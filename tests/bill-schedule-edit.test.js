const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} }, console, formatCurrency: () => '', document: { addEventListener() {} } };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'date-helpers.js'), 'utf8')}\n`
    + `${fs.readFileSync(path.join(__dirname, '..', 'bills/modal.js'), 'utf8')}\n`
    + 'module.exports = { _synthesizeStartDate, _bmShouldSendStartDate, _bmEarlierMonthDay, _bmScheduleChanges, _buildBillUpdatePayload, _bmUpcomingPreviewDates, _bmResolveMonthDay };',
  box,
  { filename: 'modal.js' },
);
const m = box.module.exports;

test('twice-monthly synthesis in a month already past uses the earlier day', () => {
  const form = { frequency: 'twice_monthly', start_date: '2026-07-01', day_of_month: 25, second_day_of_month: 10 };
  assert.equal(m._synthesizeStartDate(form, '2026-10-20'), '2026-07-10');
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

const TODAY = '2026-10-20';
const twiceMonthlyBill = {
  frequency: 'twice_monthly', interval: 1, start_date: '2026-10-15', second_date: null,
  day_of_month: 15, second_day_of_month: -1, day_of_week: null,
  end_type: 'never', end_date: null, max_occurrences: null,
};
const twiceMonthlyForm = { ...twiceMonthlyBill, start_date: '2026-10-01' };

test('last day resolves to the end of its own month', () => {
  assert.equal(m._bmResolveMonthDay(2026, 1, -1).getDate(), 28);
  assert.equal(m._bmResolveMonthDay(2026, 8, -1).getDate(), 30);
  assert.equal(m._bmResolveMonthDay(2026, 8, 31).getDate(), 30);
  assert.equal(m._bmResolveMonthDay(2026, 9, -1).getMonth(), 9);
});

test('twice-monthly synthesis in the current month picks the day still ahead', () => {
  const form = { ...twiceMonthlyForm, day_of_month: 16 };
  assert.equal(m._synthesizeStartDate(form, TODAY), '2026-10-31');
  assert.equal(m._synthesizeStartDate({ ...form, day_of_month: 25 }, TODAY), '2026-10-25');
  assert.equal(m._synthesizeStartDate({ ...form, day_of_month: 1, second_day_of_month: 15 }, TODAY), '2026-10-01');
});

test('moving a 15th-and-last bill to the 16th starts on the 31st, and the preview agrees', () => {
  const form = { ...twiceMonthlyForm, day_of_month: 16 };
  const changes = m._bmScheduleChanges(form, twiceMonthlyBill, TODAY);
  assert.equal(changes.start_date, '2026-10-31');
  assert.deepEqual([...m._bmUpcomingPreviewDates(form, twiceMonthlyBill, TODAY, 5)],
    ['2026-10-31', '2026-11-16', '2026-11-30', '2026-12-16', '2026-12-31']);
});

test('a plain edit previews from today on, not from the stored start', () => {
  const dates = m._bmUpcomingPreviewDates(twiceMonthlyForm, twiceMonthlyBill, TODAY, 3);
  assert.deepEqual([...dates], ['2026-10-31', '2026-11-15', '2026-11-30']);
});

test('dates before today still count toward an occurrence limit', () => {
  const weeklyBill = {
    ...storedBill, frequency: 'weekly', start_date: '2026-10-06', day_of_week: 1, day_of_month: null,
    end_type: 'after_occurrences', max_occurrences: 4,
  };
  const dates = m._bmUpcomingPreviewDates({ ...weeklyBill }, weeklyBill, TODAY, 10);
  assert.deepEqual([...dates], ['2026-10-20', '2026-10-27']);
});
