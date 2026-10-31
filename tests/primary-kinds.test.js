const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helpersPath = path.join(__dirname, '..', 'categories', 'primary-kinds.js');
const helpersSource = fs.readFileSync(helpersPath, 'utf8');

// The file is plain declarations with no DOM, so it loads on its own.
function loadHelpers() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(
    `${helpersSource}\nmodule.exports = { PRIMARY_KIND_OPTIONS, normalizePrimaryKey, primaryKindLabel, indexPrimaryKinds, describePrimaryKind, primaryKindErrorMessage, pinnedReasonList, pinnedExplanations, splitEmphasis, PINNED_REASON_EXPLANATIONS };`,
    sandbox,
    { filename: helpersPath }
  );
  return sandbox.module.exports;
}

const helpers = loadHelpers();

test('the picker offers the six kinds with their display labels', () => {
  const pairs = helpers.PRIMARY_KIND_OPTIONS.map(option => `${option.value}=${option.label}`);
  assert.deepEqual([...pairs], [
    'income=Earned income',
    'other_inflow=Other inflow',
    'retirement_income=Retirement income',
    'spending=Spending',
    'transfer=Transfer',
    'adjustment=Adjustment'
  ]);
});

test('excluded is not an option but still has a label and renders read-only', () => {
  assert.equal(helpers.PRIMARY_KIND_OPTIONS.some(option => option.value === 'excluded'), false);
  assert.equal(helpers.primaryKindLabel('excluded'), 'Excluded');
  const view = helpers.describePrimaryKind({ name: 'Old', kind: 'excluded', kind_is_set: true });
  assert.deepEqual({ ...view }, { mode: 'legacy', kind: 'excluded', label: 'Excluded', isSet: true });
  const byName = helpers.describePrimaryKind({ name: 'Old', kind: 'excluded', kind_is_set: false });
  assert.equal(byName.mode, 'legacy');
  assert.equal(byName.label, 'Excluded');
});

test('primaryKindLabel covers every kind and passes unknown ones through', () => {
  assert.equal(helpers.primaryKindLabel('transfer'), 'Transfer');
  assert.equal(helpers.primaryKindLabel('adjustment'), 'Adjustment');
  assert.equal(helpers.primaryKindLabel('retirement_income'), 'Retirement income');
  assert.equal(helpers.primaryKindLabel('mystery'), 'mystery');
});

test('normalizePrimaryKey matches the API: before the colon, trimmed, lowercase', () => {
  assert.equal(helpers.normalizePrimaryKey('  Other Inflow '), 'other inflow');
  assert.equal(helpers.normalizePrimaryKey('Income: Salary'), 'income');
  assert.equal(helpers.normalizePrimaryKey(null), '');
});

test('indexPrimaryKinds keys entries by normalized name and tolerates a missing list', () => {
  const index = helpers.indexPrimaryKinds([{ name: 'Other Inflow', kind: 'other_inflow' }]);
  assert.equal(index['other inflow'].kind, 'other_inflow');
  assert.equal(Object.keys(helpers.indexPrimaryKinds(undefined)).length, 0);
  assert.equal(Object.keys(helpers.indexPrimaryKinds(null)).length, 0);
});

test('a set primary is a picker at its stored kind', () => {
  const view = helpers.describePrimaryKind({ name: 'Income', kind: 'income', kind_is_set: true });
  assert.deepEqual({ ...view }, { mode: 'picker', kind: 'income', label: 'Earned income', isSet: true });
});

test('an unset primary shows "By name: ..." as its current state', () => {
  const spending = helpers.describePrimaryKind({ name: 'Food', kind: 'spending', kind_is_set: false });
  assert.equal(spending.mode, 'picker');
  assert.equal(spending.label, 'By name: Spending');
  assert.equal(spending.isSet, false);

  const earned = helpers.describePrimaryKind({ name: 'Side Income', kind: 'income', kind_is_set: false });
  assert.equal(earned.label, 'By name: Earned income');
});

test('transfer and adjustment are pickers like any other kind', () => {
  const set = helpers.describePrimaryKind({ name: 'Transfers', kind: 'transfer', kind_is_set: true });
  assert.deepEqual({ ...set }, { mode: 'picker', kind: 'transfer', label: 'Transfer', isSet: true });

  const byName = helpers.describePrimaryKind({ name: 'Adjustments', kind: 'adjustment', kind_is_set: false });
  assert.equal(byName.mode, 'picker');
  assert.equal(byName.label, 'By name: Adjustment');
  assert.equal(byName.isSet, false);
});

test('a stray kind_is_locked from an older API is treated like any other entry', () => {
  const view = helpers.describePrimaryKind({ name: 'Transfers', kind: 'transfer', kind_is_set: false, kind_is_locked: true });
  assert.deepEqual({ ...view }, { mode: 'picker', kind: 'transfer', label: 'By name: Transfer', isSet: false });
});

test('no entry means no control', () => {
  assert.equal(helpers.describePrimaryKind(undefined).mode, 'none');
  assert.equal(helpers.describePrimaryKind({ name: 'X' }).mode, 'none');
});

test('a refusal shows the API text, with a fallback when there is none', () => {
  assert.equal(helpers.primaryKindErrorMessage({ error: 'Unknown kind.' }), 'Unknown kind.');
  assert.match(helpers.primaryKindErrorMessage(null), /Could not change/);
});

test('a pinned primary shows its plain kind label with the reason text', () => {
  const view = helpers.describePrimaryKind({ name: 'Transfer In', kind: 'transfer', kind_is_set: false, pinned_reason: 'unlinked_transfer_in' });
  assert.equal(view.mode, 'pinned');
  assert.equal(view.label, 'Transfer');
  assert.deepEqual([...view.reasons], ['unlinked_transfer_in']);
  assert.match(view.explanations[0], /\*Transfer In → Account Transfer\*/);
  assert.match(view.explanations[0], /money-in half of a transfer/);
  assert.match(view.explanations[0], /always counts as a transfer/);
  assert.match(view.explanations[0], /follow the new name/);
});

test('each pinned reason has its own explanation', () => {
  const out = helpers.PINNED_REASON_EXPLANATIONS.unlinked_transfer_out;
  assert.match(out, /\*Transfer Out → Account Transfer\*/);
  assert.match(out, /money-out half of a transfer/);
  assert.match(out, /follow the new name/);
  const gain = helpers.describePrimaryKind({ name: 'Adjustments', kind: 'adjustment', kind_is_set: true, pinned_reason: 'investment_gain_loss' });
  assert.equal(gain.mode, 'pinned');
  assert.equal(gain.label, 'Adjustment');
  assert.match(gain.explanations[0], /^This label appeared when you converted an investment account or imported investment history/);
  assert.match(gain.explanations[0], /\*Adjustments: Investment Gain\/Loss\*/);
  assert.match(gain.explanations[0], /that label can't be renamed/);
  assert.match(gain.explanations[0], /set to any kind/);
});

test('splitEmphasis marks asterisk pairs and leaves a stray asterisk literal', () => {
  const runs = JSON.parse(JSON.stringify(helpers.splitEmphasis('a *b* c')));
  assert.deepEqual(runs, [
    { text: 'a ', emphasis: false },
    { text: 'b', emphasis: true },
    { text: ' c', emphasis: false }
  ]);
  const stray = helpers.splitEmphasis('a * b').map(run => run.text).join('');
  assert.equal(stray, 'a * b');
  assert.equal(helpers.splitEmphasis('').length, 0);
});

test('a list of pinned reasons explains each, and an unknown reason still pins', () => {
  const view = helpers.describePrimaryKind({
    name: 'Transfers', kind: 'transfer', kind_is_set: false,
    pinned_reason: ['unlinked_transfer_in', 'unlinked_transfer_out', 'something_new']
  });
  assert.equal(view.mode, 'pinned');
  assert.equal(view.explanations.length, 3);
  assert.match(view.explanations[2], /fixed/);
});

test('a null, empty or missing pinned_reason leaves the picker', () => {
  [null, undefined, '', []].forEach(reason => {
    const view = helpers.describePrimaryKind({ name: 'Food', kind: 'spending', kind_is_set: true, pinned_reason: reason });
    assert.equal(view.mode, 'picker');
  });
  assert.deepEqual([...helpers.pinnedReasonList(undefined)], []);
});
