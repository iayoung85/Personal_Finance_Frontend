const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads source files into one sandbox (in order) and returns what the test asks for.
function load(relPaths, exportsList, sandboxGlobals = {}) {
  const source = relPaths
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...sandboxGlobals };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return sandbox.module.exports;
}

// Objects built inside a vm sandbox come from another realm; copy them first.
const plain = value => JSON.parse(JSON.stringify(value));

const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const piece = (id, amount, extra = {}) => ({
  transaction_id: id, amount, source: 'split', status: 'cleared', ...extra,
});

const MATCH_INFO = { matched_txn_id: 'manual-1', matched_bill_id: null };

// The Plaid row as the API sends it while its manual side's pieces wait.
const waitingParent = (extra = {}) => ({
  transaction_id: 'plaid-1',
  source: 'plaid',
  status: 'cleared',
  account_id: 'acct-1',
  amount: -100,
  is_split: true,
  splits_awaiting_match: true,
  splits: [
    piece('manual-1_split_0', -60, { analytics_class: 'spending' }),
    piece('manual-1_split_1', -40, { analytics_class: 'spending' }),
  ],
  ...extra,
});

// ── Treatment of a piece ───────────────────────────────────────

const rowRenderers = load(
  ['transactions/transaction-types.js', 'transactions/row-renderers.js'],
  'getSplitPieceTreatment, renderWaitingPieceBadges',
  { escapeHtml },
);
const { getSplitPieceTreatment, renderWaitingPieceBadges } = rowRenderers;

test('a normal split keeps Modify, Delete and the editable date', () => {
  const treatment = getSplitPieceTreatment(waitingParent({ splits_awaiting_match: undefined }), false);
  assert.equal(treatment.approve, null);
  assert.equal(treatment.reject, null);
  assert.equal(treatment.firstPieceButton, 'modify');
  assert.equal(treatment.showDelete, true);
  assert.equal(treatment.dateEditable, true);
  assert.equal(renderWaitingPieceBadges(treatment), '');
});

test('a broken normal split still offers Repair', () => {
  const treatment = getSplitPieceTreatment(waitingParent({ splits_awaiting_match: undefined }), true);
  assert.equal(treatment.firstPieceButton, 'repair');
  assert.equal(treatment.showBrokenBadge, true);
  assert.equal(treatment.showDelete, true);
});

for (const splitIsBroken of [false, true]) {
  const shape = splitIsBroken ? 'fuzzy' : 'exact';

  test(`a matched waiting piece (${shape}) approves and unmatches by the manual id, with no edit controls`, () => {
    const treatment = getSplitPieceTreatment(waitingParent({ match_info: MATCH_INFO }), splitIsBroken);
    assert.deepEqual(plain(treatment.approve.args), ['manual-1', 'acct-1']);
    assert.equal(treatment.approve.call, 'approveMatchedTransactionAndRefresh');
    assert.deepEqual(plain(treatment.reject), {
      call: 'unmatchScheduledTransaction',
      args: ['manual-1'],
      title: treatment.reject.title,
    });
    assert.equal(treatment.rowCssClass, 'matched-row');
    assert.equal(treatment.sourceBadge.label, 'Matched');
    assert.equal(treatment.firstPieceButton, 'none');
    assert.equal(treatment.showDelete, false);
    assert.equal(treatment.dateEditable, false);
    assert.equal(treatment.showBrokenBadge, splitIsBroken);
  });
}

test('a waiting piece of a bill match carries the bill badge', () => {
  const withBill = getSplitPieceTreatment(waitingParent({
    match_info: { ...MATCH_INFO, matched_bill_id: 'bill-1', matched_name: 'Rent', matched_occurrence_number: 3 },
  }), false);
  assert.match(withBill.billBadgeHtml, /bill-provenance/);
  assert.match(withBill.billBadgeHtml, /Matched bill #3 of Rent/);
  assert.equal(withBill.sourceBadge.title, 'Bill-matched plaid transaction');

  const withoutBill = getSplitPieceTreatment(waitingParent({ match_info: MATCH_INFO }), false);
  assert.equal(withoutBill.billBadgeHtml, '');
});

test('waiting badges call the same handlers the unsplit waiting row does', () => {
  const matched = renderWaitingPieceBadges(
    getSplitPieceTreatment(waitingParent({ match_info: MATCH_INFO }), false),
  );
  assert.match(matched, /approveMatchedTransactionAndRefresh\('manual-1', 'acct-1'\)\.catch/);
  assert.match(matched, /unmatchScheduledTransaction\('manual-1'\)/);
  assert.ok(matched.indexOf('✓') < matched.indexOf('✗'));
});

// A non-split manual row matched onto a Plaid row that is split itself: the
// pieces are the Plaid row's own, so `splits_awaiting_match` is absent, but
// the parent is still waiting and the API refuses split edits on it.
const ownSplitWaitingParent = (extra = {}) => waitingParent({
  splits_awaiting_match: undefined,
  match_info: { ...MATCH_INFO, compare: { yours: { name: 'Groceries' }, bank: { name: 'MARKET' } } },
  splits: [
    piece('plaid-1_split_0', -60, { analytics_class: 'spending' }),
    piece('plaid-1_split_1', -40, { analytics_class: 'spending' }),
  ],
  ...extra,
});

for (const splitIsBroken of [false, true]) {
  const shape = splitIsBroken ? 'broken' : 'whole';

  test(`a waiting Plaid row's own pieces (${shape}) offer no modify, repair, delete or date edit`, () => {
    const treatment = getSplitPieceTreatment(ownSplitWaitingParent(), splitIsBroken);
    assert.equal(treatment.firstPieceButton, 'none');
    assert.equal(treatment.showDelete, false);
    assert.equal(treatment.dateEditable, false);
    assert.equal(treatment.showBrokenBadge, splitIsBroken);
    assert.equal(treatment.rowCssClass, 'matched-row');
    assert.equal(treatment.sourceBadge.label, 'Matched');
  });
}

test('a waiting Plaid row\'s own pieces approve, unmatch and compare like lent pieces', () => {
  const ownBadges = renderWaitingPieceBadges(getSplitPieceTreatment(ownSplitWaitingParent(), false));
  const lentBadges = renderWaitingPieceBadges(getSplitPieceTreatment(
    waitingParent({ match_info: ownSplitWaitingParent().match_info }), false,
  ));
  assert.equal(ownBadges, lentBadges);
  assert.match(ownBadges, /approveMatchedTransactionAndRefresh\('manual-1', 'acct-1'\)\.catch/);
  assert.match(ownBadges, /unmatchScheduledTransaction\('manual-1'\)/);
  assert.match(ownBadges, /toggleMatchCompare\(this, 'plaid-1'\)/);
});

// ── Menu of a waiting piece ────────────────────────────────────

const linkedAccounts = [{ account_id: 'acct-1', connection_status: 'linked', plaid_type: 'depository' }];
const menu = load(
  ['transactions/transaction-types.js', 'transactions/context-menu.js'],
  '_buildMenuItems, _buildContextTxnData',
  { accounts: linkedAccounts, visibleTransactions: [] },
);

// What _buildContextTxnData gives a right-clicked piece row.
function pieceTxnData(parent, index = 0) {
  return {
    txnId: parent.transaction_id,
    isSplit: true,
    isSplitChild: true,
    parentTransaction: parent,
    localTransaction: parent.splits[index],
    relatedData: parent,
  };
}

test('a matched waiting piece gets the match actions, then Inspect Data', () => {
  const parent = waitingParent({ match_info: MATCH_INFO });
  const actions = menu._buildMenuItems(pieceTxnData(parent)).map(item => item.action);
  assert.deepEqual(plain(actions), [
    'approve-match', 'approve-all-matches', 'unmatch', 'inspect-match', 'inspect-data',
  ]);
});

test('a waiting piece never offers Match, Modify or Delete', () => {
  const actions = menu._buildMenuItems(pieceTxnData(waitingParent({ match_info: MATCH_INFO }))).map(item => item.action);
  for (const forbidden of ['match-to-adjacent', 'modify', 'delete']) {
    assert.equal(actions.includes(forbidden), false);
  }
});

test('a piece of a waiting Plaid row\'s own split gets the match actions, not Match or Modify', () => {
  const actions = menu._buildMenuItems(pieceTxnData(ownSplitWaitingParent())).map(item => item.action);
  assert.deepEqual(plain(actions), [
    'approve-match', 'approve-all-matches', 'unmatch', 'inspect-match', 'inspect-data',
  ]);
});

test('a piece of an ordinary split keeps its old menu', () => {
  const parent = waitingParent({ splits_awaiting_match: undefined, status: 'converted' });
  const actions = menu._buildMenuItems(pieceTxnData(parent)).map(item => item.action);
  assert.deepEqual(plain(actions), ['match-to-adjacent', 'inspect-data']);
});

test('a piece row resolves the manual id from its parent', () => {
  const matched = waitingParent({ match_info: MATCH_INFO });
  const pieceRow = parent => ({
    dataset: {
      txnId: parent.transaction_id,
      parentTxnId: parent.transaction_id,
      splitTxnId: parent.splits[0].transaction_id,
      splitIndex: '0',
      source: 'split',
      status: 'cleared',
      accountId: parent.account_id,
      isSplit: 'true',
    },
  });
  const sandbox = { accounts: linkedAccounts, visibleTransactions: [], transactions: [matched] };
  const contextMenu = load(
    ['transactions/transaction-types.js', 'transactions/context-menu.js'],
    '_buildContextTxnData',
    sandbox,
  );

  const matchedData = contextMenu._buildContextTxnData(pieceRow(matched));
  assert.equal(matchedData.matchManualTxnId, 'manual-1');
  assert.equal(matchedData.txnId, 'plaid-1');
  assert.equal(matchedData.accountId, 'acct-1');
  assert.equal(matchedData.isSplitChild, true);
});

// ── Approve All Matches ────────────────────────────────────────

const approveAll = load(
  ['transactions/transaction-types.js', 'transactions/context-menu.js'],
  '_collectApproveAllMatchIds',
  { accounts: linkedAccounts, visibleTransactions: [] },
);

test('Approve All finds a waiting split pair through its Plaid row, once', () => {
  const hiddenManual = {
    transaction_id: 'manual-1', source: 'manual', status: 'matched', hidden_by_match: true,
  };
  const plaid = waitingParent({ match_info: MATCH_INFO });

  // Only the Plaid row passed the filters (the pieces matched, the manual row did not).
  assert.deepEqual(plain(approveAll._collectApproveAllMatchIds([plaid])), ['manual-1']);
  // Both rows in view name the same approval.
  assert.deepEqual(plain(approveAll._collectApproveAllMatchIds([hiddenManual, plaid])), ['manual-1']);
  // Only the hidden manual row in view still counts, as before.
  assert.deepEqual(plain(approveAll._collectApproveAllMatchIds([hiddenManual])), ['manual-1']);
});

test('Approve All skips unsplit pairs seen from the Plaid side', () => {
  const unsplitPair = {
    transaction_id: 'plaid-3', source: 'plaid', status: 'cleared', match_info: { matched_txn_id: 'manual-3' },
  };
  assert.deepEqual(plain(approveAll._collectApproveAllMatchIds([unsplitPair, null])), []);
});

// ── Analytics ──────────────────────────────────────────────────

function loadAnalytics(visible) {
  return load(
    ['transactions/transaction-types.js', 'transactions/analytics.js'],
    '_collectVisibleLedgerAnalyticsEntries',
    {
      visibleTransactions: visible,
      selectedAccountMode: 'single',
      parseCategoryString: label => ({ primary: String(label || ''), detailed: '' }),
      _splitMatchesSearch: () => true,
      _splitMatchesCategoryFilter: () => true,
    },
  );
}

test('a waiting split payload counts its pieces and not the hidden manual row', () => {
  const hiddenManual = {
    transaction_id: 'manual-1',
    source: 'manual',
    status: 'matched',
    hidden_by_match: true,
    amount: -100,
    analytics_class: 'spending',
  };
  const plaid = waitingParent({ match_info: MATCH_INFO, analytics_class: 'spending' });
  const entries = loadAnalytics([hiddenManual, plaid])._collectVisibleLedgerAnalyticsEntries();
  assert.deepEqual(plain(entries.map(entry => entry.amount)), [-60, -40]);
  assert.deepEqual(plain(entries.map(entry => entry.txn_type)), ['SPLIT_CHILD', 'SPLIT_CHILD']);
});
