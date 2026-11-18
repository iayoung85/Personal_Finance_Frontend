// ============================================================
// categories/bulk-actions.js — Audit log, Recategorize, and
// Override bulk ops
// ============================================================

// ── Migration Log ──────────────────────────────────────────

function renderMigrationLog() {
  const container = document.getElementById('audit-log');
  if (!migrationLog.length) {
    container.innerHTML = '<div class="empty-state">No migrations recorded yet.</div>';
    return;
  }

  const rows = migrationLog
    .map(log => {
      const when = new Date(log.created_at).toLocaleString();
      const text = describeAuditLogEntry(log);
      return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td>${escapeHtml(text.type)}</td>
          <td>${escapeHtml(text.changes)}</td>
          <td>${escapeHtml(text.stats)}</td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Changes</th>
          <th>Stats</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function refreshMigrationLog() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/migration-log`);
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to refresh audit log', 'error');
      return;
    }
    migrationLog = data.migrations || [];
    renderMigrationLog();
  } catch (error) {
    showStatus(`Failed to refresh audit log: ${error.message}`, 'error');
  }
}

// ── Recategorize All Transactions ──────────────────────────

async function recategorizeAllTransactions() {
  // Step 1: Check for broken rules first
  const validation = await checkBrokenRules(false);

  if (validation && validation.has_broken_rules) {
    showStatus(
      `Cannot recategorize: ${validation.broken_rules_count} broken rule${validation.broken_rules_count > 1 ? 's' : ''} exist. Please fix them first.`,
      'error'
    );
    showBrokenRulesModal(validation.broken_rules);
    return;
  }

  // Step 2: Confirm with user
  if (!confirm(
    'Recategorize all historical transactions?\n\n' +
    'this is a nuclear option and will change your entire spending history if tracked via monthly category summaries. This will re-run the categorization pipeline (mappings → rules → overrides) on all transactions. This may take a moment. Are you sure you want to proceed?'
  )) {
    return;
  }

  // Step 3: Show progress
  showStatus('Recategorizing transactions...', 'info');

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/transactions/recategorize`,
      { method: 'POST' }
    );
    const data = await response.json();

    if (!response.ok) {
      if (data.broken_rules) {
        showBrokenRulesModal(data.broken_rules);
      } else {
        showStatus(data.error || 'Failed to recategorize', 'error');
      }
      return;
    }

    markTransactionCacheStale();
    showStatus(
      `Recategorization complete: ${data.transactions_updated} transaction${data.transactions_updated !== 1 ? 's' : ''} updated` +
      (data.decryption_errors > 0 ? ` (${data.decryption_errors} errors)` : ''),
      'success'
    );

    setTimeout(() => clearStatus(), 5000);
  } catch (error) {
    showStatus(`Recategorization failed: ${error.message}`, 'error');
  }
}

// ── Bulk Override Operations ───────────────────────────────

async function deleteOverridesForCategory(categoryName) {
  if (!confirm(
    `Delete all manual overrides for "${categoryName}"?\n\n` +
    'This will remove all manual categorizations for this category. This cannot be undone.'
  )) {
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/transaction-overrides?category_name=${encodeURIComponent(categoryName)}`,
      { method: 'DELETE' }
    );
    const data = await response.json();

    if (response.ok) {
      markTransactionCacheStale();
      showStatus(`${data.deleted_count} override${data.deleted_count !== 1 ? 's' : ''} deleted`, 'success');
      await loadCategorizationData(true);
      setTimeout(() => clearStatus(), 3000);
    } else {
      showStatus(data.error || 'Failed to delete overrides', 'error');
    }
  } catch (error) {
    showStatus(`Failed to delete overrides: ${error.message}`, 'error');
  }
}

async function deleteAllOverrides() {
  if (!confirm(
    'Delete ALL manual categorization overrides?\n\n' +
    'This will remove all manual categorizations across all transactions. This cannot be undone.'
  )) {
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/transaction-overrides`,
      { method: 'DELETE' }
    );
    const data = await response.json();

    if (response.ok) {
      markTransactionCacheStale();
      showStatus(`Deleted all ${data.deleted_count} override${data.deleted_count !== 1 ? 's' : ''}`, 'success');
      await loadCategorizationData(true);
      setTimeout(() => clearStatus(), 3000);
    } else {
      showStatus(data.error || 'Failed to delete overrides', 'error');
    }
  } catch (error) {
    showStatus(`Failed to delete overrides: ${error.message}`, 'error');
  }
}
