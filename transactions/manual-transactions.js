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
    // Use custom_name if available, otherwise use account_name, otherwise use institution_name + account_name
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
      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Description *</label>
        <input id="manual-txn-name" type="text" placeholder="e.g., Coffee at local shop" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;" maxlength="128">
        <small style="color: #666; margin-top: 2px; display: block;">Brief description of transaction</small>
      </div>
      
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Amount *</label>
          <input id="manual-txn-amount" type="number" placeholder="0.00" step="0.01" min="0" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;">
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
 * Save a new manual transaction via API
 */
async function saveManualTransaction() {
  const name = document.getElementById('manual-txn-name').value.trim();
  const amount = parseFloat(document.getElementById('manual-txn-amount').value);
  const date = document.getElementById('manual-txn-date').value;
  const accountId = document.getElementById('manual-txn-account').value;
  const merchant = document.getElementById('manual-txn-merchant').value.trim();
  const category = document.getElementById('manual-txn-category').value;
  const memo = document.getElementById('manual-txn-memo').value.trim();

  // Validate required fields
  if (!name) {
    showStatus('Description is required', 'error');
    return;
  }
  if (!amount || amount <= 0 || isNaN(amount)) {
    showStatus('Amount must be a positive number', 'error');
    return;
  }
  if (!date) {
    showStatus('Date is required', 'error');
    return;
  }
  if (!accountId) {
    showStatus('Please select an account', 'error');
    return;
  }

  try {
    const payload = {
      description: name,
      amount,
      date,
      account_id: accountId,  // Use unified account_id (works for both Plaid and manual accounts)
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
      showStatus(data.error || 'Failed to create manual transaction', 'error');
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
    newTxn.manual_transaction_id = data.manual_transaction_id;
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
    showStatus(`Failed to create transaction: ${error.message}`, 'error');
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
