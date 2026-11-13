const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
// Objects built inside a vm sandbox come from another realm; copy them first.
const plain = value => JSON.parse(JSON.stringify(value));

// ── Types, badge and menu ──────────────────────────────────────

const stubs = `
  function escapeHtml(str) { return String(str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function isTransferCategory(str) { return /^\\[.*\\]$/.test((str || '').trim()); }
  function _fmtCurrency(value, code) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code || 'USD' }).format(value);
  }
  const accounts = [];
`;
const typesSandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${stubs}\n${read('transactions/transaction-types.js')}\n${read('transactions/row-renderers.js')}\n${read('transactions/context-menu.js')}\n`
    + 'module.exports = { TXN_TYPE, getInlineEditableFields, getRowEditAffordances, renderRowByType, _buildMenuItems };',
  typesSandbox,
  { filename: 'pending-expected-amount.test.js' },
);
const {
  TXN_TYPE, getInlineEditableFields, getRowEditAffordances, renderRowByType, _buildMenuItems,
} = typesSandbox.module.exports;

const PENDING_ROW = { transaction_id: 't1', source: 'plaid', status: 'pending', pending: true, amount: -57.5 };

test('a pending bank row inline-edits its amount and nothing else', () => {
  assert.deepEqual(plain(getInlineEditableFields(TXN_TYPE.PLAID_PENDING)), ['amount']);
  const affordances = getRowEditAffordances(PENDING_ROW, TXN_TYPE.PLAID_PENDING);
  assert.equal(affordances.amount, true);
  assert.equal(affordances.date, false);
  // The name goes through the override editor, which stays on.
  assert.equal(affordances.description, true);
});

test('what posted, converted and manual rows inline-edit is unchanged', () => {
  assert.deepEqual(plain(getInlineEditableFields(TXN_TYPE.PLAID_CLEARED)), ['date', 'amount']);
  assert.deepEqual(plain(getInlineEditableFields(TXN_TYPE.PLAID_CONVERTED)), ['date', 'description', 'amount']);
  assert.deepEqual(plain(getInlineEditableFields(TXN_TYPE.MANUAL_CLEARED)), ['date', 'description', 'amount']);
});

test('a pending row on a waiting match offers no amount edit', () => {
  const waiting = { ...PENDING_ROW, match_info: { matched_txn_id: 'm1' } };
  const affordances = getRowEditAffordances(waiting, TXN_TYPE.PLAID_PENDING);
  assert.equal(affordances.amount, false);
  assert.equal(affordances.description, false);
});

function badgeFor(rowType, txnExtra, ctxExtra = {}) {
  const txn = { account_id: 'a1', ...PENDING_ROW, ...txnExtra };
  return renderRowByType({
    txn, txnId: 't1', accountId: 'a1', currentFullCategory: 'Food', isBill: false,
    isTransfer: !!txn.transfer_pair_id, isPendingRow: true, rowType, ...ctxExtra,
  }).typeBadge;
}

test('a pending row with an expected amount shows the Modified badge', () => {
  const html = badgeFor(TXN_TYPE.PLAID_PENDING, { amount_modified: true, plaid_amount: -50 });
  assert.match(html, /amount-modified/);
  assert.match(html, /✎ Modified/);
});

test('a pending row without an expected amount shows no badge', () => {
  const html = badgeFor(TXN_TYPE.PLAID_PENDING, { amount_modified: false, plaid_amount: null });
  assert.doesNotMatch(html, /amount-modified/);
});

test('a pending transfer half shows the badge too', () => {
  const html = badgeFor(TXN_TYPE.PLAID_PENDING, { amount_modified: true, plaid_amount: -50, transfer_pair_id: 'p1' });
  assert.match(html, /amount-modified/);
});

test('the badge hover names the bank amount, on a pending and a posted row', () => {
  const pending = badgeFor(TXN_TYPE.PLAID_PENDING, { amount_modified: true, plaid_amount: -50 });
  assert.match(pending, /title="Bank shows -\$50\.00 /);
  const posted = badgeFor(
    TXN_TYPE.PLAID_CLEARED,
    { status: 'cleared', pending: false, amount_modified: true, plaid_amount: 12.5 },
    { isPendingRow: false },
  );
  assert.match(posted, /title="Bank shows \$12\.50 /);
});

test('the badge hover falls back when the API sends no bank amount', () => {
  const html = badgeFor(TXN_TYPE.PLAID_PENDING, { amount_modified: true });
  assert.match(html, /title="Amount edited by user/);
  assert.doesNotMatch(html, /Bank shows/);
});

function menuActions(txnExtra) {
  return _buildMenuItems({
    txnId: 't1', source: 'plaid', status: 'pending', pending: true, isBill: false, billId: '',
    accountId: 'a1', amount: -57.5, isSplit: false, isSplitChild: false, name: 'x',
    isHidden: false, amountModified: false, ...txnExtra,
  }).map(item => item.action);
}

test('Reset Plaid Amount is offered on a pending row only when its amount was edited', () => {
  assert.ok(menuActions({ amountModified: true }).includes('reset-plaid-amount'));
  assert.ok(!menuActions({ amountModified: false }).includes('reset-plaid-amount'));
});

test('Reset Plaid Amount is offered on a pending row under a waiting match menu too', () => {
  const actions = _buildMenuItems({
    txnId: 't1', source: 'plaid', status: 'pending', pending: true, isBill: false, billId: '',
    accountId: 'a1', amount: -57.5, isSplit: false, isSplitChild: false, name: 'x',
    isHidden: false, amountModified: true, matchManualTxnId: 'm1',
  }).map(item => item.action);
  assert.ok(actions.includes('reset-plaid-amount'));
});

// ── The save ───────────────────────────────────────────────────

function loadInlineEdit(transactionsList) {
  const calls = [];
  const sandbox = {
    module: { exports: {} },
    console,
    calls,
    transactions: transactionsList,
    BACKEND_URL: 'http://api',
    selectedAccountMode: 'all',
    selectedAccountId: null,
    showStatus() {},
    renderTransactionTable() {},
    fallbackAccountIdsForRow: () => [],
    applyRowChangesFromResponse: async () => null,
    authenticatedFetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({}) };
    },
  };
  vm.runInNewContext(
    `${read('transactions/transaction-types.js')}\n${read('transactions/inline-edit.js')}\n`
      + 'module.exports = { TXN_TYPE, getInlineEditableFields, _buildAmountPayload, _saveRowInlineEdits,'
      + ' setSession(session) { _activeRowEditSession = session; } };',
    sandbox,
    { filename: 'inline-edit.js' },
  );
  return { api: sandbox.module.exports, calls };
}

function sessionFor(api, txnType, original, draft) {
  return {
    txn_id: 't1',
    txn_type: txnType,
    editable_fields: api.getInlineEditableFields(txnType),
    plaid_date_constraint: null,
    row: null,
    original,
    draft,
  };
}

test('saving an expected amount on a pending row sends the amount alone', async () => {
  const { api, calls } = loadInlineEdit([{ transaction_id: 't1' }]);
  api.setSession(sessionFor(
    api,
    api.TXN_TYPE.PLAID_PENDING,
    { date: '2026-11-12', description: 'Cafe', signed_amount: -50 },
    // A draft that differs in every field: only the amount may be sent.
    { date: '2026-11-13', description: 'Other', amount_input: '-57.50' },
  ));
  await api._saveRowInlineEdits();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://api/api/transactions/t1');
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body), { amount: 57.5 });
});

test('typing a pending row\'s own figure without its minus sends nothing', async () => {
  const { api, calls } = loadInlineEdit([{ transaction_id: 't1' }]);
  api.setSession(sessionFor(
    api,
    api.TXN_TYPE.PLAID_PENDING,
    { date: '2026-11-12', description: 'Cafe', signed_amount: -50 },
    { date: '2026-11-12', description: 'Cafe', amount_input: '50.00' },
  ));
  await api._saveRowInlineEdits();
  assert.equal(calls.length, 0);
});

test('a posted bank row still sends its amount with the type', async () => {
  const { api, calls } = loadInlineEdit([{ transaction_id: 't1' }]);
  api.setSession(sessionFor(
    api,
    api.TXN_TYPE.PLAID_CLEARED,
    { date: '2026-11-12', description: 'Cafe', signed_amount: -50 },
    { date: '2026-11-12', description: 'Cafe', amount_input: '-57.50' },
  ));
  await api._saveRowInlineEdits();
  assert.deepEqual(JSON.parse(calls[0].options.body), { amount: 57.5, type: 'debit' });
});

test('a manual row still sends its date, description, amount and type', async () => {
  const { api, calls } = loadInlineEdit([{ transaction_id: 't1' }]);
  api.setSession(sessionFor(
    api,
    api.TXN_TYPE.MANUAL_CLEARED,
    { date: '2026-11-12', description: 'Cafe', signed_amount: -50 },
    { date: '2026-11-13', description: 'Other', amount_input: '60' },
  ));
  await api._saveRowInlineEdits();
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    date: '2026-11-13', description: 'Other', amount: 60, type: 'credit',
  });
});
