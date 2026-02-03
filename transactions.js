// BACKEND_URL is now defined in config.js and auto-detects environment

let accounts = [];
let transactions = [];
let categoryHistory = null; // Historical category data for insights
let synced = false;

// Local cache keys/durations
const TRANSACTIONS_CACHE_KEY = 'transactionsCache';
const TRANSACTIONS_CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const ACCOUNTS_CACHE_KEY = 'transactionsAccountsCache';
const ACCOUNTS_CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours
const SETTINGS_CACHE_KEY = 'transactionsViewerSettingsCache';
const SETTINGS_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const CATEGORY_HISTORY_CACHE_KEY = 'categoryHistoryCache';
const CATEGORY_HISTORY_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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

// Cache helpers
function getCachedTransactions() {
  try {
    const cached = localStorage.getItem(TRANSACTIONS_CACHE_KEY);
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    if (!data) return null;
    if (Date.now() - timestamp < TRANSACTIONS_CACHE_DURATION) {
      return data;
    }
    localStorage.removeItem(TRANSACTIONS_CACHE_KEY);
  } catch (e) {
    console.error('transactions cache read error:', e);
    localStorage.removeItem(TRANSACTIONS_CACHE_KEY);
  }
  return null;
}

function setCachedTransactions(data) {
  try {
    localStorage.setItem(TRANSACTIONS_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (e) {
    console.error('transactions cache write error:', e);
  }
}

function clearTransactionsCache() {
  localStorage.removeItem(TRANSACTIONS_CACHE_KEY);
}

function getCachedAccounts() {
  try {
    const cached = localStorage.getItem(ACCOUNTS_CACHE_KEY);
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    if (!data) return null;
    if (Date.now() - timestamp < ACCOUNTS_CACHE_DURATION) {
      return data;
    }
    localStorage.removeItem(ACCOUNTS_CACHE_KEY);
  } catch (e) {
    console.error('accounts cache read error:', e);
    localStorage.removeItem(ACCOUNTS_CACHE_KEY);
  }
  return null;
}

function setCachedAccounts(data) {
  try {
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (e) {
    console.error('accounts cache write error:', e);
  }
}

function clearAccountsCache() {
  localStorage.removeItem(ACCOUNTS_CACHE_KEY);
}

function getCachedSettings() {
  try {
    const cached = localStorage.getItem(SETTINGS_CACHE_KEY);
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    if (!data) return null;
    if (Date.now() - timestamp < SETTINGS_CACHE_DURATION) {
      return data;
    }
    localStorage.removeItem(SETTINGS_CACHE_KEY);
  } catch (e) {
    console.error('settings cache read error:', e);
    localStorage.removeItem(SETTINGS_CACHE_KEY);
  }
  return null;
}

function setCachedSettings(data) {
  try {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (e) {
    console.error('settings cache write error:', e);
  }
}

function clearSettingsCache() {
  localStorage.removeItem(SETTINGS_CACHE_KEY);
}

function getCachedCategoryHistory() {
  try {
    const cached = localStorage.getItem(CATEGORY_HISTORY_CACHE_KEY);
    if (!cached) return null;
    const { timestamp, data } = JSON.parse(cached);
    if (!data) return null;
    if (Date.now() - timestamp < CATEGORY_HISTORY_CACHE_DURATION) {
      return data;
    }
    localStorage.removeItem(CATEGORY_HISTORY_CACHE_KEY);
  } catch (e) {
    console.error('category history cache read error:', e);
    localStorage.removeItem(CATEGORY_HISTORY_CACHE_KEY);
  }
  return null;
}

function setCachedCategoryHistory(data) {
  try {
    localStorage.setItem(CATEGORY_HISTORY_CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
  } catch (e) {
    console.error('category history cache write error:', e);
  }
}

function clearCategoryHistoryCache() {
  localStorage.removeItem(CATEGORY_HISTORY_CACHE_KEY);
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

  // Load category history for insights (non-blocking, loads in parallel)
  loadCategoryHistory();

  // Add event listener for optional fields
  $(document).on('change', '.field-checkbox', function() {
    renderTransactionTable();
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
  const start = new Date();
  const today = new Date();
  
  today.setHours(0, 0, 0, 0);
  start.setDate(today.getDate() - 90);
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
    clearAccountsCache();
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

async function loadAccounts(skipCache = false) {
  try {
    if (!skipCache) {
      const cached = getCachedAccounts();
      if (cached) {
        accounts = cached;
        renderAccountSelector();
        showStatus('Loaded accounts from cache', 'info');
        setTimeout(() => clearStatus(), 1500);
        return;
      }
    }

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
    setCachedAccounts(accounts);
    
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
        clearAccountsCache();
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

async function performSync(accountIds, startDate, endDate, activate = false) {
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
      activate: activate
    })
  });
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error);
  }
  
  return data;
}

async function syncTransactions() {
  // This function is called when user manually clicks a sync button (if we keep one)
  // For now, syncing happens automatically on page load via autoSyncAndLoadTransactions()
  // Force network path on manual sync
  clearTransactionsCache();
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
  
  // Validate date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  
  if (daysDiff < 1 || daysDiff > 90) {
    showStatus('Date range must be between 1 and 90 days', 'error');
    return;
  }
  
  try {
    // If we have fresh cached transactions and not forcing network, use cache and skip backend calls
    if (!forceNetwork) {
      const cached = getCachedTransactions();
      if (cached) {
        transactions = cached;
        renderTransactionTable();
        showStatus(`Loaded ${transactions.length} transactions from cache`, 'info');
        setTimeout(() => clearStatus(), 1500);
        return;
      }
    }

    showStatus('Syncing transactions from Plaid...', 'info');
    
    const syncData = await performSync(selectedAccounts, startDate, endDate);
    let successMsg = `Synced ${syncData.synced_count || 0} transactions (${syncData.new_count || 0} new, ${syncData.updated_count || 0} updated)`;
    showStatus(successMsg, 'info');
    synced = true;
    
    // Now fetch all transactions from backend (no filters, frontend handles all filtering)
    await fetchAllTransactions(true); // force network fetch after sync
    
  } catch (error) {
    showStatus(`Sync failed: ${error.message}`, 'error');
    // Still try to load cached transactions so the user sees something
    await fetchAllTransactions(false);
  }
}

async function fetchAllTransactions(forceNetwork = false) {
  // Fetch all transactions for the user (backend returns all, frontend filters)
  try {
    if (!forceNetwork) {
      const cached = getCachedTransactions();
      if (cached) {
        transactions = cached;
        renderTransactionTable();
        showStatus(`Loaded ${transactions.length} total transactions (cached)`, 'success');
        setTimeout(() => clearStatus(), 1500);
        return;
      }
    }

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
    setCachedTransactions(transactions);
    renderTransactionTable();
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
  
  // Add optional headers
  if (optionalFields.includes('merchant_name')) html += '<th>Merchant</th>';
   if (optionalFields.includes('category')) {
     html += '<th>Category (Primary)</th>';
     html += '<th>Category (Detailed)</th>';
     html += '<th>Confidence</th>';
   }
  if (optionalFields.includes('payment_channel')) html += '<th>Channel</th>';
  if (optionalFields.includes('pending')) html += '<th>Pending</th>';
  if (optionalFields.includes('check_number')) html += '<th>Check #</th>';
  if (optionalFields.includes('original_description')) html += '<th>Original Desc</th>';
  if (optionalFields.includes('authorized_date')) html += '<th>Auth Date</th>';
  if (optionalFields.includes('authorized_datetime')) html += '<th>Auth Time</th>';

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

    // Add optional cells
    if (optionalFields.includes('merchant_name')) html += `<td>${txn.merchant_name || ''}</td>`;
    if (optionalFields.includes('category')) {
         // Use new personal_finance_category if available, otherwise fallback to legacy category
        const pfc = txn.personal_finance_category;
        if (pfc) {
          const primary = (pfc.primary || '').replace(/_/g, ' ').trim();
          const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
          // Remove the primary phrase if it prefixes detailed; otherwise drop first token
          let detailed = detailedRaw;
          if (primary && detailedRaw.toLowerCase().startsWith(primary.toLowerCase() + ' ')) {
            detailed = detailedRaw.slice(primary.length).trim();
          } else {
            detailed = detailedRaw.replace(/^\S+\s*/, '').trim();
          }
          const confidence = (pfc.confidence_level || '').replace(/_/g, ' ');
           html += `<td>${primary}</td>`;
           html += `<td>${detailed}</td>`;
           html += `<td>${confidence}</td>`;
         } else {
           // Fallback to legacy category format
           let cat = txn.category;
           if (typeof cat === 'string' && cat.startsWith('{')) {
             cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
           } else if (Array.isArray(cat)) {
             cat = cat.join(', ');
           }
           html += `<td colspan="3">${cat || ''}</td>`;
         }
    }
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

    html += '</tr>';
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
  document.getElementById('export-buttons').classList.remove('hidden');
  
  // Update chart visualization
  renderCategoryChart();
  
  // Update insights panel
  renderInsightsPanel();
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
    clearAccountsCache();
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
    
    const settings = {
      optional_fields: optionalFields,
      field_order: ['datetime', 'bank_account', 'name', 'amount', ...optionalFields],
      timezone: timezone,
      hide_transfers: hideTransfers
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
    
    clearSettingsCache();
    setCachedSettings(settings);
    
    showStatus('Settings saved successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus(`Failed to save settings: ${error.message}`, 'error');
  }
}

async function loadSettings(skipCache = false) {
  try {
    if (!skipCache) {
      const cachedSettings = getCachedSettings();
      if (cachedSettings) {
        applySettings(cachedSettings);
        return;
      }
    }
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transaction_viewer_settings`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error('Failed to load settings');
    }
    
    const settings = await response.json();
    setCachedSettings(settings);
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
}

// ===============================
// CATEGORY HISTORY & INSIGHTS
// ===============================

async function loadCategoryHistory() {
  try {
    // Check cache first
    const cached = getCachedCategoryHistory();
    if (cached) {
      categoryHistory = cached;
      console.log('Category history loaded from cache');
      return;
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/category-history`, {
      method: 'GET'
    });

    if (!response.ok) {
      console.warn('Failed to load category history');
      return;
    }

    const data = await response.json();
    if (data.success && data.data) {
      categoryHistory = data;
      setCachedCategoryHistory(data);
      console.log('Category history loaded successfully');
    }
  } catch (error) {
    console.error('Error loading category history:', error);
  }
}

function generateSpendingInsights() {
  // Generate statistical insights based on filtered transactions and historical data
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingCheckbox = document.querySelector('.field-checkbox[value="pending"]:checked');
  const hideTransfers = document.getElementById('hide-transfers').checked;

  // Get filtered transactions (same filter as table)
  const filteredTransactions = transactions.filter(txn => {
    if (txn.date < startDate || txn.date > endDate) return false;
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.plaid_account_id)) return false;
    if (txn.pending && !showPendingCheckbox) return false;
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) return false;
    }
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

  // Insight 5: Period-over-period comparison (if history available)
  if (categoryHistory && categoryHistory.data && categoryHistory.data.length >= 2) {
    const latestPeriod = categoryHistory.summary.latest_period;
    if (latestPeriod && topCategories.length > 0) {
      const topCat = topCategories[0];
      const historicalAmount = latestPeriod.categories[topCat.name] || 0;
      
      if (historicalAmount > 0) {
        const change = ((topCat.total - historicalAmount) / historicalAmount) * 100;
        const direction = change > 0 ? '📈' : '📉';
        const arrow = change > 0 ? 'up' : 'down';
        
        if (Math.abs(change) > 25) { // Only show if change is >25%
          insights.push({
            icon: direction,
            label: 'Unusual Activity',
            value: `${topCat.name} ${arrow} ${Math.abs(change).toFixed(0)}% vs previous period`,
            highlight: true
          });
        }
      }
    }
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
        
        if (detailedRaw) {
          // Remove primary prefix from detailed
          if (primaryRaw && detailedRaw.toLowerCase().startsWith(primaryRaw.toLowerCase() + ' ')) {
            // categoryKey = detailedRaw.slice(primaryRaw.length).trim();
            categoryKey = detailedRaw
          } else {
            categoryKey = detailedRaw.replace(/^\S+\s*/, '').trim();
          }
          
          if (!categoryKey) {
            categoryKey = detailedRaw;
          }
        } else if (primaryRaw) {
          categoryKey = primaryRaw;
        }
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
