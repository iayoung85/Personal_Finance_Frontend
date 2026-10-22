const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const categoriesPath = path.join(__dirname, '..', 'transactions', 'categories.js');
const categoriesSource = fs.readFileSync(categoriesPath, 'utf8');

const VIRTUAL_ID = 'bill_0d182e07a2774de4809a4f58b79af788_occ_2026-10-22';
const SAVED_ID = 'txn_saved';

// Answers each call the transfer flow makes: saving the occurrence, the
// candidate search (none), and creating the counterpart.
function loadTransferFlow({ saveFails = false } = {}) {
  const calls = { requests: [], statuses: [], removed: [], replaced: [] };
  const sandbox = {
    module: { exports: {} },
    console,
    BACKEND_URL: 'http://api.test',
    selectedAccountMode: 'all',
    selectedAccountId: null,
    document: { getElementById: () => null },
    setTimeout: () => {},
    authenticatedFetch: async (url, init = {}) => {
      calls.requests.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'PUT') {
        if (saveFails) {
          return { ok: false, json: async () => ({ error: 'Bill not found' }) };
        }
        return { ok: true, json: async () => ({ transaction: { transaction_id: SAVED_ID, account_id: 'acct-1' } }) };
      }
      if (url.includes('/transfers/candidates/')) {
        return { ok: true, json: async () => ({ candidates: [] }) };
      }
      return { ok: true, json: async () => ({ affected_transactions: [] }) };
    },
    showStatus: (message, type) => calls.statuses.push({ message, type }),
    clearStatus: () => {},
    _buildAccountDisplayName: (account) => account.name,
    _removeCachedTransaction: (id) => calls.removed.push(id),
    _replaceCachedTransaction: (id) => calls.replaced.push(id),
    _invalidateTransactionCache: () => {},
    _patchBalanceHistoryCache: () => {},
    fetchBalanceHistory: async () => {},
    loadAccounts: async () => {},
    renderTransactionTable: () => {},
  };
  vm.runInNewContext(
    `${categoriesSource}\nmodule.exports = { _applyTransferAssignment, _isVirtualBillOccurrenceId };`,
    sandbox,
    { filename: categoriesPath },
  );
  return { api: sandbox.module.exports, calls };
}

const TARGET = { account_id: 'acct-2', name: 'RH Checking' };

test('a bill occurrence not yet saved is saved first, then the saved row is linked', async () => {
  const { api, calls } = loadTransferFlow();

  await api._applyTransferAssignment(VIRTUAL_ID, 'acct-1', TARGET);

  assert.equal(calls.requests[0].method, 'PUT');
  assert.ok(calls.requests[0].url.endsWith(`/api/transactions/${VIRTUAL_ID}`));
  assert.deepEqual(calls.requests[0].body, {});
  assert.ok(calls.requests[1].url.includes(`/transfers/candidates/${SAVED_ID}?`));
  assert.deepEqual(calls.requests[2].body, { transaction_id: SAVED_ID, target_account_id: 'acct-2' });
  assert.deepEqual(calls.removed, [VIRTUAL_ID]);
  assert.ok(calls.replaced.includes(SAVED_ID));
});

test('a failed save stops before any linking and shows the reason', async () => {
  const { api, calls } = loadTransferFlow({ saveFails: true });

  await api._applyTransferAssignment(VIRTUAL_ID, 'acct-1', TARGET);

  assert.equal(calls.requests.length, 1);
  assert.deepEqual(calls.statuses.at(-1), { message: 'Bill not found', type: 'error' });
  assert.deepEqual(calls.removed, []);
});

test('a saved row links directly', async () => {
  const { api, calls } = loadTransferFlow();

  await api._applyTransferAssignment('txn_existing', 'acct-1', TARGET);

  assert.ok(calls.requests[0].url.includes('/transfers/candidates/txn_existing?'));
  assert.ok(calls.requests.every((request) => request.method !== 'PUT'));
});

test('bill occurrence IDs are recognised in every form the API uses', () => {
  const { api } = loadTransferFlow();
  assert.equal(api._isVirtualBillOccurrenceId(VIRTUAL_ID), true);
  assert.equal(api._isVirtualBillOccurrenceId('bill_0d182e07_occ_7'), true);
  assert.equal(api._isVirtualBillOccurrenceId(`${VIRTUAL_ID}_cpt`), true);
  assert.equal(api._isVirtualBillOccurrenceId('txn_4f1c2d'), false);
  assert.equal(api._isVirtualBillOccurrenceId(''), false);
});
