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
const SUGGESTION_INFO = {
  suggested_txn_id: 'manual-2', proposal_id: 42, confidence: 0.87,
};

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
  ['transactions/row-renderers.js'],
  'getSplitPieceTreatment, renderWaitingPieceBadges',
  { escapeHtml },
);
const { getSplitPieceTreatment, renderWaitingPieceBadges } = rowRenderers;

test('a normal split keeps Modify, Delete and the editable date', () => {
  const treatment = getSplitPieceTreatment(waitingParent({ splits_awaiting_match: undefined }), false);
  assert.equal(treatment.waitingKind, null);
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
    assert.equal(treatment.waitingKind, 'matched');
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

  test(`a suggested waiting piece (${shape}) approves and dismisses by suggestion, with no edit controls`, () => {
    const treatment = getSplitPieceTreatment(waitingParent({ suggestion_info: SUGGESTION_INFO }), splitIsBroken);
    assert.equal(treatment.waitingKind, 'suggested');
    assert.equal(treatment.approve.call, 'approveSuggestion');
    assert.deepEqual(plain(treatment.approve.args), ['manual-2', 'plaid-1', 'acct-1']);
    assert.equal(treatment.reject.call, 'dismissSuggestion');
    assert.deepEqual(plain(treatment.reject.args), [42, 'acct-1']);
    assert.equal(treatment.rowCssClass, 'suggested-row');
    assert.equal(treatment.sourceBadge.label, 'Suggested');
    assert.match(treatment.sourceBadge.title, /87%/);
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

  const suggested = renderWaitingPieceBadges(
    getSplitPieceTreatment(waitingParent({ suggestion_info: SUGGESTION_INFO }), false),
  );
  assert.match(suggested, /approveSuggestion\('manual-2', 'plaid-1', 'acct-1'\)/);
  assert.match(suggested, /dismissSuggestion\(42, 'acct-1'\)/);
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

test('a suggested waiting piece gets the suggestion actions, then Inspect Data', () => {
  const parent = waitingParent({ suggestion_info: SUGGESTION_INFO });
  const actions = menu._buildMenuItems(pieceTxnData(parent)).map(item => item.action);
  assert.deepEqual(plain(actions), [
    'approve-suggestion', 'dismiss-suggestion', 'inspect-suggestion', 'inspect-data',
  ]);
});

test('a waiting piece never offers Match, Modify or Delete', () => {
  for (const extra of [{ match_info: MATCH_INFO }, { suggestion_info: SUGGESTION_INFO }]) {
    const actions = menu._buildMenuItems(pieceTxnData(waitingParent(extra))).map(item => item.action);
    for (const forbidden of ['match-to-adjacent', 'modify', 'delete']) {
      assert.equal(actions.includes(forbidden), false);
    }
  }
});

test('a piece of an ordinary split keeps its old menu', () => {
  const parent = waitingParent({ splits_awaiting_match: undefined, status: 'converted' });
  const actions = menu._buildMenuItems(pieceTxnData(parent)).map(item => item.action);
  assert.deepEqual(plain(actions), ['match-to-adjacent', 'inspect-data']);
});

test('a piece row resolves the manual and suggestion ids from its parent', () => {
  const matched = waitingParent({ match_info: MATCH_INFO });
  const suggested = waitingParent({ transaction_id: 'plaid-2', suggestion_info: SUGGESTION_INFO });
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
  const sandbox = { accounts: linkedAccounts, visibleTransactions: [], transactions: [matched, suggested] };
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

  const suggestedData = contextMenu._buildContextTxnData(pieceRow(suggested));
  assert.equal(suggestedData.suggestionTxnId, 'manual-2');
  assert.equal(suggestedData.suggestionProposalId, 42);
  assert.equal(suggestedData.txnId, 'plaid-2');
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

test('Approve All skips suggestions and unsplit pairs seen from the Plaid side', () => {
  const suggested = waitingParent({ suggestion_info: SUGGESTION_INFO });
  const unsplitPair = {
    transaction_id: 'plaid-3', source: 'plaid', status: 'cleared', match_info: { matched_txn_id: 'manual-3' },
  };
  assert.deepEqual(plain(approveAll._collectApproveAllMatchIds([suggested, unsplitPair, null])), []);
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

test('a suggested waiting split payload counts its pieces and not the hidden manual row', () => {
  const hiddenManual = {
    transaction_id: 'manual-2',
    source: 'manual',
    status: 'missing',
    hidden_by_suggestion: true,
    amount: -100,
    analytics_class: 'spending',
  };
  const plaid = waitingParent({ suggestion_info: SUGGESTION_INFO });
  const entries = loadAnalytics([hiddenManual, plaid])._collectVisibleLedgerAnalyticsEntries();
  assert.deepEqual(plain(entries.map(entry => entry.amount)), [-60, -40]);
});
