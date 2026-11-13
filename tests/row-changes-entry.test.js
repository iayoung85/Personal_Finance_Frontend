const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const manualPath = path.join(__dirname, '..', 'transactions', 'manual-transactions.js');
const manualSource = fs.readFileSync(manualPath, 'utf8');

const plain = (value) => JSON.parse(JSON.stringify(value));

// The page's one entry point for a save's changed rows. The helpers it calls
// are stubbed so the test sees the order of its steps and what it falls back to.
function loadEntryPoint({ patched = true } = {}) {
  const steps = [];
  const sandbox = {
    module: { exports: {} },
    console,
    balanceHistoryLookup: { gone: 1, kept: 2 },
    applyAffectedAccounts: async () => { steps.push('accounts'); },
    applyChangedTransactions: () => { steps.push('rows'); return patched; },
    refreshAccountTransactions: async (accountId) => { steps.push(`refetch:${accountId}`); },
    refreshSelectedLedgerAfterAffected: async () => { steps.push('ledger'); },
    findSavedRowInResponse: (data) => (data && data.saved) || null,
    isTransferCategory: (category) => /^\[.*\]$/.test(category),
  };
  vm.runInNewContext(
    `${manualSource}\nmodule.exports = { applyRowChangesFromResponse, fallbackAccountIdsForRow };`,
    sandbox,
    { filename: manualPath },
  );
  return { api: sandbox.module.exports, steps, sandbox };
}

test('accounts, then rows, then the open ledger, and the saved row comes back', async () => {
  const env = loadEntryPoint();
  const saved = { transaction_id: 't1' };

  const result = await env.api.applyRowChangesFromResponse({ saved }, ['a']);

  assert.deepEqual(plain(env.steps), ['accounts', 'rows', 'ledger']);
  assert.equal(result, saved);
});

test('a response without the changed-rows fields fetches each named account again', async () => {
  const env = loadEntryPoint({ patched: false });

  await env.api.applyRowChangesFromResponse({}, ['a', 'b']);

  assert.deepEqual(plain(env.steps), ['accounts', 'rows', 'refetch:a', 'refetch:b', 'ledger']);
});

test('no named account (null or empty) fetches every account again', async () => {
  for (const named of [null, undefined, []]) {
    const env = loadEntryPoint({ patched: false });
    await env.api.applyRowChangesFromResponse({}, named);
    assert.deepEqual(plain(env.steps), ['accounts', 'rows', 'refetch:null', 'ledger']);
  }
});

test('a site that settles the ledger itself is not given a second ledger fetch', async () => {
  const env = loadEntryPoint();

  await env.api.applyRowChangesFromResponse({}, ['a'], { siteSettlesLedger: true });

  assert.deepEqual(plain(env.steps), ['accounts', 'rows']);
});

test('removed ids leave the ledger lookup', async () => {
  const env = loadEntryPoint();

  await env.api.applyRowChangesFromResponse({ removed_transaction_ids: ['gone'] }, ['a']);

  assert.deepEqual(plain(env.sandbox.balanceHistoryLookup), { kept: 2 });
});

test('the fallback is the row\'s account, or every account for a transfer half or an unknown row', () => {
  const { api } = loadEntryPoint();

  assert.deepEqual(plain(api.fallbackAccountIdsForRow({ account_id: 'a', user_category: 'Food: Groceries' })), ['a']);
  assert.equal(api.fallbackAccountIdsForRow({ account_id: 'a', user_category: '[Savings]' }), null);
  assert.equal(api.fallbackAccountIdsForRow({ user_category: 'Food: Groceries' }), null);
  assert.equal(api.fallbackAccountIdsForRow(undefined), null);
});
