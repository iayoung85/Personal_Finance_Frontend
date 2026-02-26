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
  populateCategoryFilterDropdowns();
  renderTransactionTable();

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

  // Re-render on date range change
  $(document).on('input change', '#start-date, #end-date', function() {
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


});
