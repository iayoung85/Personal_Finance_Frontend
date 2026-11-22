const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFiles(relPaths, exportsList) {
  const files = relPaths.map(relPath => path.join(__dirname, '..', relPath));
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox, { filename: files[files.length - 1] });
  return sandbox.module.exports;
}

const K = loadFiles(
  ['shared/fiscal-year.js', 'excel/constants.js', 'excel/cells.js', 'excel/default-range.js', 'excel/checks.js', 'excel/targets.js'],
  [
    'targetsSheetFromYear', 'parseTargetsSheet', 'parseTargetAmountCell', 'diffTargets', 'findingsFromTargetsDiff',
    'sameTargetSets', 'checkTargetsSheet', 'describeTargetsCheck', 'planTargetsSend', 'findingsFromTargetsRefusal',
    'isTargetsRefusal', 'buildTargetsCheckSheetRows', 'centsToAmountText', 'formatTargetCents', 'targetsYearText',
  ].join(', '),
);

const plain = value => JSON.parse(JSON.stringify(value));

const CATEGORIES = [
  { primary: 'Food', kind: 'spending', labels: ['Food: Dining', 'Food: Groceries'] },
  { primary: 'Home', kind: 'spending', labels: ['Home: Rent'] },
  { primary: 'Saved', kind: 'savings', labels: ['Saved: Rainy day'] },
];

function year2026(targets) {
  return { fiscal_year: 2026, label: 'FY2026', start: '2025-11-01', end: '2026-10-31', targets };
}

const APP_TARGETS = [
  { category: 'Food', cadence: 'monthly', amount: 600, track_pace: true, pace_band_percent: 5 },
  { category: 'Food: Groceries', cadence: 'monthly', amount: 412.5, track_pace: true, pace_band_percent: 5 },
  { category: 'Home: Rent', cadence: 'annual', amount: 12.1, track_pace: false, pace_band_percent: 5 },
];

function response(targets = APP_TARGETS) {
  return {
    editable_fiscal_years: [2026, 2025],
    years: [
      year2026(targets),
      { fiscal_year: 2025, label: 'FY2025', start: '2024-11-01', end: '2025-10-31', targets: [] },
    ],
    categories: CATEGORIES,
  };
}

function pulledSheet(targets = APP_TARGETS) {
  return K.targetsSheetFromYear(year2026(targets), CATEGORIES);
}

/** The sheet as the user left it: a copy of the pulled values with edits at (category, column). */
function sheetValues(edits = [], targets = APP_TARGETS) {
  const built = pulledSheet(targets);
  const values = built.values.map(row => [...row]);
  for (const edit of edits) {
    const row = values.find(candidate => candidate[1] === edit.category);
    row[edit.column === 'monthly' ? 3 : 4] = edit.value;
  }
  return values;
}

function check(values, picked = 2026, targets = APP_TARGETS) {
  return K.checkTargetsSheet({ values, targetsResponse: response(targets), pickedFiscalYear: picked });
}

const fixesOf = result => result.findings.filter(finding => finding.level === 'fix');

// ── Building the sheet ───────────────────────────────────────

test('the sheet names the year and its dates, then lists primaries above their detailed categories', () => {
  const built = pulledSheet();
  assert.deepEqual(plain(built.values.slice(0, 3)), [
    ['Fiscal year', 2026, 'FY2026', '', ''],
    ['Starts', '2025-11-01', '', '', ''],
    ['Ends', '2026-10-31', '', '', ''],
  ]);
  assert.deepEqual(plain(built.values[built.headerRowIndex]), ['Primary', 'Category', 'Kind', 'Monthly target', 'Annual target']);

  const table = built.values.slice(built.headerRowIndex + 1);
  assert.deepEqual(plain(table.map(row => row[1])), [
    'Food', 'Food: Dining', 'Food: Groceries', 'Home', 'Home: Rent', 'Saved', 'Saved: Rainy day',
  ]);
  assert.deepEqual(plain(table.map(row => row[0])), ['Food', 'Food', 'Food', 'Home', 'Home', 'Saved', 'Saved']);
  assert.deepEqual(plain(table.map(row => row[2])), ['spending', 'spending', 'spending', 'spending', 'spending', 'savings', 'savings']);
});

test('an amount shows where the year holds a target and the cell is blank where it does not', () => {
  const table = pulledSheet().values.slice(pulledSheet().headerRowIndex + 1);
  const byCategory = Object.fromEntries(table.map(row => [row[1], [row[3], row[4]]]));
  assert.deepEqual(plain(byCategory['Food']), [600, '']);
  assert.deepEqual(plain(byCategory['Food: Groceries']), [412.5, '']);
  assert.deepEqual(plain(byCategory['Home: Rent']), ['', 12.1]);
  assert.deepEqual(plain(byCategory['Food: Dining']), ['', '']);
  assert.deepEqual(plain(byCategory['Saved']), ['', '']);
});

test('text columns are written as text and amount columns keep a number format', () => {
  const built = pulledSheet();
  const first = built.formats[built.headerRowIndex + 1];
  assert.deepEqual(plain(first), ['@', '@', '@', '#,##0.00', '#,##0.00']);
  assert.equal(built.formats[0][1], 'General');
  assert.equal(built.values.length, built.rowCount);
  assert.ok(built.values.every(row => row.length === built.columnCount));
  assert.ok(built.formats.every(row => row.length === built.columnCount));
});

// ── Round trip ───────────────────────────────────────────────

test('building the sheet from a response and reading it back gives the same targets and nothing to send', () => {
  const parsed = K.parseTargetsSheet({
    values: pulledSheet().values,
    categories: CATEGORIES,
    editableYears: [2026, 2025],
  });
  assert.equal(parsed.fiscalYear, 2026);
  assert.deepEqual(plain(parsed.findings), []);
  assert.deepEqual(
    plain(parsed.targets.map(({ category, cadence, cents }) => ({ category, cadence, cents }))),
    [
      { category: 'Food', cadence: 'monthly', cents: 60000 },
      { category: 'Food: Groceries', cadence: 'monthly', cents: 41250 },
      { category: 'Home: Rent', cadence: 'annual', cents: 1210 },
    ],
  );

  const result = check(pulledSheet().values);
  assert.equal(result.changeCount, 0);
  assert.equal(result.canSend, false);
  assert.deepEqual(plain(result.findings), []);
});

test('every whole-cent amount survives the trip through a sheet number', () => {
  for (let cents = 1; cents < 5000; cents++) {
    assert.deepEqual(plain(K.parseTargetAmountCell(cents / 100)).cents, cents, `cents ${cents}`);
  }
  for (const cents of [123456789, 999999999999, 1000000007, 70, 7, 1999]) {
    assert.equal(K.parseTargetAmountCell(cents / 100).cents, cents);
  }
});

// ── Amounts ──────────────────────────────────────────────────

test('12.10 on the sheet reaches the body as "12.10"', () => {
  const values = sheetValues([{ category: 'Food: Dining', column: 'monthly', value: 12.1 }]);
  const plan = K.planTargetsSend({ values: values, targetsResponse: response(), pickedFiscalYear: 2026, checked: check(values) });
  assert.equal(plan.ok, true);
  const dining = plan.body.targets.find(target => target.category === 'Food: Dining');
  assert.deepEqual(plain(dining), { category: 'Food: Dining', cadence: 'monthly', amount: '12.10' });
});

test('text amounts may carry a dollar sign, commas and spaces, as the web fields allow', () => {
  assert.equal(K.parseTargetAmountCell('$1,200.50').cents, 120050);
  assert.equal(K.parseTargetAmountCell(' 75 ').cents, 7500);
  assert.equal(K.parseTargetAmountCell('.5').cents, 50);
});

test('float noise from a formula does not change the cents', () => {
  assert.equal(K.parseTargetAmountCell(0.1 + 0.2).cents, 30);
  assert.equal(K.parseTargetAmountCell(0.1 + 0.2).rounded, true);
});

test('digits past the cent round half up, as the app rounds, and are noted', () => {
  const parsed = K.parseTargetAmountCell(1.005);
  assert.equal(parsed.cents, 101);
  assert.equal(parsed.rounded, true);
  assert.equal(K.parseTargetAmountCell('12.344').cents, 1234);
  assert.equal(K.parseTargetAmountCell('12.345').cents, 1235);
  assert.equal(K.parseTargetAmountCell('12.100').rounded, false);

  const values = sheetValues([{ category: 'Food: Dining', column: 'monthly', value: 12.345 }]);
  const notes = check(values).findings.filter(finding => finding.problem === 'Amount rounded to the cent');
  assert.equal(notes.length, 1);
  assert.match(notes[0].detail, /\$12\.35/);
});

test('a blank cell is no target', () => {
  assert.equal(K.parseTargetAmountCell('').state, 'blank');
  assert.equal(K.parseTargetAmountCell('   ').state, 'blank');
  assert.equal(K.parseTargetAmountCell(null).state, 'blank');
});

test('amounts that cannot be sent say why', () => {
  const problem = value => plain(K.parseTargetAmountCell(value)).problem;
  assert.equal(problem('abc'), 'Amount is not a number');
  assert.equal(problem('12.3.4'), 'Amount is not a number');
  assert.equal(problem('1e3'), 'Amount is not a number');
  assert.equal(problem(true), 'Amount is not a number');
  assert.equal(problem(NaN), 'Amount is not a number');
  assert.equal(problem(-5), 'Amount must be above zero');
  assert.equal(problem('-5'), 'Amount must be above zero');
  assert.equal(problem(0), 'Amount must be above zero');
  assert.equal(problem('0.00'), 'Amount must be above zero');
  assert.equal(problem(0.004), 'Amount must be above zero');
  assert.equal(problem(1e-9), 'Amount must be above zero');
  assert.equal(problem(10000000000), 'Amount is too large');
  assert.equal(problem(1e30), 'Amount is too large');
  assert.equal(K.parseTargetAmountCell(9999999999.99).cents, 999999999999);
});

test('each unsendable amount is a fix finding on its row, and its target is not in the list', () => {
  const values = sheetValues([
    { category: 'Food: Dining', column: 'monthly', value: 'lots' },
    { category: 'Food: Groceries', column: 'annual', value: -20 },
    { category: 'Home', column: 'monthly', value: 0 },
  ]);
  const result = check(values);
  const fixes = fixesOf(result);
  assert.deepEqual(
    plain(fixes.map(finding => [finding.problem, finding.key, finding.name])),
    [
      ['Amount is not a number', 'Food: Dining', 'monthly'],
      ['Amount must be above zero', 'Food: Groceries', 'annual'],
      ['Amount must be above zero', 'Home', 'monthly'],
    ],
  );
  assert.match(fixes[0].detail, /Row \d+ holds "lots"/);
  assert.equal(result.canSend, false);
  assert.equal(result.diff.removed.length, 0, 'an unreadable sheet is not diffed, so no row is called removed');
});

// ── Rows that cannot be sent ─────────────────────────────────

test('a category the app does not list is a fix finding, even with no amount', () => {
  const values = sheetValues();
  values.push(['Food', 'Food: Grocerys', 'spending', '', '']);
  values.push(['Pets', 'Pets: Vet', 'spending', 80, '']);
  const result = check(values);
  const unknown = fixesOf(result).filter(finding => finding.problem === 'Category not in the app');
  assert.deepEqual(plain(unknown.map(finding => finding.key)), ['Food: Grocerys', 'Pets: Vet']);
  assert.equal(result.canSend, false);
});

test('a category spelled in another case is named with the app\'s spelling', () => {
  const values = sheetValues();
  values.push(['Food', 'food: groceries', 'spending', 5, '']);
  const finding = fixesOf(check(values))[0];
  assert.equal(finding.problem, 'Category not in the app');
  assert.match(finding.action, /"Food: Groceries"/);
});

test('surrounding spaces on a category are ignored, as the app strips them', () => {
  const values = sheetValues([{ category: 'Food: Dining', column: 'monthly', value: 50 }]);
  values.find(row => row[1] === 'Food: Dining')[1] = '  Food: Dining ';
  const result = check(values);
  assert.deepEqual(plain(fixesOf(result)), []);
  assert.equal(result.diff.added.length, 1);
});

test('an amount on a row with no category is a fix finding', () => {
  const values = sheetValues();
  values.push(['', '', '', 25, '']);
  const finding = fixesOf(check(values))[0];
  assert.equal(finding.problem, 'Amount with no category');
});

test('the same category and cadence twice is a fix finding naming both rows', () => {
  const values = sheetValues([{ category: 'Food', column: 'monthly', value: 600 }]);
  values.push(['Food', 'Food', 'spending', 700, '']);
  const duplicate = fixesOf(check(values)).find(finding => finding.problem === 'Same target twice');
  assert.ok(duplicate);
  assert.equal(duplicate.key, 'Food');
  assert.equal(duplicate.name, 'monthly');
  assert.match(duplicate.detail, /Rows \d+ and \d+/);
});

test('the same category twice is fine when only one row has an amount at that cadence', () => {
  const values = sheetValues();
  values.push(['Food', 'Food', 'spending', '', 900]);
  assert.deepEqual(plain(fixesOf(check(values))), []);
});

test('a sheet with no table or no year is a fix finding', () => {
  const noTable = check([['nothing', 'here']]);
  assert.equal(fixesOf(noTable)[0].problem, 'Table not found');
  assert.equal(noTable.canSend, false);

  const noYear = sheetValues();
  noYear[0] = ['', '', '', '', ''];
  assert.equal(fixesOf(check(noYear))[0].problem, 'Fiscal year not found');
});

test('a year the app does not take, or one other than the picker, is a fix finding', () => {
  const old = sheetValues();
  old[0][1] = 2020;
  assert.equal(fixesOf(check(old))[0].problem, 'Fiscal year cannot be set');

  const other = check(sheetValues(), 2025);
  assert.deepEqual(plain(fixesOf(other).map(finding => finding.problem)), ['Sheet is for another year']);
  assert.equal(other.canSend, false);
});

test('the year may be typed as text', () => {
  const values = sheetValues([{ category: 'Food: Dining', column: 'monthly', value: 50 }]);
  values[0][1] = '2026';
  assert.equal(check(values).canSend, true);
});

test('a missing sheet is a fix finding', () => {
  const result = K.checkTargetsSheet({ values: null, targetsResponse: response(), pickedFiscalYear: 2026 });
  assert.equal(result.findings[0].problem, 'Sheet not found');
  assert.equal(result.canSend, false);
});

test('rows below the table with only blanks are ignored', () => {
  const values = sheetValues();
  values.push(['', '', '', '', ''], ['', '', '', '', '']);
  assert.deepEqual(plain(check(values).findings), []);
});

// ── Diff ─────────────────────────────────────────────────────

test('the diff names an add, a change and a removal, and counts what did not change', () => {
  const values = sheetValues([
    { category: 'Food: Dining', column: 'monthly', value: 90 },
    { category: 'Food: Groceries', column: 'monthly', value: 450 },
    { category: 'Home: Rent', column: 'annual', value: '' },
  ]);
  const result = check(values);
  assert.equal(fixesOf(result).length, 0);
  assert.equal(result.canSend, true);
  assert.equal(result.diff.unchanged, 1);
  assert.deepEqual(plain(result.diff.added.map(({ category, cadence, cents }) => ({ category, cadence, cents }))),
    [{ category: 'Food: Dining', cadence: 'monthly', cents: 9000 }]);
  assert.deepEqual(plain(result.diff.changed.map(({ category, cents, fromCents }) => ({ category, cents, fromCents }))),
    [{ category: 'Food: Groceries', cents: 45000, fromCents: 41250 }]);
  assert.deepEqual(plain(result.diff.removed.map(({ category, cents, rowMissing }) => ({ category, cents, rowMissing }))),
    [{ category: 'Home: Rent', cents: 1210, rowMissing: false }]);

  const byProblem = Object.fromEntries(result.findings.map(finding => [finding.problem, finding]));
  assert.match(byProblem['Target to add'].detail, /\$90\.00/);
  assert.match(byProblem['Target to change'].detail, /\$412\.50.*\$450\.00/);
  assert.match(byProblem['Target to remove'].detail, /\$12\.10.*blank/);
  assert.ok(result.findings.every(finding => finding.level === 'info'));
});

test('a target whose row was deleted from the sheet is listed as removed, not dropped silently', () => {
  const values = sheetValues().filter(row => row[1] !== 'Home: Rent');
  const result = check(values);
  assert.equal(result.diff.removed.length, 1);
  assert.equal(result.diff.removed[0].rowMissing, true);
  assert.match(result.findings[0].detail, /no row for it/);
  assert.equal(result.canSend, true);
});

test('a whole year cleared is a removal of every target', () => {
  const values = sheetValues([
    { category: 'Food', column: 'monthly', value: '' },
    { category: 'Food: Groceries', column: 'monthly', value: '' },
    { category: 'Home: Rent', column: 'annual', value: '' },
  ]);
  const result = check(values);
  assert.equal(result.diff.removed.length, 3);
  const plan = K.planTargetsSend({ values, targetsResponse: response(), pickedFiscalYear: 2026, checked: result });
  assert.deepEqual(plain(plan.body), { targets: [] });
});

test('the diff is against the app\'s targets for the sheet\'s year', () => {
  const values = sheetValues();
  values[0][1] = 2025;
  const result = K.checkTargetsSheet({ values, targetsResponse: response(), pickedFiscalYear: 2025 });
  assert.equal(result.diff.added.length, 3);
  assert.equal(result.label, 'FY2025');
});

test('findings from a diff carry the sheet name and a sheet row', () => {
  const values = sheetValues([{ category: 'Food: Dining', column: 'annual', value: 5 }]);
  const finding = check(values).findings[0];
  assert.equal(finding.sheet, 'PF_TARGETS');
  assert.match(finding.detail, /row \d+/);
});

// ── Changed since the check ──────────────────────────────────

function planFor(values, checked, overrides = {}) {
  return K.planTargetsSend({
    values,
    targetsResponse: overrides.response || response(),
    pickedFiscalYear: overrides.picked === undefined ? 2026 : overrides.picked,
    checked,
  });
}

function checkedWithEdit() {
  const values = sheetValues([{ category: 'Food: Dining', column: 'monthly', value: 90 }]);
  return { values, checked: check(values) };
}

test('a send goes ahead when the sheet still holds what was checked', () => {
  const { values, checked } = checkedWithEdit();
  const plan = planFor(values, checked);
  assert.equal(plan.ok, true);
  assert.equal(plan.fiscalYear, 2026);
  assert.deepEqual(plain(plan.body), {
    targets: [
      { category: 'Food', cadence: 'monthly', amount: '600.00' },
      { category: 'Food: Dining', cadence: 'monthly', amount: '90.00' },
      { category: 'Food: Groceries', cadence: 'monthly', amount: '412.50' },
      { category: 'Home: Rent', cadence: 'annual', amount: '12.10' },
    ],
  });
});

test('the body holds exactly the rows with an amount and no pace settings', () => {
  const { values, checked } = checkedWithEdit();
  const plan = planFor(values, checked);
  for (const target of plan.body.targets) {
    assert.deepEqual(plain(Object.keys(target).sort()), ['amount', 'cadence', 'category']);
    assert.equal(typeof target.amount, 'string');
  }
  assert.equal(plan.body.targets.length, 4);
});

test('a changed amount since the check refuses the send', () => {
  const { values, checked } = checkedWithEdit();
  const edited = values.map(row => [...row]);
  edited.find(row => row[1] === 'Food: Dining')[3] = 95;
  const plan = planFor(edited, checked);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /changed since the check/);
});

test('an added or cleared target since the check refuses the send', () => {
  const { values, checked } = checkedWithEdit();
  const added = values.map(row => [...row]);
  added.find(row => row[1] === 'Saved: Rainy day')[3] = 10;
  assert.equal(planFor(added, checked).ok, false);

  const cleared = values.map(row => [...row]);
  cleared.find(row => row[1] === 'Food: Dining')[3] = '';
  assert.equal(planFor(cleared, checked).ok, false);
});

test('the comparison is on parsed targets, not on cell text', () => {
  const { values, checked } = checkedWithEdit();
  const retyped = values.map(row => [...row]);
  retyped.find(row => row[1] === 'Food: Dining')[3] = '$90.00';
  retyped.find(row => row[1] === 'Food')[3] = '600.0';
  retyped.find(row => row[1] === 'Food: Groceries')[3] = ' 412.5';
  assert.equal(planFor(retyped, checked).ok, true);
});

test('moving rows around does not count as a change', () => {
  const { values, checked } = checkedWithEdit();
  const reordered = [...values.slice(0, 6), ...values.slice(6).reverse()];
  assert.equal(planFor(reordered, checked).ok, true);
});

test('a cell that became unsendable since the check refuses the send, even though the target list looks the same', () => {
  const { values, checked } = checkedWithEdit();
  const broken = values.map(row => [...row]);
  broken.find(row => row[1] === 'Saved')[3] = 'ten';
  const plan = planFor(broken, checked);
  assert.equal(plan.ok, false);
  assert.match(plan.message, /changed since the check/);
});

test('a different year since the check refuses the send', () => {
  const { values, checked } = checkedWithEdit();
  const other = values.map(row => [...row]);
  other[0][1] = 2025;
  assert.equal(planFor(other, checked, { picked: 2025 }).ok, false);
  assert.equal(planFor(values, checked, { picked: 2025 }).ok, false);
});

test('a missing sheet at send time refuses', () => {
  const { checked } = checkedWithEdit();
  assert.equal(planFor(null, checked).ok, false);
});

test('targets that changed in the app since the check refuse the send', () => {
  const { values, checked } = checkedWithEdit();
  const moved = response([...APP_TARGETS, { category: 'Saved', cadence: 'annual', amount: 100 }]);
  const plan = planFor(values, checked, { response: moved });
  assert.equal(plan.ok, false);
  assert.match(plan.message, /app changed since the check/);
});

test('sameTargetSets ignores order and rows but not amounts', () => {
  const first = [{ category: 'A', cadence: 'monthly', cents: 100, sheetRow: 1 }, { category: 'B', cadence: 'annual', cents: 5, sheetRow: 2 }];
  const reversed = [{ category: 'B', cadence: 'annual', cents: 5, sheetRow: 9 }, { category: 'A', cadence: 'monthly', cents: 100, sheetRow: 8 }];
  assert.equal(K.sameTargetSets(first, reversed), true);
  assert.equal(K.sameTargetSets(first, [{ ...first[0], cents: 101 }, first[1]]), false);
  assert.equal(K.sameTargetSets(first, [first[0]]), false);
  assert.equal(K.sameTargetSets([], []), true);
});

// ── Refusals ─────────────────────────────────────────────────

const SENT = [
  { category: 'Food', cadence: 'monthly', cents: 60000, sheetRow: 7 },
  { category: 'Home: Rent', cadence: 'annual', cents: 1210, sheetRow: 11 },
];

test('a parent-rule refusal becomes a fix finding on the primary', () => {
  const findings = K.findingsFromTargetsRefusal({
    error: 'The monthly targets under "Food" add up to $700.00, more than its own $600.00.',
    reason: 'details_exceed_primary',
    primary: 'Food',
    cadence: 'monthly',
    primary_amount: 600,
    details_total: 700,
  }, SENT);
  assert.equal(findings.length, 1);
  assert.deepEqual(plain([findings[0].level, findings[0].key, findings[0].name, findings[0].sheet]),
    ['fix', 'Food', 'monthly', 'PF_TARGETS']);
  assert.match(findings[0].detail, /\$700\.00/);
  assert.match(findings[0].action, /monthly/);
});

test('a refusal that names an entry by index points at that entry\'s sheet row', () => {
  const findings = K.findingsFromTargetsRefusal({
    error: 'The annual target on "Home: Rent" must be an amount above zero.',
    reason: 'invalid_amount',
    index: 1,
    category: 'Home: Rent',
    cadence: 'annual',
  }, SENT);
  assert.equal(findings[0].problem, 'The app refused an amount');
  assert.equal(findings[0].key, 'Home: Rent');
  assert.match(findings[0].detail, /row 11/);
});

test('a refusal with an index and no category still finds the entry', () => {
  const findings = K.findingsFromTargetsRefusal({ error: 'Target 1 needs a category.', reason: 'invalid_request', index: 0 }, SENT);
  assert.equal(findings[0].key, 'Food');
  assert.match(findings[0].detail, /row 7/);
});

test('a save conflict and an unknown reason are findings too', () => {
  const conflict = K.findingsFromTargetsRefusal({ error: 'Your targets changed while saving. Reload and try again.', reason: 'save_conflict' }, SENT);
  assert.equal(conflict[0].problem, 'The targets changed in the app while saving');
  assert.equal(conflict[0].level, 'fix');

  const odd = K.findingsFromTargetsRefusal({ error: 'Something new.', reason: 'brand_new_reason' }, SENT);
  assert.equal(odd[0].problem, 'The app refused the targets');
  assert.match(odd[0].detail, /Something new\./);
});

test('only a 400 or 409 with a reason is a refusal for PF_CHECK', () => {
  assert.equal(K.isTargetsRefusal(400, { error: 'x', reason: 'invalid_amount' }), true);
  assert.equal(K.isTargetsRefusal(409, { error: 'x', reason: 'save_conflict' }), true);
  assert.equal(K.isTargetsRefusal(400, {}), false);
  assert.equal(K.isTargetsRefusal(500, { error: 'x', reason: 'y' }), false);
  assert.equal(K.isTargetsRefusal(401, { error: 'x' }), false);
});

// ── Reporting ────────────────────────────────────────────────

test('the PF_CHECK header line says a targets check wrote it, with the fiscal year', () => {
  const rows = K.buildTargetsCheckSheetRows({
    checkedAt: new Date(2026, 10, 21, 9, 5),
    yearText: 'FY2026',
    outcome: 'Targets checked',
    findings: check(sheetValues([{ category: 'Food: Dining', column: 'monthly', value: 90 }])).findings,
  });
  assert.equal(rows[0][0], 'Targets checked 2026-11-21 09:05, fiscal year FY2026. 0 to fix, 1 note.');
  assert.deepEqual(plain(rows[2]), ['Sheet', 'Level', 'Problem', 'Key', 'Name', 'Detail', 'What to do']);
  assert.equal(rows[3][0], 'PF_TARGETS');
  assert.ok(rows.every(row => row.length === 7));
});

test('a clean check says so in the sheet and the status line', () => {
  const result = check(pulledSheet().values);
  const rows = K.buildTargetsCheckSheetRows({ checkedAt: new Date(2026, 10, 21), yearText: K.targetsYearText(result), outcome: 'Targets checked', findings: result.findings });
  assert.equal(rows[3][2], 'No problems found.');
  assert.match(K.describeTargetsCheck(result).message, /matches the app: nothing to send/);
});

test('the status line gives the counts, or the fix count when something blocks the send', () => {
  const edited = check(sheetValues([
    { category: 'Food: Dining', column: 'monthly', value: 90 },
    { category: 'Food', column: 'monthly', value: 650 },
    { category: 'Home: Rent', column: 'annual', value: '' },
  ]));
  const described = K.describeTargetsCheck(edited);
  assert.equal(described.tone, 'success');
  assert.match(described.message, /FY2026: 1 to add, 1 to change, 1 to remove/);

  const blocked = K.describeTargetsCheck(check(sheetValues([{ category: 'Food', column: 'monthly', value: 'x' }])));
  assert.equal(blocked.tone, 'warning');
  assert.match(blocked.message, /1 to fix/);
});

test('cents print as dollars and as the app\'s decimal text', () => {
  assert.equal(K.formatTargetCents(123456), '$1,234.56');
  assert.equal(K.centsToAmountText(1210), '12.10');
  assert.equal(K.centsToAmountText(5), '0.05');
  assert.equal(K.centsToAmountText(60000), '600.00');
});
