const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'transactions', 'search.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = { module: { exports: {} }, console, isTransferCategory: () => false };
vm.runInNewContext(`${source}\nmodule.exports = { parseSearchQuery, transactionMatchesSearch };`, sandbox, { filename: sourcePath });
const { parseSearchQuery, transactionMatchesSearch } = sandbox.module.exports;

const matches = (txn, query) => transactionMatchesSearch(txn, parseSearchQuery(query));

const out800 = { amount: -800 };
const in800 = { amount: 800 };
const out10800 = { amount: -10800 };
const out800_01 = { amount: -800.01 };

test('amount:800 stays a fuzzy digit match, both directions', () => {
  assert.equal(matches(out800, 'amount:800'), true);
  assert.equal(matches(in800, 'amount:800'), true);
  assert.equal(matches(out10800, 'amount:800'), true);
  assert.equal(matches(out800_01, 'amount:800'), true);
});

test('comparisons follow the ledger sign: negative is money out', () => {
  assert.equal(matches(in800, 'amount:>100'), true);
  assert.equal(matches(out800, 'amount:>100'), false);
  assert.equal(matches(out800, 'amount:<-100'), true);
  assert.equal(matches(in800, 'amount:<-100'), false);
  assert.equal(matches({ amount: -50 }, 'amount:<-100'), false);
  assert.equal(matches(out800, 'amount:<=-800'), true);
  assert.equal(matches(out800, 'amount:>=-800'), true);
  assert.equal(matches(out800_01, 'amount:>=-800'), false);
});

test('ranges are signed and accept either bound first', () => {
  assert.equal(matches(out800, 'amount:-801..-799'), true);
  assert.equal(matches(out800, 'amount:-799..-801'), true);
  assert.equal(matches(in800, 'amount:-801..-799'), false);
  assert.equal(matches(in800, 'amount:799..801'), true);
  assert.equal(matches(out800, 'amount:799..801'), false);
  assert.equal(matches({ amount: -50 }, 'amount:-100..100'), true);
});

test('amount:=800 matches exactly 800.00 in either direction', () => {
  assert.equal(matches(out800, 'amount:=800'), true);
  assert.equal(matches(in800, 'amount:=800'), true);
  assert.equal(matches(out10800, 'amount:=800'), false);
  assert.equal(matches(out800_01, 'amount:=800'), false);
  assert.equal(matches({ amount: -800.004 }, 'amount:=800.00'), true);
});

test('== and the amt alias are accepted', () => {
  assert.equal(matches(out800, 'amount:==800'), true);
  assert.equal(matches(out800, 'amt:=800'), true);
  assert.equal(matches(out800, 'amt:800'), true);
  assert.equal(matches(out10800, 'amt:==800'), false);
});

test('a signed exact amount narrows to one direction', () => {
  assert.equal(matches(out800, 'amount:=-800'), true);
  assert.equal(matches(in800, 'amount:=-800'), false);
  assert.equal(matches(in800, 'amount:=+800'), true);
  assert.equal(matches(out800, 'amount:=+800'), false);
  assert.equal(matches(out10800, 'amount:=-800'), false);
});

test('negated exact amount excludes only that amount', () => {
  assert.equal(matches(out800, '-amount:=800'), false);
  assert.equal(matches(out10800, '-amount:=800'), true);
});

test('a non-numeric exact value matches nothing', () => {
  assert.equal(matches(out800, 'amount:=abc'), false);
  assert.equal(matches(out800, 'amount:='), false);
});

const row = {
  transaction_id: 'txn_fa97b874c7c04d96984ee8be33b4a5df',
  plaid_transaction_id: 'PlaidAbC123xyz',
  account_id: 'acct_11aa22bb',
  bill_id: 'bill_7f3a9c',
  amount: -40,
};

test('bill: finds every row carrying that bill id, including a fragment', () => {
  assert.equal(matches(row, 'bill:bill_7f3a9c'), true);
  assert.equal(matches(row, 'bill_id:7f3a'), true);
  assert.equal(matches(row, 'bill:bill_other'), false);
  assert.equal(matches({ ...row, bill_id: null }, 'bill:bill_7f3a9c'), false);
  assert.equal(matches({ amount: -40 }, 'bill:bill_7f3a9c'), false);
});

test('txn:, id:, plaid: and account_id: match their fields case-insensitively', () => {
  assert.equal(matches(row, 'txn:txn_fa97b874c7c04d96984ee8be33b4a5df'), true);
  assert.equal(matches(row, 'id:FA97B874'), true);
  assert.equal(matches(row, 'transaction_id:nope'), false);
  assert.equal(matches(row, 'plaid:plaidabc123'), true);
  assert.equal(matches(row, 'plaid_id:zzz'), false);
  assert.equal(matches(row, 'account_id:acct_11aa22bb'), true);
  assert.equal(matches(row, 'acct_id:acct_99'), false);
});

test('account_id: does not search the account display name, and account: still does', () => {
  const named = { ...row, bank_account: 'Chase Checking' };
  assert.equal(matches(named, 'account_id:chase'), false);
  assert.equal(matches(named, 'account:chase'), true);
});

test('id operators combine with the rest of the query', () => {
  assert.equal(matches(row, 'bill:bill_7f3a9c amount:=40'), true);
  assert.equal(matches(row, 'bill:bill_7f3a9c amount:=+40'), false);
  assert.equal(matches(row, 'bill:bill_7f3a9c -txn:fa97'), false);
});
