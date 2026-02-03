// Account Settings Page Logic
// BACKEND_URL is defined in config.js

// Global variables
let authToken = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = null;
try {
  currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch (e) {
  console.error('Error parsing currentUser from localStorage', e);
  localStorage.removeItem('currentUser');
}

// Initialize on page load
$(document).ready(async function() {
  try {
    await window.BACKEND_URL_PROMISE;
    
    // Check for email verification/rejection tokens in URL
    const urlParams = new URLSearchParams(window.location.search);
    const verifyToken = urlParams.get('verify_email_change');
    const rejectToken = urlParams.get('reject_email_change');
    const deletionToken = urlParams.get('confirm_account_deletion');
    const cancelDeletionToken = urlParams.get('cancel_account_deletion');
    
    if (verifyToken) {
      await handleEmailVerification(verifyToken);
      return;
    }
    
    if (rejectToken) {
      await handleEmailRejection(rejectToken);
      return;
    }
    
    if (deletionToken) {
      await handleAccountDeletionConfirmation(deletionToken);
      return;
    }
    
    if (cancelDeletionToken) {
      await handleAccountDeletionCancellation(cancelDeletionToken);
      return;
    }
    
    // Check authentication
    if (!authToken || !currentUser) {
      window.location.href = 'index.html';
      return;
    }

    // Initialize page
    initializePage();
  } catch (e) {
    console.error('Error in initialization:', e);
    window.location.href = 'index.html';
  }
});

// ============================================
// INITIALIZATION
// ============================================

function initializePage() {
  setupSettingsMenu();
  setupActivityListeners();
  renderGlobalDeletionBanner();
  loadProfileDetails();
}

// ============================================
// TOKEN HANDLERS (EMAIL CHANGE / DELETION LINKS)
// ============================================

function showTokenResult(title, message, type = 'info') {
  const container = $('.main-content');
  const cardHtml = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">${title}</h3>
      </div>
      <div class="message ${type}" style="margin-top: 12px;">${message}</div>
      <div class="flex-group" style="margin-top: 20px; gap: 10px;">
        <a class="btn btn-primary" href="index.html">Go to Login</a>
        <a class="btn btn-secondary" href="account.html">Back to Account</a>
      </div>
    </div>
  `;

  if (container.length) {
    container.html(cardHtml);
  } else {
    $('body').html(cardHtml);
  }
}

function buildFrontendContext() {
  const origin = window.location.origin.replace(/\/$/, '');
  const path = window.location.pathname || '/account.html';
  const accountPath = path.startsWith('/') ? path : `/${path}`;
  return { frontend_url: origin, account_path: accountPath };
}

async function handleEmailVerification(token) {
  try {
    const { frontend_url, account_path } = buildFrontendContext();
    const response = await fetch(`${BACKEND_URL}/api/auth/verify-email-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, frontend_url, account_path })
    });

    const data = await response.json();

    if (response.ok) {
      showTokenResult('Email Change Verified', 'Your email has been updated. Please log in with your new email.', 'success');
    } else {
      showTokenResult('Email Change Failed', data.error || 'Invalid or expired link.', 'error');
    }
  } catch (err) {
    showTokenResult('Error', `Could not process verification: ${err.message}`, 'error');
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.delete('verify_email_change');
    window.history.replaceState({}, document.title, url.toString());
  }
}

async function handleEmailRejection(token) {
  try {
    const { frontend_url, account_path } = buildFrontendContext();
    const response = await fetch(`${BACKEND_URL}/api/auth/reject-email-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, frontend_url, account_path })
    });

    const data = await response.json();

    if (response.ok) {
      showTokenResult('Email Change Rejected', 'We locked the account and sent a password reset link to the original email.', 'success');
    } else {
      showTokenResult('Email Change Rejection Failed', data.error || 'Invalid or expired link.', 'error');
    }
  } catch (err) {
    showTokenResult('Error', `Could not process rejection: ${err.message}`, 'error');
  } finally {
    const url = new URL(window.location.href);
    url.searchParams.delete('reject_email_change');
    window.history.replaceState({}, document.title, url.toString());
  }
}

// ============================================
// SETTINGS MENU (Content Switching)
// ============================================

function setupSettingsMenu() {
  $('.settings-link').on('click', function(e) {
    e.preventDefault();
    const section = $(this).data('section');
    
    // Update menu
    $('.settings-link').removeClass('active');
    $(this).addClass('active');

    // Update content
    $('.settings-panel').removeClass('active').addClass('hidden');
    $(`#${section}`).removeClass('hidden').addClass('active');

    // Load content for section
    loadSectionContent(section);

    // Scroll to top
    window.scrollTo(0, 0);
  });
}

function loadSectionContent(section) {
  
  switch(section) {
    case 'profile':
      loadProfileDetails();
      break;
    case 'password':
      loadPasswordChangeForm();
      break;
    case 'subscription':
      loadSubscriptionDetails();
      break;
    case 'tokens':
      loadTokenWallet();
      break;
    case 'twofa':
      loadTwoFactorAuthSettings();
      break;
    case 'deletion':
      loadAccountDeletionForm();
      break;
  }
}

// ============================================
// SECTION: PROFILE DETAILS
// ============================================

async function loadProfileDetails() {
  const container = $('#profile-content');
  container.html('<div class="loading">Loading profile details...</div>');

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/profile-info`);
    const data = await response.json();

    if (!response.ok) {
      container.html(`<div class="message error">${data.error || 'Failed to load profile'}</div>`);
      return;
    }

    const html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Personal Information</h3>
        </div>
        <div class="form-group">
          <label>First Name</label>
          <input type="text" id="profile-first-name" value="${escapeHtml(data.first_name || '')}" disabled>
        </div>
        <div class="form-group">
          <label>Last Name</label>
          <input type="text" id="profile-last-name" value="${escapeHtml(data.last_name || '')}" disabled>
        </div>
        <div class="flex-group">
          <button class="btn btn-primary" onclick="editProfileMode()">Edit Details</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Email Address</h3>
        </div>
        <div class="form-group">
          <label>Current Email</label>
          <input type="email" id="profile-email" value="${escapeHtml(data.email)}" disabled>
        </div>
        <p class="text-muted">To change your email, click below. You'll need to verify the new email address.</p>
        <div class="flex-group">
          <button class="btn btn-primary" onclick="changeEmailMode()">Change Email</button>
        </div>
      </div>

      <div id="profile-message"></div>
    `;

    container.html(html);
  } catch (error) {
    console.error('Error loading profile:', error);
    container.html(`<div class="message error">Connection error: ${error.message}</div>`);
  }
}

function editProfileMode() {
  const firstName = $('#profile-first-name').val();
  const lastName = $('#profile-last-name').val();

  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Edit Personal Information</h3>
      </div>
      <form id="edit-profile-form">
        <div class="form-group">
          <label for="edit-first-name">First Name</label>
          <input type="text" id="edit-first-name" value="${escapeHtml(firstName)}" required>
        </div>
        <div class="form-group">
          <label for="edit-last-name">Last Name</label>
          <input type="text" id="edit-last-name" value="${escapeHtml(lastName)}" required>
        </div>
        <div class="flex-group">
          <button type="submit" class="btn btn-primary">Save Changes</button>
          <button type="button" class="btn btn-secondary" onclick="loadProfileDetails()">Cancel</button>
        </div>
      </form>
      <div id="edit-profile-message"></div>
    </div>
  `;

  $('#profile-content').html(html);

  $('#edit-profile-form').on('submit', async function(e) {
    e.preventDefault();
    await updateProfileInfo();
  });
}

async function updateProfileInfo() {
  const firstName = $('#edit-first-name').val().trim();
  const lastName = $('#edit-last-name').val().trim();

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/update-profile-info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: firstName, last_name: lastName })
    });

    const data = await response.json();

    if (response.ok) {
      // Update stored user data
      currentUser.first_name = firstName;
      currentUser.last_name = lastName;
      localStorage.setItem('currentUser', JSON.stringify(currentUser));

      showMessage('edit-profile-message', '✓ Profile updated successfully!', 'success');
      setTimeout(() => loadProfileDetails(), 1500);
    } else {
      showMessage('edit-profile-message', data.error || 'Failed to update profile', 'error');
    }
  } catch (error) {
    console.error('Error updating profile:', error);
    showMessage('edit-profile-message', `Connection error: ${error.message}`, 'error');
  }
}

function changeEmailMode() {
  const currentEmail = $('#profile-email').val();

  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Change Email Address</h3>
      </div>
      <p class="text-muted">A verification link will be sent to your new email. You must verify it to complete the change.</p>
      <form id="change-email-form">
        <div class="form-group">
          <label>Current Email</label>
          <input type="email" value="${escapeHtml(currentEmail)}" disabled>
        </div>
        <div class="form-group">
          <label for="new-email">New Email Address</label>
          <input type="email" id="new-email" required>
        </div>
        <div class="form-group">
          <label for="email-2fa">2FA Code (if enabled)</label>
          <input type="text" id="email-2fa" placeholder="6-digit code" pattern="[0-9]*" inputmode="numeric" maxlength="6">
        </div>
        <div class="flex-group">
          <button type="submit" class="btn btn-primary">Request Email Change</button>
          <button type="button" class="btn btn-secondary" onclick="loadProfileDetails()">Cancel</button>
        </div>
      </form>
      <div id="change-email-message"></div>
    </div>
  `;

  $('#profile-content').html(html);

  $('#change-email-form').on('submit', async function(e) {
    e.preventDefault();
    await requestEmailChange();
  });
}

async function requestEmailChange() {
  const newEmail = $('#new-email').val().trim();
  const twoFACode = $('#email-2fa').val().trim();

  if (!newEmail) {
    showMessage('change-email-message', 'Please enter a new email address', 'error');
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/change-email-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        new_email: newEmail,
        twofa_code: twoFACode,
        frontend_url: window.location.origin,
        account_path: window.location.pathname
      })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('change-email-message', '✓ Verification emails have been sent to both addresses. Please check your inbox.', 'success');
      setTimeout(() => loadProfileDetails(), 3000);
    } else {
      showMessage('change-email-message', data.error || 'Failed to request email change', 'error');
    }
  } catch (error) {
    console.error('Error requesting email change:', error);
    showMessage('change-email-message', `Connection error: ${error.message}`, 'error');
  }
}

// ============================================
// SECTION: CHANGE PASSWORD
// ============================================

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
          <label for="confirm-password">Confirm Password</label>
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

  // Password strength indicator
  $('#new-password').on('input', function() {
    checkPasswordStrength($(this).val());
  });
}

function checkPasswordStrength(password) {
  const strength = calculatePasswordStrength(password);
  const indicator = $('#password-strength');

  let text = '';
  let color = '';

  if (password.length === 0) {
    indicator.html('');
    return;
  }

  if (strength < 2) {
    text = 'Weak - Add uppercase, numbers, or symbols';
    color = '#dc3545';
  } else if (strength < 3) {
    text = 'Fair - Could be stronger';
    color = '#ffc107';
  } else if (strength < 4) {
    text = 'Good password';
    color = '#28a745';
  } else {
    text = 'Strong password';
    color = '#20c997';
  }

  indicator.html(`<span style="color: ${color};">${text}</span>`);
}

function calculatePasswordStrength(password) {
  let strength = 0;
  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
  if (/\d/.test(password)) strength++;
  if (/[^a-zA-Z\d]/.test(password)) strength++;
  return strength;
}

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
      showMessage('password-change-message', '✓ Password changed successfully! You will be logged out and need to login with your new password.', 'success');
      setTimeout(() => {
        logout();
      }, 2000);
    } else {
      showMessage('password-change-message', data.error || 'Failed to change password', 'error');
    }
  } catch (error) {
    console.error('Error changing password:', error);
    showMessage('password-change-message', `Connection error: ${error.message}`, 'error');
  }
}

// ============================================
// SECTION: MANAGE SUBSCRIPTION (Framework)
// ============================================

async function loadSubscriptionDetails() {
  const container = $('#subscription-content');
  container.html('<div class="loading">Loading subscription details...</div>');

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/billing/subscription-status`);
    const data = await response.json();

    if (!response.ok) {
      container.html(`<div class="message error">${data.error || 'Failed to load subscription'}</div>`);
      return;
    }

    const statusColor = data.status === 'active' ? '#28a745' : '#dc3545';
    const isEnding = data.status === 'ending';

    // Compute local display for deletion time when ending
    let deletionLocalText = '';
    let userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    if (isEnding) {
      try {
        const endDate = new Date(data.billing_month_end);
        if (isNaN(endDate)) throw new Error('Invalid end date');
        const y = endDate.getUTCFullYear();
        const m = endDate.getUTCMonth();
        const d = endDate.getUTCDate();
        const deletionUTC = new Date(Date.UTC(y, m, d, 23, 30, 0)); // 23:30 UTC on last day
        deletionLocalText = deletionUTC.toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
          timeZone: userTimeZone, timeZoneName: 'short'
        });
      } catch (e) {
        deletionLocalText = 'Unavailable';
      }
    }

    // Fetch items to compute flagged counts and active connections
    let flaggedTx = 0, flaggedInv = 0;
    let activeTx = 0, activeInv = 0;
    try {
      const itemsResp = await authenticatedFetch(`${BACKEND_URL}/api/connections/items`);
      if (itemsResp.ok) {
        const itemsData = await itemsResp.json();
        const items = itemsData.items || [];
        items.forEach(it => {
          const billed = it.billed_products || [];
          const flagged = !!it.removal_flag;
          if (billed.includes('transactions')) {
            activeTx += 1;
            if (flagged) flaggedTx += 1;
          }
          if (billed.includes('investments')) {
            activeInv += 1;
            if (flagged) flaggedInv += 1;
          }
        });
      }
    } catch (e) {
      // ignore errors; counts remain 0
    }
    
    // Calculate projected token renewal (accounting for flagged connections)
    const unflaggedTx = Math.max(0, activeTx - flaggedTx);
    const unflaggedInv = Math.max(0, activeInv - flaggedInv);
    const projectedTxTokens = Math.max(0, data.selected_limits_next.transaction - unflaggedTx);
    const projectedInvTokens = Math.max(0, data.selected_limits_next.investment - unflaggedInv);

    const html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Current Subscription Status</h3>
        </div>
        <p><strong>Status:</strong> <span style="color: ${statusColor}; text-transform: capitalize;">${data.status}</span></p>
        ${isEnding ? '' : `<p><strong>Renewal Date:</strong> ${data.renewal_date}</p>`}
        <p><strong>Billing Period:</strong> ${data.billing_month_start} to ${data.billing_month_end}</p>
        <div style="margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap;">
          ${(!data.status || data.status === 'unsubscribed') ? `
            <button class="btn btn-primary" onclick="startSubscribeFlow()">Subscribe Now</button>
          ` : ''}
          ${(data.status === 'active') ? `
            <button class="btn btn-danger" onclick="cancelSubscription()">Unsubscribe</button>
            <button class="btn btn-secondary" onclick="startUpdatePaymentMethodFlow()">Update Payment Method</button>
          ` : ''}
          ${(data.status === 'first_month') ? `
            <button class="btn btn-danger" onclick="cancelSubscription()">Unsubscribe</button>
            <button class="btn btn-secondary" onclick="startUpdatePaymentMethodFlow()">Update Payment Method</button>
          ` : ''}
          ${(data.status === 'ending') ? `
            <button class="btn btn-success" onclick="keepSubscription()">Keep Subscription</button>
            <button class="btn btn-secondary" onclick="startUpdatePaymentMethodFlow()">Update Payment Method</button>
          ` : ''}
          ${(data.status === 'payment_failed') ? `
            <button class="btn btn-warning" onclick="startFixPaymentFlow()">Fix Payment</button>
          ` : ''}
        </div>
      </div>

      <div id="subscription-message"></div>

      ${isEnding ? '' : `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Your Selected Bank Connections</h3>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          <div>
            <h4 style="margin: 6px 0;">Current Month</h4>
            <div class="form-group">
              <label>Transaction-Based Bank Connections</label>
              <input type="number" value="${data.selected_limits_current.transaction}" min="0" disabled>
              <p class="text-muted">@ \$0.30/month each</p>
            </div>
            <div class="form-group">
              <label>Investment-Based Bank Connections</label>
              <input type="number" value="${data.selected_limits_current.investment}" min="0" disabled>
              <p class="text-muted">@ \$0.18/month each</p>
            </div>
          </div>
          <div>
            <h4 style="margin: 6px 0;">Next Month</h4>
            <div class="form-group">
              <label>Transaction-Based Bank Connections</label>
              <input type="number" value="${data.selected_limits_next.transaction}" min="0" disabled>
              <p class="text-muted">@ \$0.30/month each</p>
            </div>
            <div class="form-group">
              <label>Investment-Based Bank Connections</label>
              <input type="number" value="${data.selected_limits_next.investment}" min="0" disabled>
              <p class="text-muted">@ \$0.18/month each</p>
            </div>
          </div>
        </div>
        ${(data.status === 'first_month') ? `
          <button class="btn btn-primary" disabled title="Changes disabled during first month">Change for Next Month</button>
        ` : `
          <button class="btn btn-primary" onclick="editSubscriptionMode(${data.selected_limits_next.transaction}, ${data.selected_limits_next.investment})">Change for Next Month</button>
        `}
      </div>
      `}

      ${isEnding ? '' : `
      <div class="card" style="background: #fff5f5; border-color: #f5c2c7;">
        <div class="card-header">
          <h3 class="card-title">Flagged for Removal</h3>
        </div>
        <p class="text-muted" style="margin: 0;">These will be removed at renewal unless you unflag them.</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 8px;">
          <div style="background: #fdeaea; padding: 12px; border-radius: 6px;">
            <div style="font-size: 20px; font-weight: 600; color: #b71c1c;">${flaggedTx}</div>
            <div style="color: #666; font-size: 12px;">Transaction Connections</div>
          </div>
          <div style="background: #fdeaea; padding: 12px; border-radius: 6px;">
            <div style="font-size: 20px; font-weight: 600; color: #b71c1c;">${flaggedInv}</div>
            <div style="color: #666; font-size: 12px;">Investment Connections</div>
          </div>
        </div>
      </div>
      `}

      ${isEnding ? '' : `
      <div class="card" style="background: #f0f8ff; border-color: #b3d9ff;">
        <div class="card-header">
          <h3 class="card-title">Projected Token Renewal</h3>
        </div>
        <p class="text-muted" style="margin: 0;">Tokens you will receive at subscription renewal unless changes are made (${data.renewal_date})</p>
        <p class="text-muted" style="margin: 0;">Adjusting subscription or flagging accounts will change these amounts.</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px;">
          <div style="background: #e7f3ff; padding: 12px; border-radius: 6px;">
            <div style="font-size: 14px; color: #666; margin-bottom: 8px;">Transaction Tokens</div>
            <div style="display: flex; align-items: baseline; gap: 8px;">
              <div style="font-size: 28px; font-weight: 600; color: #0066cc;">${projectedTxTokens}</div>
              <div style="color: #999; font-size: 12px;">/ ${data.selected_limits_next.transaction} paid</div>
            </div>
          </div>
          <div style="background: #e7f3ff; padding: 12px; border-radius: 6px;">
            <div style="font-size: 14px; color: #666; margin-bottom: 8px;">Investment Tokens</div>
            <div style="display: flex; align-items: baseline; gap: 8px;">
              <div style="font-size: 28px; font-weight: 600; color: #0066cc;">${projectedInvTokens}</div>
              <div style="color: #999; font-size: 12px;">/ ${data.selected_limits_next.investment} paid</div>
            </div>
          </div>
        </div>
      </div>
      `}

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Monthly Pricing Breakdown</h3>
        </div>
        <div style="display: grid; grid-template-columns: ${isEnding ? '1fr' : '1fr 1fr'}; gap: 16px;">
          <div>
            <h4 style="margin: 6px 0;">Current Month</h4>
            <table style="width: 100%; font-size: 14px;">
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Transaction Tokens (${data.selected_limits_current.transaction} × \$0.30)</td>
                <td style="text-align: right; padding: 8px 0;">\$${(data.selected_limits_current.transaction * data.pricing_breakdown_current.plaid_transaction_fee).toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Investment Tokens (${data.selected_limits_current.investment} × \$0.18)</td>
                <td style="text-align: right; padding: 8px 0;">\$${(data.selected_limits_current.investment * data.pricing_breakdown_current.plaid_investment_fee).toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Server Fee</td>
                <td style="text-align: right; padding: 8px 0;">\$${data.pricing_breakdown_current.server_fee.toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Stripe Processing Fee</td>
                <td style="text-align: right; padding: 8px 0;">\$${data.pricing_breakdown_current.stripe_fee.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>App Fee</strong></td>
                <td style="text-align: right; padding: 8px 0;"><strong>\$${data.pricing_breakdown_current.app_fee.toFixed(2)}</strong></td>
              </tr>
              <tr style="background: #f0f0f0; font-weight: 600; border-radius: 4px;">
                <td style="padding: 12px 8px;"><strong>Total Monthly Cost</strong></td>
                <td style="text-align: right; padding: 12px 8px;"><strong>\$${data.pricing_breakdown_current.total.toFixed(2)}</strong></td>
              </tr>
            </table>
          </div>
          ${isEnding ? '' : `
          <div>
            <h4 style="margin: 6px 0;">Next Month</h4>
            <table style="width: 100%; font-size: 14px;">
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Transaction Tokens (${data.selected_limits_next.transaction} × \$0.30)</td>
                <td style="text-align: right; padding: 8px 0;">\$${(data.selected_limits_next.transaction * data.pricing_breakdown_next.plaid_transaction_fee).toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Investment Tokens (${data.selected_limits_next.investment} × \$0.18)</td>
                <td style="text-align: right; padding: 8px 0;">\$${(data.selected_limits_next.investment * data.pricing_breakdown_next.plaid_investment_fee).toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Server Fee</td>
                <td style="text-align: right; padding: 8px 0;">\$${data.pricing_breakdown_next.server_fee.toFixed(2)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e0e0e0;">
                <td style="padding: 8px 0;">Stripe Processing Fee</td>
                <td style="text-align: right; padding: 8px 0;">\$${data.pricing_breakdown_next.stripe_fee.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>App Fee</strong></td>
                <td style="text-align: right; padding: 8px 0;"><strong>\$${data.pricing_breakdown_next.app_fee.toFixed(2)}</strong></td>
              </tr>
              <tr style="background: #f0f0f0; font-weight: 600; border-radius: 4px;">
                <td style="padding: 12px 8px;"><strong>Total Monthly Cost</strong></td>
                <td style="text-align: right; padding: 12px 8px;"><strong>\$${data.pricing_breakdown_next.total.toFixed(2)}</strong></td>
              </tr>
            </table>
          </div>
          `}
        </div>
      </div>

      ${(data.status === 'ending') ? `
        <div class="card" style="background: #fff5f5; border-color: #f5c2c7;">
          <div class="card-header">
            <h3 class="card-title">Subscription Ending</h3>
          </div>
          <p class="text-muted" style="color: #b71c1c; margin: 0;">
            <strong>You will not be billed again.</strong> You will retain access to your connected accounts and may connect new accounts if you have available tokens.
          </p>
          <p class="text-muted" style="color: #b71c1c; margin: 6px 0 0 0;">
            <strong>Data deletion schedule:</strong> All bank connections and all transaction/investment data will be deleted at <strong>23:30 UTC</strong> on the last day of your current billing period.
          </p>
          <p class="text-muted" style="color: #b71c1c; margin: 6px 0 0 0;">
            Local time: <strong>${deletionLocalText}</strong> (Time zone: <strong>${userTimeZone}</strong>). UTC reference: <strong>23:30</strong>.
          </p>
          <p class="text-muted" style="margin: 6px 0 0 0;">You can delete connections now or click "Keep Subscription" to continue service before the end of the period.</p>
        </div>
      ` : ''}
    `;

    container.html(html);
  } catch (error) {
    console.error('Error loading subscription:', error);
    container.html(`<div class="message error">Connection error: ${error.message}</div>`);
  }
}
// ============================================
// SUBSCRIBE FLOW (Stripe Elements)
// ============================================

let _stripeInstance = null;
let _stripeCardElement = null;

async function getStripe() {
  if (_stripeInstance) return _stripeInstance;
  const resp = await authenticatedFetch(`${BACKEND_URL}/api/connections/stripe-publishable-key`);
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Failed to get Stripe key');
  _stripeInstance = Stripe(data.publishable_key);
  return _stripeInstance;
}

async function startSubscribeFlow() {
  const container = $('#subscription-content');
  // Fetch pricing for display defaults
  let pricing = { transaction_token_price: 0.30, investment_token_price: 0.18, app_fee: 0.50, server_fee: 0.50, stripe_fee: 0.30 };
  try {
    const r = await authenticatedFetch(`${BACKEND_URL}/api/billing/subscription-pricing`);
    const j = await r.json();
    if (r.ok) pricing = j;
  } catch {}

  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Subscribe</h3>
        <p>Your first payment covers current + next full month.</p>
      </div>
      <form id="subscribe-form">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div>
            <h4>Current Month</h4>
            <div class="form-group">
              <label>Transaction Connections</label>
              <input type="number" id="sub-tx-current" value="1" min="0" required>
              <p class="text-muted">@ \$${pricing.transaction_token_price.toFixed(2)} each</p>
            </div>
            <div class="form-group">
              <label>Investment Connections</label>
              <input type="number" id="sub-inv-current" value="1" min="0" required>
              <p class="text-muted">@ \$${pricing.investment_token_price.toFixed(2)} each</p>
            </div>
          </div>
          <div>
            <h4>Next Month</h4>
            <div class="form-group">
              <label>Transaction Connections</label>
              <input type="number" id="sub-tx-next" value="1" min="0" required>
            </div>
            <div class="form-group">
              <label>Investment Connections</label>
              <input type="number" id="sub-inv-next" value="1" min="0" required>
            </div>
          </div>
        </div>
        <div id="card-element" style="padding:12px;border:1px solid #ddd;border-radius:6px;margin-top:12px;"></div>
        <div id="subscribe-summary" class="text-muted" style="margin-top:8px;"></div>
        <div class="flex-group" style="margin-top:12px;">
          <button type="submit" class="btn btn-primary">Pay and Subscribe</button>
          <button type="button" class="btn btn-secondary" onclick="loadSubscriptionDetails()">Cancel</button>
        </div>
      </form>
      <div id="subscribe-message"></div>
    </div>
  `;

  container.html(html);

  // Initialize Stripe Elements
  try {
    const stripe = await getStripe();
    const elements = stripe.elements();
    _stripeCardElement = elements.create('card');
    _stripeCardElement.mount('#card-element');
  } catch (e) {
    showMessage('subscribe-message', `Stripe init failed: ${e.message}`, 'error');
  }

  function updateSummary() {
    const txc = parseInt($('#sub-tx-current').val()) || 0;
    const inc = parseInt($('#sub-inv-current').val()) || 0;
    const txn = parseInt($('#sub-tx-next').val()) || txc;
    const inn = parseInt($('#sub-inv-next').val()) || inc;
    const current = txc * pricing.transaction_token_price + inc * pricing.investment_token_price + pricing.server_fee + pricing.stripe_fee + pricing.app_fee;
    const next = txn * pricing.transaction_token_price + inn * pricing.investment_token_price;
    $('#subscribe-summary').text(`Charge now: $${(current+next).toFixed(2)} (Current: $${current.toFixed(2)}, Next: $${next.toFixed(2)})`);
  }
  $('#sub-tx-current, #sub-inv-current, #sub-tx-next, #sub-inv-next').on('input', updateSummary);
  updateSummary();

  $('#subscribe-form').on('submit', async function(e) {
    e.preventDefault();
    await processSubscription();
  });
}

async function processSubscription() {
  try {
    const txc = parseInt($('#sub-tx-current').val()) || 0;
    const inc = parseInt($('#sub-inv-current').val()) || 0;
    const txn = parseInt($('#sub-tx-next').val()) || txc;
    const inn = parseInt($('#sub-inv-next').val()) || inc;

    const sessionResp = await authenticatedFetch(`${BACKEND_URL}/api/billing/create-subscription-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_current: txc, inv_current: inc, tx_next: txn, inv_next: inn })
    });
    const sessionData = await sessionResp.json();
    if (!sessionResp.ok) {
      showMessage('subscribe-message', sessionData.error || 'Failed to start subscription', 'error');
      return;
    }

    const stripe = await getStripe();
    const confirmResult = await stripe.confirmCardPayment(sessionData.client_secret, {
      payment_method: { card: _stripeCardElement }
    });
    if (confirmResult.error) {
      showMessage('subscribe-message', confirmResult.error.message || 'Payment failed', 'error');
      return;
    }

    const finalizeResp = await authenticatedFetch(`${BACKEND_URL}/api/billing/confirm-subscription`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_intent_id: sessionData.payment_intent_id, tx_current: txc, inv_current: inc, tx_next: txn, inv_next: inn })
    });
    const finalizeData = await finalizeResp.json();
    if (!finalizeResp.ok) {
      showMessage('subscribe-message', finalizeData.error || 'Failed to finalize subscription', 'error');
      return;
    }
    await loadSubscriptionDetails();
    showMessage('subscribe-message', '✓ Subscription confirmed!', 'success');
  } catch (e) {
    console.error('Subscription error:', e);
    showMessage('subscribe-message', `Error: ${e.message}`, 'error');
  }
}

// ============================================
// FIX PAYMENT FLOW (Update Card + Retry Invoice)
// ============================================

let _stripeFixCardElement = null;

async function startFixPaymentFlow() {
  const container = $('#subscription-content');
  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Fix Payment</h3>
        <p>Your last payment failed. Update your card and retry the latest invoice.</p>
      </div>
      <form id="fix-payment-form">
        <div id="fix-card-element" style="padding:12px;border:1px solid #ddd;border-radius:6px;margin-top:12px;"></div>
        <div class="flex-group" style="margin-top:12px;">
          <button type="submit" class="btn btn-warning">Update Card & Retry Payment</button>
          <button type="button" class="btn btn-secondary" onclick="loadSubscriptionDetails()">Cancel</button>
        </div>
      </form>
      <div id="fix-payment-message"></div>
    </div>
  `;

  container.html(html);

  // Initialize Stripe Elements for card update
  try {
    const stripe = await getStripe();
    const elements = stripe.elements();
    _stripeFixCardElement = elements.create('card');
    _stripeFixCardElement.mount('#fix-card-element');
  } catch (e) {
    showMessage('fix-payment-message', `Stripe init failed: ${e.message}`, 'error');
  }

  $('#fix-payment-form').on('submit', async function(e) {
    e.preventDefault();
    await processFixPayment();
  });
}

async function processFixPayment() {
  try {
    // 1) Create a SetupIntent for this customer
    const intentResp = await authenticatedFetch(`${BACKEND_URL}/api/billing/create-setup-intent`, {
      method: 'POST'
    });
    const intentData = await intentResp.json();
    if (!intentResp.ok) {
      showMessage('fix-payment-message', intentData.error || 'Failed to create setup intent', 'error');
      return;
    }

    const stripe = await getStripe();
    const confirmResult = await stripe.confirmCardSetup(intentData.client_secret, {
      payment_method: { card: _stripeFixCardElement }
    });
    if (confirmResult.error) {
      showMessage('fix-payment-message', confirmResult.error.message || 'Card update failed', 'error');
      return;
    }

    // 2) Retry the latest invoice
    const retryResp = await authenticatedFetch(`${BACKEND_URL}/api/billing/retry-latest-invoice`, {
      method: 'POST'
    });
    const retryData = await retryResp.json();
    if (!retryResp.ok) {
      showMessage('fix-payment-message', retryData.error || 'Failed to retry invoice', 'error');
      return;
    }

    await loadSubscriptionDetails();
    showMessage('subscription-message', '✓ Payment method updated. Invoice retry attempted.', 'success');
  } catch (e) {
    console.error('Fix payment error:', e);
    showMessage('fix-payment-message', `Error: ${e.message}`, 'error');
  }
}

// ============================================
// UPDATE PAYMENT METHOD FLOW (Future Payments)
// ============================================

let _stripeUpdateCardElement = null;

async function startUpdatePaymentMethodFlow() {
  const container = $('#subscription-content');
  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Update Payment Method</h3>
        <p>This updates the default card used for future invoices.</p>
      </div>
      <form id="update-pm-form">
        <div id="update-card-element" style="padding:12px;border:1px solid #ddd;border-radius:6px;margin-top:12px;"></div>
        <div class="flex-group" style="margin-top:12px;">
          <button type="submit" class="btn btn-primary">Save New Card</button>
          <button type="button" class="btn btn-secondary" onclick="loadSubscriptionDetails()">Cancel</button>
        </div>
      </form>
      <div id="update-pm-message"></div>
    </div>
  `;

  container.html(html);

  try {
    const stripe = await getStripe();
    const elements = stripe.elements();
    _stripeUpdateCardElement = elements.create('card');
    _stripeUpdateCardElement.mount('#update-card-element');
  } catch (e) {
    showMessage('update-pm-message', `Stripe init failed: ${e.message}`, 'error');
  }

  $('#update-pm-form').on('submit', async function(e) {
    e.preventDefault();
    await processUpdatePaymentMethod();
  });
}

async function processUpdatePaymentMethod() {
  try {
    // 1) Create a SetupIntent
    const intentResp = await authenticatedFetch(`${BACKEND_URL}/api/billing/create-setup-intent`, {
      method: 'POST'
    });
    const intentData = await intentResp.json();
    if (!intentResp.ok) {
      showMessage('update-pm-message', intentData.error || 'Failed to create setup intent', 'error');
      return;
    }

    // 2) Confirm card setup client-side
    const stripe = await getStripe();
    const confirmResult = await stripe.confirmCardSetup(intentData.client_secret, {
      payment_method: { card: _stripeUpdateCardElement }
    });
    if (confirmResult.error) {
      showMessage('update-pm-message', confirmResult.error.message || 'Card update failed', 'error');
      return;
    }

    const setupIntent = confirmResult.setupIntent || {};
    const setup_intent_id = setupIntent.id;
    const payment_method_id = setupIntent.payment_method;

    // 3) Tell backend to set as default payment method
    const setResp = await authenticatedFetch(`${BACKEND_URL}/api/billing/set-default-payment-method`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setup_intent_id, payment_method_id })
    });
    const setData = await setResp.json();
    if (!setResp.ok) {
      showMessage('update-pm-message', setData.error || 'Failed to set default payment method', 'error');
      return;
    }

    await loadSubscriptionDetails();
    showMessage('subscription-message', '✓ Payment method updated for future invoices.', 'success');
  } catch (e) {
    console.error('Update payment method error:', e);
    showMessage('update-pm-message', `Error: ${e.message}`, 'error');
  }
}

async function cancelSubscription() {
  try {
    const r = await authenticatedFetch(`${BACKEND_URL}/api/billing/cancel-subscription`, { method: 'POST' });
    const j = await r.json();
    if (r.ok) {
      await loadSubscriptionDetails();
      showMessage('subscription-message', 'Subscription will end at the end of billing period.', 'success');
    } else {
      showMessage('subscription-message', j.error || 'Failed to cancel', 'error');
    }
  } catch (e) {
    showMessage('subscription-message', `Error: ${e.message}`, 'error');
  }
}

async function keepSubscription() {
  try {
    const r = await authenticatedFetch(`${BACKEND_URL}/api/billing/keep-subscription`, { method: 'POST' });
    const j = await r.json();
    if (r.ok) {
      await loadSubscriptionDetails();
      if (j.status === 'first_month') {
        showMessage('subscription-message', 'Subscription kept; you are still in your first month. Billing will continue as scheduled.', 'success');
      } else {
        showMessage('subscription-message', 'Subscription kept; flags restored.', 'success');
      }
    } else {
      showMessage('subscription-message', j.error || 'Failed to keep subscription', 'error');
    }
  } catch (e) {
    showMessage('subscription-message', `Error: ${e.message}`, 'error');
  }
}

function editSubscriptionMode(nextTx, nextInv) {
  const html = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Adjust Subscription for Next Month</h3>
      </div>
      <form id="subscription-form">
        <div class="form-group">
          <label for="edit-transaction-tokens">Transaction-Based Bank Connections</label>
          <input type="number" id="edit-transaction-tokens" value="${nextTx}" min="0" required>
          <p class="text-muted">@ \$0.30/month each</p>
        </div>
        <div class="form-group">
          <label for="edit-investment-tokens">Investment-Based Bank Connections</label>
          <input type="number" id="edit-investment-tokens" value="${nextInv}" min="0" required>
          <p class="text-muted">@ \$0.18/month each</p>
        </div>
        <div class="flex-group">
          <button type="submit" class="btn btn-primary">Calculate New Total</button>
          <button type="button" class="btn btn-secondary" onclick="loadSubscriptionDetails()">Cancel</button>
        </div>
      </form>
      <div id="subscription-edit-message"></div>
    </div>
  `;

  $('#subscription-content').html(html);

  $('#subscription-form').on('submit', async function(e) {
    e.preventDefault();
    await calculateNewSubscriptionTotal();
  });
}

async function calculateNewSubscriptionTotal() {
  const transactionTokens = parseInt($('#edit-transaction-tokens').val()) || 0;
  const investmentTokens = parseInt($('#edit-investment-tokens').val()) || 0;

  // Client-side minimum check based on active minus flagged items (advisory; backend enforces too)
  try {
    const resp = await authenticatedFetch(`${BACKEND_URL}/api/connections/items`);
    if (resp.ok) {
      const data = await resp.json();
      const items = data.items || [];
      let activeTx = 0, activeInv = 0, flaggedTx = 0, flaggedInv = 0;
      items.forEach(it => {
        const billed = it.billed_products || [];
        const flagged = !!it.removal_flag;
        if (billed.includes('transactions')) {
          activeTx += 1;
          if (flagged) flaggedTx += 1;
        }
        if (billed.includes('investments')) {
          activeInv += 1;
          if (flagged) flaggedInv += 1;
        }
      });
      const minTx = Math.max(activeTx - flaggedTx, 0);
      const minInv = Math.max(activeInv - flaggedInv, 0);
      if (transactionTokens < minTx || investmentTokens < minInv) {
        showMessage('subscription-edit-message', `Minimums based on current connections: Tx ≥ ${minTx}, Inv ≥ ${minInv}. Adjust your next-month limits.`, 'error');
        return;
      }
    }
  } catch (e) {
    // If constraint fetch fails, proceed to show totals; backend will still enforce minimums.
  }

  const transactionCost = transactionTokens * 0.30;
  const investmentCost = investmentTokens * 0.18;
  const serverFee = 0.50;
  const stripeFee = 0.30;
  const appFee = 0.50;
  const total = transactionCost + investmentCost + serverFee + stripeFee + appFee;

  const summary = `
    <div class="card" style="margin-top: 20px;">
      <div class="card-header">
        <h3 class="card-title">Next Month's Estimated Total</h3>
      </div>
      <table style="width: 100%; font-size: 14px;">
        <tr style="border-bottom: 1px solid #e0e0e0;">
          <td style="padding: 8px 0;">Plaid Transaction Fees (${transactionTokens} × \$0.30)</td>
          <td style="text-align: right; padding: 8px 0;">\$${transactionCost.toFixed(2)}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e0e0e0;">
          <td style="padding: 8px 0;">Plaid Investment Fees (${investmentTokens} × \$0.18)</td>
          <td style="text-align: right; padding: 8px 0;">\$${investmentCost.toFixed(2)}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e0e0e0;">
          <td style="padding: 8px 0;">Server Fee</td>
          <td style="text-align: right; padding: 8px 0;">\$${serverFee.toFixed(2)}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e0e0e0;">
          <td style="padding: 8px 0;">Stripe Processing Fee</td>
          <td style="text-align: right; padding: 8px 0;">\$${stripeFee.toFixed(2)}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e0e0e0;">
          <td style="padding: 8px 0;">App Fee</td>
          <td style="text-align: right; padding: 8px 0;">\$${appFee.toFixed(2)}</td>
        </tr>
        <tr style="background: #f0f0f0; font-weight: 600;">
          <td style="padding: 12px 8px;"><strong>Total Monthly Cost</strong></td>
          <td style="text-align: right; padding: 12px 8px;"><strong>\$${total.toFixed(2)}</strong></td>
        </tr>
      </table>
      <div class="flex-group" style="margin-top: 20px;">
        <button type="button" class="btn btn-primary" onclick="confirmSubscriptionUpdate(${transactionTokens}, ${investmentTokens})">Confirm Changes</button>
        <button type="button" class="btn btn-secondary" onclick="loadSubscriptionDetails()">Cancel</button>
      </div>
    </div>
  `;

  $('#subscription-edit-message').html(summary);
}

async function confirmSubscriptionUpdate(transactionTokens, investmentTokens) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/billing/subscription-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        transaction_tokens: transactionTokens,
        investment_tokens: investmentTokens
      })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('subscription-edit-message', '✓ Subscription updated for next month!', 'success');
      setTimeout(() => loadSubscriptionDetails(), 1500);
    } else {
      let msg = data.error || 'Failed to update subscription';
      if (data.details) {
        msg += ` (Min Tx: ${data.details.min_tx_required}, Min Inv: ${data.details.min_inv_required})`;
      }
      showMessage('subscription-edit-message', msg, 'error');
    }
  } catch (error) {
    console.error('Error updating subscription:', error);
    showMessage('subscription-edit-message', `Connection error: ${error.message}`, 'error');
  }
}

// ============================================
// SECTION: TOKEN WALLET
// ============================================

async function loadTokenWallet() {
  const container = $('#tokens-content');
  container.html('<div class="loading">Loading token wallet...</div>');

  try {
    // Fetch wallet data and history in parallel
    const [walletResponse, historyResponse] = await Promise.all([
      authenticatedFetch(`${BACKEND_URL}/api/billing/token-wallet`),
      authenticatedFetch(`${BACKEND_URL}/api/billing/get-token-history?page=1&per_page=10`)
    ]);

    const walletData = await walletResponse.json();
    const historyData = await historyResponse.json();

    if (!walletResponse.ok) {
      container.html(`<div class="message error">${walletData.error || 'Failed to load token wallet'}</div>`);
      return;
    }

    // Build History Rows
    let historyRows = '';
    if (historyData.history && historyData.history.length > 0) {
      historyRows = historyData.history.map(item => {
        let badgeClass = 'badge-default';
        let badgeColor = '#666';
        let badgeBg = '#f0f0f0';
        
        if (item.token_type === 'transaction') {
          badgeColor = '#1976d2';
          badgeBg = '#e3f2fd';
        } else if (item.token_type === 'investment') {
          badgeColor = '#e65100';
          badgeBg = '#fff3e0';
        }

        return `
          <tr style="border-bottom: 1px solid #e0e0e0;">
            <td style="padding: 10px 0;">${item.date}</td>
            <td style="padding: 10px 0;"><span style="background: ${badgeBg}; color: ${badgeColor}; padding: 2px 6px; border-radius: 3px; font-size: 11px; text-transform: capitalize;">${item.token_type}</span></td>
            <td style="padding: 10px 0;">${item.action}</td>
            <td style="padding: 10px 0;">${item.reason || '-'}</td>
            <td style="text-align: right; padding: 10px 0;"><strong>${item.balance}</strong></td>
          </tr>
        `;
      }).join('');
    } else {
      historyRows = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #666;">No token history available.</td></tr>';
    }

    const html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Current Token Balance</h3>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
          <div style="background: #f0f0f0; padding: 15px; border-radius: 6px; text-align: center;">
            <div style="font-size: 32px; font-weight: 600; color: #182742;">${walletData.current_tokens.transaction}</div>
            <div style="color: #666; font-size: 12px;">Transaction Tokens</div>
            <p class="text-muted" style="font-size: 11px; margin-top: 5px;">Each connection costs \$0.30/mo</p>
          </div>
          <div style="background: #f0f0f0; padding: 15px; border-radius: 6px; text-align: center;">
            <div style="font-size: 32px; font-weight: 600; color: #182742;">${walletData.current_tokens.investment}</div>
            <div style="color: #666; font-size: 12px;">Investment Tokens</div>
            <p class="text-muted" style="font-size: 11px; margin-top: 5px;">Each connection costs \$0.18/mo</p>
          </div>
          <div style="background: #f0f0f0; padding: 15px; border-radius: 6px; text-align: center;">
            <div style="font-size: 32px; font-weight: 600; color: #182742;">${walletData.current_tokens.swap}</div>
            <div style="color: #666; font-size: 12px;">Swap Tokens</div>
            <p class="text-muted" style="font-size: 11px; margin-top: 5px;">Swap banks within month</p>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Token Usage History</h3>
        </div>
        <div style="overflow-x: auto;">
          <table style="width: 100%; font-size: 13px;">
            <thead>
              <tr style="border-bottom: 2px solid #e0e0e0;">
                <th style="text-align: left; padding: 10px 0;">Date</th>
                <th style="text-align: left; padding: 10px 0;">Token Type</th>
                <th style="text-align: left; padding: 10px 0;">Action</th>
                <th style="text-align: left; padding: 10px 0;">Reason</th>
                <th style="text-align: right; padding: 10px 0;">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${historyRows}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card" style="background: #efe; border-color: #cfc;">
        <p class="text-muted" style="color: #3c3; margin: 0;">
          <strong>Next Refill:</strong> Your tokens will be refilled on the next billing cycle based on your subscription settings.
        </p>
      </div>
    `;

    container.html(html);
  } catch (error) {
    console.error('Error loading token wallet:', error);
    container.html(`<div class="message error">Connection error: ${error.message}</div>`);
  }
}


// ============================================
// SECTION: TWO-FACTOR AUTHENTICATION
// ============================================

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
    
    let html = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Current Status</h3>
        </div>
        <p>Two-Factor Authentication is currently <strong style="color: ${twoFAEnabled ? '#28a745' : '#dc3545'};">${twoFAEnabled ? 'Enabled' : 'Disabled'}</strong></p>
        <div class="flex-group">
          ${twoFAEnabled ? 
            `<button class="btn btn-secondary" onclick="disableTwoFactorAuth()" style="background-color: #dc3545;">Disable 2FA</button>` :
            `<button class="btn btn-primary" onclick="startTwoFactorSetup()">Enable 2FA</button>`
          }
        </div>
      </div>
    `;

    // Setup area (initially hidden)
    if (!twoFAEnabled) {
      html += `
        <div id="twofa-setup-area" class="card" style="display: none;">
          <div class="card-header">
            <h3 class="card-title">Setup Two-Factor Authentication</h3>
          </div>
          <p>Follow these steps to enable 2FA on your account:</p>
          
          <p><strong>Step 1: Scan QR Code</strong></p>
          <p style="color: #666; font-size: 14px;">Use an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator:</p>
          <div id="twofa-qr-code" style="margin: 15px 0; text-align: center;"></div>
          
          <p><strong>Step 2: Manual Entry</strong></p>
          <p style="color: #666; font-size: 14px;">Or enter this key manually:</p>
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

function startTwoFactorSetup() {
  $('#twofa-setup-area').slideDown(300);
  fetchTwoFactorSecret();
}

function cancelTwoFactorSetup() {
  $('#twofa-setup-area').slideUp(300);
}

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
      // Try to display QR code if available
      if (data.qr_code) {
        $('#twofa-qr-code').html(`<img src="data:image/png;base64,${data.qr_code}" alt="2FA QR Code" style="max-width: 250px; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">`);
      }
    } else {
      showMessage('twofa-setup-message', data.error || 'Failed to generate 2FA secret', 'error');
    }
  } catch (error) {
    console.error('Error fetching 2FA secret:', error);
    showMessage('twofa-setup-message', 'Connection error: ' + error.message, 'error');
  }
}

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
      body: JSON.stringify({ code: code })
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('twofa-message', '✓ Two-Factor Authentication enabled successfully!', 'success');
      setTimeout(() => {
        loadTwoFactorAuthSettings();
      }, 2000);
    } else {
      showMessage('twofa-setup-message', data.error || 'Invalid code. Please try again.', 'error');
    }
  } catch (error) {
    console.error('Error verifying 2FA:', error);
    showMessage('twofa-setup-message', 'Connection error: ' + error.message, 'error');
  }
}

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
      setTimeout(() => {
        loadTwoFactorAuthSettings();
      }, 1500);
    } else {
      showMessage('twofa-message', data.error || 'Failed to disable 2FA', 'error');
    }
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    showMessage('twofa-message', 'Connection error: ' + error.message, 'error');
  }
}


// ============================================
// SECTION: ACCOUNT DELETION
// ============================================

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

  // Fetch and render pending banner
  renderDeletionPendingBanner();
}

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
      setTimeout(() => {
        loadAccountDeletionForm();
      }, 3000);
    } else {
      showMessage('deletion-message', data.error || 'Failed to request deletion', 'error');
    }
  } catch (error) {
    console.error('Error requesting deletion:', error);
    showMessage('deletion-message', `Connection error: ${error.message}`, 'error');
  }
}

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
      setTimeout(() => {
        loadAccountDeletionForm();
      }, 2000);
    } else {
      showMessage('deletion-message', data.error || 'Failed to cancel deletion request', 'error');
    }
  } catch (error) {
    console.error('Error canceling deletion:', error);
    showMessage('deletion-message', `Connection error: ${error.message}`, 'error');
  }
}

async function renderDeletionPendingBanner() {
  const banner = $('#deletion-pending-banner');
  try {
    const data = await fetchDeletionStatus();
    if (response.ok && data.pending) {
      const expires = data.token_expires_at ? ` This link expires at ${new Date(data.token_expires_at).toLocaleString()}.` : '';
      banner.html(`
        <div class="card" style="background: #fff8e1; border-color: #ffe082; margin-bottom: 16px;">
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <div style="font-size: 20px;">⌛</div>
            <div>
              <p style="margin: 0; font-weight: 600;">Deletion pending</p>
              <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Check your email to confirm account ownership and complete the deletion process.${expires}</p>
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

async function renderGlobalDeletionBanner() {
  const banner = $('#global-deletion-banner');
  if (!banner.length) return;
  try {
    const data = await fetchDeletionStatus();
    if (data.pending) {
      const expires = data.token_expires_at ? ` This link expires at ${new Date(data.token_expires_at).toLocaleString()}.` : '';
      banner.html(`
        <div class="card" style="background: #fff8e1; border-color: #ffe082; margin-bottom: 16px;">
          <div style="display: flex; gap: 10px; align-items: flex-start;">
            <div style="font-size: 20px;">⌛</div>
            <div>
              <p style="margin: 0; font-weight: 600;">Deletion pending</p>
              <p style="margin: 4px 0 0 0; color: #666; font-size: 13px;">Check your email to confirm account ownership and complete the deletion process.${expires}</p>
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

async function fetchDeletionStatus() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/deletion-status`, { method: 'GET' });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch deletion status');
  }
  return data;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

async function handleAccountDeletionConfirmation(token) {
  const container = document.body;
  container.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
        <h2 style="color: #182742; margin-bottom: 20px;">Processing Account Deletion...</h2>
        <div class="loading">Please wait while we delete your account</div>
      </div>
    </div>
  `;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/confirm-account-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_token: token })
    });

    const data = await response.json();

    if (response.ok) {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #28a745; margin-bottom: 20px;">✓ Account Deleted</h2>
            <p style="color: #666; margin-bottom: 20px;">${data.message}</p>
            <p style="color: #666; margin-bottom: 30px;">You will be redirected to the login page in 3 seconds...</p>
            <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login Now</a>
          </div>
        </div>
      `;
      setTimeout(() => {
        // Clear all stored auth data
        localStorage.clear();
        window.location.href = 'index.html';
      }, 3000);
    } else {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Cannot Delete Account</h2>
            <p style="color: #666; margin-bottom: 20px;">${data.error || 'Unable to delete your account.'}</p>
            <p style="color: #999; font-size: 14px; margin-bottom: 20px;">${data.details || ''}</p>
            <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
          </div>
        </div>
      `;
      setTimeout(() => {
        localStorage.clear();
        window.location.href = 'index.html';
      }, 5000);
    }
  } catch (error) {
    console.error('Error confirming account deletion:', error);
    container.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
          <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Connection Error</h2>
          <p style="color: #666; margin-bottom: 20px;">Unable to process your deletion request. Please try again later.</p>
          <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
        </div>
      </div>
    `;
  }
}

async function handleAccountDeletionCancellation(token) {
  const container = document.body;
  container.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
        <h2 style="color: #182742; margin-bottom: 20px;">Canceling Deletion Request...</h2>
        <div class="loading">Please wait</div>
      </div>
    </div>
  `;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/cancel-account-deletion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletion_token: token })
    });

    const data = await response.json();

    if (response.ok) {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #28a745; margin-bottom: 20px;">✓ Deletion Request Canceled</h2>
            <p style="color: #666; margin-bottom: 30px;">You can continue using your account.</p>
            <a href="account.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Account</a>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Unable to Cancel</h2>
            <p style="color: #666; margin-bottom: 20px;">${data.error || 'Unable to cancel deletion request.'}</p>
            <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error canceling account deletion:', error);
    container.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
          <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Connection Error</h2>
          <p style="color: #666; margin-bottom: 20px;">Unable to process your cancellation. Please try again later.</p>
          <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
        </div>
      </div>
    `;
  }
}

function showMessage(elementId, message, type) {
  $(`#${elementId}`).html(`<div class="message ${type}">${message}</div>`);
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

async function refreshAccessToken() {
  if (!refreshToken) {
    logout();
    return false;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (response.ok) {
      const data = await response.json();
      authToken = data.access_token;
      localStorage.setItem('authToken', authToken);

      if (data.refresh_token) {
        refreshToken = data.refresh_token;
        localStorage.setItem('refreshToken', refreshToken);
      }

      return true;
    } else {
      logout();
      return false;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    logout();
    return false;
  }
}

async function authenticatedFetch(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();

    if (refreshed) {
      headers['Authorization'] = `Bearer ${authToken}`;
      return fetch(url, { ...options, headers });
    }
  }

  return response;
}

function setupActivityListeners() {
  // Placeholder for activity listeners if needed
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  authToken = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// ============================================
// EMAIL VERIFICATION HANDLERS
// ============================================

async function handleEmailVerification(token) {
  const container = document.body;
  container.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
        <h2 style="color: #182742; margin-bottom: 20px;">Verifying Email...</h2>
        <div class="loading">Please wait while we verify your new email address</div>
      </div>
    </div>
  `;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/verify-email-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await response.json();

    if (response.ok) {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #28a745; margin-bottom: 20px;">✓ Email Verified Successfully!</h2>
            <p style="color: #666; margin-bottom: 20px;">${data.message}</p>
            <p style="color: #666; margin-bottom: 30px;">You will be redirected to the login page in 3 seconds...</p>
            <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login Now</a>
          </div>
        </div>
      `;
      setTimeout(() => {
        // Logout and redirect to login
        localStorage.clear();
        window.location.href = 'index.html';
      }, 3000);
    } else {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Verification Failed</h2>
            <p style="color: #666; margin-bottom: 20px;">${data.error || 'The verification link is invalid or has expired.'}</p>
            <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error verifying email:', error);
    container.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
          <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Connection Error</h2>
          <p style="color: #666; margin-bottom: 20px;">Unable to verify email. Please try again later.</p>
          <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
        </div>
      </div>
    `;
  }
}

async function handleEmailRejection(token) {
  const container = document.body;
  container.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
      <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
        <h2 style="color: #182742; margin-bottom: 20px;">Processing Security Request...</h2>
        <div class="loading">Please wait while we secure your account</div>
      </div>
    </div>
  `;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/reject-email-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await response.json();

    if (response.ok) {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #dc3545; margin-bottom: 20px;">🔒 Account Locked for Security</h2>
            <p style="color: #666; margin-bottom: 15px;">${data.message}</p>
            <p style="color: #666; margin-bottom: 20px;">We've sent a password reset link to your email. Please check your inbox to reset your password and unlock your account.</p>
            <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
          </div>
        </div>
      `;
      // Clear any stored auth tokens
      localStorage.clear();
    } else {
      container.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
            <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Error</h2>
            <p style="color: #666; margin-bottom: 20px;">${data.error || 'The security link is invalid or has expired.'}</p>
            <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
          </div>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error rejecting email change:', error);
    container.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
          <h2 style="color: #dc3545; margin-bottom: 20px;">❌ Connection Error</h2>
          <p style="color: #666; margin-bottom: 20px;">Unable to process your request. Please try again later.</p>
          <a href="index.html" class="btn btn-primary" style="text-decoration: none; display: inline-block;">Go to Login</a>
        </div>
      </div>
    `;
  }
}
