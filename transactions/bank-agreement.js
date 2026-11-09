// ============================================================
// transactions/bank-agreement.js — Bank agreement display helpers
// Pure functions that turn the API's bank_agreement object and the
// bank-agreement detail response into what the indicator, the
// sidebar dot, and the detail panel show. The API decides whether
// the ledger agrees with the bank; nothing here recomputes that.
// ============================================================

const _BANK_AGREEMENT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _BANK_AGREEMENT_MS_PER_DAY = 24 * 60 * 60 * 1000;
// The statuses a bank-delivered row carries while today's ledger counts it.
const _BANK_AGREEMENT_COUNTED_STATUSES = ['cleared', 'converted'];

/**
 * "$1,234.56" or "-$1,234.56" for a money value the API sent as a string.
 * @param {string|number} value
 * @returns {string}
 */
function _formatAgreementMoney(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return '—';
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
  });
  return amount < 0 ? `-${formatted}` : formatted;
}

/**
 * Like _formatAgreementMoney, with a "+" on positive amounts so a gap
 * reads as a direction.
 * @param {string|number} value
 * @returns {string}
 */
function _formatAgreementSignedMoney(value) {
  const amount = Number.parseFloat(value);
  if (Number.isFinite(amount) && amount > 0) return `+${_formatAgreementMoney(amount)}`;
  return _formatAgreementMoney(value);
}

/**
 * Parse "YYYY-MM-DD" into its parts, or null when it is not one.
 * @param {string} isoDate
 * @returns {{year: number, month: number, day: number}|null}
 */
function _parseAgreementIsoDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * "Nov 4" in the current year, "Nov 4, 2025" otherwise.
 * @param {string} isoDate
 * @param {string} todayIso
 * @returns {string}
 */
function _formatAgreementShortDate(isoDate, todayIso) {
  const parts = _parseAgreementIsoDate(isoDate);
  if (!parts) return String(isoDate || '—');
  const today = _parseAgreementIsoDate(todayIso);
  const monthDay = `${_BANK_AGREEMENT_MONTHS[parts.month - 1]} ${parts.day}`;
  if (today && today.year === parts.year) return monthDay;
  return `${monthDay}, ${parts.year}`;
}

/**
 * Whole days from one ISO date to another, counted on the calendar so
 * a daylight-saving change cannot shift the result.
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number|null}
 */
function _agreementDaysBetween(fromIso, toIso) {
  const from = _parseAgreementIsoDate(fromIso);
  const to = _parseAgreementIsoDate(toIso);
  if (!from || !to) return null;
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / _BANK_AGREEMENT_MS_PER_DAY);
}

/**
 * "Nov 4, 2026 (2 days ago)": the full date with how long ago it was.
 * @param {string} isoDate
 * @param {string} todayIso
 * @returns {string}
 */
function _formatAgreementDateInWords(isoDate, todayIso) {
  const parts = _parseAgreementIsoDate(isoDate);
  if (!parts) return String(isoDate || '—');
  const fullDate = `${_BANK_AGREEMENT_MONTHS[parts.month - 1]} ${parts.day}, ${parts.year}`;
  const daysAgo = _agreementDaysBetween(isoDate, todayIso);
  if (daysAgo === null || daysAgo < 0) return fullDate;
  if (daysAgo === 0) return `${fullDate} (today)`;
  if (daysAgo === 1) return `${fullDate} (yesterday)`;
  return `${fullDate} (${daysAgo} days ago)`;
}

/**
 * What the Plaid balance indicator and the sidebar dot show for one
 * account, read from the API's bank_agreement object.
 *
 * @param {object} account - Sidebar account: current_balance and
 *   plaid_balance as numbers, bank_agreement as the API sent it.
 * @param {function(string): string} mask - Applied to every money figure.
 * @returns {{visible: boolean, mismatched: boolean, text: string,
 *   title: string, dotTitle: string}}
 */
function bankAgreementIndicatorState(account, mask) {
  const hidden = { visible: false, mismatched: false, hasHistory: false, text: '', title: '', dotTitle: '' };
  const agreement = account ? account.bank_agreement : null;
  if (!agreement || account.plaid_balance == null) return hidden;
  if (agreement.status !== 'matched' && agreement.status !== 'mismatched') return hidden;

  const plaidBalance = Number(account.plaid_balance);
  const formattedPlaidBalance = mask(plaidBalance.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
  }));
  const text = `Plaid: ${formattedPlaidBalance}`;
  // An older API, or a banking account, can be traced; the API says false
  // for an investment account, where a mismatch means stale holdings.
  const hasHistory = agreement.has_history !== false;

  if (agreement.status === 'matched') {
    const afterPending = agreement.matched_at === 'pending' ? ' (after pending rows)' : '';
    return {
      visible: true,
      mismatched: false,
      hasHistory,
      text,
      title: `Plaid balance matches app balance${afterPending}`,
      dotTitle: '',
    };
  }

  const appBalance = Number(account.current_balance) || 0;
  const gapSize = Math.abs(Number.parseFloat(agreement.gap) || 0);
  const formattedAppBalance = mask(`$${appBalance.toFixed(2)}`);
  const formattedGap = mask(`$${gapSize.toFixed(2)}`);
  const stale = hasHistory ? '' : '; holdings may need a sync';
  return {
    visible: true,
    mismatched: true,
    hasHistory,
    text,
    title: `Plaid reports ${formattedPlaidBalance} but app calculates ${formattedAppBalance} (difference: ${formattedGap}${stale})`,
    dotTitle: `Plaid balance mismatch: ${formattedGap} difference${stale}`,
  };
}

/**
 * The detail panel's view model, built from the bank-agreement detail
 * response.
 *
 * state is "mismatched" (the full panel), "matched" (the ledger agrees
 * now, so there is nothing to trace), or "unavailable" (the bank's
 * balance could not be read this time).
 *
 * highlightAfterDate is the last-agreed day when there is one: the rows
 * in the table dated after it are the ones to highlight.
 *
 * @param {object} response - GET /api/accounts/<id>/bank-agreement body.
 * @param {object} options
 * @param {function(string): string} options.mask - Applied to every money figure.
 * @param {string} options.todayIso - Today's local date, YYYY-MM-DD.
 * @returns {{state: string, message: string, gapText: string,
 *   lastAgreedDate: string|null, lastAgreedText: string, suspectText: string,
 *   days: object[], highlightAfterDate: string|null}}
 */
function buildBankAgreementPanelModel(response, options) {
  const mask = options.mask;
  const todayIso = options.todayIso;
  const agreement = response ? response.bank_agreement : null;

  const model = {
    state: 'unavailable',
    message: '',
    gapText: '',
    lastAgreedDate: null,
    lastAgreedText: '',
    suspectText: '',
    days: [],
    highlightAfterDate: null,
  };

  if (!agreement) {
    model.message = 'The bank’s balance is not available right now, so the ledger cannot be compared.';
    return model;
  }

  model.gapText = mask(_formatAgreementSignedMoney(agreement.gap));

  if (agreement.status !== 'mismatched') {
    model.state = 'matched';
    model.message = agreement.matched_at === 'pending'
      ? 'The ledger agrees with the bank now, after pending rows.'
      : 'The ledger agrees with the bank now.';
    return model;
  }

  model.state = 'mismatched';
  const days = Array.isArray(response.days) ? response.days.slice() : [];
  // Newest first, whatever order arrived.
  days.sort((left, right) => String(right.date).localeCompare(String(left.date)));
  model.days = days.map(day => {
    const gapValue = Number.parseFloat(day.gap);
    const agreed = day.agreed === true;
    return {
      date: day.date,
      dateText: _formatAgreementShortDate(day.date, todayIso),
      ledgerText: mask(_formatAgreementMoney(day.ledger_balance)),
      bankText: mask(_formatAgreementMoney(day.bank_balance)),
      gapText: mask(_formatAgreementSignedMoney(day.gap)),
      agreed,
      agreedMark: agreed ? '✓' : '',
      // The API counts a day as agreed when the bank matched the next
      // day's ledger figure, so an agreed day can still show a gap.
      agreedNote: agreed && Number.isFinite(gapValue) && gapValue !== 0
        ? 'Agreed with the next day’s ledger figure'
        : '',
    };
  });

  const lastAgreedDate = agreement.last_agreed_date || null;
  if (!lastAgreedDate) {
    model.message = 'No day in the last year agreed with the bank.';
    return model;
  }

  model.lastAgreedDate = lastAgreedDate;
  model.lastAgreedText = _formatAgreementDateInWords(lastAgreedDate, todayIso);

  const shortDate = _formatAgreementShortDate(lastAgreedDate, todayIso);
  const suspectCount = Number.isInteger(agreement.suspect_row_count) ? agreement.suspect_row_count : 0;
  const suspectRows = Array.isArray(response.suspect_rows) ? response.suspect_rows : [];
  const pendingCount = suspectRows.filter(row => row && row.status === 'pending').length;
  const rowWord = suspectCount === 1 ? 'row' : 'rows';
  let suspectText = `${suspectCount} ledger ${rowWord} dated after ${shortDate}`;
  if (pendingCount > 0) suspectText += `, plus ${pendingCount} pending`;
  model.suspectText = suspectText;

  model.highlightAfterDate = lastAgreedDate;
  return model;
}

/**
 * Whether a bank row is one today's ledger counts even when dated after
 * today. Banks date some evening and weekend deposits the next business
 * day while their balance already holds them, so the API counts a
 * delivered bank row from the moment it arrives.
 * @param {object} txn - A transaction row as the table renders it.
 * @returns {boolean}
 */
function _isCountedBankRow(txn) {
  return txn.source === 'plaid' && _BANK_AGREEMENT_COUNTED_STATUSES.includes(txn.status);
}

/**
 * Whether a table row is one of the rows to highlight: dated after the
 * last-agreed day and counted in today's ledger. The ledger counts rows
 * dated up to today plus bank rows the bank dated later, so the projected
 * future block is not part of the story.
 * @param {object} txn - A transaction row as the table renders it.
 * @param {string} afterDate - The last-agreed day, YYYY-MM-DD.
 * @param {string} todayIso - Today's local date, YYYY-MM-DD.
 * @returns {boolean}
 */
function isBankSuspectRow(txn, afterDate, todayIso) {
  if (!txn || !afterDate) return false;
  if (txn.status === 'future') return false;
  const rowDate = String(txn.date || '').slice(0, 10);
  if (todayIso && rowDate > todayIso && !_isCountedBankRow(txn)) return false;
  return rowDate > afterDate;
}

/**
 * The chip's text while the highlight is on.
 * @param {string} afterDate - The last-agreed day, YYYY-MM-DD.
 * @param {number} rowCount - Highlighted rows in the current table.
 * @param {string} todayIso - Today's local date, YYYY-MM-DD.
 * @returns {string}
 */
function bankSuspectChipText(afterDate, rowCount, todayIso) {
  const shortDate = _formatAgreementShortDate(afterDate, todayIso);
  const rowWord = rowCount === 1 ? 'row' : 'rows';
  return `Highlighting ${rowCount} ${rowWord} after ${shortDate}`;
}

/**
 * The start date the ledger filter should widen to so the highlight's
 * boundary is on screen: a week before the last-agreed day, when the
 * current start date is later than that day. Null when the current range
 * already reaches it.
 * @param {string} afterDate - The last-agreed day, YYYY-MM-DD.
 * @param {string} currentStartIso - The filter's start date, YYYY-MM-DD.
 * @returns {string|null}
 */
function bankSuspectFilterStart(afterDate, currentStartIso) {
  const parts = _parseAgreementIsoDate(afterDate);
  if (!parts) return null;
  if (currentStartIso && currentStartIso <= afterDate) return null;
  const weekBefore = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 7));
  return weekBefore.toISOString().slice(0, 10);
}
