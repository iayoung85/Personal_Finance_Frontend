const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const plain = (value) => JSON.parse(JSON.stringify(value));

// The accounts an approve fetches again when its response names no rows.
function loadApproveFallback(rows) {
  const source = ['transactions/manual-transactions.js', 'transactions/resolution.js']
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = {
    module: { exports: {} },
    console,
    transactions: rows,
    isTransferCategory: (category) => /^\[.*\]$/.test(category),
  };
  vm.runInNewContext(`${source}\nmodule.exports = { approveFallbackAccountIds };`, sandbox);
  return sandbox.module.exports.approveFallbackAccountIds;
}

const manualRow = (extra = {}) => ({
  transaction_id: 'manual-1', account_id: 'acct-1', source: 'manual',
  user_category: 'Food: Groceries', matched_transaction_id: 'plaid-1', ...extra,
});
const bankRow = (extra = {}) => ({
  transaction_id: 'plaid-1', account_id: 'acct-1', source: 'plaid',
  user_category: 'Food: Groceries', match_info: { matched_txn_id: 'manual-1' }, ...extra,
});

test('an approve of an ordinary match falls back to the account of its two rows', () => {
  const approveFallbackAccountIds = loadApproveFallback([manualRow(), bankRow()]);
  assert.deepEqual(plain(approveFallbackAccountIds('manual-1', 'acct-1')), ['acct-1']);
});

test('an approve where either row is a transfer half falls back to every account', () => {
  const manualTransfer = loadApproveFallback([manualRow({ user_category: '[Savings]' }), bankRow()]);
  assert.equal(manualTransfer('manual-1', 'acct-1'), null);

  const bankTransfer = loadApproveFallback([manualRow(), bankRow({ user_category: '[Savings]' })]);
  assert.equal(bankTransfer('manual-1', 'acct-1'), null);
});

test('the bank row is found from the matched row\'s pointer when it carries no match info', () => {
  const approveFallbackAccountIds = loadApproveFallback([
    manualRow(),
    bankRow({ match_info: undefined, user_category: '[Savings]' }),
  ]);
  assert.equal(approveFallbackAccountIds('manual-1', 'acct-1'), null);
});

test('with neither row cached the approve falls back to the account it was started from', () => {
  const approveFallbackAccountIds = loadApproveFallback([]);
  assert.deepEqual(plain(approveFallbackAccountIds('manual-1', 'acct-1')), ['acct-1']);
  assert.equal(approveFallbackAccountIds('manual-1', ''), null);
});
