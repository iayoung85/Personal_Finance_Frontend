const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const utilsPath = path.join(__dirname, '..', 'categories', 'utils.js');
const statePath = path.join(__dirname, '..', 'categories', 'label-state.js');

// label-state.js calls parseCategoryName from utils.js; both are plain
// declarations, so they load together without a page.
function loadHelpers() {
  const sandbox = { module: { exports: {} } };
  const source = `${fs.readFileSync(utilsPath, 'utf8')}\n${fs.readFileSync(statePath, 'utf8')}\n`
    + 'module.exports = { normalizeLockedLabels, findLockedLabel, findLockedKey, listedLabels, describeLabel, groupListedLabels, withLockedMappingsKept, lockedKeyUnderPlaidPrimary, normalizePlaidNamedLabels, readCatchAll, isCatchAllEntry, isCatchAllKey, catchAllMergeMove, catchAllRemapMove, catchAllMergeWarning, catchAllRemapBody, catchAllEntryIn, catchAllPrimaryNoteParagraphs, CATCH_ALL_PRIMARY_NOTE_HEADING, CATCH_ALL_TAG_HOVER, CATCH_ALL_NOTE_HEADING, CATCH_ALL_NOTE_INTRO, CATCH_ALL_NOTE_REASONS, CATCH_ALL_NOTE_CLOSING, CATCH_ALL_MAPPING_NOTE, CATCH_ALL_REMAP_TITLE, CATCH_ALL_REMAP_CONFIRM_LABEL };';
  vm.runInNewContext(source, sandbox, { filename: statePath });
  return sandbox.module.exports;
}

const helpers = loadHelpers();

// Plain copies, so deepEqual compares values and not the sandbox's prototypes.
const plain = value => JSON.parse(JSON.stringify(value));

const LOCKED = [
  { label: 'Locked A: One', mapping_key: 'KEY_A', reason: 'reason_a', message: 'Message A.' },
  { label: 'Locked B: Two', mapping_key: 'KEY_B', reason: 'reason_b', message: 'Message B.' }
];

const MAPPINGS = {
  KEY_A: 'Locked A: One',
  KEY_B: 'Locked B: Two',
  KEY_X: 'Inflows: Tax Refund',
  KEY_Y: 'Food: Groceries',
  KEY_Z: 'Food: Groceries'
};

const LISTS = {
  customCategories: ['Food: Groceries', 'Home: Lawn Care'],
  categoryMappings: MAPPINGS,
  lockedLabels: LOCKED
};

test('a missing or malformed locked_labels is an empty list', () => {
  assert.deepEqual(plain(helpers.normalizeLockedLabels(undefined)), []);
  assert.deepEqual(plain(helpers.normalizeLockedLabels(null)), []);
  assert.deepEqual(plain(helpers.normalizeLockedLabels({ label: 'x' })), []);
  assert.deepEqual(plain(helpers.normalizeLockedLabels([null, {}, { label: '' }])), []);
});

test('a locked entry keeps the API message, with a fallback when it has none', () => {
  const [entry] = helpers.normalizeLockedLabels(LOCKED);
  assert.equal(entry.message, 'Message A.');
  assert.equal(entry.mapping_key, 'KEY_A');
  const [bare] = helpers.normalizeLockedLabels([{ label: 'Bare: Label' }]);
  assert.match(bare.message, /can't be changed/);
});

test('the list is the custom labels plus every mapped label, each once', () => {
  const labels = helpers.listedLabels(LISTS.customCategories, LISTS.categoryMappings);
  assert.deepEqual(plain(labels), [
    'Food: Groceries', 'Home: Lawn Care', 'Locked A: One', 'Locked B: Two', 'Inflows: Tax Refund'
  ]);
});

test('empty and non-string mapping values are not listed', () => {
  const labels = helpers.listedLabels([], { A: '', B: '  ', C: null, D: 'Real: Label' });
  assert.deepEqual(plain(labels), ['Real: Label']);
});

test('a label only a Plaid key maps to is mapping-only; a custom one is not, even when mapped too', () => {
  const taxRefund = helpers.describeLabel('Inflows: Tax Refund', LISTS);
  assert.equal(taxRefund.isListed, true);
  assert.equal(taxRefund.isCustom, false);
  assert.equal(taxRefund.isMappingOnly, true);

  const groceries = helpers.describeLabel('Food: Groceries', LISTS);
  assert.equal(groceries.isCustom, true);
  assert.equal(groceries.isMappingOnly, false);

  const lawn = helpers.describeLabel('Home: Lawn Care', LISTS);
  assert.equal(lawn.isCustom, true);
  assert.equal(lawn.isMappingOnly, false);
});

test('a label in neither list is not listed', () => {
  const missing = helpers.describeLabel('Nowhere: Land', LISTS);
  assert.equal(missing.isListed, false);
  assert.equal(missing.isMappingOnly, false);
});

test('a label is locked only when the API names it, and carries the API message', () => {
  const locked = helpers.describeLabel('Locked A: One', LISTS);
  assert.equal(locked.locked.mapping_key, 'KEY_A');
  assert.equal(locked.lockMessage, 'Message A.');
  assert.equal(locked.isMappingOnly, true);

  const open = helpers.describeLabel('Inflows: Tax Refund', LISTS);
  assert.equal(open.locked, null);
  assert.equal(open.lockMessage, '');
});

test('with no locked_labels nothing is locked', () => {
  const lists = { ...LISTS, lockedLabels: [] };
  assert.equal(helpers.describeLabel('Locked A: One', lists).locked, null);
  const groups = helpers.groupListedLabels(lists);
  assert.equal(groups.some(group => group.holdsLocked), false);
});

test('a key is found in locked_labels by its mapping key', () => {
  assert.equal(helpers.findLockedKey('KEY_B', LOCKED).label, 'Locked B: Two');
  assert.equal(helpers.findLockedKey('KEY_X', LOCKED), null);
  assert.equal(helpers.findLockedKey('', LOCKED), null);
  assert.equal(helpers.findLockedKey('KEY_A', undefined), null);
});

test('primaries come from the whole list, so a mapping-only primary appears', () => {
  const groups = helpers.groupListedLabels(LISTS);
  assert.deepEqual(plain(groups.map(group => group.primary)), ['Food', 'Home', 'Inflows', 'Locked A', 'Locked B']);
  const inflows = groups.find(group => group.primary === 'Inflows');
  assert.deepEqual(plain(inflows.labels.map(entry => [entry.detailed, entry.isMappingOnly])), [['Tax Refund', true]]);
  assert.equal(inflows.holdsLocked, false);
});

test('a primary holding a locked label says so, with that label\'s message', () => {
  const groups = helpers.groupListedLabels(LISTS);
  const lockedPrimary = groups.find(group => group.primary === 'Locked A');
  assert.equal(lockedPrimary.holdsLocked, true);
  assert.equal(lockedPrimary.lockMessage, 'Message A.');
  assert.equal(lockedPrimary.labels[0].locked.label, 'Locked A: One');
});

test('a primary with a locked label and the user\'s own labels locks only the locked one', () => {
  const lists = {
    customCategories: ['Locked A: Mine'],
    categoryMappings: { KEY_A: 'Locked A: One' },
    lockedLabels: LOCKED
  };
  const [group] = helpers.groupListedLabels(lists);
  assert.equal(group.holdsLocked, true);
  const byDetailed = Object.fromEntries(group.labels.map(entry => [entry.detailed, Boolean(entry.locked)]));
  assert.deepEqual(byDetailed, { Mine: false, One: true });
});

test('a primary keeps the spelling the list uses, case included', () => {
  const lists = {
    customCategories: ['Dining Out: Pizza'],
    categoryMappings: { K: 'dining out: Tacos' },
    lockedLabels: []
  };
  const groups = helpers.groupListedLabels(lists);
  assert.deepEqual(plain(groups.map(group => group.primary)).sort(), ['Dining Out', 'dining out']);
});

test('a label with no detailed part is the primary-only entry', () => {
  const lists = { customCategories: ['Savings'], categoryMappings: { K: 'Savings: Vault' }, lockedLabels: [] };
  const [group] = helpers.groupListedLabels(lists);
  assert.equal(group.primary, 'Savings');
  assert.equal(group.primaryOnly.label, 'Savings');
  assert.equal(group.primaryOnly.isMappingOnly, false);
  assert.deepEqual(plain(group.labels.map(entry => entry.label)), ['Savings: Vault']);
});

test('a save keeps each locked key at the label the API holds', () => {
  const edited = { KEY_A: 'Somewhere: Else', KEY_B: '', KEY_X: 'Other: Place' };
  const kept = helpers.withLockedMappingsKept(edited, LOCKED);
  assert.deepEqual(plain(kept), { KEY_A: 'Locked A: One', KEY_B: 'Locked B: Two', KEY_X: 'Other: Place' });
  assert.equal(edited.KEY_A, 'Somewhere: Else', 'the input is not changed');
});

test('a locked key a list never had is not added on save', () => {
  const kept = helpers.withLockedMappingsKept({ KEY_X: 'Other: Place' }, LOCKED);
  assert.deepEqual(plain(kept), { KEY_X: 'Other: Place' });
  assert.deepEqual(plain(helpers.withLockedMappingsKept({ KEY_X: 'a' }, undefined)), { KEY_X: 'a' });
});

const TAXONOMY = [
  { primary: 'GROUP_A', detailed: 'KEY_A' },
  { primary: 'GROUP_A', detailed: 'KEY_X' },
  { primary: 'GROUP_F', detailed: 'KEY_Y' }
];
const titleCase = primary => primary.replace('GROUP_', 'Group ');

test('a Plaid primary holding a locked key gives that key\'s entry', () => {
  const found = helpers.lockedKeyUnderPlaidPrimary('Group A', TAXONOMY, LOCKED, titleCase);
  assert.equal(found.label, 'Locked A: One');
});

test('a Plaid primary with no locked key gives nothing', () => {
  assert.equal(helpers.lockedKeyUnderPlaidPrimary('Group F', TAXONOMY, LOCKED, titleCase), null);
  assert.equal(helpers.lockedKeyUnderPlaidPrimary('Group A', TAXONOMY, [], titleCase), null);
  assert.equal(helpers.lockedKeyUnderPlaidPrimary('Group A', undefined, LOCKED, titleCase), null);
});

test('the badge follows the API\'s plaid_named_labels, not the custom list', () => {
  const lists = { ...LISTS, plaidNamedLabels: ['Food: Groceries'] };
  // Custom and Plaid-named: still marked. Mapping-only but named by the user: not.
  assert.equal(helpers.describeLabel('Food: Groceries', lists).isPlaidNamed, true);
  assert.equal(helpers.describeLabel('Inflows: Tax Refund', lists).isPlaidNamed, false);
  assert.equal(helpers.describeLabel('Inflows: Tax Refund', LISTS).isPlaidNamed, false);
});

test('a missing or malformed plaid_named_labels is an empty list', () => {
  assert.deepEqual(plain(helpers.normalizePlaidNamedLabels(undefined)), []);
  assert.deepEqual(plain(helpers.normalizePlaidNamedLabels(['A: B', 7, ''])), ['A: B']);
});

// ── The catch-all category ──────────────────────────────────

const CATCH_ALL = { plaidKey: 'OTHER_OTHER', label: 'Uncategorized: Uncategorized' };

test('readCatchAll takes the API values and falls back to the given key', () => {
  assert.deepEqual(plain(helpers.readCatchAll(
    { catch_all_plaid_key: 'OTHER_OTHER', catch_all_label: 'Other: Other' }, 'FALLBACK'
  )), { plaidKey: 'OTHER_OTHER', label: 'Other: Other' });
  assert.deepEqual(plain(helpers.readCatchAll({ catch_all_label: 'Other: Other' }, 'FALLBACK')),
    { plaidKey: 'FALLBACK', label: 'Other: Other' });
});

test('readCatchAll leaves the label empty for an older API', () => {
  assert.equal(helpers.readCatchAll({}, 'OTHER_OTHER').label, '');
  assert.equal(helpers.readCatchAll(undefined, 'OTHER_OTHER').label, '');
  assert.equal(helpers.readCatchAll({ catch_all_label: 5 }, 'OTHER_OTHER').label, '');
});

test('isCatchAllEntry is true only for catch_all === true', () => {
  assert.equal(helpers.isCatchAllEntry({ label: 'A: B', catch_all: true }), true);
  assert.equal(helpers.isCatchAllEntry({ label: 'A: B', catch_all: false }), false);
  assert.equal(helpers.isCatchAllEntry({ label: 'A: B' }), false);
  assert.equal(helpers.isCatchAllEntry({ label: 'A: B', catch_all: 'true' }), false);
  assert.equal(helpers.isCatchAllEntry(null), false);
});

test('isCatchAllKey matches the key only when the API named a label', () => {
  assert.equal(helpers.isCatchAllKey('OTHER_OTHER', CATCH_ALL), true);
  assert.equal(helpers.isCatchAllKey('FOOD_AND_DRINK_COFFEE', CATCH_ALL), false);
  assert.equal(helpers.isCatchAllKey('OTHER_OTHER', { plaidKey: 'OTHER_OTHER', label: '' }), false);
});

test('catchAllMergeMove names the catch-all source and the target', () => {
  const selected = [
    { label: 'Uncategorized: Uncategorized', catch_all: true },
    { label: 'Food: Groceries', catch_all: false }
  ];
  assert.deepEqual(plain(helpers.catchAllMergeMove(selected, 'Food: Groceries')),
    { source: 'Uncategorized: Uncategorized', target: 'Food: Groceries' });
});

test('catchAllMergeMove is null when the catch-all is the target or absent', () => {
  const selected = [
    { label: 'Uncategorized: Uncategorized', catch_all: true },
    { label: 'Food: Groceries' }
  ];
  assert.equal(helpers.catchAllMergeMove(selected, 'Uncategorized: Uncategorized'), null);
  assert.equal(helpers.catchAllMergeMove([{ label: 'A: B' }, { label: 'C: D' }], 'A: B'), null);
  assert.equal(helpers.catchAllMergeMove(undefined, 'A: B'), null);
});

test('catchAllRemapMove reports a different label on the catch-all key', () => {
  assert.deepEqual(plain(helpers.catchAllRemapMove({ OTHER_OTHER: 'Shopping: Misc' }, CATCH_ALL)),
    { from: 'Uncategorized: Uncategorized', to: 'Shopping: Misc' });
  assert.deepEqual(plain(helpers.catchAllRemapMove({ OTHER_OTHER: '  Shopping: Misc ' }, CATCH_ALL)),
    { from: 'Uncategorized: Uncategorized', to: 'Shopping: Misc' });
});

test('catchAllRemapMove is null when nothing moves', () => {
  assert.equal(helpers.catchAllRemapMove({ OTHER_OTHER: 'Uncategorized: Uncategorized' }, CATCH_ALL), null);
  assert.equal(helpers.catchAllRemapMove({ OTHER_OTHER: '' }, CATCH_ALL), null);
  assert.equal(helpers.catchAllRemapMove({ FOOD: 'Food: Groceries' }, CATCH_ALL), null);
  assert.equal(helpers.catchAllRemapMove({ OTHER_OTHER: 'Shopping: Misc' }, { plaidKey: 'OTHER_OTHER', label: '' }), null);
  assert.equal(helpers.catchAllRemapMove(undefined, CATCH_ALL), null);
});

test('catchAllEntryIn finds the catch-all among a primary\'s categories', () => {
  const catchAllEntry = { label: 'Uncategorized: Uncategorized', catch_all: true };
  assert.equal(helpers.catchAllEntryIn([{ label: 'Uncategorized: Misc', catch_all: false }, catchAllEntry]), catchAllEntry);
  assert.equal(helpers.catchAllEntryIn([{ label: 'Food: Dining' }]), null);
  assert.equal(helpers.catchAllEntryIn(undefined), null);
});

test('the primary note advises on the kind only when the kind can be changed', () => {
  const opening = 'Uncategorized: Uncategorized sits under this primary. It collects the bank transactions the app can\'t place, and most of them are real purchases nobody has sorted yet.';
  const kindAdvice = 'Keep the kind as Spending, so they count in your totals until you sort them. A kind like Adjustment or Transfer leaves them out of every total, and money goes uncounted without your knowing what it was.';
  const nameAdvice = 'Renaming the primary renames that category too. A name like "Uncategorized" says what it is.';
  assert.equal(helpers.CATCH_ALL_PRIMARY_NOTE_HEADING, 'This primary holds your catch-all category');
  assert.deepEqual(plain(helpers.catchAllPrimaryNoteParagraphs('Uncategorized: Uncategorized', true)),
    [opening, kindAdvice, nameAdvice]);
  assert.deepEqual(plain(helpers.catchAllPrimaryNoteParagraphs('Uncategorized: Uncategorized', false)),
    [opening, nameAdvice]);
});

test('the catch-all wording is the agreed text', () => {
  assert.equal(helpers.CATCH_ALL_TAG_HOVER,
    'Bank transactions the app can\'t place land here. It means "not categorized yet". Open Edit for the details.');
  assert.equal(helpers.CATCH_ALL_NOTE_HEADING, 'This is your catch-all category');
  assert.equal(helpers.CATCH_ALL_NOTE_INTRO, 'Bank transactions land here when the app can\'t tell what they are:');
  assert.deepEqual(plain(helpers.CATCH_ALL_NOTE_REASONS), [
    'Plaid wasn\'t sure of its own category, and none of your rules matched.',
    'Plaid sent a category you haven\'t mapped.'
  ]);
  assert.equal(helpers.CATCH_ALL_NOTE_CLOSING,
    'The app treats everything in it as not categorized yet. Renaming it changes the name only: the same transactions keep landing here. '
    + 'A name like "Uncategorized" says what it is. '
    + 'A name like "Shopping: Misc" would fill a spending category with transactions nobody has sorted.');
  assert.equal(helpers.CATCH_ALL_MAPPING_NOTE, 'Catch-all: transactions the app can\'t place go to this category.');
  assert.equal(helpers.CATCH_ALL_REMAP_TITLE, 'Move the catch-all?');
  assert.equal(helpers.CATCH_ALL_REMAP_CONFIRM_LABEL, 'Save mappings');
  assert.equal(helpers.catchAllMergeWarning('A: One', 'B: Two'),
    'A: One is your catch-all category. After this merge, B: Two becomes the catch-all: bank transactions the app can\'t place will land in it, and the app will treat everything in it as not categorized yet.');
  assert.equal(helpers.catchAllRemapBody('A: One', 'B: Two'),
    'A: One is your catch-all category. Saving makes B: Two the catch-all: bank transactions the app can\'t place will land in it, and the app will treat everything in it as not categorized yet.');
});
