const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads source files into one sandbox (in order) and returns the sandbox so
// a test can set globals such as `transactions` between calls.
function load(relPaths, exportsList, sandboxGlobals = {}) {
  const source = relPaths
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...sandboxGlobals };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return { api: sandbox.module.exports, sandbox };
}

// Arrays built inside a vm sandbox come from another realm, so deepEqual
// needs them copied into this one first.
const plain = value => JSON.parse(JSON.stringify(value));

const piece = (id, amount, extra = {}) => ({
  transaction_id: id, amount, source: 'split', status: 'cleared', ...extra,
});

const parentOf = (source, status, extra = {}) => ({
  transaction_id: 'p1',
  source,
  status,
  account_id: 'acct-1',
  amount: -100,
  is_split: true,
  splits: [piece('p1_split_0', -60), piece('p1_split_1', -40)],
  ...extra,
});

// ── Piece context menu ─────────────────────────────────────────

const linkedAccounts = [
  { account_id: 'acct-1', connection_status: 'linked', plaid_type: 'depository' },
  { account_id: 'acct-inv', connection_status: 'linked', plaid_type: 'investment' },
  { account_id: 'acct-manual', connection_status: 'manual', plaid_type: 'depository' },
];

const menu = load(
  ['transactions/transaction-types.js', 'transactions/context-menu.js'],
  '_canMatchSplitParent, _buildMenuItems',
  { accounts: linkedAccounts, visibleTransactions: [] },
);

test('piece menu offers Match for missing parents in any account', () => {
  assert.equal(menu.api._canMatchSplitParent(parentOf('manual', 'missing'), linkedAccounts), true);
  assert.equal(menu.api._canMatchSplitParent(parentOf('scheduled', 'missing'), linkedAccounts), true);
  assert.equal(
    menu.api._canMatchSplitParent(parentOf('manual', 'missing', { account_id: 'acct-manual' }), linkedAccounts),
    true,
  );
});

test('piece menu offers Match for converted parents and cleared manual parents in linked non-investment accounts', () => {
  assert.equal(menu.api._canMatchSplitParent(parentOf('plaid', 'converted'), linkedAccounts), true);
  assert.equal(menu.api._canMatchSplitParent(parentOf('manual', 'cleared'), linkedAccounts), true);
  assert.equal(
    menu.api._canMatchSplitParent(parentOf('manual', 'cleared', { account_id: 'acct-inv' }), linkedAccounts),
    false,
  );
  assert.equal(
    menu.api._canMatchSplitParent(parentOf('manual', 'cleared', { account_id: 'acct-manual' }), linkedAccounts),
    false,
  );
});

test('piece menu offers no Match for Plaid parents or parents with match info', () => {
  assert.equal(menu.api._canMatchSplitParent(parentOf('plaid', 'cleared'), linkedAccounts), false);
  assert.equal(menu.api._canMatchSplitParent(parentOf('plaid', 'pending'), linkedAccounts), false);
  assert.equal(
    menu.api._canMatchSplitParent(parentOf('plaid', 'cleared', { match_info: { matched_txn_id: 'm1' } }), linkedAccounts),
    false,
  );
  assert.equal(
    menu.api._canMatchSplitParent(parentOf('manual', 'missing', { match_info: { matched_txn_id: 'm1' } }), linkedAccounts),
    false,
  );
  assert.equal(menu.api._canMatchSplitParent(null, linkedAccounts), false);
});

test('a piece row gets Match plus Inspect; Match opens the picker with the parent id', () => {
  const parent = parentOf('manual', 'missing');
  const txnData = {
    txnId: 'p1',
    isSplit: true,
    isSplitChild: true,
    parentTransaction: parent,
    localTransaction: parent.splits[0],
    relatedData: parent,
  };
  const actions = menu.api._buildMenuItems(txnData).map(item => item.action);
  assert.deepEqual(plain(actions), ['match-to-adjacent', 'inspect-data']);
  // txnId is the parent's id for a piece (the row's data-txn-id), which is
  // what _handleContextMatchToAdjacent hands to the picker.
  assert.equal(txnData.txnId, parent.transaction_id);
});

test('a piece of a Plaid parent keeps Inspect only', () => {
  const parent = parentOf('plaid', 'cleared');
  const actions = menu.api._buildMenuItems({
    txnId: 'p1',
    isSplit: true,
    isSplitChild: true,
    parentTransaction: parent,
    localTransaction: parent.splits[0],
    relatedData: parent,
  }).map(item => item.action);
  assert.deepEqual(plain(actions), ['inspect-data']);
});

// ── Match picker candidates ────────────────────────────────────

const picker = load(
  ['transactions/transaction-types.js', 'transactions/resolution.js'],
  '_filterMatchPickerCandidates',
);

const plaidRow = (id, extra = {}) => ({
  transaction_id: id, source: 'plaid', status: 'cleared', account_id: 'acct-1', amount: -50, ...extra,
});

test('picker candidates skip split rows and rows with match info', () => {
  const source = parentOf('manual', 'missing');
  const all = [
    source,
    plaidRow('ok'),
    plaidRow('split', { is_split: true, splits: [piece('split_split_0', -50)] }),
    plaidRow('matched', { match_info: { matched_txn_id: 'm' } }),
    plaidRow('other-account', { account_id: 'acct-2' }),
    plaidRow('linked', { matched_transaction_id: 'x' }),
  ];
  const ids = picker.api._filterMatchPickerCandidates(source, all).map(txn => txn.transaction_id);
  assert.deepEqual(plain(ids), ['ok']);
});

test('picker keeps an is_split row whose splits are empty', () => {
  const source = parentOf('manual', 'missing', { is_split: false, splits: [] });
  const all = [plaidRow('empty-split', { is_split: true, splits: [] })];
  assert.equal(picker.api._filterMatchPickerCandidates(source, all).length, 1);
});

test('a manual cleared source is only offered Plaid cleared targets', () => {
  const source = parentOf('manual', 'cleared');
  const all = [plaidRow('p'), { ...plaidRow('c'), source: 'manual' }];
  const ids = picker.api._filterMatchPickerCandidates(source, all).map(txn => txn.transaction_id);
  assert.deepEqual(plain(ids), ['p']);
});

// ── Analytics entries ──────────────────────────────────────────

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

test('a broken split counts its pieces as written, not the parent', () => {
  const broken = parentOf('plaid', 'converted', {
    amount: -120,
    splits: [piece('p1_split_0', -60, { analytics_class: 'spending' }), piece('p1_split_1', -40, { analytics_class: 'spending' })],
  });
  const entries = loadAnalytics([broken]).api._collectVisibleLedgerAnalyticsEntries();
  assert.deepEqual(plain(entries.map(entry => entry.amount)), [-60, -40]);
  assert.deepEqual(plain(entries.map(entry => entry.txn_type)), ['SPLIT_CHILD', 'SPLIT_CHILD']);
});

test('a normal split counts its pieces', () => {
  const normal = parentOf('plaid', 'cleared', {
    splits: [piece('p1_split_0', -60, { analytics_class: 'spending' }), piece('p1_split_1', -40, { analytics_class: 'spending' })],
  });
  const entries = loadAnalytics([normal]).api._collectVisibleLedgerAnalyticsEntries();
  assert.deepEqual(plain(entries.map(entry => entry.amount)), [-60, -40]);
});

test('a hidden row shown by Show Hidden stays out of the totals', () => {
  const shown = plaidRow('shown', { amount: -25, analytics_class: 'spending' });
  const hidden = plaidRow('hidden', { amount: -70, analytics_class: 'spending', is_hidden: true });
  const entries = loadAnalytics([shown, hidden]).api._collectVisibleLedgerAnalyticsEntries();
  assert.deepEqual(plain(entries.map(entry => entry.transaction_id)), ['shown']);
});

test('a hidden split parent keeps its pieces out of the totals', () => {
  const hiddenSplit = parentOf('plaid', 'cleared', {
    is_hidden: true,
    splits: [piece('p1_split_0', -60, { analytics_class: 'spending' }), piece('p1_split_1', -40, { analytics_class: 'spending' })],
  });
  const entries = loadAnalytics([hiddenSplit]).api._collectVisibleLedgerAnalyticsEntries();
  assert.equal(entries.length, 0);
});

// ── Inspect normalization ──────────────────────────────────────

function loadInspect(cachedTransactions) {
  return load(
    ['transactions/transaction-types.js', 'transactions/inspect-bill-matching.js', 'transactions/inspect-data.js'],
    '_normalizeInspectRequest, _buildInspectWorkingData',
    { transactions: cachedTransactions, isTransferCategory: () => false },
  );
}

// Mirrors what _buildContextTxnData hands over for a right-clicked piece.
function pieceRequest(parent, index = 0) {
  return {
    txnId: parent.transaction_id,
    isSplit: true,
    isSplitChild: true,
    parentTransaction: parent,
    localTransaction: parent.splits[index],
    relatedData: parent,
    relatedTitle: 'Parent Transaction',
  };
}

test('a piece of a Plaid parent is a split child and fetches the parent raw record', () => {
  const parent = parentOf('plaid', 'converted', { amount: -120 });
  const inspect = loadInspect([parent]);
  const context = inspect.api._normalizeInspectRequest(pieceRequest(parent));
  assert.equal(context.shouldFetchPlaidRaw, true);
  assert.equal(context.transactionId, 'p1');
  assert.equal(context.sourceTitle, 'Plaid Raw Data');
  assert.equal(context.sourceData, null);
  assert.equal(context.workingTitle, 'Split Entry Data');

  const working = inspect.api._buildInspectWorkingData(context.localTransaction, context);
  assert.equal(working._inspect_meta.row_type, 'SPLIT_CHILD');
  assert.equal(working._inspect_meta.parent_transaction_id, 'p1');
});

test('a piece of a manual parent shows the parent ledger data as related data', () => {
  const parent = parentOf('manual', 'cleared');
  const inspect = loadInspect([parent]);
  const context = inspect.api._normalizeInspectRequest(pieceRequest(parent, 1));
  assert.equal(context.shouldFetchPlaidRaw, false);
  assert.equal(context.sourceTitle, 'Parent Transaction');
  assert.equal(context.sourceData, parent);
  assert.equal(context.transactionId, 'p1');
  const working = inspect.api._buildInspectWorkingData(context.localTransaction, context);
  assert.equal(working._inspect_meta.row_type, 'SPLIT_CHILD');
  assert.equal(working._inspect_meta.parent_transaction_id, 'p1');
});

test('a split parent is not labelled a split child and keeps its Plaid fetch', () => {
  const parent = parentOf('plaid', 'cleared');
  const inspect = loadInspect([parent]);
  const context = inspect.api._normalizeInspectRequest({
    txnId: 'p1',
    isSplit: true,
    isSplitChild: false,
    parentTransaction: parent,
    localTransaction: parent,
  });
  assert.equal(context.shouldFetchPlaidRaw, true);
  assert.equal(context.workingTitle, 'Ledger Transaction Data');
  const working = inspect.api._buildInspectWorkingData(context.localTransaction, context);
  assert.equal(working._inspect_meta.row_type, 'PLAID_CLEARED');
  assert.equal(working._inspect_meta.parent_transaction_id, null);
});

// ── Broken split detection ─────────────────────────────────────

test('a split is broken only when pieces differ from the parent by more than a cent', () => {
  const rendered = load(['transactions/table-renderer.js'], '_isSplitBroken', {
    document: { addEventListener() {}, getElementById: () => null },
    window: {},
  });
  assert.equal(rendered.api._isSplitBroken(parentOf('plaid', 'cleared')), false);
  assert.equal(rendered.api._isSplitBroken(parentOf('plaid', 'cleared', { amount: -100.005 })), false);
  assert.equal(rendered.api._isSplitBroken(parentOf('plaid', 'cleared', { amount: -120 })), true);
});

test('a waiting piece names the hidden manual row as its parent until approval', () => {
  const inspect = load(
    ['transactions/transaction-types.js', 'transactions/inspect-bill-matching.js', 'transactions/inspect-data.js'],
    '_inspectParentId',
    { transactions: [], isTransferCategory: () => false },
  );
  const matchedPlaidRow = {
    transaction_id: 'plaid_1',
    splits_awaiting_match: true,
    match_info: { matched_txn_id: 'manual_1' },
  };
  const approvedPlaidRow = { transaction_id: 'plaid_3', match_info: { matched_txn_id: 'manual_3' } };

  assert.equal(inspect.api._inspectParentId(matchedPlaidRow), 'manual_1');
  assert.equal(inspect.api._inspectParentId(approvedPlaidRow), 'plaid_3');
  assert.equal(inspect.api._inspectParentId(null), null);
});
