// ============================================================
// transactions/privacy.js — Privacy Mode
// Masks the balances a passer-by could read off the screen: the
// accounts sidebar and the insight cards. The ledger itself is
// never masked, so the page stays usable for actual work.
// ============================================================

const PRIVACY_MASK_TEXT = '$**.**';
const PRIVACY_DEFAULT_PREF_KEY = 'transactionsPrivacyByDefault';

let _privacyModeOn = false;

/**
 * Whether balances are currently masked on this page.
 * @returns {boolean}
 */
function isPrivacyModeOn() {
  return _privacyModeOn;
}

/**
 * The text to show for a formatted money string, masked when privacy mode
 * is on. Formatters call this last so sign and currency styling never leak.
 * @param {string} formattedMoney - Already-formatted amount, e.g. "$1,234".
 * @returns {string}
 */
function maskMoney(formattedMoney) {
  return _privacyModeOn ? PRIVACY_MASK_TEXT : formattedMoney;
}

/**
 * Start the page in the mode the user chose in Settings. Runs after the
 * app config is loaded and before the sidebar first renders.
 */
function initPrivacyMode() {
  const config = typeof getAppConfig === 'function' ? getAppConfig() : {};
  _setPrivacyMode(config[PRIVACY_DEFAULT_PREF_KEY] === true);
}

/**
 * Flip privacy mode and redraw the two surfaces it covers.
 */
function togglePrivacyMode() {
  _setPrivacyMode(!_privacyModeOn);
  if (typeof renderAccountsSidebar === 'function') renderAccountsSidebar();
  if (typeof updatePlaidBalanceIndicator === 'function') updatePlaidBalanceIndicator();
  if (typeof renderInsightsPanel === 'function') renderInsightsPanel();
}

function _setPrivacyMode(enabled) {
  _privacyModeOn = !!enabled;
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.privacy = _privacyModeOn ? 'on' : 'off';
  }
}

/**
 * The toggle button drawn into the sidebar summary box.
 * @returns {string} HTML.
 */
function privacyToggleButtonHtml() {
  const title = _privacyModeOn ? 'Show balances' : 'Hide balances';
  const icon = _privacyModeOn ? '🙈' : '👁';
  return `<button type="button" class="sidebar-privacy-btn${_privacyModeOn ? ' active' : ''}" `
    + `onclick="event.stopPropagation(); togglePrivacyMode()" title="${title}" aria-label="${title}" `
    + `aria-pressed="${_privacyModeOn}">${icon}</button>`;
}

/**
 * Whether the page should load with privacy on, as last saved.
 * @returns {boolean}
 */
function isPrivacyByDefault() {
  const config = typeof getAppConfig === 'function' ? getAppConfig() : {};
  return config[PRIVACY_DEFAULT_PREF_KEY] === true;
}

/**
 * Persist the load-time default. The choice lives in the user's preferences
 * blob so it follows them across browsers; the local cache is refreshed from
 * the server's reply. A no-op when nothing changed.
 * @param {boolean} enabled
 * @returns {Promise<boolean>} true when saved or unchanged, false on failure.
 */
async function savePrivacyByDefault(enabled) {
  const wanted = !!enabled;
  if (isPrivacyByDefault() === wanted) return true;
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/user/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [PRIVACY_DEFAULT_PREF_KEY]: wanted }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) {
      console.error('Privacy default save failed:', response.status);
      return false;
    }
    localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(body));
    return true;
  } catch (error) {
    console.error('Privacy default save error:', error.message);
    return false;
  }
}
