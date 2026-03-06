// ============================================================
// transactions/accounts-sidebar.js — Account Sidebar Management
// Loading accounts, rendering the sidebar, selection state,
// activation, renaming, and manual account creation.
// ============================================================

let _pendingSidebarFocusAccountId = null;
const _ALL_ACCOUNTS_NAV_ID = '__all_accounts__';

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

  // Compute total balance across all accounts
  const totalBalance = sumAccountBalances(accounts);
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
    inactive: [] // Plaid items without transactions product billed
  };

  accounts.forEach(acc => {
    // Check if this account's Plaid item (if Plaid) has transactions billed
    // Why connection_status not origin: a converted plaid account (origin='plaid',
    // connection_status='converted') operates as manual and should be active.
    // Only actively-Plaid-linked accounts need billed_products check.
    const isActive = acc.connection_status !== 'linked' || acc.billed_products.includes('transactions');
    
    if (isActive) {
      const cat = acc.account_category || 'asset';
      if (!grouped.active[cat]) {
        grouped.active[cat] = [];
      }
      grouped.active[cat].push(acc);
    } else {
      // Separate inactive Plaid items
      grouped.inactive.push(acc);
    }
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
      id: 'property-debt',
      label: 'Property/Debt Net:',
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
        const displayName = _buildAccountDisplayName(acc);
        // Split trailing mask suffix e.g. "(9002)" so it never gets ellipsis-clipped.
        // \d{3,6} — only match real account number masks (3-6 digits), not words like "(old)"
        const maskMatch = displayName.match(/^(.*?)(\s*\(\d{3,6}\))$/);
        const displayNameMain = maskMatch ? maskMatch[1] : displayName;
        const displayNameSuffix = maskMatch ? maskMatch[2] : '';
        const currentBalance = acc.current_balance || 0;
        const balanceStr = formatSidebarCurrency(currentBalance);
        const balanceColorClass = currentBalance < 0 ? 'sidebar-account-balance-negative' : 'sidebar-account-balance';

        const isSelected = selectedAccountMode === 'single' && selectedAccountId === acc.account_id;
        const selectedClass = isSelected ? 'selected' : '';

        html += `
          <div class="sidebar-account-item ${selectedClass}" tabindex="0" data-account-id="${acc.account_id}" onclick="selectAccount('${acc.account_id}')">
            <button class="secondary" title="Rename account"
                    style="padding: 0 5px; font-size: 12px; align-self: stretch; min-width: unset; flex-shrink: 0; border-radius: 2px 0 0 2px; margin-left: -1px;"
                    onclick="event.stopPropagation(); promptRename('${acc.account_id}', '${(acc.custom_name || '').replace(/'/g, "\\'")}')">
              ✏
            </button>
            <div class="sidebar-account-label">
              <span class="sidebar-account-name-text" title="${displayName}">${displayNameMain}</span><span class="sidebar-account-mask">${displayNameSuffix}</span>
            </div>
            <div class="${balanceColorClass}">${balanceStr}</div>
          </div>
        `;
      });

      html += '</div>';
    }
  };

  // ===== ACTIVE ACCOUNTS (grouped by category) =====
  categoryOrder.forEach(cat => {
    renderCategoryBlock(cat);
  });

  // ===== INACTIVE PLAID ITEMS =====
  if (grouped.inactive.length > 0) {
    html += `<div class="sidebar-inactive-section">`;
    html += `<div class="sidebar-inactive-title">⚠️ Needs Activation</div>`;

    // Group inactive accounts by institution
    const inactiveByInstitution = {};
    grouped.inactive.forEach(acc => {
      const inst = acc.institution_name || 'Unknown';
      if (!inactiveByInstitution[inst]) {
        inactiveByInstitution[inst] = [];
      }
      inactiveByInstitution[inst].push(acc);
    });

    Object.entries(inactiveByInstitution).forEach(([inst, accs]) => {
      const itemId = accs[0].plaid_item_id;
      html += `
        <div class="sidebar-activate-section">
          <div style="font-weight: 500; margin-bottom: 6px;">• ${inst}</div>
          <button class="activate-btn" onclick="activateBank('${itemId}')">Activate & Sync</button>
        </div>
      `;
    });

    html += '</div>';
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

async function activateBank(itemId) {
    if (!confirm('Activating transactions for this bank may incur additional fees. Do you want to proceed?')) {
        return;
    }

    // Invalidate cached item_info so subsequent UI reads the freshest product state
    try { invalidateItemInfoCache(itemId); } catch (e) {}

    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Activating...';

    try {
        const itemAccounts = accounts.filter(a => a.plaid_item_id === itemId);
        if (itemAccounts.length === 0) {
            throw new Error('No accounts found for this bank.');
        }
        const accountIds = itemAccounts.map(a => a.account_id);

        // Use last 30 days for activation
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const activationResult = await performSync(accountIds, formatDate(start), formatDate(end), true);
        
        // Refresh accounts to update status (force network)
        await loadAccounts(true);
        
        // If items were activated, inform user that background sync is in progress
        if (activationResult.activated && activationResult.activated.length > 0) {
            showStatus('Activation complete! Transactions will be synced automatically in the background.', 'success');
        } else {
            showStatus('Activated successfully. Fetching transactions...', 'success');
        }

    } catch (error) {
        alert('Activation failed: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function getSelectedAccounts() {
  if (selectedAccountMode === 'all') {
    // Return all account IDs (active only - Plaid items with transactions billed)
    return accounts
      .filter(a => a.connection_status !== 'linked' || a.billed_products.includes('transactions'))
      .map(a => a.account_id);
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
