/**
 * Global UI state for the index/dashboard page.
 * Single source of truth for auth tokens, current user, cached bank data, and view state.
 * All other modules read/write through these accessors — no direct localStorage access elsewhere.
 */

const PAGE_OPENS_KEY = 'index_page_opens';
const PAGE_OPEN_WINDOW_MS = 10 * 1000;
const PAGE_OPEN_LIMIT = 5;

/**
 * Add one page open to the list of recent opens and decide whether the page
 * is being reopened in a loop.
 * @param {Array<number>|*} storedOpens - Earlier open times in ms since epoch; anything malformed is dropped.
 * @param {number} nowMs - Time of this open in ms since epoch.
 * @returns {{opens: Array<number>, tooOften: boolean}} The opens to store back, and whether
 *   more than PAGE_OPEN_LIMIT happened inside PAGE_OPEN_WINDOW_MS.
 */
function _trackPageOpen(storedOpens, nowMs) {
  const earlierOpens = Array.isArray(storedOpens) ? storedOpens : [];
  const recentOpens = earlierOpens.filter(openedAt => {
    if (typeof openedAt !== 'number') return false;
    const ageMs = nowMs - openedAt;
    return ageMs >= 0 && ageMs < PAGE_OPEN_WINDOW_MS;
  });
  recentOpens.push(nowMs);
  return { opens: recentOpens, tooOften: recentOpens.length > PAGE_OPEN_LIMIT };
}

// Why: Safari's Reading List fetcher once reopened this page in hidden views
// several times a second. These entries survive the reopens so the user can
// read them afterwards with:
//   console.table(JSON.parse(localStorage.index_open_diagnostics))
const OPEN_DIAGNOSTICS_KEY = 'index_open_diagnostics';
const OPEN_DIAGNOSTICS_MAX = 60;
const TAB_ID_KEY = 'index_tab_id';

/**
 * Append one diagnostic entry, keeping only the newest OPEN_DIAGNOSTICS_MAX.
 * @param {Array<Object>|*} storedEntries - Earlier entries; anything that is not an array is dropped.
 * @param {Object} entry - The entry to add.
 * @returns {Array<Object>} The entries to store back.
 */
function _appendOpenDiagnostic(storedEntries, entry) {
  const entries = Array.isArray(storedEntries) ? storedEntries : [];
  entries.push(entry);
  return entries.slice(-OPEN_DIAGNOSTICS_MAX);
}

/**
 * An id for this browser tab. sessionStorage lasts across reloads of one tab
 * but is separate per tab, so a changing id means a different copy of the page.
 * @returns {string}
 */
function _currentTabId() {
  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  return tabId;
}

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

    /**
     * Record that the page just opened. Opens are kept in localStorage, not
     * sessionStorage, so copies of the page the user cannot see are counted too.
     * @returns {boolean} true when the page is reopening too often to load automatically.
     */
    recordPageOpen() {
      try {
        const storedOpens = JSON.parse(localStorage.getItem(PAGE_OPENS_KEY) || '[]');
        const { opens, tooOften } = _trackPageOpen(storedOpens, Date.now());
        localStorage.setItem(PAGE_OPENS_KEY, JSON.stringify(opens));
        return tooOften;
      } catch (err) {
        console.warn('Failed to record page open', err);
        return false;
      }
    },

    /**
     * Log one page event (an open, a token refresh) with how the page was
     * reached, which tab it is in, and whether it is visible.
     * @param {string} event - Short event name, e.g. 'open' or 'refresh-ok'.
     */
    recordOpenDiagnostic(event) {
      try {
        const navigation = performance.getEntriesByType('navigation')[0];
        const entry = {
          at: new Date().toISOString(),
          event,
          tab: _currentTabId(),
          navType: navigation ? navigation.type : 'unknown',
          referrer: document.referrer || '',
          visibility: document.visibilityState,
          focused: document.hasFocus(),
          url: location.pathname + location.search + location.hash,
        };
        const storedEntries = JSON.parse(localStorage.getItem(OPEN_DIAGNOSTICS_KEY) || '[]');
        localStorage.setItem(OPEN_DIAGNOSTICS_KEY, JSON.stringify(_appendOpenDiagnostic(storedEntries, entry)));
      } catch (err) {
        console.warn('Failed to record open diagnostic', err);
      }
    },
    /**
     * Set a timestamp (ms since epoch) for an item action.
     * Keys are strictly `bank_action_timestamp:item:{plaid_item_id}:{action}`.
     * @param {string} itemId - Plaid item id (required)
     * @param {string} action - action name (e.g. 'initial_sync', 'relink')
     */
    setActionTimestamp(itemId, action) {
      if (!itemId) return;
      try {
        const storageKey = `bank_action_timestamp:item:${itemId}:${action}`;
        localStorage.setItem(storageKey, String(Date.now()));
      } catch (err) {
        console.error('Failed to set action timestamp', err);
      }
    },

    /**
     * Get a previously-stored action timestamp (ms since epoch) or null.
     * Expects `itemId` (plaid item id).
     */
    getActionTimestamp(itemId, action) {
      if (!itemId) return null;
      try {
        const storageKey = `bank_action_timestamp:item:${itemId}:${action}`;
        const v = localStorage.getItem(storageKey);
        return v ? parseInt(v, 10) : null;
      } catch (err) {
        console.error('Failed to read action timestamp', err);
        return null;
      }
    },

    /**
     * Clear an action timestamp for a specific item.
     */
    clearActionTimestamp(itemId, action) {
      if (!itemId) return;
      try {
        const storageKey = `bank_action_timestamp:item:${itemId}:${action}`;
        localStorage.removeItem(storageKey);
      } catch (err) {
        console.error('Failed to clear action timestamp', err);
      }
    },
  };
})();
