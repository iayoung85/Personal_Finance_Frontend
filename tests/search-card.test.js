const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// search.js calls analytics.js at run time, as the page does, so both load
// into one sandbox. The config the cards come from is a variable the tests set.
const FILES = ['transactions/transaction-types.js', 'transactions/analytics.js', 'transactions/search.js'];
const source = FILES.map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
const sandbox = {
  module: { exports: {} },
  console,
  insightCards: [],
  isTransferCategory: () => false,
  getAppConfig: () => ({ insightCards: sandbox.insightCards }),
  parseCategoryString: label => {
    const [primary, detailed] = String(label).split(': ');
    return { primary, detailed: detailed || '' };
  },
  getCategoryDisplayNames: () => ({}),
};
vm.runInNewContext(`${source}
module.exports = {
  parseSearchQuery, transactionMatchesSearch, buildCardSearchTerm, isCardTermInSearch,
  toggleCardTermInSearchText, resetInsightCardLookup, filterEntriesForInsightCard, _buildAnalyticsEntry,
};`, sandbox);
const S = sandbox.module.exports;

function useCards(cards) {
  sandbox.insightCards = cards;
  S.resetInsightCardLookup();
}

const matches = (txn, query) => S.transactionMatchesSearch(txn, S.parseSearchQuery(query));
const txn = (category, analytics_class, extra = {}) => ({
  transaction_id: `t-${category}-${analytics_class}`, source: 'plaid', status: 'cleared',
  amount: -10, user_category: category, analytics_class, ...extra,
});

const FOOD_CARD = { name: 'Eating Out', primaries: ['Food'], details: [] };
const DETAIL_CARD = { name: 'Coffee', primaries: [], details: ['Shopping: Coffee Beans'] };

// ── The operator ───────────────────────────────────────────────

test('card: matches rows in the card\'s categories and no others', () => {
  useCards([FOOD_CARD]);
  assert.equal(matches(txn('Food: Groceries', 'spending'), 'card:"Eating Out"'), true);
  assert.equal(matches(txn('Travel: Flights', 'spending'), 'card:"Eating Out"'), false);
});

test('a whole primary and a detailed label each match by their own rule', () => {
  useCards([FOOD_CARD, DETAIL_CARD]);
  assert.equal(matches(txn('Food: Restaurants', 'spending'), 'card:"Eating Out"'), true);
  assert.equal(matches(txn('Shopping: Coffee Beans', 'spending'), 'card:Coffee'), true);
  assert.equal(matches(txn('Shopping: Clothes', 'spending'), 'card:Coffee'), false);
  assert.equal(matches(txn('Shopping', 'spending'), 'card:Coffee'), false);
});

test('a row in the card\'s category whose class does not count is not on the card', () => {
  useCards([FOOD_CARD]);
  assert.equal(matches(txn('Food: Groceries', 'transfer'), 'card:"Eating Out"'), false);
  assert.equal(matches(txn('Food: Groceries', 'adjustment'), 'card:"Eating Out"'), false);
  assert.equal(matches(txn('Food: Groceries', 'investment_trend'), 'card:"Eating Out"'), false);
  assert.equal(matches(txn('Food: Groceries', null), 'card:"Eating Out"'), false);
});

test('the scope is the card\'s, not the slice\'s: a projected future bill row is listed', () => {
  useCards([FOOD_CARD]);
  const futureBill = txn('Food: Groceries', 'spending', { source: 'bill', status: 'future' });
  assert.equal(matches(futureBill, 'card:"Eating Out"'), true);
});

test('names compare case-insensitively and ignore surrounding spaces', () => {
  useCards([{ name: '  Eating Out ', primaries: ['Food'], details: [] }]);
  const row = txn('Food: Groceries', 'spending');
  assert.equal(matches(row, 'card:"eating out"'), true);
  assert.equal(matches(row, 'card:"EATING OUT"'), true);
  assert.equal(matches(row, 'card:" Eating Out "'), true);
  assert.equal(matches(row, 'CARD:"Eating Out"'), true);
});

test('an unknown card name matches nothing, and so does a blank one', () => {
  useCards([FOOD_CARD]);
  const row = txn('Food: Groceries', 'spending');
  assert.equal(matches(row, 'card:"No Such Card"'), false);
  assert.equal(matches(row, 'card:""'), false);
  assert.equal(matches(row, 'card:'), false);
});

test('-card: excludes the rows the card counts, and keeps the rest', () => {
  useCards([FOOD_CARD]);
  assert.equal(matches(txn('Food: Groceries', 'spending'), '-card:"Eating Out"'), false);
  assert.equal(matches(txn('Travel: Flights', 'spending'), '-card:"Eating Out"'), true);
  // An unknown name counts nothing, so excluding it excludes nothing.
  assert.equal(matches(txn('Food: Groceries', 'spending'), '-card:"No Such Card"'), true);
});

test('card: ANDs with the other terms', () => {
  useCards([FOOD_CARD]);
  const row = txn('Food: Groceries', 'spending', { merchant_name: 'Whole Foods' });
  assert.equal(matches(row, 'whole card:"Eating Out"'), true);
  assert.equal(matches(row, 'target card:"Eating Out"'), false);
});

test('a card name with a double quote is compared with the quote removed', () => {
  useCards([{ name: 'The "Big" Bills', primaries: ['Bills'], details: [] }]);
  const row = txn('Bills: Rent', 'spending');
  const term = S.buildCardSearchTerm('The "Big" Bills');
  assert.equal(term, 'card:"The Big Bills"');
  assert.equal(matches(row, term), true);
  // Typing the name with its quotes does not wedge the parser into a wrong match.
  assert.equal(matches(row, 'card:"The Big Bills"'), true);
});

test('the search and the card\'s number agree on which rows count', () => {
  const card = { name: 'Mixed', primaries: ['Income'], details: ['Food: Groceries'] };
  useCards([card]);
  const rows = [
    txn('Income: Wages', 'income'), txn('Food: Groceries', 'spending'), txn('Food: Restaurants', 'spending'),
    txn('Income: Wages', 'transfer'), txn('Income: Wages', 'investment_trend'), txn('Travel', 'spending'),
  ];
  const bySearch = rows.filter(row => matches(row, 'card:Mixed')).map(row => row.transaction_id);
  const byCard = S.filterEntriesForInsightCard(rows.map(row => S._buildAnalyticsEntry(row)), card)
    .map(entry => entry.transaction_id);
  assert.equal(JSON.stringify(bySearch), JSON.stringify(byCard));
  assert.equal(bySearch.length, 2);
});

// ── Split pieces ───────────────────────────────────────────────

test('a split piece is matched as the piece, the way the table builds its candidate', () => {
  useCards([FOOD_CARD]);
  const parent = txn('Split', 'excluded', { transaction_id: 'p1', is_split: true, amount: -50 });
  const foodPiece = { transaction_id: 'p1_split_0', user_category: 'Food: Groceries', analytics_class: 'spending', amount: -30 };
  const otherPiece = { transaction_id: 'p1_split_1', user_category: 'Travel: Flights', analytics_class: 'spending', amount: -20 };
  const candidate = piece => ({ ...parent, ...piece });
  assert.equal(S.transactionMatchesSearch(candidate(foodPiece), S.parseSearchQuery('card:"Eating Out"')), true);
  assert.equal(S.transactionMatchesSearch(candidate(otherPiece), S.parseSearchQuery('card:"Eating Out"')), false);
});

// ── Edits to the search text ───────────────────────────────────

test('clicking a card on an empty search types its term', () => {
  assert.equal(S.toggleCardTermInSearchText('', 'Eating Out'), 'card:"Eating Out"');
  assert.equal(S.toggleCardTermInSearchText(undefined, 'Eating Out'), 'card:"Eating Out"');
  assert.equal(S.toggleCardTermInSearchText('   ', 'Eating Out'), 'card:"Eating Out"');
});

test('the term goes after whatever is typed, which stays as typed', () => {
  assert.equal(
    S.toggleCardTermInSearchText('whole foods -is:pending amount:<-10', 'Eating Out'),
    'whole foods -is:pending amount:<-10 card:"Eating Out"',
  );
  assert.equal(S.toggleCardTermInSearchText('coffee ', 'Eating Out'), 'coffee card:"Eating Out"');
});

test('clicking the active card removes its term, quoted or not, in any case', () => {
  const remove = text => S.toggleCardTermInSearchText(text, 'Eating Out');
  assert.equal(remove('card:"Eating Out"'), '');
  assert.equal(remove('whole card:"Eating Out"'), 'whole');
  assert.equal(remove('card:"Eating Out" whole'), 'whole');
  assert.equal(remove('a card:"eating out" b'), 'a b');
  assert.equal(remove('a CARD:"EATING OUT"  b'), 'a b');
  assert.equal(remove('a card:" Eating Out " b'), 'a b');
  assert.equal(S.toggleCardTermInSearchText('x card:Coffee y', 'Coffee'), 'x y');
});

test('clicking another card swaps the term in place', () => {
  assert.equal(
    S.toggleCardTermInSearchText('a card:"Eating Out" b', 'Coffee'),
    'a card:"Coffee" b',
  );
  assert.equal(S.toggleCardTermInSearchText('card:"Eating Out"', 'Coffee'), 'card:"Coffee"');
});

test('a swap leaves no second card term behind', () => {
  assert.equal(
    S.toggleCardTermInSearchText('card:"Eating Out" memo:x card:Bills', 'Coffee'),
    'card:"Coffee" memo:x',
  );
});

test('a negated card term is another filter: neither toggled nor replaced', () => {
  assert.equal(
    S.toggleCardTermInSearchText('-card:"Eating Out"', 'Eating Out'),
    '-card:"Eating Out" card:"Eating Out"',
  );
  assert.equal(S.isCardTermInSearch('-card:"Eating Out"', 'Eating Out'), false);
});

test('a card name with a double quote edits the text with the quote stripped', () => {
  const added = S.toggleCardTermInSearchText('rent', 'The "Big" Bills');
  assert.equal(added, 'rent card:"The Big Bills"');
  assert.equal(S.isCardTermInSearch(added, 'The "Big" Bills'), true);
  assert.equal(S.toggleCardTermInSearchText(added, 'The "Big" Bills'), 'rent');
});

test('a card term inside a quoted phrase or another field is not a card term', () => {
  assert.equal(S.isCardTermInSearch('"card:Coffee"', 'Coffee'), false);
  assert.equal(S.isCardTermInSearch('memo:"card:Coffee"', 'Coffee'), false);
  assert.equal(S.isCardTermInSearch('card:Coffee', 'Coffee'), true);
  assert.equal(S.isCardTermInSearch('card:Coffee', 'Tea'), false);
});

test('the edited text parses to the card token', () => {
  const tokens = S.parseSearchQuery(S.toggleCardTermInSearchText('coffee', 'Eating Out'));
  assert.equal(JSON.stringify(tokens), JSON.stringify([
    { type: 'text', negate: false, value: 'coffee' },
    { type: 'field', negate: false, field: 'card', value: 'Eating Out' },
  ]));
});
