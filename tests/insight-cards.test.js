const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relPaths, exportsList, extraSandbox = {}) {
  const files = Array.isArray(relPaths) ? relPaths : [relPaths];
  const source = files
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...extraSandbox };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return sandbox.module.exports;
}

const A = load('transactions/analytics.js', [
  'normalizeInsightCards', 'normalizeInsightCardDetailLabel',
  'filterEntriesForInsightCard', 'getInsightCardAverageLines', 'getInsightCardFlowSummary',
].join(', '));

const row = (primary_category, detailed_category, analytics_class, amount) => ({
  primary_category, detailed_category, analytics_class, amount,
});

// ── Normalization from config ──────────────────────────────────

test('insight cards from config are trimmed, deduped, and capped at three', () => {
  const cards = A.normalizeInsightCards([
    { name: '  Total income ', primaries: ['Income', ' Income ', 'Inflows', 7], details: [] },
    { name: 'Food', primaries: [], details: ['Food:Groceries', 'Food: Groceries', 'Food'] },
    { name: 'Third', primaries: ['Travel'] },
    { name: 'Fourth', primaries: ['Shopping'], details: [] },
  ]);
  assert.equal(JSON.stringify(cards), JSON.stringify([
    { name: 'Total income', primaries: ['Income', 'Inflows'], details: [] },
    { name: 'Food', primaries: [], details: ['Food: Groceries'] },
    { name: 'Third', primaries: ['Travel'], details: [] },
  ]));
});

test('cards without a name or without members, and odd values, are dropped', () => {
  assert.equal(JSON.stringify(A.normalizeInsightCards([
    { name: '', primaries: ['Income'] },
    { name: 'Empty', primaries: [], details: [] },
    null,
    'Income',
    { name: 'Kept', primaries: ['Income'] },
  ])), JSON.stringify([{ name: 'Kept', primaries: ['Income'], details: [] }]));
  assert.equal(A.normalizeInsightCards(undefined).length, 0);
  assert.equal(A.normalizeInsightCards({ name: 'x' }).length, 0);
});

test('detail labels normalize to "Primary: Detailed" or empty', () => {
  assert.equal(A.normalizeInsightCardDetailLabel(' Food :Groceries '), 'Food: Groceries');
  assert.equal(A.normalizeInsightCardDetailLabel('Food'), '');
  assert.equal(A.normalizeInsightCardDetailLabel('Food: '), '');
  assert.equal(A.normalizeInsightCardDetailLabel(null), '');
});

test('a slice with only the old preference key yields no cards', () => {
  const { getInsightCards } = load('transactions/analytics.js', 'getInsightCards', {
    getAppConfig: () => ({ trackedInsightCategories: ['Income'] }),
  });
  assert.equal(getInsightCards().length, 0);
});

// ── Card matching ──────────────────────────────────────────────

const ledger = [
  row('Income', 'Wages', 'income', 2000),
  row('Inflows', 'Interest', 'other_inflow', 15),
  row('Food', 'Groceries', 'spending', -80),
  row('Food', 'Restaurants', 'spending', -40),
  row('Travel', '', 'spending', -300),
];

test('a whole-primary member matches every row of that primary', () => {
  const matched = A.filterEntriesForInsightCard(ledger, { primaries: ['Income', 'Inflows'], details: [] });
  assert.equal(matched.length, 2);
  assert.equal(matched.reduce((sum, entry) => sum + entry.amount, 0), 2015);
});

test('a detail member matches only its "Primary: Detailed" rows', () => {
  const matched = A.filterEntriesForInsightCard(ledger, { primaries: [], details: ['Food: Groceries'] });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].amount, -80);
});

test('a row matching both a primary and a detail member counts once', () => {
  const matched = A.filterEntriesForInsightCard(ledger, {
    primaries: ['Food'],
    details: ['Food: Groceries', 'Travel: Flights'],
  });
  assert.equal(matched.length, 2);
  assert.equal(matched.reduce((sum, entry) => sum + entry.amount, 0), -120);
});

test('stale members match nothing and do not throw', () => {
  const matched = A.filterEntriesForInsightCard(ledger, {
    primaries: ['Old Name'],
    details: ['Food: Takeout', 'Travel: '],
  });
  assert.equal(matched.length, 0);
});

// ── Averages ───────────────────────────────────────────────────

const lines = entries => JSON.stringify(A.getInsightCardAverageLines(entries));

test('a mixed card shows an average credit from credits and an average debit from debits', () => {
  assert.equal(lines([
    row('Income', 'Wages', 'income', 1000),
    row('Income', 'Wages', 'income', 3000),
    row('Income', 'Wages', 'income', -500), // clawback: ignored
    row('Food', 'Groceries', 'spending', -30),
    row('Food', 'Groceries', 'spending', -10),
    row('Food', 'Groceries', 'spending', 25), // refund: ignored
  ]), JSON.stringify([
    { label: 'Average credit', amount: 2000 },
    { label: 'Average debit', amount: 20 },
  ]));
});

test('other inflow counts toward the average credit', () => {
  assert.equal(lines([
    row('Income', 'Wages', 'income', 100),
    row('Inflows', 'Interest', 'other_inflow', 20),
  ]), JSON.stringify([{ label: 'Average credit', amount: 60 }]));
});

test('a line with no qualifying rows is null', () => {
  assert.equal(lines([
    row('Income', 'Wages', 'income', -50),
    row('Food', 'Groceries', 'spending', 12),
  ]), JSON.stringify([
    { label: 'Average credit', amount: null },
    { label: 'Average debit', amount: null },
  ]));
});

test('signed-only and empty cards keep the single average', () => {
  assert.equal(lines([
    row('Retirement', 'Pension', 'retirement_income', 300),
    row('Retirement', 'Pension', 'retirement_income', -100),
  ]), JSON.stringify([{ label: 'Average debit', amount: 200 }]));
  assert.equal(lines([]), JSON.stringify([{ label: 'Average debit', amount: null }]));
});

test('retirement income credits count toward the average credit beside spending', () => {
  assert.equal(lines([
    row('Retirement', 'Pension', 'retirement_income', 900),
    row('Retirement', 'Pension', 'retirement_income', -100), // clawback: ignored
    row('Food', 'Groceries', 'spending', -40),
  ]), JSON.stringify([
    { label: 'Average credit', amount: 900 },
    { label: 'Average debit', amount: 40 },
  ]));
});

test('retirement income credits join earned income in the average credit', () => {
  assert.equal(lines([
    row('Income', 'Wages', 'income', 1000),
    row('Retirement', 'Pension', 'retirement_income', 500),
  ]), JSON.stringify([{ label: 'Average credit', amount: 750 }]));
});

// ── Money in and out on a mixed card ───────────────────────────

test('a mixed card splits its net into credit-side and spending nets', () => {
  const flow = A.getInsightCardFlowSummary([
    row('Income', 'Wages', 'income', 1000),
    row('Income', 'Wages', 'income', -100),
    row('Retirement', 'Pension', 'retirement_income', 200),
    row('Monthly', 'Rent', 'spending', -700),
    row('Monthly', 'Rent', 'spending', 50),
  ]);
  assert.equal(flow.isMixed, true);
  assert.equal(flow.inTotal, 1100);
  assert.equal(flow.outTotal, 650);
});

test('a one-sided card is not mixed', () => {
  assert.equal(A.getInsightCardFlowSummary([
    row('Income', 'Wages', 'income', 1000),
    row('Inflows', 'Interest', 'other_inflow', 5),
  ]).isMixed, false);
  assert.equal(A.getInsightCardFlowSummary([
    row('Monthly', 'Rent', 'spending', -700),
  ]).isMixed, false);
});

// ── Rendered card: single-mode cards look as they did ──────────

const insightsSandbox = {
  escapeHtml: value => String(value),
  getAppConfig: () => ({}),
  maskMoney: value => value,
};
const I = load(['transactions/analytics.js', 'transactions/insights.js'], [
  '_buildInsightCardInsight', 'getAnalyticsAverageDisplayAmount',
  'getAnalyticsDisplayModeForEntries', 'getAnalyticsDisplayTotal', 'formatAnalyticsCurrency',
  'ANALYTICS_DISPLAY_MODE', '_renderInsightCard',
].join(', '), insightsSandbox);

/** The card exactly as the single-primary card used to build it. */
function oldSinglePrimaryCard(primary, entries) {
  const matching = entries.filter(entry => entry.primary_category === primary);
  const rawTotal = matching.reduce((sum, entry) => sum + entry.amount, 0);
  const average = I.getAnalyticsAverageDisplayAmount(matching);
  const label = I.getAnalyticsDisplayModeForEntries(matching) === I.ANALYTICS_DISPLAY_MODE.INCOME
    ? 'Average credit'
    : 'Average debit';
  return {
    label: primary,
    value: I.formatAnalyticsCurrency(I.getAnalyticsDisplayTotal(rawTotal, matching)),
    meta: `${matching.length} transactions`,
    subtext: [average === null ? `${label} —` : `${label} ${I.formatAnalyticsCurrency(average)}`],
  };
}

test('a card whose rows are all one mode renders as the old single-primary card', () => {
  const entries = [
    row('Food', 'Groceries', 'spending', -80),
    row('Food', 'Restaurants', 'spending', -40),
    row('Food', 'Groceries', 'spending', 15),
    row('Income', 'Wages', 'income', 2000),
    row('Income', 'Bonus', 'income', 500),
    row('Income', 'Wages', 'income', -100),
  ];
  for (const primary of ['Food', 'Income']) {
    const card = I._buildInsightCardInsight(
      { name: primary, primaries: [primary], details: [] },
      { trackableEntries: entries },
    );
    const expected = oldSinglePrimaryCard(primary, entries);
    assert.equal(card.label, expected.label);
    assert.equal(card.value, expected.value);
    assert.equal(card.meta, expected.meta);
    assert.equal(JSON.stringify(card.subtext), JSON.stringify(expected.subtext));
  }
});

test('a total income card sums net income and inflows under its own name', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Total income', primaries: ['Income', 'Inflows'], details: [] },
    { trackableEntries: ledger },
  );
  assert.equal(card.label, 'Total income');
  assert.equal(card.value, '$2,015.00');
  assert.equal(card.meta, '2 transactions');
  assert.equal(JSON.stringify(card.subtext), JSON.stringify(['Average credit $1,007.50']));
  const html = I._renderInsightCard(card);
  assert.equal((html.match(/insight-subtext/g) || []).length, 1);
});

test('a mixed card shows a signed net, money in and out, and both averages', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Everything', primaries: ['Income', 'Food'], details: [] },
    { trackableEntries: ledger },
  );
  assert.equal(card.value, '+$1,880.00');
  assert.equal(card.valueTone, 'positive');
  assert.equal(JSON.stringify(card.subtext), JSON.stringify([
    'In $2,000.00 · Out $120.00',
    'Average credit $2,000.00',
    'Average debit $60.00',
  ]));
  const html = I._renderInsightCard(card);
  assert.equal((html.match(/class="insight-subtext"/g) || []).length, 3);
  assert.match(html, /class="insight-value tone-positive"/);
});

test('a mixed card that spent more than came in shows a minus', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Short', primaries: ['Inflows', 'Food', 'Travel'], details: [] },
    { trackableEntries: ledger },
  );
  assert.equal(card.value, '\u2212$405.00');
  assert.equal(card.valueTone, 'negative');
  assert.equal(card.subtext[0], 'In $15.00 · Out $420.00');
});

// ── Settings editor helpers ────────────────────────────────────

const E = load('user-settings/insight-cards.js', [
  'buildInsightCategoryTree', 'validateInsightCardDrafts', 'setInsightDraftPrimary',
  'setInsightDraftDetail', 'createInsightCardDrafts', 'insightDraftsMatchSaved',
  'isInsightEditorEligibleCategory',
].join(', '));

test('the picker tree groups detailed labels under primaries and hides transfers and adjustments', () => {
  const tree = E.buildInsightCategoryTree([
    'Income: Wages', 'Income: Bonus', 'Food: Groceries', 'Gifts',
    '[Checking]', 'Transfer In: Savings', 'Balance Adjustment',
  ], []);
  assert.equal(JSON.stringify(tree.map(group => group.primary)), JSON.stringify(['Food', 'Gifts', 'Income']));
  const income = tree.find(group => group.primary === 'Income');
  assert.equal(JSON.stringify(income.details.map(detail => detail.label)), JSON.stringify(['Income: Bonus', 'Income: Wages']));
  assert.equal(tree.find(group => group.primary === 'Gifts').details.length, 0);
  assert.equal(E.isInsightEditorEligibleCategory('[Checking]'), false);
});

test('stale card members are kept in the tree and flagged missing', () => {
  const tree = E.buildInsightCategoryTree(['Food: Groceries'], [
    { primaries: ['Old Primary'], details: ['Food: Takeout', 'Food: Groceries'] },
  ]);
  const old = tree.find(group => group.primary === 'Old Primary');
  assert.equal(old.missing, true);
  const food = tree.find(group => group.primary === 'Food');
  assert.equal(food.missing, false);
  assert.equal(food.details.find(detail => detail.label === 'Food: Takeout').missing, true);
  assert.equal(food.details.find(detail => detail.label === 'Food: Groceries').missing, false);
});

test('ticking a whole primary drops its separately ticked detailed labels', () => {
  const draft = { name: 'x', primaries: [], details: ['Food: Groceries', 'Travel: Flights'] };
  E.setInsightDraftPrimary(draft, 'Food', true);
  assert.equal(JSON.stringify(draft), JSON.stringify({
    name: 'x', primaries: ['Food'], details: ['Travel: Flights'],
  }));
  E.setInsightDraftPrimary(draft, 'Food', false);
  E.setInsightDraftDetail(draft, 'Food: Restaurants', true);
  E.setInsightDraftDetail(draft, 'Travel: Flights', false);
  assert.equal(JSON.stringify(draft), JSON.stringify({
    name: 'x', primaries: [], details: ['Food: Restaurants'],
  }));
});

test('local validation blocks a card without a name or members', () => {
  const result = E.validateInsightCardDrafts([
    { name: '  Total income ', primaries: ['Income'], details: [] },
    { name: '   ', primaries: [], details: [] },
    { name: 'x'.repeat(41), primaries: [], details: ['Food: Groceries'] },
  ]);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0], undefined);
  assert.equal(result.errors[1].length, 2);
  assert.equal(result.errors[2].length, 1);
  assert.equal(result.cards[0].name, 'Total income');
});

test('valid drafts produce the payload, and an empty list is valid', () => {
  const drafts = E.createInsightCardDrafts([{ name: 'Food', primaries: [], details: ['Food: Groceries'] }]);
  const result = E.validateInsightCardDrafts(drafts);
  assert.equal(result.valid, true);
  assert.equal(JSON.stringify(result.cards), JSON.stringify([
    { name: 'Food', primaries: [], details: ['Food: Groceries'] },
  ]));
  assert.equal(E.validateInsightCardDrafts([]).valid, true);
});

test('drafts match saved cards regardless of member order but not card order', () => {
  const saved = [
    { name: 'A', primaries: ['Income', 'Inflows'], details: [] },
    { name: 'B', primaries: ['Food'], details: [] },
  ];
  const drafts = E.createInsightCardDrafts(saved);
  assert.equal(E.insightDraftsMatchSaved(drafts, saved), true);
  drafts[0].primaries.reverse();
  assert.equal(E.insightDraftsMatchSaved(drafts, saved), true);
  assert.equal(E.insightDraftsMatchSaved(drafts.slice().reverse(), saved), false);
  drafts[1].name = 'B2';
  assert.equal(E.insightDraftsMatchSaved(drafts, saved), false);
});
