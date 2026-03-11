/**
 * Render the connected banks list on the dashboard.
 * Shows institution name, account count, sync status badges, quick actions.
 * Handles the three disconnect flows: convert, archive, hard-delete.
 */

const IndexConnectionsList = (() => {

  /** Fetch banks from backend and render the list. */
  async function loadBanks() {
    const listElement = document.getElementById('connections-list');
    if (!listElement) return;

    listElement.innerHTML = 'Loading connected banks...';

    try {
      const banks = await IndexApi.fetchDashboardBanks();
      IndexState.setBanksCache(banks);

      if (!banks.length) {
        listElement.innerHTML = '<p class="banks-empty-state">No connected banks yet. Click "Connect New Bank" to get started.</p>';
        return;
      }

      listElement.innerHTML = _renderBankList(banks);
    } catch (loadError) {
      listElement.innerHTML = `<p class="banks-error">Error loading connected banks: ${loadError.message}</p>`;
    }
  }

  // ── Rendering helpers ──────────────────────────────────

  function _renderBankList(banks) {
    const bankCards = banks.map(bank => _renderBankCard(bank)).join('');
    return `<ul class="bank-list">${bankCards}</ul>`;
  }

  function _renderBankCard(bank) {
    const displayName = bank.custom_name || bank.bank_name || 'Unknown Bank';
    const accountCount = bank.account_count || 0;
    const accountLabel = accountCount === 1 ? '1 account' : `${accountCount} accounts`;
    const isLinked = bank.connection_status === 'linked';
    const isConverted = bank.connection_status === 'converted';

    const statusIndicator = _renderConnectionStatusIndicator(bank.connection_status);
    const syncBadges = isLinked ? _renderSyncBadges(bank.billed_products || []) : '';
    const actionButtons = _renderActionButtons(bank);

    return `
      <li class="bank-card" data-bank-id="${bank.bank_id}">
        <div class="bank-card-left">
          <span class="bank-icon">🏦</span>
          <div class="bank-info">
            <span class="bank-name">${displayName}</span>
            <span class="bank-meta">${accountLabel} ${statusIndicator}</span>
            ${syncBadges}
          </div>
        </div>
        <div class="bank-card-actions">
          ${actionButtons}
        </div>
      </li>`;
  }

  function _renderConnectionStatusIndicator(connectionStatus) {
    switch (connectionStatus) {
      case 'linked':
        return '<span class="conn-status conn-status-linked" title="Actively connected via Plaid">● Linked</span>';
      case 'relink_pending':
        return '<span class="conn-status conn-status-relink-pending" title="Waiting for complete transaction history from Plaid">⏳ Relink in progress</span>';
      case 'converted':
        return '<span class="conn-status conn-status-converted" title="Disconnected from Plaid, operates manually">● Manual (converted)</span>';
      case 'manual':
        return '<span class="conn-status conn-status-manual" title="Manual bank">● Manual</span>';
      default:
        return '';
    }
  }

  /**
   * Sync status badges — only shown for linked banks.
   * Displays which Plaid products are actively billed.
   */
  function _renderSyncBadges(billedProducts) {
    if (!billedProducts || !billedProducts.length) return '';

    const hasTransactions = billedProducts.includes('transactions');
    const hasInvestments = billedProducts.includes('investments');

    const badges = [];
    if (hasTransactions) {
      badges.push('<span class="sync-badge sync-badge-transactions" title="Transaction sync active">📊 Transactions</span>');
    }
    if (hasInvestments) {
      badges.push('<span class="sync-badge sync-badge-investments" title="Investment sync active">📈 Investments</span>');
    }

    if (!badges.length) return '';
    return `<div class="sync-badges">${badges.join(' ')}</div>`;
  }

  function _renderActionButtons(bank) {
    const isLinked = bank.connection_status === 'linked';
    const isRelinkPending = bank.connection_status === 'relink_pending';
    const isConverted = bank.connection_status === 'converted';
    const isManual = bank.connection_status === 'manual';
    const hasInstitution = !!bank.institution_id;
    const bankIdAttr = bank.bank_id.replace(/'/g, "\\'");
    const nameAttr = (bank.custom_name || bank.bank_name || 'Unknown Bank').replace(/'/g, "\\'");
    const itemIdAttr = (bank.plaid_item_id || '').replace(/'/g, "\\'");
    const itemStatusAttr = (bank.plaid_item_status || '').replace(/'/g, "\\'");

    const buttons = [];

    if (isRelinkPending) {
      buttons.push(
        `<span class="bank-btn-info" title="Waiting for Plaid to deliver complete transaction history">` +
        `⏳ Awaiting history from Plaid...</span>`
      );
      buttons.push(
        `<button class="bank-btn bank-btn-retry" title="Retry syncing if relink appears stuck" ` +
        `onclick="IndexConnectionsList.handleRetryRelink('${bankIdAttr}', '${nameAttr}')">` +
        `🔄 Retry Sync</button>`
      );
    } else if (isLinked) {
      // Refresh: behavior depends on plaid_item_status
      // Broken statuses need update-mode link session; healthy ones just refresh
      const isBroken = ['error', 'needs_update', 'permission_revoked'].includes(bank.plaid_item_status);
      const refreshTitle = isBroken
        ? 'Fix broken connection (re-authenticate with your bank)'
        : 'Refresh bank connection';
      const refreshLabel = isBroken ? '🔧 Fix Connection' : '🔄 Refresh';

      buttons.push(
        `<button class="bank-btn bank-btn-refresh" title="${refreshTitle}" ` +
        `onclick="IndexConnectionsList.handleRefresh('${itemIdAttr}', '${nameAttr}', '${itemStatusAttr}')">` +
        `${refreshLabel}</button>`
      );
    } else if (isConverted || (isManual && hasInstitution)) {
      // Bank can be (re-)linked via Plaid if it has an institution_id.
      // This covers scenario 7 (manual → linked) and converted → linked.
      const linkLabel = isConverted ? '🔗 Relink' : '🔗 Link to Plaid';
      const linkTitle = isConverted
        ? 'Reconnect to Plaid'
        : 'Connect this bank to Plaid for automatic syncing';

      buttons.push(
        `<button class="bank-btn bank-btn-relink" title="${linkTitle}" ` +
        `onclick="IndexConnectionsList.handleRelink('${bankIdAttr}', '${nameAttr}')">` +
        `${linkLabel}</button>`
      );
    }

    // Disconnect is always available (opens a choice dialog)
    buttons.push(
      `<button class="bank-btn bank-btn-disconnect" title="Disconnect options" ` +
      `onclick="IndexConnectionsList.handleDisconnect('${bankIdAttr}', '${nameAttr}', '${bank.connection_status}', '${itemIdAttr}')">` +
      `Disconnect</button>`
    );

    return buttons.join('');
  }

  // ── Action handlers (called from onclick in rendered HTML) ─

  /**
   * Refresh a linked bank:
   *  - Broken item (error/needs_update/permission_revoked): open Plaid Link in update mode
   *  - Healthy item: open Plaid Link in update mode (lets user update sharing permissions)
   *
   * After Plaid Link completes, refreshes accounts and checks if any newly
   * added accounts match existing manual accounts for the same institution.
   * If matches are found, shows the account matching modal so the user can
   * merge them instead of having duplicates.
   */
  async function handleRefresh(itemId, bankName, itemStatus) {
    if (!IndexState.getAuthToken()) {
      IndexUtils.showMessage('dashboard-message', 'Please login first', 'error');
      return;
    }

    try {
      // Update mode: pass itemId so backend generates an update-mode link token
      const linkToken = await IndexApi.fetchLinkToken({ itemId });
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async () => {
          try {
            const refreshResult = await IndexApi.refreshItemAccounts(itemId);
            if (refreshResult.ok) {
              invalidateItemInfoCache(itemId);

              // Check if the refresh detected manual accounts that might match
              // newly added Plaid accounts (cross-bank matching for update mode)
              const pendingMatching = refreshResult.data?.pending_account_matching;
              const targetBankId = refreshResult.data?.bank_id;
              const targetBankName = refreshResult.data?.bank_name || bankName;

              if (pendingMatching && pendingMatching.needed && targetBankId) {
                IndexUtils.showMessage(
                  'dashboard-message',
                  `✓ ${bankName} refreshed! We found existing accounts that may match — please review.`,
                  'success',
                );
                _showAccountMatchingModal(targetBankId, targetBankName, pendingMatching);
              } else {
                const newCount = refreshResult.data?.new_accounts_count || 0;
                const countMsg = newCount > 0 ? ` (${newCount} new account${newCount > 1 ? 's' : ''} added)` : '';
                IndexUtils.showMessage('dashboard-message', `✓ ${bankName} refreshed successfully!${countMsg}`, 'success');
              }
            } else {
              IndexUtils.showMessage('dashboard-message', `✓ ${bankName} refreshed, but failed to sync accounts`, 'success');
            }
            loadBanks();
          } catch (refreshError) {
            IndexUtils.showMessage('dashboard-message', 'Error: ' + refreshError.message, 'error');
          }
        },
        onExit: (exitError) => {
          if (exitError != null) {
            IndexUtils.showMessage('dashboard-message', 'Refresh cancelled or failed', 'error');
          }
        },
      });
      handler.open();
    } catch (linkError) {
      IndexUtils.showMessage('dashboard-message', 'Error: ' + linkError.message, 'error');
    }
  }

  /**
   * Relink a converted bank by starting a new Plaid Link session.
   * This connects a new Plaid item to the existing bank record.
   */
  async function handleRelink(bankId, bankName) {
    if (!IndexState.getAuthToken()) {
      IndexUtils.showMessage('dashboard-message', 'Please login first', 'error');
      return;
    }

    try {
      // Relink mode: pass bankId so backend scopes the link token to this bank's
      // institution and products, and set_access_token reattaches the new Plaid
      // item to the existing bank record (works for converted AND manual banks
      // that have a valid institution_id).
      const linkToken = await IndexApi.fetchLinkToken({ bankId });
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken) => {
          try {
            const exchangeResult = await IndexApi.exchangePublicToken(publicToken, bankId);
            invalidateItemInfoCache();

            // Two-phase relink: if backend returned relink_pending, show
            // waiting message instead of the old instant-success flow.
            if (exchangeResult.connection_status === 'relink_pending') {
              IndexUtils.showMessage(
                'dashboard-message',
                `⏳ ${bankName} relink initiated — waiting for Plaid to deliver complete history. This may take a few minutes.`,
                'success',
              );
            } else {
              // Legacy path / pass 4 account matching (kept for compatibility)
              const relinkDetails = exchangeResult.relink_details || {};
              const pendingMatching = relinkDetails.pending_account_matching;

              if (pendingMatching && pendingMatching.needed) {
                _showAccountMatchingModal(bankId, bankName, pendingMatching);
              } else {
                IndexUtils.showMessage('dashboard-message', `✓ ${bankName} relinked successfully!`, 'success');
              }
            }

            loadBanks();
          } catch (exchangeError) {
            IndexUtils.showMessage('dashboard-message', 'Error: ' + exchangeError.message, 'error');
          }
        },
        onExit: (exitError) => {
          if (exitError != null) {
            IndexUtils.showMessage('dashboard-message', 'Relink cancelled or failed', 'error');
          }
        },
      });
      handler.open();
    } catch (linkError) {
      IndexUtils.showMessage('dashboard-message', 'Error: ' + linkError.message, 'error');
    }
  }

  /**
   * Retry Phase 2 of a stuck relink — calls backend retry-relink endpoint
   * and reloads the bank list on success.
   */
  async function handleRetryRelink(bankId, bankName) {
    if (!IndexState.getAuthToken()) {
      IndexUtils.showMessage('dashboard-message', 'Please login first', 'error');
      return;
    }

    IndexUtils.showMessage(
      'dashboard-message',
      `🔄 Retrying sync for ${bankName}... this may take a moment.`,
      'info',
    );

    try {
      const result = await IndexApi.retryRelink(bankId);
      IndexUtils.showMessage(
        'dashboard-message',
        `✅ ${bankName}: ${result.message}`,
        'success',
      );
      await loadBanks();
    } catch (retryError) {
      IndexUtils.showMessage(
        'dashboard-message',
        `❌ Retry failed for ${bankName}: ${retryError.message}`,
        'error',
      );
    }
  }

  /**
   * Disconnect flow — presents a choice dialog with three options:
   * 1. Convert to manual (preserve data, stop Plaid billing)
   * 2. Disconnect & archive (convert + hide from views)
   * 3. Hard delete (irreversible)
   */
  async function handleDisconnect(bankId, bankName, connectionStatus, itemId) {
    if (!IndexState.getAuthToken()) {
      IndexUtils.showMessage('dashboard-message', 'Please login first', 'error');
      return;
    }

    // Build options based on current connection status
    const isLinked = connectionStatus === 'linked';

    const options = [];
    if (isLinked) {
      options.push('1. Disconnect & use as manual — stops Plaid sync, keeps all data');
    }
    options.push(`${isLinked ? '2' : '1'}. Disconnect & archive — ${isLinked ? 'stops sync, ' : ''}hides from dashboard (data preserved in Accounts page)`);
    options.push(`${isLinked ? '3' : '2'}. Hard delete — permanently removes bank, accounts, and ALL transactions (IRREVERSIBLE)`);

    const choicePromptText = `How would you like to disconnect ${bankName}?\n\n${options.join('\n')}\n\nEnter the number of your choice:`;

    const choice = prompt(choicePromptText);
    if (!choice) return; // User cancelled

    const choiceNumber = parseInt(choice.trim(), 10);
    let mode = null;

    if (isLinked) {
      switch (choiceNumber) {
        case 1: mode = 'convert'; break;
        case 2: mode = 'archive'; break;
        case 3: mode = 'delete'; break;
        default:
          IndexUtils.showMessage('dashboard-message', 'Invalid choice. Please try again.', 'error');
          return;
      }
    } else {
      // For non-linked banks (converted/manual), convert option not relevant
      switch (choiceNumber) {
        case 1: mode = 'archive'; break;
        case 2: mode = 'delete'; break;
        default:
          IndexUtils.showMessage('dashboard-message', 'Invalid choice. Please try again.', 'error');
          return;
      }
    }

    // Extra confirmation for hard delete
    if (mode === 'delete') {
      const deleteConfirmed = confirm(
        `⚠️ PERMANENT DELETION WARNING\n\n` +
        `This will permanently destroy ${bankName} and ALL associated:\n` +
        `• Bank record\n` +
        `• Accounts\n` +
        `• Transactions\n` +
        `• Investment data\n\n` +
        `This action CANNOT be undone. Are you absolutely sure?`
      );
      if (!deleteConfirmed) return;
    }

    try {
      const { ok, data } = await IndexApi.removeBank(bankId, mode, itemId || null);

      if (ok) {
        if (itemId) invalidateItemInfoCache(itemId);
        const modeLabels = { convert: 'converted to manual', archive: 'archived', delete: 'deleted' };
        IndexUtils.showMessage('dashboard-message', `✓ ${bankName} ${modeLabels[mode]} successfully!`, 'success');
        loadBanks();
      } else {
        IndexUtils.showMessage('dashboard-message', 'Error: ' + (data.error || 'Failed to disconnect bank'), 'error');
      }
    } catch (disconnectError) {
      IndexUtils.showMessage('dashboard-message', 'Error: ' + disconnectError.message, 'error');
    }
  }

  // ── Account Matching Modal (pass 4 UI) ────────────────

  /**
   * Show the account matching modal after a relink where automatic matching
   * couldn't resolve all accounts (pass 4 flagged pending_account_matching).
   *
   * Renders one row per existing (orphaned) account with a dropdown to pick
   * the matching Plaid account — or "No match" to leave it as-is.
   *
   * @param {string} bankId - The bank being relinked.
   * @param {string} bankName - Display name for messages.
   * @param {Object} pendingMatching - Backend's pending_account_matching payload:
   *   { existing_candidates: [...], plaid_candidates: [...] }
   */
  function _showAccountMatchingModal(bankId, bankName, pendingMatching) {
    const overlay = document.getElementById('account-matching-overlay');
    const body = document.getElementById('matching-modal-body');
    const confirmBtn = document.getElementById('matching-confirm-btn');
    const skipBtn = document.getElementById('matching-skip-btn');
    const title = document.getElementById('matching-modal-title');

    if (!overlay || !body) return;

    title.textContent = `Match Accounts — ${bankName}`;

    const existingCandidates = pendingMatching.existing_candidates || [];
    const plaidCandidates = pendingMatching.plaid_candidates || [];

    // Build rows — one per existing orphaned account
    const rowsHtml = existingCandidates.map((existingAccount, rowIndex) => {
      const displayName = existingAccount.custom_name || existingAccount.account_name || 'Unknown';
      const categoryLabel = [existingAccount.account_category, existingAccount.account_subcategory]
        .filter(Boolean)
        .join(' / ');
      const balanceFormatted = _formatCurrency(existingAccount.current_balance);

      // Build dropdown options from Plaid candidates
      const plaidOptions = plaidCandidates.map((plaidAccount, plaidIndex) => {
        const plaidLabel = plaidAccount.plaid_name || plaidAccount.account_name || 'Unknown';
        const plaidMask = plaidAccount.plaid_mask ? ` (••${plaidAccount.plaid_mask})` : '';
        const plaidType = [plaidAccount.plaid_type, plaidAccount.plaid_subtype]
          .filter(Boolean)
          .join('/');
        const plaidBalance = _formatCurrency(plaidAccount.current_balance);
        return `<option value="${plaidIndex}">${plaidLabel}${plaidMask} — ${plaidType} — ${plaidBalance}</option>`;
      }).join('');

      return `
        <div class="matching-pair-row" data-row-index="${rowIndex}">
          <div class="matching-existing-card">
            <div class="card-name">${displayName}</div>
            <div class="card-meta">${categoryLabel} · ${existingAccount.origin || 'manual'}</div>
            <div class="card-balance">Balance: ${balanceFormatted}</div>
          </div>
          <div class="matching-arrow">→</div>
          <div class="matching-plaid-select">
            <select data-row="${rowIndex}">
              <option value="">— No match —</option>
              ${plaidOptions}
            </select>
            <div class="plaid-option-detail">Select the Plaid account this corresponds to</div>
          </div>
        </div>`;
    }).join('');

    body.innerHTML = rowsHtml;

    // Enable confirm button when at least one match is selected
    const selects = body.querySelectorAll('select');
    const _updateConfirmState = () => {
      const hasAnyMatch = Array.from(selects).some(selectElement => selectElement.value !== '');
      confirmBtn.disabled = !hasAnyMatch;
    };
    selects.forEach(selectElement => selectElement.addEventListener('change', _updateConfirmState));

    // Wire up buttons
    confirmBtn.onclick = () => _handleConfirmMatches(bankId, bankName, existingCandidates, plaidCandidates);
    skipBtn.onclick = () => _closeAccountMatchingModal(bankName, /* skipped */ true);

    overlay.style.display = 'flex';
  }

  /**
   * Collect the user's match selections and POST to confirm-account-matching.
   */
  async function _handleConfirmMatches(bankId, bankName, existingCandidates, plaidCandidates) {
    const body = document.getElementById('matching-modal-body');
    const confirmBtn = document.getElementById('matching-confirm-btn');
    if (!body) return;

    const selects = body.querySelectorAll('select');
    const matches = [];
    const usedPlaidIndices = new Set();

    selects.forEach((selectElement, rowIndex) => {
      const plaidIndex = selectElement.value;
      if (plaidIndex === '') return; // "No match" selected

      const plaidIndexNum = parseInt(plaidIndex, 10);
      if (usedPlaidIndices.has(plaidIndexNum)) {
        // Duplicate — same Plaid account picked for multiple existing accounts
        IndexUtils.showMessage(
          'dashboard-message',
          'Each Plaid account can only be matched to one existing account. Please fix duplicates.',
          'error',
        );
        return;
      }
      usedPlaidIndices.add(plaidIndexNum);

      matches.push({
        existing_account_id: existingCandidates[rowIndex].account_id,
        plaid_account_id: plaidCandidates[plaidIndexNum].account_id,
      });
    });

    if (!matches.length) {
      _closeAccountMatchingModal(bankName, /* skipped */ true);
      return;
    }

    // Disable button while processing
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing…';

    try {
      const confirmResult = await IndexApi.confirmAccountMatching(bankId, matches);
      _closeAccountMatchingModal(bankName, /* skipped */ false);
      IndexUtils.showMessage(
        'dashboard-message',
        `✓ ${bankName} updated! ${confirmResult.matches_processed || 0} account(s) merged, ` +
        `${confirmResult.transactions_moved || 0} transactions migrated.`,
        'success',
      );
      loadBanks();
    } catch (confirmError) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Matches';
      IndexUtils.showMessage('dashboard-message', 'Error: ' + confirmError.message, 'error');
    }
  }

  /**
   * Close the account matching modal and show an appropriate message.
   */
  function _closeAccountMatchingModal(bankName, skipped) {
    const overlay = document.getElementById('account-matching-overlay');
    if (overlay) overlay.style.display = 'none';

    // Reset button state
    const confirmBtn = document.getElementById('matching-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Confirm Matches';
    }

    if (skipped) {
      IndexUtils.showMessage(
        'dashboard-message',
        `✓ ${bankName} updated successfully! (Account matching skipped — ` +
        `you can manually merge accounts later from the Accounts page.)`,
        'success',
      );
    }
  }

  /**
   * Format a balance value for display.
   * @param {string|number} value - The balance value.
   * @returns {string} Formatted currency string.
   */
  function _formatCurrency(value) {
    const numericValue = parseFloat(value) || 0;
    return numericValue.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  }

  return {
    loadBanks,
    handleRefresh,
    handleRelink,
    handleDisconnect,
    handleRetryRelink,
  };
})();
