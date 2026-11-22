const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFiles(relPaths, exportsList) {
  const files = relPaths.map(relPath => path.join(__dirname, '..', relPath));
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox, { filename: files[files.length - 1] });
  return sandbox.module.exports;
}

const { findOldGridExtent, findPasteBlocker, planGridPaste } = loadFiles(
  ['excel/cells.js', 'excel/sheet-extent.js'],
  'findOldGridExtent, findPasteBlocker, planGridPaste',
);

const plain = value => JSON.parse(JSON.stringify(value));

// A balances sheet as the user keeps it: the pasted grid, two blank rows, then
// their own audit rows, and a note to the right of the grid.
const SHEET = [
  ['Account', 'Mask', 45991, 46021, '', 'my note'],
  ['Assets', '', '', '', '', ''],
  ['    Elm Checking', 42, 10, 12, '', ''],
  ['Net Worth', '', 10, 12, '', ''],
  ['', '', '', '', '', ''],
  ['', '', '', '', '', ''],
  ['Audit', '', '=C4-C3', '', '', ''],
  ['Diff', '', 0, '', '', ''],
];

test('the old grid ends before the first two blank rows and spans its header', () => {
  assert.deepEqual(plain(findOldGridExtent(SHEET)), { rowCount: 4, columnCount: 4 });
});

test('a single blank row inside the grid does not end it', () => {
  const sheet = [
    ['Account', 'Mask', 45991],
    ['Assets', '', ''],
    ['', '', ''],
    ['Net Worth', '', 5],
    ['', '', ''],
    ['', '', ''],
    ['Audit', '', 1],
  ];
  assert.deepEqual(plain(findOldGridExtent(sheet)), { rowCount: 4, columnCount: 3 });
});

test('the category grid, whose header starts with a blank A1, is as wide as its header', () => {
  const sheet = [
    ['', 'Primary Category', 'Detailed Category', '1/1/26 - 1/31/26', 'Total'],
    ['Earned Income', '', '', 'January', ''],
    ['', 'Income', 'Wages', 5, 5],
  ];
  assert.deepEqual(plain(findOldGridExtent(sheet)), { rowCount: 3, columnCount: 5 });
});

test('a grid with nothing under it ends at its last row', () => {
  assert.deepEqual(plain(findOldGridExtent([['A', 'B'], ['x', 1]])), { rowCount: 2, columnCount: 2 });
});

test('an empty sheet has no old grid', () => {
  assert.deepEqual(plain(findOldGridExtent([])), { rowCount: 0, columnCount: 0 });
  assert.deepEqual(plain(findOldGridExtent([['', '']])), { rowCount: 0, columnCount: 0 });
});

test('a new grid that fits above the user rows is not blocked', () => {
  const plan = planGridPaste(SHEET, 6, 4);
  assert.equal(plan.blocker, null);
  assert.deepEqual(plain(plan.oldExtent), { rowCount: 4, columnCount: 4 });
});

test('a new grid that reaches the user rows is blocked at the first one', () => {
  const plan = planGridPaste(SHEET, 7, 4);
  assert.deepEqual(plain(plan.blocker), { rowIndex: 6, columnIndex: 0, address: 'A7' });
});

test('a wider new grid is blocked by a note to the right of the old one', () => {
  const extent = findOldGridExtent(SHEET);
  assert.deepEqual(plain(findPasteBlocker(SHEET, extent, 4, 6)), { rowIndex: 0, columnIndex: 5, address: 'F1' });
  assert.equal(findPasteBlocker(SHEET, extent, 4, 5), null);
});

test('a paste onto an empty sheet is never blocked', () => {
  assert.equal(planGridPaste([], 300, 26).blocker, null);
});
