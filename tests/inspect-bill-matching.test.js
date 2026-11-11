const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relPaths, exportsList, sandboxGlobals = {}) {
  const source = relPaths
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...sandboxGlobals };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return { api: sandbox.module.exports, sandbox };
}

// Values built inside a vm sandbox come from another realm.
const plain = value => JSON.parse(JSON.stringify(value));

const { api } = load(
  ['transactions/inspect-bill-matching.js'],
  'buildBillMatchingView, inspectBillMatchingFetchKind',
);

const ACCOUNT_NAMES = { acc_chk: 'Chase - Checking (1234)', acc_sav: 'Ally - Savings (9876)' };
const describeAccount = accountId => ACCOUNT_NAMES[accountId] || accountId;

function build(payload, options = {}) {
  return plain(api.buildBillMatchingView(payload, { describeAccount, ...options }));
}

const lineFor = (view, criterion) => view.lines.find(line => line.criterion === criterion);

const studentLoanFields = {
  plaid_name: 'To DEPT EDUCATION',
  merchant_name: 'US Department of Education',
  pfc_detailed: 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
  amount: -234.64,
  date: '2026-11-11',
  day_of_month: 11,
  account_id: 'acc_chk',
};

function criteria(extra = {}) {
  return {
    amount_mode: 'exact',
    amount_min: null,
    amount_max: null,
    date_tolerance_days: 3,
    plaid_name_patterns: [],
    merchant_name_patterns: [],
    pfc_detailed_categories: [],
    day_of_month_set: [],
    sign_enforced: true,
    transfer_account_id: null,
    ...extra,
  };
}

function bill(extra = {}, criteriaExtra = {}) {
  return {
    bill_id: 'bill_loan',
    description: 'Student loan',
    bill_row_transaction_id: 'txn_bill',
    account_id: 'acc_chk',
    amount: -234.64,
    occurrence_date: '2026-11-11',
    transfer_receiving_side: false,
    criteria: criteria(criteriaExtra),
    ...extra,
  };
}

function judged(verdicts, extra = {}) {
  return {
    status: 'judged',
    bank_transaction_id: 'txn_plaid',
    fields: studentLoanFields,
    bill: bill(),
    passes: verdicts.every(verdict => verdict.passed),
    verdicts,
    ...extra,
  };
}

const pass = (criterion, reason) => ({ criterion, passed: true, reason });
const fail = (criterion, reason) => ({ criterion, passed: false, reason });

// ── judged ─────────────────────────────────────────────────────

test('the 11-11 case: only the Plaid name fails, and the hint names the row value and the field', () => {
  const payload = judged(
    [
      pass('account', 'account_ok'),
      pass('sign', 'sign_ok'),
      pass('amount', 'amount_exact_ok'),
      pass('date_window', 'date_window_ok'),
      fail('plaid_name', 'plaid_name_no_match'),
    ],
    { bill: bill({}, { plaid_name_patterns: ['US Department of Education'] }) },
  );
  const view = build(payload, { inspectedTransactionId: 'txn_plaid' });

  assert.equal(view.status, 'judged');
  assert.equal(view.tone, 'fail');
  assert.equal(view.headline, 'Fails 1 criterion');
  assert.equal(view.subline, 'Bill: Student loan · Nov 11, 2026');
  assert.deepEqual(view.actions, ['edit-bill']);
  assert.equal(view.billId, 'bill_loan');
  assert.match(view.footnote, /^Checks the bill's criteria as the bill stands now\./);
  assert.deepEqual(view.columns, { row: true, bill: true, verdict: true });
  assert.deepEqual(view.notes, []);

  assert.deepEqual(view.lines.map(line => line.label), [
    'Account', 'Direction', 'Amount', 'Date window', 'Day of month',
    'Plaid name patterns', 'Merchant name patterns', 'PFC categories',
  ]);
  assert.deepEqual(view.lines.map(line => line.verdictLabel), [
    'Pass', 'Pass', 'Pass', 'Pass', 'Not set', 'Fail', 'Not set', 'Not set',
  ]);

  const name = lineFor(view, 'plaid_name');
  assert.equal(name.rowValue, 'To DEPT EDUCATION');
  assert.equal(name.copyValue, 'To DEPT EDUCATION');
  assert.equal(name.billSetting, 'US Department of Education');
  assert.equal(name.hint, 'Plaid\'s name is “To DEPT EDUCATION”. Add part of it to Plaid name patterns.');

  assert.equal(lineFor(view, 'account').rowValue, 'Chase - Checking (1234)');
  assert.equal(lineFor(view, 'account').copyValue, 'acc_chk');
  assert.equal(lineFor(view, 'sign').rowValue, 'Money out');
  assert.equal(lineFor(view, 'sign').copyValue, null);
  assert.equal(lineFor(view, 'sign').billSetting, 'Money out');
  assert.equal(lineFor(view, 'amount').rowValue, '−$234.64');
  assert.equal(lineFor(view, 'amount').copyValue, '-234.64');
  assert.equal(lineFor(view, 'amount').billSetting, '−$234.64');
  assert.equal(lineFor(view, 'date_window').rowValue, 'Nov 11, 2026');
  assert.equal(lineFor(view, 'date_window').copyValue, '2026-11-11');
  assert.equal(lineFor(view, 'date_window').billSetting, 'Nov 11, 2026 ± 3 days');
  assert.equal(lineFor(view, 'day_of_month').rowValue, '11th');
  assert.equal(lineFor(view, 'day_of_month').billSetting, null);
  assert.equal(lineFor(view, 'merchant_name').rowValue, 'US Department of Education');
  assert.equal(lineFor(view, 'pfc').rowValue, 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT');
  view.lines
    .filter(line => line.criterion !== 'plaid_name')
    .forEach(line => assert.equal(line.hint, null, line.criterion));
});

test('a judged pass meets every criterion', () => {
  const view = build(judged([
    pass('account', 'account_ok'),
    pass('sign', 'sign_ok'),
    pass('amount', 'amount_exact_ok'),
    pass('date_window', 'date_window_ok'),
  ]));
  assert.equal(view.tone, 'pass');
  assert.equal(view.headline, 'Meets every criterion');
});

test('the headline follows the API, not a count the client makes', () => {
  const payload = judged([pass('account', 'account_ok')]);
  payload.passes = false;
  const view = build(payload);
  assert.equal(view.tone, 'fail');
  assert.equal(view.headline, 'Fails 0 criteria');
});

test('failing merchant and PFC lines say what to add where', () => {
  const payload = judged(
    [
      pass('account', 'account_ok'),
      fail('merchant_name', 'merchant_no_match'),
      fail('pfc', 'pfc_no_match(LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT)'),
    ],
    { bill: bill({}, { merchant_name_patterns: ['Navient'], pfc_detailed_categories: ['LOAN_PAYMENTS_OTHER'] }) },
  );
  const view = build(payload);
  assert.equal(view.headline, 'Fails 2 criteria');
  assert.equal(lineFor(view, 'merchant_name').hint,
    'Plaid\'s merchant name is “US Department of Education”. Add part of it to Merchant name patterns.');
  assert.equal(lineFor(view, 'pfc').hint,
    'Plaid\'s category is LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT. Add it to PFC categories.');
});

test('a failing text line with no row value says no pattern can match', () => {
  const payload = judged(
    [pass('account', 'account_ok'), fail('merchant_name', 'merchant_no_match')],
    {
      fields: { ...studentLoanFields, merchant_name: null },
      bill: bill({}, { merchant_name_patterns: ['Navient'] }),
    },
  );
  const merchant = lineFor(build(payload), 'merchant_name');
  assert.equal(merchant.rowValue, null);
  assert.equal(merchant.copyValue, null);
  assert.equal(merchant.hint, 'Plaid sent no merchant name for this row, so no Merchant name pattern can match it.');
});

test('other failures are worded from the gate reason', () => {
  const payload = judged(
    [
      pass('account', 'account_ok'),
      fail('sign', 'sign_mismatch'),
      fail('amount', 'amount_exact_fail(-86.00 != -234.64)'),
      fail('date_window', 'date_outside_window(5d)'),
      fail('day_of_month', 'day_of_month_fail(11)'),
    ],
    { bill: bill({}, { day_of_month_set: [1, 15] }) },
  );
  const view = build(payload);
  assert.equal(lineFor(view, 'sign').hint, 'The row\'s money moves the other way from the bill\'s.');
  assert.equal(lineFor(view, 'amount').hint, 'The amount must match the bill exactly.');
  assert.equal(lineFor(view, 'date_window').hint, '5 days from the bill date, outside the window.');
  assert.equal(lineFor(view, 'day_of_month').hint, 'Not one of the bill\'s days.');
  assert.equal(lineFor(view, 'day_of_month').billSetting, '1st or 15th');
});

test('a range bill shows its band and words a miss as below or above', () => {
  const below = build(judged(
    [pass('account', 'account_ok'), fail('amount', 'amount_below_min(70.00)')],
    { bill: bill({}, { amount_mode: 'range', amount_min: 80, amount_max: 90, date_tolerance_days: 0 }) },
  ));
  assert.equal(lineFor(below, 'amount').billSetting, '$80.00 – $90.00');
  assert.equal(lineFor(below, 'amount').hint, 'Below the bill\'s range.');
  assert.equal(lineFor(below, 'date_window').billSetting, 'Nov 11, 2026, exactly');

  const above = build(judged(
    [pass('account', 'account_ok'), fail('amount', 'amount_above_max(1200.00)')],
    { bill: bill({}, { amount_mode: 'range', amount_min: null, amount_max: 1000 }) },
  ));
  assert.equal(lineFor(above, 'amount').billSetting, 'Up to $1,000.00');
  assert.equal(lineFor(above, 'amount').hint, 'Above the bill\'s range.');
});

// ── The three meanings of no verdict ───────────────────────────

test('no verdict on a criterion the bill leaves empty reads as not set', () => {
  const view = build(judged(
    [pass('account', 'account_ok'), pass('amount', 'amount_exact_ok')],
    { bill: bill({}, { sign_enforced: false, date_tolerance_days: null }) },
  ));
  ['sign', 'date_window', 'day_of_month', 'plaid_name', 'merchant_name', 'pfc'].forEach(criterion => {
    const line = lineFor(view, criterion);
    assert.equal(line.verdict, 'not_set', criterion);
    assert.equal(line.verdictLabel, 'Not set', criterion);
    assert.equal(line.billSetting, null, criterion);
    assert.equal(line.hint, null, criterion);
  });
});

test('no verdict after a failed account check reads as not judged, wrong account', () => {
  const view = build(judged(
    [fail('account', 'account_fail(acc_sav != acc_chk)')],
    {
      fields: { ...studentLoanFields, account_id: 'acc_sav' },
      bill: bill({}, { plaid_name_patterns: ['DEPT EDUCATION'] }),
    },
  ));
  const account = lineFor(view, 'account');
  assert.equal(account.verdict, 'fail');
  assert.equal(account.rowValue, 'Ally - Savings (9876)');
  assert.equal(account.hint, 'The row is in a different account from the bill.');

  ['sign', 'amount', 'date_window', 'plaid_name'].forEach(criterion => {
    const line = lineFor(view, criterion);
    assert.equal(line.verdict, 'not_judged', criterion);
    assert.equal(line.verdictLabel, 'Not judged', criterion);
    assert.equal(line.hint, 'Not checked, because the row is in another account.', criterion);
  });
  // A criterion the bill leaves empty stays not set even after the account fails.
  assert.equal(lineFor(view, 'merchant_name').verdict, 'not_set');
});

test('no verdict on the receiving side of a transfer reads as not judged, transfer side', () => {
  const view = build(judged(
    [
      pass('account', 'account_ok'),
      pass('sign', 'sign_ok'),
      pass('amount', 'amount_exact_ok'),
      pass('date_window', 'date_window_ok'),
    ],
    {
      bill: bill(
        { transfer_receiving_side: true },
        { plaid_name_patterns: ['TRANSFER'], day_of_month_set: [1], transfer_account_id: 'acc_sav' },
      ),
    },
  ));
  assert.equal(view.headline, 'Meets every criterion');
  assert.deepEqual(view.notes, ['Judged as the receiving side of a transfer bill.']);
  ['day_of_month', 'plaid_name'].forEach(criterion => {
    const line = lineFor(view, criterion);
    assert.equal(line.verdict, 'not_judged', criterion);
    assert.equal(line.hint, 'Not checked on the receiving side of a transfer.', criterion);
  });
  assert.equal(lineFor(view, 'merchant_name').verdict, 'not_set');
});

test('a bill row judged through its matched bank row says whose values are shown', () => {
  const view = build(
    judged([pass('account', 'account_ok')]),
    { inspectedTransactionId: 'txn_bill' },
  );
  assert.deepEqual(view.notes, ['This is a bill row. The row values are from the bank row matched to it.']);
});

// ── Other statuses ─────────────────────────────────────────────

test('fields_only shows what a new bill would match on, with no verdicts', () => {
  const view = build({
    status: 'fields_only',
    bank_transaction_id: 'txn_plaid',
    fields: studentLoanFields,
    bill: null,
    passes: null,
    verdicts: [],
  });
  assert.equal(view.tone, 'info');
  assert.equal(view.headline, 'No bill on this row');
  assert.equal(view.subline, 'A new bill would match on these values.');
  assert.deepEqual(view.actions, ['this-is-a-bill']);
  assert.deepEqual(view.columns, { row: true, bill: false, verdict: false });
  assert.equal(view.footnote, null);
  assert.deepEqual(view.lines.map(line => line.label), [
    'Account', 'Amount', 'Date', 'Day of month',
    'Plaid name patterns', 'Merchant name patterns', 'PFC categories',
  ]);
  view.lines.forEach(line => {
    assert.equal(line.verdict, null);
    assert.equal(line.billSetting, null);
  });
  assert.equal(lineFor(view, 'plaid_name').copyValue, 'To DEPT EDUCATION');
});

test('no_bank_row shows the bill criteria and a No bank row yet line', () => {
  const view = build({
    status: 'no_bank_row',
    bank_transaction_id: null,
    fields: null,
    bill: bill({ bill_row_transaction_id: 'txn_bill' }, { plaid_name_patterns: ['DEPT EDUCATION'] }),
    passes: null,
    verdicts: [],
  });
  assert.equal(view.headline, 'No bank row yet');
  assert.equal(view.subline,
    'No bank row is matched to this bill date. A bank row will be held to these criteria.');
  assert.deepEqual(view.notes, ['Bill: Student loan · Nov 11, 2026']);
  assert.deepEqual(view.actions, ['edit-bill']);
  assert.deepEqual(view.columns, { row: false, bill: true, verdict: false });
  assert.equal(lineFor(view, 'plaid_name').billSetting, 'DEPT EDUCATION');
  assert.equal(lineFor(view, 'merchant_name').verdict, 'not_set');
  view.lines.forEach(line => assert.equal(line.rowValue, null));
});

test('no_bank_row on a transfer receiving side lists only the criteria judged there', () => {
  const view = build({
    status: 'no_bank_row',
    bank_transaction_id: null,
    fields: null,
    bill: bill({ transfer_receiving_side: true }),
    passes: null,
    verdicts: [],
  });
  assert.deepEqual(view.lines.map(line => line.criterion), ['account', 'sign', 'amount', 'date_window']);
});

test('not_a_bank_row and a row Inspect does not fetch show one line and no criteria', () => {
  ['not_a_bank_row', 'not_fetched'].forEach(status => {
    const view = build({ status, bank_transaction_id: null, fields: null, bill: null, passes: null, verdicts: [] });
    assert.equal(view.headline, 'Not a bank row');
    assert.equal(view.subline, 'Bill matching does not look at this row. It is not a bank row and has no bill.');
    assert.equal(view.lines.length, 0);
    assert.deepEqual(view.actions, []);
  });
});

test('error, a missing block, and an incomplete judged block all read as the error line', () => {
  const broken = [
    { status: 'error', bank_transaction_id: null, fields: null, bill: null, passes: null, verdicts: [] },
    null,
    undefined,
    { status: 'judged', fields: null, bill: null, verdicts: [] },
    { status: 'something_new' },
  ];
  broken.forEach(payload => {
    const view = build(payload);
    assert.equal(view.status, 'error');
    assert.equal(view.tone, 'error');
    assert.equal(view.subline, 'Could not work out how bill matching sees this row. Try again later.');
    assert.equal(view.lines.length, 0);
    assert.deepEqual(view.actions, []);
  });
});

test('an upcoming bill date shows No bank row yet and offers Edit bill', () => {
  const view = build({ status: 'forecast', bill_id: 'bill_loan' });
  assert.equal(view.headline, 'No bank row yet');
  assert.equal(view.subline, 'This bill date has not come yet, so there is no bank row to judge.');
  assert.deepEqual(view.actions, ['edit-bill']);
  assert.equal(view.billId, 'bill_loan');
});

// ── Which rows fetch ───────────────────────────────────────────

test('Plaid rows and stored bill rows fetch; upcoming bill dates and other rows do not', () => {
  const kind = api.inspectBillMatchingFetchKind;
  assert.equal(kind({ source: 'plaid', status: 'cleared' }, 'PLAID_CLEARED'), 'plaid');
  assert.equal(kind({ source: 'plaid', status: 'pending' }, 'PLAID_PENDING'), 'plaid');
  assert.equal(kind({ source: 'scheduled', status: 'missing', bill_id: 'b1' }, 'BILL_MISSING'), 'bill');
  assert.equal(kind({ source: 'scheduled', status: 'matched', bill_id: 'b1' }, 'BILL_MATCHED'), 'bill');
  assert.equal(kind({ source: 'manual', status: 'future', bill_id: 'b1' }, 'MANUAL_FUTURE'), 'bill');
  assert.equal(kind({ source: 'scheduled', status: 'future', bill_id: 'b1' }, 'BILL_FUTURE'), 'forecast');
  assert.equal(kind({ source: 'manual', status: 'cleared' }, 'MANUAL_CLEARED'), 'none');
  assert.equal(kind({ source: 'opening_balance', status: 'cleared' }, 'SYSTEM_OPENING_BALANCE'), 'none');
  assert.equal(kind(null, null), 'none');
});

test('Inspect fetches for a bill row, and Inspect Match stays local with no Bill matching view', () => {
  const billRow = { transaction_id: 'm1', source: 'manual', status: 'missing', bill_id: 'b1', amount: -50 };
  const inspect = load(
    ['transactions/transaction-types.js', 'transactions/inspect-bill-matching.js', 'transactions/inspect-data.js'],
    '_normalizeInspectRequest',
    { transactions: [billRow], isTransferCategory: () => false },
  );

  const context = inspect.api._normalizeInspectRequest({ txnId: 'm1', localTransaction: billRow });
  assert.equal(context.shouldFetchPlaidRaw, false);
  assert.equal(context.billMatchingFetchKind, 'bill');
  assert.equal(context.showsBillMatching, true);

  const matchContext = inspect.api._normalizeInspectRequest({
    txnId: 'm1', localTransaction: billRow, relatedData: billRow, forceLocal: true,
  });
  assert.equal(matchContext.billMatchingFetchKind, 'none');
  assert.equal(matchContext.showsBillMatching, false);
});

test('a bank row with no bill row left notes it is judged against the bill as it is now', () => {
  const verdicts = [pass('account', 'account_ok'), fail('amount', 'amount_exact_fail(-112.00 != -100.00)')];
  const rebuilt = build(judged(verdicts, { bill: bill({ bill_row_transaction_id: null }) }));
  assert.ok(rebuilt.notes.includes('Judged against the bill as it is now, not the occurrence it matched.'));
  const live = build(judged(verdicts));
  assert.ok(!live.notes.includes('Judged against the bill as it is now, not the occurrence it matched.'));
});
