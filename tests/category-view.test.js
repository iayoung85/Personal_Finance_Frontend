const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const categoriesDir = path.join(__dirname, '..', 'categories');

// The three files are plain declarations with no DOM, loaded in the page's order.
function loadHelpers() {
  const sandbox = { module: { exports: {} } };
  ['primary-kinds.js', 'category-tree.js'].forEach(name => {
    const file = path.join(categoriesDir, name);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  });
  const viewPath = path.join(categoriesDir, 'category-view.js');
  vm.runInNewContext(
    `${fs.readFileSync(viewPath, 'utf8')}\nmodule.exports = { buildCategoryTree, categoryFilterOptions, normalizeCategoryView, nextCategorySort, effectiveCollapsedPrimaries, categorySearchActive, categoryViewNarrows, applyCategoryView, pruneSelectionToView, visibleCategoryLabels };`,
    sandbox,
    { filename: viewPath }
  );
  return sandbox.module.exports;
}

const helpers = loadHelpers();

// Results cross the vm boundary, so compare through JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function entry(label, extra = {}) {
  const colon = label.indexOf(':');
  return {
    label,
    primary: colon === -1 ? label : label.slice(0, colon).trim(),
    detailed: colon === -1 ? null : label.slice(colon + 1).trim(),
    uses: 0,
    hidden: false,
    ...extra
  };
}

// Food (picked Spending): 15 uses, one hidden. Travel (by name Spending): 5 uses.
// Salary (picked Earned income): 0 uses. Transfers (pinned Transfer): 2 uses, all hidden.
const LABELS = [
  entry('Food: Groceries', { uses: 12 }),
  entry('Food: Dining', { uses: 3, hidden: true }),
  entry('Food: Coffee', { uses: 0 }),
  entry('Travel: Flights', { uses: 5 }),
  entry('Travel: Hotels', { uses: 0 }),
  entry('Salary: Paycheck', { uses: 0 }),
  entry('Transfers: Credit Card Payment', { uses: 2, hidden: true })
];

const KINDS = [
  { name: 'Food', kind: 'spending', kind_is_set: true, pinned_reason: null },
  { name: 'Travel', kind: 'spending', kind_is_set: false, pinned_reason: null },
  { name: 'Salary', kind: 'income', kind_is_set: true, pinned_reason: null },
  { name: 'Transfers', kind: 'transfer', kind_is_set: false, pinned_reason: 'unlinked_transfer_in' }
];

const TREE = helpers.buildCategoryTree(LABELS, KINDS);

function view(overrides = {}) {
  return { sortColumn: 'name', sortDirection: 'asc', searchText: '', filter: 'all', ...overrides };
}

const primaries = rows => plain(rows.map(row => row.primary));
const childLabels = (rows, primary) => plain(rows.find(row => row.primary === primary).children.map(child => child.label));

// ── Sort ────────────────────────────────────────────────────

test('the table opens sorted by Name ascending, children included', () => {
  const rows = helpers.applyCategoryView(TREE, view());
  assert.deepEqual(primaries(rows), ['Food', 'Salary', 'Transfers', 'Travel']);
  assert.deepEqual(childLabels(rows, 'Food'), ['Food: Coffee', 'Food: Dining', 'Food: Groceries']);
});

test('Name descending reverses primaries and the rows inside them', () => {
  const rows = helpers.applyCategoryView(TREE, view({ sortDirection: 'desc' }));
  assert.deepEqual(primaries(rows), ['Travel', 'Transfers', 'Salary', 'Food']);
  assert.deepEqual(childLabels(rows, 'Food'), ['Food: Groceries', 'Food: Dining', 'Food: Coffee']);
});

test('Uses sorts primaries by their summed uses and children by their own', () => {
  const ascending = helpers.applyCategoryView(TREE, view({ sortColumn: 'uses' }));
  // Salary 0, Transfers 2, Travel 5, Food 15.
  assert.deepEqual(primaries(ascending), ['Salary', 'Transfers', 'Travel', 'Food']);
  // Coffee 0, Dining 3, Groceries 12.
  assert.deepEqual(childLabels(ascending, 'Food'), ['Food: Coffee', 'Food: Dining', 'Food: Groceries']);

  const descending = helpers.applyCategoryView(TREE, view({ sortColumn: 'uses', sortDirection: 'desc' }));
  assert.deepEqual(primaries(descending), ['Food', 'Travel', 'Transfers', 'Salary']);
  assert.deepEqual(childLabels(descending, 'Food'), ['Food: Groceries', 'Food: Dining', 'Food: Coffee']);
});

test('a tie on Uses falls to Name ascending in both directions', () => {
  const tied = helpers.buildCategoryTree([
    entry('B: Two', { uses: 4 }), entry('A: One', { uses: 4 }), entry('C: Three', { uses: 1 })
  ], []);
  assert.deepEqual(primaries(helpers.applyCategoryView(tied, view({ sortColumn: 'uses' }))), ['C', 'A', 'B']);
  assert.deepEqual(primaries(helpers.applyCategoryView(tied, view({ sortColumn: 'uses', sortDirection: 'desc' }))), ['A', 'B', 'C']);

  const sameRows = helpers.buildCategoryTree([entry('P: Zed', { uses: 2 }), entry('P: Ant', { uses: 2 })], []);
  const desc = helpers.applyCategoryView(sameRows, view({ sortColumn: 'uses', sortDirection: 'desc' }));
  assert.deepEqual(childLabels(desc, 'P'), ['P: Ant', 'P: Zed']);
});

test('Kind sorts primaries by display name and leaves children in Name order', () => {
  // Earned income, Spending (Food), Spending (Travel, by name), Transfer.
  const ascending = helpers.applyCategoryView(TREE, view({ sortColumn: 'kind' }));
  assert.deepEqual(primaries(ascending), ['Salary', 'Food', 'Travel', 'Transfers']);
  assert.deepEqual(childLabels(ascending, 'Travel'), ['Travel: Flights', 'Travel: Hotels']);

  const descending = helpers.applyCategoryView(TREE, view({ sortColumn: 'kind', sortDirection: 'desc' }));
  assert.deepEqual(primaries(descending), ['Transfers', 'Food', 'Travel', 'Salary']);
  assert.deepEqual(childLabels(descending, 'Travel'), ['Travel: Flights', 'Travel: Hotels']);
});

test('Kind sorts a by-name kind with the picked ones, by the kind name', () => {
  const rows = helpers.applyCategoryView(TREE, view({ sortColumn: 'kind' }));
  // Food (picked) and Travel (by name) are both Spending, so Name orders them.
  assert.deepEqual(primaries(rows).slice(1, 3), ['Food', 'Travel']);
});

test('Hidden sorts not hidden, partly hidden, fully hidden, and children by their box', () => {
  const ascending = helpers.applyCategoryView(TREE, view({ sortColumn: 'hidden' }));
  // Salary and Travel none, Food some, Transfers all.
  assert.deepEqual(primaries(ascending), ['Salary', 'Travel', 'Food', 'Transfers']);
  assert.deepEqual(childLabels(ascending, 'Food'), ['Food: Coffee', 'Food: Groceries', 'Food: Dining']);

  const descending = helpers.applyCategoryView(TREE, view({ sortColumn: 'hidden', sortDirection: 'desc' }));
  assert.deepEqual(primaries(descending), ['Transfers', 'Food', 'Salary', 'Travel']);
  assert.deepEqual(childLabels(descending, 'Food'), ['Food: Dining', 'Food: Coffee', 'Food: Groceries']);
});

test('children stay under their own primary whatever the sort', () => {
  ['name', 'kind', 'uses', 'hidden'].forEach(sortColumn => {
    ['asc', 'desc'].forEach(sortDirection => {
      const rows = helpers.applyCategoryView(TREE, view({ sortColumn, sortDirection }));
      rows.forEach(row => row.children.forEach(child => assert.equal(child.primary, row.primary)));
      assert.equal(rows.reduce((sum, row) => sum + row.children.length, 0), LABELS.length);
    });
  });
});

test('a click on a header sorts ascending, a second click reverses, another column starts over', () => {
  assert.deepEqual(plain(helpers.nextCategorySort(view(), 'uses')), { sortColumn: 'uses', sortDirection: 'asc' });
  assert.deepEqual(plain(helpers.nextCategorySort(view({ sortColumn: 'uses' }), 'uses')), { sortColumn: 'uses', sortDirection: 'desc' });
  assert.deepEqual(plain(helpers.nextCategorySort(view({ sortColumn: 'uses', sortDirection: 'desc' }), 'uses')), { sortColumn: 'uses', sortDirection: 'asc' });
  assert.deepEqual(plain(helpers.nextCategorySort(view({ sortColumn: 'uses', sortDirection: 'desc' }), 'kind')), { sortColumn: 'kind', sortDirection: 'asc' });
  assert.deepEqual(plain(helpers.nextCategorySort(view(), 'nonsense')), { sortColumn: 'name', sortDirection: 'asc' });
});

test('the view state falls back to safe values', () => {
  assert.deepEqual(plain(helpers.normalizeCategoryView(null)), view());
  assert.deepEqual(plain(helpers.normalizeCategoryView({ sortColumn: 'x', sortDirection: 'up', searchText: 3, filter: 'kind:nope' })), view());
});

// ── Search ──────────────────────────────────────────────────

test('search by primary name shows every category it holds', () => {
  const rows = helpers.applyCategoryView(TREE, view({ searchText: 'trav' }));
  assert.deepEqual(primaries(rows), ['Travel']);
  assert.deepEqual(childLabels(rows, 'Travel'), ['Travel: Flights', 'Travel: Hotels']);
});

test('search by detailed name shows the matching category with its primary row', () => {
  const rows = helpers.applyCategoryView(TREE, view({ searchText: 'dining' }));
  assert.deepEqual(primaries(rows), ['Food']);
  assert.deepEqual(childLabels(rows, 'Food'), ['Food: Dining']);
});

test('text matching a primary and another primary\'s detailed name shows both', () => {
  const tree = helpers.buildCategoryTree([
    entry('Food: Groceries'), entry('Food: Dining'), entry('Home: Food Storage'), entry('Home: Repairs')
  ], []);
  const rows = helpers.applyCategoryView(tree, view({ searchText: 'food' }));
  assert.deepEqual(primaries(rows), ['Food', 'Home']);
  assert.deepEqual(childLabels(rows, 'Food'), ['Food: Dining', 'Food: Groceries']);
  assert.deepEqual(childLabels(rows, 'Home'), ['Home: Food Storage']);
});

test('search matching nothing leaves no rows', () => {
  assert.deepEqual(plain(helpers.applyCategoryView(TREE, view({ searchText: 'zzz' }))), []);
});

test('search ignores case and surrounding space, and reads as plain text', () => {
  assert.deepEqual(primaries(helpers.applyCategoryView(TREE, view({ searchText: '  gROCER ' }))), ['Food']);
  assert.deepEqual(plain(helpers.applyCategoryView(TREE, view({ searchText: 'food:' }))), [], 'the colon of a label is not searched');
  assert.deepEqual(plain(helpers.applyCategoryView(TREE, view({ searchText: 'uses:0' }))), [], 'no keyword syntax');
});

test('a search does not match the kind text or the other columns', () => {
  assert.deepEqual(plain(helpers.applyCategoryView(TREE, view({ searchText: 'spending' }))), []);
});

test('a search opens its primaries over the stored folds, and clearing it restores them', () => {
  const folded = new Set(['Food']);
  assert.equal(helpers.effectiveCollapsedPrimaries(view({ searchText: 'cof' }), folded).has('Food'), false);
  assert.equal(helpers.effectiveCollapsedPrimaries(view({ searchText: '   ' }), folded).has('Food'), true);
  assert.equal(helpers.effectiveCollapsedPrimaries(view(), folded).has('Food'), true);
  assert.equal(folded.has('Food'), true, 'the stored folds are not touched');
  const rows = helpers.applyCategoryView(TREE, view({ searchText: 'cof' }));
  assert.equal(rows[0].forceExpanded, true);
  assert.equal(helpers.applyCategoryView(TREE, view())[0].forceExpanded, false);
});

test('shift-click order follows the rows in view, in sorted order, skipping folded primaries', () => {
  const rows = helpers.applyCategoryView(TREE, view({ sortColumn: 'uses', sortDirection: 'desc' }));
  const folds = helpers.effectiveCollapsedPrimaries(view(), new Set(['Salary']));
  assert.deepEqual(plain(helpers.visibleCategoryLabels(rows, folds)), [
    'Food: Groceries', 'Food: Dining', 'Food: Coffee',
    'Travel: Flights', 'Travel: Hotels',
    'Transfers: Credit Card Payment'
  ]);
});

// ── Filter ──────────────────────────────────────────────────

test('the filter list is Show all, Unused, Used, Hidden, then each kind in picker order', () => {
  const options = plain(helpers.categoryFilterOptions());
  assert.deepEqual(options.slice(0, 4).map(option => option.label), ['Show all', 'Unused categories', 'Used categories', 'Hidden categories']);
  assert.deepEqual(options.slice(4), [
    { value: 'kind:income', label: 'Earned income' },
    { value: 'kind:other_inflow', label: 'Other inflow' },
    { value: 'kind:retirement_income', label: 'Retirement income' },
    { value: 'kind:spending', label: 'Spending' },
    { value: 'kind:savings', label: 'Savings' },
    { value: 'kind:transfer', label: 'Transfer' },
    { value: 'kind:adjustment', label: 'Adjustment' }
  ]);
});

test('Show all keeps every category', () => {
  const rows = helpers.applyCategoryView(TREE, view({ filter: 'all' }));
  assert.equal(rows.reduce((sum, row) => sum + row.children.length, 0), LABELS.length);
});

test('Unused keeps categories with no uses, and a primary with at least one', () => {
  const rows = helpers.applyCategoryView(TREE, view({ filter: 'unused' }));
  assert.deepEqual(primaries(rows), ['Food', 'Salary', 'Travel']);
  assert.deepEqual(childLabels(rows, 'Food'), ['Food: Coffee']);
  assert.deepEqual(childLabels(rows, 'Travel'), ['Travel: Hotels']);
});

test('Used keeps categories with uses', () => {
  const rows = helpers.applyCategoryView(TREE, view({ filter: 'used' }));
  assert.deepEqual(primaries(rows), ['Food', 'Transfers', 'Travel']);
  assert.deepEqual(childLabels(rows, 'Food'), ['Food: Dining', 'Food: Groceries']);
});

test('Hidden keeps hidden categories only', () => {
  const rows = helpers.applyCategoryView(TREE, view({ filter: 'hidden' }));
  assert.deepEqual(primaries(rows), ['Food', 'Transfers']);
  assert.deepEqual(childLabels(rows, 'Food'), ['Food: Dining']);
});

test('a kind entry keeps the primaries that count as that kind, picked or by name', () => {
  const spending = helpers.applyCategoryView(TREE, view({ filter: 'kind:spending' }));
  // Food is picked, Travel is spending by name.
  assert.deepEqual(primaries(spending), ['Food', 'Travel']);
  assert.equal(spending.find(row => row.primary === 'Travel').children.length, 2);

  assert.deepEqual(primaries(helpers.applyCategoryView(TREE, view({ filter: 'kind:income' }))), ['Salary']);
  assert.deepEqual(primaries(helpers.applyCategoryView(TREE, view({ filter: 'kind:transfer' }))), ['Transfers']);
  assert.deepEqual(plain(helpers.applyCategoryView(TREE, view({ filter: 'kind:savings' }))), []);
});

test('a primary with no kind entry matches no kind filter', () => {
  const tree = helpers.buildCategoryTree([entry('Mystery: Thing')], []);
  assert.deepEqual(plain(helpers.applyCategoryView(tree, view({ filter: 'kind:spending' }))), []);
  assert.equal(helpers.applyCategoryView(tree, view()).length, 1);
});

test('search and filter apply together', () => {
  const unusedFood = helpers.applyCategoryView(TREE, view({ filter: 'unused', searchText: 'food' }));
  assert.deepEqual(primaries(unusedFood), ['Food']);
  assert.deepEqual(childLabels(unusedFood, 'Food'), ['Food: Coffee'], 'a matching primary still gives way to the filter');

  const detailed = helpers.applyCategoryView(TREE, view({ filter: 'used', searchText: 'hotel' }));
  assert.deepEqual(plain(detailed), [], 'a match the filter removes is gone');

  const kindAndText = helpers.applyCategoryView(TREE, view({ filter: 'kind:spending', searchText: 'flights' }));
  assert.deepEqual(primaries(kindAndText), ['Travel']);
  assert.deepEqual(childLabels(kindAndText, 'Travel'), ['Travel: Flights']);
});

test('a primary keeps the figures over all its categories when some are filtered out', () => {
  const rows = helpers.applyCategoryView(TREE, view({ filter: 'unused' }));
  const food = rows.find(row => row.primary === 'Food');
  assert.equal(food.children.length, 1);
  assert.equal(food.totalCount, 3);
  assert.equal(food.uses, 15, 'Uses still sums every category, because its link opens them all');
  assert.equal(food.hiddenState, 'some');
  assert.equal(TREE.find(group => group.primary === 'Food').children.length, 3, 'the source tree is untouched');
});

test('the view reports whether search or filter narrows the table', () => {
  assert.equal(helpers.categoryViewNarrows(view()), false);
  assert.equal(helpers.categoryViewNarrows(view({ searchText: ' ' })), false);
  assert.equal(helpers.categoryViewNarrows(view({ searchText: 'a' })), true);
  assert.equal(helpers.categoryViewNarrows(view({ filter: 'used' })), true);
  assert.equal(helpers.categorySearchActive(view({ searchText: 'a' })), true);
});

// ── Selection ───────────────────────────────────────────────

test('rows that leave the view leave the selection and the anchor', () => {
  const rows = helpers.applyCategoryView(TREE, view({ filter: 'unused' }));
  const result = helpers.pruneSelectionToView(
    { labels: ['Food: Coffee', 'Food: Groceries', 'Travel: Hotels'], anchor: 'Food: Groceries' },
    null,
    rows
  );
  assert.deepEqual(plain(result.selection), { labels: ['Food: Coffee', 'Travel: Hotels'], anchor: null });
});

test('a selected primary row leaves the selection when its primary leaves the view', () => {
  const rows = helpers.applyCategoryView(TREE, view({ searchText: 'sal' }));
  assert.equal(helpers.pruneSelectionToView({ labels: [], anchor: null }, 'Salary', rows).selectedPrimary, 'Salary');
  assert.equal(helpers.pruneSelectionToView({ labels: [], anchor: null }, 'Food', rows).selectedPrimary, null);
});

test('a selection wholly in view is returned as it was', () => {
  const rows = helpers.applyCategoryView(TREE, view());
  const selection = { labels: ['Food: Coffee', 'Travel: Flights'], anchor: 'Food: Coffee' };
  assert.deepEqual(plain(helpers.pruneSelectionToView(selection, null, rows).selection), selection);
});
