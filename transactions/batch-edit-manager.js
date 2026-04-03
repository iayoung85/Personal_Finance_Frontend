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
// ============================================================

const BATCH_FLUSH_DEBOUNCE_MS = 2500;
const BATCH_FLUSH_THRESHOLD = 5;

/**
 * Map of transaction_id → { user_category?, user_memo? }.
 * Only contains items not yet sent to the backend.
 */
const _pendingBatchEdits = new Map();

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
  // accumulate into a fresh batch rather than being lost.
  const updates = [];
  for (const [transactionId, fields] of _pendingBatchEdits.entries()) {
    updates.push({ transaction_id: transactionId, ...fields });
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

    if (summary.errors > 0) {
      showStatus(`Bulk save: ${totalApplied} applied, ${summary.errors} failed`, 'warning');
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
 * Strip out fields whose value is identical to what the transaction already
 * has. Returns a new object containing only genuinely modified fields.
 * Normalises null/undefined to empty string for comparison so "no memo" and
 * "" are treated as the same.
 */
function _filterUnchangedFields(transactionId, changes) {
  const txn = transactions.find(findTxn => findTxn.transaction_id === transactionId);
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
  const txn = transactions.find(findTxn => findTxn.transaction_id === transactionId);
  if (!txn) return;

  if (changes.user_category) {
    txn.user_category = changes.user_category;
    txn.is_override = true;
    _updateCategoryDom(transactionId, changes.user_category);
  }

  if (changes.user_memo !== undefined) {
    txn.user_memo = changes.user_memo;
    _updateMemoDom(transactionId, changes.user_memo);
  }
}

/**
 * Update the category autocomplete input in the DOM without a full
 * table re-render. Also updates the data attribute on the row so
 * context menus and exports see the new value.
 */
function _updateCategoryDom(transactionId, categoryString) {
  const row = document.querySelector(`tr[data-txn-id="${transactionId}"]`);
  if (!row) return;

  row.setAttribute('data-user-category', categoryString);

  const categoryInput = row.querySelector('.category-autocomplete');
  if (categoryInput) {
    categoryInput.value = categoryString;
    // Update the committed value so blur doesn't revert the text
    $(categoryInput).data('committedCategoryValue', categoryString);
  }
}

/**
 * Update the memo display in the DOM without a full table re-render.
 */
function _updateMemoDom(transactionId, memoValue) {
  const row = document.querySelector(`tr[data-txn-id="${transactionId}"]`);
  if (!row) return;

  const memoSpan = row.querySelector('.txn-memo-text');
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
  }
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
