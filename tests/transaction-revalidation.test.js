const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'transactions', 'revalidation.js'), 'utf8');

const TABLE_IDS = ['table-container', 'pending-table-container'];

// A small stand-in for the page: elements are attached or not, and each
// table container holds the elements put into it.
function makeDocument() {
  const attached = new Set();
  const contents = {};
  const containers = {};
  for (const id of TABLE_IDS) {
    contents[id] = new Set();
    containers[id] = { contains: (node) => contents[id].has(node) };
  }
  const listeners = [];
  const doc = {
    visibilityState: 'visible',
    activeElement: null,
    contains: (node) => attached.has(node),
    getElementById: (id) => containers[id] || null,
    addEventListener: (name, handler) => listeners.push({ name, handler }),
  };
  const element = (tagName, extra = {}, containerId = 'table-container') => {
    const node = { tagName, ...extra };
    attached.add(node);
    if (containerId) contents[containerId].add(node);
    return node;
  };
  const detach = (node) => {
    attached.delete(node);
    for (const id of TABLE_IDS) contents[id].delete(node);
  };
  return { doc, element, detach, listeners };
}

// revalidation.js only declares functions and constants at load, so it runs
// in a bare sandbox; the page globals it calls are stubbed per test.
function load(overrides = {}) {
  const page = makeDocument();
  const calls = { validated: [], statuses: [], intervals: [], timers: [], renders: 0, accounts: 0, history: [] };
  const outcomes = [];
  const sandbox = {
    module: { exports: {} },
    console,
    // Timers are recorded and run by the test, so a 30 s retry costs nothing.
    setTimeout: (handler, ms) => { calls.timers.push({ handler, ms }); return calls.timers.length; },
    clearTimeout: () => {},
    document: page.doc,
    setInterval: (handler, ms) => calls.intervals.push({ handler, ms }),
    _transactionLoadsInFlight: 0,
    _validateTransactionsWithServer: async (options) => {
      calls.validated.push(options);
      return outcomes.length ? outcomes.shift() : 'unchanged';
    },
    showStatus: (message, type) => calls.statuses.push({ message, type }),
    clearStatus: () => {},
    renderTransactionTable: () => { calls.renders += 1; },
    loadAccounts: async () => { calls.accounts += 1; },
    fetchBalanceHistory: async (accountId) => { calls.history.push(accountId); },
    selectedAccountMode: 'all',
    selectedAccountId: null,
    ...overrides,
  };
  // The real helper lives in api.js; this stand-in follows its plan so the
  // revalidation tests still see the calls the plan asks for.
  sandbox.refreshBalancesAfterListChange = async (plan, options = {}) => {
    if (plan.reloadAccounts) await sandbox.loadAccounts({ quiet: true });
    if (plan.refetchSelected) await sandbox.fetchBalanceHistory(sandbox.selectedAccountId);
    if (!(options.skipRenderWhileEditing && sandbox.isUserEditingTable())) sandbox.renderTransactionTable();
  };
  vm.runInNewContext(
    `${source}\nmodule.exports = {
      isRevalidationThrottled, isUserIdle, revalidationGate, shouldRevalidateNow, backgroundReplyAction,
      isTextEntryElement, isEditingTable, isUserEditingTable, transactionRowWriteCount,
      revalidateTransactions, revalidateAfterRefusedWrite, startTransactionRevalidation, noteUserInput,
      idleStatusMessage, returnStatusForOutcome,
      isTransactionRowWrite, isRefusedTransactionWrite,
      noteTransactionWriteStarted, noteTransactionWriteResponse,
      REFUSED_WRITE_REFETCH_DELAY_MS, TRANSACTION_REVALIDATE_INTERVAL_MS, DEFERRED_REVALIDATION_RETRY_MS,
      TRANSACTION_REVALIDATE_IDLE_AFTER_MS,
    };`,
    sandbox,
    { filename: 'revalidation.js' },
  );
  sandbox.isUserEditingTable = sandbox.module.exports.isUserEditingTable;
  const runTimers = async (ms) => {
    const due = calls.timers.filter((timer) => timer.ms === ms);
    calls.timers = calls.timers.filter((timer) => timer.ms !== ms);
    for (const timer of due) await timer.handler();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    api: sandbox.module.exports,
    sandbox,
    page,
    calls,
    queueOutcomes: (...values) => outcomes.push(...values),
    runTimers,
  };
}

const READY = { now: 1_000_000, lastRunAt: 0, visibilityState: 'visible', loadsInFlight: 0, editing: false };
const TRANSACTION_REVALIDATE_IDLE_AFTER_MS = 30 * 60 * 1000;

test('a check inside the last minute is throttled, one at the minute is not', () => {
  const { api } = load();
  assert.equal(api.isRevalidationThrottled(100_000, 70_000), true);
  assert.equal(api.isRevalidationThrottled(130_000, 70_000), false);
  assert.equal(api.isRevalidationThrottled(100_000, 0), false, 'no earlier check never throttles');
});

test('the gate runs only when visible, idle, past the gap, and not editing', () => {
  const { api } = load();
  assert.equal(api.revalidationGate(READY), 'run');
  assert.equal(api.shouldRevalidateNow(READY), true);
  assert.equal(api.revalidationGate({ ...READY, visibilityState: 'hidden' }), 'hidden');
  assert.equal(api.revalidationGate({ ...READY, loadsInFlight: 1 }), 'busy');
  assert.equal(api.revalidationGate({ ...READY, lastRunAt: READY.now - 1000 }), 'throttled');
  assert.equal(api.revalidationGate({ ...READY, editing: true }), 'editing');
});

test('a changed list is applied only when nobody is editing and no write overlapped', () => {
  const { api } = load();
  assert.equal(api.backgroundReplyAction({ editing: false, writesAtStart: 3, writesNow: 3 }), 'apply');
  assert.equal(api.backgroundReplyAction({ editing: true, writesAtStart: 3, writesNow: 3 }), 'deferred');
  assert.equal(api.backgroundReplyAction({ editing: false, writesAtStart: 3, writesNow: 4 }), 'superseded');
  assert.equal(api.backgroundReplyAction({ editing: true, writesAtStart: 3, writesNow: 4 }), 'deferred',
    'asking again at once is pointless while the user is still editing');
});

test('an inline editor counts only while its input is on the page', () => {
  const env = load();
  const input = env.page.element('INPUT', { type: 'text' });
  assert.equal(env.api.isEditingTable({ input }, env.page.doc), true);
  env.page.detach(input);
  assert.equal(env.api.isEditingTable({ input }, env.page.doc), false, 'a dangling pointer is not an editor');
  assert.equal(env.api.isEditingTable(null, env.page.doc), false);
});

test('a focused text field inside either table counts as editing, wherever its pointer is', () => {
  const env = load();
  const memo = env.page.element('INPUT', { type: 'text', className: 'inline-memo-input' });
  env.page.doc.activeElement = memo;
  assert.equal(env.api.isEditingTable(null, env.page.doc), true);

  const category = env.page.element('INPUT', { className: 'category-autocomplete' }, 'pending-table-container');
  env.page.doc.activeElement = category;
  assert.equal(env.api.isEditingTable(null, env.page.doc), true);

  env.page.doc.activeElement = env.page.element('TEXTAREA');
  assert.equal(env.api.isEditingTable(null, env.page.doc), true);
  env.page.doc.activeElement = env.page.element('DIV', { isContentEditable: true });
  assert.equal(env.api.isEditingTable(null, env.page.doc), true);
});

test('focus outside the table, or on a checkbox, is not editing', () => {
  const env = load();
  env.page.doc.activeElement = env.page.element('INPUT', { type: 'text' }, null);
  assert.equal(env.api.isEditingTable(null, env.page.doc), false, 'the search box is outside the table');
  env.page.doc.activeElement = env.page.element('INPUT', { type: 'checkbox' });
  assert.equal(env.api.isEditingTable(null, env.page.doc), false);
  env.page.doc.activeElement = env.page.element('BUTTON');
  assert.equal(env.api.isEditingTable(null, env.page.doc), false);
});

test('revalidateTransactions asks the server once, guarded, then is throttled', async () => {
  const env = load();
  assert.equal(await env.api.revalidateTransactions(), 'unchanged');
  assert.equal(await env.api.revalidateTransactions(), 'skipped');
  assert.equal(env.calls.validated.length, 1);
  assert.equal(env.calls.validated[0].guardUser, true);
});

test('revalidateTransactions does not start on top of a load in flight', async () => {
  const env = load({ _transactionLoadsInFlight: 1 });
  assert.equal(await env.api.revalidateTransactions(), 'skipped');
  assert.equal(env.calls.validated.length, 0);
});

test('a hidden tab is skipped without a retry', async () => {
  const env = load();
  env.page.doc.visibilityState = 'hidden';
  assert.equal(await env.api.revalidateTransactions(), 'skipped');
  assert.equal(env.calls.validated.length, 0);
  assert.equal(env.calls.timers.length, 0);
});

test('an editor open before the check: no request, one retry in 30 s', async () => {
  const env = load();
  const input = env.page.element('INPUT', { type: 'text' });
  env.sandbox._activeInlineEditor = { input };
  assert.equal(await env.api.revalidateTransactions(), 'skipped');
  assert.equal(await env.api.revalidateTransactions(), 'skipped');
  assert.equal(env.calls.validated.length, 0);
  assert.deepEqual(env.calls.timers.map((timer) => timer.ms), [30_000], 'two asks share one retry');

  // The user finished; the retry runs the check.
  env.sandbox._activeInlineEditor = null;
  await env.runTimers(30_000);
  assert.equal(env.calls.validated.length, 1);
});

test('a dangling inline editor pointer does not hold back the check', async () => {
  const env = load();
  const input = env.page.element('INPUT', { type: 'text' });
  env.page.detach(input);
  env.sandbox._activeInlineEditor = { input };
  assert.equal(await env.api.revalidateTransactions(), 'unchanged');
  assert.equal(env.calls.validated.length, 1);
});

test('a deferred reply resets the throttle and schedules one retry', async () => {
  const env = load();
  env.queueOutcomes('deferred');
  assert.equal(await env.api.revalidateTransactions(), 'deferred');
  assert.deepEqual(env.calls.timers.map((timer) => timer.ms), [30_000]);
  // Not throttled: a tab return straight after may ask again.
  assert.equal(await env.api.revalidateTransactions(), 'unchanged');
  assert.equal(env.calls.validated.length, 2);
  assert.deepEqual(env.calls.statuses, []);
});

test('a reply overlapped by a write is asked for again at once', async () => {
  const env = load();
  env.queueOutcomes('superseded', 'updated');
  assert.equal(await env.api.revalidateTransactions(), 'updated');
  assert.equal(env.calls.validated.length, 2);
  assert.equal(env.calls.timers.filter((timer) => timer.ms === 30_000).length, 0);
});

test('a second overlapped reply falls back to the 30 s retry', async () => {
  const env = load();
  env.queueOutcomes('superseded', 'superseded');
  assert.equal(await env.api.revalidateTransactions(), 'superseded');
  assert.equal(env.calls.validated.length, 2, 'only one immediate retry');
  assert.deepEqual(env.calls.timers.map((timer) => timer.ms), [30_000]);
});

test('a changed list refreshes accounts and, for one account, its balance history', async () => {
  const env = load({ selectedAccountMode: 'single', selectedAccountId: 'acct-1' });
  env.queueOutcomes('updated');
  await env.api.revalidateTransactions();
  assert.equal(env.calls.accounts, 1);
  assert.deepEqual(env.calls.history, ['acct-1']);
  assert.equal(env.calls.renders, 1, 'redrawn so the ledger column has the new balances');
  assert.equal(env.calls.statuses.length, 1);

  const all = load();
  all.queueOutcomes('updated');
  await all.api.revalidateTransactions();
  assert.equal(all.calls.accounts, 1);
  assert.deepEqual(all.calls.history, []);
});

test('the balance redraw waits if the user starts editing during the account refresh', async () => {
  const env = load();
  env.sandbox.loadAccounts = async () => {
    env.page.doc.activeElement = env.page.element('INPUT', { type: 'text' });
  };
  env.queueOutcomes('updated');
  await env.api.revalidateTransactions();
  assert.equal(env.calls.renders, 0);
});

test('an unchanged list is silent', async () => {
  const env = load();
  await env.api.revalidateTransactions();
  assert.deepEqual(env.calls.statuses, []);
  assert.equal(env.calls.accounts, 0);
});

test('startTransactionRevalidation wires visibility, input, and the five-minute timer once', async () => {
  const env = load();
  env.api.startTransactionRevalidation();
  env.api.startTransactionRevalidation();
  const names = env.page.listeners.map((listener) => listener.name);
  assert.deepEqual(names, ['visibilitychange', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']);
  assert.equal(env.calls.intervals.length, 1);
  assert.equal(env.calls.intervals[0].ms, 5 * 60 * 1000);

  // The initial load counts as a check, so an immediate tab flip is throttled.
  await env.page.listeners[0].handler();
  assert.equal(env.calls.validated.length, 0);
});

test('idle: no input for the idle period stops the timer and the retry', async () => {
  const { api } = load();
  assert.equal(api.isUserIdle(100_000, 0), false, 'unknown input never counts as idle');
  assert.equal(api.isUserIdle(100_000, 90_000, 30_000), false);
  assert.equal(api.isUserIdle(120_000, 90_000, 30_000), true);
  assert.equal(api.revalidationGate({ ...READY, lastInputAt: READY.now - TRANSACTION_REVALIDATE_IDLE_AFTER_MS }), 'idle');
  assert.equal(api.revalidationGate({ ...READY, lastInputAt: READY.now - 1000 }), 'run');
  assert.equal(api.revalidationGate({ ...READY, lastInputAt: READY.now - TRANSACTION_REVALIDATE_IDLE_AFTER_MS, editing: true }), 'idle',
    'an abandoned editor does not keep a 30 s retry loop going');
});

test('idle: a tab left alone stops asking; the first touch asks once and the timer resumes', async () => {
  const env = load();
  let now = 1_000_000;
  env.sandbox.Date = class extends Date { static now() { return now; } };
  env.api.startTransactionRevalidation();
  // The interval handler does not return the check's promise, so settle it.
  const tick = async () => {
    env.calls.intervals[0].handler();
    await new Promise((resolve) => setImmediate(resolve));
  };

  // Nothing is touched for a day. The timer asks at 5, 10, 15, 20 and 25
  // minutes after the load, then the tab is idle and asks no more.
  for (let i = 0; i < 288; i += 1) {
    now += 5 * 60 * 1000;
    await tick();
  }
  assert.equal(env.calls.validated.length, 5, 'an idle tab makes no checks');
  assert.deepEqual(env.calls.timers, [], 'and schedules no retries');
  // The status bar said so once, on the first tick that found the tab idle.
  assert.equal(env.calls.statuses.length, 1);
  assert.equal(env.calls.statuses[0].type, 'info');
  assert.match(env.calls.statuses[0].message, /^Idle since .*out of date/);

  // The user comes back: one check right away, and the timer is live again.
  env.api.noteUserInput();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.calls.validated.length, 6);
  assert.deepEqual(env.calls.statuses.slice(1).map((status) => status.type), ['info', 'success']);
  assert.equal(env.calls.statuses[2].message, 'Transactions are up to date');
  now += 5 * 60 * 1000;
  await tick();
  assert.equal(env.calls.validated.length, 7);

  // Ordinary input inside the idle period does not ask on its own.
  now += 1000;
  env.api.noteUserInput();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.calls.validated.length, 7);
});

test('idle: switching to the tab counts as input and reports like a click', async () => {
  const env = load();
  let now = 1_000_000;
  env.sandbox.Date = class extends Date { static now() { return now; } };
  env.api.startTransactionRevalidation();
  now += TRANSACTION_REVALIDATE_IDLE_AFTER_MS + 60_000;
  env.page.doc.visibilityState = 'visible';
  env.queueOutcomes('updated');
  await env.page.listeners[0].handler();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.calls.validated.length, 1);
  // "Checking..." then the updated announcement; nothing else over it.
  assert.deepEqual(env.calls.statuses.map((status) => status.message),
    ['Checking for changes since you were away...', 'Transactions updated from the server']);
});

test('idle: the status after the return check matches its outcome', () => {
  const { api } = load();
  assert.equal(api.returnStatusForOutcome('unchanged').type, 'success');
  assert.equal(api.returnStatusForOutcome('updated'), null, 'an updated list announces itself');
  assert.equal(api.returnStatusForOutcome('failed').type, 'warning');
  assert.equal(api.returnStatusForOutcome('aborted').type, 'warning');
  assert.equal(api.returnStatusForOutcome('skipped').type, 'info');
  assert.equal(api.returnStatusForOutcome('deferred').type, 'info');
  assert.match(api.idleStatusMessage(Date.UTC(2026, 0, 1, 12, 0)), /^Idle since \d.*checked when you come back\.$/);
});

test('refused writes: 4xx other than 401 and 429 on a transaction write count', () => {
  const { api } = load();
  const put = (status) => api.isRefusedTransactionWrite('PUT', 'http://api.test/api/transactions/txn_1', status);
  assert.equal(put(400), true);
  assert.equal(put(404), true);
  assert.equal(put(409), true);
  assert.equal(put(401), false);
  assert.equal(put(429), false);
  assert.equal(put(500), false);
  assert.equal(put(200), false);
});

test('refused writes: reads and non-row writes do not count', () => {
  const { api } = load();
  const base = 'http://api.test';
  assert.equal(api.isRefusedTransactionWrite('GET', `${base}/api/transactions`, 400), false);
  assert.equal(api.isRefusedTransactionWrite('POST', `${base}/api/transactions/sync_transactions`, 400), false);
  assert.equal(api.isRefusedTransactionWrite('POST', `${base}/api/transactions/import/analyze`, 400), false);
  assert.equal(api.isRefusedTransactionWrite('PUT', `${base}/api/user/preferences`, 400), false);
  assert.equal(api.isRefusedTransactionWrite('POST', `${base}/api/categorization/transactions/t1/categorize`, 400), true);
  assert.equal(api.isRefusedTransactionWrite('POST', `${base}/api/transactions/split/t1?x=1`, 422), true);
  assert.equal(api.isRefusedTransactionWrite('DELETE', `${base}/api/bills/b1`, 400), true);
});

test('the write counter moves on a row write sent and on its success, not on reads or refusals', () => {
  const { api } = load();
  const url = 'http://api.test/api/transactions/txn_1';
  api.noteTransactionWriteStarted('GET', url);
  api.noteTransactionWriteResponse('GET', url, 200);
  api.noteTransactionWriteStarted('POST', 'http://api.test/api/transactions/sync_transactions');
  assert.equal(api.transactionRowWriteCount(), 0);
  api.noteTransactionWriteStarted('PUT', url);
  assert.equal(api.transactionRowWriteCount(), 1);
  api.noteTransactionWriteResponse('PUT', url, 200);
  assert.equal(api.transactionRowWriteCount(), 2);
  api.noteTransactionWriteResponse('PUT', url, 400);
  assert.equal(api.transactionRowWriteCount(), 2);
});

test('a refused write queues one quiet guarded check, even for a burst', async () => {
  const env = load();
  const url = 'http://api.test/api/transactions/txn_1';
  env.api.noteTransactionWriteResponse('PUT', url, 400);
  env.api.noteTransactionWriteResponse('PUT', url, 400);
  env.api.noteTransactionWriteResponse('PUT', url, 500);
  assert.equal(env.calls.validated.length, 0, 'the caller shows its message first');
  // Each refusal replaced the pending timer; the last one is the one that runs.
  const last = env.calls.timers[env.calls.timers.length - 1];
  env.calls.timers = [];
  await last.handler();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.calls.validated.length, 1);
  assert.equal(env.calls.validated[0].guardUser, true);
  assert.equal(last.ms, env.api.REFUSED_WRITE_REFETCH_DELAY_MS);
});

test('a refused write with a changed list redraws quietly', async () => {
  const env = load();
  env.queueOutcomes('updated');
  assert.equal(await env.api.revalidateAfterRefusedWrite(), 'updated');
  assert.deepEqual(env.calls.statuses, [], 'the caller\'s error message stays');
  assert.equal(env.calls.accounts, 1);
});

test('a refused write while the editor is still open leaves it alone and retries later', async () => {
  const env = load();
  const input = env.page.element('INPUT', { type: 'text' });
  env.sandbox._activeInlineEditor = { input };
  env.page.doc.activeElement = input;
  assert.equal(await env.api.revalidateAfterRefusedWrite(), 'deferred');
  assert.equal(env.calls.validated.length, 0);
  assert.equal(env.calls.renders, 0);
  assert.deepEqual(env.calls.timers.map((timer) => timer.ms), [30_000]);
});

test('a refused write ignores the throttle and visibility but not a load in flight', async () => {
  const env = load();
  env.api.startTransactionRevalidation();
  env.page.doc.visibilityState = 'hidden';
  assert.equal(await env.api.revalidateAfterRefusedWrite(), 'unchanged');
  assert.equal(env.calls.validated.length, 1);

  const busy = load({ _transactionLoadsInFlight: 1 });
  assert.equal(await busy.api.revalidateAfterRefusedWrite(), 'skipped');
  assert.equal(busy.calls.validated.length, 0);
});

test('a successful write or a server error queues nothing', () => {
  const env = load();
  env.api.noteTransactionWriteResponse('PUT', 'http://api.test/api/transactions/txn_1', 200);
  env.api.noteTransactionWriteResponse('PUT', 'http://api.test/api/transactions/txn_1', 503);
  assert.equal(env.calls.timers.length, 0);
});
