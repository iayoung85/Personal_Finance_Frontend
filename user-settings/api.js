// ============================================================
// user-settings/api.js — Auth & Backend Communication
// Owns authenticatedFetch, token refresh, logout, and thin
// wrappers for backend endpoints that return raw data objects.
// No DOM manipulation in this file.
// ============================================================

/**
 * Wraps fetch with Bearer auth header. Retries once after a 401
 * with a renewed token from shared/auth-session.js.
 *
 * @param {string} url     - Target URL
 * @param {object} options - Standard fetch options
 * @returns {Promise<Response>}
 */
async function authenticatedFetch(url, options = {}) {
  const sentToken = authToken;
  const headers = {
    'Authorization': `Bearer ${sentToken}`,
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const renewedToken = await renewSessionAfter401(sentToken);

    if (renewedToken) {
      authToken = renewedToken;
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
