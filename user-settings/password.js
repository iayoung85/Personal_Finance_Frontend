// ============================================================
// user-settings/password.js — Change Password Panel
// Renders password change form with strength indicator.
// Validation helpers are pure (input → output), no side effects.
// ============================================================

/**
 * Renders the password change form and binds the strength
 * indicator listener and submit handler.
 */
function loadPasswordChangeForm() {
  const container = $('#password-content');

  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Update Your Password</h3>
      </div>
      <p class="text-muted">For security, you'll need to enter your 2FA code if you have it enabled.</p>
      <form id="password-change-form">
        <div class="form-group">
          <label for="current-password">Current Password</label>
          <input type="password" id="current-password" autocomplete="current-password" required>
        </div>
        <div class="form-group">
          <label for="new-password">New Password</label>
          <input type="password" id="new-password" autocomplete="new-password" required>
          <div class="password-strength" id="password-strength" style="margin-top: 8px; font-size: 12px;"></div>
        </div>
        <div class="form-group">
          <label for="confirm-password">Confirm New Password</label>
          <input type="password" id="confirm-password" autocomplete="new-password" required>
        </div>
        <div class="form-group">
          <label for="password-2fa">2FA Code (if enabled)</label>
          <input type="text" id="password-2fa" placeholder="6-digit code" pattern="[0-9]*" inputmode="numeric" maxlength="6">
        </div>
        <div class="flex-group">
          <button type="submit" class="btn btn-primary">Change Password</button>
          <button type="button" class="btn btn-secondary" onclick="loadPasswordChangeForm()">Cancel</button>
        </div>
      </form>
      <div id="password-change-message"></div>
    </div>
  `;

  container.html(html);

  $('#password-change-form').on('submit', async function(e) {
    e.preventDefault();
    await changePassword();
  });

  $('#new-password').on('input', function() {
    checkPasswordStrength($(this).val());
  });
}

/**
 * Updates the #password-strength element with a color-coded
 * description based on a numeric score.
 *
 * @param {string} password - The candidate password value
 */
function checkPasswordStrength(password) {
  const score = calculatePasswordStrength(password);
  const indicator = $('#password-strength');

  if (password.length === 0) {
    indicator.html('');
    return;
  }

  let text;
  let color;

  if (score < 2) {
    text = 'Weak — add uppercase letters, numbers, or symbols';
    color = '#dc3545';
  } else if (score < 3) {
    text = 'Fair — could be stronger';
    color = '#ffc107';
  } else if (score < 4) {
    text = 'Good password';
    color = '#28a745';
  } else {
    text = 'Strong password';
    color = '#20c997';
  }

  indicator.html(`<span style="color: ${color};">${text}</span>`);
}

/**
 * Returns a numeric strength score 0–5 for a password.
 * Pure function: no DOM reads or writes.
 *
 * Scoring criteria (one point each):
 *   1. At least 8 characters
 *   2. At least 12 characters
 *   3. Mixed case (lower + upper)
 *   4. Contains a digit
 *   5. Contains a non-alphanumeric character
 *
 * @param {string} password
 * @returns {number} Score between 0 and 5
 */
function calculatePasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z\d]/.test(password)) score++;
  return score;
}

/**
 * Validates inputs client-side, then submits the password
 * change request. On success, logs the user out so they
 * must re-authenticate with the new password.
 */
async function changePassword() {
  const currentPassword = $('#current-password').val();
  const newPassword = $('#new-password').val();
  const confirmPassword = $('#confirm-password').val();
  const twoFACode = $('#password-2fa').val().trim();

  if (newPassword !== confirmPassword) {
    showMessage('password-change-message', 'Passwords do not match', 'error');
    return;
  }

  if (newPassword.length < 8) {
    showMessage('password-change-message', 'Password must be at least 8 characters', 'error');
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        twofa_code: twoFACode
      })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage(
        'password-change-message',
        '✓ Password changed successfully! You will be logged out and need to log in with your new password.',
        'success'
      );
      setTimeout(() => logout(), 2000);
    } else {
      showMessage('password-change-message', data.error || 'Failed to change password', 'error');
    }
  } catch (error) {
    console.error('Error changing password:', error);
    showMessage('password-change-message', `Connection error: ${error.message}`, 'error');
  }
}
