const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const stubs = `
  function escapeHtml(str) { return String(str || '').replace(/'/g, '&#39;'); }
  function isTransferCategory(str) { return /^\\[.*\\]$/.test((str || '').trim()); }
  const accounts = [];
`;
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${stubs}\n${read('transactions/transaction-types.js')}\n${read('transactions/row-renderers.js')}\n${read('transactions/context-menu.js')}\n`
    + 'module.exports = { renderRowByType, TXN_TYPE, _buildMenuItems };',
  sandbox,
  { filename: 'paid-bill-row.test.js' },
);
const { renderRowByType, TXN_TYPE, _buildMenuItems } = sandbox.module.exports;

function renderBadge(rowType, txnExtra, ctxExtra = {}) {
  const txn = { transaction_id: 't1', account_id: 'a1', ...txnExtra };
  return renderRowByType({
    txn,
    txnId: 't1',
    accountId: 'a1',
    currentFullCategory: 'Food',
    isBill: false,
    isTransfer: !!txn.transfer_pair_id,
    isPendingRow: false,
    rowType,
    ...ctxExtra,
  }).typeBadge;
}

const LINKED = { bill_id: 'bill_1', bill_scheduled_date: '2026-11-07', is_bill: true, schedule_summary: 'Monthly on the 7th' };

const CLEARED_ROWS = [
  ['approved bank row', TXN_TYPE.PLAID_CLEARED, { source: 'plaid', status: 'cleared' }],
  ['manual payment marked paid', TXN_TYPE.MANUAL_CLEARED, { source: 'manual', status: 'cleared' }],
  ['converted download', TXN_TYPE.PLAID_CONVERTED, { source: 'plaid', status: 'converted' }],
  ['transfer', TXN_TYPE.PLAID_CLEARED, { source: 'plaid', status: 'cleared', transfer_pair_id: 'p1' }],
];

for (const [label, rowType, base] of CLEARED_ROWS) {
  test(`${label} shows the bill badge only when it carries a live bill link`, () => {
    const linked = renderBadge(rowType, { ...base, ...LINKED });
    const plain = renderBadge(rowType, base);
    assert.match(linked, /bill-provenance/);
    assert.match(linked, /scheduled 2026-11-07 — Monthly on the 7th/);
    assert.doesNotMatch(plain, /bill-provenance/);
  });
}

test('a link to a bill that no longer exists gets no badge', () => {
  const html = renderBadge(TXN_TYPE.PLAID_CLEARED, { source: 'plaid', status: 'cleared', bill_id: 'bill_gone', is_bill: false });
  assert.doesNotMatch(html, /bill-provenance/);
});

function menuActions(txnExtra) {
  return _buildMenuItems({
    txnId: 't1', source: 'plaid', status: 'cleared', pending: false, isBill: false, billId: '',
    accountId: 'a1', amount: -10, isSplit: false, isSplitChild: false, name: 'x',
    isHidden: false, amountModified: false, ...txnExtra,
  }).map(item => item.action);
}

test('a cleared row with no bill link still offers This is a Bill', () => {
  assert.ok(menuActions({}).includes('this-is-a-bill'));
  assert.ok(menuActions({ source: 'manual' }).includes('this-is-a-bill'));
});

test('a row that already belongs to a bill does not offer This is a Bill', () => {
  assert.ok(!menuActions({ billId: 'bill_1', isBill: true }).includes('this-is-a-bill'));
  assert.ok(!menuActions({ source: 'manual', billId: 'bill_1', isBill: true }).includes('this-is-a-bill'));
});

const BILL_ROW_KINDS = [
  ['virtual future occurrence', { source: 'scheduled', status: 'future', isBill: true }],
  ['materialized future row', { source: 'manual', status: 'future', isBill: true }],
  ['missing bill row', { source: 'scheduled', status: 'missing', isBill: true }],
  ['matched bill row', { source: 'scheduled', status: 'matched', isBill: true }],
  ['approved bank row', { source: 'plaid', status: 'cleared', isBill: true }],
  ['manual payment marked paid', { source: 'manual', status: 'cleared', isBill: true }],
  ['converted download', { source: 'plaid', status: 'converted', isBill: true }],
];

for (const [label, extra] of BILL_ROW_KINDS) {
  test(`${label} offers Edit Schedule while its bill exists`, () => {
    assert.ok(menuActions({ billId: 'bill_1', ...extra }).includes('edit-schedule'));
  });
}

test('a row whose bill was deleted does not offer Edit Schedule', () => {
  assert.ok(!menuActions({ source: 'manual', status: 'future', billId: 'bill_gone', isBill: false }).includes('edit-schedule'));
  assert.ok(!menuActions({ billId: 'bill_gone', isBill: false }).includes('edit-schedule'));
});

test('a row with no bill link does not offer Edit Schedule', () => {
  assert.ok(!menuActions({}).includes('edit-schedule'));
  assert.ok(!menuActions({ source: 'manual', status: 'future' }).includes('edit-schedule'));
});
