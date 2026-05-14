// ============================================================
// transactions/table-renderer.js — Transaction Table Rendering
// Builds the filtered, sorted HTML table of transactions
// including split-group rendering and memo save.
// ============================================================


/**
 * Build the inner HTML for a merchant logo cell. Uses native lazy loading
 * so the browser only fetches logos as they scroll into view.
 * Falls back to a generic category icon derived from the transaction's
 * primary personal_finance_category, or a neutral placeholder.
 */
function _renderLogoCell(txn) {
  const logoUrl = txn.logo_url;
  if (logoUrl) {
    return `<img class="merchant-logo" src="${escapeHtml(logoUrl)}" alt="" width="24" height="24" loading="lazy" decoding="async" onerror="this.replaceWith(document.createTextNode('${_logoFallbackChar(txn)}'))">`;
  }
  return `<span class="merchant-logo-fallback">${_logoFallbackChar(txn)}</span>`;
}

/**
 * Pick a single-character fallback icon based on the transaction's primary
 * personal_finance_category. Keeps the column visually consistent even
 * when no logo URL is available.
 */
function _logoFallbackChar(txn) {
  const primary = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
  switch (primary) {
    case 'FOOD_AND_DRINK':        return '🍽';
    case 'TRANSPORTATION':        return '🚗';
    case 'TRAVEL':                return '✈';
    case 'ENTERTAINMENT':         return '🎬';
    case 'MEDICAL':
    case 'HEALTHCARE':            return '🏥';
    case 'INCOME':                return '💰';
    case 'TRANSFER_IN':
    case 'TRANSFER_OUT':          return '⇄';
    case 'LOAN_PAYMENTS':         return '🏦';
    case 'RENT_AND_UTILITIES':    return '🏠';
    case 'GENERAL_MERCHANDISE':   return '🛒';
    case 'PERSONAL_CARE':         return '💇';
    case 'GENERAL_SERVICES':      return '🔧';
    case 'GOVERNMENT_AND_NON_PROFIT': return '🏛';
    case 'HOME_IMPROVEMENT':      return '🔨';
    case 'BANK_FEES':             return '🏧';
    default:                      return '○';
  }
}

async function _markSingleTransactionReviewed(transactionId) {
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/mark_reviewed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: [transactionId] }),
      }
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to mark reviewed');

    const txn = transactions.find(t => t.transaction_id === transactionId);
    if (txn) txn.reviewed = true;
    _cacheTransactions(transactions);
    renderTransactionTable();
    renderAccountsSidebar();
  } catch (reviewError) {
    showStatus(`Failed to mark reviewed: ${reviewError.message}`, 'error');
  }
}

/**
 * Build a child transaction object suitable for existing search helpers.
 * Child values override parent values while inheriting missing fields.
 */
function _buildSplitSearchCandidate(parentTxn, splitTxn) {
  return {
    ...parentTxn,
    ...splitTxn,
    bank_account: splitTxn.bank_account || parentTxn.bank_account || '',
  };
}

/**
 * Check whether a split child matches the active text search.
 */
function _splitMatchesSearch(parentTxn, splitTxn) {
  if (!searchTokens || searchTokens.length === 0) return true;
  const splitCandidate = _buildSplitSearchCandidate(parentTxn, splitTxn);
  return transactionMatchesSearch(splitCandidate, searchTokens);
}

/**
 * Check whether a split child matches active category filters.
 */
function _splitMatchesCategoryFilter(splitTxn) {
  if (!filterPrimaryCategory && !filterDetailedCategory) return true;

  const splitCategoryStr = splitTxn.user_category
    || (splitTxn.personal_finance_category
      ? `${splitTxn.personal_finance_category.primary || ''}${splitTxn.personal_finance_category.detailed ? ': ' + splitTxn.personal_finance_category.detailed : ''}`
      : '');

  const parsed = parseCategoryString(splitCategoryStr);
  if (filterPrimaryCategory && parsed.primary !== filterPrimaryCategory) return false;
  if (filterDetailedCategory && parsed.detailed !== filterDetailedCategory) return false;
  return true;
}

function _isUnmatchedPlaidLedgerRow(txn) {
  const txnType = getTransactionType(txn);
  return (txnType === TXN_TYPE.PLAID_CLEARED || txnType === TXN_TYPE.PLAID_PENDING)
    && !txn.match_info
    && !txn.matched_transaction_id;
}


// ── Virtual Scroll Engine ──────────────────────────────────────
// Only the rows visible in the viewport (plus a buffer) are rendered
// to the DOM. This eliminates the ~550ms browser parse/layout cost
// of dumping 10k+ <tr> nodes via innerHTML in one shot.
const VIRTUAL_ROW_HEIGHT = 44;
const VIRTUAL_BUFFER_ROWS = 30;

let _virtualRows = [];
let _virtualRowDates = [];
let _virtualHeaderHtml = '';
let _virtualColCount = 0;
let _virtualScrollBound = false;
let _virtualScrollRaf = 0;
let _lastRenderedRange = { start: -1, end: -1 };
let _lastRenderedScrollCacheKey = null;

function _resetVirtualScrollData() {
  _virtualRows = [];
  _virtualRowDates = [];
  _virtualHeaderHtml = '';
  _virtualColCount = 0;
  _lastRenderedRange = { start: -1, end: -1 };
}

// Scroll-date tooltip: follows the cursor and shows "Mon YYYY" while scrolling
let _scrollBubbleTimer = null;
let _lastMouseY = 0;
let _mouseTrackingBound = false;
const _MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function _getOrCreateScrollBubble() {
  let bubble = document.getElementById('scroll-date-bubble');
  if (!bubble) {
    bubble = document.createElement('div');
    bubble.id = 'scroll-date-bubble';
    bubble.className = 'scroll-date-bubble';
    document.body.appendChild(bubble);
  }
  return bubble;
}

function _bindMouseTracking() {
  if (_mouseTrackingBound) return;
  const pane = document.querySelector('.transaction-scroll-pane');
  if (!pane) return;
  pane.addEventListener('mousemove', (event) => { _lastMouseY = event.clientY; }, { passive: true });
  _mouseTrackingBound = true;
}

function _showScrollDateBubble(scrollTop) {
  if (!_virtualRowDates.length) return;
  const rowIndex = Math.min(
    Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT),
    _virtualRowDates.length - 1
  );
  // Walk forward from the computed row to find the nearest row with a date
  // (separator rows have null dates).
  let dateStr = null;
  for (let scanIndex = rowIndex; scanIndex < _virtualRowDates.length; scanIndex++) {
    if (_virtualRowDates[scanIndex]) { dateStr = _virtualRowDates[scanIndex]; break; }
  }
  if (!dateStr) {
    for (let scanIndex = rowIndex - 1; scanIndex >= 0; scanIndex--) {
      if (_virtualRowDates[scanIndex]) { dateStr = _virtualRowDates[scanIndex]; break; }
    }
  }
  if (!dateStr) return;

  const year = dateStr.slice(0, 4);
  const monthIndex = parseInt(dateStr.slice(5, 7), 10) - 1;
  const label = `${_MONTH_SHORT[monthIndex]} ${year}`;

  const bubble = _getOrCreateScrollBubble();
  bubble.textContent = label;

  // Position to the left of the scrollbar, at the cursor's Y level
  const pane = document.querySelector('.transaction-scroll-pane');
  if (pane) {
    const paneRect = pane.getBoundingClientRect();
    bubble.style.top = `${_lastMouseY}px`;
    bubble.style.left = `${paneRect.right - 80}px`;
  }

  bubble.classList.add('visible');

  if (_scrollBubbleTimer) clearTimeout(_scrollBubbleTimer);
  _scrollBubbleTimer = setTimeout(() => {
    bubble.classList.remove('visible');
    _scrollBubbleTimer = null;
  }, 1200);
}



/**
 * Render only the rows visible in the current scroll viewport plus a buffer.
 * On first call (no existing <table>), builds the full table structure.
 * On subsequent calls (scroll), updates only the <tbody> content so the
 * sticky <thead> stays stable and column widths don't flicker.
 */
function _renderVisibleWindow(container) {
  if (!_virtualRows.length) {
    container.innerHTML = '<div class="empty-state">No transactions found for the selected criteria.</div>';
    return;
  }

  const scrollPane = document.querySelector('.transaction-scroll-pane');
  const scrollTop = scrollPane ? scrollPane.scrollTop : 0;
  const viewportHeight = scrollPane ? scrollPane.clientHeight : 800;

  const totalRows = _virtualRows.length;
  const startRow = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_BUFFER_ROWS);
  const visibleCount = Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT);
  const endRow = Math.min(totalRows, startRow + visibleCount + VIRTUAL_BUFFER_ROWS * 2);

  if (startRow === _lastRenderedRange.start && endRow === _lastRenderedRange.end) return;
  _lastRenderedRange = { start: startRow, end: endRow };

  const topSpacerH = startRow * VIRTUAL_ROW_HEIGHT;
  const bottomSpacerH = Math.max(0, (totalRows - endRow) * VIRTUAL_ROW_HEIGHT);

  let bodyHtml = '';
  if (topSpacerH > 0) {
    bodyHtml += `<tr class="virtual-spacer"><td colspan="${_virtualColCount}" style="height:${topSpacerH}px"></td></tr>`;
  }
  for (let rowIndex = startRow; rowIndex < endRow; rowIndex++) {
    const entry = _virtualRows[rowIndex];
    if (typeof entry === 'string') {
      bodyHtml += entry;
    } else {
      if (entry.html === null) {
        let html = entry.fn();
        if (entry.even) {
          if (html.indexOf('<tr class="') !== -1) {
            html = html.replace('<tr class="', '<tr class="vrow-even ');
          } else {
            html = html.replace('<tr ', '<tr class="vrow-even" ');
          }
        }
        entry.html = html;
        entry.fn = null;
      }
      bodyHtml += entry.html;
    }
  }
  if (bottomSpacerH > 0) {
    bodyHtml += `<tr class="virtual-spacer"><td colspan="${_virtualColCount}" style="height:${bottomSpacerH}px"></td></tr>`;
  }

  const existingTable = container.querySelector('table');
  if (existingTable) {
    const tbody = existingTable.querySelector('tbody');
    if (tbody) {
      tbody.innerHTML = bodyHtml;
      return;
    }
  }
  container.innerHTML = _virtualHeaderHtml + '<tbody>' + bodyHtml + '</tbody></table>';
}

/**
 * Scroll handler — coalesces rapid scroll events via requestAnimationFrame
 * so we repaint at most once per frame (~16ms).
 */
function _onVirtualScroll() {
  if (_virtualScrollRaf) return;
  _virtualScrollRaf = requestAnimationFrame(() => {
    _virtualScrollRaf = 0;
    const container = document.getElementById('table-container');
    if (!container || !_virtualRows.length) return;
    _renderVisibleWindow(container);
    const scrollPane = document.querySelector('.transaction-scroll-pane');
    if (scrollPane) {
      _saveScrollPosition();
      _showScrollDateBubble(scrollPane.scrollTop);
    }
  });
}


// Cached currency formatters — Intl.NumberFormat construction is expensive
// (~0.5-2ms each). Reusing a single instance per currency across 3000+ rows
// eliminates thousands of redundant locale-resolution calls.
const _currencyFormatCache = {};
function _fmtCurrency(value, currencyCode) {
  const code = currencyCode || 'USD';
  if (!_currencyFormatCache[code]) {
    _currencyFormatCache[code] = new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
  }
  return _currencyFormatCache[code].format(value);
}

/**
 * Snapshot the current scroll position so it can be restored when the
 * user returns to this account/view later in the same session.
 */
function _getScrollPositionCacheKey() {
  return selectedAccountId || 'all';
}

function _hasSavedScrollPosition(cacheKey) {
  return Object.prototype.hasOwnProperty.call(_scrollPositionCache, cacheKey);
}

function _saveScrollPosition() {
  const scrollPane = document.querySelector('.transaction-scroll-pane');
  if (!scrollPane) return;
  const container = document.getElementById('table-container');
  if (!container || !container.querySelector('table')) return;
  const cacheKey = _getScrollPositionCacheKey();
  _scrollPositionCache[cacheKey] = scrollPane.scrollTop;
}

function renderTransactionTable() {
  const container = document.getElementById('table-container');
  const scrollPane = document.querySelector('.transaction-scroll-pane');
  const scrollCacheKey = _getScrollPositionCacheKey();
  const hasExistingVirtualTable = !!(container && container.querySelector('table'));
  const shouldPreserveLiveScroll = !!(
    scrollPane
    && hasExistingVirtualTable
    && _lastRenderedScrollCacheKey === scrollCacheKey
  );
  const preservedScrollTop = shouldPreserveLiveScroll ? scrollPane.scrollTop : null;

  if (shouldPreserveLiveScroll) {
    _scrollPositionCache[scrollCacheKey] = preservedScrollTop;
  }
  
  if (transactions.length === 0) {
    visibleTransactions = [];
    _resetVirtualScrollData();
    container.innerHTML = '<div class="empty-state">No transactions found. Sync transactions first.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    document.getElementById('pending-table-container').innerHTML = '';
    renderInsightsPanel(); // Still render empty insights
    _lastRenderedScrollCacheKey = scrollCacheKey;
    return;
  }

  // Get all filter criteria from UI
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingEnabled = document.getElementById('show-pending-toggle').checked;
  const hideTransfers = document.getElementById('hide-transfers').checked;
  const showHiddenEnabled = document.getElementById('show-hidden-toggle').checked;
  const showUnmatchedOnlyEnabled = document.getElementById('show-unmatched-toggle')?.checked;
  
  // Get selected optional fields
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });
  
  // Apply all filters to transactions array
  const filteredTransactions = transactions.filter(txn => {
    // Filter by date range
    if (txn.date < startDate || txn.date > endDate) {
      return false;
    }
    
    // Filter by selected accounts
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.account_id || txn.plaid_account_id)) {
      return false;
    }
    
    // Filter pending transactions — always exclude pending from main filter
    // pass. Pending txns are handled separately below when showPending is on.
    if (txn.pending && !showPendingEnabled) {
      return false;
    }

    // Filter hidden transactions — excluded by default, visible when toggle is on
    if (txn.is_hidden && !showHiddenEnabled) {
      return false;
    }

    // Hide transfers if requested based only on user-assigned transfer
    // category notation: [AccountName]
    if (hideTransfers) {
      if (isTransferCategory(txn.user_category)) {
        return false;
      }
    }

    // Filter by overrides only if requested
    const showOverridesOnly = document.getElementById('show-overrides-only').checked;
    if (showOverridesOnly && !txn.is_override) {
      return false;
    }

    // Narrow the ledger to only unmatched plaid rows when reconciliation
    // review mode is active. This is intentionally table-only.
    if (showUnmatchedOnlyEnabled && !_isUnmatchedPlaidLedgerRow(txn)) {
      return false;
    }
    
    // Filter by search query (broad text + advanced operators)
    if (searchTokens && searchTokens.length > 0) {
      if (txn.is_split && Array.isArray(txn.splits) && txn.splits.length > 0) {
        const parentMatchesSearch = transactionMatchesSearch(txn, searchTokens);
        const anySplitMatchesSearch = txn.splits.some(split => _splitMatchesSearch(txn, split));
        if (!parentMatchesSearch && !anySplitMatchesSearch) {
          return false;
        }
      } else if (!transactionMatchesSearch(txn, searchTokens)) {
        return false;
      }
    }

    // Filter by category (primary and/or detailed)
    if (filterPrimaryCategory || filterDetailedCategory) {
      // For split transactions, check if any split child matches the filter
      if (txn.is_split && txn.splits && txn.splits.length > 0) {
        // Check if at least one split child matches the category filter
        const hasMatchingSplit = txn.splits.some(split => _splitMatchesCategoryFilter(split));
        
        // Only include the split group if at least one child matches
        if (!hasMatchingSplit) {
          return false;
        }
      } else {
        // For non-split transactions, check parent transaction's user_category
        const parsed = parseCategoryString(txn.user_category || '');
        
        // If primary filter is set, check if it matches
        if (filterPrimaryCategory && parsed.primary !== filterPrimaryCategory) {
          return false;
        }
        
        // If detailed filter is set, check if it matches
        if (filterDetailedCategory && parsed.detailed !== filterDetailedCategory) {
          return false;
        }
      }
    }
    
    return true;
  });
  
  if (filteredTransactions.length === 0) {
    visibleTransactions = [];
    _resetVirtualScrollData();
    container.innerHTML = '<div class="empty-state">No transactions found for the selected criteria.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    document.getElementById('pending-table-container').innerHTML = '';
    renderCategorySummaryModal();
    renderInsightsPanel(); // Still render empty insights
    _lastRenderedScrollCacheKey = scrollCacheKey;
    return;
  }

  visibleTransactions = filteredTransactions;
  
  // Separate transactions into blocks per blueprint structure:
  // 1. Scheduled future (source='scheduled', status='future')
  // 2. Pending (pending=true)
  // 3. Cleared/posted (everything else, including BILL_MISSING and MANUAL_MISSING inline)
  // MANUAL_ORPHANED is excluded entirely — only accessible via Resolution Center.
  // In All Accounts view: hide OB, MOB, reconciliation
  const isAllAccounts = selectedAccountMode === 'all';

  const scheduledFuture = [];
  const pendingTransactions = [];
  const postedTransactions = [];

  // Today in YYYY-MM-DD for comparing against txn.date strings
  const _todayDateStr = _formatDateLocal(new Date());

  // Scroll anchor: on initial load show only the 10 nearest future rows
  // instead of the furthest-out projections at the very top.
  const FUTURE_ROWS_TO_SHOW = 7;
  let _futureSeparatorRowIndex = -1;

  filteredTransactions.forEach(txn => {
    // Matched manual/scheduled rows are merged into their plaid
    // counterpart by the backend — skip them entirely.
    if (txn.hidden_by_match) return;

    // Suggested manual missing rows are hidden in favor of the plaid
    // row which carries suggestion_info (yellow badge).
    if (txn.hidden_by_suggestion) return;

    // All Accounts view: hide system rows always
    if (isAllAccounts) {
      const txnType = getTransactionType(txn);
      if (isSystemType(txnType)) return;
    }

    const txnType = getTransactionType(txn);
    // Orphaned transactions are excluded from the ledger entirely —
    // they are only accessible via the Resolution Center after re-link events.
    if (txnType === TXN_TYPE.MANUAL_ORPHANED) return;

    if (txn.source === 'scheduled' && txn.status === 'future') {
      scheduledFuture.push(txn);
    } else if (txn.pending) {
      pendingTransactions.push(txn);
    } else if (txnType === TXN_TYPE.MANUAL_FUTURE) {
      // Manual transactions with future dates belong above the scheduled
      // separator — they are effectively user-created scheduled entries
      // until their date arrives.
      scheduledFuture.push(txn);
    } else {
      postedTransactions.push(txn);
    }
  });
  
  // For transfers in all-accounts view, sort by the older of the two dates
  // so both sides of a transfer cluster together chronologically.
  // In single-account view, use the transaction's own date (already correct).
  const _transferSortDate = (txn) => {
    if (!isAllAccounts || !txn.transfer_pair_id || !txn.transfer_partner_date) {
      return txn.date;
    }
    return txn.date < txn.transfer_partner_date ? txn.date : txn.transfer_partner_date;
  };

  // Sort helper: date descending, then anchor priority descending (so anchor
  // rows sink to the bottom of their day group — matching balance engine's
  // ASC order where anchors sort first), then transaction ID descending.
  // Mirrors backend: (date ASC, anchor_priority ASC, txn_id ASC) reversed.
  const sortNewestFirst = (rowA, rowB) => {
    const dateComparison = _transferSortDate(rowB).localeCompare(_transferSortDate(rowA));
    if (dateComparison !== 0) return dateComparison;
    const priorityA = anchorSortPriority(rowA.source, rowA.status);
    const priorityB = anchorSortPriority(rowB.source, rowB.status);
    if (priorityA !== priorityB) return priorityB - priorityA;
    const idA = rowA.transaction_id || '';
    const idB = rowB.transaction_id || '';
    return idB.localeCompare(idA);
  };

  // Scheduled future: furthest date at top (descending order) — agrees with the
  // overall table sort direction where oldest rows sink to the bottom.
  scheduledFuture.sort((rowA, rowB) => {
    const dateComp = rowB.date.localeCompare(rowA.date);
    if (dateComp !== 0) return dateComp;
    return (rowB.transaction_id || '').localeCompare(rowA.transaction_id || '');
  });
  postedTransactions.sort(sortNewestFirst);
  pendingTransactions.sort(sortNewestFirst);
  
  // Compute projected ledger balances for pending transactions.
  // Pending txns are excluded from backend balance history, so we project
  // forward from the account's current_balance (which reflects all posted txns).
  const pendingLedgerLookup = {};
  const scheduledLedgerLookup = {};
  const showLedgerColumn = selectedAccountMode === 'single' && selectedAccountId;
  // BILL_MISSING / MANUAL_MISSING rows only show N/A when the account is
  // Plaid-linked and non-investment: Plaid owns balance tracking there and
  // missing rows are excluded from the ledger walk. For offline and
  // investment accounts the backend DOES walk them, so look up normally.
  let isLinkedNonInvestmentAccount = false;
  if (showLedgerColumn) {
    const _ledgerAcct = accounts.find(a => a.account_id === selectedAccountId);
    isLinkedNonInvestmentAccount = !!_ledgerAcct
      && _ledgerAcct.connection_status === 'linked'
      && _ledgerAcct.account_category !== 'investment';
  }
  
  if (showLedgerColumn) {
    const selectedAccount = accounts.find(account => account.account_id === selectedAccountId);

    // Use the freshest running balance available. After a surgical balance-history
    // patch (saveManualTransaction, deleteManualTransaction, mark-paid, etc.),
    // balanceHistoryLookup is updated immediately but selectedAccount.current_balance
    // is still stale — loadAccounts() hasn't resolved yet. Seeding from the most
    // recent posted row's lookup value means future projections immediately reflect
    // the mutation without waiting for an account reload.
    let currentPostedBalance = parseFloat(selectedAccount ? (selectedAccount.current_balance || 0) : 0);
    for (const postedTxn of postedTransactions) {
      // postedTransactions is sorted newest-first; the first match is the most
      // recent posted row, whose running_balance equals the current posted balance.
      if (balanceHistoryLookup[postedTxn.transaction_id] !== undefined) {
        currentPostedBalance = balanceHistoryLookup[postedTxn.transaction_id];
        break;
      }
    }

    // Phase 1: pending transactions projected from current posted balance
    let runningProjected = currentPostedBalance;
    if (pendingTransactions.length > 0) {
      const pendingAscending = [...pendingTransactions].reverse();
      pendingAscending.forEach(txn => {
        runningProjected += txn.amount;
        const lookupKey = txn.transaction_id;
        if (lookupKey) {
          pendingLedgerLookup[lookupKey] = runningProjected;
        }
      });
    }

    // Phase 2: scheduled future transactions projected from the
    // running balance that already incorporates all pending items.
    // Walk in date ascending order (the array is sorted date descending,
    // so reverse it) to accumulate balances chronologically.
    if (scheduledFuture.length > 0) {
      const scheduledAscending = [...scheduledFuture].reverse();
      scheduledAscending.forEach(txn => {
        runningProjected += txn.amount;
        const lookupKey = txn.transaction_id;
        if (lookupKey) {
          scheduledLedgerLookup[lookupKey] = runningProjected;
        }
      });
    }
  }
  
  // Build the combined rendering list following the blueprint block order:
  // scheduled future → pending → cleared/posted (missing rows inline with posted)
  const hasPendingToShow = showPendingEnabled && pendingTransactions.length > 0;
  const hasScheduledToShow = scheduledFuture.length > 0;
  const showBankAccountColumn = selectedAccountMode === 'all';

  const allRowTransactions = [
    ...scheduledFuture,
    ...(hasPendingToShow ? pendingTransactions : []),
    ...postedTransactions,
  ];
  // Block boundary tracking flags
  let scheduledSectionEnded = !hasScheduledToShow;
  let pendingSectionEnded = !hasPendingToShow;
  
  const showLogoColumn = optionalFields.includes('merchant_logo');
  const bulkEditActive = bulkEditState.active;

  _virtualHeaderHtml = '<table><thead><tr>';
  if (bulkEditActive) {
    const selectedCount = bulkEditState.selectedIds.size;
    const visibleEligible = (typeof getBulkEligibleVisibleIds === 'function')
      ? getBulkEligibleVisibleIds()
      : [];
    const allVisibleSelected = visibleEligible.length > 0
      && visibleEligible.every(id => bulkEditState.selectedIds.has(id));
    _virtualHeaderHtml += `<th class="th-bulk-select" style="width: 42px;">`
      + `<input type="checkbox" class="bulk-select-all-checkbox" title="Select all visible"${allVisibleSelected ? ' checked' : ''}>`
      + `<span id="bulk-selected-count" class="bulk-selected-count">${selectedCount} selected</span>`
      + `</th>`;
  }
  if (showLogoColumn) {
    _virtualHeaderHtml += '<th class="th-logo" style="width: 36px;"></th>';
  }
  _virtualHeaderHtml += '<th class="th-date">Date</th>';
  if (showBankAccountColumn) {
    _virtualHeaderHtml += '<th>Bank/Account</th>';
  }
  _virtualHeaderHtml += '<th class="th-description">Description</th>';
  
  _virtualHeaderHtml += '<th class="th-category">Category</th>';
  if (optionalFields.includes('source')) _virtualHeaderHtml += '<th class="th-type">Type</th>';
  
  // Optional column headers
  if (optionalFields.includes('payment_channel')) _virtualHeaderHtml += '<th class="th-channel">Channel</th>';
  if (optionalFields.includes('authorized_datetime')) _virtualHeaderHtml += '<th class="th-authorized">Authorized</th>';
  if (optionalFields.includes('personal_finance_category')) _virtualHeaderHtml += '<th class="th-plaid-category">Plaid Category</th>';
  
  // Amount is always pinned toward the right edge of the table,
  // regardless of single-account vs all-accounts view.
  _virtualHeaderHtml += '<th class="th-amount">Amount</th>';
  if (showLedgerColumn) {
    _virtualHeaderHtml += '<th class="th-ledger">Balance Ledger</th>';
  }
  
  _virtualHeaderHtml += '<th style="width: 24px;"></th>'; // Action button column

  _virtualHeaderHtml += '</tr></thead>';
  
  // Calculate column count for separator row
  let colCount = showBankAccountColumn ? 5 : 4; // Date, (Bank), Description, Amount, Delete
  if (showLogoColumn) colCount++;
  colCount++; // Category
  if (optionalFields.includes('source')) colCount++;
  if (optionalFields.includes('payment_channel')) colCount++;
  if (optionalFields.includes('authorized_datetime')) colCount++;
  if (optionalFields.includes('personal_finance_category')) colCount++;
  if (showLedgerColumn) colCount++; // Balance Ledger
  if (bulkEditActive) colCount++; // Bulk-select checkbox column
  _virtualColCount = colCount;
  
  // Initialize virtual rows array and hidden transaction tracking
  _virtualRows = [];
  _virtualRowDates = [];
  _hiddenTxnIdSet = new Set();
  _selectedHiddenTxnIds = new Set();
  
  // Track which transactions we've already rendered (split children)
  const renderedTxnIds = new Set();
  
  // Pre-scan: check if both opening_balance and manual_opening_balance exist.
  // When both are present we insert visual separators in the ledger to delineate
  // the plaid-sync'd region from the manual-historical region.
  const hasManualOB = showLedgerColumn && allRowTransactions.some(
    txn => txn.source === 'manual_opening_balance'
  );
  // Only label a zone "plaid-synced" when the account actually has plaid data
  const hasPlaidTxns = allRowTransactions.some(
    txn => txn.source === 'plaid'
  );
  // emittedPlaidSep / emittedManualSep: one-shot flags so each separator renders once
  let emittedPlaidSep = false;
  let emittedManualSep = false;
  // Tracks when the opening_balance row has been processed so the manual
  // separator is placed AFTER it (not at the first manual txn encountered)
  let passedOpeningBalance = false;
  
  allRowTransactions.forEach(txn => {
    const txnRowType = getTransactionType(txn);

    // isFutureBlockRow: true for ANY transaction that belongs above the
    // future/cleared separator — scheduled bills AND manual transactions
    // with dates after today. Used only for block-boundary logic.
    const isFutureBlockRow = (txn.source === 'scheduled' && txn.status === 'future')
      || txnRowType === TXN_TYPE.MANUAL_FUTURE
      || (txnRowType === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING && txn.date > _todayDateStr);

    const isMissingRow = txnRowType === TXN_TYPE.BILL_MISSING
      || txnRowType === TXN_TYPE.MANUAL_MISSING;
    const isOpeningBalanceRow = txnRowType === TXN_TYPE.SYSTEM_OPENING_BALANCE
      || txnRowType === TXN_TYPE.SYSTEM_MANUAL_OPENING_BALANCE;
    const isPendingRow = !!txn.pending;

    // --- Block boundary separators ---
    // Separator: end of future block → start of pending or posted
    if (!scheduledSectionEnded && !isFutureBlockRow) {
      scheduledSectionEnded = true;
      const schedCount = scheduledFuture.length;
      _futureSeparatorRowIndex = _virtualRows.length;
      _virtualRows.push(`<tr class="scheduled-separator-row"><td colspan="${colCount}">▲ ${schedCount} Future Transaction${schedCount !== 1 ? 's' : ''} Above ▲</td></tr>`);
      _virtualRowDates.push(null);
    }

    // Separator: end of pending block → start of posted
    if (!pendingSectionEnded && !isPendingRow && !isFutureBlockRow) {
      pendingSectionEnded = true;
      const pendingCount = pendingTransactions.length;
      _virtualRows.push(`<tr class="pending-separator-row"><td colspan="${colCount}">▲ ${pendingCount} Pending Transaction${pendingCount !== 1 ? 's' : ''} Above ▲</td></tr>`);
      _virtualRowDates.push(null);
    }

    // --- Zone bookmark separators (plaid-synced / manual-historical) ---
    // Only rendered in single-account view when both OB and manual OB exist.
    if (hasManualOB && !isPendingRow && !isFutureBlockRow) {
      // Emit "Manual Historical" right after the OB row, before the next transaction
      if (passedOpeningBalance && !emittedManualSep) {
        emittedManualSep = true;
        _virtualRows.push(`<tr class="zone-separator manual-zone"><td colspan="${colCount}"><span class="zone-arrows">▼▼▼</span> manual historical <span class="zone-arrows">▼▼▼</span></td></tr>`);
        _virtualRowDates.push(null);
      }
      // Emit "Plaid-Synced" right before the OB row (only if plaid txns exist)
      if (!emittedPlaidSep && txn.source === 'opening_balance') {
        emittedPlaidSep = true;
        if (hasPlaidTxns) {
          _virtualRows.push(`<tr class="zone-separator plaid-zone"><td colspan="${colCount}"><span class="zone-arrows">▲▲▲</span> plaid-synced <span class="zone-arrows">▲▲▲</span></td></tr>`);
          _virtualRowDates.push(null);
        }
        passedOpeningBalance = true;
      }
    }
    // Skip if this is a split child that we'll render as part of a group
    if (txn.is_split && txn.transaction_id && txn.transaction_id.includes('_split_')) {
      return; // Split children are rendered as part of parent group
    }
    
    // Check if this is a split parent (has splits array)
    if (txn.is_split && txn.splits && txn.splits.length > 0) {
      // Use parent's unified transaction_id for split API calls (modify/delete)
      const parentTxnId = txn.transaction_id || '';

      // Detect split-amount mismatch: children no longer sum to parent.
      // Happens when a future/missing split parent gets matched to a plaid
      // transaction with a different amount, and the children are re-parented.
      const splitChildSum = txn.splits.reduce((sum, splitChild) => sum + (splitChild.amount || 0), 0);
      const parentAmount = txn.amount || 0;
      const splitAmountMismatch = Math.abs(splitChildSum - parentAmount) > 0.01;

      if (splitAmountMismatch) {
        const _rowParity = _virtualRows.length % 2 === 0;
        _virtualRowDates.push(txn.date);
        _virtualRows.push({ even: _rowParity, html: null, fn: () => {
        let rowHtml = '';
        const dateStr = formatDate(txn.date);
        const formattedAmount = _fmtCurrency(parentAmount, txn.iso_currency_code);
        const parentAmountCellClass = parentAmount < 0
          ? 'ledger-amount-cell ledger-negative'
          : 'ledger-amount-cell';
        const pendingBadge = isPendingRow ? '<span class="pending-badge">Pending</span> ' : '';
        const rowClass = `split-mismatch-row${isPendingRow ? ' pending-row' : ''}`;

        // ── Two-line description cell for mismatch row ──
        const mismatchDisplayName = txn.merchant_name || txn.description || txn.name || '';
        let mismatchTopText = mismatchDisplayName || '[merchant empty]';
        const mismatchTopClass = mismatchDisplayName ? 'txn-description-text' : 'txn-description-text txn-description-placeholder';
        const mismatchMemoText = txn.user_memo || '';
        const mismatchMemoHtml = `<span class="txn-memo-text" data-txn-id="${escapeHtml(parentTxnId)}" title="${escapeHtml(mismatchMemoText)}">${mismatchMemoText ? escapeHtml(mismatchMemoText) : '<em class="memo-placeholder">add memo…</em>'}</span>`;

        rowHtml += `<tr class="${rowClass}" data-txn-id="${escapeHtml(parentTxnId)}" data-source="${escapeHtml(txn.source || '')}" data-status="${escapeHtml(txn.status || '')}" data-account-id="${escapeHtml(txn.account_id || txn.plaid_account_id || '')}" data-amount="${parentAmount || 0}" data-is-split="true" data-txn-description="${escapeHtml(txn.description || txn.name || '')}" data-user-category="${escapeHtml(txn.user_category || '')}" data-merchant-name="${escapeHtml(txn.merchant_name || '')}" data-match-manual-txn-id="${escapeHtml(txn.match_info?.matched_txn_id || '')}" data-is-hidden="${!!txn.is_hidden}" data-txn-date="${escapeHtml(txn.date || '')}">
          ${bulkEditActive ? renderBulkCheckboxCell(txn) : ''}
          ${showLogoColumn ? `<td class="logo-cell">${_renderLogoCell(txn)}</td>` : ''}
          <td>${escapeHtml(dateStr)}</td>
          ${showBankAccountColumn ? `<td>${escapeHtml(txn.bank_account || '')}</td>` : ''}
          <td class="description-column">
            <div class="desc-two-line">
              <div class="desc-top-line">${pendingBadge}<span class="${mismatchTopClass}" title="${escapeHtml(mismatchDisplayName)}">${escapeHtml(mismatchTopText)}</span></div>
              <div class="desc-memo-line">${mismatchMemoHtml}</div>
            </div>
          </td>`;

        // Category cell with split-mismatch repair UI (matches header: Description → Category → Type)
        rowHtml += `<td class="split-mismatch-cell">
          <span class="split-mismatch-badge" title="Split amounts no longer add up to the transaction total. This can happen when a matched transaction has a different amount than the original.">⚠ Split broken</span>
          <button class="split-badge-btn split-repair-badge" onclick="modifySplitModal('${escapeHtml(parentTxnId)}')" title="Repair splits — amounts no longer match parent total">Repair</button>
          <button class="split-badge-btn split-delete-badge" onclick="handleDeleteSplit('${escapeHtml(parentTxnId)}')" title="Delete all splits and revert to unsplit">🗑</button>
        </td>`;

        // Type/source column after category (matching normal row order)
        if (optionalFields.includes('source')) {
          const isConverted = txn.source === 'plaid' && txn.status === 'converted';
          const sourceLabel = txn.source === 'manual' ? 'Manual' : isConverted ? 'Prior Download' : 'Downloaded';
          const sourceCssClass = txn.source === 'manual' ? 'manual' : isConverted ? 'plaid-converted' : 'plaid';
          rowHtml += `<td><span class="source-badge ${sourceCssClass}">${sourceLabel}</span></td>`;
        }

        // Fill remaining optional columns
        if (optionalFields.includes('payment_channel')) rowHtml += `<td>${escapeHtml(txn.payment_channel || '')}</td>`;
        if (optionalFields.includes('original_description')) {
          const preOverrideText = txn.user_description_override ? escapeHtml(txn.description || txn.name || '') : 'no override';
          rowHtml += `<td class="pre-override-cell">${preOverrideText}</td>`;
        }
        if (optionalFields.includes('authorized_datetime')) rowHtml += '<td></td>';
        if (optionalFields.includes('personal_finance_category')) rowHtml += '<td></td>';

        rowHtml += `<td class="${parentAmountCellClass}">${formattedAmount}</td>`;
        if (showLedgerColumn) {
          const lookupKey = txn.transaction_id;
          const runningBal = isFutureBlockRow
            ? scheduledLedgerLookup[lookupKey]
            : isPendingRow ? pendingLedgerLookup[lookupKey] : balanceHistoryLookup[lookupKey];
          if (runningBal !== undefined) {
            const fmtBal = _fmtCurrency(runningBal, txn.iso_currency_code);
            rowHtml += `<td class="ledger-cell${runningBal < 0 ? ' ledger-negative' : ''}">${fmtBal}</td>`;
          } else {
            rowHtml += '<td class="ledger-cell ledger-unavailable">—</td>';
          }
        }

        rowHtml += '<td></td></tr>';
        return rowHtml;
        }});
        renderedTxnIds.add(txn.transaction_id);
        return;
      }
      
      // Render only split children that match active search/category filters.
      const visibleSplits = txn.splits.filter(split => (
        _splitMatchesSearch(txn, split) && _splitMatchesCategoryFilter(split)
      ));

      if (visibleSplits.length === 0) {
        renderedTxnIds.add(txn.transaction_id);
        return;
      }

      visibleSplits.forEach((split, idx) => {
        const _rowParity = _virtualRows.length % 2 === 0;
        _virtualRowDates.push(split.date);
        _virtualRows.push({ even: _rowParity, html: null, fn: () => {
        let rowHtml = '';
        const dateStr = formatDate(split.date);
        
        // Amount is already in ledger convention (positive=inflow, negative=outflow)
        const displayAmount = split.amount;
        const amount = _fmtCurrency(displayAmount, split.iso_currency_code);
        const splitAmountCellClass = displayAmount < 0
          ? 'ledger-amount-cell ledger-negative'
          : 'ledger-amount-cell';
        
        // Add split styling class and border class
        // Note: isFirstSplit/isLastSplit now refer to rendered splits, not original splits
        const isFirstSplit = idx === 0;
        const isLastSplit = idx === visibleSplits.length - 1;
        const rowClass = `split-child-row ${isFirstSplit ? 'split-first' : ''} ${isLastSplit ? 'split-last' : ''}${isPendingRow ? ' pending-row' : ''}`;
        
        const pendingBadge = isPendingRow ? '<span class="pending-badge">Pending</span> ' : '';

        // ── Two-line description cell matching normal rows ──
        const splitDisplayName = split.description || split.name || txn.merchant_name || txn.description || txn.name || '';
        let splitTopLineText = splitDisplayName || '[merchant empty]';
        const splitTopLineClass = splitDisplayName ? 'txn-description-text' : 'txn-description-text txn-description-placeholder';
        const splitMemoText = split.user_memo || '';
        const splitMemoPlaceholder = 'add memo…';
        const splitMemoLineHtml = `<span class="txn-memo-text" data-txn-id="${escapeHtml(split.transaction_id)}" data-split-index="${idx}" title="${escapeHtml(splitMemoText)}">${splitMemoText ? escapeHtml(splitMemoText) : `<em class="memo-placeholder">${splitMemoPlaceholder}</em>`}</span>`;

        rowHtml += `<tr class="${rowClass}" data-txn-id="${escapeHtml(parentTxnId)}" data-parent-txn-id="${escapeHtml(parentTxnId)}" data-split-txn-id="${escapeHtml(split.transaction_id)}" data-split-index="${idx}" data-source="split" data-status="cleared" data-account-id="${escapeHtml(txn.account_id || txn.plaid_account_id || '')}" data-amount="${displayAmount || 0}" data-is-split="true" data-txn-description="${escapeHtml(split.description || split.name || txn.description || txn.name || '')}" data-user-category="${escapeHtml(split.user_category || '')}" data-merchant-name="${escapeHtml(txn.merchant_name || '')}" data-is-hidden="${!!txn.is_hidden}" data-txn-date="${escapeHtml(split.date || txn.date || '')}">
          ${bulkEditActive ? '<td class="bulk-cell bulk-cell-disabled" title="Not bulk-editable"><input type="checkbox" class="bulk-row-checkbox" disabled></td>' : ''}
          ${showLogoColumn ? `<td class="logo-cell">${_renderLogoCell(txn)}</td>` : ''}
          <td>${escapeHtml(dateStr)}</td>
          ${showBankAccountColumn ? `<td>${escapeHtml(split.bank_account || txn.bank_account || '')}</td>` : ''}
          <td class="description-column" data-field="description">
            <div class="desc-two-line">
              <div class="desc-top-line"><span class="split-badge" title="Split transaction">✂</span> ${pendingBadge}<span class="${splitTopLineClass}" title="${escapeHtml(splitDisplayName)}">${escapeHtml(splitTopLineText)}</span></div>
              <div class="desc-memo-line">${splitMemoLineHtml}</div>
            </div>
          </td>`;
        
        // Parse split category - prioritize user_category over personal_finance_category
        let splitCategoryDisplay = 'Uncategorized';
        if (split.user_category) {
          splitCategoryDisplay = split.user_category;
        } else if (split.personal_finance_category?.detailed) {
          splitCategoryDisplay = split.personal_finance_category.detailed;
        }
        
        // Category cell with autocomplete input (same as normal rows) + edit-splits button (first split only)
        const splitEditBtn = isFirstSplit
          ? `<button class="split-badge-btn split-modify-badge" onclick="modifySplitModal('${escapeHtml(parentTxnId)}')" title="Modify splits">✎</button>`
          : '';
        const splitCategoryAutocomplete = _buildCategoryAutocomplete(
          split.transaction_id,
          txn.account_id || txn.plaid_account_id || '',
          splitCategoryDisplay,
          'Type to search categories…',
          splitEditBtn
        );
        rowHtml += `<td class="category-column">${splitCategoryAutocomplete}</td>`;

        // Type/source column after category (matching normal row order)
        if (optionalFields.includes('source')) {
          const isConverted = txn.source === 'plaid' && txn.status === 'converted';
          const sourceLabel = txn.source === 'manual' ? 'Manual' : isConverted ? 'Prior Download' : 'Downloaded';
          const sourceCssClass = txn.source === 'manual' ? 'manual' : isConverted ? 'plaid-converted' : 'plaid';
          const sourceBadge = `<span class="source-badge ${sourceCssClass}">${sourceLabel}</span>`;
          rowHtml += `<td>${sourceBadge}</td>`;
        }
        
        // Add optional field columns
        if (optionalFields.includes('payment_channel')) {
          rowHtml += `<td>${escapeHtml(split.payment_channel || '')}</td>`;
        }
        if (optionalFields.includes('original_description')) {
          const splitPreOverride = txn.user_description_override ? escapeHtml(txn.description || txn.name || '') : 'no override';
          rowHtml += `<td class="pre-override-cell">${splitPreOverride}</td>`;
        }
        if (optionalFields.includes('authorized_datetime')) {
          let authDisplay = '';
          if (split.authorized_datetime) {
            const dt = new Date(split.authorized_datetime);
            authDisplay = dt.toLocaleString('en-US', {
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
              timeZoneName: 'short'
            });
          } else if (split.authorized_date) {
            authDisplay = split.authorized_date;
          }
          rowHtml += `<td>${escapeHtml(authDisplay)}</td>`;
        }
        if (optionalFields.includes('personal_finance_category')) {
          let plaidCategoryDisplay = '';
          if (split.personal_finance_category) {
            const pfc = split.personal_finance_category;
            const primary = pfc.primary || '';
            const detailed = pfc.detailed || '';
            const trimmed = trimCategoryPrefix(detailed, primary);
            const displayPrimary = formatCategoryDisplay(primary);
            const displayDetailed = formatCategoryDisplay(trimmed);
            plaidCategoryDisplay = `${displayPrimary}${displayDetailed ? ': ' + displayDetailed : ''}`;
          }
          rowHtml += `<td class="plaid-category-cell" title="${escapeHtml(plaidCategoryDisplay)}">${escapeHtml(plaidCategoryDisplay)}</td>`;
        }
        
        // Add split action badges on first row only
        if (isFirstSplit) {
          // Amount is always right-aligned; in ledger view add balance too
          rowHtml += `<td class="${splitAmountCellClass}">${amount}</td>`;
          if (showLedgerColumn) {
            const parentLookupKey = txn.transaction_id;
            const parentRunningBalance = isFutureBlockRow
              ? scheduledLedgerLookup[parentLookupKey]
              : isPendingRow ? pendingLedgerLookup[parentLookupKey] : balanceHistoryLookup[parentLookupKey];
            if (parentRunningBalance !== undefined) {
              const formattedParentBalance = _fmtCurrency(parentRunningBalance, split.iso_currency_code);
              const negativeClass = parentRunningBalance < 0 ? ' ledger-negative' : '';
              rowHtml += `<td class="ledger-cell${negativeClass}">${formattedParentBalance}</td>`;
            } else {
              rowHtml += '<td class="ledger-cell ledger-unavailable">—</td>';
            }
          }
          rowHtml += `<td class="split-actions-cell">
            <button class="split-badge-btn split-delete-badge" onclick="handleDeleteSplit('${escapeHtml(parentTxnId)}')" title="Delete splits">🗑</button>
          </td>`;
        } else {
          // Non-top split children: show amount but dash for ledger
          rowHtml += `<td class="${splitAmountCellClass}">${amount}</td>`;
          if (showLedgerColumn) {
            rowHtml += '<td class="ledger-cell ledger-unavailable">—</td>';
          }
          rowHtml += `<td></td>`;
        }
        
        rowHtml += `</tr>`;
        return rowHtml;
        }});
      });
      
      renderedTxnIds.add(txn.transaction_id);
      return;
    }

    // ── Normal (non-split) transaction rendering ──
    const txnId = txn.transaction_id || '';
    if (txn.is_hidden) {
      _hiddenTxnIdSet.add(txnId);
    }
    const _rowParity = _virtualRows.length % 2 === 0;
    _virtualRowDates.push(txn.date);
    _virtualRows.push({ even: _rowParity, html: null, fn: () => {
    let rowHtml = '';
    const accountId = txn.account_id || '';
    const isTransfer = isTransferCategory(txn.user_category) || !!txn.transfer_pair_id;

    // Build the pre-parsed category string for the autocomplete input
    let currentParsed = { primary: '', detailed: '' };
    if (txn.user_category) {
      currentParsed = parseCategoryString(txn.user_category);
    } else if (txn.personal_finance_category) {
      const pfc = txn.personal_finance_category;
      const displayNames = getCategoryDisplayNames(pfc);
      currentParsed = { primary: displayNames.primary, detailed: displayNames.trimmed };
    }
    // For transfers, prefer the live account name resolved at query time
    // so renames are reflected immediately without waiting for a DB relabel.
    const currentFullCategory = isTransfer
      ? (txn.transfer_partner_account_name
        ? buildTransferCategory(txn.transfer_partner_account_name)
        : (txn.user_category || ''))
      : buildCategoryString(currentParsed.primary, currentParsed.detailed);

    // Assemble the context object that every type renderer reads
    const rowCtx = {
      txn,
      txnId,
      accountId,
      currentFullCategory,
      isBill: !!txn.is_bill,
      isTransfer,
      isPendingRow,
      isFutureBlockRow,
      isMissingRow,
      rowType: txnRowType,
    };

    // Dispatch to the type-specific renderer — returns badge, categoryCell,
    // actionCell, rowCssClass, sourceBadge, and displayName.
    const rendered = renderRowByType(rowCtx);

    // Supplementary badges that can co-exist with the type badge
    let fullBadge = rendered.typeBadge;
    if (txn.is_split) {
      fullBadge += '<span class="split-badge" title="Split transaction">✂</span> ';
    }

    const pendingBadge = isPendingRow ? '<span class="pending-badge">Pending</span> ' : '';

    // ── Date cell ──
    const ownDateStr = formatDate(txn.date);
    let dateStr = ownDateStr;
    const hasTransferPartnerDate = txn.transfer_pair_id
      && txn.transfer_partner_date
      && txn.transfer_partner_date !== txn.date;
    if (hasTransferPartnerDate) {
      const partnerDateStr = formatDate(txn.transfer_partner_date);
      const ownTime = new Date(txn.date).getTime();
      const partnerTime = new Date(txn.transfer_partner_date).getTime();
      const olderStr = ownTime <= partnerTime ? ownDateStr : partnerDateStr;
      const newerStr = ownTime <= partnerTime ? partnerDateStr : ownDateStr;
      dateStr = `<span class="transfer-date-range" title="Sent ${olderStr}, received ${newerStr}">${olderStr} → ${newerStr}</span>`;
    }

    // ── Amount cell ──
    const amount = _fmtCurrency(txn.amount, txn.iso_currency_code);
    const amountCellClass = txn.amount < 0
      ? 'ledger-amount-cell ledger-negative'
      : 'ledger-amount-cell';

    // ── Ledger balance cell (single-account view only) ──
    // Missing rows (BILL_MISSING, MANUAL_MISSING) are excluded from the
    // running balance continuity — they display "N/A" instead of a number.
    // Investment trending rows show balance_at_date as their ledger value.
    let ledgerBalanceHtml = '';
    if (showLedgerColumn) {
      if (isMissingRow && isLinkedNonInvestmentAccount) {
        // Linked non-investment accounts: Plaid manages balance continuity;
        // BILL_MISSING / MANUAL_MISSING are excluded from the ledger walk.
        ledgerBalanceHtml = '<td class="ledger-cell ledger-unavailable">N/A</td>';
      } else if (txnRowType === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING && txn.balance_at_date != null) {
        const formattedBal = _fmtCurrency(txn.balance_at_date, txn.iso_currency_code);
        const negClass = txn.balance_at_date < 0 ? ' ledger-negative' : '';
        ledgerBalanceHtml = `<td class="ledger-cell${negClass}" title="Account balance at ${txn.date}">${formattedBal}</td>`;
      } else if (isOpeningBalanceRow && txn.balance_at_date != null) {
        // OB/MOB rows carry the account balance as it stood at that point in
        // time — display that directly rather than looking up the walk history.
        const formattedBal = _fmtCurrency(txn.balance_at_date, txn.iso_currency_code);
        const negClass = txn.balance_at_date < 0 ? ' ledger-negative' : '';
        ledgerBalanceHtml = `<td class="ledger-cell${negClass}" title="Account balance as of ${txn.date}">${formattedBal}</td>`;
      } else {
        const runningBalance = isFutureBlockRow
            ? scheduledLedgerLookup[txn.transaction_id]
            : isPendingRow ? pendingLedgerLookup[txn.transaction_id] : balanceHistoryLookup[txn.transaction_id];
        if (runningBalance !== undefined) {
          const formattedBalance = _fmtCurrency(runningBalance, txn.iso_currency_code);
          const negativeClass = runningBalance < 0 ? ' ledger-negative' : '';
          const projectedClass = isFutureBlockRow ? ' ledger-projected' : '';
          ledgerBalanceHtml = `<td class="ledger-cell${negativeClass}${projectedClass}">${formattedBalance}</td>`;
        } else {
          ledgerBalanceHtml = '<td class="ledger-cell ledger-unavailable">—</td>';
        }
      }
    }

    // ── Data attributes for context menu ──
    const rowDataAttrs = ` data-txn-id="${escapeHtml(txnId)}" data-source="${escapeHtml(txn.source || '')}" data-status="${escapeHtml(txn.status || '')}" data-pending="${!!txn.pending}" data-is-bill="${!!txn.is_bill}" data-bill-id="${escapeHtml(txn.bill_id || '')}" data-account-id="${escapeHtml(accountId)}" data-amount="${txn.amount || 0}" data-is-split="${!!txn.is_split}" data-txn-description="${escapeHtml(txn.description || txn.name || '')}" data-user-category="${escapeHtml(txn.user_category || '')}" data-merchant-name="${escapeHtml(txn.merchant_name || '')}" data-match-manual-txn-id="${escapeHtml(txn.match_info?.matched_txn_id || '')}" data-suggestion-txn-id="${escapeHtml(txn.suggestion_info?.suggested_txn_id || '')}" data-suggestion-proposal-id="${txn.suggestion_info?.proposal_id || ''}" data-is-hidden="${!!txn.is_hidden}" data-txn-date="${escapeHtml(txn.date || '')}"`;

    // ── Inline-edit eligibility (date, description, amount) ──
    const isDateInlineEditable = canInlineEditDate(txnRowType);
    const isRowDescEditable = canInlineEditDescription(txnRowType);
    const isAmountInlineEditable = canInlineEditAmount(txnRowType);
    const isPlaidDescEditable = (txnRowType === TXN_TYPE.PLAID_CLEARED || txnRowType === TXN_TYPE.PLAID_PENDING);
    const isDescEditable = isRowDescEditable || isPlaidDescEditable;

    // Prefer user_description_override for plaid rows (if the user set one)
    const effectiveDisplayName = txn.user_description_override || rendered.displayName;

    // ── Two-line description cell: merchant/payee on top, memo underneath ──
    const isManualSource = (txn.source === 'manual');
    let topLineText = effectiveDisplayName;
    let topLineClass = 'txn-description-text';
    if (isManualSource && !txn.merchant_name) {
      topLineText = '[merchant empty]';
      topLineClass = 'txn-description-text txn-description-placeholder';
    }

    const memoText = txn.user_memo || '';
    const memoPlaceholder = 'add memo…';
    const memoLineHtml = `<span class="txn-memo-text" data-txn-id="${escapeHtml(txnId)}" title="${escapeHtml(memoText)}">${memoText ? escapeHtml(memoText) : `<em class="memo-placeholder">${memoPlaceholder}</em>`}</span>`;

    // ── Assemble the row ──
    const isHiddenRow = !!txn.is_hidden;
    const hiddenClass = isHiddenRow ? ' txn-hidden' : '';
    const rowCssClass = rendered.rowCssClass;
    const combinedClass = (rowCssClass || '') + hiddenClass;
    rowHtml += `<tr${combinedClass ? ` class="${combinedClass.trim()}"` : ''}${rowDataAttrs}>`;
    if (bulkEditActive) {
      rowHtml += renderBulkCheckboxCell(txn);
    }

    // Hidden-row checkbox (for batch unhide) — rendered as first visible cell content
    const hiddenCheckboxHtml = isHiddenRow && showHiddenEnabled
      ? `<input type="checkbox" class="hidden-txn-checkbox" data-txn-id="${escapeHtml(txnId)}" title="Select for batch unhide">`
      : '';

    if (showLogoColumn) {
      rowHtml += `<td class="logo-cell">${hiddenCheckboxHtml}${_renderLogoCell(txn)}</td>`;
    }
    // Unreviewed dot: Plaid-sourced rows land in the ledger as ``reviewed=false``
    // and get a pulsing blue indicator to nudge the user to verify/categorize
    // before moving on. Approving a match auto-flips the flag, and the
    // context-menu "Mark visible as reviewed" action clears it in bulk.
    const unreviewedDot = (txn.reviewed === false && !isFutureBlockRow && !isOpeningBalanceRow)
      ? `<span class="unreviewed-dot" title="Click to mark reviewed" onclick="event.stopPropagation(); _markSingleTransactionReviewed('${txnId}')"></span>`
      : '';
    rowHtml += `<td class="date-column${isDateInlineEditable ? ' inline-editable' : ''}"${isDateInlineEditable ? ' data-field="date"' : ''}>${!showLogoColumn ? hiddenCheckboxHtml : ''}${unreviewedDot}${dateStr}</td>`;
    if (showBankAccountColumn) {
      rowHtml += `<td>${txn.bank_account}</td>`;
    }
    rowHtml += `<td class="description-column"${isDescEditable ? ' data-field="description"' : ''}>
      <div class="desc-two-line">
        <div class="desc-top-line">${fullBadge}${pendingBadge}<span class="${topLineClass}" title="${escapeHtml(effectiveDisplayName)}">${escapeHtml(topLineText)}</span></div>
        <div class="desc-memo-line">${memoLineHtml}</div>
      </div>
    </td>`;

    // Category cell
    rowHtml += `<td class="category-column">${rendered.categoryCell}</td>`;

    // Type badge column (optional field) — placed after category
    if (optionalFields.includes('source')) {
      const sb = rendered.sourceBadge;
      rowHtml += `<td><span class="source-badge ${sb.cssClass}" data-tooltip="${sb.title}">${sb.label}</span></td>`;
    }

    // Optional field cells (type-agnostic)
    if (optionalFields.includes('payment_channel')) rowHtml += `<td>${txn.payment_channel || ''}</td>`;
    if (optionalFields.includes('authorized_datetime')) {
      let authDisplay = '';
      let authTooltip = '';
      if (txn.authorized_datetime) {
        const dt = new Date(txn.authorized_datetime);
        authDisplay = txn.authorized_date || dt.toISOString().slice(0, 10);
        authTooltip = dt.toLocaleString('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          timeZoneName: 'short'
        });
      } else if (txn.authorized_date) {
        authDisplay = txn.authorized_date;
        authTooltip = txn.authorized_date;
      }
      rowHtml += `<td class="auth-date-cell"${authTooltip ? ` title="${escapeHtml(authTooltip)}"` : ''}>${authDisplay}</td>`;
    }
    if (optionalFields.includes('personal_finance_category')) {
      let plaidCategoryDisplay = '';
      if (txn.personal_finance_category) {
        const pfc = txn.personal_finance_category;
        const primary = pfc.primary || '';
        const detailed = pfc.detailed || '';
        const trimmed = trimCategoryPrefix(detailed, primary);
        const displayPrimary = formatCategoryDisplay(primary);
        const displayDetailed = formatCategoryDisplay(trimmed);
        plaidCategoryDisplay = `${displayPrimary}${displayDetailed ? ': ' + displayDetailed : ''}`;
      }
      rowHtml += `<td class="plaid-category-cell" title="${escapeHtml(plaidCategoryDisplay)}">${escapeHtml(plaidCategoryDisplay)}</td>`;
    }

    // Amount is always pinned toward the right edge
    const extraAmountClass = rendered.amountCssExtra ? ` ${rendered.amountCssExtra}` : '';
    // OB/MOB rows report a balance, not a debit/credit — suppress the amount cell.
    const isVariableBill = txn.amount_variable
      && (txnRowType === TXN_TYPE.BILL_FUTURE || txnRowType === TXN_TYPE.BILL_MISSING);
    const variableDot = isVariableBill
      ? '<span class="variable-bill-dot" title="Amount varies — check actual amount before due date"></span>'
      : '';
    const amountPrefix = isVariableBill ? '~' : '';
    const amountDisplay = isOpeningBalanceRow ? '—' : `${amountPrefix}${amount}${variableDot}`;
    rowHtml += `<td class="${amountCellClass}${extraAmountClass}${isAmountInlineEditable ? ' inline-editable' : ''}"${isAmountInlineEditable ? ' data-field="amount"' : ''}>${amountDisplay}</td>`;
    if (showLedgerColumn) {
      rowHtml += ledgerBalanceHtml;
    }

    // Action column — provided by the type-specific renderer
    rowHtml += rendered.actionCell;

    rowHtml += '</tr>';

    return rowHtml;
    }});
  });
  
  // ── Virtual scroll: render visible window + wire scroll listener ──
  // Clear existing table so the header is rebuilt (columns may have changed)
  container.innerHTML = '';
  _lastRenderedRange = { start: -1, end: -1 };
  // First render establishes the virtual spacers so the scroll pane has
  // its full content height. Without this the browser clamps scrollTop to 0
  // because the container is empty after innerHTML = ''.
  _renderVisibleWindow(container);

  if (scrollPane) {
    const cachedPosition = _scrollPositionCache[scrollCacheKey];

    if (preservedScrollTop !== null) {
      scrollPane.scrollTop = preservedScrollTop;
    } else if (_hasSavedScrollPosition(scrollCacheKey)) {
      // Restore the position the user was at last time they viewed this account.
      scrollPane.scrollTop = cachedPosition;
    } else if (_futureSeparatorRowIndex > FUTURE_ROWS_TO_SHOW) {
      // First visit: skip far-future rows, show the 10 nearest.
      scrollPane.scrollTop = (_futureSeparatorRowIndex - FUTURE_ROWS_TO_SHOW) * VIRTUAL_ROW_HEIGHT;
    }
    _scrollPositionCache[scrollCacheKey] = scrollPane.scrollTop;
    // Re-render so the visible window matches the new scroll position.
    _lastRenderedRange = { start: -1, end: -1 };
    _renderVisibleWindow(container);
  }

  _lastRenderedScrollCacheKey = scrollCacheKey;

  if (!_virtualScrollBound) {
    const pane = document.querySelector('.transaction-scroll-pane');
    if (pane) {
      pane.addEventListener('scroll', _onVirtualScroll, { passive: true });
      _virtualScrollBound = true;
    }
  }
  _bindMouseTracking();

  document.getElementById('export-buttons').classList.remove('hidden');
  
  // Attach event listeners for category dropdowns
  attachCategoryDropdownListeners();
  
  renderCategorySummaryModal();
  renderInsightsPanel();

  // Update the batch-unhide toolbar with hidden transaction count
  _updateHiddenTransactionCount();
}

/**
 * Updates the hidden transaction count badge in the batch-unhide toolbar.
 * Uses the data-driven _hiddenTxnIdSet so the count is correct even when
 * off-screen rows are not in the DOM (virtual scroll).
 */
function _updateHiddenTransactionCount() {
  const countEl = document.getElementById('hidden-txn-count');
  if (!countEl) return;

  const count = _hiddenTxnIdSet.size;
  countEl.textContent = count > 0
    ? `${count} hidden transaction${count !== 1 ? 's' : ''}`
    : 'No hidden transactions';
}

async function saveTransactionMemo(transactionId, userMemo) {
  if (!transactionId) {
    showStatus('Unable to save memo: missing transaction id', 'error');
    return;
  }

  const trimmedMemo = (userMemo || '').toString().slice(0, 256);

  try {
    const txn = transactions.find(t => t.transaction_id === transactionId);
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/add-memo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction_id: transactionId,
        user_memo: trimmedMemo
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save memo');
    }

    if (txn) {
      txn.user_memo = trimmedMemo;
      _cacheTransactions(transactions);
    }

    showStatus('Memo saved', 'success');
  } catch (error) {
    showStatus(`Failed to save memo: ${error.message}`, 'error');
  }
}


/**
 * Convert a .txn-memo-text span into an editable input. If an inline
 * memo editor is already open on a different row, commit that one first.
 */
function _openInlineMemoEditor(memoSpan) {
  const span = memoSpan instanceof HTMLElement ? memoSpan : memoSpan[0];
  if (!span || span.classList.contains('inline-memo-active')) return;

  // Close any existing inline memo editor elsewhere
  const existingEditor = document.querySelector('.inline-memo-input');
  if (existingEditor) {
    _commitInlineMemo($(existingEditor));
  }

  const txnId = span.dataset.txnId;
  if (!txnId) return;

  // For split children, the memo span's data-txn-id is the split child's
  // own transaction_id. Look up the memo from the parent's splits array.
  const splitIndex = span.dataset.splitIndex;
  let currentMemo = '';
  if (splitIndex !== undefined && splitIndex !== null) {
    const parentRow = span.closest('tr');
    const parentTxnId = parentRow ? parentRow.dataset.txnId : null;
    const parentTxn = parentTxnId
      ? transactions.find(t => t.transaction_id === parentTxnId)
      : null;
    if (parentTxn && parentTxn.splits) {
      const splitChild = parentTxn.splits.find(s => s.transaction_id === txnId);
      currentMemo = splitChild ? (splitChild.user_memo || '') : '';
    }
  } else {
    const txn = transactions.find(t => t.transaction_id === txnId);
    currentMemo = txn ? (txn.user_memo || '') : '';
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-memo-input';
  input.maxLength = 256;
  input.value = currentMemo;
  input.placeholder = 'add memo…';
  input.dataset.txnId = txnId;
  input.dataset.originalMemo = currentMemo;

  span.classList.add('inline-memo-active');
  span.textContent = '';
  span.appendChild(input);
  input.focus();
  input.select();
}


/**
 * Stage the memo edit via batch manager, then restore the span display.
 */
function _commitInlineMemo(inputEl) {
  const input = inputEl instanceof HTMLElement ? inputEl : inputEl[0];
  if (!input || !input.classList.contains('inline-memo-input')) return;

  const txnId = input.dataset.txnId;
  const newMemo = (input.value || '').trim();
  const originalMemo = input.dataset.originalMemo || '';

  if (txnId && newMemo !== originalMemo && typeof stageBatchEdit === 'function') {
    stageBatchEdit(String(txnId), { user_memo: newMemo });
  }

  _closeInlineMemoEditor($(input), false);
}


/**
 * Restore the memo span from the inline input.
 * @param {boolean} revert - If true, discard changes and show original value.
 */
function _closeInlineMemoEditor(inputEl, revert) {
  const input = inputEl instanceof HTMLElement ? inputEl : inputEl[0];
  if (!input) return;

  const span = input.closest('.txn-memo-text');
  if (!span) return;

  const txnId = span.dataset.txnId;
  const memoValue = revert ? (input.dataset.originalMemo || '') : (input.value || '').trim();

  span.classList.remove('inline-memo-active');
  if (memoValue) {
    span.textContent = memoValue;
    span.title = memoValue;
  } else {
    span.innerHTML = '<em class="memo-placeholder">add memo…</em>';
    span.title = '';
  }
}
