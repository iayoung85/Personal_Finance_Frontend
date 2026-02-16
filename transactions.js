// BACKEND_URL is now defined in config.js and auto-detects environment

let accounts = [];
let transactions = [];
let synced = false;
let availableCategories = [];
let plaidTaxonomy = []; // Plaid PFCv2 category taxonomy for parsing
let syncing = false;

// Category filter state
let filterPrimaryCategory = '';
let filterDetailedCategory = '';

// Check authentication
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let idleTimeout;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

if (!token) {
  alert('Please log in first');
  window.location.href = 'index.html';
}

async function refreshAccessToken() {
  if (!refreshToken) {
    return false;
  }
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    
    if (response.ok) {
      const data = await response.json();
      token = data.access_token;
      localStorage.setItem('authToken', token);
      resetIdleTimeout();
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    return false;
  }
}

async function authenticatedFetch(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };
  
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    }
    alert('Session expired. Please log in again.');
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
  }
  
  return response;
}

function resetIdleTimeout() {
  // Clear existing timeout
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  
  // Only set idle timeout if user is logged in
  if (token && currentUser) {
    idleTimeout = setTimeout(() => {
      logout();
      alert('You have been logged out due to inactivity for security reasons.');
    }, IDLE_TIMEOUT);
  }
}

function setupActivityListeners() {
  // List of events that indicate user activity
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  
  events.forEach(event => {
    document.addEventListener(event, resetIdleTimeout, true);
  });
}



function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  // Clear data caches on logout for security
  localStorage.removeItem('pf_cached_transactions');
  localStorage.removeItem('pf_transactions_cached_at');
  localStorage.removeItem('pf_cached_categories');
  localStorage.removeItem('pf_cached_taxonomy');
  localStorage.removeItem('pf_categories_cached_at');
  token = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// Initialize
$(document).ready(async function() {
  await window.BACKEND_URL_PROMISE;
  setDefaultDates();
  resetIdleTimeout();
  setupActivityListeners();

  // Load accounts and settings in parallel; keep checkboxes unchecked until both complete
  await Promise.all([loadAccounts(), loadSettings()]);

  // After everything is ready, select only enabled accounts/banks
  selectAllAccounts();

  // Sync transactions with Plaid on page load (after accounts are loaded/selected)
  await autoSyncAndLoadTransactions();

  // Render dynamic period buttons after transactions are loaded
  renderDynamicPeriodButtons();

  // Load available categories for manual categorization dropdown
  await loadAvailableCategories();
  populateCategoryFilterDropdowns();
  renderTransactionTable();

  // Add event listener for optional fields
  $(document).on('change', '.field-checkbox', function() {
    renderTransactionTable();
  });

  // Add event listener for memo save buttons
  $(document).on('click', '.memo-save', function() {
    const button = $(this);
    const txnId = button.data('txn-id');
    const input = button.closest('td').find('.memo-input');
    const memoValue = input.val();
    saveTransactionMemo(txnId, memoValue, button);
  });

  // Add Tab handler for memo input to move to next transaction's category
  $(document).on('keydown', '.memo-input', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const currentRow = $(this).closest('tr');
      const nextRow = currentRow.next('tr');
      if (nextRow.length) {
        const nextCategoryInput = nextRow.find('.category-autocomplete');
        if (nextCategoryInput.length) {
          nextCategoryInput.focus();
        }
      }
    } else if (e.key === 'Enter') {
      // Enter key to save memo
      e.preventDefault();
      const button = $(this).closest('td').find('.memo-save');
      if (button.length) {
        button.click();
      }
    }
  });

  
  // Add event listener for date range changes - re-render when user changes dates
  $(document).on('input change', '#start-date, #end-date', function() {
    renderTransactionTable();
  });
  
  // Add event listener for account selection changes - re-render when user changes account selection
  $(document).on('change', '.account-checkbox', function() {
    renderTransactionTable();
  });

  // Add event listener for hiding transfers
  $(document).on('change', '#hide-transfers', function() {
    renderTransactionTable();
  });

  // Add event listener for showing overrides only
  $(document).on('change', '#show-overrides-only', function() {
    renderTransactionTable();
  });

  // Manual categorize handler
  $(document).on('click', '.manual-category-save', function() {
    const txnId = $(this).data('txn-id');
    const select = $(`.manual-category-select[data-txn-id="${txnId}"]`);
    const selectedCategory = select.val();
    const accountId = select.data('account-id');
    const txn = transactions.find(t => (t.transaction_id || t.plaid_transaction_id) === txnId);
    if (!txnId || !accountId) {
      showStatus('Unable to categorize: missing transaction or account id', 'error');
      return;
    }
    openCategorizeModal(txn, selectedCategory, accountId, txnId);
  });

  // Add event listener for start date validation
  $('#start-date').on('blur', function() {
    if (!this.value) return;
    
    // Parse input as local date to avoid UTC issues
    const parts = this.value.split('-');
    const startDate = new Date(parts[0], parts[1] - 1, parts[2]);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const limitDate = new Date(today);
    limitDate.setDate(today.getDate() - 90);
    
    if (startDate < limitDate) {
      // Format limitDate as YYYY-MM-DD in local time
      const year = limitDate.getFullYear();
      const month = String(limitDate.getMonth() + 1).padStart(2, '0');
      const day = String(limitDate.getDate()).padStart(2, '0');
      
      // Format for display (MM/DD/YYYY)
      const displayDate = `${month}/${day}/${year}`;
      
      this.value = `${year}-${month}-${day}`;
      
      // Highlight input
      $(this).css('border', '2px solid #ffc107');
      $(this).css('background-color', '#fff3cd');
      
      // Show warning status
      showStatus(`${displayDate} is the earliest valid start date`, 'warning');
      
      // Remove highlight after 3 seconds
      setTimeout(() => {
        $(this).css('border', '');
        $(this).css('background-color', '');
      }, 3000);
    }
  });
});

function setDefaultDates() {
  const end = new Date();
  const start = new Date();
  let today = new Date();
  if (today.getDate() === 1) {
    // If today is first of month, set start date to first of previous month instead of first of current month
    start.setMonth(start.getMonth() - 1);
  }
  else {
    start.setDate(1); // Default to first of the month
  }
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
}

function setEarliestToDate() {
  const end = new Date();
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // Find the earliest transaction date from synced data
  let earliestDate = null;
  if (transactions && transactions.length > 0) {
    earliestDate = transactions.reduce((earliest, txn) => {
      if (!earliest || txn.date < earliest) {
        return txn.date;
      }
      return earliest;
    }, null);
  }
  
  // If we found an earliest date, use it; otherwise fall back to 90 days ago
  let start;
  if (earliestDate) {
    start = new Date(earliestDate);
  } else {
    start = new Date();
    start.setDate(start.getDate() - 90);
  }
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function setMonthToDate() {
  const end = new Date();
  const start = new Date();
  start.setDate(1); // First of the current month
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function setLastMonth() {
  const now = new Date();
  // Get first day of previous month
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // Get last day of previous month (day 0 of current month)
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function toggleConfig() {
  const content = document.getElementById('config-content');
  const icon = document.getElementById('toggle-icon');
  content.classList.toggle('open');
  icon.textContent = content.classList.contains('open') ? '▲' : '▼';
}

async function refreshAccounts() {
  try {
    showStatus('Syncing accounts from Plaid...', 'info');
    const response = await fetch(`${BACKEND_URL}/api/connections/accounts`, {
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
  // Select all account checkboxes that are not disabled
  document.querySelectorAll('.account-checkbox:not(:disabled)').forEach(checkbox => {
    checkbox.checked = true;
  });
  // Also check bank checkboxes if all their children are checked (simplified: just check all enabled bank checkboxes)
  document.querySelectorAll('.bank-checkbox:not(:disabled)').forEach(checkbox => {
    checkbox.checked = true;
  });
  renderTransactionTable();
}

function deselectAllAccounts() {
  // Deselect all account checkboxes
  document.querySelectorAll('.account-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  // Deselect all bank checkboxes
  document.querySelectorAll('.bank-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  renderTransactionTable();
}

async function loadAccounts() {
  try {
    showStatus('Loading accounts...', 'info');
    
    // Use new endpoint that gets all accounts including disconnected ones
    const url = `${BACKEND_URL}/api/transactions/accounts/all?t=${Date.now()}`;
    const response = await authenticatedFetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache'
    });
    
    const data = await response.json();
    
    if (data.error) {
      showStatus(`Error: ${data.error}`, 'error');
      return;
    }
    
    accounts = data.accounts || [];
    // Filter out investment accounts as they are not supported
    accounts = accounts.filter(acc => acc.account_type !== 'investment');
    
    renderAccountSelector();
    
    showStatus('Accounts loaded successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    console.error('loadAccounts error:', error);
    showStatus(`Failed to load accounts: ${error.message}`, 'error');
  }
}

function renderAccountSelector() {
  const container = document.getElementById('account-selector');
  
  if (accounts.length === 0) {
    container.innerHTML = '<p>No accounts found. Please connect a bank first.</p>';
    return;
  }
  
  // Group by institution
  const grouped = {};
  accounts.forEach(acc => {
    const institutionKey = acc.institution_name;
    if (!grouped[institutionKey]) {
      grouped[institutionKey] = {
        name: acc.institution_name,
        plaid_item_id: acc.plaid_item_id,
        billed_products: acc.billed_products || [],
        accounts: []
      };
    }
    grouped[institutionKey].accounts.push(acc);
  });
  
  let html = '';
  Object.keys(grouped).forEach(key => {
    const group = grouped[key];
    const isBilled = group.billed_products.includes('transactions');
    
    let headerAction = '';
    if (!isBilled) {
        headerAction = `<button class="activate-btn" style="margin-left: 10px;" onclick="activateBank('${group.plaid_item_id}')">Activate & Sync</button>`;
    }

    html += `
      <div class="account-group">
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <label style="display: flex; align-items: center;">
            <input type="checkbox" class="bank-checkbox" data-bank="${key}" 
                    onchange="toggleBank('${key}')" ${!isBilled ? 'disabled' : ''}>
            <strong style="margin-left: 5px;">${group.name}</strong>
            </label>
            ${!isBilled ? '<span class="status-badge status-inactive">Available (Not Active)</span>' : '<span class="status-badge status-active">Active</span>'}
            ${headerAction}
        </div>
    `;
    
    group.accounts.forEach(acc => {
      const displayName = acc.custom_name || `${acc.account_name} (${acc.account_subtype || acc.account_type})${acc.mask ? ' ...' + acc.mask : ''}`;
      
      html += `
        <div class="account-item">
          <div style="display: flex; align-items: center;">
            <button class="secondary" style="padding: 2px 6px; font-size: 10px; margin-right: 8px;" 
                    onclick="promptRename('${acc.plaid_account_id}', '${(acc.custom_name || '').replace(/'/g, "\\'")}')">
              Rename
            </button>
            <label style="flex-grow: 1;">
              <input type="checkbox" class="account-checkbox" 
                     data-bank="${key}"
                     data-account-id="${acc.plaid_account_id}"
                     ${!isBilled ? 'disabled' : ''}>
              ${displayName}
            </label>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  });
  
  container.innerHTML = html;
}

async function activateBank(itemId) {
    if (!confirm('Activating transactions for this bank may incur additional fees. Do you want to proceed?')) {
        return;
    }

    const btn = $(`button[onclick="activateBank('${itemId}')"]`);
    const originalText = btn.text();
    btn.prop('disabled', true).text('Activating...');

    try {
        const itemAccounts = accounts.filter(a => a.plaid_item_id === itemId);
        if (itemAccounts.length === 0) {
            throw new Error('No accounts found for this bank.');
        }
        const accountIds = itemAccounts.map(a => a.plaid_account_id);

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

        await performSync(accountIds, formatDate(start), formatDate(end), true);
        
        // Refresh accounts to update status (force network)
        await loadAccounts(true);
        showStatus('Activated successfully', 'success');

    } catch (error) {
        alert('Activation failed: ' + error.message);
    } finally {
        btn.prop('disabled', false).text(originalText);
    }
}

function toggleBank(institution) {
  const bankCheckbox = $(`.bank-checkbox[data-bank="${institution}"]`);
  // Only toggle enabled account checkboxes
  const accountCheckboxes = $(`.account-checkbox[data-bank="${institution}"]:not(:disabled)`);
  accountCheckboxes.prop('checked', bankCheckbox.prop('checked'));
  renderTransactionTable();
}

async function performSync(accountIds, startDate, endDate, activate = false, force = false) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/sync_transactions`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: startDate,
      end_date: endDate,
      account_ids: accountIds,
      activate: activate,
      force: force
    })
  });
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error);
  }
  
  return data;
}

async function syncTransactions() {
  // This function is called when user manually clicks a sync button
  // Force network + force past cooldown for explicit user action
  await autoSyncAndLoadTransactions(true);
}

async function autoSyncAndLoadTransactions(forceNetwork = false) {
  // This function runs on page load and handles sync + fetch automatically
  const selectedAccounts = getSelectedAccounts();
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  
  if (!startDate || !endDate) {
    showStatus('Please select a date range', 'error');
    return;
  }
  
  if (selectedAccounts.length === 0) {
    showStatus('Please select at least one account', 'error');
    return;
  }
  
  // ============= CACHE-FIRST STRATEGY =============
  // 1. Show cached transactions immediately if available (instant UI)
  // 2. Sync with Plaid in background (may be skipped by backend cooldown)
  // 3. Only re-fetch from server if Plaid returned actual changes
  
  const CACHE_KEY = 'pf_cached_transactions';
  const CACHE_TS_KEY = 'pf_transactions_cached_at';
  const CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
  
  const cachedData = localStorage.getItem(CACHE_KEY);
  const cachedAt = localStorage.getItem(CACHE_TS_KEY);
  const cacheAge = cachedAt ? (Date.now() - parseInt(cachedAt)) : Infinity;
  const cacheValid = cachedData && cacheAge < CACHE_MAX_AGE_MS;
  
  // Show cached data immediately for instant page load
  if (cacheValid && !forceNetwork) {
    try {
      transactions = JSON.parse(cachedData);
      renderTransactionTable();
      renderDynamicPeriodButtons();
      showStatus(`Loaded ${transactions.length} transactions from cache. Checking for updates...`, 'info');
    } catch (e) {
      console.error('Cache parse error, will fetch from server:', e);
    }
  }
  
  try {
    if (!forceNetwork && cacheValid) {
      showStatus('Checking for new transactions...', 'info');
    } else {
      showStatus('Syncing transactions from Plaid...', 'info');
    }
    
    const syncData = await performSync(selectedAccounts, startDate, endDate, false, forceNetwork);
    synced = true;
    
    // If Plaid returned no changes AND we have valid cache, skip the full re-fetch
    if (syncData.no_changes && cacheValid && !forceNetwork) {
      const cooldownMsg = syncData.cooldown 
        ? ` (next sync available in ${syncData.seconds_until_next_sync}s)`
        : '';
      showStatus(`Transactions are up to date — ${transactions.length} loaded${cooldownMsg}`, 'success');
      setTimeout(() => clearStatus(), 3000);
      return;
    }
    
    let successMsg = `Synced ${syncData.synced_count || 0} transactions (${syncData.new_count || 0} new, ${syncData.updated_count || 0} updated)`;
    showStatus(successMsg, 'info');
    
    // Plaid had changes (or no cache) — fetch fresh from server
    await fetchAllTransactions(true);
    
  } catch (error) {
    showStatus(`Sync failed: ${error.message}`, 'error');
    // If sync failed but we don't have cache, try fetching from DB anyway
    if (!cacheValid) {
      await fetchAllTransactions(false);
    }
  }
}

async function fetchAllTransactions(forceNetwork = false) {
  // Fetch all transactions for the user (backend returns all, frontend filters)
  const CACHE_KEY = 'pf_cached_transactions';
  const CACHE_TS_KEY = 'pf_transactions_cached_at';
  
  try {
    showStatus('Loading all transactions...', 'info');
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transactions`, {
      method: 'GET',
      mode: 'cors'
    });
    
    const data = await response.json();
    
    if (data.error) {
      showStatus(`Error: ${data.error}`, 'error');
      return;
    }
    
    transactions = data.transactions || [];
    
    // Cache transactions in localStorage for instant page loads
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(transactions));
      localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
    } catch (cacheErr) {
      console.warn('Could not cache transactions to localStorage:', cacheErr);
      // localStorage might be full — not fatal
    }
    
    renderTransactionTable();
    renderDynamicPeriodButtons(); // Update period buttons when transactions change
    showStatus(`Loaded ${transactions.length} total transactions (filters applied on frontend)`, 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    showStatus(`Load failed: ${error.message}`, 'error');
  }
}

function renderTransactionTable() {
  const container = document.getElementById('table-container');
  
  if (transactions.length === 0) {
    container.innerHTML = '<div class="empty-state">No transactions found. Sync transactions first.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    renderInsightsPanel(); // Still render empty insights
    return;
  }

  // Get all filter criteria from UI
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingCheckbox = document.querySelector('.field-checkbox[value="pending"]:checked');
  const hideTransfers = document.getElementById('hide-transfers').checked;
  
  // Get selected optional fields
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });
  
  // Apply all filters to transactions array
  const filteredTransactions = transactions.filter(txn => {
    // Filter by date range
    if (txn.date < startDate || txn.date > endDate) {
      return false;
    }
    
    // Filter by selected accounts
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.plaid_account_id)) {
      return false;
    }
    
    // Filter pending transactions - only show if pending checkbox is checked
    if (txn.pending && !showPendingCheckbox) {
      return false;
    }

    // Hide transfers if requested (checks personal finance primary category)
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) {
        return false;
      }
    }

    // Filter by overrides only if requested
    const showOverridesOnly = document.getElementById('show-overrides-only').checked;
    if (showOverridesOnly && !txn.is_override) {
      return false;
    }
    
    // Filter by category (primary and/or detailed)
    if (filterPrimaryCategory || filterDetailedCategory) {
      const parsed = parseCategoryString(txn.user_category || '');
      
      // If primary filter is set, check if it matches
      if (filterPrimaryCategory && parsed.primary !== filterPrimaryCategory) {
        return false;
      }
      
      // If detailed filter is set, check if it matches
      if (filterDetailedCategory && parsed.detailed !== filterDetailedCategory) {
        return false;
      }
    }
    
    return true;
  });
  
  if (filteredTransactions.length === 0) {
    container.innerHTML = '<div class="empty-state">No transactions found for the selected criteria.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    renderCategoryChart(); // Clear chart when no data
    renderInsightsPanel(); // Still render empty insights
    return;
  }
  
  let html = '<table><thead><tr>';
  html += '<th>Date</th>';
  html += '<th>Bank/Account</th>';
  html += '<th>Description</th>';
  html += '<th>Amount</th>';
  html += '<th>Category</th>';
  
  // Add optional headers
  if (optionalFields.includes('merchant_name')) html += '<th>Merchant</th>';
  if (optionalFields.includes('payment_channel')) html += '<th>Channel</th>';
  if (optionalFields.includes('pending')) html += '<th>Pending</th>';
  if (optionalFields.includes('check_number')) html += '<th>Check #</th>';
  if (optionalFields.includes('original_description')) html += '<th>Original Desc</th>';
  if (optionalFields.includes('authorized_date')) html += '<th>Auth Date</th>';
  if (optionalFields.includes('authorized_datetime')) html += '<th>Auth Time</th>';
  if (optionalFields.includes('personal_finance_category')) html += '<th>Plaid Category</th>';
  if (optionalFields.includes('user_memo')) html += '<th>Memo</th>';

  html += '</tr></thead><tbody>';
  
  filteredTransactions.forEach(txn => {
    // Parse the date string properly
    const dateObj = new Date(txn.date);
    // Format as MM/DD/YYYY using UTC to prevent timezone shifts
    const dateStr = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC'
    });
    
    const amount = new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: txn.iso_currency_code || 'USD' 
    }).format(txn.amount);
    
    html += '<tr>';
    html += `<td>${dateStr}</td>`;
    html += `<td>${txn.bank_account}</td>`;
    html += `<td>${txn.name || ''}</td>`;
    html += `<td>${amount}</td>`;

    // Category Primary and Detailed columns (always visible)
    const txnId = txn.transaction_id || txn.plaid_transaction_id || '';
    const accountId = txn.plaid_account_id || '';
    
    // Parse current user_category to get primary and detailed
    let currentParsed = { primary: '', detailed: '' };
    if (txn.user_category) {
      currentParsed = parseCategoryString(txn.user_category);
    } else if (txn.personal_finance_category) {
      // Fallback to Plaid's personal_finance_category if no user_category
      const pfc = txn.personal_finance_category;
      const displayNames = getCategoryDisplayNames(pfc);
      currentParsed = {
        primary: displayNames.primary,
        detailed: displayNames.trimmed
      };
    }

    // Build the current full category string for the autocomplete
    const currentFullCategory = buildCategoryString(currentParsed.primary, currentParsed.detailed);

    // Create combined category cell with autocomplete input + buttons
    const overrideBadge = txn.is_override
      ? `<span class="override-badge" title="This transaction has a manual override — rules will not change its category">Override <button class='clear-override' data-txn-id='${txnId}' onclick='clearOverride(event)'>X</button></span>`
      : '';
    const categoryCell = txnId ? `
      <div class="category-cell">
        <div class="category-display">${overrideBadge}${escapeHtml(currentFullCategory || 'Uncategorized')}</div>
        <div class="category-autocomplete-wrap" data-txn-id="${txnId}">
          <input type="text" class="category-autocomplete" data-txn-id="${txnId}" data-account-id="${accountId}"
                 value="${escapeHtml(currentFullCategory)}" placeholder="Type to search categories…"
                 autocomplete="off" spellcheck="false">
          <div class="category-ac-list" data-txn-id="${txnId}"></div>
        </div>
        <div class="category-buttons">
          <button class="secondary category-override" data-txn-id="${txnId}" data-account-id="${accountId}">Override</button>
          <button class="secondary category-rule" data-txn-id="${txnId}" data-account-id="${accountId}">Rule</button>
        </div>
      </div>
    ` : '<span class="pill">N/A</span>';
    html += `<td>${categoryCell}</td>`;

    // Add optional cells
    if (optionalFields.includes('merchant_name')) html += `<td>${txn.merchant_name || ''}</td>`;
    if (optionalFields.includes('payment_channel')) html += `<td>${txn.payment_channel || ''}</td>`;
    if (optionalFields.includes('pending')) html += `<td>${txn.pending ? 'Yes' : 'No'}</td>`;
    if (optionalFields.includes('check_number')) html += `<td>${txn.check_number || ''}</td>`;
    if (optionalFields.includes('original_description')) html += `<td>${txn.original_description || ''}</td>`;
    if (optionalFields.includes('authorized_date')) html += `<td>${txn.authorized_date || ''}</td>`;
    if (optionalFields.includes('authorized_datetime')) {
        let authTime = '';
        if (txn.authorized_datetime) {
            const dt = new Date(txn.authorized_datetime);
            authTime = dt.toLocaleString('en-US', {
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
        }
        html += `<td>${authTime}</td>`;
    }
    if (optionalFields.includes('personal_finance_category')) {
        let plaidCategoryDisplay = '';
        if (txn.personal_finance_category) {
            const pfc = txn.personal_finance_category;
            const primary = pfc.primary || '';
            const detailed = pfc.detailed || '';
            const trimmed = trimCategoryPrefix(detailed, primary);
            const displayPrimary = formatCategoryDisplay(primary);
            const displayDetailed = formatCategoryDisplay(trimmed);
            plaidCategoryDisplay = `${displayPrimary}${displayDetailed ? ': ' + displayDetailed : ''}`;
        }
        html += `<td>${escapeHtml(plaidCategoryDisplay)}</td>`;
    }
    if (optionalFields.includes('user_memo')) {
        const memoValue = txn.user_memo || '';
        const safeMemoValue = escapeHtml(memoValue);
        html += `
          <td>
            <div style="display: flex; gap: 6px; align-items: center;">
              <input class="memo-input" type="text" maxlength="256" value="${safeMemoValue}" style="width: 100%; min-width: 160px;">
              <button class="secondary memo-save" data-txn-id="${txn.plaid_transaction_id || ''}">Save</button>
            </div>
          </td>
        `;
    }

    html += '</tr>';
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
  document.getElementById('export-buttons').classList.remove('hidden');
  
  // Attach event listeners for category dropdowns
  attachCategoryDropdownListeners();
  
  // Update chart visualization
  renderCategoryChart();
  
  // Update insights panel
  renderInsightsPanel();
}

async function saveTransactionMemo(plaidTransactionId, userMemo, buttonEl) {
  if (!plaidTransactionId) {
    showStatus('Unable to save memo: missing transaction id', 'error');
    return;
  }

  const trimmedMemo = (userMemo || '').toString().slice(0, 256);

  if (buttonEl) {
    buttonEl.prop('disabled', true).text('Saving...');
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/add-memo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plaid_transaction_id: plaidTransactionId,
        user_memo: trimmedMemo
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save memo');
    }

    const txn = transactions.find(t => t.plaid_transaction_id === plaidTransactionId);
    if (txn) {
      txn.user_memo = trimmedMemo;
    }

    showStatus('Memo saved successfully', 'success');
  } catch (error) {
    showStatus(`Failed to save memo: ${error.message}`, 'error');
  } finally {
    if (buttonEl) {
      buttonEl.prop('disabled', false).text('Save');
    }
  }
}

/**
 * Build primary category dropdown options from available categories.
 */
function buildPrimaryDropdownOptions(selected = '') {
  const primaries = extractPrimaryCategories(availableCategories);
  
  // Always include "Uncategorized" as an option
  const options = ['Uncategorized', ...primaries];
  
  return options
    .map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
    .join('');
}

/**
 * Build detailed category dropdown options based on selected primary.
 */
function buildDetailedDropdownOptions(selectedPrimary = '', selected = '') {
  if (!selectedPrimary || selectedPrimary === 'Uncategorized') {
    return '<option value="">— No detailed categories —</option>';
  }
  
  const detailed = extractDetailedCategories(availableCategories, selectedPrimary);
  
  if (detailed.length === 0) {
    return '<option value="">— No detailed categories —</option>';
  }
  
  // Auto-select the first detailed category when none is specified,
  // so the user always has a valid "Primary: Detailed" combination.
  const effectiveSelected = selected || detailed[0];
  
  return detailed
    .map(cat => {
      return `<option value="${escapeHtml(cat)}" ${cat === effectiveSelected ? 'selected' : ''}>${escapeHtml(cat)}</option>`;
    })
    .join('');
}

/**
 * Attach event listeners for category dropdown changes.
 */
function attachCategoryDropdownListeners() {
  // Remove any previously-bound delegated handlers to prevent stacking
  $(document).off('input', '.category-autocomplete');
  $(document).off('keydown', '.category-autocomplete');
  $(document).off('focus', '.category-autocomplete');
  $(document).off('blur', '.category-autocomplete');
  $(document).off('click', '.category-ac-item');
  $(document).off('click', '.category-override');
  $(document).off('click', '.category-rule');

  // ===== Autocomplete input handler =====
  $(document).on('input', '.category-autocomplete', function() {
    const input = this;
    const query = input.value;
    const txnId = $(input).data('txn-id');
    _showCategoryAutocomplete(input, query, txnId);
  });

  // Select all text on focus for easy replacement
  $(document).on('focus', '.category-autocomplete', function() {
    this.select();
  });

  // ===== Keyboard navigation: Tab to accept, Escape to close, Arrow keys =====
  $(document).on('keydown', '.category-autocomplete', function(e) {
    const input = this;
    const txnId = $(input).data('txn-id');
    const list = $(`.category-ac-list[data-txn-id="${txnId}"]`);
    const items = list.find('.category-ac-item');
    const activeIndex = items.index(items.filter('.active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(activeIndex + 1, items.length - 1);
      items.removeClass('active');
      $(items[next]).addClass('active');
      items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(activeIndex - 1, 0);
      items.removeClass('active');
      $(items[prev]).addClass('active');
      items[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Tab') {
      // If dropdown is open with suggestions, accept the highlighted (or first) suggestion
      // Otherwise, validate the current input and move to memo if valid
      const active = items.filter('.active').first();
      const first = active.length ? active : items.first();
      
      if (first.length) {
        // Dropdown is open with items, accept the highlighted suggestion
        e.preventDefault();
        input.value = first.data('value');
        list.empty().hide();
      } else {
        // Dropdown is closed or empty, check if current input is valid
        const currentValue = (input.value || '').trim();
        if (currentValue) {
          const resolved = _resolveAutocompleteCategory(currentValue);
          if (!resolved.error) {
            // Valid category found, move focus to memo
            e.preventDefault();
            const memoInput = $(input).closest('tr').find('.memo-input');
            if (memoInput.length) {
              memoInput.focus();
            }
          }
          // If error, allow default Tab behavior (move to next focusable element)
        }
        // If no value, allow default Tab behavior
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = items.filter('.active').first();
      const first = active.length ? active : items.first();
      if (first.length) {
        // If dropdown is open with items, accept the highlighted suggestion
        input.value = first.data('value');
        list.empty().hide();
      } else if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Enter (with dropdown closed) = Open Rule modal
        const ruleBtn = $(input).closest('.category-cell').find('.category-rule');
        if (ruleBtn.length) {
          ruleBtn.click();
        }
      } else {
        // Enter (with dropdown closed) = Apply Override
        const overrideBtn = $(input).closest('.category-cell').find('.category-override');
        if (overrideBtn.length) {
          overrideBtn.click();
        }
      }
    } else if (e.key === 'Escape') {
      list.empty().hide();
    }
  });

  // ===== Click on autocomplete item =====
  $(document).on('mousedown', '.category-ac-item', function(e) {
    // mousedown instead of click so it fires before blur
    e.preventDefault();
    const value = $(this).data('value');
    const txnId = $(this).closest('.category-ac-list').data('txn-id');
    const input = $(`.category-autocomplete[data-txn-id="${txnId}"]`);
    input.val(value);
    $(this).closest('.category-ac-list').empty().hide();
  });

  // ===== Hide list on blur =====
  $(document).on('blur', '.category-autocomplete', function() {
    const txnId = $(this).data('txn-id');
    // Small delay so click-on-item can fire first
    setTimeout(() => {
      $(`.category-ac-list[data-txn-id="${txnId}"]`).empty().hide();
    }, 200);
  });

  // ===== Override button click handler =====
  $(document).on('click', '.category-override', function() {
    const txnId = $(this).data('txn-id');
    const accountId = $(this).data('account-id');
    const input = $(`.category-autocomplete[data-txn-id="${txnId}"]`);
    const fullValue = (input.val() || '').trim();

    // Validate against known categories
    const resolved = _resolveAutocompleteCategory(fullValue);
    if (resolved.error) {
      showStatus(resolved.error, 'warning');
      return;
    }

    const parsed = parseCategoryString(resolved.value);
    applyOverride(txnId, accountId, parsed.primary, parsed.detailed);
  });

  // ===== Rule button click handler =====
  $(document).on('click', '.category-rule', function() {
    const txnId = $(this).data('txn-id');
    const accountId = $(this).data('account-id');
    const input = $(`.category-autocomplete[data-txn-id="${txnId}"]`);
    const fullValue = (input.val() || '').trim();

    const resolved = _resolveAutocompleteCategory(fullValue);
    if (resolved.error) {
      showStatus(resolved.error, 'warning');
      return;
    }

    const parsed = parseCategoryString(resolved.value);
    const txn = transactions.find(t => (t.transaction_id || t.plaid_transaction_id) === txnId);
    openCategoryRuleModal(txn, parsed.primary, parsed.detailed, txnId, accountId);
  });
}

// ===== Autocomplete helper: show filtered list =====
function _showCategoryAutocomplete(input, query, txnId) {
  const list = $(`.category-ac-list[data-txn-id="${txnId}"]`);
  const q = (query || '').toLowerCase().trim();

  if (!q) {
    list.empty().hide();
    return;
  }

  // Smart filtering:
  // - If query contains ':', split and match primary + detailed separately
  // - Otherwise match anywhere in the full string
  let matches;
  if (q.includes(':')) {
    const [qPrimary, qDetailed] = q.split(':').map(s => s.trim());
    matches = (availableCategories || []).filter(cat => {
      const lower = cat.toLowerCase();
      const parts = lower.split(':').map(s => s.trim());
      const primaryMatch = !qPrimary || (parts[0] || '').includes(qPrimary);
      const detailedMatch = !qDetailed || (parts[1] || '').includes(qDetailed);
      return primaryMatch && detailedMatch;
    });
  } else {
    matches = (availableCategories || []).filter(cat =>
      cat.toLowerCase().includes(q)
    );
  }

  // Limit visible results
  const maxShow = 10;
  const shown = matches.slice(0, maxShow);

  if (shown.length === 0) {
    list.html('<div class="category-ac-empty">No matching categories</div>').show();
    return;
  }

  // Build list HTML with highlighted matching text
  const html = shown.map((cat, i) => {
    const highlighted = _highlightMatch(cat, q);
    return `<div class="category-ac-item${i === 0 ? ' active' : ''}" data-value="${escapeHtml(cat)}">${highlighted}</div>`;
  }).join('');

  const extra = matches.length > maxShow
    ? `<div class="category-ac-more">${matches.length - maxShow} more…</div>` : '';

  list.html(html + extra).show();
}

// Highlight matching portions of the category string
function _highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  // Case-insensitive highlight
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<strong>$1</strong>');
}

// Validate that the autocomplete value resolves to a known category
function _resolveAutocompleteCategory(value) {
  if (!value) {
    return { error: 'Please type or select a category' };
  }

  const normalized = normalizeCategoryLabel(value);

  // Exact match (case-insensitive)
  const exact = (availableCategories || []).find(cat =>
    normalizeCategoryLabel(cat) === normalized
  );
  if (exact) return { value: exact };

  // Partial match — if only one category matches, use it
  const partial = (availableCategories || []).filter(cat =>
    normalizeCategoryLabel(cat).includes(normalized)
  );
  if (partial.length === 1) return { value: partial[0] };

  if (partial.length > 1) {
    return { error: `Multiple categories match "${value}". Please select a specific one.` };
  }

  return { error: `"${value}" is not a known category. Please type to search and select from the list.` };
}

/**
 * Apply an override to a single transaction.
 * Combines primary and detailed into "Primary: Detailed" format.
 * Phase 4 implementation.
 */
async function applyOverride(txnId, accountId, selectedPrimary, selectedDetailed) {
  if (!selectedPrimary) {
    showStatus('Please select a primary category', 'warning');
    return;
  }

  // Ensure a detailed category is selected when detailed options exist
  const detailedOptions = extractDetailedCategories(availableCategories, selectedPrimary);
  if (detailedOptions.length > 0 && !selectedDetailed) {
    showStatus('Please select a detailed category', 'warning');
    return;
  }

  const categoryString = buildCategoryString(selectedPrimary, selectedDetailed);
  
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_category: categoryString,
        plaid_account_id: accountId
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      showStatus(data.error || 'Failed to apply override', 'error');
      return;
    }

    showStatus(`Override applied: ${categoryString}. Recategorizing transactions...`, 'success');
    
    // ============= OPTIMIZED: Update local array directly instead of full re-sync =============
    // The backend already updated the encrypted_transactions table directly,
    // so we just need to update our local copy to match.
    const txn = transactions.find(t => (t.transaction_id || t.plaid_transaction_id) === txnId);
    if (txn) {
      txn.user_category = categoryString;
      txn.is_override = true;
      // Update the localStorage cache
      try {
        localStorage.setItem('pf_cached_transactions', JSON.stringify(transactions));
        localStorage.setItem('pf_transactions_cached_at', String(Date.now()));
      } catch (e) { /* cache write failure is non-fatal */ }
    }
    renderTransactionTable();
    
    showStatus(`Override applied: ${categoryString}`, 'success');
    setTimeout(() => clearStatus(), 3000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (e) { /* cache removal failure is non-fatal */ }
  } catch (error) {
    showStatus(`Failed to apply override: ${error.message}`, 'error');
  }
}

/**
 * Clear an override from a transaction.
 */
async function clearOverride(event) {
  const txnId = event.target.getAttribute('data-txn-id');
  
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/override`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    
    if (!response.ok) {
      showStatus(data.error || 'Failed to clear override', 'error');
      return;
    }

    // Update local transaction object
    const txn = transactions.find(t => (t.transaction_id || t.plaid_transaction_id) === txnId);
    if (txn) {
      txn.is_override = false;
      if (data.updated_category) {
        txn.user_category = data.updated_category;
      }
      // Update the localStorage cache
      try {
        localStorage.setItem('pf_cached_transactions', JSON.stringify(transactions));
        localStorage.setItem('pf_transactions_cached_at', String(Date.now()));
      } catch (e) { /* cache write failure is non-fatal */ }
    }

    renderTransactionTable();
    showStatus('Override cleared', 'success');
    setTimeout(() => clearStatus(), 2000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (e) { /* cache removal failure is non-fatal */ }
  } catch (error) {
    showStatus(`Failed to clear override: ${error.message}`, 'error');
  }
}


/**
 * Open modal to create a rule from transaction categorization.
 * Phase 5 implementation — improved UX with transaction preview and
 * labels that match the visible table columns.
 */
function openCategoryRuleModal(txn, selectedPrimary, selectedDetailed, txnId, accountId) {
  if (!selectedPrimary) {
    showStatus('Please select a primary category', 'warning');
    return;
  }

  const resolvedTarget = resolveTargetCategory(selectedPrimary, selectedDetailed);
  if (resolvedTarget.error) {
    showStatus(resolvedTarget.error, 'warning');
    return;
  }

  const categoryString = resolvedTarget.value;

  // --- Transaction field values for preview & smart defaults ---
  const txnDescription = txn?.name || '';
  const txnMerchant   = txn?.merchant_name || '';
  const txnAmount     = txn?.amount != null ? Math.abs(txn.amount) : '';
  const txnCurrency   = txn?.iso_currency_code || 'USD';

  // Smart default: prefer merchant if available, fall back to description
  const hasMerchant = !!txnMerchant;
  const defaultMatchType  = hasMerchant ? 'merchant_contains' : 'name_contains';
  const defaultMatchValue = hasMerchant ? txnMerchant : txnDescription;
  const bestLabel = hasMerchant ? txnMerchant : txnDescription;
  const defaultRuleName = `${selectedPrimary}${selectedDetailed ? ' - ' + selectedDetailed : ''} (${bestLabel})`.trim();

  // Format amount for display
  const fmtAmount = txnAmount !== '' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: txnCurrency }).format(txnAmount) : '—';

  // Build rule configuration form
  const formHtml = `
    <div style="display: grid; gap: 14px;">

      <!-- Transaction preview so users can see what each field refers to -->
      <details open style="background: #f8f9fb; border: 1px solid #e2e4e9; border-radius: 6px; padding: 10px 12px;">
        <summary style="font-weight: 600; cursor: pointer; user-select: none;">Transaction being matched</summary>
        <table style="width:100%; margin-top: 8px; font-size: 0.92em; border-collapse: collapse;">
          <tr><td style="padding:3px 8px 3px 0; color:#666; white-space:nowrap;">Description</td>
              <td style="padding:3px 0; font-family: monospace;">${escapeHtml(txnDescription) || '<em style="color:#aaa">empty</em>'}</td></tr>
          <tr><td style="padding:3px 8px 3px 0; color:#666; white-space:nowrap;">Merchant</td>
              <td style="padding:3px 0; font-family: monospace;">${escapeHtml(txnMerchant) || '<em style="color:#aaa">not available</em>'}</td></tr>
          <tr><td style="padding:3px 8px 3px 0; color:#666; white-space:nowrap;">Amount</td>
              <td style="padding:3px 0; font-family: monospace;">${fmtAmount}</td></tr>
        </table>
      </details>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 4px;">Rule Name</label>
        <input id="rule-modal-name" type="text" placeholder="Rule name" value="${escapeHtml(defaultRuleName)}" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 3px;">
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 4px;">Match Type</label>
        <select id="rule-modal-match-type" onchange="_ruleModalMatchTypeChanged()" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 3px;">
          <option value="name_contains"${defaultMatchType === 'name_contains' ? ' selected' : ''}>Description contains</option>
          <option value="merchant_contains"${defaultMatchType === 'merchant_contains' ? ' selected' : ''}>Merchant contains</option>
          <option value="amount_range">Amount range</option>
          <option value="regex">Regular expression (advanced)</option>
        </select>
        <small id="rule-modal-match-hint" style="color: #666; margin-top: 4px; display: block;"></small>
      </div>

      <!-- Text-based match value (description / merchant / regex) -->
      <div id="rule-modal-text-group">
        <label style="display: block; font-weight: 500; margin-bottom: 4px;">Match Value</label>
        <input id="rule-modal-match-value" type="text" placeholder="Text to search for" value="${escapeHtml(defaultMatchValue)}" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 3px;">
      </div>

      <!-- Amount range inputs (shown only for amount_range) -->
      <div id="rule-modal-amount-group" style="display: none;">
        <label style="display: block; font-weight: 500; margin-bottom: 4px;">Amount Range</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="rule-modal-amount-min" type="number" step="0.01" min="0" placeholder="Min" value="" style="flex:1; padding: 6px; border: 1px solid #ddd; border-radius: 3px;">
          <span>to</span>
          <input id="rule-modal-amount-max" type="number" step="0.01" min="0" placeholder="Max" value="" style="flex:1; padding: 6px; border: 1px solid #ddd; border-radius: 3px;">
        </div>
        <small style="color: #666; margin-top: 4px; display: block;">Leave either blank for no limit. Matches absolute value of amount.</small>
      </div>

      <div>
        <label style="display: block; font-weight: 500; margin-bottom: 4px;">Priority</label>
        <input id="rule-modal-priority" type="number" placeholder="0" value="0" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 3px;">
        <small style="color: #666; margin-top: 4px; display: block;">Higher priority rules are applied first. Default is 0.</small>
      </div>

      <label id="rule-modal-case-row" style="display: flex; align-items: center; gap: 6px;">
        <input id="rule-modal-case-sensitive" type="checkbox">
        <span style="font-weight: 500;">Case sensitive</span>
      </label>

      <label style="display: flex; align-items: center; gap: 6px;">
        <input id="rule-modal-active" type="checkbox" checked>
        <span style="font-weight: 500;">Active</span>
      </label>

      <div style="background: #f5f5f5; padding: 10px; border-radius: 3px; border-left: 3px solid #6366f1;">
        <strong>Assign category:</strong> ${escapeHtml(categoryString)}
      </div>
    </div>
  `;

  openModal({
    title: 'Create Categorization Rule',
    body: formHtml,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Create Rule', onClick: () => submitCategoryRule(categoryString, txnId) }
    ]
  });

  // Store txn data on the modal for match-type switching
  window._ruleModalTxn = { description: txnDescription, merchant: txnMerchant, amount: txnAmount };

  // Trigger hint update for initial match type
  _ruleModalMatchTypeChanged();
}

/**
 * Update the rule modal form when the match type dropdown changes.
 * Toggles between text input and amount-range inputs and updates hints.
 */
function _ruleModalMatchTypeChanged() {
  const matchType  = document.getElementById('rule-modal-match-type').value;
  const textGroup  = document.getElementById('rule-modal-text-group');
  const amtGroup   = document.getElementById('rule-modal-amount-group');
  const hintEl     = document.getElementById('rule-modal-match-hint');
  const caseRow    = document.getElementById('rule-modal-case-row');
  const matchInput = document.getElementById('rule-modal-match-value');
  const txnData    = window._ruleModalTxn || {};

  // Toggle field visibility
  const isAmount = matchType === 'amount_range';
  textGroup.style.display  = isAmount ? 'none' : '';
  amtGroup.style.display   = isAmount ? ''     : 'none';
  caseRow.style.display    = isAmount ? 'none' : 'flex';

  // Update hint & pre-fill based on selected match type
  switch (matchType) {
    case 'name_contains':
      hintEl.textContent = 'Matches the Description column of your transactions.';
      matchInput.value = txnData.description || '';
      matchInput.placeholder = 'Text to search for in description';
      break;
    case 'merchant_contains':
      hintEl.textContent = 'Matches the Merchant field (may be empty for some transactions).';
      matchInput.value = txnData.merchant || '';
      matchInput.placeholder = 'Text to search for in merchant name';
      break;
    case 'amount_range': {
      hintEl.textContent = 'Matches transactions whose absolute amount falls within this range.';
      // Pre-fill with a reasonable range around the current amount
      const amt = txnData.amount;
      if (amt !== '' && amt != null) {
        const rounded = Math.round(amt * 100) / 100;
        document.getElementById('rule-modal-amount-min').value = Math.max(0, rounded - 5).toFixed(2);
        document.getElementById('rule-modal-amount-max').value = (rounded + 5).toFixed(2);
      }
      break;
    }
    case 'regex':
      hintEl.textContent = 'Advanced: matches the Description field using a regular expression pattern.';
      matchInput.value = txnData.description || '';
      matchInput.placeholder = 'Regular expression pattern';
      break;
  }
}

/**
 * Submit the rule creation form and call the API.
 */
async function submitCategoryRule(targetCategory, txnId) {
  const ruleName = document.getElementById('rule-modal-name').value.trim();
  const matchType = document.getElementById('rule-modal-match-type').value;
  const priority = parseInt(document.getElementById('rule-modal-priority').value || '0', 10);
  const caseSensitive = document.getElementById('rule-modal-case-sensitive').checked;
  const isActive = document.getElementById('rule-modal-active').checked;

  if (!ruleName) {
    showStatus('Rule name is required', 'warning');
    return;
  }

  // Build matchValue based on match type
  let matchValue;
  if (matchType === 'amount_range') {
    const minVal = document.getElementById('rule-modal-amount-min').value.trim();
    const maxVal = document.getElementById('rule-modal-amount-max').value.trim();
    if (!minVal && !maxVal) {
      showStatus('Please enter at least a minimum or maximum amount', 'warning');
      return;
    }
    matchValue = {};
    if (minVal) matchValue.min = parseFloat(minVal);
    if (maxVal) matchValue.max = parseFloat(maxVal);
  } else {
    matchValue = document.getElementById('rule-modal-match-value').value.trim();
  }

  if (matchType !== 'amount_range' && !matchValue) {
    showStatus('Match value is required', 'warning');
    return;
  }

  const targetValidation = validateTargetCategory(targetCategory);
  if (targetValidation.error) {
    showStatus(targetValidation.error, 'warning');
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rule_name: ruleName,
        match_criteria: {
          match_type: matchType,
          match_value: matchValue,
          case_sensitive: caseSensitive
        },
        target_category: targetCategory,
        priority: priority,
        is_active: isActive
      })
    });

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to create rule', 'error');
      return;
    }

    closeModal();
    showStatus(`Rule created: "${ruleName}". Recategorizing transactions...`, 'success');
    
    // ============= OPTIMIZED: Backend already applied rule to matching transactions =============
    // The backend returns how many transactions were updated. If any were,
    // just re-fetch the transaction list (no Plaid sync needed).
    const updatedCount = data.transactions_updated || 0;
    const skippedCount = data.overrides_skipped || 0;
    
    if (updatedCount > 0 || skippedCount > 0) {
      // Some transactions were updated by the new rule — fetch fresh data from DB (not Plaid)
      await fetchAllTransactions(true);
      let msg = `Rule created: "${ruleName}" — applied to ${updatedCount} transaction${updatedCount !== 1 ? 's' : ''}`;
      if (skippedCount > 0) {
        msg += `. ${skippedCount} transaction${skippedCount !== 1 ? 's were' : ' was'} skipped because ${skippedCount !== 1 ? 'they have' : 'it has'} a manual override.`;
      }
      showStatus(msg, 'success');
    } else {
      showStatus(`Rule created: "${ruleName}" — will apply to future transactions`, 'success');
    }
    
    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Failed to create rule: ${error.message}`, 'error');
  }
}



function getSelectedAccounts() {
  const selected = [];
  $('.account-checkbox:checked').each(function() {
    selected.push($(this).data('account-id'));
  });
  return selected;
}

function exportJSON() {
  const dataStr = JSON.stringify(transactions, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.json`;
  link.click();
}

function copyCSV() {
  const csv = generateCSV();
  navigator.clipboard.writeText(csv).then(() => {
    showStatus('CSV copied to clipboard!', 'success');
    setTimeout(() => clearStatus(), 2000);
  }).catch(err => {
    showStatus('Failed to copy to clipboard', 'error');
  });
}

function downloadCSV() {
  const csv = generateCSV();
  const dataBlob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.csv`;
  link.click();
}

function generateCSV() {
  // Get selected optional fields
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });

  let csv = 'Date,Bank/Account,Description,Amount';
  
  // Add optional headers
  if (optionalFields.includes('merchant_name')) csv += ',Merchant';
  if (optionalFields.includes('category')) csv += ',Category (Primary),Category (Detailed),Confidence';
  if (optionalFields.includes('user_category')) csv += ',User Category';
  if (optionalFields.includes('payment_channel')) csv += ',Channel';
  if (optionalFields.includes('pending')) csv += ',Pending';
  if (optionalFields.includes('check_number')) csv += ',Check #';
  if (optionalFields.includes('original_description')) csv += ',Original Desc';
  if (optionalFields.includes('authorized_date')) csv += ',Auth Date';
  if (optionalFields.includes('authorized_datetime')) csv += ',Auth Time';
  
  csv += '\n';

  transactions.forEach(txn => {
    const dateObj = new Date(txn.date);
    const dateStr = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC'
    });
    const amount = txn.amount;
    const name = (txn.name || '').replace(/"/g, '""');
    
    csv += `"${dateStr}","${txn.bank_account}","${name}",${amount}`;
    
    // Add optional fields
    if (optionalFields.includes('merchant_name')) csv += `,"${(txn.merchant_name || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('category')) {
         // Use new personal_finance_category if available
         const pfc = txn.personal_finance_category;
         if (pfc) {
           const primaryRaw = (pfc.primary || '').replace(/_/g, ' ').trim();
           const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
           let detailedTrimmed = detailedRaw;
           if (primaryRaw && detailedRaw.toLowerCase().startsWith(primaryRaw.toLowerCase() + ' ')) {
             detailedTrimmed = detailedRaw.slice(primaryRaw.length).trim();
           } else {
             detailedTrimmed = detailedRaw.replace(/^\S+\s*/, '').trim();
           }
           const primary = primaryRaw.replace(/"/g, '""');
           const detailed = detailedTrimmed.replace(/"/g, '""');
           const confidence = (pfc.confidence_level || '').replace(/_/g, ' ').replace(/"/g, '""');
           csv += `,"${primary}","${detailed}","${confidence}"`;
         } else {
           // Fallback to legacy category
           let cat = txn.category;
           if (typeof cat === 'string' && cat.startsWith('{')) {
             cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
           } else if (Array.isArray(cat)) {
             cat = cat.join(', ');
           }
           csv += `,"${(cat || '').replace(/"/g, '""')}","",""`;
         }
    }
    if (optionalFields.includes('user_category')) csv += `,"${(txn.user_category || 'Uncategorized').replace(/"/g, '""')}"`;
    if (optionalFields.includes('payment_channel')) csv += `,"${(txn.payment_channel || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('pending')) csv += `,${txn.pending ? 'Yes' : 'No'}`;
    if (optionalFields.includes('check_number')) csv += `,"${(txn.check_number || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('original_description')) csv += `,"${(txn.original_description || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('authorized_date')) csv += `,"${(txn.authorized_date || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('authorized_datetime')) {
        let authTime = '';
        if (txn.authorized_datetime) {
            const dt = new Date(txn.authorized_datetime);
            authTime = dt.toLocaleString('en-US', {
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
        }
        csv += `,"${authTime}"`;
    }
    
    csv += '\n';
  });
  return csv;
}

function getDateRange() {
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  return `${start}_to_${end}`;
}

// ===============================
// DYNAMIC PERIOD BUTTONS
// ===============================

function renderDynamicPeriodButtons() {
  const container = document.getElementById('dynamic-period-buttons');
  if (!container) return;
  
  if (!transactions || transactions.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  // Find earliest and latest transaction dates
  let earliest = null;
  let latest = null;
  
  transactions.forEach(txn => {
    if (!earliest || txn.date < earliest) earliest = txn.date;
    if (!latest || txn.date > latest) latest = txn.date;
  });
  
  if (!earliest || !latest) {
    container.innerHTML = '';
    return;
  }
  
  const earliestDate = new Date(earliest);
  const latestDate = new Date(latest);
  
  // Calculate span in days
  const daysDiff = Math.ceil((latestDate - earliestDate) / (1000 * 60 * 60 * 24));
  
  // If span is 2+ years, show year buttons; otherwise show month buttons
  if (daysDiff >= 730) {
    renderYearButtons(container, earliestDate, latestDate);
  } else {
    renderMonthButtons(container, earliestDate, latestDate);
  }
}

function renderYearButtons(container, earliestDate, latestDate) {
  const startYear = earliestDate.getFullYear();
  const endYear = latestDate.getFullYear();
  
  let html = '<span style="font-size: 14px; font-weight: 500; color: #666;">Quick Select:</span>';
  
  for (let year = startYear; year <= endYear; year++) {
    html += `<button onclick="setPeriodYear(${year})" class="secondary" style="padding: 4px 10px; font-size: 12px;">${year}</button>`;
  }
  
  container.innerHTML = html;
}

function renderMonthButtons(container, earliestDate, latestDate) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let html = '<span style="font-size: 14px; font-weight: 500; color: #666;">Quick Select:</span>';
  
  // Build list of year-month combinations
  const months = [];
  let current = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
  const end = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  
  while (current <= end) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth(),
      label: monthNames[current.getMonth()]
    });
    current.setMonth(current.getMonth() + 1);
  }
  
  // If multiple years, show year prefix for clarity
  const multiYear = months.length > 0 && months[0].year !== months[months.length - 1].year;
  
  months.forEach(m => {
    const label = multiYear ? `${m.label} '${String(m.year).slice(-2)}` : m.label;
    html += `<button onclick="setPeriodMonth(${m.year}, ${m.month})" class="secondary" style="padding: 4px 10px; font-size: 12px;">${label}</button>`;
  });
  
  container.innerHTML = html;
}

function setPeriodYear(year) {
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const start = new Date(year, 0, 1); // January 1st
  const end = new Date(year, 11, 31); // December 31st
  const today = new Date();
  
  // Don't go beyond today
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(actualEnd);
  renderTransactionTable();
}

function setPeriodMonth(year, month) {
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const start = new Date(year, month, 1); // First day of month
  const end = new Date(year, month + 1, 0); // Last day of month
  const today = new Date();
  
  // Don't go beyond today
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(actualEnd);
  renderTransactionTable();
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('status-message');
  statusDiv.className = `status-message ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.display = 'block';
}

function clearStatus() {
  const statusDiv = document.getElementById('status-message');
  statusDiv.style.display = 'none';
}

async function promptRename(accountId, currentCustomName) {
  const newName = prompt('Enter a custom name for this account (leave empty to reset):', currentCustomName);
  
  if (newName === null) return; // User cancelled
  
  try {
    showStatus('Updating account name...', 'info');
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/accounts/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plaid_account_id: accountId,
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
    
  } catch (error) {
    console.error('Rename error:', error);
    showStatus(`Failed to rename account: ${error.message}`, 'error');
  }
}

async function saveSettings() {
  try {
    showStatus('Saving settings...', 'info');
    
    const optionalFields = [];
    $('.field-checkbox:checked').each(function() {
      optionalFields.push($(this).val());
    });
    const timezone = document.getElementById('timezone').value;
    const hideTransfers = document.getElementById('hide-transfers').checked;
    const showOverridesOnly = document.getElementById('show-overrides-only').checked;
    
    const settings = {
      optional_fields: optionalFields,
      field_order: ['datetime', 'bank_account', 'name', 'amount', ...optionalFields],
      timezone: timezone,
      hide_transfers: hideTransfers,
      show_overrides_only: showOverridesOnly
    };
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transaction_viewer_settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to save settings');
    }
    
    showStatus('Settings saved successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus(`Failed to save settings: ${error.message}`, 'error');
  }
}

async function loadSettings() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transaction_viewer_settings`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error('Failed to load settings');
    }
    
    const settings = await response.json();
    applySettings(settings);
    
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

function applySettings(settings) {
  if (!settings) return;

  if (settings.timezone) {
    document.getElementById('timezone').value = settings.timezone;
  }
  
  if (settings.optional_fields && Array.isArray(settings.optional_fields)) {
    $('.field-checkbox').prop('checked', false);
    settings.optional_fields.forEach(field => {
      $(`.field-checkbox[value="${field}"]`).prop('checked', true);
    });
  }
  
  // Apply hide_transfers setting (default to true if not set)
  const hideTransfers = settings.hide_transfers !== undefined ? settings.hide_transfers : true;
  document.getElementById('hide-transfers').checked = hideTransfers;

  // Apply show_overrides_only setting (default to false if not set)
  const showOverridesOnly = settings.show_overrides_only !== undefined ? settings.show_overrides_only : false;
  document.getElementById('show-overrides-only').checked = showOverridesOnly;
}

// ===============================
// CATEGORY HISTORY & INSIGHTS
// ===============================

function generateSpendingInsights() {
  // Generate statistical insights based on filtered transactions and historical data
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingCheckbox = document.querySelector('.field-checkbox[value="pending"]:checked');
  const hideTransfers = document.getElementById('hide-transfers').checked;
  const showOverridesOnly = document.getElementById('show-overrides-only').checked;

  // Get filtered transactions (same filter as table)
  const filteredTransactions = transactions.filter(txn => {
    if (txn.date < startDate || txn.date > endDate) return false;
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.plaid_account_id)) return false;
    if (txn.pending && !showPendingCheckbox) return false;
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) return false;
    }
    if (showOverridesOnly && !txn.is_override) return false;
    if (txn.personal_finance_category && txn.personal_finance_category.primary) {
      if (/income/i.test(txn.personal_finance_category.primary)) return false;
    }
    return true;
  });

  if (filteredTransactions.length === 0) {
    return null;
  }

  // Calculate current period stats
  const currentStats = {
    totalSpending: 0,
    transactionCount: filteredTransactions.length,
    categories: {},
    largestTransaction: null,
    averageTransaction: 0
  };

  filteredTransactions.forEach(txn => {
    const amount = Math.abs(txn.amount || 0);
    currentStats.totalSpending += amount;

    // Track largest transaction
    if (!currentStats.largestTransaction || amount > currentStats.largestTransaction.amount) {
      currentStats.largestTransaction = {
        amount: amount,
        merchant: txn.merchant_name || txn.name || 'Unknown',
        date: txn.date,
        category: (txn.personal_finance_category && txn.personal_finance_category.primary) || 'Uncategorized'
      };
    }

    // Aggregate by primary category
    const category = (txn.personal_finance_category && txn.personal_finance_category.primary) || 'Uncategorized';
    const categoryName = category.replace(/_/g, ' ');
    if (!currentStats.categories[categoryName]) {
      currentStats.categories[categoryName] = { total: 0, count: 0 };
    }
    currentStats.categories[categoryName].total += amount;
    currentStats.categories[categoryName].count += 1;
  });

  currentStats.averageTransaction = currentStats.totalSpending / currentStats.transactionCount;

  // Get top categories
  const topCategories = Object.entries(currentStats.categories)
    .map(([name, data]) => ({ name, total: data.total, count: data.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  // Build insights array
  const insights = [];

  // Insight 1: Total spending
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.totalSpending);
  insights.push({
    icon: '💰',
    label: 'Total Spending',
    value: `${formattedTotal} across ${currentStats.transactionCount} transactions`
  });

  // Insight 2: Top category
  if (topCategories.length > 0) {
    const topCat = topCategories[0];
    const percentage = ((topCat.total / currentStats.totalSpending) * 100).toFixed(0);
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(topCat.total);
    insights.push({
      icon: '📈',
      label: 'Top Category',
      value: `${topCat.name} (${formatted} - ${percentage}% of spending)`
    });
  }

  // Insight 3: Average transaction
  const formattedAvg = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.averageTransaction);
  insights.push({
    icon: '💳',
    label: 'Average Transaction',
    value: formattedAvg
  });

  // Insight 4: Largest transaction
  if (currentStats.largestTransaction) {
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.largestTransaction.amount);
    insights.push({
      icon: '🔥',
      label: 'Largest Purchase',
      value: `${formatted} at ${currentStats.largestTransaction.merchant}`
    });
  }

  return insights;
}

function renderInsightsPanel() {
  const container = document.getElementById('insights-container');
  if (!container) return; // Insights panel not in DOM yet

  const insights = generateSpendingInsights();
  
  if (!insights || insights.length === 0) {
    container.innerHTML = '<div class="insights-empty">Select accounts and date range to view insights</div>';
    return;
  }

  let html = '<div class="insights-grid">';
  insights.forEach(insight => {
    const highlightClass = insight.highlight ? ' highlight' : '';
    html += `
      <div class="insight-card${highlightClass}">
        <div class="insight-icon">${insight.icon}</div>
        <div class="insight-content">
          <div class="insight-label">${insight.label}</div>
          <div class="insight-value">${insight.value}</div>
        </div>
      </div>
    `;
  });
  html += '</div>';

  container.innerHTML = html;
}

// ===============================
// CHART VISUALIZATION
// ===============================

let categoryChart = null;
let chartViewMode = 'primary'; // 'primary' or 'detailed'

// Pastel color palette
const PASTEL_COLORS = [
  '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#E0BBE4', '#FFDFD3', '#FEC8D8', '#D4F1F4', '#C9E4DE',
  '#F7D9C4', '#FAEDCB', '#C9F0DB', '#DBE7E4', '#F0EFEB',
  '#D5AAFF', '#FFCCE5', '#B4E7CE', '#FDE2E4', '#E2ECE9'
];

function switchChartView(mode) {
  chartViewMode = mode;
  
  // Update button states
  document.getElementById('chart-primary-btn').classList.toggle('active', mode === 'primary');
  document.getElementById('chart-detailed-btn').classList.toggle('active', mode === 'detailed');
  
  // Re-render chart
  renderCategoryChart();
}

function aggregateCategoriesFromFilteredTransactions() {
  // Get the same filtered transactions that the table uses
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingCheckbox = document.querySelector('.field-checkbox[value="pending"]:checked');
  const hideTransfers = document.getElementById('hide-transfers').checked;
  
  const filteredTransactions = transactions.filter(txn => {
    // Filter by date range
    if (txn.date < startDate || txn.date > endDate) {
      return false;
    }
    
    // Filter by selected accounts
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.plaid_account_id)) {
      return false;
    }
    
    // Filter pending transactions
    if (txn.pending && !showPendingCheckbox) {
      return false;
    }

    // Hide transfers if requested
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) {
        return false;
      }
    }

    // Exclude income transactions from chart
    if (txn.personal_finance_category && txn.personal_finance_category.primary) {
      const primaryCat = txn.personal_finance_category.primary;
      if (/income/i.test(primaryCat)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Aggregate by category
  const categoryTotals = {};
  
  filteredTransactions.forEach(txn => {
    const pfc = txn.personal_finance_category;
    let categoryKey = 'Uncategorized';
    
    if (pfc) {
      if (chartViewMode === 'primary') {
        categoryKey = (pfc.primary || 'Uncategorized').replace(/_/g, ' ');
      } else {
        // Detailed mode
        const primaryRaw = (pfc.primary || '').replace(/_/g, ' ').trim();
        const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
        
        // Use the helper function for consistent trimming
        const displayNames = getCategoryDisplayNames(pfc);
        categoryKey = displayNames.trimmed || displayNames.primary || 'Uncategorized';
      }
    } else if (txn.category) {
      // Fallback to legacy category
      let cat = txn.category;
      if (typeof cat === 'string' && cat.startsWith('{')) {
        cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
      } else if (Array.isArray(cat)) {
        cat = cat.join(', ');
      }
      categoryKey = cat || 'Uncategorized';
    }
    
    // Sum amounts (use absolute value for visualization)
    const amount = Math.abs(txn.amount || 0);
    categoryTotals[categoryKey] = (categoryTotals[categoryKey] || 0) + amount;
  });
  
  // Convert to array and sort by amount descending
  const categoriesArray = Object.entries(categoryTotals)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
  
  return categoriesArray;
}

function renderCategoryChart() {
  const categoryData = aggregateCategoriesFromFilteredTransactions();
  const canvas = document.getElementById('category-chart');
  const emptyState = document.getElementById('chart-empty-state');
  
  // Show/hide empty state
  if (categoryData.length === 0) {
    emptyState.classList.add('visible');
    canvas.style.display = 'none';
    if (categoryChart) {
      categoryChart.destroy();
      categoryChart = null;
    }
    return;
  } else {
    emptyState.classList.remove('visible');
    canvas.style.display = 'block';
  }
  
  const labels = categoryData.map(item => item.category);
  const data = categoryData.map(item => item.total);
  const colors = categoryData.map((_, index) => PASTEL_COLORS[index % PASTEL_COLORS.length]);
  
  // Destroy existing chart
  if (categoryChart) {
    categoryChart.destroy();
  }
  
  // Create new chart
  const ctx = canvas.getContext('2d');
  categoryChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            padding: 10,
            font: {
              size: 9.5
            },
            boxWidth: 12,
            maxWidth: 160,
            generateLabels: function(chart) {
              const data = chart.data;
              if (data.labels.length && data.datasets.length) {
                const dataset = data.datasets[0];
                const total = dataset.data.reduce((sum, val) => sum + val, 0);
                
                return data.labels.map((label, i) => {
                  const value = dataset.data[i];
                  const percentage = ((value / total) * 100).toFixed(1);
                  // Truncate very long labels (>30 chars) with ellipsis
                  let displayLabel = label;
                  if (label.length > 30) {
                    displayLabel = label.substring(0, 27) + '...';
                  }
                  
                  return {
                    text: `${displayLabel} (${percentage}%)`,
                    fillStyle: dataset.backgroundColor[i],
                    hidden: false,
                    index: i
                  };
                });
              }
              return [];
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed;
              const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              const formatted = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
              }).format(value);
              
              return `${label}: ${formatted} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// ============= CATEGORIZATION (MANUAL ONLY) =============

async function loadAvailableCategories() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`);
    const data = await response.json();
    if (response.ok) {
      availableCategories = data.available_categories || [];
    }
  } catch (error) {
    console.error('Failed to load available categories:', error);
  }
}

async function applyManualCategory(txnId, accountId) {
  const selectedCategory = document.getElementById('modal-category-select').value;
  const saveRule = document.getElementById('modal-save-rule').checked;

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_category: selectedCategory, plaid_account_id: accountId })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to categorize transaction', 'error');
      return;
    }

    if (saveRule) {
      await createRuleFromModal(selectedCategory);
    }

    closeModal();
    // Update local array directly — backend already persisted the override
    const txn = transactions.find(t => (t.transaction_id || t.plaid_transaction_id) === txnId);
    if (txn) {
      txn.user_category = selectedCategory;
      txn.is_override = true;
      try {
        localStorage.setItem('pf_cached_transactions', JSON.stringify(transactions));
        localStorage.setItem('pf_transactions_cached_at', String(Date.now()));
      } catch (e) { /* non-fatal */ }
    }
    showStatus('Transaction categorized', 'success');
    renderTransactionTable();
    setTimeout(() => clearStatus(), 2000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (e) { /* cache removal failure is non-fatal */ }
  } catch (error) {
    showStatus(`Failed to categorize transaction: ${error.message}`, 'error');
  }
}

async function createRuleFromModal(targetCategory) {
  const ruleName = document.getElementById('modal-rule-name').value.trim();
  const matchType = document.getElementById('modal-rule-match-type').value;
  const matchValue = document.getElementById('modal-rule-match-value').value.trim();
  const caseSensitive = document.getElementById('modal-rule-case').checked;
  const priority = parseInt(document.getElementById('modal-rule-priority').value || '0', 10);

  if (!ruleName || !matchValue) {
    showStatus('Rule name and match value are required', 'warning');
    return;
  }

  const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rule_name: ruleName,
      match_criteria: {
        match_type: matchType,
        match_value: matchValue,
        case_sensitive: caseSensitive
      },
      target_category: targetCategory,
      priority
    })
  });

  const data = await response.json();
  if (!response.ok) {
    showStatus(data.error || 'Failed to create rule', 'error');
  }
}

// ===============================
// CATEGORY PARSING & FORMATTING (PHASE 1)
// ===============================

/**
 * Parse a category string into primary and detailed components.
 * Handles multiple formats:
 * 1. Colon-separated: "Getting Around: Bikes and Scooters" → {primary: "Getting Around", detailed: "Bikes and Scooters"}
 * 2. Underscore-separated: "TRANSPORTATION_BIKES_AND_SCOOTERS" → {primary: "Transportation", detailed: "Bikes And Scooters"}
 * 3. Custom categories without separator: "bike stuff" → {primary: "bike stuff", detailed: ""}
 */
function parseCategoryString(categoryStr) {
  if (!categoryStr || typeof categoryStr !== 'string') {
    return { primary: '', detailed: '', full: '' };
  }

  const trimmed = categoryStr.trim();
  
  // Check for colon-separated format (new format)
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map(p => p.trim());
    return {
      primary: parts[0] || '',
      detailed: parts[1] || '',
      full: trimmed
    };
  }
  
  // Check for underscore-separated format (legacy Plaid format)
  if (trimmed.includes('_')) {
    // Try to match against plaid taxonomy to identify primary
    const parsed = parsePlaidCategoryString(trimmed);
    if (parsed.primary) {
      return parsed;
    }
  }
  
  // Custom category without separator - treat whole thing as primary
  return {
    primary: trimmed,
    detailed: '',
    full: trimmed
  };
}

/**
 * Parse a Plaid underscore-separated category using taxonomy lookup.
 * Example: "TRANSPORTATION_BIKES_AND_SCOOTERS" → {primary: "Transportation", detailed: "Bikes And Scooters"}
 */
function parsePlaidCategoryString(categoryStr) {
  if (!categoryStr) {
    return { primary: '', detailed: '', full: categoryStr };
  }
  
  // Try to find matching entry in plaid taxonomy
  const matchingTaxonomy = plaidTaxonomy.find(t => t.detailed === categoryStr);
  
  if (matchingTaxonomy) {
    const primary = matchingTaxonomy.primary || '';
    const detailed = categoryStr;
    const trimmedDetailed = trimCategoryPrefix(detailed, primary);
    
    return {
      primary: formatCategoryDisplay(primary),
      detailed: formatCategoryDisplay(trimmedDetailed),
      full: categoryStr,
      rawPrimary: primary,
      rawDetailed: detailed
    };
  }
  
  // Fallback: try to split intelligently by finding common primary patterns
  const commonPrimaries = [
    'BANK_FEES', 'ENTERTAINMENT', 'FOOD_AND_DRINK', 'GENERAL_MERCHANDISE',
    'GENERAL_SERVICES', 'GOVERNMENT_AND_NON_PROFIT', 'HOME_IMPROVEMENT',
    'INCOME', 'LOAN_DISBURSEMENTS', 'LOAN_PAYMENTS', 'MEDICAL',
    'PERSONAL_CARE', 'RENT_AND_UTILITIES', 'TRANSFER_IN', 'TRANSFER_OUT',
    'TRANSPORTATION', 'TRAVEL'
  ];
  
  for (const primaryPattern of commonPrimaries) {
    if (categoryStr.startsWith(primaryPattern + '_')) {
      const detailed = categoryStr.substring(primaryPattern.length + 1);
      return {
        primary: formatCategoryDisplay(primaryPattern),
        detailed: formatCategoryDisplay(detailed),
        full: categoryStr,
        rawPrimary: primaryPattern,
        rawDetailed: categoryStr
      };
    } else if (categoryStr === primaryPattern) {
      return {
        primary: formatCategoryDisplay(primaryPattern),
        detailed: '',
        full: categoryStr,
        rawPrimary: primaryPattern,
        rawDetailed: categoryStr
      };
    }
  }
  
  // Last resort: treat whole thing as primary
  return {
    primary: formatCategoryDisplay(categoryStr),
    detailed: '',
    full: categoryStr,
    rawPrimary: categoryStr,
    rawDetailed: categoryStr
  };
}

/**
 * Build a category string from primary and detailed components.
 * Returns format: "Primary: Detailed" or just "Primary" if no detailed.
 */
function buildCategoryString(primary, detailed) {
  if (!primary) return '';
  if (!detailed) return primary;
  return `${primary}: ${detailed}`;
}

function normalizeCategoryLabel(label) {
  return String(label || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveTargetCategory(primary, detailed) {
  const normalizedPrimary = normalizeCategoryLabel(primary);
  const normalizedDetailed = normalizeCategoryLabel(detailed);

  if (!normalizedPrimary || normalizedPrimary === 'Uncategorized') {
    return { error: 'Please select a valid category (not Uncategorized)' };
  }

  const candidate = buildCategoryString(normalizedPrimary, normalizedDetailed);
  const candidateNorm = normalizeCategoryLabel(candidate);

  const matchingAvailable = (availableCategories || []).find(cat => normalizeCategoryLabel(cat) === candidateNorm);
  if (matchingAvailable) {
    return { value: matchingAvailable };
  }

  if (!normalizedDetailed) {
    const matchingPrimary = (availableCategories || []).find(cat => normalizeCategoryLabel(cat) === normalizedPrimary);
    if (matchingPrimary) {
      return { value: matchingPrimary };
    }
  }

  const detailedOptions = extractDetailedCategories(availableCategories, normalizedPrimary);
  if (!normalizedDetailed && detailedOptions.length > 0) {
    return { error: 'Please select a detailed category' };
  }

  return { error: 'Selected category is not available. Please choose a valid category.' };
}

function validateTargetCategory(targetCategory) {
  const normalizedTarget = normalizeCategoryLabel(targetCategory);
  if (!normalizedTarget || normalizedTarget === 'Uncategorized') {
    return { error: 'Please select a valid category (not Uncategorized)' };
  }

  if (availableCategories && !(availableCategories || []).some(cat => normalizeCategoryLabel(cat) === normalizedTarget)) {
    return { error: 'Selected category is not available. Please choose a valid category.' };
  }

  const matching = (availableCategories || []).find(cat => normalizeCategoryLabel(cat) === normalizedTarget);
  return { value: matching || targetCategory };
}

/**
 * Extract unique primary categories from available categories list.
 * Returns sorted array of primary category names.
 */
function extractPrimaryCategories(categories) {
  const primaries = new Set();
  
  (categories || []).forEach(cat => {
    const parsed = parseCategoryString(cat);
    if (parsed.primary) {
      primaries.add(parsed.primary);
    }
  });
  
  return Array.from(primaries).sort((a, b) => a.localeCompare(b));
}

/**
 * Extract detailed categories for a specific primary category.
 * Returns sorted array of detailed category names.
 */
function extractDetailedCategories(categories, primaryCategory) {
  if (!primaryCategory) return [];
  
  const detailed = new Set();
  
  (categories || []).forEach(cat => {
    const parsed = parseCategoryString(cat);
    if (parsed.primary === primaryCategory && parsed.detailed) {
      detailed.add(parsed.detailed);
    }
  });
  
  return Array.from(detailed).sort((a, b) => a.localeCompare(b));
}

function buildCategoryOptions(selected) {
  const unique = new Set(availableCategories || []);
  if (selected) unique.add(selected);
  const list = Array.from(unique).sort((a, b) => a.localeCompare(b));
  return list
    .map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
    .join('');
}

/**
 * Populate the category filter dropdowns with available categories.
 */
function populateCategoryFilterDropdowns() {
  const primarySelect = document.getElementById('filter-primary-category');
  const detailedSelect = document.getElementById('filter-detailed-category');
  
  if (!primarySelect || !detailedSelect) return;
  
  // Get all primary categories
  const primaries = extractPrimaryCategories(availableCategories);
  
  // Build primary dropdown
  let primaryHTML = '<option value="">— All Categories —</option>';
  primaries.forEach(cat => {
    primaryHTML += `<option value="${escapeHtml(cat)}" ${cat === filterPrimaryCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`;
  });
  primarySelect.innerHTML = primaryHTML;
  
  // Build detailed dropdown based on current primary filter
  updateDetailedFilterDropdown();
}

/**
 * Update the detailed category filter dropdown based on selected primary category.
 */
function updateDetailedFilterDropdown() {
  const detailedSelect = document.getElementById('filter-detailed-category');
  if (!detailedSelect) return;
  
  if (!filterPrimaryCategory) {
    // No primary selected - show all detailed categories message
    detailedSelect.innerHTML = '<option value="">— All Detailed Categories —</option>';
    detailedSelect.disabled = false;
    return;
  }
  
  // Get detailed categories for the selected primary
  const detailed = extractDetailedCategories(availableCategories, filterPrimaryCategory);
  
  let detailedHTML = '<option value="">— All Detailed Categories —</option>';
  detailed.forEach(cat => {
    detailedHTML += `<option value="${escapeHtml(cat)}" ${cat === filterDetailedCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`;
  });
  detailedSelect.innerHTML = detailedHTML;
  detailedSelect.disabled = false;
}

/**
 * Handle primary category filter change.
 */
function onFilterPrimaryChange() {
  const primarySelect = document.getElementById('filter-primary-category');
  filterPrimaryCategory = primarySelect.value;
  
  // Reset detailed filter when primary changes
  filterDetailedCategory = '';
  
  // Update detailed dropdown options
  updateDetailedFilterDropdown();
  
  // Re-render table with new filters
  renderTransactionTable();
}

/**
 * Handle detailed category filter change.
 */
function onFilterDetailedChange() {
  const detailedSelect = document.getElementById('filter-detailed-category');
  filterDetailedCategory = detailedSelect.value;
  
  // Re-render table with new filters
  renderTransactionTable();
}

/**
 * Clear all category filters and refresh the table.
 */
function clearCategoryFilters() {
  filterPrimaryCategory = '';
  filterDetailedCategory = '';
  
  // Reset dropdowns
  const primarySelect = document.getElementById('filter-primary-category');
  const detailedSelect = document.getElementById('filter-detailed-category');
  
  if (primarySelect) primarySelect.value = '';
  if (detailedSelect) {
    detailedSelect.value = '';
    updateDetailedFilterDropdown();
  }
  
  // Re-render table
  renderTransactionTable();
}

/**
 * Trim the primary category prefix from a detailed category.
 * Example: "GENERAL_MERCHANDISE_SPORTING_GOODS" + "GENERAL_MERCHANDISE" → "SPORTING_GOODS"
 */
function trimCategoryPrefix(detailed, primary) {
  if (!detailed || !primary) return detailed || '';
  
  // Remove primary prefix if detailed starts with it
  if (detailed.toUpperCase().startsWith(primary.toUpperCase() + '_')) {
    return detailed.substring(primary.length + 1);
  }
  
  return detailed;
}

/**
 * Format a category string for display (replace underscores, title case).
 */
function formatCategoryDisplay(value) {
  return (value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get formatted category display names from personal_finance_category object.
 */
function getCategoryDisplayNames(pfc) {
  if (!pfc || !pfc.detailed) {
    return { primary: '', trimmed: '', confidence: '' };
  }
  
  const primary = pfc.primary || '';
  const detailed = pfc.detailed || '';
  const trimmed = trimCategoryPrefix(detailed, primary);
  const confidence = (pfc.confidence_level || '').replace(/_/g, ' ');
  
  return {
    primary: formatCategoryDisplay(primary),
    trimmed: formatCategoryDisplay(trimmed),
    confidence: confidence,
    rawPrimary: primary,
    rawDetailed: detailed,
    rawTrimmed: trimmed
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openCategorizeModal(txn, selectedCategory, accountId, txnId) {
  const merchant = txn?.merchant_name || txn?.name || '';
  const categoryOptions = buildCategoryOptions(selectedCategory);
  const defaultRuleName = `${selectedCategory} - ${merchant}`.trim();
  const defaultMatchValue = merchant || txn?.name || '';

  openModal({
    title: 'Categorize Transaction',
    body: `
      <div>
        <p><strong>${escapeHtml(txn?.name || 'Transaction')}</strong></p>
        <p class="pill">${escapeHtml(txn?.date || '')}</p>
      </div>
      <div style="margin-top: 12px;">
        <label>Category</label>
        <select id="modal-category-select" class="table-inline-select">${categoryOptions}</select>
      </div>
      <div style="margin-top: 12px;">
        <label class="inline-checkbox"><input id="modal-save-rule" type="checkbox"> Save as rule for future transactions</label>
      </div>
      <div id="modal-rule-fields" style="margin-top: 8px; display: none;">
        <input id="modal-rule-name" type="text" placeholder="Rule name" value="${escapeHtml(defaultRuleName)}">
        <select id="modal-rule-match-type">
          <option value="merchant_contains">Merchant contains</option>
          <option value="name_contains">Name contains</option>
          <option value="amount_range">Amount range</option>
          <option value="regex">Regular expression (advanced)</option>
        </select>
        <input id="modal-rule-match-value" type="text" placeholder="Match value" value="${escapeHtml(defaultMatchValue)}">
        <label class="inline-checkbox"><input id="modal-rule-case" type="checkbox"> Case sensitive</label>
        <input id="modal-rule-priority" type="number" value="0" placeholder="Priority">
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Save', onClick: () => applyManualCategory(txnId, accountId) }
    ]
  });

  const saveRuleCheckbox = document.getElementById('modal-save-rule');
  if (saveRuleCheckbox) {
    saveRuleCheckbox.addEventListener('change', () => {
      const fields = document.getElementById('modal-rule-fields');
      fields.style.display = saveRuleCheckbox.checked ? 'grid' : 'none';
    });
  }
}

async function applyManualCategory(txnId, accountId) {
  const selectedCategory = document.getElementById('modal-category-select').value;
  const saveRule = document.getElementById('modal-save-rule').checked;

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_category: selectedCategory, plaid_account_id: accountId })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to categorize transaction', 'error');
      return;
    }

    if (saveRule) {
      await createRuleFromModal(selectedCategory);
    }

    closeModal();
    // Update local array directly — backend already persisted the override
    const txn = transactions.find(t => (t.transaction_id || t.plaid_transaction_id) === txnId);
    if (txn) {
      txn.user_category = selectedCategory;
      txn.is_override = true;
      try {
        localStorage.setItem('pf_cached_transactions', JSON.stringify(transactions));
        localStorage.setItem('pf_transactions_cached_at', String(Date.now()));
      } catch (e) { /* non-fatal */ }
    }
    showStatus('Transaction categorized', 'success');
    renderTransactionTable();
    setTimeout(() => clearStatus(), 2000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (e) { /* cache removal failure is non-fatal */ }
  } catch (error) {
    showStatus(`Failed to categorize transaction: ${error.message}`, 'error');
  }
}

async function createRuleFromModal(targetCategory) {
  const ruleName = document.getElementById('modal-rule-name').value.trim();
  const matchType = document.getElementById('modal-rule-match-type').value;
  const matchValue = document.getElementById('modal-rule-match-value').value.trim();
  const caseSensitive = document.getElementById('modal-rule-case').checked;
  const priority = parseInt(document.getElementById('modal-rule-priority').value || '0', 10);

  if (!ruleName || !matchValue) {
    showStatus('Rule name and match value are required', 'warning');
    return;
  }

  const targetValidation = validateTargetCategory(targetCategory);
  if (targetValidation.error) {
    showStatus(targetValidation.error, 'warning');
    return;
  }

  const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rule_name: ruleName,
      match_criteria: {
        match_type: matchType,
        match_value: matchValue,
        case_sensitive: caseSensitive
      },
      target_category: targetCategory,
      priority
    })
  });

  const data = await response.json();
  if (!response.ok) {
    showStatus(data.error || 'Failed to create rule', 'error');
  }
}

function openModal({ title, body, actions }) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    const newOverlay = document.createElement('div');
    newOverlay.id = 'modal-overlay';
    newOverlay.className = 'modal-overlay hidden';
    newOverlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="modal-title"></h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div id="modal-body" class="modal-body"></div>
        <div id="modal-actions" class="modal-actions"></div>
      </div>
    `;
    document.body.appendChild(newOverlay);
  }

  const overlay2 = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const actionsEl = document.getElementById('modal-actions');

  titleEl.textContent = title;
  bodyEl.innerHTML = body;
  actionsEl.innerHTML = '';

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    if (action.className) btn.className = action.className;
    btn.addEventListener('click', action.onClick);
    actionsEl.appendChild(btn);
  });

  overlay2.classList.remove('hidden');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ===============================
// CATEGORY DATA LOADING
// ===============================

/**
 * Load available categories and Plaid taxonomy for categorization features.
 * Uses localStorage cache to avoid redundant API calls (categories rarely change).
 */
async function loadAvailableCategories(forceNetwork = false) {
  const CAT_CACHE_KEY = 'pf_cached_categories';
  const TAX_CACHE_KEY = 'pf_cached_taxonomy';
  const CAT_TS_KEY = 'pf_categories_cached_at';
  const CAT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes — categories change infrequently

  // Try cache first
  if (!forceNetwork) {
    const cachedAt = localStorage.getItem(CAT_TS_KEY);
    const cacheAge = cachedAt ? (Date.now() - parseInt(cachedAt)) : Infinity;
    if (cacheAge < CAT_MAX_AGE_MS) {
      try {
        const cachedCats = JSON.parse(localStorage.getItem(CAT_CACHE_KEY) || '[]');
        const cachedTax = JSON.parse(localStorage.getItem(TAX_CACHE_KEY) || '[]');
        if (cachedCats.length > 0) {
          availableCategories = cachedCats;
          plaidTaxonomy = cachedTax;
          console.log(`Loaded ${availableCategories.length} categories and ${plaidTaxonomy.length} taxonomy from cache`);
          return;
        }
      } catch (e) {
        console.warn('Category cache parse error, fetching from server:', e);
      }
    }
  }

  try {
    const [categoriesRes, taxonomyRes] = await Promise.all([
      authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/plaid-taxonomy`)
    ]);

    if (categoriesRes.ok) {
      const data = await categoriesRes.json();
      availableCategories = data.available_categories || [];
    } else {
      console.error('Failed to load available categories');
      availableCategories = [];
    }

    if (taxonomyRes.ok) {
      const data = await taxonomyRes.json();
      plaidTaxonomy = data.categories || [];
    } else {
      console.error('Failed to load Plaid taxonomy');
      plaidTaxonomy = [];
    }
    
    console.log(`Loaded ${availableCategories.length} available categories and ${plaidTaxonomy.length} taxonomy entries`);
    
    // Cache for future page loads
    try {
      localStorage.setItem(CAT_CACHE_KEY, JSON.stringify(availableCategories));
      localStorage.setItem(TAX_CACHE_KEY, JSON.stringify(plaidTaxonomy));
      localStorage.setItem(CAT_TS_KEY, String(Date.now()));
    } catch (e) {
      console.warn('Could not cache categories to localStorage:', e);
    }
  } catch (error) {
    console.error('Error loading category data:', error);
    availableCategories = [];
    plaidTaxonomy = [];
  }
}

/**
 * Trigger backend recategorization of all transactions.
 * This updates the encrypted_transactions table with computed user_category values.
 * Called after creating overrides or rules to persist changes.
 */
async function recategorizeTransactions() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/recategorize`, {
      method: 'POST'
    });

    if (!response.ok) {
      const data = await response.json();
      console.error('Recategorization failed:', data.error);
      throw new Error(data.error || 'Recategorization failed');
    }

    const data = await response.json();
    console.log('Recategorization complete:', data);
    return data;
  } catch (error) {
    console.error('Error recategorizing transactions:', error);
    throw error;
  }
}

/**
 * TEST FUNCTION: Run category parsing tests.
 * Call this from browser console: testCategoryParsing()
 */
function testCategoryParsing() {
  console.log('=== Testing Category Parsing Functions ===\n');
  
  const testCases = [
    'Getting Around: Bikes and Scooters',
    'Food And Drink: Fast Food',
    'TRANSPORTATION_BIKES_AND_SCOOTERS',
    'TRANSFER_IN_WIRE',
    'FOOD_AND_DRINK_FAST_FOOD',
    'bike stuff',
    'INCOME'
  ];
  
  testCases.forEach(testCase => {
    const parsed = parseCategoryString(testCase);
    console.log(`Input: "${testCase}"`);
    console.log(`  Primary: "${parsed.primary}"`);
    console.log(`  Detailed: "${parsed.detailed}"`);
    console.log(`  Full: "${parsed.full}"`);
    
    if (parsed.primary && parsed.detailed) {
      const rebuilt = buildCategoryString(parsed.primary, parsed.detailed);
      console.log(`  Rebuilt: "${rebuilt}"`);
    }
    console.log('');
  });
  
  console.log('=== Testing Category Extraction ===\n');
  const mockCategories = [
    'Food And Drink: Fast Food',
    'Food And Drink: Restaurant',
    'Food And Drink: Groceries',
    'Transportation: Gas',
    'Transportation: Parking',
    'bike stuff'
  ];
  
  const primaries = extractPrimaryCategories(mockCategories);
  console.log('Extracted primaries:', primaries);
  
  const foodDetails = extractDetailedCategories(mockCategories, 'Food And Drink');
  console.log('Food And Drink detailed categories:', foodDetails);
  
  const transportDetails = extractDetailedCategories(mockCategories, 'Transportation');
  console.log('Transportation detailed categories:', transportDetails);
  
  console.log('\n=== Tests Complete ===');
}
