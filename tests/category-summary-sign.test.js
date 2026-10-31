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

const { getAnalyticsSignedDisplay: signed } = load(
  'transactions/analytics.js',
  'getAnalyticsSignedDisplay',
);

const MINUS = '−';

// Raw totals use the ledger sign: positive is money in, negative is money out.

test('net inflow shows a plus and positive tone in every context', () => {
  for (const mode of ['spending', 'income', 'signed']) {
    assert.deepEqual({ ...signed(1, mode) }, { text: '+$1.00', tone: 'positive' });
  }
});

test('spending outflow stays unsigned and neutral', () => {
  assert.deepEqual({ ...signed(-1234.5, 'spending') }, { text: '$1,234.50', tone: 'neutral' });
});

test('outflow in income and signed contexts shows a minus and negative tone', () => {
  assert.deepEqual({ ...signed(-1, 'income') }, { text: `${MINUS}$1.00`, tone: 'negative' });
  assert.deepEqual({ ...signed(-1, 'signed') }, { text: `${MINUS}$1.00`, tone: 'negative' });
});

test('zero is unsigned and neutral in every context', () => {
  for (const mode of ['spending', 'income', 'signed']) {
    assert.deepEqual({ ...signed(0, mode) }, { text: '$0.00', tone: 'neutral' });
  }
  assert.deepEqual({ ...signed(-0, 'signed') }, { text: '$0.00', tone: 'neutral' });
});

test('a sub-cent remainder from float sums counts as zero', () => {
  assert.deepEqual({ ...signed(0.004, 'income') }, { text: '$0.00', tone: 'neutral' });
  assert.deepEqual({ ...signed(-0.004, 'signed') }, { text: '$0.00', tone: 'neutral' });
});

test('a spending category with a net refund shows a plus', () => {
  assert.deepEqual({ ...signed(250, 'spending') }, { text: '+$250.00', tone: 'positive' });
});

test('an investment loss shows a minus, a gain a plus', () => {
  assert.deepEqual({ ...signed(-58805.89, 'signed') }, { text: `${MINUS}$58,805.89`, tone: 'negative' });
  assert.deepEqual({ ...signed(58805.89, 'signed') }, { text: '+$58,805.89', tone: 'positive' });
});

test('summary groups read income first, then signed, then spending, each largest first', () => {
  const { compareCategorySummaryGroups } = load('transactions/analytics.js', 'compareCategorySummaryGroups');
  const groups = [
    { category: 'Monthly', display_mode: 'spending', total: -41863.54 },
    { category: 'Inflows', display_mode: 'income', total: 25234.7 },
    { category: 'Retirement', display_mode: 'signed', total: 43793.51 },
    { category: 'Income', display_mode: 'income', total: 141577.98 },
    { category: 'Investments', display_mode: 'signed', total: 58805.89 },
    { category: 'Pets', display_mode: 'spending', total: -649.37 },
  ];
  const order = [...groups].sort(compareCategorySummaryGroups).map(group => group.category);
  assert.deepEqual(order, ['Income', 'Inflows', 'Investments', 'Retirement', 'Monthly', 'Pets']);
});

const retirementEntry = (primary, detailed, amount, analyticsClass = 'retirement_income') => ({
  analytics_class: analyticsClass, amount, primary_category: primary, detailed_category: detailed,
});

test('a group of only investment trend or retirement income rows is left out of the grid', () => {
  const { isStatCardOnlyEntries } = load('transactions/analytics.js', 'isStatCardOnlyEntries');
  assert.equal(isStatCardOnlyEntries([{ analytics_class: 'investment_trend' }]), true);
  assert.equal(isStatCardOnlyEntries([{ analytics_class: 'retirement_income' }]), true);
  assert.equal(isStatCardOnlyEntries([
    { analytics_class: 'investment_trend' }, { analytics_class: 'retirement_income' },
  ]), true);
  assert.equal(isStatCardOnlyEntries([
    { analytics_class: 'retirement_income' }, { analytics_class: 'spending' },
  ]), false);
  assert.equal(isStatCardOnlyEntries([{ analytics_class: 'income' }]), false);
  assert.equal(isStatCardOnlyEntries([]), false);
});

test('retirement lines are per detailed category, largest absolute amount first', () => {
  const { buildRetirementIncomeLines } = load('transactions/analytics.js', 'buildRetirementIncomeLines');
  const lines = buildRetirementIncomeLines([
    retirementEntry('Retirement', 'Pension', 100),
    retirementEntry('Retirement', 'Social Security', 2000),
    retirementEntry('Retirement', 'Pension', 50.25),
    retirementEntry('Retirement', 'Withdrawal', -3000),
    retirementEntry('Food', 'Groceries', -20, 'spending'),
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(lines)), [
    { name: 'Withdrawal', total: -3000 },
    { name: 'Social Security', total: 2000 },
    { name: 'Pension', total: 150.25 },
  ]);
});

test('retirement lines use the full label only where a detailed name repeats', () => {
  const { buildRetirementIncomeLines } = load('transactions/analytics.js', 'buildRetirementIncomeLines');
  const lines = buildRetirementIncomeLines([
    retirementEntry('Retirement', 'Pension', 500),
    retirementEntry('Other Retirement', 'Pension', 300),
    retirementEntry('Retirement', 'Annuity', 100),
  ]);
  assert.deepEqual([...lines.map(line => line.name)], [
    'Retirement: Pension', 'Other Retirement: Pension', 'Annuity',
  ]);
});

test('no retirement rows gives no lines', () => {
  const { buildRetirementIncomeLines } = load('transactions/analytics.js', 'buildRetirementIncomeLines');
  assert.equal(buildRetirementIncomeLines([retirementEntry('Food', 'Groceries', -5, 'spending')]).length, 0);
  assert.equal(buildRetirementIncomeLines([]).length, 0);
});

test('collapsed retirement lines show three and count the rest', () => {
  const { splitRetirementIncomeLines } = load('transactions/analytics.js', 'splitRetirementIncomeLines');
  const lines = [1, 2, 3, 4, 5].map(n => ({ name: `Line ${n}`, total: n }));

  const collapsed = splitRetirementIncomeLines(lines, false);
  assert.equal(collapsed.visible.length, 3);
  assert.equal(collapsed.hiddenCount, 2);

  const expanded = splitRetirementIncomeLines(lines, true);
  assert.equal(expanded.visible.length, 5);
  assert.equal(expanded.hiddenCount, 0);

  const few = splitRetirementIncomeLines(lines.slice(0, 3), false);
  assert.equal(few.visible.length, 3);
  assert.equal(few.hiddenCount, 0);
});

test('summary data names stat-card-only groups and lines without changing the exported fields', () => {
  const rows = [
    { transaction_id: 'a', amount: -50, user_category: 'Food: Groceries', analytics_class: 'spending' },
    { transaction_id: 'b', amount: 80, user_category: 'Investments: Trending Performance', analytics_class: 'investment_trend' },
    { transaction_id: 'c', amount: 200, user_category: 'Retirement: Pension', analytics_class: 'retirement_income' },
    { transaction_id: 'd', amount: 10, user_category: 'Mixed: Pension', analytics_class: 'retirement_income' },
    { transaction_id: 'e', amount: -5, user_category: 'Mixed: Fees', analytics_class: 'spending' },
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
  assert.deepEqual([...summary.stat_card_only_categories].sort(), ['Investments', 'Retirement']);
  assert.deepEqual(JSON.parse(JSON.stringify(summary.retirement_income_lines)), [
    { name: 'Retirement: Pension', total: 200 },
    { name: 'Mixed: Pension', total: 10 },
  ]);
  assert.equal(summary.retirement_income_total, 210);
  assert.equal(summary.categories.length, 4);
});
