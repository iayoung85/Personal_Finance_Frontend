const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} } };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'transactions/transaction-patch.js'), 'utf8')}\n`
    + 'module.exports = { patchTransactionsFromResponse };',
  box,
  { filename: 'transaction-patch.js' },
);
const { patchTransactionsFromResponse } = box.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const ids = (rows) => plain(rows.map((row) => row.transaction_id));

function makeRows() {
  return [
    { transaction_id: 't1', account_id: 'a', amount: -10, user_category: 'Food' },
    { transaction_id: 't2', account_id: 'a', amount: -20, user_category: 'Gas' },
    { transaction_id: 't3', account_id: 'b', amount: 30, user_category: '[Checking]' },
  ];
}

test('removed ids leave the list and are reported for the cache', () => {
  const result = patchTransactionsFromResponse(makeRows(), {
    removed_transaction_ids: ['t2'], affected_transactions: [],
  });
  assert.equal(result.patched, true);
  assert.deepEqual(ids(result.rows), ['t1', 't3']);
  assert.deepEqual(plain(result.removedIds), ['t2']);
  assert.deepEqual(plain(result.upsertedRows), []);
});

test('an affected row replaces the row with the same id in place', () => {
  const changed = { transaction_id: 't3', account_id: 'b', amount: 30, user_category: 'Transfer In' };
  const result = patchTransactionsFromResponse(makeRows(), {
    removed_transaction_ids: [], affected_transactions: [changed],
  });
  assert.deepEqual(ids(result.rows), ['t1', 't2', 't3']);
  assert.equal(result.rows[2].user_category, 'Transfer In');
  assert.deepEqual(plain(result.upsertedRows), [changed]);
});

test('an affected row with a new id is added', () => {
  const added = { transaction_id: 't9', account_id: 'a', amount: 5 };
  const result = patchTransactionsFromResponse(makeRows(), {
    removed_transaction_ids: [], affected_transactions: [added],
  });
  assert.deepEqual(ids(result.rows).sort(), ['t1', 't2', 't3', 't9']);
});

test('an id removed and re-added in one response ends up present once, with the new row', () => {
  const again = { transaction_id: 't2', account_id: 'a', amount: -25 };
  const result = patchTransactionsFromResponse(makeRows(), {
    removed_transaction_ids: ['t2'], affected_transactions: [again],
  });
  assert.equal(ids(result.rows).filter((rowId) => rowId === 't2').length, 1);
  assert.equal(result.rows.find((row) => row.transaction_id === 't2').amount, -25);
  assert.deepEqual(plain(result.removedIds), []);
});

test('a parent replaced with pieces carries the new pieces and leaves no flat piece rows', () => {
  const rows = makeRows().concat([
    { transaction_id: 't1_split_0', account_id: 'a', is_split: true, amount: -4 },
    { transaction_id: 't1_split_1', account_id: 'a', is_split: true, amount: -6 },
  ]);
  const parent = {
    transaction_id: 't1', account_id: 'a', amount: -10, is_split: true,
    splits: [{ transaction_id: 't1_split_0', amount: -3 }, { transaction_id: 't1_split_1', amount: -7 }],
  };
  const result = patchTransactionsFromResponse(rows, { removed_transaction_ids: [], affected_transactions: [parent] });
  assert.deepEqual(ids(result.rows).sort(), ['t1', 't2', 't3']);
  assert.deepEqual(plain(result.rows.find((row) => row.transaction_id === 't1').splits.map((piece) => piece.amount)), [-3, -7]);
  assert.deepEqual(plain(result.removedIds).sort(), ['t1_split_0', 't1_split_1']);
});

test('a parent replaced without pieces drops the pieces it had', () => {
  const rows = makeRows();
  rows[0] = {
    transaction_id: 't1', account_id: 'a', amount: -10, is_split: true,
    splits: [{ transaction_id: 't1_split_0' }, { transaction_id: 't1_split_1' }],
  };
  const restored = { transaction_id: 't1', account_id: 'a', amount: -10, is_split: false, splits: [] };
  const result = patchTransactionsFromResponse(rows, { removed_transaction_ids: [], affected_transactions: [restored] });
  assert.equal(result.rows[0].splits.length, 0);
  assert.equal(result.rows[0].is_split, false);
});

test('empty arrays change nothing', () => {
  const input = makeRows();
  const result = patchTransactionsFromResponse(input, { removed_transaction_ids: [], affected_transactions: [] });
  assert.equal(result.patched, true);
  assert.deepEqual(plain(result.rows), plain(input));
  assert.deepEqual(plain(result.removedIds), []);
  assert.deepEqual(plain(result.upsertedRows), []);
});

test('a missing or non-array field reports it could not patch', () => {
  const input = makeRows();
  const cases = [
    undefined,
    null,
    {},
    { removed_transaction_ids: [] },
    { affected_transactions: [] },
    { removed_transaction_ids: 't1', affected_transactions: [] },
    { removed_transaction_ids: [], affected_transactions: { transaction_id: 't1' } },
    { removed_transaction_ids: [], affected_transactions: [{ amount: 1 }] },
  ];
  cases.forEach((response) => {
    const result = patchTransactionsFromResponse(input, response);
    assert.equal(result.patched, false);
    assert.deepEqual(plain(result.rows), plain(input));
  });
});

test('the input rows and the response are not mutated', () => {
  const input = makeRows();
  const response = {
    removed_transaction_ids: ['t2'],
    affected_transactions: [{ transaction_id: 't3', account_id: 'b', amount: 30, user_category: 'Transfer In' }],
  };
  const responseBefore = plain(response);
  patchTransactionsFromResponse(input, response);
  assert.deepEqual(plain(input), plain(makeRows()));
  assert.deepEqual(plain(response), responseBefore);
});
