// ============================================================
// transactions/inspect-bill-matching.js — Inspect's "Bill matching" view model
// Turns the API's bill_matching block into display lines: one per bill
// criterion, worded as the phone's Inspect sheet words it. Every pass and fail
// comes from the API; this file only words and lays them out.
// ============================================================

/**
 * Gate order, with the label each line carries. The phone's Inspect sheet
 * uses the same labels and wording, so the two clients read alike.
 */
const BILL_MATCHING_CRITERIA = Object.freeze([
  { key: 'account', label: 'Account' },
  { key: 'sign', label: 'Direction' },
  { key: 'amount', label: 'Amount' },
  { key: 'date_window', label: 'Date window' },
  { key: 'day_of_month', label: 'Day of month' },
  { key: 'plaid_name', label: 'Plaid name patterns' },
  { key: 'merchant_name', label: 'Merchant name patterns' },
  { key: 'pfc', label: 'PFC categories' },
]);

// On the receiving side of a transfer bill the gate judges only these.
const BILL_MATCHING_TRANSFER_SIDE_CRITERIA = new Set(['account', 'sign', 'amount', 'date_window']);

const BILL_MATCHING_VERDICT_LABELS = Object.freeze({
  pass: 'Pass',
  fail: 'Fail',
  not_set: 'Not set',
  not_judged: 'Not judged',
});

const BILL_MATCHING_FOOTNOTE = "Checks the bill's criteria as the bill stands now. It does not check the matching window, "
  + 'pairs you turned down, or a bank row another bill already took.';

const BILL_MATCHING_MESSAGES = Object.freeze({
  notABankRow: 'Bill matching does not look at this row. It is not a bank row and has no bill.',
  error: 'Could not work out how bill matching sees this row. Try again later.',
  upcoming: 'This bill date has not come yet, so there is no bank row to judge.',
});

const BILL_MATCHING_MONTHS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

/**
 * Which kind of /raw/ fetch Inspect makes for a row.
 * @param {Object|null} row - The row Inspect describes (a piece's parent for a piece).
 * @param {string|null} rowType - getTransactionType(row).
 * @returns {'plaid'|'bill'|'forecast'|'none'} 'plaid' fetches the raw blob and
 *   bill matching; 'bill' fetches only for bill matching; 'forecast' is an
 *   unsaved bill occurrence with nothing on the server; 'none' is not fetched.
 */
function inspectBillMatchingFetchKind(row, rowType) {
  if (!row) return 'none';
  if (rowType === 'PLAID_CLEARED' || rowType === 'PLAID_PENDING' || rowType === 'PLAID_CONVERTED') {
    return 'plaid';
  }
  if (!row.bill_id) return 'none';
  // A forecast occurrence is drawn from the bill and has no stored row.
  if (rowType === 'BILL_FUTURE') return 'forecast';
  if (row.source === 'manual' || row.source === 'scheduled') return 'bill';
  return 'none';
}

/**
 * Build the Bill matching view from the API's bill_matching block.
 *
 * @param {Object|null} billMatching - `bill_matching` from GET /api/transactions/raw/<id>,
 *   or a local stand-in: `{status: 'forecast', bill_id}` for an upcoming bill
 *   date, `{status: 'not_fetched'}` for a row Inspect does not ask about, or
 *   `{status: 'error'}` when the fetch failed. A missing block reads as error,
 *   so an API older than this view still opens.
 * @param {Object} [options]
 * @param {function(string): string} [options.describeAccount] - Account id to display name.
 * @param {string} [options.inspectedTransactionId] - The row Inspect asked the API about.
 * @param {boolean} [options.isSplitChild] - The user inspected a piece of a split.
 * @returns {{
 *   status: string,
 *   tone: 'pass'|'fail'|'info'|'muted'|'error',
 *   headline: string,
 *   subline: string,
 *   notes: string[],
 *   footnote: (string|null),
 *   columns: {row: boolean, bill: boolean, verdict: boolean},
 *   lines: Array<{criterion: string, label: string, rowValue: (string|null),
 *     copyValue: (string|null), billSetting: (string|null),
 *     verdict: ('pass'|'fail'|'not_set'|'not_judged'|null), verdictLabel: (string|null),
 *     hint: (string|null)}>,
 *   actions: string[],
 *   billId: (string|null),
 * }}
 */
function buildBillMatchingView(billMatching, options = {}) {
  const describeAccount = typeof options.describeAccount === 'function'
    ? options.describeAccount
    : (accountId => accountId);
  const payload = billMatching || { status: 'error' };

  switch (payload.status) {
    case 'judged':
      if (payload.fields && payload.bill) return _bmJudgedView(payload, describeAccount, options);
      break;
    case 'fields_only':
      if (payload.fields) return _bmFieldsOnlyView(payload.fields, describeAccount, options);
      break;
    case 'no_bank_row':
      if (payload.bill) return _bmNoBankRowView(payload.bill, describeAccount);
      break;
    case 'not_a_bank_row':
    case 'not_fetched':
      return _bmMessageView(payload.status, 'muted', 'Not a bank row', BILL_MATCHING_MESSAGES.notABankRow);
    case 'forecast': {
      const view = _bmMessageView('forecast', 'muted', 'No bank row yet', BILL_MATCHING_MESSAGES.upcoming);
      view.billId = payload.bill_id || null;
      if (view.billId) view.actions = ['edit-bill'];
      return view;
    }
    default:
      break;
  }

  const view = _bmMessageView('error', 'error', 'Bill matching', BILL_MATCHING_MESSAGES.error);
  view.notes.push('Advanced still shows the data stored for this row.');
  return view;
}

function _bmMessageView(status, tone, headline, subline) {
  return {
    status,
    tone,
    headline,
    subline,
    notes: [],
    footnote: null,
    columns: { row: false, bill: false, verdict: false },
    lines: [],
    actions: [],
    billId: null,
  };
}

function _bmJudgedView(payload, describeAccount, options) {
  const fields = payload.fields;
  const bill = payload.bill;
  const verdicts = Array.isArray(payload.verdicts) ? payload.verdicts : [];
  const verdictsByCriterion = {};
  verdicts.forEach(verdict => {
    if (verdict && verdict.criterion && !verdictsByCriterion[verdict.criterion]) {
      verdictsByCriterion[verdict.criterion] = verdict;
    }
  });
  const accountFailed = !!verdictsByCriterion.account && verdictsByCriterion.account.passed === false;
  const transferSide = !!bill.transfer_receiving_side;

  const lines = BILL_MATCHING_CRITERIA.map(({ key, label }) => {
    const rowValue = _bmRowValue(key, fields, describeAccount);
    const billSetting = _bmBillSetting(key, bill, describeAccount);
    const verdict = verdictsByCriterion[key];
    const line = {
      criterion: key,
      label,
      rowValue,
      copyValue: _bmCopyValue(key, fields),
      billSetting,
      verdict: null,
      verdictLabel: null,
      hint: null,
    };
    if (verdict) {
      line.verdict = verdict.passed ? 'pass' : 'fail';
      if (!verdict.passed) line.hint = _bmFailHint(key, verdict.reason || '', fields);
    } else if (billSetting === null) {
      // No verdict on a criterion the bill leaves empty: it is not set.
      line.verdict = 'not_set';
    } else {
      // No verdict on a criterion the bill sets: the gate stopped first.
      line.verdict = 'not_judged';
      line.hint = _bmNotJudgedHint(key, accountFailed, transferSide);
    }
    line.verdictLabel = BILL_MATCHING_VERDICT_LABELS[line.verdict];
    return line;
  });

  const failCount = verdicts.filter(verdict => verdict && !verdict.passed).length;
  const passes = payload.passes === true;

  const notes = [];
  if (transferSide) notes.push('Judged as the receiving side of a transfer bill.');
  // With no bill row left (approving a match deletes it), the bank row is
  // judged against the bill as it stands now; an edit to that one date is gone.
  if (!bill.bill_row_transaction_id) {
    notes.push('Judged against the bill as it is now, not the occurrence it matched.');
  }
  if (options.isSplitChild) {
    notes.push('This is a piece of a split. Bill matching looks at the whole row it belongs to.');
  } else if (options.inspectedTransactionId && payload.bank_transaction_id
      && payload.bank_transaction_id !== options.inspectedTransactionId) {
    notes.push('This is a bill row. The row values are from the bank row matched to it.');
  }

  return {
    status: 'judged',
    tone: passes ? 'pass' : 'fail',
    headline: passes ? 'Meets every criterion' : `Fails ${failCount} criteri${failCount === 1 ? 'on' : 'a'}`,
    subline: _bmBillSubline(bill),
    notes,
    footnote: BILL_MATCHING_FOOTNOTE,
    columns: { row: true, bill: true, verdict: true },
    lines,
    actions: bill.bill_id ? ['edit-bill'] : [],
    billId: bill.bill_id || null,
  };
}

function _bmFieldsOnlyView(fields, describeAccount, options) {
  // What a new bill would match on: the direction rides on the amount here.
  const lines = BILL_MATCHING_CRITERIA
    .filter(({ key }) => key !== 'sign')
    .map(({ key, label }) => ({
      criterion: key,
      label: key === 'date_window' ? 'Date' : label,
      rowValue: _bmRowValue(key, fields, describeAccount),
      copyValue: _bmCopyValue(key, fields),
      billSetting: null,
      verdict: null,
      verdictLabel: null,
      hint: null,
    }));
  const notes = [];
  if (options.isSplitChild) {
    notes.push('This is a piece of a split. Bill matching looks at the whole row it belongs to.');
  }
  return {
    status: 'fields_only',
    tone: 'info',
    headline: 'No bill on this row',
    subline: 'A new bill would match on these values.',
    notes,
    footnote: null,
    columns: { row: true, bill: false, verdict: false },
    lines,
    actions: ['this-is-a-bill'],
    billId: null,
  };
}

function _bmNoBankRowView(bill, describeAccount) {
  const transferSide = !!bill.transfer_receiving_side;
  const lines = BILL_MATCHING_CRITERIA
    .filter(({ key }) => !transferSide || BILL_MATCHING_TRANSFER_SIDE_CRITERIA.has(key))
    .map(({ key, label }) => {
      const billSetting = _bmBillSetting(key, bill, describeAccount);
      return {
        criterion: key,
        label,
        rowValue: null,
        copyValue: null,
        billSetting,
        verdict: billSetting === null ? 'not_set' : null,
        verdictLabel: billSetting === null ? BILL_MATCHING_VERDICT_LABELS.not_set : null,
        hint: null,
      };
    });
  const subline = _bmBillSubline(bill);
  return {
    status: 'no_bank_row',
    tone: 'muted',
    headline: 'No bank row yet',
    subline: 'No bank row is matched to this bill date. A bank row will be held to these criteria.',
    notes: subline ? [subline] : [],
    footnote: null,
    columns: { row: false, bill: true, verdict: false },
    lines,
    actions: bill.bill_id ? ['edit-bill'] : [],
    billId: bill.bill_id || null,
  };
}

function _bmRowValue(key, fields, describeAccount) {
  switch (key) {
    case 'account':
      return fields.account_id ? (describeAccount(fields.account_id) || fields.account_id) : null;
    case 'sign':
      return _bmIsNumber(fields.amount) ? _bmDirection(fields.amount) : null;
    case 'amount':
      return _bmIsNumber(fields.amount) ? _bmSignedMoney(fields.amount) : null;
    case 'date_window':
      return fields.date ? _bmDate(fields.date) : null;
    case 'day_of_month':
      return _bmIsNumber(fields.day_of_month) ? _bmOrdinal(fields.day_of_month) : null;
    case 'plaid_name':
      return fields.plaid_name || null;
    case 'merchant_name':
      return fields.merchant_name || null;
    case 'pfc':
      return fields.pfc_detailed || null;
    default:
      return null;
  }
}

/**
 * What the copy button puts on the clipboard: the value as the API sent it,
 * so a pasted amount or date is in the form a bill field takes. Direction is
 * worded from the amount and has nothing of its own to copy.
 */
function _bmCopyValue(key, fields) {
  switch (key) {
    case 'account':
      return fields.account_id || null;
    case 'amount':
      return _bmIsNumber(fields.amount) ? Number(fields.amount).toFixed(2) : null;
    case 'date_window':
      return fields.date || null;
    case 'day_of_month':
      return _bmIsNumber(fields.day_of_month) ? String(fields.day_of_month) : null;
    case 'plaid_name':
      return fields.plaid_name || null;
    case 'merchant_name':
      return fields.merchant_name || null;
    case 'pfc':
      return fields.pfc_detailed || null;
    default:
      return null;
  }
}

// The bill's setting, or null when the bill leaves the criterion empty.
function _bmBillSetting(key, bill, describeAccount) {
  const criteria = bill.criteria || {};
  switch (key) {
    case 'account':
      return bill.account_id ? (describeAccount(bill.account_id) || bill.account_id) : null;
    case 'sign':
      return criteria.sign_enforced && _bmIsNumber(bill.amount) ? _bmDirection(bill.amount) : null;
    case 'amount':
      if (criteria.amount_mode === 'range') return _bmRangeText(criteria.amount_min, criteria.amount_max);
      return _bmIsNumber(bill.amount) ? _bmSignedMoney(bill.amount) : null;
    case 'date_window': {
      const days = criteria.date_tolerance_days;
      if (days === null || days === undefined) return null;
      const on = bill.occurrence_date ? _bmDate(bill.occurrence_date) : 'the bill date';
      if (Number(days) === 0) return `${on}, exactly`;
      return `${on} ± ${days} day${Number(days) === 1 ? '' : 's'}`;
    }
    case 'day_of_month': {
      const days = Array.isArray(criteria.day_of_month_set) ? criteria.day_of_month_set : [];
      return days.length ? _bmOrList(days.map(day => _bmOrdinal(day))) : null;
    }
    case 'plaid_name':
      return _bmListText(criteria.plaid_name_patterns);
    case 'merchant_name':
      return _bmListText(criteria.merchant_name_patterns);
    case 'pfc':
      return _bmListText(criteria.pfc_detailed_categories);
    default:
      return null;
  }
}

function _bmNotJudgedHint(key, accountFailed, transferSide) {
  if (accountFailed) return 'Not checked, because the row is in another account.';
  if (transferSide && !BILL_MATCHING_TRANSFER_SIDE_CRITERIA.has(key)) {
    return 'Not checked on the receiving side of a transfer.';
  }
  return null;
}

/**
 * Words a failed criterion. The verdict is the API's; the reason's stem and
 * bracketed detail only pick the wording.
 */
function _bmFailHint(key, reason, fields) {
  const stem = reason.split('(')[0];
  switch (key) {
    case 'plaid_name':
      return fields.plaid_name
        ? `Plaid's name is “${fields.plaid_name}”. Add part of it to Plaid name patterns.`
        : 'Plaid sent no name for this row, so no Plaid name pattern can match it.';
    case 'merchant_name':
      return fields.merchant_name
        ? `Plaid's merchant name is “${fields.merchant_name}”. Add part of it to Merchant name patterns.`
        : 'Plaid sent no merchant name for this row, so no Merchant name pattern can match it.';
    case 'pfc':
      return fields.pfc_detailed
        ? `Plaid's category is ${fields.pfc_detailed}. Add it to PFC categories.`
        : 'Plaid sent no category for this row, so no PFC category can match it.';
    case 'account':
      return 'The row is in a different account from the bill.';
    case 'sign':
      return stem === 'sign_unparseable'
        ? 'Could not read the amounts to compare direction.'
        : "The row's money moves the other way from the bill's.";
    case 'amount':
      if (stem === 'amount_exact_fail') return 'The amount must match the bill exactly.';
      if (stem === 'amount_below_min') return "Below the bill's range.";
      if (stem === 'amount_above_max') return "Above the bill's range.";
      return 'Could not read the amount.';
    case 'date_window': {
      if (stem === 'date_missing') return 'No date to compare.';
      const detail = /\(([^)]*)\)\s*$/.exec(reason);
      const days = detail ? parseInt(detail[1], 10) : NaN;
      return Number.isFinite(days)
        ? `${days} day${days === 1 ? '' : 's'} from the bill date, outside the window.`
        : 'Outside the date window.';
    }
    case 'day_of_month':
      return stem === 'date_missing_for_dom' ? 'No date to compare.' : "Not one of the bill's days.";
    default:
      return null;
  }
}

function _bmBillSubline(bill) {
  if (!bill || !bill.description) return '';
  if (!bill.occurrence_date) return `Bill: ${bill.description}`;
  return `Bill: ${bill.description} · ${_bmDate(bill.occurrence_date)}`;
}

// The gate counts zero as money in.
function _bmDirection(amount) {
  return Number(amount) < 0 ? 'Money out' : 'Money in';
}

function _bmMoney(amount) {
  const value = Math.abs(Number(amount));
  const [whole, cents] = value.toFixed(2).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

function _bmSignedMoney(amount) {
  return Number(amount) < 0 ? `−${_bmMoney(amount)}` : `+${_bmMoney(amount)}`;
}

function _bmRangeText(min, max) {
  const hasMin = _bmIsNumber(min);
  const hasMax = _bmIsNumber(max);
  if (hasMin && hasMax) return `${_bmMoney(min)} – ${_bmMoney(max)}`;
  if (hasMin) return `At least ${_bmMoney(min)}`;
  if (hasMax) return `Up to ${_bmMoney(max)}`;
  return 'Any amount';
}

// Formats the calendar date as written, with no time zone to shift it.
function _bmDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate));
  if (!match) return String(isoDate);
  const month = BILL_MATCHING_MONTHS[Number(match[2]) - 1];
  if (!month) return String(isoDate);
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function _bmOrdinal(day) {
  const number = Number(day);
  const lastTwo = Math.abs(number) % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${number}th`;
  const last = Math.abs(number) % 10;
  if (last === 1) return `${number}st`;
  if (last === 2) return `${number}nd`;
  if (last === 3) return `${number}rd`;
  return `${number}th`;
}

function _bmOrList(values) {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
}

function _bmListText(values) {
  if (!Array.isArray(values)) return null;
  const kept = values.filter(value => value && String(value).trim());
  return kept.length ? kept.join(', ') : null;
}

function _bmIsNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}
