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

  // Wait for IndexedDB worker to be ready, then migrate localStorage cache
  if (window.txnDB) {
    await window.txnDB.ready();
    try {
      var idbCount = await window.txnDB.count();
      if (idbCount === 0) {
        var lsRaw = localStorage.getItem('pf_cached_transactions');
        if (lsRaw) {
          var lsTs = localStorage.getItem('pf_transactions_cached_at');
          var parsed = JSON.parse(lsRaw);
          await window.txnDB.bulkWrite(parsed);
          if (lsTs) await window.txnDB.setMeta('cached_at', parseInt(lsTs));
          localStorage.removeItem('pf_cached_transactions');
          localStorage.removeItem('pf_transactions_cached_at');
          console.log('Migrated ' + parsed.length + ' transactions from localStorage to IndexedDB');
        }
      }
    } catch (migrationErr) {
      console.warn('localStorage → IndexedDB migration failed (non-fatal):', migrationErr);
    }
  }

  // Sync transactions with Plaid on page load (after accounts are loaded/selected)
  await autoSyncAndLoadTransactions();

  // Render dynamic period buttons after transactions are loaded
  renderDynamicPeriodButtons();
  initCustomDateListeners();

  // Load available categories for manual categorization dropdown
  await loadAvailableCategories();
  initCategoryFilterInput();
  initSearchBar();
  renderTransactionTable();

  // Initialize right-click context menu on transaction rows
  initContextMenu();

  // Initialize click-to-edit on date, description, and amount cells
  initInlineEditing();

  // Initialize batch edit manager for deferred category/memo submissions
  initBatchEditListeners();

  // Check for pending reconciliation proposals and show banner if needed
  await checkAndRenderReconciliationBanner();

  // If returning from categories.html after creating a category for a
  // pending manual transaction, auto-submit it now that the page is ready.
  await _submitPendingManualTransaction();

  // ── Delegated event handlers ──────────────────────────────

  // Re-render table when optional field checkboxes toggle
  $(document).on('change', '.field-checkbox', function() {
    renderTransactionTable();
  });

  // Save memo via button click — stage for batch submission
  $(document).on('click', '.memo-save', function() {
    const button = $(this);
    const txnId = button.data('txn-id');
    const input = button.closest('td').find('.memo-input');
    const memoValue = input.val();

    if (txnId && typeof stageBatchEdit === 'function') {
      stageBatchEdit(String(txnId), { user_memo: memoValue });
      showStatus('Memo staged', 'success');
      setTimeout(() => clearStatus(), 1500);
    } else {
      // Fallback to immediate save if batch manager is unavailable
      saveTransactionMemo(txnId, memoValue, button);
    }
  });

  // Tab handler for memo input — stage memo via batch manager and advance
  $(document).on('keydown', '.memo-input', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const memoInputEl = $(this);
      const memoValue = memoInputEl.val();
      const currentRow = memoInputEl.closest('tr');
      const memoTxnId = currentRow.data('txn-id');

      // Stage the memo change for bulk submission
      if (memoTxnId && typeof stageBatchEdit === 'function') {
        stageBatchEdit(String(memoTxnId), { user_memo: memoValue });
      }

      // Advance to next row's category input
      const nextRow = currentRow.next('tr');
      if (nextRow.length) {
        const nextCategoryInput = nextRow.find('.category-autocomplete');
        if (nextCategoryInput.length) {
          nextCategoryInput.focus();
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const enterMemoInput = $(this);
      const enterMemoValue = enterMemoInput.val();
      const enterRow = enterMemoInput.closest('tr');
      const enterTxnId = enterRow.data('txn-id');

      // Stage the memo change for bulk submission
      if (enterTxnId && typeof stageBatchEdit === 'function') {
        stageBatchEdit(String(enterTxnId), { user_memo: enterMemoValue });
        showStatus('Memo staged', 'success');
        setTimeout(() => clearStatus(), 1500);
      } else {
        // Fallback: click the save button directly
        const button = enterMemoInput.closest('td').find('.memo-save');
        if (button.length) {
          button.click();
        }
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

  // Date filtering is handled by toggle buttons — no text input listeners needed

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

  // Re-render when show-hidden toggle changes and manage batch toolbar visibility
  $(document).on('change', '#show-hidden-toggle', function() {
    const showHidden = this.checked;
    const toolbar = document.getElementById('batch-unhide-toolbar');
    if (toolbar) {
      toolbar.classList.toggle('hidden', !showHidden);
    }
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
