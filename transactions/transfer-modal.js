// ============================================================
// transactions/transfer-modal.js — Transfer Assignment Modal
// Right-click "Make Transfer" opens a modal to pick a target
// account, then links or creates a counterpart transaction.
// ============================================================

/**
 * Open the transfer assignment modal for a transaction.
 * Shows a list of accounts (excluding the transaction's own account)
 * with directional language based on the amount sign.
 *
 * Args:
 *   transactionId (string): The transaction to assign as a transfer.
 *   sourceAccountId (string): The account the transaction belongs to.
 *   amount (number): Signed amount. Negative = debit (money going out),
 *                    positive = credit (money coming in).
 */
function openTransferAssignmentModal(transactionId, sourceAccountId, amount) {
  const isDebit = amount < 0;
  const directionLabel = isDebit ? 'Money is going to:' : 'Money is coming from:';
  const amountLabel = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(amount));
  const amountBadgeClass = isDebit ? 'debit' : 'credit';

  // Build list of eligible target accounts (exclude source account and archived)
  const eligibleAccounts = accounts.filter(account => {
    if (account.account_id === sourceAccountId) return false;
    if (account.status === 'archived') return false;
    return true;
  });

  if (eligibleAccounts.length === 0) {
    showStatus('No other accounts available for transfer assignment', 'error');
    return;
  }

  // Group accounts by type for clearer selection
  const accountsByType = {};
  eligibleAccounts.forEach(account => {
    const accountType = account.account_category || account.account_type || 'other';
    if (!accountsByType[accountType]) accountsByType[accountType] = [];
    accountsByType[accountType].push(account);
  });

  let accountListHtml = '<ul class="transfer-account-list">';
  Object.entries(accountsByType).forEach(([accountType, accountGroup]) => {
    accountGroup.forEach(account => {
      const displayName = _buildAccountDisplayName(account);
      const typeLabel = accountType.charAt(0).toUpperCase() + accountType.slice(1);
      accountListHtml += `
        <li class="transfer-account-item" data-account-id="${escapeHtml(account.account_id)}">
          <span class="transfer-account-name">${escapeHtml(displayName)}</span>
          <span class="transfer-account-type">${escapeHtml(typeLabel)}</span>
        </li>`;
    });
  });
  accountListHtml += '</ul>';

  const bodyHtml = `
    <div>
      <div class="transfer-modal-direction">
        ${directionLabel}
        <span class="transfer-modal-amount-badge ${amountBadgeClass}">${amountLabel}</span>
      </div>
      ${accountListHtml}
    </div>
  `;

  openModal({
    title: '⇄ Assign Transfer',
    body: bodyHtml,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
    ],
  });

  // Attach click handlers to account items via delegation on the modal body
  setTimeout(() => {
    const modalBody = document.getElementById('modal-body');
    if (!modalBody) return;

    modalBody.addEventListener('click', async function _onAccountClick(event) {
      const item = event.target.closest('.transfer-account-item');
      if (!item) return;

      const targetAccountId = item.dataset.accountId;
      if (!targetAccountId) return;

      // Remove click listener to prevent double-submission
      modalBody.removeEventListener('click', _onAccountClick);

      // Visual feedback: highlight selected item
      item.style.background = 'var(--accent-primary)';
      item.style.color = '#fff';
      item.querySelector('.transfer-account-type').style.color = 'rgba(255,255,255,0.7)';

      const targetAccount = accounts.find(findAccount => findAccount.account_id === targetAccountId);
      if (!targetAccount) {
        showStatus('Target account not found', 'error');
        closeModal();
        return;
      }

      closeModal();

      // Delegate to the existing transfer assignment flow in categories.js
      // which handles candidate lookup, linking, and counterpart creation.
      await _applyTransferAssignment(transactionId, sourceAccountId, targetAccount);
    });
  }, 50);
}
