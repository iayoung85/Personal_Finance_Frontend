const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// Objects built inside a vm sandbox come from another realm; copy them first.
const plain = (value) => JSON.parse(JSON.stringify(value));

const pickerBox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${read('transactions/bill-picker.js')}\n`
    + 'module.exports = { billPickerOptionLine, billPickerSortBills, billPickerFilterLines, billPickerDetailRows, billPickerComparison, BILL_PICKER_TRANSFER_REASON };',
  pickerBox,
  { filename: 'bill-picker.js' },
);
const picker = pickerBox.module.exports;

const menuStubs = `
  function escapeHtml(str) { return String(str || ''); }
  function isTransferCategory(str) { return /^\\[.*\\]$/.test((str || '').trim()); }
  const accounts = [];
`;
const menuBox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${menuStubs}\n${read('transactions/transaction-types.js')}\n${read('transactions/context-menu.js')}\n`
    + 'module.exports = { _buildMenuItems, ADD_TO_BILL_TRANSFER_REASON, WAITING_MATCH_LOCK_REASON };',
  menuBox,
  { filename: 'context-menu.js' },
);
const menu = menuBox.module.exports;

const NETFLIX = {
  bill_id: 'bill_1',
  description: 'Netflix',
  amount: -15.49,
  schedule_summary: 'Monthly on the 15th',
  account_id: 'acct_chk',
  account_name: 'Chase - Checking (1234)',
  bank_name: 'Chase',
  is_active: true,
  auto_pay: true,
  user_category: 'Entertainment: Streaming',
  memo: null,
  transfer_account_id: null,
  upcoming_occurrences: [{ date: '2026-12-15', amount: -15.49 }],
};

const ACCOUNT_NAMES = { acct_chk: 'Chase - Checking (1234)', acct_amex: 'Amex - Gold (9999)', acct_citi: 'Citi - Card (5555)' };
const nameFor = (accountId) => ACCOUNT_NAMES[accountId] || '';

// ── The dropdown line ─────────────────────────────────────────

test('a bill line shows name, amount, schedule and account', () => {
  const line = plain(picker.billPickerOptionLine(NETFLIX));
  assert.equal(line.text, 'Netflix · -$15.49 · Monthly on the 15th · Chase - Checking (1234)');
  assert.equal(line.isPaused, false);
  assert.equal(line.disabled, false);
  assert.equal(line.disabledReason, '');
});

test('a paused bill is listed and tagged, not disabled', () => {
  const line = plain(picker.billPickerOptionLine({ ...NETFLIX, is_active: false }));
  assert.equal(line.isPaused, true);
  assert.equal(line.disabled, false);
  assert.match(line.text, /\(Paused\)$/);
});

test('a transfer bill is listed disabled with the reason, naming both accounts', () => {
  const line = plain(picker.billPickerOptionLine({
    ...NETFLIX,
    description: 'Savings sweep',
    amount: -200,
    transfer_account_id: 'acct_sav',
    transfer_account_name: 'Chase - Savings (5678)',
  }));
  assert.equal(line.disabled, true);
  assert.equal(line.disabledReason, picker.BILL_PICKER_TRANSFER_REASON);
  assert.equal(line.disabledReason, 'Past transactions cannot be added to a transfer bill.');
  assert.equal(line.account, 'Chase - Checking (1234) → Chase - Savings (5678)');
});

test('bills that can be chosen come first, then paused, then transfer bills', () => {
  const sorted = picker.billPickerSortBills([
    { ...NETFLIX, bill_id: 't', description: 'Alpha transfer', transfer_account_id: 'x' },
    { ...NETFLIX, bill_id: 'p', description: 'Aardvark paused', is_active: false },
    { ...NETFLIX, bill_id: 'z', description: 'Zoo' },
    { ...NETFLIX, bill_id: 'a', description: 'Apple' },
  ]).map((bill) => bill.bill_id);
  assert.deepEqual(sorted, ['a', 'z', 'p', 't']);
});

test('the search matches every word anywhere on the line', () => {
  const lines = [NETFLIX, { ...NETFLIX, bill_id: 'bill_2', description: 'Rent', amount: -1800, schedule_summary: 'Monthly on the 1st' }]
    .map(picker.billPickerOptionLine);
  assert.deepEqual(picker.billPickerFilterLines(lines, 'rent 1st').map((line) => line.billId), ['bill_2']);
  assert.deepEqual(picker.billPickerFilterLines(lines, 'CHASE').map((line) => line.billId), ['bill_1', 'bill_2']);
  assert.equal(picker.billPickerFilterLines(lines, '').length, 2);
});

// ── Details ───────────────────────────────────────────────────

test('details give the next date, or say none while paused', () => {
  const active = Object.fromEntries(plain(picker.billPickerDetailRows(NETFLIX)).map((row) => [row.label, row.value]));
  assert.equal(active['Next date'], 'Dec 15, 2026');
  assert.equal(active['Auto-pay'], 'Yes');
  assert.equal(active.Status, 'Active');
  assert.equal(active.Memo, 'None');
  assert.equal(active.Schedule, 'Monthly on the 15th');

  const paused = Object.fromEntries(plain(picker.billPickerDetailRows({ ...NETFLIX, is_active: false, upcoming_occurrences: [] }))
    .map((row) => [row.label, row.value]));
  assert.equal(paused['Next date'], 'None while paused');
  assert.equal(paused.Status, 'Paused');
});

// ── Comparison and warnings ───────────────────────────────────

const row = (extra) => ({ date: '2026-10-15', amount: -15.49, account_id: 'acct_chk', ...extra });

test('a matching row gives no warnings', () => {
  const result = plain(picker.billPickerComparison(NETFLIX, [row()], nameFor));
  assert.equal(result.countLine, '1 transaction on Oct 15, 2026');
  assert.equal(result.amountLine, "-$15.49, against the bill's -$15.49");
  assert.deepEqual(result.warnings, []);
});

test('a different amount is warned about with both amounts', () => {
  const result = plain(picker.billPickerComparison(NETFLIX, [row({ amount: -17 })], nameFor));
  assert.deepEqual(result.warnings, ["The amount differs from the bill's: -$17.00 against -$15.49."]);
});

test('an opposite sign is warned about once, not also as a different amount', () => {
  const result = plain(picker.billPickerComparison(NETFLIX, [row({ amount: 15.49 })], nameFor));
  assert.deepEqual(result.warnings, ['This transaction puts money in, but the bill takes money out.']);
});

test('a different account names both accounts', () => {
  const result = plain(picker.billPickerComparison(NETFLIX, [row({ account_id: 'acct_amex' })], nameFor));
  assert.deepEqual(result.warnings, ['This transaction is in Amex - Gold (9999), but the bill is in Chase - Checking (1234).']);
});

test('several rows give a date range, an amount range and counted warnings', () => {
  const rows = [
    row({ date: '2026-09-15' }),
    row({ date: '2026-06-15', amount: -13.99, account_id: 'acct_amex' }),
    row({ date: '2026-08-15', amount: 15.49 }),
    row({ date: '2026-07-15', account_id: 'acct_citi' }),
  ];
  const result = plain(picker.billPickerComparison(NETFLIX, rows, nameFor));
  assert.equal(result.countLine, '4 transactions, Jun 15, 2026 to Sep 15, 2026');
  assert.equal(result.amountLine, "-$15.49 to $15.49, against the bill's -$15.49");
  assert.deepEqual(result.warnings, [
    '1 of 4 transactions put money in, but the bill takes money out.',
    "1 of 4 transactions differ from the bill's amount of -$15.49.",
    '2 of 4 transactions are in Amex - Gold (9999), Citi - Card (5555), but the bill is in Chase - Checking (1234).',
  ]);
});

test('several rows of one amount say so', () => {
  const result = plain(picker.billPickerComparison(NETFLIX, [row(), row({ date: '2026-11-15' })], nameFor));
  assert.equal(result.amountLine, "-$15.49 each, against the bill's -$15.49");
  assert.deepEqual(result.warnings, []);
});

test('an account the page does not know falls back to the API name and a plain phrase', () => {
  const result = plain(picker.billPickerComparison(NETFLIX, [row({ account_id: 'acct_gone' })], () => ''));
  assert.deepEqual(result.warnings, ['This transaction is in another account, but the bill is in Chase - Checking (1234).']);
});

// ── Which rows get which menu entry ───────────────────────────

function menuItems(ctxExtra) {
  return plain(menu._buildMenuItems({
    txnId: 't1', source: 'plaid', status: 'cleared', pending: false, isBill: false, billId: '',
    accountId: 'a1', amount: -10, isSplit: false, isSplitChild: false, name: 'x',
    isHidden: false, amountModified: false, txnDate: '2026-01-05',
    transferPairId: '', billAttachedByHand: false, ...ctxExtra,
  }));
}
const entry = (items, action) => items.find((item) => item.action === action);

test('a posted bank row, a converted row and a cleared manual row get Add to existing bill', () => {
  for (const kind of [{ source: 'plaid', status: 'cleared' }, { source: 'plaid', status: 'converted' }, { source: 'manual', status: 'cleared' }]) {
    const item = entry(menuItems(kind), 'add-to-bill');
    assert.ok(item, `${kind.source}:${kind.status} offers the entry`);
    assert.equal(item.label, '📎 Add to existing bill');
    assert.ok(!item.disabled);
  }
});

test('Add to existing bill sits beside This is a Bill', () => {
  const actions = menuItems({}).map((item) => item.action);
  assert.equal(actions.indexOf('add-to-bill'), actions.indexOf('this-is-a-bill') + 1);
});

test('one side of a linked transfer shows the entry disabled with the reason', () => {
  const item = entry(menuItems({ transferPairId: 'pair_1' }), 'add-to-bill');
  assert.ok(item.disabled);
  assert.equal(item.disabledReason, menu.ADD_TO_BILL_TRANSFER_REASON);
});

test('a side of a waiting match shows the entry disabled with the match lock', () => {
  const item = entry(menuItems({ matchManualTxnId: 'manual_1' }), 'add-to-bill');
  assert.ok(item.disabled);
  assert.equal(item.disabledReason, menu.WAITING_MATCH_LOCK_REASON);
});

test('rows where adding has no meaning omit the entry', () => {
  const omitted = [
    ['pending bank row', { status: 'pending', pending: true }],
    ['row already on a bill', { billId: 'bill_1', isBill: true }],
    ['upcoming bill occurrence', { source: 'scheduled', status: 'future', isBill: true, billId: 'bill_1' }],
    ['hand-entered future row', { source: 'manual', status: 'future' }],
    ['missing bill row', { source: 'scheduled', status: 'missing', isBill: true, billId: 'bill_1' }],
    ['orphaned manual row', { source: 'manual', status: 'orphaned' }],
    ['row dated after today', { source: 'manual', txnDate: '2999-01-01' }],
    ['split piece', { source: 'split', status: 'cleared', isSplit: true, isSplitChild: true, splitIndex: 0 }],
  ];
  for (const [label, extra] of omitted) {
    assert.ok(!entry(menuItems(extra), 'add-to-bill'), `${label} omits the entry`);
  }
});

test('a split parent gets Add to existing bill, its piece does not', () => {
  assert.ok(entry(menuItems({ isSplit: true }), 'add-to-bill'));
  assert.ok(!entry(menuItems({ isSplit: true, isSplitChild: true, splitIndex: 0, source: 'split' }), 'add-to-bill'));
});

test('Remove from bill shows only on a row added to its bill by hand', () => {
  const handAdded = menuItems({ billId: 'bill_1', isBill: true, billAttachedByHand: true });
  assert.ok(entry(handAdded, 'remove-from-bill'));
  assert.ok(entry(handAdded, 'edit-schedule'));
  assert.ok(!entry(handAdded, 'add-to-bill'));

  assert.ok(!entry(menuItems({ billId: 'bill_1', isBill: true }), 'remove-from-bill'), 'a matched-in link has no entry');
  assert.ok(!entry(menuItems({}), 'remove-from-bill'), 'a row with no bill has no entry');
  assert.ok(entry(menuItems({ source: 'manual', billId: 'bill_1', isBill: true, billAttachedByHand: true }), 'remove-from-bill'));
  assert.ok(entry(menuItems({ isSplit: true, billId: 'bill_1', isBill: true, billAttachedByHand: true }), 'remove-from-bill'), 'a split parent added by hand');
});

test('Remove from bill is locked while the row waits on a match', () => {
  const item = entry(menuItems({ billId: 'bill_1', isBill: true, billAttachedByHand: true, matchManualTxnId: 'manual_1' }), 'remove-from-bill');
  assert.ok(item.disabled);
  assert.equal(item.disabledReason, menu.WAITING_MATCH_LOCK_REASON);
});
