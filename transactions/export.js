// ============================================================
// transactions/export.js — Data Export & Backup/Restore Modal
// JSON export, CSV copy-to-clipboard, CSV download.
//
// CSV format is "PFC Export v1" — always includes backup/restore
// columns (account_id, transaction_id, source, status, etc.)
// plus a header comment with a category_list_hash so the
// re-importer can detect category drift.
// ============================================================

// ── Backup / Restore Modal ──────────────────────────────────
function openBackupRestoreModal() {
  document.getElementById('backup-restore-modal').classList.remove('hidden');
}

function closeBackupRestoreModal() {
  document.getElementById('backup-restore-modal').classList.add('hidden');
}

// Cached export metadata — fetched once per export action
let _exportMetadataCache = null;

async function _fetchExportMetadata() {
  if (_exportMetadataCache) return _exportMetadataCache;

  const [catResponse, acctResponse] = await Promise.all([
    authenticatedFetch(`${BACKEND_URL}/api/categorization/categories`),
    authenticatedFetch(`${BACKEND_URL}/api/accounts`),
  ]);

  const categoryData = catResponse.ok ? await catResponse.json() : {};
  const accountData = acctResponse.ok ? await acctResponse.json() : {};

  _exportMetadataCache = {
    categoryListHash: categoryData.category_list_hash || 'unknown',
    categoryMappings: categoryData.category_mappings || {},
    customCategories: categoryData.custom_categories || [],
    accounts: accountData.accounts || [],
    userId: currentUser?.user_id || 'unknown',
  };
  return _exportMetadataCache;
}

function _invalidateExportMetadataCache() {
  _exportMetadataCache = null;
}

async function exportJSON() {
  try {
    showStatus('Preparing JSON export...', 'info');
    const metadata = await _fetchExportMetadata();

    const exportableTransactions = transactions.filter(
      txn => txn.source !== 'opening_balance' && txn.source !== 'manual_opening_balance'
    );

    const exportPayload = {
      metadata: {
        format: 'pfc_json_v1',
        exported: new Date().toISOString(),
        user_id: metadata.userId,
        category_list_hash: metadata.categoryListHash,
        category_mappings: metadata.categoryMappings,
        custom_categories: metadata.customCategories,
        accounts: metadata.accounts,
      },
      transactions: exportableTransactions,
    };

    const dataStr = JSON.stringify(exportPayload, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions_${getDateRange()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showStatus('JSON exported', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (exportError) {
    console.error('JSON export failed:', exportError);
    showStatus('JSON export failed', 'error');
  }
}

// Balance snapshot export functions are at the bottom of this file (exportBalanceSnapshotJSON, etc.)
async function copyCSV() {
  try {
    showStatus('Preparing CSV...', 'info');
    const metadata = await _fetchExportMetadata();
    const csv = generateCSV(metadata);
    await navigator.clipboard.writeText(csv);
    showStatus('CSV copied to clipboard!', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (clipboardError) {
    showStatus('Failed to copy to clipboard', 'error');
  }
}

async function downloadCSV() {
  try {
    showStatus('Preparing CSV...', 'info');
    const metadata = await _fetchExportMetadata();
    const csv = generateCSV(metadata);
    const dataBlob = new Blob([csv], {type: 'text/csv'});
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions_${getDateRange()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    clearStatus();
  } catch (exportError) {
    console.error('CSV export failed:', exportError);
    showStatus('CSV export failed', 'error');
  }
}

/**
 * Emit one CSV row for a given transaction + optional fields config.
 * Extracted so both parent-level and split-child-level rows share the
 * same serialization logic.
 */
function _formatCsvRow(txn, optionalFields, parentTransactionId) {
  const dateStr = toISODateStr(new Date(txn.date));
  const description = (txn.description || txn.name || '').replace(/"/g, '""');
  const bankAccount = (txn.bank_account || '').replace(/"/g, '""');

  // Core columns (always present)
  let row = `"${dateStr}","${bankAccount}","${description}",${txn.amount}`;

  // Backup/restore columns (always present in PFC Export v1)
  row += `,"${txn.account_id || ''}"`;
  row += `,"${txn.transaction_id || ''}"`;
  row += `,"${txn.source || ''}"`;
  row += `,"${txn.status || ''}"`;
  row += `,"${(txn.user_category || '').replace(/"/g, '""')}"`;
  row += `,"${(txn.user_memo || '').replace(/"/g, '""')}"`;
  row += `,"${parentTransactionId || ''}"`;
  row += `,"${txn.transfer_pair_id || ''}"`;
  row += `,"${(txn.user_description_override || '').replace(/"/g, '""')}"`;

  // Balance At Date column (populated only for investment_trending rows)
  const balAtDate = txn.balance_at_date != null ? txn.balance_at_date : '';
  row += `,"${balAtDate}"`;

  // Optional Plaid-specific columns
  if (optionalFields.includes('personal_finance_category')) {
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
      row += `,"${primaryRaw.replace(/"/g, '""')}","${detailedTrimmed.replace(/"/g, '""')}","${(pfc.confidence_level || '').replace(/_/g, ' ').replace(/"/g, '""')}"`;
    } else {
      let cat = txn.category;
      if (typeof cat === 'string' && cat.startsWith('{')) {
        cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
      } else if (Array.isArray(cat)) {
        cat = cat.join(', ');
      }
      row += `,"${(cat || '').replace(/"/g, '""')}","",""`;
    }
  }
  if (optionalFields.includes('payment_channel')) {
    row += `,"${(txn.payment_channel || '').replace(/"/g, '""')}"`;
  }
  if (optionalFields.includes('original_description')) {
    const preOverrideExport = txn.user_description_override ? (txn.description || txn.name || '') : 'no override';
    row += `,"${preOverrideExport.replace(/"/g, '""')}"`;
  }
  if (optionalFields.includes('authorized_datetime')) {
    let authDisplay = '';
    if (txn.authorized_datetime) {
      const dt = new Date(txn.authorized_datetime);
      authDisplay = dt.toLocaleString('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZoneName: 'short'
      });
    } else if (txn.authorized_date) {
      authDisplay = txn.authorized_date;
    }
    row += `,"${authDisplay}"`;
  }

  return row;
}

function _buildExportSplitChild(parentTxn, splitTxn) {
  return Object.assign({}, splitTxn, {
    account_id: splitTxn.account_id || parentTxn.account_id || parentTxn.plaid_account_id || '',
    bank_account: splitTxn.bank_account || parentTxn.bank_account || '',
    date: splitTxn.date || parentTxn.date,
    description: splitTxn.description || splitTxn.name || parentTxn.description || parentTxn.name || '',
    merchant_name: splitTxn.merchant_name || parentTxn.merchant_name || '',
    parent_transaction_id: parentTxn.transaction_id || '',
    source: 'split',
    status: parentTxn.status,
    transfer_pair_id: splitTxn.transfer_pair_id || '',
    user_description_override: splitTxn.user_description_override || '',
  });
}

function _getFilteredExportRows(txnsSource) {
  const exportRows = [];

  for (const txn of txnsSource) {
    if (txn.source === 'split') continue;

    if (txn.source === 'opening_balance' || txn.source === 'manual_opening_balance') {
      continue;
    }

    if (txn.is_split && Array.isArray(txn.splits) && txn.splits.length > 0) {
      const visibleSplits = txn.splits.filter(split => (
        _splitMatchesSearch(txn, split) && _splitMatchesCategoryFilter(split)
      ));

      for (const split of visibleSplits) {
        exportRows.push({
          txn: _buildExportSplitChild(txn, split),
          parentTransactionId: txn.transaction_id || '',
        });
      }
      continue;
    }

    exportRows.push({ txn, parentTransactionId: '' });
  }

  return exportRows;
}

function generateCSV(metadata, txnsOverride) {
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });

  const txnsSource = txnsOverride || transactions;
  const isFilteredExport = !!txnsOverride;

  // Header comment for format auto-detection on re-import
  let csv = `# PFC Export v1, exported=${new Date().toISOString()}, category_list_hash=${metadata.categoryListHash}\n`;

  // Column headers — core 4 + always-included backup columns + optional
  csv += 'Date,Bank/Account,Description,Amount';
  csv += ',Account ID,Transaction ID,Source,Status,User Category,Memo,Parent Transaction ID,Transfer Pair ID,User Description Override,Balance At Date';

  if (optionalFields.includes('personal_finance_category')) csv += ',Category (Primary),Category (Detailed),Confidence';
  if (optionalFields.includes('payment_channel')) csv += ',Channel';
  if (optionalFields.includes('original_description')) csv += ',Pre-Override Desc';
  if (optionalFields.includes('authorized_datetime')) csv += ',Authorized';

  csv += '\n';

  if (isFilteredExport) {
    for (const exportRow of _getFilteredExportRows(txnsSource)) {
      csv += _formatCsvRow(exportRow.txn, optionalFields, exportRow.parentTransactionId) + '\n';
    }
    return csv;
  }

  for (const txn of txnsSource) {
    // Split children are nested under their parent — skip any that
    // leaked into the top-level array (source='split')
    if (txn.source === 'split') continue;

    // OB/MOB are system-derived balance anchors, not real transactions
    if (txn.source === 'opening_balance' || txn.source === 'manual_opening_balance') continue;

    csv += _formatCsvRow(txn, optionalFields, '') + '\n';

    // Export split children immediately after their parent.
    // Children from the API have a reduced field set (no source/status/bank_account),
    // so fill in known values before formatting.
    if (txn.is_split && Array.isArray(txn.splits)) {
      for (const child of txn.splits) {
        const enrichedChild = Object.assign({}, child, {
          source: 'split',
          status: txn.status,
          bank_account: txn.bank_account,
          transfer_pair_id: child.transfer_pair_id || '',
          user_description_override: child.user_description_override || '',
        });
        csv += _formatCsvRow(enrichedChild, optionalFields, txn.transaction_id) + '\n';
      }
    }
  }

  return csv;
}

// ============================================================
// Transaction Export (filtered view)
//
// Exports only the rows currently visible in the table — i.e.
// whatever the user has filtered down to via date range, account
// selection, search, category filter, hide-transfers, etc.
// Same CSV/JSON format as backup/restore but scoped to the view.
// ============================================================

async function exportFilteredTransactionsJSON() {
  try {
    if (!visibleTransactions.length) {
      showStatus('No transactions to export', 'error');
      return;
    }
    showStatus('Preparing JSON export...', 'info');
    const metadata = await _fetchExportMetadata();

    const exportPayload = {
      metadata: {
        format: 'pfc_json_v1',
        exported: new Date().toISOString(),
        user_id: metadata.userId,
        category_list_hash: metadata.categoryListHash,
        category_mappings: metadata.categoryMappings,
        custom_categories: metadata.customCategories,
        accounts: metadata.accounts,
      },
      transactions: visibleTransactions.filter(
        txn => txn.source !== 'opening_balance' && txn.source !== 'manual_opening_balance'
      ),
    };

    const dataStr = JSON.stringify(exportPayload, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions_filtered_${getDateRange()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showStatus('JSON exported', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (exportError) {
    console.error('JSON export failed:', exportError);
    showStatus('JSON export failed', 'error');
  }
}

async function downloadFilteredTransactionsCSV() {
  try {
    if (!visibleTransactions.length) {
      showStatus('No transactions to export', 'error');
      return;
    }
    showStatus('Preparing CSV...', 'info');
    const metadata = await _fetchExportMetadata();
    const csv = generateCSV(metadata, visibleTransactions);
    const dataBlob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions_filtered_${getDateRange()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    clearStatus();
  } catch (exportError) {
    console.error('CSV export failed:', exportError);
    showStatus('CSV export failed', 'error');
  }
}

async function copyFilteredTransactionsCSV() {
  try {
    if (!visibleTransactions.length) {
      showStatus('No transactions to export', 'error');
      return;
    }
    showStatus('Preparing CSV...', 'info');
    const metadata = await _fetchExportMetadata();
    const csv = generateCSV(metadata, visibleTransactions);
    await navigator.clipboard.writeText(csv);
    showStatus('CSV copied to clipboard!', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (clipboardError) {
    showStatus('Failed to copy to clipboard', 'error');
  }
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
 * Columns: Bank, Account, [Mask], Type, Balance, Currency
 * Mask column only appears when the showMaskWithName preference is enabled.
 * Includes a summary footer with category totals and net worth.
 */
function _generateBalanceSnapshotCSV(data) {
  const showMask = getAppConfig().showMaskWithName;

  let csv = `Balance Snapshot as of ${data.as_of_date}\n`;
  csv += showMask ? 'Bank,Account,Mask,Type,Balance,Currency\n'
                  : 'Bank,Account,Type,Balance,Currency\n';

  for (const bank of data.banks) {
    const bankName = (bank.bank_name || '').replace(/"/g, '""');
    for (const account of bank.accounts) {
      const accountName = (account.custom_name || account.account_name || '').replace(/"/g, '""');
      const subtypeLabel = (account.account_subcategory || account.account_category || '').replace(/_/g, ' ');
      csv += `"${bankName}","${accountName}"`;
      if (showMask) {
        csv += `,"${account.effective_mask || ''}"`;
      }
      csv += `,"${subtypeLabel}",${account.balance},${account.currency}\n`;
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
// Aggregates the currently visible ledger rows by primary and
// detailed category, reusing the shared analytics summary slice.
// Produces a hierarchical breakdown: primary totals with
// detailed subcategory rows nested underneath.
// ============================================================

/**
 * Build a hierarchical category summary from the currently visible ledger rows.
 *
 * Reuses buildVisibleCategorySummaryData() so the export stays aligned with
 * the category summary modal and its exclusion rules.
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
  const summaryData = buildVisibleCategorySummaryData();

  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;

  return {
    date_range: `${startDate} to ${endDate}`,
    start_date: startDate,
    end_date: endDate,
    grand_total: summaryData.grand_total,
    spending_total: summaryData.spending_total,
    income_total: summaryData.income_total,
    investment_trending_total: summaryData.investment_trending_total,
    transaction_count: summaryData.transaction_count,
    categories: summaryData.categories,
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
