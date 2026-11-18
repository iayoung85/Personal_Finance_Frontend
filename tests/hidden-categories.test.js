const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = relPath => fs.readFileSync(path.join(root, relPath), 'utf8');

// Results cross the vm boundary, so compare through JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function loadShared(extraSandbox = {}) {
  const sandbox = { module: { exports: {} }, console, ...extraSandbox };
  vm.runInNewContext(
    `${read('shared/hidden-categories.js')}\nmodule.exports = { findHiddenCategory, hiddenCategoryNotice, hiddenCategoryEntry };`,
    sandbox,
    { filename: 'shared/hidden-categories.js' },
  );
  return sandbox.module.exports;
}

const HIDDEN = ['Food: Dining Out', 'Gifts: Birthday'];

test('typing a hidden label exactly is found whatever its case and spacing', () => {
  const { findHiddenCategory } = loadShared();
  assert.equal(findHiddenCategory('food:  dining out', HIDDEN), 'Food: Dining Out');
  assert.equal(findHiddenCategory('  Gifts: Birthday ', HIDDEN), 'Gifts: Birthday');
});

test('a visible label, a partial name and blank text name no hidden category', () => {
  const { findHiddenCategory } = loadShared();
  assert.equal(findHiddenCategory('Food: Groceries', HIDDEN), '');
  assert.equal(findHiddenCategory('Food: Dining', HIDDEN), '');
  assert.equal(findHiddenCategory('', HIDDEN), '');
  assert.equal(findHiddenCategory('Food: Dining Out', undefined), '');
});

test('the notice names the label and points to the Categories page', () => {
  const { hiddenCategoryNotice } = loadShared();
  assert.equal(
    hiddenCategoryNotice('Food: Dining Out'),
    'Food: Dining Out is hidden. Unhide it on the Categories page to use it.',
  );
});

test('a hidden label the control did not open with is refused with the notice', () => {
  const { hiddenCategoryEntry } = loadShared();
  assert.deepEqual(plain(hiddenCategoryEntry('Food: Dining Out', HIDDEN, '')), {
    label: 'Food: Dining Out',
    held: false,
    notice: 'Food: Dining Out is hidden. Unhide it on the Categories page to use it.',
  });
  assert.equal(hiddenCategoryEntry('Food: Dining Out', HIDDEN, 'Gifts: Birthday').notice.length > 0, true);
  assert.equal(hiddenCategoryEntry('Food: Dining Out', HIDDEN, undefined).held, false);
});

test('the hidden value a control opened with stays acceptable', () => {
  const { hiddenCategoryEntry } = loadShared();
  assert.deepEqual(plain(hiddenCategoryEntry('Food: Dining Out', HIDDEN, 'food: dining out')), {
    label: 'Food: Dining Out',
    held: true,
    notice: '',
  });
});

test('text that is not hidden passes through with no label, no hold and no notice', () => {
  const { hiddenCategoryEntry } = loadShared();
  assert.deepEqual(plain(hiddenCategoryEntry('Food: Groceries', HIDDEN, 'Food: Groceries')), {
    label: '', held: false, notice: '',
  });
});

// ── The inline row edit ─────────────────────────────────────

function loadRowEdit(visible, hidden) {
  const sandbox = {
    module: { exports: {} },
    console,
    availableCategories: visible,
    hiddenCategories: hidden,
    plaidTaxonomy: [],
    accounts: [],
  };
  vm.runInNewContext(
    `${read('shared/hidden-categories.js')}\n${read('transactions/categories.js')}\nmodule.exports = { _resolveAutocompleteCategory, resolveTargetCategory };`,
    sandbox,
    { filename: 'transactions/categories.js' },
  );
  return sandbox.module.exports;
}

test('a row holding a hidden category resolves it unchanged, so it is not refused or blanked', () => {
  const { _resolveAutocompleteCategory } = loadRowEdit(['Food: Groceries'], HIDDEN);
  assert.deepEqual(
    plain(_resolveAutocompleteCategory('Food: Dining Out', 'Food: Dining Out')),
    { value: 'Food: Dining Out' },
  );
});

test('typing another hidden label into a row is refused with the notice, not the unknown-category message', () => {
  const { _resolveAutocompleteCategory } = loadRowEdit(['Food: Groceries'], HIDDEN);
  assert.deepEqual(
    plain(_resolveAutocompleteCategory('Gifts: Birthday', 'Food: Groceries')),
    { error: 'Gifts: Birthday is hidden. Unhide it on the Categories page to use it.' },
  );
});

test('a visible label and an unknown one resolve as before', () => {
  const { _resolveAutocompleteCategory } = loadRowEdit(['Food: Groceries'], HIDDEN);
  assert.deepEqual(plain(_resolveAutocompleteCategory('Food: Groceries', '')), { value: 'Food: Groceries' });
  assert.match(_resolveAutocompleteCategory('Nope: Nothing', '').error, /not a known category/);
});

test('a rule target on a hidden label resolves, since a hidden label is still legal', () => {
  const { resolveTargetCategory } = loadRowEdit(['Food: Groceries'], HIDDEN);
  assert.deepEqual(plain(resolveTargetCategory('Food', 'Dining Out')), { value: 'Food: Dining Out' });
});

// ── The shared picker cache ─────────────────────────────────

function loadCache(storage, now) {
  const localStorage = {
    getItem: key => (key in storage ? storage[key] : null),
    setItem: (key, value) => { storage[key] = String(value); },
  };
  const sandbox = { module: { exports: {} }, console, localStorage, Date: { now: () => now } };
  vm.runInNewContext(
    `${read('shared/categories-autocomplete.js')}\nmodule.exports = { readCachedCategoryLists, cacheCategoryLists };`,
    sandbox,
    { filename: 'shared/categories-autocomplete.js' },
  );
  return sandbox.module.exports;
}

test('both lists are cached with one timestamp and read back together', () => {
  const storage = {};
  const cache = loadCache(storage, 1000);
  cache.cacheCategoryLists(['Food: Groceries'], ['Food: Dining Out']);
  assert.deepEqual(plain(cache.readCachedCategoryLists(10000)), {
    visible: ['Food: Groceries'], hidden: ['Food: Dining Out'],
  });
  assert.equal(storage.pf_categories_cached_at, '1000');
});

test('a cache written before the hidden list was kept is refetched, not read as nothing hidden', () => {
  const storage = {
    pf_cached_categories: JSON.stringify(['Food: Groceries']),
    pf_categories_cached_at: '1000',
  };
  assert.equal(loadCache(storage, 2000).readCachedCategoryLists(10000), null);
});

test('an expired cache and an empty visible list are both refetched', () => {
  const storage = {};
  const cache = loadCache(storage, 1000);
  cache.cacheCategoryLists(['Food: Groceries'], []);
  assert.equal(loadCache(storage, 1000 + 20000).readCachedCategoryLists(10000), null);
  cache.cacheCategoryLists([], []);
  assert.equal(loadCache(storage, 1000).readCachedCategoryLists(10000), null);
});

test('removing the timestamp, as the Categories page does after a change, forces a refetch', () => {
  const storage = {};
  const cache = loadCache(storage, 1000);
  cache.cacheCategoryLists(['Food: Groceries'], ['Gifts: Birthday']);
  delete storage.pf_categories_cached_at;
  assert.equal(cache.readCachedCategoryLists(10000), null);
});
