// ============================================================
// transactions/manual-transactions.js — Manual Transaction CRUD
// Open the add-manual-transaction modal, save, and delete.
// ============================================================

/**
 * Open modal to create a new manual transaction
 */
function openAddManualTransactionModal() {
  const today = todayISO();
  
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
    accountOptions += '<optgroup label="🔗 Plaid-Linked (historical or future)">';
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
          <input id="manual-txn-date" type="text" value="${today}" class="modal-input date-input">
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

  setTimeout(() => {
    const descriptionInput = document.getElementById('manual-txn-name');
    if (!descriptionInput) return;
    descriptionInput.focus();
    descriptionInput.select();
  }, 0);

  // Auto-format wiring for the date text input inside the modal
  wireDateInputs(document.querySelector('.modal-content'));
  
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

  // Wire up account selection to show a lightweight linked-account badge.
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
 * Open modal to edit an existing manual transaction.
 * Reuses the same form layout as the create modal with fields pre-populated.
 * Calls PUT /api/transactions/manual/<id> on submit instead of POST.
 *
 * Why a separate function instead of parameterising openAddManualTransactionModal:
 * the create modal has plaid-account date advisory logic, account-selection wiring,
 * and hotkey-to-keep-open flows that don't apply to editing. Keeping them separate
 * avoids an ever-growing tangle of if-else branches in one 200-line function.
 */
function openEditManualTransactionModal(transactionId) {
  const txn = transactions.find(findTxn => findTxn.transaction_id === transactionId);
  if (!txn) {
    showStatus('Transaction not found', 'error');
    return;
  }

  // Resolve the display name for the account (read-only in edit mode)
  const txnAccount = accounts.find(findAccount => findAccount.account_id === txn.account_id);
  const accountDisplayName = txnAccount
    ? (txnAccount.custom_name || txnAccount.account_name || txnAccount.institution_name || 'Unknown')
    : (txn.bank_account || 'Unknown');

  // Pre-populate values
  const absAmount = Math.abs(txn.amount || 0).toFixed(2);
  const txnType = (txn.amount || 0) >= 0 ? 'credit' : 'debit';
  const txnDate = txn.date || '';
  const txnName = txn.raw_description || txn.description || txn.name || '';
  const txnMerchant = txn.merchant_name || '';
  const txnCategory = txn.user_category || '';
  const txnMemo = txn.user_memo || '';

  const formHtml = `
    <div style="display: grid; gap: 14px;">
      <div id="manual-txn-error-banner" style="display:none; padding: 8px 12px; background: var(--color-danger-bg); border: 1px solid var(--color-danger-border); border-radius: 4px; color: var(--color-danger); font-size: 13px;"></div>
      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Description *</label>
        <input id="manual-txn-name" type="text" value="${escapeHtml(txnName)}" class="modal-input" maxlength="128">
      </div>

      <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px;">
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Amount *</label>
          <input id="manual-txn-amount" type="text" inputmode="decimal" value="${absAmount}" class="modal-input">
        </div>
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Type *</label>
          <select id="manual-txn-type" class="modal-input">
            <option value="debit"${txnType === 'debit' ? ' selected' : ''}>Debit (−)</option>
            <option value="credit"${txnType === 'credit' ? ' selected' : ''}>Credit (+)</option>
          </select>
        </div>
        <div>
          <label style="display: block; font-weight: 500; margin-bottom: 6px;">Date *</label>
          <input id="manual-txn-date" type="text" value="${txnDate}" class="modal-input date-input">
        </div>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Account</label>
        <input type="text" value="${escapeHtml(accountDisplayName)}" class="modal-input" disabled style="opacity: 0.6; cursor: not-allowed;">
        <small style="color: var(--text-muted); margin-top: 2px; display: block;">Account cannot be changed on existing transactions</small>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Merchant (Optional)</label>
        <input id="manual-txn-merchant" type="text" value="${escapeHtml(txnMerchant)}" class="modal-input" maxlength="128">
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Category (Optional)</label>
        <div style="position: relative;">
          <input id="manual-txn-category" type="text" value="${escapeHtml(txnCategory)}" placeholder="Type to search, or [ for transfers" autocomplete="off" class="modal-input">
          <div id="manual-txn-category-list" class="category-ac-list" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 99999;"></div>
        </div>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Memo (Optional)</label>
        <input id="manual-txn-memo" type="text" value="${escapeHtml(txnMemo)}" placeholder="Add a note" class="modal-input" maxlength="256">
      </div>
    </div>
  `;

  openModal({
    title: 'Edit Transaction',
    body: formHtml,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Save Changes', onClick: () => _updateManualTransaction(transactionId, txn.account_id) }
    ]
  });

  setTimeout(() => {
    const descriptionInput = document.getElementById('manual-txn-name');
    if (!descriptionInput) return;
    descriptionInput.focus();
    descriptionInput.select();
  }, 0);

  // Auto-format wiring for the date text input inside the modal
  wireDateInputs(document.querySelector('.modal-content'));

  // Wire up the same amount prefix helpers
  setTimeout(() => {
    const amountInput = document.getElementById('manual-txn-amount');
    const typeSelect = document.getElementById('manual-txn-type');
    if (amountInput && typeSelect) {
      amountInput.addEventListener('input', () => _syncAmountPrefix(amountInput, typeSelect));
      typeSelect.addEventListener('change', () => _syncTypeDropdown(amountInput, typeSelect));
      amountInput.addEventListener('blur', () => _decorateAmountOnBlur(amountInput, typeSelect));
      amountInput.addEventListener('focus', () => _stripDecorationOnFocus(amountInput, typeSelect));
    }
  }, 50);

  // Wire up category autocomplete
  setTimeout(() => _wireUpManualCategoryAutocomplete(), 50);

  // Enter key listener saves changes
  setTimeout(() => {
    const inputs = document.querySelectorAll('#manual-txn-name, #manual-txn-amount, #manual-txn-date, #manual-txn-merchant, #manual-txn-category, #manual-txn-memo');
    inputs.forEach(input => {
      input.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          _updateManualTransaction(transactionId, txn.account_id);
        }
      });
    });
  }, 50);
}

/**
 * Send PUT request to update manual transaction, refresh UI on success.
 */
async function _updateManualTransaction(transactionId, accountId) {
  const name = document.getElementById('manual-txn-name').value.trim();
  const rawAmountStr = document.getElementById('manual-txn-amount').value.replace(/^[+\-−]/, '').trim();
  const amount = parseFloat(rawAmountStr);
  const txnType = document.getElementById('manual-txn-type').value;
  const date = document.getElementById('manual-txn-date').value;
  const merchant = document.getElementById('manual-txn-merchant').value.trim();
  const category = document.getElementById('manual-txn-category').value;
  const memo = document.getElementById('manual-txn-memo').value.trim();

  // Validate required fields
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

  const linkedDateError = _getLinkedAccountDateWindowError(accountId, date);
  if (linkedDateError) {
    _showManualTxnError(linkedDateError);
    return;
  }

  // Category validation: must match an existing category or be a bracket transfer
  if (category && !isTransferCategory(category)) {
    const isKnownCategory = (availableCategories || []).some(
      knownCat => knownCat.toLowerCase() === category.toLowerCase()
    );
    if (!isKnownCategory) {
      _showManualTxnCategoryError(category, { mode: 'edit', transactionId, accountId });
      return;
    }
  }

  try {
    const payload = {
      description: name,
      amount,
      type: txnType,
      date,
      merchant_name: merchant || null,
      user_category: category || null,
      memo: memo || null,
    };

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(transactionId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      _showManualTxnError(data.error || 'Failed to update transaction');
      return;
    }

    closeModal();
    showStatus('Transaction updated successfully', 'success');

    // Patch the edited transaction immediately for instant feedback,
    // then refetch the account so backend-recalculated trending
    // amounts (investment performance) are also picked up.
    var updatedAccountId = selectedAccountId;
    if (data.transaction && data.transaction.transaction_id) {
      _replaceCachedTransaction(transactionId, data.transaction);
      updatedAccountId = data.transaction.account_id || selectedAccountId;
    }
    await refreshAccountTransactions(updatedAccountId);
    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
    }
    renderTransactionTable();

    // Refresh sidebar balances — backend may have recalculated current_balance
    await loadAccounts();

  } catch (error) {
    _showManualTxnError(`Failed to update: ${error.message}`);
  }
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
 * Return a user-facing validation error when a linked account date falls
 * inside the plaid-synced window; otherwise return null.
 */
function _getLinkedAccountDateWindowError(accountId, date) {
  if (!accountId || !date) return null;

  const selectedAccount = accounts.find(account => account.account_id === accountId);
  // Why connection_status not origin: origin is immutable (how the account was born),
  // but connection_status reflects current lifecycle. A converted plaid account
  // (connection_status='converted') now operates as manual — no date restriction.
  const isActivelyLinkedToPlaid = selectedAccount && selectedAccount.connection_status === 'linked';
  const earliestPlaidDate = selectedAccount && selectedAccount.earliest_plaid_transaction_date;

  if (!isActivelyLinkedToPlaid || !earliestPlaidDate) {
    return null;
  }

  const todayIso = todayISO();
  const isInPlaidSyncedWindow = date >= earliestPlaidDate && date <= todayIso;

  if (isInPlaidSyncedWindow) {
    return `Plaid account: date falls in the Plaid-synced range (${earliestPlaidDate} to ${todayIso}). Use a historical date before ${earliestPlaidDate} or a future date after ${todayIso}.`;
  }

  return null;
}

/**
 * Show category-specific validation error with an option to create a new
 * category. If the user entered text in "Primary: Detailed" format, we
 * offer to take them to categories.html with the form prepopulated.
 * If it lacks the colon separator, we tell them the required format.
 */
function _showManualTxnCategoryError(badCategory, context = {}) {
  const banner = document.getElementById('manual-txn-error-banner');
  if (!banner) {
    showStatus('Unknown category — please pick from autocomplete or create it in Categories.', 'error');
    return;
  }

  const hasColon = badCategory.includes(':');
  const formatHint = hasColon
    ? ''
    : ' Categories must follow the <strong>Primary: Detailed</strong> format (e.g. "Food: Groceries").';

  banner.innerHTML = `
    <div>"<strong>${escapeHtml(badCategory)}</strong>" is not in your category list.${formatHint}</div>
    <div style="margin-top: 6px;">
      Would you like to create it?
      <button type="button" id="manual-txn-create-cat-btn"
        style="margin-left: 8px; padding: 4px 12px; background: var(--color-primary); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">
        Create Category
      </button>
    </div>
  `;
  banner.style.display = 'block';

  // Clear any existing auto-hide timer since user needs to interact
  clearTimeout(banner._clearTimer);

  document.getElementById('manual-txn-create-cat-btn').addEventListener('click', () => {
    // Why: save entire form state so the transaction can be auto-submitted
    // after the user creates the category on categories.html. This avoids
    // forcing the user to re-enter all fields after a round-trip.
    const pendingTxn = {
      mode: context.mode || 'create',
      transactionId: context.transactionId || null,
      categoryResolved: false,
      description: document.getElementById('manual-txn-name').value.trim(),
      amount: document.getElementById('manual-txn-amount').value.replace(/^[+\-−]/, '').trim(),
      type: document.getElementById('manual-txn-type').value,
      date: document.getElementById('manual-txn-date').value,
      accountId: context.accountId || document.getElementById('manual-txn-account')?.value || null,
      merchant: document.getElementById('manual-txn-merchant').value.trim(),
      category: badCategory,
      memo: document.getElementById('manual-txn-memo').value.trim(),
    };

    sessionStorage.setItem('pf_pending_manual_txn', JSON.stringify(pendingTxn));
    // Clear any previously tracked categories from an earlier redirect session
    sessionStorage.removeItem('pf_pending_txn_new_categories');
    sessionStorage.setItem('pf_prefill_custom_category', badCategory);
    sessionStorage.setItem('pf_return_url', 'transactions.html');
    window.location.href = 'categories.html#preview';
  });
}

/**
 * Auto-submit a pending manual transaction that was saved to sessionStorage
 * before a round-trip to categories.html. Called on page load — only fires
 * if the categories page resolved the category (set categoryResolved: true).
 *
 * Why a separate function instead of reusing saveManualTransaction():
 * saveManualTransaction reads from DOM inputs; this reads from sessionStorage
 * because the modal isn't open on page load.
 */
async function _submitPendingManualTransaction() {
  const pendingRaw = sessionStorage.getItem('pf_pending_manual_txn');
  if (!pendingRaw) return;

  let pending;
  try {
    pending = JSON.parse(pendingRaw);
  } catch (_parseError) {
    sessionStorage.removeItem('pf_pending_manual_txn');
    return;
  }

  // Only auto-submit if the categories page assigned a valid category
  if (!pending.categoryResolved) return;

  // Clean up immediately to prevent duplicate submissions on refresh
  sessionStorage.removeItem('pf_pending_manual_txn');
  sessionStorage.removeItem('pf_pending_txn_new_categories');
  sessionStorage.removeItem('pf_return_url');

  const payload = {
    description: pending.description,
    amount: parseFloat(pending.amount),
    type: pending.type,
    date: pending.date,
    merchant_name: pending.merchant || null,
    user_category: pending.category || null,
    memo: pending.memo || null,
  };

  const pendingAccountId = pending.mode === 'edit'
    ? (transactions.find(txn => txn.transaction_id === pending.transactionId)?.account_id || pending.accountId)
    : pending.accountId;
  const pendingDateError = _getLinkedAccountDateWindowError(pendingAccountId, pending.date);
  if (pendingDateError) {
    showStatus(pendingDateError, 'error');
    return;
  }

  try {
    if (pending.mode === 'edit') {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(pending.transactionId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        showStatus(data.error || 'Failed to update transaction with new category', 'error');
        return;
      }
      showStatus(`Transaction updated with category: ${pending.category}`, 'success');

    } else {
      // Create mode — POST with account_id
      payload.account_id = pending.accountId;
      const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        showStatus(data.error || 'Failed to create transaction', 'error');
        return;
      }

      const appliedCategory = data.transaction?.user_category;
      const successMsg = appliedCategory
        ? `Manual transaction created (category: ${appliedCategory})`
        : 'Manual transaction created successfully';
      showStatus(successMsg, 'success');

      // Add to in-memory array for immediate UI update
      const newTxn = data.transaction || {};
      newTxn.transaction_id = data.transaction_id || newTxn.transaction_id;
      newTxn.account_id = pending.accountId;
      newTxn.iso_currency_code = 'USD';
      newTxn.source = 'manual';
      transactions.unshift(newTxn);

      _expandDateFiltersForTransaction(newTxn.date);
    }

    // Refresh from server for consistency
    await refreshAccountTransactions(pending.accountId || selectedAccountId);
    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
    }
    renderTransactionTable();

  } catch (networkError) {
    showStatus(`Failed to submit transaction: ${networkError.message}`, 'error');
  }
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

  // Category validation: if the user typed something, it must match an existing
  // category or be a valid bracket-notation transfer (e.g. "[Checking]").
  // Why: our categorization schema is tightly controlled — arbitrary strings
  // would bypass mappings/rules and create orphan categories.
  if (category && !isTransferCategory(category)) {
    const isKnownCategory = (availableCategories || []).some(
      knownCat => knownCat.toLowerCase() === category.toLowerCase()
    );
    if (!isKnownCategory) {
      _showManualTxnCategoryError(category, { mode: 'create' });
      return;
    }
  }

  const linkedDateError = _getLinkedAccountDateWindowError(accountId, date);
  if (linkedDateError) {
    _showManualTxnError(linkedDateError);
    return;
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
    
    const isOldestTransactionForAccount = _isOldestTransactionForAccount(accountId, newTxn.date);

    // Add to in-memory transactions array
    transactions.unshift(newTxn);
    
    // Update cache immediately
    _cacheTransactions(transactions);
    
    // Why: expand date filters so the newly created transaction (including
    // historical ones and opening-balance entries) is immediately visible
    // instead of silently falling outside the active date window.
    _expandDateFiltersForTransaction(newTxn.date, {
      includePreviousDay: isOldestTransactionForAccount,
    });
    
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
    
    // Refetch the account's transactions so backend-recalculated trending
    // amounts and bank_account names are picked up.
    try {
      await refreshAccountTransactions(accountId || selectedAccountId);
      if (selectedAccountMode === 'single' && selectedAccountId) {
        await fetchBalanceHistory(selectedAccountId);
        renderTransactionTable();
      }
      // Refresh sidebar balances — backend may have recalculated current_balance
      await loadAccounts();
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
    var deletedAccountId = selectedAccountId;
    var deletedTxn = transactions.find(function(findTxn) { return findTxn.transaction_id === manualTransactionId; });
    if (deletedTxn) { deletedAccountId = deletedTxn.account_id || selectedAccountId; }
    _removeCachedTransaction(manualTransactionId);

    // Backend may have recalculated trending transaction amounts —
    // refresh this account so those updates are visible.
    await refreshAccountTransactions(deletedAccountId);
    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
    }
    renderTransactionTable();

    // Refresh sidebar balances — backend may have recalculated current_balance
    await loadAccounts();

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

  // Read the date from the modal — used to warn about illegal plaid-range targets
  const dateInput = document.getElementById('manual-txn-date');
  const txnDate = dateInput ? dateInput.value : null;

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

    // Warn when the counterpart transaction date would fall inside a plaid-synced block.
    // The counterpart inherits the same date — if the target is linked and the date
    // is on or after its earliest plaid transaction, it's illegal.
    let warningHtml = '';
    if (txnDate && acc.connection_status === 'linked' && acc.earliest_plaid_transaction_date) {
      if (txnDate >= acc.earliest_plaid_transaction_date) {
        warningHtml = '<span class="transfer-ac-warning" title="Date falls in this account\'s Plaid-synced range — transfer counterpart cannot be created here for this date" style="color:var(--color-warning);margin-left:4px;font-size:11px;">⚠ date conflict</span>';
      }
    }

    return `<div class="category-ac-item transfer-ac-item${index === 0 ? ' active' : ''}" data-value="${escapeHtml(transferValue)}" data-account-id="${escapeHtml(acc.account_id)}">`
      + `<span class="transfer-ac-icon">\u21C4</span> ${highlighted} ${typeBadge}${warningHtml}</div>`;
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

  if (selectedAccount && selectedAccount.connection_status === 'linked') {
    const advisory = document.createElement('small');
    advisory.id = 'manual-txn-plaid-advisory';
    advisory.style.cssText = 'color: var(--color-info); display: block; margin-top: 6px; font-size: 11px;';
    advisory.textContent = '🔗 Linked';
    accountSelect.parentElement.appendChild(advisory);
  }
  // Offline accounts: no constraints, date stays as today
}

/**
 * Return true when the newly created transaction date is older than every
 * currently loaded transaction date for the same account.
 *
 * Why: when this happens, backend reconciliation may place a
 * manual_opening_balance row one day earlier. We need to include that anchor
 * day in the active start-date filter so the row is visible immediately.
 */
function _isOldestTransactionForAccount(accountId, txnDate) {
  if (!accountId || !txnDate || !Array.isArray(transactions)) return false;

  let earliestExistingDate = null;
  transactions.forEach(transaction => {
    if (transaction.account_id !== accountId || !transaction.date) return;
    if (!earliestExistingDate || transaction.date < earliestExistingDate) {
      earliestExistingDate = transaction.date;
    }
  });

  if (!earliestExistingDate) return true;
  return txnDate < earliestExistingDate;
}

/**
 * Shift an ISO date string by a day offset and return YYYY-MM-DD.
 */
function _shiftIsoDateByDays(isoDate, dayOffset) {
  if (!isoDate) return isoDate;
  const parsedDate = new Date(`${isoDate}T00:00:00`);
  if (isNaN(parsedDate.getTime())) return isoDate;
  parsedDate.setDate(parsedDate.getDate() + dayOffset);
  return toISODateStr(parsedDate);
}

/**
 * Expand the start/end date filter inputs if the given transaction date
 * falls outside the currently visible range. This ensures newly created
 * manual transactions (including historical entries and opening-balance
 * transactions) are immediately visible to the user.
 *
 * @param {string} txnDate — ISO date string (YYYY-MM-DD) of the new transaction.
 */
function _expandDateFiltersForTransaction(txnDate, options = {}) {
  if (!txnDate) return;

  const startInput = document.getElementById('start-date');
  const endInput = document.getElementById('end-date');
  if (!startInput || !endInput) return;

  const currentStart = startInput.value; // YYYY-MM-DD string
  const currentEnd = endInput.value;
  const includePreviousDay = Boolean(options.includePreviousDay);
  const startCandidateDate = includePreviousDay
    ? _shiftIsoDateByDays(txnDate, -1)
    : txnDate;

  let didExpand = false;

  if (!currentStart || startCandidateDate < currentStart) {
    startInput.value = startCandidateDate;
    didExpand = true;
  }

  if (!currentEnd || txnDate > currentEnd) {
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
    await refreshAccountTransactions(selectedAccountId);

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
    await refreshAccountTransactions(selectedAccountId);

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
    await refreshAccountTransactions(selectedAccountId);

  } catch (networkError) {
    showStatus(`Failed to skip occurrence: ${networkError.message}`, 'error');
  }
}
