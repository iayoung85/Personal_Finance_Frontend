const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${read('transactions/unmatched-toggle.js')}\n`
    + 'module.exports = { shouldShowUnmatchedToggle, isMatchedLedgerRow };',
  sandbox,
  { filename: 'unmatched-toggle.test.js' },
);
const { shouldShowUnmatchedToggle, isMatchedLedgerRow } = sandbox.module.exports;

test('exactly 51% not matched hides the checkbox', () => {
  assert.equal(shouldShowUnmatchedToggle(100, 51, false), false);
});

test('50% not matched keeps the checkbox', () => {
  assert.equal(shouldShowUnmatchedToggle(100, 50, false), true);
});

test('above 51% not matched hides the checkbox', () => {
  assert.equal(shouldShowUnmatchedToggle(100, 100, false), false);
});

test('a fully matched ledger keeps the checkbox', () => {
  assert.equal(shouldShowUnmatchedToggle(40, 0, false), true);
});

test('an empty ledger hides the checkbox', () => {
  assert.equal(shouldShowUnmatchedToggle(0, 0, false), false);
});

test('a ticked checkbox stays whatever the share', () => {
  assert.equal(shouldShowUnmatchedToggle(100, 100, true), true);
  assert.equal(shouldShowUnmatchedToggle(0, 0, true), true);
  assert.equal(shouldShowUnmatchedToggle(100, 51, true), true);
});

test('a row is matched when it carries match_info or matched_transaction_id', () => {
  assert.equal(isMatchedLedgerRow({ match_info: { id: 'm' } }), true);
  assert.equal(isMatchedLedgerRow({ matched_transaction_id: 't1' }), true);
  assert.equal(isMatchedLedgerRow({ match_info: null, matched_transaction_id: null }), false);
  assert.equal(isMatchedLedgerRow({}), false);
});
