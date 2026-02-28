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
    name: row.dataset.txnName || '',
    userCategory: row.dataset.userCategory || '',
    merchantName: row.dataset.merchantName || '',
  };

  const menuItems = _buildMenuItems(txnData);
  if (menuItems.length === 0) return; // no actions available for this type

  _showContextMenu(event.clientX, event.clientY, menuItems, txnData);
}

// ─── Build menu items based on transaction type ───────────────
// Visibility matrix from the implementation plan in transactions.md

function _buildMenuItems(txnData) {
  const { source, status, isBill, isSplit } = txnData;

  const isPlaid = source === 'plaid';
  const isManual = source === 'manual';
  const isPending = !!txnData.pending;
  const isScheduled = source === 'scheduled' && status === 'future';
  const isMissing = source === 'scheduled' && status === 'missing';
  const isMatched = status === 'matched';
  const isOpeningBalance = source === 'opening_balance' || source === 'manual_opening_balance';
  const isOrphaned = source === 'manual' && status === 'missing';
  const isReconciliation = source === 'reconciliation';

  // Opening balance, orphaned, reconciliation, and split children have no context menu
  if (isOpeningBalance || isOrphaned || isReconciliation || isSplit) return [];

  const items = [];

  // "Modify" — manual transactions and scheduled/bill transactions
  const showModify = isManual || (isScheduled && (isBill || !isBill));
  if (showModify) {
    items.push({
      label: '✏️ Modify',
      action: 'modify',
      separator: false,
    });
  }

  // "This is a Bill" — plaid, manual, pending, matched (NOT scheduled, missing, split, opening, orphaned)
  const showBill = isPlaid || (isManual && !isOrphaned) || isPending || isMatched;
  if (showBill) {
    items.push({
      label: '📅 This is a Bill',
      action: 'this-is-a-bill',
      separator: false,
    });
  }

  // "Make Transfer" — plaid, manual, pending, scheduled, missing, matched
  // (NOT split, opening balance, orphaned)
  const showTransfer = isPlaid || isManual || isPending || isScheduled || isMissing || isMatched;
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

  // "Delete" — manual transactions only
  if (isManual && !isOrphaned) {
    items.push({
      label: '🗑️ Delete',
      action: 'delete',
      separator: false,
      destructive: true,
    });
  }

  // Remove trailing separator if delete wasn't added
  if (items.length > 0 && !items[items.length - 1].destructive) {
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
    html += `<button class="ctx-menu-item${destructiveClass}" data-action="${item.action}">${item.label}</button>`;
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
    default:
      console.warn('Unknown context menu action:', action);
  }
}

// ─── Action handlers ──────────────────────────────────────────

/**
 * RC-2: Modify — open edit modal for manual transactions,
 *        navigate to bills.html for bill occurrences.
 */
function _handleContextModify(txnData) {
  if (txnData.isBill && txnData.billId) {
    // Bill occurrence: navigate to bills page with edit modal
    window.location.href = `bills.html?edit=${encodeURIComponent(txnData.billId)}`;
    return;
  }

  // Manual transaction (including future-dated manual txns shown in scheduled block):
  // open edit modal
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
