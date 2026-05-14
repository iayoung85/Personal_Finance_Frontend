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

const _PLAID_DATE_EDIT_WINDOW_DAYS = 3;


function _getRowTxnType(row) {
  if (!row) return null;
  return getTransactionType({
    source: row.dataset.source || '',
    status: row.dataset.status || '',
  });
}


function _getRowEditFieldOrder(txnType) {
  return getInlineEditableFields(txnType);
}


function _shiftISODate(dateString, dayDelta) {
  const parsedDate = parseDateInput(dateString);
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return '';
  parsedDate.setDate(parsedDate.getDate() + dayDelta);
  return toISODateStr(parsedDate);
}


function _getPlaidDateConstraint(txn, txnType) {
  if (txnType !== TXN_TYPE.PLAID_CLEARED || !txn || !txn.date) return null;

  const minDate = _shiftISODate(txn.date, -_PLAID_DATE_EDIT_WINDOW_DAYS);
  const maxRangeDate = _shiftISODate(txn.date, _PLAID_DATE_EDIT_WINDOW_DAYS);
  if (!minDate || !maxRangeDate) return null;

  const todayDate = todayISO();
  return {
    min: minDate,
    max: maxRangeDate < todayDate ? maxRangeDate : todayDate,
  };
}


function _normalizeDateForSession(rawDateValue, editSession) {
  const parsedDate = parseDateInput(rawDateValue);
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
    return { ok: false, error: 'Enter a valid date' };
  }

  let normalizedDate = toISODateStr(parsedDate);
  let clamped = false;
  const constraint = editSession ? editSession.plaid_date_constraint : null;

  if (constraint) {
    if (normalizedDate < constraint.min) {
      normalizedDate = constraint.min;
      clamped = true;
    }
    if (normalizedDate > constraint.max) {
      normalizedDate = constraint.max;
      clamped = true;
    }
  }

  return {
    ok: true,
    value: normalizedDate,
    clamped,
    constraint,
  };
}


function _buildDateInputOptions(editSession) {
  if (!editSession || !editSession.plaid_date_constraint) return {};

  return {
    useWholeDateArrowStep: true,
    normalizeISOValue(isoValue) {
      const normalized = _normalizeDateForSession(isoValue, editSession);
      return normalized.ok ? normalized.value : isoValue;
    },
  };
}


function _consumeDateNormalization(inputEl) {
  if (!inputEl) return null;

  const fromValue = inputEl.dataset.lastNormalizedFrom || '';
  const toValue = inputEl.dataset.lastNormalizedTo || '';
  const reason = inputEl.dataset.lastNormalizedReason || '';

  delete inputEl.dataset.lastNormalizedFrom;
  delete inputEl.dataset.lastNormalizedTo;
  delete inputEl.dataset.lastNormalizedReason;

  if (!fromValue || !toValue || fromValue === toValue) return null;
  return { from: fromValue, to: toValue, reason };
}


function _showPlaidDateClampStatus(normalizedDate, constraint) {
  if (!constraint) return;

  showStatus(
    `Plaid dates can only move between ${formatDate(constraint.min)} and ${formatDate(constraint.max)}. Adjusted to ${formatDate(normalizedDate)}.`,
    'warning'
  );
}


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

  // In the two-line description cell, only open the merchant name editor when
  // the user clicks directly on the merchant text itself. Clicks anywhere else
  // in the cell (memo line, surrounding whitespace) open the memo editor instead.
  if (targetCell.dataset.field === 'description' && targetCell.querySelector('.desc-two-line')) {
    const clickedMerchantText = event.target.closest('.txn-description-text') || event.target.closest('.txn-description-placeholder');
    if (!clickedMerchantText) {
      const memoSpan = targetCell.querySelector('.txn-memo-text');
      if (memoSpan) _openInlineMemoEditor(memoSpan);
      return;
    }
  }

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

  if (field === 'description' && txnType === TXN_TYPE.SPLIT_CHILD) {
    const splitTxnId = row.dataset.splitTxnId;
    if (splitTxnId) {
      _openSplitDescriptionEditor(targetCell, splitTxnId, txnId);
    }
    return;
  }

  const editableFields = _getRowEditFieldOrder(txnType);
  if (!editableFields.includes(field)) return;

  _openRowFieldEditor({ cell: targetCell, row, txnId, field, txnType });
}


function _openRowFieldEditor({ cell, row, txnId, field, txnType }) {
  if (!_commitActiveFieldToSession()) {
    return;
  }

  const editSession = _ensureRowEditSession(row, txnId, txnType);
  if (!editSession) return;

  _dismissActiveEditor({ clearRowSession: false });

  const originalHtml = cell.innerHTML;
  const descriptionPrefixHtml = field === 'description' ? _getLeadingElementHtml(cell) : '';
  const input = _buildInputForField(field, editSession);

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
      if (!nextField) {
        _dismissActiveEditor({ clearRowSession: false });
        return;
      }
      _openRowFieldEditor({
        cell: nextField.cell,
        row,
        txnId,
        field: nextField.field,
        txnType: editSession.txn_type,
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
        if (_activeInlineEditor.field === 'date' && editSession.plaid_date_constraint) {
          _commitActiveFieldToSession();
        }
        _dismissActiveEditor({ clearRowSession: false });
      }
    }, 120);
  });
}


function _buildInputForField(field, editSession) {
  const input = document.createElement('input');
  input.className = 'inline-edit-input';
  const draftState = editSession.draft;

  if (field === 'date') {
    input.type = 'text';
    input.classList.add('inline-edit-date', 'date-input');
    input.value = draftState.date;
    autoFormatDateInput(input, _buildDateInputOptions(editSession));
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


function _ensureRowEditSession(row, txnId, txnType) {
  if (_activeRowEditSession && _activeRowEditSession.txn_id === txnId) {
    return _activeRowEditSession;
  }

  if (_activeRowEditSession && _activeRowEditSession.txn_id !== txnId) {
    _activeRowEditSession = null;
  }

  const txn = transactions.find(find_txn => find_txn.transaction_id === txnId);
  if (!txn) return null;
  const resolvedTxnType = txnType || getTransactionType(txn);
  const editableFields = _getRowEditFieldOrder(resolvedTxnType);
  if (!resolvedTxnType || editableFields.length === 0) return null;

  const signed_amount = Number(txn.amount || 0);
  const absolute_amount = Math.abs(signed_amount);
  // Pre-fill with the signed value so the input is WYSIWYG: a leading
  // "-" means debit, no leading sign means credit. Removing or adding
  // the "-" flips the type on save.
  const signed_input_text = Number.isFinite(signed_amount)
    ? (signed_amount < 0 ? `-${absolute_amount.toFixed(2)}` : absolute_amount.toFixed(2))
    : '0.00';
  _activeRowEditSession = {
    txn_id: txnId,
    txn_type: resolvedTxnType,
    editable_fields: editableFields,
    plaid_date_constraint: _getPlaidDateConstraint(txn, resolvedTxnType),
    row,
    original: {
      date: txn.date || '',
      description: txn.description || txn.name || '',
      signed_amount,
    },
    draft: {
      date: txn.date || '',
      description: txn.description || txn.name || '',
      amount_input: signed_input_text,
    },
  };

  return _activeRowEditSession;
}


function _getAdjacentEditableField(row, currentField, direction) {
  const editableFields = (_activeRowEditSession && _activeRowEditSession.row === row)
    ? _activeRowEditSession.editable_fields
    : _getRowEditFieldOrder(_getRowTxnType(row));

  const editableCells = editableFields
    .map(field => ({ field, cell: row.querySelector(`td[data-field="${field}"]`) }))
    .filter(cellInfo => !!cellInfo.cell);

  if (editableCells.length <= 1) return null;
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
  const rawValue = (_activeInlineEditor.input.value || '').trim();
  const value = (field === 'date')
    ? (getDateInputValue(_activeInlineEditor.input) || '').trim()
    : rawValue;

  if (field === 'date') {
    if (!value) {
      showStatus('Date is required', 'error');
      return false;
    }

    const normalizedDate = _normalizeDateForSession(value, _activeRowEditSession);
    if (!normalizedDate.ok) {
      showStatus(normalizedDate.error, 'error');
      return false;
    }

    const normalizationMeta = _consumeDateNormalization(_activeInlineEditor.input);
    const shouldShowClampStatus = !!_activeRowEditSession.plaid_date_constraint
      && ((normalizationMeta && normalizationMeta.reason !== 'arrow-step') || normalizedDate.clamped);

    _activeRowEditSession.draft.date = normalizedDate.value;

    if (_activeInlineEditor.input && normalizedDate.value !== value) {
      setDateInputValue(_activeInlineEditor.input, normalizedDate.value);
    }

    if (shouldShowClampStatus) {
      _showPlaidDateClampStatus(normalizedDate.value, _activeRowEditSession.plaid_date_constraint);
    }

    if (_activeInlineEditor) {
      _activeInlineEditor.originalHtml = _formatDateDisplay(normalizedDate.value);
      _activeInlineEditor.cell.classList.add('inline-staged');
    }
    return true;
  }

  if (field === 'description') {
    // Blank description signals "reset to original" — backend handles the fallback.
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
  const editableFields = Array.isArray(editSession.editable_fields)
    ? editSession.editable_fields
    : _getRowEditFieldOrder(editSession.txn_type);
  const payload = {};

  if (editableFields.includes('date') && editSession.draft.date !== editSession.original.date) {
    payload.date = editSession.draft.date;
  }

  const normalized_description = (editSession.draft.description || '').trim();
  // Blank description signals "reset to original" — backend will fall back
  // to original_description. Always send the key so the backend sees the intent.
  if (editableFields.includes('description') && normalized_description !== editSession.original.description) {
    payload.description = normalized_description;
  }

  if (editableFields.includes('amount')) {
    const amountDiffResult = _getAmountDiff(editSession.draft.amount_input, editSession.original.signed_amount);
    if (!amountDiffResult.ok) {
      showStatus(amountDiffResult.error, 'error');
      return;
    }
    if (amountDiffResult.has_change) {
      payload.amount = amountDiffResult.absolute_amount;
      payload.type = amountDiffResult.effective_type;
    }
  }

  const payloadKeys = Object.keys(payload);
  if (payloadKeys.length === 0) {
    _dismissActiveEditor({ clearRowSession: true });
    return;
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/${encodeURIComponent(editSession.txn_id)}`,
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

    // Patch the edited transaction immediately for instant feedback.
    var editedAccountId = null;
    if (data.transaction && data.transaction.transaction_id) {
      _replaceCachedTransaction(editSession.txn_id, data.transaction);
      editedAccountId = data.transaction.account_id;
    }

    // Patch the transfer partner so the counterpart account's cached row
    // reflects the propagated amount/date change without a full refetch.
    if (data.affected_transfer_partner && data.affected_transfer_partner.transaction_id) {
      _replaceCachedTransaction(data.affected_transfer_partner.transaction_id, data.affected_transfer_partner);
    }

    // Description-only edits don't affect trending, balances, or other rows —
    // the _replaceCachedTransaction above is sufficient. Skip the expensive
    // account refetch + balance history round-trips.
    const changedOnlyDescription = payloadKeys.length === 1 && payloadKeys[0] === 'description';
    if (changedOnlyDescription) {
      renderTransactionTable();
    } else {
      // Date or amount changes may trigger backend-side trending recalculation
      // (investment performance) and balance shifts — full refresh required.
      await refreshAccountTransactions(editedAccountId || selectedAccountId);
      if (selectedAccountMode === 'single' && selectedAccountId) {
        if (data.affected_balance_history) {
          _patchBalanceHistoryCache(editedAccountId || selectedAccountId, data.affected_balance_history);
        } else {
          await fetchBalanceHistory(selectedAccountId);
        }
      }

      // Refresh account data before rendering so future-row balance
      // projections use the updated current_balance.
      await loadAccounts();
      renderTransactionTable();
    }
  } catch (saveError) {
    showStatus(`Inline update failed: ${saveError.message}`, 'error');
  }
}


function _getAmountDiff(amountInput, originalSignedAmount) {
  const parsedAmount = _parseAmountInput(amountInput);
  if (!parsedAmount.ok) return parsedAmount;

  // The input is WYSIWYG: a leading "-" produces a debit, no sign
  // (or an explicit "+") produces a credit. There is no "preserve the
  // original type" fallback — that previously made unsigned edits on a
  // debit silently stay debits, which prevented flipping debit → credit.
  const effectiveType = parsedAmount.type_override === 'debit' ? 'debit' : 'credit';
  const nextSignedAmount = effectiveType === 'debit'
    ? -parsedAmount.absolute_amount
    : parsedAmount.absolute_amount;

  const delta = Math.abs(nextSignedAmount - Number(originalSignedAmount));
  if (delta < 0.000001) {
    return {
      ok: true,
      has_change: false,
      absolute_amount: parsedAmount.absolute_amount,
      effective_type: effectiveType,
      signed_amount: nextSignedAmount,
    };
  }

  return {
    ok: true,
    has_change: true,
    absolute_amount: parsedAmount.absolute_amount,
    effective_type: effectiveType,
    signed_amount: nextSignedAmount,
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
  // Zero is allowed so users can book $0 markdowns without touching the
  // running balance. Negative input on its own is rejected — the sign
  // comes from the "+"/"−" prefix or type_override.
  if (!Number.isFinite(parsedFloat) || parsedFloat < 0) {
    return { ok: false, error: 'Amount must be zero or a positive number' };
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

  const effectiveType = parsedAmount.type_override === 'debit' ? 'debit' : 'credit';
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


function _openSplitDescriptionEditor(cell, splitTxnId, parentTxnId) {
  const parentTxn = transactions.find(findTxn => findTxn.transaction_id === parentTxnId);
  if (!parentTxn || !parentTxn.splits) return;

  const splitChild = parentTxn.splits.find(s => s.transaction_id === splitTxnId);
  if (!splitChild) return;

  _dismissActiveEditor({ clearRowSession: true });

  const originalHtml = cell.innerHTML;
  const currentName = splitChild.description || splitChild.name
    || parentTxn.merchant_name || parentTxn.description || parentTxn.name || '';

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
    txnId: splitTxnId,
  };

  input.focus();
  input.select();

  input.addEventListener('keydown', async (keyboardEvent) => {
    if (keyboardEvent.key === 'Enter') {
      keyboardEvent.preventDefault();
      await _saveSplitDescriptionEdit(splitTxnId, parentTxnId, input.value.trim());
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


async function _saveSplitDescriptionEdit(splitTxnId, parentTxnId, newDescription) {
  // Blank description signals "reset to parent description" — backend handles the fallback.

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/split/${encodeURIComponent(splitTxnId)}/description`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: newDescription }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update description');
    }

    // Patch the split child in the parent's splits array using the
    // server-resolved values (which may differ from the input when the
    // backend resets a blank description to the parent's name).
    const resolvedDescription = data.description || newDescription;
    const resolvedMerchant = data.merchant_name || resolvedDescription;
    const parentTxn = transactions.find(findTxn => findTxn.transaction_id === parentTxnId);
    if (parentTxn && parentTxn.splits) {
      const splitChild = parentTxn.splits.find(s => s.transaction_id === splitTxnId);
      if (splitChild) {
        splitChild.description = resolvedDescription;
        splitChild.merchant_name = resolvedMerchant;
      }
    }

    if (window.txnDB && parentTxn) {
      window.txnDB.putOne(parentTxn).catch(function() {});
      window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
    }

    showStatus('Description updated', 'success');
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
  await refreshAccountTransactions(selectedAccountId);

  if (selectedAccountMode === 'single' && selectedAccountId) {
    await fetchBalanceHistory(selectedAccountId);
  }

  renderTransactionTable();
}
