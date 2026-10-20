const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} }, console, formatCurrency: () => '', document: { addEventListener() {} } };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'bills/modal.js'), 'utf8')}\n`
    + 'module.exports = { _synthesizeStartDate, _bmShouldSendStartDate, _bmIsLatestPreview, _bmSkippedNoteText, _bmBuildPreviewRequest, _bmEarlierMonthDay };',
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

test('only the latest preview request may render', () => {
  assert.equal(m._bmIsLatestPreview(3, 3), true);
  assert.equal(m._bmIsLatestPreview(2, 3), false);
});

test('skipped note text', () => {
  assert.equal(m._bmSkippedNoteText([]), '');
  assert.equal(m._bmSkippedNoteText(['2026-10-25']), 'Oct 25 skipped — a payment for that period is already on the books.');
  assert.equal(m._bmSkippedNoteText(['2026-10-25', '2026-11-25']), 'Oct 25, Nov 25 skipped — payments for those periods are already on the books.');
});

test('preview request carries bill_id only when editing', () => {
  const form = { frequency: 'monthly', interval: 1, start_date: '2026-07-01', day_of_month: 25, amount: 5 };
  assert.equal('bill_id' in m._bmBuildPreviewRequest(form, null), false);
  assert.equal(m._bmBuildPreviewRequest(form, 7).bill_id, 7);
  assert.equal(m._bmBuildPreviewRequest(form, 7).count, 10);
});
