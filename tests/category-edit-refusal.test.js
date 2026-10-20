const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const categoriesPath = path.join(__dirname, '..', 'transactions', 'categories.js');
const categoriesSource = fs.readFileSync(categoriesPath, 'utf8');

const LINKED_ERROR = 'This transaction is part of a linked transfer. '
  + 'Unlink the transfer before changing its category.';

// categories.js is plain function declarations, so it loads without a page.
// The backend answers a refused single edit with HTTP 400 and { error }.
function loadWithRefusal() {
  const calls = { statuses: [], requests: [], cached: 0, rendered: 0, modalClosed: 0 };
  const sandbox = {
    module: { exports: {} },
    console,
    BACKEND_URL: 'http://api.test',
    availableCategories: ['Food: Groceries'],
    plaidTaxonomy: [],
    transactions: [{
      transaction_id: 'xfer-1', source: 'manual', user_category: '[Savings]', is_override: false, reviewed: true,
    }],
    document: { getElementById: () => ({ value: 'Food: Groceries' }) },
    authenticatedFetch: async (url, init) => {
      calls.requests.push({ url, method: init.method, body: JSON.parse(init.body) });
      return { ok: false, status: 400, json: async () => ({ error: LINKED_ERROR }) };
    },
    showStatus: (message, type) => calls.statuses.push({ message, type }),
    clearStatus: () => {},
    closeModal: () => { calls.modalClosed += 1; },
    renderTransactionTable: () => { calls.rendered += 1; },
    _cacheTransactions: () => { calls.cached += 1; },
  };
  vm.runInNewContext(
    `${categoriesSource}\nmodule.exports = { applyOverride, _updateManualTransactionCategory, _applyCategorizeAndClose };`,
    sandbox,
    { filename: categoriesPath },
  );
  const untouched = JSON.parse(JSON.stringify(sandbox.transactions));
  return { api: sandbox.module.exports, sandbox, calls, untouched };
}

function assertRefusedAndRowLeftAlone({ sandbox, calls, untouched }) {
  assert.deepEqual(calls.statuses, [{ message: LINKED_ERROR, type: 'error' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.transactions)), untouched);
  assert.equal(calls.cached, 0, 'the cache was not written');
  assert.equal(calls.rendered, 0, 'the table was not re-rendered');
}

test('categorize: a refusal shows the backend reason and leaves the row as it was', async () => {
  const env = loadWithRefusal();

  await env.api.applyOverride('xfer-1', 'acct-1', 'Food', 'Groceries');

  assert.equal(env.calls.requests.length, 1);
  assert.ok(env.calls.requests[0].url.endsWith('/api/categorization/transactions/xfer-1/categorize'));
  assertRefusedAndRowLeftAlone(env);
});

test('edit: a refusal on the direct PUT shows the backend reason and leaves the row as it was', async () => {
  const env = loadWithRefusal();

  await env.api._updateManualTransactionCategory('xfer-1', 'Food: Groceries');

  assert.equal(env.calls.requests[0].method, 'PUT');
  assert.deepEqual(env.calls.requests[0].body, { user_category: 'Food: Groceries' });
  assertRefusedAndRowLeftAlone(env);
});

test('categorize modal: a refusal keeps the modal open with the backend reason', async () => {
  const env = loadWithRefusal();

  await env.api._applyCategorizeAndClose(env.sandbox.transactions[0], 'xfer-1', 'acct-1');

  assertRefusedAndRowLeftAlone(env);
  assert.equal(env.calls.modalClosed, 0, 'the modal stays open');
});
