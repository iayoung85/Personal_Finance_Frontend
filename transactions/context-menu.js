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

  const txnData = _buildContextTxnData(row);
  if (!txnData) return;

  event.preventDefault();

  const menuItems = _buildMenuItems(txnData);
  if (menuItems.length === 0) return; // no actions available for this type

  _showContextMenu(event.clientX, event.clientY, menuItems, txnData);
}

function _buildContextTxnData(row) {
  const txnId = row.dataset.txnId || '';
  if (!txnId) return null;

  const parentTxnId = row.dataset.parentTxnId || txnId;
  const splitIndexRaw = row.dataset.splitIndex;
  const splitIndex = splitIndexRaw !== undefined && splitIndexRaw !== ''
    ? parseInt(splitIndexRaw, 10)
    : null;

  const parentTxn = transactions.find(txn => txn.transaction_id === parentTxnId)
    || transactions.find(txn => txn.transaction_id === txnId)
    || null;

  let localTransaction = parentTxn;
  let relatedData = null;
  let relatedTitle = '';

  if (Number.isInteger(splitIndex)) {
    const splitTxn = parentTxn?.splits?.[splitIndex];
    if (!splitTxn) return null;
    localTransaction = splitTxn;
    relatedData = parentTxn;
    relatedTitle = 'Parent Transaction';
  }

  const fallbackTxn = localTransaction || parentTxn || {};

  return {
    txnId,
    source: row.dataset.source || fallbackTxn.source || '',
    status: row.dataset.status || fallbackTxn.status || '',
    pending: row.dataset.pending
      ? row.dataset.pending === 'true'
      : !!(fallbackTxn.pending || parentTxn?.pending),
    isBill: row.dataset.isBill
      ? row.dataset.isBill === 'true'
      : !!(fallbackTxn.is_bill || parentTxn?.is_bill),
    billId: row.dataset.billId || fallbackTxn.bill_id || parentTxn?.bill_id || '',
    accountId: row.dataset.accountId
      || fallbackTxn.account_id
      || parentTxn?.account_id
      || fallbackTxn.plaid_account_id
      || parentTxn?.plaid_account_id
      || '',
    amount: row.dataset.amount !== undefined && row.dataset.amount !== ''
      ? (parseFloat(row.dataset.amount) || 0)
      : (fallbackTxn.amount || 0),
    isSplit: row.dataset.isSplit === 'true' || !!parentTxn?.is_split,
    isSplitChild: Number.isInteger(splitIndex),
    splitIndex,
    name: row.dataset.txnDescription
      || fallbackTxn.description
      || fallbackTxn.name
      || parentTxn?.description
      || parentTxn?.name
      || '',
    userCategory: row.dataset.userCategory || fallbackTxn.user_category || parentTxn?.user_category || '',
    merchantName: row.dataset.merchantName || fallbackTxn.merchant_name || parentTxn?.merchant_name || '',
    matchManualTxnId: row.dataset.matchManualTxnId || parentTxn?.match_info?.matched_txn_id || '',
    isHidden: row.dataset.isHidden
      ? row.dataset.isHidden === 'true'
      : !!(fallbackTxn.is_hidden || parentTxn?.is_hidden),
    txnDate: row.dataset.txnDate || fallbackTxn.date || parentTxn?.date || '',
    localTransaction,
    parentTransaction: parentTxn,
    relatedData,
    relatedTitle,
  };
}

function _appendInspectMenuItem(items, txnData) {
  if (!txnData?.localTransaction && !txnData?.relatedData) {
    return items;
  }

  if (items.length > 0) {
    items[items.length - 1].separator = true;
  }

  items.push({
    label: '🔍 Inspect Data',
    action: 'inspect-data',
    separator: false,
  });

  return items;
}

// ─── Build menu items based on transaction type ───────────────
// Visibility matrix from the implementation plan in transactions.md

function _buildMenuItems(txnData) {
  const { isBill, isSplit } = txnData;

  if (isSplit) {
    return _appendInspectMenuItem([], txnData);
  }

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

  // Opening balance and reconciliation rows remain non-actionable.
  if (isOpeningBalance || isReconciliation) return [];

  const items = [];

  // Investment trending rows: Edit Account Balance + Add new trending
  if (isInvestmentTrending) {
    const account = accounts.find(a => a.account_id === txnData.accountId);
    const isLinked = account && account.connection_status === 'linked';
    const txnMonth = (txnData.txnDate || '').slice(0, 7);
    const currentMonth = toISODateStr(new Date()).slice(0, 7);
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
    return _appendInspectMenuItem(items, txnData);
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
    return _appendInspectMenuItem(items, txnData);
  }

  // Missing transactions get similar quick-fix options
  if (isMissing) {
    // Show "Mark Paid/Received" for BILL_MISSING rows in accounts that
    // don't accumulate plaid transactions. The only accounts where we
    // block this action are linked non-investment accounts — those get
    // regular plaid transaction syncs so the user should match instead.
    if (txnType === TXN_TYPE.BILL_MISSING) {
      const acct = accounts.find(findAcct => findAcct.account_id === txnData.accountId);
      const isLinkedNonInvestment = acct
        && acct.connection_status === 'linked'
        && acct.plaid_type !== 'investment';
      if (!isLinkedNonInvestment) {
        const markPaidLabel = txnData.amount < 0 ? '✅ Mark Paid' : '✅ Mark Received';
        items.push({
          label: markPaidLabel,
          action: 'mark-paid-missing',
          separator: false,
        });
      }
    }
    items.push({
      label: '✏️ Modify',
      action: 'modify',
      separator: false,
    });
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
    return _appendInspectMenuItem(items, txnData);
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
    items.push({
      label: '🔍 Inspect Match',
      action: 'inspect-match',
      separator: false,
    });
    return _appendInspectMenuItem(items, txnData);
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
      label: '📋 Edit Schedule',
      action: 'edit-schedule',
      separator: false,
    });
    items.push({
      label: '⏭ Skip Occurrence',
      action: 'skip-occurrence',
      separator: false,
      destructive: true,
    });
    return _appendInspectMenuItem(items, txnData);
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

  _appendInspectMenuItem(items, txnData);

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
    case 'mark-paid-missing':
      _handleContextMarkPaidMissing(txnData);
      break;
    case 'skip-occurrence':
      _handleContextSkipOccurrence(txnData);
      break;
    case 'edit-schedule':
      _handleContextEditSchedule(txnData);
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
    case 'inspect-match':
      _handleContextInspectMatch(txnData);
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
 * RC-3: This is a Bill — open inline bill modal with transaction data pre-filled.
 * Replaces the old page-navigation flow (bills.html?prefill=…).
 */
function _handleContextThisIsABill(txnData) {
  const txn = transactions.find(findTxn => findTxn.transaction_id === txnData.txnId);

  const prefillData = {
    description: txn?.name || txnData.name || '',
    amount: Math.abs(txnData.amount),
    type: txnData.amount < 0 ? 'debit' : 'credit',
    account_id: txnData.accountId,
    user_category: txn?.user_category || txnData.userCategory || '',
    merchant_name: txn?.merchant_name || txnData.merchantName || '',
    match_description: txn?.name || txnData.name || '',
  };

  _openInlineBillModal(null, { prefill: prefillData });
}

/**
 * Edit Schedule — fetch the bill and open the inline bill modal in edit mode.
 * Used for BILL_FUTURE rows that have a bill_id.
 */
async function _handleContextEditSchedule(txnData) {
  if (!txnData.billId) {
    showStatus('No bill schedule found for this transaction', 'error');
    return;
  }

  try {
    showStatus('Loading bill schedule…', 'info');
    const bill = await fetchBill(txnData.billId);
    clearStatus();
    _openInlineBillModal(txnData.billId, { bill });
  } catch (fetchError) {
    showStatus(`Failed to load bill: ${fetchError.message}`, 'error');
  }
}

/**
 * Shared helper: build accounts list for the bill modal and open it.
 * Converts the transactions-page `accounts` array shape to the
 * {account_id, display_name} format that bills/modal.js expects.
 */
function _openInlineBillModal(billId, extraOptions) {
  const billModalAccounts = accounts
    .filter(acct => !acct.is_archived)
    .map(acct => ({
      account_id: acct.account_id,
      display_name: acct.bank_name
        ? `${acct.bank_name} - ${acct.custom_name || acct.account_name || 'Account'} (${acct.mask || '****'})`
        : `${acct.custom_name || acct.account_name || 'Account'} (${acct.mask || '****'})`,
    }));

  openBillModal(billId, Object.assign({
    accounts: billModalAccounts,
    categories: availableCategories,
    onSave: (result) => {
      // Granular Dexie cache update using the virtual transaction data
      // returned by the bill CRUD endpoints.
      const purgedIds = result.purged_virtual_ids || [];
      const newVirtuals = result.affected_virtual_transactions || [];

      purgedIds.forEach(virtualId => _removeCachedTransaction(virtualId));
      newVirtuals.forEach(virtualTxn => _replaceCachedTransaction(virtualTxn.transaction_id, virtualTxn));

      // Wipe the ETag so the next background refresh gets a full sync,
      // but keep cached_at so Tier-1 cache still serves the patched data.
      if (window.txnDB) {
        window.txnDB.setMeta('etag', null).catch(() => {});
      }

      renderTransactionTable();
    },
  }, extraOptions));
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
    await refreshAccountTransactions(txnData.accountId);
    await checkAndRenderReconciliationBanner();
  } catch (deleteError) {
    showStatus(`Failed to delete transaction: ${deleteError.message}`, 'error');
  }
}

/**
 * Mark a BILL_MISSING row as paid in an offline or transitioned account.
 * Transitions BILL_MISSING → MANUAL_CLEARED via the resolve_missing
 * endpoint with action='keep'.
 */
async function _handleContextMarkPaidMissing(txnData) {
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/resolve_missing/${encodeURIComponent(txnData.txnId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'keep' }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to mark as paid', 'error');
      return;
    }

    const paidLabel = txnData.amount < 0 ? 'paid' : 'received';
    showStatus(`Bill marked as ${paidLabel}`, 'success');
    await refreshAccountTransactions(txnData.accountId);
  } catch (networkError) {
    showStatus(`Failed to mark as paid: ${networkError.message}`, 'error');
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
    await refreshAccountTransactions(txnData.accountId);
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
    await refreshAccountTransactions(txnData.accountId);
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
    openInspectDataModal(txnData);
  } else {
    showStatus('Inspect data modal not available', 'error');
  }
}

/**
 * Inspect Match — side-by-side comparison of the displayed Plaid row
 * and the hidden matched manual/scheduled counterpart.
 * Both datasets are already in the frontend transactions array.
 */
function _handleContextInspectMatch(txnData) {
  if (typeof openInspectDataModal !== 'function') {
    showStatus('Inspect data modal not available', 'error');
    return;
  }

  const matchedTxnId = txnData.matchManualTxnId;
  if (!matchedTxnId) {
    showStatus('No matched counterpart found for this transaction', 'error');
    return;
  }

  const matchedTxn = transactions.find(txn => txn.transaction_id === matchedTxnId);
  if (!matchedTxn) {
    showStatus('Matched transaction not found in local data', 'error');
    return;
  }

  const sourceLabel = matchedTxn.source === 'scheduled'
    ? 'Matched Scheduled Transaction'
    : 'Matched Manual Transaction';

  openInspectDataModal({
    ...txnData,
    relatedData: matchedTxn,
    relatedTitle: sourceLabel,
    forceLocal: true,
  });
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
        // Update the edited transaction in cache.
        // Backend returns amount/balance_at_date as strings — coerce to
        // numbers so downstream arithmetic (runningProjected += txn.amount)
        // doesn't silently switch to string concatenation.
        if (data.updated_transaction) {
          const coerced = { ...data.updated_transaction };
          if (coerced.amount != null) coerced.amount = parseFloat(coerced.amount);
          if (coerced.balance_at_date != null) coerced.balance_at_date = parseFloat(coerced.balance_at_date);
          _patchCachedTransactions([txnData.txnId], coerced);
        }
        // Update next month's transaction if recalculated
        if (data.next_month_transaction) {
          const nextCoerced = { ...data.next_month_transaction };
          if (nextCoerced.amount != null) nextCoerced.amount = parseFloat(nextCoerced.amount);
          if (nextCoerced.balance_at_date != null) nextCoerced.balance_at_date = parseFloat(nextCoerced.balance_at_date);
          const nextId = nextCoerced.transaction_id;
          _patchCachedTransactions([nextId], nextCoerced);
        }
        showStatus('Account balance updated', 'success');
      }

      // Invalidate transaction cache so next page load fetches fresh
      // data instead of serving stale ETag-based 304 responses.
      _invalidateTransactionCache();

      if (selectedAccountMode === 'single' && selectedAccountId) {
        await fetchBalanceHistory(selectedAccountId);
      }
      renderTransactionTable();

      // Refresh sidebar balances — backend may have recalculated current_balance
      await loadAccounts();
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
