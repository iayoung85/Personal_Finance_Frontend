// ============================================================
// transactions/import/account-mapping.js — Step 1: Account Mapping
// Compact table of CSV accounts → user's existing accounts,
// with "Create New", "Skip/Ignore", lock-balance, and linked
// account warnings.
// ============================================================

/**
 * Render the account mapping step into the wizard body.
 */
function renderAccountMappingStep(container) {
  if (!importAnalysis || !importAnalysis.accounts) {
    container.innerHTML = '<div class="import-error-banner">No analysis data. Go back and upload a file.</div>';
    return;
  }

  const csvAccounts = importAnalysis.accounts;
  let html = '';

  html += `<h2 style="margin: 0 0 6px 0; font-size: 18px; color: var(--text-heading);">Map Accounts</h2>`;
  html += `<p style="color: var(--text-secondary); margin: 0 0 18px 0; font-size: 13px;">
    Assign each CSV account to an existing account, create a new one, or skip it entirely.
  </p>`;

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

  // Group existing accounts by bank
  const offlineAccounts = accounts.filter(accountRecord => accountRecord.connection_status !== 'linked');
  const linkedAccounts = accounts.filter(accountRecord => accountRecord.connection_status === 'linked');

  if (offlineAccounts.length > 0) {
    html += '<optgroup label="Offline / Manual Accounts">';
    for (const accountRecord of offlineAccounts) {
      const displayName = _buildAccountLabel(accountRecord);
      const isSelected = selectedAction === 'map' && selectedTarget === accountRecord.account_id;
      html += `<option value="${escapeHtml(accountRecord.account_id)}"${isSelected ? ' selected' : ''}>`;
      html += escapeHtml(displayName);
      html += '</option>';
    }
    html += '</optgroup>';
  }

  if (linkedAccounts.length > 0) {
    html += '<optgroup label="🔗 Plaid-Linked">';
    for (const accountRecord of linkedAccounts) {
      const displayName = _buildAccountLabel(accountRecord);
      const isSelected = selectedAction === 'map' && selectedTarget === accountRecord.account_id;
      html += `<option value="${escapeHtml(accountRecord.account_id)}"${isSelected ? ' selected' : ''}>`;
      html += escapeHtml(displayName);
      html += '</option>';
    }
    html += '</optgroup>';
  }

  html += '</select>';
  return html;
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
    <div>
      <label>Bank Name</label>
      <input type="text" value="${escapeHtml(bankName)}"
             onchange="_updateNewAccountConfig('${_escapeAttr(csvName)}', 'bank_name', this.value)"
             placeholder="e.g., Chase">
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
