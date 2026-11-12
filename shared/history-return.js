// ============================================================
// shared/history-return.js
// What a page does when the browser brings it back through Back or Forward.
//
// Two ways a browser can return to a page, and both can show old data:
//   1. Restored whole from the back/forward cache. No script runs again, so
//      the page shows exactly what it showed when the user left. It reloads.
//   2. Run again from scratch on a history navigation. The browser prefers
//      its HTTP cache for everything the page requests during such a load,
//      so a plain GET can be answered without asking the API. For the life
//      of that page, GETs are sent with cache mode 'no-cache': the browser
//      keeps its copy but must check it with the server first.
//
// Requests that already carry their own validator (the transaction list's
// If-None-Match) are left alone: they never come from the HTTP cache.
//
// Load right after shared/auth-session.js, before any script that fetches.
//
// Exports (globals):
//   isHistoryReturnNavigation(navigationType)
//   shouldReloadOnPageShow(pageShowEvent)
//   historyReturnFetchInit(init)
// ============================================================

const _HISTORY_RETURN_FLAG_KEY = 'pf_history_return_reload';

/**
 * True when a navigation entry's type says the user came here with Back or Forward.
 * @param {string|undefined} navigationType 'navigate', 'reload', 'back_forward' or 'prerender'.
 * @returns {boolean}
 */
function isHistoryReturnNavigation(navigationType) {
  return navigationType === 'back_forward';
}

/**
 * True when a pageshow event is the browser restoring a page from its
 * back/forward cache. A first load and a reload both report persisted false,
 * so a reload can never trigger another one.
 * @param {{persisted?: boolean}|null|undefined} pageShowEvent
 * @returns {boolean}
 */
function shouldReloadOnPageShow(pageShowEvent) {
  return !!(pageShowEvent && pageShowEvent.persisted === true);
}

/**
 * True when the request headers already hold a conditional validator.
 * @param {HeadersInit|undefined} headers Plain object, Headers, or array of pairs.
 * @returns {boolean}
 */
function _historyReturnHasValidator(headers) {
  if (!headers) return false;
  const validatorNames = ['if-none-match', 'if-modified-since'];
  if (typeof headers.has === 'function') {
    return validatorNames.some(name => headers.has(name));
  }
  const names = Array.isArray(headers)
    ? headers.map(pair => String(pair[0]))
    : Object.keys(headers);
  return names.some(name => validatorNames.includes(name.toLowerCase()));
}

/**
 * The fetch options to use on a page that came back through history: the
 * caller's own options, with cache mode 'no-cache' added when the caller
 * chose no mode and sent no validator of its own.
 * @param {RequestInit|undefined} init
 * @returns {RequestInit}
 */
function historyReturnFetchInit(init) {
  const options = init || {};
  if (options.cache) return options;
  if (_historyReturnHasValidator(options.headers)) return options;
  return { ...options, cache: 'no-cache' };
}

/**
 * Send this page's requests through historyReturnFetchInit().
 * @param {Window} win
 */
function _installHistoryReturnFetch(win) {
  if (typeof win.fetch !== 'function') return;
  const originalFetch = win.fetch.bind(win);
  win.fetch = function(input, init) {
    // A Request object carries its own cache mode and headers.
    if (typeof Request !== 'undefined' && input instanceof Request) {
      return originalFetch(input, init);
    }
    return originalFetch(input, historyReturnFetchInit(init));
  };
}

/**
 * @param {Window} win
 * @returns {string|undefined} The navigation type of this page load.
 */
function _historyReturnNavigationType(win) {
  try {
    const entries = win.performance.getEntriesByType('navigation');
    return entries && entries[0] ? entries[0].type : undefined;
  } catch (error) {
    return undefined;
  }
}

/**
 * Read and clear the marker left by a back/forward-cache reload, so that
 * reload is treated as a history return too.
 * @param {Window} win
 * @returns {boolean}
 */
function _takeHistoryReturnFlag(win) {
  try {
    const wasSet = win.sessionStorage.getItem(_HISTORY_RETURN_FLAG_KEY) === '1';
    win.sessionStorage.removeItem(_HISTORY_RETURN_FLAG_KEY);
    return wasSet;
  } catch (error) {
    return false;
  }
}

/** @param {Window} win */
function _setHistoryReturnFlag(win) {
  try {
    win.sessionStorage.setItem(_HISTORY_RETURN_FLAG_KEY, '1');
  } catch (error) {
    // Without storage the reload still happens; it just uses the normal cache rules.
  }
}

/**
 * Wire the page. Called once at load.
 * @param {Window} win
 */
function _startHistoryReturnHandling(win) {
  const cameBackThroughHistory = isHistoryReturnNavigation(_historyReturnNavigationType(win));
  const reloadedForHistory = _takeHistoryReturnFlag(win);
  if (cameBackThroughHistory || reloadedForHistory) {
    _installHistoryReturnFetch(win);
  }

  win.addEventListener('pageshow', function(pageShowEvent) {
    if (!shouldReloadOnPageShow(pageShowEvent)) return;
    _setHistoryReturnFlag(win);
    win.location.reload();
  });
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  _startHistoryReturnHandling(window);
}
