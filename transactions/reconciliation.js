// ============================================================
// transactions/reconciliation.js — Reconciliation Center
// Banner display, Resolution Center modal, and inline quick-fix
// actions for orphaned/missing transactions after re-link events.
// ============================================================

// ─── API helpers (all go through authenticatedFetch) ────────

/**
 * Fetch the reconciliation banner status from backend.
 * Returns {has_pending_proposals, pending_count, missing_count,
 *          orphaned_count, batch_id, accounts_affected}
 */
async function fetchReconciliationStatus() {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/reconciliation/status`
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
  let url = `${BACKEND_URL}/api/transactions/reconciliation/proposals`;
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
 * Batch-resolve proposals and missing transactions.
 * payload: { approve: [id,...], reject: [id,...],
 *            delete_missing: [txn_id,...], force_keep: [txn_id,...] }
 */
async function resolveReconciliationBatch(payload) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/reconciliation/resolve`,
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
 * Manually match a specific manual/missing txn with a plaid txn.
 * Used by the "Match to adjacent transaction" quick-fix flow.
 */
async function manualReconciliationMatch(manualTransactionId, plaidTransactionId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/transactions/reconciliation/match`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manual_transaction_id: manualTransactionId,
        plaid_transaction_id: plaidTransactionId,
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
    reconciliationStatus = status;

    if (!status.has_pending_proposals) {
      bannerEl.classList.add('hidden');
      return;
    }

    const totalCount = (status.pending_count || 0)
                     + (status.missing_count || 0)
                     + (status.orphaned_count || 0);

    const parts = [];
    if (status.pending_count > 0) {
      parts.push(`${status.pending_count} match proposal${status.pending_count !== 1 ? 's' : ''}`);
    }
    if (status.missing_count > 0) {
      parts.push(`${status.missing_count} missing`);
    }
    if (status.orphaned_count > 0) {
      parts.push(`${status.orphaned_count} orphaned`);
    }

    const summary = parts.join(', ');

    bannerEl.innerHTML = `
      <span class="reconciliation-banner-icon">⚠️</span>
      <span class="reconciliation-banner-text">
        <strong>${totalCount}</strong> manual/scheduled transaction${totalCount !== 1 ? 's' : ''}
        could not be matched with account data (${summary}).
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
    _renderReconciliationModal(data.proposals || [], data.missing_transactions || []);
  } catch (loadError) {
    showStatus(`Failed to load reconciliation data: ${loadError.message}`, 'error');
  }
}

/**
 * Build and display the Resolution Center modal content.
 * Proposals are pre-sorted by confidence (descending) from the backend.
 */
function _renderReconciliationModal(proposals, missingTransactions) {
  const hasProposals = proposals.length > 0;
  const hasMissing = missingTransactions.length > 0;

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
          The system found likely matches between your manual/scheduled entries and
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
              <div class="recon-txn-detail"><strong>Description:</strong> ${escapeHtml(manualTxn.name || '—')}</div>
              <div class="recon-txn-detail"><strong>Amount:</strong> ${_formatCurrency(manualTxn.amount)}</div>
              <div class="recon-txn-detail"><strong>Category:</strong> ${escapeHtml(manualTxn.user_category || '—')}</div>
            </div>
            <div class="recon-side-arrow">⟷</div>
            <div class="recon-side recon-side-plaid">
              <div class="recon-side-label">Plaid Transaction</div>
              <div class="recon-txn-detail"><strong>Date:</strong> ${escapeHtml(plaidTxn.date || '—')}</div>
              <div class="recon-txn-detail"><strong>Description:</strong> ${escapeHtml(plaidTxn.name || '—')}</div>
              <div class="recon-txn-detail"><strong>Amount:</strong> ${_formatCurrency(plaidTxn.amount)}</div>
              <div class="recon-txn-detail"><strong>Category:</strong> ${escapeHtml(plaidTxn.user_category || plaidTxn.personal_finance_category_primary || '—')}</div>
            </div>
          </div>
        </div>
      `;
    });

    bodyHtml += '</div></div>';
  }

  // ── Section 2: Missing / Orphaned Transactions ──
  if (hasMissing) {
    bodyHtml += `
      <div class="recon-section">
        <div class="recon-section-header">
          <h4>Unmatched Transactions (${missingTransactions.length})</h4>
          <div class="recon-bulk-actions">
            <button class="btn-recon btn-recon-bulk-delete"
                    onclick="_bulkActionMissing('delete')">
              🗑 Delete Selected
            </button>
            <button class="btn-recon btn-recon-bulk-keep"
                    onclick="_bulkActionMissing('keep')">
              ✓ Force Keep Selected
            </button>
          </div>
        </div>
        <p class="recon-section-desc">
          These transactions could not be matched to any Plaid entry.
          Select items and choose an action, or handle them individually.
        </p>
        <div class="recon-missing-list">
          <label class="recon-select-all-label">
            <input type="checkbox" id="recon-select-all-missing"
                   onchange="_toggleAllMissingCheckboxes(this.checked)">
            <span>Select All</span>
          </label>
    `;

    missingTransactions.forEach(txn => {
      const sourceLabel = txn.source === 'manual' ? 'Orphaned' : 'Missing';
      const sourceBadgeClass = txn.source === 'manual' ? 'orphaned' : 'missing';

      bodyHtml += `
        <div class="recon-missing-row" data-txn-id="${escapeHtml(txn.transaction_id || '')}">
          <input type="checkbox" class="recon-missing-checkbox"
                 value="${escapeHtml(txn.transaction_id || '')}">
          <span class="source-badge ${sourceBadgeClass}">${sourceLabel}</span>
          <span class="recon-missing-date">${escapeHtml(txn.date || '—')}</span>
          <span class="recon-missing-desc">${escapeHtml(txn.name || '—')}</span>
          <span class="recon-missing-amount">${_formatCurrency(txn.amount)}</span>
          <span class="recon-missing-category">${escapeHtml(txn.user_category || '—')}</span>
          <span class="recon-missing-actions">
            <button class="btn-recon btn-recon-delete-single"
                    onclick="_singleMissingAction('${escapeHtml(txn.transaction_id)}', 'delete')"
                    title="Delete this transaction permanently">🗑</button>
            <button class="btn-recon btn-recon-keep-single"
                    onclick="_singleMissingAction('${escapeHtml(txn.transaction_id)}', 'keep')"
                    title="Keep this transaction (revert to cleared)">✓</button>
          </span>
        </div>
      `;
    });

    bodyHtml += '</div></div>';
  }

  if (!hasProposals && !hasMissing) {
    bodyHtml += '<p class="recon-empty">No pending reconciliation items. Everything is in sync.</p>';
  }

  bodyHtml += '</div>';

  openModal({
    title: 'Reconciliation Center',
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

  // Widen the modal for the reconciliation center — it needs more space for
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

// ─── Missing transaction checkbox/action helpers ────────────

function _toggleAllMissingCheckboxes(checked) {
  const checkboxes = document.querySelectorAll('.recon-missing-checkbox');
  checkboxes.forEach(cb => { cb.checked = checked; });
}

function _getSelectedMissingIds() {
  const checked = document.querySelectorAll('.recon-missing-checkbox:checked');
  return Array.from(checked).map(cb => cb.value);
}

async function _bulkActionMissing(action) {
  const selectedIds = _getSelectedMissingIds();
  if (selectedIds.length === 0) {
    showStatus('No transactions selected', 'warning');
    return;
  }

  const confirmLabel = action === 'delete'
    ? `Delete ${selectedIds.length} transaction(s) permanently?`
    : `Keep ${selectedIds.length} transaction(s) as cleared?`;

  if (!confirm(confirmLabel)) return;

  try {
    const payload = {};
    if (action === 'delete') {
      payload.delete_missing = selectedIds;
    } else {
      payload.force_keep = selectedIds;
    }

    await resolveReconciliationBatch(payload);
    showStatus(`${selectedIds.length} transaction(s) ${action === 'delete' ? 'deleted' : 'kept'}`, 'success');

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

async function _singleMissingAction(transactionId, action) {
  const actionLabel = action === 'delete' ? 'Delete' : 'Keep';
  if (!confirm(`${actionLabel} this transaction?`)) return;

  try {
    const payload = {};
    if (action === 'delete') {
      payload.delete_missing = [transactionId];
    } else {
      payload.force_keep = [transactionId];
    }

    await resolveReconciliationBatch(payload);
    showStatus(`Transaction ${action === 'delete' ? 'deleted' : 'kept as cleared'}`, 'success');

    // Remove the row from the modal
    const row = document.querySelector(`.recon-missing-row[data-txn-id="${transactionId}"]`);
    if (row) row.remove();

    _refreshAfterReconciliation();
  } catch (resolveError) {
    showStatus(`Action failed: ${resolveError.message}`, 'error');
  }
}

// ─── Submit all decisions from the modal ────────────────────

async function _submitReconciliationDecisions() {
  const payload = {
    approve: [],
    reject: [],
    delete_missing: [],
    force_keep: [],
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
    if (result.kept > 0) parts.push(`${result.kept} kept`);

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
  try {
    localStorage.removeItem('pf_cached_transactions');
    localStorage.removeItem('pf_transactions_cached_at');
  } catch (cacheError) { /* non-fatal */ }

  await fetchAllTransactions(true);

  // Re-check whether the banner should still show
  await checkAndRenderReconciliationBanner();
}

// ─── Inline Quick-Fix: Match to Adjacent Transaction ────────
// Called from the context menu on orphaned/missing rows
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

  // Gather plaid transactions in the same account that are cleared and unmatched
  const candidates = transactions.filter(txn =>
    txn.source === 'plaid'
    && txn.status === 'cleared'
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
    showStatus('No plaid transactions available to match in this account', 'warning');
    return;
  }

  let bodyHtml = `
    <p>Select a Plaid transaction to match with: <strong>${escapeHtml(missingTxn.name || '—')}</strong>
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
    title: 'Match to Plaid Transaction',
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

async function _selectMatchCandidate(missingTxnId, plaidTxnId) {
  if (!confirm('Link these two transactions?')) return;

  try {
    await manualReconciliationMatch(missingTxnId, plaidTxnId);
    showStatus('Transactions matched successfully', 'success');
    closeModal();
    _refreshAfterReconciliation();
  } catch (matchError) {
    showStatus(`Match failed: ${matchError.message}`, 'error');
  }
}

// ─── Shared formatting helper ───────────────────────────────

function _formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}
