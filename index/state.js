/**
 * Global UI state for the index/dashboard page.
 * Single source of truth for auth tokens, current user, cached bank data, and view state.
 * All other modules read/write through these accessors — no direct localStorage access elsewhere.
 */

const IndexState = (() => {
  let authToken = localStorage.getItem('authToken');
  let refreshToken = localStorage.getItem('refreshToken');
  let currentUser = null;
  let tempLoginCreds = null;
  let banksCache = [];

  function _parseStoredUser() {
    try {
      return JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch (parseError) {
      console.error('Error parsing currentUser from localStorage', parseError);
      localStorage.removeItem('currentUser');
      return null;
    }
  }

  currentUser = _parseStoredUser();

  return {
    getAuthToken() { return authToken; },
    getRefreshToken() { return refreshToken; },
    getCurrentUser() { return currentUser; },
    getTempLoginCreds() { return tempLoginCreds; },
    getBanksCache() { return banksCache; },

    /** Re-read tokens and user from localStorage (after external writes like config.js dev session). */
    refreshAuthState() {
      authToken = localStorage.getItem('authToken');
      refreshToken = localStorage.getItem('refreshToken');
      currentUser = _parseStoredUser();
    },

    /** Persist a successful login response into state + localStorage. */
    setAuthFromLogin(data) {
      authToken = data.access_token;
      refreshToken = data.refresh_token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
    },

    /** Update just the access token (after a silent refresh). */
    setAccessToken(token) {
      authToken = token;
      localStorage.setItem('authToken', authToken);
    },

    /** Update the refresh token (when backend issues a rotated one). */
    setRefreshToken(token) {
      refreshToken = token;
      localStorage.setItem('refreshToken', refreshToken);
    },

    setTempLoginCreds(creds) { tempLoginCreds = creds; },
    clearTempLoginCreds() { tempLoginCreds = null; },

    setBanksCache(banks) { banksCache = banks; },

    /** Wipe all auth state — used on logout. */
    clearAll() {
      authToken = null;
      refreshToken = null;
      currentUser = null;
      tempLoginCreds = null;
      banksCache = [];
      localStorage.removeItem('authToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('currentUser');
      localStorage.removeItem(ITEM_INFO_CACHE_KEY);
    },

    isLoggedIn() {
      return Boolean(authToken && currentUser);
    },
  };
})();
