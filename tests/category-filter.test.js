const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = relPath => fs.readFileSync(path.join(root, relPath), 'utf8');

// Results cross the vm boundary, so compare through JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function loadFilter() {
  const sandbox = { module: { exports: {} }, console, URLSearchParams, plaidTaxonomy: [] };
  vm.runInNewContext(
    `${read('transactions/categories.js')}\n${read('transactions/category-filter.js')}\nmodule.exports = { parseTransactionsDeepLink, transactionsStartupPlan, buildFilterSuggestions, resolveFilterCategoryText };`,
    sandbox,
    { filename: 'transactions/category-filter.js' },
  );
  return sandbox.module.exports;
}

const F = loadFilter();

// ── ?category= and ?search= ─────────────────────────────────

test('a primary name in ?category= is read as typed', () => {
  assert.deepEqual(plain(F.parseTransactionsDeepLink('?category=Food')), {
    hasSearch: false, search: '', category: 'Food', forcesFullLedger: true,
  });
});

test('a full label survives URL encoding, including & / and :', () => {
  const label = 'Food & Drink: Dining/Takeout';
  const link = `?category=${encodeURIComponent(label)}`;
  assert.equal(F.parseTransactionsDeepLink(link).category, label);
});

test('the address may come without its question mark', () => {
  assert.equal(F.parseTransactionsDeepLink('category=Gifts%3A%20Birthday').category, 'Gifts: Birthday');
});

test('an empty or missing ?category= selects nothing and forces nothing', () => {
  assert.deepEqual(plain(F.parseTransactionsDeepLink('?category=')), {
    hasSearch: false, search: '', category: '', forcesFullLedger: false,
  });
  assert.equal(F.parseTransactionsDeepLink('').forcesFullLedger, false);
  assert.equal(F.parseTransactionsDeepLink('?foo=1').category, '');
});

test('?search= alone still forces the full ledger, even when empty', () => {
  assert.equal(F.parseTransactionsDeepLink('?search=').forcesFullLedger, true);
  assert.equal(F.parseTransactionsDeepLink('?search=cat%3A%22Food%22').search, 'cat:"Food"');
});

test('both parameters apply together', () => {
  const link = F.parseTransactionsDeepLink('?search=coffee&category=Food%3A%20Dining%20Out');
  assert.deepEqual(plain(link), {
    hasSearch: true, search: 'coffee', category: 'Food: Dining Out', forcesFullLedger: true,
  });
});

// ── The suggestion list ─────────────────────────────────────

const VISIBLE = ['Food: Groceries', 'Food: Coffee', 'Travel: Flights'];
const HIDDEN = ['Food: Dining Out', 'Gifts: Birthday', 'Gifts: Holiday'];

const values = entries => entries.map(entry => entry.value);

test('with nothing typed only primaries that have a visible category are listed', () => {
  const result = F.buildFilterSuggestions(VISIBLE, HIDDEN, '');
  assert.equal(result.isOpeningList, true);
  assert.deepEqual(plain(values(result.primaries)), ['Food', 'Travel']);
  assert.deepEqual(plain(result.detailed), []);
  assert.equal(result.primaries.some(entry => entry.hidden), false);
});

test('blank spaces count as nothing typed', () => {
  const result = F.buildFilterSuggestions(VISIBLE, HIDDEN, '   ');
  assert.equal(result.isOpeningList, true);
  assert.deepEqual(plain(values(result.primaries)), ['Food', 'Travel']);
});

test('typed text adds matching hidden categories after the visible ones, tagged', () => {
  const result = F.buildFilterSuggestions(VISIBLE, HIDDEN, 'food');
  assert.equal(result.isOpeningList, false);
  assert.deepEqual(plain(result.primaries), [{ value: 'Food', hidden: false }]);
  assert.deepEqual(plain(result.detailed), [
    { value: 'Food: Groceries', hidden: false },
    { value: 'Food: Coffee', hidden: false },
    { value: 'Food: Dining Out', hidden: true },
  ]);
});

test('a primary with only hidden categories is suggested, tagged, once text matches it', () => {
  const result = F.buildFilterSuggestions(VISIBLE, HIDDEN, 'gift');
  assert.deepEqual(plain(result.primaries), [{ value: 'Gifts', hidden: true }]);
  assert.deepEqual(plain(result.detailed), [
    { value: 'Gifts: Birthday', hidden: true },
    { value: 'Gifts: Holiday', hidden: true },
  ]);
  assert.deepEqual(plain(F.buildFilterSuggestions(VISIBLE, HIDDEN, '').primaries.map(entry => entry.value)), ['Food', 'Travel']);
});

test('a primary with both kinds appears once, untagged', () => {
  const result = F.buildFilterSuggestions(VISIBLE, HIDDEN, 'Food');
  assert.equal(result.primaries.filter(entry => entry.value === 'Food').length, 1);
  assert.equal(result.primaries[0].hidden, false);
});

test('the match ignores case and a colon matches primary and detailed parts separately', () => {
  assert.deepEqual(
    plain(values(F.buildFilterSuggestions(VISIBLE, HIDDEN, 'FOOD: DINING').detailed)),
    ['Food: Dining Out'],
  );
  assert.deepEqual(
    plain(values(F.buildFilterSuggestions(VISIBLE, HIDDEN, 'birthday').detailed)),
    ['Gifts: Birthday'],
  );
});

test('text matching nothing gives an empty list, and a missing hidden list is fine', () => {
  const none = F.buildFilterSuggestions(VISIBLE, HIDDEN, 'zzz');
  assert.deepEqual(plain([none.primaries, none.detailed]), [[], []]);
  assert.equal(F.buildFilterSuggestions(VISIBLE, undefined, 'food').detailed.length, 2);
});

// ── What typed or linked text selects ───────────────────────

test('a visible primary and a visible label filter as before', () => {
  assert.deepEqual(plain(F.resolveFilterCategoryText('food', VISIBLE, HIDDEN)),
    { primary: 'Food', detailed: '', display: 'Food' });
  assert.deepEqual(plain(F.resolveFilterCategoryText('food: coffee', VISIBLE, HIDDEN)),
    { primary: 'Food', detailed: 'Coffee', display: 'Food: Coffee' });
});

test('a hidden label filters to it exactly like a visible one', () => {
  assert.deepEqual(plain(F.resolveFilterCategoryText('Food: Dining Out', VISIBLE, HIDDEN)),
    { primary: 'Food', detailed: 'Dining Out', display: 'Food: Dining Out' });
});

test('a primary whose every label is hidden filters by that primary', () => {
  assert.deepEqual(plain(F.resolveFilterCategoryText('Gifts', VISIBLE, HIDDEN)),
    { primary: 'Gifts', detailed: '', display: 'Gifts' });
});

test('a partial primary name falls back to the first matching primary, hidden ones included', () => {
  assert.deepEqual(plain(F.resolveFilterCategoryText('gif', VISIBLE, HIDDEN)),
    { primary: 'Gifts', detailed: '', display: 'Gifts' });
});

test('text that matches nothing is kept as typed', () => {
  assert.deepEqual(plain(F.resolveFilterCategoryText('Mystery', VISIBLE, HIDDEN)),
    { primary: 'Mystery', detailed: '', display: null });
});

// ── What a load shows and saves ─────────────────────────────

test('a deep link shows all dates and accounts for this load and saves nothing', () => {
  const link = F.parseTransactionsDeepLink('?category=Food');
  assert.deepEqual(plain(F.transactionsStartupPlan(link, 'last_12_months', 'acct-1', true)), {
    showAllDatesForPage: true, restoreAccountId: null, forgetSavedAccount: false,
  });
  const search = F.parseTransactionsDeepLink('?search=coffee');
  assert.equal(F.transactionsStartupPlan(search, 'ytd', null, false).forgetSavedAccount, false);
});

test('a deep link with "all" already saved leaves the date filter alone', () => {
  const link = F.parseTransactionsDeepLink('?category=Food');
  assert.equal(F.transactionsStartupPlan(link, 'all', null, false).showAllDatesForPage, false);
});

test('an ordinary load restores the saved account, or forgets one that is gone', () => {
  const plainLoad = F.parseTransactionsDeepLink('');
  assert.deepEqual(plain(F.transactionsStartupPlan(plainLoad, 'ytd', 'acct-1', true)), {
    showAllDatesForPage: false, restoreAccountId: 'acct-1', forgetSavedAccount: false,
  });
  assert.deepEqual(plain(F.transactionsStartupPlan(plainLoad, 'ytd', 'acct-9', false)), {
    showAllDatesForPage: false, restoreAccountId: null, forgetSavedAccount: true,
  });
  assert.equal(F.transactionsStartupPlan(plainLoad, null, null, false).forgetSavedAccount, true);
});
