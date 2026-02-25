/**
 * Forgot password flow — email entry, reset link request.
 */

const IndexPasswordReset = (() => {
  function init() {
    const form = document.getElementById('forgot-form');
    if (!form) return;

    form.addEventListener('submit', async (submitEvent) => {
      submitEvent.preventDefault();
      const email = document.getElementById('forgot-email').value;
      const frontendUrl = window.location.origin;

      try {
        const { ok, data } = await IndexApi.forgotPassword(email, frontendUrl);

        if (ok) {
          const view = document.getElementById('forgot-password-view');
          if (view) {
            view.innerHTML = `
              <h1>Reset Password</h1>
              <p class="subtitle">We've sent a reset link to ${email}</p>
              <button type="button" class="btn btn-primary" onclick="showLogin()">Back to Login</button>
            `;
          }
          return;
        }

        IndexUtils.showMessage('forgot-message', data.error || 'Request failed', 'error');
      } catch (networkError) {
        IndexUtils.showMessage('forgot-message', 'Connection error: ' + networkError.message, 'error');
      }
    });
  }

  return { init };
})();
