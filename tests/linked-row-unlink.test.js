const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const stubs = `
  function escapeHtml(str) { return String(str || '').replace(/'/g, '&#39;'); }
  function isTransferCategory(str) { return /^\\[.*\\]$/.test((str || '').trim()); }
`;
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${stubs}\n${read('transactions/transaction-types.js')}\n${read('transactions/row-renderers.js')}\n`
    + 'module.exports = { renderRowByType, TXN_TYPE };',
  sandbox,
  { filename: 'row-renderers.js' },
);
const { renderRowByType, TXN_TYPE } = sandbox.module.exports;

function renderCategory(rowType, txnExtra, ctxExtra = {}) {
  const txn = { transaction_id: 't1', account_id: 'a1', ...txnExtra };
  return renderRowByType({
    txn,
    txnId: 't1',
    accountId: 'a1',
    currentFullCategory: txn.transfer_pair_id ? '[Savings]' : 'Food',
    isBill: false,
    isTransfer: !!txn.transfer_pair_id,
    isPendingRow: false,
    rowType,
    ...ctxExtra,
  }).categoryCell;
}

const ROW_TYPES_THAT_WIN_OVER_TRANSFER = [
  ['scheduled future', 'MANUAL_FUTURE', {}],
  ['materialized bill', 'MANUAL_FUTURE', { isBill: true }],
  ['missing bill', 'BILL_MISSING', {}],
  ['missing manual', 'MANUAL_MISSING', {}],
  ['converted', 'PLAID_CONVERTED', {}],
  ['matched', 'MANUAL_MATCH', {}],
];

for (const [label, typeKey, ctxExtra] of ROW_TYPES_THAT_WIN_OVER_TRANSFER) {
  test(`${label} row offers Unlink only when linked`, () => {
    const linked = renderCategory(TXN_TYPE[typeKey], { transfer_pair_id: 'p1' }, ctxExtra);
    const unlinked = renderCategory(TXN_TYPE[typeKey], {}, ctxExtra);
    assert.match(linked, /unlinkTransfer\('t1'\)/);
    assert.doesNotMatch(unlinked, /unlinkTransfer/);
  });
}

test('plain cleared transfer row still offers Unlink', () => {
  const html = renderCategory(TXN_TYPE.PLAID_CLEARED, { transfer_pair_id: 'p1' });
  assert.equal((html.match(/unlinkTransfer/g) || []).length, 1);
});
