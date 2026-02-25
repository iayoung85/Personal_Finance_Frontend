// ============================================================
// user-settings/account-deletion.js — Account Deletion Panel
// Handles deletion request, cancellation, resend, and the
// email-link confirmation/cancellation token flows.
//
// BUG FIX: The original renderDeletionPendingBanner referenced
// `response.ok` which was never in scope (only `data` is
// returned from fetchDeletionStatus). Fixed below.
// ============================================================

/**
 * Renders the account deletion panel, including the warning
 * card, the request form, and the pending banner (if any).
 */
function loadAccountDeletionForm() {
  const container = $('#deletion-content');

  const html = `
    <div id="deletion-pending-banner"></div>
    <div class="card" style="background: #fdf2f2; border-color: #fcc;">
      <div style="display: flex; gap: 10px; align-items: flex-start;">
        <div style="font-size: 24px;">⚠️</div>
        <div>
          <p style="margin: 0; margin-bottom: 5px;"><strong>This action cannot be undone</strong></p>
          <p style="margin: 0; color: #666; font-size: 13px;">Deleting your account will:</p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; font-size: 13px; color: #666;">
            <li>Permanently delete all your account data</li>
            <li>Disconnect all bank connections</li>
            <li>Cancel your subscription at the end of the current billing month</li>
            <li>Remove all stored transactions and investment data</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Request Account Deletion</h3>
      </div>
      <p class="text-muted">You'll receive a confirmation email with a link you must click. After confirming, your account will be immediately and permanently deleted.</p>
      <form id="deletion-form">
        <div class="form-group">
          <label for="deletion-2fa">2FA Code (if enabled)</label>
          <input type="text" id="deletion-2fa" placeholder="6-digit code" pattern="[0-9]*" inputmode="numeric" maxlength="6">
        </div>
        <div class="flex-group">
          <button type="submit" class="btn btn-danger">Request Account Deletion</button>
          <button type="button" class="btn btn-secondary" id="cancel-deletion-btn">Cancel Deletion Request</button>
          <button type="button" class="btn btn-link" id="resend-deletion-btn" style="text-decoration: underline;">Resend confirmation email</button>
        </div>
      </form>
      <div id="deletion-message"></div>
    </div>
  `;

  container.html(html);

  $('#deletion-form').on('submit', async function(e) {
    e.preventDefault();
    await requestAccountDeletion();
  });

  $('#cancel-deletion-btn').on('click', async function() {
    await cancelAccountDeletion();
  });

  $('#resend-deletion-btn').on('click', async function() {
    await resendDeletionEmail();
  });

  renderDeletionPendingBanner();
}

/**
 * Sends the deletion request to the backend after a native
 * browser confirm. Backend sends a confirmation email.
 */
async function requestAccountDeletion() {
  const twoFACode = $('#deletion-2fa').val().trim();

  if (!confirm('Are you absolutely sure? This will permanently delete your account and all associated data immediately after you confirm the deletion email. This cannot be undone.')) {
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/request-account-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twofa_code: twoFACode })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('deletion-message', '✓ Deletion confirmation email sent! Check your inbox and click the link to confirm.', 'success');
      setTimeout(() => loadAccountDeletionForm(), 3000);
    } else {
      showMessage('deletion-message', data.error || 'Failed to request deletion', 'error');
    }
  } catch (error) {
    console.error('Error requesting deletion:', error);
    showMessage('deletion-message', `Connection error: ${error.message}`, 'error');
  }
}

/**
 * Re-sends the deletion confirmation email (e.g. if the first
 * email expired or was lost).
 */
async function resendDeletionEmail() {
  const twoFACode = $('#deletion-2fa').val().trim();

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/resend-account-deletion-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twofa_code: twoFACode })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('deletion-message', data.message || 'Deletion confirmation email resent. Check your inbox.', 'success');
      renderDeletionPendingBanner();
    } else {
      showMessage('deletion-message', data.error || 'Failed to resend deletion email', 'error');
    }
  } catch (error) {
    console.error('Error resending deletion email:', error);
    showMessage('deletion-message', `Connection error: ${error.message}`, 'error');
  }
}

/**
 * Cancels an outstanding deletion request so the account
 * remains active.
 */
async function cancelAccountDeletion() {
  const twoFACode = $('#deletion-2fa').val().trim();

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/cancel-account-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ twofa_code: twoFACode })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('deletion-message', data.message || 'Deletion request canceled.', 'success');
      setTimeout(() => loadAccountDeletionForm(), 2000);
    } else {
      showMessage('deletion-message', data.error || 'Failed to cancel deletion request', 'error');
    }
  } catch (error) {
    console.error('Error canceling deletion:', error);
    showMessage('deletion-message', `Connection error: ${error.message}`, 'error');
  }
}

/**
 * Renders a warning banner inside #deletion-pending-banner if
 * a deletion is currently pending. Clears the element otherwise.
 *
 * BUG FIX: Original code referenced `response.ok` (not in
 * scope). fetchDeletionStatus() only returns data or throws.
 */
async function renderDeletionPendingBanner() {
  const banner = $('#deletion-pending-banner');
  try {
    const data = await fetchDeletionStatus();
    if (data.pending) {
      const expiryNote = data.token_expires_at
        ? ` This link expires at ${new Date(data.token_expires_at).toLocaleString()}.`
        : '';
      banner.html(`
        <div class="card" style="background: #fff8e1; border-color: #ffe082; margin-bottom: 16px;">
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <div style="font-size: 20px;">⌛</div>
            <div>
              <p style="margin: 0; font-weight: 600;">Deletion pending</p>
              <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Check your email to confirm account ownership and complete the deletion process.${expiryNote}</p>
            </div>
          </div>
        </div>
      `);
    } else {
      banner.empty();
    }
  } catch (error) {
    console.error('Error fetching deletion status:', error);
    banner.empty();
  }
}

/**
 * Renders a global deletion-pending banner at the top of the
 * settings page (above all panels) if a deletion is pending.
 * Targets #global-deletion-banner in the HTML shell.
 */
async function renderGlobalDeletionBanner() {
  const banner = $('#global-deletion-banner');
  if (!banner.length) return;
  try {
    const data = await fetchDeletionStatus();
    if (data.pending) {
      const expiryNote = data.token_expires_at
        ? ` This link expires at ${new Date(data.token_expires_at).toLocaleString()}.`
        : '';
      banner.html(`
        <div class="card" style="background: #fff8e1; border-color: #ffe082; margin-bottom: 16px;">
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <div style="font-size: 20px;">⌛</div>
            <div>
              <p style="margin: 0; font-weight: 600;">Deletion pending</p>
              <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Check your email to confirm account ownership and complete the deletion process.${expiryNote}</p>
            </div>
          </div>
        </div>
      `);
    } else {
      banner.empty();
    }
  } catch (error) {
    console.error('Error fetching global deletion status:', error);
    banner.empty();
  }
}

// ── Email-link token flows (called on page load from main.js) ─

/**
 * Full-page replacement flow for when the user clicks the
 * account-deletion confirmation link in their email.
 * Does NOT require an auth token (deletion_token in URL).
 *
 * @param {string} token - Deletion token from URL query param
 */
async function handleAccountDeletionConfirmation(token) {
  const container = document.body;
  container.innerHTML = _buildFullPageCard('Processing Account Deletion...', `
    <div class="loading">Please wait while we delete your account</div>
  `);

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/confirm-account-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_token: token })
    });

    const data = await response.json();

    if (response.ok) {
      container.innerHTML = _buildFullPageCard('✓ Account Deleted', `
        <p style="color: #666; margin-bottom: 20px;">${data.message}</p>
        <p style="color: #666; margin-bottom: 30px;">You will be redirected to the login page in 3 seconds...</p>
        <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login Now</a>
      `, '#28a745');
      setTimeout(() => {
        localStorage.clear();
        window.location.href = 'index.html';
      }, 3000);
    } else {
      container.innerHTML = _buildFullPageCard('❌ Cannot Delete Account', `
        <p style="color: #666; margin-bottom: 20px;">${data.error || 'Unable to delete your account.'}</p>
        <p style="color: #999; font-size: 14px; margin-bottom: 20px;">${data.details || ''}</p>
        <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
      `, '#dc3545');
      setTimeout(() => {
        localStorage.clear();
        window.location.href = 'index.html';
      }, 5000);
    }
  } catch (error) {
    console.error('Error confirming account deletion:', error);
    container.innerHTML = _buildFullPageCard('❌ Connection Error', `
      <p style="color: #666; margin-bottom: 20px;">Unable to process your deletion request. Please try again later.</p>
      <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
    `, '#dc3545');
  }
}

/**
 * Full-page replacement flow for when the user clicks the
 * deletion-cancellation link in their email.
 *
 * @param {string} token - Cancellation token from URL query param
 */
async function handleAccountDeletionCancellation(token) {
  const container = document.body;
  container.innerHTML = _buildFullPageCard('Canceling Deletion Request...', `
    <div class="loading">Please wait</div>
  `);

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/cancel-account-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_token: token })
    });

    const data = await response.json();

    if (response.ok) {
      container.innerHTML = _buildFullPageCard('✓ Deletion Request Canceled', `
        <p style="color: #666; margin-bottom: 30px;">You can continue using your account.</p>
        <a href="user-settings.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Account Settings</a>
      `, '#28a745');
    } else {
      container.innerHTML = _buildFullPageCard('❌ Unable to Cancel', `
        <p style="color: #666; margin-bottom: 20px;">${data.error || 'Unable to cancel deletion request.'}</p>
        <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
      `, '#dc3545');
    }
  } catch (error) {
    console.error('Error canceling account deletion:', error);
    container.innerHTML = _buildFullPageCard('❌ Connection Error', `
      <p style="color: #666; margin-bottom: 20px;">Unable to process your cancellation. Please try again later.</p>
      <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
    `, '#dc3545');
  }
}

// ── Private helper ─────────────────────────────────────────

/**
 * Builds a full-viewport centered card for token-flow results.
 * Private to this module (prefixed _).
 *
 * @param {string} heading    - Card heading text (may contain emoji)
 * @param {string} bodyHtml   - Inner HTML for the card body
 * @param {string} [headingColor='#182742'] - CSS color for heading
 * @returns {string} HTML string
 */
function _buildFullPageCard(heading, bodyHtml, headingColor = '#182742') {
  return `
    <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
        <h2 style="color: ${headingColor}; margin-bottom: 20px;">${heading}</h2>
        ${bodyHtml}
      </div>
    </div>
  `;
}
