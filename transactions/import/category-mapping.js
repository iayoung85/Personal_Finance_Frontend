// ============================================================
// transactions/import/category-mapping.js — Step 2: Category Mapping
// Two-pass layout: auto-matched categories collapsed,
// unmapped categories prominent. Grouped by type (regular,
// transfers, investment adjustments). Batch assignment,
// search filter, and advisory banner.
// ============================================================

// Tracks which category groups are expanded in the UI
let importCategoryGroupExpanded = {
  unmatched: true,
  matched: false,
  transfers: false,
  investment: false,
};

// Tracks which category rows are selected for batch assignment
let importCategoryBatchSelected = new Set();

// Search filter text
let importCategoryFilterText = '';

/**
 * Render the category mapping step into the wizard body.
 */
function renderCategoryMappingStep(container) {
  if (!importAnalysis || !importAnalysis.categories) {
    container.innerHTML = '<div class="import-error-banner">No analysis data. Go back and upload a file.</div>';
    return;
  }

  const allCategories = importAnalysis.categories;

  // Classify categories into groups
  const transferCategories = allCategories.filter(cat => cat.is_transfer);
  const investmentCategories = allCategories.filter(cat => cat.is_investment_adjustment && !cat.is_transfer);
  const regularCategories = allCategories.filter(cat => !cat.is_transfer && !cat.is_investment_adjustment);

  // Split regular into matched vs unmatched
  const matchedRegular = regularCategories.filter(cat => _hasCategoryMapping(cat.csv_name));
  const unmatchedRegular = regularCategories.filter(cat => !_hasCategoryMapping(cat.csv_name));

  let html = '';

  html += `<h2 style="margin: 0 0 6px 0; font-size: 18px; color: var(--text-heading);">Map Categories</h2>`;
  html += `<p style="color: var(--text-secondary); margin: 0 0 14px 0; font-size: 13px;">
    Assign each CSV category to an existing app category, create a new one, or skip it.
  </p>`;

  // Advisory banner
  html += `
    <div class="import-advisor-banner">
      <strong>💡 Tip: Build your category structure first</strong>
      Before importing, visit the Categories page to set up your category mappings and custom categories.
      The closer your app categories match your CSV categories, the fewer manual adjustments you'll
      need here — the auto-matcher will handle most of the work for you.
    </div>
  `;

  // Search filter
  html += `
    <div class="import-category-filter">
      <input type="text" placeholder="Filter categories…" value="${escapeHtml(importCategoryFilterText)}"
             oninput="_onCategoryFilterChange(this.value)" id="import-category-filter-input">
      <span style="color: var(--text-muted); font-size: 12px;">
        ${allCategories.length} total · ${unmatchedRegular.length} need mapping
      </span>
    </div>
  `;

  // Batch assignment bar (visible when items are selected)
  if (importCategoryBatchSelected.size > 0) {
    html += _renderBatchAssignmentBar();
  }

  // Group 1: Needs Mapping (expanded by default)
  if (unmatchedRegular.length > 0) {
    html += _renderCategoryGroup(
      'unmatched',
      `Needs Mapping`,
      unmatchedRegular,
      unmatchedRegular.length,
      true
    );
  }

  // Group 2: Auto-Matched (collapsed by default)
  if (matchedRegular.length > 0) {
    html += _renderCategoryGroup(
      'matched',
      `Auto-Matched — Review for Accuracy`,
      matchedRegular,
      matchedRegular.length,
      false
    );
  }

  // Group 3: Transfers (collapsed by default)
  if (transferCategories.length > 0) {
    const autoTransferCount = transferCategories.filter(cat => {
      const mapping = importCategoryMappings[cat.csv_name];
      return mapping && mapping.target_category === '__auto_transfer__';
    }).length;
    const transferNote = autoTransferCount === transferCategories.length
      ? 'Each transfer will be assigned Transfer In or Transfer Out based on whether the amount is a credit or debit.'
      : autoTransferCount > 0
        ? `${autoTransferCount} of ${transferCategories.length} transfers set to auto-assign. The rest need a mapping decision.`
        : 'Select "Auto: Transfer In / Out" to let the import assign Transfer In or Transfer Out by amount direction.';
    html += _renderCategoryGroup(
      'transfers',
      `Transfers`,
      transferCategories,
      transferCategories.length,
      false,
      transferNote
    );
  }

  // Group 4: Investment Adjustments (collapsed by default)
  if (investmentCategories.length > 0) {
    html += _renderCategoryGroup(
      'investment',
      `Investment Adjustments`,
      investmentCategories,
      investmentCategories.length,
      false,
      'These appear to be end-of-month gains/losses entries. Map them to an investment trending category so the app incorporates them into your investment performance timeline.'
    );
  }

  container.innerHTML = html;
}

/**
 * Render a collapsible category group.
 */
function _renderCategoryGroup(groupKey, title, categories, count, defaultExpanded, note) {
  const isExpanded = importCategoryGroupExpanded[groupKey] !== undefined
    ? importCategoryGroupExpanded[groupKey]
    : defaultExpanded;

  const filterLower = importCategoryFilterText.toLowerCase();
  const filteredCategories = filterLower
    ? categories.filter(cat => cat.csv_name.toLowerCase().includes(filterLower))
    : categories;

  const chevron = isExpanded ? '▾' : '▸';

  let html = '<div class="import-mapping-section">';

  html += `
    <div class="import-mapping-section-title">
      <button class="import-category-group-toggle" onclick="_toggleCategoryGroup('${groupKey}')">
        ${chevron}
      </button>
      ${escapeHtml(title)}
      <span class="import-mapping-badge">${count}</span>
    </div>
  `;

  if (note && isExpanded) {
    html += `<div class="import-info-banner" style="margin-bottom: 10px;">${escapeHtml(note)}</div>`;
  }

  if (isExpanded) {
    if (filteredCategories.length === 0 && filterLower) {
      html += '<p style="color: var(--text-muted); font-size: 13px; padding: 8px 12px;">No categories match the filter.</p>';
    } else {
      html += '<table class="import-mapping-table">';
      html += `<thead><tr>
        <th style="width: 30px;"><input type="checkbox" onchange="_onCategoryBatchSelectAll(this.checked, '${groupKey}')" title="Select all for batch assign"></th>
        <th style="width: 35%;">CSV Category</th>
        <th style="width: 60px; text-align: center;">Txns</th>
        <th style="width: 50%;">Map To</th>
      </tr></thead>`;
      html += '<tbody>';

      for (const cat of filteredCategories) {
        html += _renderCategoryRow(cat, groupKey);
      }

      html += '</tbody></table>';
    }
  }

  html += '</div>';
  return html;
}

/**
 * Render a single category mapping row.
 */
function _renderCategoryRow(category, groupKey) {
  const csvName = category.csv_name;
  const currentMapping = importCategoryMappings[csvName];
  const isIgnored = currentMapping && currentMapping.action === 'ignore';
  const isSelected = importCategoryBatchSelected.has(csvName);
  const rowClass = isIgnored ? 'import-row-ignored' : (currentMapping ? 'import-row-matched' : '');

  let html = `<tr class="${rowClass}">`;
  html += `<td><input type="checkbox" ${isSelected ? 'checked' : ''}
               onchange="_onCategoryBatchToggle('${_escapeAttr(csvName)}', this.checked)"></td>`;
  html += `<td><strong>${escapeHtml(csvName)}</strong></td>`;
  html += `<td class="import-txn-count">${category.transaction_count}</td>`;
  html += `<td>${_renderCategoryMappingDropdown(csvName, currentMapping, category)}</td>`;
  html += '</tr>';

  // If create_new, show inline input
  if (currentMapping && currentMapping.action === 'create_new') {
    html += `<tr><td></td><td colspan="3" style="padding-top: 0;">
      <input type="text" class="import-mapping-select" style="max-width: 300px;"
             placeholder="Primary: Detailed (e.g., Food And Drink: Coffee)"
             value="${escapeHtml(currentMapping.new_category_name || '')}"
             onchange="_updateNewCategoryName('${_escapeAttr(csvName)}', this.value)">
    </td></tr>`;
  }

  return html;
}

/**
 * Build the category mapping dropdown.
 */
function _renderCategoryMappingDropdown(csvName, currentMapping, category) {
  const selectedAction = currentMapping ? currentMapping.action : '';
  const selectedTarget = currentMapping ? (currentMapping.target_category || '') : '';

  // Use the suggestion as placeholder text when no mapping exists
  const suggestion = category.suggested_app_category;
  const hasSuggestion = suggestion && !currentMapping;

  let html = `<select class="import-mapping-select"
               onchange="_onCategoryMappingChange('${_escapeAttr(csvName)}', this.value)"
               ${hasSuggestion ? `style="color: var(--text-muted);"` : ''}>`;

  if (hasSuggestion) {
    html += `<option value="" selected>Suggested: ${escapeHtml(suggestion)}</option>`;
  } else if (!currentMapping) {
    html += '<option value="">— Select —</option>';
  }

  html += `<option value="__ignore__"${selectedAction === 'ignore' ? ' selected' : ''}>Skip / Ignore</option>`;
  html += `<option value="__auto_transfer__"${selectedAction === 'map' && selectedTarget === '__auto_transfer__' ? ' selected' : ''}>Auto: Transfer In / Out (by amount)</option>`;
  html += `<option value="__create_new__"${selectedAction === 'create_new' ? ' selected' : ''}>+ Create New Category</option>`;

  // Build a deduplicated, sorted list of available categories
  const sortedCategories = _getSortedAvailableCategories();

  if (sortedCategories.length > 0) {
    html += '<optgroup label="Your Categories">';
    for (const appCategory of sortedCategories) {
      const isSelected = selectedAction === 'map' && selectedTarget === appCategory;
      html += `<option value="${escapeHtml(appCategory)}"${isSelected ? ' selected' : ''}>`;
      html += escapeHtml(appCategory);
      html += '</option>';
    }
    html += '</optgroup>';
  }

  html += '</select>';
  return html;
}

/**
 * Handle a change in the category mapping dropdown.
 */
function _onCategoryMappingChange(csvName, selectedValue) {
  if (selectedValue === '__ignore__') {
    importCategoryMappings[csvName] = { action: 'ignore' };
  } else if (selectedValue === '__create_new__') {
    importCategoryMappings[csvName] = {
      action: 'create_new',
      new_category_name: '',
    };
  } else if (selectedValue) {
    importCategoryMappings[csvName] = {
      action: 'map',
      target_category: selectedValue,
    };
  } else {
    delete importCategoryMappings[csvName];
  }

  // Check if this is an investment adjustment category being mapped
  const analysisCategory = importAnalysis.categories.find(cat => cat.csv_name === csvName);
  if (analysisCategory && analysisCategory.is_investment_adjustment && selectedValue && selectedValue !== '__ignore__' && selectedValue !== '__create_new__') {
    importCategoryMappings[csvName].route_to_investment_trending = true;
  }

  const body = document.getElementById('import-wizard-body');
  renderCategoryMappingStep(body);
}

function _updateNewCategoryName(csvName, value) {
  if (importCategoryMappings[csvName]) {
    importCategoryMappings[csvName].new_category_name = value;
    _saveImportProgress();
  }
}

// ── Batch Assignment ──────────────────────────────────────────

function _onCategoryBatchToggle(csvName, isChecked) {
  if (isChecked) {
    importCategoryBatchSelected.add(csvName);
  } else {
    importCategoryBatchSelected.delete(csvName);
  }
  const body = document.getElementById('import-wizard-body');
  renderCategoryMappingStep(body);
}

function _onCategoryBatchSelectAll(isChecked, groupKey) {
  const allCategories = importAnalysis.categories;
  const groupCategories = _getCategoriesForGroup(groupKey, allCategories);

  for (const cat of groupCategories) {
    if (isChecked) {
      importCategoryBatchSelected.add(cat.csv_name);
    } else {
      importCategoryBatchSelected.delete(cat.csv_name);
    }
  }

  const body = document.getElementById('import-wizard-body');
  renderCategoryMappingStep(body);
}

function _getCategoriesForGroup(groupKey, allCategories) {
  switch (groupKey) {
    case 'unmatched':
      return allCategories.filter(cat => !cat.is_transfer && !cat.is_investment_adjustment && !_hasCategoryMapping(cat.csv_name));
    case 'matched':
      return allCategories.filter(cat => !cat.is_transfer && !cat.is_investment_adjustment && _hasCategoryMapping(cat.csv_name));
    case 'transfers':
      return allCategories.filter(cat => cat.is_transfer);
    case 'investment':
      return allCategories.filter(cat => cat.is_investment_adjustment && !cat.is_transfer);
    default:
      return [];
  }
}

function _renderBatchAssignmentBar() {
  const count = importCategoryBatchSelected.size;
  const sortedCategories = _getSortedAvailableCategories();

  let html = '<div class="import-batch-bar">';
  html += `<span class="import-batch-bar-count">${count} selected</span>`;
  html += '<select id="import-batch-category-select">';
  html += '<option value="">— Assign all to… —</option>';
  html += '<option value="__ignore__">Skip / Ignore</option>';
  html += '<option value="__auto_transfer__">Auto: Transfer In / Out (by amount)</option>';
  for (const appCat of sortedCategories) {
    html += `<option value="${escapeHtml(appCat)}">${escapeHtml(appCat)}</option>`;
  }
  html += '</select>';
  html += '<button class="import-btn import-btn-primary" style="padding: 4px 14px; font-size: 13px;" onclick="_applyBatchCategoryAssignment()">Apply</button>';
  html += `<button class="import-btn import-btn-secondary" style="padding: 4px 14px; font-size: 13px;" onclick="_clearCategoryBatchSelection()">Clear</button>`;
  html += '</div>';
  return html;
}

function _applyBatchCategoryAssignment() {
  const selectElement = document.getElementById('import-batch-category-select');
  const selectedValue = selectElement ? selectElement.value : '';
  if (!selectedValue) return;

  for (const csvName of importCategoryBatchSelected) {
    if (selectedValue === '__ignore__') {
      importCategoryMappings[csvName] = { action: 'ignore' };
    } else {
      importCategoryMappings[csvName] = {
        action: 'map',
        target_category: selectedValue,
      };
    }
  }

  importCategoryBatchSelected.clear();
  const body = document.getElementById('import-wizard-body');
  renderCategoryMappingStep(body);
}

function _clearCategoryBatchSelection() {
  importCategoryBatchSelected.clear();
  const body = document.getElementById('import-wizard-body');
  renderCategoryMappingStep(body);
}

// ── Filter / Toggle ───────────────────────────────────────────

function _onCategoryFilterChange(value) {
  importCategoryFilterText = value;
  const body = document.getElementById('import-wizard-body');
  renderCategoryMappingStep(body);

  // Restore focus to the filter input after re-render
  const filterInput = document.getElementById('import-category-filter-input');
  if (filterInput) {
    filterInput.focus();
    filterInput.setSelectionRange(value.length, value.length);
  }
}

function _toggleCategoryGroup(groupKey) {
  importCategoryGroupExpanded[groupKey] = !importCategoryGroupExpanded[groupKey];
  const body = document.getElementById('import-wizard-body');
  renderCategoryMappingStep(body);
}

// ── Validation ────────────────────────────────────────────────

/**
 * Validate that every CSV category has a mapping decision.
 * Categories with a backend suggestion that the user hasn't touched
 * are auto-accepted as 'map' with the suggestion.
 */
function _validateCategoryMappingsUI() {
  if (!importAnalysis || !importAnalysis.categories) return false;

  // Auto-accept suggestions the user hasn't explicitly changed
  for (const category of importAnalysis.categories) {
    const csvName = category.csv_name;
    if (!importCategoryMappings[csvName] && category.suggested_app_category) {
      importCategoryMappings[csvName] = {
        action: 'map',
        target_category: category.suggested_app_category,
      };
    }
  }

  const unmapped = [];
  const createErrors = [];

  for (const category of importAnalysis.categories) {
    const csvName = category.csv_name;
    const mapping = importCategoryMappings[csvName];

    if (!mapping) {
      unmapped.push(csvName);
      continue;
    }

    if (mapping.action === 'create_new' && (!mapping.new_category_name || !mapping.new_category_name.trim())) {
      createErrors.push(`"${csvName}" — new category name is required`);
    }
  }

  if (unmapped.length > 0 || createErrors.length > 0) {
    let errorMsg = '';
    if (unmapped.length > 0) {
      errorMsg += `${unmapped.length} category(ies) still need a mapping decision: ${unmapped.slice(0, 3).join(', ')}`;
      if (unmapped.length > 3) errorMsg += ` and ${unmapped.length - 3} more`;
      errorMsg += '. ';
    }
    if (createErrors.length > 0) {
      errorMsg += createErrors.join('; ');
    }

    const existingError = document.querySelector('#import-wizard-body .import-error-banner');
    if (existingError) {
      existingError.textContent = errorMsg;
    } else {
      const body = document.getElementById('import-wizard-body');
      const banner = document.createElement('div');
      banner.className = 'import-error-banner';
      banner.textContent = errorMsg;
      body.insertBefore(banner, body.firstChild);
    }
    return false;
  }

  return true;
}

// ── Helpers ───────────────────────────────────────────────────

function _hasCategoryMapping(csvName) {
  return !!importCategoryMappings[csvName];
}

function _getSortedAvailableCategories() {
  const unique = new Set(availableCategories || []);
  return Array.from(unique).sort((catA, catB) => catA.localeCompare(catB));
}
