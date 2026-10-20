const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} }, console, formatCurrency: () => '', document: { addEventListener() {} } };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'bills/modal.js'), 'utf8')}\n`
    + 'module.exports = { _synthesizeStartDate, _bmShouldSendStartDate, _bmEarlierMonthDay, _bmScheduleChanges, _buildBillUpdatePayload };',
  box,
  { filename: 'modal.js' },
);
const m = box.module.exports;

test('twice-monthly synthesis uses the earlier day, independent of today', () => {
  const form = { frequency: 'twice_monthly', start_date: '2026-07-01', day_of_month: 25, second_day_of_month: 10 };
  assert.equal(m._synthesizeStartDate(form), '2026-07-10');
  assert.equal(m._bmEarlierMonthDay(-1, 5), 5);
  assert.equal(m._bmEarlierMonthDay(-1, null), -1);
});

test('monthly synthesis keeps the picked day', () => {
  const form = { frequency: 'monthly', start_date: '2026-07-01', day_of_month: 25 };
  assert.equal(m._synthesizeStartDate(form), '2026-07-25');
});

test('untouched start month is not sent', () => {
  assert.equal(m._bmShouldSendStartDate({
    frequency: 'monthly', storedStart: '2026-07-25', rawFormStart: '2026-07-01',
    synthesizedStart: '2026-07-25', dayFieldsChanged: false,
  }), false);
});

test('twice-monthly with unchanged fields is not sent even if synthesis differs', () => {
  assert.equal(m._bmShouldSendStartDate({
    frequency: 'twice_monthly', storedStart: '2026-07-25', rawFormStart: '2026-07-01',
    synthesizedStart: '2026-07-10', dayFieldsChanged: false,
  }), false);
});

test('changed start month is sent', () => {
  assert.equal(m._bmShouldSendStartDate({
    frequency: 'monthly', storedStart: '2026-07-25', rawFormStart: '2026-09-01',
    synthesizedStart: '2026-09-25', dayFieldsChanged: false,
  }), true);
});

test('changed day with a different synthesized start is sent', () => {
  assert.equal(m._bmShouldSendStartDate({
    frequency: 'monthly', storedStart: '2026-07-25', rawFormStart: '2026-07-01',
    synthesizedStart: '2026-07-10', dayFieldsChanged: true,
  }), true);
});

test('full-date frequencies compare the whole date', () => {
  const base = { frequency: 'weekly', storedStart: '2026-07-14', synthesizedStart: '', dayFieldsChanged: false };
  assert.equal(m._bmShouldSendStartDate({ ...base, rawFormStart: '2026-07-14' }), false);
  assert.equal(m._bmShouldSendStartDate({ ...base, rawFormStart: '2026-07-21' }), true);
});

const storedBill = {
  frequency: 'monthly', interval: 1, start_date: '2026-07-25', second_date: null,
  day_of_month: 25, second_day_of_month: null, day_of_week: null,
  end_type: 'never', end_date: null, max_occurrences: null,
};
const untouchedForm = { ...storedBill, start_date: '2026-07-01', amount: 5 };

test('schedule field changes always carry the synthesized start', () => {
  const form = { ...untouchedForm, day_of_month: 10, interval: 2 };
  const changes = m._bmScheduleChanges(form, storedBill);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)),
    { interval: 2, day_of_month: 10, start_date: '2026-07-10' });
});

test('a change to which dates the bill falls on carries start_date; an untouched form carries nothing', () => {
  const weekly = { ...storedBill, frequency: 'weekly', start_date: '2026-07-14', day_of_week: 1, day_of_month: null };
  const same = { ...weekly };
  assert.deepEqual(JSON.parse(JSON.stringify(m._bmScheduleChanges(same, weekly))), {});
  for (const change of [{ interval: 2 }, { day_of_week: 3 }, { second_date: '2026-07-20' }]) {
    const out = m._bmScheduleChanges({ ...same, ...change }, weekly);
    assert.equal(out.start_date, '2026-07-14', JSON.stringify(change));
  }
});

test('changing only the end conditions keeps the stored start', () => {
  const form = { ...untouchedForm, end_type: 'on_date', end_date: '2027-01-01' };
  const changes = JSON.parse(JSON.stringify(m._bmScheduleChanges(form, storedBill)));
  assert.deepEqual(changes, { end_type: 'on_date', end_date: '2027-01-01' });
});
