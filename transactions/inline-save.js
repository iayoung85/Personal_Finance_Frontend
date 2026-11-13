// ============================================================
// transactions/inline-save.js — Tab-flow category and memo saves
//
// A category accepted with Tab, or a memo committed from the inline
// editor, is saved at once through the single-row endpoint for that
// field. The cell changes before the request goes out so tabbing on
// never waits for the network.
//
// A refused save puts that row's cell back to what the server holds and
// shows the backend's reason as a warning. Warnings stay up on their own
// timer (see showStatus), so a later save's success cannot hide one.
//
// One field of one row has at most one request in flight. An edit made
// meanwhile waits and is sent when that request settles; several such
// edits send only the newest. Answers therefore arrive in the order the
// edits were sent, and the server cannot end up holding an older value
// than the cell shows.
//
// The two fields of one row are saved independently, and each answer
// carries the whole row. An answer built before the other field's save
// reached the server holds that field's older value, so a field another
// answer has already confirmed keeps the confirmed value.
// ============================================================

/**
 * Saves per field and row, keyed by `${field}:${transactionId}`, kept only
 * while a request is in flight. Each record holds:
 *   transactionId — the id requests go to; a virtual bill row's id changes
 *                   once the server saves it as a real row
 *   field         — 'category' or 'memo'
 *   serverValues  — what the server holds for that field, to put back
 *   queuedValue   — the newest edit waiting to be sent, or undefined
 */
const _inlineSaveRecords = new Map();

/**
 * The value an accepted answer confirmed for one field of a row, keyed like
 * the save records and kept while either field of the row has a save in
 * flight. Each holds:
 *   values     — the field's values as the server saved them
 *   answeredAt — the clock reading when the answer arrived
 */
const _settledInlineFields = new Map();

/**
 * Counts sends and answers, so an answer can tell whether the other field's
 * confirmed value reached this client after its own request went out.
 */
let _inlineSaveClock = 0;

// ───── Public API ──────────────────────────────────────────

/**
 * Save a category accepted by Tab in the category cell.
 *
 * @param {string} transactionId — universal transaction_id
 * @param {string} categoryString — "Primary: Detailed"
 * @returns {Promise<void>} settles when the server has answered
 */
async function saveInlineCategory(transactionId, categoryString) {
  const txn = _findTransactionOrSplitChild(transactionId);
  if (!txn) {
    _refreshOutOfDateRow();
    return;
  }
  if (_isSameText(categoryString, txn.user_category)) return;

  const record = _inlineSaveRecordFor('category', transactionId, {
    user_category: txn.user_category,
    is_override: txn.is_override,
    category_display: _readCategoryDisplay(transactionId),
    reviewed: txn.reviewed,
  });
  _applyCategoryLocally(txn, transactionId, categoryString);
  await _runInlineSaves(record, categoryString);
}

/**
 * Save a memo committed from the inline memo editor. The editor has
 * already drawn the new text into the cell.
 *
 * @param {string} transactionId — universal transaction_id
 * @param {string} memoText — the trimmed memo; empty clears it
 * @returns {Promise<void>} settles when the server has answered
 */
async function saveInlineMemo(transactionId, memoText) {
  const txn = _findTransactionOrSplitChild(transactionId);
  if (!txn) {
    _refreshOutOfDateRow();
    return;
  }
  if (_isSameText(memoText, txn.user_memo)) return;

  const record = _inlineSaveRecordFor('memo', transactionId, {
    user_memo: txn.user_memo,
    reviewed: txn.reviewed,
  });
  txn.user_memo = memoText;
  _updateMemoDom(transactionId, memoText);
  syncPendingHideButton(txn);
  _markReviewedLocally(txn, transactionId);
  await _runInlineSaves(record, memoText);
}

// ───── Save Queue ──────────────────────────────────────────

/**
 * The save record for one field of one row. A record that already exists
 * keeps its record of the server's values: the row's current values are
 * then an edit still waiting on the server.
 */
function _inlineSaveRecordFor(field, transactionId, currentValues) {
  const key = `${field}:${transactionId}`;
  let record = _inlineSaveRecords.get(key);
  if (!record) {
    record = { transactionId, field, serverValues: currentValues, queuedValue: undefined, running: false, sentAt: 0 };
    _inlineSaveRecords.set(key, record);
  }
  return record;
}

/**
 * Queue a value and, unless a request for this field and row is already in
 * flight, send queued values one at a time until none is left. When the
 * last answer was a refusal, the row goes back to what the server holds.
 *
 * @param {object} record — from _inlineSaveRecordFor
 * @param {string} value — the edit to send
 */
async function _runInlineSaves(record, value) {
  record.queuedValue = value;
  if (record.running) return;
  record.running = true;

  let lastAnswerRefused = false;
  while (record.queuedValue !== undefined) {
    const sentValue = record.queuedValue;
    record.queuedValue = undefined;
    _inlineSaveClock += 1;
    record.sentAt = _inlineSaveClock;
    const answer = await _sendInlineSave(record.field, record.transactionId, sentValue);

    if (answer.ok) {
      lastAnswerRefused = false;
      await _settleSavedAnswer(record, sentValue, answer.data);
    } else {
      lastAnswerRefused = true;
      showStatus(answer.message, answer.statusType);
    }
  }

  _inlineSaveRecords.delete(`${record.field}:${record.transactionId}`);
  if (lastAnswerRefused) {
    _putBackServerValues(record);
  }
  _forgetSettledFieldsWhenIdle(record.transactionId);
}

/**
 * Drop a row's confirmed values once neither field has a save in flight: a
 * request sent later is built after both, so they can no longer be needed.
 */
function _forgetSettledFieldsWhenIdle(transactionId) {
  const fields = ['category', 'memo'];
  if (fields.some(field => _inlineSaveRecords.has(`${field}:${transactionId}`))) return;
  fields.forEach(field => _settledInlineFields.delete(`${field}:${transactionId}`));
}

/**
 * Send one field's value for one row.
 *
 * @returns {Promise<{ok: true, data: object} | {ok: false, message: string, statusType: string}>}
 */
async function _sendInlineSave(field, transactionId, value) {
  const fieldName = field === 'category' ? 'Category' : 'Memo';
  const request = field === 'category'
    ? {
      url: `${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(transactionId)}/categorize`,
      body: { user_category: value },
    }
    : {
      url: `${BACKEND_URL}/api/transactions/add-memo`,
      body: { transaction_id: transactionId, user_memo: value },
    };

  try {
    const response = await authenticatedFetch(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
    });
    const data = await response.json();
    if (!response.ok) {
      return { ok: false, message: data.error || `${fieldName} not saved`, statusType: 'warning' };
    }
    return { ok: true, data };
  } catch (requestError) {
    return { ok: false, message: `${fieldName} not saved: ${requestError.message}`, statusType: 'error' };
  }
}

/**
 * Record a save the server accepted and carry its answer into memory and
 * the cache. While a newer edit of the field is still queued, the row keeps
 * showing that edit; only the id change and the server's record are taken.
 */
async function _settleSavedAnswer(record, sentValue, data) {
  const isNewest = record.queuedValue === undefined;

  if (record.field === 'category') {
    record.serverValues = { ...record.serverValues, user_category: sentValue, category_display: sentValue };
    await _applySavedCategory(record, sentValue, data, isNewest);
  } else {
    record.serverValues = { ...record.serverValues, user_memo: sentValue };
    await _applySavedMemo(record, data);
  }

  // The server marks a row reviewed on any accepted edit.
  for (const field of ['category', 'memo']) {
    const rowRecord = _inlineSaveRecords.get(`${field}:${record.transactionId}`);
    if (rowRecord) {
      rowRecord.serverValues = { ...rowRecord.serverValues, reviewed: true };
    }
  }
  const txn = _findTransactionOrSplitChild(record.transactionId);
  if (txn) {
    _markReviewedLocally(txn, record.transactionId);
  }

  if (isNewest) {
    showStatus(record.field === 'category' ? `Category saved: ${sentValue}` : 'Memo saved', 'success');
  }
}

/**
 * Put one field of a row back to what the server holds, after its newest
 * edit was refused or never reached the server.
 */
function _putBackServerValues(record) {
  const txn = _findTransactionOrSplitChild(record.transactionId);
  if (!txn) return;
  const serverValues = record.serverValues;

  if (record.field === 'category') {
    txn.user_category = serverValues.user_category;
    txn.is_override = serverValues.is_override;
    _restoreCategoryDom(record.transactionId, serverValues);
  } else {
    txn.user_memo = serverValues.user_memo;
    // An open memo editor holds the user's typing. Rewriting its span
    // would destroy the editor and leave it flagged as active.
    const memoEditorIsOpen = document.querySelector(`.inline-memo-input[data-txn-id="${record.transactionId}"]`);
    if (!memoEditorIsOpen) {
      _updateMemoDom(record.transactionId, serverValues.user_memo);
    }
  }

  const otherField = record.field === 'category' ? 'memo' : 'category';
  const otherSaveInFlight = _inlineSaveRecords.has(`${otherField}:${record.transactionId}`);
  if (serverValues.reviewed === false && txn.reviewed !== false && !otherSaveInFlight) {
    txn.reviewed = false;
    if (typeof renderAccountsSidebar === 'function') {
      renderAccountsSidebar();
    }
  }

  syncPendingHideButton(txn);
  _cacheRow(record.transactionId);
}

// ───── Redrawing a Row That Changed Shape ───────────────────

/**
 * Whether a saved row can no longer be shown by patching the cells that
 * were edited. A bill occurrence saved as a real row loses its bill badge
 * and gains a status and delete button; a split parent gains pieces. Both
 * need the row drawn again.
 *
 * @param {string} sentId The id the save was sent for.
 * @param {object|null} savedRow The saved row from the answer, if any.
 * @returns {boolean} True when the table must be drawn again.
 */
function savedRowNeedsRedraw(sentId, savedRow) {
  if (!savedRow) return false;
  if (savedRow.transaction_id !== sentId) return true;
  return Boolean(savedRow.is_split || (Array.isArray(savedRow.splits) && savedRow.splits.length > 0));
}

const _INLINE_EDITOR_SELECTOR = '.inline-memo-input, .inline-edit-input, .category-autocomplete';
let _tableRedrawOwed = false;

/**
 * Draw the table again, or, while the user is typing in an inline editor
 * (Tab moves them on to the next row before this answer lands), once they
 * leave the last one. Drawing the table under an open editor would throw
 * away what they are typing.
 */
function _redrawTableOnceNoEditorIsOpen() {
  if (!_isInlineEditorFocused()) {
    _tableRedrawOwed = false;
    renderTransactionTable();
    return;
  }
  _tableRedrawOwed = true;
}

function _isInlineEditorFocused() {
  const activeElement = document.activeElement;
  return Boolean(activeElement && activeElement.matches && activeElement.matches(_INLINE_EDITOR_SELECTOR));
}

const _TAB_FLOW_EDITOR_SELECTOR = '.inline-memo-input, .category-autocomplete';

// Control+S draws the table now instead of waiting for the user to leave
// the grid. In a memo or category cell it first finishes that edit the way
// Enter does, so nothing typed is lost. Other fields (the row editor, which
// saves and redraws itself, search, modal forms) are left alone. Control,
// not Cmd: Cmd+S is the browser's Save Page.
document.addEventListener('keydown', (keyEvent) => {
  const isControlS = keyEvent.ctrlKey && !keyEvent.metaKey && (keyEvent.key === 's' || keyEvent.key === 'S');
  if (!isControlS) return;

  const activeElement = document.activeElement;
  const isInTabFlowEditor = Boolean(
    activeElement && activeElement.matches && activeElement.matches(_TAB_FLOW_EDITOR_SELECTOR),
  );
  const isInOtherField = Boolean(
    activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName),
  ) && !isInTabFlowEditor;
  if (isInOtherField) return;

  keyEvent.preventDefault();
  if (isInTabFlowEditor) {
    activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  _tableRedrawOwed = false;
  renderTransactionTable();
});

// Focus leaving an editor lands on the next one only after this event, and
// the category cell settles its own text 200 ms after blur, so the check
// waits past both.
document.addEventListener('focusout', () => {
  if (!_tableRedrawOwed) return;
  setTimeout(() => {
    if (_tableRedrawOwed && !_isInlineEditorFocused()) {
      _tableRedrawOwed = false;
      renderTransactionTable();
    }
  }, 250);
});

// ───── Applying Changes ────────────────────────────────────

/**
 * Show a category on the row before the server answers.
 */
function _applyCategoryLocally(txn, transactionId, categoryString) {
  txn.user_category = categoryString;
  // Manual transactions store their category directly; no override applies.
  if (txn.source !== 'manual') {
    txn.is_override = true;
  }
  _updateCategoryDom(transactionId, categoryString);
  syncPendingHideButton(txn);
  _markReviewedLocally(txn, transactionId);
}

/**
 * Carry a saved category's server answer into memory and the cache: the
 * real row a virtual bill occurrence became, the transfer partner the
 * change touched, and the analytics class only the server can compute.
 *
 * @param {object} record — the category save record
 * @param {string} categoryString — the value this answer saved
 * @param {object} data — the categorize response
 * @param {boolean} isNewest — false while a newer edit is queued, which
 *   keeps the row's optimistic category
 */
async function _applySavedCategory(record, categoryString, data, isNewest) {
  const sentId = record.transactionId;
  const savedRow = await _applyInlineSaveResponse(record, data, !isNewest);
  if (savedRowNeedsRedraw(sentId, savedRow)) {
    _redrawTableOnceNoEditorIsOpen();
  }

  const txn = _findTransactionOrSplitChild(record.transactionId);
  if (txn && 'is_override' in txn) {
    record.serverValues = { ...record.serverValues, is_override: txn.is_override };
  }
  if (txn) {
    syncPendingHideButton(txn);
    _cacheRow(record.transactionId);
  }

  // Invalidate the categories page cache so its overrides summary refreshes.
  try {
    localStorage.removeItem('pf_catpage_data');
    localStorage.removeItem('pf_catpage_cached_at');
  } catch (storageError) { /* cache removal failure is non-fatal */ }
}

/**
 * Carry a saved memo's server answer into memory and the cache. A virtual
 * bill occurrence is saved as a new real row under a new id; a bill with a
 * splits template saves as a split parent with pieces.
 *
 * @param {object} record — the memo save record
 * @param {object} data — the add-memo response
 */
async function _applySavedMemo(record, data) {
  const sentId = record.transactionId;
  const savedRow = await _applyInlineSaveResponse(record, data, record.queuedValue !== undefined);
  _cacheRow(record.transactionId);
  if (savedRowNeedsRedraw(sentId, savedRow)) {
    _redrawTableOnceNoEditorIsOpen();
  }
}

/**
 * Put a save's answer into the page through the one changed-rows entry
 * point, keeping what the user has typed on the row since. The answer
 * replaces the row, so a field with an edit still on its way (this field
 * with a newer edit queued, or the other field with a request in flight)
 * would show the older server value until its own answer; those fields are
 * put back from what the row showed before. The other field's value that an
 * answer confirmed after this request went out is kept the same way.
 *
 * A virtual bill occurrence saved as a real row first has its id, the
 * elements tagged with it and the saves in flight pointed at the new id,
 * from the response's `transaction_id`.
 *
 * @param {object} record — the save record being settled
 * @param {object} data — the save response
 * @param {boolean} keepOwnField — true while a newer edit of this record's
 *   field is queued
 * @returns {Promise<object|null>} The saved row, or null when the response
 *   does not carry it.
 */
async function _applyInlineSaveResponse(record, data, keepOwnField) {
  const sentId = record.transactionId;
  const rowBefore = _findTransactionOrSplitChild(sentId);
  const keptEdits = _readEditsStillOnTheWay(record, keepOwnField, rowBefore);

  if (data.transaction_id && data.transaction_id !== sentId) {
    _remapTransactionId(sentId, data.transaction_id);
  }
  // Recorded before anything is awaited, so an answer for the other field
  // that is applied meanwhile already sees this value.
  _recordSettledField(record, data);

  await applyRowChangesFromResponse(data, fallbackAccountIdsForRow(rowBefore));

  _keepNewerSettledField(record, keptEdits);
  _putBackEditsStillOnTheWay(record.transactionId, keptEdits);
  return findSavedRowInResponse(data);
}

/**
 * Remember the value this answer confirmed for its own field.
 *
 * @param {object} record — the save record being settled
 * @param {object} data — the save response
 */
function _recordSettledField(record, data) {
  const savedRow = findSavedRowInResponse(data);
  let values;
  if (record.field === 'category') {
    values = { user_category: savedRow ? savedRow.user_category : record.serverValues.user_category };
    if (savedRow && 'is_override' in savedRow) values.is_override = savedRow.is_override;
  } else {
    values = { user_memo: savedRow ? savedRow.user_memo : record.serverValues.user_memo };
  }
  _inlineSaveClock += 1;
  _settledInlineFields.set(`${record.field}:${record.transactionId}`, { values, answeredAt: _inlineSaveClock });
}

/**
 * Keep the other field's confirmed value when its answer arrived after this
 * request went out: this answer's row may have been built before that save,
 * and the server now holds the confirmed value. An edit of that field still
 * on its way is newer again and takes precedence.
 *
 * @param {object} record — the save record being settled
 * @param {{category?: object, memo?: object}} keptEdits — filled in place
 */
function _keepNewerSettledField(record, keptEdits) {
  const otherField = record.field === 'category' ? 'memo' : 'category';
  if (keptEdits[otherField]) return;
  const settled = _settledInlineFields.get(`${otherField}:${record.transactionId}`);
  if (settled && settled.answeredAt > record.sentAt) {
    keptEdits[otherField] = settled.values;
  }
}

/**
 * What the row shows for each field that has an edit not yet answered.
 *
 * @returns {{category?: object, memo?: object}}
 */
function _readEditsStillOnTheWay(record, keepOwnField, row) {
  const kept = {};
  if (!row) return kept;
  const sentId = record.transactionId;

  const categoryOnTheWay = record.field === 'category'
    ? keepOwnField
    : _inlineSaveRecords.has(`category:${sentId}`);
  const memoOnTheWay = record.field === 'memo'
    ? keepOwnField
    : _inlineSaveRecords.has(`memo:${sentId}`);

  if (categoryOnTheWay) kept.category = { user_category: row.user_category, is_override: row.is_override };
  if (memoOnTheWay) kept.memo = { user_memo: row.user_memo };
  return kept;
}

/**
 * Show the edits kept by _readEditsStillOnTheWay on the row the answer put
 * in memory.
 */
function _putBackEditsStillOnTheWay(transactionId, kept) {
  const row = _findTransactionOrSplitChild(transactionId);
  if (!row) return;
  if (kept.category) {
    row.user_category = kept.category.user_category;
    if ('is_override' in kept.category) row.is_override = kept.category.is_override;
  }
  if (kept.memo) {
    row.user_memo = kept.memo.user_memo;
  }
}

/**
 * Write one row to the browser cache. A split child is stored inside its
 * parent, so the parent is written.
 */
function _cacheRow(transactionId) {
  const topLevelRow = transactions.find(row => row.transaction_id === transactionId);
  if (topLevelRow) {
    _replaceCachedTransaction(transactionId, topLevelRow);
    return;
  }
  const parentRow = transactions.find(row => (
    Array.isArray(row.splits) && row.splits.some(child => child.transaction_id === transactionId)
  ));
  if (parentRow) {
    _replaceCachedTransaction(parentRow.transaction_id, parentRow);
  }
}

/**
 * An edit marks a row reviewed on the server; show that now.
 */
function _markReviewedLocally(txn, transactionId) {
  if (txn.reviewed !== false) return;
  txn.reviewed = true;
  _removeUnreviewedDotDom(transactionId);
  if (typeof renderAccountsSidebar === 'function') {
    renderAccountsSidebar();
  }
}

/**
 * Point the in-memory row, every element tagged with its old id, and any
 * save in flight on it at the id the server saved it under, so later edits
 * and menus reach the real row.
 */
function _remapTransactionId(oldId, newId) {
  const txn = _findTransactionOrSplitChild(oldId);
  if (txn) {
    txn.transaction_id = newId;
  }

  for (const element of document.querySelectorAll(`[data-txn-id="${oldId}"]`)) {
    element.setAttribute('data-txn-id', newId);
    // jQuery caches data attributes on first read; the cache must follow.
    $(element).data('txn-id', newId);
  }

  for (const field of ['category', 'memo']) {
    const record = _inlineSaveRecords.get(`${field}:${oldId}`);
    if (record) {
      _inlineSaveRecords.delete(`${field}:${oldId}`);
      record.transactionId = newId;
      _inlineSaveRecords.set(`${field}:${newId}`, record);
    }
    const settled = _settledInlineFields.get(`${field}:${oldId}`);
    if (settled) {
      _settledInlineFields.delete(`${field}:${oldId}`);
      _settledInlineFields.set(`${field}:${newId}`, settled);
    }
  }
}

/**
 * The edited row is on screen but no longer in memory: the server replaced
 * it, and the table has not been drawn since. Draw it again so the next edit
 * reaches the row that exists.
 */
function _refreshOutOfDateRow() {
  showStatus('That row was out of date, so the table was redrawn. Make the edit again.', 'warning');
  renderTransactionTable();
}

// ───── Row Lookup and DOM ──────────────────────────────────

/**
 * Compare two field values as the user sees them: "no value" and ""
 * are the same, and surrounding spaces do not count.
 */
function _isSameText(first, second) {
  return (first || '').trim() === (second || '').trim();
}

/**
 * Look up a transaction by ID in the main array, falling back to
 * split children nested under parent transactions.
 */
function _findTransactionOrSplitChild(transactionId) {
  const txn = transactions.find(findTxn => findTxn.transaction_id === transactionId);
  if (txn) return txn;

  for (const parentTxn of transactions) {
    if (parentTxn.splits) {
      const splitChild = parentTxn.splits.find(splitItem => splitItem.transaction_id === transactionId);
      if (splitChild) return splitChild;
    }
  }
  return null;
}

/**
 * Find a transaction's row and category autocomplete input in the DOM.
 * Either is falsy when the row is not rendered.
 */
function _findCategoryDom(transactionId) {
  // Normal rows: tr[data-txn-id] matches the transaction_id directly.
  // Split child rows: the <tr> uses the parent's ID. The autocomplete input
  // inside has data-txn-id set to the child's own transaction_id.
  let row = document.querySelector(`tr[data-txn-id="${transactionId}"]`);
  let categoryInput;

  if (row) {
    categoryInput = row.querySelector('.category-autocomplete');
  } else {
    categoryInput = document.querySelector(`.category-autocomplete[data-txn-id="${transactionId}"]`);
    if (categoryInput) {
      row = categoryInput.closest('tr');
    }
  }

  return { row, categoryInput };
}

/**
 * Update the category autocomplete input in the DOM without a full
 * table re-render. Also updates the data attribute on the row so
 * context menus and exports see the new value.
 */
function _updateCategoryDom(transactionId, categoryString) {
  const { row, categoryInput } = _findCategoryDom(transactionId);

  if (row) {
    row.setAttribute('data-user-category', categoryString);
  }

  if (categoryInput) {
    categoryInput.value = categoryString;
    $(categoryInput).data('committedCategoryValue', categoryString);
  }
}

/**
 * What the category cell shows before an edit changes it, or undefined when
 * the row is not rendered. This is not always the row's user_category: a
 * linked transfer shows its partner account's current name, and a row with
 * no category of its own shows Plaid's.
 */
function _readCategoryDisplay(transactionId) {
  const { categoryInput } = _findCategoryDom(transactionId);
  if (!categoryInput) return undefined;

  // The committed value was captured when the user focused the cell, so it
  // is still the old text after they have typed the new category into it.
  const committedValue = $(categoryInput).data('committedCategoryValue');
  return committedValue !== undefined ? committedValue : categoryInput.value;
}

/**
 * Put the category cell back after the backend refused the edit. A cell the
 * user has typed into since keeps that text; its committed value is reset
 * either way, so leaving the cell snaps it back.
 *
 * @param {string} transactionId
 * @param {object} values — { user_category, category_display }
 */
function _restoreCategoryDom(transactionId, values) {
  const { row, categoryInput } = _findCategoryDom(transactionId);

  if (row) {
    row.setAttribute('data-user-category', values.user_category || '');
  }
  if (!categoryInput) return;

  const restoredText = values.category_display !== undefined
    ? values.category_display
    : (values.user_category || '');
  // The committed value still holds the refused text, so a cell whose text
  // differs from it has been typed into since.
  const refusedText = $(categoryInput).data('committedCategoryValue');
  const userIsTyping = document.activeElement === categoryInput
    && categoryInput.value !== refusedText;

  $(categoryInput).data('committedCategoryValue', restoredText);
  if (!userIsTyping) {
    categoryInput.value = restoredText;
  }
}

/**
 * Update the memo display in the DOM without a full table re-render.
 */
function _updateMemoDom(transactionId, memoValue) {
  // Normal rows have data-txn-id on the <tr> matching the transaction_id.
  // Split child rows store the child's transaction_id on the memo span itself
  // (not on the <tr>, which uses the parent's ID).
  let memoSpan;
  const row = document.querySelector(`tr[data-txn-id="${transactionId}"]`);
  if (row) {
    memoSpan = row.querySelector('.txn-memo-text');
  } else {
    memoSpan = document.querySelector(`.txn-memo-text[data-txn-id="${transactionId}"]`);
  }

  if (memoSpan) {
    if (memoValue) {
      memoSpan.textContent = memoValue;
      memoSpan.title = memoValue;
    } else {
      memoSpan.innerHTML = '<em class="memo-placeholder">add memo…</em>';
      memoSpan.title = '';
    }
  }
}

/**
 * Remove the unreviewed dot from the DOM without a full table re-render.
 */
function _removeUnreviewedDotDom(transactionId) {
  const row = document.querySelector(`tr[data-txn-id="${transactionId}"]`);
  if (!row) return;
  const dot = row.querySelector('.unreviewed-dot');
  if (dot) {
    dot.remove();
  }
}
