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
  assert.equal(withTransfers.map(section => section.label).join(','), 'Transfers,Adjustments');
});

test('report separate sections follow D5 order and include retirement income and excluded', () => {
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
  assert.equal(labels.join(','), 'Transfers,Adjustments,Retirement Income,Investment Trend,Excluded');
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

test('category report CSV orders earned income, expenses, other inflow, total income, total, then separate sections', () => {
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
    other_inflows: cat('Other Inflow: Interest', [5]),
    total_other_inflows_row: [5],
    total_other_inflows_grand: 5,
    total_all_income_row: [105],
    total_all_income_grand: 105,
    total_row: [65],
    total_grand: 65,
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
    '"Earned Income"', '"Total Earned Income"', '"Expenses"', '"Total Expenses"',
    '"Other Inflow"', '"Total Other Inflow"', '"Total Income"', ',,"Total"',
    '"Transfers"', '"Retirement Income"', '"Investment Trend"', '"Excluded"',
  ];
  const positions = marks.map(mark => csv.indexOf(mark));
  positions.forEach((pos, idx) => assert.notEqual(pos, -1, marks[idx]));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(csv, /,,"Total Income",105,105\n/);
  assert.match(csv, /,,"Total",65,65\n/);
});
