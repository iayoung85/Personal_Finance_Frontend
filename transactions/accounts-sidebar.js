// ============================================================
// transactions/accounts-sidebar.js — Account Sidebar Management
// Loading accounts, rendering the sidebar, selection state,
// activation, renaming, and manual account creation.
// ============================================================

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
      available_products: a.available_products || []
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

function renderAccountsSidebar() {
  const container = document.getElementById('accounts-list');
  
  if (accounts.length === 0) {
    container.innerHTML = '<p style="padding: 10px; color: #999;">No accounts found</p>';
    return;
  }

  // Compute total balance across all accounts
  const totalBalance = accounts.reduce((sum, acc) => sum + (acc.current_balance || 0), 0);
  const totalBalanceStr = new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD' 
  }).format(totalBalance);

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

  let html = '';

  // ===== ALL ACCOUNTS ITEM =====
  const allAccountsClass = selectedAccountMode === 'all' ? 'selected' : '';
  html += `
    <div class="sidebar-all-accounts ${allAccountsClass}" onclick="selectAllAccountsMode()">
      <div style="font-weight: 600; margin-bottom: 4px;">⊕ All Accounts</div>
      <div style="font-size: 12px; color: #2e7d32; font-weight: 500;">Total: ${totalBalanceStr}</div>
    </div>
  `;

  // ===== ACTIVE ACCOUNTS (grouped by category) =====
  categoryOrder.forEach(cat => {
    if (grouped.active[cat] && grouped.active[cat].length > 0) {
      html += `<div class="sidebar-account-group">`;
      html += `<div class="sidebar-group-title">${categoryLabels[cat] || cat}</div>`;

      grouped.active[cat].forEach(acc => {
        const displayName = _buildAccountDisplayName(acc);
        const currentBalance = acc.current_balance || 0;
        const balanceStr = new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'USD' 
        }).format(currentBalance);
        const balanceColorClass = currentBalance < 0 ? 'sidebar-account-balance-negative' : 'sidebar-account-balance';

        const isSelected = selectedAccountMode === 'single' && selectedAccountId === acc.account_id;
        const selectedClass = isSelected ? 'selected' : '';

        html += `
          <div class="sidebar-account-item ${selectedClass}" onclick="selectAccount('${acc.account_id}')">
            <div class="sidebar-account-label">
              <span title="${displayName}">${displayName}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="${balanceColorClass}">${balanceStr}</div>
              <button class="secondary" style="padding: 2px 6px; font-size: 10px;" 
                      onclick="event.stopPropagation(); promptRename('${acc.account_id}', '${(acc.custom_name || '').replace(/'/g, "\\'")}')">
                Rename
              </button>
            </div>
          </div>
        `;
      });

      html += '</div>';
    }
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

  // ===== CREATE MANUAL ACCOUNT BUTTON =====
  html += `
    <button class="sidebar-create-btn" onclick="openCreateManualAccountModal()">
      + Create Manual Account
    </button>
  `;

  container.innerHTML = html;
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

// ===== Manual Account Creation =====

function openCreateManualAccountModal() {
  const modal = document.getElementById('create-manual-account-modal');
  modal.classList.remove('hidden');
  document.getElementById('manual-account-name').focus();
}

function closeCreateManualAccountModal() {
  const modal = document.getElementById('create-manual-account-modal');
  modal.classList.add('hidden');
  // Clear form
  document.getElementById('manual-bank-name').value = '';
  document.getElementById('manual-account-name').value = '';
  document.getElementById('manual-account-category').value = '';
  document.getElementById('manual-account-balance').value = '';
  document.getElementById('manual-account-error').textContent = '';
  document.getElementById('manual-account-error').style.display = 'none';
}

async function submitCreateManualAccount() {
  const bankName = document.getElementById('manual-bank-name').value.trim();
  const name = document.getElementById('manual-account-name').value.trim();
  const category = document.getElementById('manual-account-category').value;
  const balance = parseFloat(document.getElementById('manual-account-balance').value);
  const errorDiv = document.getElementById('manual-account-error');

  // Validation
  if (!bankName) {
    errorDiv.textContent = 'Bank name is required';
    errorDiv.style.display = 'block';
    return;
  }

  if (!name) {
    errorDiv.textContent = 'Account name is required';
    errorDiv.style.display = 'block';
    return;
  }

  if (!category) {
    errorDiv.textContent = 'Please select an account category';
    errorDiv.style.display = 'block';
    return;
  }

  if (isNaN(balance)) {
    errorDiv.textContent = 'Starting balance must be a valid number';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    showStatus('Creating manual account...', 'info');

    const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bank_name: bankName,
        account_name: name,
        account_category: category,
        opening_balance: balance
      })
    });

    const data = await response.json();

    if (!response.ok) {
      errorDiv.textContent = data.error || 'Failed to create account';
      errorDiv.style.display = 'block';
      return;
    }

    closeCreateManualAccountModal();
    showStatus(`Account "${name}" created successfully`, 'success');

    // Reload accounts to show new account in sidebar
    await loadAccounts();
    selectAllAccounts();

    setTimeout(() => clearStatus(), 2000);

  } catch (error) {
    errorDiv.textContent = `Error: ${error.message}`;
    errorDiv.style.display = 'block';
  }
}
