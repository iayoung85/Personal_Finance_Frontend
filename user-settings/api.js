// ============================================================
// user-settings/api.js — Auth & Backend Communication
// Owns authenticatedFetch, token refresh, logout, and thin
// wrappers for backend endpoints that return raw data objects.
// No DOM manipulation in this file.
// ============================================================

/**
 * Attempts to refresh the access token using the stored
 * refresh token. Logs out and returns false on any failure.
 *
 * @returns {Promise<boolean>} True if refresh succeeded
 */
async function refreshAccessToken() {
  if (!refreshToken) {
    logout();
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
      authToken = data.access_token;
      localStorage.setItem('authToken', authToken);

      if (data.refresh_token) {
        refreshToken = data.refresh_token;
        localStorage.setItem('refreshToken', refreshToken);
      }

      return true;
    } else {
      logout();
      return false;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    logout();
    return false;
  }
}

/**
 * Wraps fetch with Bearer auth header. Automatically retries
 * once after a 401 via refreshAccessToken.
 *
 * @param {string} url     - Target URL
 * @param {object} options - Standard fetch options
 * @returns {Promise<Response>}
 */
async function authenticatedFetch(url, options = {}) {
  const headers = {
    'ngrok-skip-browser-warning': 'true',
    'Authorization': `Bearer ${authToken}`,
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();

    if (refreshed) {
      headers['Authorization'] = `Bearer ${authToken}`;
      return fetch(url, { ...options, headers });
    }
  }

  return response;
}

/**
 * Clears all stored auth data and redirects to the login page.
 */
function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  authToken = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// ── Thin API call wrappers ────────────────────────────────────
// These return the parsed JSON data object (throwing on network
// errors) so that render modules never need to call fetch
// directly.

/**
 * Fetches account deletion pending status for the current user.
 *
 * @returns {Promise<{pending: boolean, token_expires_at?: string}>}
 */
async function fetchDeletionStatus() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/deletion-status`, { method: 'GET' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch deletion status');
  }
  return data;
}
