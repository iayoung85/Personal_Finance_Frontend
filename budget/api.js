// ============================================================
// budget/api.js — every Budget page call to the backend.
// All requests go through authenticatedFetch for the 401 retry.
// ============================================================

function refreshAuthState() {
  token = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (parseError) {
    console.error('Error parsing currentUser', parseError);
    currentUser = null;
  }
}

refreshAuthState();

async function authenticatedFetch(url, options = {}) {
  const sentToken = token;
  const headers = {
    'Authorization': `Bearer ${sentToken}`,
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const renewedToken = await renewSessionAfter401(sentToken);
    if (renewedToken) {
      token = renewedToken;
      headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    }
  }

  return response;
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  token = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

async function _readJsonBody(response) {
  try {
    return await response.json();
  } catch (_parseError) {
    return {};
  }
}

/**
 * GET /api/budget/report.
 *
 * @returns {Promise<Object>} the finished report
 * @throws {Error} with the API's sentence when it refuses
 */
async function fetchBudgetReport() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/budget/report`);
  const body = await _readJsonBody(response);
  if (!response.ok) throw new Error(body.error || `Server error (${response.status})`);
  return body;
}

/**
 * GET /api/budget/targets.
 *
 * @returns {Promise<Object>} {editable_fiscal_years, years, categories}
 * @throws {Error}
 */
async function fetchBudgetTargets() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/budget/targets`);
  const body = await _readJsonBody(response);
  if (!response.ok) throw new Error(body.error || `Server error (${response.status})`);
  return body;
}

/**
 * PUT /api/budget/targets/<fiscalYear> with the year's whole set.
 *
 * @param {number} fiscalYear
 * @param {Array<{category: string, cadence: string, amount: string}>} targets
 * @returns {Promise<{ok: boolean, status: number, body: Object}>}
 *   body is the saved year on success, the refusal otherwise
 */
async function saveBudgetTargets(fiscalYear, targets) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/budget/targets/${encodeURIComponent(fiscalYear)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    },
  );
  const body = await _readJsonBody(response);
  return { ok: response.ok, status: response.status, body };
}
