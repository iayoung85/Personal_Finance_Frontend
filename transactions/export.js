// ============================================================
// transactions/export.js — Data Export Functions
// JSON export, CSV copy-to-clipboard, CSV download.
// ============================================================

function exportJSON() {
  const dataStr = JSON.stringify(transactions, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.json`;
  link.click();
}

// Balance snapshot export functions are at the bottom of this file (exportBalanceSnapshotJSON, etc.)
function copyCSV() {
  const csv = generateCSV();
  navigator.clipboard.writeText(csv).then(() => {
    showStatus('CSV copied to clipboard!', 'success');
    setTimeout(() => clearStatus(), 2000);
  }).catch(err => {
    showStatus('Failed to copy to clipboard', 'error');
  });
}

function downloadCSV() {
  const csv = generateCSV();
  const dataBlob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.csv`;
  link.click();
}

function generateCSV() {
  // Get selected optional fields
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });

  let csv = 'Date,Bank/Account,Description,Amount';
  
  // Add optional headers — values must match .field-checkbox values in transactions.html
  if (optionalFields.includes('personal_finance_category')) csv += ',Category (Primary),Category (Detailed),Confidence';
  if (optionalFields.includes('payment_channel')) csv += ',Channel';
  if (optionalFields.includes('original_description')) csv += ',Pre-Override Desc';
  if (optionalFields.includes('authorized_datetime')) csv += ',Authorized';
  if (optionalFields.includes('user_memo')) csv += ',Memo';
  if (optionalFields.includes('source')) csv += ',Type';
  
  csv += '\n';

  transactions.forEach(txn => {
    const dateObj = new Date(txn.date);
    const dateStr = toISODateStr(dateObj);
    const amount = txn.amount;
    const name = (txn.description || txn.name || '').replace(/"/g, '""');
    
    csv += `"${dateStr}","${txn.bank_account}","${name}",${amount}`;
    
    // Add optional fields
    if (optionalFields.includes('personal_finance_category')) {
         // Use new personal_finance_category if available
         const pfc = txn.personal_finance_category;
         if (pfc) {
           const primaryRaw = (pfc.primary || '').replace(/_/g, ' ').trim();
           const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
           let detailedTrimmed = detailedRaw;
           if (primaryRaw && detailedRaw.toLowerCase().startsWith(primaryRaw.toLowerCase() + ' ')) {
             detailedTrimmed = detailedRaw.slice(primaryRaw.length).trim();
           } else {
             detailedTrimmed = detailedRaw.replace(/^\S+\s*/, '').trim();
           }
           const primary = primaryRaw.replace(/"/g, '""');
           const detailed = detailedTrimmed.replace(/"/g, '""');
           const confidence = (pfc.confidence_level || '').replace(/_/g, ' ').replace(/"/g, '""');
           csv += `,"${primary}","${detailed}","${confidence}"`;
         } else {
           // Fallback to legacy category
           let cat = txn.category;
           if (typeof cat === 'string' && cat.startsWith('{')) {
             cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
           } else if (Array.isArray(cat)) {
             cat = cat.join(', ');
           }
           csv += `,"${(cat || '').replace(/"/g, '""')}","",""`;
         }
    }
    if (optionalFields.includes('payment_channel')) csv += `,"${(txn.payment_channel || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('original_description')) {
      const preOverrideExport = txn.user_description_override ? (txn.description || txn.name || '') : 'no override';
      csv += `,"${preOverrideExport.replace(/"/g, '""')}"`;
    }
    if (optionalFields.includes('authorized_datetime')) {
        let authDisplay = '';
        if (txn.authorized_datetime) {
            const dt = new Date(txn.authorized_datetime);
            authDisplay = dt.toLocaleString('en-US', {
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
        } else if (txn.authorized_date) {
            authDisplay = txn.authorized_date;
        }
        csv += `,"${authDisplay}"`;
    }
    if (optionalFields.includes('user_memo')) csv += `,"${(txn.user_memo || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('source')) csv += `,"${(txn.source || '').replace(/"/g, '""')}"`;
    
    csv += '\n';
  });
  return csv;
}

// ============================================================
// Balance Snapshot Exports (1i — month-end balance snapshot)
//
// Uses the end-date from the filter strip as the snapshot date.
// Defaults to last day of the previous month if no end-date is set.
// Fetches all account balances as-of that date from the backend
// and exports as JSON, CSV download, or CSV copy-to-clipboard.
// ============================================================

/**
 * Determine the snapshot date from the filter strip's end-date input.
 * Falls back to last day of previous month when the input is empty.
 */
function _getSnapshotDate() {
  const endDateInput = document.getElementById('end-date');
  if (endDateInput && endDateInput.value) {
    return endDateInput.value;
  }
  // Fallback: last day of previous month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastDayPrev = new Date(firstOfMonth - 1);
  const year = lastDayPrev.getFullYear();
  const month = String(lastDayPrev.getMonth() + 1).padStart(2, '0');
  const day = String(lastDayPrev.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Fetch balance snapshot data from the backend. */
async function _fetchBalanceSnapshot(snapshotDate) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/balances/balance-snapshot?date=${encodeURIComponent(snapshotDate)}`
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch balance snapshot');
  }
  return response.json();
}

/** Export balance snapshot as a JSON download. */
async function exportBalanceSnapshotJSON() {
  try {
    const snapshotDate = _getSnapshotDate();
    showStatus('Fetching balance snapshot...', 'info');
    const data = await _fetchBalanceSnapshot(snapshotDate);

    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `balance_snapshot_${snapshotDate}.json`;
    link.click();
    URL.revokeObjectURL(url);

    showStatus(`Balance snapshot exported (as of ${snapshotDate})`, 'success');
    setTimeout(() => clearStatus(), 3000);
  } catch (exportError) {
    showStatus(`Export failed: ${exportError.message}`, 'error');
  }
}

/**
 * Convert snapshot data into a CSV string.
 * Columns: Bank, Account, Type, Balance, Currency
 * Account name always includes the mask suffix (e.g. "Checking (...1234)").
 * Includes a summary footer with category totals and net worth.
 */
function _generateBalanceSnapshotCSV(data) {
  let csv = `Balance Snapshot as of ${data.as_of_date}\n`;
  csv += 'Bank,Account,Type,Balance,Currency\n';

  for (const bank of data.banks) {
    const bankName = (bank.bank_name || '').replace(/"/g, '""');
    for (const account of bank.accounts) {
      let accountName = account.custom_name || account.account_name || '';
      if (account.mask) {
        accountName += ` (...${account.mask})`;
      }
      accountName = accountName.replace(/"/g, '""');
      const subtypeLabel = (account.account_subcategory || account.account_category || '').replace(/_/g, ' ');
      csv += `"${bankName}","${accountName}","${subtypeLabel}",${account.balance},${account.currency}\n`;
    }
  }

  // Category summary
  csv += '\nCategory Summary\n';
  csv += 'Category,Balance\n';
  for (const [category, balance] of Object.entries(data.by_category)) {
    if (parseFloat(balance) !== 0) {
      csv += `"${category}",${balance}\n`;
    }
  }

  // Net worth footer
  csv += `\nNet Worth,${data.total_net_worth}\n`;
  csv += `Accounts,${data.account_count}\n`;

  return csv;
}

/** Download balance snapshot as a CSV file. */
async function downloadBalanceSnapshotCSV() {
  try {
    const snapshotDate = _getSnapshotDate();
    showStatus('Fetching balance snapshot...', 'info');
    const data = await _fetchBalanceSnapshot(snapshotDate);

    const csv = _generateBalanceSnapshotCSV(data);
    const dataBlob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `balance_snapshot_${snapshotDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    showStatus(`Balance snapshot CSV downloaded (as of ${snapshotDate})`, 'success');
    setTimeout(() => clearStatus(), 3000);
  } catch (exportError) {
    showStatus(`Export failed: ${exportError.message}`, 'error');
  }
}

/** Copy balance snapshot CSV to clipboard. */
async function copyBalanceSnapshotCSV() {
  try {
    const snapshotDate = _getSnapshotDate();
    showStatus('Fetching balance snapshot...', 'info');
    const data = await _fetchBalanceSnapshot(snapshotDate);

    const csv = _generateBalanceSnapshotCSV(data);
    await navigator.clipboard.writeText(csv);

    showStatus(`Balance snapshot CSV copied to clipboard (as of ${snapshotDate})`, 'success');
    setTimeout(() => clearStatus(), 3000);
  } catch (exportError) {
    showStatus(`Export failed: ${exportError.message}`, 'error');
  }
}

// ============================================================
// Category Summary Exports (2-E)
//
// Aggregates filtered transactions by primary and detailed
// category, matching the same filter logic used by the chart.
// Produces a hierarchical breakdown: primary totals with
// detailed subcategory rows nested underneath.
// ============================================================

/**
 * Build a hierarchical category summary from the currently filtered transactions.
 *
 * Reuses _getFilteredTransactionsForChart() from chart.js so the numbers
 * always match what the user sees in the pie chart.
 *
 * Amounts preserve ledger-convention signs:
 *   negative = money out (spending), positive = money in (refunds).
 * Categories are sorted by magnitude (largest absolute total first)
 * so the biggest spending categories surface at the top regardless of sign.
 *
 * Returns { date_range, start_date, end_date, grand_total, transaction_count, categories[] }
 * where each category has { category, total, count, detailed[] }
 * and each detailed entry has { category, total, count }.
 */
function _buildCategorySummaryExportData() {
  const filteredTransactions = _getFilteredTransactionsForChart();
  const summary = {};

  for (const txn of filteredTransactions) {
    const fullCategory = txn.user_category || 'Uncategorized';
    const parsed = parseCategoryString(fullCategory);
    const primaryKey = parsed.primary || 'Uncategorized';
    const detailedKey = parsed.detailed || '';
    // Preserve ledger-convention sign: negative = spending, positive = refund/inflow
    const amount = txn.amount || 0;

    if (!summary[primaryKey]) {
      summary[primaryKey] = { total: 0, count: 0, detailed: {} };
    }
    summary[primaryKey].total += amount;
    summary[primaryKey].count += 1;

    if (detailedKey) {
      if (!summary[primaryKey].detailed[detailedKey]) {
        summary[primaryKey].detailed[detailedKey] = { total: 0, count: 0 };
      }
      summary[primaryKey].detailed[detailedKey].total += amount;
      summary[primaryKey].detailed[detailedKey].count += 1;
    }
  }

  // Sort by magnitude (largest absolute total first) so biggest categories surface at top
  const primaries = Object.entries(summary)
    .map(([name, data]) => {
      const detailedEntries = Object.entries(data.detailed)
        .map(([detailedName, detailedData]) => ({
          category: detailedName,
          total: Math.round(detailedData.total * 100) / 100,
          count: detailedData.count,
        }))
        .sort((entryA, entryB) => Math.abs(entryB.total) - Math.abs(entryA.total));

      return {
        category: name,
        total: Math.round(data.total * 100) / 100,
        count: data.count,
        detailed: detailedEntries,
      };
    })
    .sort((entryA, entryB) => Math.abs(entryB.total) - Math.abs(entryA.total));

  const grandTotal = primaries.reduce((sum, primary) => sum + primary.total, 0);
  const grandCount = primaries.reduce((sum, primary) => sum + primary.count, 0);

  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;

  return {
    date_range: `${startDate} to ${endDate}`,
    start_date: startDate,
    end_date: endDate,
    grand_total: Math.round(grandTotal * 100) / 100,
    transaction_count: grandCount,
    categories: primaries,
  };
}

/**
 * Generate the category summary CSV string.
 *
 * Two separate tables: primary categories on top, detailed below.
 * Primary totals are just the summation of their detailed subcategories,
 * so mixing them in one table is misleading.
 */
function _generateCategorySummaryCSV(data) {
  // --- Primary Category Table ---
  let csv = `Category Summary for ${data.date_range}\n\n`;
  csv += ',Primary Category,Amount,Transactions\n';

  for (const primary of data.categories) {
    csv += `,"${primary.category.replace(/"/g, '""')}",${primary.total.toFixed(2)},${primary.count}\n`;
  }

  csv += `,Total,${data.grand_total.toFixed(2)},${data.transaction_count}\n`;

  // --- Detailed Category Table ---
  csv += '\n';
  csv += 'Primary Category,Detailed Category,Amount,Transactions\n';

  for (const primary of data.categories) {
    for (const detail of primary.detailed) {
      csv += `"${primary.category.replace(/"/g, '""')}","${detail.category.replace(/"/g, '""')}",${detail.total.toFixed(2)},${detail.count}\n`;
    }
  }

  csv += `Total,,${data.grand_total.toFixed(2)},${data.transaction_count}\n`;
  return csv;
}

/** Export category summary as a JSON download. */
function exportCategorySummaryJSON() {
  try {
    const data = _buildCategorySummaryExportData();
    if (data.categories.length === 0) {
      showStatus('No category data to export — load transactions first.', 'error');
      return;
    }

    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `category_summary_${getDateRange()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    showStatus('Category summary exported as JSON', 'success');
    setTimeout(() => clearStatus(), 3000);
  } catch (exportError) {
    showStatus(`Export failed: ${exportError.message}`, 'error');
  }
}

/** Download category summary as a CSV file. */
function downloadCategorySummaryCSV() {
  try {
    const data = _buildCategorySummaryExportData();
    if (data.categories.length === 0) {
      showStatus('No category data to export — load transactions first.', 'error');
      return;
    }

    const csv = _generateCategorySummaryCSV(data);
    const dataBlob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `category_summary_${getDateRange()}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    showStatus('Category summary CSV downloaded', 'success');
    setTimeout(() => clearStatus(), 3000);
  } catch (exportError) {
    showStatus(`Export failed: ${exportError.message}`, 'error');
  }
}

/** Copy category summary CSV to clipboard. */
function copyCategorySummaryCSV() {
  try {
    const data = _buildCategorySummaryExportData();
    if (data.categories.length === 0) {
      showStatus('No category data to export — load transactions first.', 'error');
      return;
    }

    const csv = _generateCategorySummaryCSV(data);
    navigator.clipboard.writeText(csv).then(() => {
      showStatus('Category summary CSV copied to clipboard', 'success');
      setTimeout(() => clearStatus(), 3000);
    }).catch(clipboardError => {
      showStatus(`Clipboard failed: ${clipboardError.message}`, 'error');
    });
  } catch (exportError) {
    showStatus(`Export failed: ${exportError.message}`, 'error');
  }
}
