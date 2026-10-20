const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const savePath = path.join(__dirname, '..', 'transactions', 'inline-save.js');
const saveSource = fs.readFileSync(savePath, 'utf8');

// Values built inside the vm context have another Object.prototype, which
// strict deepEqual rejects; a JSON round trip hands back plain test values.
const plain = (value) => JSON.parse(JSON.stringify(value));

const LINKED_ERROR = 'This transaction is part of a linked transfer. '
  + 'Unlink the transfer before changing its category.';

/**
 * A fresh sandbox per test: the save file keeps its in-flight saves in
 * module state. Each request waits until the test answers it, so a test can
 * order answers however it likes.
 */
function loadSaves(rows) {
  const calls = { statuses: [], requests: [], cached: [], removed: [], sidebar: 0, refreshed: [], redrawn: 0 };
  const domElements = new Map();
  const pending = [];
  const sandbox = {
    module: { exports: {} },
    console,
    transactions: rows,
    BACKEND_URL: 'http://api.test',
    localStorage: { removeItem() {} },
    document: {
      activeElement: null,
      querySelector: (selector) => domElements.get(selector) || null,
      querySelectorAll: () => [],
    },
    $: (element) => ({
      data(key, ...rest) {
        if (rest.length === 0) return element.store[key];
        element.store[key] = rest[0];
        return this;
      },
    }),
    showStatus: (message, type) => calls.statuses.push({ message, type }),
    renderAccountsSidebar: () => { calls.sidebar += 1; },
    _replaceCachedTransaction: (id, row) => calls.cached.push(plain(row)),
    _removeCachedTransaction: (id) => calls.removed.push(id),
    renderTransactionTable: () => { calls.redrawn += 1; },
    _refreshAccountsForStaleAnalyticsClass: async (ids) => { calls.refreshed.push(...ids); },
    authenticatedFetch: (url, init) => new Promise((resolve, reject) => {
      calls.requests.push({ url, body: JSON.parse(init.body) });
      pending.push({ resolve, reject });
    }),
  };
  vm.runInNewContext(
    `${saveSource}\nmodule.exports = { saveInlineCategory, saveInlineMemo };`,
    sandbox,
    { filename: savePath },
  );

  const answer = (index, status, body) => {
    pending[index].resolve({ ok: status < 400, status, json: async () => body });
  };
  const fail = (index, error) => pending[index].reject(error);
  // Let queued sends and answers run before the test looks.
  const settle = () => new Promise(resolve => setImmediate(resolve));

  return { api: sandbox.module.exports, sandbox, calls, answer, fail, settle, domElements };
}

const plaidRow = (id, extra = {}) => ({
  transaction_id: id, source: 'plaid', account_id: 'acct-1',
  user_category: 'Shopping: Online', is_override: false, reviewed: true, user_memo: '',
  ...extra,
});

const categorized = (row, category) => ({
  transaction_id: row.transaction_id,
  user_category: category,
  transaction: { ...row, user_category: category, is_override: true, analytics_class: 'spending' },
});

test('a Tab category posts that one row to categorize and shows on the row before the answer', async () => {
  const env = loadSaves([plaidRow('t1')]);

  const saving = env.api.saveInlineCategory('t1', 'Food: Groceries');

  assert.equal(env.calls.requests.length, 1);
  assert.ok(env.calls.requests[0].url.endsWith('/api/categorization/transactions/t1/categorize'));
  assert.deepEqual(env.calls.requests[0].body, { user_category: 'Food: Groceries' });
  assert.equal(env.sandbox.transactions[0].user_category, 'Food: Groceries');

  env.answer(0, 200, categorized(env.sandbox.transactions[0], 'Food: Groceries'));
  await saving;

  assert.equal(env.sandbox.transactions[0].analytics_class, 'spending');
  assert.deepEqual(env.calls.statuses, [{ message: 'Category saved: Food: Groceries', type: 'success' }]);
});

test('an unchanged category sends nothing', async () => {
  const env = loadSaves([plaidRow('t1')]);

  await env.api.saveInlineCategory('t1', '  Shopping: Online ');

  assert.equal(env.calls.requests.length, 0);
});

test('a refused category puts the row back and shows the reason as a warning', async () => {
  const env = loadSaves([plaidRow('xfer-1', { user_category: '[Savings]', reviewed: false })]);

  const saving = env.api.saveInlineCategory('xfer-1', 'Food: Groceries');
  assert.equal(env.sandbox.transactions[0].reviewed, true);
  env.answer(0, 400, { error: LINKED_ERROR });
  await saving;

  const row = env.sandbox.transactions[0];
  assert.equal(row.user_category, '[Savings]');
  assert.equal(row.is_override, false);
  assert.equal(row.reviewed, false);
  assert.deepEqual(env.calls.statuses, [{ message: LINKED_ERROR, type: 'warning' }]);
  assert.equal(env.calls.cached.at(-1).user_category, '[Savings]', 'the cache holds what the server holds');
});

test('a refused category restores the cell to what it showed before the edit', async () => {
  const env = loadSaves([plaidRow('xfer-1', { user_category: '[Savings]' })]);
  const categoryInput = { value: 'Savings Account', store: { committedCategoryValue: 'Savings Account' } };
  const rowElement = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector: () => categoryInput,
  };
  env.domElements.set('tr[data-txn-id="xfer-1"]', rowElement);

  const saving = env.api.saveInlineCategory('xfer-1', 'Food: Groceries');
  assert.equal(categoryInput.value, 'Food: Groceries');
  env.answer(0, 400, { error: LINKED_ERROR });
  await saving;

  assert.equal(categoryInput.value, 'Savings Account');
  assert.equal(categoryInput.store.committedCategoryValue, 'Savings Account');
  assert.equal(rowElement.attributes['data-user-category'], '[Savings]');
});

test('a category that never reached the server is put back and shown as an error', async () => {
  const env = loadSaves([plaidRow('t1')]);

  const saving = env.api.saveInlineCategory('t1', 'Food: Groceries');
  env.fail(0, new Error('Network down'));
  await saving;

  assert.equal(env.sandbox.transactions[0].user_category, 'Shopping: Online');
  assert.deepEqual(env.calls.statuses, [{ message: 'Category not saved: Network down', type: 'error' }]);
});

test('a second edit of the same field waits for the first answer, then is sent', async () => {
  const env = loadSaves([plaidRow('xfer-1', { user_category: '[Savings]' })]);

  const saving = env.api.saveInlineCategory('xfer-1', 'Food: Groceries');
  env.api.saveInlineCategory('xfer-1', 'Travel: Flights');
  assert.equal(env.calls.requests.length, 1, 'one request in flight per field and row');

  env.answer(0, 400, { error: LINKED_ERROR });
  await env.settle();
  assert.equal(env.calls.requests.length, 2);
  assert.deepEqual(env.calls.requests[1].body, { user_category: 'Travel: Flights' });
  assert.equal(env.sandbox.transactions[0].user_category, 'Travel: Flights', 'the earlier refusal leaves the newer edit');

  env.answer(1, 400, { error: LINKED_ERROR });
  await saving;

  assert.equal(env.sandbox.transactions[0].user_category, '[Savings]', 'back to what the server held before both');
  assert.equal(env.calls.statuses.length, 2, 'each refusal is reported');
});

test('edits made while a request is in flight send only the newest', async () => {
  const env = loadSaves([plaidRow('t1')]);

  const saving = env.api.saveInlineCategory('t1', 'Food: A');
  env.api.saveInlineCategory('t1', 'Food: B');
  env.api.saveInlineCategory('t1', 'Food: C');
  env.answer(0, 200, categorized(plaidRow('t1'), 'Food: A'));
  await env.settle();

  assert.equal(env.calls.requests.length, 2);
  assert.deepEqual(env.calls.requests[1].body, { user_category: 'Food: C' });
  assert.equal(env.sandbox.transactions[0].user_category, 'Food: C', 'the older answer does not overwrite the newer edit');
  assert.equal(env.calls.cached.at(-1).user_category, 'Food: C');

  env.answer(1, 200, categorized(plaidRow('t1'), 'Food: C'));
  await saving;
  assert.equal(env.sandbox.transactions[0].user_category, 'Food: C');
  assert.deepEqual(env.calls.statuses, [{ message: 'Category saved: Food: C', type: 'success' }]);
});

test('a later refused save goes back to what an earlier saved one left on the server', async () => {
  const env = loadSaves([plaidRow('t1')]);

  const saving = env.api.saveInlineCategory('t1', 'Food: Groceries');
  env.api.saveInlineCategory('t1', 'Travel: Flights');
  env.answer(0, 200, categorized(plaidRow('t1'), 'Food: Groceries'));
  await env.settle();
  env.answer(1, 400, { error: 'Refused' });
  await saving;

  assert.equal(env.sandbox.transactions[0].user_category, 'Food: Groceries');
});

test('a refused category leaves the row reviewed when a memo save on it went through', async () => {
  const env = loadSaves([plaidRow('t1', { reviewed: false })]);

  const category = env.api.saveInlineCategory('t1', 'Food: Groceries');
  const memo = env.api.saveInlineMemo('t1', 'lunch');
  env.answer(1, 200, { message: 'Memo updated successfully', transaction_id: 't1', source: 'plaid' });
  await memo;
  env.answer(0, 400, { error: 'Refused' });
  await category;

  assert.equal(env.sandbox.transactions[0].reviewed, true);
  assert.equal(env.sandbox.transactions[0].user_memo, 'lunch');
});

test('a category refused after a memo turned a virtual row real is still put back', async () => {
  const env = loadSaves([plaidRow('bill_1_occ_2', { source: 'scheduled', user_category: '[Savings]' })]);

  const memo = env.api.saveInlineMemo('bill_1_occ_2', 'rent');
  const category = env.api.saveInlineCategory('bill_1_occ_2', 'Food: Groceries');
  env.answer(0, 200, { message: 'Memo updated successfully', transaction_id: 'txn-real', source: 'manual' });
  await memo;
  env.answer(1, 400, { error: LINKED_ERROR });
  await category;

  const row = env.sandbox.transactions[0];
  assert.equal(row.transaction_id, 'txn-real');
  assert.equal(row.user_category, '[Savings]');
  assert.equal(row.user_memo, 'rent');
});

test('a queued edit on a virtual row is sent to the real id the first save created', async () => {
  const env = loadSaves([plaidRow('bill_1_occ_2', { source: 'scheduled' })]);

  const saving = env.api.saveInlineCategory('bill_1_occ_2', 'Food: Groceries');
  env.api.saveInlineCategory('bill_1_occ_2', 'Travel: Flights');
  env.answer(0, 200, {
    transaction_id: 'txn-real',
    user_category: 'Food: Groceries',
    purged_virtual_ids: ['bill_1_occ_2'],
    transaction: { ...plaidRow('txn-real'), source: 'manual', user_category: 'Food: Groceries' },
  });
  await env.settle();

  assert.ok(env.calls.requests[1].url.endsWith('/api/categorization/transactions/txn-real/categorize'));
  env.answer(1, 400, { error: 'Refused' });
  await saving;
  assert.equal(env.sandbox.transactions[0].user_category, 'Food: Groceries', 'back to what the first save left');
});

test('an edit on a row no longer in memory redraws the table and says so', async () => {
  const env = loadSaves([plaidRow('t1')]);

  await env.api.saveInlineMemo('bill_1_occ_2_cpt', 'rent');

  assert.equal(env.calls.requests.length, 0);
  assert.equal(env.calls.redrawn, 1);
  assert.equal(env.calls.statuses[0].type, 'warning');
});

test('a virtual bill row saved by categorize takes the real row id', async () => {
  const env = loadSaves([plaidRow('bill_1_occ_2', { source: 'scheduled' })]);

  const saving = env.api.saveInlineCategory('bill_1_occ_2', 'Food: Groceries');
  env.answer(0, 200, {
    transaction_id: 'txn-real',
    user_category: 'Food: Groceries',
    purged_virtual_ids: ['bill_1_occ_2'],
    transaction: { ...plaidRow('txn-real'), source: 'manual', user_category: 'Food: Groceries', analytics_class: 'spending' },
  });
  await saving;

  const row = env.sandbox.transactions[0];
  assert.equal(row.transaction_id, 'txn-real');
  assert.equal(row.source, 'manual');
});

test('a memo posts that one row to add-memo', async () => {
  const env = loadSaves([plaidRow('t1')]);

  const saving = env.api.saveInlineMemo('t1', 'lunch');
  assert.ok(env.calls.requests[0].url.endsWith('/api/transactions/add-memo'));
  assert.deepEqual(env.calls.requests[0].body, { transaction_id: 't1', user_memo: 'lunch' });
  env.answer(0, 200, { message: 'Memo updated successfully', transaction_id: 't1', source: 'plaid' });
  await saving;

  assert.equal(env.sandbox.transactions[0].user_memo, 'lunch');
  assert.deepEqual(env.calls.statuses, [{ message: 'Memo saved', type: 'success' }]);
});

test('a refused memo puts the old memo back and shows the reason as a warning', async () => {
  const env = loadSaves([plaidRow('t1', { user_memo: 'old' })]);

  const saving = env.api.saveInlineMemo('t1', 'new');
  env.answer(0, 400, { error: 'Memo edit not permitted' });
  await saving;

  assert.equal(env.sandbox.transactions[0].user_memo, 'old');
  assert.deepEqual(env.calls.statuses, [{ message: 'Memo edit not permitted', type: 'warning' }]);
});

test('a memo on a virtual bill row takes the id it was saved under', async () => {
  const env = loadSaves([plaidRow('bill_1_occ_2', { source: 'scheduled' })]);

  const saving = env.api.saveInlineMemo('bill_1_occ_2', 'rent');
  env.answer(0, 200, { message: 'Memo updated successfully', transaction_id: 'txn-real', source: 'manual' });
  await saving;

  const row = env.sandbox.transactions[0];
  assert.equal(row.transaction_id, 'txn-real');
  assert.equal(row.source, 'manual');
});
