const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const categoriesPath = path.join(__dirname, '..', 'transactions', 'categories.js');
const categoriesSource = fs.readFileSync(categoriesPath, 'utf8');

function loadHelper() {
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(
    `${categoriesSource}\nmodule.exports = { isUnchangedCategoryEntry };`,
    sandbox,
    { filename: categoriesPath },
  );
  return sandbox.module.exports.isUnchangedCategoryEntry;
}

test('a transfer label tabbed through unchanged is not a new entry', () => {
  const isUnchangedCategoryEntry = loadHelper();
  assert.equal(isUnchangedCategoryEntry('[RH Checking]', '[RH Checking]'), true);
});

test('spacing differences in the cell do not count as a change', () => {
  const isUnchangedCategoryEntry = loadHelper();
  assert.equal(isUnchangedCategoryEntry('Food And Drink: Dining ', 'Food And Drink: Dining'), true);
});

test('a different category or transfer account is a change', () => {
  const isUnchangedCategoryEntry = loadHelper();
  assert.equal(isUnchangedCategoryEntry('[RH Checking]', '[Savings]'), false);
  assert.equal(isUnchangedCategoryEntry('[RH Checking]', 'Food And Drink: Dining'), false);
});

test('a cell with no value recorded on focus counts as changed', () => {
  const isUnchangedCategoryEntry = loadHelper();
  assert.equal(isUnchangedCategoryEntry(undefined, '[RH Checking]'), false);
});
