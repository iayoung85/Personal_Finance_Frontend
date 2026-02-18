// Core frontend logic for personal-use app

let authToken = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = null;
let tempLoginCreds = null;

function refreshAuthState() {
  authToken = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (e) {
    console.error('Error parsing currentUser from localStorage', e);
    localStorage.removeItem('currentUser');
    currentUser = null;
  }
}

refreshAuthState();

$(document).ready(async function() {
  try {
    await window.BACKEND_URL_PROMISE;
    // Don't auto-login on the login page - let user register or login normally
    // Auto-login only happens on protected pages (transactions, investments, etc.)
    refreshAuthState();
    if (authToken && currentUser) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('Initialization error:', e);
    showLogin();
  }
});

function showLogin() {
  $('#login-view').removeClass('hidden');
  $('#register-view').addClass('hidden');
  $('#dashboard-view').addClass('hidden');
  $('#forgot-password-view').addClass('hidden');
  $('#two-factor-view').addClass('hidden');
  clearMessages();
}

function showRegister() {
  $('#login-view').addClass('hidden');
  $('#register-view').removeClass('hidden');
  $('#dashboard-view').addClass('hidden');
  $('#forgot-password-view').addClass('hidden');
  $('#two-factor-view').addClass('hidden');
  clearMessages();
}

function showForgotPassword() {
  $('#login-view').addClass('hidden');
  $('#register-view').addClass('hidden');
  $('#dashboard-view').addClass('hidden');
  $('#forgot-password-view').removeClass('hidden');
  $('#two-factor-view').addClass('hidden');
  clearMessages();
}

function showTwoFactorLogin() {
  $('#login-view').addClass('hidden');
  $('#register-view').addClass('hidden');
  $('#dashboard-view').addClass('hidden');
  $('#forgot-password-view').addClass('hidden');
  $('#two-factor-view').removeClass('hidden');
  clearMessages();
  $('#two-factor-code').focus();
}

function showDashboard() {
  $('#login-view').addClass('hidden');
  $('#register-view').addClass('hidden');
  $('#dashboard-view').removeClass('hidden');
  $('#forgot-password-view').addClass('hidden');
  $('#two-factor-view').addClass('hidden');
  $('#user-email').text(currentUser?.email || '');
  $('#user-name').text(`${currentUser?.first_name || ''} ${currentUser?.last_name || ''}`.trim());
  clearMessages();
  loadConnectedBanks();
}

function clearMessages() {
  $('#login-message, #register-message, #dashboard-message, #forgot-message, #two-factor-message').html('');
}

function showMessage(containerId, message, type) {
  $(`#${containerId}`).html(`<div class="message ${type}">${message}</div>`);
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  // Invalidate cached Plaid item info on logout
  localStorage.removeItem(ITEM_INFO_CACHE_KEY);
  authToken = null;
  refreshToken = null;
  currentUser = null;
  showLogin();
}

async function refreshAccessToken() {
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-cache'
    });
    if (!response.ok) return false;
    const data = await response.json();
    authToken = data.access_token;
    localStorage.setItem('authToken', authToken);
    if (data.refresh_token) {
      refreshToken = data.refresh_token;
      localStorage.setItem('refreshToken', refreshToken);
    }
    return true;
  } catch (error) {
    return false;
  }
}



async function authenticatedFetch(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    ...options.headers
  };
  const response = await fetch(url, { ...options, headers, cache: 'no-cache' });
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${authToken}`;
      return fetch(url, { ...options, headers, cache: 'no-cache' });
    }
  }
  return response;
}

async function fetchLinkToken(itemId = null, mode = null) {
  let url = `${BACKEND_URL}/api/connections/create_link_token`;
  const params = [];
  if (itemId) params.push(`item_id=${encodeURIComponent(itemId)}`);
  if (mode) params.push(`mode=${encodeURIComponent(mode)}`);
  if (params.length) url += `?${params.join('&')}`;
  const response = await authenticatedFetch(url, { method: 'GET' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch link token');
  }
  const data = await response.json();
  return data.link_token;
}

async function exchangePublicToken(public_token) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/set_access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_token })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to connect bank');
  }
  return data;
}

async function getUserItems() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/items`, { method: 'GET' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to load connections');
  }
  const data = await response.json();
  return data.items || [];
}

async function loadConnectedBanks() {
  const connectionsList = $('#connections-list');
  connectionsList.html('Loading connected banks...');
  try {
    const items = await getUserItems();
    if (!items.length) {
      connectionsList.html('<p style="color: #666; font-style: italic; margin-bottom: 8px">No connected banks yet. Click "Connect New Bank" to get started.</p>');
      return;
    }

    let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
    items.forEach(item => {
      const instName = item.institution_name || 'Unknown Bank';
      const itemId = item.plaid_item_id;
      html += `
        <li style="
          margin-bottom: 8px; 
          padding: 12px 16px; 
          background: #f7f9fc;
          border: 1px solid #e3e7ef;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-weight: 500;
          color: #333;
        ">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 18px;">🏦</span>
            <span>${instName}</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button onclick="reconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}')" style="background: #28a745; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer;">Refresh</button>
            <button onclick="disconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}')" style="background: #dc3545; color: #fff; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer;">Disconnect</button>
          </div>
        </li>`;
    });
    html += '</ul>';
    connectionsList.html(html);
  } catch (error) {
    connectionsList.html(`<p style="color: #c33;">Error loading connected banks: ${error.message}</p>`);
  }
}

async function reconnectBank(itemId, bankName) {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }

  try {
    const linkToken = await fetchLinkToken(itemId);
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: async () => {
        try {
          const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/refresh_item_accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId })
          });

          if (response.ok) {
            // Invalidate cached item_info for this item so UI will re-query fresh product info
            invalidateItemInfoCache(itemId);
            showMessage('dashboard-message', `✓ ${bankName} refreshed successfully!`, 'success');
          } else {
            showMessage('dashboard-message', `✓ ${bankName} refreshed, but failed to sync accounts`, 'success');
          }
          loadConnectedBanks();
        } catch (error) {
          showMessage('dashboard-message', 'Error: ' + error.message, 'error');
        }
      },
      onExit: (err) => {
        if (err != null) {
          showMessage('dashboard-message', 'Refresh cancelled or failed', 'error');
        }
      }
    });
    handler.open();
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
}

async function disconnectBank(itemId, bankName) {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }

  if (!confirm(`⚠️ WARNING: Disconnect ${bankName}?\n\nIf you're having connection issues or need to update your credentials, click the refresh button for the chosen bank to reconnect.\n\nAre you sure you want to permanently disconnect ${bankName}?`)) {
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/remove_item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, confirm_remove: true })
    });

    const data = await response.json();

    if (response.ok) {
      // Invalidate cache for the removed item
      invalidateItemInfoCache(itemId);
      showMessage('dashboard-message', '✓ Bank disconnected successfully!', 'success');
      loadConnectedBanks();
    } else {
      showMessage('dashboard-message', 'Error: ' + (data.error || 'Failed to disconnect bank'), 'error');
    }
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
}

// Login
$('#login-form').on('submit', async function(e) {
  e.preventDefault();
  const email = $('#login-email').val();
  const password = $('#login-password').val();

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-cache'
    });

    const data = await response.json();

    if (response.ok && data.require_2fa) {
      tempLoginCreds = { email, password };
      showTwoFactorLogin();
      return;
    }

    if (response.ok) {
      authToken = data.access_token;
      refreshToken = data.refresh_token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      showDashboard();
      return;
    }

    showMessage('login-message', data.error || 'Login failed', 'error');
  } catch (error) {
    showMessage('login-message', 'Connection error: ' + error.message, 'error');
  }
});

// Two-Factor Login
$('#two-factor-form').on('submit', async function(e) {
  e.preventDefault();
  const code = $('#two-factor-code').val().trim();
  if (!tempLoginCreds) {
    showMessage('two-factor-message', 'Session expired. Please login again.', 'error');
    showLogin();
    return;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: tempLoginCreds.email,
        password: tempLoginCreds.password,
        totp_code: code
      }),
      cache: 'no-cache'
    });

    const data = await response.json();

    if (response.ok) {
      authToken = data.access_token;
      refreshToken = data.refresh_token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      tempLoginCreds = null;
      showDashboard();
      return;
    }

    showMessage('two-factor-message', data.error || 'Verification failed', 'error');
  } catch (error) {
    showMessage('two-factor-message', 'Connection error: ' + error.message, 'error');
  }
});

// Forgot Password
$('#forgot-form').on('submit', async function(e) {
  e.preventDefault();
  const email = $('#forgot-email').val();
  const frontendUrl = window.location.origin;

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/forgot_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, frontend_url: frontendUrl }),
      cache: 'no-cache'
    });

    const data = await response.json();

    if (response.ok) {
      $('#forgot-password-view').html(`
        <h1>Reset Password</h1>
        <p class="subtitle">We've sent a reset link to ${email}</p>
        <button type="button" class="btn btn-primary" onclick="showLogin()">Back to Login</button>
      `);
      return;
    }

    showMessage('forgot-message', data.error || 'Request failed', 'error');
  } catch (error) {
    showMessage('forgot-message', 'Connection error: ' + error.message, 'error');
  }
});

// Register
$('#register-form').on('submit', async function(e) {
  e.preventDefault();
  const firstName = $('#register-firstname').val();
  const lastName = $('#register-lastname').val();
  const email = $('#register-email').val();
  const password = $('#register-password').val();
  const frontendUrl = window.location.origin;

  try {
    const statusResp = await fetch(`${BACKEND_URL}/api/auth/registration-status`, {
      cache: 'no-cache'
    });
    const statusData = await statusResp.json();
    if (!statusResp.ok || !statusData.enabled) {
      showMessage('register-message', 'Registration is currently disabled.', 'error');
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        frontend_url: frontendUrl
      }),
      cache: 'no-cache'
    });

    const data = await response.json();

    if (response.ok) {
      showMessage('register-message', 'Registration successful. Please log in.', 'success');
      setTimeout(showLogin, 800);
      return;
    }

    showMessage('register-message', data.error || 'Registration failed', 'error');
  } catch (error) {
    showMessage('register-message', 'Connection error: ' + error.message, 'error');
  }
});

// Connect new bank
$('#link-button').on('click', async function() {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }

  try {
    const linkToken = await fetchLinkToken();
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: async (public_token) => {
        try {
          const result = await exchangePublicToken(public_token);
          showMessage('dashboard-message', '✓ Bank connected successfully!', 'success');
          
          // Clear transactions page caches
          localStorage.removeItem('transactionsCache');
          localStorage.removeItem('transactionsAccountsCache');
          // Invalidate item_info cache so new item shows up correctly
          invalidateItemInfoCache();
          
          // Set flag for investments page to auto-sync new items (if investments were included)
          if (result.billed_products && result.billed_products.includes('investments')) {
            sessionStorage.setItem('newInvestmentItems', JSON.stringify([result.item_id]));
          }
          
          loadConnectedBanks();
        } catch (error) {
          showMessage('dashboard-message', 'Error: ' + error.message, 'error');
        }
      }
    });
    handler.open();
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
});

// Connect investment-only bank
$('#link-investment-button').on('click', async function() {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }

  try {
    const linkToken = await fetchLinkToken(null, 'investments_only');
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: async (public_token) => {
        try {
          const result = await exchangePublicToken(public_token);
          showMessage('dashboard-message', '✓ Bank connected successfully!', 'success');
          
          // Clear transactions page caches
          localStorage.removeItem('transactionsCache');
          localStorage.removeItem('transactionsAccountsCache');
          
          // Set flag for investments page to auto-sync new items
          if (result.item_id) {
            sessionStorage.setItem('newInvestmentItems', JSON.stringify([result.item_id]));
          }
          
          loadConnectedBanks();
        } catch (error) {
          showMessage('dashboard-message', 'Error: ' + error.message, 'error');
        }
      }
    });
    handler.open();
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
});
