const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const kindsPath = path.join(__dirname, '..', 'categories', 'primary-kinds.js');
const textPath = path.join(__dirname, '..', 'categories', 'audit-log-text.js');

function loadHelpers() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(kindsPath, 'utf8'), sandbox, { filename: kindsPath });
  vm.runInNewContext(
    `${fs.readFileSync(textPath, 'utf8')}\nmodule.exports = { describeAuditLogEntry };`,
    sandbox,
    { filename: textPath }
  );
  return sandbox.module.exports;
}

const { describeAuditLogEntry } = loadHelpers();
const plain = value => JSON.parse(JSON.stringify(value));

test('edit_category names both labels, the kind when one was stored, and what moved', () => {
  const text = describeAuditLogEntry({
    migration_type: 'edit_category',
    changes: { old_name: 'Food: Groceries', new_name: 'Household: Groceries', kind: 'spending' },
    stats: { transactions: 12, rules: 1, overrides: 0, bills: 0, alerts: 0, mappings_updated: 3 }
  });
  assert.deepEqual(plain(text), {
    type: 'Edit category',
    changes: 'Renamed Food: Groceries to Household: Groceries; its primary counts as Spending',
    stats: 'Moved 12 transactions, 1 rule, 3 Plaid categories repointed'
  });
});

test('rename_primary counts the categories that moved', () => {
  const text = describeAuditLogEntry({
    migration_type: 'rename_primary',
    changes: { old_primary: 'Food', new_primary: 'Groceries', categories_renamed: [{ old: 'Food: A', new: 'Groceries: A' }, { old: 'Food: B', new: 'Groceries: B' }] },
    stats: { transactions: 0, mappings_updated: 0 }
  });
  assert.equal(text.type, 'Rename primary');
  assert.equal(text.changes, 'Renamed Food to Groceries, with its 2 categories');
  assert.equal(text.stats, 'Nothing else moved');
});

test('merge_categories lists the sources and the target', () => {
  const text = describeAuditLogEntry({
    migration_type: 'merge_categories',
    changes: { source_categories: ['Food: A', 'Food: B'], target_category: 'Food: C' },
    stats: { transactions: 5 }
  });
  assert.equal(text.type, 'Merge categories');
  assert.equal(text.changes, 'Merged Food: A and Food: B into Food: C');
  assert.equal(text.stats, 'Moved 5 transactions');
});

test('delete_category names the label', () => {
  const text = describeAuditLogEntry({ migration_type: 'delete_category', changes: { category_name: 'Food: A' }, stats: { labels_deleted: 1 } });
  assert.deepEqual(plain(text), { type: 'Delete category', changes: 'Deleted Food: A', stats: '' });
});

test('remove_unused_categories counts what went and what was kept, cutting a long list short', () => {
  const deleted = Array.from({ length: 10 }, (_, index) => `X: ${index}`);
  const text = describeAuditLogEntry({
    migration_type: 'remove_unused_categories',
    changes: { deleted },
    stats: { labels_deleted: 10, labels_kept: 4 }
  });
  assert.equal(text.type, 'Remove unused');
  assert.equal(text.changes, 'Deleted 10 unused categories: X: 0, X: 1, X: 2, X: 3, X: 4, X: 5, X: 6, X: 7 and 2 more');
  assert.equal(text.stats, 'Kept 4 categories that something still holds');
});

test('hide_categories and unhide_categories name the labels', () => {
  const hid = describeAuditLogEntry({ migration_type: 'hide_categories', changes: { labels: ['Food: A'], hidden: true }, stats: { labels_changed: 1 } });
  assert.deepEqual(plain(hid), { type: 'Hide', changes: 'Hid Food: A', stats: '' });
  const unhid = describeAuditLogEntry({ migration_type: 'unhide_categories', changes: { labels: ['Food: A', 'Food: B'], hidden: false }, stats: {} });
  assert.deepEqual(plain(unhid), { type: 'Unhide', changes: 'Unhid Food: A and Food: B', stats: '' });
});

test('an older type still shows its raw changes and stats', () => {
  const text = describeAuditLogEntry({ migration_type: 'mapping_update', changes: { a: 1 }, stats: { b: 2 } });
  assert.deepEqual(plain(text), { type: 'mapping_update', changes: '{"a":1}', stats: '{"b":2}' });
  const noStats = describeAuditLogEntry({ migration_type: 'rename', changes: null, stats: null });
  assert.deepEqual(plain(noStats), { type: 'rename', changes: '{}', stats: '' });
});
