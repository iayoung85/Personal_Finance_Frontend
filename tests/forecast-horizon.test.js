const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filtersPath = path.join(__dirname, '..', 'transactions', 'filters.js');
const filtersSource = fs.readFileSync(filtersPath, 'utf8');
const sandbox = {
  module: { exports: {} },
  console,
  TXN_TYPE: {
    BILL_FUTURE: 'BILL_FUTURE',
    MANUAL_FUTURE: 'MANUAL_FUTURE',
  },
};

vm.runInNewContext(
  `${filtersSource}\nmodule.exports = { _parseForecastHorizonDays, _isFutureTxnPastForecastHorizon };`,
  sandbox,
  { filename: filtersPath },
);

const { _parseForecastHorizonDays, _isFutureTxnPastForecastHorizon } = sandbox.module.exports;

test('forecast horizon parser preserves zero days', () => {
  assert.equal(_parseForecastHorizonDays('0'), 0);
});

test('forecast horizon parser clamps invalid and out-of-range values', () => {
  assert.equal(_parseForecastHorizonDays(''), 90);
  assert.equal(_parseForecastHorizonDays('-5'), 0);
  assert.equal(_parseForecastHorizonDays('999'), 365);
});

test('zero-day horizon excludes future manual and bill rows after today', () => {
  assert.equal(
    _isFutureTxnPastForecastHorizon(
      { date: '2026-05-15' },
      'MANUAL_FUTURE',
      '2026-05-14',
      '2026-05-14',
    ),
    true,
  );
  assert.equal(
    _isFutureTxnPastForecastHorizon(
      { date: '2026-05-15' },
      'BILL_FUTURE',
      '2026-05-14',
      '2026-05-14',
    ),
    true,
  );
});

test('one-day horizon includes tomorrow but excludes later manual future rows', () => {
  assert.equal(
    _isFutureTxnPastForecastHorizon(
      { date: '2026-05-15' },
      'MANUAL_FUTURE',
      '2026-05-14',
      '2026-05-15',
    ),
    false,
  );
  assert.equal(
    _isFutureTxnPastForecastHorizon(
      { date: '2026-06-14' },
      'MANUAL_FUTURE',
      '2026-05-14',
      '2026-05-15',
    ),
    true,
  );
});

test('forecast horizon does not cap posted transaction types', () => {
  assert.equal(
    _isFutureTxnPastForecastHorizon(
      { date: '2026-06-14' },
      'PLAID_CLEARED',
      '2026-05-14',
      '2026-05-15',
    ),
    false,
  );
});