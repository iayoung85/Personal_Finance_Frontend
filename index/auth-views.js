/**
 * Auth view routing — exposes the four view-switch functions used by HTML onclick handlers
 * and by other modules that need to navigate between auth screens.
 */

/* eslint-disable no-unused-vars -- these are called from HTML onclick attributes */

function showLogin() {
  IndexUtils.switchToView('login-view');
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

function showDashboard() {
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
  if (nameElement) {
    nameElement.textContent = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  }

  IndexConnectionsList.loadBanks();
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
