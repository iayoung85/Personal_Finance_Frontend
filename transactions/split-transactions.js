// ============================================================
// transactions/split-transactions.js — Split Transaction UI
// Modal for creating / modifying / deleting split transactions.
// NOTE: currentSplitTransaction, splitRows, isEditingSplit are
// declared in state.js so they're shared across modules.
// ============================================================

// Open split modal for creating a new split
function openSplitModal(txn) {
  currentSplitTransaction = txn;
  isEditingSplit = false;
  splitRows = [];
  
  // Populate original transaction data
  const dateStr = new Date(txn.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC'
  });
  
  const amountFormatted = new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: txn.iso_currency_code || 'USD' 
  }).format(txn.amount);
  
  document.getElementById('split-modal-title').textContent = 'Create Split Transaction';
  document.getElementById('split-orig-date').textContent = dateStr;
  document.getElementById('split-orig-description').textContent = txn.name || '';
  document.getElementById('split-orig-account').textContent = txn.bank_account || '';
  document.getElementById('split-orig-amount').textContent = amountFormatted;
  
  // Initialize with 2 empty split rows
  document.getElementById('split-rows').innerHTML = '';
  addSplitRow();
  addSplitRow();
  
  // Show modal
  document.getElementById('split-modal').classList.remove('hidden');
  
  // Initialize validation display
  updateSplitValidation();
}

// Open split modal for editing existing split
async function modifySplitModal(splitTransactionId) {
  try {
    // Get split data from backend
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/split/${splitTransactionId}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to fetch split data');
    }
    
    const data = await response.json();
    const splits = data.splits || [];
    
    if (splits.length === 0) {
      showStatus('No splits found', 'error');
      return;
    }
    
    // Find parent transaction
    const firstSplit = splits[0];
    const parentId = firstSplit.split_transaction_id.replace('split_', '');
    const parentTxn = transactions.find(t => 
      t.plaid_transaction_id === parentId || t.manual_transaction_id === parentId
    );
    
    if (!parentTxn) {
      showStatus('Parent transaction not found', 'error');
      return;
    }
    
    currentSplitTransaction = parentTxn;
    isEditingSplit = true;
    splitRows = [];
    
    // Populate original transaction data
    const dateStr = new Date(parentTxn.date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC'
    });
    
    const amountFormatted = new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: parentTxn.iso_currency_code || 'USD' 
    }).format(parentTxn.amount);
    
    document.getElementById('split-modal-title').textContent = 'Modify Split Transaction';
    document.getElementById('split-orig-date').textContent = dateStr;
    document.getElementById('split-orig-description').textContent = parentTxn.name || '';
    document.getElementById('split-orig-account').textContent = parentTxn.bank_account || '';
    document.getElementById('split-orig-amount').textContent = amountFormatted;
    
    // Populate split rows with existing data
    document.getElementById('split-rows').innerHTML = '';
    splits.forEach(split => {
      addSplitRow(
        split.amount,
        split.user_category || split.personal_finance_category?.detailed || '',
        split.user_memo || ''
      );
    });
    
    // Show modal
    document.getElementById('split-modal').classList.remove('hidden');
    updateSplitValidation();
    
  } catch (error) {
    showStatus(`Error loading split data: ${error.message}`, 'error');
  }
}

// Add a split row to the modal
function addSplitRow(amount = '', category = '', memo = '') {
  const splitRowsContainer = document.getElementById('split-rows');
  const rowIndex = splitRows.length;
  
  const rowDiv = document.createElement('div');
  rowDiv.className = 'split-row';
  rowDiv.id = `split-row-${rowIndex}`;
  
  rowDiv.innerHTML = `
    <div>
      <div class="split-row-label">Amount</div>
      <input type="number" step="0.01" value="${amount}" placeholder="0.00" class="split-amount-input" 
             onchange="updateSplitValidation()" oninput="updateSplitValidation()">
    </div>
    <div>
      <div class="split-row-label">Category</div>
      <div class="split-category-autocomplete-wrap" data-split-row-id="${rowIndex}">
        <input type="text" value="${escapeHtml(category)}" placeholder="Type category..." 
               class="split-category-autocomplete" data-split-row-id="${rowIndex}"
               onchange="updateSplitValidation()" oninput="updateSplitValidation()">
        <div class="split-category-ac-list" data-split-row-id="${rowIndex}"></div>
      </div>
    </div>
    <div>
      <div class="split-row-label">Memo (Optional)</div>
      <input type="text" value="${escapeHtml(memo)}" placeholder="Enter memo..." class="split-memo-input" maxlength="256">
    </div>
    <button type="button" class="split-row-remove" onclick="removeSplitRow(${rowIndex})" title="Remove this split">−</button>
  `;
  
  splitRowsContainer.appendChild(rowDiv);
  splitRows.push({ rowIndex, element: rowDiv });
  
  // Attach autocomplete event handlers to the new row
  attachSplitCategoryAutocomplete(rowIndex);
}

// Attach autocomplete event handlers to split category input
function attachSplitCategoryAutocomplete(rowIndex) {
  const input = document.querySelector(`.split-category-autocomplete[data-split-row-id="${rowIndex}"]`);
  if (!input) return;
  
  // Input event for showing autocomplete
  input.addEventListener('input', function() {
    showSplitCategoryAutocomplete(this, rowIndex);
  });
  
  // Focus event - select all
  input.addEventListener('focus', function() {
    this.select();
  });
  
  // Keyboard navigation (Arrow keys, Enter, Tab accept, Escape close)
  input.addEventListener('keydown', function(e) {
    const list = document.querySelector(`.split-category-ac-list[data-split-row-id="${rowIndex}"]`);
    const items = list.querySelectorAll('.split-category-ac-item');
    let activeIndex = Array.from(items).findIndex(item => item.classList.contains('active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(activeIndex + 1, items.length - 1);
      items.forEach(item => item.classList.remove('active'));
      if (items[next]) items[next].classList.add('active');
      items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(activeIndex - 1, 0);
      items.forEach(item => item.classList.remove('active'));
      if (items[prev]) items[prev].classList.add('active');
      items[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Tab') {
      // If dropdown has suggestions, accept the highlighted (or first) suggestion.
      // Otherwise, if the current input resolves to a valid category, move focus to the memo input.
      const active = Array.from(items).find(item => item.classList.contains('active'));
      const first = active || items[0];

      if (first) {
        e.preventDefault();
        this.value = first.dataset.value;
        list.innerHTML = '';
        list.style.display = 'none';
        updateSplitValidation();
      } else {
        const currentValue = (this.value || '').trim();
        if (currentValue) {
          const resolved = _resolveAutocompleteCategory(currentValue);
          if (!resolved.error) {
            e.preventDefault();
            const memoInput = this.closest('.split-row')?.querySelector('.split-memo-input');
            if (memoInput) memoInput.focus();
          }
          // if invalid, allow default Tab behavior (move focus)
        }
        // if empty, allow default Tab behavior
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = Array.from(items).find(item => item.classList.contains('active'));
      const first = active || items[0];
      if (first) {
        this.value = first.dataset.value;
        list.innerHTML = '';
        list.style.display = 'none';
        updateSplitValidation();
      }
    } else if (e.key === 'Escape') {
      list.innerHTML = '';
      list.style.display = 'none';
    }
  });
  
  // Blur event - hide list
  input.addEventListener('blur', function() {
    const list = document.querySelector(`.split-category-ac-list[data-split-row-id="${rowIndex}"]`);
    setTimeout(() => {
      list.innerHTML = '';
      list.style.display = 'none';
    }, 200);
  });
}

// Show autocomplete suggestions for split category
function showSplitCategoryAutocomplete(input, rowIndex) {
  const list = document.querySelector(`.split-category-ac-list[data-split-row-id="${rowIndex}"]`);
  const query = (input.value || '').toLowerCase().trim();
  
  if (!query) {
    list.innerHTML = '';
    list.style.display = 'none';
    return;
  }
  
  // Smart filtering
  let matches;
  if (query.includes(':')) {
    const [qPrimary, qDetailed] = query.split(':').map(s => s.trim());
    matches = (availableCategories || []).filter(cat => {
      const lower = cat.toLowerCase();
      const parts = lower.split(':').map(s => s.trim());
      const primaryMatch = !qPrimary || (parts[0] || '').includes(qPrimary);
      const detailedMatch = !qDetailed || (parts[1] || '').includes(qDetailed);
      return primaryMatch && detailedMatch;
    });
  } else {
    matches = (availableCategories || []).filter(cat =>
      cat.toLowerCase().includes(query)
    );
  }
  
  const maxShow = 10;
  const shown = matches.slice(0, maxShow);
  
  if (shown.length === 0) {
    list.innerHTML = '<div style="padding: 8px; color: #999; font-size: 13px;">No matching categories</div>';
    list.style.display = 'block';
    return;
  }
  
  // Build list HTML
  const html = shown.map((cat, i) => {
    const highlighted = highlightCategoryMatch(cat, query);
    return `<div class="split-category-ac-item${i === 0 ? ' active' : ''}" data-value="${escapeHtml(cat)}">${highlighted}</div>`;
  }).join('');
  
  const extra = matches.length > maxShow
    ? `<div style="padding: 8px; color: #999; font-size: 12px;">${matches.length - maxShow} more…</div>` : '';
  
  list.innerHTML = html + extra;
  list.style.display = 'block';
}

// Highlight matching portions
function highlightCategoryMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<strong>$1</strong>');
}

// Remove a split row
function removeSplitRow(rowIndex) {
  const rowElement = document.getElementById(`split-row-${rowIndex}`);
  if (rowElement) {
    rowElement.remove();
    splitRows = splitRows.filter(r => r.rowIndex !== rowIndex);
    updateSplitValidation();
  }
}

// Update split validation display
function updateSplitValidation() {
  if (!currentSplitTransaction) return;
  
  const originalAmount = currentSplitTransaction.amount;
  let splitSum = 0;
  let validCount = 0;
  
  // Get all split rows with values
  const rowElements = document.querySelectorAll('.split-row');
  rowElements.forEach(row => {
    const amountInput = row.querySelector('.split-amount-input');
    const categoryInput = row.querySelector('.split-category-autocomplete');
    
    if (amountInput && amountInput.value && categoryInput && categoryInput.value) {
      const amount = parseFloat(amountInput.value) || 0;
      splitSum += amount;
      validCount++;
    }
  });
  
  // Update sum display
  const sumFormatted = new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: currentSplitTransaction.iso_currency_code || 'USD' 
  }).format(splitSum);
  
  const remaining = originalAmount - splitSum;
  const remainingFormatted = new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: currentSplitTransaction.iso_currency_code || 'USD' 
  }).format(remaining);
  
  document.getElementById('split-sum').textContent = sumFormatted;
  document.getElementById('split-remaining').textContent = remainingFormatted;
  
  const remainingElement = document.getElementById('split-remaining');
  const isBalanced = Math.abs(remaining) < 0.01;
  remainingElement.classList.toggle('balanced', isBalanced);
  remainingElement.classList.toggle('unbalanced', !isBalanced);
  
  // Update validation error
  const errorDiv = document.getElementById('split-validation-error');
  let errorMsg = '';
  
  if (validCount < 2) {
    errorMsg = 'Need at least 2 splits with both amount and category.';
  } else if (!isBalanced) {
    errorMsg = `Split amounts don't balance. Difference: ${remainingFormatted}`;
  }
  
  if (errorMsg) {
    errorDiv.textContent = errorMsg;
    errorDiv.classList.remove('hidden');
  } else {
    errorDiv.classList.add('hidden');
  }
  
  // Update submit button state
  const submitBtn = document.getElementById('split-submit-btn');
  submitBtn.disabled = validCount < 2 || !isBalanced;
}

// Close split modal
function closeSplitModal() {
  document.getElementById('split-modal').classList.add('hidden');
  currentSplitTransaction = null;
  splitRows = [];
  isEditingSplit = false;
}

// Handle split creation/modification submission
async function handleSplitSubmit() {
  if (!currentSplitTransaction) return;
  
  try {
    // Gather split data
    const splits = [];
    document.querySelectorAll('.split-row').forEach(row => {
      const amountInput = row.querySelector('.split-amount-input');
      const categoryInput = row.querySelector('.split-category-autocomplete');
      const memoInput = row.querySelector('.split-memo-input');
      
      if (amountInput && amountInput.value && categoryInput && categoryInput.value) {
        const split = {
          amount: parseFloat(amountInput.value),
          category: categoryInput.value,
        };
        if (memoInput && memoInput.value) {
          split.user_memo = memoInput.value;
        }
        splits.push(split);
      }
    });
    
    if (splits.length < 2) {
      showStatus('Please add at least 2 splits', 'error');
      return;
    }
    
    const submitBtn = document.getElementById('split-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = isEditingSplit ? 'Updating...' : 'Creating...';
    
    if (isEditingSplit) {
      // Delete old splits, then create new ones
      const splitTransactionId = currentSplitTransaction.splits?.[0]?.split_transaction_id;
      if (splitTransactionId) {
        await deleteSplitHelper(splitTransactionId);
      }
    }
    
    // Create new splits
    const txnId = currentSplitTransaction.plaid_transaction_id || currentSplitTransaction.manual_transaction_id;
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/split`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: txnId,
          splits: splits
        })
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create split');
    }
    
    closeSplitModal();
    showStatus(isEditingSplit ? 'Split updated successfully' : 'Split created successfully', 'success');
    
    // Refresh transactions
    await fetchAllTransactions(true);
    
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
    const submitBtn = document.getElementById('split-submit-btn');
    submitBtn.disabled = false;
    submitBtn.textContent = isEditingSplit ? 'Update' : 'Create';
  }
}

// Helper function to delete splits
async function deleteSplitHelper(splitTransactionId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/split/${splitTransactionId}`,
    { method: 'DELETE' }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete split');
  }
}

// Delete split immediately (no confirmation)
async function handleDeleteSplit(splitTransactionId) {
  try {
    await deleteSplitHelper(splitTransactionId);
    showStatus('Split deleted successfully', 'success');
    await fetchAllTransactions(true);
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
  }
}
