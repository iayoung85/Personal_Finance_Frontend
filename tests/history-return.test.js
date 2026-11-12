const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'shared', 'history-return.js');
const scriptSource = fs.readFileSync(scriptPath, 'utf8');

function mapStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

/**
 * Load the script against a fake window.
 * @param {{navigationType?: string, storage?: object}} options
 */
function loadScript({ navigationType, storage } = {}) {
  const listeners = {};
  const fetchCalls = [];
  const reloads = [];
  const fakeWindow = {
    addEventListener: (name, listener) => { listeners[name] = listener; },
    performance: {
      getEntriesByType: () => (navigationType ? [{ type: navigationType }] : []),
    },
    sessionStorage: storage || mapStorage(),
    location: { reload: () => reloads.push(true) },
    fetch: (input, init) => { fetchCalls.push({ input, init }); return Promise.resolve(); },
  };
  const sandbox = { window: fakeWindow };
  vm.runInNewContext(scriptSource, sandbox, { filename: scriptPath });
  return { sandbox, fakeWindow, listeners, fetchCalls, reloads };
}

test('only a back_forward navigation counts as a history return', () => {
  const { sandbox } = loadScript();
  assert.equal(sandbox.isHistoryReturnNavigation('back_forward'), true);
  assert.equal(sandbox.isHistoryReturnNavigation('navigate'), false);
  assert.equal(sandbox.isHistoryReturnNavigation('reload'), false);
  assert.equal(sandbox.isHistoryReturnNavigation(undefined), false);
});

test('a page restored from the back/forward cache reloads, a fresh load does not', () => {
  const { sandbox, listeners, reloads } = loadScript({ navigationType: 'navigate' });
  assert.equal(sandbox.shouldReloadOnPageShow({ persisted: true }), true);
  assert.equal(sandbox.shouldReloadOnPageShow({ persisted: false }), false);
  assert.equal(sandbox.shouldReloadOnPageShow(null), false);

  listeners.pageshow({ persisted: false });
  assert.equal(reloads.length, 0);
  listeners.pageshow({ persisted: true });
  assert.equal(reloads.length, 1);
});

test('the reload after a cache restore is itself treated as a history return, once', () => {
  const storage = mapStorage();
  const first = loadScript({ navigationType: 'navigate', storage });
  first.listeners.pageshow({ persisted: true });

  const afterReload = loadScript({ navigationType: 'reload', storage });
  afterReload.fakeWindow.fetch('https://api.example.test/api/bills', {});
  assert.equal(afterReload.fetchCalls[0].init.cache, 'no-cache');

  const laterLoad = loadScript({ navigationType: 'navigate', storage });
  laterLoad.fakeWindow.fetch('https://api.example.test/api/bills', {});
  assert.equal(laterLoad.fetchCalls[0].init.cache, undefined);
});

test('an ordinary first load leaves fetch alone', () => {
  const { fakeWindow, fetchCalls } = loadScript({ navigationType: 'navigate' });
  fakeWindow.fetch('https://api.example.test/api/bills', { headers: { A: 'b' } });
  assert.equal(fetchCalls[0].init.cache, undefined);
});

test('a history navigation makes the page revalidate its GETs with the server', () => {
  const { fakeWindow, fetchCalls } = loadScript({ navigationType: 'back_forward' });
  fakeWindow.fetch('https://api.example.test/api/bills');
  fakeWindow.fetch('https://api.example.test/api/accounts', { headers: { Authorization: 'x' } });
  assert.equal(fetchCalls[0].init.cache, 'no-cache');
  assert.equal(fetchCalls[1].init.cache, 'no-cache');
  assert.equal(fetchCalls[1].init.headers.Authorization, 'x');
});

test('a request with its own validator or cache mode is passed through unchanged', () => {
  const { sandbox } = loadScript();
  const conditional = { headers: { 'If-None-Match': '"abc"' } };
  assert.equal(sandbox.historyReturnFetchInit(conditional), conditional);

  const modified = { headers: [['if-modified-since', 'Mon, 01 Jan 2024 00:00:00 GMT']] };
  assert.equal(sandbox.historyReturnFetchInit(modified), modified);

  const explicit = { cache: 'no-store' };
  assert.equal(sandbox.historyReturnFetchInit(explicit), explicit);
});

test('page load with no navigation entry and no storage does not throw', () => {
  const throwingStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  const { listeners, reloads } = loadScript({ storage: throwingStorage });
  listeners.pageshow({ persisted: true });
  assert.equal(reloads.length, 1);
});
