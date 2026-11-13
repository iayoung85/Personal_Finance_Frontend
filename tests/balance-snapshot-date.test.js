const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Balance Summary export takes its date from the ledger's end-date
// filter. That filter normally ends after today (future bills), and the
// API refuses a balance for a future date, so the date is capped at today.

const sourcePath = path.join(__dirname, '..', 'transactions', 'export.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const TODAY = '2026-11-12';

function snapshotDateFor(endDateValue) {
  const sandbox = {
    module: { exports: {} },
    document: {
      getElementById: id => (id === 'end-date' ? { value: endDateValue } : null),
    },
    todayISO: () => TODAY,
  };
  vm.runInNewContext(
    `${source}\nmodule.exports = { _getSnapshotDate };`,
    sandbox,
    { filename: sourcePath }
  );
  return sandbox.module.exports._getSnapshotDate();
}

test('a filter ending after today exports the balance as of today', () => {
  assert.equal(snapshotDateFor('2026-12-31'), TODAY);
  assert.equal(snapshotDateFor('2027-01-05'), TODAY);
});

test('a filter ending today or earlier keeps its own end date', () => {
  assert.equal(snapshotDateFor(TODAY), TODAY);
  assert.equal(snapshotDateFor('2026-10-31'), '2026-10-31');
  assert.equal(snapshotDateFor('2025-12-31'), '2025-12-31');
});

test('no end date falls back to the last day of the previous month', () => {
  const now = new Date();
  const lastDayPrev = new Date(new Date(now.getFullYear(), now.getMonth(), 1) - 1);
  const expected = [
    lastDayPrev.getFullYear(),
    String(lastDayPrev.getMonth() + 1).padStart(2, '0'),
    String(lastDayPrev.getDate()).padStart(2, '0'),
  ].join('-');
  assert.equal(snapshotDateFor(''), expected);
});
