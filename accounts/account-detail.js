// ============================================================
// accounts/account-detail.js — Account Detail View
// Renders the main content area when an account is selected:
// metadata card, classification table, notes, and action list.
// ============================================================

/**
 * Render the Account Detail View in the main content area.
 * Fetches fresh detail from backend, then builds the DOM.
 */
async function renderAccountDetail(accountId) {
  const mainContent = document.getElementById('main-content');
  mainContent.innerHTML = '<div style="padding: 40px; text-align: center; color: #888;">Loading account details…</div>';

  try {
    const account = await apiFetchAccountDetail(accountId);
    mainContent.innerHTML = _buildAccountDetailHtml(account);
  } catch (fetchError) {
    mainContent.innerHTML = `<div style="padding: 20px; color: #c62828;">Error loading account: ${fetchError.message}</div>`;
  }
}

function _buildAccountDetailHtml(account) {
  const displayName = account.custom_name || account.account_name || 'Unknown Account';
  const balance = parseFloat(account.current_balance) || 0;
  const balanceStr = formatCurrency(balance, account.currency || 'USD');
  const isNegative = balance < 0;
  const bankDisplayName = account.bank_name || 'Unknown Bank';

  // Look up parent bank for health info
  const parentBank = banksCache.find(bankItem => bankItem.bank_id === account.bank_id);
  const itemHealth = parentBank ? parentBank.item_health : null;

  // Badges
  const badges = [
    renderOriginBadge(account.origin),
    renderConnectionBadge(account.connection_status),
    renderHealthBadge(account.connection_status, itemHealth),
    renderArchivedBadge(account.is_archived),
    renderCategoryBadge(account.account_category),
    account.is_hidden ? '<span class="badge badge-hidden">Hidden</span>' : '',
    account.holdings_hidden ? '<span class="badge badge-holdings-hidden">Holdings Hidden</span>' : ''
  ].filter(Boolean).join(' ');

  // Subcategory label
  const subcategoryLabel = account.account_subcategory
    ? account.account_subcategory.replace(/_/g, ' ').replace(/\b\w/g, firstChar => firstChar.toUpperCase())
    : '—';

  return `
    <!-- Metadata Card -->
    <div class="detail-card">
      <div class="detail-card-header">
        <h2>${_escapeHtml(displayName)}</h2>
        <div class="detail-card-badges">${badges}</div>
      </div>

      <div class="metadata-grid">
        <div class="metadata-item">
          <span class="metadata-label">Current Balance</span>
          <span class="metadata-value balance ${isNegative ? 'negative' : ''}">${balanceStr}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Balance Date</span>
          <span class="metadata-value">${account.balance_date || '—'}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Category</span>
          <span class="metadata-value">${account.account_category || '—'}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Subcategory</span>
          <span class="metadata-value">${subcategoryLabel}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Mask</span>
          <span class="metadata-value">${account.mask || '—'}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Bank</span>
          <span class="metadata-value">
            <a onclick="selectBank('${account.bank_id}')">${_escapeHtml(bankDisplayName)}</a>
          </span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Currency</span>
          <span class="metadata-value">${account.currency || 'USD'}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Created</span>
          <span class="metadata-value">${account.created_at ? formatDate(account.created_at) : '—'}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Transactions</span>
          <span class="metadata-value">${account.transaction_count !== undefined ? account.transaction_count.toLocaleString() : '—'}</span>
        </div>
      </div>

      <!-- Classification Table -->
      <table class="classification-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Origin</td>
            <td>${renderOriginBadge(account.origin)}</td>
            <td>${account.origin === 'plaid' ? 'Created from a Plaid Link connection' : 'Created manually by user'}</td>
          </tr>
          <tr>
            <td>Connection</td>
            <td>${renderConnectionBadge(account.connection_status)}</td>
            <td>${_connectionMeaning(account.connection_status)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Notes Field -->
      <div class="notes-field">
        <label class="metadata-label" style="margin-bottom: 4px; display: block;">Notes</label>
        <textarea id="account-notes-input" rows="2" placeholder="Add notes…">${_escapeHtml(account.notes || '')}</textarea>
        <div class="notes-save-row">
          <button class="btn-secondary btn-sm" onclick="saveAccountNotes('${account.account_id}')">Save Notes</button>
        </div>
      </div>
    </div>

    <!-- Actions Section -->
    <div class="actions-section">
      <h3>Account Actions</h3>
      <div class="action-list">
        ${_buildAccountActions(account)}
      </div>
    </div>
  `;
}

/**
 * Build the HTML for account action items.
 */
function _buildAccountActions(account) {
  let actions = '';

  // ── Rename ──
  actions += _actionItem(
    'Rename Account',
    'Change the custom display name for this account.',
    `<button class="btn-action" onclick="promptRenameAccount('${account.account_id}', '${_escapeAttr(account.custom_name || '')}')">Rename</button>`,
    'info-rename',
    'Sets a custom display name. Leave empty to reset to the default bank-account name format.'
  );

  // ── Change Category ──
  actions += _actionItem(
    'Change Account Type',
    'Reassign account category and subcategory. Does not affect transaction data.',
    `<button class="btn-action" onclick="promptChangeCategory('${account.account_id}', '${account.account_category}', '${account.account_subcategory || ''}')">Change</button>`,
    'info-change-type',
    'Changes the account classification (e.g., depository, credit, investment). All existing transaction data is preserved.'
  );

  // ── Hide / Unhide (sidebar visibility) ──
  if (account.is_hidden) {
    actions += _actionItem(
      'Unhide Account',
      'Show this account again in the transactions sidebar. Transactions are always included regardless.',
      `<button class="btn-action" onclick="toggleAccountHidden('${account.account_id}', false)">Unhide</button>`,
      'info-unhide',
      'Removes the hidden flag. The account reappears in the transactions sidebar. Transactions, reports, and net-worth calculations always include this account regardless of hidden state.'
    );
  } else {
    actions += _actionItem(
      'Hide Account',
      'Remove from transactions sidebar. Transactions, reports, and net-worth still include this account.',
      `<button class="btn-action" onclick="toggleAccountHidden('${account.account_id}', true)">Hide</button>`,
      'info-hide',
      'Hides the account from the transactions sidebar only. All transactions, balance calculations, reports, and net-worth are unaffected. Use this to declutter the sidebar for accounts you rarely need to view individually.'
    );
  }

  // ── Hide / Unhide Holdings (investment accounts only) ──
  if ((account.account_category || '').toLowerCase() === 'investment') {
    if (account.holdings_hidden) {
      actions += _actionItem(
        'Show Holdings',
        'Include this account in investment holdings and allocation views.',
        `<button class="btn-action" onclick="toggleAccountHoldingsHidden('${account.account_id}', false)">Show Holdings</button>`,
        'info-show-holdings',
        'Removes the holdings-hidden flag. This account\'s holdings will appear in investment holdings tables and allocation calculations.'
      );
    } else {
      actions += _actionItem(
        'Hide Holdings',
        'Exclude from investment holdings and allocation views. Transactions sidebar and transactions are unaffected.',
        `<button class="btn-action" onclick="toggleAccountHoldingsHidden('${account.account_id}', true)">Hide Holdings</button>`,
        'info-hide-holdings',
        'Hides this account\'s holdings from the investments page and allocation summary. Useful for brokerage cash accounts or emergency fund accounts at brokerages that skew allocation percentages. Cannot be overridden — holdings are always excluded.'
      );
    }
  }

  // ── Move to Bank (manual accounts only) ──
  if (account.origin === 'manual' && account.connection_status === 'manual') {
    actions += _actionItem(
      'Move to Different Bank',
      'Reassign this account to a different bank group.',
      `<button class="btn-action" onclick="promptMoveAccountToBank('${account.account_id}')">Move</button>`,
      'info-move-bank',
      'Moves this manual account under a different bank. If the source bank has no remaining accounts and no Plaid item, it is automatically removed.'
    );
  }

  // ── Archive / Unarchive ──
  if (account.is_archived) {
    actions += _actionItem(
      'Unarchive Account',
      'Restore this account to all active views (dashboard, transactions, investments).',
      `<button class="btn-action" onclick="unarchiveAccount('${account.account_id}')">Unarchive</button>`,
      'info-unarchive',
      'Removes the archived state. The account reappears in dashboard totals and the transactions sidebar. Reversible.'
    );
  } else {
    actions += _actionItem(
      'Archive Account',
      'Hide from dashboard, transactions, and investments. Data is fully preserved.',
      `<button class="btn-warn btn-sm" onclick="archiveAccount('${account.account_id}')">Archive</button>`,
      'info-archive',
      'Archived accounts are hidden from active views but data is fully preserved. If the parent bank is Plaid-linked, syncing continues in the background so data stays fresh. Reversible via Unarchive.'
    );
  }

  // ── Reset Account ──
  actions += _actionItem(
    'Reset Account',
    account.origin === 'plaid' && account.connection_status === 'linked'
      ? 'Delete all historical Plaid transaction data and re-derive opening balance from next sync.'
      : 'Delete all transaction data and set a new opening balance.',
    `<button class="btn-warn btn-sm" onclick="openResetAccountModal('${account.account_id}', '${account.origin}', '${account.connection_status}')">Reset</button>`,
    'info-reset',
    'For Plaid accounts: deletes transaction history, resets sync cursor, and re-derives opening balance on next sync. For manual accounts: deletes all transactions and prompts for a new opening balance. Requires confirmation.'
  );

  // ── Delete Account / Unlink & Archive ──
  const isLinked = account.connection_status === 'linked';

  if (isLinked) {
    // Linked accounts cannot be hard-deleted. Offer "Unlink & Archive" instead:
    // disconnects this account from Plaid sync, wipes its data, and archives it.
    actions += _actionItem(
      'Unlink, Reset & Archive',
      'Disconnect this account from Plaid sync, delete all its transaction data, and archive it. The rest of the bank stays linked.',
      `<button class="btn-warn btn-sm" onclick="unlinkAndArchiveAccount('${account.account_id}', '${_escapeAttr(account.custom_name || account.account_name)}')">Unlink & Archive</button>`,
      'info-unlink-archive',
      'Removes this account from Plaid transaction sync (the bank and its other accounts remain linked). All transaction data, balance history, and snapshots for this account are permanently deleted. The account is then archived. Future syncs will ignore it. This action cannot be undone.'
    );
  } else {
    actions += _actionItem(
      'Delete Account & All Data',
      'Permanently removes this account, all transactions, balance history, and snapshots. Irreversible.',
      `<button class="btn-danger btn-sm" onclick="deleteAccount('${account.account_id}', '${_escapeAttr(account.custom_name || account.account_name)}')">Delete</button>`,
      'info-delete',
      'This is a permanent, irreversible action. All transaction data, balance history, and snapshots for this account will be destroyed. You will need to type the account name to confirm.'
    );
  }

  return actions;
}

/**
 * Build a single action item row.
 */
function _actionItem(title, description, buttonHtml, tooltipId, tooltipText) {
  return `
    <div class="action-item">
      <div class="action-item-left">
        <span class="action-item-title">${title}</span>
        <span class="action-item-desc">${description}</span>
        ${tooltipId ? `<div id="${tooltipId}" class="info-tooltip">${tooltipText}</div>` : ''}
      </div>
      <div class="action-item-right">
        ${tooltipId ? `<button class="info-btn" onclick="toggleInfoTooltip('${tooltipId}')" title="More info">ⓘ</button>` : ''}
        ${buttonHtml}
      </div>
    </div>
  `;
}

// ── Account Action Handlers ──────────────────────────────────

async function promptRenameAccount(accountId, currentCustomName) {
  const newName = prompt('Enter a custom name for this account (leave empty to reset):', currentCustomName);
  if (newName === null) return;

  try {
    showToast('Updating account name…', 'info');
    await apiUpdateAccount(accountId, { custom_name: newName.trim() || null });
    showToast('Account renamed successfully', 'success');
    await reloadAndReselect();
  } catch (renameError) {
    showToast(`Failed to rename: ${renameError.message}`, 'error');
  }
}

function promptChangeCategory(accountId, currentCategory, currentSubcategory) {
  // Build a small inline form in a modal-like approach using the confirm modal
  // For simplicity, use a prompt-based approach with the category reference
  const categoryKeys = Object.keys(categoriesReference);
  const categoryList = categoryKeys.map((key, index) => `${index + 1}. ${key}`).join('\n');

  const choiceStr = prompt(
    `Current category: ${currentCategory}\n\nSelect new category (enter number):\n${categoryList}`,
    ''
  );
  if (choiceStr === null || choiceStr.trim() === '') return;

  const choiceIndex = parseInt(choiceStr, 10) - 1;
  if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= categoryKeys.length) {
    showToast('Invalid category selection', 'error');
    return;
  }

  const newCategory = categoryKeys[choiceIndex];
  const subcategories = categoriesReference[newCategory]?.subtypes || [];

  let newSubcategory = null;
  if (subcategories.length > 0) {
    const subList = subcategories.map((sub, subIndex) => `${subIndex + 1}. ${sub}`).join('\n');
    const subChoiceStr = prompt(
      `Select subcategory for ${newCategory} (enter number, or leave empty for none):\n${subList}`,
      ''
    );
    if (subChoiceStr !== null && subChoiceStr.trim() !== '') {
      const subChoiceIndex = parseInt(subChoiceStr, 10) - 1;
      if (subChoiceIndex >= 0 && subChoiceIndex < subcategories.length) {
        newSubcategory = subcategories[subChoiceIndex];
      }
    }
  }

  _doChangeCategory(accountId, newCategory, newSubcategory);
}

async function _doChangeCategory(accountId, category, subcategory) {
  try {
    showToast('Updating account type…', 'info');
    const fields = { account_category: category };
    if (subcategory) fields.account_subcategory = subcategory;
    await apiUpdateAccount(accountId, fields);
    showToast('Account type updated', 'success');
    await reloadAndReselect();
  } catch (categoryError) {
    showToast(`Failed to change type: ${categoryError.message}`, 'error');
  }
}

async function toggleAccountHidden(accountId, hidden) {
  try {
    showToast(hidden ? 'Hiding account…' : 'Unhiding account…', 'info');
    await apiUpdateAccount(accountId, { is_hidden: hidden });
    showToast(hidden ? 'Account hidden from sidebar' : 'Account visible in sidebar', 'success');
    await reloadAndReselect();
  } catch (error) {
    showToast(`Failed: ${error.message}`, 'error');
  }
}

async function toggleAccountHoldingsHidden(accountId, hidden) {
  try {
    showToast(hidden ? 'Hiding holdings…' : 'Showing holdings…', 'info');
    await apiUpdateAccount(accountId, { holdings_hidden: hidden });
    showToast(hidden ? 'Holdings hidden from investments' : 'Holdings visible in investments', 'success');
    await reloadAndReselect();
  } catch (error) {
    showToast(`Failed: ${error.message}`, 'error');
  }
}

let _pendingMoveAccountId = null;

function promptMoveAccountToBank(accountId) {
  _pendingMoveAccountId = accountId;

  const currentAccount = accountsCache.find(acct => acct.account_id === accountId);
  const currentBankId = currentAccount ? currentAccount.bank_id : null;

  const availableBanks = banksCache
    .filter(bank => bank.bank_id !== currentBankId)
    .sort((bankA, bankB) => buildBankDisplayName(bankA).localeCompare(buildBankDisplayName(bankB)));

  // Store for filter use
  _moveBankChoices = availableBanks;

  const searchInput = document.getElementById('move-bank-search');
  searchInput.value = '';
  _renderMoveBankList(availableBanks);

  document.getElementById('move-account-error').classList.add('hidden');
  document.getElementById('move-account-modal').classList.remove('hidden');

  // Auto-focus the search field
  setTimeout(() => searchInput.focus(), 50);
}

let _moveBankChoices = [];

function filterMoveBankList() {
  const query = (document.getElementById('move-bank-search').value || '').toLowerCase();
  const filtered = query
    ? _moveBankChoices.filter(bank => buildBankDisplayName(bank).toLowerCase().includes(query))
    : _moveBankChoices;
  _renderMoveBankList(filtered);
}

function _renderMoveBankList(banks) {
  const container = document.getElementById('move-bank-list');
  if (banks.length === 0) {
    container.innerHTML = '<div style="padding: 12px; color: var(--text-muted); text-align: center; font-size: 13px;">No matching banks</div>';
    return;
  }
  container.innerHTML = banks.map(bank => {
    const displayName = buildBankDisplayName(bank);
    const accountCount = (bank.accounts || []).length;
    return `
      <div class="move-bank-item" onclick="selectMoveBank('${bank.bank_id}', '${_escapeAttr(displayName)}')">
        <span class="status-dot ${getStatusDotClass(bank.connection_status, bank.item_health)}"></span>
        <span>${_escapeHtml(displayName)}</span>
        <span class="bank-account-count">${accountCount} acct${accountCount !== 1 ? 's' : ''}</span>
      </div>`;
  }).join('');
}

function selectMoveBank(targetBankId, targetBankName) {
  const accountIdToMove = _pendingMoveAccountId;
  closeMoveAccountModal();

  openConfirmModal(
    'Move Account',
    `Move this account to "${targetBankName}"?`,
    async () => {
      try {
        showToast('Moving account…', 'info');
        await apiMoveAccountToBank(accountIdToMove, targetBankId);
        showToast(`Account moved to ${targetBankName}`, 'success');
        await reloadAndReselect();
      } catch (moveError) {
        showToast(`Failed to move: ${moveError.message}`, 'error');
      }
    },
    { buttonLabel: 'Move', buttonClass: 'btn-action' }
  );
}

function closeMoveAccountModal() {
  document.getElementById('move-account-modal').classList.add('hidden');
  _pendingMoveAccountId = null;
}

function archiveAccount(accountId) {
  openConfirmModal(
    'Archive Account',
    'This will hide the account from the dashboard, transactions, and investments pages. All data is preserved and you can unarchive at any time.',
    async () => {
      try {
        showToast('Archiving account…', 'info');
        await apiUpdateAccount(accountId, { is_archived: true });
        showToast('Account archived', 'success');
        await reloadAndReselect();
      } catch (archiveError) {
        showToast(`Failed to archive: ${archiveError.message}`, 'error');
      }
    },
    { buttonLabel: 'Archive', buttonClass: 'btn-warn' }
  );
}

async function unarchiveAccount(accountId) {
  try {
    showToast('Unarchiving account…', 'info');
    await apiUpdateAccount(accountId, { is_archived: false });
    showToast('Account unarchived', 'success');
    await reloadAndReselect();
  } catch (unarchiveError) {
    showToast(`Failed to unarchive: ${unarchiveError.message}`, 'error');
  }
}

function deleteAccount(accountId, accountName) {
  openConfirmModal(
    'Delete Account & All Data',
    `This will permanently delete "${accountName}" and ALL its transactions, balance history, and snapshots. This action cannot be undone.`,
    async () => {
      try {
        showToast('Deleting account…', 'info');
        await apiHardDeleteAccount(accountId);
        showToast('Account and all related data permanently deleted', 'success');
        selectedAccountId = null;
        await reloadAndReselect();
      } catch (deleteError) {
        showToast(`Failed to delete: ${deleteError.message}`, 'error');
      }
    },
    {
      buttonLabel: 'Delete Permanently',
      buttonClass: 'btn-danger'
    }
  );
}

function unlinkAndArchiveAccount(accountId, accountName) {
  openConfirmModal(
    'Unlink, Reset & Archive',
    `This will disconnect "${accountName}" from Plaid sync, permanently delete ALL its transaction data, ` +
    'balance history, and snapshots, then archive it. The rest of the bank stays linked. This action cannot be undone.',
    async () => {
      try {
        showToast('Unlinking and archiving…', 'info');
        await apiUnlinkAndArchiveAccount(accountId);
        showToast('Account unlinked, data cleared, and archived', 'success');
        selectedAccountId = null;
        await reloadAndReselect();
      } catch (unlinkError) {
        showToast(`Failed to unlink: ${unlinkError.message}`, 'error');
      }
    },
    {
      buttonLabel: 'Unlink & Archive',
      buttonClass: 'btn-warn'
    }
  );
}

function openResetAccountModal(accountId, origin, connectionStatus) {
  pendingResetAccountId = accountId;
  const descriptionEl = document.getElementById('reset-modal-description');
  const manualFields = document.getElementById('reset-manual-fields');
  const errorEl = document.getElementById('reset-account-error');
  errorEl.classList.add('hidden');

  if (origin === 'plaid' && connectionStatus === 'linked') {
    descriptionEl.textContent =
      'This will delete all historical Plaid transaction data and reset the sync cursor. ' +
      'The opening balance will be re-derived from the next Plaid sync. This cannot be undone.';
    manualFields.classList.add('hidden');
  } else {
    descriptionEl.textContent =
      'This will delete all transaction data for this account. ' +
      'You will need to provide a new opening balance and date.';
    manualFields.classList.remove('hidden');
    document.getElementById('reset-new-balance').value = '';
    document.getElementById('reset-new-date').value = todayISO();
  }

  document.getElementById('reset-account-modal').classList.remove('hidden');
}

function closeResetAccountModal() {
  document.getElementById('reset-account-modal').classList.add('hidden');
  pendingResetAccountId = null;
}

async function submitResetAccount() {
  if (!pendingResetAccountId) return;
  const errorEl = document.getElementById('reset-account-error');
  errorEl.classList.add('hidden');

  // Gather opening balance fields for manual accounts
  const manualFields = document.getElementById('reset-manual-fields');
  const isManualReset = manualFields && !manualFields.classList.contains('hidden');

  let openingBalance = null;
  let openingBalanceDate = null;

  if (isManualReset) {
    const balanceInput = document.getElementById('reset-new-balance');
    const dateInput = document.getElementById('reset-new-date');
    openingBalance = parseFloat(balanceInput?.value) || 0;
    openingBalanceDate = dateInput?.value || todayISO();
  }

  try {
    showToast('Resetting account…', 'info');
    await apiResetAccount(pendingResetAccountId, openingBalance, openingBalanceDate);
    showToast('Account reset successfully', 'success');
    closeResetAccountModal();
    await reloadAndReselect();
  } catch (resetError) {
    errorEl.textContent = resetError.message;
    errorEl.classList.remove('hidden');
  }
}

async function saveAccountNotes(accountId) {
  const notesInput = document.getElementById('account-notes-input');
  if (!notesInput) return;
  try {
    showToast('Saving notes…', 'info');
    await apiUpdateAccount(accountId, { notes: notesInput.value });
    showToast('Notes saved', 'success');
  } catch (notesError) {
    showToast(`Failed to save notes: ${notesError.message}`, 'error');
  }
}

// ── Helpers ──────────────────────────────────────────────────

function _connectionMeaning(connectionStatus) {
  const meanings = {
    linked: 'Actively connected to Plaid. Syncing data automatically.',
    dormant: 'Plaid-connected but transactions not yet billed. Operating as manual. Activate to start syncing.',
    converted: 'Was Plaid-linked, converted to manual. Plaid billing stopped. Re-link available.',
    manual: 'Manual data-entry mode. Transactions are entered by the user.'
  };
  return meanings[connectionStatus] || 'Unknown';
}

function _escapeAttr(text) {
  return (text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
