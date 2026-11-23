const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dateHelpersPath = path.join(__dirname, '..', 'date-helpers.js');
const dateHelpersSource = fs.readFileSync(dateHelpersPath, 'utf8');

/** Load the date helpers with the display format the user has chosen. */
function loadWithFormat(dateFormat) {
  const sandbox = {
    module: { exports: {} },
    console,
    document: { addEventListener() {} },
    localStorage: { getItem() { return null; } },
  };
  vm.runInNewContext(
    `${dateHelpersSource}\n`
      + `_getDateFormatPreference = () => ${JSON.stringify(dateFormat)};\n`
      + 'module.exports = { formatDateWithoutYear, transferDateRangeLabels };',
    sandbox,
    { filename: dateHelpersPath },
  );
  return sandbox.module.exports;
}

test('a same-year transfer drops the year from the later date', () => {
  const { transferDateRangeLabels } = loadWithFormat('YYYY-MM-DD');
  const labels = transferDateRangeLabels('2025-06-11', '2025-07-11');
  assert.equal(labels.sentLabel, '2025-06-11');
  assert.equal(labels.receivedLabel, '07-11');
  assert.equal(labels.receivedFullLabel, '2025-07-11');
});

test('the earlier date leads whichever side the row is', () => {
  const { transferDateRangeLabels } = loadWithFormat('YYYY-MM-DD');
  const labels = transferDateRangeLabels('2025-07-11', '2025-06-11');
  assert.equal(labels.sentLabel, '2025-06-11');
  assert.equal(labels.receivedLabel, '07-11');
});

test('a transfer across a year change keeps the year on both dates', () => {
  const { transferDateRangeLabels } = loadWithFormat('YYYY-MM-DD');
  const labels = transferDateRangeLabels('2024-12-11', '2025-01-13');
  assert.equal(labels.sentLabel, '2024-12-11');
  assert.equal(labels.receivedLabel, '2025-01-13');
  assert.equal(labels.receivedFullLabel, '2025-01-13');
});

test('the year-less date follows the chosen display format', () => {
  assert.equal(loadWithFormat('YYYY-MM-DD').formatDateWithoutYear('2025-07-04'), '07-04');
  assert.equal(loadWithFormat('MM/DD/YYYY').formatDateWithoutYear('2025-07-04'), '07/04');
  assert.equal(loadWithFormat('DD/MM/YYYY').formatDateWithoutYear('2025-07-04'), '04/07');
  assert.equal(loadWithFormat('MMM D, YYYY').formatDateWithoutYear('2025-07-04'), 'Jul 4');
});

test('an empty date reads as a dash', () => {
  assert.equal(loadWithFormat('YYYY-MM-DD').formatDateWithoutYear(''), '—');
});
