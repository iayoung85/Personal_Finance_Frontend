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
    const isConverted = bank.connection_status === 'converted';
    const bankIdAttr = bank.bank_id.replace(/'/g, "\\'");
    const nameAttr = (bank.custom_name || bank.bank_name || 'Unknown Bank').replace(/'/g, "\\'");
    const itemIdAttr = (bank.plaid_item_id || '').replace(/'/g, "\\'");
    const itemStatusAttr = (bank.plaid_item_status || '').replace(/'/g, "\\'");

    const buttons = [];

    if (isLinked) {
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
    } else if (isConverted) {
      // Converted bank: offer to relink via a new Plaid link session
      buttons.push(
        `<button class="bank-btn bank-btn-relink" title="Reconnect to Plaid" ` +
        `onclick="IndexConnectionsList.handleRelink('${bankIdAttr}', '${nameAttr}')">` +
        `🔗 Relink</button>`
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
              IndexUtils.showMessage('dashboard-message', `✓ ${bankName} refreshed successfully!`, 'success');
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
            await IndexApi.exchangePublicToken(publicToken, bankId);
            invalidateItemInfoCache();
            IndexUtils.showMessage('dashboard-message', `✓ ${bankName} relinked successfully!`, 'success');
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

  return {
    loadBanks,
    handleRefresh,
    handleRelink,
    handleDisconnect,
  };
})();
