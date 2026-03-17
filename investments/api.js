// ============================================================
// investments/api.js — All backend API calls
// Vanilla fetch only (no jQuery). Handles token refresh.
// ============================================================

async function authenticatedFetch(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshed = await _refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${authToken}`;
      return fetch(url, { ...options, headers });
    }
    window.location.href = 'index.html';
    throw new Error('Session expired');
  }

  return response;
}

async function _refreshAccessToken() {
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (response.ok) {
      const data = await response.json();
      authToken = data.access_token;
      localStorage.setItem('authToken', authToken);
      return true;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }
  return false;
}

async function fetchItemInfo(itemId) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/item_info`, {
      method: 'POST',
      body: JSON.stringify({ item_id: itemId })
    });
    if (!response.ok) throw new Error('Failed to fetch item info');
    return await response.json();
  } catch (error) {
    console.debug('fetchItemInfo error:', error);
    return { item_id: itemId, billed_products: [], available_products: [] };
  }
}

async function fetchAllAccounts() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.accounts || [];
}

async function fetchHoldings() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/holdings`);
  const data = await response.json();
  return data;
}

async function syncItemApi(itemId, activate = false) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/sync`, {
    method: 'POST',
    body: JSON.stringify({ item_id: itemId, activate: activate })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Sync failed');
  return data;
}

async function renameAccountApi(accountId, customName) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify({ custom_name: customName })
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to rename account');
  }
  return await response.json();
}

async function saveViewerSettings(optionalFields, fieldOrder) {
  return authenticatedFetch(`${BACKEND_URL}/api/investments/settings`, {
    method: 'POST',
    body: JSON.stringify({ optional_fields: optionalFields, field_order: fieldOrder })
  });
}

async function loadViewerSettings() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/settings`);
  return await response.json();
}

async function classifySecurityApi(securityId, sector, industry) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/investments/securities/${encodeURIComponent(securityId)}/classify`,
    {
      method: 'POST',
      body: JSON.stringify({ sector, industry }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Classification failed');
  return data;
}

async function fetchVocabulary() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/vocabulary`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to load vocabulary');
  return data;
}

async function fetchEtfExposure(tickers, values) {
  const tickersParam = tickers.join(',');
  const valuesParam = values.join(',');
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/investments/etf-exposure?tickers=${encodeURIComponent(tickersParam)}&values=${encodeURIComponent(valuesParam)}`
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to fetch ETF exposure');
  return data;
}

async function submitEtfHoldingsApi(etfTicker, etfName, holdings) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/etf-holdings`, {
    method: 'POST',
    body: JSON.stringify({ etf_ticker: etfTicker, etf_name: etfName, holdings }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to submit ETF holdings');
  return data;
}
