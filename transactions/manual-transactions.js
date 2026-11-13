// ============================================================
// transactions/manual-transactions.js — Manual Transaction CRUD
// Open the add-manual-transaction modal, save, and delete.
// ============================================================

function _normalizeManualTransactionEditValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    return trimmedValue === '' ? null : trimmedValue;
  }
  return value;
}

function _buildManualTransactionEditPayload(transaction, formValues) {
  const currentTxn = transaction || {};
  const payload = {};

  const parsedAmount = Number.parseFloat(formValues.amountRaw || '0');
  const signedAmount = formValues.type === 'credit' ? parsedAmount : -parsedAmount;
  const currentAmount = Number.isFinite(Number(currentTxn.amount))
    ? Number(Number(currentTxn.amount).toFixed(2))
    : null;
  const nextAmount = Number.isFinite(signedAmount)
    ? Number(signedAmount.toFixed(2))
    : null;

  if (nextAmount !== currentAmount) {
    payload.amount = Number.isFinite(parsedAmount) ? parsedAmount : 0;
  }

  const currentType = Number(currentTxn.amount || 0) >= 0 ? 'credit' : 'debit';
  if (formValues.type !== currentType) {
    payload.type = formValues.type;
  }

  const currentDate = _normalizeManualTransactionEditValue(currentTxn.date);
  if (formValues.date !== currentDate) {
    payload.date = formValues.date;
  }

  const currentMerchant = _normalizeManualTransactionEditValue(currentTxn.merchant_name);
  const merchantValue = _normalizeManualTransactionEditValue(formValues.merchant);
  if (merchantValue !== currentMerchant) {
    payload.merchant_name = merchantValue;
  }

  const currentCategory = _normalizeManualTransactionEditValue(currentTxn.user_category);
  const categoryValue = _normalizeManualTransactionEditValue(formValues.category);
  // A bracket category is written by the transfer link flow onto both rows;
  // the API refuses it on an unlinked row, so it is never sent here.
  if (categoryValue !== currentCategory && !isTransferCategory(categoryValue)) {
    payload.user_category = categoryValue;
  }

  const currentMemo = _normalizeManualTransactionEditValue(currentTxn.user_memo ?? currentTxn.memo);
  const memoValue = _normalizeManualTransactionEditValue(formValues.memo);
  if (memoValue !== currentMemo) {
    payload.memo = memoValue;
  }

  return payload;
}

/**
 * Build the POST body for a new manual transaction. A bracket category
 * ("[Checking]") is left out: the transfer link flow sets it on both rows
 * after the row exists, and the API refuses it on an unlinked row.
 *
 * @param {Object} values - amount, type, date, accountId, merchant, category, memo
 * @returns {Object}
 */
function _buildManualTransactionCreatePayload(values) {
  const category = values.category || '';
  return {
    amount: values.amount,
    type: values.type,
    date: values.date,
    account_id: values.accountId,
    merchant_name: values.merchant || null,
    user_category: category && !isTransferCategory(category) ? category : null,
    memo: values.memo || null,
  };
}

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
  const visibleAccounts = accounts.filter(a => !a.is_hidden && !a.is_archived);
  const offlineAccounts = visibleAccounts
    .filter(a => a.connection_status !== 'linked')
    .sort((a, b) => _buildAccountDisplayName(a).localeCompare(_buildAccountDisplayName(b)));
  const linkedAccounts = visibleAccounts
    .filter(a => a.connection_status === 'linked')
    .sort((a, b) => _buildAccountDisplayName(a).localeCompare(_buildAccountDisplayName(b)));

  if (offlineAccounts.length > 0) {
    accountOptions += '<optgroup label="Offline / Manual Accounts">';
    offlineAccounts.forEach(account => {
      const displayName = _buildAccountDisplayName(account);
      const categoryLabel = account.account_category || '';
      accountOptions += `<option value="${escapeHtml(account.account_id)}">${escapeHtml(displayName)} (${escapeHtml(categoryLabel)})</option>`;
    });
    accountOptions += '</optgroup>';
  }

  if (linkedAccounts.length > 0) {
    accountOptions += '<optgroup label="🔗 Plaid-Linked (historical or future)">';
    linkedAccounts.forEach(account => {
      const displayName = _buildAccountDisplayName(account);
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
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Merchant Name and/or Description (Optional)</label>
        <input id="manual-txn-merchant" type="text" placeholder="e.g., Starbucks" class="modal-input" maxlength="128">
        <small style="color: var(--text-muted); margin-top: 2px; display: block;">Payee or merchant for this transaction</small>
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
    const merchantInput = document.getElementById('manual-txn-merchant');
    if (!merchantInput) return;
    merchantInput.focus();
    merchantInput.select();
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
    const inputs = document.querySelectorAll('#manual-txn-merchant, #manual-txn-amount, #manual-txn-date, #manual-txn-category, #manual-txn-memo');
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
 * Calls PUT /api/transactions/<id> on submit instead of POST.
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
  const txnMerchant = txn.merchant_name || '';
  const txnCategory = txn.user_category || '';
  const txnMemo = txn.user_memo || '';

  const formHtml = `
    <div style="display: grid; gap: 14px;">
      <div id="manual-txn-error-banner" style="display:none; padding: 8px 12px; background: var(--color-danger-bg); border: 1px solid var(--color-danger-border); border-radius: 4px; color: var(--color-danger); font-size: 13px;"></div>
      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 6px;">Merchant Name And/Or Description (Optional)</label>
        <input id="manual-txn-merchant" type="text" value="${escapeHtml(txnMerchant)}" class="modal-input" maxlength="128">
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
    const merchantInput = document.getElementById('manual-txn-merchant');
    if (!merchantInput) return;
    merchantInput.focus();
    merchantInput.select();
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
    const inputs = document.querySelectorAll('#manual-txn-merchant, #manual-txn-amount, #manual-txn-date, #manual-txn-category, #manual-txn-memo');
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
  const rawAmountStr = document.getElementById('manual-txn-amount').value.replace(/^[+\-−]/, '').trim();
  const amount = parseFloat(rawAmountStr);
  const txnType = document.getElementById('manual-txn-type').value;
  const date = getDateInputValue('manual-txn-date');
  const merchant = document.getElementById('manual-txn-merchant').value.trim();
  const category = document.getElementById('manual-txn-category').value;
  const memo = document.getElementById('manual-txn-memo').value.trim();

  // Validate required fields. Zero is intentionally allowed so users can
  // book $0 markdowns (e.g. garnishment carved out of a paycheck) without
  // touching the real running balance.
  if (isNaN(amount) || amount < 0) {
    _showManualTxnError('Amount must be zero or a positive number');
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

  // A bracket is applied by linking, not by saving it on the row. Resolve the
  // target first so an unknown account stops before anything is saved.
  const cachedTxn = transactions.find(findTxn => findTxn.transaction_id === transactionId);
  const currentTxn = cachedTxn || {};
  let transferTarget = null;
  if (category && isTransferCategory(category)
      && category.trim() !== String(currentTxn.user_category || '').trim()) {
    transferTarget = _findAccountByTransferName(parseTransferAccountName(category));
    if (!transferTarget) {
      _showManualTxnError(`No account named "${parseTransferAccountName(category)}" found. Type [ to see available accounts.`);
      return;
    }
  }

  try {
    const payload = _buildManualTransactionEditPayload(currentTxn, {
      amountRaw: rawAmountStr,
      type: txnType,
      date,
      merchant: merchant,
      category,
      memo,
    });

    if (Object.keys(payload).length === 0) {
      closeModal();
      if (transferTarget) {
        await _applyTransferAssignment(transactionId, accountId, transferTarget);
      } else {
        showStatus('No changes were made', 'success');
      }
      return;
    }

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/${encodeURIComponent(transactionId)}`,
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

    // Accounts first inside the helper: the ledger cache is signed with the
    // account's last_updated, and rendering needs the new balance.
    // A linked transfer half's partner sits in another account and changes
    // with it, so the fallback reaches past this row's account.
    const savedRow = await applyRowChangesFromResponse(data, fallbackAccountIdsForRow(cachedTxn), { siteSettlesLedger: true });
    const updatedAccountId = (savedRow && savedRow.account_id) || accountId || selectedAccountId;

    if (selectedAccountMode === 'single' && selectedAccountId) {
      if (data.affected_balance_history) {
        _patchBalanceHistoryCache(updatedAccountId, data.affected_balance_history);
      } else {
        await fetchBalanceHistory(updatedAccountId);
      }
    }

    renderTransactionTable();

    if (transferTarget) {
      // Saving a bill occurrence gives it a new ID; link that row.
      const savedTransactionId = data.transaction_id || transactionId;
      await _applyTransferAssignment(savedTransactionId, accountId, transferTarget);
    }

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
 * Return a user-facing validation error for linked-account date rules.
 * MANUAL_CLEARED creation is now allowed at any date in linked accounts,
 * so this guard is relaxed to always permit.
 */
function _getLinkedAccountDateWindowError(_accountId, _date) {
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
      merchant: document.getElementById('manual-txn-merchant').value.trim(),
      amount: document.getElementById('manual-txn-amount').value.replace(/^[+\-−]/, '').trim(),
      type: document.getElementById('manual-txn-type').value,
      date: getDateInputValue('manual-txn-date'),
      accountId: context.accountId || document.getElementById('manual-txn-account')?.value || null,
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

  // Read before the save, which may replace the row.
  const pendingEditedRow = pending.mode === 'edit'
    ? transactions.find(txn => txn.transaction_id === pending.transactionId)
    : undefined;
  const payload = pending.mode === 'edit'
    ? _buildManualTransactionEditPayload(
        pendingEditedRow || {},
        {
          amountRaw: pending.amount,
          type: pending.type,
          date: pending.date,
          merchant: pending.merchant || '',
          category: pending.category || '',
          memo: pending.memo || '',
        }
      )
    : _buildManualTransactionCreatePayload({
        amount: parseFloat(pending.amount),
        type: pending.type,
        date: pending.date,
        merchant: pending.merchant,
        category: pending.category,
        memo: pending.memo,
      });

  const pendingDateError = _getLinkedAccountDateWindowError(pending.accountId, pending.date);
  if (pendingDateError) {
    showStatus(pendingDateError, 'error');
    return;
  }

  try {
    // The save response, whichever branch ran.
    let savedData = null;
    if (pending.mode === 'edit') {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/${encodeURIComponent(pending.transactionId)}`,
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
      savedData = data;
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
      savedData = data;
    }

    // An edited transfer half's partner sits in another account; a new row
    // has none yet.
    let pendingFallbackAccountIds = pending.accountId ? [pending.accountId] : null;
    if (pending.mode === 'edit') {
      pendingFallbackAccountIds = fallbackAccountIdsForRow(pendingEditedRow);
    }
    const savedRow = await applyRowChangesFromResponse(savedData, pendingFallbackAccountIds, { siteSettlesLedger: true });

    if (pending.mode !== 'edit') {
      const appliedCategory = savedRow ? savedRow.user_category : null;
      const successMsg = appliedCategory
        ? `Manual transaction created (category: ${appliedCategory})`
        : 'Manual transaction created successfully';
      showStatus(successMsg, 'success');
      // Why: the new row, historical or not, must not fall outside the
      // active date window.
      _expandDateFiltersForTransaction((savedRow && savedRow.date) || pending.date);
    }

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
  const merchant = document.getElementById('manual-txn-merchant').value.trim();
  // Strip any leading +/− decoration before parsing the absolute amount
  const rawAmountStr = document.getElementById('manual-txn-amount').value.replace(/^[+\-−]/, '').trim();
  const amount = parseFloat(rawAmountStr);
  const txnType = document.getElementById('manual-txn-type').value;
  const date = getDateInputValue('manual-txn-date');
  const accountId = document.getElementById('manual-txn-account').value;
  const category = document.getElementById('manual-txn-category').value;
  const memo = document.getElementById('manual-txn-memo').value.trim();

  // Validate required fields — show errors inline on the modal. Zero is
  // allowed so users can book $0 accounting markdowns.
  if (isNaN(amount) || amount < 0) {
    _showManualTxnError('Amount must be zero or a positive number (sign is set by Type)');
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

  // Resolve the transfer target before creating anything, so an unknown
  // account does not leave a stray unlinked row behind.
  let transferTarget = null;
  if (category && isTransferCategory(category)) {
    transferTarget = _findAccountByTransferName(parseTransferAccountName(category));
    if (!transferTarget) {
      _showManualTxnError(`No account named "${parseTransferAccountName(category)}" found. Type [ to see available accounts.`);
      return;
    }
  }

  try {
    const payload = _buildManualTransactionCreatePayload({
      amount,
      type: txnType,
      date,
      accountId,
      merchant,
      category,
      memo,
    });

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

    // Read before the rows change: whether the new row lands before every
    // other row of the account decides how far the date window widens.
    const isOldestTransactionForAccount = _isOldestTransactionForAccount(accountId, date);

    // Accounts first inside the helper: the ledger cache is signed with the
    // account's last_updated, and the render needs the new balance for
    // projections. This also has to precede the transfer assignment below,
    // whose own response does not list the account the new row was created on.
    const newTxn = await applyRowChangesFromResponse(data, [accountId], { siteSettlesLedger: true });

    // Show success message with category info if available
    const appliedCategory = newTxn ? newTxn.user_category : null;
    const successMsg = appliedCategory
      ? `Manual transaction created successfully (category: ${appliedCategory})`
      : 'Manual transaction created successfully';
    showStatus(successMsg, 'success');

    // Why: expand date filters so the newly created transaction (including
    // historical ones and opening-balance entries) is immediately visible
    // instead of silently falling outside the active date window.
    _expandDateFiltersForTransaction((newTxn && newTxn.date) || date, {
      includePreviousDay: isOldestTransactionForAccount,
    });

    // The ledger column for this account is settled here, before any transfer
    // assignment: linking changes no ledger row, so nothing after this point
    // would bring the new row's running balance in.
    try {
      if (selectedAccountMode === 'single' && selectedAccountId) {
        if (data.affected_balance_history) {
          _patchBalanceHistoryCache(accountId, data.affected_balance_history);
        } else {
          await fetchBalanceHistory(selectedAccountId);
        }
      }
    } catch (e) {
      // If fetch fails, user still sees the transaction locally
      console.warn('Background fetch failed but transaction is locally cached:', e);
    }

    // Refresh table with new transaction visible
    renderTransactionTable();

    // If the category is bracket-notation transfer (e.g. "[Checking]"),
    // trigger the transfer assignment flow to link/create a counterpart.
    // This runs after the modal is closed so status messages are visible.
    const newTxnId = data.transaction_id;
    if (transferTarget && newTxnId) {
      await _applyTransferAssignment(newTxnId, accountId, transferTarget);
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

    const data = response.ok ? await response.json() : null;
    if (!response.ok) {
      const errData = data || await response.json();
      showStatus(errData.error || 'Failed to delete transaction', 'error');
      return;
    }

    showStatus('Manual transaction deleted successfully', 'success');
    var deletedTxn = transactions.find(function(findTxn) { return findTxn.transaction_id === manualTransactionId; });

    // The response names the deleted row, a cascade-deleted partner, the
    // opening-balance row it rebuilt and an unlinked partner.
    await applyRowChangesFromResponse(data, fallbackAccountIdsForRow(deletedTxn), { siteSettlesLedger: true });

    if (selectedAccountMode === 'single' && selectedAccountId) {
      var deletedAccountId = (deletedTxn && deletedTxn.account_id) || selectedAccountId;
      // Remove the deleted row from the in-memory balance lookup
      delete balanceHistoryLookup[manualTransactionId];
      // Also remove from localStorage cache
      var cacheByAcct = _loadBalanceHistoryCache();
      if (cacheByAcct[deletedAccountId] && cacheByAcct[deletedAccountId].lookup) {
        delete cacheByAcct[deletedAccountId].lookup[manualTransactionId];
        _saveBalanceHistoryCache(cacheByAcct);
      }
      if (data && data.affected_balance_history) {
        _patchBalanceHistoryCache(deletedAccountId, data.affected_balance_history);
      } else {
        await fetchBalanceHistory(selectedAccountId);
      }
    }

    renderTransactionTable();

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
    selectAllOnFocus(input);
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
  const txnDate = getDateInputValue('manual-txn-date') || null;

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

    // MANUAL_CLEARED in linked accounts is now permitted — no date-conflict warning needed.
    const warningHtml = '';

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
 * The accounts to fetch again when a save's response names no rows: the saved
 * row's own account, or null (every account) when the row is half of a
 * transfer, whose partner sits in another account, or is not in the cache.
 *
 * @param {Object|null|undefined} cachedRow The row as the page held it before the save.
 * @returns {Array<string>|null}
 */
function fallbackAccountIdsForRow(cachedRow) {
  if (!cachedRow || !cachedRow.account_id) return null;
  if (isTransferCategory(cachedRow.user_category || '')) return null;
  return [cachedRow.account_id];
}

/**
 * Put a changed-rows response into the page, the one place every save that
 * returns `affected_transactions` and `removed_transaction_ids` goes through:
 * balances first, then the rows it names, then the open ledger. The response
 * names every row the request rewrote, a transfer partner in another account,
 * renumbered bill occurrences and a rebuilt opening-balance row included. A
 * response without the two fields (an older API, or one that could not follow
 * the writes) leaves the page with the accounts that could have changed
 * fetched again.
 *
 * @param {Object|null} data - The parsed success response.
 * @param {Array<string>|null} refetchAccountIds - Accounts to fetch again when
 *   the response names no rows; null or empty fetches every account.
 * @param {{siteSettlesLedger?: boolean}} [options] With `siteSettlesLedger`,
 *   the caller patches or fetches the ledger column itself, so the helper does
 *   not fetch it a second time.
 * @returns {Promise<Object|null>} The saved row (the affected row whose id is
 *   the response's `transaction_id`), or null when the response does not carry
 *   it, so a caller can focus it or learn the id a virtual occurrence got.
 */
async function applyRowChangesFromResponse(data, refetchAccountIds, options) {
  await applyAffectedAccounts(data);
  if (!applyChangedTransactions(data)) {
    if (refetchAccountIds === null || refetchAccountIds === undefined || refetchAccountIds.length === 0) {
      await refreshAccountTransactions(null);
    } else {
      for (const accountId of refetchAccountIds) {
        await refreshAccountTransactions(accountId);
      }
    }
  }
  if (data && Array.isArray(data.removed_transaction_ids)) {
    data.removed_transaction_ids.forEach((removedId) => { delete balanceHistoryLookup[removedId]; });
  }
  if (!(options && options.siteSettlesLedger)) {
    await refreshSelectedLedgerAfterAffected(data);
  }
  return findSavedRowInResponse(data);
}

/**
 * Unmatch a scheduled↔plaid pairing for good. The API puts the row back to
 * missing, or to scheduled when it is not due yet, and may match it to a
 * different bank transaction before it answers.
 * Called from the Unmatch button in the category cell of matched transactions.
 */
async function unmatchScheduledTransaction(transactionId) {
  if (!confirm('Undo this match? These two transactions will not be matched to each other again.')) {
    return;
  }

  // Read from the cache before the request: afterwards the rows no longer
  // say which transfer partner the waiting match was previewing.
  const touchedAccountIds = accountsTouchedByMatch(transactionId, transactions);

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

    const data = await response.json().catch(() => null);

    const rematched = Boolean(data && data.rematched);
    showStatus(
      rematched ? 'Match undone. Matched to another bank transaction.' : 'Match undone',
      'success'
    );
    closeMatchCompare();
    await applyRowChangesFromResponse(data, touchedAccountIds);
    renderTransactionTable();

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

    const data = response.ok ? await response.json() : null;
    if (!response.ok) {
      const errData = data || await response.json();
      showStatus(errData.error || 'Failed to resolve missing transaction', 'error');
      return;
    }

    showStatus('Missing transaction resolved', 'success');

    // A manual partner in another account is deleted with the missing row,
    // and a bank partner is unlinked; the response carries both.
    const missingTxn = transactions.find((txn) => txn.transaction_id === transactionId);
    await applyRowChangesFromResponse(data, fallbackAccountIdsForRow(missingTxn), { siteSettlesLedger: true });

    if (selectedAccountMode === 'single' && selectedAccountId) {
      if (data && data.affected_balance_history) {
        delete balanceHistoryLookup[transactionId];
        _patchBalanceHistoryCache(selectedAccountId, data.affected_balance_history);
      } else {
        await fetchBalanceHistory(selectedAccountId);
      }
    }
    renderTransactionTable();

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

    const data = await response.json();

    // Granular cache patch: remove skipped virtual rows (including _cpt
    // counterpart for transfer bills) and upsert the rebuilt virtual
    // transaction set so both accounts see the change instantly.
    if (data.purged_virtual_ids && data.purged_virtual_ids.length) {
      for (const virtualId of data.purged_virtual_ids) {
        _removeCachedTransaction(virtualId);
      }
    }
    if (data.affected_virtual_transactions && data.affected_virtual_transactions.length) {
      for (const virtualTxn of data.affected_virtual_transactions) {
        _replaceCachedTransaction(virtualTxn.transaction_id, virtualTxn);
      }
    }

    // Wipe ETag so next background refresh gets a full sync
    if (window.txnDB) {
      window.txnDB.setMeta('etag', null).catch(() => {});
    }

    showStatus('Bill occurrence skipped', 'success');
    renderTransactionTable();

  } catch (networkError) {
    showStatus(`Failed to skip occurrence: ${networkError.message}`, 'error');
  }
}
