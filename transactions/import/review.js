// ============================================================
// transactions/import/review.js — Step 3: Review + Confirm
// Summary of all mapping decisions before committing the import.
// Also handles the execute call and transitions to the report.
// ============================================================

/**
 * Render the review step into the wizard body.
 */
function renderReviewStep(container) {
  if (!importAnalysis) {
    container.innerHTML = '<div class="import-error-banner">No analysis data available.</div>';
    return;
  }

  const accountStats = _computeAccountReviewStats();
  const categoryStats = _computeCategoryReviewStats();

  let html = '';
  html += `<h2 style="margin: 0 0 6px 0; font-size: 18px; color: var(--text-heading);">Review Import</h2>`;
  html += `<p style="color: var(--text-secondary); margin: 0 0 20px 0; font-size: 13px;">
    Confirm the details below before importing. This action cannot be undone.
  </p>`;

  html += '<div class="import-review-grid">';

  // ── Transactions Overview ───────────────────────────────────
  html += `
    <div class="import-review-section">
      <h3>📊 Transactions</h3>
      <ul class="import-review-list">
        <li>
          <span>Total rows parsed</span>
          <span class="review-value">${importAnalysis.total_rows || 0}</span>
        </li>
        <li>
          <span>Rows to import</span>
          <span class="review-value">${accountStats.importableTransactions}</span>
        </li>
        <li>
          <span>Discarded (parse errors)</span>
          <span class="review-muted">${importAnalysis.discarded_rows || 0}</span>
        </li>
        <li>
          <span>Split groups</span>
          <span class="review-muted">${importAnalysis.split_group_count || 0}</span>
        </li>
        <li>
          <span>Date range</span>
          <span class="review-muted">${_computeOverallDateRange()}</span>
        </li>
      </ul>
    </div>
  `;

  // ── Account Summary ─────────────────────────────────────────
  html += `
    <div class="import-review-section">
      <h3>🏦 Accounts</h3>
      <ul class="import-review-list">
        <li>
          <span>Mapped to existing</span>
          <span class="review-value">${accountStats.mapped}</span>
        </li>
        <li>
          <span>New accounts to create</span>
          <span class="review-value">${accountStats.createNew}</span>
        </li>
        <li>
          <span>Skipped / ignored</span>
          <span class="review-muted">${accountStats.ignored}</span>
        </li>
        <li>
          <span>Transactions skipped (ignored accts)</span>
          <span class="review-muted">${accountStats.ignoredTransactions}</span>
        </li>
      </ul>
    </div>
  `;

  // ── Category Summary ────────────────────────────────────────
  html += `
    <div class="import-review-section">
      <h3>🏷️ Categories</h3>
      <ul class="import-review-list">
        <li>
          <span>Mapped to existing</span>
          <span class="review-value">${categoryStats.mapped}</span>
        </li>
        <li>
          <span>New categories to create</span>
          <span class="review-value">${categoryStats.createNew}</span>
        </li>
        <li>
          <span>Skipped / ignored</span>
          <span class="review-muted">${categoryStats.ignored}</span>
        </li>
        <li>
          <span>Transfers</span>
          <span class="review-muted">${categoryStats.transfers}</span>
        </li>
        <li>
          <span>Investment adjustments</span>
          <span class="review-muted">${categoryStats.investmentAdjustments}</span>
        </li>
      </ul>
    </div>
  `;

  // ── Linked Account Warnings ─────────────────────────────────
  const linkedMappings = _getLinkedAccountMappings();
  if (linkedMappings.length > 0) {
    html += `
      <div class="import-review-section full-width">
        <h3>🔗 Plaid-Linked Accounts</h3>
        <div class="import-info-banner" style="margin-bottom: 8px;">
          Imported transactions overlapping Plaid sync ranges will be matched against existing data.
          Unmatched imports will appear in the Resolution Center for your review.
        </div>
        <ul class="import-review-list">
    `;
    for (const linkedMapping of linkedMappings) {
      html += `<li>
        <span>${escapeHtml(linkedMapping.csvName)} → ${escapeHtml(linkedMapping.accountName)}</span>
        <span class="review-muted">${linkedMapping.transactionCount} txns</span>
      </li>`;
    }
    html += '</ul></div>';
  }

  // ── New Accounts Detail ─────────────────────────────────────
  const newAccounts = _getNewAccountConfigs();
  if (newAccounts.length > 0) {
    html += `<div class="import-review-section full-width"><h3>New Accounts</h3><ul class="import-review-list">`;
    for (const newAccount of newAccounts) {
      const bankLabel = newAccount.bank_name ? escapeHtml(newAccount.bank_name) : 'No bank';
      const institutionTag = newAccount.institution_id ? ' \uD83C\uDFE6' : '';
      html += `<li>
        <span>${escapeHtml(newAccount.account_name)} (${escapeHtml(newAccount.account_category)})</span>
        <span class="review-muted">${bankLabel}${institutionTag}</span>
      </li>`;
    }
    html += '</ul></div>';
  }

  // ── New Categories Detail ───────────────────────────────────
  const newCategories = _getNewCategoryNames();
  if (newCategories.length > 0) {
    html += `<div class="import-review-section full-width"><h3>New Categories</h3><ul class="import-review-list">`;
    for (const categoryName of newCategories) {
      html += `<li><span>${escapeHtml(categoryName)}</span></li>`;
    }
    html += '</ul></div>';
  }

  html += '</div>'; // close review-grid
  container.innerHTML = html;
}

// ── Execute Import ────────────────────────────────────────────

/**
 * Build the mappings payload and send to /import/execute.
 */
async function executeImportFromWizard() {
  if (!importFileBytes || !importFile) {
    const body = document.getElementById('import-wizard-body');
    body.innerHTML = '<div class="import-error-banner">No file loaded. Go back to the Upload step and re-select your file.</div>';
    return;
  }

  const executeButton = document.getElementById('import-execute-btn');
  if (executeButton) {
    executeButton.disabled = true;
    executeButton.textContent = 'Importing…';
  }

  const body = document.getElementById('import-wizard-body');
  _showImportLoading(body, 'Importing transactions… This may take a moment for large files.');

  try {
    const mappingsPayload = _buildMappingsPayload();
    const formData = new FormData();
    formData.append('file', new Blob([importFileBytes]), importFile.name);
    formData.append('mappings', JSON.stringify(mappingsPayload));

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/import/execute`,
      { method: 'POST', body: formData }
    );

    const report = await response.json();

    if (!response.ok) {
      throw new Error(report.error || 'Import failed');
    }

    // Store report for power-user localStorage retrieval
    importLastReport = report;
    try {
      localStorage.setItem('pf_last_import_report', JSON.stringify(report));
    } catch (_storageError) {
      // localStorage full or unavailable — non-critical
    }

    // Import succeeded — clear saved wizard progress
    _clearImportProgress();

    // Close wizard and show report modal
    closeImportWizard();
    openImportReportModal(report);

    // Refresh the transaction table and accounts to reflect new data
    await loadAccounts();
    await loadAvailableCategories(true);

    // Invalidate transaction cache to force a fresh fetch
    localStorage.removeItem('pf_cached_transactions');
    localStorage.removeItem('pf_transactions_cached_at');
    await fetchAllTransactions(true);
    renderTransactionTable();

    showStatus('Import completed successfully!', 'success');

  } catch (executeError) {
    body.innerHTML = `<div class="import-error-banner">${escapeHtml(executeError.message)}</div>`;
    if (executeButton) {
      executeButton.disabled = false;
      executeButton.textContent = 'Import Transactions';
    }
    _renderImportFooter();
  }
}

// ── Payload Builder ───────────────────────────────────────────

function _buildMappingsPayload() {
  const accountMappingsList = [];
  const categoryMappingsList = [];

  // Account mappings
  for (const csvAccount of importAnalysis.accounts) {
    const csvName = csvAccount.csv_name;
    const mapping = importAccountMappings[csvName];
    if (!mapping) continue;

    const entry = { csv_name: csvName, action: mapping.action };

    if (mapping.action === 'map') {
      entry.target_account_id = mapping.target_account_id;
      entry.lock_current_balance = !!mapping.lock_current_balance;
    } else if (mapping.action === 'create_new') {
      entry.new_account_config = mapping.new_account_config || {};
    }

    accountMappingsList.push(entry);
  }

  // Category mappings
  for (const csvCategory of importAnalysis.categories) {
    const csvName = csvCategory.csv_name;
    const mapping = importCategoryMappings[csvName];
    if (!mapping) continue;

    const entry = { csv_name: csvName, action: mapping.action };

    if (mapping.action === 'map') {
      entry.target_category = mapping.target_category;
    } else if (mapping.action === 'create_new') {
      entry.new_category_name = mapping.new_category_name;
    }

    if (mapping.route_to_investment_trending) {
      entry.route_to_investment_trending = true;
    }

    categoryMappingsList.push(entry);
  }

  return {
    account_mappings: accountMappingsList,
    category_mappings: categoryMappingsList,
  };
}

// ── Review Stat Helpers ───────────────────────────────────────

function _computeAccountReviewStats() {
  let mapped = 0;
  let createNew = 0;
  let ignored = 0;
  let ignoredTransactions = 0;
  let importableTransactions = importAnalysis.total_rows - (importAnalysis.discarded_rows || 0);

  for (const csvAccount of importAnalysis.accounts) {
    const mapping = importAccountMappings[csvAccount.csv_name];
    if (!mapping || mapping.action === 'ignore') {
      ignored++;
      ignoredTransactions += csvAccount.transaction_count;
    } else if (mapping.action === 'map') {
      mapped++;
    } else if (mapping.action === 'create_new') {
      createNew++;
    }
  }

  importableTransactions -= ignoredTransactions;

  // Also subtract category-ignored transactions (rough estimate)
  let categoryIgnoredTxns = 0;
  for (const csvCategory of importAnalysis.categories) {
    const catMapping = importCategoryMappings[csvCategory.csv_name];
    if (catMapping && catMapping.action === 'ignore') {
      categoryIgnoredTxns += csvCategory.transaction_count;
    }
  }
  importableTransactions = Math.max(0, importableTransactions - categoryIgnoredTxns);

  return { mapped, createNew, ignored, ignoredTransactions, importableTransactions };
}

function _computeCategoryReviewStats() {
  let mapped = 0;
  let createNew = 0;
  let ignored = 0;
  let transfers = 0;
  let investmentAdjustments = 0;

  for (const csvCategory of importAnalysis.categories) {
    if (csvCategory.is_transfer) transfers++;
    if (csvCategory.is_investment_adjustment) investmentAdjustments++;

    const mapping = importCategoryMappings[csvCategory.csv_name];
    if (!mapping || mapping.action === 'ignore') {
      ignored++;
    } else if (mapping.action === 'map') {
      mapped++;
    } else if (mapping.action === 'create_new') {
      createNew++;
    }
  }

  return { mapped, createNew, ignored, transfers, investmentAdjustments };
}

function _computeOverallDateRange() {
  if (!importAnalysis.accounts || importAnalysis.accounts.length === 0) return '—';

  let earliest = null;
  let latest = null;

  for (const csvAccount of importAnalysis.accounts) {
    const mapping = importAccountMappings[csvAccount.csv_name];
    if (mapping && mapping.action === 'ignore') continue;

    if (csvAccount.date_range && csvAccount.date_range.length >= 2) {
      if (!earliest || csvAccount.date_range[0] < earliest) earliest = csvAccount.date_range[0];
      if (!latest || csvAccount.date_range[1] > latest) latest = csvAccount.date_range[1];
    }
  }

  if (!earliest || !latest) return '—';
  return `${earliest} → ${latest}`;
}

function _getLinkedAccountMappings() {
  const results = [];
  for (const csvAccount of importAnalysis.accounts) {
    const mapping = importAccountMappings[csvAccount.csv_name];
    if (!mapping || mapping.action !== 'map') continue;

    const targetAccount = _findAccountById(mapping.target_account_id);
    if (targetAccount && targetAccount.connection_status === 'linked') {
      results.push({
        csvName: csvAccount.csv_name,
        accountName: _buildAccountLabel(targetAccount),
        transactionCount: csvAccount.transaction_count,
      });
    }
  }
  return results;
}

function _getNewAccountConfigs() {
  const results = [];
  for (const csvAccount of importAnalysis.accounts) {
    const mapping = importAccountMappings[csvAccount.csv_name];
    if (mapping && mapping.action === 'create_new' && mapping.new_account_config) {
      results.push(mapping.new_account_config);
    }
  }
  return results;
}

function _getNewCategoryNames() {
  const results = [];
  for (const csvCategory of importAnalysis.categories) {
    const mapping = importCategoryMappings[csvCategory.csv_name];
    if (mapping && mapping.action === 'create_new' && mapping.new_category_name) {
      results.push(mapping.new_category_name);
    }
  }
  return results;
}
