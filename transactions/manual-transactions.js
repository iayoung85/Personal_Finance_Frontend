// ============================================================
// transactions/manual-transactions.js — Manual Transaction CRUD
// Open the add-manual-transaction modal, save, and delete.
// ============================================================

/**
 * Open modal to create a new manual transaction
 */
function openAddManualTransactionModal() {
  // Get today's date in local timezone (not UTC)
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;
  
  // Build account dropdown from available accounts
  let accountOptions = '<option value="">— Select Account —</option>';
  let defaultAccountId = '';
  
  // Group accounts: offline/manual first, then linked with a visual badge.
  // This makes it clear which accounts have date restrictions for manual txns.
  const offlineAccounts = accounts.filter(a => a.connection_status !== 'linked');
  const linkedAccounts = accounts.filter(a => a.connection_status === 'linked');

  if (offlineAccounts.length > 0) {
    accountOptions += '<optgroup label="Offline / Manual Accounts">';
    offlineAccounts.forEach(account => {
      const displayName = account.custom_name || account.account_name || account.institution_name || 'Unknown Account';
      const categoryLabel = account.account_category || '';
      accountOptions += `<option value="${escapeHtml(account.account_id)}">${escapeHtml(displayName)} (${escapeHtml(categoryLabel)})</option>`;
    });
    accountOptions += '</optgroup>';
  }

  if (linkedAccounts.length > 0) {
    accountOptions += '<optgroup label="🔗 Plaid-Linked (historical only)">';
    linkedAccounts.forEach(account => {
      const displayName = account.custom_name || account.account_name || account.institution_name || 'Unknown Account';
      const categoryLabel = account.account_category || '';
      accountOptions += `<option value="${escapeHtml(account.account_id)}">${escapeHtml(displayName)} (${escapeHtml(categoryLabel)})</option>`;
    });
    accountOptions += '</optgroup>';
  }
  
  // If in single account mode, default to that account
  if (selectedAccountMode === 'single' && selectedAccountId) {
    defaultAccountId = selectedAccountId;
    accountOptions = accountOptions.replace(
      `value="${selectedAccountId}"`,
      `value="${selectedAccountId}" selected`
    );
  }

  const formHtml = `
    <div style="display: grid; gap: 14px;">
      <div id="manual-txn-error-banner" style="display:none; padding: 8px 12px; background: var(--color-danger-bg); border: 1px solid var(--color-danger-border); border-radius: 4px; color: var(--color-danger); font-size: 13px;"></div>
      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Description *</label>
        <input id="manual-txn-name" type="text" placeholder="e.g., Coffee at local shop" class="modal-input" maxlength="128">
        <small style="color: var(--text-muted); margin-top: 2px; display: block;">Brief description of transaction</small>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px;">
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Amount *</label>
          <input id="manual-txn-amount" type="text" inputmode="decimal" placeholder="0.00" class="modal-input">
        </div>
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Type *</label>
          <select id="manual-txn-type" class="modal-input">
            <option value="debit" selected>Debit (−)</option>
            <option value="credit">Credit (+)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Date *</label>
          <input id="manual-txn-date" type="date" value="${today}" class="modal-input">
        </div>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Account *</label>
        <select id="manual-txn-account" class="modal-input">
          ${accountOptions}
        </select>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Merchant (Optional)</label>
        <input id="manual-txn-merchant" type="text" placeholder="e.g., Starbucks" class="modal-input" maxlength="128">
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Category (Optional)</label>
        <div style="position: relative;">
          <input id="manual-txn-category" type="text" placeholder="Type to search, or [ for transfers" autocomplete="off" class="modal-input">
          <div id="manual-txn-category-list" class="category-ac-list" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 99999;"></div>
        </div>
        <small style="color: var(--text-muted); margin-top: 2px; display: block;">If empty, mappings and rules will be applied automatically. Type <kbd>[</kbd> to assign as transfer.</small>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Memo (Optional)</label>
        <input id="manual-txn-memo" type="text" placeholder="Add a note" class="modal-input" maxlength="256">
        <small style="color: var(--text-muted); margin-top: 2px; display: block;">Additional notes about this transaction</small>
      </div>
    </div>
  `;

  openModal({
    title: 'Add Manual Transaction',
    body: formHtml,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Create', onClick: () => saveManualTransaction() }
    ]
  });
  
  // --- Wire up smart +/− shorthand on the amount field ---
  // Typing "+" before the number auto-selects Credit; no prefix = Debit.
  // The dropdown is still the source of truth and can override the prefix.
  // On blur, debits show a leading "−" for visual clarity; on focus it's stripped.
  setTimeout(() => {
    const amountInput = document.getElementById('manual-txn-amount');
    const typeSelect  = document.getElementById('manual-txn-type');
    if (amountInput && typeSelect) {
      amountInput.addEventListener('input', () => _syncAmountPrefix(amountInput, typeSelect));
      typeSelect.addEventListener('change', () => _syncTypeDropdown(amountInput, typeSelect));
      amountInput.addEventListener('blur',  () => _decorateAmountOnBlur(amountInput, typeSelect));
      amountInput.addEventListener('focus', () => _stripDecorationOnFocus(amountInput, typeSelect));
    }
  }, 50);

  // Wire up account selection to show advisory for plaid accounts
  // and auto-set date to day before opening balance for plaid accounts
  setTimeout(() => {
    const accountSelect = document.getElementById('manual-txn-account');
    if (accountSelect) {
      accountSelect.addEventListener('change', _updateManualTxnDateConstraints);
      // Trigger immediately if account is pre-selected
      if (accountSelect.value) _updateManualTxnDateConstraints();
    }
  }, 50);

  // Wire up category autocomplete (text input with dropdown suggestions)
  setTimeout(() => _wireUpManualCategoryAutocomplete(), 50);
  
  // Add Enter key listener for Create button
  setTimeout(() => {
    const inputs = document.querySelectorAll('#manual-txn-name, #manual-txn-amount, #manual-txn-date, #manual-txn-merchant, #manual-txn-category, #manual-txn-memo');
    inputs.forEach(input => {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveManualTransaction();
        }
      });
    });
  }, 50);
}

/**
 * Show an inline validation error inside the manual transaction modal.
 * Clears after 5 seconds automatically.
 */
function _showManualTxnError(message) {
  const banner = document.getElementById('manual-txn-error-banner');
  if (!banner) {
    // Fallback to global status if modal is gone
    showStatus(message, 'error');
    return;
  }
  banner.textContent = message;
  banner.style.display = 'block';
  // Auto-clear after 5 seconds
  clearTimeout(banner._clearTimer);
  banner._clearTimer = setTimeout(() => { banner.style.display = 'none'; }, 5000);
}

// ─── Amount / Type shorthand helpers ───────────────────────
// Why four tiny functions instead of one: each maps to a single DOM event
// (input, change, blur, focus), keeping concerns separate and easy to test.

/** On every keystroke in the amount field: detect leading "+" to auto-set Credit */
function _syncAmountPrefix(amountInput, typeSelect) {
  const raw = amountInput.value;
  if (raw.startsWith('+')) {
    typeSelect.value = 'credit';
  } else if (typeSelect.value === 'credit' && !raw.startsWith('+')) {
    // User deleted the +, revert to debit
    typeSelect.value = 'debit';
  }
}

/** On dropdown change: enforce prefix consistency with the selected type */
function _syncTypeDropdown(amountInput, typeSelect) {
  const raw = amountInput.value;
  if (typeSelect.value === 'debit') {
    // Remove leading + or − if user switched back to debit
    amountInput.value = raw.replace(/^[+\-−]/, '');
  } else if (typeSelect.value === 'credit' && !raw.startsWith('+')) {
    // Add + prefix for credit when missing
    const stripped = raw.replace(/^[+\-−]/, '');
    amountInput.value = stripped ? '+' + stripped : '+';
  }
}

/** On blur: prepend "−" to a bare debit amount so the user sees the sign */
function _decorateAmountOnBlur(amountInput, typeSelect) {
  const raw = amountInput.value.trim();
  if (!raw) return;
  // Only decorate debits that don't already have a sign
  if (typeSelect.value === 'debit' && !raw.startsWith('-') && !raw.startsWith('−')) {
    const numericPart = raw.replace(/^[+]/, '');
    if (numericPart && !isNaN(parseFloat(numericPart))) {
      amountInput.value = '−' + numericPart;
    }
  }
}

/** On focus: strip leading decoration so the user edits a clean number */
function _stripDecorationOnFocus(amountInput, typeSelect) {
  const raw = amountInput.value;
  if (typeSelect.value === 'debit') {
    amountInput.value = raw.replace(/^[−\-]/, '');
  }
}

/**
 * Save a new manual transaction via API
 */
async function saveManualTransaction() {
  const name = document.getElementById('manual-txn-name').value.trim();
  // Strip any leading +/− decoration before parsing the absolute amount
  const rawAmountStr = document.getElementById('manual-txn-amount').value.replace(/^[+\-−]/, '').trim();
  const amount = parseFloat(rawAmountStr);
  const txnType = document.getElementById('manual-txn-type').value;
  const date = document.getElementById('manual-txn-date').value;
  const accountId = document.getElementById('manual-txn-account').value;
  const merchant = document.getElementById('manual-txn-merchant').value.trim();
  const category = document.getElementById('manual-txn-category').value;
  const memo = document.getElementById('manual-txn-memo').value.trim();

  // Validate required fields — show errors inline on the modal
  if (!name) {
    _showManualTxnError('Description is required');
    return;
  }
  if (!amount || amount <= 0 || isNaN(amount)) {
    _showManualTxnError('Amount must be a positive number (sign is set by Type)');
    return;
  }
  if (!date) {
    _showManualTxnError('Date is required');
    return;
  }
  if (!accountId) {
    _showManualTxnError('Please select an account');
    return;
  }

  // Date validation depends on whether this is a plaid or offline account
  const selectedAccount = accounts.find(account => account.account_id === accountId);
  // Why connection_status not origin: origin is immutable (how the account was born),
  // but connection_status reflects current lifecycle. A converted plaid account
  // (connection_status='converted') now operates as manual — no date restriction.
  const isActivelyLinkedToPlaid = selectedAccount && selectedAccount.connection_status === 'linked';

  // Use backend-authoritative earliest plaid transaction date (Problem 5 alignment).
  // The backend guards against dates >= earliest_plaid_date, so the frontend must
  // use the same boundary rather than the opening_balance date (which may differ).
  const earliestPlaidDate = selectedAccount && selectedAccount.earliest_plaid_transaction_date;

  if (isActivelyLinkedToPlaid && earliestPlaidDate) {
    // Plaid accounts: manual transactions MUST be before the earliest plaid transaction.
    // Backend will auto-generate a manual_opening_balance to reconcile.
    if (date >= earliestPlaidDate) {
      _showManualTxnError(`Plaid account: date must be before the earliest plaid transaction (${earliestPlaidDate}). Manual transactions in Plaid accounts are only for historical entries.`);
      return;
    }
  }

  try {
    const payload = {
      description: name,
      amount,
      type: txnType,
      date,
      account_id: accountId,
      merchant_name: merchant || null,
      user_category: category || null,
      memo: memo || null
    };

    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      _showManualTxnError(data.error || 'Failed to create manual transaction');
      return;
    }

    closeModal();
    
    // Show success message with category info if available
    const appliedCategory = data.transaction?.user_category;
    const successMsg = appliedCategory 
      ? `Manual transaction created successfully (category: ${appliedCategory})`
      : 'Manual transaction created successfully';
    showStatus(successMsg, 'success');
    
    // Add the new transaction to the in-memory array and localStorage immediately for instant UI update
    const newTxn = data.transaction || {};
    
    // Ensure transaction has required fields for rendering
    newTxn.transaction_id = data.transaction_id || newTxn.transaction_id;
    newTxn.account_id = accountId;
    newTxn.iso_currency_code = 'USD';
    newTxn.source = 'manual';
    
    // Add to in-memory transactions array
    transactions.unshift(newTxn);
    
    // Update localStorage immediately
    try {
      localStorage.setItem('pf_cached_transactions', JSON.stringify(transactions));
      localStorage.setItem('pf_transactions_cached_at', String(Date.now()));
    } catch (e) { /* non-fatal */ }
    
    // Why: expand date filters so the newly created transaction (including
    // historical ones and opening-balance entries) is immediately visible
    // instead of silently falling outside the active date window.
    _expandDateFiltersForTransaction(newTxn.date);
    
    // Refresh table with new transaction visible
    renderTransactionTable();

    // If the category is bracket-notation transfer (e.g. "[Checking]"),
    // trigger the transfer assignment flow to link/create a counterpart.
    // This runs after the modal is closed so status messages are visible.
    const newTxnId = data.transaction_id || newTxn.transaction_id;
    if (category && isTransferCategory(category)) {
      const transferAccountName = parseTransferAccountName(category);
      const targetAccount = _findAccountByTransferName(transferAccountName);
      if (targetAccount && newTxnId) {
        await _applyTransferAssignment(newTxnId, accountId, targetAccount);
        return; // _applyTransferAssignment already refreshes transactions
      }
    }
    
    // Fetch all transactions in background to ensure consistency and get bank_account names
    try {
      await fetchAllTransactions(true);
    } catch (e) {
      // If fetch fails, user still sees the transaction locally
      console.warn('Background fetch failed but transaction is locally cached:', e);
    }

  } catch (error) {
    _showManualTxnError(`Failed to create transaction: ${error.message}`);
  }
}

/**
 * Delete a manual transaction via API
 */
async function deleteManualTransaction(manualTransactionId) {
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(manualTransactionId)}`,
      { method: 'DELETE' }
    );

    if (!response.ok) {
      const data = await response.json();
      showStatus(data.error || 'Failed to delete transaction', 'error');
      return;
    }

    showStatus('Manual transaction deleted successfully', 'success');

    // Invalidate cache
    try {
      localStorage.removeItem('pf_cached_transactions');
      localStorage.removeItem('pf_transactions_cached_at');
    } catch (e) { /* non-fatal */ }

    // Refresh transactions
    await fetchAllTransactions(true);

  } catch (error) {
    showStatus(`Failed to delete transaction: ${error.message}`, 'error');
  }
}

/**
 * Update date input and advisory when the user selects an account in the manual txn modal.
 *
 * Plaid accounts: manual transactions are for historical entries that occurred
 * BEFORE the opening balance. Auto-set date to the day before the opening balance
 * and set max date constraint. Backend generates a manual_opening_balance to reconcile.
 *
 * Offline/manual accounts: no date restriction. Date defaults to today.
 */

// ─── Manual Transaction Category Autocomplete ──────────────
// Why separate functions instead of reusing attachCategoryDropdownListeners():
// The transaction-table autocomplete is jQuery-delegated with data-txn-id scoping.
// The modal is ephemeral DOM that only exists while open, so direct addEventListener
// binding is cleaner and avoids ID collisions with the table's autocomplete.

/**
 * Wire up category autocomplete for the manual transaction modal.
 * Supports both regular category search and bracket-notation transfer accounts.
 */
function _wireUpManualCategoryAutocomplete() {
  const input = document.getElementById('manual-txn-category');
  const list = document.getElementById('manual-txn-category-list');
  if (!input || !list) return;

  input.addEventListener('input', () => {
    _showManualCategoryDropdown(input, list);
  });

  // Show suggestions on focus if input already has text
  input.addEventListener('focus', () => {
    input.select();
    if (input.value.trim()) {
      _showManualCategoryDropdown(input, list);
    }
  });

  input.addEventListener('keydown', (event) => {
    const items = list.querySelectorAll('.category-ac-item');
    const activeItem = list.querySelector('.category-ac-item.active');
    const activeIndex = Array.from(items).indexOf(activeItem);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach(item => item.classList.remove('active'));
      if (items[nextIndex]) {
        items[nextIndex].classList.add('active');
        items[nextIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIndex = Math.max(activeIndex - 1, 0);
      items.forEach(item => item.classList.remove('active'));
      if (items[prevIndex]) {
        items[prevIndex].classList.add('active');
        items[prevIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'Tab') {
      // Accept the highlighted (or first) suggestion if dropdown is open
      const target = activeItem || items[0];
      if (target) {
        event.preventDefault();
        input.value = target.dataset.value;
        list.innerHTML = '';
        list.style.display = 'none';
      }
    } else if (event.key === 'Escape') {
      list.innerHTML = '';
      list.style.display = 'none';
    }
    // Enter is handled by the global Enter-key listener that calls saveManualTransaction()
  });

  // Hide list on blur (small delay so mousedown on item fires first)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      list.innerHTML = '';
      list.style.display = 'none';
    }, 200);
  });

  // Click on autocomplete item
  list.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.category-ac-item');
    if (item) {
      event.preventDefault();
      input.value = item.dataset.value;
      list.innerHTML = '';
      list.style.display = 'none';
    }
  });
}

/**
 * Show filtered category/account suggestions in the manual transaction modal.
 * Delegates to the transfer-account dropdown when query starts with "[".
 */
function _showManualCategoryDropdown(input, list) {
  const query = (input.value || '').trim();
  const queryLower = query.toLowerCase();

  if (!query) {
    list.innerHTML = '';
    list.style.display = 'none';
    return;
  }

  // Transfer mode: "[" prefix triggers account list for transfer assignment
  if (query.startsWith('[')) {
    _showManualTransferAccountDropdown(list, query);
    return;
  }

  // Smart filtering: split on ":" to match primary/detailed independently
  let matches;
  if (queryLower.includes(':')) {
    const [queryPrimary, queryDetailed] = queryLower.split(':').map(segment => segment.trim());
    matches = (availableCategories || []).filter(cat => {
      const lower = cat.toLowerCase();
      const parts = lower.split(':').map(segment => segment.trim());
      const primaryMatch = !queryPrimary || (parts[0] || '').includes(queryPrimary);
      const detailedMatch = !queryDetailed || (parts[1] || '').includes(queryDetailed);
      return primaryMatch && detailedMatch;
    });
  } else {
    matches = (availableCategories || []).filter(cat =>
      cat.toLowerCase().includes(queryLower)
    );
  }

  const maxVisible = 10;
  const shown = matches.slice(0, maxVisible);

  if (shown.length === 0) {
    list.innerHTML = '<div class="category-ac-empty">No matching categories</div>';
    list.style.display = 'block';
    return;
  }

  const html = shown.map((cat, index) => {
    const highlighted = _highlightMatch(cat, query);
    return `<div class="category-ac-item${index === 0 ? ' active' : ''}" data-value="${escapeHtml(cat)}">${highlighted}</div>`;
  }).join('');

  const overflow = matches.length > maxVisible
    ? `<div class="category-ac-more">${matches.length - maxVisible} more\u2026</div>` : '';

  list.innerHTML = html + overflow;
  list.style.display = 'block';
}

/**
 * Show transfer-account suggestions when user types "[" in the manual txn modal.
 * Excludes the currently selected account (can't transfer to self).
 */
function _showManualTransferAccountDropdown(list, rawQuery) {
  const accountQuery = rawQuery.slice(1).replace(/]$/, '').toLowerCase();

  // Exclude the account selected in the modal's Account dropdown
  const accountSelect = document.getElementById('manual-txn-account');
  const currentAccountId = accountSelect ? accountSelect.value : null;

  const matchingAccounts = accounts.filter(acc => {
    if (acc.account_id === currentAccountId) return false;
    if (acc.is_archived) return false;
    if (!accountQuery) return true;
    const displayName = _buildAccountDisplayName(acc).toLowerCase();
    const rawName = (acc.account_name || '').toLowerCase();
    return displayName.includes(accountQuery) || rawName.includes(accountQuery);
  });

  const maxVisible = 10;
  const shown = matchingAccounts.slice(0, maxVisible);

  if (shown.length === 0) {
    list.innerHTML = '<div class="category-ac-empty">No matching accounts for transfer</div>';
    list.style.display = 'block';
    return;
  }

  const html = shown.map((acc, index) => {
    const displayName = _buildAccountDisplayName(acc);
    const transferValue = buildTransferCategory(displayName);
    const typeBadge = `<span class="transfer-ac-type">${acc.account_category || 'account'}</span>`;
    const highlighted = accountQuery ? _highlightMatch(displayName, accountQuery) : escapeHtml(displayName);
    return `<div class="category-ac-item transfer-ac-item${index === 0 ? ' active' : ''}" data-value="${escapeHtml(transferValue)}" data-account-id="${escapeHtml(acc.account_id)}">`
      + `<span class="transfer-ac-icon">\u21C4</span> ${highlighted} ${typeBadge}</div>`;
  }).join('');

  const overflow = matchingAccounts.length > maxVisible
    ? `<div class="category-ac-more">${matchingAccounts.length - maxVisible} more accounts\u2026</div>` : '';

  list.innerHTML = html + overflow;
  list.style.display = 'block';
}

function _updateManualTxnDateConstraints() {
  const accountSelect = document.getElementById('manual-txn-account');
  const dateInput = document.getElementById('manual-txn-date');
  if (!accountSelect || !dateInput) return;

  const accountId = accountSelect.value;
  if (!accountId) return;

  const selectedAccount = accounts.find(account => account.account_id === accountId);

  // Remove any existing advisory
  const existingAdvisory = document.getElementById('manual-txn-plaid-advisory');
  if (existingAdvisory) existingAdvisory.remove();

  // Clear any previous constraints
  dateInput.removeAttribute('min');
  dateInput.removeAttribute('max');

  // Use backend-authoritative earliest plaid transaction date (Problem 5 alignment).
  // This matches the backend's guard in create_manual_transaction_record which
  // checks txn_date >= earliest_plaid_date, not the opening_balance date.
  const earliestPlaidDate = selectedAccount && selectedAccount.earliest_plaid_transaction_date;

  if (selectedAccount && selectedAccount.connection_status === 'linked') {
    // Plaid account: manual transactions must be BEFORE earliest plaid transaction.
    // Auto-set date to 1 day before that boundary for convenience.
    if (earliestPlaidDate) {
      const boundaryDate = new Date(earliestPlaidDate + 'T00:00:00');
      const dayBefore = new Date(boundaryDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayBeforeStr = dayBefore.toISOString().split('T')[0];

      dateInput.value = dayBeforeStr;
      dateInput.setAttribute('max', dayBeforeStr);
    }

    const advisory = document.createElement('small');
    advisory.id = 'manual-txn-plaid-advisory';
    advisory.style.cssText = 'color: var(--color-warning); display: block; margin-top: 6px; padding: 6px 8px; background: var(--color-warning-bg); border: 1px solid var(--color-warning-border); border-radius: 4px; font-size: 11px;';
    advisory.textContent = earliestPlaidDate
      ? `⚠ Linked account — date capped at ${earliestPlaidDate}. An opening balance will be auto-created.`
      : '⚠ Linked account — historical entries only (before first Plaid import).';
    accountSelect.parentElement.appendChild(advisory);
  }
  // Offline accounts: no constraints, date stays as today
}

/**
 * Expand the start/end date filter inputs if the given transaction date
 * falls outside the currently visible range. This ensures newly created
 * manual transactions (including historical entries and opening-balance
 * transactions) are immediately visible to the user.
 *
 * @param {string} txnDate — ISO date string (YYYY-MM-DD) of the new transaction.
 */
function _expandDateFiltersForTransaction(txnDate) {
  if (!txnDate) return;

  const startInput = document.getElementById('start-date');
  const endInput = document.getElementById('end-date');
  if (!startInput || !endInput) return;

  const currentStart = startInput.value; // YYYY-MM-DD string
  const currentEnd = endInput.value;

  let didExpand = false;

  if (txnDate < currentStart) {
    startInput.value = txnDate;
    didExpand = true;
  }

  if (txnDate > currentEnd) {
    endInput.value = txnDate;
    didExpand = true;
  }

  // Re-render dynamic period buttons when the range changes so they
  // reflect the new time span (e.g. year buttons for historical entries).
  if (didExpand) {
    renderDynamicPeriodButtons();
  }
}


// ============================================================================
// SCHEDULED / MISSING / MATCHED TRANSACTION ACTIONS
// ============================================================================

/**
 * Unmatch a scheduled↔plaid pairing, reverting the scheduled row to 'missing'.
 * Called from the Unmatch button in the category cell of matched transactions.
 */
async function unmatchScheduledTransaction(transactionId) {
  if (!confirm('Undo this match? The scheduled transaction will revert to "missing" status.')) {
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/unmatch_scheduled/${encodeURIComponent(transactionId)}`,
      { method: 'POST' }
    );

    if (!response.ok) {
      const data = await response.json();
      showStatus(data.error || 'Failed to unmatch transaction', 'error');
      return;
    }

    showStatus('Match undone — transaction reverted to missing', 'success');

    // Invalidate cache and refresh
    try {
      localStorage.removeItem('pf_cached_transactions');
      localStorage.removeItem('pf_transactions_cached_at');
    } catch (cacheError) { /* non-fatal */ }

    await fetchAllTransactions(true);

  } catch (networkError) {
    showStatus(`Failed to unmatch: ${networkError.message}`, 'error');
  }
}

/**
 * Resolve (delete) a missing scheduled transaction — dismiss the alert.
 * Called from the ✖ button in the action column of missing transactions.
 */
async function resolveMissingTransaction(transactionId) {
  if (!confirm('Dismiss this missing transaction? It will be removed permanently.')) {
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/resolve_missing/${encodeURIComponent(transactionId)}`,
      { method: 'DELETE' }
    );

    if (!response.ok) {
      const data = await response.json();
      showStatus(data.error || 'Failed to resolve missing transaction', 'error');
      return;
    }

    showStatus('Missing transaction resolved', 'success');

    try {
      localStorage.removeItem('pf_cached_transactions');
      localStorage.removeItem('pf_transactions_cached_at');
    } catch (cacheError) { /* non-fatal */ }

    await fetchAllTransactions(true);

  } catch (networkError) {
    showStatus(`Failed to resolve: ${networkError.message}`, 'error');
  }
}

/**
 * Skip a bill occurrence by calling the Bills API skip endpoint.
 * Called from the ⏭ button in the action column of scheduled bill transactions.
 */
async function skipBillOccurrence(billId, occurrenceDate) {
  if (!confirm(`Skip the bill occurrence on ${occurrenceDate}?`)) {
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/bills/${encodeURIComponent(billId)}/skip`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: occurrenceDate })
      }
    );

    if (!response.ok) {
      const data = await response.json();
      showStatus(data.error || 'Failed to skip occurrence', 'error');
      return;
    }

    showStatus('Bill occurrence skipped', 'success');

    try {
      localStorage.removeItem('pf_cached_transactions');
      localStorage.removeItem('pf_transactions_cached_at');
    } catch (cacheError) { /* non-fatal */ }

    await fetchAllTransactions(true);

  } catch (networkError) {
    showStatus(`Failed to skip occurrence: ${networkError.message}`, 'error');
  }
}
