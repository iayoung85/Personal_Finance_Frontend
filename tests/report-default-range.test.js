const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'transactions', 'reports.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadHelpers() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(
    `${source}\nmodule.exports = { _balanceDefaultMonths, _categoryDefaultFiscalYears, _categoryReportRange, _formatDateInput };`,
    sandbox,
    { filename: sourcePath }
  );
  return sandbox.module.exports;
}

const {
  _balanceDefaultMonths,
  _categoryDefaultFiscalYears,
  _categoryReportRange,
  _formatDateInput,
} = loadHelpers();

const NOVEMBER = 11;

function balance(year, month, day, fiscalMonth) {
  const months = _balanceDefaultMonths(new Date(year, month - 1, day), fiscalMonth);
  return `${months.startMonth}..${months.endMonth}`;
}

function fiscalYears(year, month, day, fiscalMonth) {
  const years = _categoryDefaultFiscalYears(new Date(year, month - 1, day), fiscalMonth);
  return `${years.startFY}..${years.endFY}`;
}

function categoryRange(startFY, endFY, fiscalMonth, now) {
  const range = _categoryReportRange(startFY, endFY, fiscalMonth, now);
  return `${_formatDateInput(range.startDate)}..${_formatDateInput(range.endDate)}`;
}

test('balances keep the prior fiscal year through the first month of a new one', () => {
  assert.equal(balance(2026, 10, 1, NOVEMBER), '2024-11..2026-10');
  assert.equal(balance(2026, 11, 11, NOVEMBER), '2024-11..2026-11');
  assert.equal(balance(2026, 11, 30, NOVEMBER), '2024-11..2026-11');
});

test('balances drop the oldest year one month after the fiscal year starts', () => {
  assert.equal(balance(2026, 12, 1, NOVEMBER), '2025-11..2026-12');
  assert.equal(balance(2027, 1, 15, NOVEMBER), '2025-11..2027-01');
  assert.equal(balance(2027, 11, 1, NOVEMBER), '2025-11..2027-11');
  assert.equal(balance(2027, 12, 1, NOVEMBER), '2026-11..2027-12');
});

test('a calendar fiscal year jumps in February', () => {
  assert.equal(balance(2027, 1, 20, 1), '2025-01..2027-01');
  assert.equal(balance(2027, 2, 1, 1), '2026-01..2027-02');
  assert.equal(fiscalYears(2027, 1, 20, 1), '2025..2027');
  assert.equal(fiscalYears(2027, 2, 1, 1), '2026..2027');
});

test('category years jump on the same day as balances', () => {
  assert.equal(fiscalYears(2026, 10, 1, NOVEMBER), '2025..2026');
  assert.equal(fiscalYears(2026, 11, 11, NOVEMBER), '2025..2027');
  assert.equal(fiscalYears(2026, 12, 1, NOVEMBER), '2026..2027');
  assert.equal(fiscalYears(2027, 1, 15, NOVEMBER), '2026..2027');
});

test('the default category range covers the same months as the balance range', () => {
  const cases = [[2026, 10, 1], [2026, 11, 11], [2026, 12, 1], [2027, 3, 9]];
  for (const [year, month, day] of cases) {
    const now = new Date(year, month - 1, day);
    const years = _categoryDefaultFiscalYears(now, NOVEMBER);
    const range = _categoryReportRange(years.startFY, years.endFY, NOVEMBER, now);
    const months = _balanceDefaultMonths(now, NOVEMBER);
    assert.equal(_formatDateInput(range.startDate).slice(0, 7), months.startMonth);
    assert.equal(_formatDateInput(range.endDate).slice(0, 7), months.endMonth);
  }
});

test('a category range never runs past the current month', () => {
  const now = new Date(2026, 10, 11);
  assert.equal(categoryRange(2025, 2027, NOVEMBER, now), '2024-11-01..2026-11-30');
  assert.equal(_categoryReportRange(2025, 2027, NOVEMBER, now).endsEarly, true);
});

test('a finished fiscal year keeps its own end', () => {
  const now = new Date(2026, 10, 11);
  assert.equal(categoryRange(2025, 2026, NOVEMBER, now), '2024-11-01..2026-10-31');
  assert.equal(_categoryReportRange(2025, 2026, NOVEMBER, now).endsEarly, false);
});

test('a range that has not started yet has no dates', () => {
  assert.equal(_categoryReportRange(2028, 2028, NOVEMBER, new Date(2026, 10, 11)), null);
});
