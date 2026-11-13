const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const stubs = `
  function escapeHtml(str) { return String(str || '').replace(/'/g, '&#39;'); }
  function isTransferCategory(str) { return /^\\[.*\\]$/.test((str || '').trim()); }
  const accounts = [];
`;
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${stubs}\n${read('transactions/transaction-types.js')}\n${read('transactions/ledger-forecast.js')}\n${read('transactions/row-renderers.js')}\n`
    + 'module.exports = { isHiddenPendingRow, projectLedgerForecast, renderPendingHideButton, renderRowByType, getTransactionType, TXN_TYPE };',
  sandbox,
  { filename: 'ledger-forecast.test.js' },
);
const {
  isHiddenPendingRow, projectLedgerForecast, renderPendingHideButton, renderRowByType, getTransactionType, TXN_TYPE,
} = sandbox.module.exports;

const plain = value => JSON.parse(JSON.stringify(value));
const pending = (id, amount, extra = {}) => ({
  transaction_id: id, amount, pending: true, is_hidden: false, source: 'plaid', status: 'pending', ...extra,
});
const scheduled = (id, amount) => ({ transaction_id: id, amount, source: 'scheduled', status: 'future' });

// Newest first, as the table sorts them.
const SCHEDULED = [scheduled('s2', -20), scheduled('s1', -10)];

test('a hidden pending row is out of the walk; a hidden posted row is not a pending row', () => {
  assert.equal(isHiddenPendingRow(pending('p1', -5, { is_hidden: true })), true);
  assert.equal(isHiddenPendingRow(pending('p1', -5)), false);
  assert.equal(isHiddenPendingRow({ pending: false, is_hidden: true }), false);
});

test('pending rows walk from the posted balance, scheduled rows stack on the pending total', () => {
  const { pendingLedgerLookup, scheduledLedgerLookup } = projectLedgerForecast(
    1000, [pending('p2', -30), pending('p1', -50)], SCHEDULED);
  assert.deepEqual(plain(pendingLedgerLookup), { p1: 950, p2: 920 });
  assert.deepEqual(plain(scheduledLedgerLookup), { s1: 910, s2: 890 });
});

test('a hidden pending row has no balance and does not move any other row', () => {
  const { pendingLedgerLookup, scheduledLedgerLookup } = projectLedgerForecast(
    1000, [pending('p2', -30), pending('p1', -50, { is_hidden: true })], SCHEDULED);
  assert.equal(pendingLedgerLookup.p1, undefined);
  assert.equal(pendingLedgerLookup.p2, 970);
  assert.deepEqual(plain(scheduledLedgerLookup), { s1: 960, s2: 940 });
});

test('scheduled projected balances are the same whether Show hidden puts the hidden hold in the walk or not', () => {
  const hiddenHold = pending('p1', -50, { is_hidden: true });
  const visibleHold = pending('p2', -30);
  // Show hidden off: the list filter has removed the hidden hold.
  const withoutIt = projectLedgerForecast(1000, [visibleHold], SCHEDULED);
  // Show hidden on: the hold is in the list the walk receives.
  const withIt = projectLedgerForecast(1000, [visibleHold, hiddenHold], SCHEDULED);
  assert.deepEqual(plain(withIt.scheduledLedgerLookup), plain(withoutIt.scheduledLedgerLookup));
  assert.equal(withIt.pendingLedgerLookup.p2, withoutIt.pendingLedgerLookup.p2);
});

test('the pending Hide button calls the context menu hide, and is absent once hidden', () => {
  const html = renderPendingHideButton(pending('p1', -5));
  assert.match(html, /class="pending-hide-btn"/);
  assert.match(html, /_handleContextHide\(\{ txnId: 'p1' \}\)/);
  assert.match(html, />Hide</);
  assert.equal(renderPendingHideButton(pending('p1', -5, { is_hidden: true })), '');
  assert.equal(renderPendingHideButton({ pending: true }), '');
  // A row the user has worked on is one they accepted: no button.
  assert.equal(renderPendingHideButton(pending('p1', -5, { is_override: true })), '');
  assert.equal(renderPendingHideButton(pending('p1', -5, { user_memo: 'lunch' })), '');
  assert.equal(renderPendingHideButton(pending('p1', -5, { user_description_override: 'Sam' })), '');
  assert.equal(renderPendingHideButton(pending('p1', -5, { transfer_pair_id: 'pair_1' })), '');
  assert.equal(renderPendingHideButton(pending('p1', -5, { amount_modified: true })), '');
  assert.match(renderPendingHideButton(pending('p1', -5, { amount_modified: false })), /pending-hide-btn/);
  assert.match(renderPendingHideButton(pending('p1', -5, { user_memo: '  ' })), /pending-hide-btn/);
});

test('a Missing row that carries a Plaid transaction id is still a Missing row', () => {
  const txn = {
    transaction_id: 't1', account_id: 'a1', source: 'manual', status: 'missing', pending: false,
    plaid_transaction_id: 'plaid-abc', reviewed: false,
  };
  assert.equal(getTransactionType(txn), TXN_TYPE.MANUAL_MISSING);
  const rendered = renderRowByType({
    txn, txnId: 't1', accountId: 'a1', currentFullCategory: 'Food', isBill: false,
    isTransfer: false, isPendingRow: false, rowType: TXN_TYPE.MANUAL_MISSING,
  });
  assert.equal(rendered.rowCssClass, 'missing-row');
  assert.equal(rendered.sourceBadge.label, 'Missing');
});
