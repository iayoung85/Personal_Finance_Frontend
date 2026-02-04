// BACKEND_URL is defined in config.js

let holdingsData = [];
let securitiesData = [];
let accountStatus = [];
let investmentAccounts = [];
let currentUser = null;
let authToken = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');

// Auth Check
if (!authToken) {
  window.location.href = 'index.html';
}

try {
  currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch (e) {
  console.error('Error parsing user', e);
}

$(document).ready(async function() {
  await window.BACKEND_URL_PROMISE;
  
  // Load accounts first so selections exist
  await loadAccounts();
  await loadAccountStatus(); // Populate accountStatus for Sync All Holdings button
  
  // Check for newly connected investment items and auto-sync
  const newInvItems = JSON.parse(sessionStorage.getItem('newInvestmentItems') || '[]');
  if (newInvItems.length > 0) {
    console.log('Auto-syncing newly connected investment items:', newInvItems);
    
    // Sync each new item
    for (const itemId of newInvItems) {
      try {
        await syncItem(itemId, false);  // Don't activate, just sync
      } catch (error) {
        console.error(`Failed to sync new investment item ${itemId}:`, error);
      }
    }
    
    // Clear the flags after syncing
    sessionStorage.removeItem('newInvestmentItems');
    
    // Load holdings with fresh data (skip cache)
    await loadHoldings(true);
  } else {
    // Normal load with cache
    await loadHoldings();
  }

  // Account selection changes
  $(document).on('change', '.account-checkbox', function() {
    renderTable();
  });
});

// --- API Calls ---

async function authenticatedFetch(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    // Try refresh
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${authToken}`;
      return fetch(url, { ...options, headers });
    } else {
      window.location.href = 'index.html';
      throw new Error('Session expired');
    }
  }
  
  return response;
}

async function refreshAccessToken() {
  if (!refreshToken) return false;
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
      return true;
    }
  } catch (e) { console.error(e); }
  return false;
}

// --- Accounts (selection similar to transactions) ---
async function loadAccounts() {
  const container = $('#account-selector');
  container.html('<div class="status-message info">Loading accounts...</div>');
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/accounts/all`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    investmentAccounts = data.accounts || [];
    renderAccountSelector();
    // Auto-select all active/available accounts
    selectAllAccounts();
  } catch (error) {
    container.html(`<div class="error">Error loading accounts: ${error.message}</div>`);
  }
}

function renderAccountSelector() {
  const container = $('#account-selector');
  if (!investmentAccounts || investmentAccounts.length === 0) {
    container.html('<div class="empty-state">No investment accounts found. Connect or activate investments in dashboard.</div>');
    return;
  }

  // Group accounts by plaid_item_id to handle activate buttons
  const groupedByItem = {};
  investmentAccounts.forEach(acc => {
    const itemId = acc.plaid_item_id;
    if (!groupedByItem[itemId]) groupedByItem[itemId] = [];
    groupedByItem[itemId].push(acc);
  });

  let html = '<div class="account-list">';
  
  Object.keys(groupedByItem).forEach(itemId => {
    const accounts = groupedByItem[itemId];
    const canActivate = accounts.some(a => a.status === 'available');
    const allActive = accounts.every(a => a.status === 'active');
    
    html += '<div class="item-group">';
    html += '<div class="accounts-column">';
    
    accounts.forEach(acc => {
      const disabled = acc.status !== 'active';
      const institutionName = acc.institution_name || 'Unknown Institution';
      const accountName = acc.account_name || 'Account';
      const maskDisplay = acc.mask ? ` ...${acc.mask}` : '';
      const statusBadge = accountStatusLabel(acc.status);
      
      html += `
        <div class="account-row">
          <label>
            <input type="checkbox" class="account-checkbox" data-account-id="${acc.plaid_account_id}" ${disabled ? 'disabled' : ''}>
            <span class="bank-name">${institutionName}</span>
            <span class="account-name">${accountName}${maskDisplay}</span>
          </label>
          ${statusBadge}
        </div>
      `;
    });
    
    html += '</div>';
    
    // Add Activate & Sync button if applicable
    if (canActivate && !allActive) {
      html += `<button class="activate-btn" data-item="${itemId}" onclick="syncItem('${itemId}', true)">Activate & Sync</button>`;
    }
    
    html += '</div>';
  });
  
  html += '</div>';
  container.html(html);
}



function accountStatusLabel(status) {
  if (status === 'active') return '<span class="status-badge status-active">Active</span>';
  if (status === 'available') return '<span class="status-badge status-inactive">Available (Not Active)</span>';
  return '<span class="status-badge status-inactive">Inactive</span>';
}

function getSelectedAccounts() {
  const selected = [];
  $('.account-checkbox:checked').each(function() {
    selected.push($(this).data('account-id'));
  });
  return selected;
}

function selectAllAccounts() {
  $('.account-checkbox:not(:disabled)').prop('checked', true);
  renderTable();
}

function deselectAllAccounts() {
  $('.account-checkbox').prop('checked', false);
  renderTable();
}



async function loadAccountStatus() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/accounts_status`);
    const data = await response.json();
    accountStatus = data.items;
    renderAccountStatus();
  } catch (error) {
    console.error('Error loading account status:', error);
    if (document.getElementById('account-status-list')) {
      $('#account-status-list').html(`<div class="error">Error loading status: ${error.message}</div>`);
    }
  }
}

async function loadHoldings(skipCache = false) {
  $('#table-container').html('<div class="empty-state">Loading holdings...</div>');
  try {
    // Fetch from backend
    const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/holdings`);
    const data = await response.json();
    holdingsData = data.items || [];
    securitiesData = data.securities || [];
    
    renderTable();
  } catch (error) {
    console.error('Error loading holdings:', error);
    $('#table-container').html(`<div class="error">Error loading holdings: ${error.message}</div>`);
  }
}

async function syncItem(itemId, activate = false) {
  try {
    if (activate && !confirm('Activating investments for this bank may incur additional fees. Do you want to proceed?')) {
        return;
    }

    const btn = $(`button[data-item="${itemId}"]`);
    const originalText = btn.text();
    btn.prop('disabled', true).text(activate ? 'Activating...' : 'Syncing...');
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/sync`, {
      method: 'POST',
      body: JSON.stringify({ 
          item_id: itemId,
          activate: activate
      })
    });
    
    const responseData = await response.json();
    
    if (response.ok) {
      // Refresh all data
      await loadAccounts(); 
      await loadAccountStatus(); 
      await loadHoldings(true);
      showMessage(activate ? 'Activated successfully' : 'Synced successfully', 'success');
    } else {
      alert('Sync failed: ' + responseData.error);
      btn.prop('disabled', false).text(originalText);
    }
  } catch (error) {
    console.error('Sync error:', error);
    alert('Sync error: ' + error.message);
    const btn = $(`button[data-item="${itemId}"]`);
    btn.prop('disabled', false).text('Activate & Sync');
  }
}

async function syncAllHoldings() {
  const activeItems = accountStatus.filter(i => i.status === 'active');
  
  if (activeItems.length === 0) {
    alert('No active investment accounts found.');
    return;
  }
  
  if (!confirm(`Syncing ${activeItems.length} active bank connections. This may take a moment.`)) return;
  
  let successCount = 0;
  for (const item of activeItems) {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/api/investments/sync`, {
        method: 'POST',
        body: JSON.stringify({ item_id: item.plaid_item_id })
      });
      if (response.ok) {
        successCount++;
      } else {
        const err = await response.json();
        console.error(`Sync failed for ${item.institution_name}:`, err);
      }
    } catch (e) {
      console.error(`Failed to sync ${item.institution_name}:`, e);
    }
  }
  
  // Reload data
  await loadHoldings(true);
  showMessage(`Synced ${successCount}/${activeItems.length} accounts`, 'success');
}


// --- Rendering ---

function renderAccountStatus() {
  const container = $('#account-status-list');
  if (accountStatus.length === 0) {
    container.html('<div class="empty-state">No bank accounts connected.</div>');
    return;
  }
  
  let html = '';
  accountStatus.forEach(item => {
    let actionHtml = '';
    let statusClass = 'status-inactive';
    let statusText = 'No Investment Accounts. If you believe there is an investment account associated with this bank, please try refreshing the connection from the dashboard and be sure to select the investment accounts to authorize sharing.';
    let unsuportedStatusText = 'Investments Not Supported by Institution. This institution does not support investment account access via Plaid even if you selected investment accounts during linking.';
    if (item.status === 'active') {
      statusClass = 'status-active';
      statusText = 'Active';
      actionHtml = `<span style="font-size: 11px; color: #666;">Last synced: ${formatDate(item.last_updated)}</span>`;
    } else if (item.status === 'available') {
      statusClass = 'status-inactive';
      statusText = 'Available (Not Active)';
      actionHtml = `<button class="activate-btn" data-item="${item.plaid_item_id}" onclick="syncItem('${item.plaid_item_id}', true)">Activate & Sync</button>`;
    } else if (item.status === 'unsupported_by_institution') {
      statusClass = 'status-unsupported';
      statusText = unsuportedStatusText;
      actionHtml = `<span style="font-size: 11px; color: #666;">Please contact support if you believe this is an error.</span>`;
    }
    
    html += `
      <div class="account-status-item">
        <div>
          <strong>${item.institution_name}</strong>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
        <div>${actionHtml}</div>
      </div>
    `;
  });
  
  container.html(html);
}

function renderTable() {
  const container = $('#table-container');
  
  const selectedAccounts = getSelectedAccounts();
  // If nothing selected, show hint
  if (selectedAccounts.length === 0) {
    container.html('<div class="empty-state">Select at least one investment account to view holdings.</div>');
    return;
  }

  const groupedHoldings = buildGroupedHoldings(selectedAccounts);

  if (groupedHoldings.length === 0) {
    container.html('<div class="empty-state">No holdings found for selected accounts. Sync or adjust selections.</div>');
    return;
  }
  
  // Build Table
  let tableHtml = `
    <table class="transactions-table">
      <thead>
        <tr>
          <th style="width: 30px;"></th>
          <th>Ticker</th>
          <th>Name</th>
          <th>Price</th>
          <th>Total Qty</th>
          <th>Total Value</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  groupedHoldings.forEach((group, index) => {
    const hasMultiple = group.holdings.length > 0; // Always true if it exists
    
    tableHtml += `
      <tr class="holding-group-header" onclick="toggleGroup('group-${index}', this)">
        <td><span class="expand-icon">▶</span></td>
        <td>${group.ticker || '-'}</td>
        <td>${group.name}</td>
        <td>${formatCurrency(group.price)}</td>
        <td>${group.total_quantity.toFixed(4)}</td>
        <td>${formatCurrency(group.total_value)}</td>
      </tr>
    `;
    
    // Detail Rows
    group.holdings.forEach(h => {
      tableHtml += `
        <tr class="holding-detail-row group-${index}">
          <td></td>
          <td colspan="2" style="font-style: italic;">${h.bank} - ${h.account}</td>
          <td>${formatCurrency(h.price)}</td>
          <td>${h.quantity.toFixed(4)}</td>
          <td>${formatCurrency(h.value)}</td>
        </tr>
      `;
    });
  });
  
  tableHtml += '</tbody></table>';
  container.html(tableHtml);
}

// --- Helpers ---

function toggleGroup(groupId, headerRow) {
  $(`.${groupId}`).toggleClass('expanded');
  $(headerRow).toggleClass('expanded');
}

// Price fallback helper: prefer security prices; fall back to holding prices or implied from institution_value
function derivePrice(security, holding) {
  const candidates = [
    security.close_price,
    security.price,
    security.institution_price,
    holding.institution_price,
    holding.price
  ];
  let price = candidates.find(v => v !== null && v !== undefined && Number.isFinite(v) && v > 0);
  if (!price && holding.institution_value && holding.quantity) {
    price = holding.quantity !== 0 ? (holding.institution_value / holding.quantity) : 0;
  }
  return price || 0;
}

function toggleConfig() {
  const content = document.getElementById('config-content');
  const icon = document.getElementById('toggle-icon');
  
  if (content.style.display === 'none' || !content.style.display) {
    content.style.display = 'block';
    icon.textContent = '▲';
  } else {
    content.style.display = 'none';
    icon.textContent = '▼';
  }
}

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(isoString) {
  if (!isoString) return 'Never';
  return new Date(isoString).toLocaleString();
}

// Build grouped holdings (collapsed view) for selected accounts
function buildGroupedHoldings(selectedAccounts) {
  const grouped = {}; // Key: ticker_symbol or name
  
  // Helper to lookup security by security_id
  const getSecurityById = (securityId) => {
    return securitiesData.find(s => s.security_id === securityId);
  };
  
  // Process each item's holdings
  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;
    
    const itemInstitution = item.institution_name || 'Unknown';
    
    // Get investment accounts from this item
    const investmentAccounts = item.accounts.filter(acc => 
      acc.type === 'investment' && selectedAccounts.includes(acc.account_id)
    );
    
    investmentAccounts.forEach(account => {
      // Get holdings for this account
      const accountHoldings = item.holdings.filter(h => h.account_id === account.account_id);
      
      accountHoldings.forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;

        const price = derivePrice(security, holding);
        const key = security.ticker_symbol || security.name;

        if (!grouped[key]) {
          grouped[key] = {
            ticker: security.ticker_symbol,
            name: security.name,
            type: security.type,
            price: price,
            total_quantity: 0,
            total_value: 0,
            holdings: []
          };
        } else if (!grouped[key].price && price) {
          grouped[key].price = price;
        }
        
        const quantity = holding.quantity;
        const value = price > 0 ? (quantity * price) : (holding.institution_value || 0);
        grouped[key].total_quantity += quantity;
        grouped[key].total_value += value;
        
        const accountName = account.name || account.official_name || 'Unknown Account';
        grouped[key].holdings.push({
          bank: itemInstitution,
          account: accountName,
          quantity,
          value,
          price
        });
      });
    });
  });

  return Object.values(grouped);
}

// Collect the full Plaid payload with enriched holdings (holdings + securities joined) for export
function buildRawHoldingsExport(selectedAccounts) {
  if (!holdingsData || holdingsData.length === 0) return [];
  
  const getSecurityById = (securityId) => {
    return securitiesData.find(s => s.security_id === securityId) || {};
  };
  
  const exportData = [];
  
  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;
    
    // Filter to selected investment accounts
    const selectedInvestmentAccounts = item.accounts.filter(acc => 
      acc.type === 'investment' && selectedAccounts.includes(acc.account_id)
    );
    
    if (selectedInvestmentAccounts.length === 0) return;
    
    // Create enriched holdings for this item
    const enrichedHoldings = item.holdings
      .filter(h => selectedInvestmentAccounts.some(acc => acc.account_id === h.account_id))
      .map(holding => {
        const security = getSecurityById(holding.security_id);
        return {
          ...holding,
          security: security
        };
      });
    
    exportData.push({
      plaid_item_id: item.plaid_item_id,
      institution_name: item.institution_name,
      accounts: selectedInvestmentAccounts,
      holdings: enrichedHoldings,
      item: item.item,
      last_updated: item.last_updated,
      request_id: item.request_id
    });
  });
  
  return exportData;
}

function showMessage(msg, type) {
  const el = $('#status-message');
  el.html(`<div class="message ${type}">${msg}</div>`);
  setTimeout(() => el.html(''), 5000);
}

// Export functions (Simplified)
function exportJSON() {
  const selected = getSelectedAccounts();
  if (selected.length === 0) {
    alert('Select at least one investment account to export.');
    return;
  }
  const rawData = buildRawHoldingsExport(selected);
  if (rawData.length === 0) {
    alert('No holdings found for selected accounts.');
    return;
  }

  const jsonString = JSON.stringify(rawData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'holdings.json';
  link.click();
  URL.revokeObjectURL(url);
}

function copyCSV() {
  const csv = buildCSV();
  if (!csv) return;
  navigator.clipboard.writeText(csv)
    .then(() => showMessage('CSV copied to clipboard', 'success'))
    .catch(() => alert('Failed to copy CSV'));
}

function downloadCSV() {
  const csv = buildCSV();
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'holdings.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// --- CSV helpers ---
function buildCSV() {
  const selected = getSelectedAccounts();
  if (selected.length === 0) {
    alert('Select at least one investment account to export.');
    return null;
  }
  const grouped = buildGroupedHoldings(selected);
  if (grouped.length === 0) {
    alert('No holdings found for selected accounts.');
    return null;
  }

  const rows = [];
  rows.push(['Ticker', 'Name', 'Price', 'Total Qty', 'Total Value']);
  grouped.forEach(g => {
    rows.push([
      g.ticker || '-',
      g.name || '-',
      g.price === undefined || g.price === null ? '-' : formatCurrency(g.price),
      (g.total_quantity || 0).toFixed(4),
      g.total_value === undefined || g.total_value === null ? '-' : formatCurrency(g.total_value)
    ]);
  });

  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}


// Helper to exchange token
async function exchangePublicToken(public_token) {
    try {
        const response = await fetch(`${BACKEND_URL}/api/connections/set_access_token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ public_token: public_token })
        });
        
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to exchange token');
        }
        return data;
    } catch (error) {
        console.error('Error exchanging token:', error);
        alert('Failed to connect bank: ' + error.message);
    }
}
