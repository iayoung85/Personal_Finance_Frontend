/**
 * Login form handling — email/password validation, error display, 2FA redirect.
 */

const IndexLogin = (() => {
  function init() {
    const form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      try {
        const { ok, data } = await IndexApi.login(email, password);

        if (ok && data.require_2fa) {
          IndexState.setTempLoginCreds({ email, password });
          showTwoFactorLogin();
          return;
        }

        if (ok) {
          IndexState.setAuthFromLogin(data);
          showDashboard();
          return;
        }

        IndexUtils.showMessage('login-message', data.error || 'Login failed', 'error');
      } catch (networkError) {
        IndexUtils.showMessage('login-message', 'Connection error: ' + networkError.message, 'error');
      }
    });
  }

  return { init };
})();
