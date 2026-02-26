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
  
  // Separate pending from posted transactions
  const pendingTransactions = filteredTransactions.filter(txn => txn.pending);
  const postedTransactions = filteredTransactions.filter(txn => !txn.pending);
  
  // Sort helper: date descending, then transaction ID descending within same day
  // Mirrors backend balance engine order (date ASC, txn_id ASC) reversed
  const sortNewestFirst = (rowA, rowB) => {
    const dateComparison = rowB.date.localeCompare(rowA.date);
    if (dateComparison !== 0) return dateComparison;
    const idA = rowA.transaction_id || '';
    const idB = rowB.transaction_id || '';
    return idB.localeCompare(idA);
  };
  
  postedTransactions.sort(sortNewestFirst);
  pendingTransactions.sort(sortNewestFirst);
  
  // Compute projected ledger balances for pending transactions.
  // Pending txns are excluded from backend balance history, so we project
  // forward from the account's current_balance (which reflects all posted txns).
  const pendingLedgerLookup = {};
  const showLedgerColumn = selectedAccountMode === 'single' && selectedAccountId;
  
  if (showLedgerColumn && pendingTransactions.length > 0) {
    const selectedAccount = accounts.find(account => account.account_id === selectedAccountId);
    const currentPostedBalance = selectedAccount ? selectedAccount.current_balance : 0;
    
    // Walk pending in balance-engine order (date ASC, txn_id ASC) to accumulate
    const pendingAscending = [...pendingTransactions].reverse();
    let runningProjected = currentPostedBalance;
    pendingAscending.forEach(txn => {
      // Amount is already in ledger convention (positive=inflow, negative=outflow)
      runningProjected += txn.amount;
      const lookupKey = txn.transaction_id;
      if (lookupKey) {
        pendingLedgerLookup[lookupKey] = runningProjected;
      }
    });
  }
  
  // Build the combined rendering list: pending rows first, then posted
  const hasPendingToShow = showPendingEnabled && pendingTransactions.length > 0;
  const allRowTransactions = hasPendingToShow
    ? [...pendingTransactions, ...postedTransactions]
    : postedTransactions;
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
  html += '<th>Category</th>';
  
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
  
  // Open first tbody — pending if applicable, otherwise posted
  if (hasPendingToShow) {
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
    // Insert separator row when transitioning from pending to posted section
    if (!pendingSectionEnded && !txn.pending) {
      pendingSectionEnded = true;
      const pendingCount = pendingTransactions.length;
      html += `<tr class="pending-separator-row"><td colspan="${colCount}">▲ ${pendingCount} Pending Transaction${pendingCount !== 1 ? 's' : ''} Above ▲</td></tr>`;
      html += '</tbody><tbody>'; // End pending tbody, start posted tbody
    }
    
    const isPendingRow = !!txn.pending;

    // --- Zone bookmark separators ---
    // Only rendered when both opening_balance and manual_opening_balance exist.
    // "Plaid-Synced" sits ABOVE the opening_balance row (only when plaid txns exist).
    // "Manual Historical" sits BELOW the opening_balance row.
    // Why ordered this way: the manual-sep check must come first so it fires on
    // the iteration AFTER we process the OB row (passedOpeningBalance is already
    // true), before we'd ever re-enter the plaid-sep branch.
    if (hasManualOB && !isPendingRow) {
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
            html += `<td class="ledger-amount-cell">${amount}</td>`;
            // Top child shows the parent transaction's running balance
            const parentLookupKey = txn.transaction_id;
            const parentRunningBalance = isPendingRow
              ? pendingLedgerLookup[parentLookupKey]
              : balanceHistoryLookup[parentLookupKey];
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
            html += `<td class="ledger-amount-cell">${amount}</td>`;
            html += '<td class="ledger-cell ledger-unavailable">—</td>';
          }
          html += `<td></td>`;
        }
        
        html += `</tr>`;
      });
      
      renderedTxnIds.add(txn.transaction_id);
      return;
    }

    
    // Normal transaction rendering (not split)
    // Parse the date string properly
    const dateStr = new Date(txn.date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC'
    });
    
    // Amount is already in ledger convention:
    // positive = money in (deposits, refunds), negative = money out (purchases, charges)
    const displayAmount = txn.amount;
    const amount = new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: txn.iso_currency_code || 'USD' 
    }).format(displayAmount);
    
    // Look up running balance from the balance-history data fetched when account was selected
    // For pending rows, use the projected balance computed from current_balance
    let ledgerBalanceHtml = '';
    if (showLedgerColumn) {
      const lookupKey = txn.transaction_id;
      const runningBalance = isPendingRow
        ? pendingLedgerLookup[lookupKey]
        : balanceHistoryLookup[lookupKey];
      if (runningBalance !== undefined) {
        const formattedBalance = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: txn.iso_currency_code || 'USD'
        }).format(runningBalance);
        const negativeClass = runningBalance < 0 ? ' ledger-negative' : '';
        ledgerBalanceHtml = `<td class="ledger-cell${negativeClass}">${formattedBalance}</td>`;
      } else {
        ledgerBalanceHtml = '<td class="ledger-cell ledger-unavailable">—</td>';
      }
    }
    
    const pendingBadge = isPendingRow ? '<span class="pending-badge">Pending</span> ' : '';
    html += `<tr${isPendingRow ? ' class="pending-row"' : ''}>`;
    html += `<td>${dateStr}</td>`;
    html += `<td>${txn.bank_account}</td>`;
    html += `<td>${pendingBadge}${txn.name || ''}</td>`;
    
    // In all accounts view, add amount here; in single account view, it goes later
    if (!showLedgerColumn) {
      html += `<td>${amount}</td>`;
    }

    // Determine source and transaction IDs
    const isOpeningBalance = txn.source === 'opening_balance' || txn.source === 'manual_opening_balance';
    const isManual = txn.source === 'manual' || isOpeningBalance;
    const txnId = txn.transaction_id || '';
    const accountId = txn.account_id || '';
    
    // Add source badge if source field is selected
    if (optionalFields.includes('source')) {
      let sourceLabel, sourceCssClass, sourceTitle;
      if (isOpeningBalance) {
        sourceLabel = 'Opening Bal';
        sourceCssClass = 'opening-balance';
        sourceTitle = txn.source === 'manual_opening_balance' ? 'Auto-generated manual opening balance' : 'Opening balance';
      } else if (txn.source === 'manual') {
        sourceLabel = 'Manual';
        sourceCssClass = 'manual';
        sourceTitle = 'Added manually by user';
      } else {
        sourceLabel = 'Plaid';
        sourceCssClass = 'plaid';
        sourceTitle = 'From Plaid';
      }
      const sourceBadge = `<span class="source-badge ${sourceCssClass}" title="${sourceTitle}">${sourceLabel}</span>`;
      html += `<td>${sourceBadge}</td>`;
    }
    
    // Parse current user_category to get primary and detailed
    let currentParsed = { primary: '', detailed: '' };
    const isTransfer = isTransferCategory(txn.user_category) || !!txn.transfer_pair_id;
    if (txn.user_category) {
      currentParsed = parseCategoryString(txn.user_category);
    } else if (txn.personal_finance_category) {
      // Fallback to Plaid's personal_finance_category if no user_category
      const pfc = txn.personal_finance_category;
      const displayNames = getCategoryDisplayNames(pfc);
      currentParsed = {
        primary: displayNames.primary,
        detailed: displayNames.trimmed
      };
    }

    // Build the current full category string for the autocomplete.
    // For transfers, use the raw [AccountName] string directly rather than
    // feeding it through buildCategoryString which expects Primary: Detailed.
    const currentFullCategory = isTransfer
      ? (txn.user_category || '')
      : buildCategoryString(currentParsed.primary, currentParsed.detailed);

    // Create combined category cell with autocomplete input + buttons
    // Opening balance transactions have locked category — no overrides, rules, or splits allowed
    let categoryCell;
    if (isOpeningBalance) {
      const openingBalBadge = '<span class="source-badge opening-balance" title="Opening balance — category is locked">Opening Bal</span>';
      categoryCell = `<div class="category-cell"><div class="category-display">${openingBalBadge}${escapeHtml(currentFullCategory || 'Uncategorized')}</div></div>`;
    } else if (isTransfer) {
      // Transfer transaction: show transfer badge with account name + unlink button
      const transferAccountName = parseTransferAccountName(txn.user_category || '');
      const transferDisplayHtml = transferAccountName
        ? `<span class="transfer-badge" title="Transfer to/from ${escapeHtml(transferAccountName)}">&#x21C4; Transfer</span> ${escapeHtml(transferAccountName)}`
        : `<span class="transfer-badge">&#x21C4; Transfer</span>`;

      categoryCell = txnId ? `
        <div class="category-cell">
          <div class="category-display">${transferDisplayHtml}</div>
          <div class="category-autocomplete-wrap" data-txn-id="${txnId}">
            <input type="text" class="category-autocomplete" data-txn-id="${txnId}" data-account-id="${accountId}"
                   value="${escapeHtml(currentFullCategory)}" placeholder="Type [ to reassign transfer…"
                   autocomplete="off" spellcheck="false">
            <div class="category-ac-list" data-txn-id="${txnId}"></div>
          </div>
          <div class="category-buttons">
            <button class="category-override" data-txn-id="${txnId}" data-account-id="${accountId}">Override</button>
            <button class="transfer-unlink-btn" data-txn-id="${txnId}" onclick="unlinkTransfer('${escapeHtml(txnId)}')" title="Break this transfer pair">Unlink</button>
          </div>
        </div>
      ` : '<span class="pill">N/A</span>';
    } else {
      const overrideBadge = txn.is_override
        ? `<span class="override-badge" title="This transaction has a manual override — rules will not change its category">Override <button class='clear-override' data-txn-id='${txnId}' onclick='clearOverride(event)'>X</button></span>`
        : '';
      
      // Build split badge if transaction can be split
      const splitBadge = (!txn.is_split) ? '' : `<span class="split-badge" title="This transaction is split">Split</span>`;
      
      categoryCell = txnId ? `
        <div class="category-cell">
          <div class="category-display">${splitBadge}${overrideBadge}${escapeHtml(currentFullCategory || 'Uncategorized')}</div>
          <div class="category-autocomplete-wrap" data-txn-id="${txnId}">
            <input type="text" class="category-autocomplete" data-txn-id="${txnId}" data-account-id="${accountId}"
                   value="${escapeHtml(currentFullCategory)}" placeholder="Type to search categories…"
                   autocomplete="off" spellcheck="false">
            <div class="category-ac-list" data-txn-id="${txnId}"></div>
          </div>
          <div class="category-buttons">
            <button class="category-override" data-txn-id="${txnId}" data-account-id="${accountId}">Override</button>
            <button class="category-rule" data-txn-id="${txnId}" data-account-id="${accountId}">Rule</button>
            <button class="category-split" data-txn-id="${txnId}" onclick="window.splitModalTxnId='${escapeHtml(txnId)}'; openSplitModal(transactions.find(t => t.transaction_id === '${escapeHtml(txnId)}')); return false;" title="Split this transaction">Split</button>
          </div>
        </div>
      ` : '<span class="pill">N/A</span>';
    }
    html += `<td>${categoryCell}</td>`;

    // Add optional cells
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
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
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
        const memoValue = txn.user_memo || '';
        const safeMemoValue = escapeHtml(memoValue);
        html += `
          <td>
            <div style="display: flex; gap: 3px; align-items: center;">
              <input class="memo-input" type="text" maxlength="256" value="${safeMemoValue}" style="width: 100%; min-width: 100px; padding: 2px 4px; font-size: 12px;">
              <button class="memo-save" data-txn-id="${txnId}" style="padding: 2px 6px; font-size: 10px;">Save</button>
            </div>
          </td>
        `;
    }

    // In single account view, add amount and balance ledger columns before delete button
    if (showLedgerColumn) {
      html += `<td class="ledger-amount-cell">${amount}</td>`;
      html += ledgerBalanceHtml;
    }

    // Add delete button for manual transactions only (not opening balance or plaid)
    if (txn.source === 'manual') {
      html += `
        <td style="text-align: center;">
          <button class="delete-transaction-btn" onclick="deleteManualTransaction('${escapeHtml(txnId)}')" title="Delete manual transaction">🗑</button>
        </td>
      `;
    } else {
      html += '<td></td>'; // Empty cell for Plaid and opening balance transactions
    }

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
    const isManual = txn && (txn.source === 'manual' || txn.source === 'opening_balance' || txn.source === 'manual_opening_balance');
    
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
