const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'transactions', 'manual-transactions.js'), 'utf8');
const stubs = `
  function isTransferCategory(str) { return /^\\[.+\\]$/.test((str || '').trim()); }
`;
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${stubs}\n${source}\nmodule.exports = { _buildManualTransactionCreatePayload, _buildManualTransactionEditPayload };`,
  sandbox,
  { filename: 'manual-transactions.js' },
);
const { _buildManualTransactionCreatePayload, _buildManualTransactionEditPayload } = sandbox.module.exports;

const createValues = (category) => ({
  amount: 12.5, type: 'debit', date: '2026-01-02', accountId: 'a1', merchant: 'Shop', category, memo: '',
});

test('create drops a bracket category', () => {
  const payload = _buildManualTransactionCreatePayload(createValues('[Checking]'));
  assert.equal(payload.user_category, null);
  assert.equal(payload.account_id, 'a1');
  assert.equal(payload.merchant_name, 'Shop');
});

test('create passes a listed category unchanged', () => {
  assert.equal(_buildManualTransactionCreatePayload(createValues('Food: Groceries')).user_category, 'Food: Groceries');
});

test('create sends null for an empty category', () => {
  assert.equal(_buildManualTransactionCreatePayload(createValues('')).user_category, null);
});

const current = { amount: -12.5, date: '2026-01-02', merchant_name: 'Shop', user_category: 'Food: Groceries', memo: '' };
const editValues = (category, extra = {}) => ({
  amountRaw: '12.5', type: 'debit', date: '2026-01-02', merchant: 'Shop', category, memo: '', ...extra,
});

test('edit drops a bracket category but keeps other changes', () => {
  const payload = _buildManualTransactionEditPayload(current, editValues('[Checking]', { merchant: 'New Shop' }));
  assert.deepEqual({ ...payload }, { merchant_name: 'New Shop' });
});

test('edit with only a bracket change has an empty payload', () => {
  assert.equal(Object.keys(_buildManualTransactionEditPayload(current, editValues('[Checking]'))).length, 0);
});

test('edit passes a changed listed category unchanged', () => {
  const payload = _buildManualTransactionEditPayload(current, editValues('Travel: Flights'));
  assert.deepEqual({ ...payload }, { user_category: 'Travel: Flights' });
});
