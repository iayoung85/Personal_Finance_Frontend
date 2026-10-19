// ============================================================
// shared/auth-session.js
// Shared session renewal: one token refresh at a time, and the
// same sign-out on every page when the server refuses it.
//
// Dependencies (must be present as globals before this file loads):
//   BACKEND_URL — from config.js (read when a refresh runs)
//
// Exports (globals):
//   renewSessionAfter401(rejectedToken)
//   takeSessionExpiredNotice()
// ============================================================

// ── Storage Keys ─────────────────────────────────────────────
const _SESSION_ACCESS_TOKEN_KEY = 'authToken';
const _SESSION_REFRESH_TOKEN_KEY = 'refreshToken';
const _SESSION_USER_KEY = 'currentUser';
const _SESSION_EXPIRED_NOTICE_KEY = 'pf_session_expired_notice';

// Why: these mean the server read the refresh token and said no. Any other
// failure (offline, an API restart, rate limiting) keeps the session, so a
// network blip does not sign anyone out.
const _SESSION_REFUSED_STATUSES = [400, 401, 403, 404];

let _sessionRefreshInFlight = null;
let _sessionSignOutStarted = false;

// ── Internal: One Refresh Request ────────────────────────────

/**
 * Ask the API for a new access token using the stored refresh token.
 * @returns {Promise<{outcome: 'renewed'|'refused'|'unreachable', accessToken?: string}>}
 */
async function _requestSessionRefresh() {
  const storedRefreshToken = localStorage.getItem(_SESSION_REFRESH_TOKEN_KEY);
  if (!storedRefreshToken) return { outcome: 'refused' };

  let response;
  try {
    response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: storedRefreshToken }),
      cache: 'no-cache',
    });
  } catch (networkError) {
    console.error('[auth-session] Token refresh failed:', networkError);
    return { outcome: 'unreachable' };
  }

  if (!response.ok) {
    const refused = _SESSION_REFUSED_STATUSES.includes(response.status);
    return { outcome: refused ? 'refused' : 'unreachable' };
  }

  try {
    const data = await response.json();
    if (!data.access_token) return { outcome: 'unreachable' };
    localStorage.setItem(_SESSION_ACCESS_TOKEN_KEY, data.access_token);
    if (data.refresh_token) {
      localStorage.setItem(_SESSION_REFRESH_TOKEN_KEY, data.refresh_token);
    }
    return { outcome: 'renewed', accessToken: data.access_token };
  } catch (parseError) {
    console.error('[auth-session] Token refresh returned an unreadable body:', parseError);
    return { outcome: 'unreachable' };
  }
}

// ── Internal: Sign-Out ───────────────────────────────────────

/** Clear the stored session and open the login screen, which then says why. */
function _signOutExpiredSession() {
  if (_sessionSignOutStarted) return;
  _sessionSignOutStarted = true;
  localStorage.removeItem(_SESSION_ACCESS_TOKEN_KEY);
  localStorage.removeItem(_SESSION_REFRESH_TOKEN_KEY);
  localStorage.removeItem(_SESSION_USER_KEY);
  try {
    sessionStorage.setItem(_SESSION_EXPIRED_NOTICE_KEY, '1');
  } catch (_) { /* the notice is a courtesy; the sign-out still happens */ }
  window.location.href = 'index.html';
}

// ── Public ───────────────────────────────────────────────────

/**
 * Renew the session after the API answered 401. Requests that hit a 401 while
 * a refresh is running wait for that same refresh, so a burst of 401s sends
 * one refresh request. When the server refuses the refresh token, this signs
 * out and opens the login screen.
 * @param {string|null} rejectedToken - The access token the failed request carried.
 * @returns {Promise<string|null>} The access token to retry with, or null to give up.
 */
async function renewSessionAfter401(rejectedToken) {
  const storedAccessToken = localStorage.getItem(_SESSION_ACCESS_TOKEN_KEY);
  // Why: a refresh already landed after this request went out, in this page
  // or another tab, so the stored token is newer than the one refused.
  if (storedAccessToken && storedAccessToken !== rejectedToken) {
    return storedAccessToken;
  }

  if (!_sessionRefreshInFlight) {
    _sessionRefreshInFlight = _requestSessionRefresh().finally(() => {
      _sessionRefreshInFlight = null;
    });
  }
  const { outcome, accessToken } = await _sessionRefreshInFlight;

  if (outcome === 'renewed') return accessToken;
  if (outcome === 'refused') _signOutExpiredSession();
  return null;
}

/**
 * Whether the login screen should say the session expired. True once per
 * sign-out, so a later visit to the login screen stays quiet.
 * @returns {boolean}
 */
function takeSessionExpiredNotice() {
  try {
    const noticePending = sessionStorage.getItem(_SESSION_EXPIRED_NOTICE_KEY) === '1';
    sessionStorage.removeItem(_SESSION_EXPIRED_NOTICE_KEY);
    return noticePending;
  } catch (_) {
    return false;
  }
}
