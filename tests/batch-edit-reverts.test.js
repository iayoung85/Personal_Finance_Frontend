const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const managerPath = path.join(__dirname, '..', 'transactions', 'batch-edit-manager.js');
const managerSource = fs.readFileSync(managerPath, 'utf8');
const EXPORTED = [
  'stageBatchEdit', 'flushBatchEdits', 'hasPendingBatchEdits',
  '_noteBatchEditBaseline', '_planBatchEditReverts', '_describeBatchEditFailures',
].join(', ');

// Values built inside the vm context have another Object.prototype, which
// strict deepEqual rejects; a JSON round trip hands back plain test values.
const plain = (value) => JSON.parse(JSON.stringify(value));

const LINKED_ERROR = 'This transaction is part of a linked transfer. '
  + 'Unlink the transfer before changing its category.';

const pure = loadManager().api;

// A fresh sandbox per call: the manager keeps its queue in module state.
function loadManager() {
  const calls = { statuses: [], cached: [], requests: [], sidebar: 0 };
  const domElements = new Map();
  const sandbox = {
    module: { exports: {} },
    console: { log() {}, warn() {}, error() {} },
    transactions: [],
    BACKEND_URL: 'http://api.test',
    document: {
      activeElement: null,
      querySelector: (selector) => domElements.get(selector) || null,
    },
    $: (element) => ({
      data(key, ...rest) {
        if (rest.length === 0) return element.store[key];
        element.store[key] = rest[0];
        return this;
      },
    }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    showStatus: (message, type) => calls.statuses.push({ message, type }),
    clearStatus: () => {},
    renderAccountsSidebar: () => { calls.sidebar += 1; },
    _cacheTransactions: (rows) => calls.cached.push(plain(rows)),
    _patchAnalyticsClassFromServer: () => true,
    _refreshAccountsForStaleAnalyticsClass: async () => {},
    authenticatedFetch: async () => { throw new Error('no response scripted'); },
  };
  vm.runInNewContext(
    `${managerSource}\nmodule.exports = { ${EXPORTED} };`,
    sandbox,
    { filename: managerPath },
  );

  // Script the next responses; every request body is recorded.
  const reply = (...bodies) => {
    const queue = [...bodies];
    sandbox.authenticatedFetch = async (url, init) => {
      calls.requests.push(JSON.parse(init.body));
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return { ok: true, json: async () => next };
    };
  };

  return { api: sandbox.module.exports, sandbox, calls, reply, domElements };
}

const plaidRow = (id, extra = {}) => ({
  transaction_id: id, source: 'plaid', account_id: 'acct-1',
  user_category: 'Shopping: Online', is_override: false, reviewed: true, user_memo: '',
  ...extra,
});

const refused = (id, error = LINKED_ERROR) => ({ transaction_id: id, ok: false, applied: [], error });
const accepted = (id, applied = ['category']) => ({
  transaction_id: id, ok: true, applied, analytics_class: 'spending',
});
const summaryOf = (categories, memos, errors) => ({
  total: categories + memos + errors,
  categories_updated: categories,
  memos_updated: memos,
  errors,
});

// ── _noteBatchEditBaseline ───────────────────────────────────────

test('baseline: the first change to a row notes the category group and the unreviewed flag', () => {
  const row = plaidRow('t1', { user_category: '[Savings]', reviewed: false });
  const noted = pure._noteBatchEditBaseline(undefined, row, { user_category: 'Food: Groceries' }, '[Savings Acct]');

  assert.deepEqual(plain(noted), {
    user_category: '[Savings]',
    is_override: false,
    category_display: '[Savings Acct]',
    reviewed: false,
  });
});

test('baseline: the first value wins when the same row changes again before the flush', () => {
  const row = plaidRow('t1', { reviewed: false });
  const first = pure._noteBatchEditBaseline(undefined, row, { user_category: 'A: One' }, 'Shopping: Online');

  // What the optimistic update leaves behind after the first change.
  Object.assign(row, { user_category: 'A: One', is_override: true, reviewed: true });
  const second = pure._noteBatchEditBaseline(first, row, { user_category: 'B: Two' }, 'A: One');

  assert.deepEqual(plain(second), plain(first));
  assert.equal(second.user_category, 'Shopping: Online');
});

test('baseline: a memo change notes the memo, not the category', () => {
  const row = plaidRow('t1', { user_memo: 'old note' });
  const noted = pure._noteBatchEditBaseline(undefined, row, { user_memo: 'new note' }, 'ignored');

  assert.deepEqual(plain(noted), { user_memo: 'old note' });
});

test('baseline: a later memo change adds to what a category change noted', () => {
  const row = plaidRow('t1', { user_memo: 'old note' });
  const afterCategory = pure._noteBatchEditBaseline(undefined, row, { user_category: 'A: One' }, 'Shopping: Online');
  const afterMemo = pure._noteBatchEditBaseline(afterCategory, row, { user_memo: 'new note' });

  assert.equal(afterMemo.user_category, 'Shopping: Online');
  assert.equal(afterMemo.user_memo, 'old note');
});

test('baseline: a blank category is not applied optimistically, so nothing is noted', () => {
  const noted = pure._noteBatchEditBaseline(undefined, plaidRow('t1'), { user_category: '' }, 'x');

  assert.deepEqual(plain(noted), {});
});

test('baseline: the baseline passed in is left alone', () => {
  const before = { user_memo: 'old note' };
  pure._noteBatchEditBaseline(before, plaidRow('t1'), { user_category: 'A: One' }, 'x');

  assert.deepEqual(plain(before), { user_memo: 'old note' });
});

// ── _planBatchEditReverts ────────────────────────────────────────

const categoryBaseline = {
  user_category: '[Savings]', is_override: false, category_display: '[Savings Acct]', reviewed: false,
};

test('plan: accepted items change nothing', () => {
  const plan = plain(pure._planBatchEditReverts(
    [accepted('t1')], new Map([['t1', categoryBaseline]]), new Map(),
  ));

  assert.deepEqual(plan, { reverts: [], handovers: [], failedCount: 0, errors: [] });
});

test('plan: a refused item goes back to its baseline and reports the reason', () => {
  const plan = plain(pure._planBatchEditReverts(
    [accepted('t2'), refused('t1')],
    new Map([['t1', categoryBaseline]]),
    new Map(),
  ));

  assert.deepEqual(plan, {
    reverts: [{ transactionId: 't1', values: categoryBaseline }],
    handovers: [],
    failedCount: 1,
    errors: [LINKED_ERROR],
  });
});

test('plan: a refused item loses its memo too, since none of its fields were saved', () => {
  const baseline = { ...categoryBaseline, user_memo: 'old note' };
  const plan = plain(pure._planBatchEditReverts(
    [refused('t1')], new Map([['t1', baseline]]), new Map(),
  ));

  assert.equal(plan.reverts[0].values.user_memo, 'old note');
  assert.equal(plan.reverts[0].values.user_category, '[Savings]');
});

test('plan: a field the backend reports as applied stays, even though the item failed', () => {
  const baseline = { ...categoryBaseline, user_memo: 'old note' };
  const memoErrored = {
    transaction_id: 't1', ok: false, applied: ['category'], error: 'Memo update failed: boom',
  };
  const plan = plain(pure._planBatchEditReverts(
    [memoErrored], new Map([['t1', baseline]]), new Map(),
  ));

  // Only the memo is put back; the saved category, and the reviewed flag the
  // backend set along with it, are left as the screen shows them.
  assert.deepEqual(plan.reverts, [{ transactionId: 't1', values: { user_memo: 'old note' } }]);
  assert.deepEqual(plan.errors, ['Memo update failed: boom']);
});

test('plan: a field staged again meanwhile is handed over, not reverted', () => {
  const baseline = { ...categoryBaseline, user_memo: 'old note' };
  const plan = plain(pure._planBatchEditReverts(
    [refused('t1')],
    new Map([['t1', baseline]]),
    new Map([['t1', { user_category: 'Travel: Flights' }]]),
  ));

  // The memo has no newer edit, so it goes back now.
  assert.deepEqual(plan.reverts, [{ transactionId: 't1', values: { user_memo: 'old note' } }]);
  // The category (and the reviewed flag the newer edit will settle) wait with the newer edit.
  assert.deepEqual(plan.handovers, [{
    transactionId: 't1',
    values: {
      user_category: '[Savings]', is_override: false, category_display: '[Savings Acct]', reviewed: false,
    },
  }]);
});

test('plan: a refused item with no baseline still counts and gives its reason', () => {
  const plan = plain(pure._planBatchEditReverts([refused('gone')], new Map(), new Map()));

  assert.deepEqual(plan, { reverts: [], handovers: [], failedCount: 1, errors: [LINKED_ERROR] });
});

test('plan: a materialized row is found by its virtual id and reverted under its real id', () => {
  const materialized = {
    ...refused('real-9'), original_virtual_id: 'bill_1_occ_2', materialized: true,
  };
  const plan = plain(pure._planBatchEditReverts(
    [materialized], new Map([['bill_1_occ_2', categoryBaseline]]), new Map(),
  ));

  assert.equal(plan.reverts[0].transactionId, 'real-9');
  assert.equal(plan.reverts[0].values.user_category, '[Savings]');
});

test('plan: a blank or missing reason is counted but not reported', () => {
  const plan = plain(pure._planBatchEditReverts(
    [refused('t1', '   '), { transaction_id: 't2', ok: false }], new Map(), new Map(),
  ));

  assert.equal(plan.failedCount, 2);
  assert.deepEqual(plan.errors, []);
});

test('plan: a response without results is an empty plan', () => {
  const plan = plain(pure._planBatchEditReverts(undefined, new Map(), new Map()));

  assert.deepEqual(plan, { reverts: [], handovers: [], failedCount: 0, errors: [] });
});

// ── _describeBatchEditFailures ───────────────────────────────────

test('message: the reason follows the counts', () => {
  assert.equal(
    pure._describeBatchEditFailures(4, 1, [LINKED_ERROR]),
    `Bulk save: 4 applied, 1 failed — ${LINKED_ERROR}`,
  );
});

test('message: an identical reason is shown once, different reasons together', () => {
  assert.equal(
    pure._describeBatchEditFailures(0, 3, [LINKED_ERROR, LINKED_ERROR, LINKED_ERROR]),
    `Bulk save: 0 applied, 3 failed — ${LINKED_ERROR}`,
  );
  assert.equal(
    pure._describeBatchEditFailures(1, 2, [LINKED_ERROR, 'Transaction not found']),
    `Bulk save: 1 applied, 2 failed — ${LINKED_ERROR} / Transaction not found`,
  );
});

test('message: without a reason it is just the counts', () => {
  assert.equal(pure._describeBatchEditFailures(2, 1, []), 'Bulk save: 2 applied, 1 failed');
  assert.equal(pure._describeBatchEditFailures(2, 1), 'Bulk save: 2 applied, 1 failed');
});

// ── Flush: a refused item is put back, kept out of the cache, explained ──

test('flush: a refused category is put back in memory, kept out of the cache, and explained', async () => {
  const { api, sandbox, calls, reply } = loadManager();
  sandbox.transactions.push(
    plaidRow('xfer-1', { user_category: '[Savings]', reviewed: false }),
    plaidRow('plain-1'),
  );
  api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });
  api.stageBatchEdit('plain-1', { user_category: 'Food: Groceries' });

  // The screen shows the edit straight away.
  assert.equal(sandbox.transactions[0].user_category, 'Food: Groceries');
  assert.equal(sandbox.transactions[0].is_override, true);
  assert.equal(sandbox.transactions[0].reviewed, true);

  reply({
    results: [refused('xfer-1'), accepted('plain-1')],
    summary: summaryOf(1, 0, 1),
  });
  const sidebarBefore = calls.sidebar;
  await api.flushBatchEdits();

  const [transferRow, plainRow] = sandbox.transactions;
  assert.equal(transferRow.user_category, '[Savings]');
  assert.equal(transferRow.is_override, false);
  assert.equal(transferRow.reviewed, false);
  assert.equal(plainRow.user_category, 'Food: Groceries');
  assert.equal(plainRow.is_override, true);

  // The cache is written once, after the revert, so it never holds the refused value.
  assert.equal(calls.cached.length, 1);
  assert.equal(calls.cached[0][0].user_category, '[Savings]');
  assert.equal(calls.cached[0][1].user_category, 'Food: Groceries');

  assert.deepEqual(calls.statuses.at(-1), {
    message: `Bulk save: 1 applied, 1 failed — ${LINKED_ERROR}`,
    type: 'warning',
  });
  // The row is unreviewed again, so the sidebar count is redrawn.
  assert.ok(calls.sidebar > sidebarBefore);
  // What is sent to the API is unchanged.
  assert.deepEqual(calls.requests, [{ updates: [
    { transaction_id: 'xfer-1', user_category: 'Food: Groceries' },
    { transaction_id: 'plain-1', user_category: 'Food: Groceries' },
  ] }]);
});

test('flush: a refused item loses its memo edit as well', async () => {
  const { api, sandbox, reply } = loadManager();
  sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Savings]', user_memo: 'old note' }));
  api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });
  api.stageBatchEdit('xfer-1', { user_memo: 'new note' });
  assert.equal(sandbox.transactions[0].user_memo, 'new note');

  reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await api.flushBatchEdits();

  assert.equal(sandbox.transactions[0].user_category, '[Savings]');
  assert.equal(sandbox.transactions[0].user_memo, 'old note');
});

test('flush: a category the backend saved stays when only the memo of the same item failed', async () => {
  const { api, sandbox, reply } = loadManager();
  sandbox.transactions.push(plaidRow('t1', { user_memo: 'old note', reviewed: false }));
  api.stageBatchEdit('t1', { user_category: 'Food: Groceries' });
  api.stageBatchEdit('t1', { user_memo: 'new note' });

  reply({
    results: [{
      transaction_id: 't1', ok: false, applied: ['category'], error: 'Memo update failed: boom',
    }],
    summary: summaryOf(1, 0, 1),
  });
  await api.flushBatchEdits();

  assert.equal(sandbox.transactions[0].user_category, 'Food: Groceries');
  assert.equal(sandbox.transactions[0].is_override, true);
  assert.equal(sandbox.transactions[0].reviewed, true);
  assert.equal(sandbox.transactions[0].user_memo, 'old note');
});

test('flush: editing a row twice before the flush goes back to what the server holds', async () => {
  const { api, sandbox, reply } = loadManager();
  sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Savings]' }));
  api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });
  api.stageBatchEdit('xfer-1', { user_category: 'Travel: Flights' });

  reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await api.flushBatchEdits();

  assert.equal(sandbox.transactions[0].user_category, '[Savings]');
});

test('flush: when everything is accepted nothing is put back', async () => {
  const { api, sandbox, calls, reply } = loadManager();
  sandbox.transactions.push(plaidRow('t1'));
  api.stageBatchEdit('t1', { user_category: 'Food: Groceries' });

  reply({ results: [accepted('t1')], summary: summaryOf(1, 0, 0) });
  await api.flushBatchEdits();

  assert.equal(sandbox.transactions[0].user_category, 'Food: Groceries');
  assert.equal(calls.cached[0][0].user_category, 'Food: Groceries');
  assert.deepEqual(calls.statuses.at(-1), { message: 'Saved 1 edit', type: 'success' });
});

test('flush: a count with no per-item detail keeps the old message', async () => {
  const { api, sandbox, calls, reply } = loadManager();
  sandbox.transactions.push(plaidRow('t1'));
  api.stageBatchEdit('t1', { user_category: 'Food: Groceries' });

  reply({ results: [], summary: summaryOf(0, 0, 1) });
  await api.flushBatchEdits();

  assert.deepEqual(calls.statuses.at(-1), { message: 'Bulk save: 0 applied, 1 failed', type: 'warning' });
});

test('flush: a refused row that has left memory still shows the reason', async () => {
  const { api, sandbox, calls, reply } = loadManager();
  sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Savings]' }));
  api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });
  sandbox.transactions.length = 0;

  reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await api.flushBatchEdits();

  assert.match(calls.statuses.at(-1).message, /linked transfer/);
});

test('flush: a materialized bill row that is refused goes back under its new id', async () => {
  const { api, sandbox, reply } = loadManager();
  sandbox.transactions.push(plaidRow('bill_1_occ_2', { source: 'scheduled', user_category: 'Bills: Rent' }));
  api.stageBatchEdit('bill_1_occ_2', { user_category: 'Food: Groceries' });

  reply({
    results: [{ ...refused('real-9'), original_virtual_id: 'bill_1_occ_2', materialized: true }],
    summary: summaryOf(0, 0, 1),
  });
  await api.flushBatchEdits();

  assert.equal(sandbox.transactions[0].transaction_id, 'real-9');
  assert.equal(sandbox.transactions[0].user_category, 'Bills: Rent');
});

test('flush: an edit staged while the request is in flight survives, and rolls back to the server value if refused too', async () => {
  const { api, sandbox, calls, reply } = loadManager();
  sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Savings]' }));
  api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  sandbox.authenticatedFetch = async (url, init) => {
    calls.requests.push(JSON.parse(init.body));
    await gate;
    return { ok: true, json: async () => ({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) }) };
  };
  const firstFlush = api.flushBatchEdits();
  api.stageBatchEdit('xfer-1', { user_category: 'Travel: Flights' });
  release();
  await firstFlush;

  // The newer edit is still waiting for its own flush, so it stays on screen.
  assert.equal(sandbox.transactions[0].user_category, 'Travel: Flights');
  assert.equal(api.hasPendingBatchEdits(), true);

  reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await api.flushBatchEdits();

  // Back to what the server holds, not to the first refused edit.
  assert.equal(sandbox.transactions[0].user_category, '[Savings]');
  assert.equal(sandbox.transactions[0].is_override, false);
  assert.deepEqual(calls.requests[1], { updates: [{ transaction_id: 'xfer-1', user_category: 'Travel: Flights' }] });
});

test('flush: after a failed request the retry can still be refused and put the row back', async () => {
  const { api, sandbox, calls, reply } = loadManager();
  sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Savings]' }));
  api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });

  reply(new Error('network down'));
  await api.flushBatchEdits();
  assert.equal(calls.statuses.at(-1).message, 'Bulk save failed: network down');
  assert.equal(sandbox.transactions[0].user_category, 'Food: Groceries');
  assert.equal(api.hasPendingBatchEdits(), true);

  reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await api.flushBatchEdits();

  assert.equal(sandbox.transactions[0].user_category, '[Savings]');
  assert.equal(calls.cached.at(-1)[0].user_category, '[Savings]');
});

// ── The screen: category cell and memo ──────────────────────────

// A rendered row with the elements the manager touches.
function renderRow(env, txnId, { display, memo = '' }) {
  const input = { value: display, store: { committedCategoryValue: display } };
  const memoSpan = { textContent: memo, title: memo, innerHTML: '' };
  const row = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) {
      if (selector === '.category-autocomplete') return input;
      if (selector === '.txn-memo-text') return memoSpan;
      return null;
    },
  };
  env.domElements.set(`tr[data-txn-id="${txnId}"]`, row);
  return { row, input, memoSpan };
}

test('screen: a refused category cell shows what it showed before, not the raw category', async () => {
  const env = loadManager();
  // A linked transfer shows its partner's current name, which can differ
  // from the category text stored on the row.
  env.sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Old Savings]' }));
  const { row, input } = renderRow(env, 'xfer-1', { display: '[Savings]' });

  input.value = 'Food: Groceries'; // what the user typed before pressing Tab
  env.api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });
  assert.equal(row.attributes['data-user-category'], 'Food: Groceries');

  env.reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await env.api.flushBatchEdits();

  assert.equal(input.value, '[Savings]');
  assert.equal(input.store.committedCategoryValue, '[Savings]');
  assert.equal(row.attributes['data-user-category'], '[Old Savings]');
});

test('screen: a cell the user is typing in keeps the typing, and snaps back when they leave', async () => {
  const env = loadManager();
  env.sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Savings]' }));
  const { input } = renderRow(env, 'xfer-1', { display: '[Savings]' });

  input.value = 'Food: Groceries';
  env.api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });

  // The user goes back into the cell and starts a different entry.
  env.sandbox.document.activeElement = input;
  input.value = 'Tra';

  env.reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await env.api.flushBatchEdits();

  assert.equal(input.value, 'Tra');
  assert.equal(input.store.committedCategoryValue, '[Savings]');
});

test('screen: a focused cell the user has not touched is put back', async () => {
  const env = loadManager();
  env.sandbox.transactions.push(plaidRow('xfer-1', { user_category: '[Savings]' }));
  const { input } = renderRow(env, 'xfer-1', { display: '[Savings]' });

  input.value = 'Food: Groceries';
  env.api.stageBatchEdit('xfer-1', { user_category: 'Food: Groceries' });
  env.sandbox.document.activeElement = input;

  env.reply({ results: [refused('xfer-1')], summary: summaryOf(0, 0, 1) });
  await env.api.flushBatchEdits();

  assert.equal(input.value, '[Savings]');
});

test('screen: a refused memo is put back on the row, unless its editor is open', async () => {
  const env = loadManager();
  env.sandbox.transactions.push(
    plaidRow('t1', { user_memo: 'old note' }),
    plaidRow('t2', { user_memo: 'old note' }),
  );
  const first = renderRow(env, 't1', { display: 'x', memo: 'old note' });
  const second = renderRow(env, 't2', { display: 'x', memo: 'old note' });
  env.api.stageBatchEdit('t1', { user_memo: 'new note' });
  env.api.stageBatchEdit('t2', { user_memo: 'new note' });
  first.memoSpan.textContent = 'new note';
  second.memoSpan.textContent = 'new note';
  env.domElements.set('.inline-memo-input[data-txn-id="t2"]', {});

  env.reply({ results: [refused('t1'), refused('t2')], summary: summaryOf(0, 0, 2) });
  await env.api.flushBatchEdits();

  assert.equal(first.memoSpan.textContent, 'old note');
  assert.equal(second.memoSpan.textContent, 'new note');
  assert.equal(env.sandbox.transactions[0].user_memo, 'old note');
  assert.equal(env.sandbox.transactions[1].user_memo, 'old note');
});
