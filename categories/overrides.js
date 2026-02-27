// ============================================================
// categories/overrides.js — Transaction Override Management
// Render override summary table, clear/reassign overrides.
// ============================================================

function renderOverridesTable() {
  const container = document.getElementById('overrides-table');
  if (!container) return;

  if (!overrides || !overrides.length) {
    container.innerHTML = '<div class="empty-state">No manual overrides yet. Override transactions on the Transactions page to see them here.</div>';
    return;
  }

  // Sort by transaction count descending
  const sorted = overrides.slice().sort((a, b) => (b.transaction_count || 0) - (a.transaction_count || 0));

  const rows = sorted
    .map(override => {
      const categoryName = override.category_name || 'Unknown';
      const txnCount = override.transaction_count || 0;
      return `
        <tr>
          <td>${escapeHtml(categoryName)}</td>
          <td style="text-align: center;">${txnCount}</td>
          <td>
            <div class="rules-actions">
              <button class="secondary" onclick="clearOverridesForCategory('${escapeHtml(categoryName).replace(/'/g, "\\'")}')">Clear All</button>
              <button class="secondary" onclick="reassignOverridesForCategory('${escapeHtml(categoryName).replace(/'/g, "\\'")}')">Reassign All</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Category Name</th>
          <th style="text-align: center;"># Transactions</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Override Actions ────────────────────────────────────────

async function clearOverridesForCategory(categoryName) {
  if (!confirm(
    `Clear all manual overrides for "${categoryName}"?\n\n` +
    'Transactions will revert to follow category mappings and/or rules. This cannot be undone.'
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
      showStatus(`Cleared ${data.deleted_count} override${data.deleted_count !== 1 ? 's' : ''} for "${categoryName}"`, 'success');
      await loadCategorizationData(true);
      setTimeout(() => clearStatus(), 3000);
    } else {
      showStatus(data.error || 'Failed to clear overrides', 'error');
    }
  } catch (networkError) {
    showStatus(`Failed to clear overrides: ${networkError.message}`, 'error');
  }
}

function reassignOverridesForCategory(categoryName) {
  openModal({
    title: 'Reassign All Overrides',
    body: `
      <p>Reassign all overrides from <strong>${escapeHtml(categoryName)}</strong> to:</p>
      <div style="margin-top: 12px;">
        <select id="reassign-overrides-target">
          <option value="">-- Select target category --</option>
          ${buildCategoryOptions()}
        </select>
      </div>
      <p style="font-size: 12px; color: var(--text-secondary); margin-top: 12px;">All transactions currently overridden to "${escapeHtml(categoryName)}" will be changed to the new category you select.</p>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Reassign', onClick: () => _confirmReassignOverrides(categoryName) }
    ]
  });
}

async function _confirmReassignOverrides(oldCategory) {
  const targetSelect = document.getElementById('reassign-overrides-target');
  const newCategory = targetSelect ? targetSelect.value : '';

  if (!newCategory) {
    showStatus('Please select a target category', 'warning');
    return;
  }

  try {
    showStatus('Reassigning overrides...', 'info');

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transaction-overrides/reassign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_category: oldCategory,
        new_category: newCategory
      })
    });

    const data = await response.json();

    if (!response.ok) {
      showStatus(`Failed to reassign overrides: ${data.error || 'Unknown error'}`, 'error');
      return;
    }

    closeModal();
    showStatus(`Successfully reassigned ${data.updated_count} override${data.updated_count !== 1 ? 's' : ''} to "${newCategory}"`, 'success');
    await loadCategorizationData(true);
    setTimeout(() => clearStatus(), 3000);
  } catch (networkError) {
    showStatus(`Failed to reassign overrides: ${networkError.message}`, 'error');
  }
}
