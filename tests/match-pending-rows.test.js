const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads source files into one sandbox (in order) and returns the exports.
function load(relPaths, exportsList, sandboxGlobals = {}) {
  const source = relPaths
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...sandboxGlobals };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return sandbox.module.exports;
}

// Arrays built inside a vm sandbox come from another realm; copy them first.
const plain = value => JSON.parse(JSON.stringify(value));

const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const accounts = [
  { account_id: 'acct-1', connection_status: 'linked', plaid_type: 'depository' },
  { account_id: 'acct-inv', connection_status: 'linked', plaid_type: 'investment' },
  { account_id: 'acct-manual', connection_status: 'manual', plaid_type: 'depository' },
];

const row = (id, source, status, extra = {}) => ({
  transaction_id: id, source, status, account_id: 'acct-1', amount: -50, ...extra,
});

const resolution = load(
  ['transactions/transaction-types.js', 'transactions/resolution.js'],
  '_filterMatchPickerCandidates, _isForceMatchTarget',
);
const { _filterMatchPickerCandidates, _isForceMatchTarget } = resolution;

const idsOf = rows => plain(rows).map(candidate => candidate.transaction_id);

// ── Match picker targets ───────────────────────────────────────

const everyRow = [
  row('cleared', 'plaid', 'cleared'),
  row('pending', 'plaid', 'pending', { pending: true }),
  row('pending-hidden', 'plaid', 'pending', { pending: true, is_hidden: true }),
  row('pending-matched', 'plaid', 'pending', { match_info: { matched_txn_id: 'x' } }),
  row('pending-split', 'plaid', 'pending', { is_split: true, splits: [{}, {}] }),
  row('pending-other-account', 'plaid', 'pending', { account_id: 'acct-2' }),
  row('manual-cleared', 'manual', 'cleared'),
];

for (const [label, source] of [
  ['a missing row', row('src', 'manual', 'missing')],
  ['a hand-entered cleared row', row('src', 'manual', 'cleared')],
  ['a hand-entered future row', row('src', 'manual', 'future')],
  ['an upcoming bill occurrence', row('bill_ab_occ_2026-12-01', 'scheduled', 'future', { is_bill: true })],
]) {
  test(`the picker for ${label} offers a pending bank row that is not hidden`, () => {
    const offered = idsOf(_filterMatchPickerCandidates(source, [source, ...everyRow]));
    assert.ok(offered.includes('pending'));
    assert.ok(offered.includes('cleared'));
  });

  test(`the picker for ${label} keeps its exclusions for pending rows`, () => {
    const offered = idsOf(_filterMatchPickerCandidates(source, [source, ...everyRow]));
    for (const excluded of ['pending-hidden', 'pending-matched', 'pending-split', 'pending-other-account', 'src']) {
      assert.equal(offered.includes(excluded), false, excluded);
    }
  });
}

test('a hand-entered cleared row is not offered another hand-entered row', () => {
  const source = row('src', 'manual', 'cleared');
  assert.equal(idsOf(_filterMatchPickerCandidates(source, [source, ...everyRow])).includes('manual-cleared'), false);
});

// ── Force-match targets ────────────────────────────────────────

test('force match takes a posted or a visible pending Plaid row', () => {
  assert.equal(_isForceMatchTarget(row('a', 'plaid', 'cleared')), true);
  assert.equal(_isForceMatchTarget(row('b', 'plaid', 'pending')), true);
});

test('force match refuses a hidden pending row and rows that are not bank rows', () => {
  assert.equal(_isForceMatchTarget(row('a', 'plaid', 'pending', { is_hidden: true })), false);
  assert.equal(_isForceMatchTarget(row('b', 'manual', 'cleared')), false);
  assert.equal(_isForceMatchTarget(row('c', 'scheduled', 'future')), false);
  assert.equal(_isForceMatchTarget(undefined), false);
});

// ── The one queue rule ─────────────────────────────────────────

const { rowNeedsReview } = load(['transactions/transaction-types.js'], 'rowNeedsReview');

test('a pair that waits for the bank reads the row\'s own reviewed flag', () => {
  const waits = { matched_txn_id: 'm', approval_waits_for_posting: true };
  assert.equal(rowNeedsReview({ reviewed: true, match_info: waits }), false);
  assert.equal(rowNeedsReview({ reviewed: false, match_info: waits }), true);
});

test('every other matched row stays in the queue whatever its flag says', () => {
  assert.equal(rowNeedsReview({ reviewed: true, match_info: { matched_txn_id: 'm' } }), true);
  assert.equal(rowNeedsReview({ reviewed: true, match_info: { matched_txn_id: 'm', approval_waits_for_posting: false } }), true);
  assert.equal(rowNeedsReview({ reviewed: false, match_info: { matched_txn_id: 'm' } }), true);
});

test('an ordinary row needs review only when unreviewed', () => {
  assert.equal(rowNeedsReview({ reviewed: false }), true);
  assert.equal(rowNeedsReview({ reviewed: true }), false);
  assert.equal(rowNeedsReview(null), false);
});

// ── Hide button, approve check and dot ─────────────────────────

const renderers = load(
  ['transactions/transaction-types.js', 'transactions/row-renderers.js'],
  'renderPendingHideButton, getSplitPieceTreatment, renderWaitingPieceBadges',
  { escapeHtml },
);

const pendingRow = (extra = {}) => row('p1', 'plaid', 'pending', { pending: true, is_hidden: false, ...extra });
const WAITS = { matched_txn_id: 'm1', approval_waits_for_posting: true };

test('a pending row carrying a match is offered no Hide button', () => {
  assert.match(renderers.renderPendingHideButton(pendingRow()), /pending-hide-btn/);
  assert.equal(renderers.renderPendingHideButton(pendingRow({ match_info: { matched_txn_id: 'm1' } })), '');
});

const waitingPair = (matchInfo, extra = {}) => pendingRow({
  is_split: true,
  splits_awaiting_match: true,
  splits: [{ transaction_id: 'm1_split_0', amount: -30 }, { transaction_id: 'm1_split_1', amount: -20 }],
  match_info: matchInfo,
  reviewed: false,
  ...extra,
});

test('a pair that waits for the bank draws its approve check disabled, with the reason', () => {
  const treatment = renderers.getSplitPieceTreatment(waitingPair(WAITS), false);
  const html = renderers.renderWaitingPieceBadges(treatment);
  assert.match(html, /approve-match-badge" data-txn-id="m1" disabled/);
  assert.match(html, /title="This transaction is split\. It can be approved once the bank posts it\."/);
  assert.doesNotMatch(html, /approveMatchedTransactionAndRefresh/);
  assert.match(html, /reject-match-badge/);
});

test('a pair that can be approved keeps its live approve check and has no review dot', () => {
  const treatment = renderers.getSplitPieceTreatment(waitingPair({ matched_txn_id: 'm1' }), false);
  const html = renderers.renderWaitingPieceBadges(treatment);
  assert.match(html, /approveMatchedTransactionAndRefresh/);
  assert.doesNotMatch(html, / disabled/);
  assert.equal(treatment.reviewDotTxnId, '');
});

test('the review dot is wanted only while a waiting pair is unreviewed', () => {
  assert.equal(renderers.getSplitPieceTreatment(waitingPair(WAITS), false).reviewDotTxnId, 'p1');
  assert.equal(renderers.getSplitPieceTreatment(waitingPair(WAITS, { reviewed: true }), false).reviewDotTxnId, '');
});

// ── Context menu ───────────────────────────────────────────────

const menu = load(
  ['transactions/transaction-types.js', 'transactions/context-menu.js'],
  '_buildMenuItems, _canMatchNotYetDueRow, _canMatchSplitParent, _approveAllSkipReasons',
  { accounts, visibleTransactions: [] },
);

// Context data as _buildContextTxnData makes it for a right-clicked row.
const menuData = (txn, extra = {}) => ({
  txnId: txn.transaction_id,
  source: txn.source,
  status: txn.status,
  pending: !!txn.pending,
  isBill: !!txn.is_bill,
  billId: txn.bill_id || '',
  accountId: txn.account_id,
  amount: txn.amount,
  isSplit: false,
  isSplitChild: false,
  isHidden: !!txn.is_hidden,
  matchManualTxnId: txn.match_info ? txn.match_info.matched_txn_id : '',
  localTransaction: txn,
  parentTransaction: txn,
  ...extra,
});

const itemFor = (items, action) => plain(items).find(item => item.action === action);

test('Match to Transaction is offered on rows not yet due in a linked account only', () => {
  const futureRow = row('f1', 'manual', 'future');
  const occurrence = row('bill_ab_occ_2026-12-01', 'scheduled', 'future', { is_bill: true, bill_id: 'ab' });
  const billRow = row('f2', 'manual', 'future', { is_bill: true, bill_id: 'ab' });
  for (const txn of [futureRow, occurrence, billRow]) {
    assert.ok(itemFor(menu._buildMenuItems(menuData(txn)), 'match-to-adjacent'), txn.transaction_id);
    for (const accountId of ['acct-inv', 'acct-manual']) {
      const items = menu._buildMenuItems(menuData({ ...txn, account_id: accountId }));
      assert.equal(itemFor(items, 'match-to-adjacent'), undefined, `${txn.transaction_id} in ${accountId}`);
    }
  }
});

test('the not-yet-due rule is the one place that names those types', () => {
  assert.equal(menu._canMatchNotYetDueRow('MANUAL_FUTURE', 'acct-1', accounts), true);
  assert.equal(menu._canMatchNotYetDueRow('BILL_FUTURE', 'acct-1', accounts), true);
  assert.equal(menu._canMatchNotYetDueRow('PLAID_CLEARED', 'acct-1', accounts), false);
  assert.equal(menu._canMatchNotYetDueRow('BILL_FUTURE', 'unknown', accounts), false);
});

test('a split hand-entered future row offers Match from its pieces in a linked account', () => {
  const parent = row('f3', 'manual', 'future', { is_split: true, splits: [{}, {}] });
  assert.equal(menu._canMatchSplitParent(parent, accounts), true);
  assert.equal(menu._canMatchSplitParent({ ...parent, account_id: 'acct-inv' }, accounts), false);
});

test('Hide on a matched pending row is shown disabled; Unhide and posted rows are untouched', () => {
  const pendingPair = pendingRow({ match_info: { matched_txn_id: 'm1' } });
  const hide = itemFor(menu._buildMenuItems(menuData(pendingPair)), 'hide');
  assert.equal(hide.disabled, true);
  assert.match(hide.disabledReason, /Unmatch/);

  const hidden = pendingRow({ match_info: { matched_txn_id: 'm1' }, is_hidden: true });
  assert.equal(itemFor(menu._buildMenuItems(menuData(hidden)), 'unhide').disabled, undefined);

  const postedPair = row('c1', 'plaid', 'cleared', { match_info: { matched_txn_id: 'm1' } });
  assert.equal(itemFor(menu._buildMenuItems(menuData(postedPair)), 'hide').disabled, undefined);
});

test('Approve Match is disabled for a pair that waits for the bank', () => {
  const waiting = row('c2', 'plaid', 'pending', { match_info: WAITS, pending: true });
  const approve = itemFor(menu._buildMenuItems(menuData(waiting)), 'approve-match');
  assert.equal(approve.disabled, true);
  assert.match(approve.disabledReason, /bank posts it/);

  const ordinary = row('c3', 'plaid', 'cleared', { match_info: { matched_txn_id: 'm1' } });
  assert.equal(itemFor(menu._buildMenuItems(menuData(ordinary)), 'approve-match').disabled, undefined);
});

test('Approve All names the matches left waiting for the bank to post', () => {
  assert.deepEqual(plain(menu._approveAllSkipReasons({ skipped_waits_for_posting: 2 })), [
    '2 left waiting because the transaction is split and the bank has not posted it yet',
  ]);
  assert.deepEqual(plain(menu._approveAllSkipReasons({ skipped_waits_for_posting: 0 })), []);
});

// ── Bulk edit refusal text ─────────────────────────────────────

const { _partialFailureMessage } = load(['transactions/bulk-edit.js'], '_partialFailureMessage');

test('a bulk edit that skipped rows shows the API\'s reason, once per distinct reason', () => {
  const refusal = 'This pending transaction cannot be hidden while a match waits on it. Unmatch first.';
  const results = [
    { ok: true },
    { ok: false, error: refusal },
    { ok: false, error: refusal },
  ];
  assert.equal(_partialFailureMessage(1, 2, results), `1 updated, 2 failed: ${refusal}`);
  assert.equal(_partialFailureMessage(1, 1, [{ ok: false }]), '1 updated, 1 failed');
});
