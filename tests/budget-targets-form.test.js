const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'budget', 'targets-form.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// Results cross the vm boundary, so compare through JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function loadForm() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(
    `${source}\nmodule.exports = { targetDraftKey, formatTargetFieldValue, draftFromYearTargets, `
      + 'normalizeTargetInput, buildTargetsFormSections, flattenTargetsFormRows, buildTargetsPayload, '
      + 'isTargetsDraftChanged, targetsDraftHasValues, placeTargetsRefusal, setAlertAvailability, '
      + 'fiscalStartMonthOfYear, targetFieldMoveForKey, nextTargetFieldPosition, paceDraftKey, '
      + 'formatPaceBandPercent, resolveRowPace, setRowPace, bandDollarsFromPercent, '
      + 'bandPercentFromDollars, paceControlState, targetsDraftHasScopeValues, clearTargetsDraft, '
      + 'clearTargetsButtonState, clearTargetsConfirmText, clearTargetsStatusText };',
    sandbox,
    { filename: sourcePath },
  );
  return sandbox.module.exports;
}

const form = loadForm();

const CATEGORIES = [
  { primary: 'Food And Drink', kind: 'spending', labels: ['Food And Drink: Dining', 'Food And Drink: Groceries'] },
  { primary: 'Travel', kind: 'spending', labels: ['Travel: Flights'] },
  { primary: 'Savings', kind: 'savings', labels: ['Savings: Emergency Fund'] },
];

test('the form lists spending then savings, each primary row before its details', () => {
  const sections = plain(form.buildTargetsFormSections(CATEGORIES));
  assert.deepEqual(sections.map(section => section.kind), ['spending', 'savings']);
  const rows = plain(form.flattenTargetsFormRows(form.buildTargetsFormSections(CATEGORIES)));
  assert.deepEqual(rows.map(row => [row.category, row.name, row.isPrimary]), [
    ['Food And Drink', 'Food And Drink', true],
    ['Food And Drink: Dining', 'Dining', false],
    ['Food And Drink: Groceries', 'Groceries', false],
    ['Travel', 'Travel', true],
    ['Travel: Flights', 'Flights', false],
    ['Savings', 'Savings', true],
    ['Savings: Emergency Fund', 'Emergency Fund', false],
  ]);
});

test('saved targets fill the fields, whole dollars without cents', () => {
  const draft = plain(form.draftFromYearTargets([
    { category: 'Food And Drink', cadence: 'monthly', amount: 900.0 },
    { category: 'Food And Drink: Dining', cadence: 'annual', amount: 612.5 },
  ]));
  assert.deepEqual(draft, {
    'monthly|Food And Drink': '900',
    'annual|Food And Drink: Dining': '612.50',
  });
});

test('the payload sends every filled field in row order, monthly first, blanks left out', () => {
  const rows = form.flattenTargetsFormRows(form.buildTargetsFormSections(CATEGORIES));
  const draft = {
    [form.targetDraftKey('Food And Drink: Dining', 'annual')]: '$6,000',
    [form.targetDraftKey('Food And Drink: Dining', 'monthly')]: ' 600 ',
    [form.targetDraftKey('Food And Drink', 'monthly')]: '',
    [form.targetDraftKey('Savings', 'annual')]: '12000',
  };
  // A spending target of either cadence carries its pace settings, here the
  // defaults: monthly on, annual off. Savings carries none.
  assert.deepEqual(plain(form.buildTargetsPayload(rows, draft)), [
    { category: 'Food And Drink: Dining', cadence: 'monthly', amount: '600', track_pace: true, pace_band_percent: 5 },
    { category: 'Food And Drink: Dining', cadence: 'annual', amount: '6000', track_pace: false, pace_band_percent: 5 },
    { category: 'Savings', cadence: 'annual', amount: '12000' },
  ]);
});

test('a primary is sent under the exact text the API listed it as', () => {
  const rows = form.flattenTargetsFormRows(form.buildTargetsFormSections(CATEGORIES));
  const draft = { [form.targetDraftKey('Food And Drink', 'monthly')]: '900' };
  assert.equal(plain(form.buildTargetsPayload(rows, draft))[0].category, 'Food And Drink');
});

test('a blank field and a missing key are the same; a changed amount is a change', () => {
  const saved = { 'monthly|Travel': '300' };
  assert.equal(form.isTargetsDraftChanged({ 'monthly|Travel': '300', 'annual|Travel': '' }, saved), false);
  assert.equal(form.isTargetsDraftChanged({ 'monthly|Travel': '$300' }, saved), false);
  assert.equal(form.isTargetsDraftChanged({ 'monthly|Travel': '350' }, saved), true);
  assert.equal(form.isTargetsDraftChanged({}, saved), true);
  assert.equal(form.targetsDraftHasValues({ a: ' ', b: '' }), false);
  assert.equal(form.targetsDraftHasValues({ a: '5' }), true);
});

test('copy from last year fills this year from last year and sends nothing by itself', () => {
  const lastYear = [{ category: 'Travel', cadence: 'monthly', amount: 300 }];
  const copied = plain(form.draftFromYearTargets(lastYear));
  assert.deepEqual(copied, { 'monthly|Travel': '300' });
  // The copy only becomes a change against this year's saved targets.
  assert.equal(form.isTargetsDraftChanged(copied, {}), true);
});

// ── Refusals ────────────────────────────────────────────────

test('a refusal with an index goes to the field that entry came from', () => {
  const sent = [
    { category: 'Food And Drink: Dining', cadence: 'monthly', amount: '600' },
    { category: 'Travel: Flights', cadence: 'annual', amount: 'abc' },
  ];
  const placed = plain(form.placeTargetsRefusal({
    error: 'The annual target on "Travel: Flights" must be an amount above zero.',
    reason: 'invalid_amount', index: 1, category: 'Travel: Flights', cadence: 'annual',
  }, sent));
  assert.deepEqual(placed, {
    category: 'Travel: Flights',
    cadence: 'annual',
    message: 'The annual target on "Travel: Flights" must be an amount above zero.',
  });
});

test('details exceeding a primary go to that primary on the cadence named, with no index', () => {
  const sent = [
    { category: 'Food And Drink', cadence: 'monthly', amount: '500' },
    { category: 'Food And Drink: Dining', cadence: 'monthly', amount: '600' },
  ];
  const placed = plain(form.placeTargetsRefusal({
    error: 'The monthly targets under "Food And Drink" add up to $600.00, more than its own $500.00.',
    reason: 'details_exceed_primary', primary: 'Food And Drink', cadence: 'monthly',
    primary_amount: 500, details_total: 600,
  }, sent));
  assert.equal(placed.category, 'Food And Drink');
  assert.equal(placed.cadence, 'monthly');
  assert.match(placed.message, /add up to \$600\.00/);
});

test('a refusal naming no entry is for the whole form', () => {
  const placed = plain(form.placeTargetsRefusal({
    error: 'Your targets changed while saving. Reload and try again.', reason: 'save_conflict',
  }, []));
  assert.deepEqual(placed, {
    category: null, cadence: null, message: 'Your targets changed while saving. Reload and try again.',
  });
  assert.equal(form.placeTargetsRefusal({ reason: 'year_not_editable' }, []).category, null);
  assert.equal(form.placeTargetsRefusal(null, []).message, 'The targets could not be saved.');
});

// ── Set alert ───────────────────────────────────────────────

test('Set alert works on a detailed spending target with an amount', () => {
  const row = { category: 'Food And Drink: Dining', isPrimary: false, kind: 'spending' };
  assert.equal(form.setAlertAvailability(row, 'monthly', '600').enabled, true);
  const blank = plain(form.setAlertAvailability(row, 'annual', ''));
  assert.equal(blank.enabled, false);
  assert.equal(blank.reason, 'Enter an annual target first.');
  assert.equal(form.setAlertAvailability(row, 'monthly', 'abc').enabled, false);
  assert.equal(form.setAlertAvailability(row, 'monthly', '0').enabled, false);
});

test('Set alert is disabled with its reason on a primary and on savings', () => {
  const primary = plain(form.setAlertAvailability(
    { category: 'Food And Drink', isPrimary: true, kind: 'spending' }, 'monthly', '900'));
  assert.equal(primary.enabled, false);
  assert.match(primary.reason, /one detailed category/);

  const savings = plain(form.setAlertAvailability(
    { category: 'Savings: Emergency Fund', isPrimary: false, kind: 'savings' }, 'monthly', '500'));
  assert.equal(savings.enabled, false);
  assert.match(savings.reason, /savings target/);
});

test('the fiscal start month is read off the API year', () => {
  assert.equal(form.fiscalStartMonthOfYear({ start: '2026-11-01' }), 11);
  assert.equal(form.fiscalStartMonthOfYear({ start: '2026-01-01' }), 1);
  assert.equal(form.fiscalStartMonthOfYear(null), 1);
});

test('up, down and Enter always leave the field; left and right only from its edge', () => {
  assert.equal(form.targetFieldMoveForKey('ArrowUp', 2, 2, 5), 'up');
  assert.equal(form.targetFieldMoveForKey('ArrowDown', 2, 2, 5), 'down');
  assert.equal(form.targetFieldMoveForKey('Enter', 0, 5, 5), 'down');

  assert.equal(form.targetFieldMoveForKey('ArrowLeft', 0, 0, 5), 'left');
  assert.equal(form.targetFieldMoveForKey('ArrowLeft', 3, 3, 5), null);
  assert.equal(form.targetFieldMoveForKey('ArrowRight', 5, 5, 5), 'right');
  assert.equal(form.targetFieldMoveForKey('ArrowRight', 3, 3, 5), null);
  assert.equal(form.targetFieldMoveForKey('ArrowLeft', 0, 0, 0), 'left');
  assert.equal(form.targetFieldMoveForKey('ArrowRight', 0, 0, 0), 'right');

  // With text selected the arrow collapses the selection first.
  assert.equal(form.targetFieldMoveForKey('ArrowLeft', 0, 5, 5), null);
  assert.equal(form.targetFieldMoveForKey('ArrowRight', 0, 5, 5), null);
  assert.equal(form.targetFieldMoveForKey('a', 0, 0, 5), null);
});

test('a move lands on the neighbouring field and nowhere past the edge of the grid', () => {
  assert.deepEqual(plain(form.nextTargetFieldPosition(3, 1, 'monthly', 'down')), { rowIndex: 2, cadence: 'monthly' });
  assert.deepEqual(plain(form.nextTargetFieldPosition(3, 1, 'annual', 'up')), { rowIndex: 0, cadence: 'annual' });
  assert.deepEqual(plain(form.nextTargetFieldPosition(3, 1, 'monthly', 'right')), { rowIndex: 1, cadence: 'annual' });
  assert.deepEqual(plain(form.nextTargetFieldPosition(3, 1, 'annual', 'left')), { rowIndex: 1, cadence: 'monthly' });

  assert.equal(form.nextTargetFieldPosition(3, 0, 'monthly', 'up'), null);
  assert.equal(form.nextTargetFieldPosition(3, 2, 'monthly', 'down'), null);
  assert.equal(form.nextTargetFieldPosition(3, 1, 'monthly', 'left'), null);
  assert.equal(form.nextTargetFieldPosition(3, 1, 'annual', 'right'), null);
  assert.equal(form.nextTargetFieldPosition(3, -1, 'monthly', 'down'), null);
});

// ── Pace settings ───────────────────────────────────────────

test('a band shows without needless trailing zeros', () => {
  assert.equal(form.formatPaceBandPercent(5), '5');
  assert.equal(form.formatPaceBandPercent(5.0), '5');
  assert.equal(form.formatPaceBandPercent(29.347), '29.347');
  assert.equal(form.formatPaceBandPercent('29.3470'), '29.347');
  assert.equal(form.formatPaceBandPercent(null), '');
  assert.equal(form.formatPaceBandPercent('abc'), '');
});

test('typing a percent sets the dollars to the monthly amount times percent, to the cent', () => {
  assert.equal(form.bandDollarsFromPercent('450', '5'), '22.50');
  assert.equal(form.bandDollarsFromPercent('$1,200', '29.347'), '352.16');
  assert.equal(form.bandDollarsFromPercent('600', '5'), '30');
  assert.equal(form.bandDollarsFromPercent('600', '0'), '0');
  assert.equal(form.bandDollarsFromPercent('', '5'), '');
  assert.equal(form.bandDollarsFromPercent('0', '5'), '');
  assert.equal(form.bandDollarsFromPercent('600', ''), '');
  assert.equal(form.bandDollarsFromPercent('600', 'abc'), '');
});

test('typing dollars sets the percent to dollars over the monthly amount, to 4 places', () => {
  assert.equal(form.bandPercentFromDollars('450', '22.50'), '5');
  assert.equal(form.bandPercentFromDollars('1200', '352.16'), '29.3467');
  assert.equal(form.bandPercentFromDollars('900', '100'), '11.1111');
  assert.equal(form.bandPercentFromDollars('', '10'), '');
  assert.equal(form.bandPercentFromDollars('450', ''), '');
});

test('a changed amount keeps the percent and recomputes the dollars, at either cadence', () => {
  const pace = { on: true, bandText: '29.347' };
  assert.equal(form.paceControlState({ kind: 'spending' }, 'monthly', '1200', pace).dollarsText, '352.16');
  assert.equal(form.paceControlState({ kind: 'spending' }, 'monthly', '1300', pace).dollarsText, '381.51');
  assert.equal(form.paceControlState({ kind: 'spending' }, 'annual', '12000', pace).dollarsText, '3521.64');
});

test('an empty amount disables all three controls with the cadence\'s reason, and savings has none', () => {
  const pace = { on: true, bandText: '5' };
  const monthly = plain(form.paceControlState({ kind: 'spending' }, 'monthly', '', pace));
  assert.equal(monthly.toggleDisabled, true);
  assert.equal(monthly.bandDisabled, true);
  assert.equal(monthly.toggleTitle, 'Enter a monthly amount first');
  assert.equal(monthly.percentTitle, 'Enter a monthly amount first');
  assert.equal(monthly.dollarsTitle, 'Enter a monthly amount first');
  assert.equal(monthly.dollarsText, '');
  const annual = plain(form.paceControlState({ kind: 'spending' }, 'annual', '', pace));
  assert.equal(annual.toggleDisabled, true);
  assert.equal(annual.bandDisabled, true);
  assert.equal(annual.toggleTitle, 'Enter an annual amount first');
  assert.equal(annual.percentTitle, 'Enter an annual amount first');
  assert.equal(annual.dollarsTitle, 'Enter an annual amount first');
  assert.equal(form.paceControlState({ kind: 'savings' }, 'monthly', '500', pace), null);
  assert.equal(form.paceControlState({ kind: 'savings' }, 'annual', '500', pace), null);
});

test('with Pace unchecked the band fields are disabled and the checkbox is not, at either cadence', () => {
  for (const cadence of ['monthly', 'annual']) {
    const state = plain(form.paceControlState({ kind: 'spending' }, cadence, '450', { on: false, bandText: '5' }));
    assert.equal(state.toggleDisabled, false);
    assert.equal(state.toggleTitle, 'Show pace on this line');
    assert.equal(state.bandDisabled, true);
    const on = plain(form.paceControlState({ kind: 'spending' }, cadence, '450', { on: true, bandText: '5' }));
    assert.equal(on.bandDisabled, false);
  }
});

test('the band percent title names the amount it is a percent of', () => {
  const pace = { on: true, bandText: '5' };
  assert.match(form.paceControlState({ kind: 'spending' }, 'monthly', '450', pace).percentTitle, /monthly amount/);
  assert.match(form.paceControlState({ kind: 'spending' }, 'annual', '450', pace).percentTitle, /annual amount/);
});

const DEFAULTS = {
  monthly: { track_pace: true, pace_band_percent: 5 },
  annual: { track_pace: false, pace_band_percent: 5 },
};

test('a row starts from its own year, else the remembered settings, else the cadence defaults', () => {
  const remembered = {
    'Travel: Flights': { monthly: { track_pace: false, pace_band_percent: 12.5 } },
  };
  const own = {
    [form.paceDraftKey('paceOn', 'Travel: Flights', 'monthly')]: 'true',
    [form.paceDraftKey('paceBand', 'Travel: Flights', 'monthly')]: '8',
  };
  const resolve = (draft, category, cadence) =>
    plain(form.resolveRowPace(draft, category, cadence, remembered, DEFAULTS));
  assert.deepEqual(resolve(own, 'Travel: Flights', 'monthly'), { on: true, bandText: '8' });
  assert.deepEqual(resolve({}, 'Travel: Flights', 'monthly'), { on: false, bandText: '12.5' });
  assert.deepEqual(resolve({}, 'Travel: Hotels', 'monthly'), { on: true, bandText: '5' });
  // The monthly memory says nothing about the annual target of the same category.
  assert.deepEqual(resolve({}, 'Travel: Flights', 'annual'), { on: false, bandText: '5' });
});

test('the defaults come from pace_defaults, and fall back to monthly on and annual off, both 5', () => {
  const sent = { monthly: { track_pace: false, pace_band_percent: 9 }, annual: { track_pace: true, pace_band_percent: 12 } };
  assert.deepEqual(plain(form.resolveRowPace({}, 'Travel', 'monthly', {}, sent)), { on: false, bandText: '9' });
  assert.deepEqual(plain(form.resolveRowPace({}, 'Travel', 'annual', {}, sent)), { on: true, bandText: '12' });
  for (const missing of [undefined, {}, { monthly: {} }]) {
    assert.deepEqual(plain(form.resolveRowPace({}, 'Travel', 'monthly', {}, missing)), { on: true, bandText: '5' });
    assert.deepEqual(plain(form.resolveRowPace({}, 'Travel', 'annual', {}, missing)), { on: false, bandText: '5' });
  }
  assert.deepEqual(plain(form.resolveRowPace({}, 'Travel', 'annual', undefined, undefined)), { on: false, bandText: '5' });
});

test('the draft\'s own setting wins over the memory, and a missing half falls through on its own', () => {
  const remembered = { Travel: { annual: { track_pace: true, pace_band_percent: 20 } } };
  const onlyOn = { [form.paceDraftKey('paceOn', 'Travel', 'annual')]: 'false' };
  assert.deepEqual(plain(form.resolveRowPace(onlyOn, 'Travel', 'annual', remembered, DEFAULTS)), { on: false, bandText: '20' });
});

test('saved targets put their pace settings in the draft, one pair per cadence', () => {
  const draft = plain(form.draftFromYearTargets([
    { category: 'Childcare', cadence: 'monthly', amount: 1200, track_pace: true, pace_band_percent: 29.347 },
    { category: 'Childcare', cadence: 'annual', amount: 9000, track_pace: false, pace_band_percent: 10 },
  ]));
  assert.deepEqual(draft, {
    'monthly|Childcare': '1200',
    'paceOn|monthly|Childcare': 'true',
    'paceBand|monthly|Childcare': '29.347',
    'annual|Childcare': '9000',
    'paceOn|annual|Childcare': 'false',
    'paceBand|annual|Childcare': '10',
  });
});

test('a category\'s monthly and annual settings are independent in the draft', () => {
  const draft = {};
  form.setRowPace(draft, 'Travel: Flights', 'annual', {}, DEFAULTS, { on: true, bandText: '15' });
  assert.deepEqual(plain(draft), {
    'paceOn|annual|Travel: Flights': 'true',
    'paceBand|annual|Travel: Flights': '15',
  });
  assert.deepEqual(plain(form.resolveRowPace(draft, 'Travel: Flights', 'monthly', {}, DEFAULTS)), { on: true, bandText: '5' });
  form.setRowPace(draft, 'Travel: Flights', 'monthly', {}, DEFAULTS, { on: false });
  assert.deepEqual(plain(form.resolveRowPace(draft, 'Travel: Flights', 'annual', {}, DEFAULTS)), { on: true, bandText: '15' });
  assert.deepEqual(plain(form.resolveRowPace(draft, 'Travel: Flights', 'monthly', {}, DEFAULTS)), { on: false, bandText: '5' });
});

test('the payload sends both settings on every monthly and annual spending target, and none on savings', () => {
  const rows = form.flattenTargetsFormRows(form.buildTargetsFormSections(CATEGORIES));
  const remembered = {
    'Travel: Flights': {
      monthly: { track_pace: false, pace_band_percent: 12.5 },
      annual: { track_pace: true, pace_band_percent: 7 },
    },
  };
  const draft = {
    'monthly|Food And Drink: Dining': '600',
    'paceOn|monthly|Food And Drink: Dining': 'false',
    'paceBand|monthly|Food And Drink: Dining': '29.347',
    'annual|Food And Drink: Dining': '7000',
    'paceOn|annual|Food And Drink: Dining': 'true',
    'paceBand|annual|Food And Drink: Dining': '10',
    'monthly|Travel: Flights': '300',
    'annual|Travel: Flights': '4000',
    'monthly|Savings': '500',
    'annual|Savings': '6000',
  };
  assert.deepEqual(plain(form.buildTargetsPayload(rows, draft, remembered, DEFAULTS)), [
    { category: 'Food And Drink: Dining', cadence: 'monthly', amount: '600', track_pace: false, pace_band_percent: 29.347 },
    { category: 'Food And Drink: Dining', cadence: 'annual', amount: '7000', track_pace: true, pace_band_percent: 10 },
    { category: 'Travel: Flights', cadence: 'monthly', amount: '300', track_pace: false, pace_band_percent: 12.5 },
    { category: 'Travel: Flights', cadence: 'annual', amount: '4000', track_pace: true, pace_band_percent: 7 },
    { category: 'Savings', cadence: 'monthly', amount: '500' },
    { category: 'Savings', cadence: 'annual', amount: '6000' },
  ]);
});

test('a band that is not a number is sent as typed so the API refuses it on that row', () => {
  const rows = form.flattenTargetsFormRows(form.buildTargetsFormSections(CATEGORIES));
  const draft = {
    'monthly|Travel': '300', 'paceOn|monthly|Travel': 'true', 'paceBand|monthly|Travel': '',
    'annual|Travel': '3000', 'paceOn|annual|Travel': 'true', 'paceBand|annual|Travel': 'xyz',
    'monthly|Travel: Flights': '100', 'paceOn|monthly|Travel: Flights': 'true', 'paceBand|monthly|Travel: Flights': 'abc',
  };
  const payload = plain(form.buildTargetsPayload(rows, draft));
  assert.equal(payload[0].pace_band_percent, '');
  assert.equal(payload[1].pace_band_percent, 'xyz');
  assert.equal(payload[2].pace_band_percent, 'abc');
});

test('settings kept while an amount is cleared come back when it is retyped, at either cadence', () => {
  for (const cadence of ['monthly', 'annual']) {
    const draft = {};
    form.setRowPace(draft, 'Travel: Flights', cadence, {}, DEFAULTS, { on: cadence === 'annual' ? true : false, bandText: '9' });
    draft[`${cadence}|Travel: Flights`] = '';
    draft[`${cadence}|Travel: Flights`] = '300';
    assert.deepEqual(
      plain(form.resolveRowPace(draft, 'Travel: Flights', cadence, {}, DEFAULTS)),
      { on: cadence === 'annual', bandText: '9' },
    );
  }
});

test('setRowPace writes both settings so a later memory change does not move the row', () => {
  const draft = {};
  const remembered = { 'Travel: Flights': { monthly: { track_pace: true, pace_band_percent: 7 } } };
  form.setRowPace(draft, 'Travel: Flights', 'monthly', remembered, DEFAULTS, { on: false });
  assert.deepEqual(plain(draft), {
    'paceOn|monthly|Travel: Flights': 'false',
    'paceBand|monthly|Travel: Flights': '7',
  });
});

test('a pace change is an unsaved change, and Undo to the saved draft is not', () => {
  const saved = form.draftFromYearTargets([
    { category: 'Travel', cadence: 'monthly', amount: 300, track_pace: true, pace_band_percent: 5 },
  ]);
  assert.equal(form.isTargetsDraftChanged(plain(saved), saved), false);
  const toggled = { ...plain(saved), 'paceOn|monthly|Travel': 'false' };
  assert.equal(form.isTargetsDraftChanged(toggled, saved), true);
  const wider = { ...plain(saved), 'paceBand|monthly|Travel': '10' };
  assert.equal(form.isTargetsDraftChanged(wider, saved), true);
  // "5.0" is the same band as "5".
  assert.equal(form.isTargetsDraftChanged({ ...plain(saved), 'paceBand|monthly|Travel': '5.0' }, saved), false);
});

test('a change to the annual settings is a change, and leaves the monthly ones as saved', () => {
  const saved = form.draftFromYearTargets([
    { category: 'Travel', cadence: 'monthly', amount: 300, track_pace: true, pace_band_percent: 5 },
    { category: 'Travel', cadence: 'annual', amount: 3600, track_pace: false, pace_band_percent: 5 },
  ]);
  assert.equal(form.isTargetsDraftChanged(plain(saved), saved), false);
  const annualOn = { ...plain(saved), 'paceOn|annual|Travel': 'true' };
  assert.equal(form.isTargetsDraftChanged(annualOn, saved), true);
  const annualBand = { ...plain(saved), 'paceBand|annual|Travel': '8' };
  assert.equal(form.isTargetsDraftChanged(annualBand, saved), true);
});

test('pace settings on a row with no amount at their cadence are not a change and not a value', () => {
  const draft = {
    'paceOn|monthly|Travel': 'false', 'paceBand|monthly|Travel': '9',
    'paceOn|annual|Travel': 'true', 'paceBand|annual|Travel': '9',
  };
  assert.equal(form.isTargetsDraftChanged(draft, {}), false);
  assert.equal(form.targetsDraftHasValues(draft), false);
  // An amount at one cadence makes only that cadence's settings count.
  const monthlyOnly = { ...draft, 'monthly|Travel': '300' };
  assert.equal(form.isTargetsDraftChanged(monthlyOnly, { 'monthly|Travel': '300' }), true);
  const annualSettingsOnly = { 'monthly|Travel': '300', 'paceOn|annual|Travel': 'true' };
  assert.equal(form.isTargetsDraftChanged(annualSettingsOnly, { 'monthly|Travel': '300' }), false);
  assert.equal(form.targetsDraftHasValues({ ...draft, 'monthly|Travel': '300' }), true);
});

test('copy from last year brings both cadences\' settings with the amounts', () => {
  const copied = plain(form.draftFromYearTargets([
    { category: 'Travel', cadence: 'monthly', amount: 300, track_pace: false, pace_band_percent: 20 },
    { category: 'Travel', cadence: 'annual', amount: 3600, track_pace: true, pace_band_percent: 15 },
  ]));
  assert.deepEqual(plain(form.resolveRowPace(copied, 'Travel', 'monthly', {}, DEFAULTS)), { on: false, bandText: '20' });
  assert.deepEqual(plain(form.resolveRowPace(copied, 'Travel', 'annual', {}, DEFAULTS)), { on: true, bandText: '15' });
  assert.equal(form.isTargetsDraftChanged(copied, {}), true);
});

test('the two pace refusals land on the row they name and say they are about pace', () => {
  const sent = [
    { category: 'Travel: Flights', cadence: 'monthly', amount: '300' },
    { category: 'Travel', cadence: 'monthly', amount: '900' },
  ];
  const band = plain(form.placeTargetsRefusal({
    error: 'The on-pace band on "Travel" must be a percent from 0 to 100.',
    reason: 'invalid_pace_band', index: 1, category: 'Travel', cadence: 'monthly',
  }, sent));
  assert.deepEqual(band, {
    category: 'Travel', cadence: 'monthly', paceReason: 'invalid_pace_band',
    message: 'The on-pace band on "Travel" must be a percent from 0 to 100.',
  });
  const flag = plain(form.placeTargetsRefusal({
    error: 'Track pace on "Travel: Flights" must be true or false.',
    reason: 'invalid_track_pace', index: 0, category: 'Travel: Flights', cadence: 'monthly',
  }, sent));
  assert.equal(flag.category, 'Travel: Flights');
  assert.equal(flag.paceReason, 'invalid_track_pace');
});

test('an annual pace refusal names the annual cadence so the editor opens that view', () => {
  const sent = [{ category: 'Travel', cadence: 'annual', amount: '3600' }];
  const refused = plain(form.placeTargetsRefusal({
    error: 'The on-pace band on "Travel" must be a percent from 0 to 100.',
    reason: 'invalid_pace_band', index: 0, category: 'Travel', cadence: 'annual',
  }, sent));
  assert.equal(refused.cadence, 'annual');
  assert.equal(refused.paceReason, 'invalid_pace_band');
});

const CLEAR_DRAFT = {
  'monthly|Food And Drink': '900',
  'monthly|Travel': '',
  'annual|Travel: Flights': '1200',
  'paceOn|monthly|Food And Drink': 'true',
  'paceBand|monthly|Food And Drink': '5',
};

test('clearing monthly leaves the annual amounts', () => {
  const cleared = plain(form.clearTargetsDraft(CLEAR_DRAFT, 'monthly'));
  assert.equal(form.targetsDraftHasScopeValues(cleared, 'monthly'), false);
  assert.equal(cleared['annual|Travel: Flights'], '1200');
});

test('clearing annual leaves the monthly amounts', () => {
  const cleared = plain(form.clearTargetsDraft(CLEAR_DRAFT, 'annual'));
  assert.equal(form.targetsDraftHasScopeValues(cleared, 'annual'), false);
  assert.equal(cleared['monthly|Food And Drink'], '900');
});

test('clearing all empties both cadences', () => {
  const cleared = plain(form.clearTargetsDraft(CLEAR_DRAFT, 'all'));
  assert.equal(form.targetsDraftHasScopeValues(cleared, 'all'), false);
  assert.equal(form.targetsDraftHasValues(cleared), false);
});

test('clearing does not change the draft it was given', () => {
  const before = plain(CLEAR_DRAFT);
  form.clearTargetsDraft(CLEAR_DRAFT, 'all');
  assert.deepEqual(plain(CLEAR_DRAFT), before);
});

test('a cleared row sends no target, whatever its pace settings were', () => {
  const rows = form.flattenTargetsFormRows(form.buildTargetsFormSections(CATEGORIES));
  const cleared = form.clearTargetsDraft(CLEAR_DRAFT, 'monthly');
  const payload = plain(form.buildTargetsPayload(rows, cleared, {}, {}));
  assert.deepEqual(payload.map(target => [target.category, target.cadence]), [
    ['Travel: Flights', 'annual'],
  ]);
});

test('a scope with nothing to clear is detected, blank fields included', () => {
  assert.equal(form.targetsDraftHasScopeValues(CLEAR_DRAFT, 'monthly'), true);
  assert.equal(form.targetsDraftHasScopeValues(CLEAR_DRAFT, 'annual'), true);
  assert.equal(form.targetsDraftHasScopeValues({ 'monthly|Travel': '  ' }, 'monthly'), false);
  assert.equal(form.targetsDraftHasScopeValues({ 'annual|Travel': '50' }, 'monthly'), false);
  assert.equal(form.targetsDraftHasScopeValues({ 'paceOn|monthly|Travel': 'true' }, 'all'), false);
  assert.equal(form.targetsDraftHasScopeValues({}, 'all'), false);
});

test('a clear button is disabled with its reason when its scope is empty', () => {
  const annualOnly = { 'annual|Travel: Flights': '1200' };
  assert.deepEqual(plain(form.clearTargetsButtonState(annualOnly, 'monthly', 'FY2027')), {
    label: 'Clear monthly',
    disabled: true,
    title: 'FY2027 has no monthly targets.',
  });
  assert.equal(form.clearTargetsButtonState(annualOnly, 'annual', 'FY2027').disabled, false);
  assert.equal(form.clearTargetsButtonState(annualOnly, 'all', 'FY2027').disabled, false);
  assert.equal(form.clearTargetsButtonState({}, 'all', 'FY2027').title, 'FY2027 has no targets.');
});

test('the clear wording names the year and the scope', () => {
  assert.equal(
    form.clearTargetsConfirmText('FY2027', 'monthly'),
    "Clear FY2027's monthly targets?\n\nNothing is saved until you press Save.",
  );
  assert.equal(
    form.clearTargetsConfirmText('FY2026', 'all'),
    "Clear all of FY2026's targets?\n\nNothing is saved until you press Save.",
  );
  assert.equal(
    form.clearTargetsStatusText('FY2027', 'annual'),
    "Cleared FY2027's annual targets. Nothing is saved until you press Save.",
  );
});
