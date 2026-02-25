// ============================================================
// user-settings/two-factor.js — 2FA Panel
// Handles TOTP enable/disable flow, QR code display, and
// 6-digit code verification. No network calls outside of
// calls through authenticatedFetch (api.js).
// ============================================================

/**
 * Loads 2FA panel showing current status and the appropriate
 * action button (Enable or Disable). If disabled, also renders
 * the hidden setup area that slides down when setup is started.
 */
async function loadTwoFactorAuthSettings() {
  const container = $('#twofa-content');
  container.html('<div class="loading">Loading 2FA settings...</div>');

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/profile-info`);
    const data = await response.json();

    if (!response.ok) {
      container.html(`<div class="message error">${data.error || 'Failed to load 2FA settings'}</div>`);
      return;
    }

    const twoFAEnabled = !!data.is_2fa_enabled;
    const statusColor = twoFAEnabled ? '#28a745' : '#dc3545';
    const statusLabel = twoFAEnabled ? 'Enabled' : 'Disabled';

    let html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Current Status</h3>
        </div>
        <p>Two-Factor Authentication is currently <strong style="color: ${statusColor};">${statusLabel}</strong></p>
        <div class="flex-group">
          ${twoFAEnabled
            ? `<button class="btn btn-danger" onclick="disableTwoFactorAuth()">Disable 2FA</button>`
            : `<button class="btn btn-primary" onclick="startTwoFactorSetup()">Enable 2FA</button>`
          }
        </div>
      </div>
    `;

    // Only render setup area when 2FA is not yet active
    if (!twoFAEnabled) {
      html += `
        <div id="twofa-setup-area" class="card" style="display: none;">
          <div class="card-header">
            <h3 class="card-title">Setup Two-Factor Authentication</h3>
          </div>
          <p>Follow these steps to enable 2FA on your account:</p>

          <p><strong>Step 1: Scan QR Code</strong></p>
          <p style="color: #666; font-size: 14px;">Use an authenticator app (Google Authenticator, Authy, Microsoft Authenticator):</p>
          <div id="twofa-qr-code" style="margin: 15px 0; text-align: center;"></div>

          <p><strong>Step 2: Manual Entry (if scan fails)</strong></p>
          <code id="twofa-secret-key" style="background: #f5f5f5; padding: 8px 12px; border-radius: 4px; font-family: monospace; display: block; margin: 10px 0; word-break: break-all;"></code>

          <p><strong>Step 3: Verify Code</strong></p>
          <form id="twofa-verify-form">
            <div class="form-group">
              <label for="twofa-verify-code">Enter the 6-digit code from your authenticator app</label>
              <input type="text" id="twofa-verify-code" pattern="[0-9]{6}" inputmode="numeric" maxlength="6" required placeholder="000000" style="letter-spacing: 3px; text-align: center;">
            </div>
            <div class="flex-group">
              <button type="submit" class="btn btn-primary">Verify & Enable</button>
              <button type="button" class="btn btn-secondary" onclick="cancelTwoFactorSetup()">Cancel</button>
            </div>
          </form>
          <div id="twofa-setup-message"></div>
        </div>
      `;
    }

    html += `<div id="twofa-message"></div>`;
    container.html(html);

    if (!twoFAEnabled) {
      $('#twofa-verify-form').on('submit', async function(e) {
        e.preventDefault();
        await verifyTwoFactorSetup();
      });
    }
  } catch (error) {
    console.error('Error loading 2FA settings:', error);
    container.html(`<div class="message error">Connection error: ${error.message}</div>`);
  }
}

/** Slides the setup area into view and fetches the TOTP secret. */
function startTwoFactorSetup() {
  $('#twofa-setup-area').slideDown(300);
  fetchTwoFactorSecret();
}

/** Collapses the setup area without changing 2FA state. */
function cancelTwoFactorSetup() {
  $('#twofa-setup-area').slideUp(300);
}

/**
 * Fetches a new TOTP secret from the backend and populates
 * the QR code image and plaintext secret key fields.
 */
async function fetchTwoFactorSecret() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/setup_2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (response.ok) {
      $('#twofa-secret-key').text(data.secret);
      if (data.qr_code) {
        $('#twofa-qr-code').html(`
          <img src="data:image/png;base64,${data.qr_code}"
               alt="2FA QR Code"
               style="max-width: 250px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
        `);
      }
    } else {
      showMessage('twofa-setup-message', data.error || 'Failed to generate 2FA secret', 'error');
    }
  } catch (error) {
    console.error('Error fetching 2FA secret:', error);
    showMessage('twofa-setup-message', `Connection error: ${error.message}`, 'error');
  }
}

/**
 * Validates the 6-digit code entered by the user and asks
 * the backend to activate 2FA. Reloads the panel on success.
 */
async function verifyTwoFactorSetup() {
  const code = $('#twofa-verify-code').val().trim();

  if (code.length !== 6) {
    showMessage('twofa-setup-message', 'Please enter a 6-digit code', 'error');
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/verify_2fa_setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('twofa-message', '✓ Two-Factor Authentication enabled successfully!', 'success');
      setTimeout(() => loadTwoFactorAuthSettings(), 2000);
    } else {
      showMessage('twofa-setup-message', data.error || 'Invalid code. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Error verifying 2FA:', error);
    showMessage('twofa-setup-message', `Connection error: ${error.message}`, 'error');
  }
}

/**
 * Disables 2FA after a native browser confirm. Reloads the
 * panel on success so the Enable button re-appears.
 */
async function disableTwoFactorAuth() {
  if (!confirm('Are you sure you want to disable Two-Factor Authentication? This will make your account less secure.')) {
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/disable_2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('twofa-message', '✓ Two-Factor Authentication disabled.', 'success');
      setTimeout(() => loadTwoFactorAuthSettings(), 1500);
    } else {
      showMessage('twofa-message', data.error || 'Failed to disable 2FA', 'error');
    }
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    showMessage('twofa-message', `Connection error: ${error.message}`, 'error');
  }
}
