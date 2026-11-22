// ============================================================
// transactions/filters.js — Date, Account & Category Filtering
// Toggle-style date range buttons, dynamic month shortcuts,
// custom date range picker, and category filter dropdown.
// ============================================================

// localStorage key for the active date filter toggle
const DATE_FILTER_ACTIVE_KEY = 'pf_date_filter_active';
// When the user last touched the Transactions page. Decides at page open
// whether the remembered chip is still fresh or the Settings default applies.
const DATE_FILTER_LAST_ACTIVITY_KEY = 'pf_date_filter_last_activity';
// A remembered chip older than this since the last activity is replaced by
// the Settings default when the page opens.
const DATE_FILTER_STALE_AFTER_MS = 60 * 60 * 1000;
// Activity listeners write localStorage at most this often.
const DATE_FILTER_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
let _lastDateFilterActivityWriteMs = 0;
// A filter in force for this page load only, set by a deep link; null when
// the saved one applies. The saved one is shared with the user's other tabs.
let _pageOnlyDateFilter = null;
// For custom range, remember user-entered start/end
const DATE_FILTER_CUSTOM_START_KEY = 'pf_date_filter_custom_start';
const DATE_FILTER_CUSTOM_END_KEY = 'pf_date_filter_custom_end';
// For month buttons, remember which year+month was selected
const DATE_FILTER_MONTH_KEY = 'pf_date_filter_month';
const DEFAULT_FORECAST_HORIZON_DAYS = 90;
const MAX_FORECAST_HORIZON_DAYS = 365;

/** The date filter in force: this load's own, else the saved one. */
function _activeDateFilterName() {
  if (_pageOnlyDateFilter !== null) return _pageOnlyDateFilter;
  return localStorage.getItem(DATE_FILTER_ACTIVE_KEY);
}

/** Save a filter the user chose; it replaces any page-only one. */
function _saveActiveDateFilter(filterName) {
  _pageOnlyDateFilter = null;
  localStorage.setItem(DATE_FILTER_ACTIVE_KEY, filterName);
}

/**
 * Show every date for this page load without saving it, so a deep link does
 * not change what the user's other tabs open on. A filter picked by hand
 * afterwards is saved as usual.
 */
function showAllDatesForThisPage() {
  _hideCustomRangeInputs();
  _applyAllTimeDates();
  _setActiveToggle('btn-date-all');
  _pageOnlyDateFilter = 'all';
}

function _formatDateLocal(date) {
  return toISODateStr(date);
}

function _parseForecastHorizonDays(rawValue, defaultDays = DEFAULT_FORECAST_HORIZON_DAYS) {
  const parsedDays = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedDays)) {
    return defaultDays;
  }
  return Math.max(0, Math.min(MAX_FORECAST_HORIZON_DAYS, parsedDays));
}

function _getForecastHorizonDays() {
  return _parseForecastHorizonDays(document.getElementById('bills-future-days')?.value);
}

// ===== "Show all" baseline dates =====
// Default range: earliest txn through the active forecast horizon.

function _allTimeStartDate() {
  if (transactions && transactions.length > 0) {
    const earliest = transactions.reduce((min, txn) => {
      if (isSystemType(getTransactionType(txn))) return min;
      return (!min || txn.date < min) ? txn.date : min;
    }, null);
    if (earliest) return earliest;
  }
  // Fallback when no txns loaded yet
  const fallback = new Date();
  fallback.setFullYear(fallback.getFullYear() - 10);
  return _formatDateLocal(fallback);
}

function _tomorrowDateStr() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return _formatDateLocal(tomorrow);
}

/**
 * Return a date string for today + the forecast horizon.
 * Used by filters that include projected future rows.
 */
function _futureEndDateStr() {
  const futureDays = _getForecastHorizonDays();
  const end = new Date();
  end.setDate(end.getDate() + futureDays);
  return _formatDateLocal(end);
}

function _isForecastLimitedFutureTxnType(txnType) {
  return txnType === TXN_TYPE.BILL_FUTURE || txnType === TXN_TYPE.MANUAL_FUTURE;
}

function _isFutureTxnPastForecastHorizon(txn, txnType, todayDateStr, forecastEndDateStr) {
  if (!_isForecastLimitedFutureTxnType(txnType)) {
    return false;
  }
  if (!txn.date || txn.date <= todayDateStr) {
    return false;
  }
  return txn.date > forecastEndDateStr;
}

function _refreshDateFilterWindowForForecastHorizon() {
  const activeFilter = _activeDateFilterName();

  if (activeFilter === 'all') {
    _applyAllTimeDates();
  } else if (activeFilter === 'mtd') {
    _applyMonthToDate();
  } else if (activeFilter === 'ytd') {
    _applyYearToDate();
  } else if (activeFilter === 'fiscal_ytd') {
    _applyFiscalYearToDate();
  } else if (activeFilter === 'last_12_months' || !activeFilter) {
    _applyLast12Months();
  }
}

/**
 * Write "show everything" range into the hidden start-date / end-date inputs.
 * End date extends by the forecast horizon so projected future rows remain visible.
 */
function _applyAllTimeDates() {
  document.getElementById('start-date').value = _allTimeStartDate();
  document.getElementById('end-date').value = _futureEndDateStr();
}

/**
 * Set start-date/end-date to the trailing year (365 or 366 days ending
 * today), plus the forecast horizon into the future so projected rows
 * are visible by default.
 */
function _applyLast12Months() {
  const start = trailingYearStartDate(new Date());
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _futureEndDateStr();
}

/**
 * Keep the trailing-year button's day count accurate.
 * Called once from main.js init.
 */
function refreshTrailingYearButtonLabel() {
  const button = document.getElementById('btn-date-last-12-months');
  if (button) button.textContent = trailingYearLabel(new Date());
}

/**
 * Set start-date/end-date to Month-to-Date. On the 1st of the month
 * we include the prior month so the view isn't empty.
 */
function _applyMonthToDate() {
  const start = new Date();
  if (start.getDate() === 1) {
    start.setMonth(start.getMonth() - 1);
  } else {
    start.setDate(1);
  }
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _futureEndDateStr();
}

function _applyLastMonth() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(end);
}

function _applyYearToDate() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _futureEndDateStr();
}

function _applyLastYear() {
  const now = new Date();
  const start = new Date(now.getFullYear() - 1, 0, 1);
  const end = new Date(now.getFullYear() - 1, 11, 31);
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(end);
}

/**
 * Current fiscal year: its first day through today, plus the forecast
 * horizon so projected rows show, the same way YTD treats the future.
 */
function _applyFiscalYearToDate() {
  const range = currentFiscalYearRange(new Date(), getFiscalStartMonth());
  document.getElementById('start-date').value = _formatDateLocal(range.start);
  document.getElementById('end-date').value = _futureEndDateStr();
}

/** The most recent finished fiscal year, first day to last, no future rows. */
function _applyLastFiscalYear() {
  const range = lastFiscalYearRange(new Date(), getFiscalStartMonth());
  document.getElementById('start-date').value = _formatDateLocal(range.start);
  document.getElementById('end-date').value = _formatDateLocal(range.end);
}

/**
 * The fiscal filters exist only when the fiscal year differs from the
 * calendar year. A saved or default fiscal filter met with a January start
 * becomes its calendar twin, which covers the same dates and has a chip.
 *
 * @param {string} filterName
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {string} the filter name to apply
 */
function _resolveDateFilterName(filterName, fiscalStartMonth) {
  if (hasDistinctFiscalYear(fiscalStartMonth)) return filterName;
  if (filterName === 'fiscal_ytd') return 'ytd';
  if (filterName === 'last_fiscal_year') return 'last_year';
  return filterName;
}

/**
 * The two fiscal-year chips. The current one is FYTD, with no year, to sit
 * with MTD and YTD and to stay distinct from the finished year's chip; its
 * tooltip names the year.
 *
 * @param {Date} now
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {Array<{id: string, label: string,
 *   range: {start: Date, end: Date, fiscalYear: number}}>}
 */
function _fiscalChips(now, fiscalStartMonth) {
  const currentRange = currentFiscalYearRange(now, fiscalStartMonth);
  const lastRange = lastFiscalYearRange(now, fiscalStartMonth);
  return [
    {
      id: 'btn-date-fiscal-ytd',
      label: 'FYTD',
      range: currentRange,
    },
    {
      id: 'btn-date-last-fiscal-year',
      label: fiscalYearLabel(lastRange.fiscalYear),
      range: lastRange,
    },
  ];
}

/**
 * Show the two fiscal-year chips only when they are not duplicates of YTD
 * and Last Year, and put each one's exact dates in its tooltip.
 */
function _refreshFiscalChips() {
  const fiscalStartMonth = getFiscalStartMonth();
  const now = new Date();
  // Visibility comes from the chip plan, so the row on screen and the plan
  // the tests check cannot disagree. History does not affect these chips.
  const shownIds = _dateChipPlan(now, null, fiscalStartMonth).fiscalIds;
  const chips = _fiscalChips(now, fiscalStartMonth);
  chips.forEach(chip => {
    const button = document.getElementById(chip.id);
    if (!button) return;
    button.style.display = shownIds.includes(chip.id) ? '' : 'none';
    button.textContent = chip.label;
    button.title = `${fiscalYearLabel(chip.range.fiscalYear)}: ${formatFiscalRangeShort(chip.range)}`;
  });
}

/**
 * Re-read the fiscal start month after preferences arrive from the server:
 * the chips and an active fiscal filter were first set from the local cache,
 * which is stale when the setting was changed in another browser.
 * Called from main.js before the first render.
 */
function refreshFiscalDateFilter() {
  _refreshFiscalChips();
  const storedFilter = _activeDateFilterName();
  // A year chip spans its fiscal year, so its dates move with the setting too.
  if (storedFilter && storedFilter.startsWith('year_')) {
    _restoreSavedToggleFilter(storedFilter);
    return;
  }
  if (storedFilter !== 'fiscal_ytd' && storedFilter !== 'last_fiscal_year') return;

  // The fresh month may be January, which hides the fiscal chips; the
  // filter then moves to its calendar twin so a visible chip is lit.
  const resolvedFilter = _resolveDateFilterName(storedFilter, getFiscalStartMonth());
  if (resolvedFilter !== storedFilter) {
    _saveActiveDateFilter(resolvedFilter);
  }
  _restoreSavedToggleFilter(resolvedFilter);
}

/**
 * A year chip's whole fiscal year, so the year chips tile the history with
 * Last FY and FYTD and leave no months between them. With a January start
 * this is the calendar year.
 *
 * @param {number} year - the fiscal year, named after the year it ends in
 */
function _applyYear(year) {
  const range = fiscalYearRange(year, getFiscalStartMonth());
  document.getElementById('start-date').value = _formatDateLocal(range.start);
  document.getElementById('end-date').value = _formatDateLocal(range.end);
}

function _applyMonth(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(end);
}

/**
 * Map a defaultDateRange config value (from user preferences) to the
 * matching apply function, filter-name key, and toggle button id.
 * Config values that don't correspond to a visible toggle button
 * leave buttonId null — the range is applied without highlighting.
 */
function _mapConfigRangeToFilter(configValue) {
  switch (configValue) {
    case 'last_12_months':
      return { apply: _applyLast12Months,  filterName: 'last_12_months', buttonId: 'btn-date-last-12-months' };
    case 'mtd':
      return { apply: _applyMonthToDate,   filterName: 'mtd',            buttonId: 'btn-date-mtd' };
    case 'ytd':
      return { apply: _applyYearToDate,    filterName: 'ytd',            buttonId: 'btn-date-ytd' };
    case 'last_month':
      return { apply: _applyLastMonth,     filterName: 'last_month',     buttonId: 'btn-date-last-month' };
    case 'last_year':
      return { apply: _applyLastYear,      filterName: 'last_year',      buttonId: 'btn-date-last-year' };
    case 'fiscal_ytd':
      return { apply: _applyFiscalYearToDate, filterName: 'fiscal_ytd',    buttonId: 'btn-date-fiscal-ytd' };
    case 'last_fiscal_year':
      return { apply: _applyLastFiscalYear, filterName: 'last_fiscal_year', buttonId: 'btn-date-last-fiscal-year' };
    default:
      return { apply: _applyLast12Months,  filterName: 'last_12_months', buttonId: 'btn-date-last-12-months' };
  }
}

// ===== Visual toggle helpers =====

function _clearAllDateToggleStyles() {
  document.querySelectorAll('.btn-date-toggle').forEach(button => {
    button.classList.remove('active');
  });
  document.querySelectorAll('.btn-date-month').forEach(button => {
    button.classList.remove('active');
  });
  document.querySelectorAll('.btn-date-year').forEach(button => {
    button.classList.remove('active');
  });
}

function _setActiveToggle(buttonId) {
  _clearAllDateToggleStyles();
  const button = document.getElementById(buttonId);
  if (button) button.classList.add('active');
}

function _setActiveMonthButton(year, month) {
  _clearAllDateToggleStyles();
  const button = document.getElementById(`btn-month-${year}-${month}`);
  if (button) button.classList.add('active');
}

function _setActiveYearButton(year) {
  _clearAllDateToggleStyles();
  const button = document.getElementById(`btn-year-${year}`);
  if (button) button.classList.add('active');
}

// ===== Core toggle handler =====

/**
 * Main entry point for all date filter buttons. Clicking a toggled-on
 * button turns it off (returns to "all dates"). Only one filter active
 * at a time.
 */
function toggleDateFilter(filterName) {
  const currentActive = _activeDateFilterName();

  // Clicking the same filter again → deactivate (back to default 12-month view)
  if (currentActive === filterName) {
    _deactivateDateFilter();
    return;
  }

  _hideCustomRangeInputs();

  if (filterName === 'last_12_months') {
    _applyLast12Months();
    _setActiveToggle('btn-date-last-12-months');
  } else if (filterName === 'all') {
    _applyAllTimeDates();
    _setActiveToggle('btn-date-all');
  } else if (filterName === 'mtd') {
    _applyMonthToDate();
    _setActiveToggle('btn-date-mtd');
  } else if (filterName === 'ytd') {
    _applyYearToDate();
    _setActiveToggle('btn-date-ytd');
  } else if (filterName === 'last_month') {
    _applyLastMonth();
    _setActiveToggle('btn-date-last-month');
  } else if (filterName === 'last_year') {
    _applyLastYear();
    _setActiveToggle('btn-date-last-year');
  } else if (filterName === 'fiscal_ytd') {
    _applyFiscalYearToDate();
    _setActiveToggle('btn-date-fiscal-ytd');
  } else if (filterName === 'last_fiscal_year') {
    _applyLastFiscalYear();
    _setActiveToggle('btn-date-last-fiscal-year');
  } else if (filterName === 'custom') {
    _activateCustomRange();
    _setActiveToggle('btn-date-custom');
  }

  _saveActiveDateFilter(filterName);
  _recordDateFilterActivity(true);
  renderTransactionTable();
}

/**
 * Called from dynamically rendered month buttons.
 */
function toggleMonthFilter(year, month) {
  const monthKey = `month_${year}_${month}`;
  const currentActive = _activeDateFilterName();

  if (currentActive === monthKey) {
    _deactivateDateFilter();
    return;
  }

  _applyMonth(year, month);
  _setActiveMonthButton(year, month);
  _hideCustomRangeInputs();
  _saveActiveDateFilter(monthKey);
  localStorage.setItem(DATE_FILTER_MONTH_KEY, `${year}_${month}`);
  _recordDateFilterActivity(true);
  renderTransactionTable();
}

function toggleYearFilter(year) {
  const yearKey = `year_${year}`;
  const currentActive = _activeDateFilterName();

  if (currentActive === yearKey) {
    _deactivateDateFilter();
    return;
  }

  _applyYear(year);
  _setActiveYearButton(year);
  _hideCustomRangeInputs();
  _saveActiveDateFilter(yearKey);
  _recordDateFilterActivity(true);
  renderTransactionTable();
}

function _deactivateDateFilter() {
  _clearAllDateToggleStyles();
  _hideCustomRangeInputs();
  // Default baseline is now last 12 months (not all-time)
  _applyLast12Months();
  _setActiveToggle('btn-date-last-12-months');
  _saveActiveDateFilter('last_12_months');
  _recordDateFilterActivity(true);
  renderTransactionTable();
}

// ===== Custom date range =====

function _activateCustomRange() {
  const customInputs = document.getElementById('custom-date-range-inputs');
  if (customInputs) customInputs.style.display = 'inline-flex';

  const savedStart = localStorage.getItem(DATE_FILTER_CUSTOM_START_KEY);
  const savedEnd = localStorage.getItem(DATE_FILTER_CUSTOM_END_KEY);

  let startIso;
  let endIso;
  if (savedStart && savedEnd) {
    startIso = savedStart;
    endIso = savedEnd;
  } else {
    // Default custom range to current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    startIso = _formatDateLocal(monthStart);
    endIso = _formatDateLocal(now);
  }

  setDateInputValue('custom-start-date', startIso);
  setDateInputValue('custom-end-date', endIso);
  document.getElementById('start-date').value = startIso;
  document.getElementById('end-date').value = endIso;
}

function _hideCustomRangeInputs() {
  const customInputs = document.getElementById('custom-date-range-inputs');
  if (customInputs) customInputs.style.display = 'none';
}

function _onCustomDateChange() {
  const customStart = getDateInputValue('custom-start-date');
  const customEnd = getDateInputValue('custom-end-date');
  if (customStart && customEnd) {
    document.getElementById('start-date').value = customStart;
    document.getElementById('end-date').value = customEnd;
    localStorage.setItem(DATE_FILTER_CUSTOM_START_KEY, customStart);
    localStorage.setItem(DATE_FILTER_CUSTOM_END_KEY, customEnd);
    renderTransactionTable();
  }
}

/**
 * Show the ledger from a given day onward. Goes through the custom range,
 * the one filter that holds an arbitrary start date, so the range survives
 * the next refresh and the toggles show what is applied. The end date is
 * left where it is.
 * @param {string} startIso - YYYY-MM-DD.
 */
function showLedgerFromDate(startIso) {
  if (!startIso) return;
  const endIso = document.getElementById('end-date').value || _futureEndDateStr();
  localStorage.setItem(DATE_FILTER_CUSTOM_START_KEY, startIso);
  localStorage.setItem(DATE_FILTER_CUSTOM_END_KEY, endIso);
  _saveActiveDateFilter('custom');
  _recordDateFilterActivity(true);
  _activateCustomRange();
  _setActiveToggle('btn-date-custom');
  renderTransactionTable();
}

// ===== Last-activity tracking =====

/**
 * Decide whether the remembered date chip should be restored at page open.
 * A missing or unreadable timestamp counts as stale, so browsers that
 * predate the timestamp pick up the Settings default once.
 *
 * @param {string|null} storedChip - the stored active-filter name, if any
 * @param {string|number|null} storedActivityMs - stored last-activity epoch ms
 * @param {number} nowMs - the current epoch ms
 * @returns {boolean} true to restore the chip, false to apply the Settings default
 */
function _shouldRestoreSavedDateFilter(storedChip, storedActivityMs, nowMs) {
  if (!storedChip) return false;
  if (storedActivityMs === null || storedActivityMs === undefined || storedActivityMs === '') return false;
  const activityMs = Number(storedActivityMs);
  if (!Number.isFinite(activityMs)) return false;
  const ageMs = nowMs - activityMs;
  return ageMs >= 0 && ageMs <= DATE_FILTER_STALE_AFTER_MS;
}

/**
 * Record that the user is active on the Transactions page.
 *
 * @param {boolean} [force=false] - skip the write throttle
 */
function _recordDateFilterActivity(force = false) {
  const nowMs = Date.now();
  if (!force && nowMs - _lastDateFilterActivityWriteMs < DATE_FILTER_ACTIVITY_WRITE_INTERVAL_MS) return;
  _lastDateFilterActivityWriteMs = nowMs;
  try {
    localStorage.setItem(DATE_FILTER_LAST_ACTIVITY_KEY, String(nowMs));
  } catch (error) {
    // Storage can be full or blocked; the chip just falls back to the default next time.
  }
}

/**
 * Refresh the last-activity timestamp on any user interaction with the page.
 * Called once from main.js. Scroll does not bubble, so it is captured.
 */
function initDateFilterActivityTracking() {
  const onActivity = () => _recordDateFilterActivity();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(eventName => {
    document.addEventListener(eventName, onActivity, { passive: true });
  });
  document.addEventListener('scroll', onActivity, { capture: true, passive: true });
}

// ===== Initialization =====

/**
 * Called on page load from main.js. Sets "all dates" baseline,
 * then restores any saved toggle from localStorage.
 */
function setDefaultDates() {
  // Default baseline is last 12 months (fast initial render)
  _applyLast12Months();
  _refreshFiscalChips();

  const fiscalStartMonth = getFiscalStartMonth();
  const storedFilter = _activeDateFilterName();
  const shouldRestore = _shouldRestoreSavedDateFilter(
    storedFilter,
    localStorage.getItem(DATE_FILTER_LAST_ACTIVITY_KEY),
    Date.now(),
  );
  _recordDateFilterActivity(true);

  if (!shouldRestore) {
    // Nothing saved, or the page sat idle too long — use the user's defaultDateRange config
    const configRange = _resolveDateFilterName(getAppConfig().defaultDateRange, fiscalStartMonth);
    const mapped = _mapConfigRangeToFilter(configRange);
    mapped.apply();
    if (mapped.buttonId) _setActiveToggle(mapped.buttonId);
    _saveActiveDateFilter(mapped.filterName);
    return;
  }

  const savedFilter = _resolveDateFilterName(storedFilter, fiscalStartMonth);
  if (savedFilter !== storedFilter) {
    _saveActiveDateFilter(savedFilter);
  }
  _restoreSavedToggleFilter(savedFilter);
}

/**
 * Re-apply a saved filter's dates and highlight without re-rendering
 * (main.js renders later).
 *
 * @param {string} savedFilter - the stored active-filter name
 */
function _restoreSavedToggleFilter(savedFilter) {
  if (savedFilter === 'last_12_months') {
    _applyLast12Months();
    _setActiveToggle('btn-date-last-12-months');
  } else if (savedFilter === 'all') {
    _applyAllTimeDates();
    _setActiveToggle('btn-date-all');
  } else if (savedFilter === 'mtd') {
    _applyMonthToDate();
    _setActiveToggle('btn-date-mtd');
  } else if (savedFilter === 'last_month') {
    _applyLastMonth();
    _setActiveToggle('btn-date-last-month');
  } else if (savedFilter === 'custom') {
    _activateCustomRange();
    _setActiveToggle('btn-date-custom');
  } else if (savedFilter === 'ytd') {
    _applyYearToDate();
    _setActiveToggle('btn-date-ytd');
  } else if (savedFilter === 'last_year') {
    _applyLastYear();
    _setActiveToggle('btn-date-last-year');
  } else if (savedFilter === 'fiscal_ytd') {
    _applyFiscalYearToDate();
    _setActiveToggle('btn-date-fiscal-ytd');
  } else if (savedFilter === 'last_fiscal_year') {
    _applyLastFiscalYear();
    _setActiveToggle('btn-date-last-fiscal-year');
  } else if (savedFilter.startsWith('year_')) {
    const yearStr = savedFilter.replace('year_', '');
    _applyYear(parseInt(yearStr, 10));
    // Button highlighting happens after renderDynamicPeriodButtons builds the DOM
  } else if (savedFilter.startsWith('month_')) {
    const savedMonth = localStorage.getItem(DATE_FILTER_MONTH_KEY);
    if (savedMonth) {
      const [yearStr, monthStr] = savedMonth.split('_');
      _applyMonth(parseInt(yearStr, 10), parseInt(monthStr, 10));
      // Button highlighting happens after renderDynamicPeriodButtons builds the DOM
    }
  }
}

/**
 * Open the settings modal (replaces the old collapsible config panel).
 */
function openConfigModal() {
  document.getElementById('config-modal').classList.remove('hidden');
}

/**
 * Close the settings modal.
 */
function closeConfigModal() {
  document.getElementById('config-modal').classList.add('hidden');
}

// ===== Helper: latest transaction date =====

function _latestTransactionDate() {
  let latestDateStr = null;
  if (transactions && transactions.length > 0) {
    latestDateStr = transactions.reduce((latest, txn) => {
      if (!latest || txn.date > latest) return txn.date;
      return latest;
    }, null);
  }
  return latestDateStr ? new Date(latestDateStr) : new Date();
}

// ===== Dynamic Month Buttons (last 6 months) =====

/**
 * Refresh forecast-aware date ranges after transactions/settings change.
 * The forecast horizon caps projected future rows; it should not expand to
 * the furthest MANUAL_FUTURE row in the payload.
 */
function autoExtendEndDateForScheduled() {
  _refreshDateFilterWindowForForecastHorizon();

  // When "Show All Dates" is active, snap start-date to real earliest txn.
  // Otherwise the default (last_12_months) handles itself.
  const activeFilter = _activeDateFilterName();
  if (activeFilter === 'all') {
    document.getElementById('start-date').value = _allTimeStartDate();
  }
}

const MONTH_CHIP_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Chips that are always in the row, in transactions.html.
const ALWAYS_SHOWN_DATE_CHIP_IDS = [
  'btn-date-last-12-months', 'btn-date-mtd', 'btn-date-ytd',
  'btn-date-last-month', 'btn-date-last-year',
  'btn-date-custom', 'btn-date-all',
];
// Chips in transactions.html shown only when the fiscal year differs from
// the calendar year.
const FISCAL_DATE_CHIP_IDS = ['btn-date-fiscal-ytd', 'btn-date-last-fiscal-year'];

/**
 * The six month chips: the months before last month, oldest first. The
 * current month (MTD) and last month (Last Month) have their own chips.
 *
 * @param {Date} now
 * @returns {Array<{year: number, month: number, label: string}>} month is 0-11
 */
function _monthChips(now) {
  const months = [];
  for (let offset = 7; offset >= 2; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({ year: date.getFullYear(), month: date.getMonth() });
  }

  const multiYear = months[0].year !== months[months.length - 1].year;
  return months.map(entry => ({
    ...entry,
    label: multiYear
      ? `${MONTH_CHIP_NAMES[entry.month]} '${String(entry.year).slice(-2)}`
      : MONTH_CHIP_NAMES[entry.month],
  }));
}

/**
 * The year chips: every fiscal year from the one holding the earliest
 * transaction up to the one before the last finished fiscal year (the
 * current one and the last one have their own chips). With a January start
 * these are calendar years, ending two years ago.
 *
 * @param {string|null} earliestDateStr - YYYY-MM-DD of the earliest real transaction
 * @param {Date} now
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {number[]} fiscal years, oldest first
 */
function _yearChipYears(earliestDateStr, now, fiscalStartMonth) {
  if (!earliestDateStr) return [];
  // Build the date from its parts: parsing an ISO date gives UTC midnight,
  // which is the previous day west of Greenwich.
  const [year, month, day] = earliestDateStr.slice(0, 10).split('-').map(Number);
  const earliestDate = new Date(year, month - 1, day);
  const firstYear = currentFiscalYearRange(earliestDate, fiscalStartMonth).fiscalYear;
  const lastYear = lastFiscalYearRange(now, fiscalStartMonth).fiscalYear - 1;
  const years = [];
  for (let fiscalYear = firstYear; fiscalYear <= lastYear; fiscalYear++) {
    years.push(fiscalYear);
  }
  return years;
}

/**
 * Every chip the date row shows, in one place: what is always there, what
 * the fiscal setting adds, and what the transaction history adds.
 *
 * The year chips make the row long for a deep history. So the fiscal chips
 * do not make that row longer still, once there are year chips the fiscal
 * row is exactly as long as the calendar row: the two fiscal chips, and any
 * year chip more than the calendar row would have, take the slots of the
 * oldest month chips. A history too short to have year chips keeps all six
 * months.
 *
 * @param {Date} now
 * @param {string|null} earliestDateStr - YYYY-MM-DD of the earliest real transaction
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {{alwaysShownIds: string[], fiscalIds: string[],
 *   months: Array<{year: number, month: number, label: string}>,
 *   years: number[], total: number}}
 */
function _dateChipPlan(now, earliestDateStr, fiscalStartMonth) {
  const fiscalIds = hasDistinctFiscalYear(fiscalStartMonth) ? FISCAL_DATE_CHIP_IDS.slice() : [];
  const years = _yearChipYears(earliestDateStr, now, fiscalStartMonth);
  const calendarYearCount = _yearChipYears(earliestDateStr, now, CALENDAR_YEAR_START_MONTH).length;
  const allMonths = _monthChips(now);
  const historyIsLong = years.length > 0;
  let months = allMonths;
  if (historyIsLong) {
    const slotsTaken = fiscalIds.length + years.length - calendarYearCount;
    months = allMonths.slice(Math.max(0, Math.min(allMonths.length, slotsTaken)));
  }
  return {
    alwaysShownIds: ALWAYS_SHOWN_DATE_CHIP_IDS.slice(),
    fiscalIds,
    months,
    years,
    total: ALWAYS_SHOWN_DATE_CHIP_IDS.length + fiscalIds.length + months.length + years.length,
  };
}

/**
 * Date of the earliest real transaction loaded, or null when there is none.
 * System rows (investment trending, opening balances, reconciliation) are
 * skipped: they can predate real data.
 *
 * @returns {string|null} YYYY-MM-DD
 */
function _earliestTransactionDateStr() {
  return (transactions || []).reduce((min, txn) => {
    if (isSystemType(getTransactionType(txn))) return min;
    return (!min || txn.date < min) ? txn.date : min;
  }, null);
}

/** The chip plan for the loaded transactions and the saved fiscal setting. */
function _currentDateChipPlan() {
  return _dateChipPlan(new Date(), _earliestTransactionDateStr(), getFiscalStartMonth());
}

/**
 * Render the month chips the plan allows as individual toggle buttons.
 * Also re-highlights a saved month toggle if one was active.
 */
function renderDynamicPeriodButtons() {
  const container = document.getElementById('date-month-buttons');
  if (!container) return;

  let html = '';
  _currentDateChipPlan().months.forEach(chip => {
    html += `<button id="btn-month-${chip.year}-${chip.month}" `
          + `class="btn-date-toggle btn-date-month" `
          + `onclick="toggleMonthFilter(${chip.year}, ${chip.month})">`
          + `${chip.label}</button>`;
  });

  container.innerHTML = html;

  // Restore active month highlight if one was saved
  const savedFilter = _activeDateFilterName();
  if (savedFilter && savedFilter.startsWith('month_')) {
    const savedMonth = localStorage.getItem(DATE_FILTER_MONTH_KEY);
    if (savedMonth) {
      const [yearStr, monthStr] = savedMonth.split('_');
      _setActiveMonthButton(parseInt(yearStr, 10), parseInt(monthStr, 10));
    }
  }

  // Render year buttons for historical data (2+ years old)
  _renderDynamicYearButtons();
}

/**
 * A year chip's text and tooltip: "FY2024" with its dates when the fiscal
 * year is not the calendar year, the bare year otherwise.
 *
 * @param {number} year - the fiscal year
 * @param {number} fiscalStartMonth - month 1-12
 * @returns {{label: string, title: string}}
 */
function _yearChipText(year, fiscalStartMonth) {
  if (!hasDistinctFiscalYear(fiscalStartMonth)) {
    return { label: String(year), title: '' };
  }
  const label = fiscalYearLabel(year);
  const range = fiscalYearRange(year, fiscalStartMonth);
  return { label, title: `${label}: ${formatFiscalRangeShort(range)}` };
}

/**
 * Render the year chips for the loaded history.
 */
function _renderDynamicYearButtons() {
  const container = document.getElementById('date-year-buttons');
  if (!container) return;

  const plan = _currentDateChipPlan();
  const fiscalStartMonth = getFiscalStartMonth();

  let html = '';
  plan.years.forEach(year => {
    const text = _yearChipText(year, fiscalStartMonth);
    html += `<button id="btn-year-${year}" `
          + `class="btn-date-toggle btn-date-year" `
          + `title="${text.title}" `
          + `onclick="toggleYearFilter(${year})">`
          + `${text.label}</button>`;
  });

  container.innerHTML = html;

  // Restore active year highlight if one was saved
  const savedFilter = _activeDateFilterName();
  if (savedFilter && savedFilter.startsWith('year_')) {
    const yearStr = savedFilter.replace('year_', '');
    _setActiveYearButton(parseInt(yearStr, 10));
  }
}

/**
 * Attach change listeners to the custom date inputs.
 * Called once from main.js init.
 */
function initCustomDateListeners() {
  const customStart = document.getElementById('custom-start-date');
  const customEnd = document.getElementById('custom-end-date');
  if (customStart) customStart.addEventListener('change', _onCustomDateChange);
  if (customEnd) customEnd.addEventListener('change', _onCustomDateChange);
}

// ===== Category Filter — Smart Text Box =====

/**
 * Initialize the category filter text box with autocomplete.
 * Called once from main.js after categories are loaded.
 */
function initCategoryFilterInput() {
  const input = document.getElementById('filter-category-input');
  if (!input) return;

  // One delegated handler on the list, so every render path (including the
  // empty-query primaries list) gets clickable items. mousedown with
  // preventDefault keeps focus on the input, so the blur timer never clears
  // the list before the selection applies.
  const acList = document.getElementById('filter-category-ac-list');
  if (acList) {
    acList.addEventListener('mousedown', function(mouseEvent) {
      const item = mouseEvent.target.closest('.filter-ac-item');
      if (!item) return;
      mouseEvent.preventDefault();
      _applyCategoryFilterFromItem(item);
    });
  }

  // Show autocomplete on input
  input.addEventListener('input', function() {
    _showFilterCategoryAutocomplete(this.value);
  });

  // Select all on focus for easy replacement
  input.addEventListener('focus', function() {
    selectAllOnFocus(this);
    _showFilterCategoryAutocomplete(this.value);
  });

  // Hide autocomplete on blur (delayed so click can fire first)
  input.addEventListener('blur', function() {
    setTimeout(() => {
      const list = document.getElementById('filter-category-ac-list');
      if (list) { list.innerHTML = ''; list.style.display = 'none'; }
    }, 200);
  });

  // Keyboard navigation
  input.addEventListener('keydown', function(event) {
    const list = document.getElementById('filter-category-ac-list');
    const items = list ? list.querySelectorAll('.filter-ac-item') : [];
    const activeItem = list ? list.querySelector('.filter-ac-item.active') : null;
    let activeIndex = -1;
    items.forEach((item, idx) => { if (item === activeItem) activeIndex = idx; });

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = Math.min(activeIndex + 1, items.length - 1);
      items.forEach(item => item.classList.remove('active'));
      if (items[next]) { items[next].classList.add('active'); items[next].scrollIntoView({ block: 'nearest' }); }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = Math.max(activeIndex - 1, 0);
      items.forEach(item => item.classList.remove('active'));
      if (items[prev]) { items[prev].classList.add('active'); items[prev].scrollIntoView({ block: 'nearest' }); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = activeItem || (items.length > 0 ? items[0] : null);
      if (active) {
        _applyCategoryFilterFromItem(active);
      } else {
        // Apply whatever is typed manually
        _applyCategoryFilterFromText(this.value);
      }
      if (list) { list.innerHTML = ''; list.style.display = 'none'; }
    } else if (event.key === 'Escape') {
      if (list) { list.innerHTML = ''; list.style.display = 'none'; }
    }
  });
}

/**
 * Build and show the autocomplete dropdown for the category filter.
 * Groups results into two tiers:
 *   1. Primary categories (if query matches a primary name)
 *   2. Specific "Primary: Detailed" categories
 * This lets the user pick a broad primary OR a specific detailed.
 */
function _showFilterCategoryAutocomplete(query) {
  const list = document.getElementById('filter-category-ac-list');
  if (!list) return;

  const suggestions = buildFilterSuggestions(availableCategories, hiddenCategories, query);

  if (suggestions.isOpeningList) {
    // Show all primaries when input is empty (user sees what's available)
    if (suggestions.primaries.length === 0) { list.innerHTML = ''; list.style.display = 'none'; return; }
    let html = '<div class="filter-ac-section-label">Primary Categories</div>';
    suggestions.primaries.forEach((entry, idx) => {
      html += `<div class="filter-ac-item${idx === 0 ? ' active' : ''}" data-type="primary" data-value="${escapeHtml(entry.value)}">${escapeHtml(entry.value)}</div>`;
    });
    list.innerHTML = html;
    list.style.display = 'block';
    return;
  }

  const matchingPrimaries = suggestions.primaries;
  const filteredDetailed = suggestions.detailed;

  if (matchingPrimaries.length === 0 && filteredDetailed.length === 0) {
    list.innerHTML = '<div class="filter-ac-empty">No matching categories</div>';
    list.style.display = 'block';
    return;
  }

  // Hidden ones are not in the opening list, so the tag says why this one
  // only turns up once the user types.
  const itemHtml = (entry, type, isFirst) => {
    const tag = entry.hidden ? '<span class="filter-ac-hidden-tag">hidden</span>' : '';
    return `<div class="filter-ac-item${isFirst ? ' active' : ''}" data-type="${type}" data-value="${escapeHtml(entry.value)}">${_highlightFilterMatch(entry.value, query)}${tag}</div>`;
  };

  let html = '';
  let firstItem = true;

  // Primaries section
  if (matchingPrimaries.length > 0) {
    html += '<div class="filter-ac-section-label">Primary Categories (shows all under this group)</div>';
    matchingPrimaries.forEach(entry => {
      html += itemHtml(entry, 'primary', firstItem);
      firstItem = false;
    });
  }

  // Detailed section (limit to prevent overwhelming list)
  const maxDetailed = 15;
  const shownDetailed = filteredDetailed.slice(0, maxDetailed);
  if (shownDetailed.length > 0) {
    html += '<div class="filter-ac-section-label">Specific Categories</div>';
    shownDetailed.forEach(entry => {
      html += itemHtml(entry, 'detailed', firstItem);
      firstItem = false;
    });
    if (filteredDetailed.length > maxDetailed) {
      html += `<div class="filter-ac-more">${filteredDetailed.length - maxDetailed} more…</div>`;
    }
  }

  list.innerHTML = html;
  list.style.display = 'block';
}

/**
 * Highlight matching text in category filter autocomplete results.
 */
function _highlightFilterMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return escapeHtml(text).replace(regex, '<strong>$1</strong>');
}

/**
 * Apply the category filter from a clicked/selected autocomplete item.
 */
function _applyCategoryFilterFromItem(itemElement) {
  const filterType = itemElement.getAttribute('data-type');
  const filterValue = itemElement.getAttribute('data-value');
  const input = document.getElementById('filter-category-input');

  if (filterType === 'primary') {
    filterPrimaryCategory = filterValue;
    filterDetailedCategory = '';
    if (input) input.value = filterValue;
  } else {
    // Detailed: parse into primary + detailed
    const parsed = parseCategoryString(filterValue);
    filterPrimaryCategory = parsed.primary;
    filterDetailedCategory = parsed.detailed;
    if (input) input.value = filterValue;
  }

  const list = document.getElementById('filter-category-ac-list');
  if (list) { list.innerHTML = ''; list.style.display = 'none'; }

  renderTransactionTable();
}

/**
 * Apply the category filter from manually typed text (Enter key without selection).
 * Smart matching: if the text matches a known primary exactly, filter by primary.
 * If it matches a "Primary: Detailed", filter by both. Otherwise treat as primary search.
 */
function _applyCategoryFilterFromText(text) {
  const trimmed = (text || '').trim();
  const input = document.getElementById('filter-category-input');

  if (!trimmed) {
    filterPrimaryCategory = '';
    filterDetailedCategory = '';
    renderTransactionTable();
    return;
  }

  // Hidden labels are matched too: a hidden category is not offered when the
  // box opens, but it can be typed or linked to.
  const resolved = resolveFilterCategoryText(trimmed, availableCategories, hiddenCategories);
  filterPrimaryCategory = resolved.primary;
  filterDetailedCategory = resolved.detailed;
  if (input && resolved.display !== null) input.value = resolved.display;
  renderTransactionTable();
}

/**
 * Show or hide the batch unhide toolbar to match the show-hidden toggle.
 */
function syncBatchUnhideToolbar() {
  const toggle = document.getElementById('show-hidden-toggle');
  const toolbar = document.getElementById('batch-unhide-toolbar');
  if (toggle && toolbar) toolbar.classList.toggle('hidden', !toggle.checked);
}

/**
 * Turn the show-hidden toggle on without a click. The toggle is never saved,
 * so this lasts for the page load and the user can switch it back off.
 */
function showHiddenRowsForThisPage() {
  const toggle = document.getElementById('show-hidden-toggle');
  if (!toggle || toggle.checked) return;
  toggle.checked = true;
  // The toggle's change handler is attached later in start-up, so its
  // toolbar step is done here; the caller redraws the table.
  syncBatchUnhideToolbar();
}

/**
 * Fill and apply the Category filter box from a ?category= address
 * parameter, the same way as typing the text and pressing Enter. Called after
 * the category lists are loaded, since a hidden label is only known from them.
 */
function applyCategoryDeepLink() {
  const { category, showsHiddenRows } = parseTransactionsDeepLink(window.location.search);
  if (!category) return;
  if (showsHiddenRows) showHiddenRowsForThisPage();
  const input = document.getElementById('filter-category-input');
  if (input) input.value = category;
  _applyCategoryFilterFromText(category);
}

/**
 * Clear all category filters and refresh the table.
 */
function clearCategoryFilters() {
  filterPrimaryCategory = '';
  filterDetailedCategory = '';
  
  const input = document.getElementById('filter-category-input');
  if (input) input.value = '';
  
  // Re-render table
  renderTransactionTable();
}
