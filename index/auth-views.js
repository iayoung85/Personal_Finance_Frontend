/**
 * Auth view routing — exposes the four view-switch functions used by HTML onclick handlers
 * and by other modules that need to navigate between auth screens.
 */

/* eslint-disable no-unused-vars -- these are called from HTML onclick attributes */

function showLogin() {
  IndexUtils.switchToView('login-view');
  if (takeSessionExpiredNotice()) {
    IndexUtils.showMessage('login-message', 'Your session expired. Please sign in again.', 'error');
  }
}

function showRegister() {
  IndexUtils.switchToView('register-view');
}

function showForgotPassword() {
  IndexUtils.switchToView('forgot-password-view');
}

function showTwoFactorLogin() {
  IndexUtils.switchToView('two-factor-view');
  document.getElementById('two-factor-code')?.focus();
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.pauseBankLoad=false] - Show a load button instead of fetching banks.
 */
function showDashboard(options = {}) {
  // Why: sidebar only appears after authentication, not on login/register views
  document.body.setAttribute('data-nav-mode', 'persistent');
  if (typeof initNavSidebar === 'function' && !document.getElementById('nav-sidebar')) {
    initNavSidebar();
  }

  IndexUtils.switchToView('dashboard-view');

  const user = IndexState.getCurrentUser();
  const emailElement = document.getElementById('user-email');
  const nameElement = document.getElementById('user-name');

  if (emailElement) emailElement.textContent = user?.email || '';
  const storedName = _fullName(user);
  if (nameElement) nameElement.textContent = storedName;

  // Why: the saved user is only written at login, so a session saved without a
  // name would stay blank until the next sign-in. Ask the API once instead.
  if (!storedName && !options.pauseBankLoad) {
    _fillMissingName(nameElement);
  }

  if (options.pauseBankLoad) {
    IndexConnectionsList.showLoadPaused();
  } else {
    IndexConnectionsList.loadBanks();
  }
}

function _fullName(user) {
  return `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
}

async function _fillMissingName(nameElement) {
  try {
    const profile = await IndexApi.fetchProfileInfo();
    if (!_fullName(profile)) return;
    IndexState.setUserName(profile.first_name || '', profile.last_name || '');
    if (nameElement) nameElement.textContent = _fullName(profile);
  } catch (err) {
    console.error('Could not load the profile name', err);
  }
}

function logout() {
  IndexState.clearAll();
  // Why: remove sidebar when returning to auth views
  document.body.removeAttribute('data-nav-mode');
  const existingSidebar = document.getElementById('nav-sidebar');
  if (existingSidebar) existingSidebar.remove();
  document.getElementById('nav-sidebar-overlay')?.remove();
  document.getElementById('nav-hamburger')?.remove();

  showLogin();
}
