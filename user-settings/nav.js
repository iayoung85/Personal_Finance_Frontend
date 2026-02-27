// ============================================================
// user-settings/nav.js — Settings Navigation
// Panel switching is now handled by the shared nav-sidebar.js
// which calls loadSectionContent() when sub-nav items are
// clicked. This module retains the dispatcher and handles
// initial panel selection based on URL hash.
// ============================================================

/**
 * Initializes the settings page by selecting the correct panel
 * based on the URL hash. The shared nav sidebar handles all
 * click-based panel switching.
 */
function setupSettingsMenu() {
  const hash = window.location.hash.replace('#', '') || 'profile';
  const validSections = ['profile', 'password', 'twofa', 'deletion'];

  // Why: fallback to profile if hash is invalid or empty
  const section = validSections.includes(hash) ? hash : 'profile';

  // Show the correct panel
  $('.settings-panel').removeClass('active').addClass('hidden');
  $(`#${section}`).removeClass('hidden').addClass('active');

  // Load its content
  loadSectionContent(section);
}

/**
 * Dispatches to the correct section-loader function.
 *
 * @param {string} section - Section key matching a panel ID
 */
function loadSectionContent(section) {
  switch (section) {
    case 'profile':
      loadProfileDetails();
      break;
    case 'password':
      loadPasswordChangeForm();
      break;
    case 'twofa':
      loadTwoFactorAuthSettings();
      break;
    case 'deletion':
      loadAccountDeletionForm();
      break;
  }
}
