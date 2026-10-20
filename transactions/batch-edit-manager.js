// ============================================================
// transactions/batch-edit-manager.js — Batched Category & Memo Edits
//
// Accumulates category overrides and memo changes locally, then
// flushes them to the backend in a single POST /bulk-update call.
//
// Flush triggers (whichever fires first):
//   1. Pending queue reaches BATCH_FLUSH_THRESHOLD items
//   2. User stops editing for BATCH_FLUSH_DEBOUNCE_MS
//   3. User clicks outside the transaction table (blur)
//   4. Page visibility changes or beforeunload fires
//
// Optimistic updates: the in-memory `transactions` array and
// the visible DOM cells are updated immediately so the user sees
// their changes without waiting for the network round-trip.
//
// Refused items: the backend answers 200 even when it refuses an item (a
// category edit on a linked transfer saves none of that item's fields).
// Before a row is changed optimistically, the values being overwritten are
// noted; when the item comes back refused they are put back in memory and on
// screen, and the backend's reason goes to the status bar, so neither the
// table nor the local cache keeps a value the server rejected.
// ============================================================

const BATCH_FLUSH_DEBOUNCE_MS = 2500;
const BATCH_FLUSH_THRESHOLD = 5;

/**
 * Map of transaction_id → { user_category?, user_memo? }.
 * Only contains items not yet sent to the backend.
 */
const _pendingBatchEdits = new Map();

/**
 * Map of transaction_id → the values this row's staged edits overwrote, as
 * noted by _noteBatchEditBaseline. Covers the rows staged since the last
 * flush; a flush moves the sent rows' entries out so edits made while the
 * request is in flight are noted separately.
 */
const _batchEditBaselines = new Map();

let _batchFlushTimer = null;
let _batchFlushInFlight = false;

// ───── Public API ──────────────────────────────────────────

/**
 * Stage a category and/or memo change for deferred bulk submission.
 * Immediately applies an optimistic update to the in-memory data and DOM
 * so the user sees the result without waiting for the API round-trip.
 *
 * @param {string} transactionId — universal transaction_id
 * @param {object} changes — { user_category?: string, user_memo?: string }
 */
function stageBatchEdit(transactionId, changes) {
  if (!transactionId || !changes) return;

  // Compare each field against the current in-memory value to avoid
  // staging no-op edits. This is critical for virtual BILL_FUTURE rows
  // where "echoing" the same category back would trigger materialization.
  const actualChanges = _filterUnchangedFields(transactionId, changes);
  if (Object.keys(actualChanges).length === 0) return;

  const existing = _pendingBatchEdits.get(transactionId) || {};
  _pendingBatchEdits.set(transactionId, { ...existing, ...actualChanges });

  _applyOptimisticUpdate(transactionId, actualChanges);

  _resetFlushTimer();

  if (_pendingBatchEdits.size >= BATCH_FLUSH_THRESHOLD) {
    flushBatchEdits();
  }
}

/**
 * Immediately send all pending edits to the backend.
 * Safe to call multiple times — guards against concurrent flushes
 * and no-ops when the queue is empty.
 */
async function flushBatchEdits() {
  if (_pendingBatchEdits.size === 0) return;
  if (_batchFlushInFlight) return;

  _clearFlushTimer();
  _batchFlushInFlight = true;

  // Snapshot and clear the queue so new edits during the request
  // accumulate into a fresh batch rather than being lost. The baselines of
  // the sent rows travel with the request; an edit staged to one of these
  // rows meanwhile notes its own baseline from the then-current values.
  const updates = [];
  const sentBaselines = new Map();
  for (const [transactionId, fields] of _pendingBatchEdits.entries()) {
    updates.push({ transaction_id: transactionId, ...fields });
    if (_batchEditBaselines.has(transactionId)) {
      sentBaselines.set(transactionId, _batchEditBaselines.get(transactionId));
      _batchEditBaselines.delete(transactionId);
    }
  }
  _pendingBatchEdits.clear();

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/bulk-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Bulk update failed');
    }

    const summary = data.summary || {};
    const results = data.results || [];
    const totalApplied = (summary.categories_updated || 0) + (summary.memos_updated || 0);

    // When a virtual bill row gets materialized, the backend returns the
    // new real transaction_id. We need to update both the in-memory array
    // and the DOM so subsequent edits target the persisted row, not the
    // now-defunct virtual ID.
    _remapMaterializedIds(results);

    // Put refused rows back first: the awaits below can write the whole
    // array to the cache, and it must not hold a value the server rejected.
    const revertPlan = _planBatchEditReverts(results, sentBaselines, _pendingBatchEdits);
    _applyBatchEditReverts(revertPlan);

    await _applyBatchAnalyticsClasses(results);

    const failedCount = Math.max(summary.errors || 0, revertPlan.failedCount);
    if (failedCount > 0) {
      showStatus(_describeBatchEditFailures(totalApplied, failedCount, revertPlan.errors), 'warning');
    } else if (totalApplied > 0) {
      showStatus(`Saved ${totalApplied} edit${totalApplied > 1 ? 's' : ''}`, 'success');
      setTimeout(() => clearStatus(), 2000);
    }

    // Persist the optimistic state to localStorage so a page reload
    // does not revert changes (backend is already updated).
    _persistTransactionCache();

  } catch (flushError) {
    console.error('Batch flush failed:', flushError);
    showStatus(`Bulk save failed: ${flushError.message}`, 'error');

    // Re-queue the failed items so the next flush retries them,
    // unless the user has already staged newer values.
    for (const failedUpdate of updates) {
      const txnId = failedUpdate.transaction_id;
      // The retry can still be refused, so keep on record what the server
      // holds. The sent baseline is older than anything noted while the
      // request was in flight, so it wins.
      if (sentBaselines.has(txnId)) {
        _carryBaselineValues(txnId, sentBaselines.get(txnId));
      }
      if (!_pendingBatchEdits.has(txnId)) {
        const retriable = {};
        if (failedUpdate.user_category) retriable.user_category = failedUpdate.user_category;
        if (failedUpdate.user_memo !== undefined) retriable.user_memo = failedUpdate.user_memo;
        _pendingBatchEdits.set(txnId, retriable);
      }
    }
    // Schedule a retry after a short delay
    _resetFlushTimer();
  } finally {
    _batchFlushInFlight = false;
  }
}

/**
 * Returns true when there are unsent edits waiting in the queue.
 */
function hasPendingBatchEdits() {
  return _pendingBatchEdits.size > 0;
}

// ───── Optimistic Updates ──────────────────────────────────

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
 * Strip out fields whose value is identical to what the transaction already
 * has. Returns a new object containing only genuinely modified fields.
 * Normalises null/undefined to empty string for comparison so "no memo" and
 * "" are treated as the same.
 */
function _filterUnchangedFields(transactionId, changes) {
  const txn = _findTransactionOrSplitChild(transactionId);
  if (!txn) return changes;

  const filtered = {};

  if ('user_category' in changes) {
    const incomingCategory = (changes.user_category || '').trim();
    const currentCategory  = (txn.user_category || '').trim();
    if (incomingCategory !== currentCategory) {
      filtered.user_category = changes.user_category;
    }
  }

  if ('user_memo' in changes) {
    const incomingMemo = (changes.user_memo || '').trim();
    const currentMemo  = (txn.user_memo || '').trim();
    if (incomingMemo !== currentMemo) {
      filtered.user_memo = changes.user_memo;
    }
  }

  return filtered;
}

function _applyOptimisticUpdate(transactionId, changes) {
  const txn = _findTransactionOrSplitChild(transactionId);
  if (!txn) return;

  // Note what this change overwrites before it does, so a refused item can
  // be put back.
  _batchEditBaselines.set(transactionId, _noteBatchEditBaseline(
    _batchEditBaselines.get(transactionId),
    txn,
    changes,
    _readCategoryDisplay(transactionId),
  ));

  let didUpdate = false;

  if (changes.user_category) {
    txn.user_category = changes.user_category;
    // Manual transactions store category directly — no override concept applies.
    if (txn.source !== 'manual') {
      txn.is_override = true;
    }
    _updateCategoryDom(transactionId, changes.user_category);
    didUpdate = true;
  }

  if (changes.user_memo !== undefined) {
    txn.user_memo = changes.user_memo;
    _updateMemoDom(transactionId, changes.user_memo);
    didUpdate = true;
  }
  if (didUpdate && txn.reviewed === false) {
    txn.reviewed = true;
    _removeUnreviewedDotDom(transactionId);
    if (typeof renderAccountsSidebar === 'function') {
      renderAccountsSidebar();
  }
  }
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
 * @param {object} values — the reverted part of a baseline
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
  // Find the row associated with this transaction
  const row = document.querySelector(`tr[data-txn-id="${transactionId}"]`);
  
  if (row) {
    // Find the unreviewed dot inside this specific row
    const dot = row.querySelector('.unreviewed-dot');
    if (dot) {
      dot.remove(); // Deletes the span element from the DOM entirely
    }
  }
}

/**
 * Carry the server's analytics_class for each category-changed row into the
 * in-memory and cached copy. Rows whose result lacks it (or that are split
 * children) get their account re-fetched so no optimistic row keeps a stale class.
 */
async function _applyBatchAnalyticsClasses(results) {
  const staleAccounts = [];
  for (const result of results) {
    if (!result.ok || !(result.applied || []).includes('category')) continue;
    if (_patchAnalyticsClassFromServer(result.transaction_id, result.analytics_class)) continue;
    const txn = _findTransactionOrSplitChild(result.transaction_id);
    staleAccounts.push(txn ? txn.account_id : null);
  }
  if (staleAccounts.length > 0) {
    await _refreshAccountsForStaleAnalyticsClass(staleAccounts);
  }
}

/**
 * After flushBatchEdits, rewrite any virtual bill IDs that the backend
 * materialized into real transaction rows. This keeps the frontend's
 * in-memory state in sync so future edits, context-menu actions, and
 * exports all reference the persisted row instead of the stale virtual ID.
 */
function _remapMaterializedIds(results) {
  for (const result of results) {
    if (!result.materialized || !result.original_virtual_id) continue;

    const oldVirtualId = result.original_virtual_id;
    const newRealId = result.transaction_id;

    const txn = transactions.find(findTxn => findTxn.transaction_id === oldVirtualId);
    if (txn) {
      txn.transaction_id = newRealId;
      txn.source = 'manual';
    }

    const domRow = document.querySelector(`tr[data-txn-id="${oldVirtualId}"]`);
    if (domRow) {
      domRow.setAttribute('data-txn-id', newRealId);
    }

    // If the user staged another edit for the old virtual ID while the
    // flush was in-flight, rewrite the key so the next flush uses the
    // real ID instead.
    if (_pendingBatchEdits.has(oldVirtualId)) {
      const pendingChanges = _pendingBatchEdits.get(oldVirtualId);
      _pendingBatchEdits.delete(oldVirtualId);
      _pendingBatchEdits.set(newRealId, pendingChanges);
    }
    if (_batchEditBaselines.has(oldVirtualId)) {
      _batchEditBaselines.set(newRealId, _batchEditBaselines.get(oldVirtualId));
      _batchEditBaselines.delete(oldVirtualId);
    }
  }
}

// ───── Refused Items ───────────────────────────────────────
// The pure functions decide what to put back and what to say; the
// underscore functions below them carry it out against memory and the DOM.

/**
 * Note the values a staged change is about to overwrite on one row, so the
 * row can be put back if the backend refuses the item. The first value noted
 * for a field wins: editing a row twice before the flush still goes back to
 * what the server holds, not to the first edit.
 *
 * Notes only what _applyOptimisticUpdate will change. A baseline holds up to
 * three groups of keys: user_category with is_override and category_display;
 * user_memo; and reviewed (set false when the change marks an unreviewed row
 * reviewed).
 *
 * @param {object|undefined} baseline — what is already noted for this row
 * @param {object} txn — the row as it is now, before the optimistic change
 * @param {object} changes — the staged change: { user_category?, user_memo? }
 * @param {string|undefined} categoryDisplay — what the category cell shows now, if rendered
 * @returns {object} a new baseline; the one passed in is not modified
 */
function _noteBatchEditBaseline(baseline, txn, changes, categoryDisplay) {
  const noted = { ...baseline };
  const changesCategory = Boolean(changes.user_category);
  const changesMemo = changes.user_memo !== undefined;

  if (changesCategory && !('user_category' in noted)) {
    noted.user_category = txn.user_category;
    noted.is_override = txn.is_override;
    noted.category_display = categoryDisplay;
  }
  if (changesMemo && !('user_memo' in noted)) {
    noted.user_memo = txn.user_memo;
  }
  if ((changesCategory || changesMemo) && txn.reviewed === false && !('reviewed' in noted)) {
    noted.reviewed = false;
  }
  return noted;
}

/**
 * Decide which rows to put back after a bulk save, and to what.
 *
 * Each field of a refused item (ok: false) that the backend did not report
 * as applied goes back to the noted baseline. A linked-transfer refusal
 * saves none of the item's fields; a memo that errors after its category went
 * through leaves the category saved, and it stays. A field the user has
 * staged again since the request left also stays: that newer value is still
 * waiting for the next flush, so the baseline is handed over to guard it in
 * case it is refused too.
 *
 * @param {Array<object>} results — results[] from the bulk-update response
 * @param {Map<string, object>} baselines — staged transaction_id → baseline for the sent batch
 * @param {Map<string, object>} newerEdits — edits staged since the request left, by transaction_id
 * @returns {{
 *   reverts: Array<{transactionId: string, values: object}>,
 *   handovers: Array<{transactionId: string, values: object}>,
 *   failedCount: number,
 *   errors: string[]
 * }} reverts: values to put back now; handovers: values that become the
 *   baseline of a newer staged edit; errors: the backend's reason for each
 *   refused item that gave one
 */
function _planBatchEditReverts(results, baselines, newerEdits) {
  const plan = { reverts: [], handovers: [], failedCount: 0, errors: [] };

  for (const result of results || []) {
    if (!result || result.ok !== false) continue;

    plan.failedCount += 1;
    if (typeof result.error === 'string' && result.error.trim()) {
      plan.errors.push(result.error.trim());
    }

    // A materialized virtual bill row was staged under its virtual id but is
    // answered under its new real id.
    const stagedId = result.original_virtual_id || result.transaction_id;
    const baseline = baselines.get(stagedId);
    if (!baseline) continue;

    const saved = Array.isArray(result.applied) ? result.applied : [];
    const categorySaved = saved.includes('category');
    const memoSaved = saved.includes('memo');
    const newer = newerEdits.get(result.transaction_id) || {};
    const putBack = {};
    const handOver = {};
    const sortValues = (isSuperseded, values) => {
      Object.assign(isSuperseded ? handOver : putBack, values);
    };

    if ('user_category' in baseline && !categorySaved) {
      sortValues('user_category' in newer, {
        user_category: baseline.user_category,
        is_override: baseline.is_override,
        category_display: baseline.category_display,
      });
    }
    if ('user_memo' in baseline && !memoSaved) {
      sortValues('user_memo' in newer, { user_memo: baseline.user_memo });
    }
    // Saving either field marks the row reviewed on the backend.
    if ('reviewed' in baseline && !categorySaved && !memoSaved) {
      // Any newer edit marks the row reviewed when it saves, so the flag is
      // still that edit's to settle.
      sortValues(Object.keys(newer).length > 0, { reviewed: baseline.reviewed });
    }

    if (Object.keys(putBack).length > 0) {
      plan.reverts.push({ transactionId: result.transaction_id, values: putBack });
    }
    if (Object.keys(handOver).length > 0) {
      plan.handovers.push({ transactionId: result.transaction_id, values: handOver });
    }
  }

  return plan;
}

/**
 * Status-bar text for a bulk save in which the backend refused some items.
 * Carries the backend's own reason, the sentence the single-edit paths show,
 * instead of only a count. Identical reasons are shown once.
 *
 * @param {number} appliedCount — edits the backend saved
 * @param {number} failedCount — items the backend refused
 * @param {string[]} reasons — the backend's reason for each refused item that gave one
 * @returns {string}
 */
function _describeBatchEditFailures(appliedCount, failedCount, reasons) {
  const countsText = `Bulk save: ${appliedCount} applied, ${failedCount} failed`;
  const distinctReasons = Array.from(new Set(reasons || []));
  if (distinctReasons.length === 0) return countsText;
  return `${countsText} — ${distinctReasons.join(' / ')}`;
}

/**
 * Carry out a plan from _planBatchEditReverts against the in-memory rows and
 * the DOM. Call this before the cache is written so the cached copy of a
 * refused row matches the server.
 */
function _applyBatchEditReverts(plan) {
  let reviewedFlagChanged = false;

  for (const { transactionId, values } of plan.reverts) {
    const txn = _findTransactionOrSplitChild(transactionId);
    if (!txn) continue;

    if ('user_category' in values) {
      txn.user_category = values.user_category;
      txn.is_override = values.is_override;
      _restoreCategoryDom(transactionId, values);
    }

    if ('user_memo' in values) {
      txn.user_memo = values.user_memo;
      // An open memo editor holds the user's typing. Rewriting its span
      // would destroy the editor and leave it flagged as active.
      const memoEditorIsOpen = document.querySelector(`.inline-memo-input[data-txn-id="${transactionId}"]`);
      if (!memoEditorIsOpen) {
        _updateMemoDom(transactionId, values.user_memo);
      }
    }

    if ('reviewed' in values) {
      txn.reviewed = values.reviewed;
      reviewedFlagChanged = true;
    }
  }

  for (const { transactionId, values } of plan.handovers) {
    _carryBaselineValues(transactionId, values);
  }

  if (reviewedFlagChanged && typeof renderAccountsSidebar === 'function') {
    renderAccountsSidebar();
  }
}

/**
 * Merge older baseline values into a row's current baseline. The older
 * values describe the server; the current ones were noted from optimistic
 * values while a request was in flight, so the older ones win.
 */
function _carryBaselineValues(transactionId, olderValues) {
  _batchEditBaselines.set(transactionId, {
    ...(_batchEditBaselines.get(transactionId) || {}),
    ...olderValues,
  });
}

// ───── Flush Scheduling ────────────────────────────────────

function _resetFlushTimer() {
  _clearFlushTimer();
  _batchFlushTimer = setTimeout(() => {
    flushBatchEdits();
  }, BATCH_FLUSH_DEBOUNCE_MS);
}

function _clearFlushTimer() {
  if (_batchFlushTimer) {
    clearTimeout(_batchFlushTimer);
    _batchFlushTimer = null;
  }
}

function _persistTransactionCache() {
  _cacheTransactions(transactions);
}

// ───── Global Listeners ────────────────────────────────────
// Flush pending edits when the user navigates away or the tab
// loses focus, so nothing is silently dropped.

function initBatchEditListeners() {
  window.addEventListener('beforeunload', () => {
    if (_pendingBatchEdits.size > 0) {
      const updates = [];
      for (const [transactionId, fields] of _pendingBatchEdits.entries()) {
        updates.push({ transaction_id: transactionId, ...fields });
      }
      _pendingBatchEdits.clear();

      // keepalive lets the request outlive the page teardown while still
      // allowing custom headers (unlike sendBeacon which cannot attach auth).
      try {
        const authToken = token || localStorage.getItem('authToken') || '';
        fetch(`${BACKEND_URL}/api/transactions/bulk-update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ updates }),
          keepalive: true,
        });
      } catch (teardownError) {
        console.warn('Page-exit flush failed, edits may be lost:', teardownError);
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushBatchEdits();
    }
  });

  // Flush when clicking outside the table area — signals the user
  // is done with the editing flow.
  document.addEventListener('mousedown', (clickEvent) => {
    if (_pendingBatchEdits.size === 0) return;

    const tableContainer = document.getElementById('table-container');
    if (tableContainer && !tableContainer.contains(clickEvent.target)) {
      flushBatchEdits();
    }
  });
}
