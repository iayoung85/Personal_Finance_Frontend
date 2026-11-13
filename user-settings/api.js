// ============================================================
// user-settings/api.js — Auth & Backend Communication
// Owns authenticatedFetch, token refresh, and logout.
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
