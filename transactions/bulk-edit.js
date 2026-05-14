// ============================================================
// transactions/bulk-edit.js — TXN-018 Bulk Edit
//
// Owns the bulk-edit modal, preflight + apply API calls, and the
// per-row Dexie patch after a successful apply. Mirrors the modular
// shape of `batch-edit-manager.js` (which handles the tab-cycle
// inline edit flow and is intentionally left alone here).
//
// Source of truth for selection: `bulkEditState` in state.js. Other
// modules read/clear it but should not maintain parallel selection
// sets.
// ============================================================

const BULK_EDIT_FIELD_LABELS = Object.freeze({
  user_category: 'Category',
  user_memo:     'Memo',
  description:   'Description',
  amount:        'Amount',
  is_hidden:     'Hidden',
});

const BULK_EDIT_INPUT_TYPE = Object.freeze({
  user_category: 'category',
  user_memo:     'text',
  description:   'text',
  amount:        'number',
  is_hidden:     'toggle',
});

// ── Selectability ────────────────────────────────────────────────

/**
 * True when the given transaction must NOT be selectable in bulk
 * mode. Mirrors the backend's `rejected_ids` rules: system rows,
 * transient match rows, virtual BILL_FUTURE rows, and split parents.
 * Split children are excluded in v1 as well (see plan Appendix A.5).
 *
 * @param {Object} txn - Transaction record from the visibleTransactions array.
 * @returns {boolean}
 */
function isRowBulkRejected(txn) {
  if (!txn) return true;
  const txnType = getTransactionType(txn);
  if (!txnType) return true;
  if (SYSTEM_TYPES.has(txnType)) return true;
  if (txnType === TXN_TYPE.MANUAL_MATCH || txnType === TXN_TYPE.BILL_MATCHED) return true;
  if (txnType === TXN_TYPE.BILL_FUTURE) return true;
  if (txn.is_split) return true;
  return false;
}

/**
 * Enumerate the bulk-eligible transaction IDs in the current
 * filtered view (`visibleTransactions`). Respects search, account,
 * date, and toggle filters because those have already been applied
 * by the time visibleTransactions is set.
 *
 * @returns {string[]}
 */
function getBulkEligibleVisibleIds() {
  const eligible = [];
  for (let idx = 0; idx < visibleTransactions.length; idx++) {
    const txn = visibleTransactions[idx];
    if (isRowBulkRejected(txn)) continue;
    if (txn.transaction_id) eligible.push(txn.transaction_id);
  }
  return eligible;
}

// ── Mode transitions ─────────────────────────────────────────────

/**
 * Enter bulk-edit mode. Re-renders the table so the checkbox column
 * appears and the toolbar swaps to the bulk-mode buttons.
 */
function enterBulkEditMode() {
  bulkEditState.active = true;
  _refreshBulkToolbar();
  renderTransactionTable();
}

/**
 * Exit bulk-edit mode and clear the selection.
 */
function exitBulkEditMode() {
  bulkEditState.active = false;
  bulkEditState.selectedIds = new Set();
  bulkEditState.preflight = null;
  _refreshBulkToolbar();
  renderTransactionTable();
}

/**
 * Toggle a single transaction's selection state.
 *
 * @param {string} txnId
 * @param {boolean} shouldSelect
 */
function toggleBulkSelection(txnId, shouldSelect) {
  if (!txnId) return;
  if (shouldSelect) {
    if (bulkEditState.selectedIds.size >= BULK_EDIT_MAX_SELECTION
        && !bulkEditState.selectedIds.has(txnId)) {
      showStatus(`Selection capped at ${BULK_EDIT_MAX_SELECTION}`, 'warning');
      return;
    }
    bulkEditState.selectedIds.add(txnId);
  } else {
    bulkEditState.selectedIds.delete(txnId);
  }
  _refreshBulkToolbar();
  _refreshBulkHeader();
}

/**
 * Select every bulk-eligible row in the currently filtered view, or
 * deselect all of them. Honours the 500-row client cap.
 */
function toggleSelectAllVisibleBulk(shouldSelectAll) {
  const eligible = getBulkEligibleVisibleIds();

  if (shouldSelectAll) {
    let capped = false;
    for (let idx = 0; idx < eligible.length; idx++) {
      if (bulkEditState.selectedIds.size >= BULK_EDIT_MAX_SELECTION) {
        capped = true;
        break;
      }
      bulkEditState.selectedIds.add(eligible[idx]);
    }
    if (capped) {
      showStatus(`Selection capped at ${BULK_EDIT_MAX_SELECTION}`, 'warning');
    }
  } else {
    // Only deselect visible-eligible ids — preserves any selections
    // hidden behind the current filter set.
    for (let idx = 0; idx < eligible.length; idx++) {
      bulkEditState.selectedIds.delete(eligible[idx]);
    }
  }
  _refreshBulkToolbar();
  renderTransactionTable();
}

// ── Toolbar / header helpers ─────────────────────────────────────

function _refreshBulkToolbar() {
  const enterBtn   = document.getElementById('btn-bulk-modify');
  const editBtn    = document.getElementById('btn-bulk-edit-selected');
  const cancelBtn  = document.getElementById('btn-bulk-cancel');
  const unhideBar  = document.getElementById('batch-unhide-toolbar');

  if (!enterBtn || !editBtn || !cancelBtn) return;

  const count = bulkEditState.selectedIds.size;
  editBtn.textContent = `Edit selected (${count})`;
  editBtn.disabled = count === 0;

  if (bulkEditState.active) {
    enterBtn.classList.add('hidden');
    editBtn.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    // Hide the batch-unhide toolbar while bulk mode is active to keep
    // the two selection flows from competing for the same row UI.
    if (unhideBar) unhideBar.classList.add('hidden');
  } else {
    enterBtn.classList.remove('hidden');
    editBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    // Restore the batch-unhide toolbar visibility based on its own
    // toggle (the show-hidden checkbox owns it).
    const showHiddenToggle = document.getElementById('show-hidden-toggle');
    if (unhideBar && showHiddenToggle) {
      unhideBar.classList.toggle('hidden', !showHiddenToggle.checked);
    }
  }
}

function _refreshBulkHeader() {
  const pill = document.getElementById('bulk-selected-count');
  if (pill) pill.textContent = `${bulkEditState.selectedIds.size} selected`;
}

// ── API client ───────────────────────────────────────────────────

async function _postBulkPreflight(transactionIds) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/bulk-edit/preflight`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_ids: transactionIds }),
    },
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

async function _postBulkApply(transactionIds, changes) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/bulk-edit/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_ids: transactionIds, changes }),
    },
  );
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, body };
}

// ── Open / orchestrate the modal ─────────────────────────────────

/**
 * Run preflight for the current selection and open the bulk-edit modal.
 * Called by the "Edit selected" toolbar button.
 */
async function openBulkEditModal() {
  const ids = Array.from(bulkEditState.selectedIds);
  if (ids.length === 0) {
    showStatus('No transactions selected', 'warning');
    return;
  }
  if (ids.length > BULK_EDIT_MAX_SELECTION) {
    showStatus(`Selection capped at ${BULK_EDIT_MAX_SELECTION}`, 'warning');
    return;
  }

  let preflight;
  try {
    preflight = await _postBulkPreflight(ids);
  } catch (networkErr) {
    showStatus(`Preflight failed: ${networkErr.message}`, 'error');
    return;
  }

  if (!preflight.ok) {
    if (preflight.status === 413) {
      showStatus(`Selection too large (max ${preflight.body.max_batch_size || BULK_EDIT_MAX_SELECTION})`, 'error');
    } else {
      showStatus(preflight.body.error || 'Preflight failed', 'error');
    }
    return;
  }

  bulkEditState.preflight = preflight.body;
  _dropRejectedIds(preflight.body.rejected_ids || []);
  _renderBulkEditModal(preflight.body);
}

function _dropRejectedIds(rejectedIds) {
  if (!rejectedIds || rejectedIds.length === 0) return;
  for (let idx = 0; idx < rejectedIds.length; idx++) {
    bulkEditState.selectedIds.delete(rejectedIds[idx]);
  }
  showStatus(`Removed ${rejectedIds.length} non-editable row(s) from selection`, 'warning');
  _refreshBulkToolbar();
}

// ── Modal rendering ──────────────────────────────────────────────

function _renderBulkEditModal(preflight) {
  _closeBulkEditModal();

  const overlay = document.createElement('div');
  overlay.id = 'bulk-edit-modal';
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', evt => {
    if (evt.target === overlay) _closeBulkEditModal();
  });

  const modal = document.createElement('div');
  modal.className = 'modal modal-bulk-edit';
  overlay.appendChild(modal);

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Bulk modify ${preflight.selection_count} transaction${preflight.selection_count !== 1 ? 's' : ''}</h2>
      <button class="modal-close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="modal-body">
      <p class="bulk-edit-instructions">
        Check a field, enter a value, and click Apply. Only fields legal for
        every selected row are listed below.
      </p>
      <div class="bulk-edit-fields"></div>
      <div class="bulk-edit-blockers"></div>
    </div>
    <div class="modal-footer">
      <button class="secondary" id="bulk-edit-cancel-btn" type="button">Cancel</button>
      <button id="bulk-edit-apply-btn" type="button">Apply</button>
    </div>
  `;

  const fieldsContainer   = modal.querySelector('.bulk-edit-fields');
  const blockersContainer = modal.querySelector('.bulk-edit-blockers');

  _renderLegalFieldRows(fieldsContainer, preflight.legal_fields || []);
  _renderBlockersFooter(blockersContainer, preflight.blockers || {});

  modal.querySelector('.modal-close').addEventListener('click', _closeBulkEditModal);
  modal.querySelector('#bulk-edit-cancel-btn').addEventListener('click', _closeBulkEditModal);
  modal.querySelector('#bulk-edit-apply-btn').addEventListener('click', _onBulkEditApplyClick);

  document.body.appendChild(overlay);
}

function _closeBulkEditModal() {
  const existing = document.getElementById('bulk-edit-modal');
  if (existing) existing.remove();
}

function _renderLegalFieldRows(container, legalFields) {
  if (legalFields.length === 0) {
    container.innerHTML = '<div class="bulk-edit-empty">No fields are legal for this selection.</div>';
    return;
  }
  for (let idx = 0; idx < legalFields.length; idx++) {
    const fieldKey = legalFields[idx];
    container.appendChild(_buildFieldRow(fieldKey));
  }

  // Wire up category autocomplete (must run after DOM insertion).
  const catInput = container.querySelector('#bulk-field-input-user_category');
  const catList  = container.querySelector('#bulk-field-list-user_category');
  if (catInput && catList && typeof wireUpCategoryAutocomplete === 'function') {
    // Refresh from shared cache so the dropdown has data even when the
    // page-level `availableCategories` global is empty (e.g. cold load).
    // Wire immediately with whatever is in memory; re-wire once the fetch
    // resolves so the latest list is available.
    const initialList = (typeof availableCategories !== 'undefined' && availableCategories)
      ? availableCategories
      : [];
    const acOptions = {
      categories: initialList,
      itemClass:  'bulk-edit-category-ac-item',
      emptyClass: 'bulk-edit-category-ac-empty',
      moreClass:  'bulk-edit-category-ac-more',
    };
    wireUpCategoryAutocomplete(catInput, catList, acOptions);

    if (typeof fetchCategoriesWithCache === 'function') {
      fetchCategoriesWithCache().then(fresh => {
        if (!fresh || fresh.length === 0) return;
        if (typeof availableCategories !== 'undefined') {
          availableCategories = fresh;
        }
        const liveInput = container.querySelector('#bulk-field-input-user_category');
        const liveList  = container.querySelector('#bulk-field-list-user_category');
        if (liveInput && liveList) {
          const currentValue = liveInput.value;
          const rewiredInput = wireUpCategoryAutocomplete(liveInput, liveList, {
            ...acOptions,
            categories: fresh,
          });
          if (currentValue) {
            rewiredInput.value = currentValue;
          }
        }
      }).catch(() => { /* non-critical — keep initial list */ });
    }
  }
}

function _buildFieldRow(fieldKey) {
  const label = BULK_EDIT_FIELD_LABELS[fieldKey] || fieldKey;
  const row = document.createElement('div');
  row.className = 'bulk-edit-field-row';
  row.dataset.field = fieldKey;

  row.innerHTML = `
    <label class="bulk-edit-field-toggle">
      <input type="checkbox" class="bulk-edit-field-checkbox" data-field="${fieldKey}">
      <span>${label}</span>
    </label>
    <div class="bulk-edit-field-input" data-field="${fieldKey}"></div>
  `;

  const inputContainer = row.querySelector('.bulk-edit-field-input');
  inputContainer.appendChild(_buildBulkEditInputForField(fieldKey));
  return row;
}

// Renamed from _buildInputForField to prevent global-scope collision with the
// identically-named helper in inline-edit.js — both files load as plain scripts
// on transactions.html, so the second declaration silently overrode the first
// and broke the inline date editor (placeholder "New date" leaking through).
function _buildBulkEditInputForField(fieldKey) {
  const inputType = BULK_EDIT_INPUT_TYPE[fieldKey];
  if (inputType === 'category') {
    const wrap = document.createElement('div');
    wrap.className = 'bulk-edit-category-wrap';
    wrap.innerHTML = `
      <input type="text" id="bulk-field-input-user_category"
             class="modal-input bulk-edit-category-input"
             placeholder="Type to search categories…" autocomplete="off">
      <div id="bulk-field-list-user_category" class="bulk-edit-category-ac-list"></div>
    `;
    return wrap;
  }
  if (inputType === 'toggle') {
    const wrap = document.createElement('label');
    wrap.className = 'bulk-edit-toggle-wrap';
    wrap.innerHTML = `
      <input type="checkbox" id="bulk-field-input-${fieldKey}">
      <span>Set hidden = true</span>
    `;
    return wrap;
  }
  if (inputType === 'number') {
    const inputEl = document.createElement('input');
    inputEl.type = 'number';
    inputEl.step = '0.01';
    inputEl.id = `bulk-field-input-${fieldKey}`;
    inputEl.className = 'modal-input';
    inputEl.placeholder = 'New amount (signed)';
    return inputEl;
  }
  const textEl = document.createElement('input');
  textEl.type = 'text';
  textEl.id = `bulk-field-input-${fieldKey}`;
  textEl.className = 'modal-input';
  textEl.placeholder = `New ${(BULK_EDIT_FIELD_LABELS[fieldKey] || fieldKey).toLowerCase()}`;
  return textEl;
}

function _renderBlockersFooter(container, blockers) {
  const fieldKeys = Object.keys(blockers || {});
  if (fieldKeys.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '<div class="bulk-edit-blockers-title">Not editable for this selection</div>';
  for (let idx = 0; idx < fieldKeys.length; idx++) {
    const fieldKey   = fieldKeys[idx];
    const fieldLabel = BULK_EDIT_FIELD_LABELS[fieldKey] || fieldKey;
    const offenders  = blockers[fieldKey] || [];
    const topThree   = offenders.slice(0, 3);
    const summary    = topThree.map(o => `${o.transaction_id}: ${o.reason}`).join('\n');

    html += `
      <div class="bulk-edit-blocker-row">
        <span class="bulk-edit-blocker-field" title="${escapeHtml(summary)}">${fieldLabel}</span>
        <span class="bulk-edit-blocker-count">${offenders.length} row${offenders.length !== 1 ? 's' : ''} blocking</span>
        ${offenders.length > 3
          ? `<button type="button" class="bulk-edit-blocker-expand" data-field="${fieldKey}">View all</button>`
          : ''}
      </div>
      <div class="bulk-edit-blocker-detail hidden" data-field="${fieldKey}">
        <ul>
          ${offenders.map(o => `<li><code>${escapeHtml(o.transaction_id)}</code>: ${escapeHtml(o.reason)}</li>`).join('')}
        </ul>
      </div>
    `;
  }
  container.innerHTML = html;

  container.querySelectorAll('.bulk-edit-blocker-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const detail = container.querySelector(`.bulk-edit-blocker-detail[data-field="${field}"]`);
      if (detail) detail.classList.toggle('hidden');
    });
  });
}

// ── Apply flow ───────────────────────────────────────────────────

async function _onBulkEditApplyClick() {
  if (bulkEditState.applying) return;

  const blankRequired = _findBlankRequiredField();
  if (blankRequired) {
    showStatus(`Enter a value for ${BULK_EDIT_FIELD_LABELS[blankRequired] || blankRequired} (or uncheck it)`, 'warning');
    return;
  }

  const changes = _collectChangesFromModal();
  if (Object.keys(changes).length === 0) {
    showStatus('Check at least one field to apply', 'warning');
    return;
  }

  const ids = Array.from(bulkEditState.selectedIds);
  if (ids.length === 0) {
    showStatus('Selection is empty', 'warning');
    return;
  }

  const applyBtn = document.getElementById('bulk-edit-apply-btn');
  bulkEditState.applying = true;
  if (applyBtn) {
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
  }

  try {
    const result = await _postBulkApply(ids, changes);

    if (result.status === 409) {
      // Selection legality drifted. Re-open the modal with the new
      // preflight payload so the user can pick a still-legal field set.
      showStatus('Selection changed during edit — please re-confirm', 'warning');
      bulkEditState.preflight = result.body;
      _renderBulkEditModal(result.body);
      return;
    }

    if (!result.ok) {
      const errMsg = result.body && result.body.error
        ? result.body.error
        : `Apply failed (status ${result.status})`;
      showStatus(errMsg, 'error');
      return;
    }

    _patchCacheFromApplyResults(result.body, changes);
    const summary = result.body.summary || {};
    const succeeded = summary.succeeded || 0;
    const failed    = summary.failed || 0;

    if (failed === 0) {
      showStatus(`Updated ${succeeded} transaction${succeeded !== 1 ? 's' : ''}`, 'success');
    } else {
      _showPartialFailureToast(succeeded, failed, result.body.results || []);
    }

    _closeBulkEditModal();
    exitBulkEditMode();
  } catch (networkErr) {
    showStatus(`Apply failed: ${networkErr.message}`, 'error');
  } finally {
    bulkEditState.applying = false;
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply';
    }
  }
}

function _findBlankRequiredField() {
  const REQUIRED_TEXT_FIELDS = ['user_category', 'description'];
  const checkboxes = document.querySelectorAll('.bulk-edit-field-checkbox');
  for (let idx = 0; idx < checkboxes.length; idx++) {
    const checkbox = checkboxes[idx];
    if (!checkbox.checked) continue;
    const field = checkbox.dataset.field;
    if (!REQUIRED_TEXT_FIELDS.includes(field)) continue;
    const raw = _readFieldValue(field);
    if (typeof raw === 'string' && raw.trim() === '') return field;
  }
  return null;
}

function _collectChangesFromModal() {
  const changes = {};
  document.querySelectorAll('.bulk-edit-field-checkbox').forEach(checkbox => {
    if (!checkbox.checked) return;
    const field = checkbox.dataset.field;
    const value = _readFieldValue(field);
    if (value === undefined) return;
    // Drop trimmed-empty strings for required text fields so the user gets
    // an actionable client-side error instead of a backend 400 round-trip.
    if (typeof value === 'string' && value.trim() === ''
        && (field === 'user_category' || field === 'description')) {
      return;
    }
    changes[field] = value;
  });
  return changes;
}

function _readFieldValue(fieldKey) {
  const inputType = BULK_EDIT_INPUT_TYPE[fieldKey];
  if (inputType === 'toggle') {
    const el = document.getElementById(`bulk-field-input-${fieldKey}`);
    return !!(el && el.checked);
  }
  if (inputType === 'number') {
    const el = document.getElementById(`bulk-field-input-${fieldKey}`);
    if (!el || el.value === '') return undefined;
    const num = parseFloat(el.value);
    if (Number.isNaN(num)) return undefined;
    return num;
  }
  const el = document.getElementById(`bulk-field-input-${fieldKey}`);
  if (!el) return undefined;
  return el.value;
}

// ── Dexie / in-memory patching from apply response ───────────────

/**
 * Walk the `results[]` from a successful /apply response and patch
 * both the in-memory transactions array and IndexedDB so the table
 * re-renders without a network refetch. Each row is patched
 * individually because description / category writes split between
 * the override column and the direct column depending on row type.
 */
function _patchCacheFromApplyResults(applyBody, changes) {
  const results = applyBody.results || [];
  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx];
    if (!result.ok) continue;
    const txn = transactions.find(t => t.transaction_id === result.transaction_id);
    if (!txn) continue;

    const applied = result.applied || [];
    const patch = _buildPerRowPatch(txn, applied, changes);
    if (Object.keys(patch).length > 0) {
      _patchCachedTransaction(result.transaction_id, patch);
    }
  }
}

function _buildPerRowPatch(txn, appliedFields, changes) {
  const txnType = getTransactionType(txn);
  const isPlaidSource = txn.source === 'plaid';
  const patch = {};

  for (let idx = 0; idx < appliedFields.length; idx++) {
    const field = appliedFields[idx];
    if (field === 'user_memo') {
      patch.user_memo = changes.user_memo;
    } else if (field === 'is_hidden') {
      patch.is_hidden = !!changes.is_hidden;
    } else if (field === 'amount') {
      patch.amount = changes.amount;
      if (txnType === TXN_TYPE.PLAID_CONVERTED) {
        patch.amount_modified = true;
      }
    } else if (field === 'description') {
      // Backend split: plaid rows get user_description_override; others
      // get description + merchant_name directly. Frontend mirrors this
      // so the rendered display matches the persisted state.
      if (isPlaidSource) {
        patch.user_description_override = changes.description;
      } else {
        patch.description = changes.description;
        patch.merchant_name = changes.description;
      }
    } else if (field === 'user_category') {
      patch.user_category = changes.user_category;
      if (isPlaidSource) {
        patch.is_override = true;
      }
    }
  }
  return patch;
}

function _showPartialFailureToast(succeeded, failed, results) {
  const failures = results.filter(r => !r.ok);
  showStatus(`${succeeded} updated, ${failed} failed`, 'warning');
  console.warn('Bulk edit partial failures:', failures);
}
