const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const kindsPath = path.join(__dirname, '..', 'categories', 'primary-kinds.js');
const treePath = path.join(__dirname, '..', 'categories', 'category-tree.js');

// Both files are plain declarations with no DOM; the tree reads the kind helpers.
function loadHelpers() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(kindsPath, 'utf8'), sandbox, { filename: kindsPath });
  vm.runInNewContext(
    `${fs.readFileSync(treePath, 'utf8')}\nmodule.exports = { buildCategoryTree, categoryRowName, sumPrimaryUses, primaryHiddenState, visibleCategoryLabels, categoryUsesHref, selectionAfterClick, selectionAfterRightClick, categoryMenuEntries, primaryMenuEntries, isNewPrimaryName, findPrimaryGroup, defaultKindForNewPrimary, planCategoryEditSteps, planPrimaryEditSteps, planCategoryCreateSteps, runCategorySaveSteps, describePartialSave, plaidMappingView, mergeSummary, removeUnusedSummary };`,
    sandbox,
    { filename: treePath }
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
    description: null,
    locked: false,
    locked_message: null,
    can_delete: true,
    delete_reason: null,
    plaid_categories: [],
    is_plaid_default: false,
    ...extra
  };
}

const LABELS = [
  entry('food: Snacks', { uses: 1 }),
  entry('Food: Groceries', { uses: 12 }),
  entry('Food: Dining', { uses: 3, hidden: true }),
  entry('Bank Fees: Atm Fees', { uses: 0 }),
  entry('Adjustments'),
  entry('Adjustments: Investment Gain/Loss', { uses: 4 })
];

const KINDS = [
  { name: 'Food', kind: 'spending', kind_is_set: true, pinned_reason: null },
  { name: 'Bank Fees', kind: 'spending', kind_is_set: false, pinned_reason: null },
  { name: 'Adjustments', kind: 'adjustment', kind_is_set: false, pinned_reason: 'investment_gain_loss' }
];

// ── Tree ────────────────────────────────────────────────────

test('primaries sort ignoring case and their categories sort by name', () => {
  const tree = helpers.buildCategoryTree(LABELS, KINDS);
  assert.deepEqual(plain(tree.map(group => group.primary)), ['Adjustments', 'Bank Fees', 'food', 'Food']);
  const food = tree.find(group => group.primary === 'Food');
  assert.deepEqual(plain(food.children.map(child => child.label)), ['Food: Dining', 'Food: Groceries']);
});

test('a primary spelled in another case is its own group, as the list spells it', () => {
  const tree = helpers.buildCategoryTree(LABELS, KINDS);
  const lower = tree.find(group => group.primary === 'food');
  assert.deepEqual(plain(lower.children.map(child => child.label)), ['food: Snacks']);
  assert.equal(lower.kindView.label, 'Spending', 'kind matches ignoring case, as the API keys it');
});

test('a primary with one category holds just that row', () => {
  const tree = helpers.buildCategoryTree(LABELS, KINDS);
  const fees = tree.find(group => group.primary === 'Bank Fees');
  assert.equal(fees.children.length, 1);
  assert.equal(helpers.categoryRowName(fees.children[0]), 'Atm Fees');
});

test('a label with no colon sits first under its own primary and shows its whole name', () => {
  const tree = helpers.buildCategoryTree(LABELS, KINDS);
  const adjustments = tree.find(group => group.primary === 'Adjustments');
  assert.deepEqual(plain(adjustments.children.map(child => child.label)), ['Adjustments', 'Adjustments: Investment Gain/Loss']);
  assert.equal(helpers.categoryRowName(adjustments.children[0]), 'Adjustments');
});

test('an entry without primary or detailed fields is grouped from its label', () => {
  const tree = helpers.buildCategoryTree([{ label: 'Travel: Flights', uses: 2 }], []);
  assert.equal(tree[0].primary, 'Travel');
  assert.equal(helpers.categoryRowName({ label: 'Travel: Flights' }), 'Travel: Flights');
});

test('blank and malformed entries are skipped', () => {
  const tree = helpers.buildCategoryTree([null, { label: '' }, { label: '   ' }, { uses: 3 }, entry('A: B')], []);
  assert.deepEqual(plain(tree.map(group => group.primary)), ['A']);
});

test('the kind view comes from primary_categories: set, by name, pinned', () => {
  const tree = helpers.buildCategoryTree(LABELS, KINDS);
  const byName = name => tree.find(group => group.primary === name).kindView;
  assert.equal(byName('Food').label, 'Spending');
  assert.equal(byName('Bank Fees').label, 'By name: Spending');
  assert.equal(byName('Adjustments').mode, 'pinned');
});

test('a primary sums its categories uses', () => {
  assert.equal(helpers.sumPrimaryUses([{ uses: 12 }, { uses: 3 }, { uses: 0 }]), 15);
  assert.equal(helpers.sumPrimaryUses([{ uses: 'x' }, {}, { uses: 2 }]), 2);
  assert.equal(helpers.sumPrimaryUses([]), 0);
  const food = helpers.buildCategoryTree(LABELS, KINDS).find(group => group.primary === 'Food');
  assert.equal(food.uses, 15);
});

test('the primary hidden box is all, some or none of its categories', () => {
  assert.equal(helpers.primaryHiddenState([{ hidden: true }, { hidden: true }]), 'all');
  assert.equal(helpers.primaryHiddenState([{ hidden: true }, { hidden: false }]), 'some');
  assert.equal(helpers.primaryHiddenState([{ hidden: false }, {}]), 'none');
  assert.equal(helpers.primaryHiddenState([]), 'none');
});

test('folded primaries drop out of the visible order', () => {
  const tree = helpers.buildCategoryTree(LABELS, KINDS);
  const labels = helpers.visibleCategoryLabels(tree, new Set(['Adjustments', 'food']));
  assert.deepEqual(plain(labels), ['Bank Fees: Atm Fees', 'Food: Dining', 'Food: Groceries']);
});

test('the Uses link encodes a primary or a full label', () => {
  assert.equal(helpers.categoryUsesHref('Food'), 'transactions.html?category=Food');
  assert.equal(
    helpers.categoryUsesHref('Adjustments: Investment Gain/Loss'),
    'transactions.html?category=Adjustments%3A%20Investment%20Gain%2FLoss'
  );
});

// ── Selection ───────────────────────────────────────────────

const ORDER = ['A: 1', 'A: 2', 'B: 1', 'B: 2'];

test('a plain click selects one row and becomes the anchor', () => {
  const next = helpers.selectionAfterClick({ labels: ['A: 1', 'B: 1'], anchor: 'A: 1' }, 'A: 2', {}, ORDER);
  assert.deepEqual(plain(next), { labels: ['A: 2'], anchor: 'A: 2' });
});

test('Cmd-click adds and removes one row', () => {
  const added = helpers.selectionAfterClick({ labels: ['A: 1'], anchor: 'A: 1' }, 'B: 2', { additive: true }, ORDER);
  assert.deepEqual(plain(added.labels), ['A: 1', 'B: 2']);
  const removed = helpers.selectionAfterClick(added, 'A: 1', { additive: true }, ORDER);
  assert.deepEqual(plain(removed.labels), ['B: 2']);
});

test('Shift-click selects the range from the anchor, across primaries', () => {
  const next = helpers.selectionAfterClick({ labels: ['A: 2'], anchor: 'A: 2' }, 'B: 2', { range: true }, ORDER);
  assert.deepEqual(plain(next), { labels: ['A: 2', 'B: 1', 'B: 2'], anchor: 'A: 2' });
});

test('right-click on a selected row keeps the selection; elsewhere it selects that row alone', () => {
  const selection = { labels: ['A: 1', 'B: 1'], anchor: 'A: 1' };
  assert.deepEqual(plain(helpers.selectionAfterRightClick(selection, 'B: 1')), selection);
  assert.deepEqual(plain(helpers.selectionAfterRightClick(selection, 'A: 2')), { labels: ['A: 2'], anchor: 'A: 2' });
});

// ── Right-click menu ────────────────────────────────────────

function itemsById(items) {
  const byId = {};
  items.filter(item => !item.divider).forEach(item => { byId[item.id] = plain(item); });
  return byId;
}

test('a single deletable category: everything but Merge is open', () => {
  const target = entry('Food: Snacks');
  const items = helpers.categoryMenuEntries(target, [target]);
  const byId = itemsById(items);
  assert.equal(byId.edit.enabled, true);
  assert.equal(byId.delete.enabled, true);
  assert.equal(byId.hide.enabled, true);
  assert.equal(byId.hide.label, 'Hide Category');
  assert.equal(byId.merge.enabled, false);
  assert.match(byId.merge.reason, /two or more/);
  assert.equal(byId.new.enabled, true);
  assert.equal(byId['new-sub'].enabled, true);
  assert.equal(items.filter(item => item.divider).length, 1, 'one divider before the New entries');
});

test('a category in use: Delete greyed with the API reason as it stands', () => {
  const target = entry('Food: Groceries', { uses: 12, can_delete: false, delete_reason: 'Move its 12 transactions to another category first.' });
  const byId = itemsById(helpers.categoryMenuEntries(target, [target]));
  assert.equal(byId.delete.enabled, false);
  assert.equal(byId.delete.reason, 'Move its 12 transactions to another category first.');
});

test('a hidden category offers Unhide', () => {
  const target = entry('Food: Dining', { hidden: true });
  const byId = itemsById(helpers.categoryMenuEntries(target, [target]));
  assert.equal(byId.unhide.label, 'Unhide Category');
  assert.equal(byId.hide, undefined);
});

test('a locked category: Edit, Delete and Merge greyed with the locked message, Hide allowed', () => {
  const message = 'The app writes this label when a transfer is unlinked.';
  const target = entry('Transfer In: Account Transfer', {
    locked: true,
    locked_message: message,
    can_delete: false,
    delete_reason: message
  });
  const byId = itemsById(helpers.categoryMenuEntries(target, [target]));
  assert.equal(byId.edit.enabled, false);
  assert.equal(byId.edit.reason, message);
  assert.equal(byId.delete.enabled, false);
  assert.equal(byId.delete.reason, message);
  assert.equal(byId.hide.enabled, true);
  assert.equal(byId.merge.enabled, false);
});

test('a multi-row selection merges into the right-clicked row and hides them all', () => {
  const target = entry('Food: Groceries', { uses: 12, can_delete: false, delete_reason: 'In use.' });
  const others = [entry('Food: Snacks', { uses: 1 }), entry('Food: Dining', { uses: 3, hidden: true })];
  const byId = itemsById(helpers.categoryMenuEntries(target, [others[0], target, others[1]]));
  assert.equal(byId.merge.enabled, true);
  assert.equal(byId.merge.label, 'Merge 3 Categories…');
  assert.equal(byId.hide.label, 'Hide 3 Categories');
  assert.equal(byId.delete.enabled, false, 'Delete still answers for the right-clicked row');
  assert.equal(byId.edit.enabled, true);
});

test('a locked row in the selection blocks Merge as a source, naming it', () => {
  const target = entry('Food: Groceries');
  const locked = entry('Transfer In: Account Transfer', { locked: true, locked_message: 'App-owned.' });
  const byId = itemsById(helpers.categoryMenuEntries(target, [target, locked]));
  assert.equal(byId.merge.enabled, false);
  assert.equal(byId.merge.reason, 'Transfer In: Account Transfer: App-owned.');
});

test('a locked row may be the Merge target', () => {
  const target = entry('Transfer In: Account Transfer', { locked: true, locked_message: 'App-owned.' });
  const byId = itemsById(helpers.categoryMenuEntries(target, [target, entry('Food: Groceries')]));
  assert.equal(byId.merge.enabled, true);
});

test('a primary row: Merge always greyed, Delete only when every category can go', () => {
  const tree = helpers.buildCategoryTree([
    entry('Food: Groceries', { can_delete: false, delete_reason: 'In use.' }),
    entry('Food: Snacks')
  ], KINDS);
  const byId = itemsById(helpers.primaryMenuEntries(tree[0]));
  assert.equal(byId.merge.enabled, false);
  assert.match(byId.merge.reason, /primary category can't be merged/);
  assert.equal(byId.delete.enabled, false);
  assert.equal(byId.delete.reason, 'Groceries: In use.');
  assert.equal(byId.edit.enabled, true);
  assert.equal(byId.hide.enabled, true);
  assert.equal(byId['new-sub'].enabled, true);

  const free = helpers.buildCategoryTree([entry('Food: Snacks'), entry('Food: Chips')], KINDS);
  const freeById = itemsById(helpers.primaryMenuEntries(free[0]));
  assert.equal(freeById.delete.enabled, true);
  assert.equal(freeById.delete.label, 'Delete Category and its 2 Subcategories');
});

test('a primary holding a locked label greys Edit with its message', () => {
  const tree = helpers.buildCategoryTree([
    entry('Transfer In: Account Transfer', { locked: true, locked_message: 'App-owned.', can_delete: false, delete_reason: 'App-owned.' })
  ], []);
  const byId = itemsById(helpers.primaryMenuEntries(tree[0]));
  assert.equal(byId.edit.enabled, false);
  assert.equal(byId.edit.reason, 'App-owned.');
});

test('a primary whose categories are all hidden offers Unhide', () => {
  const tree = helpers.buildCategoryTree([entry('Food: A', { hidden: true }), entry('Food: B', { hidden: true })], []);
  const byId = itemsById(helpers.primaryMenuEntries(tree[0]));
  assert.equal(byId.unhide.label, 'Unhide Category');
});

// ── Kind for a new primary ──────────────────────────────────

test('a typed primary is new unless the list has it, ignoring case and space', () => {
  const tree = helpers.buildCategoryTree(LABELS, KINDS);
  assert.equal(helpers.isNewPrimaryName('  bank fees ', tree), false);
  assert.equal(helpers.isNewPrimaryName('Pets', tree), true);
  assert.equal(helpers.isNewPrimaryName('', tree), false);
  assert.equal(helpers.findPrimaryGroup('BANK FEES', tree).primary, 'Bank Fees');
});

test('a new primary preselects the kind the source primary counts as, else Spending', () => {
  assert.equal(helpers.defaultKindForNewPrimary({ kind: 'income', kind_is_set: true }), 'income');
  assert.equal(helpers.defaultKindForNewPrimary({ kind: 'savings', kind_is_set: false }), 'savings', 'by name counts too');
  assert.equal(helpers.defaultKindForNewPrimary({ kind: 'excluded' }), 'spending');
  assert.equal(helpers.defaultKindForNewPrimary(undefined), 'spending');
});

// ── Saving ──────────────────────────────────────────────────

const ORIGINAL = { label: 'Food: Groceries', primary: 'Food', detailed: 'Groceries', description: null, hidden: false };

test('an edit that changes nothing makes no calls', () => {
  const steps = helpers.planCategoryEditSteps(ORIGINAL, {
    name: ' Groceries ', parent: 'Food', parentIsNew: false, kind: 'spending', description: '  ', hidden: false
  });
  assert.deepEqual(plain(steps), []);
});

test('a rename plus description plus hide moves first, then writes to the new label', async () => {
  const steps = helpers.planCategoryEditSteps(ORIGINAL, {
    name: 'Supermarket', parent: 'Food', parentIsNew: false, kind: 'income', description: 'Weekly shop', hidden: true
  });
  assert.deepEqual(plain(steps.map(step => step.call)), ['label', 'description', 'hidden']);
  assert.equal(steps[0].kind, undefined, 'no kind for a listed primary');

  const calls = [];
  const api = {
    editLabel: async body => { calls.push(['label', body]); return { ok: true, data: { label: 'Food: Supermarket' } }; },
    setDescription: async body => { calls.push(['description', body]); return { ok: true, data: {} }; },
    setHidden: async body => { calls.push(['hidden', body]); return { ok: true, data: {} }; }
  };
  const outcome = await helpers.runCategorySaveSteps(steps, { label: 'Food: Groceries' }, api);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.label, 'Food: Supermarket');
  assert.deepEqual(plain(calls), [
    ['label', { label: 'Food: Groceries', primary: 'Food', detailed: 'Supermarket' }],
    ['description', { label: 'Food: Supermarket', description: 'Weekly shop' }],
    ['hidden', { labels: ['Food: Supermarket'], hidden: true }]
  ]);
});

test('a move into a new primary always sends the kind', () => {
  const steps = helpers.planCategoryEditSteps(ORIGINAL, {
    name: 'Groceries', parent: 'Household', parentIsNew: true, kind: 'spending', description: '', hidden: false
  });
  assert.deepEqual(plain(steps), [{ call: 'label', primary: 'Household', detailed: 'Groceries', kind: 'spending' }]);
});

test('a refused first call stops the save with nothing done', async () => {
  const steps = helpers.planCategoryEditSteps(ORIGINAL, {
    name: 'Dining', parent: 'Food', parentIsNew: false, kind: null, description: 'x', hidden: false
  });
  let later = 0;
  const api = {
    editLabel: async () => ({ ok: false, data: { error: 'Food: Dining is already in your list. Use Merge.', reason: 'label_exists' } }),
    setDescription: async () => { later += 1; return { ok: true, data: {} }; }
  };
  const outcome = await helpers.runCategorySaveSteps(steps, { label: 'Food: Groceries' }, api);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.done.length, 0);
  assert.equal(outcome.error, 'Food: Dining is already in your list. Use Merge.');
  assert.equal(later, 0);
  assert.equal(helpers.describePartialSave(outcome), '');
});

test('a later call failing after the move says plainly what was and was not saved', async () => {
  const steps = helpers.planCategoryEditSteps(ORIGINAL, {
    name: 'Supermarket', parent: 'Food', parentIsNew: false, kind: null, description: 'Too long', hidden: true
  });
  const api = {
    editLabel: async () => ({ ok: true, data: { label: 'Food: Supermarket' } }),
    setDescription: async () => ({ ok: false, data: { error: 'Description is over 500 characters.' } }),
    setHidden: async () => { throw new Error('should not run'); }
  };
  const outcome = await helpers.runCategorySaveSteps(steps, { label: 'Food: Groceries' }, api);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.label, 'Food: Supermarket');
  assert.equal(
    helpers.describePartialSave(outcome),
    'Saved the new name, but not the description: Description is over 500 characters.'
  );
});

test('a network failure is reported as a refusal', async () => {
  const outcome = await helpers.runCategorySaveSteps(
    [{ call: 'hidden', hidden: true }],
    { label: 'Food: Groceries' },
    { setHidden: async () => { throw new Error('offline'); } }
  );
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /offline/);
});

test('a primary save renames with any kind change, then hides the moved labels', async () => {
  const original = { primary: 'Food', kind: null, hiddenState: 'some' };
  const steps = helpers.planPrimaryEditSteps(original, { name: 'Groceries & Dining', kind: 'spending', hidden: true });
  assert.deepEqual(plain(steps), [
    { call: 'primary', newPrimary: 'Groceries & Dining', renames: true, kind: 'spending' },
    { call: 'hidden', hidden: true }
  ]);

  const calls = [];
  const api = {
    renamePrimary: async body => {
      calls.push(['primary', body]);
      return { ok: true, data: { primary: 'Groceries & Dining', moves: [{ old: 'Food: A', new: 'Groceries & Dining: A' }, { old: 'Food: B', new: 'Groceries & Dining: B' }] } };
    },
    setHidden: async body => { calls.push(['hidden', body]); return { ok: true, data: {} }; }
  };
  const outcome = await helpers.runCategorySaveSteps(steps, { primary: 'Food', labels: ['Food: A', 'Food: B'] }, api);
  assert.equal(outcome.primary, 'Groceries & Dining');
  assert.deepEqual(plain(calls), [
    ['primary', { primary: 'Food', new_primary: 'Groceries & Dining', kind: 'spending' }],
    ['hidden', { labels: ['Groceries & Dining: A', 'Groceries & Dining: B'], hidden: true }]
  ]);
});

test('a primary kind-only save keeps the name, and a mixed box left alone sends no hide', () => {
  const original = { primary: 'Food', kind: 'spending', hiddenState: 'some' };
  assert.deepEqual(plain(helpers.planPrimaryEditSteps(original, { name: 'Food', kind: 'savings', hidden: null })), [
    { call: 'primary', newPrimary: 'Food', renames: false, kind: 'savings' }
  ]);
  assert.deepEqual(plain(helpers.planPrimaryEditSteps(original, { name: 'Food', kind: 'spending', hidden: null })), []);
  assert.deepEqual(plain(helpers.planPrimaryEditSteps({ ...original, hiddenState: 'all' }, { name: 'Food', kind: null, hidden: true })), []);
});

test('a create adds the category, then its description and Hide', async () => {
  const steps = helpers.planCategoryCreateSteps({
    name: ' Vet ', parent: 'Pets', parentIsNew: true, kind: 'spending', description: 'Checkups', hidden: true
  });
  assert.deepEqual(plain(steps), [
    { call: 'create', label: 'Pets: Vet', kind: 'spending' },
    { call: 'description', description: 'Checkups' },
    { call: 'hidden', hidden: true }
  ]);
  const calls = [];
  const api = {
    createLabel: async body => { calls.push(body); return { ok: true, data: { category_name: 'Pets: Vet' } }; },
    setDescription: async body => { calls.push(body); return { ok: true, data: {} }; },
    setHidden: async body => { calls.push(body); return { ok: true, data: {} }; }
  };
  const outcome = await helpers.runCategorySaveSteps(steps, {}, api);
  assert.equal(outcome.label, 'Pets: Vet');
  assert.deepEqual(plain(calls), [
    { category_name: 'Pets: Vet', kind: 'spending' },
    { label: 'Pets: Vet', description: 'Checkups' },
    { labels: ['Pets: Vet'], hidden: true }
  ]);
});

test('a create under a listed primary sends no kind', () => {
  const steps = helpers.planCategoryCreateSteps({ name: 'Snacks', parent: 'Food', parentIsNew: false, kind: 'spending', description: '', hidden: false });
  assert.deepEqual(plain(steps), [{ call: 'create', label: 'Food: Snacks' }]);
});

// ── Plaid section, Merge and Remove unused ──────────────────

test('a short Plaid set lists flat; a long one starts collapsed, grouped by Plaid primary', () => {
  const short = helpers.plaidMappingView([{ key: 'A', name: 'Food And Drink: Groceries' }], true);
  assert.equal(short.heading, 'Plaid sends 1 category here');
  assert.equal(short.collapsed, false);
  assert.match(short.defaultSentence, /default/);

  const many = [];
  for (let index = 0; index < 7; index += 1) many.push({ key: `K${index}`, name: `${index < 4 ? 'Travel' : 'Bank Fees'}: Item ${index}` });
  const long = helpers.plaidMappingView(many, false);
  assert.equal(long.heading, 'Plaid sends 7 categories here');
  assert.equal(long.collapsed, true);
  assert.deepEqual(plain(long.groups.map(group => [group.plaidPrimary, group.names.length])), [['Bank Fees', 3], ['Travel', 4]]);
  assert.equal(long.defaultSentence, '');

  const none = helpers.plaidMappingView([], false);
  assert.equal(none.count, 0);
  assert.match(none.heading, /No Plaid categories/);
});

test('the Merge confirm lists the sources, then the survivor, with the total', () => {
  const summary = helpers.mergeSummary(
    [entry('Food: Groceries', { uses: 12 }), entry('Food: Snacks', { uses: 1 }), entry('Food: Dining', { uses: 3 })],
    'Food: Snacks'
  );
  assert.deepEqual(plain(summary.rows), [
    { label: 'Food: Groceries', uses: 12, isTarget: false },
    { label: 'Food: Dining', uses: 3, isTarget: false },
    { label: 'Food: Snacks', uses: 1, isTarget: true }
  ]);
  assert.equal(summary.total, 16);
  assert.deepEqual(plain(summary.sources), ['Food: Groceries', 'Food: Dining']);
});

test('the Remove unused confirm splits kept categories by why', () => {
  const summary = helpers.removeUnusedSummary({
    deleted: ['A: 1', 'A: 2'],
    kept: [
      { label: 'Loans: Disbursements', delete_blocked_by: 'plaid_keys', delete_reason: 'Plaid sends 7 categories here.' },
      { label: 'Bills: Water', delete_blocked_by: 'bills', delete_reason: 'A bill uses it.' }
    ],
    kept_in_use: 40
  });
  assert.equal(summary.nothingToRemove, false);
  assert.equal(summary.headline, '2 categories will be deleted.');
  assert.deepEqual(plain(summary.keptForPlaid.map(item => item.label)), ['Loans: Disbursements']);
  assert.deepEqual(plain(summary.keptOther.map(item => item.label)), ['Bills: Water']);
  assert.equal(summary.keptInUse, 40);

  const empty = helpers.removeUnusedSummary({ deleted: [], kept: [], kept_in_use: 3 });
  assert.equal(empty.nothingToRemove, true);
  assert.match(empty.headline, /nothing to remove/);
});
