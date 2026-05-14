// ============================================================
// transactions/filters.js — Date, Account & Category Filtering
// Toggle-style date range buttons, dynamic month shortcuts,
// custom date range picker, and category filter dropdown.
// ============================================================

// localStorage key for the active date filter toggle
const DATE_FILTER_ACTIVE_KEY = 'pf_date_filter_active';
// For custom range, remember user-entered start/end
const DATE_FILTER_CUSTOM_START_KEY = 'pf_date_filter_custom_start';
const DATE_FILTER_CUSTOM_END_KEY = 'pf_date_filter_custom_end';
// For month buttons, remember which year+month was selected
const DATE_FILTER_MONTH_KEY = 'pf_date_filter_month';
const DEFAULT_FORECAST_HORIZON_DAYS = 90;
const MAX_FORECAST_HORIZON_DAYS = 365;

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
  const activeFilter = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);

  if (activeFilter === 'all') {
    _applyAllTimeDates();
  } else if (activeFilter === 'mtd') {
    _applyMonthToDate();
  } else if (activeFilter === 'ytd') {
    _applyYearToDate();
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
 * Set start-date/end-date to the last 12 months from today,
 * plus the forecast horizon into the future so projected rows
 * are visible by default.
 */
function _applyLast12Months() {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _futureEndDateStr();
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

function _applyYear(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(end);
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
  const currentActive = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);

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
  } else if (filterName === 'custom') {
    _activateCustomRange();
    _setActiveToggle('btn-date-custom');
  }

  localStorage.setItem(DATE_FILTER_ACTIVE_KEY, filterName);
  renderTransactionTable();
}

/**
 * Called from dynamically rendered month buttons.
 */
function toggleMonthFilter(year, month) {
  const monthKey = `month_${year}_${month}`;
  const currentActive = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);

  if (currentActive === monthKey) {
    _deactivateDateFilter();
    return;
  }

  _applyMonth(year, month);
  _setActiveMonthButton(year, month);
  _hideCustomRangeInputs();
  localStorage.setItem(DATE_FILTER_ACTIVE_KEY, monthKey);
  localStorage.setItem(DATE_FILTER_MONTH_KEY, `${year}_${month}`);
  renderTransactionTable();
}

function toggleYearFilter(year) {
  const yearKey = `year_${year}`;
  const currentActive = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);

  if (currentActive === yearKey) {
    _deactivateDateFilter();
    return;
  }

  _applyYear(year);
  _setActiveYearButton(year);
  _hideCustomRangeInputs();
  localStorage.setItem(DATE_FILTER_ACTIVE_KEY, yearKey);
  renderTransactionTable();
}

function _deactivateDateFilter() {
  _clearAllDateToggleStyles();
  _hideCustomRangeInputs();
  // Default baseline is now last 12 months (not all-time)
  _applyLast12Months();
  _setActiveToggle('btn-date-last-12-months');
  localStorage.setItem(DATE_FILTER_ACTIVE_KEY, 'last_12_months');
  renderTransactionTable();
}

// ===== Custom date range =====

function _activateCustomRange() {
  const customInputs = document.getElementById('custom-date-range-inputs');
  if (customInputs) customInputs.style.display = 'inline-flex';

  const savedStart = localStorage.getItem(DATE_FILTER_CUSTOM_START_KEY);
  const savedEnd = localStorage.getItem(DATE_FILTER_CUSTOM_END_KEY);
  const customStartInput = document.getElementById('custom-start-date');
  const customEndInput = document.getElementById('custom-end-date');

  if (savedStart && savedEnd) {
    customStartInput.value = savedStart;
    customEndInput.value = savedEnd;
    document.getElementById('start-date').value = savedStart;
    document.getElementById('end-date').value = savedEnd;
  } else {
    // Default custom range to current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    customStartInput.value = _formatDateLocal(monthStart);
    customEndInput.value = _formatDateLocal(now);
    document.getElementById('start-date').value = _formatDateLocal(monthStart);
    document.getElementById('end-date').value = _formatDateLocal(now);
  }
}

function _hideCustomRangeInputs() {
  const customInputs = document.getElementById('custom-date-range-inputs');
  if (customInputs) customInputs.style.display = 'none';
}

function _onCustomDateChange() {
  const customStart = document.getElementById('custom-start-date').value;
  const customEnd = document.getElementById('custom-end-date').value;
  if (customStart && customEnd) {
    document.getElementById('start-date').value = customStart;
    document.getElementById('end-date').value = customEnd;
    localStorage.setItem(DATE_FILTER_CUSTOM_START_KEY, customStart);
    localStorage.setItem(DATE_FILTER_CUSTOM_END_KEY, customEnd);
    renderTransactionTable();
  }
}

// ===== Initialization =====

/**
 * Called on page load from main.js. Sets "all dates" baseline,
 * then restores any saved toggle from localStorage.
 */
function setDefaultDates() {
  // Default baseline is last 12 months (fast initial render)
  _applyLast12Months();

  const savedFilter = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);
  if (!savedFilter) {
    // No saved page-level preference — use the user's defaultDateRange config
    const configRange = getAppConfig().defaultDateRange;
    const mapped = _mapConfigRangeToFilter(configRange);
    mapped.apply();
    if (mapped.buttonId) _setActiveToggle(mapped.buttonId);
    localStorage.setItem(DATE_FILTER_ACTIVE_KEY, mapped.filterName);
    return;
  }

  // Re-apply the saved filter without re-rendering (main.js renders later)
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

function toggleChartModal() {
  toggleCategorySummaryModal();
}

function closeChartModal() {
  closeCategorySummaryModal();
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
  const activeFilter = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);
  if (activeFilter === 'all') {
    document.getElementById('start-date').value = _allTimeStartDate();
  }
}

/**
 * Render the last 6 calendar months as individual toggle buttons.
 * Always shows 6 months regardless of transaction history depth.
 * Also re-highlights a saved month toggle if one was active.
 */
function renderDynamicPeriodButtons() {
  const container = document.getElementById('date-month-buttons');
  if (!container) return;

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const months = [];

  // Build last 6 months, skipping current month (MTD) and last month
  // (Last Month button). So offsets 7→2 give 6 distinct months.
  for (let offset = 7; offset >= 2; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({ year: date.getFullYear(), month: date.getMonth() });
  }

  const multiYear = months[0].year !== months[months.length - 1].year;

  let html = '';
  months.forEach(m => {
    const label = multiYear
      ? `${monthNames[m.month]} '${String(m.year).slice(-2)}`
      : monthNames[m.month];
    html += `<button id="btn-month-${m.year}-${m.month}" `
          + `class="btn-date-toggle btn-date-month" `
          + `onclick="toggleMonthFilter(${m.year}, ${m.month})">`
          + `${label}</button>`;
  });

  container.innerHTML = html;

  // Restore active month highlight if one was saved
  const savedFilter = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);
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
 * Render year buttons for data older than 2 years. Excludes current year
 * (covered by YTD/MTD) and last year (covered by Last Year button).
 * Only appears if transactions exist 2+ calendar years back.
 */
function _renderDynamicYearButtons() {
  const container = document.getElementById('date-year-buttons');
  if (!container) return;

  if (!transactions || transactions.length === 0) {
    container.innerHTML = '';
    return;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const twoYearsAgoThreshold = currentYear - 2;

  // Find the earliest transaction year — exclude system rows (investment
  // trending, opening balances, reconciliation) which can predate real data.
  const earliestDateStr = transactions.reduce((min, txn) => {
    if (isSystemType(getTransactionType(txn))) return min;
    return (!min || txn.date < min) ? txn.date : min;
  }, null);

  if (!earliestDateStr) {
    container.innerHTML = '';
    return;
  }

  const earliestYear = new Date(earliestDateStr).getFullYear();

  // Only show if there are transactions 2+ years old
  if (earliestYear > twoYearsAgoThreshold) {
    container.innerHTML = '';
    return;
  }

  // Build buttons for each year from earliest up to 2 years ago
  // (current year = YTD, last year = Last Year button)
  let html = '';
  for (let year = earliestYear; year <= twoYearsAgoThreshold; year++) {
    html += `<button id="btn-year-${year}" `
          + `class="btn-date-toggle btn-date-year" `
          + `onclick="toggleYearFilter(${year})">`
          + `${year}</button>`;
  }

  container.innerHTML = html;

  // Restore active year highlight if one was saved
  const savedFilter = localStorage.getItem(DATE_FILTER_ACTIVE_KEY);
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

  // Show autocomplete on input
  input.addEventListener('input', function() {
    _showFilterCategoryAutocomplete(this.value);
  });

  // Select all on focus for easy replacement
  input.addEventListener('focus', function() {
    this.select();
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
  const queryLower = (query || '').trim().toLowerCase();

  if (!queryLower) {
    // Show all primaries when input is empty (user sees what's available)
    const primaries = extractPrimaryCategories(availableCategories);
    if (primaries.length === 0) { list.innerHTML = ''; list.style.display = 'none'; return; }
    let html = '<div class="filter-ac-section-label">Primary Categories</div>';
    primaries.forEach((cat, idx) => {
      html += `<div class="filter-ac-item${idx === 0 ? ' active' : ''}" data-type="primary" data-value="${escapeHtml(cat)}">${escapeHtml(cat)}</div>`;
    });
    list.innerHTML = html;
    list.style.display = 'block';
    return;
  }

  // Collect matching primaries
  const primaries = extractPrimaryCategories(availableCategories);
  const matchingPrimaries = primaries.filter(cat => cat.toLowerCase().includes(queryLower));

  // Collect matching full categories (Primary: Detailed)
  let matchingDetailed;
  if (queryLower.includes(':')) {
    const [queryPrimary, queryDetailed] = queryLower.split(':').map(segment => segment.trim());
    matchingDetailed = (availableCategories || []).filter(cat => {
      const lower = cat.toLowerCase();
      const parts = lower.split(':').map(segment => segment.trim());
      const primaryMatch = !queryPrimary || (parts[0] || '').includes(queryPrimary);
      const detailedMatch = !queryDetailed || (parts[1] || '').includes(queryDetailed);
      return primaryMatch && detailedMatch;
    });
  } else {
    matchingDetailed = (availableCategories || []).filter(cat =>
      cat.toLowerCase().includes(queryLower)
    );
  }

  // De-duplicate: remove entries that are just primary-only matches already
  // shown in the primaries section (e.g., "Income" as a full category)
  const primarySet = new Set(matchingPrimaries.map(p => p.toLowerCase()));
  const filteredDetailed = matchingDetailed.filter(cat => {
    const parsed = parseCategoryString(cat);
    // Keep if it has a detailed component, or it's not already shown as a primary
    return parsed.detailed || !primarySet.has(parsed.primary.toLowerCase());
  });

  if (matchingPrimaries.length === 0 && filteredDetailed.length === 0) {
    list.innerHTML = '<div class="filter-ac-empty">No matching categories</div>';
    list.style.display = 'block';
    return;
  }

  let html = '';
  let firstItem = true;

  // Primaries section
  if (matchingPrimaries.length > 0) {
    html += '<div class="filter-ac-section-label">Primary Categories (shows all under this group)</div>';
    matchingPrimaries.forEach(cat => {
      html += `<div class="filter-ac-item${firstItem ? ' active' : ''}" data-type="primary" data-value="${escapeHtml(cat)}">${_highlightFilterMatch(cat, query)}</div>`;
      firstItem = false;
    });
  }

  // Detailed section (limit to prevent overwhelming list)
  const maxDetailed = 15;
  const shownDetailed = filteredDetailed.slice(0, maxDetailed);
  if (shownDetailed.length > 0) {
    html += '<div class="filter-ac-section-label">Specific Categories</div>';
    shownDetailed.forEach(cat => {
      html += `<div class="filter-ac-item${firstItem ? ' active' : ''}" data-type="detailed" data-value="${escapeHtml(cat)}">${_highlightFilterMatch(cat, query)}</div>`;
      firstItem = false;
    });
    if (filteredDetailed.length > maxDetailed) {
      html += `<div class="filter-ac-more">${filteredDetailed.length - maxDetailed} more…</div>`;
    }
  }

  list.innerHTML = html;
  list.style.display = 'block';

  // Attach click handlers
  list.querySelectorAll('.filter-ac-item').forEach(item => {
    item.addEventListener('mousedown', function(mouseEvent) {
      mouseEvent.preventDefault();
      _applyCategoryFilterFromItem(this);
    });
  });
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

  // Check if it's a known exact primary
  const primaries = extractPrimaryCategories(availableCategories);
  const exactPrimary = primaries.find(p => p.toLowerCase() === trimmed.toLowerCase());
  if (exactPrimary) {
    filterPrimaryCategory = exactPrimary;
    filterDetailedCategory = '';
    if (input) input.value = exactPrimary;
    renderTransactionTable();
    return;
  }

  // Check if it's a known full "Primary: Detailed"
  const exactFull = (availableCategories || []).find(c => c.toLowerCase() === trimmed.toLowerCase());
  if (exactFull) {
    const parsed = parseCategoryString(exactFull);
    filterPrimaryCategory = parsed.primary;
    filterDetailedCategory = parsed.detailed;
    if (input) input.value = exactFull;
    renderTransactionTable();
    return;
  }

  // Fallback: treat entire input as a primary filter (fuzzy)
  const fuzzyPrimary = primaries.find(p => p.toLowerCase().includes(trimmed.toLowerCase()));
  if (fuzzyPrimary) {
    filterPrimaryCategory = fuzzyPrimary;
    filterDetailedCategory = '';
    if (input) input.value = fuzzyPrimary;
  } else {
    // No match found — set as-is and let table filtering handle it
    filterPrimaryCategory = trimmed;
    filterDetailedCategory = '';
  }
  renderTransactionTable();
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
