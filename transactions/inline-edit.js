// ============================================================
// transactions/inline-edit.js — Click/Tab Inline Editing
//
// Supports inline editing for date, description, and amount on
// EDITABLE_TYPES rows with keyboard flow:
// - Tab: stage current field and move to next editable field
// - Enter: save staged row edits in one API call
// - Escape: cancel inline session
//
// Plaid rows keep their existing description-override inline flow.
// ============================================================

let _activeInlineEditor = null;
let _activeRowEditSession = null;

const _ROW_EDIT_FIELD_ORDER = ['date', 'description', 'amount'];


function initInlineEditing() {
  const tableContainer = document.getElementById('table-container');
  if (!tableContainer) return;

  tableContainer.addEventListener('click', _handleInlineClick);
}


function _handleInlineClick(event) {
  const targetCell = event.target.closest('td[data-field]');
  if (!targetCell) return;

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
  const txnType = getTransactionType({ source, status });
  if (!txnType) return;

  if (field === 'description' && (txnType === TXN_TYPE.PLAID_CLEARED || txnType === TXN_TYPE.PLAID_PENDING)) {
    _openPlaidDescriptionEditor(targetCell, txnId);
    return;
  }

  if (!EDITABLE_TYPES.has(txnType)) return;
  if (!_ROW_EDIT_FIELD_ORDER.includes(field)) return;

  _openRowFieldEditor({ cell: targetCell, row, txnId, field });
}


function _openRowFieldEditor({ cell, row, txnId, field }) {
  if (!_commitActiveFieldToSession()) {
    return;
  }

  const editSession = _ensureRowEditSession(row, txnId);
  if (!editSession) return;

  _dismissActiveEditor({ clearRowSession: false });

  const originalHtml = cell.innerHTML;
  const descriptionPrefixHtml = field === 'description' ? _getLeadingElementHtml(cell) : '';
  const input = _buildInputForField(field, editSession.draft);

  if (!input) return;

  cell.textContent = '';
  cell.appendChild(input);
  cell.classList.add('inline-editing');

  _activeInlineEditor = {
    cell,
    originalHtml,
    input,
    field,
    row,
    txnId,
    descriptionPrefixHtml,
  };

  input.focus();
  if (field !== 'date') {
    input.select();
  }

  input.addEventListener('keydown', async (keyboardEvent) => {
    if (keyboardEvent.key === 'Escape') {
      keyboardEvent.preventDefault();
      _dismissActiveEditor({ clearRowSession: true });
      return;
    }

    if (keyboardEvent.key === 'Tab') {
      keyboardEvent.preventDefault();
      const staged = _commitActiveFieldToSession();
      if (!staged) return;
      const nextField = _getAdjacentEditableField(row, field, keyboardEvent.shiftKey ? -1 : 1);
      if (!nextField) return;
      _openRowFieldEditor({
        cell: nextField.cell,
        row,
        txnId,
        field: nextField.field,
      });
      return;
    }

    if (keyboardEvent.key === 'Enter') {
      keyboardEvent.preventDefault();
      const staged = _commitActiveFieldToSession();
      if (!staged) return;
      await _saveRowInlineEdits();
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (_activeInlineEditor && _activeInlineEditor.input === input) {
        _dismissActiveEditor({ clearRowSession: false });
      }
    }, 120);
  });
}


function _buildInputForField(field, draftState) {
  const input = document.createElement('input');
  input.className = 'inline-edit-input';

  if (field === 'date') {
    input.type = 'text';
    input.classList.add('inline-edit-date', 'date-input');
    input.value = draftState.date;
    autoFormatDateInput(input);
    return input;
  }

  if (field === 'description') {
    input.type = 'text';
    input.classList.add('inline-edit-description');
    input.maxLength = 500;
    input.value = draftState.description;
    return input;
  }

  if (field === 'amount') {
    input.type = 'text';
    input.classList.add('inline-edit-amount');
    input.inputMode = 'decimal';
    input.value = draftState.amount_input;
    return input;
  }

  return null;
}


function _ensureRowEditSession(row, txnId) {
  if (_activeRowEditSession && _activeRowEditSession.txn_id === txnId) {
    return _activeRowEditSession;
  }

  if (_activeRowEditSession && _activeRowEditSession.txn_id !== txnId) {
    _activeRowEditSession = null;
  }

  const txn = transactions.find(find_txn => find_txn.transaction_id === txnId);
  if (!txn) return null;

  const absolute_amount = Math.abs(Number(txn.amount || 0));
  _activeRowEditSession = {
    txn_id: txnId,
    row,
    original: {
      date: txn.date || '',
      description: txn.description || txn.name || '',
      signed_amount: Number(txn.amount || 0),
    },
    draft: {
      date: txn.date || '',
      description: txn.description || txn.name || '',
      amount_input: Number.isFinite(absolute_amount) ? absolute_amount.toFixed(2) : '0.00',
    },
  };

  return _activeRowEditSession;
}


function _getAdjacentEditableField(row, currentField, direction) {
  const editableCells = _ROW_EDIT_FIELD_ORDER
    .map(field => ({ field, cell: row.querySelector(`td[data-field="${field}"]`) }))
    .filter(cellInfo => !!cellInfo.cell);

  if (editableCells.length === 0) return null;

  const currentIndex = editableCells.findIndex(cellInfo => cellInfo.field === currentField);
  const fallbackIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = (fallbackIndex + direction + editableCells.length) % editableCells.length;
  return editableCells[nextIndex];
}


function _commitActiveFieldToSession() {
  if (!_activeInlineEditor || !_activeRowEditSession) return true;
  if (_activeInlineEditor.txnId !== _activeRowEditSession.txn_id) return true;

  const field = _activeInlineEditor.field;
  const value = (_activeInlineEditor.input.value || '').trim();

  if (field === 'date') {
    if (!value) {
      showStatus('Date is required', 'error');
      return false;
    }
    _activeRowEditSession.draft.date = value;
    if (_activeInlineEditor) {
      _activeInlineEditor.originalHtml = _formatDateDisplay(value);
      _activeInlineEditor.cell.classList.add('inline-staged');
    }
    return true;
  }

  if (field === 'description') {
    if (!value) {
      showStatus('Description cannot be empty', 'error');
      return false;
    }
    _activeRowEditSession.draft.description = value;
    if (_activeInlineEditor) {
      const prefixHtml = _activeInlineEditor.descriptionPrefixHtml || '';
      _activeInlineEditor.originalHtml = `${prefixHtml}${_escapeInlineText(value)}`;
      _activeInlineEditor.cell.classList.add('inline-staged');
    }
    return true;
  }

  if (field === 'amount') {
    const amountParseResult = _parseAmountInput(value);
    if (!amountParseResult.ok) {
      showStatus(amountParseResult.error, 'error');
      return false;
    }
    _activeRowEditSession.draft.amount_input = value;
    if (_activeInlineEditor) {
      const stagedAmount = _formatStagedAmount(
        _activeInlineEditor.txnId,
        value,
        _activeRowEditSession.original.signed_amount
      );
      if (stagedAmount) {
        _activeInlineEditor.originalHtml = stagedAmount.display_text;
        _activeInlineEditor.cell.classList.toggle('ledger-negative', stagedAmount.is_negative);
        _activeInlineEditor.cell.classList.add('inline-staged');
      }
    }
    return true;
  }

  return true;
}


async function _saveRowInlineEdits() {
  if (!_activeRowEditSession) return;

  const editSession = _activeRowEditSession;
  const payload = {};

  if (editSession.draft.date !== editSession.original.date) {
    payload.date = editSession.draft.date;
  }

  const normalized_description = (editSession.draft.description || '').trim();
  if (!normalized_description) {
    showStatus('Description cannot be empty', 'error');
    return;
  }
  if (normalized_description !== editSession.original.description) {
    payload.description = normalized_description;
  }

  const amountDiffResult = _getAmountDiff(editSession.draft.amount_input, editSession.original.signed_amount);
  if (!amountDiffResult.ok) {
    showStatus(amountDiffResult.error, 'error');
    return;
  }
  if (amountDiffResult.has_change) {
    payload.amount = amountDiffResult.absolute_amount;
    if (amountDiffResult.type_override) {
      payload.type = amountDiffResult.type_override;
    }
  }

  const payloadKeys = Object.keys(payload);
  if (payloadKeys.length === 0) {
    _dismissActiveEditor({ clearRowSession: true });
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/manual/${encodeURIComponent(editSession.txn_id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update transaction');
    }

    showStatus('Transaction updated', 'success');
    _dismissActiveEditor({ clearRowSession: true });

    // If the server returned the full updated transaction, patch the cache
    // directly — avoids clearing and re-downloading 100k+ rows.
    if (data.transaction && data.transaction.transaction_id) {
      _replaceCachedTransaction(editSession.txn_id, data.transaction);
      if (selectedAccountMode === 'single' && selectedAccountId) {
        await fetchBalanceHistory(selectedAccountId);
      }
      renderTransactionTable();
    } else {
      // Fallback: full refetch if server didn't return the object
      await _refreshAfterInlineEdit();
    }
  } catch (saveError) {
    showStatus(`Inline update failed: ${saveError.message}`, 'error');
  }
}


function _getAmountDiff(amountInput, originalSignedAmount) {
  const parsedAmount = _parseAmountInput(amountInput);
  if (!parsedAmount.ok) return parsedAmount;

  const defaultType = Number(originalSignedAmount) < 0 ? 'debit' : 'credit';
  const effectiveType = parsedAmount.type_override || defaultType;
  const nextSignedAmount = effectiveType === 'debit'
    ? -parsedAmount.absolute_amount
    : parsedAmount.absolute_amount;

  const delta = Math.abs(nextSignedAmount - Number(originalSignedAmount));
  if (delta < 0.000001) {
    return {
      ok: true,
      has_change: false,
      absolute_amount: parsedAmount.absolute_amount,
      type_override: null,
    };
  }

  return {
    ok: true,
    has_change: true,
    absolute_amount: parsedAmount.absolute_amount,
    type_override: parsedAmount.type_override,
  };
}


function _parseAmountInput(rawAmountInput) {
  const trimmedInput = (rawAmountInput || '').trim();
  if (!trimmedInput) {
    return { ok: false, error: 'Amount is required' };
  }

  const signSymbol = _extractSignSymbol(trimmedInput);
  const typeOverride = signSymbol === '-'
    ? 'debit'
    : signSymbol === '+' ? 'credit' : null;

  const normalizedString = trimmedInput
    .replace(/[−]/g, '-')
    .replace(/[$,\s]/g, '')
    .replace(/[+\-]/g, '');

  const parsedFloat = Number.parseFloat(normalizedString);
  if (!Number.isFinite(parsedFloat) || parsedFloat <= 0) {
    return { ok: false, error: 'Amount must be a positive number' };
  }

  return {
    ok: true,
    absolute_amount: parsedFloat,
    type_override: typeOverride,
  };
}


function _extractSignSymbol(amountInput) {
  for (const inputChar of amountInput) {
    if (inputChar === '+' || inputChar === '-' || inputChar === '−') {
      return inputChar === '−' ? '-' : inputChar;
    }
  }
  return null;
}


function _formatDateDisplay(dateString) {
  return formatDate(dateString);
}


function _formatStagedAmount(txnId, rawInputValue, originalSignedAmount) {
  const parsedAmount = _parseAmountInput(rawInputValue);
  if (!parsedAmount.ok) return null;

  const defaultType = Number(originalSignedAmount) < 0 ? 'debit' : 'credit';
  const effectiveType = parsedAmount.type_override || defaultType;
  const signedAmount = effectiveType === 'debit'
    ? -parsedAmount.absolute_amount
    : parsedAmount.absolute_amount;

  const txn = transactions.find(find_txn => find_txn.transaction_id === txnId);
  const currencyCode = (txn && txn.iso_currency_code) ? txn.iso_currency_code : 'USD';

  return {
    display_text: new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(signedAmount),
    is_negative: signedAmount < 0,
  };
}


function _escapeInlineText(rawText) {
  if (typeof escapeHtml === 'function') {
    return escapeHtml(rawText);
  }
  return String(rawText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function _getLeadingElementHtml(cell) {
  const htmlChunks = [];
  const childElements = cell.querySelectorAll(':scope > *');
  childElements.forEach(childElement => {
    htmlChunks.push(childElement.outerHTML);
  });
  return htmlChunks.join('');
}


function _openPlaidDescriptionEditor(cell, txnId) {
  const txn = transactions.find(find_txn => find_txn.transaction_id === txnId);
  if (!txn) return;

  _dismissActiveEditor({ clearRowSession: true });

  const originalHtml = cell.innerHTML;
  const descriptionPrefixHtml = _getLeadingElementHtml(cell);
  const currentName = txn.user_description_override || txn.description || txn.name || '';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input inline-edit-description';
  input.value = currentName;
  input.maxLength = 500;

  cell.textContent = '';
  cell.appendChild(input);
  cell.classList.add('inline-editing');

  _activeInlineEditor = {
    cell,
    originalHtml,
    input,
    field: 'description',
    row: cell.closest('tr'),
    txnId,
    descriptionPrefixHtml,
  };

  input.focus();
  input.select();

  input.addEventListener('keydown', async (keyboardEvent) => {
    if (keyboardEvent.key === 'Enter') {
      keyboardEvent.preventDefault();
      await _savePlaidDescriptionEdit(txnId, input.value.trim());
    } else if (keyboardEvent.key === 'Escape') {
      keyboardEvent.preventDefault();
      _dismissActiveEditor({ clearRowSession: true });
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (_activeInlineEditor && _activeInlineEditor.input === input) {
        _dismissActiveEditor({ clearRowSession: true });
      }
    }, 120);
  });
}


async function _savePlaidDescriptionEdit(txnId, newDescription) {
  // Empty input signals user wants to revert to the original plaid description.
  // The backend clears user_description_override when description is empty.
  const isClearing = !newDescription;

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/${encodeURIComponent(txnId)}/description`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newDescription || '' }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update description');
    }

    const txn = transactions.find(find_txn => find_txn.transaction_id === txnId);
    if (txn) {
      if (isClearing) {
        txn.user_description_override = null;
      } else {
        txn.user_description_override = newDescription;
        txn.description = newDescription;
      }
    }

    // Persist the in-memory patch to IndexedDB (no full refetch needed —
    // description edits don't affect other rows or balance history).
    if (window.txnDB && txn) {
      window.txnDB.putOne(txn).catch(function() {});
      window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
    }

    showStatus(isClearing ? 'Description override cleared' : 'Description updated', 'success');
    _dismissActiveEditor({ clearRowSession: true });
    renderTransactionTable();
  } catch (saveError) {
    showStatus(`Description update failed: ${saveError.message}`, 'error');
  }
}


function _restoreCell(cell, originalHtml) {
  cell.innerHTML = originalHtml;
  cell.classList.remove('inline-editing');
}


function _dismissActiveEditor({ clearRowSession = true } = {}) {
  if (_activeInlineEditor) {
    _restoreCell(_activeInlineEditor.cell, _activeInlineEditor.originalHtml);
    _activeInlineEditor = null;
  }
  if (clearRowSession) {
    _activeRowEditSession = null;
  }
}


async function _refreshAfterInlineEdit() {
  // Mark cache stale (don't nuke 100k rows — replaceAll handles it atomically)
  _invalidateTransactionCache();

  await fetchAllTransactions(true);

  if (selectedAccountMode === 'single' && selectedAccountId) {
    await fetchBalanceHistory(selectedAccountId);
  }

  renderTransactionTable();
}
