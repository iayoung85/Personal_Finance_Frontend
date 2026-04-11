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
 * Start date = 3 years ago (first of that month).
 * End date = today.
 */
function _initReportsDefaults() {
  const now = new Date();
  const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), 1);

  const startInput = document.getElementById('report-start-date');
  const endInput = document.getElementById('report-end-date');

  if (!startInput.value) {
    startInput.value = _formatDateInput(threeYearsAgo);
  }
  if (!endInput.value) {
    endInput.value = _formatDateInput(now);
  }

  _onReportTypeChange();
}

function _formatDateInput(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


// ── Form interactions ───────────────────────────────────────

function _onReportTypeChange() {
  const reportType = document.getElementById('report-type').value;
  const isBalance = reportType === 'balance';

  // Toggle visibility of type-specific options
  document.getElementById('report-option-zero-label').style.display = isBalance ? '' : 'none';
  document.getElementById('report-option-transfers-label').style.display = isBalance ? 'none' : '';

  // Fiscal year row only relevant for category reports
  _onReportIntervalChange();
}

function _onReportIntervalChange() {
  const reportType = document.getElementById('report-type').value;
  const interval = document.getElementById('report-interval').value;

  // Show fiscal-year month picker only for category + monthly
  const showFiscal = reportType === 'category' && interval === 'monthly';
  document.getElementById('fiscal-year-row').style.display = showFiscal ? '' : 'none';
}


// ── Report generation ───────────────────────────────────────

// Cached report data for CSV export
let _lastReportData = null;
let _lastReportType = null;

async function generateReport() {
  const reportType = document.getElementById('report-type').value;
  const interval = document.getElementById('report-interval').value;
  let startDate = document.getElementById('report-start-date').value;
  let endDate = document.getElementById('report-end-date').value;

  if (!startDate || !endDate) {
    _showReportsError('Please select both start and end dates.');
    return;
  }

  // For fiscal-year mode, align dates to the chosen fiscal start month
  const fiscalRow = document.getElementById('fiscal-year-row');
  if (fiscalRow.style.display !== 'none') {
    const fiscalMonth = parseInt(document.getElementById('report-fiscal-month').value, 10);
    const aligned = _alignToFiscalYear(startDate, endDate, fiscalMonth);
    startDate = aligned.startDate;
    endDate = aligned.endDate;
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

/**
 * Align date range to full fiscal-year boundaries.
 * E.g. fiscal start month = 11 (November): fiscal year runs Nov 1 – Oct 31.
 * The start date snaps backward to the nearest fiscal year start,
 * and the end date snaps forward to the nearest fiscal year end.
 */
function _alignToFiscalYear(startStr, endStr, fiscalMonth) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');

  // Snap start to fiscal year start: find the nearest fiscalMonth/1 on or before start
  let fiscalStartYear = start.getFullYear();
  if (start.getMonth() + 1 < fiscalMonth) {
    fiscalStartYear--;
  }
  const fiscalStart = new Date(fiscalStartYear, fiscalMonth - 1, 1);

  // Snap end to fiscal year end: the month before fiscalMonth, last day, on or after end
  let fiscalEndYear = end.getFullYear();
  if (end.getMonth() + 1 >= fiscalMonth) {
    fiscalEndYear++;
  }
  const fiscalEndMonth = fiscalMonth - 1 === 0 ? 12 : fiscalMonth - 1;
  const fiscalEndMonthYear = fiscalEndMonth === 12 ? fiscalEndYear - 1 : fiscalEndYear;
  const lastDay = new Date(fiscalEndMonthYear, fiscalEndMonth, 0).getDate();
  const fiscalEnd = new Date(fiscalEndMonthYear, fiscalEndMonth - 1, lastDay);

  return {
    startDate: _formatDateInput(fiscalStart),
    endDate: _formatDateInput(fiscalEnd),
  };
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
        html += '<tr class="reports-account-row">';
        html += `<td class="reports-indent-2">${_escapeHtml(account.name)}</td>`;
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
    for (const amount of catData.amounts) {
      html += `<td class="reports-num-col">${_formatCurrency(amount)}</td>`;
    }
    html += `<td class="reports-num-col">${_formatCurrency(catData.total)}</td>`;
    html += '</tr>';
  }
  return html;
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
  let csv = ',' + periods.map(dateStr => `"${dateStr}"`).join(',') + '\n';

  for (const [sectionKey, sectionData] of Object.entries(data.sections)) {
    const sectionLabel = sectionKey === 'assets' ? 'Assets' : 'Liabilities';
    csv += `"${sectionLabel}"\n`;

    for (const [subgroupLabel, subgroupData] of Object.entries(sectionData.subgroups)) {
      csv += `,"${subgroupLabel}"\n`;

      for (const account of subgroupData.accounts) {
        csv += `," - ${_csvEscape(account.name)}"`;
        for (const balance of account.balances) {
          csv += `,${balance}`;
        }
        csv += '\n';
      }

      csv += `," - Total ${subgroupLabel}"`;
      for (const subtotal of subgroupData.subtotals) {
        csv += `,${subtotal}`;
      }
      csv += '\n';
    }

    csv += `"Total ${sectionLabel}"`;
    for (const total of sectionData.section_totals) {
      csv += `,${total}`;
    }
    csv += '\n';
  }

  csv += '"Net Worth"';
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
