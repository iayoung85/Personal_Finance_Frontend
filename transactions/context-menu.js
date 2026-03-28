// ============================================================
// transactions/context-menu.js — Right-Click Context Menu
// Custom context menu on transaction rows with type-aware
// menu item filtering and action dispatching.
// ============================================================

/**
 * Initialize the context menu system.
 * Called once from main.js during page bootstrap.
 *
 * Why a single delegated listener on #table-container instead of per-row:
 * the table is re-rendered frequently (filter changes, syncs, etc.), so
 * attaching to each <tr> would leak listeners or require teardown logic.
 */
function initContextMenu() {
  // Create the floating menu container once (appended to <body> to avoid
  // clipping by the scroll pane's overflow:hidden).
  const menuEl = document.createElement('div');
  menuEl.id = 'txn-context-menu';
  menuEl.className = 'txn-context-menu hidden';
  document.body.appendChild(menuEl);

  // Delegated contextmenu listener on the table scroll container
  const tableContainer = document.getElementById('table-container');
  if (tableContainer) {
    tableContainer.addEventListener('contextmenu', _handleContextMenu);
  }

  // Dismiss menu on click-outside, Escape, or scroll
  document.addEventListener('click', _dismissContextMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') _dismissContextMenu();
  });
  if (tableContainer) {
    tableContainer.addEventListener('scroll', _dismissContextMenu);
  }
}

// ─── Event handler: contextmenu on table container ────────────

function _handleContextMenu(event) {
  // Ctrl/⌘ + Right-Click → let native browser menu through
  if (event.ctrlKey || event.metaKey) return;

  // If target is an interactive element, let native menu through
  // (paste/spell-check in inputs, button right-click, etc.)
  const targetTag = event.target.tagName.toLowerCase();
  if (['input', 'select', 'textarea', 'button'].includes(targetTag)) return;
  // Also check if target is inside a button (e.g. icon inside <button>)
  if (event.target.closest('button')) return;

  // Find the closest <tr> (transaction row)
  const row = event.target.closest('tr');
  if (!row) return;

  // Skip header rows and separator rows
  if (row.closest('thead')) return;
  if (row.classList.contains('scheduled-separator-row')
   || row.classList.contains('missing-separator-row')
   || row.classList.contains('pending-separator-row')
   || row.classList.contains('zone-separator')) return;

  // Read transaction metadata from data attributes
  const txnId = row.dataset.txnId;
  if (!txnId) return; // safety — rows without data-txn-id are non-actionable

  event.preventDefault();

  const txnData = {
    txnId,
    source: row.dataset.source || '',
    status: row.dataset.status || '',
    pending: row.dataset.pending === 'true',
    isBill: row.dataset.isBill === 'true',
    billId: row.dataset.billId || '',
    accountId: row.dataset.accountId || '',
    amount: parseFloat(row.dataset.amount) || 0,
    isSplit: row.dataset.isSplit === 'true',
    name: row.dataset.txnDescription || '',
    userCategory: row.dataset.userCategory || '',
    merchantName: row.dataset.merchantName || '',
    matchManualTxnId: row.dataset.matchManualTxnId || '',
    isHidden: row.dataset.isHidden === 'true',
    txnDate: row.dataset.txnDate || '',
  };

  const menuItems = _buildMenuItems(txnData);
  if (menuItems.length === 0) return; // no actions available for this type

  _showContextMenu(event.clientX, event.clientY, menuItems, txnData);
}

// ─── Build menu items based on transaction type ───────────────
// Visibility matrix from the implementation plan in transactions.md

function _buildMenuItems(txnData) {
  const { isBill, isSplit } = txnData;

  // Classify once via the centralized type classifier
  const txnType = getTransactionType(txnData);

  const isPlaid = txnType === TXN_TYPE.PLAID_CLEARED || txnType === TXN_TYPE.PLAID_PENDING;
  const isManual = txnType === TXN_TYPE.MANUAL_CLEARED;
  const isPlaidConverted = txnType === TXN_TYPE.PLAID_CONVERTED;
  const isPending = txnType === TXN_TYPE.PLAID_PENDING;
  const isBillFuture = txnType === TXN_TYPE.BILL_FUTURE;
  const isManualFuture = txnType === TXN_TYPE.MANUAL_FUTURE;
  const isScheduled = isBillFuture || isManualFuture;
  const isMissing = txnType === TXN_TYPE.BILL_MISSING || txnType === TXN_TYPE.MANUAL_MISSING;
  const isMatched = txnType === TXN_TYPE.BILL_MATCHED || txnType === TXN_TYPE.MANUAL_MATCH;
  const isMatchedPair = !!txnData.matchManualTxnId;
  const isOpeningBalance = txnType === TXN_TYPE.SYSTEM_OPENING_BALANCE || txnType === TXN_TYPE.SYSTEM_MANUAL_OPENING_BALANCE;
  const isOrphaned = txnType === TXN_TYPE.MANUAL_ORPHANED;
  const isReconciliation = txnType === TXN_TYPE.SYSTEM_RECONCILIATION;

  const isInvestmentTrending = txnType === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING;

  // Opening balance, reconciliation, and split children have no context menu
  if (isOpeningBalance || isReconciliation || isSplit) return [];

  const items = [];

  // Investment trending rows: Edit Account Balance + Add new trending
  if (isInvestmentTrending) {
    const account = accounts.find(a => a.account_id === txnData.accountId);
    const isLinked = account && account.connection_status === 'linked';
    const txnMonth = (txnData.txnDate || '').slice(0, 7);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const isCurrentMonth = txnMonth === currentMonth;
    const isLocked = isLinked && isCurrentMonth;

    items.push({
      label: isLocked ? '🔒 Edit Account Balance (locked)' : '💰 Edit Account Balance',
      action: 'edit-investment-balance',
      separator: false,
      disabled: isLocked,
    });
    items.push({
      label: '📈 Add Trending Transaction',
      action: 'add-trending',
      separator: false,
    });
    return items;
  }

  // Orphaned transactions get the same edit capability as manual, plus
  // reconciliation-specific quick-fix actions (force match, relocate).
  if (isOrphaned) {
    items.push({
      label: '✏️ Modify',
      action: 'modify',
      separator: false,
    });
    items.push({
      label: '🔗 Force Match',
      action: 'force-match',
      separator: false,
    });
    items.push({
      label: '↪ Move to Account',
      action: 'move-to-account',
      separator: false,
    });
    items.push({
      label: '🗑️ Delete',
      action: 'delete-missing',
      separator: true,
      destructive: true,
    });
    return items;
  }

  // Missing transactions get similar quick-fix options
  if (isMissing) {
    items.push({
      label: '🔗 Match to Transaction',
      action: 'match-to-adjacent',
      separator: false,
    });
    items.push({
      label: '🗑️ Delete',
      action: 'delete-missing',
      separator: false,
      destructive: true,
    });
    return items;
  }

  // Matched transactions get approve actions, bill, and transfer
  if (isMatched || isMatchedPair) {
    items.push({
      label: '✓ Approve Match',
      action: 'approve-match',
      separator: false,
    });
    items.push({
      label: '✓ Approve All Matches',
      action: 'approve-all-matches',
      separator: true,
    });
    items.push({
      label: '📅 This is a Bill',
      action: 'this-is-a-bill',
      separator: false,
    });
    items.push({
      label: '⇄ Make Transfer',
      action: 'make-transfer',
      separator: false,
    });
    return items;
  }

  // ── Virtual BILL_FUTURE gets its own menu: mark paid, modify, skip ──
  // These are virtual rows (no DB record) — actions trigger materialization.
  // Split and transfer are not available because there is no DB row to
  // attach child rows or transfer_pair_id to.
  if (isBillFuture) {
    const markPaidLabel = txnData.amount < 0 ? '✅ Mark Paid' : '✅ Mark Received';
    items.push({
      label: markPaidLabel,
      action: 'mark-paid',
      separator: false,
    });
    items.push({
      label: '✏️ Modify',
      action: 'modify',
      separator: false,
    });
    items.push({
      label: '⏭ Skip Occurrence',
      action: 'skip-occurrence',
      separator: false,
      destructive: true,
    });
    return items;
  }

  // "Modify" — manual transactions, MANUAL_FUTURE, and PLAID_CONVERTED
  const showModify = isManual || isManualFuture || isPlaidConverted;
  if (showModify) {
    items.push({
      label: '✏️ Modify',
      action: 'modify',
      separator: false,
    });
  }

  // "Hide" / "Unhide" — plaid cleared and plaid pending in linked accounts
  if (isPlaid) {
    if (txnData.isHidden) {
      items.push({
        label: '👁 Unhide',
        action: 'unhide',
        separator: false,
      });
    } else {
      items.push({
        label: '👁‍🗨 Hide',
        action: 'hide',
        separator: false,
      });
    }
  }

  // "This is a Bill" — plaid, manual, plaid-converted, pending (NOT scheduled, missing, split, opening, orphaned)
  const showBill = isPlaid || (isManual && !isOrphaned) || isPlaidConverted || isPending;
  if (showBill) {
    items.push({
      label: '📅 This is a Bill',
      action: 'this-is-a-bill',
      separator: false,
    });
  }

  // "Make Transfer" — plaid, manual, plaid-converted, pending, MANUAL_FUTURE, missing
  // (NOT split, opening balance, orphaned, matched, BILL_FUTURE)
  const showTransfer = isPlaid || isManual || isPlaidConverted || isPending || isManualFuture || isMissing;
  if (showTransfer) {
    items.push({
      label: '⇄ Make Transfer',
      action: 'make-transfer',
      separator: false,
    });
  }

  // Visual separator before destructive actions
  if (items.length > 0) {
    items[items.length - 1].separator = true;
  }

  // "Delete" — manual cleared, MANUAL_FUTURE, and PLAID_CONVERTED (not matched, not orphaned)
  if ((isManual || isManualFuture || isPlaidConverted) && !isOrphaned) {
    items.push({
      label: '🗑️ Delete',
      action: 'delete',
      separator: false,
      destructive: true,
    });
  }

  // "Inspect Data" — any plaid-sourced row (cleared, pending, converted).
  // Shows Plaid's raw blob side-by-side with the app's working data.
  if (isPlaid || isPlaidConverted) {
    if (items.length > 0) {
      items[items.length - 1].separator = true;
    }
    items.push({
      label: '🔍 Inspect Data',
      action: 'inspect-data',
      separator: false,
    });
  }

  // Remove trailing separator if delete wasn't added
  if (items.length > 0 && !items[items.length - 1].destructive && items[items.length - 1].action !== 'inspect-data') {
    items[items.length - 1].separator = false;
  }

  return items;
}

// ─── Show / Dismiss the floating menu ─────────────────────────

function _showContextMenu(cursorX, cursorY, menuItems, txnData) {
  const menuEl = document.getElementById('txn-context-menu');
  if (!menuEl) return;

  // Build menu HTML
  let html = '';
  menuItems.forEach(item => {
    const destructiveClass = item.destructive ? ' ctx-destructive' : '';
    const disabledClass = item.disabled ? ' ctx-disabled' : '';
    const disabledAttr = item.disabled ? ' disabled' : '';
    html += `<button class="ctx-menu-item${destructiveClass}${disabledClass}" data-action="${item.action}"${disabledAttr}>${item.label}</button>`;
    if (item.separator) {
      html += '<div class="ctx-menu-separator"></div>';
    }
  });
  menuEl.innerHTML = html;

  // Attach click handlers — use event delegation on the menu container
  menuEl.onclick = (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    _dismissContextMenu();
    _dispatchContextAction(btn.dataset.action, txnData);
  };

  // Position near cursor, clamped to viewport
  menuEl.classList.remove('hidden');
  const menuRect = menuEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let posX = cursorX;
  let posY = cursorY;

  // Prevent overflow off right edge
  if (posX + menuRect.width > viewportWidth - 8) {
    posX = viewportWidth - menuRect.width - 8;
  }
  // Prevent overflow off bottom edge
  if (posY + menuRect.height > viewportHeight - 8) {
    posY = viewportHeight - menuRect.height - 8;
  }

  menuEl.style.left = `${posX}px`;
  menuEl.style.top = `${posY}px`;
}

function _dismissContextMenu() {
  const menuEl = document.getElementById('txn-context-menu');
  if (menuEl) {
    menuEl.classList.add('hidden');
    menuEl.onclick = null;
  }
}

// ─── Action dispatcher ────────────────────────────────────────

function _dispatchContextAction(action, txnData) {
  switch (action) {
    case 'modify':
      _handleContextModify(txnData);
      break;
    case 'this-is-a-bill':
      _handleContextThisIsABill(txnData);
      break;
    case 'make-transfer':
      _handleContextMakeTransfer(txnData);
      break;
    case 'delete':
      _handleContextDelete(txnData);
      break;
    case 'match-to-adjacent':
      _handleContextMatchToAdjacent(txnData);
      break;
    case 'force-match':
      _handleContextForceMatch(txnData);
      break;
    case 'move-to-account':
      _handleContextMoveToAccount(txnData);
      break;
    case 'delete-missing':
      _handleContextDeleteMissing(txnData);
      break;
    case 'approve-match':
      _handleContextApproveMatch(txnData);
      break;
    case 'approve-all-matches':
      _handleContextApproveAllMatches(txnData);
      break;
    case 'mark-paid':
      _handleContextMarkPaid(txnData);
      break;
    case 'skip-occurrence':
      _handleContextSkipOccurrence(txnData);
      break;
    case 'hide':
      _handleContextHide(txnData);
      break;
    case 'unhide':
      _handleContextUnhide(txnData);
      break;
    case 'inspect-data':
      _handleContextInspectData(txnData);
      break;
    case 'edit-investment-balance':
      _handleContextEditInvestmentBalance(txnData);
      break;
    case 'add-trending':
      _openAddTrendingModal(txnData.accountId);
      break;
    case 'delete-trending':
      _handleContextDeleteTrending(txnData);
      break;
    default:
      console.warn('Unknown context menu action:', action);
  }
}

// ─── Action handlers ──────────────────────────────────────────

/**
 * RC-2: Modify — open edit modal for manual transactions.
 *        For virtual BILL_FUTURE rows the modal opens pre-filled with
 *        bill data; on save the backend materializes it first, then
 *        applies the edits (handled transparently by the update route).
 */
function _handleContextModify(txnData) {
  if (typeof openEditManualTransactionModal === 'function') {
    openEditManualTransactionModal(txnData.txnId);
  } else {
    showStatus('Edit modal not available', 'error');
  }
}

/**
 * RC-3: This is a Bill — navigate to bills.html with prefill data
 */
function _handleContextThisIsABill(txnData) {
  // Find the full transaction object to get all fields
  const txn = transactions.find(findTxn => findTxn.transaction_id === txnData.txnId);

  const prefillData = {
    description: txn?.name || txnData.name || '',
    amount: Math.abs(txnData.amount),
    type: txnData.amount < 0 ? 'debit' : 'credit',
    account_id: txnData.accountId,
    user_category: txn?.user_category || txnData.userCategory || '',
    merchant_name: txn?.merchant_name || txnData.merchantName || '',
  };

  // Base64-encode the prefill data for safe URL transport
  const encoded = btoa(JSON.stringify(prefillData));

  // Mark that this bill flow originated from transactions context-menu.
  // bills.js consumes this and conditionally redirects back after create.
  sessionStorage.setItem('pf_return_to_transactions_after_bill_create', '1');
  window.location.href = `bills.html?prefill=${encoded}`;
}

/**
 * RC-4: Delete — delegates to existing deleteManualTransaction()
 */
function _handleContextDelete(txnData) {
  if (typeof deleteManualTransaction === 'function') {
    deleteManualTransaction(txnData.txnId);
  } else {
    showStatus('Delete function not available', 'error');
  }
}

/**
 * RC-5: Make Transfer — open transfer assignment modal
 */
function _handleContextMakeTransfer(txnData) {
  if (typeof openTransferAssignmentModal === 'function') {
    openTransferAssignmentModal(txnData.txnId, txnData.accountId, txnData.amount);
  } else {
    showStatus('Transfer assignment not available', 'error');
  }
}

// ─── Reconciliation quick-fix context menu handlers ─────────

/**
 * Opens the inline match picker for a missing/orphaned transaction.
 * Delegates to the reconciliation module.
 */
function _handleContextMatchToAdjacent(txnData) {
  if (typeof openInlineMatchPicker === 'function') {
    openInlineMatchPicker(txnData.txnId);
  } else {
    showStatus('Match picker not available', 'error');
  }
}

/**
 * Force-match: enters pick mode so user can click any plaid transaction
 * to force-match the orphan to. Delegates to reconciliation module.
 */
function _handleContextForceMatch(txnData) {
  if (typeof enterForceMatchPickMode === 'function') {
    enterForceMatchPickMode(txnData.txnId);
  } else {
    showStatus('Force match not available', 'error');
  }
}

/**
 * Move orphan to a manual/converted account via the account picker modal.
 */
function _handleContextMoveToAccount(txnData) {
  if (typeof openRelocateAccountPicker === 'function') {
    openRelocateAccountPicker(txnData.txnId);
  } else {
    showStatus('Move to account not available', 'error');
  }
}

/**
 * Delete a missing/orphaned transaction permanently.
 */
async function _handleContextDeleteMissing(txnData) {
  if (!confirm('Delete this transaction permanently?')) return;

  try {
    await resolveReconciliationBatch({ delete_missing: [txnData.txnId] });
    showStatus('Transaction deleted', 'success');
    _invalidateTransactionCache();
    await fetchAllTransactions(true);
    await checkAndRenderReconciliationBanner();
  } catch (deleteError) {
    showStatus(`Failed to delete transaction: ${deleteError.message}`, 'error');
  }
}

/**
 * Approve a single matched transaction — deletes the manual side,
 * the plaid row survives with all migrated metadata intact.
 */
async function _handleContextApproveMatch(txnData) {
  // For merged matched pairs, the approve target is the hidden manual
  // row's transaction_id, not the displayed plaid row's.
  const approveId = txnData.matchManualTxnId || txnData.txnId;
  try {
    await approveMatch(approveId);
    showStatus('Match approved — manual transaction removed', 'success');
    _invalidateTransactionCache();
    await fetchAllTransactions(true);
  } catch (approveError) {
    showStatus(`Failed to approve match: ${approveError.message}`, 'error');
  }
}

/**
 * Approve every matched transaction for the current user at once.
 */
async function _handleContextApproveAllMatches() {
  if (!confirm('Approve all matched transactions? This will permanently delete every manual counterpart.')) return;

  try {
    const result = await approveAllMatches();
    showStatus(`Approved ${result.approved_count} match(es)`, 'success');
    _invalidateTransactionCache();
    await fetchAllTransactions(true);
  } catch (approveError) {
    showStatus(`Failed to approve matches: ${approveError.message}`, 'error');
  }
}


// ─── Bill-future specific context menu handlers ─────────────

/**
 * Mark Paid: materializes a virtual BILL_FUTURE occurrence into a real
 * MANUAL_FUTURE row in the database. The backend handles the state
 * machine transition (BILL_FUTURE → MANUAL_FUTURE via MATERIALIZE) and
 * adds the occurrence to Bill.skipped_occurrences so the virtual slot
 * is suppressed on the next fetch.
 *
 * The row appears in-place in the scheduled block after refresh, now
 * rendered as a materialized bill-originated MANUAL_FUTURE with the 📝
 * badge instead of the greyed-out 📅 bill badge.
 */
async function _handleContextMarkPaid(txnData) {
  try {
    // The update route detects virtual IDs (bill_{id}_occ_{N}) and
    // materializes automatically. Sending an empty payload triggers
    // materialization without changing any fields.
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(txnData.txnId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to mark as paid', 'error');
      return;
    }

    showStatus('Marked as paid — occurrence materialized', 'success');
    _invalidateTransactionCache();
    await fetchAllTransactions(true);
  } catch (networkError) {
    showStatus(`Failed to mark as paid: ${networkError.message}`, 'error');
  }
}


/**
 * Skip Occurrence: adds the occurrence number to the bill's
 * skipped_occurrences list so it no longer appears in the scheduled
 * future block. Delegates to the existing skipBillOccurrence() in
 * manual-transactions.js.
 */
function _handleContextSkipOccurrence(txnData) {
  if (!txnData.billId) {
    showStatus('Cannot skip — no bill associated', 'error');
    return;
  }
  // Find the full transaction object from the cached list to get the
  // occurrence date for the skip endpoint.
  const txn = transactions.find(findTxn => findTxn.transaction_id === txnData.txnId);
  const occurrenceDate = txn?.date || '';
  if (!occurrenceDate) {
    showStatus('Cannot determine occurrence date', 'error');
    return;
  }

  if (typeof skipBillOccurrence === 'function') {
    skipBillOccurrence(txnData.billId, occurrenceDate);
  } else {
    showStatus('Skip function not available', 'error');
  }
}


// ─── Hide / Unhide handlers ──────────────────────────────────

/**
 * Hide a plaid transaction — excluded from balance and main ledger view.
 * Common use cases: reversed fees (debit + credit pair), micro-deposits,
 * hotel pre-auth holds, or contaminating transactions from plaid.
 */
async function _handleContextHide(txnData) {
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/${encodeURIComponent(txnData.txnId)}/hide`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hide: true }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to hide transaction', 'error');
      return;
    }

    showStatus('Transaction hidden', 'success');
    _patchCachedTransaction(txnData.txnId, { is_hidden: true });
    renderTransactionTable();
  } catch (networkError) {
    showStatus(`Failed to hide transaction: ${networkError.message}`, 'error');
  }
}

/**
 * Unhide a plaid transaction — restores it to balance and ledger view.
 */
async function _handleContextUnhide(txnData) {
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/${encodeURIComponent(txnData.txnId)}/hide`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hide: false }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to unhide transaction', 'error');
      return;
    }

    showStatus('Transaction unhidden', 'success');
    _patchCachedTransaction(txnData.txnId, { is_hidden: false });
    renderTransactionTable();
  } catch (networkError) {
    showStatus(`Failed to unhide transaction: ${networkError.message}`, 'error');
  }
}

// ─── Inspect Data handler ─────────────────────────────────────

/**
 * Inspect Data: opens a side-by-side view of the immutable Plaid raw
 * blob and the app's current working data for a plaid-sourced transaction.
 */
function _handleContextInspectData(txnData) {
  if (typeof openInspectDataModal === 'function') {
    openInspectDataModal(txnData.txnId);
  } else {
    showStatus('Inspect data modal not available', 'error');
  }
}

/**
 * Mark the transaction cache as stale so the next fetchAllTransactions(true)
 * pulls fresh data from the server. The cached rows are preserved in IndexedDB
 * (not deleted) — _cacheTransactions() will atomically replace them once the
 * fresh network response arrives, preventing a window where the cache is empty.
 */
function _invalidateTransactionCache() {
  // Clear cached ETag so the next fetch doesn't short-circuit with 304
  if (typeof _fetchTransactionsFromServer !== 'undefined') {
    _fetchTransactionsFromServer._cachedEtag = null;
  }
  // Mark cache as stale (age → Infinity) so _readCachedTransactions won't
  // pass the freshness check, but keep the data for interim reads.
  if (window.txnDB) {
    window.txnDB.setMeta('etag', null).catch(function() {});
    window.txnDB.setMeta('cached_at', 0).catch(function() {});
  }
}

/**
 * Batch unhide: unhides all currently selected hidden transactions.
 * Called from the batch toolbar that appears when "Show Hidden" is active.
 */
async function batchUnhideSelected() {
  const checkboxes = document.querySelectorAll('.hidden-txn-checkbox:checked');
  const transactionIds = Array.from(checkboxes).map(cb => cb.dataset.txnId);

  if (transactionIds.length === 0) {
    showStatus('No hidden transactions selected', 'error');
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/batch-unhide`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: transactionIds }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to unhide transactions', 'error');
      return;
    }

    showStatus(`Unhid ${data.unhidden_count} transaction(s)`, 'success');
    var skipped = new Set(data.skipped_ids || []);
    var unhiddenIds = transactionIds.filter(function(id) { return !skipped.has(id); });
    _patchCachedTransactions(unhiddenIds, { is_hidden: false });
    renderTransactionTable();
  } catch (networkError) {
    showStatus(`Failed to batch unhide: ${networkError.message}`, 'error');
  }
}

/**
 * Batch unhide all hidden transactions visible in current filter view.
 */
async function batchUnhideAll() {
  const checkboxes = document.querySelectorAll('.hidden-txn-checkbox');
  const transactionIds = Array.from(checkboxes).map(cb => cb.dataset.txnId);

  if (transactionIds.length === 0) {
    showStatus('No hidden transactions to unhide', 'error');
    return;
  }

  if (!confirm(`Unhide all ${transactionIds.length} hidden transaction(s)?`)) return;

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/batch-unhide`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: transactionIds }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to unhide transactions', 'error');
      return;
    }

    showStatus(`Unhid all ${data.unhidden_count} transaction(s)`, 'success');
    var skippedAll = new Set(data.skipped_ids || []);
    var unhiddenAllIds = transactionIds.filter(function(id) { return !skippedAll.has(id); });
    _patchCachedTransactions(unhiddenAllIds, { is_hidden: false });
    renderTransactionTable();
  } catch (networkError) {
    showStatus(`Failed to batch unhide: ${networkError.message}`, 'error');
  }
}


// ─── Investment trending context menu handlers ──────────────

/**
 * Edit Account Balance: opens a focused modal to edit balance_at_date
 * on a trending row. PATCH /api/transactions/<id>/investment-balance
 */
function _handleContextEditInvestmentBalance(txnData) {
  const txn = transactions.find(t => t.transaction_id === txnData.txnId);
  const currentBalance = txn?.balance_at_date ?? '';
  const txnDate = txn?.date || txnData.txnDate || '';

  // Find account name for display
  const account = accounts.find(a => a.account_id === txnData.accountId);
  const accountName = account?.name || account?.official_name || 'Account';

  // Build and show the modal
  let overlay = document.getElementById('edit-balance-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'edit-balance-modal';
    overlay.className = 'modal-overlay hidden';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="modal modal-edit-balance">
      <div class="modal-header">
        <h2>💰 Edit Account Balance</h2>
        <button class="modal-close" id="edit-balance-close">✕</button>
      </div>
      <div class="modal-body">
        <p class="edit-balance-context">
          <strong>${escapeHtml(accountName)}</strong> — ${escapeHtml(txnDate)}
        </p>
        <div class="form-group">
          <label for="edit-balance-input">Account Balance ($)</label>
          <input type="number" id="edit-balance-input" step="0.01"
                 value="${currentBalance}" placeholder="e.g. 53000.00"
                 autofocus>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary" id="edit-balance-cancel">Cancel</button>
        <button class="primary" id="edit-balance-save">Save</button>
      </div>
    </div>
  `;

  overlay.classList.remove('hidden');

  // Wire up events
  const closeModal = () => overlay.classList.add('hidden');
  document.getElementById('edit-balance-close').onclick = closeModal;
  document.getElementById('edit-balance-cancel').onclick = closeModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

  const input = document.getElementById('edit-balance-input');
  input.focus();
  input.select();

  const saveBalance = async () => {
    const newBalance = parseFloat(input.value);
    if (isNaN(newBalance)) {
      showStatus('Please enter a valid dollar amount', 'error');
      return;
    }

    try {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/${encodeURIComponent(txnData.txnId)}/investment-balance`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ balance_at_date: newBalance }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        showStatus(data.error || 'Failed to update balance', 'error');
        return;
      }

      closeModal();

      // Handle deletion response (balance set to $0 on oldest row)
      if (data.deleted) {
        _removeCachedTransaction(txnData.txnId);
        showStatus(`Trending row removed (${data.rows_deleted} row${data.rows_deleted !== 1 ? 's' : ''} deleted)`, 'success');
      } else {
        // Update the edited transaction in cache
        if (data.updated_transaction) {
          _patchCachedTransactions([txnData.txnId], data.updated_transaction);
        }
        // Update next month's transaction if recalculated
        if (data.next_month_transaction) {
          const nextId = data.next_month_transaction.transaction_id;
          _patchCachedTransactions([nextId], data.next_month_transaction);
        }
        showStatus('Account balance updated', 'success');
      }

      if (selectedAccountMode === 'single' && selectedAccountId) {
        await fetchBalanceHistory(selectedAccountId);
      }
      renderTransactionTable();
    } catch (networkError) {
      showStatus(`Failed to update balance: ${networkError.message}`, 'error');
    }
  };

  document.getElementById('edit-balance-save').onclick = saveBalance;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBalance();
    if (e.key === 'Escape') closeModal();
  });
}

/**
 * Delete a trending row via the standard manual transaction delete endpoint.
 * The backend state machine now allows DELETE on investment_trending rows.
 */
async function _handleContextDeleteTrending(txnData) {
  if (!confirm('Delete this trending row? The backend will recalculate adjacent months.')) return;

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(txnData.txnId)}`,
      { method: 'DELETE' }
    );

    if (!response.ok) {
      const data = await response.json();
      showStatus(data.error || 'Failed to delete trending row', 'error');
      return;
    }

    showStatus('Trending row deleted', 'success');
    _removeCachedTransaction(txnData.txnId);
    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
    }
    renderTransactionTable();
  } catch (networkError) {
    showStatus(`Failed to delete trending row: ${networkError.message}`, 'error');
  }
}
