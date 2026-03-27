// ============================================================
// transactions/import/account-mapping.js — Step 1: Account Mapping
// Compact table of CSV accounts → user's existing accounts,
// with "Create New", "Skip/Ignore", lock-balance, and linked
// account warnings.
// ============================================================

// Cached popular institutions so we only fetch once per session
let _importPopularInstitutionsCache = null;

// Whether auto-suggest has already run for this analysis session
let _importAutoSuggestApplied = false;

/**
 * Render the account mapping step into the wizard body.
 */
function renderAccountMappingStep(container) {
  if (!importAnalysis || !importAnalysis.accounts) {
    container.innerHTML = '<div class="import-error-banner">No analysis data. Go back and upload a file.</div>';
    return;
  }

  // Run auto-suggest once per analysis session to pre-fill likely matches
  _autoSuggestAccountMappings();

  const csvAccounts = importAnalysis.accounts;
  let html = '';

  html += `<h2 style="margin: 0 0 6px 0; font-size: 18px; color: var(--text-heading);">Map Accounts</h2>`;
  html += `<p style="color: var(--text-secondary); margin: 0 0 18px 0; font-size: 13px;">
    Assign each CSV account to an existing account, create a new one, or skip it entirely.
  </p>`;

  // Bulk action buttons
  html += '<div class="import-bulk-actions">';
  html += '<button class="import-bulk-btn" onclick="_bulkIgnoreAllAccounts()">Skip All</button>';
  html += '<button class="import-bulk-btn" onclick="_bulkResuggestAllAccounts()">Auto-Suggest All</button>';
  html += '</div>';

  html += '<table class="import-mapping-table">';
  html += `<thead><tr>
    <th style="width: 30%;">CSV Account</th>
    <th style="width: 70px; text-align: center;">Txns</th>
    <th style="width: 140px;">Date Range</th>
    <th style="width: 40%;">Map To</th>
  </tr></thead>`;
  html += '<tbody>';

  for (const csvAccount of csvAccounts) {
    const csvName = csvAccount.csv_name;
    const currentMapping = importAccountMappings[csvName];
    const isIgnored = currentMapping && currentMapping.action === 'ignore';
    const rowClass = isIgnored ? 'import-row-ignored' : '';

    html += `<tr class="${rowClass}" id="import-acct-row-${_safeId(csvName)}">`;
    html += `<td><strong>${escapeHtml(csvName)}</strong></td>`;
    html += `<td class="import-txn-count">${csvAccount.transaction_count}</td>`;
    html += `<td class="import-date-range">${_formatDateRange(csvAccount.date_range)}</td>`;
    html += `<td>${_renderAccountMappingDropdown(csvName, currentMapping)}</td>`;
    html += '</tr>';

    // Extra row for create-new form or linked warning
    if (currentMapping && currentMapping.action === 'create_new') {
      html += `<tr id="import-acct-create-${_safeId(csvName)}">`;
      html += `<td colspan="4">${_renderCreateAccountForm(csvName, currentMapping.new_account_config)}</td>`;
      html += '</tr>';
    }

    // Lock-balance checkbox for existing offline/converted accounts
    if (currentMapping && currentMapping.action === 'map' && currentMapping.target_account_id) {
      const targetAccount = _findAccountById(currentMapping.target_account_id);
      if (targetAccount) {
        let extraHtml = '';

        if (targetAccount.connection_status === 'linked') {
          extraHtml += _renderLinkedAccountWarning(targetAccount);
        } else {
          extraHtml += _renderLockBalanceCheckbox(csvName, currentMapping);
        }

        // Warn if another CSV account is already mapped to the same app account
        const dupCsvNames = _getDuplicateMappingsFor(currentMapping.target_account_id, csvName);
        if (dupCsvNames.length > 0) {
          extraHtml += _renderDuplicateMappingWarning(targetAccount, dupCsvNames);
        }

        if (extraHtml) {
          html += `<tr><td colspan="4" style="padding-top: 0; border-bottom: none;">${extraHtml}</td></tr>`;
        }
      }
    }
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

/**
 * Build the account mapping dropdown for a single CSV account.
 */
function _renderAccountMappingDropdown(csvName, currentMapping) {
  const safeId = _safeId(csvName);
  const selectedAction = currentMapping ? currentMapping.action : '';
  const selectedTarget = currentMapping ? (currentMapping.target_account_id || '') : '';

  let html = `<select class="import-mapping-select" id="import-acct-select-${safeId}"
               onchange="_onAccountMappingChange('${_escapeAttr(csvName)}', this.value)">`;
  html += '<option value="">— Select —</option>';
  html += '<option value="__ignore__"' + (selectedAction === 'ignore' ? ' selected' : '') + '>Skip / Ignore</option>';
  html += '<option value="__create_new__"' + (selectedAction === 'create_new' ? ' selected' : '') + '>+ Create New Account</option>';

  // Collect account IDs already mapped by OTHER CSV accounts (not this one)
  const usedAccountIds = _getUsedAccountIds(csvName);

  // Group existing accounts by bank, sort alphabetically by label
  const offlineAccounts = accounts
    .filter(accountRecord => accountRecord.connection_status !== 'linked')
    .sort((a, b) => _buildAccountLabel(a).localeCompare(_buildAccountLabel(b)));
  const linkedAccounts = accounts
    .filter(accountRecord => accountRecord.connection_status === 'linked')
    .sort((a, b) => _buildAccountLabel(a).localeCompare(_buildAccountLabel(b)));

  if (offlineAccounts.length > 0) {
    html += '<optgroup label="Offline / Manual Accounts">';
    for (const accountRecord of offlineAccounts) {
      const displayName = _buildAccountLabel(accountRecord);
      const isSelected = selectedAction === 'map' && selectedTarget === accountRecord.account_id;
      const isUsed = usedAccountIds.has(accountRecord.account_id);
      const usedSuffix = isUsed ? ' ⚠ (already mapped)' : '';
      html += `<option value="${escapeHtml(accountRecord.account_id)}"${isSelected ? ' selected' : ''}>`;
      html += escapeHtml(displayName) + usedSuffix;
      html += '</option>';
    }
    html += '</optgroup>';
  }

  if (linkedAccounts.length > 0) {
    html += '<optgroup label="🔗 Plaid-Linked">';
    for (const accountRecord of linkedAccounts) {
      const displayName = _buildAccountLabel(accountRecord);
      const isSelected = selectedAction === 'map' && selectedTarget === accountRecord.account_id;
      const isUsed = usedAccountIds.has(accountRecord.account_id);
      const usedSuffix = isUsed ? ' ⚠ (already mapped)' : '';
      html += `<option value="${escapeHtml(accountRecord.account_id)}"${isSelected ? ' selected' : ''}>`;
      html += escapeHtml(displayName) + usedSuffix;
      html += '</option>';
    }
    html += '</optgroup>';
  }

  html += '</select>';
  return html;
}

/**
 * Bulk: set every CSV account to Skip/Ignore.
 */
function _bulkIgnoreAllAccounts() {
  if (!importAnalysis || !importAnalysis.accounts) return;
  for (const csvAccount of importAnalysis.accounts) {
    importAccountMappings[csvAccount.csv_name] = { action: 'ignore' };
  }
  _saveImportProgress();
  const body = document.getElementById('import-wizard-body');
  renderAccountMappingStep(body);
}

/**
 * Bulk: re-run auto-suggest from scratch (clears all current mappings first).
 */
function _bulkResuggestAllAccounts() {
  if (!importAnalysis || !importAnalysis.accounts) return;
  // Reset all to ignore, then let auto-suggest fill in matches
  for (const csvAccount of importAnalysis.accounts) {
    importAccountMappings[csvAccount.csv_name] = { action: 'ignore' };
  }
  _importAutoSuggestApplied = false;
  _autoSuggestAccountMappings();
  _saveImportProgress();
  const body = document.getElementById('import-wizard-body');
  renderAccountMappingStep(body);
}

/**
 * Handle a change in the account mapping dropdown.
 */
function _onAccountMappingChange(csvName, selectedValue) {
  if (selectedValue === '__ignore__') {
    importAccountMappings[csvName] = { action: 'ignore' };
  } else if (selectedValue === '__create_new__') {
    importAccountMappings[csvName] = {
      action: 'create_new',
      new_account_config: {
        account_name: csvName,
        bank_name: '',
        bank_id: null,
        institution_id: null,
        bank_selection_mode: '',
        account_category: 'depository',
        opening_balance: 0,
        balance_date: '',
      },
    };
  } else if (selectedValue) {
    importAccountMappings[csvName] = {
      action: 'map',
      target_account_id: selectedValue,
      lock_current_balance: false,
    };
  } else {
    delete importAccountMappings[csvName];
  }

  // Re-render to show/hide create form, linked warning, lock checkbox
  const body = document.getElementById('import-wizard-body');
  renderAccountMappingStep(body);
}

/**
 * Render the inline create-account form for a CSV account.
 */
function _renderCreateAccountForm(csvName, config) {
  const safeId = _safeId(csvName);
  const accountName = (config && config.account_name) || csvName;
  const bankName = (config && config.bank_name) || '';
  const bankSelectionMode = (config && config.bank_selection_mode) || '';
  const accountCategory = (config && config.account_category) || 'depository';
  const openingBalance = (config && config.opening_balance) || '';
  const balanceDate = (config && config.balance_date) || '';

  let html = '<div class="import-create-account-form">';

  html += `
    <div class="import-create-form-banner">
      We recommend entering your current balance or last statement balance as the
      "opening balance" rather than a historical opening balance.
    </div>
  `;

  html += `
    <div>
      <label>Account Name *</label>
      <input type="text" value="${escapeHtml(accountName)}"
             onchange="_updateNewAccountConfig('${_escapeAttr(csvName)}', 'account_name', this.value)"
             placeholder="e.g., Chase Checking">
    </div>
    <div class="import-create-form-full">
      <label>Bank / Institution</label>
      ${_renderBankSelector(csvName, safeId, config)}
    </div>
    <div>
      <label>Account Type *</label>
      <select onchange="_updateNewAccountConfig('${_escapeAttr(csvName)}', 'account_category', this.value)">
        <option value="depository"${accountCategory === 'depository' ? ' selected' : ''}>Depository (Checking/Savings)</option>
        <option value="credit"${accountCategory === 'credit' ? ' selected' : ''}>Credit Card</option>
        <option value="investment"${accountCategory === 'investment' ? ' selected' : ''}>Investment</option>
        <option value="loan"${accountCategory === 'loan' ? ' selected' : ''}>Loan</option>
        <option value="asset"${accountCategory === 'asset' ? ' selected' : ''}>Asset</option>
        <option value="liability"${accountCategory === 'liability' ? ' selected' : ''}>Liability</option>
      </select>
    </div>
    <div>
      <label>Opening Balance</label>
      <input type="number" step="0.01" value="${openingBalance}"
             onchange="_updateNewAccountConfig('${_escapeAttr(csvName)}', 'opening_balance', parseFloat(this.value) || 0)"
             placeholder="0.00">
    </div>
    <div>
      <label>Balance Date</label>
      <input type="date" value="${escapeHtml(balanceDate)}"
             onchange="_updateNewAccountConfig('${_escapeAttr(csvName)}', 'balance_date', this.value)">
    </div>
  `;

  html += '</div>';
  return html;
}

/**
 * Build the three-tier bank selector: existing banks, official institution
 * (popular dropdown + full search), or custom free-text.
 */
function _renderBankSelector(csvName, safeId, config) {
  const bankSelectionMode = (config && config.bank_selection_mode) || '';
  const bankName = (config && config.bank_name) || '';
  const institutionId = (config && config.institution_id) || '';
  const bankId = (config && config.bank_id) || '';
  const escapedCsvName = _escapeAttr(csvName);

  // Collect unique existing banks from the global accounts array
  const existingBanks = _getUniqueBanks();

  let html = `<select id="import-bank-select-${safeId}"
               onchange="_onImportBankSelectChange('${escapedCsvName}', this.value)">`;
  html += '<option value="">— Select a Bank —</option>';

  if (existingBanks.length > 0) {
    html += '<optgroup label="Your Banks">';
    for (const bank of existingBanks) {
      const isSelected = bankSelectionMode === 'existing' && bankName === bank.bank_name;
      html += `<option value="existing::${escapeHtml(bank.bank_name)}::${escapeHtml(bank.bank_id || '')}"
               ${isSelected ? 'selected' : ''}>${escapeHtml(bank.bank_name)}</option>`;
    }
    html += '</optgroup>';
  }

  html += `<option value="__official__" ${bankSelectionMode === 'official' ? 'selected' : ''}>` +
    '\u2795 Use official institution</option>';
  html += `<option value="__custom__" ${bankSelectionMode === 'custom' ? 'selected' : ''}>` +
    '\u2795 Enter custom bank name</option>';
  html += '</select>';

  // Official institution sub-panel
  const showOfficial = bankSelectionMode === 'official';
  html += `<div id="import-official-fields-${safeId}" class="import-bank-subpanel ${showOfficial ? '' : 'hidden'}">`;
  html += `<select id="import-official-bank-${safeId}"
            onchange="_onImportOfficialBankChange('${escapedCsvName}', '${safeId}')">`;
  html += '<option value="">— Choose an institution —</option>';

  if (_importPopularInstitutionsCache) {
    for (const inst of _importPopularInstitutionsCache) {
      const isSelected = institutionId === inst.institution_id;
      html += `<option value="${escapeHtml(inst.institution_id)}" ${isSelected ? 'selected' : ''}>`;
      html += escapeHtml(inst.name);
      html += '</option>';
    }
  }

  // If a search-selected institution isn't in the popular list, add it
  if (institutionId && bankName && _importPopularInstitutionsCache) {
    const alreadyInList = _importPopularInstitutionsCache.some(
      inst => inst.institution_id === institutionId
    );
    if (!alreadyInList) {
      html += `<option value="${escapeHtml(institutionId)}" selected>${escapeHtml(bankName)}</option>`;
    }
  }

  html += '</select>';
  html += `<div class="import-institution-hint">
    Can\u2019t find yours?
    <a href="#" onclick="_showImportInstitutionSearch(event, '${escapedCsvName}', '${safeId}')">Search all 9,000+ institutions</a>
  </div>`;
  html += `<div id="import-inst-search-panel-${safeId}" class="hidden">`;
  html += `<div class="import-institution-search-row">`;
  html += `<input id="import-inst-search-input-${safeId}" placeholder="Search by name\u2026"
            onkeydown="if(event.key==='Enter'){_searchImportInstitutions('${escapedCsvName}','${safeId}');}" />`;
  html += `<button onclick="_searchImportInstitutions('${escapedCsvName}','${safeId}')">Search</button>`;
  html += '</div>';
  html += `<div id="import-inst-search-results-${safeId}" class="import-institution-search-results"></div>`;
  html += '</div>';
  html += '</div>';

  // Custom bank name sub-panel
  const showCustom = bankSelectionMode === 'custom';
  html += `<div id="import-custom-bank-fields-${safeId}" class="import-bank-subpanel ${showCustom ? '' : 'hidden'}">`;
  html += `<input type="text" value="${escapeHtml(showCustom ? bankName : '')}"
            onchange="_updateNewAccountConfig('${escapedCsvName}', 'bank_name', this.value)"
            placeholder="e.g., Piggy Bank, My Kid\u2019s Bank">`;
  html += '</div>';

  // Lazy-load popular institutions on first render
  if (!_importPopularInstitutionsCache) {
    _loadImportPopularInstitutions(safeId);
  }

  return html;
}

/**
 * Collect unique banks from the global `accounts` array (already loaded by the transactions page).
 */
function _getUniqueBanks() {
  const bankMap = new Map();
  for (const accountRecord of accounts) {
    const name = accountRecord.bank_name || accountRecord.institution_name;
    if (!name) continue;
    if (bankMap.has(name)) continue;
    bankMap.set(name, {
      bank_name: name,
      bank_id: accountRecord.bank_id || null,
    });
  }
  return Array.from(bankMap.values()).sort(
    (a, b) => a.bank_name.localeCompare(b.bank_name)
  );
}

/**
 * Handle bank selector dropdown change for an import create-new form.
 */
function _onImportBankSelectChange(csvName, value) {
  const config = importAccountMappings[csvName] && importAccountMappings[csvName].new_account_config;
  if (!config) return;

  if (value.startsWith('existing::')) {
    const parts = value.split('::');
    config.bank_name = parts[1] || '';
    config.bank_id = parts[2] || null;
    config.institution_id = null;
    config.bank_selection_mode = 'existing';
  } else if (value === '__official__') {
    config.bank_name = '';
    config.bank_id = null;
    config.institution_id = null;
    config.bank_selection_mode = 'official';
  } else if (value === '__custom__') {
    config.bank_name = '';
    config.bank_id = null;
    config.institution_id = null;
    config.bank_selection_mode = 'custom';
  } else {
    config.bank_name = '';
    config.bank_id = null;
    config.institution_id = null;
    config.bank_selection_mode = '';
  }

  _saveImportProgress();

  // Re-render to toggle sub-panels
  const body = document.getElementById('import-wizard-body');
  renderAccountMappingStep(body);
}

/**
 * Handle selection from the official institution popular dropdown.
 */
function _onImportOfficialBankChange(csvName, safeId) {
  const config = importAccountMappings[csvName] && importAccountMappings[csvName].new_account_config;
  if (!config) return;

  const officialSelect = document.getElementById(`import-official-bank-${safeId}`);
  const selectedOption = officialSelect.options[officialSelect.selectedIndex];
  config.institution_id = officialSelect.value || null;
  config.bank_name = selectedOption && officialSelect.value ? selectedOption.textContent : '';
  config.bank_id = null;
  _saveImportProgress();
}

/**
 * Show the full institution search panel.
 */
function _showImportInstitutionSearch(event, csvName, safeId) {
  event.preventDefault();
  const panel = document.getElementById(`import-inst-search-panel-${safeId}`);
  panel.classList.remove('hidden');
  document.getElementById(`import-inst-search-input-${safeId}`).focus();
}

/**
 * Search institutions via backend and render clickable results.
 */
async function _searchImportInstitutions(csvName, safeId) {
  const searchInput = document.getElementById(`import-inst-search-input-${safeId}`);
  const resultsContainer = document.getElementById(`import-inst-search-results-${safeId}`);
  const query = searchInput.value.trim();

  if (query.length < 2) {
    resultsContainer.innerHTML = '<div class="import-institution-search-status">Type at least 2 characters.</div>';
    return;
  }

  resultsContainer.innerHTML = '<div class="import-institution-search-status">Searching\u2026</div>';

  try {
    const url = `${BACKEND_URL}/api/accounts/reference/search-institutions?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Search failed');
    }
    const data = await response.json();
    const results = data.institutions || [];

    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="import-institution-search-status">No results found.</div>';
      return;
    }

    const currentInstId = importAccountMappings[csvName]
      && importAccountMappings[csvName].new_account_config
      && importAccountMappings[csvName].new_account_config.institution_id;

    resultsContainer.innerHTML = results.map(inst => {
      const selectedClass = inst.institution_id === currentInstId ? ' selected' : '';
      return `<div class="import-institution-search-result${selectedClass}"
                   onclick="_selectImportSearchInstitution('${_escapeAttr(csvName)}', '${safeId}', '${_escapeAttr(inst.institution_id)}', '${_escapeAttr(inst.name)}')">
                ${escapeHtml(inst.name)}
              </div>`;
    }).join('');
  } catch (searchError) {
    resultsContainer.innerHTML = `<div class="import-institution-search-status" style="color:var(--color-error);">Search failed: ${escapeHtml(searchError.message)}</div>`;
  }
}

/**
 * Select an institution from search results.
 */
function _selectImportSearchInstitution(csvName, safeId, institutionId, institutionName) {
  const config = importAccountMappings[csvName] && importAccountMappings[csvName].new_account_config;
  if (!config) return;

  config.institution_id = institutionId;
  config.bank_name = institutionName;
  config.bank_id = null;
  _saveImportProgress();

  // Add to the official dropdown if not present, then select it
  const officialSelect = document.getElementById(`import-official-bank-${safeId}`);
  let existingOption = officialSelect.querySelector(`option[value="${institutionId}"]`);
  if (!existingOption) {
    existingOption = document.createElement('option');
    existingOption.value = institutionId;
    existingOption.textContent = institutionName;
    officialSelect.appendChild(existingOption);
  }
  officialSelect.value = institutionId;

  // Highlight selected result
  const resultsContainer = document.getElementById(`import-inst-search-results-${safeId}`);
  resultsContainer.querySelectorAll('.import-institution-search-result').forEach(el => {
    const elId = el.getAttribute('onclick').includes(institutionId);
    el.classList.toggle('selected', elId);
  });
}

/**
 * Fetch popular institutions from backend (once per session).
 */
async function _loadImportPopularInstitutions(safeId) {
  try {
    const url = `${BACKEND_URL}/api/accounts/reference/popular-institutions`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch popular institutions');
    const data = await response.json();
    _importPopularInstitutionsCache = data.institutions || [];

    // Populate all official bank dropdowns currently rendered
    _repopulateAllOfficialDropdowns();
  } catch (fetchError) {
    console.warn('Could not load popular institutions:', fetchError.message);
  }
}

/**
 * After lazy-loading popular institutions, fill every official dropdown on screen.
 */
function _repopulateAllOfficialDropdowns() {
  if (!_importPopularInstitutionsCache) return;
  const selects = document.querySelectorAll('select[id^="import-official-bank-"]');
  for (const officialSelect of selects) {
    const placeholder = officialSelect.querySelector('option[value=""]');
    officialSelect.innerHTML = '';
    if (placeholder) officialSelect.appendChild(placeholder);
    else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '\u2014 Choose an institution \u2014';
      officialSelect.appendChild(opt);
    }
    for (const inst of _importPopularInstitutionsCache) {
      const option = document.createElement('option');
      option.value = inst.institution_id;
      option.textContent = inst.name;
      officialSelect.appendChild(option);
    }
  }
}

/**
 * Update a field in the new_account_config for a CSV account.
 */
function _updateNewAccountConfig(csvName, field, value) {
  if (!importAccountMappings[csvName]) return;
  if (!importAccountMappings[csvName].new_account_config) {
    importAccountMappings[csvName].new_account_config = {};
  }
  importAccountMappings[csvName].new_account_config[field] = value;
  _saveImportProgress();
}

/**
 * Render the linked-account warning notice.
 */
function _renderLinkedAccountWarning(targetAccount) {
  const earliestDate = targetAccount.earliest_transaction_date || 'unknown';
  const latestDate = targetAccount.latest_transaction_date || 'unknown';

  return `
    <div class="import-linked-warning">
      ⚠️ This account has Plaid data from <strong>${escapeHtml(earliestDate)}</strong>
      to <strong>${escapeHtml(latestDate)}</strong>. Imported transactions overlapping
      that range will be matched against existing Plaid transactions. Unmatched imports
      will be flagged for your review.
    </div>
  `;
}

/**
 * Render the "lock in current balance" checkbox for offline/converted accounts.
 */
function _renderLockBalanceCheckbox(csvName, currentMapping) {
  const isChecked = currentMapping.lock_current_balance ? 'checked' : '';
  return `
    <div class="import-lock-balance-row">
      <input type="checkbox" id="import-lock-${_safeId(csvName)}" ${isChecked}
             onchange="_onLockBalanceToggle('${_escapeAttr(csvName)}', this.checked)">
      <label for="import-lock-${_safeId(csvName)}">
        Lock in current balance — imported transactions will be treated as
        pre-opening-balance history without changing today's balance.
      </label>
    </div>
  `;
}

function _onLockBalanceToggle(csvName, isChecked) {
  if (importAccountMappings[csvName]) {
    importAccountMappings[csvName].lock_current_balance = isChecked;
    _saveImportProgress();
  }
}

// ── Validation ────────────────────────────────────────────────

/**
 * Validate that every CSV account has a mapping decision.
 * Returns true if valid, false if not (shows error inline).
 */
function _validateAccountMappingsUI() {
  if (!importAnalysis || !importAnalysis.accounts) return false;

  const unmapped = [];
  const createErrors = [];

  for (const csvAccount of importAnalysis.accounts) {
    const csvName = csvAccount.csv_name;
    const mapping = importAccountMappings[csvName];

    if (!mapping) {
      unmapped.push(csvName);
      continue;
    }

    if (mapping.action === 'create_new') {
      const config = mapping.new_account_config || {};
      if (!config.account_name || !config.account_name.trim()) {
        createErrors.push(`"${csvName}" — account name is required`);
      }
      if (!config.account_category) {
        createErrors.push(`"${csvName}" — account type is required`);
      }
    }
  }

  if (unmapped.length > 0 || createErrors.length > 0) {
    let errorMsg = '';
    if (unmapped.length > 0) {
      errorMsg += `${unmapped.length} account(s) still need a mapping decision: ${unmapped.slice(0, 3).join(', ')}`;
      if (unmapped.length > 3) errorMsg += ` and ${unmapped.length - 3} more`;
      errorMsg += '. ';
    }
    if (createErrors.length > 0) {
      errorMsg += createErrors.join('; ');
    }

    // Show error at the top of the step
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

// ── Utilities ─────────────────────────────────────────────────

function _buildAccountLabel(accountRecord) {
  const displayName = accountRecord.custom_name || accountRecord.account_name || 'Unknown Account';
  const bank = accountRecord.bank_name || accountRecord.institution_name || '';
  const category = accountRecord.account_category || '';
  let label = displayName;
  if (bank) label = `${bank} — ${label}`;
  if (category) label += ` (${category})`;
  return label;
}

function _findAccountById(accountId) {
  return accounts.find(accountRecord => accountRecord.account_id === accountId) || null;
}

function _formatDateRange(dateRange) {
  if (!dateRange || dateRange.length < 2) return '—';
  return `${dateRange[0]} → ${dateRange[1]}`;
}

function _safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function _escapeAttr(value) {
  return String(value || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ── Duplicate Mapping Helpers ─────────────────────────────────

/**
 * Get the set of account IDs already mapped by OTHER CSV accounts (excludes the given csvName).
 */
function _getUsedAccountIds(excludeCsvName) {
  const used = new Set();
  for (const [csvName, mapping] of Object.entries(importAccountMappings)) {
    if (csvName === excludeCsvName) continue;
    if (mapping.action === 'map' && mapping.target_account_id) {
      used.add(mapping.target_account_id);
    }
  }
  return used;
}

/**
 * Get CSV account names that are also mapped to the same target account (excluding self).
 */
function _getDuplicateMappingsFor(targetAccountId, excludeCsvName) {
  const duplicates = [];
  for (const [csvName, mapping] of Object.entries(importAccountMappings)) {
    if (csvName === excludeCsvName) continue;
    if (mapping.action === 'map' && mapping.target_account_id === targetAccountId) {
      duplicates.push(csvName);
    }
  }
  return duplicates;
}

/**
 * Render warning when multiple CSV accounts map to the same app account.
 */
function _renderDuplicateMappingWarning(targetAccount, otherCsvNames) {
  const accountLabel = _buildAccountLabel(targetAccount);
  const othersText = otherCsvNames.map(n => `"${escapeHtml(n)}"`).join(', ');
  return `
    <div class="import-linked-warning" style="border-color: var(--color-warning, #e6a700);">
      ⚠️ <strong>${escapeHtml(accountLabel)}</strong> is also mapped from ${othersText}.
      All transactions from these CSV accounts will be merged into this single account.
    </div>
  `;
}

// ── Auto-Suggest Matching ─────────────────────────────────────

/**
 * Auto-suggest account mappings by fuzzy-matching CSV account names
 * against the user's existing accounts. Only fills in unmapped entries.
 * Call once after analysis is loaded.
 */
function _autoSuggestAccountMappings() {
  if (!importAnalysis || !importAnalysis.accounts || !accounts || accounts.length === 0) return;
  if (_importAutoSuggestApplied) return;
  _importAutoSuggestApplied = true;

  // Build a lookup of all app accounts with normalized search tokens
  const appAccounts = accounts.map(acct => ({
    account_id: acct.account_id,
    account_name: acct.account_name || '',
    custom_name: acct.custom_name || '',
    bank_name: acct.bank_name || acct.institution_name || '',
    mask: acct.mask || '',
    account_category: acct.account_category || '',
    label: _buildAccountLabel(acct),
  }));

  const usedIds = new Set();

  for (const csvAccount of importAnalysis.accounts) {
    const csvName = csvAccount.csv_name;
    const existing = importAccountMappings[csvName];

    // Skip if user already made a decision (not just the default 'ignore' from non-app-reimport)
    if (existing && existing.action === 'map') {
      if (existing.target_account_id) usedIds.add(existing.target_account_id);
      continue;
    }
    if (existing && existing.action === 'create_new') continue;

    // Find best match
    const match = _findBestAccountMatch(csvName, appAccounts, usedIds);
    if (match) {
      importAccountMappings[csvName] = {
        action: 'map',
        target_account_id: match.account_id,
        lock_current_balance: false,
      };
      usedIds.add(match.account_id);
    }
  }
}

/**
 * Find the best matching app account for a CSV account name.
 * Returns the matched app account object or null.
 */
function _findBestAccountMatch(csvName, appAccounts, usedIds) {
  const csvNorm = _normalizeForMatch(csvName);
  if (!csvNorm) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const appAcct of appAccounts) {
    if (usedIds.has(appAcct.account_id)) continue;

    const score = _scoreAccountMatch(csvNorm, csvName, appAcct);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = appAcct;
    }
  }

  // Require a minimum confidence threshold
  return bestScore >= 3 ? bestMatch : null;
}

/**
 * Score how well a CSV name matches an app account. Higher = better match.
 *
 * Scoring tiers:
 *  10 = exact match on full label or name
 *   8 = CSV name contains full account name or vice-versa
 *   6 = bank + partial name match
 *   5 = mask (last 4 digits) + bank match
 *   4 = strong token overlap (most words match)
 *   3 = moderate token overlap
 *   0 = no meaningful match
 */
function _scoreAccountMatch(csvNorm, csvRaw, appAcct) {
  const nameNorm = _normalizeForMatch(appAcct.account_name);
  const customNorm = _normalizeForMatch(appAcct.custom_name);
  const bankNorm = _normalizeForMatch(appAcct.bank_name);
  const labelNorm = _normalizeForMatch(appAcct.label);
  const mask = appAcct.mask || '';

  // Exact match on label or name
  if (csvNorm === labelNorm || csvNorm === nameNorm || csvNorm === customNorm) return 10;

  // CSV contains full account name or vice-versa
  if (nameNorm && csvNorm.includes(nameNorm)) return 8;
  if (customNorm && csvNorm.includes(customNorm)) return 8;
  if (nameNorm && nameNorm.includes(csvNorm)) return 8;

  // Bank name match + partial name match
  const csvHasBank = bankNorm && csvNorm.includes(bankNorm);
  if (csvHasBank && nameNorm) {
    const nameTokens = nameNorm.split(/\s+/);
    const matchedTokens = nameTokens.filter(t => t.length > 2 && csvNorm.includes(t));
    if (matchedTokens.length >= 1) return 6;
  }

  // Mask (last 4 digits) + bank match
  if (mask && csvRaw.includes(mask) && csvHasBank) return 5;

  // Token overlap scoring
  const csvTokens = csvNorm.split(/\s+/).filter(t => t.length > 2);
  const acctTokens = labelNorm.split(/\s+/).filter(t => t.length > 2);
  if (csvTokens.length > 0 && acctTokens.length > 0) {
    const matchedCount = csvTokens.filter(t => acctTokens.includes(t)).length;
    const overlapRatio = matchedCount / Math.min(csvTokens.length, acctTokens.length);
    if (overlapRatio >= 0.7 && matchedCount >= 2) return 4;
    if (overlapRatio >= 0.5 && matchedCount >= 2) return 3;
  }

  return 0;
}

/**
 * Normalize a string for fuzzy comparison: lowercase, strip punctuation, collapse whitespace.
 */
function _normalizeForMatch(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
