const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

const MIXED_REASON = 'These transactions mix linked transfers with transactions that are not transfers, so none of them can be added to a bill together. Select only transfers, or only transactions that are not transfers.';

// A just-enough element for the modal code: it records what is appended and
// hands back the same child for the same selector.
function fakeElement() {
  const children = new Map();
  const element = {
    className: '',
    innerHTML: '',
    dataset: {},
    appended: [],
    appendChild(child) { element.appended.push(child); return child; },
    querySelector(selector) {
      if (!children.has(selector)) children.set(selector, fakeElement());
      return children.get(selector);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    closest() { return null; },
    remove() {},
  };
  return element;
}

function loadBulkEdit() {
  const mounts = [];
  const billSlot = fakeElement();
  const box = {
    module: { exports: {} },
    console,
    mounts,
    billSlot,
    escapeHtml: (text) => String(text),
    transactions: [],
    bulkEditState: { selectedIds: new Set() },
    document: {
      createElement: () => fakeElement(),
      getElementById: () => null,
      body: fakeElement(),
    },
    mountBillPicker: (slot, options) => { mounts.push(options); return {}; },
  };
  vm.runInNewContext(
    `${read('transactions/bulk-edit.js')}\n`
      // The field row is real DOM work; the bill slot is all these tests need.
      + 'function _buildFieldRow() { return { querySelector: () => null }; }\n'
      + '_renderLegalFieldRows = function (container, legalFields, transferBillsOnly) {\n'
      + "  if (legalFields.includes('bill_id')) _mountBulkBillPicker(billSlot, transferBillsOnly);\n"
      + '};\n'
      + 'module.exports = { _renderBulkEditModal, _renderBlockersFooter, bulkEditSharedBlockerReason };',
    box,
    { filename: 'bulk-edit.js' },
  );
  return { api: box.module.exports, mounts, box };
}

test('the bulk picker follows the preflight flag when every row is a linked transfer', () => {
  const { api, mounts } = loadBulkEdit();
  api._renderBulkEditModal({ selection_count: 3, legal_fields: ['bill_id'], blockers: {}, transfer_bills_only: true });
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].transferBillsOnly, true);
});

test('the bulk picker greys nothing for this when the flag is false or missing', () => {
  const { api, mounts } = loadBulkEdit();
  api._renderBulkEditModal({ selection_count: 2, legal_fields: ['bill_id'], blockers: {}, transfer_bills_only: false });
  api._renderBulkEditModal({ selection_count: 2, legal_fields: ['bill_id'], blockers: {} });
  assert.deepEqual(mounts.map((options) => options.transferBillsOnly), [false, false]);
});

test('a re-render from an apply refusal reads the flag from that body', () => {
  const { api, mounts } = loadBulkEdit();
  const refusal = {
    error: 'Selection changed',
    selection_count: 2,
    legal_fields: ['bill_id'],
    blockers: {},
    rejected_ids: [],
    transfer_bills_only: true,
  };
  api._renderBulkEditModal({ selection_count: 2, legal_fields: ['bill_id'], blockers: {}, transfer_bills_only: false });
  api._renderBulkEditModal(refusal);
  assert.deepEqual(mounts.map((options) => options.transferBillsOnly), [false, true]);
});

test('a mixed selection offers no bill picker and lists Add to bill as not editable with the API reason', () => {
  const { api, mounts } = loadBulkEdit();
  const blockers = {
    bill_id: ['t1', 't2', 't3', 't4', 't5'].map((id) => ({ transaction_id: id, reason: MIXED_REASON })),
  };
  api._renderBulkEditModal({ selection_count: 5, legal_fields: ['user_memo'], blockers, transfer_bills_only: false });
  assert.equal(mounts.length, 0);

  const container = fakeElement();
  api._renderBlockersFooter(container, plain(blockers));
  assert.match(container.innerHTML, /Not editable for this selection/);
  assert.match(container.innerHTML, /Add to bill/);
  assert.match(container.innerHTML, /5 rows blocking/);
  assert.ok(container.innerHTML.includes(`<div class="bulk-edit-blocker-reason">${MIXED_REASON}</div>`));
});

test('one reason is shown once, and different reasons are left to the per-row list', () => {
  const { api } = loadBulkEdit();
  assert.equal(api.bulkEditSharedBlockerReason([{ reason: 'a' }, { reason: 'a' }]), 'a');
  assert.equal(api.bulkEditSharedBlockerReason([{ reason: 'a' }, { reason: 'b' }]), '');
  assert.equal(api.bulkEditSharedBlockerReason([]), '');

  const container = fakeElement();
  api._renderBlockersFooter(container, { amount: [{ transaction_id: 't1', reason: 'a' }, { transaction_id: 't2', reason: 'b' }] });
  assert.ok(!container.innerHTML.includes('bulk-edit-blocker-reason'));
});
