const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const utilsPath = path.join(__dirname, '..', 'transactions', 'utils.js');
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${fs.readFileSync(utilsPath, 'utf8')}\nmodule.exports = { describeReviewReason, unreviewedDotTitle };`,
  sandbox,
  { filename: utilsPath },
);
const { describeReviewReason, unreviewedDotTitle } = sandbox.module.exports;

// Midday UTC keeps the local calendar day stable in any timezone within +/-11h.
const AT = '2026-10-19T12:00:00.123456';
const WHEN = ' (Oct 19)';
const make = (code, detail = null, extra = {}) => ({
  review_reason: code, review_reason_at: AT, review_reason_detail: detail, ...extra,
});

test('plaid_new, with and without pending', () => {
  assert.equal(describeReviewReason(make('plaid_new')), 'New from Plaid' + WHEN);
  assert.equal(describeReviewReason(make('plaid_new', null, { pending: true })), 'New pending charge from Plaid' + WHEN);
});

test('simple codes', () => {
  assert.equal(describeReviewReason(make('plaid_posted_from_pending', { pending_plaid_transaction_id: 'x' })),
    'Posted by the bank, replacing its pending charge' + WHEN);
  assert.equal(describeReviewReason(make('plaid_redelivered')), 'Plaid sent this back after removing it' + WHEN);
  assert.equal(describeReviewReason(make('plaid_removed_kept')),
    'Plaid removed this from the bank feed; kept in your ledger' + WHEN);
});

test('transfer_unlinked with and without partner', () => {
  assert.equal(describeReviewReason(make('transfer_unlinked', { partner_account_name: 'Savings' })),
    'Its transfer pair with Savings was unlinked' + WHEN);
  assert.equal(describeReviewReason(make('transfer_unlinked')), 'Its transfer pair was unlinked' + WHEN);
});

test('plaid_modified lists each change', () => {
  const detail = { changes: [
    { field: 'amount', from: '-12.00', to: '-15.50' },
    { field: 'transaction_date', from: '2026-10-03', to: '2026-10-04' },
    { field: 'description', from: 'X', to: 'Y' },
    { field: 'merchant_name', from: 'A', to: 'B' },
    { field: 'status', from: 'pending', to: 'cleared' },
  ] };
  assert.equal(describeReviewReason(make('plaid_modified', detail)),
    'Plaid changed amount from -$12.00 to -$15.50, changed date from Oct 3 to Oct 4, changed description from "X" to "Y", changed merchant from A to B, cleared the pending charge' + WHEN);
});

test('plaid_modified reverted user edits', () => {
  const detail = { changes: [
    { field: 'description', from: 'A', to: 'B' },
    { field: 'amount', from: '-20.00', to: '-12.00', reverted_user_edit: true },
    { field: 'transaction_date', from: '2026-10-03', to: '2026-10-04', reverted_user_edit: true },
  ] };
  assert.equal(describeReviewReason(make('plaid_modified', detail)),
    'Plaid changed description from "A" to "B", replaced your edited amount -$20.00 with -$12.00, replaced your date Oct 3 with Oct 4' + WHEN);
});

test('plaid_modified amount under a kept user override', () => {
  const detail = { changes: [
    { field: 'amount', from: '-12.00', to: '-15.00', kept_user_value: '-20.00' },
  ] };
  assert.equal(describeReviewReason(make('plaid_modified', detail)),
    'Plaid changed amount from -$12.00 to -$15.00 (your -$20.00 kept)' + WHEN);
});

test('plaid_modified with empty or missing changes', () => {
  assert.equal(describeReviewReason(make('plaid_modified', { changes: [] })), 'Plaid changed this transaction' + WHEN);
  assert.equal(describeReviewReason(make('plaid_modified')), 'Plaid changed this transaction' + WHEN);
});

test('null, missing, and unknown reasons give no reason line', () => {
  assert.equal(describeReviewReason({ review_reason: null }), '');
  assert.equal(describeReviewReason({}), '');
  assert.equal(describeReviewReason(make('something_new')), '');
});

test('date suffix omitted when review_reason_at is null', () => {
  assert.equal(describeReviewReason({ review_reason: 'plaid_new', review_reason_at: null }), 'New from Plaid');
});

test('dot title adds the action line', () => {
  assert.equal(unreviewedDotTitle({ review_reason: null }), 'Click to mark reviewed');
  assert.equal(unreviewedDotTitle(make('plaid_new')), 'New from Plaid (Oct 19)\nClick to mark reviewed');
});
