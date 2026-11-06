const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads source files into one sandbox (in order) and returns the sandbox.
function load(relPaths, exportsList, sandboxGlobals = {}) {
  const source = relPaths
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...sandboxGlobals };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return { api: sandbox.module.exports, sandbox };
}

/**
 * A table container that records how the pick handler was attached, a
 * document that is enough for the banner, and a fetch stub that records
 * the force-match request.
 */
function buildPage() {
  const listeners = [];
  const container = {
    parentNode: { insertBefore() {} },
    addEventListener(type, handler, options) { listeners.push({ action: 'add', type, handler, options }); },
    removeEventListener(type, handler, options) { listeners.push({ action: 'remove', type, handler, options }); },
  };
  const fakeElement = () => ({ innerHTML: '', className: '', id: '', remove() {} });
  const document = {
    getElementById: (id) => (id === 'table-container' ? container : null),
    createElement: fakeElement,
    body: { prepend() {} },
    addEventListener() {},
    removeEventListener() {},
  };
  const requests = [];
  const statuses = [];
  const globals = {
    document,
    BACKEND_URL: 'http://api.test',
    transactions: [
      { transaction_id: 'orphan_1', source: 'manual', status: 'orphaned', description: 'Gym', amount: -40 },
      { transaction_id: 'plaid_1', source: 'plaid', status: 'cleared', description: 'GYM CO', amount: -40 },
    ],
    closeModal() {},
    showStatus: (message, kind) => statuses.push({ message, kind }),
    escapeHtml: (value) => String(value),
    _formatCurrency: (value) => String(value),
    authenticatedFetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
    _invalidateTransactionCache() {},
    fetchAllTransactions: async () => {},
    checkAndRenderReconciliationBanner: async () => {},
  };
  return { listeners, requests, statuses, globals };
}

function clickOn(rowDataset, cellTag = 'span') {
  const row = { dataset: rowDataset };
  const calls = { prevented: 0, stopped: 0 };
  const event = {
    target: {
      tagName: cellTag,
      closest: (selector) => (selector === 'tr' ? row : null),
    },
    preventDefault() { calls.prevented += 1; },
    stopPropagation() { calls.stopped += 1; },
  };
  return { event, calls };
}

test('pick mode listens in the capture phase and removes the same way', () => {
  const page = buildPage();
  const { api } = load(
    ['transactions/transaction-types.js', 'transactions/resolution.js'],
    'enterForceMatchPickMode, exitForceMatchPickMode, isForceMatchPickModeActive',
    page.globals,
  );

  api.enterForceMatchPickMode('orphan_1');
  assert.equal(api.isForceMatchPickModeActive(), true);
  assert.equal(page.listeners[0].action, 'add');
  assert.equal(page.listeners[0].options.capture, true);

  api.exitForceMatchPickMode();
  assert.equal(api.isForceMatchPickModeActive(), false);
  assert.equal(page.listeners[1].action, 'remove');
  assert.equal(page.listeners[1].options.capture, true);
});

test('a click on a Plaid row picks it and never reaches the inline editors', async () => {
  const page = buildPage();
  const { api } = load(
    ['transactions/transaction-types.js', 'transactions/resolution.js'],
    'enterForceMatchPickMode, _forceMatchRowClickHandler',
    page.globals,
  );
  api.enterForceMatchPickMode('orphan_1');

  const { event, calls } = clickOn({ txnId: 'plaid_1', source: 'plaid', status: 'cleared' });
  await api._forceMatchRowClickHandler(event);

  assert.equal(calls.stopped, 1);
  assert.equal(calls.prevented, 1);
  assert.equal(page.requests.length, 1);
  assert.match(page.requests[0].url, /force_match$/);
  assert.deepEqual(JSON.parse(page.requests[0].options.body), {
    orphan_transaction_id: 'orphan_1',
    target_plaid_transaction_id: 'plaid_1',
  });
});

test('a click on a non-Plaid row is swallowed with a warning, not edited', async () => {
  const page = buildPage();
  const { api } = load(
    ['transactions/transaction-types.js', 'transactions/resolution.js'],
    'enterForceMatchPickMode, _forceMatchRowClickHandler, isForceMatchPickModeActive',
    page.globals,
  );
  api.enterForceMatchPickMode('orphan_1');

  const { event, calls } = clickOn({ txnId: 'orphan_1', source: 'manual', status: 'orphaned' });
  await api._forceMatchRowClickHandler(event);

  assert.equal(calls.stopped, 1);
  assert.equal(page.requests.length, 0);
  assert.equal(page.statuses.at(-1).kind, 'warning');
  assert.equal(api.isForceMatchPickModeActive(), true);
});

test('inline editing steps aside while pick mode is active', () => {
  const page = buildPage();
  let cellLookups = 0;
  const { api } = load(
    ['transactions/transaction-types.js', 'transactions/resolution.js', 'transactions/inline-edit.js'],
    'enterForceMatchPickMode, exitForceMatchPickMode, _handleInlineClick',
    page.globals,
  );
  const event = {
    target: {
      tagName: 'span',
      closest: () => { cellLookups += 1; return null; },
    },
  };

  api.enterForceMatchPickMode('orphan_1');
  api._handleInlineClick(event);
  assert.equal(cellLookups, 0);

  api.exitForceMatchPickMode();
  api._handleInlineClick(event);
  assert.equal(cellLookups, 1);
});
