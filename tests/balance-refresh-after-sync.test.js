const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} } };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'transactions/sync-refresh-plan.js'), 'utf8')}\n`
    + 'module.exports = { balanceRefreshAfterSync };',
  box,
  { filename: 'sync-refresh-plan.js' },
);
const { balanceRefreshAfterSync } = box.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a sync with no changes refreshes nothing', () => {
  const plan = balanceRefreshAfterSync({ added_count: 0, affected_account_ids: ['a'] }, 'single', 'a');
  assert.deepEqual(plain(plan), { evictAccountIds: [], clearAll: false, refetchSelected: false, reloadAccounts: false });
});

test('changes on another account reload accounts and evict it without refetching the selected one', () => {
  const plan = balanceRefreshAfterSync({ modified_count: 2, affected_account_ids: ['b'] }, 'single', 'a');
  assert.deepEqual(plain(plan), { evictAccountIds: ['b'], clearAll: false, refetchSelected: false, reloadAccounts: true });
});

test('changes on the selected account refetch its history', () => {
  const plan = balanceRefreshAfterSync({ added_count: 1, affected_account_ids: ['a', 'b'] }, 'single', 'a');
  assert.equal(plan.refetchSelected, true);
  assert.deepEqual(plain(plan.evictAccountIds), ['a', 'b']);
});

test('trending changes clear every cached history and refetch the selected account', () => {
  const plan = balanceRefreshAfterSync({ trending_changed: true }, 'single', 'a');
  assert.equal(plan.clearAll, true);
  assert.equal(plan.refetchSelected, true);
  assert.equal(plan.reloadAccounts, true);
});

test('all-accounts mode never refetches a history', () => {
  const plan = balanceRefreshAfterSync({ removed_count: 1, trending_changed: true, affected_account_ids: ['a'] }, 'all', null);
  assert.equal(plan.refetchSelected, false);
  assert.equal(plan.reloadAccounts, true);
});
