// ============================================================
// transactions/api.js — Auth & Backend Communication
// Authentication helpers, token refresh, and data-loading
// orchestration (sync, fetch). All network calls route through
// authenticatedFetch() for automatic 401 retry.
// ============================================================

function refreshAuthState() {
  token = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (e) {
    console.error('Error parsing currentUser', e);
    currentUser = null;
  }
}

// Re-read auth state on script load
refreshAuthState();

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
  if (window.LOCAL_AUTO_LOGIN_ENABLED) {
    return;
  }
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
  if (window.LOCAL_AUTO_LOGIN_ENABLED) {
    return;
  }
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
  // Clear date range memory on logout
  localStorage.removeItem('pf_date_range_preset');
  localStorage.removeItem('pf_date_range_start');
  localStorage.removeItem('pf_date_range_end');
  token = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// ===== Plaid Sync & Transaction Fetching =====

async function performSync(accountIds, startDate, endDate, activate = false, force = false) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/sync_transactions`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      activate: activate,
      force: force,
      sync_all: true
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
  
  // If no accounts selected, still try to fetch existing transactions from DB
  if (selectedAccounts.length === 0) {
    console.warn('No accounts selected - skipping sync, loading existing transactions only');
    await fetchAllTransactions(false);
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
      autoExtendEndDateForScheduled();
      renderTransactionTable();
      renderDynamicPeriodButtons();
      showStatus(`Loaded ${transactions.length} transactions from cache. Checking for updates...`, 'info');
    } catch (e) {
      console.error('Cache parse error, will fetch from server:', e);
    }
  }
  
  try {
    // Try to sync with Plaid first
    if (!forceNetwork && cacheValid) {
      showStatus('Checking for new transactions...', 'info');
    } else {
      showStatus('Syncing transactions from Plaid...', 'info');
    }
    
    const syncData = await performSync(selectedAccounts, startDate, endDate, false, forceNetwork);
    
    // Determine if we need to fetch from DB based on actual backend response fields
    const totalChanges = (syncData.added_count || 0) + (syncData.modified_count || 0) + (syncData.removed_count || 0);
    const shouldFetchFromDB = !cacheValid || totalChanges > 0 || forceNetwork;
    
    if (shouldFetchFromDB) {
      // No cache OR sync returned changes OR force requested → fetch from DB
      let successMsg = totalChanges > 0 
        ? `Synced ${totalChanges} transactions (${syncData.added_count || 0} new, ${syncData.modified_count || 0} updated, ${syncData.removed_count || 0} removed)`
        : 'Sync complete, loading transactions...';
      showStatus(successMsg, 'info');
      
      await fetchAllTransactions(true);
    } else {
      // Have valid cache AND no changes from Plaid → use cache
      const cooldownMsg = syncData.cooldown 
        ? ` (next sync available in ${syncData.seconds_until_next_sync}s)`
        : '';
      showStatus(`Transactions are up to date — ${transactions.length} loaded${cooldownMsg}`, 'success');
      setTimeout(() => clearStatus(), 3000);
    }
    
  } catch (error) {
    console.error('Sync error:', error);
    showStatus(`Sync failed: ${error.message}`, 'error');
    
    // Always try to fetch existing transactions from DB when sync fails
    // This ensures the page shows something even if Plaid sync fails
    try {
      await fetchAllTransactions(false);
    } catch (fetchError) {
      console.error('Failed to fetch transactions after sync error:', fetchError);
      showStatus(`Failed to load transactions: ${fetchError.message}`, 'error');
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
    
    autoExtendEndDateForScheduled(); // Extend end-date to show all scheduled future txns
    renderTransactionTable();
    renderDynamicPeriodButtons(); // Update period buttons when transactions change
    showStatus(`Loaded ${transactions.length} total transactions (filters applied on frontend)`, 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    showStatus(`Load failed: ${error.message}`, 'error');
  }
}

// ===== Balance History for Ledger Column =====

async function fetchBalanceHistory(accountId) {
  /**
   * Fetches all balance-history rows for a single account and builds
   * a lookup map: transactionId → running_balance (as a number).
   * Called when the user selects a single account in the sidebar.
   * The lookup is consumed by renderTransactionTable to populate
   * the "Balance Ledger" column.
   */
  if (!accountId) {
    balanceHistoryLookup = {};
    return;
  }

  balanceHistoryLoading = true;

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/${accountId}/balance-history?limit=10000`
    );

    if (!response.ok) {
      console.error('fetchBalanceHistory: non-OK response', response.status);
      balanceHistoryLookup = {};
      return;
    }

    const data = await response.json();
    const historyRows = data.balance_history || [];

    const lookup = {};
    historyRows.forEach(row => {
      const transactionKey = row.transaction_id;
      if (transactionKey) {
        lookup[transactionKey] = parseFloat(row.running_balance);
      }
    });

    balanceHistoryLookup = lookup;
    console.debug(
      `fetchBalanceHistory: loaded ${Object.keys(lookup).length} ledger entries for account ${accountId}`
    );

  } catch (error) {
    console.error('fetchBalanceHistory error:', error);
    balanceHistoryLookup = {};
  } finally {
    balanceHistoryLoading = false;
  }
}
