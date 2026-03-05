// ============================================================
// transactions/inline-edit.js — Click-to-Edit on Table Cells
//
// Adds inline editing for Date and Description cells directly
// in the transaction table. Amount clicks open the existing
// edit modal with the amount field pre-highlighted.
//
// This is an additive UX layer — the right-click context menu
// and modify modal remain fully functional as alternative paths.
//
// Depends on: transaction-types.js, api.js, table-renderer.js,
//             manual-transactions.js (for openEditManualTransactionModal)
// ============================================================

/** Track the currently active inline editor so only one is open at a time. */
let _activeInlineEditor = null;


/**
 * One-time setup: attaches a delegated click listener on the table
 * container that inspects the clicked cell and dispatches to the
 * appropriate inline editor based on data-field attributes.
 */
function initInlineEditing() {
  const tableContainer = document.getElementById('table-container');
  if (!tableContainer) return;

  tableContainer.addEventListener('click', _handleInlineClick);
}


// ── Click dispatcher ──────────────────────────────────────────

function _handleInlineClick(event) {
  const targetCell = event.target.closest('td[data-field]');
  if (!targetCell) return;

  // Ignore clicks on interactive elements inside the cell (buttons, inputs)
  const interactiveTag = event.target.tagName.toLowerCase();
  if (['input', 'select', 'textarea', 'button'].includes(interactiveTag)) return;
  if (event.target.closest('button') || event.target.closest('input')) return;

  const row = targetCell.closest('tr');
  if (!row) return;

  const txnId = row.dataset.txnId;
  if (!txnId) return;

  const field = targetCell.dataset.field;
  const source = row.dataset.source || '';
  const status = row.dataset.status || '';

  // Reconstruct the transaction type from source + status
  const txnType = getTransactionType({ source, status });
  if (!txnType) return;

  switch (field) {
    case 'date':
      if (!EDITABLE_TYPES.has(txnType)) return;
      _openDateEditor(targetCell, txnId, row);
      break;

    case 'description':
      _openDescriptionEditor(targetCell, txnId, txnType, row);
      break;

    case 'amount':
      if (!EDITABLE_TYPES.has(txnType)) return;
      _openAmountViaModal(txnId);
      break;

    default:
      return;
  }
}


// ── Date Editor ───────────────────────────────────────────────

function _openDateEditor(cell, txnId, row) {
  // Find the transaction in the in-memory array to get the raw date
  const txn = transactions.find(findTxn => findTxn.transaction_id === txnId);
  if (!txn) return;

  // Dismiss any existing editor first
  _dismissActiveEditor();

  const originalHtml = cell.innerHTML;
  const currentDate = txn.date; // YYYY-MM-DD string

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'inline-edit-input inline-edit-date';
  input.value = currentDate;

  cell.textContent = '';
  cell.appendChild(input);
  cell.classList.add('inline-editing');

  input.focus();

  _activeInlineEditor = {
    cell,
    originalHtml,
    input,
    cleanup: () => _restoreCell(cell, originalHtml),
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      _saveDateEdit(txnId, input.value, cell, originalHtml);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      _dismissActiveEditor();
    }
  });

  // Save on change (calendar picker selection) for quicker UX
  input.addEventListener('change', () => {
    if (input.value && input.value !== currentDate) {
      _saveDateEdit(txnId, input.value, cell, originalHtml);
    }
  });

  input.addEventListener('blur', () => {
    // Short delay so that a change event can fire before blur dismisses
    setTimeout(() => {
      if (_activeInlineEditor && _activeInlineEditor.input === input) {
        _dismissActiveEditor();
      }
    }, 150);
  });
}


async function _saveDateEdit(txnId, newDate, cell, originalHtml) {
  if (!newDate) {
    _dismissActiveEditor();
    return;
  }

  // Determine API route: virtual BILL_FUTURE ids go through manual update
  // (backend auto-materializes), all EDITABLE_TYPES use the manual update endpoint
  const endpoint = `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(txnId)}`;

  try {
    const response = await authenticatedFetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: newDate }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update date');
    }

    showStatus('Date updated', 'success');
    _dismissActiveEditor();
    _refreshAfterInlineEdit();

  } catch (saveError) {
    showStatus(`Date update failed: ${saveError.message}`, 'error');
    _dismissActiveEditor();
  }
}


// ── Description Editor ────────────────────────────────────────

function _openDescriptionEditor(cell, txnId, txnType, row) {
  const isPlaidType = (txnType === TXN_TYPE.PLAID_CLEARED || txnType === TXN_TYPE.PLAID_PENDING);
  const isEditableType = EDITABLE_TYPES.has(txnType);

  // Only plaid types (override) and editable types (direct edit) allowed
  if (!isPlaidType && !isEditableType) return;

  const txn = transactions.find(findTxn => findTxn.transaction_id === txnId);
  if (!txn) return;

  _dismissActiveEditor();

  const originalHtml = cell.innerHTML;
  const currentName = txn.user_description_override || txn.name || '';

  // Preserve badges — they sit before the display name in the cell.
  // Extract the text content that represents the name (last text node or
  // the rendered.displayName portion). We'll re-render the full cell on
  // save, so for the editor we overlay an input after any badge elements.
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input inline-edit-description';
  input.value = currentName;
  input.maxLength = 500;

  // Replace cell contents but preserve data attributes on the cell
  cell.textContent = '';
  cell.appendChild(input);
  cell.classList.add('inline-editing');

  input.focus();
  input.select();

  _activeInlineEditor = {
    cell,
    originalHtml,
    input,
    cleanup: () => _restoreCell(cell, originalHtml),
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      _saveDescriptionEdit(txnId, input.value.trim(), isPlaidType, cell, originalHtml);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      _dismissActiveEditor();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (_activeInlineEditor && _activeInlineEditor.input === input) {
        _dismissActiveEditor();
      }
    }, 150);
  });
}


async function _saveDescriptionEdit(txnId, newDescription, isPlaid, cell, originalHtml) {
  if (!newDescription) {
    showStatus('Description cannot be empty', 'error');
    _dismissActiveEditor();
    return;
  }

  try {
    let response;

    if (isPlaid) {
      // Plaid transactions use the dedicated description override endpoint
      response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/${encodeURIComponent(txnId)}/description`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDescription }),
        }
      );
    } else {
      // Manual/editable types use the existing manual update endpoint
      response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(txnId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDescription }),
        }
      );
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update description');
    }

    // Update the in-memory transaction so re-render shows the new name
    const txn = transactions.find(findTxn => findTxn.transaction_id === txnId);
    if (txn) {
      if (isPlaid) {
        txn.user_description_override = newDescription;
        txn.name = newDescription;
      } else {
        txn.name = newDescription;
      }
    }

    showStatus('Description updated', 'success');
    _dismissActiveEditor();
    _refreshAfterInlineEdit();

  } catch (saveError) {
    showStatus(`Description update failed: ${saveError.message}`, 'error');
    _dismissActiveEditor();
  }
}


// ── Amount (opens modal with pre-highlight) ───────────────────

function _openAmountViaModal(txnId) {
  if (typeof openEditManualTransactionModal !== 'function') {
    showStatus('Edit modal not available', 'error');
    return;
  }

  openEditManualTransactionModal(txnId);

  // After the modal renders, focus and select the amount input so the
  // user can immediately type the new value without extra clicks.
  setTimeout(() => {
    const amountInput = document.getElementById('manual-txn-amount');
    if (amountInput) {
      amountInput.focus();
      amountInput.select();
    }
  }, 100);
}


// ── Shared helpers ────────────────────────────────────────────

function _restoreCell(cell, originalHtml) {
  cell.innerHTML = originalHtml;
  cell.classList.remove('inline-editing');
}


function _dismissActiveEditor() {
  if (_activeInlineEditor) {
    _activeInlineEditor.cleanup();
    _activeInlineEditor = null;
  }
}


/**
 * After a successful inline edit, invalidate the localStorage cache and
 * re-fetch + re-render. This is the same pattern used by the memo save
 * and the modify modal.
 */
async function _refreshAfterInlineEdit() {
  try {
    localStorage.removeItem('pf_cached_transactions');
    localStorage.removeItem('pf_transactions_cached_at');
  } catch (cacheError) { /* non-fatal */ }

  await fetchAllTransactions(true);

  if (selectedAccountMode === 'single' && selectedAccountId) {
    await fetchBalanceHistory(selectedAccountId);
  }

  renderTransactionTable();
}
