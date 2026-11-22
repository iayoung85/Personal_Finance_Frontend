const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'shared', 'budget-report.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// Results cross the vm boundary, so compare through JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function loadReport() {
  const sandbox = { module: { exports: {} }, Intl };
  vm.runInNewContext(
    `${source}\nmodule.exports = { formatBudgetMoney, formatBudgetDate, budgetTickPercent, `
      + 'buildBudgetBar, buildBudgetSectionRows, isBudgetReportEmpty, buildBudgetReportHtml };',
    sandbox,
    { filename: sourcePath },
  );
  return sandbox.module.exports;
}

const {
  formatBudgetMoney,
  formatBudgetDate,
  budgetTickPercent,
  buildBudgetBar,
  buildBudgetSectionRows,
  isBudgetReportEmpty,
  buildBudgetReportHtml,
} = loadReport();

const SPENDING = { kind: 'spending' };
const SAVINGS = { kind: 'savings' };

function entry(target, actual, extra = {}) {
  return { target, actual, remaining: Math.round((target - actual) * 100) / 100, ...extra };
}

function line(category, current, previous = null) {
  return { category, name: category.split(':')[1].trim(), current, previous };
}

const NOVEMBER = {
  label: 'Nov 2026', start: '2026-11-01', end: '2026-11-30',
  fiscal_year: 2027, days_elapsed: 21, days_total: 30,
};
const OCTOBER = {
  label: 'Oct 2026', start: '2026-10-01', end: '2026-10-31',
  fiscal_year: 2026, days_elapsed: 31, days_total: 31,
};

// ── Money ───────────────────────────────────────────────────

test('money is whole dollars, rounded for display', () => {
  assert.equal(formatBudgetMoney(600), '$600');
  assert.equal(formatBudgetMoney(307.22), '$307');
  assert.equal(formatBudgetMoney(1240.5), '$1,241');
  assert.equal(formatBudgetMoney(4037.84), '$4,038');
});

test('a negative amount keeps its sign, and a rounded zero has none', () => {
  assert.equal(formatBudgetMoney(-50), '-$50');
  assert.equal(formatBudgetMoney(-0), '$0');
  assert.equal(formatBudgetMoney(-0.4), '$0');
});

test('a gap that is real but rounds away says less than $1', () => {
  const barelyOver = plain(buildBudgetBar({ target: 600, actual: 600.4, remaining: -0.4 }, SPENDING));
  assert.equal(barelyOver.isOver, true);
  assert.equal(barelyOver.text, '$600 of $600, over by less than $1');

  const barelyLeft = plain(buildBudgetBar({ target: 600, actual: 599.7, remaining: 0.3 }, SPENDING));
  assert.equal(barelyLeft.text, '$600 of $600, less than $1 left');

  const exactlySpent = plain(buildBudgetBar({ target: 600, actual: 600, remaining: 0 }, SPENDING));
  assert.equal(exactlySpent.text, '$600 of $600, $0 left');

  const barelyPast = plain(buildBudgetBar({ target: 500, actual: 500.3, remaining: -0.3 }, SAVINGS));
  assert.equal(barelyPast.text, 'saved $500 of $500, goal met');
});

test('an ISO date reads as a calendar date', () => {
  assert.equal(formatBudgetDate('2026-11-21'), 'Nov 21, 2026');
  assert.equal(formatBudgetDate(''), '');
});

// ── Bars ────────────────────────────────────────────────────

test('spending under target fills spent over target and says what is left', () => {
  const bar = plain(buildBudgetBar(entry(600, 240), SPENDING));
  assert.equal(bar.tone, 'normal');
  assert.equal(bar.fillPercent, 40);
  assert.equal(bar.text, '$240 of $600, $360 left');
  assert.equal(bar.tickPercent, null);
});

test('over target the bar is full and red, says over by, and drops the pace word', () => {
  const bar = plain(buildBudgetBar(
    entry(600, 655, { pace: null, pace_amount: 420, pace_difference: 235 }),
    { ...SPENDING, tickPercent: 70 },
  ));
  assert.equal(bar.tone, 'over');
  assert.equal(bar.fillPercent, 100);
  assert.equal(bar.isOver, true);
  assert.equal(bar.text, '$655 of $600, over by $55');
  // The tick stays where today's pace is, even on a red bar.
  assert.equal(bar.tickPercent, 70);
});

test('pace words carry the gap without its sign', () => {
  const under = plain(buildBudgetBar(
    entry(700, 307.22, { pace: 'under', pace_amount: 490, pace_difference: -182.78 }),
    SPENDING,
  ));
  assert.equal(under.text, '$307 of $700, $393 left, under pace by $183');
  assert.equal(under.tone, 'normal');

  const over = plain(buildBudgetBar(
    entry(600, 460, { pace: 'over', pace_amount: 420, pace_difference: 40 }),
    SPENDING,
  ));
  assert.equal(over.text, '$460 of $600, $140 left, over pace by $40');
  assert.equal(over.tone, 'pace-over');
});

test('on pace prints no gap, even when the API sends -0.0', () => {
  const bar = plain(buildBudgetBar(
    entry(600, 420, { pace: 'on', pace_amount: 420, pace_difference: -0 }),
    SPENDING,
  ));
  assert.equal(bar.text, '$420 of $600, $180 left, on pace');
  assert.equal(bar.tone, 'normal');
});

test('a negative amount leaves the bar empty and prints the true amount', () => {
  const bar = plain(buildBudgetBar({ target: 600, actual: -50, remaining: 650 }, SPENDING));
  assert.equal(bar.fillPercent, 0);
  assert.equal(bar.isOver, false);
  assert.equal(bar.text, '-$50 of $600, $650 left');
});

test('a savings line under its goal fills green toward it and says what is to go', () => {
  const bar = plain(buildBudgetBar(entry(1000, 500), SAVINGS));
  assert.equal(bar.tone, 'savings');
  assert.equal(bar.fillPercent, 50);
  assert.equal(bar.isMet, false);
  assert.equal(bar.text, 'saved $500 of $1,000, $500 to go');
  assert.equal(bar.tickPercent, null);
});

test('a savings line past its goal is full, says goal met and by how much', () => {
  const past = plain(buildBudgetBar(entry(1000, 1200), SAVINGS));
  assert.equal(past.fillPercent, 100);
  assert.equal(past.isMet, true);
  assert.equal(past.isOver, false);
  assert.equal(past.text, 'saved $1,200 of $1,000, goal met, $200 past it');

  const exact = plain(buildBudgetBar(entry(1000, 1000), SAVINGS));
  assert.equal(exact.text, 'saved $1,000 of $1,000, goal met');
});

test('the tick sits at the share of the month gone', () => {
  assert.equal(budgetTickPercent(NOVEMBER), 70);
  assert.equal(budgetTickPercent({ days_elapsed: 1, days_total: 31 }).toFixed(3), '3.226');
  assert.equal(budgetTickPercent(OCTOBER), 100);
  assert.equal(budgetTickPercent({ days_elapsed: 0, days_total: 0 }), null);
});

// ── Nesting ─────────────────────────────────────────────────

test('a primary with its own target is a line with its details nested under it', () => {
  const rows = plain(buildBudgetSectionRows({
    groups: [{
      primary: 'Food And Drink', kind: 'spending',
      own: { current: entry(900, 512.4), previous: null },
      lines: [line('Food And Drink: Dining', entry(600, 240))],
    }],
  }));
  assert.deepEqual(rows.map(row => [row.type, row.label, row.depth, row.isPrimary, row.groupPosition]), [
    ['line', 'Food And Drink', 0, true, 'first'],
    ['line', 'Food And Drink: Dining', 1, false, 'last'],
  ]);
  assert.equal(rows[0].previous, null);
  assert.equal(rows[0].primaryPart, undefined);
  assert.deepEqual([rows[1].primaryPart, rows[1].detailPart], ['Food And Drink', 'Dining']);
});

test('details under a primary with no target are one group of full names, with no heading row', () => {
  const rows = plain(buildBudgetSectionRows({
    groups: [{
      primary: 'Food And Drink', kind: 'spending', own: null,
      lines: [
        line('Food And Drink: Dining', entry(600, 240)),
        line('Food And Drink: Groceries', entry(700, 307.22)),
        line('Food And Drink: Snacks', entry(50, 10)),
      ],
    }],
  }));
  assert.deepEqual(rows.map(row => [row.type, row.label, row.depth, row.groupPosition]), [
    ['line', 'Food And Drink: Dining', 0, 'first'],
    ['line', 'Food And Drink: Groceries', 0, 'middle'],
    ['line', 'Food And Drink: Snacks', 0, 'last'],
  ]);
});

test('one detail alone is one flat Primary: Detailed line', () => {
  const rows = plain(buildBudgetSectionRows({
    groups: [{
      primary: 'Travel', kind: 'spending', own: null,
      lines: [line('Travel: Flights', null, entry(300, 120))],
    }],
  }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'line');
  assert.equal(rows[0].label, 'Travel: Flights');
  assert.equal(rows[0].depth, 0);
  assert.equal(rows[0].groupPosition, 'single');
  assert.equal(rows[0].current, null);
  assert.equal(rows[0].previous.target, 300);
});

test('a kind row opens each kind only when a section holds both', () => {
  const spendingOnly = plain(buildBudgetSectionRows({
    groups: [{ primary: 'Travel', kind: 'spending', own: { current: entry(1, 0), previous: null }, lines: [] }],
  }));
  assert.equal(spendingOnly.some(row => row.type === 'kind'), false);

  const both = plain(buildBudgetSectionRows({
    groups: [
      { primary: 'Travel', kind: 'spending', own: { current: entry(1, 0), previous: null }, lines: [] },
      { primary: 'Savings', kind: 'savings', own: { current: entry(1, 0), previous: null }, lines: [] },
    ],
  }));
  assert.deepEqual(both.filter(row => row.type === 'kind').map(row => row.kind), ['spending', 'savings']);
});

// ── Whole report ────────────────────────────────────────────

function reportWith(monthlyGroups, annualGroups = []) {
  return {
    today: '2026-11-21',
    monthly: { current: NOVEMBER, previous: OCTOBER, groups: monthlyGroups },
    annual: {
      current: { label: 'FY2027', start: '2026-11-01', end: '2027-10-31', fiscal_year: 2027, days_elapsed: 21, days_total: 365 },
      previous: { label: 'FY2026', start: '2025-11-01', end: '2026-10-31', fiscal_year: 2026, days_elapsed: 365, days_total: 365 },
      groups: annualGroups,
    },
  };
}

test('a report with no target at all draws the empty state with a way to Targets', () => {
  const report = reportWith([], []);
  assert.equal(isBudgetReportEmpty(report), true);
  const html = buildBudgetReportHtml(report, { targetsHref: '#targets' });
  assert.match(html, /No budget targets yet/);
  assert.match(html, /href="#targets" data-budget-action="targets"/);
});

test('a period with no target is a dash labelled No target, and an empty section points to Targets', () => {
  const html = buildBudgetReportHtml(reportWith([{
    primary: 'Travel', kind: 'spending', own: null,
    lines: [line('Travel: Flights', null, entry(300, 120))],
  }]));
  assert.match(html, /aria-label="No target">—</);
  assert.match(html, /No annual targets/);
  assert.doesNotMatch(html, /No monthly targets/);
});

test('the tick and the key are drawn on this month spending bars only', () => {
  const html = buildBudgetReportHtml(reportWith(
    [
      {
        primary: 'Food', kind: 'spending', own: null,
        lines: [line('Food: Dining', entry(600, 240, { pace: 'under', pace_amount: 420, pace_difference: -180 }), entry(600, 500))],
      },
      { primary: 'Savings', kind: 'savings', own: null, lines: [line('Savings: Emergency', entry(1000, 500))] },
    ],
    [{ primary: 'Food', kind: 'spending', own: null, lines: [line('Food: Dining', entry(6000, 2000), entry(6000, 5800))] }],
  ));
  assert.equal((html.match(/class="bt-tick"/g) || []).length, 1);
  assert.match(html, /class="bt-tick" style="left:70\.00%"/);
  assert.match(html, /The tick marks today&#39;s pace/);
  assert.match(html, /As of Nov 21, 2026/);
});

test('category text is escaped', () => {
  const html = buildBudgetReportHtml(reportWith([{
    primary: 'Fun <b>', kind: 'spending', own: { current: entry(10, 1), previous: null }, lines: [],
  }]));
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /Fun &lt;b&gt;/);
});

test('the drawn text is in whole dollars', () => {
  const report = reportWith([{ primary: 'Travel', kind: 'spending', own: { current: entry(600, 240.49), previous: null }, lines: [] }]);
  assert.match(buildBudgetReportHtml(report), /\$240 of \$600/);
});
