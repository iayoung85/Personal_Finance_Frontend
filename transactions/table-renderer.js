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


function renderTransactionTable() {
  const container = document.getElementById('table-container');
  
  if (transactions.length === 0) {
    container.innerHTML = '<div class="empty-state">No transactions found. Sync transactions first.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    document.getElementById('pending-table-container').innerHTML = '';
    renderInsightsPanel(); // Still render empty insights
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
    container.innerHTML = '<div class="empty-state">No transactions found for the selected criteria.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    document.getElementById('pending-table-container').innerHTML = '';
    renderCategoryChart(); // Clear chart when no data
    renderInsightsPanel(); // Still render empty insights
    return;
  }
  
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

  filteredTransactions.forEach(txn => {
    // Matched manual/scheduled rows are merged into their plaid
    // counterpart by the backend — skip them entirely.
    if (txn.hidden_by_match) return;

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
    const priorityA = anchorSortPriority(rowA.source);
    const priorityB = anchorSortPriority(rowB.source);
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
  
  if (showLedgerColumn) {
    const selectedAccount = accounts.find(account => account.account_id === selectedAccountId);
    const currentPostedBalance = selectedAccount ? selectedAccount.current_balance : 0;

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

  let html = '<table><thead><tr>';
  if (showLogoColumn) {
    html += '<th class="th-logo" style="width: 36px;"></th>';
  }
  html += '<th class="th-date">Date</th>';
  if (showBankAccountColumn) {
    html += '<th>Bank/Account</th>';
  }
  html += '<th class="th-description">Description</th>';
  
  html += '<th class="th-category">Category</th>';
  if (optionalFields.includes('source')) html += '<th class="th-type">Type</th>';
  
  // Optional column headers
  if (optionalFields.includes('payment_channel')) html += '<th class="th-channel">Channel</th>';
  if (optionalFields.includes('authorized_datetime')) html += '<th class="th-authorized">Authorized</th>';
  if (optionalFields.includes('personal_finance_category')) html += '<th class="th-plaid-category">Plaid Category</th>';
  
  // Amount is always pinned toward the right edge of the table,
  // regardless of single-account vs all-accounts view.
  html += '<th class="th-amount">Amount</th>';
  if (showLedgerColumn) {
    html += '<th class="th-ledger">Balance Ledger</th>';
  }
  
  html += '<th style="width: 24px;"></th>'; // Action button column

  html += '</tr></thead>';
  
  // Calculate column count for separator row
  let colCount = showBankAccountColumn ? 5 : 4; // Date, (Bank), Description, Amount, Delete
  if (showLogoColumn) colCount++;
  colCount++; // Category
  if (optionalFields.includes('source')) colCount++;
  if (optionalFields.includes('payment_channel')) colCount++;
  if (optionalFields.includes('authorized_datetime')) colCount++;
  if (optionalFields.includes('personal_finance_category')) colCount++;
  if (showLedgerColumn) colCount++; // Balance Ledger
  
  // Open first tbody based on which block comes first
  if (hasScheduledToShow) {
    html += '<tbody class="scheduled-tbody">';
  } else if (hasPendingToShow) {
    html += '<tbody class="pending-tbody">';
  } else {
    html += '<tbody>';
  }
  
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
    const isPendingRow = !!txn.pending;

    // --- Block boundary separators ---
    // Separator: end of future block → start of pending or posted
    if (!scheduledSectionEnded && !isFutureBlockRow) {
      scheduledSectionEnded = true;
      const schedCount = scheduledFuture.length;
      html += `<tr class="scheduled-separator-row"><td colspan="${colCount}">▲ ${schedCount} Future Transaction${schedCount !== 1 ? 's' : ''} Above ▲</td></tr>`;
      html += '</tbody>';
      if (isPendingRow) {
        html += '<tbody class="pending-tbody">';
      } else {
        html += '<tbody>';
      }
    }

    // Separator: end of pending block → start of posted
    if (!pendingSectionEnded && !isPendingRow && !isFutureBlockRow) {
      pendingSectionEnded = true;
      const pendingCount = pendingTransactions.length;
      html += `<tr class="pending-separator-row"><td colspan="${colCount}">▲ ${pendingCount} Pending Transaction${pendingCount !== 1 ? 's' : ''} Above ▲</td></tr>`;
      html += '</tbody><tbody>';
    }

    // --- Zone bookmark separators (plaid-synced / manual-historical) ---
    // Only rendered in single-account view when both OB and manual OB exist.
    if (hasManualOB && !isPendingRow && !isFutureBlockRow) {
      // Emit "Manual Historical" right after the OB row, before the next transaction
      if (passedOpeningBalance && !emittedManualSep) {
        emittedManualSep = true;
        html += `<tr class="zone-separator manual-zone"><td colspan="${colCount}"><span class="zone-arrows">▼▼▼</span> manual historical <span class="zone-arrows">▼▼▼</span></td></tr>`;
      }
      // Emit "Plaid-Synced" right before the OB row (only if plaid txns exist)
      if (!emittedPlaidSep && txn.source === 'opening_balance') {
        emittedPlaidSep = true;
        if (hasPlaidTxns) {
          html += `<tr class="zone-separator plaid-zone"><td colspan="${colCount}"><span class="zone-arrows">▲▲▲</span> plaid-synced <span class="zone-arrows">▲▲▲</span></td></tr>`;
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
        // Render the parent row (not children) with a repair prompt.
        // The split children are hidden until the user fixes the split.
        const dateStr = formatDate(txn.date);
        const formattedAmount = new Intl.NumberFormat('en-US', {
          style: 'currency', currency: txn.iso_currency_code || 'USD'
        }).format(parentAmount);
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

        html += `<tr class="${rowClass}" data-txn-id="${escapeHtml(parentTxnId)}" data-source="${escapeHtml(txn.source || '')}" data-status="${escapeHtml(txn.status || '')}" data-account-id="${escapeHtml(txn.account_id || txn.plaid_account_id || '')}" data-amount="${parentAmount || 0}" data-is-split="true" data-txn-description="${escapeHtml(txn.description || txn.name || '')}" data-user-category="${escapeHtml(txn.user_category || '')}" data-merchant-name="${escapeHtml(txn.merchant_name || '')}" data-match-manual-txn-id="${escapeHtml(txn.match_info?.matched_txn_id || '')}" data-is-hidden="${!!txn.is_hidden}" data-txn-date="${escapeHtml(txn.date || '')}">
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
        html += `<td class="split-mismatch-cell">
          <span class="split-mismatch-badge" title="Split amounts no longer add up to the transaction total. This can happen when a matched transaction has a different amount than the original.">⚠ Split broken</span>
          <button class="split-badge-btn split-repair-badge" onclick="modifySplitModal('${escapeHtml(parentTxnId)}')" title="Repair splits — amounts no longer match parent total">Repair</button>
          <button class="split-badge-btn split-delete-badge" onclick="handleDeleteSplit('${escapeHtml(parentTxnId)}')" title="Delete all splits and revert to unsplit">🗑</button>
        </td>`;

        // Type/source column after category (matching normal row order)
        if (optionalFields.includes('source')) {
          const isConverted = txn.source === 'plaid' && txn.status === 'converted';
          const sourceLabel = txn.source === 'manual' ? 'Manual' : isConverted ? 'Prior Download' : 'Downloaded';
          const sourceCssClass = txn.source === 'manual' ? 'manual' : isConverted ? 'plaid-converted' : 'plaid';
          html += `<td><span class="source-badge ${sourceCssClass}">${sourceLabel}</span></td>`;
        }

        // Fill remaining optional columns
        if (optionalFields.includes('payment_channel')) html += `<td>${escapeHtml(txn.payment_channel || '')}</td>`;
        if (optionalFields.includes('original_description')) {
          const preOverrideText = txn.user_description_override ? escapeHtml(txn.description || txn.name || '') : 'no override';
          html += `<td class="pre-override-cell">${preOverrideText}</td>`;
        }
        if (optionalFields.includes('authorized_datetime')) html += '<td></td>';
        if (optionalFields.includes('personal_finance_category')) html += '<td></td>';

        html += `<td class="${parentAmountCellClass}">${formattedAmount}</td>`;
        if (showLedgerColumn) {
          const lookupKey = txn.transaction_id;
          const runningBal = isFutureBlockRow
            ? scheduledLedgerLookup[lookupKey]
            : isPendingRow ? pendingLedgerLookup[lookupKey] : balanceHistoryLookup[lookupKey];
          if (runningBal !== undefined) {
            const fmtBal = new Intl.NumberFormat('en-US', { style: 'currency', currency: txn.iso_currency_code || 'USD' }).format(runningBal);
            html += `<td class="ledger-cell${runningBal < 0 ? ' ledger-negative' : ''}">${fmtBal}</td>`;
          } else {
            html += '<td class="ledger-cell ledger-unavailable">—</td>';
          }
        }

        html += '<td></td></tr>';
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
        const dateStr = formatDate(split.date);
        
        // Amount is already in ledger convention (positive=inflow, negative=outflow)
        const displayAmount = split.amount;
        const amount = new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: split.iso_currency_code || 'USD' 
        }).format(displayAmount);
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
        const splitMemoLineHtml = `<span class="txn-memo-text" data-txn-id="${escapeHtml(parentTxnId)}" data-split-index="${idx}" title="${escapeHtml(splitMemoText)}">${splitMemoText ? escapeHtml(splitMemoText) : `<em class="memo-placeholder">${splitMemoPlaceholder}</em>`}</span>`;

        html += `<tr class="${rowClass}" data-txn-id="${escapeHtml(parentTxnId)}" data-parent-txn-id="${escapeHtml(parentTxnId)}" data-split-index="${idx}" data-source="split" data-status="cleared" data-account-id="${escapeHtml(txn.account_id || txn.plaid_account_id || '')}" data-amount="${displayAmount || 0}" data-is-split="true" data-txn-description="${escapeHtml(split.description || split.name || txn.description || txn.name || '')}" data-user-category="${escapeHtml(split.user_category || '')}" data-merchant-name="${escapeHtml(txn.merchant_name || '')}" data-is-hidden="${!!txn.is_hidden}" data-txn-date="${escapeHtml(split.date || txn.date || '')}">
          ${showLogoColumn ? `<td class="logo-cell">${_renderLogoCell(txn)}</td>` : ''}
          <td>${escapeHtml(dateStr)}</td>
          ${showBankAccountColumn ? `<td>${escapeHtml(split.bank_account || txn.bank_account || '')}</td>` : ''}
          <td class="description-column">
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
        
        // Category cell with edit-splits button tucked right-aligned (first split only)
        const splitEditBtn = isFirstSplit
          ? `<button class="split-badge-btn split-modify-badge" onclick="modifySplitModal('${escapeHtml(parentTxnId)}')" title="Modify splits">✎</button>`
          : '';
        html += `<td class="split-category-cell"><div class="split-category-inner"><span class="split-category-text">${escapeHtml(splitCategoryDisplay)}</span>${splitEditBtn}</div></td>`;

        // Type/source column after category (matching normal row order)
        if (optionalFields.includes('source')) {
          const isConverted = txn.source === 'plaid' && txn.status === 'converted';
          const sourceLabel = txn.source === 'manual' ? 'Manual' : isConverted ? 'Prior Download' : 'Downloaded';
          const sourceCssClass = txn.source === 'manual' ? 'manual' : isConverted ? 'plaid-converted' : 'plaid';
          const sourceBadge = `<span class="source-badge ${sourceCssClass}">${sourceLabel}</span>`;
          html += `<td>${sourceBadge}</td>`;
        }
        
        // Add optional field columns
        if (optionalFields.includes('payment_channel')) {
          html += `<td>${escapeHtml(split.payment_channel || '')}</td>`;
        }
        if (optionalFields.includes('original_description')) {
          const splitPreOverride = txn.user_description_override ? escapeHtml(txn.description || txn.name || '') : 'no override';
          html += `<td class="pre-override-cell">${splitPreOverride}</td>`;
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
          html += `<td>${escapeHtml(authDisplay)}</td>`;
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
          html += `<td class="plaid-category-cell" title="${escapeHtml(plaidCategoryDisplay)}">${escapeHtml(plaidCategoryDisplay)}</td>`;
        }
        
        // Add split action badges on first row only
        if (isFirstSplit) {
          // Amount is always right-aligned; in ledger view add balance too
          html += `<td class="${splitAmountCellClass}">${amount}</td>`;
          if (showLedgerColumn) {
            const parentLookupKey = txn.transaction_id;
            const parentRunningBalance = isFutureBlockRow
              ? scheduledLedgerLookup[parentLookupKey]
              : isPendingRow ? pendingLedgerLookup[parentLookupKey] : balanceHistoryLookup[parentLookupKey];
            if (parentRunningBalance !== undefined) {
              const formattedParentBalance = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: split.iso_currency_code || 'USD'
              }).format(parentRunningBalance);
              const negativeClass = parentRunningBalance < 0 ? ' ledger-negative' : '';
              html += `<td class="ledger-cell${negativeClass}">${formattedParentBalance}</td>`;
            } else {
              html += '<td class="ledger-cell ledger-unavailable">—</td>';
            }
          }
          html += `<td class="split-actions-cell">
            <button class="split-badge-btn split-delete-badge" onclick="handleDeleteSplit('${escapeHtml(parentTxnId)}')" title="Delete splits">🗑</button>
          </td>`;
        } else {
          // Non-top split children: show amount but dash for ledger
          html += `<td class="${splitAmountCellClass}">${amount}</td>`;
          if (showLedgerColumn) {
            html += '<td class="ledger-cell ledger-unavailable">—</td>';
          }
          html += `<td></td>`;
        }
        
        html += `</tr>`;
      });
      
      renderedTxnIds.add(txn.transaction_id);
      return;
    }

    // ── Normal (non-split) transaction rendering ──
    // Classify once, dispatch to the type-specific renderer in row-renderers.js
    // txnRowType already computed above for block boundary logic — reuse it.
    const txnId = txn.transaction_id || '';
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
    // For transfers, use the raw [AccountName] string directly rather than
    // feeding it through buildCategoryString which expects Primary: Detailed.
    const currentFullCategory = isTransfer
      ? (txn.user_category || '')
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
    if (txn.is_override) {
      fullBadge += '<span class="override-badge" title="Manual category override">⊘</span> ';
    }
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
    const amount = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: txn.iso_currency_code || 'USD'
    }).format(txn.amount);
    const amountCellClass = txn.amount < 0
      ? 'ledger-amount-cell ledger-negative'
      : 'ledger-amount-cell';

    // ── Ledger balance cell (single-account view only) ──
    // Missing rows (BILL_MISSING, MANUAL_MISSING) are excluded from the
    // running balance continuity — they display "N/A" instead of a number.
    // Investment trending rows show balance_at_date as their ledger value.
    let ledgerBalanceHtml = '';
    if (showLedgerColumn) {
      if (isMissingRow) {
        ledgerBalanceHtml = '<td class="ledger-cell ledger-unavailable">N/A</td>';
      } else if (txnRowType === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING && txn.balance_at_date != null) {
        const formattedBal = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: txn.iso_currency_code || 'USD'
        }).format(txn.balance_at_date);
        const negClass = txn.balance_at_date < 0 ? ' ledger-negative' : '';
        ledgerBalanceHtml = `<td class="ledger-cell${negClass}" title="Account balance at ${txn.date}">${formattedBal}</td>`;
      } else {
        const runningBalance = isFutureBlockRow
            ? scheduledLedgerLookup[txn.transaction_id]
            : isPendingRow ? pendingLedgerLookup[txn.transaction_id] : balanceHistoryLookup[txn.transaction_id];
        if (runningBalance !== undefined) {
          const formattedBalance = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: txn.iso_currency_code || 'USD'
          }).format(runningBalance);
          const negativeClass = runningBalance < 0 ? ' ledger-negative' : '';
          const projectedClass = isFutureBlockRow ? ' ledger-projected' : '';
          ledgerBalanceHtml = `<td class="ledger-cell${negativeClass}${projectedClass}">${formattedBalance}</td>`;
        } else {
          ledgerBalanceHtml = '<td class="ledger-cell ledger-unavailable">—</td>';
        }
      }
    }

    // ── Data attributes for context menu ──
    const rowDataAttrs = ` data-txn-id="${escapeHtml(txnId)}" data-source="${escapeHtml(txn.source || '')}" data-status="${escapeHtml(txn.status || '')}" data-pending="${!!txn.pending}" data-is-bill="${!!txn.is_bill}" data-bill-id="${escapeHtml(txn.bill_id || '')}" data-account-id="${escapeHtml(accountId)}" data-amount="${txn.amount || 0}" data-is-split="${!!txn.is_split}" data-txn-description="${escapeHtml(txn.description || txn.name || '')}" data-user-category="${escapeHtml(txn.user_category || '')}" data-merchant-name="${escapeHtml(txn.merchant_name || '')}" data-match-manual-txn-id="${escapeHtml(txn.match_info?.matched_txn_id || '')}" data-is-hidden="${!!txn.is_hidden}" data-txn-date="${escapeHtml(txn.date || '')}"`;

    // ── Inline-edit eligibility (date, description, amount) ──
    const isInlineEditable = EDITABLE_TYPES.has(txnRowType);
    const isPlaidDescEditable = (txnRowType === TXN_TYPE.PLAID_CLEARED || txnRowType === TXN_TYPE.PLAID_PENDING);
    const isDescEditable = isInlineEditable || isPlaidDescEditable;

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
    html += `<tr${combinedClass ? ` class="${combinedClass.trim()}"` : ''}${rowDataAttrs}>`;

    // Hidden-row checkbox (for batch unhide) — rendered as first visible cell content
    const hiddenCheckboxHtml = isHiddenRow && showHiddenEnabled
      ? `<input type="checkbox" class="hidden-txn-checkbox" data-txn-id="${escapeHtml(txnId)}" title="Select for batch unhide">`
      : '';

    if (showLogoColumn) {
      html += `<td class="logo-cell">${hiddenCheckboxHtml}${_renderLogoCell(txn)}</td>`;
    }
    html += `<td class="date-column${isInlineEditable ? ' inline-editable' : ''}"${isInlineEditable ? ' data-field="date"' : ''}>${!showLogoColumn ? hiddenCheckboxHtml : ''}${dateStr}</td>`;
    if (showBankAccountColumn) {
      html += `<td>${txn.bank_account}</td>`;
    }
    html += `<td class="description-column"${isDescEditable ? ' data-field="description"' : ''}>
      <div class="desc-two-line">
        <div class="desc-top-line">${fullBadge}${pendingBadge}<span class="${topLineClass}" title="${escapeHtml(effectiveDisplayName)}">${escapeHtml(topLineText)}</span></div>
        <div class="desc-memo-line">${memoLineHtml}</div>
      </div>
    </td>`;

    // Category cell
    html += `<td class="category-column">${rendered.categoryCell}</td>`;

    // Type badge column (optional field) — placed after category
    if (optionalFields.includes('source')) {
      const sb = rendered.sourceBadge;
      html += `<td><span class="source-badge ${sb.cssClass}" data-tooltip="${sb.title}">${sb.label}</span></td>`;
    }

    // Optional field cells (type-agnostic)
    if (optionalFields.includes('payment_channel')) html += `<td>${txn.payment_channel || ''}</td>`;
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
      html += `<td class="auth-date-cell"${authTooltip ? ` title="${escapeHtml(authTooltip)}"` : ''}>${authDisplay}</td>`;
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
      html += `<td class="plaid-category-cell" title="${escapeHtml(plaidCategoryDisplay)}">${escapeHtml(plaidCategoryDisplay)}</td>`;
    }

    // Amount is always pinned toward the right edge
    const extraAmountClass = rendered.amountCssExtra ? ` ${rendered.amountCssExtra}` : '';
    html += `<td class="${amountCellClass}${extraAmountClass}${isInlineEditable ? ' inline-editable' : ''}"${isInlineEditable ? ' data-field="amount"' : ''}>${amount}</td>`;
    if (showLedgerColumn) {
      html += ledgerBalanceHtml;
    }

    // Action column — provided by the type-specific renderer
    html += rendered.actionCell;

    html += '</tr>';
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
  document.getElementById('export-buttons').classList.remove('hidden');
  
  // Attach event listeners for category dropdowns
  attachCategoryDropdownListeners();
  
  // Update chart visualization
  renderCategoryChart();
  
  // Update insights panel
  renderInsightsPanel();

  // Update the batch-unhide toolbar with hidden transaction count
  _updateHiddenTransactionCount();
}

/**
 * Updates the hidden transaction count badge in the batch-unhide toolbar.
 * Counts how many hidden rows are currently rendered in the table.
 */
function _updateHiddenTransactionCount() {
  const countEl = document.getElementById('hidden-txn-count');
  if (!countEl) return;

  const hiddenCheckboxes = document.querySelectorAll('.hidden-txn-checkbox');
  const count = hiddenCheckboxes.length;
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

  const txn = transactions.find(t => t.transaction_id === txnId);
  const currentMemo = txn ? (txn.user_memo || '') : '';

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
