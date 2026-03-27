/**
 * Render the connected banks list on the dashboard.
 * Shows institution name, account count, sync status badges, quick actions.
 * Handles the three disconnect flows: convert, archive, hard-delete.
 */

const IndexConnectionsList = (() => {
  // Polling state for pending banks (auto-refresh while waiting for Plaid)
  let _pendingPollId = null;
  const PENDING_POLL_INTERVAL = 30 * 1000; // 30s
  const ACCOUNT_MATCHING_DRAFT_KEY = 'index_account_matching_draft';

  /** Fetch banks from backend and render the list. */
  async function loadBanks() {
    const listElement = document.getElementById('connections-list');
    if (!listElement) return;

    listElement.innerHTML = 'Loading connected banks...';

    try {
      const banks = await IndexApi.fetchDashboardBanks();
      IndexState.setBanksCache(banks);

      // Restore unfinished account matching — try localStorage draft first,
      // then fall back to re-deriving from backend if any bank has matching_pending.
      _restorePendingAccountMatchingDraft(banks);
      _checkForPendingAccountMatching(banks);

      // Clear timestamps for banks that are no longer pending, and
      // decide whether to start/stop the pending poll based on current state.
      try {
        let hasPending = false;
        banks.forEach(bank => {
          const itemId = bank.plaid_item_id || bank.item_id || null;
          if (!itemId) return;
          if (bank.connection_status === 'pending_initial_sync') {
            hasPending = true;
          } else {
            IndexState.clearActionTimestamp(itemId, 'initial_sync');
          }
          if (bank.connection_status === 'relink_pending') {
            hasPending = true;
          } else {
            IndexState.clearActionTimestamp(itemId, 'relink');
          }
        });
        if (hasPending) _startPendingPoll(); else _stopPendingPoll();
      } catch (err) {
        console.warn('Error clearing pending timestamps', err);
      }

      if (!banks.length) {
        _clearPendingAccountMatchingDraft();
        listElement.innerHTML = '<p class="banks-empty-state">No connected banks yet. Click "Connect New Bank" to get started.</p>';
        return;
      }

      listElement.innerHTML = _renderBankList(banks);
    } catch (loadError) {
      listElement.innerHTML = `<p class="banks-error">Error loading connected banks: ${loadError.message}</p>`;
    }
  }

  // Start polling the backend while any bank is in a pending state.
  function _startPendingPoll() {
    if (_pendingPollId) return; // already running
    _pendingPollId = setInterval(() => {
      loadBanks().catch(err => console.warn('Pending poll loadBanks failed', err));
    }, PENDING_POLL_INTERVAL);
  }

  function _stopPendingPoll() {
    if (!_pendingPollId) return;
    clearInterval(_pendingPollId);
    _pendingPollId = null;
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
      case 'pending_initial_sync':
        return '<span class="conn-status conn-status-pending-sync" title="Initial sync in progress, bank will be linked once complete">⏳ Syncing...</span>';
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
    // don't allow button rendering unless the relink attempt or initial sync has been pending 
    // for at least 5 minutes, to avoid confusion while waiting for Plaid
    const isRelinkPending = bank.connection_status === 'relink_pending';
    const isInitialSyncPending = bank.connection_status === 'pending_initial_sync';
    const isConverted = bank.connection_status === 'converted';
    const isManual = bank.connection_status === 'manual';
    const hasInstitution = !!bank.institution_id;
    const bankIdAttr = bank.bank_id.replace(/'/g, "\\'");
    const nameAttr = (bank.custom_name || bank.bank_name || 'Unknown Bank').replace(/'/g, "\\'");
    const itemIdAttr = (bank.plaid_item_id || '').replace(/'/g, "\\'");
    const itemStatusAttr = (bank.plaid_item_status || '').replace(/'/g, "\\'");

    const buttons = [];

    if (isRelinkPending) {
      // Only show the retry button once the relink has been pending for at least 5 minutes.
      const FIVE_MIN = 5 * 60 * 1000;
      const pendingItemId = bank.plaid_item_id || bank.item_id || null;
      const pendingSince = pendingItemId ? IndexState.getActionTimestamp(pendingItemId, 'relink') : null;
      // If there's no stored timestamp, fall back to showing the Retry button
      // (backend will still enforce any server-side timing rules).
      const canRetry = pendingSince ? (Date.now() - pendingSince >= FIVE_MIN) : true;

      buttons.push(
        `<span class="bank-btn-info" title="Waiting for Plaid to deliver complete transaction history">` +
        `⏳ Awaiting history from Plaid...</span>`
      );
      if (canRetry) {
        buttons.push(
          `<button class="bank-btn bank-btn-retry" title="Retry syncing if relink appears stuck" ` +
          `onclick="IndexConnectionsList.handleRetryRelink('${bankIdAttr}', '${nameAttr}')">` +
          `🔄 Retry Sync</button>`
        );
      }
    } else if (isInitialSyncPending) {
      // Only show the retry button once the initial sync has been pending for at least 5 minutes.
      const FIVE_MIN = 5 * 60 * 1000;
      const pendingItemId = bank.plaid_item_id || bank.item_id || null;
      const pendingSince = pendingItemId ? IndexState.getActionTimestamp(pendingItemId, 'initial_sync') : null;
      // If there's no stored timestamp, fall back to showing the Retry button
      // (backend will still enforce any server-side timing rules).
      const canRetry = pendingSince ? (Date.now() - pendingSince >= FIVE_MIN) : true;

      buttons.push(
        `<span class="bank-btn-info" title="Initial sync in progress, bank will be linked once complete">` +
        `⏳ Initial sync in progress... may take up to 5 minutes</span>`
      );
      if (canRetry) {
        buttons.push(
          `<button class="bank-btn bank-btn-retry" title="Retry initial sync if it takes longer than 5 minutes" ` +
          `onclick="IndexConnectionsList.handleRetryInitialSync('${bankIdAttr}', '${nameAttr}')">` +
          `🔄 Retry Sync</button>`
        );
      }

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
      // Activate buttons for linked banks missing a product
      const billedProducts = bank.billed_products || [];
      const availableProducts = bank.available_products || [];
      const hasTransactions = billedProducts.includes('transactions');
      const hasInvestments = billedProducts.includes('investments');

      // Transaction activation needs depository/credit accounts already linked;
      // investment-only connections have nothing to sync transactions for.
      const accounts = bank.accounts || [];
      const hasTransactionEligibleAccounts = accounts.some(
        account => account.account_category === 'depository' || account.account_category === 'credit'
      );

      if (!hasTransactions && hasTransactionEligibleAccounts && availableProducts.includes('transactions')) {
        buttons.push(
          `<button class="bank-btn bank-btn-activate" title="Activate the transactions product for this bank (Plaid billing applies)" ` +
          `onclick="IndexConnectionsList.handleActivateTransactions('${bankIdAttr}', '${nameAttr}')">`  +
          `📊 Activate Transactions</button>`
        );
      }
      // Only offer investment activation when the bank has investment accounts
      const hasInvestmentAccounts = accounts.some(
        account => (account.account_category || '').toLowerCase() === 'investment'
      );
      if (!hasInvestments && hasInvestmentAccounts && availableProducts.includes('investments')) {
        buttons.push(
          `<button class="bank-btn bank-btn-activate" title="Activate the investments product for this bank (Plaid billing applies)" ` +
          `onclick="IndexConnectionsList.handleActivateInvestments('${bankIdAttr}', '${nameAttr}', '${itemIdAttr}')">`  +
          `📈 Activate Investments</button>`
        );
      }    } else if (isConverted || isManual) {
      // Any converted or manual bank can be (re-)linked via Plaid.
      // Banks without an institution_id go through the institution picker first.
      const linkLabel = isConverted ? '🔗 Relink' : '🔗 Link to Plaid';
      const linkTitle = isConverted
        ? 'Reconnect to Plaid'
        : 'Connect this bank to Plaid for automatic syncing';

      const onClickHandler = hasInstitution
        ? `IndexConnectionsList.startRelink('${bankIdAttr}', '${nameAttr}')`
        : `IndexConnectionsList.showInstitutionPicker('${bankIdAttr}', '${nameAttr}')`;

      buttons.push(
        `<button class="bank-btn bank-btn-relink" title="${linkTitle}" ` +
        `onclick="${onClickHandler}">` +
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

  // ── Smart Link Mode Detection ──────────────────────────

  /**
   * Determine the Plaid link mode based on the bank's account categories.
   * Returns 'investments_only', null (transactions default), or 'ask' if ambiguous.
   */
  function _resolveRelinkMode(bankId) {
    const banks = IndexState.getBanksCache() || [];
    const bank = banks.find(b => b.bank_id === bankId);
    const accounts = bank?.accounts || [];

    if (accounts.length === 0) return 'ask';

    const hasTransactionEligible = accounts.some(
      a => a.account_category === 'depository' || a.account_category === 'credit'
    );
    const hasInvestment = accounts.some(
      a => (a.account_category || '').toLowerCase() === 'investment'
    );

    if (hasInvestment && !hasTransactionEligible) return 'investments_only';
    if (hasTransactionEligible && !hasInvestment) return null; // transactions default
    return 'ask'; // mixed — need user input
  }

  /**
   * Entry point for (re-)linking a bank to Plaid. Auto-detects the best link
   * mode from the bank's account categories, or shows a modal if ambiguous.
   * @param {string} bankId
   * @param {string} bankName
   * @param {string|null} institutionId - Pre-selected institution (from picker).
   */
  function startRelink(bankId, bankName, institutionId = null) {
    const resolvedMode = _resolveRelinkMode(bankId);
    if (resolvedMode === 'ask') {
      _showLinkModeModal(bankId, bankName, institutionId);
    } else {
      handleRelink(bankId, bankName, institutionId, resolvedMode);
    }
  }

  /**
   * Show the link mode selection modal for banks with mixed or no accounts.
   */
  function _showLinkModeModal(bankId, bankName, institutionId) {
    const overlay = document.getElementById('link-mode-overlay');
    const bankNameEl = document.getElementById('link-mode-bank-name');
    const txnBtn = document.getElementById('link-mode-transactions');
    const invBtn = document.getElementById('link-mode-investments');
    const cancelBtn = document.getElementById('link-mode-cancel');

    bankNameEl.textContent = bankName;
    overlay.style.display = 'flex';

    txnBtn.onclick = () => {
      closeLinkModeModal();
      handleRelink(bankId, bankName, institutionId, null);
    };
    invBtn.onclick = () => {
      closeLinkModeModal();
      handleRelink(bankId, bankName, institutionId, 'investments_only');
    };
    cancelBtn.onclick = () => closeLinkModeModal();
  }

  function closeLinkModeModal() {
    const overlay = document.getElementById('link-mode-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  /**
   * Relink a converted bank by starting a new Plaid Link session.
   * This connects a new Plaid item to the existing bank record.
   * @param {string} bankId
   * @param {string} bankName
   * @param {string|null} institutionId - Pre-selected institution for made-up banks.
   * @param {string|null} mode - 'investments_only' or null (transactions default).
   */
  async function handleRelink(bankId, bankName, institutionId = null, mode = null) {
    if (!IndexState.getAuthToken()) {
      IndexUtils.showMessage('dashboard-message', 'Please login first', 'error');
      return;
    }

    try {
      // Relink mode: pass bankId so backend scopes the link token to this bank's
      // institution and products, and set_access_token reattaches the new Plaid
      // item to the existing bank record (works for converted AND manual banks
      // that have a valid institution_id). institutionId is passed when the user
      // selected a real bank via the institution picker for made-up banks.
      // mode drives product selection on the backend (null = transactions,
      // 'investments_only' = investments).
      const linkToken = await IndexApi.fetchLinkToken({ bankId, institutionId, mode });
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken) => {
          try {
            const exchangeResult = await IndexApi.exchangePublicToken(publicToken, bankId);
            // Record relink timestamp under the Plaid item id only.
            try {
              const itemId = exchangeResult.item_id || exchangeResult.plaid_item_id || null;
              if (itemId) IndexState.setActionTimestamp(itemId, 'relink');
            } catch (tsErr) {
              console.warn('Could not persist relink timestamp', tsErr);
            }
            invalidateItemInfoCache();

            // Check for pending account matching FIRST — this takes priority
            // regardless of whether the bank is relink_pending or already linked.
            // Pass 4 data is included in the response whenever auto-matching
            // couldn't resolve all accounts.
            const relinkDetails = exchangeResult.relink_details || {};
            const pendingMatching = relinkDetails.pending_account_matching;

            if (pendingMatching && pendingMatching.needed) {
              const statusMsg = exchangeResult.connection_status === 'relink_pending'
                ? ' Waiting for Plaid to deliver transaction history.'
                : '';
              IndexUtils.showMessage(
                'dashboard-message',
                `✓ ${bankName} linked! We found accounts that need your input.${statusMsg}`,
                'success',
              );
              _showAccountMatchingModal(bankId, bankName, pendingMatching);
            } else if (exchangeResult.connection_status === 'relink_pending') {
              IndexUtils.showMessage(
                'dashboard-message',
                `⏳ ${bankName} relink initiated — waiting for Plaid to deliver complete history. This may take a up to 5 minutes. if not successfull by then, you will be able to attempt a manual retry.`,
                'success',
              );
            } else {
              IndexUtils.showMessage('dashboard-message', `✓ ${bankName} relinked successfully!`, 'success');
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
  /** Retry initial sync for a bank that is stuck in pending_initial_sync state 
   * only show this button if it has been 5 minutes since the initial sync started, 
   * otherwise it may cause confusion if users click it while the initial sync is still in progress.
  */
  async function handleRetryInitialSync(bankId, bankName) {
    if (!IndexState.getAuthToken()) {
      IndexUtils.showMessage('dashboard-message', 'Please login first', 'error');
      return;
    }

    IndexUtils.showMessage(
      'dashboard-message',
      `🔄 Retrying initial sync for ${bankName}... this may take a moment.`,
      'info',
    );

    try {
      const result = await IndexApi.retryInitialSync(bankId);
      // Clear stored initial_sync timestamp — resolve by finding the bank's item id
      try {
        const banks = IndexState.getBanksCache() || [];
        const bank = banks.find(b => b.bank_id === bankId);
        const itemId = bank?.plaid_item_id || bank?.item_id || null;
        if (itemId) IndexState.clearActionTimestamp(itemId, 'initial_sync');
      } catch (e) { /* noop */ }
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
      // Clear stored relink timestamp — resolve by finding the bank's item id
      try {
        const banks = IndexState.getBanksCache() || [];
        const bank = banks.find(b => b.bank_id === bankId);
        const itemId = bank?.plaid_item_id || bank?.item_id || null;
        if (itemId) IndexState.clearActionTimestamp(itemId, 'relink');
      } catch (e) { /* noop */ }
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

    _persistPendingAccountMatchingDraft(bankId, bankName, pendingMatching);

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

      const statusLabel = existingAccount.connection_status || existingAccount.origin || 'manual';

      return `
        <div class="matching-pair-row" data-row-index="${rowIndex}">
          <div class="matching-existing-card">
            <div class="card-name">${displayName}</div>
            <div class="card-meta">${categoryLabel} · <span class="status-badge status-${statusLabel}">${statusLabel}</span></div>
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

    // Enable confirm button when at least one match is selected,
    // and keep dropdowns in sync so a Plaid account can only be chosen once.
    const selects = body.querySelectorAll('select');

    const _syncDropdowns = () => {
      // Collect every non-empty value that is currently selected
      const selectedValues = new Set(
        Array.from(selects)
          .map(s => s.value)
          .filter(v => v !== '')
      );

      selects.forEach(selectElement => {
        const ownValue = selectElement.value;
        Array.from(selectElement.options).forEach(opt => {
          if (opt.value === '') return; // always keep "No match"
          // Disable if another row already claimed this Plaid account
          opt.disabled = selectedValues.has(opt.value) && opt.value !== ownValue;
        });
      });

      const hasAnyMatch = selectedValues.size > 0;
      confirmBtn.disabled = !hasAnyMatch;
    };

    selects.forEach(selectElement => selectElement.addEventListener('change', _syncDropdowns));

    // Wire up buttons
    confirmBtn.onclick = () => _handleConfirmMatches(bankId, bankName, existingCandidates, plaidCandidates);
    skipBtn.onclick = () => _skipAccountMatching(bankId, bankName);

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
      _skipAccountMatching(bankId, bankName);
      return;
    }

    // Disable button while processing
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing…';

    try {
      const confirmResult = await IndexApi.confirmAccountMatching(bankId, matches);
      _clearPendingAccountMatchingDraft();
      _closeAccountMatchingModal();
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
   * Skip account matching — tell the backend to finalize without merges.
   */
  async function _skipAccountMatching(bankId, bankName) {
    const skipBtn = document.getElementById('matching-skip-btn');
    if (skipBtn) {
      skipBtn.disabled = true;
      skipBtn.textContent = 'Skipping…';
    }

    try {
      await IndexApi.skipAccountMatching(bankId);
      _clearPendingAccountMatchingDraft();
      _closeAccountMatchingModal();
      IndexUtils.showMessage(
        'dashboard-message',
        `✓ ${bankName} updated successfully! (Account matching skipped — ` +
        `you can manually merge accounts later from the Accounts page.)`,
        'success',
      );
      loadBanks();
    } catch (skipError) {
      if (skipBtn) {
        skipBtn.disabled = false;
        skipBtn.textContent = 'Skip';
      }
      IndexUtils.showMessage('dashboard-message', 'Error: ' + skipError.message, 'error');
    }
  }

  /**
   * Close the account matching modal and reset button state.
   */
  function _closeAccountMatchingModal() {
    const overlay = document.getElementById('account-matching-overlay');
    if (overlay) overlay.style.display = 'none';

    const confirmBtn = document.getElementById('matching-confirm-btn');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Confirm Matches';
    }

    const skipBtn = document.getElementById('matching-skip-btn');
    if (skipBtn) {
      skipBtn.disabled = false;
      skipBtn.textContent = 'Skip';
    }
  }

  function _persistPendingAccountMatchingDraft(bankId, bankName, pendingMatching) {
    try {
      localStorage.setItem(
        ACCOUNT_MATCHING_DRAFT_KEY,
        JSON.stringify({ bankId, bankName, pendingMatching, savedAt: Date.now() }),
      );
    } catch (persistError) {
      console.warn('Could not persist account matching draft', persistError);
    }
  }

  function _clearPendingAccountMatchingDraft() {
    try {
      localStorage.removeItem(ACCOUNT_MATCHING_DRAFT_KEY);
    } catch (_clearError) {
      // no-op
    }
  }

  function _restorePendingAccountMatchingDraft(banks) {
    const overlay = document.getElementById('account-matching-overlay');
    if (overlay && overlay.style.display === 'flex') return;

    let draft = null;
    try {
      draft = JSON.parse(localStorage.getItem(ACCOUNT_MATCHING_DRAFT_KEY) || 'null');
    } catch (parseError) {
      console.warn('Invalid account matching draft payload', parseError);
      _clearPendingAccountMatchingDraft();
      return;
    }

    if (!draft?.bankId || !draft?.pendingMatching) return;

    const targetBank = (banks || []).find(bank => bank.bank_id === draft.bankId);
    if (!targetBank) {
      _clearPendingAccountMatchingDraft();
      return;
    }

    const existingCandidates = draft.pendingMatching.existing_candidates || [];
    const plaidCandidates = draft.pendingMatching.plaid_candidates || [];
    if (!existingCandidates.length || !plaidCandidates.length) {
      _clearPendingAccountMatchingDraft();
      return;
    }

    _showAccountMatchingModal(
      draft.bankId,
      draft.bankName || targetBank.custom_name || targetBank.bank_name || 'Bank',
      draft.pendingMatching,
    );
  }

  /**
   * If any bank has matching_pending=true and the localStorage draft didn't
   * already restore the modal, fetch the matching data from the backend and
   * show the modal. Fires once per loadBanks cycle — the first matching_pending
   * bank wins (multiple pending banks at once is not a realistic scenario).
   */
  async function _checkForPendingAccountMatching(banks) {
    const overlay = document.getElementById('account-matching-overlay');
    if (overlay && overlay.style.display === 'flex') return;

    const pendingBank = (banks || []).find(bank => bank.matching_pending);
    if (!pendingBank) return;

    try {
      const matchingData = await IndexApi.fetchPendingAccountMatching(pendingBank.bank_id);
      if (!matchingData?.needed) return;

      const bankDisplayName = pendingBank.custom_name || pendingBank.bank_name || 'Bank';

      _persistPendingAccountMatchingDraft(pendingBank.bank_id, bankDisplayName, matchingData);
      _showAccountMatchingModal(pendingBank.bank_id, bankDisplayName, matchingData);
    } catch (fetchError) {
      console.warn('Could not restore pending account matching from backend', fetchError);
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

  // ── Institution Picker (for made-up banks without institution_id) ──

  let _pickerBankId = null;
  let _pickerBankName = null;
  let _pickerSelectedInstitutionId = null;
  let _pickerSearchTimeout = null;

  /**
   * Show the institution picker modal so the user can select which real
   * bank corresponds to their made-up bank name.
   */
  async function showInstitutionPicker(bankId, bankName) {
    _pickerBankId = bankId;
    _pickerBankName = bankName;
    _pickerSelectedInstitutionId = null;

    const overlay = document.getElementById('institution-picker-overlay');
    const bankNameSpan = document.getElementById('institution-picker-bank-name');
    const searchInput = document.getElementById('institution-picker-search');
    const confirmBtn = document.getElementById('institution-picker-confirm');
    const resultsContainer = document.getElementById('institution-picker-results');

    bankNameSpan.textContent = bankName;
    searchInput.value = '';
    confirmBtn.disabled = true;
    resultsContainer.innerHTML = '<div class="institution-picker-empty">Loading popular banks...</div>';
    overlay.style.display = 'flex';
    searchInput.focus();

    // Wire up search input with debounce
    searchInput.oninput = () => {
      clearTimeout(_pickerSearchTimeout);
      _pickerSearchTimeout = setTimeout(() => _searchInstitutions(searchInput.value.trim()), 300);
    };

    // Wire up confirm button
    confirmBtn.onclick = () => {
      if (_pickerSelectedInstitutionId && _pickerBankId) {
        const capturedBankId = _pickerBankId;
        const capturedBankName = _pickerBankName;
        const capturedInstitutionId = _pickerSelectedInstitutionId;
        closeInstitutionPicker();
        startRelink(capturedBankId, capturedBankName, capturedInstitutionId);
      }
    };

    // Load popular institutions as initial list
    try {
      const response = await fetch(
        `${window.BACKEND_URL || 'http://localhost:8000'}/api/accounts/reference/popular-institutions`,
      );
      const data = await response.json();
      _renderInstitutionResults(data.institutions || []);
    } catch (fetchError) {
      resultsContainer.innerHTML =
        '<div class="institution-picker-empty">Failed to load institutions. Try searching.</div>';
    }
  }

  async function _searchInstitutions(query) {
    const resultsContainer = document.getElementById('institution-picker-results');
    if (query.length < 2) {
      // Too short — reload popular list
      try {
        const response = await fetch(
          `${window.BACKEND_URL || 'http://localhost:8000'}/api/accounts/reference/popular-institutions`,
        );
        const data = await response.json();
        _renderInstitutionResults(data.institutions || []);
      } catch {
        resultsContainer.innerHTML =
          '<div class="institution-picker-empty">Failed to load institutions.</div>';
      }
      return;
    }

    resultsContainer.innerHTML = '<div class="institution-picker-empty">Searching...</div>';
    try {
      const response = await fetch(
        `${window.BACKEND_URL || 'http://localhost:8000'}/api/accounts/reference/search-institutions?q=${encodeURIComponent(query)}`,
      );
      const data = await response.json();
      const institutions = data.institutions || [];
      if (institutions.length === 0) {
        resultsContainer.innerHTML =
          '<div class="institution-picker-empty">No matching banks found. Try different keywords.</div>';
        return;
      }
      _renderInstitutionResults(institutions);
    } catch {
      resultsContainer.innerHTML =
        '<div class="institution-picker-empty">Search failed. Please try again.</div>';
    }
  }

  function _renderInstitutionResults(institutions) {
    const resultsContainer = document.getElementById('institution-picker-results');
    const confirmBtn = document.getElementById('institution-picker-confirm');

    if (!institutions.length) {
      resultsContainer.innerHTML =
        '<div class="institution-picker-empty">No institutions available.</div>';
      return;
    }

    resultsContainer.innerHTML = institutions.map(inst => {
      const isSelected = inst.institution_id === _pickerSelectedInstitutionId;
      return `<div class="institution-picker-item${isSelected ? ' selected' : ''}"
                   data-institution-id="${inst.institution_id}">
                <span class="inst-name">${_escapeHtml(inst.name)}</span>
                <span class="inst-id">${_escapeHtml(inst.institution_id)}</span>
              </div>`;
    }).join('');

    // Click handlers for each item
    resultsContainer.querySelectorAll('.institution-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        _pickerSelectedInstitutionId = item.dataset.institutionId;
        // Update visual selection
        resultsContainer.querySelectorAll('.institution-picker-item').forEach(el =>
          el.classList.remove('selected'),
        );
        item.classList.add('selected');
        confirmBtn.disabled = false;
      });
    });
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function closeInstitutionPicker() {
    const overlay = document.getElementById('institution-picker-overlay');
    overlay.style.display = 'none';
    _pickerBankId = null;
    _pickerBankName = null;
    _pickerSelectedInstitutionId = null;
  }

  async function handleActivateTransactions(bankId, bankName) {
    const confirmed = confirm(
      `Activate Transactions for ${bankName}?\n\n` +
      `This will enable the transactions product on your Plaid connection. ` +
      `Plaid billing for transactions will begin immediately.\n\n` +
      `Dormant accounts under this bank will be promoted to linked and ` +
      `historical transaction data will be synced from Plaid.`,
    );
    if (!confirmed) return;

    try {
      IndexUtils.showMessage('dashboard-message', `Activating transactions for ${bankName}…`, 'info');
      const result = await IndexApi.activateTransactions(bankId);
      const activatedCount = (result.accounts_activated || []).length;
      IndexUtils.showMessage(
        'dashboard-message',
        `✓ Transactions activated for ${bankName}! ${activatedCount} account(s) promoted. ` +
        `Historical data will sync shortly via webhook.`,
        'success',
      );
      loadBanks();
    } catch (activateError) {
      IndexUtils.showMessage('dashboard-message', 'Error: ' + activateError.message, 'error');
    }
  }

  async function handleActivateInvestments(bankId, bankName, itemId) {
    const confirmed = confirm(
      `Activate Investments for ${bankName}?\n\n` +
      `This will enable the investments product on your Plaid connection. ` +
      `Plaid billing for investments will begin immediately.\n\n` +
      `Holdings data will be fetched and synced.`,
    );
    if (!confirmed) return;

    try {
      IndexUtils.showMessage('dashboard-message', `Activating investments for ${bankName}…`, 'info');
      await IndexApi.activateInvestments(itemId);
      IndexUtils.showMessage(
        'dashboard-message',
        `✓ Investments activated for ${bankName}! Holdings data synced.`,
        'success',
      );
      loadBanks();
    } catch (activateError) {
      IndexUtils.showMessage('dashboard-message', 'Error: ' + activateError.message, 'error');
    }
  }

  return {
    loadBanks,
    handleRefresh,
    handleRelink,
    handleDisconnect,
    handleRetryRelink,
    handleActivateTransactions,
    handleActivateInvestments,
    showInstitutionPicker,
    closeInstitutionPicker,
    closeLinkModeModal,
    startRelink,
    handleRetryInitialSync,
  };
})();
