/**
 * Registration form handling — password validation, account creation.
 */

const IndexRegister = (() => {
  function init() {
    const form = document.getElementById('register-form');
    if (!form) return;

    form.addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();

      const firstName = document.getElementById('register-firstname').value;
      const lastName = document.getElementById('register-lastname').value;
      const email = document.getElementById('register-email').value;
      const password = document.getElementById('register-password').value;
      const frontendUrl = window.location.origin;

      try {
        // Check if registration is enabled before attempting
        const statusResult = await IndexApi.checkRegistrationStatus();
        if (!statusResult.ok || !statusResult.data.enabled) {
          IndexUtils.showMessage('register-message', 'Registration is currently disabled.', 'error');
          return;
        }

        const { ok, data } = await IndexApi.register({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          frontend_url: frontendUrl,
        });

        if (ok) {
          IndexUtils.showMessage('register-message', 'Registration successful. Please log in.', 'success');
          setTimeout(showLogin, 800);
          return;
        }

        IndexUtils.showMessage('register-message', data.error || 'Registration failed', 'error');
      } catch (networkError) {
        IndexUtils.showMessage('register-message', 'Connection error: ' + networkError.message, 'error');
      }
    });
  }

  return { init };
})();
