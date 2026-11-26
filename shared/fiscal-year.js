// ============================================================
// shared/fiscal-year.js — Fiscal-year date math
//
// The month a fiscal year starts in is a user preference owned by
// the API (fiscalYearStartMonth, 1-12, January by default). Every
// page that needs a fiscal-year boundary derives it here, so the
// date chips, the reports form, and the Settings text agree.
//
// A fiscal year always starts on day 1 of its start month and is
// named after the calendar year it ends in: with a November start,
// FY2027 is Nov 1 2026 through Oct 31 2027.
//
// Loaded after config-helpers.js (getFiscalStartMonth reads the
// cached preferences).
// ============================================================

const FISCAL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CALENDAR_YEAR_START_MONTH = 1;

/**
 * Coerce a stored preference to a usable start month. Anything that is
 * not a whole month number falls back to January, so a damaged cache
 * shows calendar years instead of breaking the date math.
 *
 * @param {*} rawValue - the stored fiscalYearStartMonth
 * @returns {number} month 1-12
 */
function normalizeFiscalStartMonth(rawValue) {
  const month = Number(rawValue);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return CALENDAR_YEAR_START_MONTH;
  }
  return month;
}

/**
 * The user's fiscal start month from the cached preferences.
 *
 * @returns {number} month 1-12
 */
function getFiscalStartMonth() {
  return normalizeFiscalStartMonth(getAppConfig().fiscalYearStartMonth);
}

/**
 * Whether the fiscal year differs from the calendar year. With a January
 * start the fiscal ranges equal the calendar ones, so fiscal-only
 * controls would be duplicates.
 *
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {boolean}
 */
function hasDistinctFiscalYear(fiscalStartMonth) {
  return normalizeFiscalStartMonth(fiscalStartMonth) !== CALENDAR_YEAR_START_MONTH;
}

/**
 * First and last day of the fiscal year that contains a date.
 *
 * @param {Date} now
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {{start: Date, end: Date, fiscalYear: number}}
 *   fiscalYear is the calendar year the fiscal year ends in.
 */
function currentFiscalYearRange(now, fiscalStartMonth) {
  const startMonthIndex = normalizeFiscalStartMonth(fiscalStartMonth) - 1;
  const hasStartedThisCalendarYear = now.getMonth() >= startMonthIndex;
  const startYear = hasStartedThisCalendarYear ? now.getFullYear() : now.getFullYear() - 1;
  return _fiscalYearStartingIn(startYear, startMonthIndex);
}

/**
 * First and last day of the most recent finished fiscal year.
 *
 * @param {Date} now
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {{start: Date, end: Date, fiscalYear: number}}
 */
function lastFiscalYearRange(now, fiscalStartMonth) {
  const current = currentFiscalYearRange(now, fiscalStartMonth);
  return _fiscalYearStartingIn(current.start.getFullYear() - 1, current.start.getMonth());
}

/**
 * First and last day of a named fiscal year. With a January start this is
 * the calendar year of that number.
 *
 * @param {number} fiscalYear - the calendar year the fiscal year ends in
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {{start: Date, end: Date, fiscalYear: number}}
 */
function fiscalYearRange(fiscalYear, fiscalStartMonth) {
  const startMonthIndex = normalizeFiscalStartMonth(fiscalStartMonth) - 1;
  const startYear = startMonthIndex === 0 ? fiscalYear : fiscalYear - 1;
  return _fiscalYearStartingIn(startYear, startMonthIndex);
}

function _fiscalYearStartingIn(startYear, startMonthIndex) {
  const start = new Date(startYear, startMonthIndex, 1);
  // Day 0 of the start month one year on is the last day of the month before it.
  const end = new Date(startYear + 1, startMonthIndex, 0);
  return { start, end, fiscalYear: end.getFullYear() };
}

/**
 * The one way a fiscal year is written anywhere on screen: "FY2027".
 *
 * @param {number} fiscalYear - the calendar year the fiscal year ends in
 * @returns {string}
 */
function fiscalYearLabel(fiscalYear) {
  return `FY${fiscalYear}`;
}

function _formatFiscalDayLong(date) {
  return `${FISCAL_MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * A short "Nov 1, 2026 – Oct 31, 2027" form of a range, for tooltips.
 *
 * @param {{start: Date, end: Date}} range
 * @returns {string}
 */
function formatFiscalRangeShort(range) {
  const formatDay = date =>
    `${FISCAL_MONTH_NAMES[date.getMonth()].slice(0, 3)} ${date.getDate()}, ${date.getFullYear()}`;
  return `${formatDay(range.start)} – ${formatDay(range.end)}`;
}

/**
 * Plain-language statement of what the user's fiscal year is: the yearly
 * span, then the exact dates of the current and the last finished one.
 *
 * @param {number} fiscalStartMonth - month 1-12
 * @param {Date} now
 * @returns {string}
 */
function describeFiscalYear(fiscalStartMonth, now) {
  const month = normalizeFiscalStartMonth(fiscalStartMonth);
  const current = currentFiscalYearRange(now, month);
  const last = lastFiscalYearRange(now, month);

  const startName = FISCAL_MONTH_NAMES[month - 1];
  const endName = FISCAL_MONTH_NAMES[current.end.getMonth()];
  // February is the one month whose last day moves, so the yearly span
  // names it instead of printing this year's 28 or 29.
  const endDayText = endName === 'February'
    ? 'the last day of February'
    : `${endName} ${current.end.getDate()}`;

  const span = hasDistinctFiscalYear(month)
    ? `Your fiscal year runs from ${startName} 1 through ${endDayText}.`
    : 'Your fiscal year is the calendar year, January 1 through December 31.';

  return `${span} The current one (${fiscalYearLabel(current.fiscalYear)}) is `
    + `${_formatFiscalDayLong(current.start)} through ${_formatFiscalDayLong(current.end)}. `
    + `The last one (${fiscalYearLabel(last.fiscalYear)}) was `
    + `${_formatFiscalDayLong(last.start)} through ${_formatFiscalDayLong(last.end)}.`;
}

/**
 * The question asked before a new fiscal start month is saved. Targets
 * are stored under a fiscal year's name, not its dates, so a new month
 * moves every target onto different months without deleting any; the
 * question says so, with the dates the current year would have.
 *
 * @param {number} currentMonth - the saved start month, 1-12
 * @param {number} newMonth - the month being picked, 1-12
 * @param {Date} now
 * @returns {string}
 */
function describeFiscalStartChange(currentMonth, newMonth, now) {
  const oldMonth = normalizeFiscalStartMonth(currentMonth);
  const month = normalizeFiscalStartMonth(newMonth);
  const oldCurrent = currentFiscalYearRange(now, oldMonth);
  const newCurrent = currentFiscalYearRange(now, month);
  const oldName = fiscalYearLabel(oldCurrent.fiscalYear);
  const newName = fiscalYearLabel(newCurrent.fiscalYear);
  const sameNameBefore = fiscalYearRange(newCurrent.fiscalYear, oldMonth);

  const lines = [
    `Change the fiscal year to start in ${FISCAL_MONTH_NAMES[month - 1]}?`,
    '',
    `The current fiscal year would be ${newName}, `
      + `${_formatFiscalDayLong(newCurrent.start)} through ${_formatFiscalDayLong(newCurrent.end)}.`,
    '',
    'Budget targets stay with their fiscal year\'s name, so they will apply to different months: '
      + `${newName}'s targets would cover those dates instead of `
      + `${_formatFiscalDayLong(sameNameBefore.start)} through ${_formatFiscalDayLong(sameNameBefore.end)}.`,
  ];

  if (newCurrent.fiscalYear < oldCurrent.fiscalYear) {
    lines.push(
      `The current year would be ${newName} instead of ${oldName}, so ${oldName}'s targets `
      + 'would leave the Budget and its targets editor until that year begins.',
    );
  } else if (newCurrent.fiscalYear > oldCurrent.fiscalYear) {
    lines.push(`The current year would be ${newName} instead of ${oldName}, so ${oldName}'s targets would become last year's.`);
  }

  lines.push('', 'Nothing is deleted. Changing the month back restores today\'s view.');
  return lines.join('\n');
}
