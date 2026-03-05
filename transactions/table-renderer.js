// ============================================================
// transactions/table-renderer.js — Transaction Table Rendering
// Builds the filtered, sorted HTML table of transactions
// including split-group rendering and memo save.
// ============================================================

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

    // Hide transfers if requested (checks personal finance primary category,
    // transfer_pair_id, and [AccountName] category notation)
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) {
        return false;
      }
      if (txn.transfer_pair_id || isTransferCategory(txn.user_category)) {
        return false;
      }
    }

    // Filter by overrides only if requested
    const showOverridesOnly = document.getElementById('show-overrides-only').checked;
    if (showOverridesOnly && !txn.is_override) {
      return false;
    }
    
    // Filter by category (primary and/or detailed)
    if (filterPrimaryCategory || filterDetailedCategory) {
      // For split transactions, check if any split child matches the filter
      if (txn.is_split && txn.splits && txn.splits.length > 0) {
        // Check if at least one split child matches the category filter
        const hasMatchingSplit = txn.splits.some(split => {
          const splitCategoryStr = split.user_category
            || (split.personal_finance_category
              ? `${split.personal_finance_category.primary || ''}${split.personal_finance_category.detailed ? ': ' + split.personal_finance_category.detailed : ''}`
              : '');
          
          const parsed = parseCategoryString(splitCategoryStr);
          
          // Check if this split matches the filter criteria
          let matches = true;
          if (filterPrimaryCategory && parsed.primary !== filterPrimaryCategory) {
            matches = false;
          }
          if (filterDetailedCategory && parsed.detailed !== filterDetailedCategory) {
            matches = false;
          }
          return matches;
        });
        
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
  // 2. Missing (source='scheduled', status='missing')
  // 3. Pending (pending=true)
  // 4. Cleared/posted (everything else)
  // In All Accounts view: hide OB, MOB, reconciliation
  const isAllAccounts = selectedAccountMode === 'all';
  const showMissingOrphaned = document.getElementById('show-missing-orphaned')?.checked ?? false;

  const scheduledFuture = [];
  const missingTransactions = [];
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

    // Orphaned / missing — governed by the show-missing-orphaned toggle
    const txnType = getTransactionType(txn);
    const isOrphanedTxn = txnType === TXN_TYPE.MANUAL_MISSING || txnType === TXN_TYPE.MANUAL_ORPHANED;
    const isMissingTxn = txnType === TXN_TYPE.BILL_MISSING;
    if (isOrphanedTxn || isMissingTxn) {
      if (showMissingOrphaned) {
        missingTransactions.push(txn);
      }
      return;
    }

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

  // Sort helper: date descending, then transaction ID descending within same day
  // Mirrors backend balance engine order (date ASC, txn_id ASC) reversed
  const sortNewestFirst = (rowA, rowB) => {
    const dateComparison = _transferSortDate(rowB).localeCompare(_transferSortDate(rowA));
    if (dateComparison !== 0) return dateComparison;
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
  missingTransactions.sort(sortNewestFirst);
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
  // scheduled future → missing → pending → cleared/posted
  const hasPendingToShow = showPendingEnabled && pendingTransactions.length > 0;
  const hasScheduledToShow = scheduledFuture.length > 0;
  const hasMissingToShow = missingTransactions.length > 0;

  const allRowTransactions = [
    ...scheduledFuture,
    ...missingTransactions,
    ...(hasPendingToShow ? pendingTransactions : []),
    ...postedTransactions,
  ];
  // Block boundary tracking flags
  let scheduledSectionEnded = !hasScheduledToShow;
  let missingSectionEnded = !hasMissingToShow;
  let pendingSectionEnded = !hasPendingToShow;
  
  let html = '<table><thead><tr>';
  html += '<th>Date</th>';
  html += '<th>Bank/Account</th>';
  html += '<th>Description</th>';
  
  // In single account view: amount goes 2nd-from-right (before ledger column)
  // In all accounts view: amount stays in normal position
  if (!showLedgerColumn) {
    html += '<th>Amount</th>';
  }
  
  if (optionalFields.includes('source')) html += '<th>Source</th>';
  html += '<th class="th-category">Category</th>';
  
  // Add optional headers
  if (optionalFields.includes('merchant_name')) html += '<th>Merchant</th>';
  if (optionalFields.includes('payment_channel')) html += '<th>Channel</th>';
  if (optionalFields.includes('check_number')) html += '<th>Check #</th>';
  if (optionalFields.includes('original_description')) html += '<th>Original Desc</th>';
  if (optionalFields.includes('authorized_date')) html += '<th>Auth Date</th>';
  if (optionalFields.includes('authorized_datetime')) html += '<th>Auth Time</th>';
  if (optionalFields.includes('personal_finance_category')) html += '<th>Plaid Category</th>';
  if (optionalFields.includes('user_memo')) html += '<th>Memo</th>';
  
  // In single account view, add amount column here (2nd-from-right)
  // and then ledger column will be the rightmost
  if (showLedgerColumn) {
    html += '<th>Amount</th>';
    html += '<th>Balance Ledger</th>';
  }
  
  html += '<th style="width: 40px;"></th>'; // Delete button column 
  // TODO: 3f: move delete button to be an icon in the description column to save horizontal space and avoid accidental clicks

  html += '</tr></thead>';
  
  // Calculate column count for separator row
  let colCount = 4; // Date, Bank, Description, Delete
  if (!showLedgerColumn) colCount++; // Amount in normal position
  if (optionalFields.includes('source')) colCount++;
  colCount++; // Category
  if (optionalFields.includes('merchant_name')) colCount++;
  if (optionalFields.includes('payment_channel')) colCount++;
  if (optionalFields.includes('check_number')) colCount++;
  if (optionalFields.includes('original_description')) colCount++;
  if (optionalFields.includes('authorized_date')) colCount++;
  if (optionalFields.includes('authorized_datetime')) colCount++;
  if (optionalFields.includes('personal_finance_category')) colCount++;
  if (optionalFields.includes('user_memo')) colCount++;
  if (showLedgerColumn) colCount += 2; // Amount + Balance Ledger
  
  // Open first tbody based on which block comes first
  if (hasScheduledToShow) {
    html += '<tbody class="scheduled-tbody">';
  } else if (hasMissingToShow) {
    html += '<tbody class="missing-tbody">';
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
    // isFutureBlockRow: true for ANY transaction that belongs above the
    // future/cleared separator — scheduled bills AND manual transactions
    // with dates after today. Used only for block-boundary logic.
    const isFutureBlockRow = (txn.source === 'scheduled' && txn.status === 'future')
      || getTransactionType(txn) === TXN_TYPE.MANUAL_FUTURE;
    const txnRowType = getTransactionType(txn);
    const isMissingRow = txnRowType === TXN_TYPE.BILL_MISSING
      || txnRowType === TXN_TYPE.MANUAL_MISSING
      || txnRowType === TXN_TYPE.MANUAL_ORPHANED;
    const isPendingRow = !!txn.pending;

    // --- Block boundary separators ---
    // Separator: end of future block → start of missing or pending or posted
    if (!scheduledSectionEnded && !isFutureBlockRow) {
      scheduledSectionEnded = true;
      const schedCount = scheduledFuture.length;
      html += `<tr class="scheduled-separator-row"><td colspan="${colCount}">▲ ${schedCount} Future Transaction${schedCount !== 1 ? 's' : ''} Above ▲</td></tr>`;
      html += '</tbody>';
      if (isMissingRow) {
        html += '<tbody class="missing-tbody">';
      } else if (isPendingRow) {
        html += '<tbody class="pending-tbody">';
      } else {
        html += '<tbody>';
      }
    }

    // Separator: end of missing block → start of pending or posted
    if (!missingSectionEnded && !isMissingRow && !isFutureBlockRow) {
      missingSectionEnded = true;
      const missCount = missingTransactions.length;
      html += `<tr class="missing-separator-row"><td colspan="${colCount}">▲ ${missCount} Missing/Orphaned Transaction${missCount !== 1 ? 's' : ''} Above ▲</td></tr>`;
      html += '</tbody>';
      if (isPendingRow) {
        html += '<tbody class="pending-tbody">';
      } else {
        html += '<tbody>';
      }
    }

    // Separator: end of pending block → start of posted
    if (!pendingSectionEnded && !isPendingRow && !isFutureBlockRow && !isMissingRow) {
      pendingSectionEnded = true;
      const pendingCount = pendingTransactions.length;
      html += `<tr class="pending-separator-row"><td colspan="${colCount}">▲ ${pendingCount} Pending Transaction${pendingCount !== 1 ? 's' : ''} Above ▲</td></tr>`;
      html += '</tbody><tbody>';
    }

    // --- Zone bookmark separators (plaid-synced / manual-historical) ---
    // Only rendered in single-account view when both OB and manual OB exist.
    if (hasManualOB && !isPendingRow && !isFutureBlockRow && !isMissingRow) {
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
        const dateStr = new Date(txn.date).toLocaleDateString('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'
        });
        const formattedAmount = new Intl.NumberFormat('en-US', {
          style: 'currency', currency: txn.iso_currency_code || 'USD'
        }).format(parentAmount);
        const parentAmountCellClass = parentAmount < 0
          ? 'ledger-amount-cell ledger-negative'
          : 'ledger-amount-cell';
        const pendingBadge = isPendingRow ? '<span class="pending-badge">Pending</span> ' : '';
        const rowClass = `split-mismatch-row${isPendingRow ? ' pending-row' : ''}`;

        html += `<tr class="${rowClass}" data-txn-id="${escapeHtml(parentTxnId)}" data-source="${escapeHtml(txn.source || '')}">
          <td>${escapeHtml(dateStr)}</td>
          <td>${escapeHtml(txn.bank_account || '')}</td>
          <td>${pendingBadge}${escapeHtml(txn.name || '—')}</td>`;

        if (!showLedgerColumn) {
          html += `<td>${formattedAmount}</td>`;
        }

        if (optionalFields.includes('source')) {
          const sourceLabel = txn.is_manual ? 'Manual' : 'Plaid';
          html += `<td><span class="source-badge ${txn.is_manual ? 'manual' : 'plaid'}">${sourceLabel}</span></td>`;
        }

        html += `<td class="split-mismatch-cell">
          <span class="split-mismatch-badge" title="Split amounts no longer add up to the transaction total. This can happen when a matched transaction has a different amount than the original.">⚠ Split broken</span>
          <button class="split-badge-btn split-repair-badge" onclick="modifySplitModal('${escapeHtml(parentTxnId)}')" title="Repair splits — amounts no longer match parent total">Repair</button>
          <button class="split-badge-btn split-delete-badge" onclick="handleDeleteSplit('${escapeHtml(parentTxnId)}')" title="Delete all splits and revert to unsplit">🗑</button>
        </td>`;

        // Fill remaining optional columns
        if (optionalFields.includes('merchant_name')) html += `<td>${escapeHtml(txn.merchant_name || '')}</td>`;
        if (optionalFields.includes('payment_channel')) html += `<td>${escapeHtml(txn.payment_channel || '')}</td>`;
        if (optionalFields.includes('check_number')) html += `<td>${escapeHtml(txn.check_number || '')}</td>`;
        if (optionalFields.includes('original_description')) html += `<td>${escapeHtml(txn.original_description || '')}</td>`;
        if (optionalFields.includes('authorized_date')) html += `<td>${escapeHtml(txn.authorized_date || '')}</td>`;
        if (optionalFields.includes('authorized_datetime')) html += '<td></td>';
        if (optionalFields.includes('personal_finance_category')) html += '<td></td>';
        if (optionalFields.includes('user_memo')) html += `<td>${escapeHtml(txn.user_memo || '')}</td>`;

        if (showLedgerColumn) {
          html += `<td class="${parentAmountCellClass}">${formattedAmount}</td>`;
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
      
      // Filter and render each split child as actual table rows
      let renderedSplitCount = 0;
      txn.splits.forEach((split, idx) => {
        // Apply category filter to individual splits
        if (filterPrimaryCategory || filterDetailedCategory) {
          const splitCategoryStr = split.user_category
            || (split.personal_finance_category
              ? `${split.personal_finance_category.primary || ''}${split.personal_finance_category.detailed ? ': ' + split.personal_finance_category.detailed : ''}`
              : '');
          
          const parsed = parseCategoryString(splitCategoryStr);
          
          // Check if this split matches the filter criteria
          if (filterPrimaryCategory && parsed.primary !== filterPrimaryCategory) {
            return; // Skip this split
          }
          if (filterDetailedCategory && parsed.detailed !== filterDetailedCategory) {
            return; // Skip this split
          }
        }
        
        renderedSplitCount++;
        const dateStr = new Date(split.date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          timeZone: 'UTC'
        });
        
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
        const isFirstSplit = renderedSplitCount === 1;
        const isLastSplit = renderedSplitCount === txn.splits.filter(s => {
          if (filterPrimaryCategory || filterDetailedCategory) {
            const sCategoryStr = s.user_category
              || (s.personal_finance_category
                ? `${s.personal_finance_category.primary || ''}${s.personal_finance_category.detailed ? ': ' + s.personal_finance_category.detailed : ''}`
                : '');
            const sParsed = parseCategoryString(sCategoryStr);
            if (filterPrimaryCategory && sParsed.primary !== filterPrimaryCategory) return false;
            if (filterDetailedCategory && sParsed.detailed !== filterDetailedCategory) return false;
          }
          return true;
        }).length;
        const rowClass = `split-child-row ${isFirstSplit ? 'split-first' : ''} ${isLastSplit ? 'split-last' : ''}${isPendingRow ? ' pending-row' : ''}`;
        
        const pendingBadge = isPendingRow ? '<span class="pending-badge">Pending</span> ' : '';
        html += `<tr class="${rowClass}">
          <td>${escapeHtml(dateStr)}</td>
          <td>${escapeHtml(split.bank_account || txn.bank_account || '')}</td>
          <td>${pendingBadge}${escapeHtml(split.name || '—')}</td>`;
        
        // When ledger column is NOT shown, amount stays in normal position
        if (!showLedgerColumn) {
          html += `<td>${amount}</td>`;
        }
        
        // Add source column if needed
        if (optionalFields.includes('source')) {
          const sourceLabel = split.is_manual ? 'Manual' : 'Plaid';
          const sourceBadge = `<span class="source-badge ${split.is_manual ? 'manual' : 'plaid'}">${sourceLabel}</span>`;
          html += `<td>${sourceBadge}</td>`;
        }
        
        // Parse split category - prioritize user_category over personal_finance_category
        let splitCategoryDisplay = 'Uncategorized';
        if (split.user_category) {
          splitCategoryDisplay = split.user_category;
        } else if (split.personal_finance_category?.detailed) {
          splitCategoryDisplay = split.personal_finance_category.detailed;
        }
        
        html += `<td class="split-category-cell">${escapeHtml(splitCategoryDisplay)}</td>`;
        
        // Add optional field columns
        if (optionalFields.includes('merchant_name')) {
          html += `<td>${escapeHtml(split.merchant_name || '')}</td>`;
        }
        if (optionalFields.includes('payment_channel')) {
          html += `<td>${escapeHtml(split.payment_channel || '')}</td>`;
        }
        if (optionalFields.includes('check_number')) {
          html += `<td>${escapeHtml(split.check_number || '')}</td>`;
        }
        if (optionalFields.includes('original_description')) {
          html += `<td>${escapeHtml(split.original_description || '')}</td>`;
        }
        if (optionalFields.includes('authorized_date')) {
          html += `<td>${escapeHtml(split.authorized_date || '')}</td>`;
        }
        if (optionalFields.includes('authorized_datetime')) {
          let authTime = '';
          if (split.authorized_datetime) {
            const dt = new Date(split.authorized_datetime);
            authTime = dt.toLocaleString('en-US', {
              year: 'numeric', 
              month: '2-digit', 
              day: '2-digit',
              hour: '2-digit', 
              minute: '2-digit',
              second: '2-digit',
              timeZoneName: 'short'
            });
          }
          html += `<td>${escapeHtml(authTime)}</td>`;
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
          html += `<td>${escapeHtml(plaidCategoryDisplay)}</td>`;
        }
        if (optionalFields.includes('user_memo')) {
          html += `<td>${escapeHtml(split.user_memo || '')}</td>`;
        }
        
        // Add split action badges on first row only
        if (isFirstSplit) {
          // When ledger is shown, add amount + ledger columns for split rows
          if (showLedgerColumn) {
            html += `<td class="${splitAmountCellClass}">${amount}</td>`;
            // Top child shows the parent transaction's running balance
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
            <span class="split-badge-inline">Split</span>
            <button class="split-badge-btn split-modify-badge" onclick="modifySplitModal('${escapeHtml(parentTxnId)}')" title="Modify splits">✎</button>
            <button class="split-badge-btn split-delete-badge" onclick="handleDeleteSplit('${escapeHtml(parentTxnId)}')" title="Delete splits">🗑</button>
          </td>`;
        } else {
          // Non-top split children: show amount but dash for ledger
          if (showLedgerColumn) {
            html += `<td class="${splitAmountCellClass}">${amount}</td>`;
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
    const _dateFormatOpts = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' };
    const ownDateStr = new Date(txn.date).toLocaleDateString('en-US', _dateFormatOpts);
    let dateStr = ownDateStr;
    const hasTransferPartnerDate = txn.transfer_pair_id
      && txn.transfer_partner_date
      && txn.transfer_partner_date !== txn.date;
    if (hasTransferPartnerDate) {
      const partnerDateStr = new Date(txn.transfer_partner_date).toLocaleDateString('en-US', _dateFormatOpts);
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
    let ledgerBalanceHtml = '';
    if (showLedgerColumn) {
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

    // ── Data attributes for context menu ──
    const rowDataAttrs = ` data-txn-id="${escapeHtml(txnId)}" data-source="${escapeHtml(txn.source || '')}" data-status="${escapeHtml(txn.status || '')}" data-pending="${!!txn.pending}" data-is-bill="${!!txn.is_bill}" data-bill-id="${escapeHtml(txn.bill_id || '')}" data-account-id="${escapeHtml(accountId)}" data-amount="${txn.amount || 0}" data-is-split="${!!txn.is_split}" data-txn-name="${escapeHtml(txn.name || '')}" data-user-category="${escapeHtml(txn.user_category || '')}" data-merchant-name="${escapeHtml(txn.merchant_name || '')}" data-match-manual-txn-id="${escapeHtml(txn.match_info?.matched_txn_id || '')}"`;

    // ── Assemble the row ──
    const rowCssClass = rendered.rowCssClass;
    html += `<tr${rowCssClass ? ` class="${rowCssClass}"` : ''}${rowDataAttrs}>`;
    html += `<td>${dateStr}</td>`;
    html += `<td>${txn.bank_account}</td>`;
    html += `<td>${fullBadge}${pendingBadge}${rendered.displayName}</td>`;

    if (!showLedgerColumn) {
      html += `<td>${amount}</td>`;
    }

    // Source badge column (optional field)
    if (optionalFields.includes('source')) {
      const sb = rendered.sourceBadge;
      html += `<td><span class="source-badge ${sb.cssClass}" data-tooltip="${sb.title}">${sb.label}</span></td>`;
    }

    // Category cell
    html += `<td>${rendered.categoryCell}</td>`;

    // Optional field cells (type-agnostic)
    if (optionalFields.includes('merchant_name')) html += `<td>${txn.merchant_name || ''}</td>`;
    if (optionalFields.includes('payment_channel')) html += `<td>${txn.payment_channel || ''}</td>`;
    if (optionalFields.includes('check_number')) html += `<td>${txn.check_number || ''}</td>`;
    if (optionalFields.includes('original_description')) html += `<td>${txn.original_description || ''}</td>`;
    if (optionalFields.includes('authorized_date')) html += `<td>${txn.authorized_date || ''}</td>`;
    if (optionalFields.includes('authorized_datetime')) {
      let authTime = '';
      if (txn.authorized_datetime) {
        const dt = new Date(txn.authorized_datetime);
        authTime = dt.toLocaleString('en-US', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          timeZoneName: 'short'
        });
      }
      html += `<td>${authTime}</td>`;
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
      html += `<td>${escapeHtml(plaidCategoryDisplay)}</td>`;
    }
    if (optionalFields.includes('user_memo')) {
      const safeMemoValue = escapeHtml(txn.user_memo || '');
      html += `
        <td>
          <div style="display: flex; gap: 3px; align-items: center;">
            <input class="memo-input" type="text" maxlength="256" value="${safeMemoValue}" placeholder="Add memo…">
            <button class="memo-save" data-txn-id="${txnId}">Save</button>
          </div>
        </td>
      `;
    }

    // Ledger columns (single-account view)
    if (showLedgerColumn) {
      html += `<td class="${amountCellClass}">${amount}</td>`;
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
}

async function saveTransactionMemo(transactionId, userMemo, buttonEl) {
  if (!transactionId) {
    showStatus('Unable to save memo: missing transaction id', 'error');
    return;
  }

  const trimmedMemo = (userMemo || '').toString().slice(0, 256);

  if (buttonEl) {
    buttonEl.prop('disabled', true).text('Saving...');
  }

  try {
    // Determine if this is a manual or Plaid transaction
    const txn = transactions.find(t => t.transaction_id === transactionId);
    const memoTxnType = txn ? getTransactionType(txn) : null;
    const isManual = memoTxnType && (
      memoTxnType === TXN_TYPE.MANUAL_CLEARED
      || memoTxnType === TXN_TYPE.SYSTEM_OPENING_BALANCE
      || memoTxnType === TXN_TYPE.SYSTEM_MANUAL_OPENING_BALANCE
    );
    
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
      
      // Update localStorage with the modified transaction
      try {
        localStorage.setItem('pf_cached_transactions', JSON.stringify(transactions));
        localStorage.setItem('pf_transactions_cached_at', String(Date.now()));
      } catch (e) {
        console.warn('Could not update cached transactions in localStorage:', e);
      }
    }

    showStatus('Memo saved successfully', 'success');
  } catch (error) {
    showStatus(`Failed to save memo: ${error.message}`, 'error');
  } finally {
    if (buttonEl) {
      buttonEl.prop('disabled', false).text('Save');
    }
  }
}
