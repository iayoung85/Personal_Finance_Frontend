const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const inlineEditPath = path.join(__dirname, '..', 'transactions', 'inline-edit.js');
const inlineEditSource = fs.readFileSync(inlineEditPath, 'utf8');
const sandbox = {
  module: { exports: {} },
  console,
};

vm.runInNewContext(
  `${inlineEditSource}\nmodule.exports = { _getAmountDiff, _parseAmountInput };`,
  sandbox,
  { filename: inlineEditPath },
);

const { _getAmountDiff, _parseAmountInput } = sandbox.module.exports;

test('explicit plus changes an existing debit to a credit', () => {
  const result = _getAmountDiff('+500', -500);

  assert.equal(result.ok, true);
  assert.equal(result.has_change, true);
  assert.equal(result.absolute_amount, 500);
  assert.equal(result.effective_type, 'credit');
  assert.equal(result.signed_amount, 500);
});

test('explicit minus changes an existing credit to a debit', () => {
  const result = _getAmountDiff('-500', 500);

  assert.equal(result.ok, true);
  assert.equal(result.has_change, true);
  assert.equal(result.absolute_amount, 500);
  assert.equal(result.effective_type, 'debit');
  assert.equal(result.signed_amount, -500);
});

test('unsigned edits resolve to credit even when the original was a debit', () => {
  // WYSIWYG: the inline editor pre-fills debits with a leading "-", so a
  // user who deletes the minus (or types a fresh unsigned number) is
  // explicitly asking for a credit. The "preserve original sign" fallback
  // was what blocked flipping a debit to a credit in TXN-027.
  const result = _getAmountDiff('501', -500);

  assert.equal(result.ok, true);
  assert.equal(result.has_change, true);
  assert.equal(result.absolute_amount, 501);
  assert.equal(result.effective_type, 'credit');
  assert.equal(result.signed_amount, 501);
});

test('unsigned edits on an existing credit stay a credit', () => {
  const result = _getAmountDiff('501', 500);

  assert.equal(result.ok, true);
  assert.equal(result.has_change, true);
  assert.equal(result.absolute_amount, 501);
  assert.equal(result.effective_type, 'credit');
  assert.equal(result.signed_amount, 501);
});

test('leading minus edits on an existing debit stay a debit', () => {
  const result = _getAmountDiff('-501', -500);

  assert.equal(result.ok, true);
  assert.equal(result.has_change, true);
  assert.equal(result.absolute_amount, 501);
  assert.equal(result.effective_type, 'debit');
  assert.equal(result.signed_amount, -501);
});

test('currency formatting does not hide an explicit plus sign', () => {
  const result = _parseAmountInput('$ +1,250.50');

  assert.equal(result.ok, true);
  assert.equal(result.absolute_amount, 1250.50);
  assert.equal(result.type_override, 'credit');
});
