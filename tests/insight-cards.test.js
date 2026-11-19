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
  'filterEntriesForInsightCard', 'insightCardCountsEntry', 'getInsightCardAverageLines', 'getInsightCardFlowSummary',
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

// ── Card view models and markup ────────────────────────────────

const insightsSandbox = {
  escapeHtml: value => String(value),
  getAppConfig: () => ({}),
  maskMoney: value => value,
  searchQuery: '',
  isTransferCategory: () => false,
};
const I = load(['transactions/analytics.js', 'transactions/search.js', 'transactions/insights.js'], [
  '_buildInsightCardInsight', '_buildTotalOutflowInsight', '_buildLiveLedgerInsight',
  '_buildCategorySummaryInsight', 'insightCountText', 'insightCategoryCountText', 'getAnalyticsAverageDisplayAmount',
  'getAnalyticsDisplayModeForEntries', 'getAnalyticsDisplayTotal', 'formatAnalyticsCurrency',
  'ANALYTICS_DISPLAY_MODE', '_renderInsightCard', 'INSIGHT_CARD_SETTINGS_URL',
].join(', '), insightsSandbox);

const plainJson = value => JSON.stringify(value);

test('every card words its count the same way, singular for one', () => {
  assert.equal(I.insightCountText(0), '0 transactions');
  assert.equal(I.insightCountText(1), '1 transaction');
  assert.equal(I.insightCountText(2), '2 transactions');
  assert.equal(I.insightCountText(1099), '1099 transactions');
});

/** The total and average a single-mode card has always shown. */
function singleModeExpectation(primary, entries) {
  const matching = entries.filter(entry => entry.primary_category === primary);
  const rawTotal = matching.reduce((sum, entry) => sum + entry.amount, 0);
  const average = I.getAnalyticsAverageDisplayAmount(matching);
  const label = I.getAnalyticsDisplayModeForEntries(matching) === I.ANALYTICS_DISPLAY_MODE.INCOME
    ? 'Average credit'
    : 'Average debit';
  return {
    value: I.formatAnalyticsCurrency(I.getAnalyticsDisplayTotal(rawTotal, matching)),
    countText: `${matching.length} transactions`,
    rows: [{ label, value: average === null ? '—' : I.formatAnalyticsCurrency(average) }],
  };
}

test('a card whose rows are all one mode keeps its total, and its average moves to the details', () => {
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
    const expected = singleModeExpectation(primary, entries);
    assert.equal(card.label, primary);
    assert.equal(card.value, expected.value);
    assert.equal(card.countText, expected.countText);
    assert.equal(plainJson(card.details.rows), plainJson(expected.rows));
  }
});

test('a custom card lists its categories and links to App configuration', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Total income', primaries: ['Income'], details: ['Inflows: Interest'] },
    { trackableEntries: ledger },
  );
  assert.equal(card.label, 'Total income');
  assert.equal(card.value, '$2,015.00');
  assert.equal(card.countText, '2 transactions');
  assert.equal(card.details.listTitle, 'Categories');
  assert.equal(plainJson(card.details.list), plainJson(['Income', 'Inflows: Interest']));
  assert.equal(card.details.link.href, 'user-settings.html#app-config');
  assert.equal(card.details.link.href, I.INSIGHT_CARD_SETTINGS_URL);
  assert.match(card.details.link.text, /App configuration/);

  const html = I._renderInsightCard(card, 1);
  assert.match(html, /<a class="insight-popover-link" href="user-settings.html#app-config">Change in App configuration<\/a>/);
  assert.match(html, /<li>Income<\/li><li>Inflows: Interest<\/li>/);
});

test('a one-sided card has no In and Out rows', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Total income', primaries: ['Income', 'Inflows'], details: [] },
    { trackableEntries: ledger },
  );
  assert.equal(card.value, '$2,015.00');
  assert.equal(card.countText, '2 transactions');
  assert.equal(plainJson(card.details.rows), plainJson([{ label: 'Average credit', value: '$1,007.50' }]));
});

test('a mixed card shows a signed net, and In, Out and both averages in its details', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Everything', primaries: ['Income', 'Food'], details: [] },
    { trackableEntries: ledger },
  );
  assert.equal(card.value, '+$1,880.00');
  assert.equal(card.valueTone, 'positive');
  assert.equal(plainJson(card.details.rows), plainJson([
    { label: 'In', value: '$2,000.00' },
    { label: 'Out', value: '$120.00' },
    { label: 'Average credit', value: '$2,000.00' },
    { label: 'Average debit', value: '$60.00' },
  ]));
  assert.match(I._renderInsightCard(card, 0), /class="insight-value tone-positive"/);
});

test('a mixed card that spent more than came in shows a minus', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Short', primaries: ['Inflows', 'Food', 'Travel'], details: [] },
    { trackableEntries: ledger },
  );
  assert.equal(card.value, '−$405.00');
  assert.equal(card.valueTone, 'negative');
  assert.equal(plainJson(card.details.rows.slice(0, 2)), plainJson([
    { label: 'In', value: '$15.00' },
    { label: 'Out', value: '$420.00' },
  ]));
});

test('a card with one matching row says "1 transaction"', () => {
  const card = I._buildInsightCardInsight(
    { name: 'Groceries', primaries: [], details: ['Food: Groceries'] },
    { trackableEntries: ledger },
  );
  assert.equal(card.countText, '1 transaction');
});

test('Live Result and Category Summary give a count line and a details sentence', () => {
  const view = {
    ledgerEntries: [row('Food', 'Groceries', 'spending', -80), row('Transfer', 'Out', 'transfer', -500)],
    summaryEntries: [row('Food', 'Groceries', 'spending', -80)],
  };
  const live = I._buildLiveLedgerInsight(view);
  assert.equal(live.value, '-$580.00');
  assert.equal(live.countText, '2 transactions');
  assert.equal(plainJson(live.details.paragraphs), plainJson(['Signed net sum of the current ledger view.']));

  const summary = I._buildCategorySummaryInsight(view);
  assert.equal(summary.value, 'Open category table');
  // Its third line counts categories; the transaction count would differ from
  // Live Result's by every row the table leaves out, so it sits in the details.
  assert.equal(summary.countText, '1 primary category');
  assert.match(
    summary.details.paragraphs.join(' '),
    /1 of the 2 listed transactions\. Transfers, adjustments and balance anchors are left out/,
  );
});

test('the Category Summary card counts primaries that have a row in its table', () => {
  assert.equal(I.insightCategoryCountText([]), '0 primary categories');
  assert.equal(I.insightCategoryCountText([
    row('Food', 'Groceries', 'spending', -80),
    row('Food', 'Dining', 'spending', -20),
    row('Pay', 'Salary', 'income', 900),
  ]), '2 primary categories');
  // A primary holding only investment trend rows is a stat card, not a table row.
  assert.equal(I.insightCategoryCountText([
    row('Food', 'Groceries', 'spending', -80),
    row('Investments', 'Trending Performance', 'investment_trend', 40),
  ]), '1 primary category');
});

test('every card renders as three single lines with an info button and a closed popover', () => {
  const view = {
    outflowEntries: [row('Food', 'Groceries', 'spending', -80)],
    spendingEntries: [row('Food', 'Groceries', 'spending', -80)],
    savingsEntries: [],
    trackableEntries: ledger,
    ledgerEntries: ledger,
    summaryEntries: ledger,
  };
  const cards = [
    I._buildTotalOutflowInsight(view),
    I._buildInsightCardInsight({ name: 'Food', primaries: ['Food'], details: [] }, view),
    I._buildLiveLedgerInsight(view),
    I._buildCategorySummaryInsight(view),
  ];
  cards.forEach((card, index) => {
    const html = I._renderInsightCard(card, index);
    assert.equal((html.match(/class="insight-(label|value|meta)[" ]/g) || []).length, 3, card.label);
    assert.doesNotMatch(html, /insight-subtext|insight-icon/);
    assert.match(html, new RegExp(`<div class="insight-meta">${card.countText}</div>`));
    assert.match(html, new RegExp(
      `<button type="button" class="insight-info-btn" aria-label="Details for ${card.label}"`,
    ));
    assert.match(html, new RegExp(`aria-expanded="false" aria-controls="insight-details-${index}"`));
    assert.match(html, new RegExp(`<div class="insight-popover" id="insight-details-${index}" title="" hidden>`));
  });
});

test('a long custom card name keeps the full name in its title', () => {
  const name = 'Household and recurring subscriptions';
  const card = I._buildInsightCardInsight({ name, primaries: ['Food'], details: [] }, { trackableEntries: ledger });
  assert.match(I._renderInsightCard(card, 1), new RegExp(`<div class="insight-label" title="${name}">${name}</div>`));
});

test('the Category Summary card opens its table except from its info button or details', () => {
  let opened = 0;
  const { _onCategorySummaryCardClick } = load(['transactions/analytics.js', 'transactions/insights.js'],
    '_onCategorySummaryCardClick', { ...insightsSandbox, toggleCategorySummaryModal: () => { opened += 1; } });
  const clickOn = insideSelector => ({
    target: { closest: selector => (insideSelector && selector.includes(insideSelector) ? {} : null) },
  });
  _onCategorySummaryCardClick(clickOn(null));
  assert.equal(opened, 1);
  _onCategorySummaryCardClick(clickOn('.insight-info-btn'));
  _onCategorySummaryCardClick(clickOn('.insight-popover'));
  assert.equal(opened, 1);
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

// ── Savings on the debit side ──────────────────────────────────

test('a card tracking a savings primary keeps its total and its average debit', () => {
  const savingsRows = [
    row('Savings', 'Deposit', 'savings', -300),
    row('Savings', 'Deposit', 'savings', -100),
    row('Savings', 'Withdrawal', 'savings', 50), // withdrawal: ignored by the average
  ];
  assert.equal(lines(savingsRows), JSON.stringify([{ label: 'Average debit', amount: 200 }]));
  const flow = A.getInsightCardFlowSummary(savingsRows);
  assert.equal(flow.isMixed, false);
  assert.equal(flow.outTotal, 350);
});

test('a card holding income and savings is mixed, with savings as money out', () => {
  const flow = A.getInsightCardFlowSummary([
    row('Income', 'Wages', 'income', 1000),
    row('Savings', 'Deposit', 'savings', -300),
    row('Food', 'Groceries', 'spending', -50),
  ]);
  assert.equal(flow.isMixed, true);
  assert.equal(flow.inTotal, 1000);
  assert.equal(flow.outTotal, 350);
});

// ── Total Outflow ──────────────────────────────────────────────

test('Total Outflow sums spending and savings, and its details split it into the two', () => {
  const spending = [row('Food', 'Groceries', 'spending', -80), row('Food', 'Groceries', 'spending', 30)];
  const savings = [row('Savings', 'Deposit', 'savings', -300), row('Savings', 'Withdrawal', 'savings', 100)];
  const card = I._buildTotalOutflowInsight({
    spendingEntries: spending,
    savingsEntries: savings,
    outflowEntries: [...spending, ...savings],
  });
  assert.equal(card.label, 'Total Outflow');
  assert.equal(card.value, '$250.00');
  assert.equal(card.countText, '4 transactions');
  assert.match(card.details.paragraphs[0], /Spending plus savings/);
  assert.equal(plainJson(card.details.rows), plainJson([
    { label: 'Spending', value: '$50.00' },
    { label: 'Savings', value: '$200.00' },
  ]));
  const toNumber = text => Number(text.replace(/[$,]/g, ''));
  assert.equal(toNumber(card.details.rows[0].value) + toNumber(card.details.rows[1].value), toNumber(card.value));
});

test('an empty side of Total Outflow reads $0.00, never a negative zero', () => {
  const spending = [row('Food', 'Groceries', 'spending', -80)];
  const card = I._buildTotalOutflowInsight({ spendingEntries: spending, savingsEntries: [], outflowEntries: spending });
  assert.equal(card.details.rows[1].value, '$0.00');
  const empty = I._buildTotalOutflowInsight({ spendingEntries: [], savingsEntries: [], outflowEntries: [] });
  assert.equal(empty.value, '$0.00');
  assert.equal(empty.countText, '0 transactions');
});

// ── The whole row, from the rows the table lists ───────────────

/**
 * The panel's builders over a ledger view, with the real slice and type rules.
 * visibleTransactions stands for what the table lists after its filters.
 */
function loadPanel(visibleTransactions, insightCards = []) {
  return load(['transactions/transaction-types.js', 'transactions/analytics.js', 'transactions/insights.js'],
    'generateSpendingInsights, buildVisibleCategorySummaryData', {
      visibleTransactions,
      selectedAccountMode: 'single',
      parseCategoryString: label => {
        const [primary, detailed] = String(label).split(': ');
        return { primary, detailed: detailed || '' };
      },
      getCategoryDisplayNames: () => ({}),
      getAppConfig: () => ({ insightCards }),
      maskMoney: value => value,
      escapeHtml: value => String(value),
      _splitMatchesSearch: () => true,
      _splitMatchesCategoryFilter: () => true,
    });
}

const ledgerRow = (id, amount, category, analytics_class, extra = {}) => ({
  transaction_id: id, source: 'plaid', status: 'cleared', amount, user_category: category, analytics_class, ...extra,
});

const byLabel = (insights, label) => insights.find(insight => insight.label === label);

test('the row is Total Outflow, the custom cards, Live Result, Category Summary', () => {
  const panel = loadPanel(
    [ledgerRow('a', -40, 'Food: Groceries', 'spending')],
    [{ name: 'Food', primaries: ['Food'], details: [] }, { name: 'Pay', primaries: ['Income'], details: [] }],
  );
  const labels = panel.generateSpendingInsights().map(insight => insight.label);
  assert.equal(plainJson(labels), plainJson(['Total Outflow', 'Food', 'Pay', 'Live Result', 'Category Summary']));
});

test('hidden rows count in every card while the table lists them, and not otherwise', () => {
  const shown = ledgerRow('shown', -25, 'Food: Groceries', 'spending');
  const hidden = ledgerRow('hidden', -70, 'Food: Groceries', 'spending', { is_hidden: true });
  const cards = [{ name: 'Food', primaries: ['Food'], details: [] }];

  const listed = loadPanel([shown, hidden], cards);
  const withHidden = listed.generateSpendingInsights();
  assert.equal(byLabel(withHidden, 'Total Outflow').value, '$95.00');
  assert.equal(byLabel(withHidden, 'Total Outflow').countText, '2 transactions');
  assert.equal(byLabel(withHidden, 'Food').countText, '2 transactions');
  assert.equal(byLabel(withHidden, 'Live Result').countText, '2 transactions');
  assert.equal(byLabel(withHidden, 'Category Summary').countText, '1 primary category');
  // The category table and the summary export agree with the cards.
  const summary = listed.buildVisibleCategorySummaryData();
  assert.equal(summary.transaction_count, 2);
  assert.equal(summary.spending_total, -95);

  const notListed = loadPanel([shown], cards);
  const withoutHidden = notListed.generateSpendingInsights();
  assert.equal(byLabel(withoutHidden, 'Total Outflow').value, '$25.00');
  assert.equal(byLabel(withoutHidden, 'Live Result').countText, '1 transaction');
  assert.equal(notListed.buildVisibleCategorySummaryData().transaction_count, 1);
});

test('a view listing only hidden rows shows its cards; an empty view shows none', () => {
  const onlyHidden = loadPanel([ledgerRow('h', -10, 'Food: Groceries', 'spending', { is_hidden: true })]);
  assert.equal(byLabel(onlyHidden.generateSpendingInsights(), 'Live Result').countText, '1 transaction');
  assert.equal(loadPanel([]).generateSpendingInsights(), null);
});

test('a pending row counts with the posted ones and no card names it apart', () => {
  const posted = ledgerRow('posted', -30, 'Food: Groceries', 'spending');
  const pending = ledgerRow('pending', -20, 'Food: Groceries', 'spending', { status: 'pending', pending: true });
  const insights = loadPanel([posted, pending], [{ name: 'Food', primaries: ['Food'], details: [] }])
    .generateSpendingInsights();
  assert.equal(byLabel(insights, 'Total Outflow').value, '$50.00');
  assert.equal(byLabel(insights, 'Total Outflow').countText, '2 transactions');
  assert.equal(byLabel(insights, 'Food').countText, '2 transactions');
  assert.equal(byLabel(insights, 'Live Result').countText, '2 transactions');
  assert.doesNotMatch(JSON.stringify(insights), /\bpending\b/i);
});

// ── Hidden categories ──────────────────────────────────────────

test('a hidden category already on a card is kept and not flagged missing', () => {
  const tree = E.buildInsightCategoryTree(
    ['Food: Groceries'],
    [{ primaries: [], details: ['Food: Dining Out'] }],
    ['Food: Dining Out'],
  );
  const food = tree.find(group => group.primary === 'Food');
  assert.equal(food.missing, false);
  assert.equal(food.details.find(detail => detail.label === 'Food: Dining Out').missing, false);
  assert.equal(food.details.find(detail => detail.label === 'Food: Groceries').missing, false);
});

test('a hidden category not on any card is not offered', () => {
  const tree = E.buildInsightCategoryTree(
    ['Food: Groceries'],
    [{ primaries: [], details: ['Food: Groceries'] }],
    ['Food: Dining Out', 'Gifts: Birthday'],
  );
  assert.equal(JSON.stringify(tree.map(group => group.primary)), JSON.stringify(['Food']));
  assert.equal(JSON.stringify(tree[0].details.map(detail => detail.label)), JSON.stringify(['Food: Groceries']));
});

test('a primary with only hidden categories is not missing when a card holds it or one of its labels', () => {
  const whole = E.buildInsightCategoryTree(['Food: Groceries'], [{ primaries: ['Gifts'], details: [] }], ['Gifts: Birthday']);
  assert.equal(whole.find(group => group.primary === 'Gifts').missing, false);
  const one = E.buildInsightCategoryTree(['Food: Groceries'], [{ primaries: [], details: ['Gifts: Birthday'] }], ['Gifts: Birthday']);
  const gifts = one.find(group => group.primary === 'Gifts');
  assert.equal(gifts.missing, false);
  assert.equal(gifts.details[0].missing, false);
});

test('a label in neither list is still missing, and the hidden list may be absent', () => {
  const tree = E.buildInsightCategoryTree(
    ['Food: Groceries'],
    [{ primaries: ['Old Primary'], details: ['Food: Gone', 'Gifts: Unknown'] }],
    ['Food: Dining Out'],
  );
  assert.equal(tree.find(group => group.primary === 'Old Primary').missing, true);
  assert.equal(tree.find(group => group.primary === 'Food').details.find(detail => detail.label === 'Food: Gone').missing, true);
  assert.equal(tree.find(group => group.primary === 'Gifts').missing, true);
  const noHidden = E.buildInsightCategoryTree(['Food: Groceries'], [{ primaries: [], details: ['Food: Dining Out'] }]);
  assert.equal(noHidden[0].details.find(detail => detail.label === 'Food: Dining Out').missing, true);
});

// ── Card membership ────────────────────────────────────────────

test('a row counts on a card only when its class counts and its category is a member', () => {
  const card = { primaries: ['Food'], details: [] };
  assert.equal(A.insightCardCountsEntry(card, row('Food', 'Groceries', 'spending', -5)), true);
  assert.equal(A.insightCardCountsEntry(card, row('Food', 'Groceries', 'transfer', -5)), false);
  assert.equal(A.insightCardCountsEntry(card, row('Food', 'Groceries', 'adjustment', -5)), false);
  assert.equal(A.insightCardCountsEntry(card, row('Food', 'Groceries', 'investment_trend', -5)), false);
  assert.equal(A.insightCardCountsEntry(card, row('Food', 'Groceries', null, -5)), false);
  assert.equal(A.insightCardCountsEntry(card, row('Travel', '', 'spending', -5)), false);
});

// ── Pressing a custom card ─────────────────────────────────────

/** Renders cards against a fresh page whose search bar holds `query`. */
function renderWithSearch(query, buildInsights) {
  const page = load(['transactions/analytics.js', 'transactions/search.js', 'transactions/insights.js'],
    '_buildInsightCardInsight, _buildTotalOutflowInsight, _buildLiveLedgerInsight, '
    + '_buildCategorySummaryInsight, _renderInsightCard',
    { ...insightsSandbox, searchQuery: query });
  return buildInsights(page).map((insight, index) => page._renderInsightCard(insight, index));
}

const clickableCard = (name, query = '') => renderWithSearch(query, page => [
  page._buildInsightCardInsight({ name, primaries: ['Food'], details: [] }, { trackableEntries: ledger }),
])[0];

test('a custom card is a button that reports whether its term is in the search', () => {
  const idle = clickableCard('Food');
  assert.match(idle, /class="insight-card insight-filter-card"/);
  assert.match(idle, /onclick="_onInsightFilterCardClick\(event\)" role="button" tabindex="0"/);
  assert.match(idle, /aria-pressed="false"/);
  assert.match(idle, /data-insight-card-name="Food"/);
  assert.match(idle, /title="Show the transactions this card counts"/);
  // The name keeps its own tooltip for when the line truncates it.
  assert.match(idle, /<div class="insight-label" title="Food">Food<\/div>/);

  assert.match(clickableCard('Food', 'coffee card:"food"'), /aria-pressed="true"/);
  assert.match(clickableCard('Food', 'card:"Food Bills"'), /aria-pressed="false"/);
});

test('the other three cards carry no filter wiring', () => {
  const view = {
    trackableEntries: ledger, outflowEntries: [], spendingEntries: [], savingsEntries: [],
    ledgerEntries: ledger, summaryEntries: ledger,
  };
  const htmls = renderWithSearch('card:"Total Outflow"', page => [
    page._buildTotalOutflowInsight(view), page._buildLiveLedgerInsight(view), page._buildCategorySummaryInsight(view),
  ]);
  assert.equal(htmls.length, 3);
  htmls.forEach(html => {
    assert.doesNotMatch(html, /aria-pressed|insight-filter-card|_onInsightFilterCardClick|data-insight-card-name/);
  });
});

test('a card name is escaped into its attribute', () => {
  const page = load(['transactions/analytics.js', 'transactions/search.js', 'transactions/insights.js'],
    '_renderInsightCard', {
      ...insightsSandbox,
      escapeHtml: value => String(value).replace(/"/g, '&quot;'),
    });
  const html = page._renderInsightCard(
    { label: 'x', value: '$1', countText: '1 transaction', filterCardName: 'a"b' }, 0,
  );
  assert.match(html, /data-insight-card-name="a&quot;b"/);
});

/** The handlers over stubs for the search bar and the page. */
function loadHandlers() {
  const toggled = [];
  const cards = [];
  const sandboxed = {
    ...insightsSandbox,
    toggleCardSearchFilter: name => toggled.push(name),
    isCardTermInSearch: () => false,
    document: {
      activeElement: null,
      addEventListener: () => {},
      querySelectorAll: () => cards,
    },
  };
  const handlers = load(['transactions/analytics.js', 'transactions/insights.js'],
    '_onInsightFilterCardClick, _onInsightDetailsKeydown', sandboxed);
  return { handlers, toggled, cards, page: sandboxed.document };
}

const fakeCard = name => ({
  classList: { contains: className => className === 'insight-filter-card' },
  getAttribute: attribute => (attribute === 'data-insight-card-name' ? name : null),
  focused: 0,
  focus() { this.focused += 1; },
});

test('pressing a custom card toggles its filter, but not from the info button or details', () => {
  const { handlers, toggled } = loadHandlers();
  const card = fakeCard('Food');
  const pressOn = insideSelector => ({
    currentTarget: card,
    target: { closest: selector => (insideSelector && selector.includes(insideSelector) ? {} : null) },
  });
  handlers._onInsightFilterCardClick(pressOn(null));
  assert.equal(JSON.stringify(toggled), JSON.stringify(['Food']));
  handlers._onInsightFilterCardClick(pressOn('.insight-info-btn'));
  handlers._onInsightFilterCardClick(pressOn('.insight-popover'));
  assert.equal(toggled.length, 1);
});

test('Enter and Space on a focused custom card toggle it; other keys and targets do not', () => {
  const { handlers, toggled } = loadHandlers();
  const card = fakeCard('Food');
  let prevented = 0;
  const key = (keyName, target, extra = {}) => ({
    key: keyName, target, preventDefault: () => { prevented += 1; }, ...extra,
  });

  handlers._onInsightDetailsKeydown(key('Enter', card));
  handlers._onInsightDetailsKeydown(key(' ', card));
  assert.equal(toggled.length, 2);
  assert.equal(prevented, 2);

  handlers._onInsightDetailsKeydown(key('a', card));
  handlers._onInsightDetailsKeydown(key('Enter', card, { repeat: true }));
  // The info button inside a card acts on Enter itself.
  handlers._onInsightDetailsKeydown(key('Enter', { classList: { contains: () => false } }));
  assert.equal(toggled.length, 2);
});

test('a keyboard press puts focus back on the redrawn card', () => {
  const { handlers, cards, page } = loadHandlers();
  const before = fakeCard('Food');
  const after = fakeCard('Food');
  cards.push(fakeCard('Pay'), after);
  page.activeElement = before;
  handlers._onInsightDetailsKeydown({ key: 'Enter', target: before, preventDefault: () => {} });
  assert.equal(after.focused, 1);
});

// ── A card's number while its term narrows the ledger ──────────

test('a split group listed through a matching piece counts only that piece on the card', () => {
  const split = {
    transaction_id: 's1', source: 'plaid', status: 'cleared', amount: -50, is_split: true,
    user_category: 'Split', analytics_class: 'excluded',
    splits: [
      { transaction_id: 's1_split_0', amount: -30, user_category: 'Food: Groceries', analytics_class: 'spending' },
      { transaction_id: 's1_split_1', amount: -20, user_category: 'Travel: Flights', analytics_class: 'spending' },
    ],
  };
  const cards = [{ name: 'Food', primaries: ['Food'], details: [] }];
  const sandboxed = {
    visibleTransactions: [split],
    selectedAccountMode: 'single',
    insightCards: cards,
    searchTokens: [],
    isTransferCategory: () => false,
    parseCategoryString: label => {
      const [primary, detailed] = String(label).split(': ');
      return { primary, detailed: detailed || '' };
    },
    getCategoryDisplayNames: () => ({}),
    getAppConfig: () => ({ insightCards: cards }),
    maskMoney: value => value,
    escapeHtml: value => String(value),
    _splitMatchesSearch: (parent, piece) => (
      sandboxed.searchTokens.length === 0
      || sandboxed.transactionMatchesSearch({ ...parent, ...piece }, sandboxed.searchTokens)
    ),
    _splitMatchesCategoryFilter: () => true,
  };
  const panel = load(
    ['transactions/transaction-types.js', 'transactions/analytics.js', 'transactions/search.js', 'transactions/insights.js'],
    'generateSpendingInsights, parseSearchQuery, transactionMatchesSearch', sandboxed);
  sandboxed.transactionMatchesSearch = panel.transactionMatchesSearch;

  sandboxed.searchTokens = panel.parseSearchQuery('card:Food');
  const food = panel.generateSpendingInsights().find(insight => insight.label === 'Food');
  assert.equal(food.value, '$30.00');
  assert.equal(food.countText, '1 transaction');
});

test('a card filter that lists nothing still shows the row, with the card pressed', () => {
  const cards = [{ name: 'Food', primaries: ['Food'], details: [] }];
  // The search text is read when the scripts load, so each case loads its own panel.
  const loadEmptyLedgerPanel = searchQuery => load(
    ['transactions/transaction-types.js', 'transactions/analytics.js', 'transactions/search.js', 'transactions/insights.js'],
    'generateSpendingInsights, _renderInsightCard', {
      visibleTransactions: [],
      selectedAccountMode: 'single',
      searchQuery,
      searchTokens: [],
      isTransferCategory: () => false,
      parseCategoryString: label => {
        const [primary, detailed] = String(label).split(': ');
        return { primary, detailed: detailed || '' };
      },
      getCategoryDisplayNames: () => ({}),
      getAppConfig: () => ({ insightCards: cards }),
      maskMoney: value => value,
      escapeHtml: value => String(value),
      _splitMatchesSearch: () => true,
      _splitMatchesCategoryFilter: () => true,
    });

  const filtered = loadEmptyLedgerPanel('Paycheck card:"Food"');
  const food = filtered.generateSpendingInsights().find(insight => insight.label === 'Food');
  assert.equal(food.countText, '0 transactions');
  assert.match(filtered._renderInsightCard(food, 1), /aria-pressed="true"/);

  // The same empty ledger with no card in the search keeps the empty state.
  assert.equal(loadEmptyLedgerPanel('Paycheck').generateSpendingInsights(), null);
});
