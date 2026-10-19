/**
 * Main entry point — page bootstrap and smart view routing.
 * Detects auth state, loads correct view, binds all module initializers.
 * This file should be the LAST script loaded (after all other index/* modules).
 */

window.addEventListener('pagehide', (event) => {
  IndexState.recordOpenDiagnostic(event.persisted ? 'leave-to-cache' : 'leave');
});

/**
 * Run startPage now if the page is visible, otherwise the first time it becomes visible.
 * @param {Document} doc - The page's document; tests pass a stand-in.
 * @param {Function} startPage - Called exactly once.
 */
function _startWhenVisible(doc, startPage) {
  if (doc.visibilityState === 'visible') {
    startPage();
    return;
  }
  const startOnFirstShow = () => {
    if (doc.visibilityState !== 'visible') return;
    doc.removeEventListener('visibilitychange', startOnFirstShow);
    startPage();
  };
  doc.addEventListener('visibilitychange', startOnFirstShow);
}

/** Bind the forms, then route to the login or dashboard view. */
async function _startPage() {
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
      // Why: a hidden browser page once reopened this page several times a
      // second for days, and every open fetched the bank list from the API.
      showDashboard({ pauseBankLoad: IndexState.recordPageOpen() });
    } else {
      showLogin();
    }
  } catch (initError) {
    console.error('Initialization error:', initError);
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  IndexState.recordOpenDiagnostic('open');
  // Why: Safari's Reading List fetcher loaded this page in hidden views about
  // eleven times a second, and every copy signed in and fetched banks. A page
  // nobody can see, such as a background tab, starts when it is first shown.
  _startWhenVisible(document, _startPage);
});
