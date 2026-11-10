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

    const batchResult = await resolveReconciliationBatch(payload);
    await applyAffectedAccounts(batchResult);
    showStatus(`${selectedIds.length} transaction(s) deleted`, 'success');

    // Remove resolved rows from the modal DOM
    selectedIds.forEach(txnId => {
      const row = document.querySelector(`.recon-missing-row[data-txn-id="${txnId}"]`);
      if (row) row.remove();
    });

    // Refresh main transaction list in the background
    _refreshAfterReconciliation();
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
    await applyAffectedAccounts(batchResult);
    showStatus('Transaction deleted', 'success');

    // Remove the row from the modal
    const row = document.querySelector(`.recon-missing-row[data-txn-id="${transactionId}"]`);
    if (row) row.remove();

    _refreshAfterReconciliation();
  } catch (resolveError) {
    showStatus(`Action failed: ${resolveError.message}`, 'error');
  }
}

// ─── Force Match Pick Mode ──────────────────────────────────
// When the user clicks "Force Match" on an orphan (from the modal or
// context menu), we close any open modal, show a floating instruction
// banner, and let them click any plaid transaction row in the table.
// The orphan is rewritten to adopt the plaid txn's amount/account.

let _forceMatchOrphanId = null;

// The pick handler runs in the capture phase so it sees a click before the
// row's inline editors and buttons do. Those listeners sit on the same
// container (or on the cell itself) and would otherwise open an editor
// instead of picking the row.
const _FORCE_MATCH_CLICK_OPTIONS = { capture: true };

/**
 * Whether the user is currently choosing a Plaid row for a force match.
 * Inline editors check this so a click on a row picks it instead of editing.
 */
function isForceMatchPickModeActive() {
  return _forceMatchOrphanId !== null;
}

/**
 * Enter force-match pick mode: close modal, show instruction banner,
 * install a one-shot click handler on the transaction table.
 */
function enterForceMatchPickMode(orphanTxnId) {
  _forceMatchOrphanId = orphanTxnId;

  // Close the resolution center modal if open
  if (typeof closeModal === 'function') closeModal();

  // Find the orphan in the transactions array for display context
  const orphanTxn = transactions.find(txn => txn.transaction_id === orphanTxnId);
  const orphanLabel = orphanTxn
    ? `"${orphanTxn.description || orphanTxn.name || 'Unnamed'}" (${_formatCurrency(orphanTxn.amount)})`
    : orphanTxnId;

  // Show the pick-mode instruction banner
  _showForceMatchBanner(orphanLabel);

  // Install delegated click handler on the table
  const tableContainer = document.getElementById('table-container');
  if (tableContainer) {
    tableContainer.addEventListener('click', _forceMatchRowClickHandler, _FORCE_MATCH_CLICK_OPTIONS);
  }

  // Allow Escape to cancel
  document.addEventListener('keydown', _forceMatchEscapeHandler);
}

function _showForceMatchBanner(orphanLabel) {
  // Remove existing banner if any
  _removeForceMatchBanner();

  const banner = document.createElement('div');
  banner.id = 'force-match-pick-banner';
  banner.className = 'force-match-pick-banner';
  banner.innerHTML = `
    <span class="force-match-pick-icon">\ud83d\udd17</span>
    <span class="force-match-pick-text">
      <strong>Force Match Mode:</strong> Click any <em>Plaid</em> transaction row to match orphan ${escapeHtml(orphanLabel)}.
      The orphan will be rewritten to match the selected transaction's amount and account.
    </span>
    <button class="btn-banner btn-banner-secondary force-match-pick-cancel"
            onclick="exitForceMatchPickMode()">Cancel</button>
  `;

  // Insert at the top of the main content area, above the table
  const tableContainer = document.getElementById('table-container');
  if (tableContainer && tableContainer.parentNode) {
    tableContainer.parentNode.insertBefore(banner, tableContainer);
  } else {
    document.body.prepend(banner);
  }
}

function _removeForceMatchBanner() {
  const existing = document.getElementById('force-match-pick-banner');
  if (existing) existing.remove();
}

function exitForceMatchPickMode() {
  _forceMatchOrphanId = null;
  _removeForceMatchBanner();

  const tableContainer = document.getElementById('table-container');
  if (tableContainer) {
    tableContainer.removeEventListener('click', _forceMatchRowClickHandler, _FORCE_MATCH_CLICK_OPTIONS);
  }
  document.removeEventListener('keydown', _forceMatchEscapeHandler);
}

function _forceMatchEscapeHandler(event) {
  if (event.key === 'Escape') {
    exitForceMatchPickMode();
    showStatus('Force match cancelled', 'info');
  }
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

  // Only Plaid-cleared transactions can serve as a force-match target
  const clickedTxn = transactions.find(txn => txn.transaction_id === clickedTxnId);
  const clickedType = clickedTxn ? getTransactionType(clickedTxn) : null;
  if (clickedType !== TXN_TYPE.PLAID_CLEARED) {
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
  exitForceMatchPickMode();

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

    _refreshAfterReconciliation();
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

async function _refreshAfterReconciliation() {
  _invalidateTransactionCache();
  await fetchAllTransactions(true);

  // Re-check whether the banner should still show
  await checkAndRenderReconciliationBanner();
}

// ─── Inline Quick-Fix: Match to Adjacent Transaction ────────
// Called from the context menu on orphaned rows
// in the day-to-day inline handling flow.

/**
 * Rows the match picker may offer as targets for a source transaction.
 *
 * When the source is MANUAL_CLEARED (user-entered txn waiting for Plaid
 * delivery) or PLAID_CONVERTED, only PLAID_CLEARED targets are offered —
 * matching manual-to-manual doesn't make sense in this flow. Split rows are
 * left out because the API refuses a match between two split rows, and rows
 * already carrying a match are left out because they are waiting on their
 * own resolution.
 *
 * @param {Object} sourceTxn - The transaction being matched (a split's parent, never a piece).
 * @param {Array<Object>} allTransactions - Every cached transaction.
 * @returns {Array<Object>} Candidate target rows, in input order.
 */
function _filterMatchPickerCandidates(sourceTxn, allTransactions) {
  const sourceType = getTransactionType(sourceTxn);
  const isSourceManualCleared =
    sourceType === TXN_TYPE.MANUAL_CLEARED ||
    sourceType === TXN_TYPE.PLAID_CONVERTED;
  const matchableTargetTypes = isSourceManualCleared
    ? new Set([TXN_TYPE.PLAID_CLEARED])
    : new Set([TXN_TYPE.PLAID_CLEARED, TXN_TYPE.MANUAL_CLEARED, TXN_TYPE.PLAID_CONVERTED]);
  const sourceAccountId = sourceTxn.account_id || sourceTxn.plaid_account_id;

  return allTransactions.filter(txn => {
    if (txn.transaction_id === sourceTxn.transaction_id) return false;
    if (!matchableTargetTypes.has(getTransactionType(txn))) return false;
    if ((txn.account_id || txn.plaid_account_id) !== sourceAccountId) return false;
    if (txn.matched_transaction_id) return false;
    if (txn.is_split && Array.isArray(txn.splits) && txn.splits.length > 0) return false;
    if (txn.match_info) return false;
    return true;
  });
}

/**
 * Opens a small picker modal showing cleared plaid transactions in the same
 * account so the user can manually match a missing/orphaned txn.
 */
function openInlineMatchPicker(missingTxnId) {
  const missingTxn = transactions.find(txn => txn.transaction_id === missingTxnId);
  if (!missingTxn) {
    showStatus('Transaction not found', 'error');
    return;
  }

  const candidates = _filterMatchPickerCandidates(missingTxn, transactions);

  // Sort by date proximity to the missing transaction
  const missingDate = new Date(missingTxn.date).getTime();
  candidates.sort((candidateA, candidateB) => {
    const diffA = Math.abs(new Date(candidateA.date).getTime() - missingDate);
    const diffB = Math.abs(new Date(candidateB.date).getTime() - missingDate);
    return diffA - diffB;
  });

  // Limit to a reasonable number to avoid overwhelming the picker
  const MAX_CANDIDATES = 50;
  const topCandidates = candidates.slice(0, MAX_CANDIDATES);

  if (topCandidates.length === 0) {
    showStatus('No cleared transactions available to match in this account', 'warning');
    return;
  }

  let bodyHtml = `
    <p>Select a transaction to match with: <strong>${escapeHtml(missingTxn.description || missingTxn.name || '—')}</strong>
    (${_formatCurrency(missingTxn.amount)}, ${escapeHtml(missingTxn.date || '')})</p>
    <div class="recon-match-picker-list">
  `;

  topCandidates.forEach(candidate => {
    const amountMatch = Math.abs((candidate.amount || 0) - (missingTxn.amount || 0)) < 0.02;
    const highlightClass = amountMatch ? 'recon-match-candidate-highlight' : '';

    bodyHtml += `
      <div class="recon-match-candidate ${highlightClass}"
           onclick="_selectMatchCandidate('${escapeHtml(missingTxnId)}', '${escapeHtml(candidate.transaction_id)}')">
        <span class="recon-match-date">${escapeHtml(candidate.date || '—')}</span>
        <span class="recon-match-desc">${escapeHtml(candidate.name || '—')}</span>
        <span class="recon-match-amount">${_formatCurrency(candidate.amount)}</span>
        ${amountMatch ? '<span class="recon-amount-match-badge">$ Match</span>' : ''}
      </div>
    `;
  });

  bodyHtml += '</div>';

  openModal({
    title: 'Match to Transaction',
    body: bodyHtml,
    actions: [
      {
        label: 'Cancel',
        className: 'secondary',
        onClick: closeModal,
      },
    ],
  });

  // Size the modal for the picker
  const modalEl = document.querySelector('#modal-overlay .modal');
  if (modalEl) {
    modalEl.style.width = 'min(700px, 92vw)';
    modalEl.style.maxHeight = '80vh';
    modalEl.style.overflow = 'auto';
  }
}

function _applyReconciliationMutationToCache(result, removedTxnId) {
  if (removedTxnId) {
    _removeCachedTransaction(removedTxnId);
  }

  if (result && result.transaction && result.transaction.transaction_id) {
    _replaceCachedTransaction(result.transaction.transaction_id, result.transaction);
  }

  const partnerTransaction = result?.transfer_partner_transaction || result?.affected_transfer_partner;
  if (partnerTransaction && partnerTransaction.transaction_id) {
    _replaceCachedTransaction(partnerTransaction.transaction_id, partnerTransaction);
  }

  renderTransactionTable();
  if (typeof renderAccountsSidebar === 'function') {
    renderAccountsSidebar();
  }
}

async function approveMatchedTransactionAndRefresh(transactionId, accountId) {
  const result = await approveMatch(transactionId);
  // Before the cache patch: its table render projects from the balance.
  await applyAffectedAccounts(result);
  _applyReconciliationMutationToCache(result, transactionId);

  if (accountId) {
    try {
      await refreshAccountTransactions(accountId);
    } catch (refreshError) {
      console.warn('Failed to refresh account after approve-match', accountId, refreshError);
    }
  }

  showStatus('Match approved — manual transaction removed', 'success');
}

async function _selectMatchCandidate(missingTxnId, targetTxnId) {
  if (!confirm('Link these two transactions?')) return;

  try {
    const result = await manualReconciliationMatch(missingTxnId, targetTxnId);
    // Before the cache patch: its table render projects from the balance.
    await applyAffectedAccounts(result);
    _applyReconciliationMutationToCache(result, missingTxnId);

    if (result.splits_need_repair) {
      showStatus(
        'Transactions matched — but split amounts no longer add up. Open the transaction to repair splits.',
        'warning'
      );
    } else {
      showStatus('Transactions matched successfully', 'success');
    }

    closeModal();
    fetchBalanceHistory(result.account_id);
  } catch (matchError) {
    showStatus(`Match failed: ${matchError.message}`, 'error');
  }
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
    _refreshAfterReconciliation();
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
