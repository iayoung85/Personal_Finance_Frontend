const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const fiscalSource = fs.readFileSync(path.join(root, 'shared', 'fiscal-year.js'), 'utf8');
const filtersPath = path.join(root, 'transactions', 'filters.js');
const filtersSource = fs.readFileSync(filtersPath, 'utf8');
const pageHtml = fs.readFileSync(path.join(root, 'transactions.html'), 'utf8');
const settingsSource = fs.readFileSync(path.join(root, 'user-settings', 'app-config.js'), 'utf8');

function loadFilters() {
  const sandbox = { module: { exports: {} }, getAppConfig: () => ({}) };
  vm.runInNewContext(
    `${fiscalSource}\n${filtersSource}\nmodule.exports = { _dateChipPlan, _monthChips, `
      + '_yearChipYears, _resolveDateFilterName, _mapConfigRangeToFilter, _fiscalChips, '
      + '_shouldRestoreSavedDateFilter, DATE_FILTER_STALE_AFTER_MS, '
      + 'ALWAYS_SHOWN_DATE_CHIP_IDS, FISCAL_DATE_CHIP_IDS };',
    sandbox,
    { filename: filtersPath },
  );
  return sandbox.module.exports;
}

const {
  _dateChipPlan,
  _monthChips,
  _yearChipYears,
  _resolveDateFilterName,
  _mapConfigRangeToFilter,
  _fiscalChips,
  _shouldRestoreSavedDateFilter,
  DATE_FILTER_STALE_AFTER_MS,
  ALWAYS_SHOWN_DATE_CHIP_IDS,
  FISCAL_DATE_CHIP_IDS,
} = loadFilters();

const JANUARY = 1;
const NOVEMBER = 11;
const NOW = new Date(2026, 10, 12);

/** The static chips in the page's date row: id and whether it starts hidden. */
function staticDateChips() {
  const rowStart = pageHtml.indexOf('filter-group-dates');
  const rowEnd = pageHtml.indexOf('custom-date-range-inputs', rowStart);
  const rowHtml = pageHtml.slice(rowStart, rowEnd);
  const chips = [];
  for (const match of rowHtml.matchAll(/<button id="([^"]+)" class="btn-date-toggle"([^>]*)>/g)) {
    chips.push({ id: match[1], startsHidden: match[2].includes('display:none') });
  }
  return chips;
}

test('the plan names exactly the static chips the page has', () => {
  const chips = staticDateChips();
  const alwaysShown = chips.filter(chip => !chip.startsHidden).map(chip => chip.id);
  const startHidden = chips.filter(chip => chip.startsHidden).map(chip => chip.id);

  assert.deepEqual(alwaysShown.sort(), Array.from(ALWAYS_SHOWN_DATE_CHIP_IDS).sort());
  assert.deepEqual(startHidden.sort(), Array.from(FISCAL_DATE_CHIP_IDS).sort());
});

test('a January fiscal year shows no fiscal chips and every year chip', () => {
  const plan = _dateChipPlan(NOW, 2019, JANUARY);

  assert.equal(plan.fiscalIds.length, 0);
  assert.equal(plan.months.length, 6);
  assert.deepEqual(Array.from(plan.years), [2019, 2020, 2021, 2022, 2023, 2024]);
  assert.equal(plan.total, 7 + 6 + 6);
});

test('with a long history the fiscal chips do not make the row longer', () => {
  const dates = [NOW, new Date(2026, 0, 1), new Date(2026, 9, 31), new Date(2027, 5, 15)];
  for (const now of dates) {
    for (const earliestYear of [2012, 2019, now.getFullYear() - 3]) {
      const calendarTotal = _dateChipPlan(now, earliestYear, JANUARY).total;
      for (let fiscalMonth = 2; fiscalMonth <= 12; fiscalMonth++) {
        const plan = _dateChipPlan(now, earliestYear, fiscalMonth);
        assert.equal(plan.fiscalIds.length, 2);
        assert.equal(
          plan.total,
          calendarTotal,
          `start month ${fiscalMonth}, history from ${earliestYear}, on ${now.toDateString()}`,
        );
      }
    }
  }
});

test('the fiscal chips take the slots of the two oldest month chips', () => {
  const plan = _dateChipPlan(NOW, 2019, NOVEMBER);

  assert.deepEqual(Array.from(plan.fiscalIds), ['btn-date-fiscal-ytd', 'btn-date-last-fiscal-year']);
  assert.deepEqual(Array.from(plan.months, chip => chip.label), ['Jun', 'Jul', 'Aug', 'Sep']);
  assert.deepEqual(Array.from(plan.years), [2019, 2020, 2021, 2022, 2023, 2024]);
});

test('one year chip is history enough for the cap to apply', () => {
  const plan = _dateChipPlan(NOW, 2024, NOVEMBER);

  assert.deepEqual(Array.from(plan.years), [2024]);
  assert.equal(plan.months.length, 4);
  assert.equal(plan.total, _dateChipPlan(NOW, 2024, JANUARY).total);
});

test('a short history keeps all six month chips beside the fiscal chips', () => {
  // No year chips, so the row is short and may grow by the two fiscal chips.
  for (const earliestYear of [2025, 2026, null]) {
    const calendarPlan = _dateChipPlan(NOW, earliestYear, JANUARY);
    const fiscalPlan = _dateChipPlan(NOW, earliestYear, NOVEMBER);
    assert.deepEqual(Array.from(fiscalPlan.years), []);
    assert.equal(fiscalPlan.months.length, 6);
    assert.equal(fiscalPlan.total, calendarPlan.total + 2);
  }
});

test('the fiscal chips read FYTD and the finished fiscal year', () => {
  const label = (now, month) => Array.from(_fiscalChips(now, month), chip => chip.label);

  assert.deepEqual(label(NOW, NOVEMBER), ['FYTD', 'FY2026']);
  assert.deepEqual(label(new Date(2026, 9, 31), NOVEMBER), ['FYTD', 'FY2025']);
  assert.deepEqual(label(new Date(2026, 10, 1), NOVEMBER), ['FYTD', 'FY2026']);
  assert.deepEqual(
    Array.from(_fiscalChips(NOW, NOVEMBER), chip => chip.id),
    Array.from(FISCAL_DATE_CHIP_IDS),
  );
});

test('year chips stop two years back', () => {
  assert.deepEqual(Array.from(_yearChipYears(2020, 2026)), [2020, 2021, 2022, 2023, 2024]);
  assert.deepEqual(Array.from(_yearChipYears(2025, 2026)), []);
  assert.deepEqual(Array.from(_yearChipYears(null, 2026)), []);
});

test('month chips are the six months before last month', () => {
  const sameYear = _monthChips(new Date(2026, 10, 12));
  assert.deepEqual(Array.from(sameYear, chip => chip.label), ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);

  const acrossYears = _monthChips(new Date(2026, 2, 3));
  assert.deepEqual(
    Array.from(acrossYears, chip => chip.label),
    ["Aug '25", "Sep '25", "Oct '25", "Nov '25", "Dec '25", "Jan '26"],
  );
  assert.equal(acrossYears[0].year, 2025);
  assert.equal(acrossYears[0].month, 7);
});

test('a fiscal filter falls back to its calendar twin with a January start', () => {
  assert.equal(_resolveDateFilterName('fiscal_ytd', JANUARY), 'ytd');
  assert.equal(_resolveDateFilterName('last_fiscal_year', JANUARY), 'last_year');
  assert.equal(_resolveDateFilterName('fiscal_ytd', NOVEMBER), 'fiscal_ytd');
  assert.equal(_resolveDateFilterName('last_fiscal_year', NOVEMBER), 'last_fiscal_year');
  assert.equal(_resolveDateFilterName('mtd', JANUARY), 'mtd');
  assert.equal(_resolveDateFilterName('year_2020', NOVEMBER), 'year_2020');
});

test('both fiscal ranges can be the saved default range', () => {
  assert.equal(_mapConfigRangeToFilter('fiscal_ytd').buttonId, 'btn-date-fiscal-ytd');
  assert.equal(_mapConfigRangeToFilter('fiscal_ytd').filterName, 'fiscal_ytd');
  assert.equal(_mapConfigRangeToFilter('last_fiscal_year').buttonId, 'btn-date-last-fiscal-year');
  assert.equal(_mapConfigRangeToFilter('last_fiscal_year').filterName, 'last_fiscal_year');
});

test('Settings offers the fiscal default ranges only when they are distinct', () => {
  const sandbox = {
    module: { exports: {} },
    trailingYearLabel: () => 'Last 365 Days',
  };
  vm.runInNewContext(
    `${fiscalSource}\n${settingsSource}\nmodule.exports = { _defaultRangeOptions };`,
    sandbox,
  );
  const { _defaultRangeOptions } = sandbox.module.exports;
  const fiscalLabels = _defaultRangeOptions('ytd', NOVEMBER, NOW)
    .filter(option => option.value.includes('fiscal'))
    .map(option => option.label);
  assert.deepEqual(
    Array.from(fiscalLabels),
    ['Current Fiscal Year (FY2027)', 'Last Fiscal Year (FY2026)'],
  );
  const values = (selected, month) =>
    Array.from(_defaultRangeOptions(selected, month, NOW), option => option.value);

  const calendarValues = ['last_12_months', 'mtd', 'ytd', 'last_month', 'last_year'];
  assert.deepEqual(values('ytd', JANUARY), calendarValues);
  assert.deepEqual(values('ytd', NOVEMBER), [...calendarValues, 'fiscal_ytd', 'last_fiscal_year']);
  // A fiscal range saved before the start month went back to January stays listed.
  assert.deepEqual(values('fiscal_ytd', JANUARY), [...calendarValues, 'fiscal_ytd']);
});

const MINUTE_MS = 60 * 1000;
const NOW_MS = NOW.getTime();

test('a chip with recent activity is restored', () => {
  assert.equal(_shouldRestoreSavedDateFilter('ytd', String(NOW_MS - 5 * MINUTE_MS), NOW_MS), true);
  assert.equal(
    _shouldRestoreSavedDateFilter('ytd', String(NOW_MS - DATE_FILTER_STALE_AFTER_MS), NOW_MS),
    true,
  );
});

test('a chip idle past the window falls back to the Settings default', () => {
  const staleMs = NOW_MS - DATE_FILTER_STALE_AFTER_MS - 1;
  assert.equal(_shouldRestoreSavedDateFilter('ytd', String(staleMs), NOW_MS), false);
});

test('a missing or unreadable timestamp counts as stale', () => {
  assert.equal(_shouldRestoreSavedDateFilter('ytd', null, NOW_MS), false);
  assert.equal(_shouldRestoreSavedDateFilter('ytd', '', NOW_MS), false);
  assert.equal(_shouldRestoreSavedDateFilter('ytd', 'abc', NOW_MS), false);
});

test('a timestamp in the future counts as stale', () => {
  assert.equal(_shouldRestoreSavedDateFilter('ytd', String(NOW_MS + MINUTE_MS), NOW_MS), false);
});

test('no saved chip means the Settings default, even with fresh activity', () => {
  assert.equal(_shouldRestoreSavedDateFilter(null, String(NOW_MS), NOW_MS), false);
  assert.equal(_shouldRestoreSavedDateFilter('', String(NOW_MS), NOW_MS), false);
});
