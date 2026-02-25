/**
 * Main entry point — page bootstrap and smart view routing.
 * Detects auth state, loads correct view, binds all module initializers.
 * This file should be the LAST script loaded (after all other index/* modules).
 */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await window.BACKEND_URL_PROMISE;

    IndexState.refreshAuthState();

    // Initialize form handlers
    IndexLogin.init();
    IndexRegister.init();
    IndexPasswordReset.init();
    IndexTwoFactor.init();
    IndexPlaidIntegration.init();

    // Route to correct view based on auth state
    if (IndexState.isLoggedIn()) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch (initError) {
    console.error('Initialization error:', initError);
    showLogin();
  }
});
