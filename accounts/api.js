// ============================================================
// accounts/api.js — Backend Communication
// All network calls for the accounts page. No DOM rendering
// here — just fetch, parse, return. Uses authenticatedFetch()
// for automatic 401 retry. Loaded after state.js.
// ============================================================

function refreshAuthState() {
  token = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (parseError) {
    console.error('Error parsing currentUser', parseError);
    currentUser = null;
  }
}

refreshAuthState();

async function refreshAccessToken() {
  if (!refreshToken) return false;
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
    }
    return false;
  } catch (networkError) {
    console.error('Token refresh failed:', networkError);
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
  if (window.LOCAL_AUTO_LOGIN_ENABLED) return;
  if (idleTimeout) clearTimeout(idleTimeout);
  if (token && currentUser) {
    idleTimeout = setTimeout(() => {
      localStorage.removeItem('authToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('currentUser');
      alert('You have been logged out due to inactivity.');
      window.location.href = 'index.html';
    }, IDLE_TIMEOUT);
  }
}

function setupActivityListeners() {
  if (window.LOCAL_AUTO_LOGIN_ENABLED) return;
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  events.forEach(eventName => {
    document.addEventListener(eventName, resetIdleTimeout, true);
  });
}

// ── Data Loading ─────────────────────────────────────────────

/**
 * Fetch all banks (with nested accounts) from the backend.
 * Populates banksCache and accountsCache.
 */
async function apiFetchBanks(includeArchived = true) {
  const url = `${BACKEND_URL}/api/accounts/banks?include_archived=${includeArchived}`;
  const response = await authenticatedFetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch banks');
  }
  const data = await response.json();
  return data.banks || [];
}

/**
 * Fetch available account categories and subcategories.
 */
async function apiFetchCategories() {
  const url = `${BACKEND_URL}/api/accounts/reference/categories`;
  const response = await fetch(url); // No auth required
  if (!response.ok) {
    throw new Error('Failed to fetch categories');
  }
  const data = await response.json();
  return data.categories || {};
}

/**
 * Fetch curated list of popular institutions for the official bank dropdown.
 * No auth required — reference data.
 */
async function apiFetchPopularInstitutions() {
  const url = `${BACKEND_URL}/api/accounts/reference/popular-institutions`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch popular institutions');
  }
  const data = await response.json();
  return data.institutions || [];
}

/**
 * Search institutions by name substring.
 * No auth required — reference data.
 * @param {string} query - Search term (min 2 characters)
 */
async function apiSearchInstitutions(query) {
  const url = `${BACKEND_URL}/api/accounts/reference/search-institutions?q=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to search institutions');
  }
  const data = await response.json();
  return data.institutions || [];
}

/**
 * Get a single account's full detail.
 */
async function apiFetchAccountDetail(accountId) {
  const url = `${BACKEND_URL}/api/accounts/${accountId}`;
  const response = await authenticatedFetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch account');
  }
  return await response.json();
}

// ── Account Mutations ────────────────────────────────────────

/**
 * Create a new manual account.
 */
async function apiCreateAccount(payload) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to create account');
  }
  return data;
}

/**
 * Update account fields (custom_name, account_category, account_subcategory, is_archived, notes, currency).
 */
async function apiUpdateAccount(accountId, fields) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update account');
  }
  return data;
}

/**
 * Soft-delete (archive) an account.
 */
async function apiArchiveAccount(accountId) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
    method: 'DELETE'
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to archive account');
  }
  return data;
}

/**
 * Reset balance history for an account (re-derive opening balance + rebuild ledger).
 * This is the lightweight version — re-derives without wiping transactions.
 */
async function apiResetBalanceHistory(accountId) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/reset-balance-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_id: accountId })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to reset balance history');
  }
  return data;
}

/**
 * Full account reset: wipe all transactions, history, snapshots and start fresh.
 * For Plaid-linked accounts: resets sync cursor, balance re-derives on next sync.
 * For manual accounts: accepts a new opening balance and date.
 */
async function apiResetAccount(accountId, openingBalance = null, openingBalanceDate = null) {
  const body = {};
  if (openingBalance !== null) body.opening_balance = openingBalance;
  if (openingBalanceDate !== null) body.opening_balance_date = openingBalanceDate;

  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to reset account');
  }
  return data;
}

/**
 * Hard-delete an account and all its transactions, history, snapshots.
 * Blocked for Plaid-linked accounts — archive or convert to manual first.
 */
async function apiHardDeleteAccount(accountId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/accounts/${accountId}?mode=delete`,
    { method: 'DELETE' }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to delete account');
  }
  return data;
}

// ── Bank Mutations ───────────────────────────────────────────

/**
 * Fetch a single bank's full detail (institution metadata, Plaid item info,
 * preserved metadata, account summary counts).
 */
async function apiFetchBankDetail(bankId) {
  const url = `${BACKEND_URL}/api/accounts/banks/${bankId}`;
  const response = await authenticatedFetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch bank detail');
  }
  return await response.json();
}

/**
 * Convert a Plaid-linked bank to manual mode (stops billing, preserves data).
 * Does NOT archive — the bank stays visible and usable in manual mode.
 */
async function apiConvertBankToManual(bankId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/accounts/banks/${bankId}/convert-to-manual`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to convert bank to manual');
  }
  return data;
}

/**
 * Update bank fields (custom_name, notes).
 */
async function apiUpdateBank(bankId, fields) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/banks/${bankId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update bank');
  }
  return data;
}

/**
 * Archive a bank (and cascade to all child accounts).
 * For Plaid-linked banks this converts to manual first.
 */
async function apiArchiveBank(bankId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/accounts/banks/${bankId}?mode=archive`,
    { method: 'DELETE' }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to archive bank');
  }
  return data;
}

/**
 * Hard-delete a bank and all its accounts + transactions. Irreversible.
 */
async function apiHardDeleteBank(bankId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/accounts/banks/${bankId}?mode=delete`,
    { method: 'DELETE' }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to delete bank');
  }
  return data;
}

/**
 * Unarchive a bank and all its child accounts.
 */
async function apiUnarchiveBank(bankId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/accounts/banks/${bankId}/unarchive`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to unarchive bank');
  }
  return data;
}
