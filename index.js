// BACKEND_URL is now defined in config.js and auto-detects environment

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
let idleTimeout;
let tempLoginCreds = null; // For 2FA login flow
let pageHiddenTime = null; // Track when page was hidden
let turnstileWidgetId = null;
let turnstileResolver = null;
let turnstileRejecter = null;
let turnstileInitPromise = null;

// Idle timeout settings (30 minutes of inactivity)
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
const SESSION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_CACHE_PREFIX = 'iay:sesscache:v1';

function buildSessionCacheKey(baseKey) {
  const userKey = currentUser && currentUser.email ? currentUser.email : 'anon';
  return `${SESSION_CACHE_PREFIX}:${userKey}:${baseKey}`;
}

function readSessionCache(baseKey) {
  const key = buildSessionCacheKey(baseKey);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.timestamp) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() - parsed.timestamp > SESSION_CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch (error) {
    sessionStorage.removeItem(key);
    return null;
  }
}

function writeSessionCache(baseKey, data) {
  const key = buildSessionCacheKey(baseKey);
  try {
    sessionStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
  } catch (error) {
    // Ignore storage failures (quota, private mode, etc.)
  }
}

function clearSessionCache(baseKey) {
  try {
    sessionStorage.removeItem(buildSessionCacheKey(baseKey));
  } catch (error) {
    // Ignore storage failures
  }
}

// Clear all data caches from other pages when bank connections change
function clearAllDataCaches() {
  // Clear transactions.js caches
  try {
    localStorage.removeItem('transactionsCache');
    localStorage.removeItem('transactionsAccountsCache');
    localStorage.removeItem('transactionsViewerSettingsCache');
  } catch (error) {}
  
  // Clear investments.js caches
  try {
    localStorage.removeItem('investmentHoldingsCache');
    localStorage.removeItem('investmentAccountsCache');
    localStorage.removeItem('investmentAccountsStatusCache');
  } catch (error) {}
}

// Show appropriate view on page load
$(document).ready(async function() {
  try {
    await window.BACKEND_URL_PROMISE;
    
    if (authToken && currentUser) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch (e) {
    console.error('Error in initialization:', e);
    // Fallback to login if something goes wrong
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

async function initTurnstileWidget() {
  if (turnstileInitPromise) {
    return turnstileInitPromise;
  }

  turnstileInitPromise = (async () => {
    if (!window.turnstile) {
      return;
    }

    await window.BACKEND_URL_PROMISE;
    const resolvedBackend = window.BACKEND_URL || '';
    let siteKey = '0x4AAAAAACNX3qSz6p5n1wCN';

    if (resolvedBackend.includes('127.0.0.1')) {
      siteKey = '1x00000000000000000000AA';
    } else if (resolvedBackend.includes('railway.app')) {
      siteKey = '0x4AAAAAACNX3qSz6p5n1wCN';
    }

    turnstileWidgetId = window.turnstile.render('#turnstile-container', {
      sitekey: siteKey,
      size: 'normal',
      execution: 'execute',
      appearance: 'execute',
      callback: (token) => {
        if (turnstileResolver) {
          const resolve = turnstileResolver;
          turnstileResolver = null;
          turnstileRejecter = null;
          resolve(token);
        }
      },
      'error-callback': () => {
        if (turnstileRejecter) {
          const reject = turnstileRejecter;
          turnstileResolver = null;
          turnstileRejecter = null;
          reject(new Error('Captcha error. Please try again.'));
        }
      },
      'expired-callback': () => {
        if (turnstileRejecter) {
          const reject = turnstileRejecter;
          turnstileResolver = null;
          turnstileRejecter = null;
          reject(new Error('Captcha expired. Please try again.'));
        }
      }
    });
  })();

  return turnstileInitPromise;
}

window.turnstileReady = function () {
  initTurnstileWidget();
};

async function getTurnstileToken() {
  await initTurnstileWidget();
  if (!window.turnstile || turnstileWidgetId === null) {
    throw new Error('Captcha is not ready. Please refresh and try again.');
  }

  return new Promise((resolve, reject) => {
    turnstileResolver = resolve;
    turnstileRejecter = reject;
    window.turnstile.execute(turnstileWidgetId);
  });
}

async function showRegister() {
  try {
    // Check if registration is enabled
    const response = await fetch(`${BACKEND_URL}/api/auth/registration-status`);
    if (response.ok) {
      const data = await response.json();
      if (!data.enabled) {
        alert('Sorry, registration is currently disabled.');
        return;
      }
    }
  } catch (error) {
    console.error('Error checking registration status:', error);
    // If we can't check status, we might want to fail safe or let them try (and fail at submit)
    // Given the requirement, let's fail safe if we can't verify it's enabled.
    alert('Unable to verify registration status. Please try again later.');
    return;
  }

  $('#login-view').addClass('hidden');
  $('#register-view').removeClass('hidden');
  $('#dashboard-view').addClass('hidden');
  $('#forgot-password-view').addClass('hidden');
  $('#two-factor-view').addClass('hidden');
  clearMessages();
}

function showDashboard() {
  $('#login-view').addClass('hidden');
  $('#register-view').addClass('hidden');
  $('#dashboard-view').removeClass('hidden');
  $('#forgot-password-view').addClass('hidden');
  $('#two-factor-view').addClass('hidden');
  $('#user-email').text(currentUser.email);
  $('#user-name').text(`${currentUser.first_name || ''} ${currentUser.last_name || ''}`);
  clearMessages();
  
  // Load connected banks (force fresh to avoid stale cache after subscription changes)
  loadConnectedBanks(true);
  // Load token balances (transaction & investment) - force fresh for initial dashboard load
  loadTokenBalances(true);
  
  // Apply approval-related UI state
  updateApprovalUI();
  renderDashboardDeletionBanner();
  
  // Setup security features for logged-in users
  setupActivityListeners();
  resetIdleTimeout();
}

// Update UI controls based on `currentUser.approved`
function updateApprovalUI() {
  if (!currentUser) return;
  if (currentUser.approved === false) {
    $('#approval-message').show();
    $('#link-button').prop('disabled', true).css({ opacity: '0.5', cursor: 'not-allowed' });
    $('#link-investment-button').prop('disabled', true).css({ opacity: '0.5', cursor: 'not-allowed' });
    $('#unlink-button').prop('disabled', true).css({ opacity: '0.5', cursor: 'not-allowed' });
  } else {
    $('#approval-message').hide();
    $('#link-button').prop('disabled', false).css({ opacity: '1', cursor: 'pointer' });
    $('#link-investment-button').prop('disabled', false).css({ opacity: '1', cursor: 'pointer' });
    $('#unlink-button').prop('disabled', false).css({ opacity: '1', cursor: 'pointer' });
  }
}

// Show a banner when account deletion is pending (cached for 10 minutes)
async function renderDashboardDeletionBanner(forceFresh = false) {
  const banner = $('#dashboard-deletion-banner');
  if (!banner.length || !authToken) return;

  const renderFromRecord = (record) => {
    if (!record || !record.ok || !record.data) {
      banner.empty();
      return;
    }
    const data = record.data;
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
  };

  if (!forceFresh) {
    const cached = readSessionCache('deletion-status');
    if (cached) {
      renderFromRecord(cached);
      return;
    }
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/auth/deletion-status`, { method: 'GET' });
    const data = await response.json();
    const record = { ok: response.ok, data };
    writeSessionCache('deletion-status', record);
    renderFromRecord(record);
  } catch (error) {
    console.error('Error fetching dashboard deletion status:', error);
    banner.empty();
  }
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

async function loadTokenBalances(forceFresh = false) {
  const applyStatus = (record) => {
    if (!record || !record.ok || !record.data) {
      $('#token-tx-count').text('–');
      $('#token-inv-count').text('–');
      return;
    }

    const data = record.data;
    const tx = data.current_tokens ? data.current_tokens.transaction : null;
    const inv = data.current_tokens ? data.current_tokens.investment : null;
    $('#token-tx-count').text(typeof tx === 'number' ? tx : '0');
    $('#token-inv-count').text(typeof inv === 'number' ? inv : '0');

    // If backend reports approval changed, update local storage and UI
    if (typeof data.approved === 'boolean' && currentUser) {
      if (currentUser.approved !== data.approved) {
        currentUser.approved = data.approved;
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        updateApprovalUI();
      }
    }
  };

  try {
    if (!forceFresh) {
      const cached = readSessionCache('subscription-status');
      if (cached) {
        applyStatus(cached);
        return;
      }
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/api/billing/subscription-status`);
    const data = await response.json();
    const record = { ok: response.ok, data };
    writeSessionCache('subscription-status', record);
    applyStatus(record);
  } catch (error) {
    applyStatus({ ok: false, data: null });
  }
}

async function loadConnectedBanks(forceFresh = false) {
  try {
    const items = await getUserItems(forceFresh);
    const connectionsList = $('#connections-list');
    
    // Check for webhook alerts and display them
    displayWebhookAlerts(items);
    
    if (items.length === 0) {
      connectionsList.html('<p style="color: #666; font-style: italic; margin-bottom: 8px">No connected banks yet. Click "Connect New Bank" to get started.</p>');
      return;
    }
    let html = '<ul style="list-style: none; padding: 0; margin: 0;">';
    items.forEach(item => {
      const instName = item.institution_name || 'Unknown Bank';
      const itemId = item.plaid_item_id;
      const flagged = !!item.removal_flag;
      const status = item.status || 'active';
      const errorCode = item.error_code;
      const newAccountsAvailable = item.new_accounts_available;
      
      // Determine item styling based on status
      let itemBg = 'linear-gradient(135deg, #f0f4ff 0%, #e8f2ff 100%)';
      let itemBorder = '#667eea20';
      let statusIndicator = '';
      
      if (status === 'error' || status === 'permission_revoked') {
        itemBg = 'linear-gradient(135deg, #ffe5e5 0%, #fff0f0 100%)';
        itemBorder = '#ff000030';
        statusIndicator = '<span style="color: #d32f2f; font-size: 20px; margin-right: 8px;" title="Connection Error">⚠️</span>';
      } else if (status === 'needs_update') {
        itemBg = 'linear-gradient(135deg, #fff4e5 0%, #fff9f0 100%)';
        itemBorder = '#ff990030';
        statusIndicator = '<span style="color: #f57c00; font-size: 20px; margin-right: 8px;" title="Update Required">⚠️</span>';
      } else if (newAccountsAvailable) {
        itemBg = 'linear-gradient(135deg, #e5f9ff 0%, #f0fdff 100%)';
        itemBorder = '#0099ff30';
        statusIndicator = '<span style="color: #0288d1; font-size: 20px; margin-right: 8px;" title="New Accounts Available">ℹ️</span>';
      }
      
      html += `
        <li style="
          margin-bottom: 8px; 
          padding: 12px 16px; 
          background: ${itemBg};
          border: 1px solid ${itemBorder};
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-weight: 500;
          color: #333;
          box-shadow: 0 2px 4px rgba(102, 126, 234, 0.1);
          transition: transform 0.2s, box-shadow 0.2s;
        "
        onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(102, 126, 234, 0.15)';"
        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(102, 126, 234, 0.1)';">
          <div style="display: flex; align-items: center;">
            ${statusIndicator}
            <span style="font-size: 18px; margin-right: 12px;">🏦</span>
            <span>${instName}</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <div style="display: flex; gap: 5px; margin-right: 5px;">
              <div style="display: flex; flex-direction: column; align-items: center; font-size: 0.7em; color: #666;">
                <span>Txn</span>
                <input type="checkbox" disabled ${item.billed_products && item.billed_products.includes('transactions') ? 'checked' : ''} title="Transactions Product Active">
              </div>
              <div style="display: flex; flex-direction: column; align-items: center; font-size: 0.7em; color: #666;">
                <span>Inv</span>
                <input type="checkbox" disabled ${item.billed_products && item.billed_products.includes('investments') ? 'checked' : ''} title="Investments Product Active">
              </div>
            </div>
            <button 
              onclick="toggleRemovalFlag('${itemId}', ${flagged})"
              style="
                background: ${flagged ? '#b71c1c' : '#ff6f6f'};
                color: white;
                border: none;
                border-radius: 50%;
                width: 28px;
                height: 28px;
                font-size: 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s, transform 0.1s;
                padding: 0;
                line-height: 1;
              "
              onmouseover="this.style.transform='scale(1.1)';"
              onmouseout="this.style.transform='scale(1)';"
              title="${flagged ? 'Unflag removal' : 'Flag for removal at end of current subscription cycle'}"
            >⚑</button>
            <button 
              onclick="reconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}')"
              style="
                background: #28a745;
                color: white;
                border: none;
                border-radius: 50%;
                width: 28px;
                height: 28px;
                font-size: 20px;
                font-weight: normal;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s, transform 0.1s;
                padding: 0;
                line-height: 1;
              "
              onmouseover="this.style.background='#218838'; this.style.transform='scale(1.1)';"
              onmouseout="this.style.background='#28a745'; this.style.transform='scale(1)';"
              title="Reconnect/Update ${instName}"
            >↻</button>
            <button 
              onclick="disconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}')"
              style="
                background: #dc3545;
                color: white;
                border: none;
                border-radius: 50%;
                width: 28px;
                height: 28px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s, transform 0.1s;
                padding: 0;
                line-height: 1;
              "
              onmouseover="this.style.background='#c82333'; this.style.transform='scale(1.1)';"
              onmouseout="this.style.background='#dc3545'; this.style.transform='scale(1)';"
              title="Disconnect ${instName}"
            >✕</button>
          </div>
        </li>`;
    });
    html += '</ul>';
    connectionsList.html(html);
  } catch (error) {
    console.error('Error loading connected banks:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    $('#connections-list').html(`<p style="color: #c33;">Error loading connected banks: ${error.message}</p>`);
  }
}

function displayWebhookAlerts(items) {
  const alertContainer = $('#webhook-alerts-container');
  alertContainer.empty();
  
  if (!items || items.length === 0) {
    return;
  }
  
  const alerts = [];
  
  items.forEach(item => {
    const instName = item.institution_name || 'Unknown Bank';
    const status = item.status || 'active';
    const errorCode = item.error_code;
    const newAccountsAvailable = item.new_accounts_available;
    const itemId = item.plaid_item_id;
    
    // Critical: Permission revoked
    if (status === 'permission_revoked') {
      alerts.push({
        type: 'critical',
        icon: '🚨',
        title: 'Action Required',
        message: `<strong>${instName}</strong>: Your permission for this connection has been revoked. You must repair this connection or it will be deleted at the end of the month.`,
        action: `<button onclick="reconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}');" style="margin-left: 10px; padding: 6px 12px; background: #fff; color: #d32f2f; border: 2px solid #d32f2f; border-radius: 4px; cursor: pointer; font-weight: 600;">Repair Connection</button>`
      });
    }
    // Error: Connection error
    else if (status === 'error') {
      alerts.push({
        type: 'error',
        icon: '⚠️',
        title: 'Connection Error',
        message: `<strong>${instName}</strong>: There was an issue with your connection${errorCode ? ` (${errorCode})` : ''}. Please refresh your connection.`,
        action: `<button onclick="reconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}');" style="margin-left: 10px; padding: 6px 12px; background: #fff; color: #f57c00; border: 2px solid #f57c00; border-radius: 4px; cursor: pointer; font-weight: 600;">Refresh Connection</button>`
      });
    }
    // Warning: Needs update
    else if (status === 'needs_update') {
      alerts.push({
        type: 'warning',
        icon: '⏰',
        title: 'Update Required',
        message: `<strong>${instName}</strong>: Your bank connection will expire soon. Please refresh your connection.`,
        action: `<button onclick="reconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}');" style="margin-left: 10px; padding: 6px 12px; background: #fff; color: #f57c00; border: 2px solid #f57c00; border-radius: 4px; cursor: pointer; font-weight: 600;">Refresh Connection</button>`
      });
    }
    // Info: New accounts available
    else if (newAccountsAvailable) {
      alerts.push({
        type: 'info',
        icon: 'ℹ️',
        title: 'New Accounts Available',
        message: `<strong>${instName}</strong>: New accounts are available for your connection. Click "Refresh Connection" to add them.`,
        action: `<button onclick="reconnectBank('${itemId}', '${instName.replace(/'/g, "\\'")}');" style="margin-left: 10px; padding: 6px 12px; background: #fff; color: #0288d1; border: 2px solid #0288d1; border-radius: 4px; cursor: pointer; font-weight: 600;">Refresh Connection</button>`
      });
    }
  });
  
  // Sort alerts by severity (critical > error > warning > info)
  const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
  alerts.sort((a, b) => severityOrder[a.type] - severityOrder[b.type]);
  
  // Display alerts
  alerts.forEach(alert => {
    const colors = {
      critical: { bg: '#ffebee', border: '#d32f2f', text: '#b71c1c' },
      error: { bg: '#fff3e0', border: '#f57c00', text: '#e65100' },
      warning: { bg: '#fff9e6', border: '#ffa726', text: '#f57c00' },
      info: { bg: '#e3f2fd', border: '#0288d1', text: '#01579b' }
    };
    
    const style = colors[alert.type];
    
    alertContainer.append(`
      <div style="
        background: ${style.bg};
        border-left: 4px solid ${style.border};
        padding: 15px;
        margin-bottom: 10px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      ">
        <div style="display: flex; align-items: center; flex: 1;">
          <span style="font-size: 24px; margin-right: 12px;">${alert.icon}</span>
          <div>
            <div style="font-weight: 600; color: ${style.text}; margin-bottom: 4px;">${alert.title}</div>
            <div style="color: ${style.text};">${alert.message}</div>
          </div>
        </div>
        ${alert.action}
      </div>
    `);
  });
}

async function toggleRemovalFlag(itemId, currentlyFlagged) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/item_flag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, flag: !currentlyFlagged })
    });

    const data = await response.json();

    if (response.ok) {
      const msg = !currentlyFlagged ? '✓ Flagged for removal at end of cycle.' : '✓ Unflagged successfully.';
      showMessage('dashboard-message', msg, 'success');
      clearSessionCache('connections-items');
      loadConnectedBanks(true);
    } else {
      const detail = data.message || data.error || 'Failed to update flag';
      showMessage('dashboard-message', `Error: ${detail}`, 'error');
    }
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
}

function clearMessages() {
  $('#login-message, #register-message, #dashboard-message').html('');
}

function showMessage(containerId, message, type) {
  $(`#${containerId}`).html(`<div class="message ${type}">${message}</div>`);
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  try { sessionStorage.clear(); } catch (error) {}
  authToken = null;
  refreshToken = null;
  currentUser = null;
  showLogin();
}

// Mutex to prevent multiple simultaneous refresh attempts
let refreshPromise = null;

async function refreshAccessToken() {
  if (!refreshToken) {
    logout(); // No refresh token, force logout
    return false;
  }
  
  // If a refresh is already in progress, wait for it instead of making another call
  if (refreshPromise) {
    return refreshPromise;
  }
  
  // Create the refresh promise so other callers can await it
  refreshPromise = (async () => {
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
        
        // Update refresh token if provided (Sliding Window)
        if (data.refresh_token) {
          refreshToken = data.refresh_token;
          localStorage.setItem('refreshToken', refreshToken);
        }
        
        resetIdleTimeout(); // Reset idle timer after successful refresh
        return true;
      } else {
        // Refresh token expired or invalid
        logout();
        return false;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      logout();
      return false;
    } finally {
      // Clear the mutex so future refreshes can proceed
      refreshPromise = null;
    }
  })();
  
  return refreshPromise;
}

async function authenticatedFetch(url, options = {}) {
  // Add authorization header
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    ...options.headers
  };
  
  const response = await fetch(url, { ...options, headers });
  
  // If we get a 401, try to refresh the token
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    
    if (refreshed) {
      // Retry the request with new token
      headers['Authorization'] = `Bearer ${authToken}`;
      return fetch(url, { ...options, headers });
    }
  }
  
  return response;
}

function resetIdleTimeout() {
  // Clear existing timeout
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  
  // Only set idle timeout if user is logged in
  if (authToken && currentUser) {
    idleTimeout = setTimeout(() => {
      logout();
      alert('You have been logged out due to inactivity for security reasons.');
    }, IDLE_TIMEOUT);
  }
}

function setupActivityListeners() {
  // List of events that indicate user activity
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  
  events.forEach(event => {
    document.addEventListener(event, resetIdleTimeout, true);
  });
  
  // Handle page visibility changes (phone locked, browser tab hidden, etc.)
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange() {
  if (document.hidden) {
    // Page is now hidden (phone locked, tab switched, etc.)
    // Record the time and clear the timeout to save resources
    pageHiddenTime = Date.now();
    if (idleTimeout) {
      clearTimeout(idleTimeout);
      idleTimeout = null;
    }
  } else {
    // Page is now visible again
    if (pageHiddenTime && authToken && currentUser) {
      const timeHidden = Date.now() - pageHiddenTime;
      
      if (timeHidden >= IDLE_TIMEOUT) {
        // User was away for longer than idle timeout - log them out
        logout();
        alert('You have been logged out due to inactivity for security reasons.');
      } else {
        // User returned within timeout period - restart the timer
        pageHiddenTime = null;
        resetIdleTimeout();
      }
    } else if (authToken && currentUser) {
      // Page became visible but no hidden time was recorded - just reset
      resetIdleTimeout();
    }
  }
}

// Login form handler
$('#login-form').on('submit', async function(e) {
  e.preventDefault();
  const email = $('#login-email').val();
  const password = $('#login-password').val();
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      if (data.require_2fa) {
        // 2FA required - store credentials temporarily
        tempLoginCreds = { email, password };
        showTwoFactorLogin();
      } else {
        // Normal login success
        authToken = data.access_token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('refreshToken', data.refresh_token);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        showDashboard();
      }
    } else {
      if (data.email_not_verified) {
        showMessage('login-message', `
          ${data.error}
          <div style="margin-top: 10px;">
            <button type="button" class="btn-link" onclick="resendVerification('${email}')" style="color: #667eea; text-decoration: underline; border: none; background: none; cursor: pointer; padding: 0;">
              Resend Verification Email
            </button>
          </div>
        `, 'error');
      } else {
        showMessage('login-message', data.error || 'Login failed', 'error');
      }
    }
  } catch (error) {
    console.error('Login error:', error);
    showMessage('login-message', 'Connection error: ' + error.message, 'error');
  }
});

// Resend verification email
async function resendVerification(email) {
  try {
    const btn = event.target;
    const originalText = btn.innerText;
    btn.innerText = 'Sending...';
    btn.disabled = true;
    
    const frontendUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const turnstileToken = await getTurnstileToken();
    
    const response = await fetch(`${BACKEND_URL}/api/auth/resend_verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email,
        frontend_url: frontendUrl,
        turnstileToken
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      showMessage('login-message', 'Verification email sent! Please check your inbox.', 'success');
    } else {
      showMessage('login-message', data.error || 'Failed to send email', 'error');
    }
  } catch (error) {
    showMessage('login-message', 'Connection error: ' + error.message, 'error');
  }
}

// 2FA Login form handler
$('#two-factor-form').on('submit', async function(e) {
  e.preventDefault();
  const code = $('#two-factor-code').val();
  
  if (!tempLoginCreds) {
    showLogin();
    return;
  }
  
  try {
    // Call login endpoint again with credentials AND 2FA code
    const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: tempLoginCreds.email, 
        password: tempLoginCreds.password,
        totp_code: code 
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      authToken = data.access_token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('refreshToken', data.refresh_token);
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      tempLoginCreds = null; // Clear temp credentials
      showDashboard();
    } else {
      showMessage('two-factor-message', data.error || 'Verification failed', 'error');
    }
  } catch (error) {
    showMessage('two-factor-message', 'Connection error: ' + error.message, 'error');
  }
});

// Forgot Password form handler
$('#forgot-form').on('submit', async function(e) {
  e.preventDefault();
  const email = $('#forgot-email').val();
  const btn = $(this).find('button[type="submit"]');
  
  btn.prop('disabled', true).text('Sending...');
  
  try {
    const frontendUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const turnstileToken = await getTurnstileToken();

    const response = await fetch(`${BACKEND_URL}/api/auth/forgot_password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email,
        frontend_url: frontendUrl,
        turnstileToken
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      $('#forgot-password-view').html(`
        <h1>Check Your Email</h1>
        <p class="subtitle">We've sent a password reset link to ${email}</p>
        <div class="message success">Please check your inbox and spam folder.</div>
        <button class="btn btn-primary" onclick="showLogin()">Back to Login</button>
      `);
    } else {
      showMessage('forgot-message', data.error || 'Request failed', 'error');
      btn.prop('disabled', false).text('Send Reset Link');
    }
  } catch (error) {
    showMessage('forgot-message', 'Connection error: ' + error.message, 'error');
    btn.prop('disabled', false).text('Send Reset Link');
  }
});

// Register form handler
$('#register-form').on('submit', async function(e) {
  e.preventDefault();
  const firstName = $('#register-firstname').val();
  const lastName = $('#register-lastname').val();
  const email = $('#register-email').val();
  const password = $('#register-password').val();
  
  try {
    // Get current base URL (e.g., http://localhost:5501/iayoung85.github.io or https://bank.isaacyoung.com)
    // We remove the filename (index.html) to get the base path
    const frontendUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const turnstileToken = await getTurnstileToken();

    const response = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        first_name: firstName,
        last_name: lastName,
        frontend_url: frontendUrl,
        turnstileToken
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // Registration successful - show message and switch to login
      showMessage('register-message', 'Registration successful! Please check your email to verify your account.', 'success');
      setTimeout(() => {
        showLogin();
        showMessage('login-message', 'Please check your email to verify your account before logging in.', 'success');
      }, 3000);
    } else {
      showMessage('register-message', data.error || 'Registration failed', 'error');
    }
  } catch (error) {
    showMessage('register-message', 'Connection error: ' + error.message, 'error');
  }
});

// Test connection button
$('#test-connection').on('click', async function() {
  try {
    const cached = readSessionCache('health');
    if (cached) {
      if (cached.ok && cached.data && cached.data.status === 'ok') {
        showMessage('dashboard-message', '✓ Backend connected successfully!', 'success');
      } else {
        showMessage('dashboard-message', '⚠ Unexpected response from backend', 'error');
      }
      return;
    }

    const response = await fetch(`${BACKEND_URL}/api/health`);
    const data = await response.json();
    const record = { ok: response.ok, data };
    writeSessionCache('health', record);

    if (record.ok && data.status === 'ok') {
      showMessage('dashboard-message', '✓ Backend connected successfully!', 'success');
    } else {
      showMessage('dashboard-message', '⚠ Unexpected response from backend', 'error');
    }
  } catch (error) {
    showMessage('dashboard-message', '✗ Connection failed: ' + error.message, 'error');
  }
});

// Plaid integration functions
async function fetchLinkToken(itemId = null) {
  let url = `${BACKEND_URL}/api/connections/create_link_token`;
  // Add query parameter if itemId is provided
  if (itemId) {
    url += `?item_id=${encodeURIComponent(itemId)}`;
  }
  
  const response = await authenticatedFetch(url);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create link token');
  }
  
  const data = await response.json();
  return data.link_token;
}

async function getUserItems(forceFresh = false) {
  if (!forceFresh) {
    const cached = readSessionCache('connections-items');
    if (Array.isArray(cached)) {
      return cached;
    }
  }

  const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/items`);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Failed to fetch items:', errorText);
    throw new Error(`Failed to fetch items: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  const items = data.items || [];
  writeSessionCache('connections-items', items);
  return items;
}

async function exchangePublicToken(public_token) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/set_access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ public_token: public_token })
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to connect bank');
  }
  
  // Store newly connected investment items for auto-sync
  if (data.billed_products && data.billed_products.includes('investments')) {
    const newInvItems = JSON.parse(sessionStorage.getItem('newInvestmentItems') || '[]');
    if (!newInvItems.includes(data.item_id)) {
      newInvItems.push(data.item_id);
      sessionStorage.setItem('newInvestmentItems', JSON.stringify(newInvItems));
    }
  }
  
  return data;
}

// Connect bank account button
$('#link-button').on('click', async function() {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }
  
  try {
    const linkToken = await fetchLinkToken(null);

    const handler = Plaid.create({
      token: linkToken,
      onSuccess: async (public_token, metadata) => {
        try {
          // Check for duplicate BEFORE exchanging the token
          const institutionId = metadata.institution?.institution_id;
          const institutionName = metadata.institution?.name;
          
          if (institutionId) {
            const dupCheckResponse = await authenticatedFetch(`${BACKEND_URL}/api/connections/check_duplicate_institution`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ institution_id: institutionId })
            });
            
            const dupData = await dupCheckResponse.json();
            
            if (dupData.is_duplicate) {
              showMessage('dashboard-message', 
                `${institutionName || 'This bank'} is already connected to your account. Please use the "Refresh" button to update the connection.`, 
                'error');
              clearSessionCache('connections-items');
              clearAllDataCaches();
              loadConnectedBanks(true);
              return; // Exit without exchanging the token
            }
          }
          
          // Not a duplicate, proceed with normal flow
          await exchangePublicToken(public_token);
          showMessage('dashboard-message', '✓ Bank connected successfully!', 'success');
          clearSessionCache('connections-items');
          clearSessionCache('subscription-status');
          clearAllDataCaches();
          loadConnectedBanks(true);
          loadTokenBalances(true);
        } catch (error) {
          showMessage('dashboard-message', 'Error: ' + error.message, 'error');
        }
      },
      onLoad: () => { /* Link is ready */ },
      onExit: (err, metadata) => {
        if (err != null) {
          console.error('Plaid Link Error:', err);
          showMessage('dashboard-message', 'Connection cancelled or failed', 'error');
        }
      },
      onEvent: (eventName, metadata) => {
        // Log events for debugging if needed
        console.log('Plaid Event:', eventName, metadata);
      }
    });
    
    handler.open();

  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
});

// Connect Investment ONLY Bank button handler
$('#link-investment-button').on('click', async function() {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }
  
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/create_link_token?mode=investments_only`);
    
    if (response.ok) {
      const data = await response.json();
      const handler = Plaid.create({
        token: data.link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            // Check for duplicate BEFORE exchanging the token
            const institutionId = metadata.institution?.institution_id;
            const institutionName = metadata.institution?.name;
            
            if (institutionId) {
              const dupCheckResponse = await authenticatedFetch(`${BACKEND_URL}/api/connections/check_duplicate_institution`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ institution_id: institutionId })
              });
              
              const dupData = await dupCheckResponse.json();
              
              if (dupData.is_duplicate) {
                showMessage('dashboard-message', 
                  `${institutionName || 'This bank'} is already connected to your account. Please use the "Refresh" button to update the connection.`, 
                  'error');
                clearSessionCache('connections-items');
                clearAllDataCaches();
                loadConnectedBanks(true);
                return; // Exit without exchanging the token
              }
            }
            
            // Not a duplicate, proceed with exchange
            await exchangePublicToken(public_token);
            showMessage('dashboard-message', '✓ Bank connected successfully with investment access!', 'success');
            clearSessionCache('connections-items');
            clearSessionCache('subscription-status');
            clearAllDataCaches();
            loadConnectedBanks(true);
            loadTokenBalances(true);
          } catch (error) {
            showMessage('dashboard-message', 'Error: ' + error.message, 'error');
          }
        },
        onLoad: () => { /* Link is ready */ },
        onExit: (err, metadata) => {
          if (err != null) {
            console.error('Plaid Link Error:', err);
            showMessage('dashboard-message', 'Connection cancelled or failed', 'error');
          }
        },
        onEvent: (eventName, metadata) => {
          // Log events for debugging if needed
          console.log('Plaid Event:', eventName, metadata);
        }
      });
      
      handler.open();
    }
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
});

// Reconnect/update bank function
async function reconnectBank(itemId, bankName) {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }
  
  try {
    // For reconnection, we always use standard mode (user can use "Connect New Bank" for investment accounts)
    const linkToken = await fetchLinkToken(itemId);
    const handler = Plaid.create({
      token: linkToken,
      onSuccess: async (public_token, metadata) => {
        try {
          // Update mode - refresh accounts from Plaid (user may have changed account selection)
          const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/refresh_item_accounts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId })
          });
          
          if (response.ok) {
            const data = await response.json();
            let message = `✓ ${bankName} reconnected successfully!`;
            
            if (data.accounts_added > 0 || data.accounts_removed > 0) {
              const changes = [];
              if (data.accounts_added > 0) changes.push(`${data.accounts_added} account(s) added`);
              if (data.accounts_removed > 0) changes.push(`${data.accounts_removed} account(s) removed`);
              message += ` (${changes.join(', ')})`;
            }
            
            showMessage('dashboard-message', message, 'success');
          } else {
            showMessage('dashboard-message', `✓ ${bankName} reconnected, but failed to refresh accounts`, 'success');
          }
          
          // Refresh connected banks list
          clearSessionCache('connections-items');
          clearAllDataCaches();
          loadConnectedBanks(true);
        } catch (error) {
          showMessage('dashboard-message', 'Error: ' + error.message, 'error');
        }
      },
      onLoad: () => {
        // Link is ready
      },
      onExit: (err, metadata) => {
        if (err != null) {
          console.error('Plaid Link Error:', err);
          showMessage('dashboard-message', 'Reconnection cancelled or failed', 'error');
        }
      },
      onEvent: (eventName, metadata) => {}
    });
    handler.open();
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
}

// Disconnect individual bank function
async function disconnectBank(itemId, bankName) {
  if (!authToken) {
    showMessage('dashboard-message', 'Please login first', 'error');
    return;
  }
  
  // Confirm before disconnecting
  if (!confirm(`⚠️ WARNING: Disconnect ${bankName}?\n\nIf you're having connection issues or need to update your credentials, click the refresh button for the chosen bank to reconnect.\n\nDisconnecting and then reconnecting as a NEW bank will consume either a swap token if available or a transaction and/or investment token.\n\nAre you sure you want to permanently disconnect ${bankName}?`)) {
    return;
  }
  
  try {
    // First call: detect if swap opportunity exists
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/remove_item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId })
    });
    
    const data = await response.json();
    
    if (response.status === 200 && data.swap_opportunity) {
      // Swap opportunity detected - ask user what they want to do
      showSwapTokenModal(itemId, bankName, data.swap_opportunity);
    } else if (response.ok) {
      // No swap opportunity, item removed successfully
      showMessage('dashboard-message', '✓ Bank disconnected successfully!', 'success');
      clearSessionCache('connections-items');
      clearAllDataCaches();
      loadConnectedBanks(true);
    } else {
      showMessage('dashboard-message', 'Error: ' + (data.error || 'Failed to disconnect bank'), 'error');
    }
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
}

// Show modal for swap token options
function showSwapTokenModal(itemId, bankName, swapOpportunity) {
  const options = swapOpportunity.options || [];
  const maxSwaps = swapOpportunity.max_swaps_available || 0;
  
  let optionsHtml = '';
  
  if (options.includes('transaction') && options.includes('investment')) {
    // Both options available
    if (maxSwaps >= 2) {
      optionsHtml = `
        <label style="display: block; margin: 10px 0; cursor: pointer;">
          <input type="radio" name="swap-choice" value="transaction" checked> Get 1 Transaction Token
        </label>
        <label style="display: block; margin: 10px 0; cursor: pointer;">
          <input type="radio" name="swap-choice" value="investment"> Get 1 Investment Token
        </label>
        <label style="display: block; margin: 10px 0; cursor: pointer;">
          <input type="radio" name="swap-choice" value="both"> Get Both (uses 2 swap tokens)
        </label>
      `;
    } else {
      optionsHtml = `
        <label style="display: block; margin: 10px 0; cursor: pointer;">
          <input type="radio" name="swap-choice" value="transaction" checked> Get 1 Transaction Token
        </label>
        <label style="display: block; margin: 10px 0; cursor: pointer;">
          <input type="radio" name="swap-choice" value="investment"> Get 1 Investment Token
        </label>
        <p style="color: #666; font-size: 0.9em;">You have ${maxSwaps} swap token(s) available. To get both, you'd need 2 swap tokens.</p>
      `;
    }
  } else if (options.includes('transaction')) {
    optionsHtml = `
      <p style="margin: 10px 0;">Your transaction tokens are depleted. Use a swap token to get 1 transaction token?</p>
      <input type="hidden" name="swap-choice" value="transaction">
    `;
  } else if (options.includes('investment')) {
    optionsHtml = `
      <p style="margin: 10px 0;">Your investment tokens are depleted. Use a swap token to get 1 investment token?</p>
      <input type="hidden" name="swap-choice" value="investment">
    `;
  }
  
  const modal = $(`
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    " id="swap-modal-overlay" onclick="if(event.target === this) closeSwapModal()">
      <div style="
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      ">
        <h3 style="margin-top: 0; color: #333;">Swap Token Opportunity</h3>
        <p style="color: #666; margin: 10px 0;">
          You're disconnecting <strong>${bankName}</strong>. 
          ${swapOpportunity.reason}
        </p>
        <p style="color: #666; margin: 10px 0; font-weight: 500;">
          You have <strong>${maxSwaps} swap token(s)</strong> available. Would you like to use one?
        </p>
        
        <div style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 4px;">
          ${optionsHtml}
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button 
            onclick="applySwapAndDisconnect('${itemId}', '${bankName}')"
            style="
              flex: 1;
              padding: 10px;
              background: #28a745;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-weight: 500;
            "
            onmouseover="this.style.background='#218838';"
            onmouseout="this.style.background='#28a745';"
          >
            Use Swap Token
          </button>
          <button 
            onclick="closeSwapModalAndDisconnect('${itemId}')"
            style="
              flex: 1;
              padding: 10px;
              background: #dc3545;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-weight: 500;
            "
            onmouseover="this.style.background='#c82333';"
            onmouseout="this.style.background='#dc3545';"
          >
            Skip & Disconnect
          </button>
        </div>
      </div>
    </div>
  `);
  
  $('body').append(modal);
}

function closeSwapModal() {
  $('#swap-modal-overlay').remove();
}

async function applySwapAndDisconnect(itemId, bankName) {
  // Get value from either checked radio or hidden input
  const productType = $('input[name="swap-choice"]:checked').val() || $('input[name="swap-choice"][type="hidden"]').val();
  
  if (!productType) {
    alert('Please select a token type');
    return;
  }
  
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/remove_item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        item_id: itemId,
        apply_swap: true,
        product_type: productType
      })
    });
    
    const data = await response.json();
    
    closeSwapModal();
    
    if (response.ok) {
      const tokenType = productType === 'both' ? 'both tokens' : `${productType} token`;
      showMessage('dashboard-message', `✓ Bank disconnected and swap applied! You received 1 ${tokenType}.`, 'success');
      clearSessionCache('connections-items');
      clearSessionCache('subscription-status');
      clearAllDataCaches();
      loadConnectedBanks(true);
      loadTokenBalances(true);
    } else {
      showMessage('dashboard-message', 'Error: ' + (data.error || 'Failed to apply swap'), 'error');
    }
  } catch (error) {
    closeSwapModal();
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
}

async function closeSwapModalAndDisconnect(itemId) {
  closeSwapModal();
  
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/connections/remove_item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, apply_swap: false, confirm_remove: true })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      showMessage('dashboard-message', '✓ Bank disconnected successfully!', 'success');
      clearSessionCache('connections-items');
      clearAllDataCaches();
      loadConnectedBanks(true);
    } else {
      showMessage('dashboard-message', 'Error: ' + (data.error || 'Failed to disconnect bank'), 'error');
    }
  } catch (error) {
    showMessage('dashboard-message', 'Error: ' + error.message, 'error');
  }
}

// Handle OAuth redirect
(async function handleOauthReturn() {
  if (!window.location.href.includes('?oauth_state_id=')) return;
  if (!authToken) return;
  
  try {
    const linkToken = await fetchLinkToken();
    const handler = Plaid.create({
      token: linkToken,
      receivedRedirectUri: window.location.href,
      onSuccess: async (public_token, metadata) => {
        try {
          await exchangePublicToken(public_token);
          showMessage('dashboard-message', '✓ Bank connected successfully!', 'success');
          clearSessionCache('connections-items');
          clearSessionCache('subscription-status');
          clearAllDataCaches();
          loadConnectedBanks(true);
          loadTokenBalances(true);
        } catch (error) {
          showMessage('dashboard-message', 'Error: ' + error.message, 'error');
        }
      },
      onLoad: () => {},
      onExit: (err, metadata) => {
        if (err != null) console.error('OAuth Error:', err);
      },
      onEvent: (eventName, metadata) => {}
    });
    handler.open();
  } catch (err) {
    console.error('Error handling OAuth redirect:', err);
  }
})();