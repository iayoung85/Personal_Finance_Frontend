// ============================================================
// user-settings/main.js — Page Bootstrap
// Loaded LAST. Orchestrates module initialization.
// Contains no business logic — all delegated to section modules.
// ============================================================

$(document).ready(async function() {
  try {
    await window.BACKEND_URL_PROMISE;

    // Account settings page always requires real authentication
    refreshAuthState();

    // Gate the settings page behind authentication
    if (!authToken || !currentUser) {
      window.location.href = 'index.html';
      return;
    }

    initializePage();
  } catch (e) {
    console.error('Error in initialization:', e);
    window.location.href = 'index.html';
  }
});

/**
 * Wires up all settings modules and loads the default panel.
 * Deliberately thin — modules handle their own content.
 */
function initializePage() {
  setupSettingsMenu();
  loadProfileDetails();
}


