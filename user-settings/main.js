// ============================================================
// user-settings/main.js — Page Bootstrap & Token-URL Handlers
// Loaded LAST. Orchestrates module initialization and handles
// account deletion token flows triggered by URL query params.
// Contains no business logic — all delegated to section modules.
// ============================================================

$(document).ready(async function() {
  try {
    await window.BACKEND_URL_PROMISE;

    // Account settings page always requires real authentication
    refreshAuthState();

    // Handle deletion confirmation/cancellation links from email
    const urlParams = new URLSearchParams(window.location.search);
    const deletionToken = urlParams.get('confirm_account_deletion');
    const cancelDeletionToken = urlParams.get('cancel_account_deletion');

    if (deletionToken) {
      await handleAccountDeletionConfirmation(deletionToken);
      return;
    }
    if (cancelDeletionToken) {
      await handleAccountDeletionCancellation(cancelDeletionToken);
      return;
    }

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
  setupActivityListeners();
  renderGlobalDeletionBanner();
  loadProfileDetails();
}

/**
 * Placeholder for any page-wide activity tracking that may be
 * needed in the future (e.g. idle timeout, session heartbeat).
 */
function setupActivityListeners() {
  // No-op for now; reserved for future session management.
}


