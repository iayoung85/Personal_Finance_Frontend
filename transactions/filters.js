// ============================================================
// transactions/filters.js — Date, Account & Category Filtering
// Date range helpers, quick-range shortcuts, dynamic period
// buttons, and category filter dropdown management.
// ============================================================

function setDefaultDates() {
  const end = new Date();
  const start = new Date();
  let today = new Date();
  if (today.getDate() === 1) {
    // If today is first of month, set start date to first of previous month instead of first of current month
    start.setMonth(start.getMonth() - 1);
  }
  else {
    start.setDate(1); // Default to first of the month
  }
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
}

function setEarliestToDate() {
  const end = new Date();
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
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
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function setMonthToDate() {
  const end = new Date();
  const start = new Date();
  start.setDate(1); // First of the current month
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function setLastMonth() {
  const now = new Date();
  // Get first day of previous month
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // Get last day of previous month (day 0 of current month)
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
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
 * Open the expense chart modal.
 */
function openChartModal() {
  document.getElementById('chart-modal').classList.remove('hidden');
  // Re-render chart when modal opens so canvas sizes correctly
  renderCategoryChart();
}

/**
 * Close the expense chart modal.
 */
function closeChartModal() {
  document.getElementById('chart-modal').classList.add('hidden');
}

// ===== Dynamic Period Buttons =====

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
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const start = new Date(year, 0, 1); // January 1st
  const end = new Date(year, 11, 31); // December 31st
  const today = new Date();
  
  // Don't go beyond today
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(actualEnd);
  renderTransactionTable();
}

function setPeriodMonth(year, month) {
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const start = new Date(year, month, 1); // First day of month
  const end = new Date(year, month + 1, 0); // Last day of month
  const today = new Date();
  
  // Don't go beyond today
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(actualEnd);
  renderTransactionTable();
}

// ===== Category Filter Dropdowns =====

/**
 * Populate the category filter dropdowns with available categories.
 */
function populateCategoryFilterDropdowns() {
  const primarySelect = document.getElementById('filter-primary-category');
  const detailedSelect = document.getElementById('filter-detailed-category');
  
  if (!primarySelect || !detailedSelect) return;
  
  // Get all primary categories
  const primaries = extractPrimaryCategories(availableCategories);
  
  // Build primary dropdown
  let primaryHTML = '<option value="">— All Categories —</option>';
  primaries.forEach(cat => {
    primaryHTML += `<option value="${escapeHtml(cat)}" ${cat === filterPrimaryCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`;
  });
  primarySelect.innerHTML = primaryHTML;
  
  // Build detailed dropdown based on current primary filter
  updateDetailedFilterDropdown();
}

/**
 * Update the detailed category filter dropdown based on selected primary category.
 */
function updateDetailedFilterDropdown() {
  const detailedSelect = document.getElementById('filter-detailed-category');
  if (!detailedSelect) return;
  
  if (!filterPrimaryCategory) {
    // No primary selected - show all detailed categories message
    detailedSelect.innerHTML = '<option value="">— All Detailed Categories —</option>';
    detailedSelect.disabled = false;
    return;
  }
  
  // Get detailed categories for the selected primary
  const detailed = extractDetailedCategories(availableCategories, filterPrimaryCategory);
  
  let detailedHTML = '<option value="">— All Detailed Categories —</option>';
  detailed.forEach(cat => {
    detailedHTML += `<option value="${escapeHtml(cat)}" ${cat === filterDetailedCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`;
  });
  detailedSelect.innerHTML = detailedHTML;
  detailedSelect.disabled = false;
}

/**
 * Handle primary category filter change.
 */
function onFilterPrimaryChange() {
  const primarySelect = document.getElementById('filter-primary-category');
  filterPrimaryCategory = primarySelect.value;
  
  // Reset detailed filter when primary changes
  filterDetailedCategory = '';
  
  // Update detailed dropdown options
  updateDetailedFilterDropdown();
  
  // Re-render table with new filters
  renderTransactionTable();
}

/**
 * Handle detailed category filter change.
 */
function onFilterDetailedChange() {
  const detailedSelect = document.getElementById('filter-detailed-category');
  filterDetailedCategory = detailedSelect.value;
  
  // Re-render table with new filters
  renderTransactionTable();
}

/**
 * Clear all category filters and refresh the table.
 */
function clearCategoryFilters() {
  filterPrimaryCategory = '';
  filterDetailedCategory = '';
  
  // Reset dropdowns
  const primarySelect = document.getElementById('filter-primary-category');
  const detailedSelect = document.getElementById('filter-detailed-category');
  
  if (primarySelect) primarySelect.value = '';
  if (detailedSelect) {
    detailedSelect.value = '';
    updateDetailedFilterDropdown();
  }
  
  // Re-render table
  renderTransactionTable();
}
