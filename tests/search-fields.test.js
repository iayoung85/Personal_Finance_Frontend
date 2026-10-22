const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'transactions', 'search.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sandbox = { module: { exports: {} }, console, isTransferCategory: () => false };
vm.runInNewContext(`${source}\nmodule.exports = { parseSearchQuery, transactionMatchesSearch };`, sandbox, { filename: sourcePath });
const { parseSearchQuery, transactionMatchesSearch } = sandbox.module.exports;

const matches = (txn, query) => transactionMatchesSearch(txn, parseSearchQuery(query));

const row = {
  source: 'plaid', user_category: 'Food: Coffee', is_override: false,
  personal_finance_category: { detailed: 'FOOD_AND_DRINK_COFFEE', confidence_level: 'LOW' },
};

test('label is an exact, case-insensitive match and takes quoted colons', () => {
  assert.equal(matches(row, 'label:"Food: Coffee"'), true);
  assert.equal(matches(row, 'label:"food: coffee"'), true);
  assert.equal(matches(row, 'label:"Food"'), false);
});

test('pfc matches the detailed key exactly', () => {
  assert.equal(matches(row, 'pfc:food_and_drink_coffee'), true);
  assert.equal(matches(row, 'pfc:FOOD_AND_DRINK'), false);
  assert.equal(matches({ user_category: 'x' }, 'pfc:FOOD_AND_DRINK_COFFEE'), false);
});

test('confidence matches the level', () => {
  assert.equal(matches(row, 'confidence:low'), true);
  assert.equal(matches(row, 'confidence:high'), false);
});

test('the full inspect query with negations', () => {
  const query = 'label:"Food: Coffee" pfc:FOOD_AND_DRINK_COFFEE is:plaid -is:override -is:transfer';
  assert.equal(matches(row, query), true);
  assert.equal(matches({ ...row, is_override: true }, query), false);
});
