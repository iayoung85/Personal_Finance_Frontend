// ============================================================
// user-settings/nav.js — Settings Navigation
// Handles left-sidebar menu rendering and panel switching.
// No network calls in this module.
// ============================================================

/**
 * Attaches click handlers to all sidebar nav links.
 * Switches active panel and loads its content on click.
 */
function setupSettingsMenu() {
  $('.settings-link').on('click', function(e) {
    e.preventDefault();
    const section = $(this).data('section');

    // Update active state in sidebar
    $('.settings-link').removeClass('active');
    $(this).addClass('active');

    // Swap visible panel
    $('.settings-panel').removeClass('active').addClass('hidden');
    $(`#${section}`).removeClass('hidden').addClass('active');

    // Delegate content loading to the appropriate module
    loadSectionContent(section);

    window.scrollTo(0, 0);
  });
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
