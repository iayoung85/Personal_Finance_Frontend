// ============================================================
// transactions/import/report.js — Post-Import Report Modal
// Displays a structured report after a successful import.
// Includes download-as-JSON functionality.
// ============================================================

/**
 * Open the import report modal with the given report data.
 */
function openImportReportModal(report) {
  const overlay = document.getElementById('import-report-modal');
  const body = document.getElementById('import-report-body');

  body.innerHTML = _renderImportReport(report);
  overlay.classList.remove('hidden');
}

function closeImportReportModal() {
  const overlay = document.getElementById('import-report-modal');
  overlay.classList.add('hidden');
}

/**
 * Render the structured import report.
 */
function _renderImportReport(report) {
  let html = '';

  // ── Created Transactions ──────────────────────────────────
  html += '<div class="import-report-section">';
  html += '<h3>Transactions Created</h3>';

  if (report.transactions_created !== undefined) {
    html += `<div class="import-report-stat success">
      <span>Total transactions written</span>
      <span class="stat-value">${report.transactions_created}</span>
    </div>`;
  }

  if (report.regular_transactions !== undefined) {
    html += `<div class="import-report-stat">
      <span>Regular transactions</span>
      <span class="stat-value">${report.regular_transactions}</span>
    </div>`;
  }

  if (report.split_parents !== undefined && report.split_parents > 0) {
    html += `<div class="import-report-stat">
      <span>Split parents created</span>
      <span class="stat-value">${report.split_parents}</span>
    </div>`;
  }

  if (report.split_children !== undefined && report.split_children > 0) {
    html += `<div class="import-report-stat">
      <span>Split children created</span>
      <span class="stat-value">${report.split_children}</span>
    </div>`;
  }

  html += '</div>';

  // ── Accounts ──────────────────────────────────────────────
  const accountsCreatedList = Array.isArray(report.accounts_created) ? report.accounts_created : [];
  if (accountsCreatedList.length > 0 || report.per_account_summary) {
    html += '<div class="import-report-section">';
    html += '<h3>Accounts</h3>';

    if (accountsCreatedList.length > 0) {
      html += `<div class="import-report-stat success">
        <span>New accounts created</span>
        <span class="stat-value">${accountsCreatedList.length}</span>
      </div>`;

      for (const account of accountsCreatedList) {
        const displayName = typeof account === 'string' ? account : (account.name || 'Unknown');
        html += `<div class="import-report-stat">
          <span>  · ${escapeHtml(displayName)}</span>
          <span class="stat-value"></span>
        </div>`;
      }
    }

    if (report.per_account_summary) {
      for (const accountSummary of report.per_account_summary) {
        const dateRange = accountSummary.date_range
          ? `${accountSummary.date_range[0]} → ${accountSummary.date_range[1]}`
          : '';
        html += `<div class="import-report-stat">
          <span>${escapeHtml(accountSummary.account_name || 'Unknown')}</span>
          <span class="stat-value">${accountSummary.transaction_count} txns ${dateRange ? '· ' + dateRange : ''}</span>
        </div>`;
      }
    }

    html += '</div>';
  }

  // ── Categories ────────────────────────────────────────────
  if (report.categories_created) {
    html += '<div class="import-report-section">';
    html += '<h3>Categories</h3>';
    html += `<div class="import-report-stat success">
      <span>New categories created</span>
      <span class="stat-value">${report.categories_created}</span>
    </div>`;
    if (report.new_category_names && report.new_category_names.length > 0) {
      for (const categoryName of report.new_category_names) {
        html += `<div class="import-report-stat">
          <span>  · ${escapeHtml(categoryName)}</span>
          <span class="stat-value"></span>
        </div>`;
      }
    }
    html += '</div>';
  }

  // ── Post-Write Processing ─────────────────────────────────
  const hasPostWriteData = report.transfer_pairs_linked
    || report.investment_trending_months
    || report.overlap_results
    || report.reconciliation_results;

  if (hasPostWriteData) {
    html += '<div class="import-report-section">';
    html += '<h3>Post-Import Processing</h3>';

    if (report.transfer_pairs_linked) {
      html += `<div class="import-report-stat">
        <span>Transfer pairs auto-linked</span>
        <span class="stat-value">${report.transfer_pairs_linked}</span>
      </div>`;
    }

    if (report.investment_trending_months) {
      html += `<div class="import-report-stat">
        <span>Investment trending months adjusted</span>
        <span class="stat-value">${report.investment_trending_months}</span>
      </div>`;
    }

    if (report.overlap_results) {
      const overlap = report.overlap_results;
      if (overlap.duplicates_found) {
        html += `<div class="import-report-stat warning">
          <span>Potential duplicates detected</span>
          <span class="stat-value">${overlap.duplicates_found}</span>
        </div>`;
      }
    }

    if (report.reconciliation_results) {
      const recon = report.reconciliation_results;
      if (recon.auto_matched) {
        html += `<div class="import-report-stat success">
          <span>Auto-matched with Plaid</span>
          <span class="stat-value">${recon.auto_matched}</span>
        </div>`;
      }
      if (recon.proposals_created) {
        html += `<div class="import-report-stat warning">
          <span>Proposals for review</span>
          <span class="stat-value">${recon.proposals_created}</span>
        </div>`;
      }
      if (recon.orphaned) {
        html += `<div class="import-report-stat warning">
          <span>Orphaned (needs review)</span>
          <span class="stat-value">${recon.orphaned}</span>
        </div>`;
      }
    }

    html += '</div>';
  }

  // ── Skipped / Discarded ───────────────────────────────────
  const hasSkipped = report.ignored_by_account || report.ignored_by_category
    || report.discarded_rows || report.duplicates_skipped;
  if (hasSkipped) {
    html += '<div class="import-report-section">';
    html += '<h3>Skipped / Discarded</h3>';

    if (report.duplicates_skipped) {
      html += `<div class="import-report-stat">
        <span>Duplicates skipped (already in DB)</span>
        <span class="stat-value">${report.duplicates_skipped}</span>
      </div>`;
    }

    if (report.ignored_by_account) {
      html += `<div class="import-report-stat">
        <span>Skipped (account ignored)</span>
        <span class="stat-value">${report.ignored_by_account}</span>
      </div>`;
    }
    if (report.ignored_by_category) {
      html += `<div class="import-report-stat">
        <span>Skipped (category ignored)</span>
        <span class="stat-value">${report.ignored_by_category}</span>
      </div>`;
    }
    if (report.discarded_rows) {
      html += `<div class="import-report-stat">
        <span>Discarded (parse errors)</span>
        <span class="stat-value">${report.discarded_rows}</span>
      </div>`;
    }

    html += '</div>';
  }

  return html;
}

/**
 * Download the import report as a JSON file.
 */
function downloadImportReport() {
  const report = importLastReport;
  if (!report) {
    showStatus('No import report available to download.', 'warning');
    return;
  }

  const jsonString = JSON.stringify(report, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  link.download = `import-report-${timestamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
