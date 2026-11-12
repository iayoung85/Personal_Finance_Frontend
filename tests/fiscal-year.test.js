const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'shared', 'fiscal-year.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadHelpers(appConfig = {}) {
  const sandbox = { module: { exports: {} }, getAppConfig: () => appConfig };
  vm.runInNewContext(
    `${source}\nmodule.exports = { normalizeFiscalStartMonth, getFiscalStartMonth, `
      + 'hasDistinctFiscalYear, currentFiscalYearRange, lastFiscalYearRange, '
      + 'formatFiscalRangeShort, describeFiscalYear };',
    sandbox,
    { filename: sourcePath },
  );
  return sandbox.module.exports;
}

const {
  normalizeFiscalStartMonth,
  hasDistinctFiscalYear,
  currentFiscalYearRange,
  lastFiscalYearRange,
  formatFiscalRangeShort,
  describeFiscalYear,
} = loadHelpers();

const NOVEMBER = 11;

function iso(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function describeRange(range) {
  return `FY${range.fiscalYear} ${iso(range.start)}..${iso(range.end)}`;
}

function current(year, month, day, fiscalMonth) {
  return describeRange(currentFiscalYearRange(new Date(year, month - 1, day), fiscalMonth));
}

function last(year, month, day, fiscalMonth) {
  return describeRange(lastFiscalYearRange(new Date(year, month - 1, day), fiscalMonth));
}

test('a missing or damaged setting means January', () => {
  for (const bad of [undefined, null, '', 'abc', 0, 13, 2.5, -3]) {
    assert.equal(normalizeFiscalStartMonth(bad), 1);
  }
  assert.equal(normalizeFiscalStartMonth(11), 11);
  assert.equal(normalizeFiscalStartMonth('11'), 11);
  assert.equal(loadHelpers({}).getFiscalStartMonth(), 1);
  assert.equal(loadHelpers({ fiscalYearStartMonth: 11 }).getFiscalStartMonth(), 11);
});

test('only a non-January start makes the fiscal year distinct', () => {
  assert.equal(hasDistinctFiscalYear(1), false);
  assert.equal(hasDistinctFiscalYear(undefined), false);
  for (let month = 2; month <= 12; month++) {
    assert.equal(hasDistinctFiscalYear(month), true);
  }
});

test('a November fiscal year turns over on November 1', () => {
  assert.equal(current(2026, 10, 31, NOVEMBER), 'FY2026 2025-11-01..2026-10-31');
  assert.equal(current(2026, 11, 1, NOVEMBER), 'FY2027 2026-11-01..2027-10-31');
  assert.equal(current(2026, 11, 12, NOVEMBER), 'FY2027 2026-11-01..2027-10-31');
  assert.equal(current(2027, 1, 15, NOVEMBER), 'FY2027 2026-11-01..2027-10-31');
});

test('the last fiscal year is the one that just finished', () => {
  assert.equal(last(2026, 10, 31, NOVEMBER), 'FY2025 2024-11-01..2025-10-31');
  assert.equal(last(2026, 11, 1, NOVEMBER), 'FY2026 2025-11-01..2026-10-31');
  assert.equal(last(2027, 6, 30, NOVEMBER), 'FY2026 2025-11-01..2026-10-31');
});

test('a January start gives calendar years', () => {
  assert.equal(current(2026, 11, 12, 1), 'FY2026 2026-01-01..2026-12-31');
  assert.equal(last(2026, 11, 12, 1), 'FY2025 2025-01-01..2025-12-31');
  assert.equal(current(2026, 1, 1, 1), 'FY2026 2026-01-01..2026-12-31');
});

test('a March start ends on the real last day of February', () => {
  assert.equal(current(2027, 3, 1, 3), 'FY2028 2027-03-01..2028-02-29');
  assert.equal(last(2027, 3, 1, 3), 'FY2027 2026-03-01..2027-02-28');
});

test('every start month gives back-to-back years that cover the date', () => {
  const now = new Date(2026, 6, 15);
  for (let month = 1; month <= 12; month++) {
    const currentRange = currentFiscalYearRange(now, month);
    const lastRange = lastFiscalYearRange(now, month);
    assert.ok(currentRange.start <= now && now <= currentRange.end, `month ${month} covers today`);
    assert.equal(currentRange.start.getDate(), 1);
    const dayAfterLast = new Date(lastRange.end);
    dayAfterLast.setDate(dayAfterLast.getDate() + 1);
    assert.equal(iso(dayAfterLast), iso(currentRange.start), `month ${month} years are adjacent`);
  }
});

test('the Settings text states the exact dates of the fiscal year', () => {
  assert.equal(
    describeFiscalYear(NOVEMBER, new Date(2026, 10, 12)),
    'Your fiscal year runs from November 1 through October 31. '
      + 'The current one (FY2027) is November 1, 2026 through October 31, 2027. '
      + 'The last one (FY2026) was November 1, 2025 through October 31, 2026.',
  );
  assert.equal(
    describeFiscalYear(1, new Date(2026, 10, 12)),
    'Your fiscal year is the calendar year, January 1 through December 31. '
      + 'The current one (FY2026) is January 1, 2026 through December 31, 2026. '
      + 'The last one (FY2025) was January 1, 2025 through December 31, 2025.',
  );
  assert.match(
    describeFiscalYear(3, new Date(2027, 2, 1)),
    /^Your fiscal year runs from March 1 through the last day of February\. The current one \(FY2028\) is March 1, 2027 through February 29, 2028\./,
  );
});

test('the chip tooltip gives a short range', () => {
  const range = currentFiscalYearRange(new Date(2026, 10, 12), NOVEMBER);
  assert.equal(formatFiscalRangeShort(range), 'Nov 1, 2026 – Oct 31, 2027');
});
