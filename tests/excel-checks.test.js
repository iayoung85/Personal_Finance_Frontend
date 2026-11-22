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

const K = loadFiles(
  ['shared/fiscal-year.js', 'shared/report-grid.js', 'excel/constants.js', 'excel/cells.js', 'excel/default-range.js', 'excel/checks.js'],
  [
    'xlookupMatches', 'xlookupIndex', 'nearMissKind', 'isRetiredFlag', 'readLookupTable', 'pickLookupTable',
    'lookupTableFromSheetValues', 'checkBalanceSheet', 'checkCategorySheet', 'buildCheckSheetRows', 'sortFindings',
    'countFindings', 'pasteBlockedFinding', 'missingSheetFinding', 'buildBalanceReportGrid', 'buildCategoryReportGrid',
  ].join(', '),
);

const plain = value => JSON.parse(JSON.stringify(value));
const CURRENT_MONTH = '2026-03';

// ── XLOOKUP matching ─────────────────────────────────────────

test('text matches without regard to case, as XLOOKUP does', () => {
  assert.equal(K.xlookupMatches('Groceries', 'groceries'), true);
  assert.equal(K.xlookupMatches('A12', 'a12'), true);
  assert.equal(K.xlookupMatches('Groceries', 'Dining'), false);
});

test('a number never matches the same digits as text', () => {
  assert.equal(K.xlookupMatches(5747, '5747'), false);
  assert.equal(K.xlookupMatches('5747', 5747), false);
  assert.equal(K.xlookupMatches(5747, 5747), true);
});

test('spaces are not trimmed', () => {
  assert.equal(K.xlookupMatches('Groceries ', 'Groceries'), false);
});

test('booleans match only booleans, and blanks match nothing typed', () => {
  assert.equal(K.xlookupMatches(true, true), true);
  assert.equal(K.xlookupMatches(true, 'TRUE'), false);
  assert.equal(K.xlookupMatches(0, ''), false);
});

test('the first match wins', () => {
  assert.equal(K.xlookupIndex('food', ['Rent', 'Food', 'FOOD']), 1);
  assert.equal(K.xlookupIndex('Gas', ['Rent', 'Food']), -1);
});

test('near misses name number against text and stray spaces', () => {
  assert.equal(K.nearMissKind(5747, '5747'), 'numberText');
  assert.equal(K.nearMissKind(134, '0134'), 'numberText');
  assert.equal(K.nearMissKind('Dining ', 'dining'), 'spaces');
  assert.equal(K.nearMissKind(5747, 5747), null);
  assert.equal(K.nearMissKind(5747, '5748'), null);
});

test('a retired flag is anything filled in except a no', () => {
  for (const value of [true, 1, 'x', 'Y', 'Retired', 'yes']) assert.equal(K.isRetiredFlag(value), true, String(value));
  for (const value of [false, 0, '', ' ', 'no', 'N', 'FALSE', '0', null]) assert.equal(K.isRetiredFlag(value), false, String(value));
});

// ── Lookup tables ────────────────────────────────────────────

test('table columns are found by header text, wherever they sit', () => {
  const table = K.readLookupTable({
    headerRow: ['Account', 'Retired Account Flag', ' Lookup Mask '],
    bodyRows: [['Elm Checking', '', 5747], ['', '', ''], ['Old Card', 'x', 'A12']],
    firstDataRow: 5,
  }, 'lookup mask', 'Retired account flag');
  assert.deepEqual(plain(table), {
    rows: [{ key: 5747, retired: false, sheetRow: 5 }, { key: 'A12', retired: true, sheetRow: 7 }],
    missingHeaders: [],
  });
});

test('a missing header is named and a missing key column gives no rows', () => {
  const noFlag = K.readLookupTable({ headerRow: ['lookup mask'], bodyRows: [[1]], firstDataRow: 2 }, 'lookup mask', 'Retired account flag');
  assert.deepEqual(plain(noFlag.missingHeaders), ['Retired account flag']);
  assert.equal(noFlag.rows.length, 1);
  const noKey = K.readLookupTable({ headerRow: ['Mask'], bodyRows: [[1]], firstDataRow: 2 }, 'lookup mask', 'Retired account flag');
  assert.deepEqual(plain(noKey), { rows: [], missingHeaders: ['lookup mask', 'Retired account flag'] });
});

test('the table holding the key column is the one picked, with the sheet as a fallback', () => {
  const other = { headerRow: ['Notes'], bodyRows: [], firstDataRow: 2 };
  const accounts = { headerRow: ['lookup mask'], bodyRows: [], firstDataRow: 4 };
  assert.equal(K.pickLookupTable([other, accounts], 'lookup mask'), accounts);
  assert.equal(K.pickLookupTable([other], 'lookup mask'), null);
  const fromSheet = K.lookupTableFromSheetValues([['Title'], ['', 'lookup mask'], ['', 42]], 1, 'lookup mask');
  assert.equal(fromSheet.firstDataRow, 3);
  assert.deepEqual(plain(fromSheet.bodyRows), [['', 42]]);
});

// ── Balance checks ───────────────────────────────────────────

const account = (name, mask, balances) => ({ account_id: name, name, effective_mask: mask, balances });

function balanceGrid(accounts, periods = ['2026-01-31', '2026-02-28', '2026-03-31']) {
  return K.buildBalanceReportGrid({
    periods,
    sections: { assets: { subgroups: { Checking: { accounts, subtotals: periods.map(() => '0') } }, section_totals: periods.map(() => '0') } },
    net_worth_row: periods.map(() => '0'),
  }, { showMask: true });
}

function accountTable(rows) {
  return K.readLookupTable({
    headerRow: ['Account', 'lookup mask', 'Retired account flag'],
    bodyRows: rows.map(([key, retired]) => ['name', key, retired || '']),
    firstDataRow: 3,
  }, 'lookup mask', 'Retired account flag');
}

function runBalance({ accounts, table, oldValues = null, periods }) {
  return K.checkBalanceSheet({ grid: balanceGrid(accounts, periods), accountTable: table, oldValues, currentMonth: CURRENT_MONTH });
}

const problems = findings => plain(findings.map(finding => `${finding.level}:${finding.problem}:${finding.key}`));

test('a report account whose mask the Accounts table lacks needs a fix', () => {
  const findings = runBalance({ accounts: [account('Birch Savings', '8810', ['1', '2', '3'])], table: accountTable([]) });
  assert.deepEqual(problems(findings), ['fix:Account not in the Accounts table:8810']);
  assert.match(findings[0].detail, /3 of 3 months are not zero/);
});

test('a report account the table holds, by number or by text in another case, is fine', () => {
  const findings = runBalance({
    accounts: [account('Elm Checking', '5747', ['1', '1', '1']), account('Oak Card', 'B7x', ['1', '1', '1'])],
    table: accountTable([[5747], ['b7X']]),
  });
  assert.deepEqual(problems(findings), []);
});

test('a new account with only zero months is a note, not a fix', () => {
  const findings = runBalance({ accounts: [account('Idle Account', '9001', ['0.00', '0.00', '0.00'])], table: accountTable([]) });
  assert.deepEqual(problems(findings), ['info:Account not in the Accounts table:9001']);
});

test('a lookup mask with no report account needs a fix, or is a note when retired', () => {
  const findings = runBalance({ accounts: [], table: accountTable([[4321], ['Z9', 'x']]) });
  assert.deepEqual(problems(findings), [
    'fix:Mask not in the report:4321',
    "info:Retired row's mask is not in the report:Z9",
  ]);
  assert.match(findings[0].detail, /Accounts row 3/);
});

test('a mask that matches only as text against a number is caught once, from both sides', () => {
  const findings = runBalance({ accounts: [account('Elm Checking', '5747', ['1', '1', '1'])], table: accountTable([['5747']]) });
  assert.deepEqual(problems(findings), ['fix:Mask matches only as number against text:5747']);
  assert.match(findings[0].detail, /the number 5747.*the text "5747"/);
});

test('a leading-zero mask written as a number matches a text "0134" only nearly', () => {
  const findings = runBalance({ accounts: [account('Maple Checking', '0134', ['1', '1', '1'])], table: accountTable([['0134']]) });
  assert.deepEqual(problems(findings), ['fix:Mask matches only as number against text:134']);
});

test('a number-against-text near miss on a retired row is only a note', () => {
  const findings = runBalance({ accounts: [account('Old Checking', '5747', ['1', '1', '1'])], table: accountTable([['5747', 'x']]) });
  assert.deepEqual(problems(findings), ['info:Mask matches only as number against text:5747']);
});

test('a mask that differs only in spaces is named as such', () => {
  const findings = runBalance({ accounts: [account('Oak Card', 'B7X', ['1', '1', '1'])], table: accountTable([['B7X ']]) });
  assert.deepEqual(problems(findings), ['fix:Mask differs only in spaces:B7X']);
});

test('a mask on two report accounts flags the second, which is never read', () => {
  const findings = runBalance({
    accounts: [account('Elm Checking', '5747', ['1', '1', '1']), account('Elm Savings', '5747', ['2', '2', '2'])],
    table: accountTable([[5747]]),
  });
  assert.deepEqual(problems(findings), ['fix:Mask on more than one account:5747']);
  assert.equal(findings[0].name, 'Elm Savings');
  assert.match(findings[0].detail, /"Elm Checking" first/);
});

test('masks that differ only in case are the same mask to XLOOKUP', () => {
  const findings = runBalance({
    accounts: [account('Card One', 'ab1', ['1', '1', '1']), account('Card Two', 'AB1', ['1', '1', '1'])],
    table: accountTable([['AB1']]),
  });
  assert.deepEqual(problems(findings), ['fix:Mask on more than one account:AB1']);
});

test('a report account with no mask is flagged; one with a mask is not', () => {
  const findings = runBalance({
    accounts: [account('Cash Box', null, ['50', '50', '50']), account('Elm Checking', '5747', ['1', '1', '1'])],
    table: accountTable([[5747]]),
  });
  assert.deepEqual(problems(findings), ['fix:Account has no mask:']);
  assert.equal(findings[0].name, 'Cash Box');
});

const OLD_BALANCES = [
  ['Account', 'Mask', 46053, 46081, 46112],
  ['Assets', '', '', '', ''],
  ['    Elm Checking', 5747, 100, 200, 300],
];

test('a different first month is flagged because every lookup reads by position', () => {
  const findings = runBalance({
    accounts: [account('Elm Checking', '5747', ['200', '300'])],
    table: accountTable([[5747]]),
    oldValues: OLD_BALANCES,
    periods: ['2026-02-28', '2026-03-31'],
  });
  assert.deepEqual(problems(findings), ['fix:First month moves:']);
  assert.match(findings[0].action, /Jan 2026/);
});

test('the same first month, or a sheet with no months yet, is not a shift', () => {
  const same = runBalance({ accounts: [account('Elm Checking', '5747', ['100', '200', '300'])], table: accountTable([[5747]]), oldValues: OLD_BALANCES });
  assert.deepEqual(problems(same), []);
  const fresh = runBalance({ accounts: [account('Elm Checking', '5747', ['1', '2', '3'])], table: accountTable([[5747]]), oldValues: [] });
  assert.deepEqual(problems(fresh), []);
});

test('a past month whose balance changed is a note with the old and new value', () => {
  const findings = runBalance({
    accounts: [account('Elm Checking', '5747', ['100.00', '250.50', '999.00'])],
    table: accountTable([[5747]]),
    oldValues: OLD_BALANCES,
  });
  assert.deepEqual(problems(findings), ['info:Past months changed:5747']);
  assert.equal(findings[0].detail, 'Feb 2026: 200.00 to 250.50');
});

test('the current month moving is not reported as a change', () => {
  const findings = runBalance({
    accounts: [account('Elm Checking', '5747', ['100.00', '200.004', '999.00'])],
    table: accountTable([[5747]]),
    oldValues: OLD_BALANCES,
  });
  assert.deepEqual(problems(findings), []);
});

test('a missing Accounts sheet or key column is a finding, not an error', () => {
  const missingSheet = runBalance({ accounts: [account('Elm Checking', '5747', ['1', '1', '1'])], table: null });
  assert.deepEqual(problems(missingSheet), ['fix:Sheet not found:']);
  const noKey = K.readLookupTable({ headerRow: ['Mask'], bodyRows: [], firstDataRow: 2 }, 'lookup mask', 'Retired account flag');
  const missingColumn = runBalance({ accounts: [account('Elm Checking', '5747', ['1', '1', '1'])], table: noKey });
  assert.deepEqual(problems(missingColumn), ['fix:Column not found:lookup mask', 'fix:Column not found:Retired account flag']);
});

// ── Category checks ──────────────────────────────────────────

const amounts = values => ({ amounts: values, total: values.reduce((a, b) => a + b, 0) });

function categoryData(expenses, periods = ['1/1/26 - 1/31/26', '2/1/26 - 2/28/26', '3/1/26 - 3/31/26']) {
  const zeros = periods.map(() => 0);
  return {
    periods,
    income: {}, total_income_row: zeros, total_income_grand: 0,
    expenses, total_expenses_row: zeros, total_expenses_grand: 0,
    total_all_income_row: zeros, total_all_income_grand: 0,
    total_all_outflow_row: zeros, total_all_outflow_grand: 0,
    total_row: zeros, total_grand: 0,
  };
}

function categoryTable(rows) {
  return K.readLookupTable({
    headerRow: ['PF Primary', 'PF Detailed Category', 'RETIRED CATEGORY FLAG'],
    bodyRows: rows.map(([key, retired]) => ['', key, retired || '']),
    firstDataRow: 2,
  }, 'PF Detailed Category', 'RETIRED CATEGORY FLAG');
}

function runCategory({ expenses, table, oldValues = null, periods }) {
  return K.checkCategorySheet({
    grid: K.buildCategoryReportGrid(categoryData(expenses, periods)),
    categoryTable: table,
    oldValues,
    currentMonth: CURRENT_MONTH,
  });
}

// Total labels sit in the lookup column too, and the workbook may read them.
const TOTAL_LABELS = [['Total Earned Income'], ['Total Inflows'], ['Total Spending'], ['Total Outflow'], ['Total']];

test('a report category the Categories table lacks needs a fix', () => {
  const findings = runCategory({ expenses: { 'Food: Groceries': amounts([-5, -6, -7]) }, table: categoryTable(TOTAL_LABELS) });
  assert.deepEqual(problems(findings), ['fix:Category not in the Categories table:Groceries']);
  assert.equal(findings[0].name, 'Food: Groceries');
});

test('a detailed name in another case still matches, and total labels are found', () => {
  const findings = runCategory({ expenses: { 'Food: Groceries': amounts([-5, -6, -7]) }, table: categoryTable([['groceries'], ...TOTAL_LABELS]) });
  assert.deepEqual(problems(findings), []);
});

test('a PF Detailed Category with no report category needs a fix, or is a note when retired', () => {
  const findings = runCategory({ expenses: {}, table: categoryTable([['Pet Food'], ['Old Hobby', 'Y'], ...TOTAL_LABELS]) });
  assert.deepEqual(problems(findings), [
    'fix:Detailed name not in the report:Pet Food',
    "info:Retired row's detailed name is not in the report:Old Hobby",
  ]);
});

test('a detailed name under two primaries flags the second; distinct names do not', () => {
  const findings = runCategory({
    expenses: { 'Home: Repairs': amounts([-1, -1, -1]), 'Car: Repairs': amounts([-2, -2, -2]), 'Car: Fuel': amounts([-3, -3, -3]) },
    table: categoryTable([['Repairs'], ['Fuel'], ...TOTAL_LABELS]),
  });
  assert.deepEqual(problems(findings), ['fix:Detailed name under more than one primary:Repairs']);
  assert.equal(findings[0].name, 'Car: Repairs');
});

test('a category with no detailed name cannot be looked up', () => {
  const findings = runCategory({ expenses: { Gifts: amounts([-25, 0, 0]), 'Food: Dining': amounts([0, 0, 0]) }, table: categoryTable([['Dining'], ...TOTAL_LABELS]) });
  assert.deepEqual(problems(findings), ['fix:Category has no detailed name:']);
  assert.equal(findings[0].name, 'Gifts');
});

test('a table row whose category lands below the lookup range is flagged; rows inside it are not', () => {
  const expenses = {};
  const tableRows = [];
  for (let index = 0; index < 250; index++) {
    expenses[`Bulk: Item ${index}`] = amounts([-1, -1, -1]);
    tableRows.push([`Item ${index}`]);
  }
  tableRows.push(['Total Spending']);
  const findings = runCategory({ expenses, table: categoryTable(tableRows) });
  const beyond = findings.filter(finding => finding.problem === 'Below the lookup range');
  // Rows 1 to 5 are the headers, two income totals and the Spending label, so
  // item 0 is on row 6 and item 243 is the first past row 248.
  assert.deepEqual(plain(beyond.map(finding => finding.key)), [
    'Item 243', 'Item 244', 'Item 245', 'Item 246', 'Item 247', 'Item 248', 'Item 249', 'Total Spending',
  ]);
  assert.match(beyond[0].detail, /row 249/);
  assert.ok(!findings.some(finding => finding.problem === 'Detailed name not in the report'));
  assert.ok(!findings.some(finding => finding.key === 'Item 242'));
});

const OLD_CATEGORIES = [
  ['', 'Primary Category', 'Detailed Category', '1/1/26 - 1/31/26', '2/1/26 - 2/28/26', '3/1/26 - 3/31/26', 'Total'],
  ['Earned Income', '', '', 'January', 'February', 'March'],
  ['Spending', '', '', '', '', ''],
  ['', 'Food', 'Groceries', -5, -6, -7, -18],
];

test('a different first month on the categories sheet is flagged', () => {
  const findings = runCategory({
    expenses: { 'Food: Groceries': amounts([-6, -7]) },
    table: categoryTable([['Groceries'], ...TOTAL_LABELS]),
    oldValues: OLD_CATEGORIES,
    periods: ['2/1/26 - 2/28/26', '3/1/26 - 3/31/26'],
  });
  assert.deepEqual(problems(findings), ['fix:First month moves:']);
});

test('a changed past month on the categories sheet is a note; an unchanged one is not', () => {
  const changed = runCategory({
    expenses: { 'Food: Groceries': amounts([-5, -16, -70]) },
    table: categoryTable([['Groceries'], ...TOTAL_LABELS]),
    oldValues: OLD_CATEGORIES,
  });
  assert.deepEqual(problems(changed), ['info:Past months changed:Groceries']);
  assert.equal(changed[0].detail, 'Feb 2026: -6.00 to -16.00');
  const same = runCategory({
    expenses: { 'Food: Groceries': amounts([-5, -6, -70]) },
    table: categoryTable([['Groceries'], ...TOTAL_LABELS]),
    oldValues: OLD_CATEGORIES,
  });
  assert.deepEqual(problems(same), []);
});

// ── The PF_CHECK sheet ───────────────────────────────────────

test('the check sheet says when and over which months, then lists fixes before notes', () => {
  const findings = [
    { sheet: 'Accounts', level: 'info', problem: 'B', key: '', name: '', detail: '', action: '' },
    { sheet: 'Accounts', level: 'fix', problem: 'A', key: '1', name: 'n', detail: 'd', action: 'a' },
  ];
  const rows = K.buildCheckSheetRows({
    checkedAt: new Date(2026, 10, 21, 9, 5),
    startMonth: '2025-11',
    endMonth: '2026-11',
    outcome: 'Checked',
    findings,
  });
  assert.equal(rows[0][0], 'Checked 2026-11-21 09:05, months Nov 2025 to Nov 2026. 1 to fix, 1 note.');
  assert.deepEqual(plain(rows[2]), ['Sheet', 'Level', 'Problem', 'Key', 'Name', 'Detail', 'What to do']);
  assert.deepEqual(plain(rows.slice(3).map(row => row[2])), ['A', 'B']);
  assert.ok(rows.every(row => row.length === 7));
});

test('a check with no findings says so', () => {
  const rows = K.buildCheckSheetRows({
    checkedAt: new Date(2026, 10, 21), startMonth: '2025-11', endMonth: '2026-11', outcome: 'Checked', findings: [],
  });
  assert.match(rows[0][0], /0 to fix, 0 notes/);
  assert.equal(rows[3][2], 'No problems found.');
});

test('a blocked paste names the cell in the way', () => {
  const finding = K.pasteBlockedFinding('PF_BALANCES', { rowIndex: 40, columnIndex: 0, address: 'A41' });
  assert.equal(finding.level, 'fix');
  assert.equal(finding.key, 'A41');
  assert.match(finding.detail, /Nothing was pasted/);
});

// ── The whole workbook ───────────────────────────────────────

const { collectWorkbookFindings } = loadFiles(
  ['shared/fiscal-year.js', 'shared/report-grid.js', 'excel/constants.js', 'excel/cells.js', 'excel/default-range.js', 'excel/checks.js'],
  'collectWorkbookFindings',
);

function workbookInput(overrides) {
  return {
    balanceGrid: balanceGrid([account('Elm Checking', '5747', ['1', '1', '1'])]),
    categoryGrid: K.buildCategoryReportGrid(categoryData({ 'Food: Groceries': amounts([-1, -1, -1]) })),
    balanceValues: [],
    categoryValues: [],
    accountSheet: { tables: [{ headerRow: ['lookup mask', 'Retired account flag'], bodyRows: [[5747, '']], firstDataRow: 2 }], usedValues: [], usedFirstRow: 1 },
    categorySheet: { tables: [], usedValues: [['Budget'], ['PF Detailed Category', 'RETIRED CATEGORY FLAG'], ['Groceries', ''], ...TOTAL_LABELS], usedFirstRow: 1 },
    currentMonth: CURRENT_MONTH,
    pasting: false,
    ...overrides,
  };
}

test('a workbook whose tables hold every key has no findings, read from a table or from plain cells', () => {
  assert.deepEqual(problems(collectWorkbookFindings(workbookInput({}))), []);
});

test('a missing paste sheet needs a fix on a check and is a note when the paste creates it', () => {
  assert.deepEqual(problems(collectWorkbookFindings(workbookInput({ balanceValues: null }))), ['fix:Sheet not found:']);
  assert.deepEqual(problems(collectWorkbookFindings(workbookInput({ balanceValues: null, pasting: true }))), ['info:Sheet created:']);
});

test('a missing Categories sheet is one finding, not one per category', () => {
  const findings = collectWorkbookFindings(workbookInput({ categorySheet: null }));
  assert.deepEqual(problems(findings), ['fix:Sheet not found:']);
  assert.equal(findings[0].sheet, 'Categories');
});

test('the status line names a blocked paste first, then the tally', () => {
  const { describeWorkbookRun } = loadFiles(
    ['shared/fiscal-year.js', 'shared/report-grid.js', 'excel/constants.js', 'excel/cells.js', 'excel/default-range.js', 'excel/checks.js'],
    'describeWorkbookRun',
  );
  const fix = { level: 'fix' };
  const info = { level: 'info' };
  assert.deepEqual(plain(describeWorkbookRun({ findings: [fix], pasted: false, blocked: [{ sheet: 'PF_BALANCES', address: 'A41' }] }, true)), {
    message: 'Nothing pasted: PF_BALANCES cell A41 is in the way. See PF_CHECK.', tone: 'error',
  });
  assert.deepEqual(plain(describeWorkbookRun({ findings: [fix, info], pasted: true, blocked: [] }, true)), {
    message: 'Pasted both sheets; 1 to fix, 1 note. See PF_CHECK.', tone: 'warning',
  });
  assert.deepEqual(plain(describeWorkbookRun({ findings: [], pasted: false, blocked: [] }, false)), {
    message: 'Checked: no problems found. See PF_CHECK.', tone: 'success',
  });
});
