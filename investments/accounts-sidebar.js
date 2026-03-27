// ============================================================
// investments/accounts-sidebar.js — Investment Account Sidebar
// Multi-select with "Pool All Accounts" toggle, activate/sync,
// rename, manage-accounts link. Investment accounts only.
// ============================================================

/**
 * Load investment accounts from backend, enrich with product info,
 * populate investmentAccounts state, and render the sidebar.
 */
async function loadInvestmentAccounts() {
  const container = document.getElementById('accounts-list');
  container.innerHTML = '<div class="status-message info">Loading accounts…</div>';

  try {
    const allAccounts = await fetchAllAccounts();
    const invAccounts = allAccounts.filter(
      acc => (acc.account_category || '').toLowerCase() === 'investment'
    );

    // Fetch item-level product info for each distinct plaid_item_id
    const itemIds = [...new Set(invAccounts.map(acc => acc.plaid_item_id).filter(Boolean))];
    const itemInfoResults = await Promise.all(
      itemIds.map(itemId => fetchItemInfo(itemId).catch(() => ({
        item_id: itemId, billed_products: [], available_products: []
      })))
    );

    const itemInfoMap = {};
    itemInfoResults.forEach(info => {
      const key = info.item_id || info.plaid_item_id;
      if (key) itemInfoMap[key] = info;
    });

    investmentAccounts = invAccounts.map(acc => {
      const info = itemInfoMap[acc.plaid_item_id] || { billed_products: [], available_products: [] };
      let billed = _normalizeProductList(info.billed_products);
      let available = _normalizeProductList(info.available_products);

      let status = 'inactive';
      if (billed.includes('investments')) status = 'active';
      else if (available.includes('investments')) status = 'available';

      return {
        account_id: acc.account_id,
        plaid_account_id: acc.plaid_account_id,
        plaid_item_id: acc.plaid_item_id,
        institution_name: acc.institution_name,
        account_name: acc.account_name,
        custom_name: acc.custom_name,
        account_type: acc.account_type,
        account_subtype: acc.account_subtype,
        mask: acc.mask,
        status: status,
        billed_products: billed,
        available_products: available,
        current_balance: parseFloat(acc.current_balance) || 0,
        updated_at: acc.last_updated || null,
        holdings_hidden: acc.holdings_hidden || false,
        is_hidden: acc.is_hidden || false
      };
    });

    _buildAccountStatus();
    renderInvestmentSidebar();

    // Default: pool all accounts selected
    if (poolAllMode) {
      _applyPoolAllSelection();
    }
  } catch (error) {
    container.innerHTML = `<div class="error">Error loading accounts: ${error.message}</div>`;
  }
}

function _normalizeProductList(products) {
  if (typeof products === 'string') {
    try { return JSON.parse(products); } catch (_) { return []; }
  }
  return Array.isArray(products) ? products : [];
}

/**
 * Build accountStatus array (item-level) for sync-all logic.
 */
function _buildAccountStatus() {
  const itemIds = [...new Set(investmentAccounts.map(acc => acc.plaid_item_id).filter(Boolean))];
  accountStatus = itemIds.map(itemId => {
    const accs = investmentAccounts.filter(acc => acc.plaid_item_id === itemId);
    const hasActive = accs.some(acc => acc.status === 'active');
    const hasAvailable = accs.some(acc => acc.status === 'available');
    const representative = accs[0] || {};

    let status = 'not_supported';
    if (hasActive) status = 'active';
    else if (hasAvailable) status = 'available';

    return {
      plaid_item_id: itemId,
      institution_name: representative.institution_name || 'Unknown',
      status: status,
      last_updated: representative.updated_at
    };
  });
}

function renderInvestmentSidebar() {
  const container = document.getElementById('accounts-list');

  if (!investmentAccounts || investmentAccounts.length === 0) {
    container.innerHTML = '<div class="empty-state">No investment accounts found.<br><a href="accounts.html">Manage Accounts</a></div>';
    return;
  }

  let html = '';

  // Pool All Accounts toggle
  const poolClass = poolAllMode ? 'selected' : '';
  html += `
    <div class="sidebar-all-accounts ${poolClass}" tabindex="0" onclick="togglePoolAll()">
      <span>⊕ Pool All Accounts</span>
    </div>
  `;

  // Only show active accounts that are not holdings_hidden
  const activeAccounts = investmentAccounts.filter(acc => acc.status === 'active' && !acc.holdings_hidden);

  // Investment accounts section
  html += '<div class="sidebar-account-group">';
  html += `<div class="sidebar-group-title">
    <span>📈 Investment</span>
    <span class="sidebar-group-total">${formatCompactCurrency(_sumBalances(activeAccounts))}</span>
  </div>`;

  // Regroup active accounts by item
  const activeGroupedByItem = {};
  activeAccounts.forEach(acc => {
    const itemId = acc.plaid_item_id || 'no_item';
    if (!activeGroupedByItem[itemId]) activeGroupedByItem[itemId] = [];
    activeGroupedByItem[itemId].push(acc);
  });

  Object.keys(activeGroupedByItem).forEach(itemId => {
    const accounts = activeGroupedByItem[itemId];

    accounts.forEach(acc => {
      const displayName = buildAccountDisplayName(acc);
      const maskMatch = displayName.match(/^(.*?)(\s*\(\d{3,6}\))$/);
      const displayNameMain = maskMatch ? maskMatch[1] : displayName;
      const displayNameSuffix = maskMatch ? maskMatch[2] : '';
      const balanceStr = formatCompactCurrency(acc.current_balance);
      const balanceColorClass = acc.current_balance < 0 ? 'sidebar-account-balance-negative' : 'sidebar-account-balance';
      const isSelected = !poolAllMode && selectedAccountIds.has(acc.account_id);
      const selectedClass = isSelected ? 'selected' : '';
      html += `
        <div class="sidebar-account-item ${selectedClass}"
             tabindex="0"
             data-account-id="${acc.account_id}"
             onclick="toggleAccountSelection('${acc.account_id}')"
             oncontextmenu="event.preventDefault(); _showInvAccountContextMenu(event, '${acc.account_id}')">
          <div class="sidebar-account-label">
            <span class="sidebar-account-name-text" title="${displayName}">${displayNameMain}</span>
            <span class="sidebar-account-mask">${displayNameSuffix}</span>
          </div>
          <div class="sidebar-account-right">
            <span class="${balanceColorClass}">${balanceStr}</span>
          </div>
        </div>
      `;
    });
  });

  html += '</div>'; // close sidebar-account-group

  // Manage Accounts link
  html += `
    <a href="accounts.html" class="sidebar-create-btn" style="background: var(--accent-primary);">
      Manage Accounts
    </a>
  `;

  container.innerHTML = html;
}

function _sumBalances(accounts) {
  return accounts.reduce((sum, acc) => sum + (acc.current_balance || 0), 0);
}

// ─── Investment Sidebar Context Menu ─────────────────────────

function _showInvAccountContextMenu(event, accountId) {
  _dismissInvAccountContextMenu();

  const acc = investmentAccounts.find(a => a.account_id === accountId);
  if (!acc) return;

  const menu = document.createElement('div');
  menu.id = 'inv-account-context-menu';
  menu.className = 'account-context-menu';

  let items = '';
  // Rename
  items += `<div class="account-ctx-item" onclick="_ctxInvRenameAccount('${accountId}')">✏ Rename Account</div>`;
  if (acc.custom_name) {
    items += `<div class="account-ctx-item" onclick="_ctxInvClearCustomName('${accountId}')">↩ Reset to Default Name</div>`;
  }
  items += '<div class="account-ctx-separator"></div>';
  items += `<div class="account-ctx-item account-ctx-item-warn" onclick="_ctxInvHideHoldings('${accountId}')">🙈 Hide Holdings</div>`;

  menu.innerHTML = items;
  document.body.appendChild(menu);

  const menuWidth = 200;
  const menuHeight = menu.offsetHeight || 100;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  setTimeout(() => {
    document.addEventListener('click', _dismissInvAccountContextMenu, { once: true });
    document.addEventListener('keydown', _handleInvCtxEscape);
  }, 0);
}

function _handleInvCtxEscape(event) {
  if (event.key === 'Escape') _dismissInvAccountContextMenu();
}

function _dismissInvAccountContextMenu() {
  const existing = document.getElementById('inv-account-context-menu');
  if (existing) existing.remove();
  document.removeEventListener('keydown', _handleInvCtxEscape);
}

function _ctxInvRenameAccount(accountId) {
  _dismissInvAccountContextMenu();
  const acc = investmentAccounts.find(a => a.account_id === accountId);
  promptInvestmentRename(accountId, (acc && acc.custom_name) || '');
}

async function _ctxInvClearCustomName(accountId) {
  _dismissInvAccountContextMenu();
  try {
    await renameAccountApi(accountId, null);
    showInvestmentMessage('Name reset to default', 'success');
    await loadInvestmentAccounts();
  } catch (error) {
    showInvestmentMessage('Reset failed: ' + error.message, 'error');
  }
}

async function _ctxInvHideHoldings(accountId) {
  _dismissInvAccountContextMenu();
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings_hidden: true })
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to hide holdings');
    }
    showInvestmentMessage('Holdings hidden — manage from Accounts page', 'success');
    await loadInvestmentAccounts();
    await loadInvestmentHoldings();
  } catch (error) {
    showInvestmentMessage('Failed: ' + error.message, 'error');
  }
}

// --- Selection handlers ---

function togglePoolAll() {
  poolAllMode = true;
  selectedAccountIds.clear();
  renderInvestmentSidebar();
  _applyPoolAllSelection();
  onAccountSelectionChanged();
  if (typeof _saveViewerPrefs === 'function') _saveViewerPrefs();
}

function toggleAccountSelection(accountId) {
  const account = investmentAccounts.find(acc => acc.account_id === accountId);
  if (!account || account.status !== 'active') return;

  // Transitioning from pool-all: select only the clicked account
  if (poolAllMode) {
    poolAllMode = false;
    selectedAccountIds.clear();
    selectedAccountIds.add(accountId);
  } else if (selectedAccountIds.has(accountId)) {
    selectedAccountIds.delete(accountId);
    // If nothing selected, revert to pool mode
    if (selectedAccountIds.size === 0) {
      poolAllMode = true;
      _applyPoolAllSelection();
    }
  } else {
    selectedAccountIds.add(accountId);
  }

  renderInvestmentSidebar();
  onAccountSelectionChanged();
  if (typeof _saveViewerPrefs === 'function') _saveViewerPrefs();
}

function _applyPoolAllSelection() {
  selectedAccountIds.clear();
  investmentAccounts
    .filter(acc => acc.status === 'active' && !acc.holdings_hidden)
    .forEach(acc => selectedAccountIds.add(acc.account_id));
}

// --- Actions ---

async function activateAndSyncItem(itemId) {
  if (!confirm('Activating investments may incur additional Plaid fees. Proceed?')) return;

  const btn = document.querySelector(`button[data-item="${itemId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Activating…'; }

  try {
    await syncItemApi(itemId, true);
    showInvestmentMessage('Activated and synced successfully', 'success');
    await loadInvestmentAccounts();
    await loadInvestmentHoldings();
  } catch (error) {
    showInvestmentMessage('Activation failed: ' + error.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Activate & Sync'; }
  }
}

async function syncAllHoldings() {
  const activeItems = accountStatus.filter(item => item.status === 'active');
  if (activeItems.length === 0) {
    alert('No active investment accounts found.');
    return;
  }

  if (!confirm(`Syncing ${activeItems.length} active bank connection(s). This may take a moment.`)) return;

  let successCount = 0;
  for (const item of activeItems) {
    try {
      await syncItemApi(item.plaid_item_id, false);
      successCount++;
    } catch (error) {
      console.error(`Sync failed for ${item.institution_name}:`, error);
    }
  }

  await loadInvestmentHoldings();
  showInvestmentMessage(`Synced ${successCount}/${activeItems.length} connections`, 'success');
}

async function promptInvestmentRename(accountId, currentCustomName) {
  const newName = prompt('Enter a custom name for this account (leave empty to reset):', currentCustomName);
  if (newName === null) return;

  try {
    await renameAccountApi(accountId, newName.trim() || null);
    showInvestmentMessage('Account renamed', 'success');
    await loadInvestmentAccounts();
  } catch (error) {
    showInvestmentMessage('Rename failed: ' + error.message, 'error');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('accounts-sidebar');
  sidebar.classList.toggle('open');
}
