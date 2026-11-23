const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Loads source files into one sandbox (in order) and returns the exports.
function load(relPaths, exportsList, sandboxGlobals = {}) {
  const source = relPaths
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...sandboxGlobals };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return sandbox.module.exports;
}

const PAGE_FILES = ['transactions/transaction-types.js', 'transactions/resolution.js', 'transactions/inline-edit.js'];
const EXPORTS = [
  'enterMatchToTransactionPickMode', 'enterForceMatchPickMode', 'exitPickMode', 'isPickModeActive',
  '_matchToTransactionRowClickHandler', '_forceMatchRowClickHandler', '_pickModeEscapeHandler',
  '_handleInlineClick',
].join(', ');

const SOURCE_ID = 'manual-1';
const REFUSAL = 'This bank transaction is already matched to the bill "Rent" (Nov 18). Reset it to Plaid first, then match again.';

const bankRow = (id, extra = {}) => ({
  transaction_id: id, source: 'plaid', status: 'cleared', account_id: 'acct-1',
  description: id, amount: -30.68, date: '2026-11-06', ...extra,
});

const ROWS = [
  {
    transaction_id: SOURCE_ID, source: 'manual', status: 'cleared', account_id: 'acct-1',
    description: 'Shine Shop car wash', amount: -21.19, date: '2026-12-12',
  },
  bankRow('Budget Car Rental'),
  bankRow('hidden', { status: 'pending', is_hidden: true }),
  bankRow('other-account', { account_id: 'acct-2' }),
  bankRow('matched', { match_info: { matched_txn_id: 'x' } }),
  bankRow('waiting', { matched_transaction_id: 'x' }),
  bankRow('split', { is_split: true, splits: [{}, {}] }),
  { ...bankRow('other-manual'), source: 'manual' },
  { transaction_id: 'orphan-1', source: 'manual', status: 'orphaned', account_id: 'acct-1', description: 'Gym', amount: -40, date: '2026-11-01' },
];

/**
 * resolution.js and inline-edit.js on a stubbed page. `apiResponse` is what
 * the match request gets back; `confirmAnswer` is what the user answers.
 */
function buildPage({ apiResponse = { ok: true, status: 200, json: async () => ({ account_id: 'acct-1' }) }, confirmAnswer = true } = {}) {
  const tableListeners = [];
  const documentListeners = [];
  const container = {
    parentNode: { insertBefore(banner) { page.banner = banner; } },
    addEventListener(type, handler, options) { tableListeners.push({ action: 'add', type, handler, options }); },
    removeEventListener(type, handler, options) { tableListeners.push({ action: 'remove', type, handler, options }); },
  };
  const document = {
    getElementById: (id) => {
      if (id === 'table-container') return container;
      if (id === 'force-match-pick-banner') return page.banner;
      return null;
    },
    createElement: () => ({
      innerHTML: '',
      remove() { page.banner = null; page.bannersRemoved += 1; },
    }),
    body: { prepend() {} },
    addEventListener(type, handler) { documentListeners.push({ action: 'add', type, handler }); },
    removeEventListener(type, handler) { documentListeners.push({ action: 'remove', type, handler }); },
  };
  const page = {
    banner: null, bannersRemoved: 0, tableListeners, documentListeners,
    requests: [], statuses: [], confirms: [], calls: [],
  };
  page.api = load(PAGE_FILES, EXPORTS, {
    document,
    BACKEND_URL: 'http://api.test',
    transactions: ROWS,
    closeModal() { page.calls.push('closeModal'); },
    showStatus: (message, kind) => page.statuses.push({ message, kind }),
    escapeHtml: value => String(value),
    _formatCurrency: value => `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`,
    confirm: (message) => { page.confirms.push(message); return confirmAnswer; },
    authenticatedFetch: async (url, options) => { page.requests.push({ url, options }); return apiResponse; },
    fallbackAccountIdsForRow: () => ['acct-1'],
    applyRowChangesFromResponse: async (...args) => { page.calls.push(['applyRowChangesFromResponse', ...args]); },
    renderTransactionTable: () => page.calls.push('renderTransactionTable'),
    renderAccountsSidebar: () => page.calls.push('renderAccountsSidebar'),
    fetchBalanceHistory: (accountId) => page.calls.push(['fetchBalanceHistory', accountId]),
  });
  return page;
}

function clickOn(txnId) {
  const calls = { prevented: 0, stopped: 0 };
  const event = {
    target: { tagName: 'span', closest: selector => (selector === 'tr' ? { dataset: { txnId } } : null) },
    preventDefault() { calls.prevented += 1; },
    stopPropagation() { calls.stopped += 1; },
  };
  return { event, calls };
}

test('entering the mode closes the modal, shows the banner and listens in the capture phase', () => {
  const page = buildPage();
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);

  assert.equal(page.api.isPickModeActive(), true);
  assert.deepEqual(page.calls, ['closeModal']);
  assert.match(page.banner.innerHTML, /Click the bank transaction that "Shine Shop car wash" \(-\$21\.19, 2026-12-12\) belongs to\./);
  assert.match(page.banner.innerHTML, /Cancel/);
  assert.equal(page.banner.className, 'force-match-pick-banner');
  assert.equal(page.tableListeners[0].action, 'add');
  assert.equal(page.tableListeners[0].type, 'click');
  assert.equal(page.tableListeners[0].options.capture, true);
  assert.equal(page.documentListeners[0].type, 'keydown');
});

test('leaving the mode removes the banner and both listeners', () => {
  const page = buildPage();
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);
  page.api.exitPickMode();

  assert.equal(page.api.isPickModeActive(), false);
  assert.equal(page.banner, null);
  const removedTable = page.tableListeners.find(listener => listener.action === 'remove');
  assert.equal(removedTable.options.capture, true);
  assert.equal(removedTable.handler, page.tableListeners[0].handler);
  assert.equal(page.documentListeners.at(-1).action, 'remove');
});

test('a missing source row shows an error and does not enter the mode', () => {
  const page = buildPage();
  page.api.enterMatchToTransactionPickMode('not-there');
  assert.equal(page.api.isPickModeActive(), false);
  assert.deepEqual(page.statuses.at(-1), { message: 'Transaction not found', kind: 'error' });
});

test('accepting the confirm names both rows, sends the match and leaves the mode', async () => {
  const page = buildPage();
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);

  const { event, calls } = clickOn('Budget Car Rental');
  await page.api._matchToTransactionRowClickHandler(event);

  assert.equal(calls.stopped, 1);
  assert.equal(calls.prevented, 1);
  assert.deepEqual(page.confirms, [
    'Match "Shine Shop car wash" (-$21.19, 2026-12-12) to "Budget Car Rental" (-$30.68, 2026-11-06)?',
  ]);
  assert.equal(page.api.isPickModeActive(), false);
  assert.match(page.requests[0].url, /\/api\/transactions\/resolution\/match$/);
  assert.deepEqual(JSON.parse(page.requests[0].options.body), {
    manual_transaction_id: SOURCE_ID,
    target_transaction_id: 'Budget Car Rental',
  });
  const applied = page.calls.find(call => Array.isArray(call) && call[0] === 'applyRowChangesFromResponse');
  assert.deepEqual(JSON.parse(JSON.stringify(applied.slice(1))), [{ account_id: 'acct-1' }, ['acct-1'], { siteSettlesLedger: true }]);
  assert.ok(page.calls.includes('renderTransactionTable'));
  assert.ok(page.calls.includes('renderAccountsSidebar'));
  assert.deepEqual(page.calls.at(-1), ['fetchBalanceHistory', 'acct-1']);
  assert.deepEqual(page.statuses.at(-1), { message: 'Transactions matched successfully', kind: 'success' });
});

test('a match that leaves split amounts off warns to repair them', async () => {
  const page = buildPage({ apiResponse: { ok: true, json: async () => ({ account_id: 'acct-1', splits_need_repair: true }) } });
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);
  await page.api._matchToTransactionRowClickHandler(clickOn('Budget Car Rental').event);
  assert.equal(page.statuses.at(-1).kind, 'warning');
  assert.match(page.statuses.at(-1).message, /split amounts no longer add up/);
});

test('declining the confirm sends nothing and stays in the mode', async () => {
  const page = buildPage({ confirmAnswer: false });
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);

  await page.api._matchToTransactionRowClickHandler(clickOn('Budget Car Rental').event);

  assert.equal(page.confirms.length, 1);
  assert.equal(page.requests.length, 0);
  assert.equal(page.api.isPickModeActive(), true);
});

const REFUSED_CLICKS = [
  ['the row itself', SOURCE_ID, 'Cannot match a transaction to itself'],
  ['a row in another account', 'other-account', 'That transaction is in another account. Click one in the same account'],
  ['a row that is already matched', 'matched', 'That transaction is already matched or has a match waiting'],
  ['a row with a match waiting', 'waiting', 'That transaction is already matched or has a match waiting'],
  // A piece's row carries its parent's id, so a click on a piece lands here too.
  ['a split row', 'split', 'That transaction is split. Clear its splits first, then match to it'],
  ['a hidden pending row', 'hidden', 'That pending transaction is hidden. Unhide it first, then match to it'],
  ['a hand-entered row', 'other-manual', 'Please click a bank transaction to match to'],
  ['a row the page does not hold', 'unknown-row', 'Please click a bank transaction to match to'],
];

for (const [label, clickedId, sentence] of REFUSED_CLICKS) {
  test(`a click on ${label} is swallowed with its reason and sends nothing`, async () => {
    const page = buildPage();
    page.api.enterMatchToTransactionPickMode(SOURCE_ID);

    const { event, calls } = clickOn(clickedId);
    await page.api._matchToTransactionRowClickHandler(event);

    assert.equal(calls.stopped, 1);
    assert.equal(calls.prevented, 1);
    assert.deepEqual(page.statuses.at(-1), { message: sentence, kind: 'warning' });
    assert.equal(page.confirms.length, 0);
    assert.equal(page.requests.length, 0);
    assert.equal(page.api.isPickModeActive(), true);
  });
}

test('an API refusal shows the API sentence on the status bar, with the mode already off', async () => {
  const page = buildPage({ apiResponse: { ok: false, status: 400, json: async () => ({ error: REFUSAL }) } });
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);

  await page.api._matchToTransactionRowClickHandler(clickOn('Budget Car Rental').event);

  assert.deepEqual(page.statuses.at(-1), { message: `Match failed: ${REFUSAL}`, kind: 'error' });
  assert.equal(page.api.isPickModeActive(), false);
});

test('Escape ends the mode with an info status; other keys do not', () => {
  const page = buildPage();
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);

  page.api._pickModeEscapeHandler({ key: 'a' });
  assert.equal(page.api.isPickModeActive(), true);

  page.api._pickModeEscapeHandler({ key: 'Escape' });
  assert.equal(page.api.isPickModeActive(), false);
  assert.deepEqual(page.statuses.at(-1), { message: 'Match canceled', kind: 'info' });
});

test('Cancel on the banner ends the mode', () => {
  const page = buildPage();
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);
  assert.match(page.banner.innerHTML, /onclick="exitPickMode\(\)"/);
  page.api.exitPickMode();
  assert.equal(page.api.isPickModeActive(), false);
});

test('inline editing steps aside in this mode', () => {
  const page = buildPage();
  let cellLookups = 0;
  const event = { target: { tagName: 'span', closest: () => { cellLookups += 1; return null; } } };

  page.api.enterMatchToTransactionPickMode(SOURCE_ID);
  page.api._handleInlineClick(event);
  assert.equal(cellLookups, 0);

  page.api.exitPickMode();
  page.api._handleInlineClick(event);
  assert.equal(cellLookups, 1);
});

test('starting a force match ends Match to Transaction, and the reverse', async () => {
  const page = buildPage();
  page.api.enterMatchToTransactionPickMode(SOURCE_ID);
  page.api.enterForceMatchPickMode('orphan-1');

  assert.match(page.banner.innerHTML, /Force Match Mode/);
  assert.equal(page.tableListeners.filter(l => l.action === 'remove').length, 1);
  // The old match handler is inert: a click on a bank row does not ask a confirm.
  await page.api._matchToTransactionRowClickHandler(clickOn('Budget Car Rental').event);
  assert.equal(page.confirms.length, 0);

  page.api.enterMatchToTransactionPickMode(SOURCE_ID);
  assert.match(page.banner.innerHTML, /Match to Transaction/);
  assert.equal(page.tableListeners.filter(l => l.action === 'remove').length, 2);
  await page.api._forceMatchRowClickHandler(clickOn('Budget Car Rental').event);
  assert.equal(page.requests.length, 0);

  // Escape reports the mode that is on, not the one that was replaced.
  page.api._pickModeEscapeHandler({ key: 'Escape' });
  assert.equal(page.statuses.at(-1).message, 'Match canceled');
});
