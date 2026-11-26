const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readSource(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

// Values built inside a vm sandbox come from another realm.
const plain = value => JSON.parse(JSON.stringify(value));

const picker = (() => {
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(
    `${readSource('shared/plaid-category-picker.js')}\n`
      + 'module.exports = { plaidPickerNormalizeCode, plaidPickerNormalizeCodes, plaidPickerFilterGroups,'
      + ' plaidPickerSelectedItems, plaidPickerAdd, plaidPickerRemove, plaidPickerCodesChanged };',
    sandbox,
  );
  return sandbox.module.exports;
})();

const TAXONOMY = [
  { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_COFFEE' },
  { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_RESTAURANT' },
  { primary: 'INCOME', detailed: 'INCOME_WAGES' },
  { primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY' },
  { primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' },
];

const codesOf = groups => plain(groups).flatMap(group => group.items.map(item => item.code));

test('an empty search lists every category, grouped by primary in the API order', () => {
  const groups = plain(picker.plaidPickerFilterGroups(TAXONOMY, '', []));
  assert.deepEqual(groups.map(group => group.primary), ['FOOD_AND_DRINK', 'INCOME', 'RENT_AND_UTILITIES']);
  assert.deepEqual(groups.map(group => group.label), ['Food and drink', 'Income', 'Rent and utilities']);
  assert.deepEqual(groups[0].items, [
    { code: 'FOOD_AND_DRINK_COFFEE', label: 'Coffee' },
    { code: 'FOOD_AND_DRINK_RESTAURANT', label: 'Restaurant' },
  ]);
});

test('search matches the code, the label, or the group, and every word must match', () => {
  const search = query => codesOf(picker.plaidPickerFilterGroups(TAXONOMY, query, []));
  assert.deepEqual(search('coffee'), ['FOOD_AND_DRINK_COFFEE']);
  assert.deepEqual(search('COFFEE'), ['FOOD_AND_DRINK_COFFEE']);
  assert.deepEqual(search('food coffee'), ['FOOD_AND_DRINK_COFFEE']);
  assert.deepEqual(search('food_and_drink_rest'), ['FOOD_AND_DRINK_RESTAURANT']);
  assert.deepEqual(search('utilities'), [
    'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY', 'RENT_AND_UTILITIES_RENT',
  ]);
  assert.deepEqual(search('rent gas'), ['RENT_AND_UTILITIES_GAS_AND_ELECTRICITY']);
  assert.deepEqual(search('zzz'), []);
});

test('chosen categories are left out of the list, and an emptied group disappears', () => {
  const groups = plain(picker.plaidPickerFilterGroups(TAXONOMY, '', ['income_wages', 'FOOD_AND_DRINK_COFFEE']));
  assert.deepEqual(groups.map(group => group.primary), ['FOOD_AND_DRINK', 'RENT_AND_UTILITIES']);
  assert.equal(codesOf(groups).includes('INCOME_WAGES'), false);
  assert.equal(codesOf(groups).includes('FOOD_AND_DRINK_COFFEE'), false);
});

test('a missing or empty taxonomy lists nothing', () => {
  assert.deepEqual(codesOf(picker.plaidPickerFilterGroups(null, '', [])), []);
  assert.deepEqual(codesOf(picker.plaidPickerFilterGroups([], 'x', [])), []);
});

test('the selection is normalized: uppercase, trimmed, no blanks, no repeats', () => {
  assert.deepEqual(plain(picker.plaidPickerNormalizeCodes([' income_wages', 'INCOME_WAGES', '', null])), ['INCOME_WAGES']);
  assert.deepEqual(plain(picker.plaidPickerNormalizeCodes(undefined)), []);
  assert.deepEqual(plain(picker.plaidPickerAdd(['INCOME_WAGES'], 'food_and_drink_coffee')),
    ['INCOME_WAGES', 'FOOD_AND_DRINK_COFFEE']);
  assert.deepEqual(plain(picker.plaidPickerAdd(['INCOME_WAGES'], 'income_wages')), ['INCOME_WAGES']);
  assert.deepEqual(plain(picker.plaidPickerRemove(['INCOME_WAGES', 'FOOD_AND_DRINK_COFFEE'], 'income_wages')),
    ['FOOD_AND_DRINK_COFFEE']);
});

test('chosen codes show readable names, and a code outside the list is marked unknown', () => {
  const items = plain(picker.plaidPickerSelectedItems(['INCOME_WAGES', 'OLD_RETIRED_CODE'], TAXONOMY));
  assert.deepEqual(items, [
    { code: 'INCOME_WAGES', label: 'Income: Wages', unknown: false },
    { code: 'OLD_RETIRED_CODE', label: 'OLD_RETIRED_CODE', unknown: true },
  ]);
});

test('with no taxonomy loaded, no stored code is called unknown', () => {
  [null, undefined, []].forEach(taxonomy => {
    const items = plain(picker.plaidPickerSelectedItems(['INCOME_WAGES'], taxonomy));
    assert.deepEqual(items, [{ code: 'INCOME_WAGES', label: 'INCOME_WAGES', unknown: false }]);
  });
});

test('the change check ignores order, case, and repeats, and sees an added or removed code', () => {
  const changed = picker.plaidPickerCodesChanged;
  assert.equal(changed(['A', 'B'], ['B', 'A']), false);
  assert.equal(changed(['a'], ['A']), false);
  assert.equal(changed([], null), false);
  assert.equal(changed(['A'], ['A', 'B']), true);
  assert.equal(changed(['A', 'B'], ['A']), true);
  assert.equal(changed(['A'], []), true);
  assert.equal(changed([], ['A']), true);
  assert.equal(changed(['A', 'C'], ['A', 'B']), true);
});

// ── The edit payload ────────────────────────────────────────────

const modal = (() => {
  const sandbox = {
    module: { exports: {} }, console, formatCurrency: () => '', document: { addEventListener() {} },
  };
  vm.runInNewContext(
    `${readSource('date-helpers.js')}\n${readSource('shared/plaid-category-picker.js')}\n${readSource('bills/modal.js')}\n`
      + 'module.exports = { _buildBillUpdatePayload, setEditData(bill) { _billModalEditData = bill; } };',
    sandbox,
    { filename: 'modal.js' },
  );
  return sandbox.module.exports;
})();

const storedBill = {
  frequency: 'monthly', interval: 1, start_date: '2026-07-25', second_date: null,
  day_of_month: 25, second_day_of_month: null, day_of_week: null,
  end_type: 'never', end_date: null, max_occurrences: null,
  amount: -50, match_pfc_detailed_categories: ['OLD_RETIRED_CODE'],
};
const untouchedForm = {
  ...storedBill, start_date: '2026-07-01', match_pfc_detailed_categories: ['OLD_RETIRED_CODE'],
};

test('an edit that leaves the Plaid categories alone does not resend a stored unknown code', () => {
  modal.setEditData(storedBill);
  const payload = plain(modal._buildBillUpdatePayload('bill_1', untouchedForm, -50, null));
  assert.equal('match_pfc_detailed_categories' in payload, false);
});

test('an edit that changes the Plaid categories sends the whole new list', () => {
  modal.setEditData(storedBill);
  const form = { ...untouchedForm, match_pfc_detailed_categories: ['OLD_RETIRED_CODE', 'income_wages'] };
  const payload = plain(modal._buildBillUpdatePayload('bill_1', form, -50, null));
  assert.deepEqual(payload.match_pfc_detailed_categories, ['OLD_RETIRED_CODE', 'INCOME_WAGES']);

  const cleared = plain(modal._buildBillUpdatePayload('bill_1', { ...untouchedForm, match_pfc_detailed_categories: [] }, -50, null));
  assert.deepEqual(cleared.match_pfc_detailed_categories, []);
});
