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

const R = loadFiles(
  ['shared/fiscal-year.js', 'excel/cells.js', 'excel/default-range.js'],
  'defaultPasteRange, firstMonthOnSheet, monthRangeToDates, monthPickerOptions, monthKeyLabel, monthRangeProblem',
);

const plain = value => JSON.parse(JSON.stringify(value));
const NOVEMBER = 11;
const FIRST_MONTH_COLUMN = 2;

test('in the first month of a fiscal year with no header, the range starts a year back, not two', () => {
  const range = R.defaultPasteRange(new Date(2026, 10, 21), NOVEMBER, undefined, FIRST_MONTH_COLUMN);
  assert.deepEqual(plain(range), { startMonth: '2025-11', endMonth: '2026-11' });
});

test('mid fiscal year with no header, the range starts at the previous fiscal year', () => {
  const range = R.defaultPasteRange(new Date(2026, 9, 5), NOVEMBER, [], FIRST_MONTH_COLUMN);
  assert.deepEqual(plain(range), { startMonth: '2024-11', endMonth: '2026-10' });
  const calendar = R.defaultPasteRange(new Date(2026, 0, 15), 1, [], FIRST_MONTH_COLUMN);
  assert.deepEqual(plain(calendar), { startMonth: '2025-01', endMonth: '2026-01' });
});

test('a sheet that already holds months starts on its first one', () => {
  const header = ['Account', 'Mask', 45991, 46021];
  const range = R.defaultPasteRange(new Date(2026, 11, 2), NOVEMBER, header, FIRST_MONTH_COLUMN);
  assert.deepEqual(plain(range), { startMonth: '2025-11', endMonth: '2026-12' });
  assert.equal(R.firstMonthOnSheet(['Account', '', '2025-12-31'], FIRST_MONTH_COLUMN), '2025-12');
});

test('the Mask header is never read as the first month', () => {
  assert.equal(R.firstMonthOnSheet(['Account', 'Mask'], FIRST_MONTH_COLUMN), null);
});

test('a month range becomes its first and last day', () => {
  assert.deepEqual(plain(R.monthRangeToDates('2025-11', '2026-02')), { startDate: '2025-11-01', endDate: '2026-02-28' });
  assert.deepEqual(plain(R.monthRangeToDates('2027-11', '2028-02')), { startDate: '2027-11-01', endDate: '2028-02-29' });
});

test('the pickers offer the current month first and always the sheet month', () => {
  const options = R.monthPickerOptions(new Date(2026, 10, 21), 1, ['2019-03']);
  assert.equal(options[0].value, '2026-11');
  assert.equal(options[0].label, 'Nov 2026');
  assert.equal(options[12].value, '2025-11');
  assert.equal(options[options.length - 1].value, '2019-03');
  assert.equal(options.length, 14);
});

test('a range out of order is refused before any request', () => {
  assert.equal(R.monthRangeProblem('2026-01', '2025-12'), 'The start month is after the end month.');
  assert.equal(R.monthRangeProblem('', '2025-12'), 'Pick a start and an end month.');
  assert.equal(R.monthRangeProblem('2025-11', '2025-11'), null);
});
