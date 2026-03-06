// ============================================================
// transactions/filters.js — Date, Account & Category Filtering
// Date range helpers, quick-range shortcuts, dynamic period
// buttons, and category filter dropdown management.
// ============================================================

// localStorage keys for remembering user's last date range selection
const DATE_RANGE_PRESET_KEY = 'pf_date_range_preset';
const DATE_RANGE_START_KEY = 'pf_date_range_start';
const DATE_RANGE_END_KEY = 'pf_date_range_end';

// Delegates to toISODateStr() from date-helpers.js
function _formatDateLocal(date) {
  return toISODateStr(date);
}

/**
 * Save the current date range selection to localStorage.
 * Stores both the preset name (for quick-range button highlighting)
 * and the actual start/end values (for restoration on reload).
 */
function _saveDateRangeToStorage(presetName) {
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  localStorage.setItem(DATE_RANGE_PRESET_KEY, presetName || 'custom');
  localStorage.setItem(DATE_RANGE_START_KEY, startDate);
  localStorage.setItem(DATE_RANGE_END_KEY, endDate);
}

function setDefaultDates() {
  // Check if user has a saved date range from a previous session
  const savedPreset = localStorage.getItem(DATE_RANGE_PRESET_KEY);
  const savedStart = localStorage.getItem(DATE_RANGE_START_KEY);
  const savedEnd = localStorage.getItem(DATE_RANGE_END_KEY);

  if (savedPreset && savedStart && savedEnd) {
    // Restore the saved dates directly — they already reflect the preset
    document.getElementById('start-date').value = savedStart;
    document.getElementById('end-date').value = savedEnd;

    // For relative presets (MTD, Last Month), recalculate to current calendar
    // so the dates stay meaningful after midnight rolls over
    if (savedPreset === 'mtd') {
      _applyMonthToDate();
    } else if (savedPreset === 'last_month') {
      _applyLastMonth();
    }
    // For 'earliest', 'period_year', 'period_month', 'custom': keep saved dates as-is
    // (earliest will be re-evaluated after transactions load anyway)
    return;
  }

  // No saved preference — fall back to Month-to-Date default
  _applyMonthToDate();
}

/**
 * Internal: set date inputs to Month-to-Date without triggering render/save.
 */
function _applyMonthToDate() {
  const end = new Date();
  const start = new Date();
  let today = new Date();
  if (today.getDate() === 1) {
    start.setMonth(start.getMonth() - 1);
  } else {
    start.setDate(1);
  }
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(end);
}

/**
 * Internal: set date inputs to Last Month without triggering render/save.
 */
function _applyLastMonth() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(end);
}

function setEarliestToDate() {
  // Find the earliest transaction date from synced data
  let earliestDate = null;
  if (transactions && transactions.length > 0) {
    earliestDate = transactions.reduce((earliest, txn) => {
      if (!earliest || txn.date < earliest) {
        return txn.date;
      }
      return earliest;
    }, null);
  }
  
  // If we found an earliest date, use it; otherwise fall back to 90 days ago
  let start;
  if (earliestDate) {
    start = new Date(earliestDate);
  } else {
    start = new Date();
    start.setDate(start.getDate() - 90);
  }
  
  document.getElementById('start-date').value = _formatDateLocal(start);
  // Reset end-date to encompass all future/scheduled transactions.
  // Without this, a stale end-date from a previous filter (e.g. "last month")
  // would cut off current and future transactions.
  document.getElementById('end-date').value = _formatDateLocal(_latestTransactionDate());
  _saveDateRangeToStorage('earliest');
  renderTransactionTable();
}

function setMonthToDate() {
  const start = new Date();
  const today = new Date();
  if (today.getDate() === 1) {
    start.setMonth(start.getMonth() - 1);
  } else {
    start.setDate(1);
  }
  document.getElementById('start-date').value = _formatDateLocal(start);
  // Reset end-date to encompass all future/scheduled transactions.
  document.getElementById('end-date').value = _formatDateLocal(_latestTransactionDate());
  _saveDateRangeToStorage('mtd');
  renderTransactionTable();
}

function setLastMonth() {
  _applyLastMonth();
  _saveDateRangeToStorage('last_month');
  renderTransactionTable();
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

/**
 * Toggle the expense chart modal open/closed.
 * Replaces the old openChartModal so the same 📊 button opens AND closes the chart.
 */
function toggleChartModal() {
  const modal = document.getElementById('chart-modal');
  if (modal.classList.contains('hidden')) {
    modal.classList.remove('hidden');
    // Re-render chart when modal opens so canvas sizes correctly
    renderCategoryChart();
  } else {
    modal.classList.add('hidden');
  }
}

/**
 * Close the expense chart modal.
 */
function closeChartModal() {
  document.getElementById('chart-modal').classList.add('hidden');
}

// ===== Helper: latest transaction date =====

/**
 * Returns a Date representing the latest transaction date across all loaded
 * transactions (including scheduled/future). Falls back to today if no
 * transactions are loaded. Used by quick-range shortcuts (earliest, MTD) to
 * guarantee the end-date always encompasses future bills.
 */
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

// ===== Dynamic Period Buttons =====

/**
 * Auto-extend the end-date to include all scheduled/future transactions.
 * Called after transactions are loaded so that future bill occurrences
 * are always visible without manual date range adjustment.
 */
function autoExtendEndDateForScheduled() {
  if (!transactions || transactions.length === 0) return;

  const latestScheduledDate = transactions.reduce((latest, txn) => {
    const txnType = getTransactionType(txn);
    if (txnType === TXN_TYPE.BILL_FUTURE || txnType === TXN_TYPE.MANUAL_FUTURE) {
      if (!latest || txn.date > latest) return txn.date;
    }
    return latest;
  }, null);

  if (!latestScheduledDate) return;

  const currentEndDate = document.getElementById('end-date').value;
  if (latestScheduledDate > currentEndDate) {
    document.getElementById('end-date').value = latestScheduledDate;
  }
}

function renderDynamicPeriodButtons() {
  const container = document.getElementById('dynamic-period-buttons');
  if (!container) return;
  
  if (!transactions || transactions.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  // Find earliest and latest transaction dates
  let earliest = null;
  let latest = null;
  
  transactions.forEach(txn => {
    if (!earliest || txn.date < earliest) earliest = txn.date;
    if (!latest || txn.date > latest) latest = txn.date;
  });
  
  if (!earliest || !latest) {
    container.innerHTML = '';
    return;
  }
  
  const earliestDate = new Date(earliest);
  const latestDate = new Date(latest);
  
  // Calculate span in days
  const daysDiff = Math.ceil((latestDate - earliestDate) / (1000 * 60 * 60 * 24));
  
  // If span is 2+ years, show year buttons; otherwise show month buttons
  if (daysDiff >= 730) {
    renderYearButtons(container, earliestDate, latestDate);
  } else {
    renderMonthButtons(container, earliestDate, latestDate);
  }
}

function renderYearButtons(container, earliestDate, latestDate) {
  const startYear = earliestDate.getFullYear();
  const endYear = latestDate.getFullYear();
  
  let html = '<span style="font-size: 14px; font-weight: 500; color: #666;">Quick Select:</span>';
  
  for (let year = startYear; year <= endYear; year++) {
    html += `<button onclick="setPeriodYear(${year})" class="secondary" style="padding: 4px 10px; font-size: 12px;">${year}</button>`;
  }
  
  container.innerHTML = html;
}

function renderMonthButtons(container, earliestDate, latestDate) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let html = '<span style="font-size: 14px; font-weight: 500; color: #666;">Quick Select:</span>';
  
  // Build list of year-month combinations
  const months = [];
  let current = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
  const end = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  
  while (current <= end) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth(),
      label: monthNames[current.getMonth()]
    });
    current.setMonth(current.getMonth() + 1);
  }
  
  // If multiple years, show year prefix for clarity
  const multiYear = months.length > 0 && months[0].year !== months[months.length - 1].year;
  
  months.forEach(m => {
    const label = multiYear ? `${m.label} '${String(m.year).slice(-2)}` : m.label;
    html += `<button onclick="setPeriodMonth(${m.year}, ${m.month})" class="secondary" style="padding: 4px 10px; font-size: 12px;">${label}</button>`;
  });
  
  container.innerHTML = html;
}

function setPeriodYear(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const today = new Date();
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(actualEnd);
  _saveDateRangeToStorage('period_year');
  renderTransactionTable();
}

function setPeriodMonth(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const today = new Date();
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = _formatDateLocal(start);
  document.getElementById('end-date').value = _formatDateLocal(actualEnd);
  _saveDateRangeToStorage('period_month');
  renderTransactionTable();
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
