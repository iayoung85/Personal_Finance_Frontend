const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dateHelpersPath = path.join(__dirname, '..', 'date-helpers.js');
const dateHelpersSource = fs.readFileSync(dateHelpersPath, 'utf8');
const sandbox = {
  module: { exports: {} },
  console,
  document: { addEventListener() {} },
};

vm.runInNewContext(
  `${dateHelpersSource}\nmodule.exports = { trailingYearStartDate, trailingYearLabel, toISODateStr };`,
  sandbox,
  { filename: dateHelpersPath },
);

const { trailingYearStartDate, trailingYearLabel, toISODateStr } = sandbox.module.exports;

function startFor(year, month, day) {
  return toISODateStr(trailingYearStartDate(new Date(year, month - 1, day)));
}

function labelFor(year, month, day) {
  return trailingYearLabel(new Date(year, month - 1, day));
}

test('window starts the day after today one year back', () => {
  assert.equal(startFor(2026, 10, 20), '2025-10-21');
  assert.equal(labelFor(2026, 10, 20), 'Last 365 Days');
});

test('window rolls across a year boundary', () => {
  assert.equal(startFor(2026, 12, 31), '2026-01-01');
  assert.equal(labelFor(2026, 12, 31), 'Last 365 Days');
});

test('a leap day in the range widens the window to 366 days', () => {
  assert.equal(startFor(2028, 10, 20), '2027-10-21');
  assert.equal(labelFor(2028, 10, 20), 'Last 366 Days');
  assert.equal(startFor(2028, 3, 1), '2027-03-02');
  assert.equal(labelFor(2028, 3, 1), 'Last 366 Days');
});

test('the leap day leaving the range drops back to 365 days', () => {
  assert.equal(startFor(2029, 2, 28), '2028-02-29');
  assert.equal(labelFor(2029, 2, 28), 'Last 366 Days');
  assert.equal(startFor(2029, 3, 1), '2028-03-02');
  assert.equal(labelFor(2029, 3, 1), 'Last 365 Days');
});

test('on Feb 29 the prior Feb 28 stands in for the missing date', () => {
  assert.equal(startFor(2028, 2, 29), '2027-03-01');
  assert.equal(labelFor(2028, 2, 29), 'Last 366 Days');
});
