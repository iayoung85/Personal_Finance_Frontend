// ============================================================
// categories/preview-panel.js — Category Preview Rendering
// Renders the "Category Output Preview" card and
// the "Custom Categories" preview (primary + detailed panes).
// ============================================================

// ── Category Output Preview (read-only taxonomy view) ───────

function renderAvailableCategoriesPreview() {
  const primaryList = document.getElementById('primary-category-list');
  const detailedList = document.getElementById('detailed-category-list');
  const primaryCount = document.getElementById('primary-selected-count');
  const detailedCount = document.getElementById('detailed-count');

  if (!primaryList || !detailedList) return;

  const primarySet = new Set();
  (availableCategories || []).forEach(cat => {
    const parts = parseCategoryName(cat);
    if (parts.primary) primarySet.add(parts.primary);
  });

  const primaryOptions = Array.from(primarySet).sort((a, b) => a.localeCompare(b));

  if (!primaryOptions.length) {
    primaryList.innerHTML = '<div class="empty-state">No categories available.</div>';
    detailedList.innerHTML = '<div class="empty-state">No categories available.</div>';
    if (primaryCount) primaryCount.textContent = '';
    if (detailedCount) detailedCount.textContent = '';
    return;
  }

  if (!selectedPrimaryCategories || selectedPrimaryCategories.size === 0) {
    selectedPrimaryCategories = new Set(['__all__']);
  }

  const primaryItems = [
    { key: '__all__', label: 'All' },
    ...primaryOptions.map(primary => ({ key: primary, label: primary }))
  ];

  const rows = primaryItems
    .map((item, index) => {
      const isSelected = selectedPrimaryCategories.has(item.key);
      return `
        <div class="preview-item ${isSelected ? 'selected' : ''}" data-primary="${escapeHtml(item.key)}" data-index="${index}">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span>${escapeHtml(item.label)}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              ${item.key === '__all__' ? '<span class="pill">All</span>' : `<button class="secondary" style="padding: 3px 8px; font-size: 11px; white-space: nowrap;" onclick="startAddDetailsForPrimary('${escapeHtml(item.key)}'); event.stopPropagation();">+ Add Custom Detailed Cat</button>`}
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  primaryList.innerHTML = rows;

  primaryList.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('click', event => {
      const key = item.getAttribute('data-primary');
      const index = parseInt(item.getAttribute('data-index') || '0', 10);
      if (!key) return;

      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      if (key === '__all__') {
        selectedPrimaryCategories = new Set(['__all__']);
        lastSelectedPrimaryIndex = index;
        renderAvailableCategoriesPreview();
        return;
      }

      if (isShift && lastSelectedPrimaryIndex !== null) {
        const start = Math.min(lastSelectedPrimaryIndex, index);
        const end = Math.max(lastSelectedPrimaryIndex, index);
        const rangeKeys = primaryItems
          .slice(start, end + 1)
          .map(rangeItem => rangeItem.key)
          .filter(itemKey => itemKey !== '__all__');

        if (isCtrl) {
          selectedPrimaryCategories.delete('__all__');
          rangeKeys.forEach(rangeKey => selectedPrimaryCategories.add(rangeKey));
        } else {
          selectedPrimaryCategories = new Set(rangeKeys);
        }
      } else if (isCtrl) {
        if (selectedPrimaryCategories.has('__all__')) {
          selectedPrimaryCategories.delete('__all__');
        }
        if (selectedPrimaryCategories.has(key)) {
          selectedPrimaryCategories.delete(key);
        } else {
          selectedPrimaryCategories.add(key);
        }
      } else {
        selectedPrimaryCategories = new Set([key]);
      }

      if (selectedPrimaryCategories.size === 0) {
        selectedPrimaryCategories.add('__all__');
      }

      lastSelectedPrimaryIndex = index;
      renderAvailableCategoriesPreview();
    });
  });

  const selectedCount = selectedPrimaryCategories.has('__all__')
    ? primaryOptions.length
    : selectedPrimaryCategories.size;

  if (primaryCount) {
    primaryCount.textContent = `${selectedCount} selected`;
  }

  const detailedRows = _buildDetailedPreviewRows();
  detailedList.innerHTML = detailedRows.html;
  if (detailedCount) detailedCount.textContent = `${detailedRows.count} total`;
}

function _buildDetailedPreviewRows() {
  const list = availableCategories || [];
  const filtered = selectedPrimaryCategories.has('__all__')
    ? list
    : list.filter(cat => selectedPrimaryCategories.has(parseCategoryName(cat).primary));

  const sorted = filtered.slice().sort((a, b) => a.localeCompare(b));
  if (!sorted.length) {
    return { html: '<div class="empty-state">No detailed categories match your selection.</div>', count: 0 };
  }

  const html = sorted
    .map(cat => `<div class="preview-item disabled"><span>${escapeHtml(cat)}</span></div>`)
    .join('');

  return { html, count: sorted.length };
}

// ── Custom Categories Preview ───────────────────────────────

function renderCustomCategories() {
  if (!customCategories.length) {
    const primaryContainer = document.getElementById('custom-primary-category-list');
    const detailedContainer = document.getElementById('custom-detailed-category-list');
    const primaryCountElement = document.getElementById('custom-primary-selected-count');
    const detailedCountElement = document.getElementById('custom-detailed-count');

    if (primaryContainer) primaryContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    if (detailedContainer) detailedContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    if (primaryCountElement) primaryCountElement.textContent = '';
    if (detailedCountElement) detailedCountElement.textContent = '';
    return;
  }

  _renderCustomCategoryFiltered();
}

function _renderCustomCategoryFiltered() {
  const primaryContainer = document.getElementById('custom-primary-category-list');
  const detailedContainer = document.getElementById('custom-detailed-category-list');
  const primaryCountElement = document.getElementById('custom-primary-selected-count');
  const detailedCountElement = document.getElementById('custom-detailed-count');

  if (!primaryContainer || !detailedContainer) return;

  // Group custom categories by primary
  const primaryMap = {};
  (customCategories || []).forEach(cat => {
    const parts = parseCategoryName(cat);
    if (!primaryMap[parts.primary]) {
      primaryMap[parts.primary] = [];
    }
    if (parts.detailed) {
      primaryMap[parts.primary].push(parts.detailed);
    }
  });

  const primaryOptions = Object.keys(primaryMap).sort((a, b) => a.localeCompare(b));

  if (!primaryOptions.length) {
    primaryContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    detailedContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    if (primaryCountElement) primaryCountElement.textContent = '';
    if (detailedCountElement) detailedCountElement.textContent = '';
    return;
  }

  // Initialize selection if empty
  if (!selectedCustomPrimaryCategories || selectedCustomPrimaryCategories.size === 0) {
    selectedCustomPrimaryCategories = new Set([primaryOptions[0]]);
  }

  const primaryItems = primaryOptions.map((primary, index) => ({
    key: primary,
    label: primary,
    index
  }));

  const rows = primaryItems
    .map((item) => {
      const isSelected = selectedCustomPrimaryCategories.has(item.key);
      return `
        <div class="preview-item ${isSelected ? 'selected' : ''}" data-primary="${escapeHtml(item.key)}" data-index="${item.index}">
          <span>${escapeHtml(item.label)}</span>
        </div>
      `;
    })
    .join('');

  primaryContainer.innerHTML = rows;

  primaryContainer.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('click', event => {
      const key = item.getAttribute('data-primary');
      const index = parseInt(item.getAttribute('data-index') || '0', 10);
      if (!key) return;

      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      if (isShift && lastSelectedCustomPrimaryIndex !== null) {
        const start = Math.min(lastSelectedCustomPrimaryIndex, index);
        const end = Math.max(lastSelectedCustomPrimaryIndex, index);
        const rangeKeys = primaryItems
          .slice(start, end + 1)
          .map(rangeItem => rangeItem.key);

        if (isCtrl) {
          rangeKeys.forEach(rangeKey => selectedCustomPrimaryCategories.add(rangeKey));
        } else {
          selectedCustomPrimaryCategories = new Set(rangeKeys);
        }
      } else if (isCtrl) {
        if (selectedCustomPrimaryCategories.has(key)) {
          selectedCustomPrimaryCategories.delete(key);
        } else {
          selectedCustomPrimaryCategories.add(key);
        }
      } else {
        selectedCustomPrimaryCategories = new Set([key]);
      }

      if (selectedCustomPrimaryCategories.size === 0) {
        selectedCustomPrimaryCategories = new Set([primaryOptions[0]]);
      }

      lastSelectedCustomPrimaryIndex = index;
      _renderCustomCategoryFiltered();
    });
  });

  // Display detailed categories with action buttons
  const detailedRows = _buildCustomDetailedPreviewRows(primaryMap);
  detailedContainer.innerHTML = detailedRows.html;

  if (primaryCountElement) {
    primaryCountElement.textContent = `${primaryOptions.length} total`;
  }
  if (detailedCountElement) {
    detailedCountElement.textContent = `${detailedRows.count} total`;
  }
}

function _buildCustomDetailedPreviewRows(primaryMap) {
  const rows = [];

  Array.from(selectedCustomPrimaryCategories).forEach(selectedPrimary => {
    if (!primaryMap[selectedPrimary]) return;

    const detailedList = primaryMap[selectedPrimary];
    const primary = selectedPrimary;

    // Primary row with action buttons
    rows.push(`
      <div class="custom-category-row" style="background: var(--bg-surface-elevated); padding: 8px 12px; margin: 8px 0; border-radius: 4px; border-left: 3px solid var(--accent-primary);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600;">${escapeHtml(primary)}</span>
          <div style="display: flex; gap: 6px;">
            <button class="secondary" style="padding: 4px 8px; font-size: 12px;" onclick="startAddDetailsForCategory('${escapeHtml(primary)}')">+ Add Detailed</button>
            <button class="secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openReassignPrimaryModal('${escapeHtml(primary)}')" title="Move all detailed categories under this primary to another primary. All rules and overrides will follow.">Reassign</button>
          </div>
        </div>
      </div>
    `);

    // Detailed category rows
    if (detailedList && detailedList.length > 0) {
      detailedList.forEach(detailed => {
        const fullCategoryName = `${primary}: ${detailed}`;
        rows.push(`
          <div class="custom-detailed-row" style="padding: 6px 12px 6px 24px; margin: 4px 0; background: var(--bg-surface); border-radius: 3px; display: flex; justify-content: space-between; align-items: center;">
            <span>${escapeHtml(detailed)}</span>
            <div style="display: flex; gap: 6px;">
              <button class="secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openReassignDetailedModal('${escapeHtml(fullCategoryName)}')" title="Move this category to a different primary or consolidate with another detailed category. All rules and overrides will follow.">Reassign</button>
            </div>
          </div>
        `);
      });
    } else {
      rows.push(`
        <div style="padding: 6px 12px 6px 24px; margin: 4px 0; color: var(--text-muted); font-size: 13px; font-style: italic;">
          No detailed categories
        </div>
      `);
    }
  });

  if (rows.length === 0) {
    return { html: '<div class="empty-state">No custom categories match your selection.</div>', count: 0 };
  }

  // Count total detailed categories
  let totalDetailed = 0;
  Array.from(selectedCustomPrimaryCategories).forEach(primary => {
    if (primaryMap[primary]) {
      totalDetailed += primaryMap[primary].length;
    }
  });

  return { html: rows.join(''), count: totalDetailed };
}

// ── Custom Category Form Helpers ────────────────────────────

function addDetailedCategoryField(value = '') {
  const container = document.getElementById('detailed-categories-list');
  if (!container) return;

  const fieldId = `detailed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fieldDiv = document.createElement('div');
  fieldDiv.className = 'detailed-field-row';
  fieldDiv.innerHTML = `
    <input type="text" id="${fieldId}" placeholder="e.g., Lawn Care" value="${escapeHtml(value)}">
    <button type="button" class="secondary remove-detailed-btn" onclick="removeDetailedCategoryField('${fieldId}')">×</button>
  `;
  container.appendChild(fieldDiv);
  return fieldDiv.querySelector('input');
}

function removeDetailedCategoryField(fieldId) {
  const field = document.getElementById(fieldId);
  if (field && field.parentElement) {
    field.parentElement.remove();
  }
}

function getDetailedCategoryValues() {
  const container = document.getElementById('detailed-categories-list');
  if (!container) return [];

  const inputs = container.querySelectorAll('input[type="text"]');
  return Array.from(inputs)
    .map(input => (input.value || '').trim())
    .filter(Boolean);
}

function clearDetailedCategoryFields() {
  const container = document.getElementById('detailed-categories-list');
  if (container) {
    container.innerHTML = '';
  }
}

function startAddDetailsForCategory(categoryName) {
  const parts = parseCategoryName(categoryName);
  if (!parts.primary) return;

  const primaryInput = document.getElementById('custom-primary-input');
  if (primaryInput) {
    primaryInput.value = parts.primary;
    primaryInput.readOnly = true;
  }

  clearDetailedCategoryFields();
  const newInput = addDetailedCategoryField();
  if (newInput) {
    newInput.focus();
  } else if (primaryInput) {
    primaryInput.focus();
  }

  const card = document.getElementById('custom-categories-card');
  if (card && card.scrollIntoView) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function startAddDetailsForPrimary(primaryName) {
  const primaryInput = document.getElementById('custom-primary-input');
  if (primaryInput) {
    primaryInput.value = primaryName;
    primaryInput.readOnly = true;
  }

  clearDetailedCategoryFields();
  const newInput = addDetailedCategoryField();
  if (newInput) {
    newInput.focus();
  } else if (primaryInput) {
    primaryInput.focus();
  }

  const card = document.getElementById('custom-categories-card');
  if (card && card.scrollIntoView) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function addCustomCategoryGroup() {
  const primaryInput = document.getElementById('custom-primary-input');
  const primary = (primaryInput?.value || '').trim();

  if (!primary) {
    showStatus('Enter a primary category', 'warning');
    return;
  }
  if (primary.includes(':')) {
    showStatus('Primary category should not include ":"', 'warning');
    return;
  }

  const detailedValues = getDetailedCategoryValues();
  if (!detailedValues.length) {
    showStatus('Add at least one detailed category', 'warning');
    return;
  }
  const categoriesToAdd = detailedValues.map(detail => `${primary}: ${detail}`);
  const uniqueCategories = Array.from(new Set(categoriesToAdd));

  let successCount = 0;
  const errors = [];

  if (detailedValues.length && (customCategories || []).includes(primary)) {
    await deleteCategory(primary, 'delete');
  }

  for (const categoryName of uniqueCategories) {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: categoryName })
      });
      const data = await response.json();
      if (!response.ok) {
        errors.push(data.error || `Failed to add ${categoryName}`);
        continue;
      }
      successCount += 1;
    } catch (networkError) {
      errors.push(networkError.message || `Failed to add ${categoryName}`);
    }
  }

  if (successCount > 0) {
    if (primaryInput) {
      primaryInput.value = '';
      primaryInput.readOnly = false;
    }
    clearDetailedCategoryFields();
    addDetailedCategoryField();
    const message = errors.length
      ? `Added ${successCount} categories. ${errors.length} failed.`
      : `Added ${successCount} ${successCount === 1 ? 'category' : 'categories'}.`;
    showStatus(message, errors.length ? 'warning' : 'success');
    await loadCategorizationData(true);
    setTimeout(() => clearStatus(), 2500);
  } else {
    showStatus(errors[0] || 'Failed to add categories', 'error');
  }
}

async function addCustomCategory() {
  return addCustomCategoryGroup();
}
