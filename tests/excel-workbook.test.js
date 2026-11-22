const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// excel/workbook.js against an in-memory stand-in for the slice of the Excel
// API it uses. The stand-in does not model load/sync timing; it proves what
// gets written where: the user's rows and the lookup tables are never touched.

function columnIndexOf(letters) {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

function parseAddress(address) {
  const [start, end] = address.split(':');
  const parse = cell => {
    const match = /^([A-Z]+)(\d+)$/.exec(cell);
    return { row: Number(match[2]) - 1, column: columnIndexOf(match[1]) };
  };
  const first = parse(start);
  const last = end ? parse(end) : first;
  return { top: first.row, left: first.column, rows: last.row - first.row + 1, columns: last.column - first.column + 1 };
}

function letterOf(index) {
  let remaining = index + 1;
  let letters = '';
  while (remaining > 0) {
    letters = String.fromCharCode(65 + ((remaining - 1) % 26)) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

class FakeSheet {
  constructor(name, rows = [], tables = []) {
    this.name = name;
    this.isNullObject = false;
    this.cells = new Map();
    this.formats = new Map();
    rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      if (value !== '') this.cells.set(`${rowIndex},${columnIndex}`, value);
    }));
    this.tables = { items: tables.map(table => table(this)), load() {} };
    this.writes = 0;
  }
  load() {}
  getRange(address) {
    if (!address) return new FakeRange(this, { top: 0, left: 0, rows: 1000, columns: 60 });
    return new FakeRange(this, parseAddress(address));
  }
  getUsedRangeOrNullObject() {
    let maxRow = -1;
    let maxColumn = -1;
    for (const key of this.cells.keys()) {
      const [row, column] = key.split(',').map(Number);
      maxRow = Math.max(maxRow, row);
      maxColumn = Math.max(maxColumn, column);
    }
    if (maxRow === -1) return { isNullObject: true, load() {} };
    return { isNullObject: false, rowIndex: 0, columnIndex: 0, rowCount: maxRow + 1, columnCount: maxColumn + 1, load() {} };
  }
  valueAt(row, column) {
    return this.cells.has(`${row},${column}`) ? this.cells.get(`${row},${column}`) : '';
  }
  rows(rowCount, columnCount) {
    return Array.from({ length: rowCount }, (_, row) => Array.from({ length: columnCount }, (_, column) => this.valueAt(row, column)));
  }
}

class FakeRange {
  constructor(sheet, rect) {
    this.sheet = sheet;
    this.rect = rect;
    this.format = { font: {}, autofitColumns() {} };
  }
  load() {}
  get rowIndex() { return this.rect.top; }
  get address() {
    const { top, left, rows, columns } = this.rect;
    return `${this.sheet.name}!${letterOf(left)}${top + 1}:${letterOf(left + columns - 1)}${top + rows}`;
  }
  _each(callback) {
    return Array.from({ length: this.rect.rows }, (_, rowOffset) => Array.from({ length: this.rect.columns },
      (_, columnOffset) => callback(this.rect.top + rowOffset, this.rect.left + columnOffset)));
  }
  get values() { return this._each((row, column) => this.sheet.valueAt(row, column)); }
  set values(matrix) {
    this.sheet.writes++;
    this._each((row, column) => {
      const value = matrix[row - this.rect.top][column - this.rect.left];
      if (value === '') this.sheet.cells.delete(`${row},${column}`);
      else this.sheet.cells.set(`${row},${column}`, value);
    });
  }
  get numberFormat() { return this._each((row, column) => this.sheet.formats.get(`${row},${column}`) || 'General'); }
  set numberFormat(matrix) {
    this.sheet.writes++;
    this._each((row, column) => this.sheet.formats.set(`${row},${column}`, matrix[row - this.rect.top][column - this.rect.left]));
  }
  clear() {
    this.sheet.writes++;
    this._each((row, column) => this.sheet.cells.delete(`${row},${column}`));
  }
  getCell(rowOffset, columnOffset) {
    return new FakeRange(this.sheet, { top: this.rect.top + rowOffset, left: this.rect.left + columnOffset, rows: 1, columns: 1 });
  }
  getResizedRange(deltaRows, deltaColumns) {
    return new FakeRange(this.sheet, { ...this.rect, rows: this.rect.rows + deltaRows, columns: this.rect.columns + deltaColumns });
  }
}

function fakeTable(headerRowIndex, rowCount, columnCount) {
  return sheet => ({
    getHeaderRowRange: () => new FakeRange(sheet, { top: headerRowIndex, left: 0, rows: 1, columns: columnCount }),
    getDataBodyRange: () => new FakeRange(sheet, { top: headerRowIndex + 1, left: 0, rows: rowCount, columns: columnCount }),
  });
}

function fakeExcel(sheets, selection) {
  const byName = new Map(sheets.map(sheet => [sheet.name, sheet]));
  const workbook = {
    worksheets: {
      getItemOrNullObject: name => byName.get(name) || { isNullObject: true, load() {} },
      add: name => {
        const sheet = new FakeSheet(name);
        byName.set(name, sheet);
        return sheet;
      },
    },
    getSelectedRange: () => byName.get(selection.sheet).getRange(selection.address),
  };
  return {
    byName,
    Excel: {
      ClearApplyTo: { contents: 'Contents', all: 'All' },
      run: callback => callback({ workbook, sync: async () => {} }),
    },
  };
}

function loadWorkbook(excel) {
  const files = [
    'shared/fiscal-year.js', 'shared/report-grid.js', 'excel/constants.js', 'excel/cells.js',
    'excel/sheet-extent.js', 'excel/default-range.js', 'excel/checks.js', 'excel/workbook.js',
  ].map(relPath => path.join(__dirname, '..', relPath));
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const sandbox = { module: { exports: {} }, console, Excel: excel.Excel };
  vm.runInNewContext(
    `${source}\nmodule.exports = { runWorkbookCheck, pasteGridAtSelection, buildBalanceReportGrid, buildCategoryReportGrid };`,
    sandbox,
    { filename: files[files.length - 1] },
  );
  return sandbox.module.exports;
}

const PERIODS = ['2026-01-31', '2026-02-28'];
const BALANCE_DATA = {
  periods: PERIODS,
  sections: { assets: { subgroups: { Checking: { accounts: [{ name: 'Elm Checking', effective_mask: '5747', balances: ['10.00', '20.00'] }], subtotals: ['10.00', '20.00'] } }, section_totals: ['10.00', '20.00'] } },
  net_worth_row: ['10.00', '20.00'],
};
const CATEGORY_DATA = {
  periods: ['1/1/26 - 1/31/26', '2/1/26 - 2/28/26'],
  income: {}, total_income_row: [0, 0], total_income_grand: 0,
  expenses: { 'Food: Groceries': { amounts: [-5, -6], total: -11 } }, total_expenses_row: [-5, -6], total_expenses_grand: -11,
  total_all_income_row: [0, 0], total_all_income_grand: 0, total_all_outflow_row: [-5, -6], total_all_outflow_grand: -11,
  total_row: [-5, -6], total_grand: -11,
};

function workbookSheets({ balanceRows }) {
  return [
    new FakeSheet('PF_BALANCES', balanceRows),
    new FakeSheet('MYAPP Categories', [
      ['', 'Primary Category', 'Detailed Category', '1/1/26 - 1/31/26', '2/1/26 - 2/28/26', 'Total'],
    ]),
    new FakeSheet('Accounts', [['Account', 'lookup mask', 'Retired account flag'], ['Elm Checking', 5747, '']], [fakeTable(0, 1, 3)]),
    new FakeSheet('Categories', [['PF Detailed Category', 'RETIRED CATEGORY FLAG'], ['Groceries', ''], ['Total Spending', '']], [fakeTable(0, 2, 2)]),
  ];
}

// The old grid, then blank rows, then the user's audit rows. The new balance
// grid is seven rows (header, Assets, Checking, the account, its total, Total
// Assets, Net Worth), so it fits above audit rows on row 10 but reaches one on
// row 7.
function oldBalances(auditRowNumber) {
  const rows = [
    ['Account', 'Mask', 46053, 46081],
    ['Assets', '', '', ''],
    ['    Old Account', 1111, 1, 2],
    ['Net Worth', '', 1, 2],
  ];
  while (rows.length < auditRowNumber - 1) rows.push(['', '', '', '']);
  rows.push(['Audit', '', '=C4', '']);
  return rows;
}

async function run(excel, paste, now = new Date(2026, 2, 15)) {
  const workbook = loadWorkbook(excel);
  return workbook.runWorkbookCheck({
    balanceGrid: workbook.buildBalanceReportGrid(BALANCE_DATA, { showMask: true }),
    categoryGrid: workbook.buildCategoryReportGrid(CATEGORY_DATA),
    startMonth: '2026-01',
    endMonth: '2026-02',
    now,
    paste,
  });
}

function checkRows(excel) {
  const sheet = excel.byName.get('PF_CHECK');
  return sheet.rows(12, 7);
}

test('paste both sheets replaces the old grid, keeps the audit rows, and never writes the tables', async () => {
  const excel = fakeExcel(workbookSheets({ balanceRows: oldBalances(10) }), null);
  const result = await run(excel, true);
  assert.equal(result.pasted, true);

  const balances = excel.byName.get('PF_BALANCES');
  assert.deepEqual(balances.rows(7, 4)[0], ['Account', 'Mask', 46053, 46081]);
  assert.equal(balances.formats.get('0,0'), '@');
  assert.equal(balances.formats.get('0,2'), 'm/d/yyyy');
  assert.deepEqual(balances.rows(7, 4)[3], ['    Elm Checking', 5747, 10, 20]);
  assert.equal(balances.formats.get('3,1'), 'General');
  assert.ok(!balances.rows(7, 4).flat().includes('    Old Account'));
  assert.equal(balances.valueAt(9, 0), 'Audit');
  assert.equal(balances.valueAt(9, 2), '=C4');

  const categories = excel.byName.get('MYAPP Categories');
  assert.equal(categories.valueAt(1, 3), 'January');
  assert.equal(excel.byName.get('Accounts').writes, 0);
  assert.equal(excel.byName.get('Categories').writes, 0);
  assert.match(checkRows(excel)[0][0], /^Pasted both sheets /);
});

test('a paste that would reach the user rows writes neither sheet, only the check', async () => {
  const excel = fakeExcel(workbookSheets({ balanceRows: oldBalances(7) }), null);
  const result = await run(excel, true);
  assert.equal(result.pasted, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.blocked)), [{ sheet: 'PF_BALANCES', address: 'A7' }]);
  assert.equal(excel.byName.get('PF_BALANCES').writes, 0);
  assert.equal(excel.byName.get('MYAPP Categories').writes, 0);
  const rows = checkRows(excel);
  assert.match(rows[0][0], /^Paste refused /);
  assert.ok(rows.some(row => row[2] === 'Paste would overwrite your rows' && row[3] === 'A7'));
});

test('check writes PF_CHECK and nothing else', async () => {
  const excel = fakeExcel(workbookSheets({ balanceRows: oldBalances(10) }), null);
  const result = await run(excel, false);
  assert.equal(result.pasted, false);
  for (const name of ['PF_BALANCES', 'MYAPP Categories', 'Accounts', 'Categories']) {
    assert.equal(excel.byName.get(name).writes, 0, name);
  }
  const rows = checkRows(excel);
  assert.match(rows[0][0], /^Checked 2026-03-15/);
  // The old sheet's account is gone from the report; the new one is in the table.
  assert.ok(!rows.some(row => row[1] === 'fix'));
});

test('paste at the selected cell writes the typed grid there and nothing else', async () => {
  const sheets = [new FakeSheet('Scratch', [['keep me']])];
  const excel = fakeExcel(sheets, { sheet: 'Scratch', address: 'C5' });
  const workbook = loadWorkbook(excel);
  const address = await workbook.pasteGridAtSelection(workbook.buildBalanceReportGrid(BALANCE_DATA, { showMask: true }));
  assert.equal(address, 'Scratch!C5:F11');
  const scratch = excel.byName.get('Scratch');
  assert.equal(scratch.valueAt(0, 0), 'keep me');
  assert.equal(scratch.valueAt(4, 2), 'Account');
  assert.equal(scratch.valueAt(4, 4), 46053);
  assert.equal(scratch.valueAt(7, 3), 5747);
  assert.equal(excel.byName.has('PF_CHECK'), false);
});
