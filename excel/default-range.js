// ============================================================
// excel/default-range.js — the month range the panel opens on
//
// The workbook reads months by column position, so the paste must
// start on the month already in the first month column, or every
// lookup shifts. The web client's report modal keeps an older start
// through the first month of a fiscal year; the add-in does not.
//
// Pure functions. Depends on shared/fiscal-year.js
// (currentFiscalYearRange, FISCAL_MONTH_NAMES) and excel/cells.js
// (monthKeyFromHeaderValue).
// ============================================================

/**
 * YYYY-MM of a date, in local time.
 *
 * @param {Date} date
 * @returns {string}
 */
function monthKeyOfDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The first month a balances sheet already holds: the first cell of its
 * header row, from the given column on, that names a month.
 *
 * @param {Array<*>|undefined} headerRow - row 1 of the sheet
 * @param {number} firstMonthColumn - zero-based column to start looking in
 * @returns {string|null} YYYY-MM
 */
function firstMonthOnSheet(headerRow, firstMonthColumn) {
  for (let columnIndex = firstMonthColumn; columnIndex < (headerRow || []).length; columnIndex++) {
    const monthKey = monthKeyFromHeaderValue(headerRow[columnIndex]);
    if (monthKey) return monthKey;
  }
  return null;
}

/**
 * The panel's default range: from the first month already on the balances
 * sheet through the current month. A sheet with no month header yet starts
 * at the first month of the fiscal year before the current one.
 *
 * Example, fiscal start November, on 21 November 2026 with no header:
 * November 2025 through November 2026.
 *
 * @param {Date} now
 * @param {number} fiscalStartMonth - month 1-12
 * @param {Array<*>|undefined} balanceHeaderRow - row 1 of the balances sheet
 * @param {number} firstMonthColumn - zero-based
 * @returns {{startMonth: string, endMonth: string}} YYYY-MM values
 */
function defaultPasteRange(now, fiscalStartMonth, balanceHeaderRow, firstMonthColumn) {
  const endMonth = monthKeyOfDate(now);
  const onSheet = firstMonthOnSheet(balanceHeaderRow, firstMonthColumn);
  if (onSheet && onSheet <= endMonth) return { startMonth: onSheet, endMonth };

  const currentStart = currentFiscalYearRange(now, fiscalStartMonth).start;
  const previousStart = new Date(currentStart.getFullYear() - 1, currentStart.getMonth(), 1);
  return { startMonth: monthKeyOfDate(previousStart), endMonth };
}

/**
 * The first and last day of a month range, as the report endpoints take them.
 *
 * @param {string} startMonth - YYYY-MM
 * @param {string} endMonth - YYYY-MM
 * @returns {{startDate: string, endDate: string}}
 */
function monthRangeToDates(startMonth, endMonth) {
  const [endYear, endMonthNumber] = endMonth.split('-').map(Number);
  const lastDay = new Date(endYear, endMonthNumber, 0).getDate();
  return {
    startDate: `${startMonth}-01`,
    endDate: `${endMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Short display name of a month: "Nov 2026".
 *
 * @param {string} monthKey - YYYY-MM
 * @returns {string}
 */
function monthKeyLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${FISCAL_MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
}

/**
 * The months a picker offers, newest first: the current month back through
 * the given number of years, plus any extra month (such as an older first
 * month already on the sheet) so the default is always selectable.
 *
 * @param {Date} now
 * @param {number} yearsBack
 * @param {string[]} [extraMonths]
 * @returns {Array<{value: string, label: string}>}
 */
function monthPickerOptions(now, yearsBack, extraMonths = []) {
  const months = new Set(extraMonths.filter(Boolean));
  for (let offset = 0; offset <= yearsBack * 12; offset++) {
    months.add(monthKeyOfDate(new Date(now.getFullYear(), now.getMonth() - offset, 1)));
  }
  return [...months]
    .sort()
    .reverse()
    .map(value => ({ value, label: monthKeyLabel(value) }));
}

/**
 * Whether a picked range can be sent: both months set and in order.
 *
 * @param {string} startMonth - YYYY-MM
 * @param {string} endMonth - YYYY-MM
 * @returns {string|null} a sentence for the status line, or null when fine
 */
function monthRangeProblem(startMonth, endMonth) {
  if (!startMonth || !endMonth) return 'Pick a start and an end month.';
  if (startMonth > endMonth) return 'The start month is after the end month.';
  return null;
}
