// ============================================================
// categories/bulk-actions.js — Migrations, Rename, Merge,
// Reassign, Delete, Recategorize, Override bulk ops
// ============================================================

// ── Migration Selectors ────────────────────────────────────

function renderMigrationSelectors() {
  const mergeList = document.getElementById('merge-source-list');
  if (mergeList) {
    mergeList.innerHTML = availableCategories
      .map(cat => `
        <label class="merge-item">
          <input type="checkbox" value="${escapeHtml(cat)}">
          <span>${escapeHtml(cat)}</span>
        </label>
      `)
      .join('');
  }
}

// ── Rename ─────────────────────────────────────────────────

function confirmRename() {
  const oldName = document.getElementById('rename-old').value.trim();
  const newName = document.getElementById('rename-new').value.trim();
  if (!oldName || !newName) {
    showStatus('Enter both old and new category names', 'warning');
    return;
  }
  openModal({
    title: 'Confirm Rename',
    body: `<p>Rename <strong>${escapeHtml(oldName)}</strong> to <strong>${escapeHtml(newName)}</strong>?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Rename', onClick: () => renameCategory(oldName, newName) }
    ]
  });
}

async function renameCategory(oldName, newName) {
  try {
    // Check if this is a primary category rename that affects detailed categories
    const isPrimaryRename = await checkPrimaryRename(oldName, newName);

    if (isPrimaryRename) {
      const affectedCategories = isPrimaryRename.affectedCategories;
      const confirmMessage =
        `Rename "${oldName}" to "${newName}"?\n\n` +
        `This will also update ${affectedCategories.length} detailed categor${affectedCategories.length > 1 ? 'ies' : 'y'}:\n` +
        affectedCategories.slice(0, 5).map(c => `  • ${c.old} → ${c.new}`).join('\n') +
        (affectedCategories.length > 5 ? `\n  ... and ${affectedCategories.length - 5} more` : '');

      if (!confirm(confirmMessage)) {
        return;
      }
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_name: oldName, new_name: newName })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to rename category', 'error');
      return;
    }
    closeModal();
    showStatus('Category renamed successfully', 'success');
    await loadCategorizationData(true);
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to rename category: ${error.message}`, 'error');
  }
}

/**
 * Check if renaming a category affects other detailed categories.
 * Why: "Food And Drink" → "Dining" should remap "Food And Drink: Fast Food" to "Dining: Fast Food"
 */
async function checkPrimaryRename(oldName, newName) {
  const oldParts = parseCategoryName(oldName);
  const newParts = parseCategoryName(newName);

  // Only proceed if old name is a primary (no colon) and new name is also a primary
  if (oldParts.detailed || newParts.detailed) {
    return null;
  }

  const affectedCategories = [];
  for (const cat of availableCategories) {
    const parts = parseCategoryName(cat);
    if (parts.primary === oldName && parts.detailed) {
      const newCategoryName = `${newName}: ${parts.detailed}`;
      affectedCategories.push({ old: cat, new: newCategoryName });
    }
  }

  return affectedCategories.length > 0 ? { affectedCategories } : null;
}

// ── Merge ──────────────────────────────────────────────────

function confirmMerge() {
  const sourceChecks = document.querySelectorAll('#merge-source-list input[type="checkbox"]:checked');
  const sourceCategories = Array.from(sourceChecks).map(c => c.value);
  const targetCategory = document.getElementById('merge-target').value;

  if (!sourceCategories.length || !targetCategory) {
    showStatus('Select source categories and a target category', 'warning');
    return;
  }

  openModal({
    title: 'Confirm Merge',
    body: `<p>Merge ${escapeHtml(sourceCategories.join(', '))} into <strong>${escapeHtml(targetCategory)}</strong>?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Merge', onClick: () => mergeCategories(sourceCategories, targetCategory) }
    ]
  });
}

async function mergeCategories(sourceCategories, targetCategory) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_categories: sourceCategories, target_category: targetCategory })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to merge categories', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData(true);
  } catch (error) {
    showStatus(`Failed to merge categories: ${error.message}`, 'error');
  }
}

// ── Reassign Category (generic) ────────────────────────────

function openReassignCategoryModal(categoryName) {
  openModal({
    title: 'Reassign Category',
    body: `
      <p>Move all rules and overrides from <strong>${escapeHtml(categoryName)}</strong> to:</p>
      <div style="margin-top: 12px;">
        <select id="reassign-target-category">
          ${buildCategoryOptions()}
        </select>
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Reassign', onClick: () => _confirmReassignCategory(categoryName) }
    ]
  });
}

function _confirmReassignCategory(categoryName) {
  const targetSelect = document.getElementById('reassign-target-category');
  const targetCategory = targetSelect ? targetSelect.value : '';
  if (!targetCategory) {
    showStatus('Please select a target category for reassignment', 'warning');
    return;
  }
  deleteCategory(categoryName, 'reassign', targetCategory);
}

// ── Reassign Primary ───────────────────────────────────────

async function openReassignPrimaryModal(primaryName) {
  try {
    showStatus('Loading available primary categories...', 'info');

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`);
    const data = await response.json();
    const allAvailablePrimaries = data.available_categories || [];

    // Extract unique primary categories excluding the source
    const primarySet = new Set();
    allAvailablePrimaries.forEach(cat => {
      const parts = parseCategoryName(cat);
      if (parts.primary && parts.primary !== primaryName) {
        primarySet.add(parts.primary);
      }
    });

    (customCategories || []).forEach(cat => {
      const parts = parseCategoryName(cat);
      if (parts.primary && parts.primary !== primaryName) {
        primarySet.add(parts.primary);
      }
    });

    const targetOptions = Array.from(primarySet)
      .sort((a, b) => a.localeCompare(b))
      .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
      .join('');

    if (!targetOptions) {
      showStatus('No other primary categories available to reassign to.', 'warning');
      return;
    }

    clearStatus();
    openModal({
      title: 'Reassign Primary Category',
      body: `
        <p>Move all detailed categories from <strong>${escapeHtml(primaryName)}</strong> to which primary?</p>
        <div style="margin-top: 12px;">
          <select id="reassign-primary-target">
            ${targetOptions}
          </select>
        </div>
      `,
      actions: [
        { label: 'Cancel', className: 'secondary', onClick: closeModal },
        { label: 'Reassign', onClick: () => _confirmReassignPrimary(primaryName) }
      ]
    });
  } catch (error) {
    showStatus(`Failed to load primary categories: ${error.message}`, 'error');
  }
}

async function _confirmReassignPrimary(primaryName) {
  const targetSelect = document.getElementById('reassign-primary-target');
  const targetPrimary = targetSelect ? targetSelect.value : '';

  if (!targetPrimary) {
    showStatus('Please select a target primary category', 'warning');
    return;
  }

  try {
    showStatus('Reassigning primary category...', 'info');

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/reassign-primary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_primary: primaryName,
        target_primary: targetPrimary
      })
    });

    const data = await response.json();

    if (!response.ok) {
      showStatus(`Failed to reassign primary: ${data.error || 'Unknown error'}`, 'error');
      return;
    }

    closeModal();

    let successMsg = `Successfully reassigned all categories from ${primaryName} to ${targetPrimary}`;
    if (data.rules_affected > 0) {
      successMsg += ` (${data.rules_affected} rule${data.rules_affected !== 1 ? 's' : ''} updated)`;
    }
    if (data.overrides_affected > 0) {
      successMsg += ` (${data.overrides_affected} override${data.overrides_affected !== 1 ? 's' : ''} updated)`;
    }

    showStatus(successMsg, 'success');
    await loadCategorizationData(true);
    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Failed to reassign categories: ${error.message}`, 'error');
  }
}

// ── Reassign Detailed ──────────────────────────────────────

async function openReassignDetailedModal(categoryName) {
  try {
    const parts = parseCategoryName(categoryName);
    const sourcePrimary = parts.primary;

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`);
    const data = await response.json();
    const allAvailablePrimaries = data.available_categories || [];

    // Collect unique primaries from available + custom
    const primarySet = new Set();
    allAvailablePrimaries.forEach(cat => {
      const p = parseCategoryName(cat);
      if (p.primary) primarySet.add(p.primary);
    });
    (customCategories || []).forEach(cat => {
      const p = parseCategoryName(cat);
      if (p.primary) primarySet.add(p.primary);
    });
    const allPrimaries = Array.from(primarySet).sort((a, b) => a.localeCompare(b));

    // Helper: get detailed categories under a given primary
    const _getDetailedForPrimary = (primary) => {
      const detailedSet = new Set();
      (customCategories || [])
        .filter(cat => cat !== categoryName)
        .forEach(cat => {
          const p = parseCategoryName(cat);
          if (p.primary === primary && p.detailed) detailedSet.add(p.detailed);
        });
      allAvailablePrimaries.forEach(cat => {
        const p = parseCategoryName(cat);
        if (p.primary === primary && p.detailed) detailedSet.add(p.detailed);
      });
      return Array.from(detailedSet).sort((a, b) => a.localeCompare(b));
    };

    const samePrimaryDetailed = _getDetailedForPrimary(sourcePrimary);
    const samePrimaryOptions = samePrimaryDetailed
      .map(d => `<option value="${sourcePrimary}|${escapeHtml(d)}">${escapeHtml(d)}</option>`)
      .join('');

    openModal({
      title: 'Reassign Detailed Category',
      body: `
        <p>Move <strong>${escapeHtml(categoryName)}</strong> to where?</p>

        <div style="margin-top: 16px;">
          <label class="inline-checkbox" style="display: block; margin-bottom: 12px;">
            <input type="radio" name="reassign-scope" value="same-primary" checked onchange="updateReassignOptions()">
            Move within <strong>${escapeHtml(sourcePrimary)}</strong> (consolidate with existing)
          </label>
          <label class="inline-checkbox" style="display: block; margin-bottom: 12px;">
            <input type="radio" name="reassign-scope" value="different-primary" onchange="updateReassignOptions()">
            Move to a different primary
          </label>
        </div>

        <div style="margin-top: 12px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 500;">Target category:</label>
          <select id="reassign-detailed-target">
            ${samePrimaryOptions}
          </select>
          <div id="cross-primary-options" style="display: none; margin-top: 12px;">
            <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">Select available detailed categories or create new one:</p>
            <select id="reassign-detailed-target-all">
              <option value="">-- Use same detailed name: ${escapeHtml(parts.detailed || '(primary only)')} --</option>
              ${allPrimaries.flatMap(primary =>
                _getDetailedForPrimary(primary).map(detailed =>
                  `<option value="${escapeHtml(primary)}|${escapeHtml(detailed)}">${escapeHtml(primary)}: ${escapeHtml(detailed)}</option>`
                )
              ).join('')}
            </select>
            <input type="text" id="reassign-detailed-new-name" placeholder="Or enter new detailed name...">
            <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
              Select a target primary below. Leave dropdown as default to keep the detailed name "${escapeHtml(parts.detailed || 'primary')}"
            </p>
            <select id="reassign-target-primary" style="margin-top: 8px;">
              <option value="">-- Select target primary --</option>
              ${allPrimaries.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}
            </select>
          </div>
        </div>
      `,
      actions: [
        { label: 'Cancel', className: 'secondary', onClick: closeModal },
        { label: 'Reassign', onClick: () => _confirmReassignDetailed(categoryName) }
      ]
    });

    // Stash helper data for dynamic option updates from the modal
    window._reassignDetailedCtx = {
      sourcePrimary,
      categoryName,
      allAvailablePrimaries,
      allPrimaries,
      getDetailedForPrimary: _getDetailedForPrimary
    };

    const targetPrimarySelect = document.getElementById('reassign-target-primary');
    if (targetPrimarySelect) {
      targetPrimarySelect.addEventListener('change', updateDetailedCategoriesForPrimary);
    }
  } catch (error) {
    showStatus(`Failed to load categories: ${error.message}`, 'error');
  }
}

function updateDetailedCategoriesForPrimary() {
  const targetPrimary = document.getElementById('reassign-target-primary').value;
  const detailedSelect = document.getElementById('reassign-detailed-target-all');

  if (!targetPrimary || !detailedSelect || !window._reassignDetailedCtx) return;

  const { getDetailedForPrimary } = window._reassignDetailedCtx;
  const detailedCategories = getDetailedForPrimary(targetPrimary);

  const options = detailedCategories.map(detailed =>
    `<option value="${escapeHtml(targetPrimary)}|${escapeHtml(detailed)}">${escapeHtml(targetPrimary)}: ${escapeHtml(detailed)}</option>`
  ).join('');

  detailedSelect.innerHTML = `<option value="">-- Select an existing category or leave empty to create new --</option>${options}`;
}

function updateReassignOptions() {
  const scope = document.querySelector('input[name="reassign-scope"]:checked').value;
  const crossPrimaryDiv = document.getElementById('cross-primary-options');
  const targetSelect = document.getElementById('reassign-detailed-target');

  if (scope === 'same-primary') {
    crossPrimaryDiv.style.display = 'none';
    targetSelect.style.display = 'block';
    targetSelect.disabled = false;
  } else {
    crossPrimaryDiv.style.display = 'block';
    targetSelect.style.display = 'none';
    targetSelect.disabled = true;
  }
}

async function _confirmReassignDetailed(categoryName) {
  const scope = document.querySelector('input[name="reassign-scope"]:checked').value;
  let targetCategory = '';
  let targetPrimary = '';
  let targetDetailedName = '';

  if (scope === 'same-primary') {
    const value = document.getElementById('reassign-detailed-target').value;
    if (!value) {
      showStatus('Please select a target category', 'warning');
      return;
    }
    const [primary, detailed] = value.split('|');
    targetCategory = `${primary}: ${detailed}`;
  } else {
    targetPrimary = document.getElementById('reassign-target-primary').value;
    if (!targetPrimary) {
      showStatus('Please select a target primary category', 'warning');
      return;
    }

    const newName = document.getElementById('reassign-detailed-new-name').value.trim();
    const selectedValue = document.getElementById('reassign-detailed-target-all').value;

    if (newName) {
      targetDetailedName = newName;
    } else if (selectedValue) {
      const [, detailed] = selectedValue.split('|');
      targetDetailedName = detailed || '(primary only)';
    } else {
      const sourceParts = parseCategoryName(categoryName);
      if (sourceParts.detailed) {
        targetDetailedName = sourceParts.detailed;
      } else {
        showStatus('Please enter a new detailed name or select an existing category', 'warning');
        return;
      }
    }
  }

  try {
    showStatus('Reassigning category...', 'info');

    const resolvedTargetPrimary = scope === 'same-primary'
      ? parseCategoryName(categoryName).primary
      : targetPrimary;
    const resolvedTargetDetailed = scope === 'same-primary'
      ? parseCategoryName(targetCategory).detailed
      : targetDetailedName;
    const targetFullName = `${resolvedTargetPrimary}: ${resolvedTargetDetailed}`;

    const ctxAvailable = (window._reassignDetailedCtx && window._reassignDetailedCtx.allAvailablePrimaries)
      ? window._reassignDetailedCtx.allAvailablePrimaries
      : [];
    const isTargetCustom = (customCategories || []).includes(targetFullName);
    const isTargetPlaidDefault = ctxAvailable.includes(targetFullName) && !isTargetCustom;

    if (isTargetPlaidDefault) {
      // Use reassign-delete path to avoid creating a custom category that matches Plaid defaults
      closeModal();
      await deleteCategory(categoryName, 'reassign', targetFullName);
      return;
    }

    const payload = {
      source_category: categoryName,
      target_primary: resolvedTargetPrimary,
      target_detailed_name: resolvedTargetDetailed
    };

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/reassign-detailed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      showStatus(`Failed to reassign category: ${data.error || 'Unknown error'}`, 'error');
      return;
    }

    closeModal();

    let successMsg = `Successfully reassigned ${categoryName} to ${data.target_category}`;
    if (data.consolidation_occurred) successMsg += ' (merged with existing category)';
    if (data.rules_affected > 0) successMsg += ` (${data.rules_affected} rule${data.rules_affected !== 1 ? 's' : ''} updated)`;
    if (data.overrides_affected > 0) successMsg += ` (${data.overrides_affected} override${data.overrides_affected !== 1 ? 's' : ''} updated)`;

    showStatus(successMsg, 'success');
    await loadCategorizationData(true);
    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Failed to reassign category: ${error.message}`, 'error');
  }
}

// ── Delete Category ────────────────────────────────────────

async function deleteCategory(categoryName, actionOverride = null, reassignTargetOverride = null) {
  try {
    const actionEl = !actionOverride ? document.querySelector('input[name="delete-action"]:checked') : null;
    const action = actionOverride || (actionEl ? actionEl.value : 'archive');

    let url = `${BACKEND_URL}/api/categorization/categories/${encodeURIComponent(categoryName)}?action=${action}`;

    if (action === 'reassign') {
      const targetSelect = !reassignTargetOverride ? document.getElementById('reassign-target-category') : null;
      const targetCategory = reassignTargetOverride || (targetSelect ? targetSelect.value : '');
      if (!targetCategory) {
        showStatus('Please select a target category for reassignment', 'warning');
        return;
      }
      url += `&reassign_to=${encodeURIComponent(targetCategory)}`;
    }

    const response = await authenticatedFetch(url, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to delete category', 'error');
      return;
    }

    closeModal();

    const actionLabel = action === 'archive' ? 'archived' : action === 'reassign' ? 'reassigned' : 'deleted';
    showStatus(
      `Category ${actionLabel}` +
      (data.rules_affected > 0 ? ` (${data.rules_affected} rules affected)` : '') +
      (data.overrides_affected > 0 ? ` (${data.overrides_affected} overrides affected)` : ''),
      'success'
    );

    await loadCategorizationData(true);
    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Failed to delete category: ${error.message}`, 'error');
  }
}

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
      const changes = JSON.stringify(log.changes || {});
      const stats = log.stats ? JSON.stringify(log.stats) : '';
      return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td>${escapeHtml(log.migration_type || '')}</td>
          <td>${escapeHtml(changes)}</td>
          <td>${escapeHtml(stats)}</td>
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

function showMigrationsHelp() {
  openModal({
    title: 'Category Migrations Help',
    body: `
      <div style="text-align: left; line-height: 1.6;">
        <h4 style="margin-top: 0;">When to Use Category Migrations</h4>

        <h5>Rename</h5>
        <p>Use when you want to change the name of an existing category everywhere it's referenced. This updates:</p>
        <ul>
          <li>Category mappings</li>
          <li>Rules that reference the old name</li>
          <li>Overrides on historical transactions</li>
          <li>All future transaction categorization</li>
        </ul>
        <p><strong>Example:</strong> Rename "Fast Food" to "Quick Service Restaurants"</p>

        <h5>Merge</h5>
        <p>Use when you want to consolidate multiple separate categories into one. This is useful for:</p>
        <ul>
          <li>Simplifying your category taxonomy</li>
          <li>Combining similar spending categories</li>
          <li>Consolidating after re-evaluating your budget categories</li>
        </ul>
        <p><strong>Example:</strong> Merge "Fast Food", "Restaurants", and "Coffee Shops" into "Dining"</p>

        <h4>Important Notes</h4>
        <ul>
          <li>These operations are permanent and affect all your historical data</li>
          <li>Always backup your data before major migrations</li>
          <li>Check the Audit Log to see what changes were made</li>
          <li>For moving categories between primaries, use the "Reassign" buttons in Custom Categories instead</li>
        </ul>
      </div>
    `,
    actions: [
      { label: 'Close', className: 'secondary', onClick: closeModal }
    ]
  });
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
    'This will re-run the categorization pipeline (mappings → rules → overrides) on all transactions. This may take a moment.'
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
