// ============================================================
// transactions/reports.js — Reports Modal
// Generates balance-history and category-summary reports via
// backend API endpoints, renders them as scrollable HTML tables,
// and supports CSV download / clipboard copy.
// ============================================================

// ── Modal open / close ──────────────────────────────────────

function openReportsModal() {
  _initReportsDefaults();
  document.getElementById('reports-modal').classList.remove('hidden');
}

function closeReportsModal() {
  document.getElementById('reports-modal').classList.add('hidden');
}

/**
 * Set sensible defaults when the modal opens.
 * Balance mode: start = first month of the prior fiscal year, end = current month.
 * Category mode: year selectors populated, preview shown.
 */
function _initReportsDefaults() {
  _populateCategoryYearSelects();
  _applyBalanceDateDefaults();
  _onReportTypeChange();
}

function _formatDateInput(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Format a Date as YYYY-MM for type="month" inputs. */
function _formatMonthInput(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/** Read the selected fiscal start month (1-12). */
function _getFiscalMonth() {
  return parseInt(document.getElementById('report-fiscal-month').value, 10);
}

/**
 * Compute the balance-mode default start month:
 * first month of the fiscal year *before* the current fiscal year.
 *
 * Example: fiscal start = November, today = April 2026.
 * Current FY started Nov 2025. Prior FY started Nov 2024.
 * Default start = Nov 2024, default end = Apr 2026.
 */
function _applyBalanceDateDefaults() {
  const now = new Date();
  const fiscalMonth = _getFiscalMonth();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Determine what year the current fiscal year started
  let currentFiscalStartYear = currentYear;
  if (currentMonth < fiscalMonth) {
    currentFiscalStartYear = currentYear - 1;
  }
  // Prior fiscal year started one year before that
  const priorFiscalStartYear = currentFiscalStartYear - 1;

  const startInput = document.getElementById('report-start-month');
  const endInput = document.getElementById('report-end-month');

  startInput.value = _formatMonthInput(new Date(priorFiscalStartYear, fiscalMonth - 1, 1));
  endInput.value = _formatMonthInput(now);
}

/** Populate start/end year <select> elements for category mode. */
function _populateCategoryYearSelects() {
  const startSelect = document.getElementById('report-start-year');
  const endSelect = document.getElementById('report-end-year');

  if (startSelect.options.length > 0) return;

  const currentYear = new Date().getFullYear();
  const earliestYear = currentYear - 10;

  for (let year = earliestYear; year <= currentYear + 1; year++) {
    startSelect.add(new Option(year, year));
    endSelect.add(new Option(year, year));
  }

  // Default: start 2 years ago, end current year
  startSelect.value = String(currentYear - 1);
  endSelect.value = String(currentYear);

  _updateCategoryDatePreview();
}


// ── Form interactions ───────────────────────────────────────

function _onReportTypeChange() {
  const reportType = document.getElementById('report-type').value;
  const isBalance = reportType === 'balance';

  // Toggle visibility of type-specific options
  document.getElementById('report-option-zero-label').style.display = isBalance ? '' : 'none';
  document.getElementById('report-option-transfers-label').style.display = isBalance ? 'none' : '';

  // Balance mode uses month pickers; category mode uses year selects
  document.getElementById('report-balance-dates').style.display = isBalance ? '' : 'none';
  document.getElementById('report-category-dates').style.display = isBalance ? 'none' : '';
  document.getElementById('report-category-preview').style.display = isBalance ? 'none' : '';

  // Balance mode is always monthly; category mode keeps the interval selector
  document.getElementById('report-interval').closest('.reports-form-row').style.display = isBalance ? 'none' : '';

  if (!isBalance) {
    _updateCategoryDatePreview();
  }
}

function _onReportIntervalChange() {
  _updateCategoryDatePreview();
}

/** Recalculate balance defaults when fiscal month changes. */
function _onFiscalMonthChange() {
  const reportType = document.getElementById('report-type').value;
  if (reportType === 'balance') {
    _applyBalanceDateDefaults();
  } else {
    _updateCategoryDatePreview();
  }
}

const _MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

/**
 * Show a preview of the actual fiscal date range for category mode.
 *
 * Fiscal years are named after the calendar year they END in.
 * FY2025 with fiscal start November = Nov 2024 – Oct 2025.
 * FY2025 with fiscal start January  = Jan 2025 – Dec 2025.
 */
function _updateCategoryDatePreview() {
  const previewEl = document.getElementById('report-category-preview');
  const startFY = parseInt(document.getElementById('report-start-year').value, 10);
  const endFY = parseInt(document.getElementById('report-end-year').value, 10);
  const fiscalMonth = _getFiscalMonth();

  if (!startFY || !endFY) {
    previewEl.style.display = 'none';
    return;
  }

  const { startDate, endDate } = _fiscalYearRange(startFY, endFY, fiscalMonth);
  const rangeStartMonth = _MONTH_NAMES[startDate.getMonth()];
  const rangeEndMonth = _MONTH_NAMES[endDate.getMonth()];

  previewEl.textContent = `Report range: ${rangeStartMonth} ${startDate.getFullYear()} – ${rangeEndMonth} ${endDate.getFullYear()}`;
  previewEl.style.display = '';
}

/**
 * Compute the calendar date range for a span of fiscal years.
 *
 * Fiscal years are named after the calendar year they END in.
 * FY2025 with fiscal start month 11 (Nov) → Nov 1 2024 – Oct 31 2025.
 * FY2025 with fiscal start month 1  (Jan) → Jan 1 2025 – Dec 31 2025.
 */
function _fiscalYearRange(startFY, endFY, fiscalMonth) {
  // FY start: month M of year (FY - 1) when M > 1, or month 1 of year FY when M == 1
  const startCalendarYear = fiscalMonth === 1 ? startFY : startFY - 1;
  const rangeStart = new Date(startCalendarYear, fiscalMonth - 1, 1);

  // FY end: month (M-1) of year FY when M > 1, or month 12 of year FY when M == 1
  const endMonth = fiscalMonth === 1 ? 12 : fiscalMonth - 1;
  const endCalendarYear = endFY;
  const lastDay = new Date(endCalendarYear, endMonth, 0).getDate();
  const rangeEnd = new Date(endCalendarYear, endMonth - 1, lastDay);

  return { startDate: rangeStart, endDate: rangeEnd };
}


// ── Report generation ───────────────────────────────────────

// Cached report data for CSV export
let _lastReportData = null;
let _lastReportType = null;

async function generateReport() {
  const reportType = document.getElementById('report-type').value;
  let startDate, endDate, interval;

  if (reportType === 'balance') {
    interval = 'monthly';
    const startMonth = document.getElementById('report-start-month').value;
    const endMonth = document.getElementById('report-end-month').value;

    if (!startMonth || !endMonth) {
      _showReportsError('Please select both start and end months.');
      return;
    }

    // type="month" gives "YYYY-MM"; expand to first/last day
    startDate = startMonth + '-01';
    const [endYear, endMon] = endMonth.split('-').map(Number);
    const lastDay = new Date(endYear, endMon, 0).getDate();
    endDate = `${endMonth}-${String(lastDay).padStart(2, '0')}`;
  } else {
    interval = document.getElementById('report-interval').value;
    const startYear = parseInt(document.getElementById('report-start-year').value, 10);
    const endYear = parseInt(document.getElementById('report-end-year').value, 10);
    const fiscalMonth = _getFiscalMonth();

    if (!startYear || !endYear) {
      _showReportsError('Please select both start and end years.');
      return;
    }

    const range = _fiscalYearRange(startYear, endYear, fiscalMonth);
    startDate = _formatDateInput(range.startDate);
    endDate = _formatDateInput(range.endDate);
  }

  _showReportsLoading(true);
  _hideReportsError();
  document.getElementById('reports-output').classList.add('hidden');

  try {
    let data;
    if (reportType === 'balance') {
      const hideZero = document.getElementById('report-hide-zero').checked;
      data = await _fetchBalanceReport(startDate, endDate, interval, hideZero);
    } else {
      const includeTransfers = document.getElementById('report-include-transfers').checked;
      data = await _fetchCategoryReport(startDate, endDate, interval, includeTransfers);
    }

    _lastReportData = data;
    _lastReportType = reportType;

    if (reportType === 'balance') {
      _renderBalanceReport(data, interval);
    } else {
      _renderCategoryReport(data, interval);
    }

    document.getElementById('reports-output').classList.remove('hidden');
  } catch (fetchError) {
    _showReportsError(fetchError.message || 'Failed to generate report.');
  } finally {
    _showReportsLoading(false);
  }
}

// ── API calls ───────────────────────────────────────────────

async function _fetchBalanceReport(startDate, endDate, interval, hideZero) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    interval: interval,
    hide_zero_balance: hideZero.toString(),
    include_archived: 'false',
  });

  const response = await authenticatedFetch(`${BACKEND_URL}/api/reports/balance?${params}`);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `Server error (${response.status})`);
  }
  return response.json();
}

async function _fetchCategoryReport(startDate, endDate, interval, includeTransfers) {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    interval: interval,
    include_transfers: includeTransfers.toString(),
  });

  const response = await authenticatedFetch(`${BACKEND_URL}/api/reports/category?${params}`);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `Server error (${response.status})`);
  }
  return response.json();
}


// ── Balance Report Renderer ─────────────────────────────────

function _renderBalanceReport(data, interval) {
  const container = document.getElementById('reports-table-container');
  const titleEl = document.getElementById('reports-output-title');
  const showMask = getAppConfig().showMaskWithName;

  const periodCount = data.periods.length;
  if (periodCount === 0) {
    container.innerHTML = '<p class="reports-empty">No periods in the selected range.</p>';
    titleEl.textContent = 'Account Balances';
    return;
  }

  titleEl.textContent = `Account Balances — ${interval === 'yearly' ? 'Yearly' : 'Monthly'} (${periodCount} periods)`;

  const periodHeaders = data.periods.map(dateStr => _formatPeriodHeader(dateStr, interval));

  let html = '<table class="reports-table">';
  html += '<thead><tr><th class="reports-label-col"></th>';
  for (const header of periodHeaders) {
    html += `<th class="reports-num-col">${header}</th>`;
  }
  html += '</tr></thead><tbody>';

  // Render each section (assets, liabilities)
  for (const [sectionKey, sectionData] of Object.entries(data.sections)) {
    const sectionLabel = sectionKey === 'assets' ? 'Assets' : 'Liabilities';
    html += `<tr class="reports-section-header"><td colspan="${periodCount + 1}">${sectionLabel}</td></tr>`;

    for (const [subgroupLabel, subgroupData] of Object.entries(sectionData.subgroups)) {
      html += `<tr class="reports-subgroup-header"><td class="reports-indent-1">${subgroupLabel}</td>`;
      html += `<td colspan="${periodCount}"></td></tr>`;

      for (const account of subgroupData.accounts) {
        let displayName = account.name;
        if (showMask && account.effective_mask) {
          displayName += ` (...${account.effective_mask})`;
        }
        html += '<tr class="reports-account-row">';
        html += `<td class="reports-indent-2">${_escapeHtml(displayName)}</td>`;
        for (const balance of account.balances) {
          html += `<td class="reports-num-col">${_formatCurrency(balance)}</td>`;
        }
        html += '</tr>';
      }

      // Subgroup subtotal
      html += '<tr class="reports-subtotal-row">';
      html += `<td class="reports-indent-1">Total ${subgroupLabel}</td>`;
      for (const subtotal of subgroupData.subtotals) {
        html += `<td class="reports-num-col">${_formatCurrency(subtotal)}</td>`;
      }
      html += '</tr>';
    }

    // Section total
    html += '<tr class="reports-section-total-row">';
    html += `<td>Total ${sectionLabel}</td>`;
    for (const total of sectionData.section_totals) {
      html += `<td class="reports-num-col">${_formatCurrency(total)}</td>`;
    }
    html += '</tr>';
  }

  // Net Worth row
  html += '<tr class="reports-net-worth-row">';
  html += '<td><strong>Net Worth</strong></td>';
  for (const nw of data.net_worth_row) {
    html += `<td class="reports-num-col"><strong>${_formatCurrency(nw)}</strong></td>`;
  }
  html += '</tr>';

  html += '</tbody></table>';
  container.innerHTML = html;
}


// ── Category Report Renderer ────────────────────────────────

function _renderCategoryReport(data, interval) {
  const container = document.getElementById('reports-table-container');
  const titleEl = document.getElementById('reports-output-title');

  const periodCount = data.periods.length;
  if (periodCount === 0) {
    container.innerHTML = '<p class="reports-empty">No periods in the selected range.</p>';
    titleEl.textContent = 'Category Summary';
    return;
  }

  titleEl.textContent = `Category Summary — ${interval === 'yearly' ? 'Yearly' : 'Monthly'} (${periodCount} periods)`;

  let html = '<table class="reports-table">';
  html += '<thead><tr><th class="reports-label-col">Category</th>';
  for (const period of data.periods) {
    html += `<th class="reports-num-col">${_escapeHtml(period)}</th>`;
  }
  html += '<th class="reports-num-col">Total</th>';
  html += '</tr></thead><tbody>';

  // Income section
  html += `<tr class="reports-section-header"><td colspan="${periodCount + 2}">Income</td></tr>`;
  html += _renderCategoryRows(data.income, periodCount);
  html += '<tr class="reports-subtotal-row"><td>Total Income</td>';
  for (const val of data.total_income_row) {
    html += `<td class="reports-num-col">${_formatCurrency(val)}</td>`;
  }
  html += `<td class="reports-num-col">${_formatCurrency(data.total_income_grand)}</td></tr>`;

  // Expenses section
  html += `<tr class="reports-section-header"><td colspan="${periodCount + 2}">Expenses</td></tr>`;
  html += _renderCategoryRows(data.expenses, periodCount);
  html += '<tr class="reports-subtotal-row"><td>Total Expenses</td>';
  for (const val of data.total_expenses_row) {
    html += `<td class="reports-num-col">${_formatCurrency(val)}</td>`;
  }
  html += `<td class="reports-num-col">${_formatCurrency(data.total_expenses_grand)}</td></tr>`;

  // Transfers section (optional)
  if (data.transfers) {
    html += `<tr class="reports-section-header"><td colspan="${periodCount + 2}">Transfers</td></tr>`;
    html += _renderCategoryRows(data.transfers, periodCount);
    html += '<tr class="reports-subtotal-row"><td>Total Transfers</td>';
    for (const val of data.total_transfers_row) {
      html += `<td class="reports-num-col">${_formatCurrency(val)}</td>`;
    }
    html += `<td class="reports-num-col">${_formatCurrency(data.total_transfers_grand)}</td></tr>`;
  }

  // Grand total row
  html += '<tr class="reports-net-worth-row"><td><strong>Total</strong></td>';
  for (const val of data.total_row) {
    html += `<td class="reports-num-col"><strong>${_formatCurrency(val)}</strong></td>`;
  }
  html += `<td class="reports-num-col"><strong>${_formatCurrency(data.total_grand)}</strong></td></tr>`;

  html += '</tbody></table>';
  container.innerHTML = html;
}

function _renderCategoryRows(categoryMap, periodCount) {
  let html = '';
  for (const [category, catData] of Object.entries(categoryMap)) {
    html += '<tr class="reports-category-row">';
    html += `<td class="reports-indent-1">${_escapeHtml(category)}</td>`;
    for (let periodIdx = 0; periodIdx < catData.amounts.length; periodIdx++) {
      const amount = catData.amounts[periodIdx];
      const periodDates = (_lastReportData && _lastReportData.period_dates)
        ? _lastReportData.period_dates[periodIdx]
        : null;
      html += `<td class="reports-num-col">${_renderCategoryAmountCell(amount, category, periodDates)}</td>`;
    }
    html += `<td class="reports-num-col">${_renderCategoryAmountCell(catData.total, category, null)}</td>`;
    html += '</tr>';
  }
  return html;
}

/**
 * Build a search-bar-compatible date token from period start/end ISO dates.
 * Full calendar months use the compact YYYY-MM form; partial months or
 * yearly ranges use date:YYYY-MM-DD..YYYY-MM-DD.
 */
function _buildPeriodSearchToken(periodDates) {
  if (!periodDates) return null;
  const startStr = periodDates.start;
  const endStr = periodDates.end;

  // Detect full calendar month: starts on the 1st and ends on the last day
  const startParts = startStr.split('-');
  const endParts = endStr.split('-');
  if (startParts[0] === endParts[0] && startParts[1] === endParts[1] && startParts[2] === '01') {
    const lastDay = new Date(Number(endParts[0]), Number(endParts[1]), 0).getDate();
    if (Number(endParts[2]) === lastDay) {
      return `date:${startParts[0]}-${startParts[1]}`;
    }
  }
  return `date:${startStr}..${endStr}`;
}

/**
 * Render a category-report amount as a clickable link that opens the
 * transactions page in a new tab with the search bar prefilled. Zero
 * amounts render as plain text so we don't invite the user to click
 * into an empty view.
 */
function _renderCategoryAmountCell(amount, category, periodDates) {
  const formatted = _formatCurrency(amount);
  if (!amount || !category) return formatted;

  const tokens = [];
  const dateToken = _buildPeriodSearchToken(periodDates);
  if (dateToken) tokens.push(dateToken);
  tokens.push(`cat:"${category}"`);
  const searchQuery = tokens.join(' ');
  const href = `transactions.html?search=${encodeURIComponent(searchQuery)}`;

  return `<a class="reports-drilldown-link" href="${href}" target="_blank" rel="noopener" title="Open matching transactions in a new tab">${formatted}</a>`;
}


// ── CSV Export ──────────────────────────────────────────────

function downloadReportCSV() {
  const csv = _generateReportCSV();
  if (!csv) return;

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const reportType = _lastReportType === 'balance' ? 'account_balances' : 'category_summary';
  link.download = `${reportType}_report.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function copyReportCSV() {
  const csv = _generateReportCSV();
  if (!csv) return;

  try {
    await navigator.clipboard.writeText(csv);
    showStatus('Report CSV copied to clipboard', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (clipboardError) {
    showStatus('Failed to copy to clipboard', 'error');
  }
}

function _generateReportCSV() {
  if (!_lastReportData || !_lastReportType) {
    showStatus('No report data to export. Generate a report first.', 'error');
    return null;
  }

  if (_lastReportType === 'balance') {
    return _generateBalanceCSV(_lastReportData);
  }
  return _generateCategoryCSV(_lastReportData);
}

function _generateBalanceCSV(data) {
  const periods = data.periods;
  const showMask = getAppConfig().showMaskWithName;

  // Header row: Account label, optional Mask column, then one column per period
  let csv = showMask ? '"Account","Mask"' : '"Account"';
  csv += ',' + periods.map(dateStr => `"${dateStr}"`).join(',') + '\n';

  // Empty padding for the mask column when present
  const maskPad = showMask ? ',' : '';

  for (const [sectionKey, sectionData] of Object.entries(data.sections)) {
    const sectionLabel = sectionKey === 'assets' ? 'Assets' : 'Liabilities';
    csv += `"${sectionLabel}"${maskPad}\n`;

    for (const [subgroupLabel, subgroupData] of Object.entries(sectionData.subgroups)) {
      csv += `"  ${subgroupLabel}"${maskPad}\n`;

      for (const account of subgroupData.accounts) {
        const mask = account.effective_mask || '';
        csv += `"    ${_csvEscape(account.name)}"`;
        csv += showMask ? `,"${_csvEscape(mask)}"` : '';
        for (const balance of account.balances) {
          csv += `,${balance}`;
        }
        csv += '\n';
      }

      csv += `"  Total ${subgroupLabel}"${maskPad}`;
      for (const subtotal of subgroupData.subtotals) {
        csv += `,${subtotal}`;
      }
      csv += '\n';
    }

    csv += `"Total ${sectionLabel}"${maskPad}`;
    for (const total of sectionData.section_totals) {
      csv += `,${total}`;
    }
    csv += '\n';
  }

  csv += `"Net Worth"${maskPad}`;
  for (const nw of data.net_worth_row) {
    csv += `,${nw}`;
  }
  csv += '\n';

  return csv;
}

function _generateCategoryCSV(data) {
  const monthNames = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

  // Extract short month name from each period label (e.g. "11/1/25 - 11/30/25" → "November")
  const periodMonths = data.periods.map(period => {
    const monthNum = parseInt(period.split('/')[0], 10);
    return monthNames[monthNum - 1] || '';
  });

  let csv = ',"Primary Category","Detailed Category",' + data.periods.map(period => `"${_csvEscape(period)}"`).join(',') + ',"Total"\n';

  csv += '"Income",,,' + periodMonths.map(m => `"${m}"`).join(',') + '\n';
  for (const [category, catData] of Object.entries(data.income)) {
    csv += _splitCategoryColumns(category);
    for (const amount of catData.amounts) { csv += `,${amount}`; }
    csv += `,${catData.total}\n`;
  }
  csv += ',,"Total Income"';
  for (const val of data.total_income_row) { csv += `,${val}`; }
  csv += `,${data.total_income_grand}\n`;

  csv += '"Expenses"\n';
  for (const [category, catData] of Object.entries(data.expenses)) {
    csv += _splitCategoryColumns(category);
    for (const amount of catData.amounts) { csv += `,${amount}`; }
    csv += `,${catData.total}\n`;
  }
  csv += ',,"Total Expenses"';
  for (const val of data.total_expenses_row) { csv += `,${val}`; }
  csv += `,${data.total_expenses_grand}\n`;

  if (data.transfers) {
    csv += '"Transfers"\n';
    for (const [category, catData] of Object.entries(data.transfers)) {
      csv += _splitCategoryColumns(category);
      for (const amount of catData.amounts) { csv += `,${amount}`; }
      csv += `,${catData.total}\n`;
    }
    csv += ',,"Total Transfers"';
    for (const val of data.total_transfers_row) { csv += `,${val}`; }
    csv += `,${data.total_transfers_grand}\n`;
  }

  csv += ',,"Total"';
  for (const val of data.total_row) { csv += `,${val}`; }
  csv += `,${data.total_grand}\n`;

  return csv;
}

/**
 * Split "Primary: Detailed" into two CSV columns.
 * If no colon, primary gets the full name and detailed is empty.
 */
function _splitCategoryColumns(category) {
  const colonIndex = category.indexOf(':');
  if (colonIndex === -1) {
    return `,"${_csvEscape(category)}",`;
  }
  const primary = category.substring(0, colonIndex).trim();
  const detailed = category.substring(colonIndex + 1).trim();
  return `,"${_csvEscape(primary)}","${_csvEscape(detailed)}"`;
}


// ── Formatting helpers ──────────────────────────────────────

function _formatCurrency(value) {
  const num = parseFloat(value);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _formatPeriodHeader(isoDate, interval) {
  const parts = isoDate.split('-');
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  const year = parts[0];

  if (interval === 'yearly') {
    return year;
  }
  return `${month}/${day}/${year.slice(2)}`;
}

function _escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function _csvEscape(text) {
  return (text || '').replace(/"/g, '""');
}


// ── UI helpers ──────────────────────────────────────────────

function _showReportsLoading(show) {
  document.getElementById('reports-loading').classList.toggle('hidden', !show);
  document.getElementById('report-generate-btn').disabled = show;
}

function _showReportsError(message) {
  const errorEl = document.getElementById('reports-error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function _hideReportsError() {
  document.getElementById('reports-error').classList.add('hidden');
}
