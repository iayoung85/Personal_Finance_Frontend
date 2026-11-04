const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads the context menu source into a sandbox and returns the helpers under test.
function load() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'transactions/context-menu.js'), 'utf8');
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(
    `${source}\nmodule.exports = { _approveAllSkipReasons, _buildApproveAllWarning };`,
    sandbox
  );
  return sandbox.module.exports;
}

const { _approveAllSkipReasons, _buildApproveAllWarning } = load();
const toast = result => {
  const reasons = Array.from(_approveAllSkipReasons(result));
  return reasons.length ? _buildApproveAllWarning(result.approved_count, reasons) : null;
};

test('no skips gives no reasons, so the plain success line is used', () => {
  assert.equal(toast({ approved_count: 3 }), null);
  assert.equal(toast({ approved_count: 3, skipped_both_split: 0, skipped_transfer_bank_row: 0 }), null);
});

test('both-split skips are named with their remedy', () => {
  assert.equal(
    toast({ approved_count: 3, skipped_both_split: 1 }),
    'Approved 3 match(es); 1 left waiting because both rows are split (unmatch first).'
  );
});

test('transfer bank row skips are named with their remedy', () => {
  assert.equal(
    toast({ approved_count: 0, skipped_transfer_bank_row: 2 }),
    'Approved 0 match(es); 2 left waiting because the bank row is a transfer (unmatch first).'
  );
});

test('both reasons are listed together', () => {
  assert.equal(
    toast({ approved_count: 3, skipped_both_split: 1, skipped_transfer_bank_row: 2 }),
    'Approved 3 match(es); 1 left waiting because both rows are split (unmatch first); 2 left waiting because the bank row is a transfer (unmatch first).'
  );
});
