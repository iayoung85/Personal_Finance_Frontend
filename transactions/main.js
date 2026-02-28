// ============================================================
// transactions/main.js — Application Bootstrap
// $(document).ready() — orchestrates startup, attaches
// delegated jQuery event handlers. Loaded LAST.
// ============================================================

$(document).ready(async function() {
  await window.BACKEND_URL_PROMISE;
  if (window.ensureLocalDevSession) {
    window.ensureLocalDevSession();
  }
  refreshAuthState();
  if (!token) {
    alert('Please log in first');
    window.location.href = 'index.html';
    return;
  }
  setDefaultDates();
  resetIdleTimeout();
  setupActivityListeners();

  // Load accounts and settings in parallel; keep checkboxes unchecked until both complete
  await Promise.all([loadAccounts(), loadSettings()]);

  // Restore last-selected account from previous session, or default to all
  const savedAccountId = localStorage.getItem('pf_selected_account');
  const savedAccountExists = savedAccountId && accounts.some(a => a.account_id === savedAccountId);
  if (savedAccountExists) {
    await selectAccount(savedAccountId);
  } else {
    localStorage.removeItem('pf_selected_account');
    selectAllAccounts();
  }

  // Sync transactions with Plaid on page load (after accounts are loaded/selected)
  await autoSyncAndLoadTransactions();

  // Render dynamic period buttons after transactions are loaded
  renderDynamicPeriodButtons();

  // Load available categories for manual categorization dropdown
  await loadAvailableCategories();
  initCategoryFilterInput();
  renderTransactionTable();

  // Initialize right-click context menu on transaction rows
  initContextMenu();

  // If returning from categories.html after creating a category for a
  // pending manual transaction, auto-submit it now that the page is ready.
  await _submitPendingManualTransaction();

  // ── Delegated event handlers ──────────────────────────────

  // Re-render table when optional field checkboxes toggle
  $(document).on('change', '.field-checkbox', function() {
    renderTransactionTable();
  });

  // Save memo via button click
  $(document).on('click', '.memo-save', function() {
    const button = $(this);
    const txnId = button.data('txn-id');
    const input = button.closest('td').find('.memo-input');
    const memoValue = input.val();
    saveTransactionMemo(txnId, memoValue, button);
  });

  // Tab handler for memo input — move to next row's category input
  $(document).on('keydown', '.memo-input', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const currentRow = $(this).closest('tr');
      const nextRow = currentRow.next('tr');
      if (nextRow.length) {
        const nextCategoryInput = nextRow.find('.category-autocomplete');
        if (nextCategoryInput.length) {
          nextCategoryInput.focus();
        }
      }
    } else if (e.key === 'Enter') {
      // Enter key to save memo
      e.preventDefault();
      const button = $(this).closest('td').find('.memo-save');
      if (button.length) {
        button.click();
      }
    }
  });

  // Navigate to bills.html when "Edit Bill" button is clicked on scheduled transactions
  $(document).on('click', '.bill-edit-btn', function() {
    const billId = $(this).data('bill-id');
    if (billId) {
      // Tell bills.html to return here after the edit is saved
      sessionStorage.setItem('pf_return_url', 'transactions.html');
      window.location.href = `bills.html?edit=${encodeURIComponent(billId)}`;
    } else {
      showStatus('Unable to edit bill: missing bill ID', 'error');
    }
  });

  // Re-render on date range change and save custom date to localStorage
  $(document).on('input change', '#start-date, #end-date', function() {
    _saveDateRangeToStorage('custom');
    renderTransactionTable();
  });

  // Re-render on account selection change
  $(document).on('change', '.account-checkbox', function() {
    renderTransactionTable();
  });

  // Re-render when hide-transfers toggle changes
  $(document).on('change', '#hide-transfers', function() {
    renderTransactionTable();
  });

  // Re-render when show-overrides-only toggle changes
  $(document).on('change', '#show-overrides-only', function() {
    renderTransactionTable();
  });

  // Re-render when show-pending toggle changes
  $(document).on('change', '#show-pending-toggle', function() {
    renderTransactionTable();
  });

  // Manual categorize handler
  $(document).on('click', '.manual-category-save', function() {
    const txnId = $(this).data('txn-id');
    const select = $(`.manual-category-select[data-txn-id="${txnId}"]`);
    const selectedCategory = select.val();
    const accountId = select.data('account-id');
    const txn = transactions.find(t => t.transaction_id === txnId);
    if (!txnId || !accountId) {
      showStatus('Unable to categorize: missing transaction or account id', 'error');
      return;
    }
    openCategorizeModal(txn, selectedCategory, accountId, txnId);
  });

  // Global hotkey for creating manual transactions: Ctrl+M (Windows/Linux) or Cmd+M (Mac)
  $(document).on('keydown', function(event) {
    // Only trigger if Ctrl/Cmd is pressed with M key (and not inside a focused input)
    const isModifierKey = event.ctrlKey || event.metaKey;
    const isMKey = event.key === 'm' || event.key === 'M';
    const activeElement = document.activeElement;
    
    // Don't trigger if user is typing in an input or textarea (unless it's a modal form field)
    const isInModalInput = activeElement && (
      activeElement.id === 'manual-txn-name' ||
      activeElement.id === 'manual-txn-amount' ||
      activeElement.id === 'manual-txn-date' ||
      activeElement.id === 'manual-txn-merchant' ||
      activeElement.id === 'manual-txn-category' ||
      activeElement.id === 'manual-txn-memo'
    );
    const isInNormalInput = activeElement && (
      activeElement.tagName === 'INPUT' || 
      activeElement.tagName === 'TEXTAREA' || 
      activeElement.tagName === 'SELECT'
    ) && !isInModalInput;
    
    if (isModifierKey && isMKey && !isInNormalInput) {
      event.preventDefault();
      openAddManualTransactionModal();
    }
  });

});
