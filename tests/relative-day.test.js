const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dateHelpersPath = path.join(__dirname, '..', 'date-helpers.js');
const sandbox = {
  module: { exports: {} },
  console,
  document: { addEventListener() {} },
  getAppConfig: () => ({ dateFormat: 'YYYY-MM-DD' }),
};

vm.runInNewContext(
  `${fs.readFileSync(dateHelpersPath, 'utf8')}\nmodule.exports = { parseApiTimestamp, formatRelativeDay };`,
  sandbox,
  { filename: dateHelpersPath },
);

const { parseApiTimestamp, formatRelativeDay } = sandbox.module.exports;

test('a zoneless API timestamp is read as UTC', () => {
  const moment = parseApiTimestamp('2026-11-23T04:19:30.787241');
  assert.equal(moment.toISOString(), '2026-11-23T04:19:30.787Z');
});

test('a timestamp that carries a zone is read as written', () => {
  assert.equal(parseApiTimestamp('2026-11-23T04:19:30Z').toISOString(), '2026-11-23T04:19:30.000Z');
  assert.equal(parseApiTimestamp('2026-11-22T22:19:30-06:00').toISOString(), '2026-11-23T04:19:30.000Z');
});

test('an empty or unreadable timestamp is null', () => {
  assert.equal(parseApiTimestamp(null), null);
  assert.equal(parseApiTimestamp(''), null);
  assert.equal(parseApiTimestamp('not a date'), null);
});

test('a moment a minute ago is never a negative number of days', () => {
  const now = new Date();
  const justSent = parseApiTimestamp(new Date(now.getTime() - 60 * 1000).toISOString().replace('Z', ''));
  const label = formatRelativeDay(justSent, now);
  assert.ok(label === 'Today' || label === 'Yesterday', label);
});

test('days are counted by midnights crossed', () => {
  const morning = new Date(2026, 10, 22, 8, 0);
  assert.equal(formatRelativeDay(new Date(2026, 10, 22, 0, 5), morning), 'Today');
  assert.equal(formatRelativeDay(new Date(2026, 10, 21, 22, 0), morning), 'Yesterday');
  assert.equal(formatRelativeDay(new Date(2026, 10, 19, 23, 59), morning), '3 days ago');
  assert.equal(formatRelativeDay(new Date(2026, 10, 8, 12, 0), morning), '2w ago');
  assert.equal(formatRelativeDay(new Date(2026, 9, 1, 12, 0), morning), '2026-10-01');
});

test('a moment later than now reads Today', () => {
  const now = new Date(2026, 10, 22, 22, 0);
  assert.equal(formatRelativeDay(new Date(2026, 10, 23, 4, 0), now), 'Today');
});
