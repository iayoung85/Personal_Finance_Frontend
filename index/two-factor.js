/**
 * Two-factor authentication — TOTP code verification after login.
 */

const IndexTwoFactor = (() => {
  function init() {
    const form = document.getElementById('two-factor-form');
    if (!form) return;

    form.addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      const code = document.getElementById('two-factor-code').value.trim();
      const creds = IndexState.getTempLoginCreds();

      if (!creds) {
        IndexUtils.showMessage('two-factor-message', 'Session expired. Please login again.', 'error');
        showLogin();
        return;
      }

      try {
        const { ok, data } = await IndexApi.login(creds.email, creds.password, code);

        if (ok) {
          IndexState.setAuthFromLogin(data);
          IndexState.clearTempLoginCreds();
          showDashboard();
          return;
        }

        IndexUtils.showMessage('two-factor-message', data.error || 'Verification failed', 'error');
      } catch (networkError) {
        IndexUtils.showMessage('two-factor-message', 'Connection error: ' + networkError.message, 'error');
      }
    });
  }

  return { init };
})();
