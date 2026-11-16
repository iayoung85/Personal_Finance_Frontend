// ============================================================
// transactions/resolution.js — Resolution Center
// Banner display, Resolution Center modal, and inline quick-fix
// actions for MANUAL_ORPHANED transactions after re-link events.
// ============================================================

// ─── API helpers (all go through authenticatedFetch) ────────

/**
 * Fetch the reconciliation banner status from backend.
 * Returns {missing_count, orphaned_count, accounts_affected}
 */
async function fetchReconciliationStatus() {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/resolution/status`
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch reconciliation status');
  }
  return response.json();
}

/**
 * Fetch the orphaned manual transactions with decrypted details.
 * Returns {orphaned_transactions, missing_transactions}, the second an
 * alias of the first.
 */
async function fetchOrphanedTransactions() {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/resolution/proposals`
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch orphaned transactions');
  }
  return response.json();
}

/**
 * Batch-resolve orphaned transactions.
 * payload: { delete_orphaned: [txn_id,...] }
 *
 * Note: force_keep is no longer supported. Orphans must be deleted
 * or force-matched via forceMatchOrphanToPlaid().
 */
async function resolveReconciliationBatch(payload) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/resolution/resolve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to resolve reconciliation batch');
  }
  return response.json();
}

/**
 * Force-match an orphaned manual transaction to any plaid transaction.
 * The orphan is rewritten to adopt the plaid txn's amount and account.
 */
async function forceMatchOrphanToPlaid(orphanTransactionId, targetPlaidTransactionId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/resolution/force_match`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orphan_transaction_id: orphanTransactionId,
        target_plaid_transaction_id: targetPlaidTransactionId,
      }),
    }
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to force match transactions');
  }
  return response.json();
}

/**
 * Relocate an orphaned transaction to a manual/converted account.
 * The orphan keeps all original properties, only account_id changes.
 */
async function relocateOrphanToAccount(orphanTransactionId, targetAccountId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/resolution/relocate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orphan_transaction_id: orphanTransactionId,
        target_account_id: targetAccountId,
      }),
    }
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to relocate transaction');
  }
  return response.json();
}

/**
 * Manually match a specific manual/missing txn with a plaid txn.
 * Used by the "Match to adjacent transaction" quick-fix flow.
 */
async function manualReconciliationMatch(manualTransactionId, targetTransactionId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/resolution/match`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manual_transaction_id: manualTransactionId,
        target_transaction_id: targetTransactionId,
      }),
    }
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to match transactions');
  }
  return response.json();
}

// ─── Banner ─────────────────────────────────────────────────

/**
 * Check reconciliation status and render or hide the banner.
 * Called after page load and after any sync/refresh.
 */
async function checkAndRenderReconciliationBanner() {
  const bannerEl = document.getElementById('reconciliation-banner');
  if (!bannerEl) return;

  try {
    const status = await fetchReconciliationStatus();
    const orphanedCount = status.orphaned_count || 0;

    if (orphanedCount <= 0) {
      bannerEl.classList.add('hidden');
      return;
    }

    bannerEl.innerHTML = `
      <span class="reconciliation-banner-icon">⚠️</span>
      <span class="reconciliation-banner-text">
        <strong>${orphanedCount}</strong> relink conflict item${orphanedCount !== 1 ? 's' : ''}
        need resolution (orphaned manual transactions).
      </span>
      <span class="reconciliation-banner-actions">
        <button class="btn-banner btn-banner-primary" onclick="openReconciliationCenter()">Review &amp; Resolve</button>
        <button class="btn-banner btn-banner-secondary" onclick="dismissReconciliationBanner()">Ignore for now</button>
      </span>
    `;
    bannerEl.classList.remove('hidden');
  } catch (fetchError) {
    // Non-fatal — quietly hide the banner on error
    console.warn('Reconciliation status check failed:', fetchError);
    bannerEl.classList.add('hidden');
  }
}

function dismissReconciliationBanner() {
  const bannerEl = document.getElementById('reconciliation-banner');
  if (bannerEl) bannerEl.classList.add('hidden');
}

// ─── Resolution Center Modal ────────────────────────────────

/**
 * Open the Resolution Center overlay for orphaned manual transactions.
 * Fetches the orphans, builds the UI, and displays inside the
 * generic modal system (openModal from utils.js).
 */
async function openReconciliationCenter() {
  showStatus('Loading reconciliation data…', 'info');

  try {
    const data = await fetchOrphanedTransactions();

    clearStatus();
    _renderReconciliationModal(data.orphaned_transactions || data.missing_transactions || []);
  } catch (loadError) {
    showStatus(`Failed to load reconciliation data: ${loadError.message}`, 'error');
  }
}

/**
 * Build and display the Resolution Center modal content.
 */
function _renderReconciliationModal(orphanedTransactions) {
  const hasOrphaned = orphanedTransactions.length > 0;

  let bodyHtml = '<div class="recon-center">';

  // ── Orphaned Transactions ──
  if (hasOrphaned) {
    bodyHtml += `
      <div class="recon-section">
        <div class="recon-section-header">
          <h4>Orphaned Transactions (${orphanedTransactions.length})</h4>
          <div class="recon-bulk-actions">
            <button class="btn-recon btn-recon-bulk-delete"
                    onclick="_bulkActionOrphaned('delete')">
              🗑 Delete Selected
            </button>
            <button class="btn-recon btn-recon-bulk-match"
                    onclick="_bulkForceMatchOrphaned()">
              🔗 Force Match Selected
            </button>
          </div>
        </div>
        <p class="recon-section-desc">
          These MANUAL_ORPHANED transactions were created by relinking conflict detection.
          Select items and choose an action, or handle them individually.
          Force Match rewrites the orphan to match a plaid transaction you choose.
        </p>
        <div class="recon-missing-list">
          <label class="recon-select-all-label">
            <input type="checkbox" id="recon-select-all-missing"
                   onchange="_toggleAllOrphanedCheckboxes(this.checked)">
            <span>Select All</span>
          </label>
    `;

    orphanedTransactions.forEach(txn => {
      const sourceLabel = 'Orphaned';
      const sourceBadgeClass = 'orphaned';

      bodyHtml += `
        <div class="recon-missing-row" data-txn-id="${escapeHtml(txn.transaction_id || '')}">
          <input type="checkbox" class="recon-missing-checkbox"
                 value="${escapeHtml(txn.transaction_id || '')}">
          <span class="source-badge ${sourceBadgeClass}">${sourceLabel}</span>
          <span class="recon-missing-date">${escapeHtml(txn.date || '—')}</span>
          <span class="recon-missing-desc">${escapeHtml(txn.description || txn.name || '—')}</span>
          <span class="recon-missing-amount">${_formatCurrency(txn.amount)}</span>
          <span class="recon-missing-category">${escapeHtml(txn.user_category || '—')}</span>
          <span class="recon-missing-actions">
            <button class="btn-recon btn-recon-delete-single"
                onclick="_singleOrphanedAction('${escapeHtml(txn.transaction_id)}', 'delete')"
                    title="Delete this transaction permanently">🗑</button>
            <button class="btn-recon btn-recon-match-single"
                    onclick="_startForceMatchFromModal('${escapeHtml(txn.transaction_id)}')"
                    title="Force match to a plaid transaction">🔗</button>
          </span>
        </div>
      `;
    });

    bodyHtml += '</div></div>';
  }

  if (!hasOrphaned) {
    bodyHtml += '<p class="recon-empty">No pending resolution items. Everything is in sync.</p>';
  }

  bodyHtml += '</div>';

  openModal({
    title: 'Resolution Center',
    body: bodyHtml,
    actions: [
      {
        label: 'Close',
        className: 'secondary',
        onClick: closeModal,
      },
    ],
  });

  // Widen the modal for the resolution center — the orphan rows are wide.
  const modalEl = document.querySelector('#modal-overlay .modal');
  if (modalEl) {
    modalEl.style.width = 'min(920px, 95vw)';
    modalEl.style.maxHeight = '85vh';
    modalEl.style.overflow = 'auto';
  }
}

// ─── Orphaned transaction checkbox/action helpers ───────────

function _toggleAllOrphanedCheckboxes(checked) {
  const checkboxes = document.querySelectorAll('.recon-missing-checkbox');
  checkboxes.forEach(cb => { cb.checked = checked; });
}

/**
 * The orphans a batch delete left in place, with the API's reason for each.
 * A skipped orphan is still in the ledger, so it must not be reported or
 * removed as deleted.
 * @param {object} batchResult - response of resolveReconciliationBatch
 * @returns {Map<string, string>} transaction id -> reason
 */
function skippedOrphanReasons(batchResult) {
  const reasons = new Map();
  const skipped = (batchResult && batchResult.skipped) || [];
  skipped.forEach(skip => reasons.set(skip.transaction_id, skip.reason));
  return reasons;
}

function _getSelectedOrphanedIds() {
  const checked = document.querySelectorAll('.recon-missing-checkbox:checked');
  return Array.from(checked).map(cb => cb.value);
}

async function _bulkActionOrphaned(action) {
  const selectedIds = _getSelectedOrphanedIds();
  if (selectedIds.length === 0) {
    showStatus('No transactions selected', 'warning');
    return;
  }

  if (action !== 'delete') {
    showStatus('Only delete is supported as a bulk action for orphans', 'warning');
    return;
  }

  if (!confirm(`Delete ${selectedIds.length} transaction(s) permanently?`)) return;

  try {
    const payload = { delete_orphaned: selectedIds };

    // Balances are applied with the rows in _refreshAfterBatchResolve.
    const batchResult = await resolveReconciliationBatch(payload);
    const skippedReasons = skippedOrphanReasons(batchResult);
    const deletedIds = selectedIds.filter(txnId => !skippedReasons.has(txnId));
    if (skippedReasons.size > 0) {
      const firstReason = skippedReasons.values().next().value;
      showStatus(
        `${deletedIds.length} transaction(s) deleted, ${skippedReasons.size} not deleted: ${firstReason}`,
        'warning'
      );
    } else {
      showStatus(`${deletedIds.length} transaction(s) deleted`, 'success');
    }

    // Remove resolved rows from the modal DOM
    deletedIds.forEach(txnId => {
      const row = document.querySelector(`.recon-missing-row[data-txn-id="${txnId}"]`);
      if (row) row.remove();
    });

    // Refresh main transaction list in the background
    _refreshAfterBatchResolve(batchResult);
  } catch (resolveError) {
    showStatus(`Bulk action failed: ${resolveError.message}`, 'error');
  }
}

async function _singleOrphanedAction(transactionId, action) {
  if (action !== 'delete') {
    showStatus('Only delete is supported. Use Force Match to keep an orphan.', 'warning');
    return;
  }

  if (!confirm('Delete this transaction permanently?')) return;

  try {
    const payload = { delete_orphaned: [transactionId] };

    const batchResult = await resolveReconciliationBatch(payload);
    const skippedReason = skippedOrphanReasons(batchResult).get(transactionId);
    if (skippedReason) {
      await applyAffectedAccounts(batchResult);
      showStatus(`Not deleted: ${skippedReason}`, 'error');
      return;
    }
    showStatus('Transaction deleted', 'success');

    // Remove the row from the modal
    const row = document.querySelector(`.recon-missing-row[data-txn-id="${transactionId}"]`);
    if (row) row.remove();

    _refreshAfterBatchResolve(batchResult);
  } catch (resolveError) {
    showStatus(`Action failed: ${resolveError.message}`, 'error');
  }
}

// ─── Pick modes: Force Match and Match to Transaction ───────
// Both modes close any open modal, show an instruction banner above the
// table, and let the user click a row of the real transaction list. What
// differs is the banner text, which rows can be picked, and what a pick
// sends. Everything else (banner, click and Escape listeners, "is a pick
// mode active") is shared below. Only one mode is on at a time.

// Force Match: the orphan to rewrite onto the Plaid row the user clicks.
let _forceMatchOrphanId = null;
// Match to Transaction: the row to match onto the bank row the user clicks.
let _matchSourceId = null;

// The mode that is on: the click handler it installed on the table and the
// status shown when Escape ends it. Null when no mode is on.
let _activePickMode = null;

// The pick handler runs in the capture phase so it sees a click before the
// row's inline editors and buttons do. Those listeners sit on the same
// container (or on the cell itself) and would otherwise open an editor
// instead of picking the row.
const _PICK_MODE_CLICK_OPTIONS = { capture: true };

/**
 * Whether the user is currently choosing a row for a force match or a
 * Match to Transaction. Inline editors check this so a click on a row picks
 * it instead of editing.
 */
function isPickModeActive() {
  return _activePickMode !== null;
}

/**
 * Turn a pick mode on: end the other mode if it is on, close any open
 * modal, show the banner and install the click and Escape listeners.
 *
 * @param {Object} mode
 * @param {string} mode.bannerHtml - Inner HTML of the instruction text.
 * @param {Function} mode.clickHandler - Capture-phase click handler for the table.
 * @param {string} mode.cancelMessage - Info status shown when Escape ends the mode.
 */
function _startPickMode({ bannerHtml, clickHandler, cancelMessage }) {
  exitPickMode();
  _activePickMode = { clickHandler, cancelMessage };

  if (typeof closeModal === 'function') closeModal();
  _showPickModeBanner(bannerHtml);

  const tableContainer = document.getElementById('table-container');
  if (tableContainer) {
    tableContainer.addEventListener('click', clickHandler, _PICK_MODE_CLICK_OPTIONS);
  }
  document.addEventListener('keydown', _pickModeEscapeHandler);
}

/**
 * Enter force-match pick mode: close modal, show instruction banner,
 * install a click handler on the transaction table.
 */
function enterForceMatchPickMode(orphanTxnId) {
  // Find the orphan in the transactions array for display context
  const orphanTxn = transactions.find(txn => txn.transaction_id === orphanTxnId);
  const orphanLabel = orphanTxn
    ? `"${orphanTxn.description || orphanTxn.name || 'Unnamed'}" (${_formatCurrency(orphanTxn.amount)})`
    : orphanTxnId;

  _startPickMode({
    bannerHtml: `
      <strong>Force Match Mode:</strong> Click any <em>Plaid</em> transaction row to match orphan ${escapeHtml(orphanLabel)}.
      The orphan will be rewritten to match the selected transaction's amount and account.
    `,
    clickHandler: _forceMatchRowClickHandler,
    cancelMessage: 'Force match cancelled',
  });
  _forceMatchOrphanId = orphanTxnId;
}

function _showPickModeBanner(bannerHtml) {
  // Remove existing banner if any
  _removePickModeBanner();

  const banner = document.createElement('div');
  banner.id = 'force-match-pick-banner';
  banner.className = 'force-match-pick-banner';
  banner.innerHTML = `
    <span class="force-match-pick-icon">\ud83d\udd17</span>
    <span class="force-match-pick-text">${bannerHtml}</span>
    <button class="btn-banner btn-banner-secondary force-match-pick-cancel"
            onclick="exitPickMode()">Cancel</button>
  `;

  // Insert at the top of the main content area, above the table
  const tableContainer = document.getElementById('table-container');
  if (tableContainer && tableContainer.parentNode) {
    tableContainer.parentNode.insertBefore(banner, tableContainer);
  } else {
    document.body.prepend(banner);
  }
}

function _removePickModeBanner() {
  const existing = document.getElementById('force-match-pick-banner');
  if (existing) existing.remove();
}

/** Turn whichever pick mode is on off: banner, listeners and picked ids. */
function exitPickMode() {
  const endedMode = _activePickMode;
  _activePickMode = null;
  _forceMatchOrphanId = null;
  _matchSourceId = null;
  _removePickModeBanner();

  if (!endedMode) return;
  const tableContainer = document.getElementById('table-container');
  if (tableContainer) {
    tableContainer.removeEventListener('click', endedMode.clickHandler, _PICK_MODE_CLICK_OPTIONS);
  }
  document.removeEventListener('keydown', _pickModeEscapeHandler);
}

function _pickModeEscapeHandler(event) {
  if (event.key !== 'Escape' || !_activePickMode) return;
  const { cancelMessage } = _activePickMode;
  exitPickMode();
  showStatus(cancelMessage, 'info');
}

/**
 * Whether a row may serve as a force-match target: a Plaid row, posted or
 * pending. The API refuses a pending row the user hid, so it is not taken.
 *
 * @param {Object|undefined} txn - The clicked row as the page holds it.
 * @returns {boolean}
 */
function _isForceMatchTarget(txn) {
  if (!txn) return false;
  const txnType = getTransactionType(txn);
  if (txnType === TXN_TYPE.PLAID_CLEARED) return true;
  return txnType === TXN_TYPE.PLAID_PENDING && !txn.is_hidden;
}

async function _forceMatchRowClickHandler(event) {
  if (!_forceMatchOrphanId) return;

  // Find the clicked row
  const row = event.target.closest('tr');
  if (!row) return;

  const clickedTxnId = row.dataset.txnId;
  if (!clickedTxnId) return;

  // The click is a pick, whatever the row holds under the pointer.
  event.preventDefault();
  event.stopPropagation();

  const clickedTxn = transactions.find(txn => txn.transaction_id === clickedTxnId);
  if (!_isForceMatchTarget(clickedTxn)) {
    showStatus('Please click a Plaid transaction (blue "Plaid" badge rows)', 'warning');
    return;
  }

  // Prevent clicking orphaned/system rows
  if (clickedTxnId === _forceMatchOrphanId) {
    showStatus('Cannot match a transaction to itself', 'warning');
    return;
  }

  // Capture the orphan ID before exiting pick mode
  const orphanId = _forceMatchOrphanId;
  exitPickMode();

  try {
    showStatus('Applying force match…', 'info');
    const result = await forceMatchOrphanToPlaid(orphanId, clickedTxnId);
    await applyAffectedAccounts(result);

    if (result.splits_need_repair) {
      showStatus(
        'Force match applied — but split amounts no longer add up. Open the transaction to repair splits.',
        'warning'
      );
    } else {
      showStatus('Force match applied successfully', 'success');
    }

    _refreshAfterReconciliation(result);
  } catch (matchError) {
    showStatus(`Force match failed: ${matchError.message}`, 'error');
  }
}

/**
 * Start force match from the reconciliation modal for a specific orphan.
 * Closes the modal first, then enters pick mode.
 */
function _startForceMatchFromModal(orphanTxnId) {
  enterForceMatchPickMode(orphanTxnId);
}

/**
 * Bulk force match is not practical (each orphan needs a unique target),
 * so the bulk button just enters pick mode for the first selected orphan
 * and shows guidance.
 */
function _bulkForceMatchOrphaned() {
  const selectedIds = _getSelectedOrphanedIds();
  if (selectedIds.length === 0) {
    showStatus('No transactions selected', 'warning');
    return;
  }
  if (selectedIds.length > 1) {
    showStatus('Force match works one at a time. Starting with the first selected orphan.', 'info');
  }
  enterForceMatchPickMode(selectedIds[0]);
}

// ─── Post-resolution refresh ────────────────────────────────

/**
 * Download the whole list again after a resolution.
 *
 * @param {Object} [responseData] The resolution's response, for the ledger
 *   column of the selected account.
 * @returns {Promise<void>}
 */
async function _refreshAfterReconciliation(responseData) {
  _invalidateTransactionCache();
  await fetchAllTransactions(true);
  if (responseData) {
    await refreshSelectedLedgerAfterAffected(responseData);
    renderTransactionTable();
  }

  // Re-check whether the banner should still show
  await checkAndRenderReconciliationBanner();
}

/**
 * Bring the page up to date after a batch delete: balances, the response's
 * changed rows, or the whole list downloaded again when it has none, then
 * the open ledger.
 *
 * @param {Object} batchResult Parsed JSON body of the batch resolve.
 * @returns {Promise<void>}
 */
async function _refreshAfterBatchResolve(batchResult) {
  await applyRowChangesFromResponse(batchResult, null);
  renderTransactionTable();
  await checkAndRenderReconciliationBanner();
}

// ─── Match to Transaction ───────────────────────────────────
// Called from the context menu on a missing, hand-entered, not-yet-due or
// bill row. The user picks the bank row on the real list, so the row is seen
// in its account with its neighbours, then confirms the match.

/**
 * Why a clicked row cannot be the bank row for a source transaction, or null
 * when it can. This is the one rule for which rows may be picked, and the
 * sentence is what the user is told when a click is refused.
 *
 * When the source is MANUAL_CLEARED (user-entered txn waiting for Plaid
 * delivery) or PLAID_CONVERTED, only bank rows are allowed: matching
 * manual-to-manual doesn't make sense in this flow. A bank row is posted or
 * still pending, as the API accepts both; a pending row the user hid is
 * refused because the API refuses it. Split rows are refused because the API
 * refuses a match between two split rows, and rows already carrying a match
 * are refused because they are waiting on their own resolution.
 *
 * @param {Object} sourceTxn - The transaction being matched (a split's parent, never a piece).
 * @param {Object|undefined} targetTxn - The clicked row as the page holds it.
 * @returns {string|null} The reason to show, or null when the row can be picked.
 */
function _matchTargetRefusal(sourceTxn, targetTxn) {
  if (!targetTxn) return 'Please click a bank transaction to match to';
  if (targetTxn.transaction_id === sourceTxn.transaction_id) {
    return 'Cannot match a transaction to itself';
  }

  const sourceType = getTransactionType(sourceTxn);
  const isSourceManualCleared =
    sourceType === TXN_TYPE.MANUAL_CLEARED ||
    sourceType === TXN_TYPE.PLAID_CONVERTED;
  const matchableTargetTypes = isSourceManualCleared
    ? new Set([TXN_TYPE.PLAID_CLEARED, TXN_TYPE.PLAID_PENDING])
    : new Set([TXN_TYPE.PLAID_CLEARED, TXN_TYPE.PLAID_PENDING, TXN_TYPE.MANUAL_CLEARED, TXN_TYPE.PLAID_CONVERTED]);

  const targetType = getTransactionType(targetTxn);
  if (!matchableTargetTypes.has(targetType)) return 'Please click a bank transaction to match to';
  if (targetType === TXN_TYPE.PLAID_PENDING && targetTxn.is_hidden) {
    return 'That pending transaction is hidden. Unhide it first, then match to it';
  }
  const sourceAccountId = sourceTxn.account_id || sourceTxn.plaid_account_id;
  if ((targetTxn.account_id || targetTxn.plaid_account_id) !== sourceAccountId) {
    return 'That transaction is in another account. Click one in the same account';
  }
  if (targetTxn.matched_transaction_id || targetTxn.match_info) {
    return 'That transaction is already matched or has a match waiting';
  }
  if (targetTxn.is_split && Array.isArray(targetTxn.splits) && targetTxn.splits.length > 0) {
    return 'That transaction is split. Clear its splits first, then match to it';
  }
  return null;
}

/** A row named for a prompt: its name, amount and date. */
function _matchRowLabel(txn) {
  return `"${txn.description || txn.name || 'Unnamed'}" (${_formatCurrency(txn.amount)}, ${txn.date || ''})`;
}

/**
 * Enter Match to Transaction pick mode for a missing, hand-entered,
 * not-yet-due or bill row: close any modal, show the instruction banner and
 * let the user click the bank row it belongs to.
 *
 * @param {string} sourceTxnId - The row being matched.
 */
function enterMatchToTransactionPickMode(sourceTxnId) {
  const sourceTxn = transactions.find(txn => txn.transaction_id === sourceTxnId);
  if (!sourceTxn) {
    showStatus('Transaction not found', 'error');
    return;
  }
  if (!transactions.some(txn => _matchTargetRefusal(sourceTxn, txn) === null)) {
    showStatus('No bank transactions available to match in this account', 'warning');
    return;
  }

  _startPickMode({
    bannerHtml: `
      <strong>Match to Transaction:</strong> Click the bank transaction that ${escapeHtml(_matchRowLabel(sourceTxn))} belongs to.
    `,
    clickHandler: _matchToTransactionRowClickHandler,
    cancelMessage: 'Match cancelled',
  });
  _matchSourceId = sourceTxnId;
}

async function _matchToTransactionRowClickHandler(event) {
  if (!_matchSourceId) return;

  const row = event.target.closest('tr');
  if (!row) return;
  const clickedTxnId = row.dataset.txnId;
  if (!clickedTxnId) return;

  // The click is a pick, whatever the row holds under the pointer.
  event.preventDefault();
  event.stopPropagation();

  const sourceTxn = transactions.find(txn => txn.transaction_id === _matchSourceId);
  if (!sourceTxn) {
    exitPickMode();
    showStatus('Transaction not found', 'error');
    return;
  }

  const clickedTxn = transactions.find(txn => txn.transaction_id === clickedTxnId);
  const refusal = _matchTargetRefusal(sourceTxn, clickedTxn);
  if (refusal) {
    showStatus(refusal, 'warning');
    return;
  }

  // Declining leaves the mode on so the user can pick another row.
  if (!confirm(`Match ${_matchRowLabel(sourceTxn)} to ${_matchRowLabel(clickedTxn)}?`)) return;

  exitPickMode();

  try {
    const result = await manualReconciliationMatch(sourceTxn.transaction_id, clickedTxn.transaction_id);
    // The response drops the missing row and carries the matched bank row
    // and any transfer partner. The ledger is fetched below, so the helper
    // does not fetch it too.
    await applyRowChangesFromResponse(result, fallbackAccountIdsForRow(sourceTxn), { siteSettlesLedger: true });
    renderTransactionTable();
    if (typeof renderAccountsSidebar === 'function') {
      renderAccountsSidebar();
    }

    if (result.splits_need_repair) {
      showStatus(
        'Transactions matched — but split amounts no longer add up. Open the transaction to repair splits.',
        'warning'
      );
    } else {
      showStatus('Transactions matched successfully', 'success');
    }

    fetchBalanceHistory(result.account_id);
  } catch (matchError) {
    showStatus(`Match failed: ${matchError.message}`, 'error');
  }
}

/**
 * The accounts to fetch again when an approve's response names no rows:
 * those of the matched row being approved and of the bank row it merges
 * into, or every account when either is a transfer half (its partner sits
 * in another account) or neither is cached. Read before the request, which
 * deletes the matched row.
 *
 * @param {string} matchedTxnId The matched manual or bill row's id.
 * @param {string|null} [shownAccountId] The account of the row the approve
 *   was started from, used when neither row is cached.
 * @returns {Array<string>|null}
 */
function approveFallbackAccountIds(matchedTxnId, shownAccountId) {
  const matchedRow = transactions.find(txn => txn.transaction_id === matchedTxnId);
  const bankRow = transactions.find(txn => (
    (txn.match_info && txn.match_info.matched_txn_id === matchedTxnId)
    || (matchedRow && matchedRow.matched_transaction_id && txn.transaction_id === matchedRow.matched_transaction_id)
  ));
  const sides = [matchedRow, bankRow].filter(Boolean);
  if (sides.length === 0) return shownAccountId ? [shownAccountId] : null;

  const accountIds = new Set();
  for (const side of sides) {
    const sideAccountIds = fallbackAccountIdsForRow(side);
    if (sideAccountIds === null) return null;
    sideAccountIds.forEach(accountId => accountIds.add(accountId));
  }
  return Array.from(accountIds);
}

/**
 * Bring the page up to date after an approve: balances, the response's
 * changed rows (the manual row it deletes, the bank row that keeps its
 * data, a split's pieces, a transfer partner), the open ledger. Without the
 * fields the named accounts are fetched again.
 *
 * @param {Object} result Parsed JSON body of the approve.
 * @param {Array<string>|null} refetchAccountIds From
 *   approveFallbackAccountIds, read before the request.
 * @returns {Promise<void>}
 */
async function _applyApprovedMatch(result, refetchAccountIds) {
  await applyRowChangesFromResponse(result, refetchAccountIds);
  renderTransactionTable();
  if (typeof renderAccountsSidebar === 'function') {
    renderAccountsSidebar();
  }
}

async function approveMatchedTransactionAndRefresh(transactionId, accountId) {
  const refetchAccountIds = approveFallbackAccountIds(transactionId, accountId);
  const result = await approveMatch(transactionId);
  await _applyApprovedMatch(result, refetchAccountIds);

  showStatus('Match approved — manual transaction removed', 'success');
}

// ─── Approve match API calls ────────────────────────────────

/**
 * Approve a single matched transaction — permanently deletes the manual
 * counterpart, the surviving plaid row keeps all migrated metadata.
 */
async function approveMatch(transactionId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/approve_match/${encodeURIComponent(transactionId)}`,
    { method: 'POST' }
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to approve match');
  }
  return response.json();
}

/**
 * Approve matched transactions. When ``transactionIds`` is provided, the
 * backend scopes the approval to that subset (used by the context menu so
 * the action honors the current filter/search view). When omitted, every
 * matched transaction for the user is approved.
 */
async function approveAllMatches(transactionIds) {
  const body = Array.isArray(transactionIds) && transactionIds.length > 0
    ? { transaction_ids: transactionIds }
    : {};
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/approve_all_matches`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to approve all matches');
  }
  return response.json();
}

// ─── Relocate Orphan to Manual Account (Account Picker) ─────

/**
 * Open account picker modal for relocating an orphaned transaction to
 * a manual or converted account. Filters the `accounts` state variable
 * to show only eligible destinations.
 */
function openRelocateAccountPicker(orphanTxnId) {
  const orphanTxn = transactions.find(txn => txn.transaction_id === orphanTxnId);
  if (!orphanTxn) {
    showStatus('Transaction not found', 'error');
    return;
  }

  // Eligible: manual or converted, not archived, not the current account
  const eligibleAccounts = accounts.filter(acc =>
    acc.connection_status !== 'linked'
    && !acc.is_archived
    && acc.account_id !== orphanTxn.account_id
  );

  if (eligibleAccounts.length === 0) {
    showStatus('No manual or converted accounts available to move to. Create one on the Accounts page first.', 'warning');
    return;
  }

  const orphanLabel = orphanTxn.description || orphanTxn.name || 'Unnamed';

  let bodyHtml = `
    <p>Move orphan <strong>${escapeHtml(orphanLabel)}</strong>
    (${_formatCurrency(orphanTxn.amount)}, ${escapeHtml(orphanTxn.date || '')})
    to a manual or converted account. All properties (amount, date, category, memo)
    are preserved.</p>
    <div class="recon-relocate-list">
  `;

  // Group by bank name for clarity
  const accountsByBank = {};
  eligibleAccounts.forEach(acc => {
    const bankLabel = acc.bank_name || 'Unknown Bank';
    if (!accountsByBank[bankLabel]) accountsByBank[bankLabel] = [];
    accountsByBank[bankLabel].push(acc);
  });

  Object.entries(accountsByBank).forEach(([bankName, bankAccounts]) => {
    bodyHtml += `<div class="recon-relocate-bank-group">`;
    bodyHtml += `<div class="recon-relocate-bank-label">${escapeHtml(bankName)}</div>`;

    bankAccounts.forEach(acc => {
      const displayName = acc.custom_name || acc.account_name || 'Unnamed Account';
      const statusBadge = acc.connection_status === 'converted'
        ? '<span class="source-badge converted">Converted</span>'
        : '<span class="source-badge manual-acct">Manual</span>';
      const maskLabel = acc.mask ? ` (${acc.mask})` : '';

      bodyHtml += `
        <div class="recon-relocate-account"
             onclick="_selectRelocateAccount('${escapeHtml(orphanTxnId)}', '${escapeHtml(acc.account_id)}', '${escapeHtml(displayName)}')">
          ${statusBadge}
          <span class="recon-relocate-name">${escapeHtml(displayName)}${escapeHtml(maskLabel)}</span>
          <span class="recon-relocate-category">${escapeHtml(acc.account_category || '')}</span>
        </div>
      `;
    });

    bodyHtml += `</div>`;
  });

  bodyHtml += '</div>';

  openModal({
    title: 'Move Orphan to Account',
    body: bodyHtml,
    actions: [
      {
        label: 'Cancel',
        className: 'secondary',
        onClick: closeModal,
      },
    ],
  });

  const modalEl = document.querySelector('#modal-overlay .modal');
  if (modalEl) {
    modalEl.style.width = 'min(600px, 92vw)';
    modalEl.style.maxHeight = '80vh';
    modalEl.style.overflow = 'auto';
  }
}

async function _selectRelocateAccount(orphanTxnId, targetAccountId, accountName) {
  if (!confirm(`Move this orphan to "${accountName}"? It will become a normal cleared transaction in that account.`)) {
    return;
  }

  try {
    showStatus('Moving transaction…', 'info');
    const relocateResult = await relocateOrphanToAccount(orphanTxnId, targetAccountId);
    await applyAffectedAccounts(relocateResult);
    showStatus(`Transaction moved to ${accountName}`, 'success');
    closeModal();
    _refreshAfterReconciliation(relocateResult);
  } catch (relocateError) {
    showStatus(`Move failed: ${relocateError.message}`, 'error');
  }
}

/**
 * Entry point from reconciliation modal per-row ↪ button.
 * Closes the recon modal first, then opens the account picker.
 */
function _openRelocatePickerFromModal(orphanTxnId) {
  closeModal();
  // Small delay so the recon modal fully closes before opening the picker
  setTimeout(() => openRelocateAccountPicker(orphanTxnId), 150);
}

// ─── Shared formatting helper ───────────────────────────────

function _formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
