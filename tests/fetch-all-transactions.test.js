const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = ['api.js', 'revalidation.js']
  .map((file) => fs.readFileSync(path.join(__dirname, '..', 'transactions', file), 'utf8'))
  .join('\n');

const CACHED_ROWS = [{ transaction_id: 'old-1' }, { transaction_id: 'old-2' }];
const SERVER_ROWS = [{ transaction_id: 'new-1' }];
const STALE_ROWS = [{ transaction_id: 'stale-1' }];

const ids = (rows) => rows.map((row) => row.transaction_id);

// Loads api.js with a fake Dexie worker and a fake server. `respond` gets the
// request headers and returns { status, etag, rows }; it may also change the
// page (open an editor, land a write) to act out what happens mid-request.
function load({
  realTimers = false, cachedAtAgeMs = 1000, storedEtag = 'etag-1', rows = CACHED_ROWS,
  respond, replaceAllFails = false,
}) {
  const requests = [];
  const meta = { cached_at: Date.now() - cachedAtAgeMs, etag: storedEtag };
  // `stored` is every Dexie write in the order the worker would apply it.
  const calls = { renders: 0, statuses: [], stored: [], timers: [], rowsAtRender: [], accounts: 0 };
  const attached = new Set();
  const inTable = new Set();
  const page = {
    visibilityState: 'visible',
    activeElement: null,
    contains: (node) => attached.has(node),
    getElementById: (id) => (id === 'table-container' ? { contains: (node) => inTable.has(node) } : null),
    addEventListener() {},
  };
  const sandbox = {
    module: { exports: {} },
    console,
    setTimeout: realTimers ? setTimeout : (handler, ms) => { calls.timers.push({ handler, ms }); return 0; },
    clearTimeout,
    AbortController,
    document: page,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    token: 't', refreshToken: null, currentUser: null,
    BACKEND_URL: 'http://api.test',
    transactions: [],
    selectedAccountMode: 'all',
    selectedAccountId: null,
    accounts: [],
    balanceHistoryLookup: {},
    balanceHistoryLoading: false,
    window: {
      requestIdleCallback: (callback) => { callback(); },
      txnDB: {
        query: async () => rows.slice(),
        getMeta: async (key) => meta[key] ?? null,
        setMeta: async (key, value) => { meta[key] = value; calls.stored.push([key, value]); },
        replaceAll: async (list) => {
          if (replaceAllFails) throw new Error('quota');
          calls.stored.push(['rows', list.map((row) => row.transaction_id)]);
        },
      },
    },
    fetch: async (url, init) => {
      requests.push({ url, method: init.method || 'GET', headers: init.headers });
      const reply = respond(init.headers, { url, method: init.method || 'GET', count: requests.length });
      return {
        status: reply.status,
        headers: { get: (name) => (name === 'ETag' ? reply.etag || null : null) },
        json: async () => ({ transactions: reply.rows || [] }),
      };
    },
    renderTransactionTable: () => {
      calls.renders += 1;
      calls.rowsAtRender.push(ids(sandbox.transactions));
    },
    renderDynamicPeriodButtons: () => {},
    autoExtendEndDateForScheduled: () => {},
    showStatus: (message, type) => calls.statuses.push({ message, type }),
    clearStatus: () => {},
    loadAccounts: async () => { calls.accounts += 1; },
  };
  vm.runInNewContext(
    `${source}\nmodule.exports = { fetchAllTransactions, _fetchTransactionsFromServer, revalidateTransactions };`,
    sandbox,
    { filename: 'api.js' },
  );
  sandbox.module.exports._fetchTransactionsFromServer._cachedEtag = storedEtag;

  // A text input in the table, focused or held by the inline editor.
  const tableInput = () => {
    const node = { tagName: 'INPUT', type: 'text' };
    attached.add(node);
    inTable.add(node);
    return node;
  };
  const detach = (node) => { attached.delete(node); inTable.delete(node); };
  return { api: sandbox.module.exports, sandbox, requests, calls, meta, page, tableInput, detach };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const etagInMemory = (env) => env.api._fetchTransactionsFromServer._cachedEtag;
const storedKeys = (env) => env.calls.stored.map(([key]) => key);

test('a recent cache still asks the server, and a 304 keeps the cached rows', async () => {
  const env = load({ cachedAtAgeMs: 1000, respond: () => ({ status: 304 }) });
  await env.api.fetchAllTransactions(false);
  assert.equal(env.requests.length, 1, 'no age under which the network is skipped');
  assert.equal(env.requests[0].headers['If-None-Match'], 'etag-1');
  assert.deepEqual(ids(env.sandbox.transactions), ['old-1', 'old-2']);
  assert.ok(env.calls.stored.some(([key]) => key === 'cached_at'), 'the cache stamp is refreshed');
});

test('a 200 replaces the cached rows and stores the new ETag', async () => {
  const env = load({ respond: () => ({ status: 200, etag: 'etag-2', rows: SERVER_ROWS }) });
  await env.api.fetchAllTransactions(false);
  assert.deepEqual(ids(env.sandbox.transactions), ['new-1']);
  assert.equal(env.meta.etag, 'etag-2');
});

test('cached rows with no stored ETag are drawn, then replaced by one plain full GET', async () => {
  const env = load({ storedEtag: null, respond: () => ({ status: 200, etag: 'etag-2', rows: SERVER_ROWS }) });
  await env.api.fetchAllTransactions(false);
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].url.includes('since_date'), false);
  assert.equal(env.requests[0].headers['If-None-Match'], undefined);
  assert.deepEqual(env.calls.rowsAtRender, [['old-1', 'old-2'], ['new-1']]);
});

test('a forced reload with rows on screen is one full GET that cannot be a 304', async () => {
  const env = load({ respond: (headers) => (headers['If-None-Match']
    ? { status: 304 }
    : { status: 200, etag: 'etag-3', rows: SERVER_ROWS }) });
  env.sandbox.transactions = CACHED_ROWS.slice();
  await env.api.fetchAllTransactions(true, { quiet: true });
  assert.equal(env.requests.length, 1);
  assert.equal(env.requests[0].headers['If-None-Match'], undefined);
  assert.deepEqual(ids(env.sandbox.transactions), ['new-1']);
  assert.deepEqual(env.calls.statuses, [], 'quiet leaves the status bar alone');
});

test('a cold start is still the recent window followed by the full history', async () => {
  const env = load({ rows: [], storedEtag: null, respond: () => ({ status: 200, etag: 'etag-4', rows: SERVER_ROWS }) });
  await env.api.fetchAllTransactions(false);
  assert.equal(env.requests.length, 2);
  assert.ok(env.requests[0].url.includes('since_date='));
  assert.equal(env.requests[1].url.includes('since_date'), false);
});

test('a failed check leaves the cached rows on screen', async () => {
  const env = load({ respond: () => { throw new Error('offline'); } });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await env.api.fetchAllTransactions(false);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(ids(env.sandbox.transactions), ['old-1', 'old-2']);
});

test('a refused write is followed by a conditional check that redraws a changed row', async () => {
  const env = load({
    realTimers: true,
    respond: (headers) => (headers['X-Write']
      ? { status: 400 }
      : { status: 200, etag: 'etag-5', rows: SERVER_ROWS }),
  });
  env.sandbox.transactions = CACHED_ROWS.slice();
  await env.sandbox.authenticatedFetch('http://api.test/api/transactions/txn_1', {
    method: 'PUT',
    headers: { 'X-Write': '1' },
  });
  assert.equal(env.requests.length, 1, 'the check waits for the caller to show its message');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].headers['If-None-Match'], 'etag-1', 'conditional, not a forced reload');
  assert.deepEqual(ids(env.sandbox.transactions), ['new-1']);
});

test('a refused write that the server answers with a 304 leaves the table and the editor alone', async () => {
  const env = load({
    realTimers: true,
    respond: (headers) => (headers['X-Write'] ? { status: 400 } : { status: 304 }),
  });
  env.sandbox.transactions = CACHED_ROWS.slice();
  // A memo commit was refused; its input is gone and nothing is focused.
  await env.sandbox.authenticatedFetch('http://api.test/api/transactions/txn_1/memo', {
    method: 'PUT',
    headers: { 'X-Write': '1' },
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(env.requests.length, 2);
  assert.equal(env.calls.renders, 0);
  assert.deepEqual(ids(env.sandbox.transactions), ['old-1', 'old-2']);
  assert.equal(env.calls.accounts, 0);
});

test('an editor opened while the check is out holds back the 200, ETag and all', async () => {
  const env = load({ respond: (headers, request) => {
    if (request.count === 1) env.sandbox._activeInlineEditor = { input: env.tableInput() };
    return { status: 200, etag: 'etag-2', rows: SERVER_ROWS };
  } });
  env.sandbox.transactions = CACHED_ROWS.slice();

  assert.equal(await env.api.revalidateTransactions(), 'deferred');
  assert.deepEqual(ids(env.sandbox.transactions), ['old-1', 'old-2']);
  assert.equal(env.calls.renders, 0);
  assert.equal(etagInMemory(env), 'etag-1');
  assert.equal(env.meta.etag, 'etag-1');
  assert.equal(storedKeys(env).includes('rows'), false);
  assert.deepEqual(env.calls.timers.map((timer) => timer.ms), [30_000]);

  // The user leaves the editor; the retry still sends the old ETag, so it
  // gets the changed list rather than a 304.
  env.detach(env.sandbox._activeInlineEditor.input);
  await env.calls.timers[0].handler();
  await flush();
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].headers['If-None-Match'], 'etag-1');
  assert.deepEqual(ids(env.sandbox.transactions), ['new-1']);
  assert.equal(env.meta.etag, 'etag-2');
});

test('a memo input focused while the check is out holds back the 200', async () => {
  const env = load({ respond: () => {
    env.page.activeElement = env.tableInput();
    return { status: 200, etag: 'etag-2', rows: SERVER_ROWS };
  } });
  env.sandbox.transactions = CACHED_ROWS.slice();
  assert.equal(await env.api.revalidateTransactions(), 'deferred');
  assert.equal(env.calls.renders, 0);
  assert.equal(etagInMemory(env), 'etag-1');
});

test('a dangling inline editor pointer does not stop a changed list from landing', async () => {
  const env = load({ respond: () => ({ status: 200, etag: 'etag-2', rows: SERVER_ROWS }) });
  const removedInput = env.tableInput();
  env.detach(removedInput);
  env.sandbox._activeInlineEditor = { input: removedInput };
  assert.equal(await env.api.revalidateTransactions(), 'updated');
  assert.deepEqual(ids(env.sandbox.transactions), ['new-1']);
});

test('a write that lands during the check discards the reply and asks again at once', async () => {
  const env = load({ respond: (headers, request) => {
    if (request.method !== 'GET') return { status: 200 };
    if (request.count === 1) {
      // The user's write commits while the list is being built.
      env.sandbox.noteTransactionWriteResponse('PUT', 'http://api.test/api/transactions/old-1', 200);
      return { status: 200, etag: 'etag-stale', rows: STALE_ROWS };
    }
    return { status: 200, etag: 'etag-2', rows: SERVER_ROWS };
  } });
  env.sandbox.transactions = CACHED_ROWS.slice();
  assert.equal(await env.api.revalidateTransactions(), 'updated');
  assert.equal(env.requests.length, 2);
  assert.equal(env.requests[1].headers['If-None-Match'], 'etag-1', 'the dropped reply left no ETag behind');
  assert.deepEqual(env.calls.rowsAtRender[0], ['new-1'], 'the stale list was never drawn');
  assert.equal(env.meta.etag, 'etag-2');
});

test('a background 200 refreshes accounts and the selected account\'s balance history', async () => {
  const env = load({ respond: () => ({ status: 200, etag: 'etag-2', rows: SERVER_ROWS }) });
  env.sandbox.selectedAccountMode = 'single';
  env.sandbox.selectedAccountId = 'acct-1';
  const outcome = await env.api.revalidateTransactions();
  assert.equal(outcome, 'updated');
  assert.equal(env.calls.accounts, 1);
  assert.ok(env.requests.some((request) => request.url.includes('/api/accounts/acct-1/balance-history')));
});

test('every full-list path stores its ETag in Dexie only after the rows', async () => {
  const etagAfterRows = (env, etag) => {
    const rowsAt = storedKeys(env).lastIndexOf('rows');
    const etagAt = env.calls.stored.findIndex(([key, value]) => key === 'etag' && value === etag);
    assert.ok(rowsAt >= 0 && etagAt > rowsAt, JSON.stringify(env.calls.stored));
  };

  const validated = load({ respond: () => ({ status: 200, etag: 'etag-2', rows: SERVER_ROWS }) });
  await validated.api.fetchAllTransactions(false);
  etagAfterRows(validated, 'etag-2');

  const forced = load({ respond: () => ({ status: 200, etag: 'etag-3', rows: SERVER_ROWS }) });
  forced.sandbox.transactions = CACHED_ROWS.slice();
  await forced.api.fetchAllTransactions(true);
  etagAfterRows(forced, 'etag-3');

  const cold = load({ rows: [], storedEtag: null, respond: () => ({ status: 200, etag: 'etag-4', rows: SERVER_ROWS }) });
  await cold.api.fetchAllTransactions(false);
  await flush();
  etagAfterRows(cold, 'etag-4');
});

test('a failed row write keeps the old ETag in Dexie over the old rows', async () => {
  const env = load({ replaceAllFails: true, respond: () => ({ status: 200, etag: 'etag-2', rows: SERVER_ROWS }) });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await env.api.fetchAllTransactions(false);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(env.meta.etag, 'etag-1');
  assert.equal(etagInMemory(env), 'etag-2', 'the page itself holds the new rows');
});

test('a cache reset while the rows are being written keeps the new ETag out of Dexie', async () => {
  const env = load({ respond: () => ({ status: 200, etag: 'etag-2', rows: SERVER_ROWS }) });
  const replaceAll = env.sandbox.window.txnDB.replaceAll;
  env.sandbox.window.txnDB.replaceAll = async (list) => {
    await replaceAll(list);
    env.api._fetchTransactionsFromServer._cachedEtag = null;
  };
  await env.api.fetchAllTransactions(false);
  assert.equal(env.meta.etag, 'etag-1');
});

test('a cold start clears the ETag left in Dexie as well as the one in memory', async () => {
  const env = load({ rows: [], storedEtag: 'etag-left-over', respond: () => ({ status: 200, etag: 'etag-4', rows: SERVER_ROWS }) });
  await env.api.fetchAllTransactions(false);
  await flush();
  assert.deepEqual(env.calls.stored[0], ['etag', null]);
  assert.equal(env.requests[1].headers['If-None-Match'], undefined);
});
