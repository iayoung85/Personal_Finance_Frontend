const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} } };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'transactions/account-patch.js'), 'utf8')}\n`
    + 'module.exports = { patchAccountsFromAffected, mapAccountBalanceFields, selectedLedgerNeedsRefresh };',
  box,
  { filename: 'account-patch.js' },
);
const { patchAccountsFromAffected, mapAccountBalanceFields, selectedLedgerNeedsRefresh } = box.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

function makeAccounts() {
  return [
    {
      account_id: 'a', account_name: 'Checking', current_balance: 100, last_updated: '2026-01-01',
      plaid_balance: 90, bank_agreement: { status: 'agrees' }, mask: '1111',
    },
    {
      account_id: 'b', account_name: 'Savings', current_balance: 500, last_updated: '2026-01-02',
      plaid_balance: null, bank_agreement: null, mask: '2222',
    },
  ];
}

test('one entry patches its account and leaves the others alone', () => {
  const input = makeAccounts();
  const result = patchAccountsFromAffected(input, [{
    account_id: 'a',
    current_balance: '125.50',
    last_balance_update: '2026-02-01T10:00:00',
    last_updated: '2026-02-01T10:00:00',
    plaid_balance: '120.00',
    bank_agreement: { status: 'differs' },
  }]);
  assert.equal(result.patched, true);
  assert.equal(result.accounts[0].current_balance, 125.5);
  assert.equal(result.accounts[0].last_updated, '2026-02-01T10:00:00');
  assert.equal(result.accounts[0].plaid_balance, 120);
  assert.deepEqual(plain(result.accounts[0].bank_agreement), { status: 'differs' });
  assert.deepEqual(plain(result.accounts[1]), plain(input[1]));
});

test('a transfer patches both accounts', () => {
  const result = patchAccountsFromAffected(makeAccounts(), [
    { account_id: 'a', current_balance: '50' },
    { account_id: 'b', current_balance: '550' },
  ]);
  assert.equal(result.patched, true);
  assert.equal(result.accounts[0].current_balance, 50);
  assert.equal(result.accounts[1].current_balance, 550);
});

test('string balances parse to numbers, a zero included', () => {
  const result = patchAccountsFromAffected(makeAccounts(), [{ account_id: 'a', current_balance: '0' }]);
  assert.equal(result.accounts[0].current_balance, 0);
  assert.equal(typeof result.accounts[0].current_balance, 'number');
});

test('a null plaid_balance and bank_agreement clear the held values', () => {
  const result = patchAccountsFromAffected(makeAccounts(), [{
    account_id: 'a', current_balance: '100', plaid_balance: null, bank_agreement: null,
  }]);
  assert.equal(result.accounts[0].plaid_balance, null);
  assert.equal(result.accounts[0].bank_agreement, null);
});

test('fields an entry does not carry stay as they were', () => {
  const input = makeAccounts();
  const result = patchAccountsFromAffected(input, [{ account_id: 'a', current_balance: '1' }]);
  assert.equal(result.accounts[0].current_balance, 1);
  assert.equal(result.accounts[0].last_updated, '2026-01-01');
  assert.equal(result.accounts[0].plaid_balance, 90);
  assert.deepEqual(plain(result.accounts[0].bank_agreement), { status: 'agrees' });
  assert.equal(result.accounts[0].account_name, 'Checking');
  assert.equal(result.accounts[0].mask, '1111');
});

test('the input accounts are not mutated', () => {
  const input = makeAccounts();
  patchAccountsFromAffected(input, [{ account_id: 'a', current_balance: '1' }]);
  assert.deepEqual(plain(input), plain(makeAccounts()));
});

test('an empty list is a valid answer that changes nothing', () => {
  const input = makeAccounts();
  const result = patchAccountsFromAffected(input, []);
  assert.equal(result.patched, true);
  assert.deepEqual(plain(result.accounts), plain(input));
});

test('a missing or non-array list reports it could not patch', () => {
  assert.equal(patchAccountsFromAffected(makeAccounts(), undefined).patched, false);
  assert.equal(patchAccountsFromAffected(makeAccounts(), null).patched, false);
  assert.equal(patchAccountsFromAffected(makeAccounts(), { account_id: 'a' }).patched, false);
});

test('an account the page does not hold reports it could not patch', () => {
  const input = makeAccounts();
  const result = patchAccountsFromAffected(input, [
    { account_id: 'a', current_balance: '1' },
    { account_id: 'zzz', current_balance: '2' },
  ]);
  assert.equal(result.patched, false);
  assert.deepEqual(plain(result.accounts), plain(input));
});

test('the accounts-list mapping reads last_balance_update before last_updated', () => {
  const mapped = mapAccountBalanceFields({
    current_balance: '12.5', last_balance_update: 'new', last_updated: 'old', plaid_balance: null,
  });
  assert.deepEqual(plain(mapped), {
    current_balance: 12.5, last_updated: 'new', plaid_balance: null, bank_agreement: null,
  });
});

test('the ledger needs a refresh when the selected account was rebuilt and no history came', () => {
  const response = { affected_accounts: [{ account_id: 'a' }, { account_id: 'b' }] };
  assert.equal(selectedLedgerNeedsRefresh(response, 'single', 'a'), true);
});

test('the ledger needs no refresh for another account, all-accounts mode or no selection', () => {
  const response = { affected_accounts: [{ account_id: 'b' }] };
  assert.equal(selectedLedgerNeedsRefresh(response, 'single', 'a'), false);
  assert.equal(selectedLedgerNeedsRefresh({ affected_accounts: [{ account_id: 'a' }] }, 'all', 'a'), false);
  assert.equal(selectedLedgerNeedsRefresh({ affected_accounts: [{ account_id: 'a' }] }, 'single', null), false);
});

test('the ledger needs no refresh when the response brings its own history', () => {
  const response = { affected_accounts: [{ account_id: 'a' }], affected_balance_history: [] };
  assert.equal(selectedLedgerNeedsRefresh(response, 'single', 'a'), false);
});

test('the ledger needs no refresh for a missing, empty or malformed account list', () => {
  assert.equal(selectedLedgerNeedsRefresh(null, 'single', 'a'), false);
  assert.equal(selectedLedgerNeedsRefresh({}, 'single', 'a'), false);
  assert.equal(selectedLedgerNeedsRefresh({ affected_accounts: [] }, 'single', 'a'), false);
  assert.equal(selectedLedgerNeedsRefresh({ affected_accounts: 'a' }, 'single', 'a'), false);
});
