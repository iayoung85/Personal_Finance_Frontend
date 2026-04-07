/**
 * All backend API calls for the index/dashboard page.
 * No DOM manipulation here — returns data or throws errors for callers to handle.
 */

const IndexApi = (() => {

  /**
   * Wrapper that attaches the auth header and handles 401 → silent token refresh.
   * Every authenticated call in this module should go through this.
   */
  async function authenticatedFetch(url, options = {}) {
    const headers = {
      'Authorization': `Bearer ${IndexState.getAuthToken()}`,
      'ngrok-skip-browser-warning': 'true', // Bypass ngrok's interstitial on localhost
      ...options.headers,
    };
    const response = await fetch(url, { ...options, headers, cache: 'no-cache' });

    if (response.status === 401) {
      const refreshed = await _refreshAccessToken();
      if (refreshed) {
        headers['Authorization'] = `Bearer ${IndexState.getAuthToken()}`;
        return fetch(url, { ...options, headers, cache: 'no-cache' });
      }
    }
    return response;
  }

  /** Silent access-token refresh using the stored refresh token. */
  async function _refreshAccessToken() {
    const currentRefreshToken = IndexState.getRefreshToken();
    if (!currentRefreshToken) return false;

    try {
      const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: currentRefreshToken }),
        cache: 'no-cache',
      });
      if (!response.ok) return false;

      const data = await response.json();
      IndexState.setAccessToken(data.access_token);
      if (data.refresh_token) {
        IndexState.setRefreshToken(data.refresh_token);
      }
      return true;
    } catch (_networkError) {
      return false;
    }
  }

  // ── Auth endpoints ──────────────────────────────────────

  async function login(email, password, totpCode = null) {
    const body = { email, password };
    if (totpCode) body.totp_code = totpCode;

    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(body),
      cache: 'no-cache',
    });
    const data = await response.json();
    return { ok: response.ok, data };
  }

  async function register(payload) {
    const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(payload),
      cache: 'no-cache',
    });
    const data = await response.json();
    return { ok: response.ok, data };
  }

  async function checkRegistrationStatus() {
    const response = await fetch(`${BACKEND_URL}/api/auth/registration-status`, {
      headers: { 'ngrok-skip-browser-warning': 'true' },
      cache: 'no-cache',
    });
    const data = await response.json();
    return { ok: response.ok, data };
  }

  async function forgotPassword(email, frontendUrl) {
    const response = await fetch(`${BACKEND_URL}/api/auth/forgot_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ email, frontend_url: frontendUrl }),
      cache: 'no-cache',
    });
    const data = await response.json();
    return { ok: response.ok, data };
  }

  // ── Dashboard data endpoints ────────────────────────────

  /** Fetch non-archived banks from the accounts module. */
  async function fetchBanks() {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/banks`,
      { method: 'GET' }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to load banks');
    }
    const data = await response.json();
    return data.banks || [];
  }

  /** Fetch Plaid item summaries from the connections module. */
  async function fetchPlaidItems() {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/connections/items`,
      { method: 'GET' }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to load Plaid items');
    }
    const data = await response.json();
    return data.items || [];
  }

  /**
   * Fetch banks and Plaid items in parallel then merge Plaid metadata onto
   * each bank by plaid_item_id. Returns an enriched banks array with
   * billed_products and plaid_item_status added to linked banks.
   */
  async function fetchDashboardBanks() {
    const [banks, plaidItems] = await Promise.all([fetchBanks(), fetchPlaidItems()]);

    // Build a lookup: plaid_item_id → item summary
    const itemsByPlaidId = {};
    for (const item of plaidItems) {
      itemsByPlaidId[item.plaid_item_id] = item;
    }

    // Enrich each bank with its Plaid item data (when linked)
    return banks.map(bank => {
      const plaidItem = itemsByPlaidId[bank.plaid_item_id];
      return {
        ...bank,
        billed_products: plaidItem?.billed_products || [],
        available_products: plaidItem?.available_products || [],
        plaid_item_status: plaidItem?.status || null,
      };
    });
  }

  // ── Plaid connection endpoints ──────────────────────────

  /**
   * Create a Plaid Link token.
   * @param {Object} options
   * @param {string|null} options.itemId  - Pass for update mode (fix broken connection).
   * @param {string|null} options.bankId  - Pass for relink mode (reconnect converted/manual bank).
   * @param {string|null} options.mode    - 'investments_only' for investment-focused new connections.
   * @param {string|null} options.institutionId - Pre-selected institution for banks without one.
   */
  async function fetchLinkToken({ itemId = null, bankId = null, mode = null, institutionId = null } = {}) {
    let url = `${BACKEND_URL}/api/connections/create_link_token`;
    const params = [];
    if (itemId) params.push(`item_id=${encodeURIComponent(itemId)}`);
    if (bankId) params.push(`bank_id=${encodeURIComponent(bankId)}`);
    if (mode) params.push(`mode=${encodeURIComponent(mode)}`);
    if (institutionId) params.push(`institution_id=${encodeURIComponent(institutionId)}`);
    if (params.length) url += `?${params.join('&')}`;

    const response = await authenticatedFetch(url, { method: 'GET' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to fetch link token');
    }
    const data = await response.json();
    return data.link_token;
  }

  /**
   * Exchange Plaid public token for access token.
   * @param {string} publicToken - From Plaid Link onSuccess callback.
   * @param {string|null} relinkBankId - If relinking, the bank_id to reattach to.
   */
  async function exchangePublicToken(publicToken, relinkBankId = null) {
    const body = { public_token: publicToken };
    if (relinkBankId) body.bank_id = relinkBankId;

    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/set_access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to connect bank');
    }
    return data;
  }

  async function refreshItemAccounts(itemId) {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/refresh_item_accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  }

  /**
   * Disconnect / convert / archive / delete a bank.
   * @param {string} bankId - The bank_id to act on.
   * @param {string} mode - 'convert' | 'archive' | 'delete'.
   * @param {string|null} itemId - Optional plaid_item_id (for convert/archive of linked banks).
   */
  async function removeBank(bankId, mode = 'convert', itemId = null) {
    const body = { bank_id: bankId, mode };
    if (itemId) body.item_id = itemId;

    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/remove_item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return { ok: response.ok, data };
  }

  /**
   * Confirm user-driven account matching after a relink or update-mode refresh.
   * @param {string} bankId - The bank_id whose accounts are being matched.
   * @param {Array<{existing_account_id: string, plaid_account_id: string}>} matches
   *   Each element pairs an orphaned existing account with a Plaid account.
   * @param {Array<string>} [orphanedAccountIds] - Orphaned account IDs to
   *   downgrade to converted status (not matched by the user).
   * @returns {Promise<Object>} Reconciliation stats from the backend.
   */
  async function confirmAccountMatching(bankId, matches, orphanedAccountIds = []) {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/banks/${encodeURIComponent(bankId)}/confirm-account-matching`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches, orphaned_account_ids: orphanedAccountIds }),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to confirm account matching');
    }
    return data;
  }

  /**
   * Skip account matching — keep accounts separate, downgrade orphans.
   * @param {string} bankId
   * @param {Array<string>} [orphanedAccountIds] - Orphaned account IDs to
   *   downgrade to converted status.
   */
  async function skipAccountMatching(bankId, orphanedAccountIds = []) {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/banks/${encodeURIComponent(bankId)}/skip-account-matching`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orphaned_account_ids: orphanedAccountIds }),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to skip account matching');
    }
    return data;
  }

  async function activateTransactions(bankId) {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/connections/banks/${encodeURIComponent(bankId)}/activate-transactions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to activate transactions');
    }
    return data;
  }

  async function activateInvestments(itemId) {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/investments/sync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, activate: true }),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to activate investments');
    }
    return data;
  }

  async function retryInitialSync(bankId) {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/connections/banks/${encodeURIComponent(bankId)}/retry-initial-sync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to retry initial sync');
    }
    return data;
  }

  async function fetchPendingAccountMatching(bankId) {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/banks/${encodeURIComponent(bankId)}/pending-account-matching`,
      { method: 'GET' },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch pending account matching');
    }
    return data;
  }

  async function retryRelink(bankId) {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/connections/banks/${encodeURIComponent(bankId)}/retry-relink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to retry relink');
    }
    return data;
  }

  // ── Expose for other modules ────────────────────────────

  async function transitionToInvestment(accountId, subcategory = 'brokerage') {
    const body = {};
    if (subcategory) body.account_subcategory = subcategory;

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/${encodeURIComponent(accountId)}/transition-to-investment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to transition account to investment');
    }
    return data;
  }

  async function transitionToDepository(accountId, openingBalanceAmount, openingBalanceDate, subcategory = 'savings') {
    const body = {
      opening_balance_amount: openingBalanceAmount,
      opening_balance_date: openingBalanceDate,
    };
    if (subcategory) body.account_subcategory = subcategory;

    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/${encodeURIComponent(accountId)}/transition-to-depository`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to transition account to depository');
    }
    return data;
  }

  return {
    authenticatedFetch,
    login,
    register,
    checkRegistrationStatus,
    forgotPassword,
    fetchBanks,
    fetchPlaidItems,
    fetchDashboardBanks,
    fetchLinkToken,
    exchangePublicToken,
    refreshItemAccounts,
    removeBank,
    confirmAccountMatching,
    skipAccountMatching,
    activateTransactions,
    activateInvestments,
    fetchPendingAccountMatching,
    retryRelink,
    retryInitialSync,
    transitionToInvestment,
    transitionToDepository,
  };
})();
