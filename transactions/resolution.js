// ============================================================
// transactions/resolution.js — Resolution Center
// Banner display, Resolution Center modal, and inline quick-fix
// actions for MANUAL_ORPHANED transactions after re-link events.
// ============================================================

// ─── API helpers (all go through authenticatedFetch) ────────

/**
 * Fetch the reconciliation banner status from backend.
 * Returns {has_pending_proposals, pending_count, missing_count,
 *          orphaned_count, batch_id, accounts_affected}
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
 * Fetch full proposal list with decrypted transaction details.
 * Optional batch_id narrows to a single re-link event.
 */
async function fetchReconciliationProposals(batchId) {
  let url = `${BACKEND_URL}/api/transactions/resolution/proposals`;
  if (batchId) {
    url += `?batch_id=${encodeURIComponent(batchId)}`;
  }
  const response = await authenticatedFetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch reconciliation proposals');
  }
  return response.json();
}

/**
 * Batch-resolve proposals and orphaned transactions.
 * payload: { approve: [id,...], reject: [id,...],
 *            delete_orphaned: [txn_id,...] }
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
  await loadAccounts();
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
    reconciliationStatus = status;

    if (!status.has_pending_proposals) {
      bannerEl.classList.add('hidden');
      return;
    }

    const totalCount = (status.pending_count || 0)
             + (status.orphaned_count || 0);

    const parts = [];
    if (status.pending_count > 0) {
      parts.push(`${status.pending_count} match proposal${status.pending_count !== 1 ? 's' : ''}`);
    }
    if (status.orphaned_count > 0) {
      parts.push(`${status.orphaned_count} orphaned`);
    }

    const summary = parts.join(', ');

    bannerEl.innerHTML = `
      <span class="reconciliation-banner-icon">⚠️</span>
      <span class="reconciliation-banner-text">
        <strong>${totalCount}</strong> relink conflict item${totalCount !== 1 ? 's' : ''}
        need resolution (${summary}).
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

/**
 * After a bulk import, the backend may run matching asynchronously.
// ─── Resolution Center Modal ────────────────────────────────

/**
 * Open the full Resolution Center overlay for batch review.
 * Fetches proposals, builds the UI, and displays inside the
 * generic modal system (openModal from utils.js).
 */
async function openReconciliationCenter() {
  showStatus('Loading reconciliation data…', 'info');

  try {
    const batchId = reconciliationStatus?.batch_id || null;
    const data = await fetchReconciliationProposals(batchId);

    clearStatus();
    _renderReconciliationModal(data.proposals || [], data.orphaned_transactions || data.missing_transactions || []);
  } catch (loadError) {
    showStatus(`Failed to load reconciliation data: ${loadError.message}`, 'error');
  }
}

/**
 * Build and display the Resolution Center modal content.
 * Proposals are pre-sorted by confidence (descending) from the backend.
 */
function _renderReconciliationModal(proposals, orphanedTransactions) {
  const hasProposals = proposals.length > 0;
  const hasOrphaned = orphanedTransactions.length > 0;

  let bodyHtml = '<div class="recon-center">';

  // ── Section 1: Auto-Match Proposals ──
  if (hasProposals) {
    bodyHtml += `
      <div class="recon-section">
        <div class="recon-section-header">
          <h4>Match Proposals (${proposals.length})</h4>
          <button class="btn-banner btn-banner-primary recon-approve-all-btn"
                  onclick="_approveAllProposals()">
            ✓ Approve All Matches
          </button>
        </div>
        <p class="recon-section-desc">
          The system found likely matches between your orphaned manual entries and
          Plaid-downloaded transactions. Review each pair below.
        </p>
        <div class="recon-proposals-list">
    `;

    proposals.forEach(proposal => {
      const confidencePct = Math.round((proposal.confidence || 0) * 100);
      const confidenceClass = confidencePct >= 85 ? 'high' : confidencePct >= 50 ? 'medium' : 'low';
      const reasons = (proposal.match_reasons || []).join(', ') || 'N/A';

      const manualTxn = proposal.manual_transaction || {};
      const plaidTxn = proposal.plaid_transaction || {};

      bodyHtml += `
        <div class="recon-proposal-card" data-proposal-id="${proposal.proposal_id}">
          <div class="recon-proposal-header">
            <span class="recon-confidence recon-confidence-${confidenceClass}">
              ${confidencePct}% confidence
            </span>
            <span class="recon-reasons">${escapeHtml(reasons)}</span>
            <div class="recon-proposal-actions">
              <button class="btn-recon btn-recon-approve"
                      onclick="_toggleProposalDecision(${proposal.proposal_id}, 'approve')"
                      data-proposal-id="${proposal.proposal_id}">
                ✓ Approve
              </button>
              <button class="btn-recon btn-recon-reject"
                      onclick="_toggleProposalDecision(${proposal.proposal_id}, 'reject')"
                      data-proposal-id="${proposal.proposal_id}">
                ✗ Reject
              </button>
            </div>
          </div>
          <div class="recon-comparison">
            <div class="recon-side recon-side-manual">
              <div class="recon-side-label">Manual/Scheduled Entry</div>
              <div class="recon-txn-detail"><strong>Date:</strong> ${escapeHtml(manualTxn.date || '—')}</div>
              <div class="recon-txn-detail"><strong>Description:</strong> ${escapeHtml(manualTxn.description || manualTxn.name || '—')}</div>
              <div class="recon-txn-detail"><strong>Amount:</strong> ${_formatCurrency(manualTxn.amount)}</div>
              <div class="recon-txn-detail"><strong>Category:</strong> ${escapeHtml(manualTxn.user_category || '—')}</div>
            </div>
            <div class="recon-side-arrow">⟷</div>
            <div class="recon-side recon-side-plaid">
              <div class="recon-side-label">Plaid Transaction</div>
              <div class="recon-txn-detail"><strong>Date:</strong> ${escapeHtml(plaidTxn.date || '—')}</div>
              <div class="recon-txn-detail"><strong>Description:</strong> ${escapeHtml(plaidTxn.description || plaidTxn.name || '—')}</div>
              <div class="recon-txn-detail"><strong>Amount:</strong> ${_formatCurrency(plaidTxn.amount)}</div>
              <div class="recon-txn-detail"><strong>Category:</strong> ${escapeHtml(plaidTxn.user_category || plaidTxn.personal_finance_category_primary || '—')}</div>
            </div>
          </div>
        </div>
      `;
    });

    bodyHtml += '</div></div>';
  }

  // ── Section 2: Orphaned Transactions ──
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

  if (!hasProposals && !hasOrphaned) {
    bodyHtml += '<p class="recon-empty">No pending resolution items. Everything is in sync.</p>';
  }

  bodyHtml += '</div>';

  openModal({
    title: 'Resolution Center',
    body: bodyHtml,
    actions: [
      {
        label: 'Apply Decisions',
        className: 'btn-banner btn-banner-primary',
        onClick: _submitReconciliationDecisions,
      },
      {
        label: 'Cancel',
        className: 'secondary',
        onClick: closeModal,
      },
    ],
  });

  // Widen the modal for the resolution center — it needs more space for
  // the side-by-side comparison layout.
  const modalEl = document.querySelector('#modal-overlay .modal');
  if (modalEl) {
    modalEl.style.width = 'min(920px, 95vw)';
    modalEl.style.maxHeight = '85vh';
    modalEl.style.overflow = 'auto';
  }
}

// ─── Proposal decision tracking ─────────────────────────────
// Stored in a module-level map: proposalId → 'approve' | 'reject' | null

const _proposalDecisions = new Map();

function _toggleProposalDecision(proposalId, decision) {
  const current = _proposalDecisions.get(proposalId);
  // Toggle off if same button clicked again
  const newDecision = current === decision ? null : decision;
  _proposalDecisions.set(proposalId, newDecision);

  // Update button visual state
  const card = document.querySelector(`.recon-proposal-card[data-proposal-id="${proposalId}"]`);
  if (!card) return;

  const approveBtn = card.querySelector('.btn-recon-approve');
  const rejectBtn = card.querySelector('.btn-recon-reject');

  approveBtn.classList.toggle('active', newDecision === 'approve');
  rejectBtn.classList.toggle('active', newDecision === 'reject');
  card.classList.toggle('recon-decided-approve', newDecision === 'approve');
  card.classList.toggle('recon-decided-reject', newDecision === 'reject');
}

function _approveAllProposals() {
  const cards = document.querySelectorAll('.recon-proposal-card');
  cards.forEach(card => {
    const proposalId = parseInt(card.dataset.proposalId, 10);
    _proposalDecisions.set(proposalId, 'approve');

    const approveBtn = card.querySelector('.btn-recon-approve');
    const rejectBtn = card.querySelector('.btn-recon-reject');
    if (approveBtn) approveBtn.classList.add('active');
    if (rejectBtn) rejectBtn.classList.remove('active');
    card.classList.add('recon-decided-approve');
    card.classList.remove('recon-decided-reject');
  });
  showStatus(`Marked all ${cards.length} proposals for approval`, 'info');
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

    await resolveReconciliationBatch(payload);
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

    await resolveReconciliationBatch(payload);
    showStatus('Transaction deleted', 'success');

    // Remove the row from the modal
    const row = document.querySelector(`.recon-missing-row[data-txn-id="${transactionId}"]`);
    if (row) row.remove();

    _refreshAfterReconciliation();
  } catch (resolveError) {
    showStatus(`Action failed: ${resolveError.message}`, 'error');
  }
}

// ─── Submit all decisions from the modal ────────────────────

// ─── Force Match Pick Mode ──────────────────────────────────
// When the user clicks "Force Match" on an orphan (from the modal or
// context menu), we close any open modal, show a floating instruction
// banner, and let them click any plaid transaction row in the table.
// The orphan is rewritten to adopt the plaid txn's amount/account.

let _forceMatchOrphanId = null;

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
    tableContainer.addEventListener('click', _forceMatchRowClickHandler);
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
    tableContainer.removeEventListener('click', _forceMatchRowClickHandler);
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
  const clickedSource = row.dataset.source || '';

  if (!clickedTxnId) return;

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

// ─── Submit all decisions from the modal (continued) ────────

async function _submitReconciliationDecisions() {
  const payload = {
    approve: [],
    reject: [],
    delete_orphaned: [],
  };

  // Gather proposal decisions
  _proposalDecisions.forEach((decision, proposalId) => {
    if (decision === 'approve') payload.approve.push(proposalId);
    else if (decision === 'reject') payload.reject.push(proposalId);
  });

  // No-op check: nothing decided
  const totalDecisions = payload.approve.length + payload.reject.length;
  if (totalDecisions === 0) {
    showStatus('No decisions to submit. Approve or reject proposals first.', 'warning');
    return;
  }

  try {
    const result = await resolveReconciliationBatch(payload);

    const parts = [];
    if (result.approved > 0) parts.push(`${result.approved} approved`);
    if (result.rejected > 0) parts.push(`${result.rejected} rejected`);
    if (result.deleted > 0) parts.push(`${result.deleted} deleted`);

    showStatus(`Reconciliation complete: ${parts.join(', ')}`, 'success');
    closeModal();

    _proposalDecisions.clear();
    _refreshAfterReconciliation();
  } catch (submitError) {
    showStatus(`Reconciliation submit failed: ${submitError.message}`, 'error');
  }
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
 * Opens a small picker modal showing cleared plaid transactions in the same
 * account so the user can manually match a missing/orphaned txn.
 */
function openInlineMatchPicker(missingTxnId) {
  const missingTxn = transactions.find(txn => txn.transaction_id === missingTxnId);
  if (!missingTxn) {
    showStatus('Transaction not found', 'error');
    return;
  }

  // Gather cleared transactions in the same account that are unmatched.
  // When the source is MANUAL_CLEARED (user-entered txn waiting for Plaid
  // delivery), only show PLAID_CLEARED targets — matching manual-to-manual
  // doesn't make sense in this flow.
  const sourceType = getTransactionType(missingTxn);
  const isSourceManualCleared = sourceType === TXN_TYPE.MANUAL_CLEARED;
  const MATCHABLE_TARGET_TYPES = isSourceManualCleared
    ? new Set([TXN_TYPE.PLAID_CLEARED])
    : new Set([TXN_TYPE.PLAID_CLEARED, TXN_TYPE.MANUAL_CLEARED, TXN_TYPE.PLAID_CONVERTED]);
  const candidates = transactions.filter(txn =>
    txn.transaction_id !== missingTxnId
    && MATCHABLE_TARGET_TYPES.has(getTransactionType(txn))
    && (txn.account_id || txn.plaid_account_id) === (missingTxn.account_id || missingTxn.plaid_account_id)
    && !txn.matched_transaction_id
  );

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

async function _selectMatchCandidate(missingTxnId, targetTxnId) {
  if (!confirm('Link these two transactions?')) return;

  try {
    const result = await manualReconciliationMatch(missingTxnId, targetTxnId);

    if (result.splits_need_repair) {
      showStatus(
        'Transactions matched — but split amounts no longer add up. Open the transaction to repair splits.',
        'warning'
      );
    } else {
      showStatus('Transactions matched successfully', 'success');
    }

    closeModal();
    _refreshAfterReconciliation();
    fetchBalanceHistory(result.account_id);
  } catch (matchError) {
    showStatus(`Match failed: ${matchError.message}`, 'error');
  }
}

// ─── Suggestion (system proposal) inline actions ────────────

/**
 * Approve a system-suggested match by performing a manual ledger match.
 * Called from the yellow checkmark button in the suggested pair row.
 */
async function approveSuggestion(suggestedTxnId, plaidTxnId, accountId) {
  if (!confirm('Approve this suggested match? The manual transaction will be merged into the Plaid transaction.')) return;
  try {
    await manualReconciliationMatch(suggestedTxnId, plaidTxnId);
    showStatus('Suggestion approved — manual transaction merged', 'success');
    await refreshAccountTransactions(accountId);
  } catch (approveError) {
    showStatus(`Failed to approve suggestion: ${approveError.message}`, 'error');
  }
}

/**
 * Dismiss a system-suggested match.  The proposal is marked dismissed and
 * the manual missing row reappears in the ledger on next refresh.
 */
async function dismissSuggestion(proposalId, accountId) {
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/resolution/dismiss_suggestion`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_id: proposalId }),
      }
    );
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to dismiss suggestion');
    }
    showStatus('Suggestion dismissed', 'success');
    await refreshAccountTransactions(accountId);
  } catch (dismissError) {
    showStatus(`Failed to dismiss suggestion: ${dismissError.message}`, 'error');
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
    await relocateOrphanToAccount(orphanTxnId, targetAccountId);
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
