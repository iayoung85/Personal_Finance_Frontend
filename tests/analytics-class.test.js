const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relPath, exportsList, extraSandbox = {}) {
  const file = path.join(__dirname, '..', relPath);
  const sandbox = { module: { exports: {} }, console, ...extraSandbox };
  vm.runInNewContext(
    `${fs.readFileSync(file, 'utf8')}\nmodule.exports = { ${exportsList} };`,
    sandbox,
    { filename: file },
  );
  return sandbox.module.exports;
}

const A = load('transactions/analytics.js', [
  'ANALYTICS_DISPLAY_MODE', 'getAnalyticsModeForClass', 'isAnalyticsCountedClass',
  'getAnalyticsDisplayModeForEntries', 'getAnalyticsDisplayTotal',
  'getAnalyticsAverageDisplayAmount', 'getAnalyticsDisplayAmount',
].join(', '));

const entry = (analytics_class, amount) => ({ analytics_class, amount });

test('class to mode mapping', () => {
  assert.equal(A.getAnalyticsModeForClass('spending'), 'spending');
  assert.equal(A.getAnalyticsModeForClass('income'), 'income');
  assert.equal(A.getAnalyticsModeForClass('investment_trend'), 'signed');
});

test('other inflow shows like income, retirement income like investment trend', () => {
  assert.equal(A.getAnalyticsModeForClass('other_inflow'), 'income');
  assert.equal(A.getAnalyticsModeForClass('retirement_income'), 'signed');
  assert.equal(A.isAnalyticsCountedClass('other_inflow'), true);
  assert.equal(A.isAnalyticsCountedClass('retirement_income'), true);
  assert.equal(A.getAnalyticsDisplayTotal(40, [entry('other_inflow', 40)]), 40);
  assert.equal(A.getAnalyticsDisplayTotal(-9, [entry('retirement_income', -9)]), -9);
  assert.equal(A.getAnalyticsAverageDisplayAmount([
    entry('other_inflow', 10), entry('other_inflow', 30), entry('other_inflow', -5),
  ]), 20);
});

test('savings counts in the spending display mode', () => {
  assert.equal(A.getAnalyticsModeForClass('savings'), 'spending');
  assert.equal(A.isAnalyticsCountedClass('savings'), true);
  assert.equal(A.getAnalyticsDisplayTotal(-300, [entry('savings', -300)]), 300);
});

test('transfer, adjustment, excluded are not counted', () => {
  for (const cls of ['transfer', 'adjustment', 'excluded']) {
    assert.equal(A.isAnalyticsCountedClass(cls), false, cls);
  }
});

test('unknown, missing, and odd class values are not counted and do not throw', () => {
  for (const cls of ['future_class', '', null, undefined, 42, 'toString', '__proto__']) {
    assert.equal(A.getAnalyticsModeForClass(cls), null, String(cls));
    assert.equal(A.isAnalyticsCountedClass(cls), false, String(cls));
  }
  assert.equal(A.getAnalyticsDisplayModeForEntries([entry('future_class', -50)]), 'spending');
});

test('mixed classes: largest absolute amount wins, ties go spending first', () => {
  assert.equal(A.getAnalyticsDisplayModeForEntries([
    entry('spending', -10), entry('income', 100),
  ]), 'income');
  assert.equal(A.getAnalyticsDisplayModeForEntries([
    entry('income', 40), entry('spending', -40),
  ]), 'spending');
  assert.equal(A.getAnalyticsDisplayModeForEntries([
    entry('investment_trend', 5), entry('spending', -1), entry('transfer', -9999),
  ]), 'signed');
  assert.equal(A.getAnalyticsDisplayModeForEntries([]), 'spending');
});

test('display total flips sign only for spending', () => {
  assert.equal(A.getAnalyticsDisplayTotal(-120, [entry('spending', -120)]), 120);
  assert.equal(A.getAnalyticsDisplayTotal(300, [entry('income', 300)]), 300);
  assert.equal(A.getAnalyticsDisplayTotal(-7, [entry('investment_trend', -7)]), -7);
});

test('average uses the direction of the category mode', () => {
  assert.equal(A.getAnalyticsAverageDisplayAmount([
    entry('spending', -10), entry('spending', -30), entry('spending', 5),
  ]), 20);
  assert.equal(A.getAnalyticsAverageDisplayAmount([
    entry('income', 100), entry('income', 300), entry('income', -50),
  ]), 200);
  assert.equal(A.getAnalyticsAverageDisplayAmount([entry('spending', 5)]), null);
});

test('category summary counts only counted classes', () => {
  const rows = [
    { transaction_id: 'a', amount: -50, user_category: 'Food: Groceries', analytics_class: 'spending' },
    { transaction_id: 'b', amount: 1000, user_category: 'Income: Wages', analytics_class: 'income' },
    { transaction_id: 'c', amount: -200, user_category: '[Transfer] Savings', analytics_class: 'transfer' },
    { transaction_id: 'd', amount: 9, user_category: 'Adjustment', analytics_class: 'adjustment' },
    { transaction_id: 'e', amount: 80, user_category: 'Whatever', analytics_class: 'investment_trend' },
    { transaction_id: 'f', amount: -5, user_category: 'Food: Snacks', analytics_class: 'future_class' },
  ];
  const sandbox = {
    visibleTransactions: rows,
    selectedAccountMode: 'single',
    TXN_TYPE: { SPLIT_CHILD: 'SPLIT_CHILD', BILL_FUTURE: 'BILL_FUTURE', MANUAL_FUTURE: 'MANUAL_FUTURE', MANUAL_ORPHANED: 'MANUAL_ORPHANED' },
    getTransactionType: () => 'PLAID_POSTED',
    isSystemType: () => false,
    parseCategoryString: label => {
      const [primary, detailed] = label.split(': ');
      return { primary, detailed };
    },
    getCategoryDisplayNames: () => ({}),
    getAppConfig: () => ({ trackedInsightCategories: [] }),
  };
  const { buildVisibleCategorySummaryData } = load(
    'transactions/analytics.js', 'buildVisibleCategorySummaryData', sandbox,
  );
  const summary = buildVisibleCategorySummaryData();
  assert.equal(summary.spending_total, -50);
  assert.equal(summary.income_total, 1000);
  assert.equal(summary.investment_trending_total, 80);
  assert.equal(summary.transaction_count, 3);
  assert.equal(summary.grand_total, 1030);
});

test('category summary gives other inflow and retirement income their own totals', () => {
  const rows = [
    { transaction_id: 'a', amount: -50, user_category: 'Food: Groceries', analytics_class: 'spending' },
    { transaction_id: 'b', amount: 1000, user_category: 'Income: Wages', analytics_class: 'income' },
    { transaction_id: 'c', amount: 30, user_category: 'Other Inflow: Interest', analytics_class: 'other_inflow' },
    { transaction_id: 'd', amount: 12.5, user_category: 'Other Inflow: Gifts', analytics_class: 'other_inflow' },
    { transaction_id: 'e', amount: 200, user_category: 'Retirement Income: Pension', analytics_class: 'retirement_income' },
    { transaction_id: 'f', amount: 80, user_category: 'Whatever', analytics_class: 'investment_trend' },
  ];
  const sandbox = {
    visibleTransactions: rows,
    selectedAccountMode: 'single',
    TXN_TYPE: { SPLIT_CHILD: 'SPLIT_CHILD', BILL_FUTURE: 'BILL_FUTURE', MANUAL_FUTURE: 'MANUAL_FUTURE', MANUAL_ORPHANED: 'MANUAL_ORPHANED' },
    getTransactionType: () => 'PLAID_POSTED',
    isSystemType: () => false,
    parseCategoryString: label => {
      const [primary, detailed] = label.split(': ');
      return { primary, detailed };
    },
    getCategoryDisplayNames: () => ({}),
    getAppConfig: () => ({ trackedInsightCategories: [] }),
  };
  const { buildVisibleCategorySummaryData, buildNormalizedAnalyticsSlice } = load(
    'transactions/analytics.js', 'buildVisibleCategorySummaryData, buildNormalizedAnalyticsSlice', sandbox,
  );
  const summary = buildVisibleCategorySummaryData();
  assert.equal(summary.spending_total, -50);
  assert.equal(summary.income_total, 1000);
  assert.equal(summary.other_inflow_total, 42.5);
  assert.equal(summary.all_income_total, 1042.5);
  assert.equal(summary.retirement_income_total, 200);
  assert.equal(summary.investment_trending_total, 80);
  assert.equal(summary.transaction_count, 6);
  // Every counted class, retirement income included, as before.
  assert.equal(summary.grand_total, 1272.5);
  const other = summary.categories.find(category => category.category === 'Other Inflow');
  assert.equal(other.display_mode, 'income');
  const retirement = summary.categories.find(category => category.category === 'Retirement Income');
  assert.equal(retirement.display_mode, 'signed');
  // The spending insight still counts spending rows only.
  assert.equal(buildNormalizedAnalyticsSlice().spendingEntries.length, 1);
});

const SUMMARY_TXN_TYPE = { SPLIT_CHILD: 'SPLIT_CHILD', BILL_FUTURE: 'BILL_FUTURE', MANUAL_FUTURE: 'MANUAL_FUTURE', MANUAL_ORPHANED: 'MANUAL_ORPHANED' };

function loadSummary(rows) {
  return load('transactions/analytics.js', 'buildVisibleCategorySummaryData, buildNormalizedAnalyticsSlice', {
    visibleTransactions: rows,
    selectedAccountMode: 'single',
    TXN_TYPE: SUMMARY_TXN_TYPE,
    getTransactionType: () => 'PLAID_POSTED',
    isSystemType: () => false,
    parseCategoryString: label => {
      const [primary, detailed] = label.split(': ');
      return { primary, detailed };
    },
    getCategoryDisplayNames: () => ({}),
    getAppConfig: () => ({ trackedInsightCategories: [] }),
  });
}

test('category summary gives savings its own total and total outflow is spending plus savings', () => {
  const { buildVisibleCategorySummaryData, buildNormalizedAnalyticsSlice } = loadSummary([
    { transaction_id: 'a', amount: -50, user_category: 'Food: Groceries', analytics_class: 'spending' },
    { transaction_id: 'b', amount: -300, user_category: 'Savings: Deposit', analytics_class: 'savings' },
    { transaction_id: 'c', amount: 40, user_category: 'Savings: Withdrawal', analytics_class: 'savings' },
    { transaction_id: 'd', amount: 1000, user_category: 'Income: Wages', analytics_class: 'income' },
  ]);
  const summary = buildVisibleCategorySummaryData();
  // Spending is spending only; a withdrawal filed under savings reduces savings.
  assert.equal(summary.spending_total, -50);
  assert.equal(summary.savings_total, -260);
  assert.equal(summary.all_outflow_total, -310);
  assert.equal(summary.all_income_total, 1000);
  assert.equal(summary.grand_total, 690);
  assert.equal(summary.transaction_count, 4);
  const savings = summary.categories.find(category => category.category === 'Savings');
  assert.equal(savings.display_mode, 'spending');

  const slice = buildNormalizedAnalyticsSlice();
  assert.equal(slice.spendingEntries.length, 1);
  assert.equal(slice.savingsEntries.length, 2);
  assert.equal(slice.outflowEntries.length, 3);
});

test('an unknown class counts in no total, savings included in none by accident', () => {
  const { buildVisibleCategorySummaryData, buildNormalizedAnalyticsSlice } = loadSummary([
    { transaction_id: 'a', amount: -50, user_category: 'Food: Groceries', analytics_class: 'spending' },
    { transaction_id: 'b', amount: -7, user_category: 'Odd: Thing', analytics_class: 'future_class' },
    { transaction_id: 'c', amount: -8, user_category: 'Odd: Thing', analytics_class: null },
  ]);
  const summary = buildVisibleCategorySummaryData();
  assert.equal(summary.spending_total, -50);
  assert.equal(summary.savings_total, 0);
  assert.equal(summary.all_outflow_total, -50);
  assert.equal(summary.grand_total, -50);
  assert.equal(summary.transaction_count, 1);
  assert.equal(buildNormalizedAnalyticsSlice().outflowEntries.length, 1);
});

test('report savings section hides when empty, carries its subtotal, and follows show-inactive', () => {
  const { _getReportSavingsSection } = load('transactions/reports.js', '_getReportSavingsSection, _keepReportSectionsWithCategories, _filterReportCategories, _reportCategoryHasActivity');
  assert.equal(_getReportSavingsSection({ savings: {} }), null);
  assert.equal(_getReportSavingsSection({}), null);
  const data = {
    savings: { 'Savings: Deposit': { amounts: [-100, -50], total: -150 } },
    total_savings_row: [-100, -50],
    total_savings_grand: -150,
  };
  const found = _getReportSavingsSection(data);
  assert.equal(found.label, 'Savings');
  assert.equal(found.grandTotal, -150);
  assert.equal(found.totalRow.join(','), '-100,-50');
  const idle = { savings: { 'Savings: Deposit': { amounts: [0, 0], total: 0 } } };
  assert.notEqual(_getReportSavingsSection(idle, true), null);
  assert.equal(_getReportSavingsSection(idle, false), null);
});

test('cache schema check', () => {
  const { isTransactionCacheSchemaCurrent, TRANSACTION_CACHE_SCHEMA } = load(
    'transactions/utils.js', 'isTransactionCacheSchemaCurrent, TRANSACTION_CACHE_SCHEMA',
  );
  assert.equal(isTransactionCacheSchemaCurrent(undefined), false);
  assert.equal(isTransactionCacheSchemaCurrent(null), false);
  assert.equal(isTransactionCacheSchemaCurrent(TRANSACTION_CACHE_SCHEMA), true);
});

test('report separate sections hide when empty', () => {
  const { _getReportSeparateSections } = load('transactions/reports.js', '_getReportSeparateSections');
  const none = _getReportSeparateSections({ adjustments: {}, investment_trends: {} });
  assert.equal(none.length, 0);
  const some = _getReportSeparateSections({
    adjustments: {},
    investment_trends: { 'Investment Trend': { amounts: [1, 2], total: 3 } },
    total_investment_trends_row: [1, 2],
    total_investment_trends_grand: 3,
  });
  assert.equal(some.length, 1);
  assert.equal(some[0].label, 'Investment Trend');
  assert.equal(some[0].grandTotal, 3);
  assert.equal(_getReportSeparateSections({}).length, 0);
  const withTransfers = _getReportSeparateSections({
    transfers: { 'Transfer: Out': { amounts: [-5], total: -5 } },
    total_transfers_row: [-5],
    total_transfers_grand: -5,
    adjustments: { 'Adjustments: Fix': { amounts: [2], total: 2 } },
  });
  assert.equal(withTransfers.map(section => section.label).join(','), 'Adjustments,Transfers');
});

test('report separate sections put transfers last and include retirement income and excluded', () => {
  const { _getReportSeparateSections } = load('transactions/reports.js', '_getReportSeparateSections');
  const section = amounts => ({ 'A: B': { amounts, total: amounts.reduce((a, b) => a + b, 0) } });
  const labels = _getReportSeparateSections({
    excluded: section([1]),
    total_excluded_row: [1],
    total_excluded_grand: 1,
    investment_trends: section([2]),
    retirement_income: section([3]),
    total_retirement_income_row: [3],
    total_retirement_income_grand: 3,
    adjustments: section([4]),
    transfers: section([5]),
  }).map(entry => entry.label);
  assert.equal(labels.join(','), 'Adjustments,Retirement Income,Investment Trend,Excluded,Transfers');
  const retirement = _getReportSeparateSections({
    retirement_income: section([3]),
    total_retirement_income_row: [3],
    total_retirement_income_grand: 3,
  });
  assert.equal(retirement[0].grandTotal, 3);
  assert.equal(_getReportSeparateSections({ retirement_income: {}, excluded: {} }).length, 0);
});

test('report other inflow section hides when empty and carries its subtotal', () => {
  const { _getReportOtherInflowSection } = load('transactions/reports.js', '_getReportOtherInflowSection, _keepReportSectionsWithCategories');
  assert.equal(_getReportOtherInflowSection({ other_inflows: {} }), null);
  assert.equal(_getReportOtherInflowSection({}), null);
  const found = _getReportOtherInflowSection({
    other_inflows: { 'Other Inflow: Interest': { amounts: [4, 6], total: 10 } },
    total_other_inflows_row: [4, 6],
    total_other_inflows_grand: 10,
  });
  assert.equal(found.label, 'Other Inflow');
  assert.equal(found.grandTotal, 10);
  assert.equal(found.totalRow.join(','), '4,6');
});

test('category report CSV orders earned income, other inflow, total inflows, spending, savings, total outflow, total, then separate sections', () => {
  const { _generateCategoryCSV } = load('transactions/reports.js', '_generateCategoryCSV', {
    _csvEscape: value => String(value).replace(/"/g, '""'),
  });
  const cat = (name, amounts) => ({ [name]: { amounts, total: amounts.reduce((a, b) => a + b, 0) } });
  const csv = _generateCategoryCSV({
    periods: ['11/1/25 - 11/30/25'],
    income: cat('Income: Wages', [100]),
    total_income_row: [100],
    total_income_grand: 100,
    expenses: cat('Food: Groceries', [-40]),
    total_expenses_row: [-40],
    total_expenses_grand: -40,
    savings: cat('Savings: Deposit', [-25]),
    total_savings_row: [-25],
    total_savings_grand: -25,
    total_all_outflow_row: [-65],
    total_all_outflow_grand: -65,
    other_inflows: cat('Other Inflow: Interest', [5]),
    total_other_inflows_row: [5],
    total_other_inflows_grand: 5,
    total_all_income_row: [105],
    total_all_income_grand: 105,
    total_row: [40],
    total_grand: 40,
    transfers: cat('Transfer: Out', [-9]),
    total_transfers_row: [-9],
    total_transfers_grand: -9,
    retirement_income: cat('Retirement Income: Pension', [7]),
    total_retirement_income_row: [7],
    total_retirement_income_grand: 7,
    investment_trends: cat('Investment Trend', [2]),
    total_investment_trends_row: [2],
    total_investment_trends_grand: 2,
    excluded: cat('Parked: X', [1]),
    total_excluded_row: [1],
    total_excluded_grand: 1,
  });
  const marks = [
    '"Earned Income"', '"Total Earned Income"', '"Other Inflow"', '"Total Other Inflow"',
    '"Total Inflows"', '"Spending"', '"Total Spending"', '"Savings"', '"Total Savings"',
    '"Total Outflow"', ',,"Total"',
    '"Retirement Income"', '"Investment Trend"', '"Excluded"', '"Transfers"',
  ];
  const positions = marks.map(mark => csv.indexOf(mark));
  positions.forEach((pos, idx) => assert.notEqual(pos, -1, marks[idx]));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(csv, /,,"Total Inflows",105,105\n/);
  assert.match(csv, /,,"Total Spending",-40,-40\n/);
  assert.match(csv, /,,"Total Savings",-25,-25\n/);
  assert.match(csv, /,,"Total Outflow",-65,-65\n/);
  assert.match(csv, /,,"Total",40,40\n/);
  assert.ok(!csv.includes('Expenses') && !csv.includes('"Total Income"'));
});

test('category report CSV leaves the Savings section out when empty but keeps Total Outflow', () => {
  const { _generateCategoryCSV } = load('transactions/reports.js', '_generateCategoryCSV', {
    _csvEscape: value => String(value).replace(/"/g, '""'),
  });
  const csv = _generateCategoryCSV({
    periods: ['11/1/25 - 11/30/25'],
    income: {}, total_income_row: [0], total_income_grand: 0,
    expenses: { 'Food: Groceries': { amounts: [-40], total: -40 } },
    total_expenses_row: [-40], total_expenses_grand: -40,
    savings: {}, total_savings_row: [0], total_savings_grand: 0,
    total_all_outflow_row: [-40], total_all_outflow_grand: -40,
    total_all_income_row: [0], total_all_income_grand: 0,
    total_row: [-40], total_grand: -40,
  });
  assert.ok(!csv.includes('Savings'));
  assert.match(csv, /,,"Total Outflow",-40,-40\n/);
  // An older API with no outflow keys still gets a zero row, not "undefined".
  const older = _generateCategoryCSV({
    periods: ['11/1/25 - 11/30/25'],
    income: {}, total_income_row: [0], total_income_grand: 0,
    expenses: {}, total_expenses_row: [0], total_expenses_grand: 0,
    total_row: [0], total_grand: 0,
  });
  assert.match(older, /,,"Total Outflow",0\n/);
  assert.ok(!older.includes('undefined'));
});

const REPORT_EXPORTS = [
  '_getReportSavingsSection', '_reportCategoryHasActivity', '_filterReportCategories', '_getReportSeparateSections',
  '_getReportOtherInflowSection', '_generateCategoryCSV',
].join(', ');
const loadReports = () => load('transactions/reports.js', REPORT_EXPORTS, {
  _csvEscape: value => String(value).replace(/"/g, '""'),
});

test('report category filter drops all-zero rows only when inactive categories are hidden', () => {
  const { _filterReportCategories } = loadReports();
  const rows = {
    'Food: Groceries': { amounts: [-40, 0], total: -40 },
    'Food: Dining': { amounts: [0, 0], total: 0 },
    'Misc: Nets Out': { amounts: [5, -5], total: 0 },
  };
  assert.equal(Object.keys(_filterReportCategories(rows, true)).join(','), 'Food: Groceries,Food: Dining,Misc: Nets Out');
  assert.equal(Object.keys(_filterReportCategories(rows, false)).join(','), 'Food: Groceries,Misc: Nets Out');
  assert.equal(Object.keys(_filterReportCategories(undefined, false)).length, 0);
});

test('report category with any non-zero period counts as active', () => {
  const { _reportCategoryHasActivity } = loadReports();
  assert.equal(_reportCategoryHasActivity({ amounts: [0, 0, 3] }), true);
  assert.equal(_reportCategoryHasActivity({ amounts: [0, 0, 0] }), false);
  assert.equal(_reportCategoryHasActivity({ amounts: [] }), false);
});

test('report section hides when every row is filtered out, and keeps its subtotal otherwise', () => {
  const { _getReportSeparateSections, _getReportOtherInflowSection } = loadReports();
  const data = {
    adjustments: { 'Adjustments: Fix': { amounts: [0], total: 0 } },
    total_adjustments_row: [0],
    total_adjustments_grand: 0,
    transfers: {
      'Transfer: Out': { amounts: [-9], total: -9 },
      'Transfer: In': { amounts: [0], total: 0 },
    },
    total_transfers_row: [-9],
    total_transfers_grand: -9,
    other_inflows: { 'Other Inflow: Interest': { amounts: [0], total: 0 } },
  };
  assert.equal(_getReportSeparateSections(data, true).map(s => s.label).join(','), 'Adjustments,Transfers');
  const hidden = _getReportSeparateSections(data, false);
  assert.equal(hidden.map(s => s.label).join(','), 'Transfers');
  assert.equal(Object.keys(hidden[0].categories).join(','), 'Transfer: Out');
  assert.equal(hidden[0].grandTotal, -9);
  assert.equal(hidden[0].totalRow.join(','), '-9');
  assert.notEqual(_getReportOtherInflowSection(data, true), null);
  assert.equal(_getReportOtherInflowSection(data, false), null);
  assert.equal(_getReportSeparateSections(data).length, 2);
});

test('category report CSV follows the show-inactive choice', () => {
  const { _generateCategoryCSV } = loadReports();
  const data = {
    periods: ['11/1/25 - 11/30/25', '12/1/25 - 12/31/25'],
    income: { 'Income: Wages': { amounts: [100, 0], total: 100 }, 'Income: Bonus': { amounts: [0, 0], total: 0 } },
    total_income_row: [100, 0],
    total_income_grand: 100,
    expenses: { 'Food: Groceries': { amounts: [0, 0], total: 0 }, 'Food: Dining': { amounts: [0, -4], total: -4 } },
    total_expenses_row: [0, -4],
    total_expenses_grand: -4,
    savings: { 'Savings: Deposit': { amounts: [0, 0], total: 0 } },
    total_savings_row: [0, 0],
    total_savings_grand: 0,
    total_all_outflow_row: [0, -4],
    total_all_outflow_grand: -4,
    other_inflows: { 'Other Inflow: Interest': { amounts: [0, 0], total: 0 } },
    total_other_inflows_row: [0, 0],
    total_other_inflows_grand: 0,
    total_all_income_row: [100, 0],
    total_all_income_grand: 100,
    total_row: [100, -4],
    total_grand: 96,
    transfers: { 'Transfer: Out': { amounts: [0, 0], total: 0 } },
    total_transfers_row: [0, 0],
    total_transfers_grand: 0,
  };
  const shown = _generateCategoryCSV(data, true);
  for (const name of ['Bonus', 'Groceries', 'Interest', 'Out', '"Other Inflow"', '"Transfers"', '"Savings"', 'Deposit']) {
    assert.ok(shown.includes(name), name);
  }
  assert.equal(_generateCategoryCSV(data), shown);
  const hidden = _generateCategoryCSV(data, false);
  for (const name of ['Bonus', 'Groceries', 'Interest', '"Out"', '"Other Inflow"', '"Transfers"', '"Savings"', 'Deposit']) {
    assert.ok(!hidden.includes(name), name);
  }
  assert.ok(hidden.includes('"Wages"') && hidden.includes('"Dining"'));
  assert.match(hidden, /,,"Total Earned Income",100,0,100\n/);
  assert.match(hidden, /,,"Total Spending",0,-4,-4\n/);
});
