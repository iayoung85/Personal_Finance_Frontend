const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} }, console, document: { addEventListener() {} }, window: {} };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'transactions/transaction-types.js'), 'utf8')}\n`
    + `${fs.readFileSync(path.join(__dirname, '..', 'transactions/inline-edit.js'), 'utf8')}\n`
    + 'module.exports = { editNeedsAccountRefetch, TXN_TYPE };',
  box,
  { filename: 'inline-edit.js' },
);
const { editNeedsAccountRefetch, TXN_TYPE } = box.module.exports;

test('a banking row with no split children patches from the response', () => {
  assert.equal(editNeedsAccountRefetch(TXN_TYPE.MANUAL_CLEARED, 'depository', false), false);
  assert.equal(editNeedsAccountRefetch(TXN_TYPE.PLAID_CLEARED, 'credit', false), false);
});

test('an investment account still refetches, its trending rows change server-side', () => {
  assert.equal(editNeedsAccountRefetch(TXN_TYPE.MANUAL_CLEARED, 'investment', false), true);
});

test('a split parent or child still refetches, the siblings are not returned', () => {
  assert.equal(editNeedsAccountRefetch(TXN_TYPE.MANUAL_CLEARED, 'depository', true), true);
  assert.equal(editNeedsAccountRefetch(TXN_TYPE.SPLIT_CHILD, 'depository', false), true);
});

test('an unknown account category is treated as a banking account', () => {
  assert.equal(editNeedsAccountRefetch(TXN_TYPE.MANUAL_CLEARED, null, false), false);
});
