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

const COMPARE = {
  yours: { date: '2026-01-12', name: 'Corner cafe', amount: -40.0, category: 'Food: Dining' },
  bank: {
    date: '2026-01-15', name: 'SQ *CORNER CAFE', amount: -41.5, memo: 'Bank memo',
    plaid_category: 'Food And Drink: Coffee', mapped_category: 'Food: Coffee shops',
  },
};

// The Plaid row of a waiting match, previewed as approval will leave it.
const waitingPlaidRow = (extra = {}) => ({
  transaction_id: 'plaid-1',
  source: 'plaid',
  status: 'cleared',
  account_id: 'acct-1',
  amount: -41.5,
  name: 'SQ *CORNER CAFE',
  merchant_name: 'Square Corner',
  user_description_override: 'Corner cafe',
  user_category: 'Food: Dining',
  match_info: {
    matched_txn_id: 'manual-1',
    matched_name: 'Corner cafe',
    matched_description: 'Stale name from match_info',
    matched_user_category: 'Stale: Category',
    compare: COMPARE,
  },
  ...extra,
});

const normalPlaidRow = () => ({
  transaction_id: 'plaid-2', source: 'plaid', status: 'cleared', account_id: 'acct-1', amount: -10,
});

// ── The waiting-row helper ─────────────────────────────────────

const types = load(
  ['transactions/transaction-types.js'],
  'isWaitingMatchRow, getRowEditAffordances, TXN_TYPE, WAITING_MATCH_LOCK_REASON',
);

test('the Plaid row and the hidden matched rows are waiting; ordinary rows and pieces are not', () => {
  assert.equal(types.isWaitingMatchRow(waitingPlaidRow()), true);
  assert.equal(types.isWaitingMatchRow({ source: 'manual', status: 'matched', hidden_by_match: true }), true);
  // A matched row whose bank row is in another account's list is not
  // flagged hidden, but still points at it.
  assert.equal(types.isWaitingMatchRow({ source: 'manual', status: 'matched', matched_transaction_id: 41 }), true);
  assert.equal(types.isWaitingMatchRow({ source: 'scheduled', status: 'matched', matched_transaction_id: 41 }), true);

  assert.equal(types.isWaitingMatchRow(normalPlaidRow()), false);
  assert.equal(types.isWaitingMatchRow({ source: 'manual', status: 'cleared' }), false);
  assert.equal(types.isWaitingMatchRow({ source: 'split', status: 'cleared' }), false);
  assert.equal(types.isWaitingMatchRow(null), false);
});

test('a matched row whose bank row is gone is no longer waiting, and keeps its edits', () => {
  // Deleting the bank row clears the pointer, so the list sends neither it
  // nor hidden_by_match.
  const orphanedManual = { transaction_id: 'manual-9', source: 'manual', status: 'matched', amount: -12 };
  const orphanedBill = { transaction_id: 'bill-9', source: 'scheduled', status: 'matched', amount: -12 };
  assert.equal(types.isWaitingMatchRow(orphanedManual), false);
  assert.equal(types.isWaitingMatchRow(orphanedBill), false);
  assert.equal(types.isWaitingMatchRow({ ...orphanedManual, matched_transaction_id: null }), false);

  const affordances = types.getRowEditAffordances(orphanedManual, types.TXN_TYPE.MANUAL_MATCH);
  assert.equal(affordances.lockReason, '');
  assert.equal(affordances.memo, true);
  assert.equal(affordances.category, true);
});

test('a waiting row offers no inline edit; a normal Plaid row keeps its edits', () => {
  const locked = plain(types.getRowEditAffordances(waitingPlaidRow(), types.TXN_TYPE.PLAID_CLEARED));
  assert.deepEqual(locked, {
    date: false, description: false, amount: false, memo: false, category: false,
    lockReason: types.WAITING_MATCH_LOCK_REASON,
  });

  const open = plain(types.getRowEditAffordances(normalPlaidRow(), types.TXN_TYPE.PLAID_CLEARED));
  assert.deepEqual(open, {
    date: true, description: true, amount: true, memo: true, category: true, lockReason: '',
  });
});

test('an auto-split bill still locks only its amount', () => {
  const affordances = types.getRowEditAffordances(
    { source: 'scheduled', status: 'future', has_splits_template: true },
    types.TXN_TYPE.BILL_FUTURE,
  );
  assert.equal(affordances.amount, false);
  assert.equal(affordances.date, true);
  assert.equal(affordances.memo, true);
});

// ── Name and category on a waiting row ─────────────────────────

const renderers = load(
  ['transactions/transaction-types.js', 'transactions/row-renderers.js'],
  'renderRowByType, getSplitPieceTreatment, renderWaitingPieceBadges',
  { escapeHtml },
);

const renderWaiting = txn => renderers.renderRowByType({
  txn,
  txnId: txn.transaction_id,
  accountId: txn.account_id,
  currentFullCategory: txn.user_category,
  isBill: false,
  isTransfer: false,
  isPendingRow: false,
  rowType: 'PLAID_CLEARED',
});

test('a waiting row shows its own name and category, not match_info', () => {
  const rendered = renderWaiting(waitingPlaidRow());
  // The table puts user_description_override over displayName; displayName
  // itself is the row's own name, never matched_description.
  assert.equal(rendered.displayName, 'Square Corner');
  assert.doesNotMatch(rendered.categoryCell, /Stale: Category/);
  assert.match(rendered.categoryCell, /Food: Dining/);
});

test('a waiting row category is plain text with the reason, not an editor', () => {
  const rendered = renderWaiting(waitingPlaidRow());
  assert.doesNotMatch(rendered.categoryCell, /category-autocomplete/);
  assert.match(rendered.categoryCell, /category-locked/);
  assert.match(rendered.categoryCell, /Approve or unmatch this match first/);
});

test('a waiting row carries the compare button beside ✓ and ✗, when the API sends compare', () => {
  const withCompare = renderWaiting(waitingPlaidRow()).typeBadge;
  assert.match(withCompare, /approve-match-badge[\s\S]*reject-match-badge[\s\S]*compare-match-badge/);
  assert.match(withCompare, /toggleMatchCompare\(this, 'plaid-1'\)/);
  assert.match(withCompare, /title="Compare"/);

  const oldApiRow = waitingPlaidRow();
  delete oldApiRow.match_info.compare;
  assert.doesNotMatch(renderWaiting(oldApiRow).typeBadge, /compare-match-badge/);
});

test('a waiting split piece carries the same compare button', () => {
  const parent = waitingPlaidRow({
    is_split: true,
    splits_awaiting_match: true,
    splits: [{ transaction_id: 'manual-1_split_0', amount: -41.5 }],
  });
  const badges = renderers.renderWaitingPieceBadges(renderers.getSplitPieceTreatment(parent, false));
  assert.match(badges, /toggleMatchCompare\(this, 'plaid-1'\)/);
});

// ── Compare popover content ────────────────────────────────────

const compareModule = load(
  ['transactions/waiting-match.js'],
  'buildMatchCompareSections, renderMatchCompareHtml, placeMatchComparePopover, accountsTouchedByMatch',
  {
    escapeHtml,
    formatDate: value => `D(${value})`,
    _fmtCurrency: (value, code) => `${code || 'USD'} ${value.toFixed(2)}`,
  },
);

test('the compare sections list your side and the bank side in order', () => {
  const sections = plain(compareModule.buildMatchCompareSections(COMPARE));
  assert.deepEqual(sections.map(section => section.title), ['Your transaction', 'Plaid-downloaded transaction']);
  assert.deepEqual(sections[0].rows.map(row => [row.label, row.value]), [
    ['Date', '2026-01-12'], ['Name', 'Corner cafe'], ['Amount', -40], ['Category', 'Food: Dining'],
  ]);
  assert.deepEqual(sections[1].rows.map(row => [row.label, row.value]), [
    ['Date', '2026-01-15'], ['Name', 'SQ *CORNER CAFE'], ['Amount', -41.5],
    ['Plaid category', 'Food And Drink: Coffee'], ['Maps to', 'Food: Coffee shops'],
    ['Memo', 'Bank memo'],
  ]);
});

test('a bank row without a Plaid category lists neither category row', () => {
  const compare = {
    yours: COMPARE.yours,
    bank: { ...COMPARE.bank, plaid_category: null, mapped_category: null },
  };
  const bankRows = plain(compareModule.buildMatchCompareSections(compare))[1].rows;
  assert.deepEqual(bankRows.map(row => row.label), ['Date', 'Name', 'Amount', 'Memo']);
});

test('a blank bank memo is left out', () => {
  for (const memo of ['', '   ', null, undefined]) {
    const compare = { yours: COMPARE.yours, bank: { ...COMPARE.bank, memo } };
    const bankRows = plain(compareModule.buildMatchCompareSections(compare))[1].rows;
    assert.deepEqual(
      bankRows.map(row => row.label),
      ['Date', 'Name', 'Amount', 'Plaid category', 'Maps to'],
    );
    assert.doesNotMatch(compareModule.renderMatchCompareHtml(compare), /<dt>Memo<\/dt>/);
  }
});

test('the popover HTML formats dates and amounts like the ledger and escapes names', () => {
  const compare = { yours: { ...COMPARE.yours, name: 'A & <B>' }, bank: COMPARE.bank };
  const html = compareModule.renderMatchCompareHtml(compare, 'USD');
  assert.match(html, /<dt>Date<\/dt><dd>D\(2026-01-12\)<\/dd>/);
  assert.match(html, /<dt>Amount<\/dt><dd class="ledger-negative">USD -40.00<\/dd>/);
  assert.match(html, /<dd>A &amp; &lt;B&gt;<\/dd>/);
  assert.match(html, /<dt>Memo<\/dt><dd>Bank memo<\/dd>/);
  assert.match(html, /Your transaction[\s\S]*Plaid-downloaded transaction/);
});

test('nothing to compare gives no popover content', () => {
  assert.equal(compareModule.renderMatchCompareHtml(undefined), '');
  assert.equal(compareModule.renderMatchCompareHtml({}), '');
});

test('the popover opens below its button and stays inside the viewport', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 260, height: 200 };

  const roomy = plain(compareModule.placeMatchComparePopover({ top: 100, bottom: 122, left: 300, right: 322 }, size, viewport));
  assert.deepEqual(roomy, { left: 300, top: 126 });

  const nearBottom = plain(compareModule.placeMatchComparePopover({ top: 700, bottom: 722, left: 300, right: 322 }, size, viewport));
  assert.deepEqual(nearBottom, { left: 300, top: 496 });

  const nearRight = plain(compareModule.placeMatchComparePopover({ top: 100, bottom: 122, left: 900, right: 922 }, size, viewport));
  assert.deepEqual(nearRight, { left: 732, top: 126 });

  const tinyViewport = plain(compareModule.placeMatchComparePopover(
    { top: 50, bottom: 72, left: 10, right: 32 }, size, { width: 300, height: 240 },
  ));
  assert.deepEqual(tinyViewport, { left: 10, top: 32 });
});

// ── Accounts an unmatch touches ────────────────────────────────

// Both rows of a transfer carry one shared pair id. While the match waits,
// the Plaid row previews the manual row's pair, so all three name it.
const PAIR_ID = 'xfr_6f1c2b9e-7d3a-4c51-9a0e-2b8d4f6a1c3e';

test('unmatch refreshes the waiting row\'s account and a transfer partner in another account', () => {
  const rows = [
    { transaction_id: 'manual-1', account_id: 'acct-1', source: 'manual', status: 'matched', hidden_by_match: true, transfer_pair_id: PAIR_ID },
    waitingPlaidRow({ transfer_pair_id: PAIR_ID }),
    { transaction_id: 'far-1', account_id: 'acct-2', source: 'plaid', status: 'cleared', transfer_pair_id: PAIR_ID },
    { transaction_id: 'other', account_id: 'acct-3', transfer_pair_id: 'xfr_00000000-0000-4000-8000-000000000000' },
  ];
  assert.deepEqual(plain(compareModule.accountsTouchedByMatch('manual-1', rows)).sort(), ['acct-1', 'acct-2']);
});

test('a cached partner is found by its shared pair id, even when no side names its account', () => {
  const rows = [
    waitingPlaidRow({ transfer_pair_id: PAIR_ID }),
    { transaction_id: 'far-1', account_id: 'acct-2', transfer_pair_id: PAIR_ID },
  ];
  assert.deepEqual(plain(compareModule.accountsTouchedByMatch('manual-1', rows)).sort(), ['acct-1', 'acct-2']);
});

test('a pair the Plaid row already holds refreshes that partner too', () => {
  const ownPairId = 'xfr_1a2b3c4d-0000-4000-8000-00000000abcd';
  const rows = [
    { transaction_id: 'manual-1', account_id: 'acct-1', source: 'manual', status: 'matched', hidden_by_match: true },
    waitingPlaidRow({ transfer_pair_id: ownPairId }),
    { transaction_id: 'own-partner', account_id: 'acct-4', transfer_pair_id: ownPairId },
  ];
  assert.deepEqual(plain(compareModule.accountsTouchedByMatch('manual-1', rows)).sort(), ['acct-1', 'acct-4']);
});

test('a match with no transfer touches only its own account', () => {
  const rows = [
    { transaction_id: 'manual-1', account_id: 'acct-1', source: 'manual', status: 'matched', hidden_by_match: true },
    waitingPlaidRow(),
  ];
  assert.deepEqual(plain(compareModule.accountsTouchedByMatch('manual-1', rows)), ['acct-1']);
});

test('an uncached partner falls back to its named account, or to a full fetch', () => {
  const named = [waitingPlaidRow({ transfer_pair_id: PAIR_ID, transfer_partner_account_id: 'acct-9' })];
  assert.deepEqual(plain(compareModule.accountsTouchedByMatch('manual-1', named)).sort(), ['acct-1', 'acct-9']);

  const unnamed = [waitingPlaidRow({ transfer_pair_id: PAIR_ID })];
  assert.equal(compareModule.accountsTouchedByMatch('manual-1', unnamed), null);
  assert.equal(compareModule.accountsTouchedByMatch('missing', []), null);
});

// ── Context menu on a waiting row ──────────────────────────────

const menu = load(
  ['transactions/transaction-types.js', 'transactions/context-menu.js'],
  '_buildMenuItems',
  { accounts: [], visibleTransactions: [] },
);

const menuDataFor = (txn, extra = {}) => ({
  txnId: txn.transaction_id,
  source: txn.source,
  status: txn.status,
  accountId: txn.account_id,
  amount: txn.amount,
  isSplit: false,
  isSplitChild: false,
  isHidden: false,
  amountModified: false,
  matchManualTxnId: txn.match_info ? txn.match_info.matched_txn_id : '',
  localTransaction: txn,
  ...extra,
});

test('a waiting row disables transfer and reset, with the reason, and keeps hide and approve', () => {
  const items = plain(menu._buildMenuItems(menuDataFor(waitingPlaidRow(), { amountModified: true })));
  const byAction = Object.fromEntries(items.map(item => [item.action, item]));

  for (const lockedAction of ['make-transfer', 'reset-plaid-amount']) {
    assert.equal(byAction[lockedAction].disabled, true, lockedAction);
    assert.equal(byAction[lockedAction].disabledReason, 'Approve or unmatch this match first');
  }
  for (const openAction of ['approve-match', 'approve-all-matches', 'hide', 'inspect-match', 'inspect-data']) {
    assert.ok(byAction[openAction], openAction);
    assert.ok(!byAction[openAction].disabled, openAction);
  }
  assert.equal(byAction.modify, undefined);
  assert.equal(byAction.delete, undefined);
});

test('a hidden waiting row offers Unhide', () => {
  const actions = plain(menu._buildMenuItems(menuDataFor(waitingPlaidRow(), { isHidden: true }))).map(item => item.action);
  assert.ok(actions.includes('unhide'));
  assert.ok(!actions.includes('hide'));
});

test('a normal Plaid row keeps its transfer and reset items enabled', () => {
  const items = plain(menu._buildMenuItems(menuDataFor(normalPlaidRow(), { amountModified: true })));
  const byAction = Object.fromEntries(items.map(item => [item.action, item]));
  assert.ok(byAction['make-transfer'] && !byAction['make-transfer'].disabled);
  assert.ok(byAction['reset-plaid-amount'] && !byAction['reset-plaid-amount'].disabled);
});

// ── Reset to Plaid on the menu ─────────────────────────────────

const menuActionsFor = (txn, extra = {}) => (
  plain(menu._buildMenuItems(menuDataFor(txn, extra))).map(item => item.action)
);

test('a posted bank row offers Reset to Plaid, with or without an amount override', () => {
  assert.ok(menuActionsFor(normalPlaidRow()).includes('reset-to-plaid'));
  assert.ok(menuActionsFor(normalPlaidRow(), { amountModified: true }).includes('reset-to-plaid'));
  assert.ok(menuActionsFor(normalPlaidRow(), { isHidden: true }).includes('reset-to-plaid'));
});

test('a converted bank row offers Reset to Plaid', () => {
  const converted = { ...normalPlaidRow(), status: 'converted' };
  assert.ok(menuActionsFor(converted).includes('reset-to-plaid'));
});

test('a split bank row offers Reset to Plaid, its pieces do not', () => {
  assert.ok(menuActionsFor(normalPlaidRow(), { isSplit: true }).includes('reset-to-plaid'));
  const piece = { transaction_id: 'piece-1', source: 'split', status: 'cleared', account_id: 'acct-1' };
  assert.ok(!menuActionsFor(piece, { isSplit: true, isSplitChild: true }).includes('reset-to-plaid'));
  assert.ok(!menuActionsFor(
    { ...normalPlaidRow(), source: 'plaid' },
    { isSplit: true, isSplitChild: true },
  ).includes('reset-to-plaid'));
});

test('pending, manual, scheduled and waiting-match rows do not offer Reset to Plaid', () => {
  const rows = {
    pending: { ...normalPlaidRow(), status: 'pending' },
    manual: { transaction_id: 'm-1', source: 'manual', status: 'cleared', account_id: 'acct-1', amount: -5 },
    missing: { transaction_id: 'b-1', source: 'scheduled', status: 'missing', account_id: 'acct-1', amount: -5 },
    waitingBank: waitingPlaidRow(),
    waitingManual: {
      transaction_id: 'manual-1', source: 'manual', status: 'matched', account_id: 'acct-1',
      amount: -40, matched_transaction_id: 'plaid-1', hidden_by_match: true,
    },
  };
  for (const [name, row] of Object.entries(rows)) {
    assert.ok(!menuActionsFor(row).includes('reset-to-plaid'), name);
  }
  // A split bank row on a waiting match is locked out too.
  assert.ok(!menuActionsFor(waitingPlaidRow(), { isSplit: true }).includes('reset-to-plaid'));
});

// ── Filtered export ────────────────────────────────────────────

const exporter = load(
  ['transactions/export.js'],
  '_getFilteredExportRows',
  { _splitMatchesSearch: () => true, _splitMatchesCategoryFilter: () => true },
);

test('a waiting match exports once: the previewed Plaid row, never the hidden matched row', () => {
  const rows = [
    { transaction_id: 'manual-1', source: 'manual', status: 'matched', hidden_by_match: true, amount: -40 },
    waitingPlaidRow(),
  ];
  const exported = exporter._getFilteredExportRows(rows).map(row => row.txn.transaction_id);
  assert.deepEqual(plain(exported), ['plaid-1']);
});

test('a waiting split exports its pieces once, under the Plaid row', () => {
  const rows = [
    { transaction_id: 'manual-1', source: 'manual', status: 'matched', hidden_by_match: true, amount: -41.5 },
    waitingPlaidRow({
      is_split: true,
      splits_awaiting_match: true,
      splits: [
        { transaction_id: 'manual-1_split_0', amount: -30 },
        { transaction_id: 'manual-1_split_1', amount: -11.5 },
      ],
    }),
  ];
  const exported = plain(exporter._getFilteredExportRows(rows).map(row => [row.txn.transaction_id, row.parentTransactionId]));
  assert.deepEqual(exported, [['manual-1_split_0', 'plaid-1'], ['manual-1_split_1', 'plaid-1']]);
});

// ── Compare popover across a re-render ─────────────────────────

test('re-rendering the table closes an open compare popover first', () => {
  const events = [];
  const element = () => ({ innerHTML: '', classList: { add() {}, remove() {} }, querySelector: () => null });
  const elements = { 'table-container': element(), 'export-buttons': element(), 'pending-table-container': element() };
  const { renderTransactionTable } = load(['transactions/table-renderer.js'], 'renderTransactionTable', {
    document: {
      addEventListener() {},
      getElementById: id => elements[id] || null,
      querySelector: () => null,
    },
    window: {},
    transactions: [],
    visibleTransactions: [],
    selectedAccountId: 'acct-1',
    _scrollPositionCache: {},
    _resetVirtualScrollData() {},
    renderInsightsPanel() { events.push('rendered'); },
    closeMatchCompare() { events.push('closed'); },
  });

  renderTransactionTable();
  assert.deepEqual(events, ['closed', 'rendered']);
});
