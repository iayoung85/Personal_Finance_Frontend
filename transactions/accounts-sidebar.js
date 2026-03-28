// ============================================================
// transactions/accounts-sidebar.js — Account Sidebar Management
// Loading accounts, rendering the sidebar, selection state,
// activation, renaming, and manual account creation.
// ============================================================

let _pendingSidebarFocusAccountId = null;
const _ALL_ACCOUNTS_NAV_ID = '__all_accounts__';
let _showHiddenAccounts = false;

/**
 * Build the human-readable display name for an account.
 * Custom name takes priority and is shown as-is (user controls mask inclusion).
 * Default format: <bank_name> - <account_name>(...<mask>)
 */
function _buildAccountDisplayName(acc) {
  if (acc.custom_name) return acc.custom_name;

  const bankPrefix = acc.bank_name || acc.institution_name || '';
  const accountName = acc.account_name || 'Unknown Account';
  const mask = acc.mask;

  let nameWithMask = accountName;
  if (mask && !accountName.includes(mask)) {
    nameWithMask = `${accountName} (${mask})`;
  }

  return bankPrefix ? `${bankPrefix} - ${nameWithMask}` : nameWithMask;
}

async function refreshAccounts() {
  try {
    showStatus('Syncing accounts from Plaid...', 'info');
    const response = await fetch(`${BACKEND_URL}/api/accounts`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to refresh accounts');
    }
    
    await loadAccounts(true);
    showStatus('Accounts refreshed successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    console.error('refreshAccounts error:', error);
    showStatus(`Failed to refresh accounts: ${error.message}`, 'error');
  }
}

function selectAllAccounts() {
  selectedAccountMode = 'all';
  selectedAccountId = null;
  renderAccountsSidebar();
  // Note: Don't render transaction table here during init - transactions may not be loaded yet
}

function deselectAllAccounts() {
  selectedAccountMode = 'all';
  selectedAccountId = null;
  renderAccountsSidebar();
  // Note: Don't render transaction table here during init - transactions may not be loaded yet
}

function toggleSidebar() {
  const sidebar = document.getElementById('accounts-sidebar');
  sidebar.classList.toggle('open');
}

async function selectAccount(accountId) {
  selectedAccountMode = 'single';
  selectedAccountId = accountId;
  localStorage.setItem('pf_selected_account', accountId);
  renderAccountsSidebar();
  // Fetch running balance data for the ledger column before rendering table
  await fetchBalanceHistory(accountId);
  renderTransactionTable();
}

function selectAllAccountsMode() {
  selectedAccountMode = 'all';
  selectedAccountId = null;
  localStorage.removeItem('pf_selected_account');
  balanceHistoryLookup = {};
  renderAccountsSidebar();
  renderTransactionTable();
}

async function fetchItemInfo(itemId) {
  // Fetch item info from connections endpoint
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/item_info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ item_id: itemId })
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch item info');
    }
    return await response.json();
  } catch (error) {
    console.debug('fetchItemInfo error:', error);
    // Return default structure if endpoint doesn't exist
    return {
      item_id: itemId,
      billed_products: ['transactions'], // Assume transactions is billed by default
      available_products: []
    };
  }
}

async function loadAccounts() {
  try {
    showStatus('Loading accounts...', 'info');

    // 1) Get canonical accounts list (includes Plaid + manual accounts, all types)
    const resp = await authenticatedFetch(`${BACKEND_URL}/api/accounts`);
    const data = await resp.json();
    if (data.error) {
      showStatus(`Error: ${data.error}`, 'error');
      return;
    }

    const allAccounts = data.accounts || [];
    console.debug('loadAccounts: /api/accounts returned', allAccounts.length, 'accounts');

    // 2) Map to internal format (all account types now included)
    const mappedAccounts = allAccounts.map(a => ({
      account_id: a.account_id || null,
      plaid_account_id: a.plaid_account_id || null,
      plaid_item_id: a.plaid_item_id || a.item_id || null,
      bank_id: a.bank_id || null,
      bank_name: a.bank_name || null,
      institution_name: a.institution_name || a.bank_name || null,
      account_name: a.account_name || '',
      account_category: a.account_category || a.account_type || '',
      account_subcategory: a.account_subcategory || a.account_subtype || '',
      current_balance: parseFloat(a.current_balance) || 0,
      custom_name: a.custom_name || null,
      origin: a.origin || 'manual',
      connection_status: a.connection_status || 'manual',
      mask: a.mask || null,
      last_updated: a.last_balance_update || a.last_updated || null,
      is_archived: a.is_archived || false,
      is_hidden: a.is_hidden || false,
      billed_products: a.billed_products || [],
      available_products: a.available_products || [],
      // Backend-authoritative boundary for manual txn date guard (Problem 5 alignment)
      earliest_plaid_transaction_date: a.earliest_plaid_transaction_date || null,
    }))
    .filter(a => a.account_id); // Filter out any without account_id

    accounts = mappedAccounts;
    console.debug('loadAccounts: mapped', accounts.length, 'accounts');

    // 3) For Plaid-linked accounts, fetch item-level product info for activation status
    // Why connection_status not origin: origin is immutable birth record.
    // Only actively linked accounts have a live plaid_item_id to query.
    const plaidItemIds = [...new Set(
      accounts
        .filter(a => a.connection_status === 'linked')
        .map(a => a.plaid_item_id)
        .filter(Boolean)
    )];

    if (plaidItemIds.length > 0) {
      const itemInfoResults = await Promise.all(
        plaidItemIds.map(async (itemId) => {
          try {
            return await fetchItemInfo(itemId);
          } catch (err) {
            console.debug('fetchItemInfo failed for', itemId, err && err.message);
            return { item_id: itemId, billed_products: [], available_products: [] };
          }
        })
      );

      const itemInfoMap = {};
      itemInfoResults.forEach(it => {
        if (it && (it.item_id || it.plaid_item_id)) {
          itemInfoMap[it.item_id || it.plaid_item_id] = it;
        }
      });

      // Attach product info to accounts
      accounts = accounts.map(acc => {
        const info = itemInfoMap[acc.plaid_item_id] || { billed_products: [], available_products: [] };
        let billed = info.billed_products || [];
        if (typeof billed === 'string') {
          try { billed = JSON.parse(billed); } catch (e) { billed = []; }
        }
        return {
          ...acc,
          billed_products: billed,
          available_products: info.available_products || []
        };
      });
    }

    renderAccountsSidebar();

    showStatus('Accounts loaded successfully', 'success');
    setTimeout(() => clearStatus(), 2000);

  } catch (error) {
    console.error('loadAccounts error:', error);
    showStatus(`Failed to load accounts: ${error.message}`, 'error');
  }
}

function _wireSidebarKeyboardNavigation(container) {
  if (!container) return;
  if (container.dataset.arrowNavBound === 'true') return;

  const handleArrowNavigation = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const activeElement = document.activeElement;
    const isTypingContext = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.isContentEditable
    );
    if (isTypingContext) return;

    const sidebarRows = Array.from(container.querySelectorAll('.sidebar-all-accounts, .sidebar-account-item'));
    if (sidebarRows.length === 0) return;

    const focusedSidebarRow = activeElement && activeElement.closest
      ? activeElement.closest('.sidebar-all-accounts, .sidebar-account-item')
      : null;
    const focusIsInSidebar = !!focusedSidebarRow;
    const hasSelectedSidebarAccount = selectedAccountMode === 'single' && !!selectedAccountId;

    if (!focusIsInSidebar && !hasSelectedSidebarAccount) return;

    let currentIndex = -1;
    if (focusedSidebarRow) {
      currentIndex = sidebarRows.indexOf(focusedSidebarRow);
    }

    if (currentIndex < 0 && hasSelectedSidebarAccount) {
      currentIndex = sidebarRows.findIndex(row => row.dataset.accountId === selectedAccountId);
    }

    if (currentIndex < 0) {
      currentIndex = 0;
    }

    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= sidebarRows.length) return;

    const nextAccountId = sidebarRows[nextIndex].dataset.accountId || _ALL_ACCOUNTS_NAV_ID;

    event.preventDefault();
    _pendingSidebarFocusAccountId = nextAccountId;
    if (nextAccountId === _ALL_ACCOUNTS_NAV_ID) {
      selectAllAccountsMode();
      return;
    }

    void selectAccount(nextAccountId);
  };

  // container.addEventListener('keydown', handleArrowNavigation);
  document.addEventListener('keydown', handleArrowNavigation);

  container.dataset.arrowNavBound = 'true';
}

function renderAccountsSidebar() {
  const container = document.getElementById('accounts-list');
  
  if (accounts.length === 0) {
    container.innerHTML = '<p style="padding: 10px; color: #999;">No accounts found</p>';
    return;
  }

  const formatSidebarCurrency = (amount) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);

  const sumAccountBalances = (accountList) => accountList.reduce((sum, account) => {
    return sum + (account.current_balance || 0);
  }, 0);

  // Separate visible vs hidden accounts
  const visibleAccounts = accounts.filter(acc => !acc.is_hidden);
  const hiddenAccounts = accounts.filter(acc => acc.is_hidden);

  // Compute total balance across visible accounts only
  const totalBalance = sumAccountBalances(visibleAccounts);
  const totalBalanceStr = formatSidebarCurrency(totalBalance);

  // Group accounts by category
  const categoryOrder = ['depository', 'credit', 'investment', 'loan', 'asset', 'liability'];
  const categoryLabels = {
    'depository': '🔹 Depository',
    'credit': '💳 Credit',
    'investment': '📈 Investment',
    'loan': '📋 Loan',
    'asset': '💎 Asset',
    'liability': '⚠️ Liability'
  };

  const grouped = {
    active: {},
  };

  visibleAccounts.forEach(acc => {
    const cat = acc.account_category || 'asset';
    if (!grouped.active[cat]) {
      grouped.active[cat] = [];
    }
    grouped.active[cat].push(acc);
  });

  // Sort accounts within each category by account_name
  Object.keys(grouped.active).forEach(cat => {
    grouped.active[cat].sort((a, b) => {
      const nameA = (a.custom_name || a.account_name).toLowerCase();
      const nameB = (b.custom_name || b.account_name).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  const categoryTotals = {};
  Object.keys(grouped.active).forEach(cat => {
    categoryTotals[cat] = sumAccountBalances(grouped.active[cat]);
  });

  const superCategoryDefinitions = [
    {
      id: 'banking',
      label: 'Banking Net:',
      categories: ['depository', 'credit']
    },
    {
      id: 'assets-liabilities',
      label: 'Assets/Liabilities:',
      categories: ['investment', 'loan', 'asset', 'liability']
    }
  ];

  let html = '';

  const netWorthTotalClass = totalBalance < 0
    ? 'sidebar-super-group-total sidebar-super-group-total-negative'
    : 'sidebar-super-group-total sidebar-super-group-total-positive';

  const superCategoryRows = superCategoryDefinitions.map(superCategory => {
    const superCategoryTotal = superCategory.categories.reduce((sum, cat) => {
      return sum + (categoryTotals[cat] || 0);
    }, 0);
    const superCategoryTotalClass = superCategoryTotal < 0
      ? 'sidebar-super-group-total sidebar-super-group-total-negative'
      : 'sidebar-super-group-total sidebar-super-group-total-positive';

    return `
      <div class="sidebar-super-group-title">
        <span>${superCategory.label}</span>
        <span class="${superCategoryTotalClass}">${formatSidebarCurrency(superCategoryTotal)}</span>
      </div>
    `;
  }).join('');

  html += `
    <div class="sidebar-super-group-box">
      <div class="sidebar-super-group-title">
        <span>Net Worth:</span>
        <span class="${netWorthTotalClass}">${totalBalanceStr}</span>
      </div>
      ${superCategoryRows}
    </div>
  `;

  // ===== ALL ACCOUNTS ITEM =====
  const allAccountsClass = selectedAccountMode === 'all' ? 'selected' : '';
  html += `
    <div class="sidebar-all-accounts ${allAccountsClass}" tabindex="0" data-account-id="${_ALL_ACCOUNTS_NAV_ID}" onclick="selectAllAccountsMode()">
      <span>⊕ All Accounts</span>
    </div>
  `;

  const renderCategoryBlock = (cat) => {
    if (grouped.active[cat] && grouped.active[cat].length > 0) {
      html += `<div class="sidebar-account-group">`;
      html += `
        <div class="sidebar-group-title">
          <span>${categoryLabels[cat] || cat}</span>
          <span class="sidebar-group-total">${formatSidebarCurrency(categoryTotals[cat] || 0)}</span>
        </div>
      `;

      grouped.active[cat].forEach(acc => {
        html += _renderSidebarAccountItem(acc, formatSidebarCurrency);
      });

      html += '</div>';
    }
  };

  // ===== ACTIVE ACCOUNTS (grouped by category) =====
  categoryOrder.forEach(cat => {
    renderCategoryBlock(cat);
  });

  // ===== HIDDEN ACCOUNTS TOGGLE & LIST =====
  if (hiddenAccounts.length > 0) {
    const toggleClass = _showHiddenAccounts ? 'expanded' : '';
    html += `
      <div class="sidebar-hidden-toggle ${toggleClass}" onclick="_toggleHiddenAccountsView()">
        <span>${_showHiddenAccounts ? '▾' : '▸'} Hidden Accounts (${hiddenAccounts.length})</span>
      </div>
    `;

    if (_showHiddenAccounts) {
      html += '<div class="sidebar-hidden-list">';
      hiddenAccounts.forEach(acc => {
        const displayName = _buildAccountDisplayName(acc);
        html += `
          <div class="sidebar-hidden-account-item"
               oncontextmenu="event.preventDefault(); _showAccountContextMenu(event, '${acc.account_id}', true)">
            <span class="sidebar-hidden-account-name" title="${displayName}">${displayName}</span>
            <button class="sidebar-unhide-btn" title="Unhide account"
                    onclick="event.stopPropagation(); _unhideAccount('${acc.account_id}')">
              Unhide
            </button>
          </div>
        `;
      });
      html += '</div>';
    }
  }

  // ===== CREATE MANUAL ACCOUNT LINK =====
  html += `
    <a href="accounts.html#create-account" class="sidebar-create-btn">
      + Create Manual Account
    </a>
  `;

  container.innerHTML = html;
  _wireSidebarKeyboardNavigation(container);

  if (_pendingSidebarFocusAccountId) {
    const focusTarget = container.querySelector(`[data-account-id="${_pendingSidebarFocusAccountId}"]`);
    if (focusTarget) {
      focusTarget.focus();
    }
    _pendingSidebarFocusAccountId = null;
  }
}

// ─── Sidebar account item renderer ───────────────────────────

function _renderSidebarAccountItem(acc, formatSidebarCurrency) {
  const displayName = _buildAccountDisplayName(acc);
  const maskMatch = displayName.match(/^(.*?)(\s*\(\d{3,6}\))$/);
  const displayNameMain = maskMatch ? maskMatch[1] : displayName;
  const displayNameSuffix = maskMatch ? maskMatch[2] : '';
  const currentBalance = acc.current_balance || 0;
  const balanceStr = formatSidebarCurrency(currentBalance);
  const balanceColorClass = currentBalance < 0 ? 'sidebar-account-balance-negative' : 'sidebar-account-balance';

  const isSelected = selectedAccountMode === 'single' && selectedAccountId === acc.account_id;
  const selectedClass = isSelected ? 'selected' : '';

  return `
    <div class="sidebar-account-item ${selectedClass}" tabindex="0"
         data-account-id="${acc.account_id}"
         onclick="selectAccount('${acc.account_id}')"
         oncontextmenu="event.preventDefault(); _showAccountContextMenu(event, '${acc.account_id}', false)">
      <div class="sidebar-account-label">
        <span class="sidebar-account-name-text" title="${displayName}">${displayNameMain}</span><span class="sidebar-account-mask">${displayNameSuffix}</span>
      </div>
      <div class="${balanceColorClass}">${balanceStr}</div>
    </div>
  `;
}

// ─── Account Sidebar Context Menu ────────────────────────────

function _showAccountContextMenu(event, accountId, isHidden) {
  _dismissAccountContextMenu();

  const acc = accounts.find(a => a.account_id === accountId);
  if (!acc) return;

  const menu = document.createElement('div');
  menu.id = 'account-context-menu';
  menu.className = 'account-context-menu';

  let items = '';

  if (isHidden) {
    items += `<div class="account-ctx-item" onclick="_unhideAccount('${accountId}')">👁 Unhide Account</div>`;
  } else {
    // Rename
    items += `<div class="account-ctx-item" onclick="_ctxRenameAccount('${accountId}')">✏ Rename Account</div>`;
    // Clear custom name (only if custom name is set)
    if (acc.custom_name) {
      items += `<div class="account-ctx-item" onclick="_ctxClearCustomName('${accountId}')">↩ Reset to Default Name</div>`;
    }
    // Add Trending Transaction (investment accounts only)
    if (acc.account_category === 'investment') {
      items += '<div class="account-ctx-separator"></div>';
      items += `<div class="account-ctx-item" onclick="_ctxAddTrendingTransaction('${accountId}')">📈 Add Trending Transaction</div>`;
    }
    items += '<div class="account-ctx-separator"></div>';
    // Hide
    items += `<div class="account-ctx-item account-ctx-item-warn" onclick="_hideAccount('${accountId}')">🙈 Hide Account</div>`;
  }

  menu.innerHTML = items;
  document.body.appendChild(menu);

  // Position near the click, keeping it on screen
  const menuWidth = 200;
  const menuHeight = menu.offsetHeight || 120;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Dismiss on click outside or Escape
  setTimeout(() => {
    document.addEventListener('click', _dismissAccountContextMenu, { once: true });
    document.addEventListener('keydown', _handleAccountCtxEscape);
  }, 0);
}

function _handleAccountCtxEscape(event) {
  if (event.key === 'Escape') _dismissAccountContextMenu();
}

function _dismissAccountContextMenu() {
  const existing = document.getElementById('account-context-menu');
  if (existing) existing.remove();
  document.removeEventListener('keydown', _handleAccountCtxEscape);
}

// ─── Context menu actions ────────────────────────────────────

function _ctxRenameAccount(accountId) {
  _dismissAccountContextMenu();
  const acc = accounts.find(a => a.account_id === accountId);
  promptRename(accountId, (acc && acc.custom_name) || '');
}

function _ctxClearCustomName(accountId) {
  _dismissAccountContextMenu();
  _updateAccountField(accountId, { custom_name: null }, 'Name reset to default');
}

async function _hideAccount(accountId) {
  _dismissAccountContextMenu();
  await _updateAccountField(accountId, { is_hidden: true }, 'Account hidden');
}

async function _unhideAccount(accountId) {
  _dismissAccountContextMenu();
  await _updateAccountField(accountId, { is_hidden: false }, 'Account unhidden');
}

function _ctxAddTrendingTransaction(accountId) {
  _dismissAccountContextMenu();
  _openAddTrendingModal(accountId);
}

function _openAddTrendingModal(accountId) {
  const account = accounts.find(a => a.account_id === accountId);
  const accountName = account?.custom_name || account?.name || account?.official_name || 'Account';

  let overlay = document.getElementById('add-trending-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'add-trending-modal';
    overlay.className = 'modal-overlay hidden';
    document.body.appendChild(overlay);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const currentMonth = todayIso.slice(0, 7);

  overlay.innerHTML = `
    <div class="modal modal-edit-balance">
      <div class="modal-header">
        <h2>📈 Add Trending Transaction</h2>
        <button class="modal-close" id="add-trending-close">✕</button>
      </div>
      <div class="modal-body">
        <p class="edit-balance-context">
          <strong>${escapeHtml(accountName)}</strong>
        </p>
        <div class="form-group">
          <label for="add-trending-month">Month</label>
          <input type="month" id="add-trending-month" value="${currentMonth}" max="${currentMonth}">
        </div>
        <div class="form-group">
          <label for="add-trending-balance">Account Balance at End of Month ($)</label>
          <input type="number" id="add-trending-balance" step="0.01" placeholder="e.g. 105000.00" autofocus>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary" id="add-trending-cancel">Cancel</button>
        <button class="primary" id="add-trending-save">Create</button>
      </div>
    </div>
  `;

  overlay.classList.remove('hidden');

  const closeModal = () => overlay.classList.add('hidden');
  document.getElementById('add-trending-close').onclick = closeModal;
  document.getElementById('add-trending-cancel').onclick = closeModal;
  overlay.onclick = (event) => { if (event.target === overlay) closeModal(); };

  const balanceInput = document.getElementById('add-trending-balance');
  balanceInput.focus();

  const saveTrending = async () => {
    const month = document.getElementById('add-trending-month').value;
    const balanceValue = parseFloat(balanceInput.value);

    if (!month) {
      showStatus('Please select a month', 'error');
      return;
    }
    if (isNaN(balanceValue)) {
      showStatus('Please enter a valid dollar amount', 'error');
      return;
    }

    try {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/investment-trending`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accountId,
            balance_at_date: balanceValue,
            month: month,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        showStatus(data.error || 'Failed to create trending transaction', 'error');
        return;
      }

      closeModal();

      if (data.created_transaction) {
        const newTxn = data.created_transaction;
        newTxn.account_id = accountId;
        newTxn.iso_currency_code = 'USD';
        newTxn.status = 'cleared';
        newTxn.user_category = 'System: Investment Performance';
        newTxn.date = newTxn.transaction_date;
        transactions.unshift(newTxn);
      }

      if (data.next_month_transaction) {
        const nextId = data.next_month_transaction.transaction_id;
        _patchCachedTransactions([nextId], data.next_month_transaction);
      }

      _cacheTransactions(transactions);

      _expandDateFiltersForTransaction(
        data.created_transaction?.transaction_date
      );

      showStatus('Trending transaction created', 'success');

      if (selectedAccountMode === 'single' && selectedAccountId) {
        await fetchBalanceHistory(selectedAccountId);
      }
      renderTransactionTable();
    } catch (networkError) {
      showStatus(`Failed to create trending: ${networkError.message}`, 'error');
    }
  };

  document.getElementById('add-trending-save').onclick = saveTrending;
  balanceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveTrending();
    if (event.key === 'Escape') closeModal();
  });
}

async function _updateAccountField(accountId, fields, successMessage) {
  try {
    showStatus('Updating account…', 'info');
    const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update account');
    }
    showStatus(successMessage, 'success');
    setTimeout(() => clearStatus(), 2000);
    await loadAccounts(true);
    renderTransactionTable();
  } catch (error) {
    console.error('_updateAccountField error:', error);
    showStatus(`Failed: ${error.message}`, 'error');
  }
}

// ─── Hidden accounts toggle ─────────────────────────────────

function _toggleHiddenAccountsView() {
  _showHiddenAccounts = !_showHiddenAccounts;
  renderAccountsSidebar();
}

function getSelectedAccounts() {
  if (selectedAccountMode === 'all') {
    // Return all account IDs — every account in the sidebar is usable.
    // Dormant accounts operate as manual and are included.
    return accounts.map(a => a.account_id);
  } else if (selectedAccountMode === 'single' && selectedAccountId) {
    // Return single selected account
    return [selectedAccountId];
  }
  return [];
}

async function promptRename(accountId, currentCustomName) {
  const newName = prompt('Enter a custom name for this account (leave empty to reset):', currentCustomName);
  
  if (newName === null) return; // User cancelled
  
  try {
    showStatus('Updating account name...', 'info');
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        custom_name: newName.trim() || null
      })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to rename account');
    }
    
    showStatus('Account renamed successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
    // Refresh accounts list
    await loadAccounts(true);

    // Propagate updated display name into in-memory transactions so the
    // table reflects the rename without a full re-fetch from the server.
    const renamedAccount = accounts.find(a => a.account_id === accountId);
    if (renamedAccount) {
      const updatedDisplayName = _buildAccountDisplayName(renamedAccount);
      transactions.forEach(txn => {
        if (txn.account_id === accountId) {
          txn.bank_account = updatedDisplayName;
        }
      });
    }
    renderTransactionTable();
    
  } catch (error) {
    console.error('Rename error:', error);
    showStatus(`Failed to rename account: ${error.message}`, 'error');
  }
}
