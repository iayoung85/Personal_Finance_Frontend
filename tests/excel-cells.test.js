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

const C = loadFiles(['shared/report-grid.js', 'excel/cells.js'], [
  'excelColumnLetter', 'excelCellAddress', 'excelBlockAddress', 'excelSerialFromIsoDate', 'isoDateFromExcelSerial',
  'monthKeyFromHeaderValue', 'sheetValueOfCell', 'typeGridForSheet', 'chooseNumberFormat', 'numberFormatsForGrid',
  'buildBalanceReportGrid',
].join(', '));

const plain = value => JSON.parse(JSON.stringify(value));

test('column letters run A to Z, then AA', () => {
  assert.equal(C.excelColumnLetter(0), 'A');
  assert.equal(C.excelColumnLetter(25), 'Z');
  assert.equal(C.excelColumnLetter(26), 'AA');
  assert.equal(C.excelColumnLetter(27), 'AB');
  assert.equal(C.excelColumnLetter(701), 'ZZ');
  assert.equal(C.excelColumnLetter(702), 'AAA');
  assert.equal(C.excelCellAddress(40, 2), 'C41');
  assert.equal(C.excelBlockAddress(30, 26), 'A1:Z30');
});

test('an all-digit mask lands as a number, leading zeros dropped, as a paste leaves it', () => {
  assert.deepEqual(plain(C.sheetValueOfCell({ text: '5747', role: 'mask' })), { value: 5747, kind: 'number' });
  assert.deepEqual(plain(C.sheetValueOfCell({ text: '0134', role: 'mask' })), { value: 134, kind: 'number' });
});

test('a mask with a letter, or a blank mask, is not a number', () => {
  assert.deepEqual(plain(C.sheetValueOfCell({ text: 'A12', role: 'mask' })), { value: 'A12', kind: 'text' });
  assert.deepEqual(plain(C.sheetValueOfCell({ text: '', role: 'mask' })), { value: '', kind: 'empty' });
  assert.deepEqual(plain(C.sheetValueOfCell({ text: '12-34', role: 'mask' })), { value: '12-34', kind: 'text' });
});

test('digits in a label that is not a mask stay text', () => {
  assert.deepEqual(plain(C.sheetValueOfCell({ text: '2024', role: 'detailed' })), { value: '2024', kind: 'text' });
  assert.deepEqual(plain(C.sheetValueOfCell({ text: '0134' })), { value: '0134', kind: 'text' });
});

test('a balance month header lands as a real date', () => {
  const typed = C.sheetValueOfCell({ text: '2025-11-30', role: 'periodEnd' });
  assert.equal(typed.kind, 'date');
  assert.equal(typed.value, 45991);
  assert.equal(C.isoDateFromExcelSerial(typed.value), '2025-11-30');
  assert.equal(C.excelSerialFromIsoDate('2026-02-28'), 46081);
  assert.equal(C.excelSerialFromIsoDate('not a date'), null);
});

test('a category period label is text, not a date', () => {
  assert.deepEqual(plain(C.sheetValueOfCell({ text: '11/1/25 - 11/30/25' })), { value: '11/1/25 - 11/30/25', kind: 'text' });
});

test('amounts land as numbers whether the API sent text or a number', () => {
  assert.deepEqual(plain(C.sheetValueOfCell({ amount: '1200.50' })), { value: 1200.5, kind: 'number' });
  assert.deepEqual(plain(C.sheetValueOfCell({ amount: -410.2 })), { value: -410.2, kind: 'number' });
  assert.deepEqual(plain(C.sheetValueOfCell({ amount: 0 })), { value: 0, kind: 'number' });
  assert.deepEqual(plain(C.sheetValueOfCell(null)), { value: '', kind: 'empty' });
});

test('a typed grid is a rectangle padded with empty cells', () => {
  const grid = C.buildBalanceReportGrid({
    periods: ['2026-01-31'],
    sections: { assets: { subgroups: { Checking: { accounts: [{ name: 'Elm Checking', effective_mask: '0042', balances: ['5.00'] }], subtotals: ['5.00'] } }, section_totals: ['5.00'] } },
    net_worth_row: ['5.00'],
  }, { showMask: true });
  const typed = C.typeGridForSheet(grid);
  assert.equal(typed.columnCount, 3);
  assert.equal(typed.rowCount, grid.length);
  assert.deepEqual(plain(typed.values[0]), ['Account', 'Mask', 46053]);
  assert.deepEqual(plain(typed.values[1]), ['Assets', '', '']);
  assert.deepEqual(plain(typed.values[3]), ['    Elm Checking', 42, 5]);
  assert.deepEqual(plain(typed.kinds[3]), ['text', 'number', 'number']);
  assert.ok(typed.values.every(row => row.length === 3));
});

test('header cells name their month however they reached the sheet', () => {
  assert.equal(C.monthKeyFromHeaderValue(45991), '2025-11');
  assert.equal(C.monthKeyFromHeaderValue('2025-11-30'), '2025-11');
  assert.equal(C.monthKeyFromHeaderValue('11/1/25 - 11/30/25'), '2025-11');
  assert.equal(C.monthKeyFromHeaderValue('11/30/2025'), '2025-11');
  assert.equal(C.monthKeyFromHeaderValue('Mask'), null);
  assert.equal(C.monthKeyFromHeaderValue('Total'), null);
  assert.equal(C.monthKeyFromHeaderValue(''), null);
  assert.equal(C.monthKeyFromHeaderValue(0), null);
  assert.equal(C.monthKeyFromHeaderValue('13/1/25 - 13/30/25'), null);
});

test('text cells get the text format so Excel cannot retype them', () => {
  assert.equal(C.chooseNumberFormat('text', 'General'), '@');
  assert.equal(C.chooseNumberFormat('text', '#,##0.00'), '@');
});

test('numbers keep a currency format but leave text and date formats', () => {
  assert.equal(C.chooseNumberFormat('number', '$#,##0.00'), '$#,##0.00');
  assert.equal(C.chooseNumberFormat('number', '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)'), '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)');
  assert.equal(C.chooseNumberFormat('number', '@'), 'General');
  assert.equal(C.chooseNumberFormat('number', 'm/d/yyyy'), 'General');
  assert.equal(C.chooseNumberFormat('number', undefined), 'General');
});

test('dates keep a date format and get one otherwise', () => {
  assert.equal(C.chooseNumberFormat('date', 'mmm-yy'), 'mmm-yy');
  assert.equal(C.chooseNumberFormat('date', 'General'), 'm/d/yyyy');
  assert.equal(C.chooseNumberFormat('date', '@'), 'm/d/yyyy');
});

test('empty cells keep whatever format they had', () => {
  assert.equal(C.chooseNumberFormat('empty', '0.00'), '0.00');
  assert.equal(C.chooseNumberFormat('empty', undefined), 'General');
  assert.deepEqual(plain(C.numberFormatsForGrid([['text', 'number']], [['General', '0.00']])), [['@', '0.00']]);
  assert.deepEqual(plain(C.numberFormatsForGrid([['number']], undefined)), [['General']]);
});
