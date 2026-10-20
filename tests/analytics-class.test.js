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

test('transfer, adjustment, excluded are not counted', () => {
  for (const cls of ['transfer', 'adjustment', 'excluded']) {
    assert.equal(A.isAnalyticsCountedClass(cls), false, cls);
  }
});

test('unknown, missing, and odd class values are not counted and do not throw', () => {
  for (const cls of ['other_inflow', '', null, undefined, 42, 'toString', '__proto__']) {
    assert.equal(A.getAnalyticsModeForClass(cls), null, String(cls));
    assert.equal(A.isAnalyticsCountedClass(cls), false, String(cls));
  }
  assert.equal(A.getAnalyticsDisplayModeForEntries([entry('other_inflow', -50)]), 'spending');
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
    { transaction_id: 'f', amount: -5, user_category: 'Food: Snacks', analytics_class: 'other_inflow' },
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
});
