const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helperPath = path.join(__dirname, '..', 'transactions', 'bank-agreement.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function loadHelper() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(
    `${helperSource}\nmodule.exports = { buildBankAgreementPanelModel, bankAgreementIndicatorState, `
    + 'isBankSuspectRow, bankSuspectChipText, bankSuspectFilterStart };',
    sandbox,
    { filename: helperPath },
  );
  return sandbox.module.exports;
}

const {
  buildBankAgreementPanelModel, bankAgreementIndicatorState,
  isBankSuspectRow, bankSuspectChipText, bankSuspectFilterStart,
} = loadHelper();

// Objects built inside a vm sandbox come from another realm; copy them first.
const plain = value => JSON.parse(JSON.stringify(value));

const showAll = text => text;
const MASK = '$**.**';
const maskAll = () => MASK;
const TODAY = '2026-11-06';

const MISMATCHED_WITH_DATE = {
  account_id: 'acc_1',
  bank_agreement: {
    status: 'mismatched',
    matched_at: null,
    gap: '151.58',
    last_agreed_date: '2026-11-04',
    suspect_row_count: 3,
  },
  days: [
    { date: '2026-11-04', ledger_balance: '2022.12', bank_balance: '2022.12', gap: '0.00', agreed: true },
    { date: '2026-11-05', ledger_balance: '4595.21', bank_balance: '4443.63', gap: '151.58', agreed: false },
  ],
  suspect_rows: [
    { transaction_id: 't1', date: '2026-11-05', description: 'A', amount: '-12.34', source: 'plaid', status: 'cleared' },
    { transaction_id: 't2', date: '2026-11-05', description: 'B', amount: '-1.00', source: 'plaid', status: 'pending' },
  ],
};

const MISMATCHED_NO_DATE = {
  account_id: 'acc_1',
  bank_agreement: {
    status: 'mismatched',
    matched_at: null,
    gap: '-40.00',
    last_agreed_date: null,
    suspect_row_count: null,
  },
  days: [
    { date: '2026-11-05', ledger_balance: '-1200.00', bank_balance: '-1160.00', gap: '-40.00', agreed: false },
    { date: '2025-12-30', ledger_balance: '-900.00', bank_balance: '-850.00', gap: '-50.00', agreed: false },
  ],
  suspect_rows: [],
};

test('mismatched with a date: the date in words, the gap, newest day first, and the highlight day', () => {
  const model = plain(buildBankAgreementPanelModel(MISMATCHED_WITH_DATE, { mask: showAll, todayIso: TODAY }));

  assert.equal(model.state, 'mismatched');
  assert.equal(model.lastAgreedDate, '2026-11-04');
  assert.equal(model.lastAgreedText, 'Nov 4, 2026 (2 days ago)');
  assert.equal(model.gapText, '+$151.58');
  assert.equal(model.suspectText, '3 ledger rows dated after Nov 4, plus 1 pending');
  assert.equal(model.highlightAfterDate, '2026-11-04');
  assert.equal(model.message, '');

  assert.deepEqual(model.days.map(day => day.date), ['2026-11-05', '2026-11-04']);
  assert.deepEqual(model.days[0], {
    date: '2026-11-05',
    dateText: 'Nov 5',
    ledgerText: '$4,595.21',
    bankText: '$4,443.63',
    gapText: '+$151.58',
    agreed: false,
    agreedMark: '',
    agreedNote: '',
  });
  assert.equal(model.days[1].agreed, true);
  assert.equal(model.days[1].agreedMark, '✓');
  assert.equal(model.days[1].gapText, '$0.00');
  assert.equal(model.days[1].agreedNote, '');
});

test('mismatched with no date: says none agreed in the last year and highlights nothing', () => {
  const model = plain(buildBankAgreementPanelModel(MISMATCHED_NO_DATE, { mask: showAll, todayIso: TODAY }));

  assert.equal(model.state, 'mismatched');
  assert.equal(model.lastAgreedDate, null);
  assert.equal(model.lastAgreedText, '');
  assert.equal(model.suspectText, '');
  assert.equal(model.highlightAfterDate, null);
  assert.equal(model.message, 'No day in the last year agreed with the bank.');
  assert.equal(model.gapText, '-$40.00');
  assert.deepEqual(model.days.map(day => day.dateText), ['Nov 5', 'Dec 30, 2025']);
  assert.deepEqual(model.days.map(day => day.ledgerText), ['-$1,200.00', '-$900.00']);
});

test('an agreed day with a non-zero gap keeps its mark and explains it', () => {
  const response = {
    ...MISMATCHED_WITH_DATE,
    days: [
      { date: '2026-11-05', ledger_balance: '4595.21', bank_balance: '4443.63', gap: '151.58', agreed: false },
      { date: '2026-11-04', ledger_balance: '2487.56', bank_balance: '2022.12', gap: '465.44', agreed: true },
    ],
  };
  const model = plain(buildBankAgreementPanelModel(response, { mask: showAll, todayIso: TODAY }));
  const agreedDay = model.days[1];

  assert.equal(agreedDay.agreed, true);
  assert.equal(agreedDay.agreedMark, '✓');
  assert.equal(agreedDay.gapText, '+$465.44');
  assert.equal(agreedDay.agreedNote, 'Agreed with the next day’s ledger figure');
});

test('every money figure in the panel goes through the mask', () => {
  const model = plain(buildBankAgreementPanelModel(MISMATCHED_WITH_DATE, { mask: maskAll, todayIso: TODAY }));

  assert.equal(model.gapText, MASK);
  for (const day of model.days) {
    assert.equal(day.ledgerText, MASK);
    assert.equal(day.bankText, MASK);
    assert.equal(day.gapText, MASK);
  }
  assert.equal(model.lastAgreedText, 'Nov 4, 2026 (2 days ago)');
});

test('yesterday and today read as words', () => {
  const yesterday = {
    ...MISMATCHED_WITH_DATE,
    bank_agreement: { ...MISMATCHED_WITH_DATE.bank_agreement, last_agreed_date: '2026-11-05', suspect_row_count: 1 },
  };
  const model = plain(buildBankAgreementPanelModel(yesterday, { mask: showAll, todayIso: TODAY }));
  assert.equal(model.lastAgreedText, 'Nov 5, 2026 (yesterday)');
  assert.equal(model.suspectText, '1 ledger row dated after Nov 5, plus 1 pending');

  const lastYear = {
    ...MISMATCHED_WITH_DATE,
    bank_agreement: { ...MISMATCHED_WITH_DATE.bank_agreement, last_agreed_date: '2025-12-30' },
  };
  const older = plain(buildBankAgreementPanelModel(lastYear, { mask: showAll, todayIso: TODAY }));
  assert.equal(older.highlightAfterDate, '2025-12-30');
});

test('a detail response that is matched now, or has no bank balance, has nothing to trace', () => {
  const matched = plain(buildBankAgreementPanelModel(
    { bank_agreement: { status: 'matched', matched_at: 'pending', gap: '-151.58', last_agreed_date: null, suspect_row_count: null }, days: [], suspect_rows: [] },
    { mask: showAll, todayIso: TODAY },
  ));
  assert.equal(matched.state, 'matched');
  assert.equal(matched.message, 'The ledger agrees with the bank now, after pending rows.');
  assert.equal(matched.highlightAfterDate, null);

  const unavailable = plain(buildBankAgreementPanelModel(
    { bank_agreement: null, days: [], suspect_rows: [] },
    { mask: showAll, todayIso: TODAY },
  ));
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.highlightAfterDate, null);
  assert.deepEqual(unavailable.days, []);
});

test('suspect rows: dated after the last agreed day and up to today, the future block left out', () => {
  const afterDate = '2026-11-04';
  assert.equal(isBankSuspectRow({ date: '2026-11-05', status: 'cleared' }, afterDate, TODAY), true);
  assert.equal(isBankSuspectRow({ date: '2026-11-06', status: 'pending' }, afterDate, TODAY), true);
  assert.equal(isBankSuspectRow({ date: '2026-11-04', status: 'cleared' }, afterDate, TODAY), false);
  assert.equal(isBankSuspectRow({ date: '2026-10-30', status: 'cleared' }, afterDate, TODAY), false);
  assert.equal(isBankSuspectRow({ date: '2026-11-07', status: 'cleared' }, afterDate, TODAY), false);
  assert.equal(isBankSuspectRow({ date: '2026-11-20', status: 'future' }, afterDate, TODAY), false);
  assert.equal(isBankSuspectRow({ date: '2026-11-05T00:00:00', status: 'cleared' }, afterDate, TODAY), true);
  assert.equal(isBankSuspectRow({ date: '2026-11-05', status: 'cleared' }, null, TODAY), false);
  assert.equal(isBankSuspectRow(null, afterDate, TODAY), false);
});

test('the chip names the day and counts the rows', () => {
  assert.equal(bankSuspectChipText('2026-11-04', 12, TODAY), 'Highlighting 12 rows after Nov 4');
  assert.equal(bankSuspectChipText('2026-11-04', 1, TODAY), 'Highlighting 1 row after Nov 4');
  assert.equal(bankSuspectChipText('2025-12-30', 0, TODAY), 'Highlighting 0 rows after Dec 30, 2025');
});

test('the filter widens to a week before the last agreed day only when it starts later', () => {
  assert.equal(bankSuspectFilterStart('2026-11-04', '2026-11-01'), null);
  assert.equal(bankSuspectFilterStart('2026-11-04', '2026-11-04'), null);
  assert.equal(bankSuspectFilterStart('2026-11-04', '2026-11-05'), '2026-10-28');
  assert.equal(bankSuspectFilterStart('2026-01-03', '2026-02-01'), '2025-12-27');
  assert.equal(bankSuspectFilterStart('2026-11-04', ''), '2026-10-28');
  assert.equal(bankSuspectFilterStart('not-a-date', '2026-11-05'), null);
});

test('indicator: hidden when the API sent no bank_agreement', () => {
  const state = plain(bankAgreementIndicatorState(
    { current_balance: 100, plaid_balance: 100, bank_agreement: null },
    showAll,
  ));
  assert.equal(state.visible, false);
  assert.equal(state.mismatched, false);
  assert.equal(plain(bankAgreementIndicatorState(null, showAll)).visible, false);
});

test('indicator: matched follows the API even when the two balances differ', () => {
  const account = {
    current_balance: 4595.21,
    plaid_balance: 4443.63,
    bank_agreement: { status: 'matched', matched_at: 'pending', gap: '151.58', last_agreed_date: null, suspect_row_count: null },
  };
  const state = plain(bankAgreementIndicatorState(account, showAll));
  assert.equal(state.visible, true);
  assert.equal(state.mismatched, false);
  assert.equal(state.text, 'Plaid: $4,443.63');
  assert.equal(state.title, 'Plaid balance matches app balance (after pending rows)');
  assert.equal(state.dotTitle, '');

  account.bank_agreement = { ...account.bank_agreement, matched_at: 'cleared' };
  assert.equal(plain(bankAgreementIndicatorState(account, showAll)).title, 'Plaid balance matches app balance');
});

test('indicator: mismatched uses the API gap for the difference', () => {
  const account = {
    current_balance: 1000,
    plaid_balance: 1000.5,
    bank_agreement: { status: 'mismatched', matched_at: null, gap: '-40.00', last_agreed_date: '2026-11-04', suspect_row_count: 2 },
  };
  const state = plain(bankAgreementIndicatorState(account, showAll));
  assert.equal(state.visible, true);
  assert.equal(state.mismatched, true);
  assert.equal(state.title, 'Plaid reports $1,000.50 but app calculates $1000.00 (difference: $40.00)');
  assert.equal(state.dotTitle, 'Plaid balance mismatch: $40.00 difference');

  const masked = plain(bankAgreementIndicatorState(account, maskAll));
  assert.equal(masked.text, `Plaid: ${MASK}`);
  assert.equal(masked.title, `Plaid reports ${MASK} but app calculates ${MASK} (difference: ${MASK})`);
});

test('indicator: an investment account keeps its dot but has no history to open', () => {
  const account = {
    account_id: 'acc_inv', connection_status: 'linked', account_category: 'investment',
    current_balance: '10000.00', plaid_balance: '10250.00',
    bank_agreement: {
      status: 'mismatched', matched_at: null, gap: '-250.00', has_history: false,
      last_agreed_date: null, suspect_row_count: null,
    },
  };
  const state = plain(bankAgreementIndicatorState(account, showAll));
  assert.equal(state.visible, true);
  assert.equal(state.mismatched, true);
  assert.equal(state.hasHistory, false);
  assert.match(state.dotTitle, /holdings may need a sync/);

  const banking = plain(bankAgreementIndicatorState({
    ...account, account_category: 'depository',
    bank_agreement: { ...account.bank_agreement, has_history: true },
  }, showAll));
  assert.equal(banking.hasHistory, true);
  assert.doesNotMatch(banking.dotTitle, /holdings/);
});
