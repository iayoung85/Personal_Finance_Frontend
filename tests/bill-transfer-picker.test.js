const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const pickerBox = { module: { exports: {} }, console, localStorage: {} };
vm.runInNewContext(
  `${read('shared/categories-autocomplete.js')}\n`
    + 'module.exports = { transferLabelForAccount, filterTransferAccounts, isTransferPickCurrent, setTransferPick, getTransferPickId };',
  pickerBox,
  { filename: 'categories-autocomplete.js' },
);
const picker = pickerBox.module.exports;

const modalBox = {
  module: { exports: {} },
  console,
  formatCurrency: () => '',
  document: { addEventListener() {} },
};
vm.runInNewContext(
  `${read('bills/modal.js')}\n`
    + 'module.exports = { _normalizeSplitsTemplateForCompare };',
  modalBox,
  { filename: 'modal.js' },
);
const modal = modalBox.module.exports;

const ACCOUNTS = [
  { account_id: 'a1', display_name: 'WF - Checking (1234)', transfer_label: '[WF Checking]' },
  { account_id: 'a2', display_name: 'WF - Riddles Jewelry (9999)', transfer_label: '[WF Riddles Jewelry]' },
  { account_id: 'a3', display_name: 'Chase - Savings (5555)' },
];

function fakeInput(value = '') {
  return { value, dataset: {} };
}

test('filter excludes the source account', () => {
  const ids = picker.filterTransferAccounts(ACCOUNTS, '[', 'a1').map(a => a.account_id);
  assert.deepEqual(ids, ['a2', 'a3']);
});

test('filter matches the friendly name case-insensitively and ignores a closing bracket', () => {
  const ids = picker.filterTransferAccounts(ACCOUNTS, '[riddles]', null).map(a => a.account_id);
  assert.deepEqual(ids, ['a2']);
});

test('insert uses transfer_label, falling back to the display-name label', () => {
  assert.equal(picker.transferLabelForAccount(ACCOUNTS[1]), '[WF Riddles Jewelry]');
  assert.equal(picker.transferLabelForAccount(ACCOUNTS[2]), '[Chase - Savings (5555)]');
});

test('a pick records the id and survives while the text equals the label', () => {
  const input = fakeInput('[WF Riddles Jewelry]');
  picker.setTransferPick(input, ACCOUNTS[1]);
  assert.equal(picker.getTransferPickId(input), 'a2');
});

test('editing the text away from the picked label drops the id', () => {
  const input = fakeInput('[WF Riddles Jewelry]');
  picker.setTransferPick(input, ACCOUNTS[1]);
  input.value = 'Groceries';
  assert.equal(picker.getTransferPickId(input), null);
  assert.equal(picker.isTransferPickCurrent('[WF Riddles Jewelry]', '[WF Riddles Jewelry]'), true);
  assert.equal(picker.isTransferPickCurrent('[WF Riddles', '[WF Riddles Jewelry]'), false);
});

test('no recorded pick gives no id', () => {
  assert.equal(picker.getTransferPickId(fakeInput('[Anything]')), null);
});

test('an unchanged splits template compares equal despite null memo and description', () => {
  const stored = [{ amount: 10, category: 'Food' }, { amount: 5.5, category: 'Gas', user_memo: 'x' }];
  const form = [
    { amount: 10, category: 'Food', user_memo: null, description: null },
    { amount: 5.5, category: 'Gas', user_memo: 'x', description: null },
  ];
  assert.equal(
    JSON.stringify(modal._normalizeSplitsTemplateForCompare(form)),
    JSON.stringify(modal._normalizeSplitsTemplateForCompare(stored)),
  );
});

test('a changed split is still detected', () => {
  const stored = [{ amount: 10, category: 'Food' }];
  const form = [{ amount: 11, category: 'Food', user_memo: null, description: null }];
  assert.notEqual(
    JSON.stringify(modal._normalizeSplitsTemplateForCompare(form)),
    JSON.stringify(modal._normalizeSplitsTemplateForCompare(stored)),
  );
});
