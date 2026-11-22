// ============================================================
// excel/api.js — every call the Excel panel makes to the API
//
// Sign-in uses the same endpoint and the same stored keys as the
// web client's sign-in, so the session renews through
// shared/auth-session.js like every other page. Against the dev
// API, config.js fabricates the dev session and no sign-in shows.
//
// Dependencies: config.js (BACKEND_URL), shared/auth-session.js
// (renewSessionAfter401), excel/constants.js, excel/default-range.js.
//
// authenticatedFetch keeps its shared name on purpose:
// config-helpers.js's initAppConfig looks for it to load the
// user's preferences.
// ============================================================

const _EXCEL_ACCESS_TOKEN_KEY = 'authToken';
const _EXCEL_REFRESH_TOKEN_KEY = 'refreshToken';
const _EXCEL_USER_KEY = 'currentUser';

/**
 * Whether a session is stored. It may still be refused; the first call finds
 * out and renews or signs out.
 *
 * @returns {boolean}
 */
function excelHasSession() {
  return Boolean(localStorage.getItem(_EXCEL_ACCESS_TOKEN_KEY));
}

/**
 * fetch with the stored access token, renewing it once on a 401.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
async function authenticatedFetch(url, options = {}) {
  const sentToken = localStorage.getItem(_EXCEL_ACCESS_TOKEN_KEY);
  const headers = { Authorization: `Bearer ${sentToken}`, ...options.headers };
  const response = await fetch(url, { ...options, headers, cache: 'no-cache' });

  if (response.status === 401) {
    const renewedToken = await renewSessionAfter401(sentToken);
    if (renewedToken) {
      headers.Authorization = `Bearer ${renewedToken}`;
      return fetch(url, { ...options, headers, cache: 'no-cache' });
    }
  }
  return response;
}

async function _excelReadJson(response) {
  try {
    return await response.json();
  } catch (_parseError) {
    return {};
  }
}

/**
 * POST /api/auth/login. With two-factor turned on the first answer asks for
 * the code; the same call is sent again with it.
 *
 * @param {string} email
 * @param {string} password
 * @param {string} [totpCode]
 * @returns {Promise<{ok: boolean, needsCode: boolean, error: string|null}>}
 */
async function excelSignIn(email, password, totpCode) {
  const body = { email, password };
  if (totpCode) body.totp_code = totpCode;

  const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-cache',
  });
  const data = await _excelReadJson(response);

  if (response.ok && data.require_2fa) return { ok: false, needsCode: true, error: null };
  if (!response.ok || !data.access_token) {
    return { ok: false, needsCode: false, error: data.error || `Sign-in failed (${response.status}).` };
  }

  localStorage.setItem(_EXCEL_ACCESS_TOKEN_KEY, data.access_token);
  localStorage.setItem(_EXCEL_REFRESH_TOKEN_KEY, data.refresh_token || '');
  localStorage.setItem(_EXCEL_USER_KEY, JSON.stringify(data.user || null));
  return { ok: true, needsCode: false, error: null };
}

/** Forget the stored session in this panel. */
function excelSignOut() {
  localStorage.removeItem(_EXCEL_ACCESS_TOKEN_KEY);
  localStorage.removeItem(_EXCEL_REFRESH_TOKEN_KEY);
  localStorage.removeItem(_EXCEL_USER_KEY);
}

async function _excelGetReport(path, params) {
  const response = await authenticatedFetch(`${BACKEND_URL}${path}?${new URLSearchParams(params)}`);
  const body = await _excelReadJson(response);
  if (!response.ok) throw new Error(body.error || `Server error (${response.status})`);
  return body;
}

/**
 * GET /api/reports/balance, monthly, with the options the workbook was built
 * around: zero-balance accounts kept, archived accounts left out.
 *
 * @param {string} startMonth - YYYY-MM
 * @param {string} endMonth - YYYY-MM
 * @returns {Promise<Object>}
 */
function fetchExcelBalanceReport(startMonth, endMonth) {
  const { startDate, endDate } = monthRangeToDates(startMonth, endMonth);
  return _excelGetReport('/api/reports/balance', {
    start_date: startDate,
    end_date: endDate,
    interval: 'monthly',
    hide_zero_balance: String(EXCEL_REPORT_OPTIONS.hideZeroBalance),
    include_archived: String(EXCEL_REPORT_OPTIONS.includeArchived),
  });
}

/**
 * GET /api/reports/category, monthly, transfers left out.
 *
 * @param {string} startMonth - YYYY-MM
 * @param {string} endMonth - YYYY-MM
 * @returns {Promise<Object>}
 */
function fetchExcelCategoryReport(startMonth, endMonth) {
  const { startDate, endDate } = monthRangeToDates(startMonth, endMonth);
  return _excelGetReport('/api/reports/category', {
    start_date: startDate,
    end_date: endDate,
    interval: 'monthly',
    include_transfers: String(EXCEL_REPORT_OPTIONS.includeTransfers),
  });
}

/**
 * GET /api/budget/targets: the editable years, each year's targets, and the
 * categories that can take one.
 *
 * @returns {Promise<Object>}
 */
function fetchExcelTargets() {
  return _excelGetReport('/api/budget/targets', {});
}

/**
 * PUT /api/budget/targets/<fiscalYear>. The body replaces the year's whole set.
 *
 * @param {number} fiscalYear
 * @param {Array<{category: string, cadence: string, amount: string}>} targets
 * @returns {Promise<{ok: boolean, status: number, body: Object}>} body is the saved year, or the refusal
 */
async function saveExcelTargets(fiscalYear, targets) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/budget/targets/${encodeURIComponent(fiscalYear)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    },
  );
  return { ok: response.ok, status: response.status, body: await _excelReadJson(response) };
}
