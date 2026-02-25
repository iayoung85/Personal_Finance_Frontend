// ============================================================
// transactions/manual-transactions.js — Manual Transaction CRUD
// Open the add-manual-transaction modal, save, and delete.
// ============================================================

/**
 * Open modal to create a new manual transaction
 */
function openAddManualTransactionModal() {
  const categoryOptions = buildCategoryOptions('');
  
  // Get today's date in local timezone (not UTC)
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;
  
  // Build account dropdown from available accounts
  let accountOptions = '<option value="">— Select Account —</option>';
  let defaultAccountId = '';
  
  accounts.forEach(account => {
    const displayName = account.custom_name || account.account_name || account.institution_name || 'Unknown Account';
    const categoryLabel = account.account_category || '';
    
    accountOptions += `<option value="${escapeHtml(account.account_id)}">${escapeHtml(displayName)} (${escapeHtml(categoryLabel)})</option>`;
  });
  
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
      <div id="manual-txn-error-banner" style="display:none; padding: 8px 12px; background: #fef2f2; border: 1px solid #fca5a5; border-radius: 4px; color: #b91c1c; font-size: 13px;"></div>
      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Description *</label>
        <input id="manual-txn-name" type="text" placeholder="e.g., Coffee at local shop" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;" maxlength="128">
        <small style="color: #666; margin-top: 2px; display: block;">Brief description of transaction</small>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px;">
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Amount *</label>
          <input id="manual-txn-amount" type="number" placeholder="0.00" step="0.01" min="0" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;">
        </div>
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Type *</label>
          <select id="manual-txn-type" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;">
            <option value="debit" selected>Debit (−)</option>
            <option value="credit">Credit (+)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Date *</label>
          <input id="manual-txn-date" type="date" value="${today}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;">
        </div>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Account *</label>
        <select id="manual-txn-account" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;">
          ${accountOptions}
        </select>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Merchant (Optional)</label>
        <input id="manual-txn-merchant" type="text" placeholder="e.g., Starbucks" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;" maxlength="128">
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Category (Optional)</label>
        <select id="manual-txn-category" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;">
          <option value="">— None (Auto-apply rules) —</option>
          ${categoryOptions}
        </select>
        <small style="color: #666; margin-top: 2px; display: block;">If not selected, mappings and rules will be applied automatically</small>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Memo (Optional)</label>
        <input id="manual-txn-memo" type="text" placeholder="Add a note" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;" maxlength="256">
        <small style="color: #666; margin-top: 2px; display: block;">Additional notes about this transaction</small>
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
  
  // Add Enter key listener for Create button
  setTimeout(() => {
    const inputs = document.querySelectorAll('#manual-txn-name, #manual-txn-amount, #manual-txn-date, #manual-txn-merchant, #manual-txn-memo');
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

/**
 * Save a new manual transaction via API
 */
async function saveManualTransaction() {
  const name = document.getElementById('manual-txn-name').value.trim();
  const amount = parseFloat(document.getElementById('manual-txn-amount').value);
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
    _showManualTxnError('Amount must be a positive number');
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
  const openingBalanceTxn = transactions.find(
    txn => txn.source === 'opening_balance' && txn.account_id === accountId
  );

  if (isActivelyLinkedToPlaid && openingBalanceTxn) {
    // Plaid accounts: manual transactions MUST be before the opening balance date.
    // Backend will auto-generate a manual_opening_balance to reconcile.
    if (date >= openingBalanceTxn.date) {
      _showManualTxnError(`Plaid account: date must be before the opening balance (${openingBalanceTxn.date}). Manual transactions in Plaid accounts are only for historical entries.`);
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
    
    // Refresh table with new transaction visible
    renderTransactionTable();
    
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

  // Find opening balance for this account
  const openingBalanceTxn = transactions.find(
    txn => txn.source === 'opening_balance' && txn.account_id === accountId
  );

  if (selectedAccount && selectedAccount.connection_status === 'linked') {
    // Plaid account: manual transactions must be BEFORE opening balance.
    // Auto-set date to 1 day before opening balance for convenience.
    if (openingBalanceTxn) {
      const openingDate = new Date(openingBalanceTxn.date + 'T00:00:00');
      const dayBefore = new Date(openingDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayBeforeStr = dayBefore.toISOString().split('T')[0];

      dateInput.value = dayBeforeStr;
      dateInput.setAttribute('max', dayBeforeStr);
    }

    const advisory = document.createElement('small');
    advisory.id = 'manual-txn-plaid-advisory';
    advisory.style.cssText = 'color: #b45309; display: block; margin-top: 6px; padding: 6px 8px; background: #fef3c7; border-radius: 4px; font-size: 11px;';
    advisory.textContent = openingBalanceTxn
      ? `Plaid account: Manual transactions must occur before the opening balance (${openingBalanceTxn.date}). The app will auto-generate a reconciling opening balance.`
      : 'Plaid account: Manual transactions are only for historical entries before the earliest Plaid-downloaded transaction.';
    accountSelect.parentElement.appendChild(advisory);
  }
  // Offline accounts: no constraints, date stays as today
}
