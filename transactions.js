// BACKEND_URL is now defined in config.js and auto-detects environment

let accounts = [];
let transactions = [];
let synced = false;
let categoryMappings = {};
let customCategories = [];
let availableCategories = [];
let rules = [];
let plaidTaxonomy = [];
let migrationLog = [];
let currentRuleEditId = null;

// Check authentication
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let idleTimeout;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

if (!token) {
  alert('Please log in first');
  window.location.href = 'index.html';
}

async function refreshAccessToken() {
  if (!refreshToken) {
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
      token = data.access_token;
      localStorage.setItem('authToken', token);
      resetIdleTimeout();
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    return false;
  }
}

async function authenticatedFetch(url, options = {}) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };
  
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    }
    alert('Session expired. Please log in again.');
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
  }
  
  return response;
}

function resetIdleTimeout() {
  // Clear existing timeout
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  
  // Only set idle timeout if user is logged in
  if (token && currentUser) {
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
}



function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  token = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// Initialize
$(document).ready(async function() {
  await window.BACKEND_URL_PROMISE;
  setDefaultDates();
  resetIdleTimeout();
  setupActivityListeners();

  // Load accounts and settings in parallel; keep checkboxes unchecked until both complete
  await Promise.all([loadAccounts(), loadSettings()]);

  // After everything is ready, select only enabled accounts/banks
  selectAllAccounts();

  // Sync transactions with Plaid on page load (after accounts are loaded/selected)
  await autoSyncAndLoadTransactions();

  // Render dynamic period buttons after transactions are loaded
  renderDynamicPeriodButtons();

  // Load categorization UI data
  await loadCategorizationData();

  // Add event listener for optional fields
  $(document).on('change', '.field-checkbox', function() {
    renderTransactionTable();
  });
  
  // Add event listener for date range changes - re-render when user changes dates
  $(document).on('input change', '#start-date, #end-date', function() {
    renderTransactionTable();
  });
  
  // Add event listener for account selection changes - re-render when user changes account selection
  $(document).on('change', '.account-checkbox', function() {
    renderTransactionTable();
  });

  // Add event listener for hiding transfers
  $(document).on('change', '#hide-transfers', function() {
    renderTransactionTable();
  });

  // Filter mappings
  $(document).on('input', '#mapping-filter', function() {
    renderMappingsList(this.value);
  });

  // Filter taxonomy list
  $(document).on('input', '#taxonomy-filter', function() {
    renderTaxonomyList(this.value);
  });

  // Manual categorize handler
  $(document).on('click', '.manual-category-save', function() {
    const txnId = $(this).data('txn-id');
    const select = $(`.manual-category-select[data-txn-id="${txnId}"]`);
    const selectedCategory = select.val();
    const accountId = select.data('account-id');
    const txn = transactions.find(t => (t.transaction_id || t.plaid_transaction_id) === txnId);
    if (!txnId || !accountId) {
      showStatus('Unable to categorize: missing transaction or account id', 'error');
      return;
    }
    openCategorizeModal(txn, selectedCategory, accountId, txnId);
  });

  // Add event listener for start date validation
  $('#start-date').on('blur', function() {
    if (!this.value) return;
    
    // Parse input as local date to avoid UTC issues
    const parts = this.value.split('-');
    const startDate = new Date(parts[0], parts[1] - 1, parts[2]);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const limitDate = new Date(today);
    limitDate.setDate(today.getDate() - 90);
    
    if (startDate < limitDate) {
      // Format limitDate as YYYY-MM-DD in local time
      const year = limitDate.getFullYear();
      const month = String(limitDate.getMonth() + 1).padStart(2, '0');
      const day = String(limitDate.getDate()).padStart(2, '0');
      
      // Format for display (MM/DD/YYYY)
      const displayDate = `${month}/${day}/${year}`;
      
      this.value = `${year}-${month}-${day}`;
      
      // Highlight input
      $(this).css('border', '2px solid #ffc107');
      $(this).css('background-color', '#fff3cd');
      
      // Show warning status
      showStatus(`${displayDate} is the earliest valid start date`, 'warning');
      
      // Remove highlight after 3 seconds
      setTimeout(() => {
        $(this).css('border', '');
        $(this).css('background-color', '');
      }, 3000);
    }
  });
});

function setDefaultDates() {
  const end = new Date();
  const start = new Date();
  let today = new Date();
  if (today.getDate() === 1) {
    // If today is first of month, set start date to first of previous month instead of first of current month
    start.setMonth(start.getMonth() - 1);
  }
  else {
    start.setDate(1); // Default to first of the month
  }
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
}

function setEarliestToDate() {
  const end = new Date();
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  // Find the earliest transaction date from synced data
  let earliestDate = null;
  if (transactions && transactions.length > 0) {
    earliestDate = transactions.reduce((earliest, txn) => {
      if (!earliest || txn.date < earliest) {
        return txn.date;
      }
      return earliest;
    }, null);
  }
  
  // If we found an earliest date, use it; otherwise fall back to 90 days ago
  let start;
  if (earliestDate) {
    start = new Date(earliestDate);
  } else {
    start = new Date();
    start.setDate(start.getDate() - 90);
  }
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function setMonthToDate() {
  const end = new Date();
  const start = new Date();
  start.setDate(1); // First of the current month
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function setLastMonth() {
  const now = new Date();
  // Get first day of previous month
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // Get last day of previous month (day 0 of current month)
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  
  // Helper to format date as YYYY-MM-DD in local time
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(end);
  renderTransactionTable();
}

function toggleConfig() {
  const content = document.getElementById('config-content');
  const icon = document.getElementById('toggle-icon');
  content.classList.toggle('open');
  icon.textContent = content.classList.contains('open') ? '▲' : '▼';
}

async function refreshAccounts() {
  try {
    showStatus('Syncing accounts from Plaid...', 'info');
    const response = await fetch(`${BACKEND_URL}/api/connections/accounts`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to refresh accounts');
    }
    
    await loadAccounts(true);
    showStatus('Accounts refreshed successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    console.error('refreshAccounts error:', error);
    showStatus(`Failed to refresh accounts: ${error.message}`, 'error');
  }
}

function selectAllAccounts() {
  // Select all account checkboxes that are not disabled
  document.querySelectorAll('.account-checkbox:not(:disabled)').forEach(checkbox => {
    checkbox.checked = true;
  });
  // Also check bank checkboxes if all their children are checked (simplified: just check all enabled bank checkboxes)
  document.querySelectorAll('.bank-checkbox:not(:disabled)').forEach(checkbox => {
    checkbox.checked = true;
  });
  renderTransactionTable();
}

function deselectAllAccounts() {
  // Deselect all account checkboxes
  document.querySelectorAll('.account-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  // Deselect all bank checkboxes
  document.querySelectorAll('.bank-checkbox').forEach(checkbox => {
    checkbox.checked = false;
  });
  renderTransactionTable();
}

async function loadAccounts() {
  try {
    showStatus('Loading accounts...', 'info');
    
    // Use new endpoint that gets all accounts including disconnected ones
    const url = `${BACKEND_URL}/api/transactions/accounts/all?t=${Date.now()}`;
    const response = await authenticatedFetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache'
    });
    
    const data = await response.json();
    
    if (data.error) {
      showStatus(`Error: ${data.error}`, 'error');
      return;
    }
    
    accounts = data.accounts || [];
    // Filter out investment accounts as they are not supported
    accounts = accounts.filter(acc => acc.account_type !== 'investment');
    
    renderAccountSelector();
    
    showStatus('Accounts loaded successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    console.error('loadAccounts error:', error);
    showStatus(`Failed to load accounts: ${error.message}`, 'error');
  }
}

function renderAccountSelector() {
  const container = document.getElementById('account-selector');
  
  if (accounts.length === 0) {
    container.innerHTML = '<p>No accounts found. Please connect a bank first.</p>';
    return;
  }
  
  // Group by institution
  const grouped = {};
  accounts.forEach(acc => {
    const institutionKey = acc.institution_name;
    if (!grouped[institutionKey]) {
      grouped[institutionKey] = {
        name: acc.institution_name,
        plaid_item_id: acc.plaid_item_id,
        billed_products: acc.billed_products || [],
        accounts: []
      };
    }
    grouped[institutionKey].accounts.push(acc);
  });
  
  let html = '';
  Object.keys(grouped).forEach(key => {
    const group = grouped[key];
    const isBilled = group.billed_products.includes('transactions');
    
    let headerAction = '';
    if (!isBilled) {
        headerAction = `<button class="activate-btn" style="margin-left: 10px;" onclick="activateBank('${group.plaid_item_id}')">Activate & Sync</button>`;
    }

    html += `
      <div class="account-group">
        <div style="display: flex; align-items: center; margin-bottom: 5px;">
            <label style="display: flex; align-items: center;">
            <input type="checkbox" class="bank-checkbox" data-bank="${key}" 
                    onchange="toggleBank('${key}')" ${!isBilled ? 'disabled' : ''}>
            <strong style="margin-left: 5px;">${group.name}</strong>
            </label>
            ${!isBilled ? '<span class="status-badge status-inactive">Available (Not Active)</span>' : '<span class="status-badge status-active">Active</span>'}
            ${headerAction}
        </div>
    `;
    
    group.accounts.forEach(acc => {
      const displayName = acc.custom_name || `${acc.account_name} (${acc.account_subtype || acc.account_type})${acc.mask ? ' ...' + acc.mask : ''}`;
      
      html += `
        <div class="account-item">
          <div style="display: flex; align-items: center;">
            <button class="secondary" style="padding: 2px 6px; font-size: 10px; margin-right: 8px;" 
                    onclick="promptRename('${acc.plaid_account_id}', '${(acc.custom_name || '').replace(/'/g, "\\'")}')">
              Rename
            </button>
            <label style="flex-grow: 1;">
              <input type="checkbox" class="account-checkbox" 
                     data-bank="${key}"
                     data-account-id="${acc.plaid_account_id}"
                     ${!isBilled ? 'disabled' : ''}>
              ${displayName}
            </label>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  });
  
  container.innerHTML = html;
}

async function activateBank(itemId) {
    if (!confirm('Activating transactions for this bank may incur additional fees. Do you want to proceed?')) {
        return;
    }

    const btn = $(`button[onclick="activateBank('${itemId}')"]`);
    const originalText = btn.text();
    btn.prop('disabled', true).text('Activating...');

    try {
        const itemAccounts = accounts.filter(a => a.plaid_item_id === itemId);
        if (itemAccounts.length === 0) {
            throw new Error('No accounts found for this bank.');
        }
        const accountIds = itemAccounts.map(a => a.plaid_account_id);

        // Use last 30 days for activation
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        
        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        await performSync(accountIds, formatDate(start), formatDate(end), true);
        
        // Refresh accounts to update status (force network)
        await loadAccounts(true);
        showStatus('Activated successfully', 'success');

    } catch (error) {
        alert('Activation failed: ' + error.message);
    } finally {
        btn.prop('disabled', false).text(originalText);
    }
}

function toggleBank(institution) {
  const bankCheckbox = $(`.bank-checkbox[data-bank="${institution}"]`);
  // Only toggle enabled account checkboxes
  const accountCheckboxes = $(`.account-checkbox[data-bank="${institution}"]:not(:disabled)`);
  accountCheckboxes.prop('checked', bankCheckbox.prop('checked'));
  renderTransactionTable();
}

async function performSync(accountIds, startDate, endDate, activate = false) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/sync_transactions`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: startDate,
      end_date: endDate,
      account_ids: accountIds,
      activate: activate
    })
  });
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(data.error);
  }
  
  return data;
}

async function syncTransactions() {
  // This function is called when user manually clicks a sync button (if we keep one)
  // For now, syncing happens automatically on page load via autoSyncAndLoadTransactions()
  // Force network path on manual sync
  await autoSyncAndLoadTransactions(true);
}

async function autoSyncAndLoadTransactions(forceNetwork = false) {
  // This function runs on page load and handles sync + fetch automatically
  const selectedAccounts = getSelectedAccounts();
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  
  if (!startDate || !endDate) {
    showStatus('Please select a date range', 'error');
    return;
  }
  
  if (selectedAccounts.length === 0) {
    showStatus('Please select at least one account', 'error');
    return;
  }
  
  try {
    showStatus('Syncing transactions from Plaid...', 'info');
    
    const syncData = await performSync(selectedAccounts, startDate, endDate);
    let successMsg = `Synced ${syncData.synced_count || 0} transactions (${syncData.new_count || 0} new, ${syncData.updated_count || 0} updated)`;
    showStatus(successMsg, 'info');
    synced = true;
    
    // Now fetch all transactions from backend (no filters, frontend handles all filtering)
    await fetchAllTransactions(true); // force network fetch after sync
    
  } catch (error) {
    showStatus(`Sync failed: ${error.message}`, 'error');
    await fetchAllTransactions(false);
  }
}

async function fetchAllTransactions(forceNetwork = false) {
  // Fetch all transactions for the user (backend returns all, frontend filters)
  try {
    showStatus('Loading all transactions...', 'info');
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transactions`, {
      method: 'GET',
      mode: 'cors'
    });
    
    const data = await response.json();
    
    if (data.error) {
      showStatus(`Error: ${data.error}`, 'error');
      return;
    }
    
    transactions = data.transactions || [];
    renderTransactionTable();
    renderDynamicPeriodButtons(); // Update period buttons when transactions change
    showStatus(`Loaded ${transactions.length} total transactions (filters applied on frontend)`, 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    showStatus(`Load failed: ${error.message}`, 'error');
  }
}

function renderTransactionTable() {
  const container = document.getElementById('table-container');
  
  if (transactions.length === 0) {
    container.innerHTML = '<div class="empty-state">No transactions found. Sync transactions first.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    renderInsightsPanel(); // Still render empty insights
    return;
  }

  // Get all filter criteria from UI
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingCheckbox = document.querySelector('.field-checkbox[value="pending"]:checked');
  const hideTransfers = document.getElementById('hide-transfers').checked;
  
  // Get selected optional fields
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });
  
  // Apply all filters to transactions array
  const filteredTransactions = transactions.filter(txn => {
    // Filter by date range
    if (txn.date < startDate || txn.date > endDate) {
      return false;
    }
    
    // Filter by selected accounts
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.plaid_account_id)) {
      return false;
    }
    
    // Filter pending transactions - only show if pending checkbox is checked
    if (txn.pending && !showPendingCheckbox) {
      return false;
    }

    // Hide transfers if requested (checks personal finance primary category)
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) {
        return false;
      }
    }
    
    return true;
  });
  
  if (filteredTransactions.length === 0) {
    container.innerHTML = '<div class="empty-state">No transactions found for the selected criteria.</div>';
    document.getElementById('export-buttons').classList.add('hidden');
    renderCategoryChart(); // Clear chart when no data
    renderInsightsPanel(); // Still render empty insights
    return;
  }
  
  let html = '<table><thead><tr>';
  html += '<th>Date</th>';
  html += '<th>Bank/Account</th>';
  html += '<th>Description</th>';
  html += '<th>Amount</th>';
  html += '<th>Manual Categorize</th>';
  
  // Add optional headers
  if (optionalFields.includes('merchant_name')) html += '<th>Merchant</th>';
   if (optionalFields.includes('category')) {
     html += '<th>Category (Primary)</th>';
     html += '<th>Category (Detailed)</th>';
     html += '<th>Confidence</th>';
   }
  if (optionalFields.includes('payment_channel')) html += '<th>Channel</th>';
  if (optionalFields.includes('pending')) html += '<th>Pending</th>';
  if (optionalFields.includes('check_number')) html += '<th>Check #</th>';
  if (optionalFields.includes('original_description')) html += '<th>Original Desc</th>';
  if (optionalFields.includes('authorized_date')) html += '<th>Auth Date</th>';
  if (optionalFields.includes('authorized_datetime')) html += '<th>Auth Time</th>';

  html += '</tr></thead><tbody>';
  
  filteredTransactions.forEach(txn => {
    // Parse the date string properly
    const dateObj = new Date(txn.date);
    // Format as MM/DD/YYYY using UTC to prevent timezone shifts
    const dateStr = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC'
    });
    
    const amount = new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: txn.iso_currency_code || 'USD' 
    }).format(txn.amount);
    
    html += '<tr>';
    html += `<td>${dateStr}</td>`;
    html += `<td>${txn.bank_account}</td>`;
    html += `<td>${txn.name || ''}</td>`;
    html += `<td>${amount}</td>`;

    const txnId = txn.transaction_id || txn.plaid_transaction_id || '';
    const currentCategory = txn.user_category || (txn.personal_finance_category && txn.personal_finance_category.detailed) || 'Uncategorized';
    const categoryOptions = buildCategoryOptions(currentCategory);
    const manualCell = txnId ? `
      <div class="manual-category-cell">
        <select class="manual-category-select table-inline-select" data-txn-id="${txnId}" data-account-id="${txn.plaid_account_id || ''}">
          ${categoryOptions}
        </select>
        <button class="secondary manual-category-save" data-txn-id="${txnId}">Save</button>
      </div>
    ` : '<span class="pill">N/A</span>';
    html += `<td>${manualCell}</td>`;

    // Add optional cells
    if (optionalFields.includes('merchant_name')) html += `<td>${txn.merchant_name || ''}</td>`;
    if (optionalFields.includes('category')) {
         // Use new personal_finance_category if available, otherwise fallback to legacy category
        const pfc = txn.personal_finance_category;
        if (pfc) {
          const primary = (pfc.primary || '').replace(/_/g, ' ').trim();
          const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
          // Remove the primary phrase if it prefixes detailed; otherwise drop first token
          let detailed = detailedRaw;
          if (primary && detailedRaw.toLowerCase().startsWith(primary.toLowerCase() + ' ')) {
            detailed = detailedRaw.slice(primary.length).trim();
          } else {
            detailed = detailedRaw.replace(/^\S+\s*/, '').trim();
          }
          const confidence = (pfc.confidence_level || '').replace(/_/g, ' ');
           html += `<td>${primary}</td>`;
           html += `<td>${detailed}</td>`;
           html += `<td>${confidence}</td>`;
         } else {
           // Fallback to legacy category format
           let cat = txn.category;
           if (typeof cat === 'string' && cat.startsWith('{')) {
             cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
           } else if (Array.isArray(cat)) {
             cat = cat.join(', ');
           }
           html += `<td colspan="3">${cat || ''}</td>`;
         }
    }
    if (optionalFields.includes('payment_channel')) html += `<td>${txn.payment_channel || ''}</td>`;
    if (optionalFields.includes('pending')) html += `<td>${txn.pending ? 'Yes' : 'No'}</td>`;
    if (optionalFields.includes('check_number')) html += `<td>${txn.check_number || ''}</td>`;
    if (optionalFields.includes('original_description')) html += `<td>${txn.original_description || ''}</td>`;
    if (optionalFields.includes('authorized_date')) html += `<td>${txn.authorized_date || ''}</td>`;
    if (optionalFields.includes('authorized_datetime')) {
        let authTime = '';
        if (txn.authorized_datetime) {
            const dt = new Date(txn.authorized_datetime);
            authTime = dt.toLocaleString('en-US', {
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
        }
        html += `<td>${authTime}</td>`;
    }

    html += '</tr>';
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
  document.getElementById('export-buttons').classList.remove('hidden');
  
  // Update chart visualization
  renderCategoryChart();
  
  // Update insights panel
  renderInsightsPanel();
}

function getSelectedAccounts() {
  const selected = [];
  $('.account-checkbox:checked').each(function() {
    selected.push($(this).data('account-id'));
  });
  return selected;
}

function exportJSON() {
  const dataStr = JSON.stringify(transactions, null, 2);
  const dataBlob = new Blob([dataStr], {type: 'application/json'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.json`;
  link.click();
}

function copyCSV() {
  const csv = generateCSV();
  navigator.clipboard.writeText(csv).then(() => {
    showStatus('CSV copied to clipboard!', 'success');
    setTimeout(() => clearStatus(), 2000);
  }).catch(err => {
    showStatus('Failed to copy to clipboard', 'error');
  });
}

function downloadCSV() {
  const csv = generateCSV();
  const dataBlob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transactions_${getDateRange()}.csv`;
  link.click();
}

function generateCSV() {
  // Get selected optional fields
  const optionalFields = [];
  $('.field-checkbox:checked').each(function() {
    optionalFields.push($(this).val());
  });

  let csv = 'Date,Bank/Account,Description,Amount';
  
  // Add optional headers
  if (optionalFields.includes('merchant_name')) csv += ',Merchant';
   if (optionalFields.includes('category')) csv += ',Category (Primary),Category (Detailed),Confidence';
  if (optionalFields.includes('payment_channel')) csv += ',Channel';
  if (optionalFields.includes('pending')) csv += ',Pending';
  if (optionalFields.includes('check_number')) csv += ',Check #';
  if (optionalFields.includes('original_description')) csv += ',Original Desc';
  if (optionalFields.includes('authorized_date')) csv += ',Auth Date';
  if (optionalFields.includes('authorized_datetime')) csv += ',Auth Time';
  
  csv += '\n';

  transactions.forEach(txn => {
    const dateObj = new Date(txn.date);
    const dateStr = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC'
    });
    const amount = txn.amount;
    const name = (txn.name || '').replace(/"/g, '""');
    
    csv += `"${dateStr}","${txn.bank_account}","${name}",${amount}`;
    
    // Add optional fields
    if (optionalFields.includes('merchant_name')) csv += `,"${(txn.merchant_name || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('category')) {
         // Use new personal_finance_category if available
         const pfc = txn.personal_finance_category;
         if (pfc) {
           const primaryRaw = (pfc.primary || '').replace(/_/g, ' ').trim();
           const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
           let detailedTrimmed = detailedRaw;
           if (primaryRaw && detailedRaw.toLowerCase().startsWith(primaryRaw.toLowerCase() + ' ')) {
             detailedTrimmed = detailedRaw.slice(primaryRaw.length).trim();
           } else {
             detailedTrimmed = detailedRaw.replace(/^\S+\s*/, '').trim();
           }
           const primary = primaryRaw.replace(/"/g, '""');
           const detailed = detailedTrimmed.replace(/"/g, '""');
           const confidence = (pfc.confidence_level || '').replace(/_/g, ' ').replace(/"/g, '""');
           csv += `,"${primary}","${detailed}","${confidence}"`;
         } else {
           // Fallback to legacy category
           let cat = txn.category;
           if (typeof cat === 'string' && cat.startsWith('{')) {
             cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
           } else if (Array.isArray(cat)) {
             cat = cat.join(', ');
           }
           csv += `,"${(cat || '').replace(/"/g, '""')}","",""`;
         }
    }
    if (optionalFields.includes('payment_channel')) csv += `,"${(txn.payment_channel || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('pending')) csv += `,${txn.pending ? 'Yes' : 'No'}`;
    if (optionalFields.includes('check_number')) csv += `,"${(txn.check_number || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('original_description')) csv += `,"${(txn.original_description || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('authorized_date')) csv += `,"${(txn.authorized_date || '').replace(/"/g, '""')}"`;
    if (optionalFields.includes('authorized_datetime')) {
        let authTime = '';
        if (txn.authorized_datetime) {
            const dt = new Date(txn.authorized_datetime);
            authTime = dt.toLocaleString('en-US', {
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
        }
        csv += `,"${authTime}"`;
    }
    
    csv += '\n';
  });
  return csv;
}

function getDateRange() {
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  return `${start}_to_${end}`;
}

// ===============================
// DYNAMIC PERIOD BUTTONS
// ===============================

function renderDynamicPeriodButtons() {
  const container = document.getElementById('dynamic-period-buttons');
  if (!container) return;
  
  if (!transactions || transactions.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  // Find earliest and latest transaction dates
  let earliest = null;
  let latest = null;
  
  transactions.forEach(txn => {
    if (!earliest || txn.date < earliest) earliest = txn.date;
    if (!latest || txn.date > latest) latest = txn.date;
  });
  
  if (!earliest || !latest) {
    container.innerHTML = '';
    return;
  }
  
  const earliestDate = new Date(earliest);
  const latestDate = new Date(latest);
  
  // Calculate span in days
  const daysDiff = Math.ceil((latestDate - earliestDate) / (1000 * 60 * 60 * 24));
  
  // If span is 2+ years, show year buttons; otherwise show month buttons
  if (daysDiff >= 730) {
    renderYearButtons(container, earliestDate, latestDate);
  } else {
    renderMonthButtons(container, earliestDate, latestDate);
  }
}

function renderYearButtons(container, earliestDate, latestDate) {
  const startYear = earliestDate.getFullYear();
  const endYear = latestDate.getFullYear();
  
  let html = '<span style="font-size: 14px; font-weight: 500; color: #666;">Quick Select:</span>';
  
  for (let year = startYear; year <= endYear; year++) {
    html += `<button onclick="setPeriodYear(${year})" class="secondary" style="padding: 4px 10px; font-size: 12px;">${year}</button>`;
  }
  
  container.innerHTML = html;
}

function renderMonthButtons(container, earliestDate, latestDate) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let html = '<span style="font-size: 14px; font-weight: 500; color: #666;">Quick Select:</span>';
  
  // Build list of year-month combinations
  const months = [];
  let current = new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1);
  const end = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
  
  while (current <= end) {
    months.push({
      year: current.getFullYear(),
      month: current.getMonth(),
      label: monthNames[current.getMonth()]
    });
    current.setMonth(current.getMonth() + 1);
  }
  
  // If multiple years, show year prefix for clarity
  const multiYear = months.length > 0 && months[0].year !== months[months.length - 1].year;
  
  months.forEach(m => {
    const label = multiYear ? `${m.label} '${String(m.year).slice(-2)}` : m.label;
    html += `<button onclick="setPeriodMonth(${m.year}, ${m.month})" class="secondary" style="padding: 4px 10px; font-size: 12px;">${label}</button>`;
  });
  
  container.innerHTML = html;
}

function setPeriodYear(year) {
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const start = new Date(year, 0, 1); // January 1st
  const end = new Date(year, 11, 31); // December 31st
  const today = new Date();
  
  // Don't go beyond today
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(actualEnd);
  renderTransactionTable();
}

function setPeriodMonth(year, month) {
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  
  const start = new Date(year, month, 1); // First day of month
  const end = new Date(year, month + 1, 0); // Last day of month
  const today = new Date();
  
  // Don't go beyond today
  const actualEnd = end > today ? today : end;
  
  document.getElementById('start-date').value = formatDate(start);
  document.getElementById('end-date').value = formatDate(actualEnd);
  renderTransactionTable();
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('status-message');
  statusDiv.className = `status-message ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.display = 'block';
}

function clearStatus() {
  const statusDiv = document.getElementById('status-message');
  statusDiv.style.display = 'none';
}

async function promptRename(accountId, currentCustomName) {
  const newName = prompt('Enter a custom name for this account (leave empty to reset):', currentCustomName);
  
  if (newName === null) return; // User cancelled
  
  try {
    showStatus('Updating account name...', 'info');
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/accounts/rename`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plaid_account_id: accountId,
        custom_name: newName.trim() || null
      })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to rename account');
    }
    
    showStatus('Account renamed successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
    // Refresh accounts list
    await loadAccounts(true);
    
  } catch (error) {
    console.error('Rename error:', error);
    showStatus(`Failed to rename account: ${error.message}`, 'error');
  }
}

async function saveSettings() {
  try {
    showStatus('Saving settings...', 'info');
    
    const optionalFields = [];
    $('.field-checkbox:checked').each(function() {
      optionalFields.push($(this).val());
    });
    const timezone = document.getElementById('timezone').value;
    const hideTransfers = document.getElementById('hide-transfers').checked;
    
    const settings = {
      optional_fields: optionalFields,
      field_order: ['datetime', 'bank_account', 'name', 'amount', ...optionalFields],
      timezone: timezone,
      hide_transfers: hideTransfers
    };
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transaction_viewer_settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to save settings');
    }
    
    showStatus('Settings saved successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus(`Failed to save settings: ${error.message}`, 'error');
  }
}

async function loadSettings() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transaction_viewer_settings`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error('Failed to load settings');
    }
    
    const settings = await response.json();
    applySettings(settings);
    
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

function applySettings(settings) {
  if (!settings) return;

  if (settings.timezone) {
    document.getElementById('timezone').value = settings.timezone;
  }
  
  if (settings.optional_fields && Array.isArray(settings.optional_fields)) {
    $('.field-checkbox').prop('checked', false);
    settings.optional_fields.forEach(field => {
      $(`.field-checkbox[value="${field}"]`).prop('checked', true);
    });
  }
  
  // Apply hide_transfers setting (default to true if not set)
  const hideTransfers = settings.hide_transfers !== undefined ? settings.hide_transfers : true;
  document.getElementById('hide-transfers').checked = hideTransfers;
}

// ===============================
// CATEGORY HISTORY & INSIGHTS
// ===============================

function generateSpendingInsights() {
  // Generate statistical insights based on filtered transactions and historical data
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingCheckbox = document.querySelector('.field-checkbox[value="pending"]:checked');
  const hideTransfers = document.getElementById('hide-transfers').checked;

  // Get filtered transactions (same filter as table)
  const filteredTransactions = transactions.filter(txn => {
    if (txn.date < startDate || txn.date > endDate) return false;
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.plaid_account_id)) return false;
    if (txn.pending && !showPendingCheckbox) return false;
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) return false;
    }
    if (txn.personal_finance_category && txn.personal_finance_category.primary) {
      if (/income/i.test(txn.personal_finance_category.primary)) return false;
    }
    return true;
  });

  if (filteredTransactions.length === 0) {
    return null;
  }

  // Calculate current period stats
  const currentStats = {
    totalSpending: 0,
    transactionCount: filteredTransactions.length,
    categories: {},
    largestTransaction: null,
    averageTransaction: 0
  };

  filteredTransactions.forEach(txn => {
    const amount = Math.abs(txn.amount || 0);
    currentStats.totalSpending += amount;

    // Track largest transaction
    if (!currentStats.largestTransaction || amount > currentStats.largestTransaction.amount) {
      currentStats.largestTransaction = {
        amount: amount,
        merchant: txn.merchant_name || txn.name || 'Unknown',
        date: txn.date,
        category: (txn.personal_finance_category && txn.personal_finance_category.primary) || 'Uncategorized'
      };
    }

    // Aggregate by primary category
    const category = (txn.personal_finance_category && txn.personal_finance_category.primary) || 'Uncategorized';
    const categoryName = category.replace(/_/g, ' ');
    if (!currentStats.categories[categoryName]) {
      currentStats.categories[categoryName] = { total: 0, count: 0 };
    }
    currentStats.categories[categoryName].total += amount;
    currentStats.categories[categoryName].count += 1;
  });

  currentStats.averageTransaction = currentStats.totalSpending / currentStats.transactionCount;

  // Get top categories
  const topCategories = Object.entries(currentStats.categories)
    .map(([name, data]) => ({ name, total: data.total, count: data.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  // Build insights array
  const insights = [];

  // Insight 1: Total spending
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.totalSpending);
  insights.push({
    icon: '💰',
    label: 'Total Spending',
    value: `${formattedTotal} across ${currentStats.transactionCount} transactions`
  });

  // Insight 2: Top category
  if (topCategories.length > 0) {
    const topCat = topCategories[0];
    const percentage = ((topCat.total / currentStats.totalSpending) * 100).toFixed(0);
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(topCat.total);
    insights.push({
      icon: '📈',
      label: 'Top Category',
      value: `${topCat.name} (${formatted} - ${percentage}% of spending)`
    });
  }

  // Insight 3: Average transaction
  const formattedAvg = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.averageTransaction);
  insights.push({
    icon: '💳',
    label: 'Average Transaction',
    value: formattedAvg
  });

  // Insight 4: Largest transaction
  if (currentStats.largestTransaction) {
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.largestTransaction.amount);
    insights.push({
      icon: '🔥',
      label: 'Largest Purchase',
      value: `${formatted} at ${currentStats.largestTransaction.merchant}`
    });
  }

  return insights;
}

function renderInsightsPanel() {
  const container = document.getElementById('insights-container');
  if (!container) return; // Insights panel not in DOM yet

  const insights = generateSpendingInsights();
  
  if (!insights || insights.length === 0) {
    container.innerHTML = '<div class="insights-empty">Select accounts and date range to view insights</div>';
    return;
  }

  let html = '<div class="insights-grid">';
  insights.forEach(insight => {
    const highlightClass = insight.highlight ? ' highlight' : '';
    html += `
      <div class="insight-card${highlightClass}">
        <div class="insight-icon">${insight.icon}</div>
        <div class="insight-content">
          <div class="insight-label">${insight.label}</div>
          <div class="insight-value">${insight.value}</div>
        </div>
      </div>
    `;
  });
  html += '</div>';

  container.innerHTML = html;
}

// ===============================
// CHART VISUALIZATION
// ===============================

let categoryChart = null;
let chartViewMode = 'primary'; // 'primary' or 'detailed'

// Pastel color palette
const PASTEL_COLORS = [
  '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
  '#E0BBE4', '#FFDFD3', '#FEC8D8', '#D4F1F4', '#C9E4DE',
  '#F7D9C4', '#FAEDCB', '#C9F0DB', '#DBE7E4', '#F0EFEB',
  '#D5AAFF', '#FFCCE5', '#B4E7CE', '#FDE2E4', '#E2ECE9'
];

function switchChartView(mode) {
  chartViewMode = mode;
  
  // Update button states
  document.getElementById('chart-primary-btn').classList.toggle('active', mode === 'primary');
  document.getElementById('chart-detailed-btn').classList.toggle('active', mode === 'detailed');
  
  // Re-render chart
  renderCategoryChart();
}

function aggregateCategoriesFromFilteredTransactions() {
  // Get the same filtered transactions that the table uses
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const showPendingCheckbox = document.querySelector('.field-checkbox[value="pending"]:checked');
  const hideTransfers = document.getElementById('hide-transfers').checked;
  
  const filteredTransactions = transactions.filter(txn => {
    // Filter by date range
    if (txn.date < startDate || txn.date > endDate) {
      return false;
    }
    
    // Filter by selected accounts
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.plaid_account_id)) {
      return false;
    }
    
    // Filter pending transactions
    if (txn.pending && !showPendingCheckbox) {
      return false;
    }

    // Hide transfers if requested
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) {
        return false;
      }
    }

    // Exclude income transactions from chart
    if (txn.personal_finance_category && txn.personal_finance_category.primary) {
      const primaryCat = txn.personal_finance_category.primary;
      if (/income/i.test(primaryCat)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Aggregate by category
  const categoryTotals = {};
  
  filteredTransactions.forEach(txn => {
    const pfc = txn.personal_finance_category;
    let categoryKey = 'Uncategorized';
    
    if (pfc) {
      if (chartViewMode === 'primary') {
        categoryKey = (pfc.primary || 'Uncategorized').replace(/_/g, ' ');
      } else {
        // Detailed mode
        const primaryRaw = (pfc.primary || '').replace(/_/g, ' ').trim();
        const detailedRaw = (pfc.detailed || '').replace(/_/g, ' ').trim();
        
        if (detailedRaw) {
          // Remove primary prefix from detailed
          if (primaryRaw && detailedRaw.toLowerCase().startsWith(primaryRaw.toLowerCase() + ' ')) {
            // categoryKey = detailedRaw.slice(primaryRaw.length).trim();
            categoryKey = detailedRaw
          } else {
            categoryKey = detailedRaw.replace(/^\S+\s*/, '').trim();
          }
          
          if (!categoryKey) {
            categoryKey = detailedRaw;
          }
        } else if (primaryRaw) {
          categoryKey = primaryRaw;
        }
      }
    } else if (txn.category) {
      // Fallback to legacy category
      let cat = txn.category;
      if (typeof cat === 'string' && cat.startsWith('{')) {
        cat = cat.replace(/^{|}$/g, '').replace(/,/g, ', ');
      } else if (Array.isArray(cat)) {
        cat = cat.join(', ');
      }
      categoryKey = cat || 'Uncategorized';
    }
    
    // Sum amounts (use absolute value for visualization)
    const amount = Math.abs(txn.amount || 0);
    categoryTotals[categoryKey] = (categoryTotals[categoryKey] || 0) + amount;
  });
  
  // Convert to array and sort by amount descending
  const categoriesArray = Object.entries(categoryTotals)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
  
  return categoriesArray;
}

function renderCategoryChart() {
  const categoryData = aggregateCategoriesFromFilteredTransactions();
  const canvas = document.getElementById('category-chart');
  const emptyState = document.getElementById('chart-empty-state');
  
  // Show/hide empty state
  if (categoryData.length === 0) {
    emptyState.classList.add('visible');
    canvas.style.display = 'none';
    if (categoryChart) {
      categoryChart.destroy();
      categoryChart = null;
    }
    return;
  } else {
    emptyState.classList.remove('visible');
    canvas.style.display = 'block';
  }
  
  const labels = categoryData.map(item => item.category);
  const data = categoryData.map(item => item.total);
  const colors = categoryData.map((_, index) => PASTEL_COLORS[index % PASTEL_COLORS.length]);
  
  // Destroy existing chart
  if (categoryChart) {
    categoryChart.destroy();
  }
  
  // Create new chart
  const ctx = canvas.getContext('2d');
  categoryChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            padding: 10,
            font: {
              size: 9.5
            },
            boxWidth: 12,
            maxWidth: 160,
            generateLabels: function(chart) {
              const data = chart.data;
              if (data.labels.length && data.datasets.length) {
                const dataset = data.datasets[0];
                const total = dataset.data.reduce((sum, val) => sum + val, 0);
                
                return data.labels.map((label, i) => {
                  const value = dataset.data[i];
                  const percentage = ((value / total) * 100).toFixed(1);
                  // Truncate very long labels (>30 chars) with ellipsis
                  let displayLabel = label;
                  if (label.length > 30) {
                    displayLabel = label.substring(0, 27) + '...';
                  }
                  
                  return {
                    text: `${displayLabel} (${percentage}%)`,
                    fillStyle: dataset.backgroundColor[i],
                    hidden: false,
                    index: i
                  };
                });
              }
              return [];
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed;
              const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              const formatted = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
              }).format(value);
              
              return `${label}: ${formatted} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// ============= CATEGORIZATION MANAGEMENT =============

async function loadCategorizationData() {
  try {
    await window.BACKEND_URL_PROMISE;
    const [categoriesRes, availableRes, rulesRes, logRes, taxonomyRes] = await Promise.all([
      authenticatedFetch(`${BACKEND_URL}/api/categorization/categories`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/migration-log`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/plaid-taxonomy`)
    ]);

    const categoriesData = await categoriesRes.json();
    const availableData = await availableRes.json();
    const rulesData = await rulesRes.json();
    const logData = await logRes.json();
    const taxonomyData = await taxonomyRes.json();

    categoryMappings = categoriesRes.ok ? (categoriesData.category_mappings || {}) : {};
    customCategories = categoriesRes.ok ? (categoriesData.custom_categories || []) : [];
    availableCategories = availableRes.ok ? (availableData.available_categories || []) : [];
    rules = rulesRes.ok ? (rulesData.rules || []) : [];
    migrationLog = logRes.ok ? (logData.migrations || []) : [];
    plaidTaxonomy = taxonomyRes.ok ? (taxonomyData.categories || []) : [];

    renderMappingsList();
    renderCustomCategories();
    renderTaxonomyList();
    renderRulesTable();
    renderRuleFormOptions();
    renderMigrationSelectors();
    renderMigrationLog();
    renderMappingSelectOptions();

    // Refresh table to include latest categories
    renderTransactionTable();
  } catch (error) {
    console.error('loadCategorizationData error:', error);
    showStatus(`Failed to load categorization data: ${error.message}`, 'error');
  }
}

function refreshCategorizationData() {
  return loadCategorizationData();
}

function renderMappingsList(filterText = '') {
  const container = document.getElementById('mappings-list');
  const filter = (filterText || '').toLowerCase().trim();
  const entries = Object.entries(categoryMappings || {}).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No mappings yet.</div>';
    return;
  }

  const rows = entries
    .filter(([plaidCat, userLabel]) => {
      if (!filter) return true;
      return plaidCat.toLowerCase().includes(filter) || (userLabel || '').toLowerCase().includes(filter);
    })
    .map(([plaidCat, userLabel]) => {
      const displayKey = formatPlaidCategory(plaidCat);
      return `
        <div class="mapping-row" data-plaid-category="${escapeHtml(plaidCat)}">
          <div class="mapping-key">${escapeHtml(displayKey)}</div>
          <input class="mapping-value" type="text" value="${escapeHtml(userLabel || '')}" placeholder="User label">
          <button class="secondary mapping-clear" onclick="clearMapping('${escapeHtml(plaidCat)}')">Clear</button>
        </div>
      `;
    })
    .join('');

  container.innerHTML = rows || '<div class="empty-state">No mappings match your filter.</div>';
}

function renderMappingSelectOptions() {
  const select = document.getElementById('mapping-plaid-select');
  if (!select) return;
  const options = plaidTaxonomy
    .slice()
    .sort((a, b) => a.detailed.localeCompare(b.detailed))
    .map(cat => {
      const label = `${formatPlaidCategory(cat.primary)} / ${formatPlaidCategory(cat.detailed)}`;
      return `<option value="${escapeHtml(cat.detailed)}">${escapeHtml(label)}</option>`;
    })
    .join('');
  select.innerHTML = options;
}

function renderTaxonomyList(filterText = '') {
  const container = document.getElementById('taxonomy-list');
  if (!container) return;
  const filter = (filterText || '').toLowerCase().trim();
  const rows = (plaidTaxonomy || [])
    .filter(cat => {
      if (!filter) return true;
      return cat.primary.toLowerCase().includes(filter) || cat.detailed.toLowerCase().includes(filter);
    })
    .map(cat => {
      const label = `${formatPlaidCategory(cat.primary)} / ${formatPlaidCategory(cat.detailed)}`;
      return `<div class="taxonomy-row">${escapeHtml(label)}</div>`;
    })
    .join('');

  container.innerHTML = rows || '<div class="empty-state">No taxonomy items found.</div>';
}

function toggleTaxonomy() {
  const content = document.getElementById('taxonomy-content');
  const toggle = document.getElementById('taxonomy-toggle');
  content.classList.toggle('open');
  toggle.textContent = content.classList.contains('open') ? '▲' : '▼';
}

function clearMapping(plaidCategory) {
  const row = document.querySelector(`.mapping-row[data-plaid-category="${plaidCategory}"]`);
  if (row) {
    const input = row.querySelector('.mapping-value');
    if (input) input.value = '';
  }
}

async function saveCategoryMappings() {
  try {
    const mappingRows = document.querySelectorAll('.mapping-row');
    const newMappings = {};
    mappingRows.forEach(row => {
      const key = row.getAttribute('data-plaid-category');
      const value = row.querySelector('.mapping-value').value.trim();
      if (key && value) {
        newMappings[key] = value;
      }
    });

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/mappings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_mappings: newMappings })
    });

    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to save mappings', 'error');
      return;
    }

    showStatus('Mappings saved', 'success');
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to save mappings: ${error.message}`, 'error');
  }
}

function addMappingRow() {
  const plaidSelect = document.getElementById('mapping-plaid-select');
  const userLabelInput = document.getElementById('mapping-user-label');
  const plaidCat = (plaidSelect && plaidSelect.value) || '';
  const userLabel = (userLabelInput && userLabelInput.value || '').trim();

  if (!plaidCat || !userLabel) {
    showStatus('Select a Plaid category and enter a user label', 'warning');
    return;
  }

  categoryMappings[plaidCat] = userLabel;
  if (userLabelInput) userLabelInput.value = '';
  renderMappingsList(document.getElementById('mapping-filter').value);
}

async function addCustomCategory() {
  const input = document.getElementById('custom-category-input');
  const categoryName = (input.value || '').trim();
  if (!categoryName) {
    showStatus('Enter a category name', 'warning');
    return;
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_name: categoryName })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to add category', 'error');
      return;
    }
    input.value = '';
    showStatus('Custom category added', 'success');
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to add category: ${error.message}`, 'error');
  }
}

function renderCustomCategories() {
  const container = document.getElementById('custom-category-list');
  if (!customCategories.length) {
    container.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    return;
  }

  container.innerHTML = customCategories
    .map(cat => `
      <div class="tag-item">
        <span>${escapeHtml(cat)}</span>
        <button class="secondary" onclick="confirmDeleteCategory('${escapeHtml(cat)}')">Delete</button>
      </div>
    `)
    .join('');
}

function renderRuleFormOptions() {
  const targetSelect = document.getElementById('rule-target-category');
  if (!targetSelect) return;
  const options = buildCategoryOptions();
  targetSelect.innerHTML = options;

  const mergeTarget = document.getElementById('merge-target');
  if (mergeTarget) mergeTarget.innerHTML = options;
  const splitOld = document.getElementById('split-old');
  if (splitOld) splitOld.innerHTML = options;
}

function renderRulesTable() {
  const container = document.getElementById('rules-table');
  if (!rules.length) {
    container.innerHTML = '<div class="empty-state">No rules created yet.</div>';
    return;
  }

  const rows = rules
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map(rule => {
      const match = rule.match_criteria || {};
      const matchLabel = `${match.match_type || 'unknown'}: ${match.match_value || ''}`;
      return `
        <tr>
          <td>${rule.priority || 0}</td>
          <td>${escapeHtml(rule.rule_name || '')}</td>
          <td>${escapeHtml(matchLabel)}</td>
          <td>${escapeHtml(rule.target_category || '')}</td>
          <td>${rule.is_active ? 'Yes' : 'No'}</td>
          <td>
            <div class="rules-actions">
              <button class="secondary" onclick="editRule(${rule.id})">Edit</button>
              <button class="secondary" onclick="adjustRulePriority(${rule.id}, 'up')">↑</button>
              <button class="secondary" onclick="adjustRulePriority(${rule.id}, 'down')">↓</button>
              <button class="secondary" onclick="confirmDeleteRule(${rule.id})">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Priority</th>
          <th>Name</th>
          <th>Match</th>
          <th>Target</th>
          <th>Active</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function saveRule() {
  const ruleName = document.getElementById('rule-name').value.trim();
  const matchType = document.getElementById('rule-match-type').value;
  const matchValue = document.getElementById('rule-match-value').value.trim();
  const targetCategory = document.getElementById('rule-target-category').value;
  const priority = parseInt(document.getElementById('rule-priority').value || '0', 10);
  const caseSensitive = document.getElementById('rule-case-sensitive').checked;
  const isActive = document.getElementById('rule-active').checked;

  if (!ruleName || !matchType || !matchValue || !targetCategory) {
    showStatus('Fill in rule name, match, and target category', 'warning');
    return;
  }

  const payload = {
    rule_name: ruleName,
    match_criteria: {
      match_type: matchType,
      match_value: matchValue,
      case_sensitive: caseSensitive
    },
    target_category: targetCategory,
    priority: priority,
    is_active: isActive
  };

  try {
    const isEditing = !!currentRuleEditId;
    const url = isEditing
      ? `${BACKEND_URL}/api/categorization/rules/${currentRuleEditId}`
      : `${BACKEND_URL}/api/categorization/rules`;
    const method = isEditing ? 'PUT' : 'POST';

    const response = await authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to save rule', 'error');
      return;
    }

    showStatus(isEditing ? 'Rule updated' : 'Rule created', 'success');
    cancelRuleEdit();
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to save rule: ${error.message}`, 'error');
  }
}

function editRule(ruleId) {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;

  currentRuleEditId = ruleId;
  document.getElementById('rule-name').value = rule.rule_name || '';
  document.getElementById('rule-match-type').value = rule.match_criteria?.match_type || 'merchant_contains';
  document.getElementById('rule-match-value').value = rule.match_criteria?.match_value || '';
  document.getElementById('rule-target-category').value = rule.target_category || '';
  document.getElementById('rule-priority').value = rule.priority || 0;
  document.getElementById('rule-case-sensitive').checked = !!rule.match_criteria?.case_sensitive;
  document.getElementById('rule-active').checked = !!rule.is_active;
  document.getElementById('rule-save-btn').textContent = 'Update Rule';
  document.getElementById('rule-cancel-btn').classList.remove('hidden');
}

function cancelRuleEdit() {
  currentRuleEditId = null;
  document.getElementById('rule-name').value = '';
  document.getElementById('rule-match-value').value = '';
  document.getElementById('rule-priority').value = 0;
  document.getElementById('rule-case-sensitive').checked = false;
  document.getElementById('rule-active').checked = true;
  document.getElementById('rule-save-btn').textContent = 'Create Rule';
  document.getElementById('rule-cancel-btn').classList.add('hidden');
}

async function adjustRulePriority(ruleId, direction) {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;
  const delta = direction === 'up' ? 1 : -1;
  const newPriority = (rule.priority || 0) + delta;

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: newPriority })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to update priority', 'error');
      return;
    }
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to update priority: ${error.message}`, 'error');
  }
}

function confirmDeleteRule(ruleId) {
  openModal({
    title: 'Delete Rule',
    body: '<p>Delete this rule permanently?</p>',
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Delete', onClick: () => deleteRule(ruleId) }
    ]
  });
}

async function deleteRule(ruleId) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${ruleId}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to delete rule', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to delete rule: ${error.message}`, 'error');
  }
}

function renderMigrationSelectors() {
  const mergeList = document.getElementById('merge-source-list');
  if (mergeList) {
    mergeList.innerHTML = availableCategories
      .map(cat => `
        <label class="merge-item">
          <input type="checkbox" value="${escapeHtml(cat)}">
          <span>${escapeHtml(cat)}</span>
        </label>
      `)
      .join('');
  }
  const splitRows = document.getElementById('split-rows');
  if (splitRows && splitRows.children.length === 0) {
    addSplitRow();
  }
}

function addSplitRow() {
  const container = document.getElementById('split-rows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'split-row';
  row.innerHTML = `
    <input type="text" placeholder="Plaid categories (comma separated)">
    <input type="text" placeholder="Target category">
    <button class="secondary" type="button">Remove</button>
  `;
  row.querySelector('button').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function confirmRename() {
  const oldName = document.getElementById('rename-old').value.trim();
  const newName = document.getElementById('rename-new').value.trim();
  if (!oldName || !newName) {
    showStatus('Enter both old and new category names', 'warning');
    return;
  }
  openModal({
    title: 'Confirm Rename',
    body: `<p>Rename <strong>${escapeHtml(oldName)}</strong> to <strong>${escapeHtml(newName)}</strong>?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Rename', onClick: () => renameCategory(oldName, newName) }
    ]
  });
}

async function renameCategory(oldName, newName) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_name: oldName, new_name: newName })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to rename category', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to rename category: ${error.message}`, 'error');
  }
}

function confirmMerge() {
  const sourceChecks = document.querySelectorAll('#merge-source-list input[type="checkbox"]:checked');
  const sourceCategories = Array.from(sourceChecks).map(c => c.value);
  const targetCategory = document.getElementById('merge-target').value;

  if (!sourceCategories.length || !targetCategory) {
    showStatus('Select source categories and a target category', 'warning');
    return;
  }

  openModal({
    title: 'Confirm Merge',
    body: `<p>Merge ${escapeHtml(sourceCategories.join(', '))} into <strong>${escapeHtml(targetCategory)}</strong>?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Merge', onClick: () => mergeCategories(sourceCategories, targetCategory) }
    ]
  });
}

async function mergeCategories(sourceCategories, targetCategory) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_categories: sourceCategories, target_category: targetCategory })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to merge categories', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to merge categories: ${error.message}`, 'error');
  }
}

function confirmSplit() {
  const oldCategory = document.getElementById('split-old').value;
  const splitRows = document.querySelectorAll('#split-rows .split-row');
  const splits = [];

  splitRows.forEach(row => {
    const plaidRaw = row.querySelector('input:nth-child(1)').value.trim();
    const target = row.querySelector('input:nth-child(2)').value.trim();
    if (!plaidRaw || !target) return;
    const plaidCategories = plaidRaw.split(',').map(v => v.trim()).filter(Boolean);
    if (plaidCategories.length) {
      splits.push({ plaid_categories: plaidCategories, target });
    }
  });

  if (!oldCategory || splits.length === 0) {
    showStatus('Provide a category to split and at least one split row', 'warning');
    return;
  }

  openModal({
    title: 'Confirm Split',
    body: `<p>Split <strong>${escapeHtml(oldCategory)}</strong> into ${splits.length} categories?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Split', onClick: () => splitCategory(oldCategory, splits) }
    ]
  });
}

async function splitCategory(oldCategory, splits) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_category: oldCategory, splits })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to split category', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to split category: ${error.message}`, 'error');
  }
}

function confirmDeleteCategory(categoryName) {
  openModal({
    title: 'Delete Category',
    body: `
      <p>Archive or delete <strong>${escapeHtml(categoryName)}</strong>?</p>
      <div style="margin-top: 8px;">
        <label class="inline-checkbox"><input type="radio" name="delete-action" value="archive" checked> Archive (recommended)</label>
        <label class="inline-checkbox"><input type="radio" name="delete-action" value="delete"> Delete permanently</label>
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Confirm', onClick: () => deleteCategory(categoryName) }
    ]
  });
}

async function deleteCategory(categoryName) {
  try {
    const actionEl = document.querySelector('input[name="delete-action"]:checked');
    const action = actionEl ? actionEl.value : 'archive';
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/${encodeURIComponent(categoryName)}?action=${action}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to delete category', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to delete category: ${error.message}`, 'error');
  }
}

function renderMigrationLog() {
  const container = document.getElementById('audit-log');
  if (!migrationLog.length) {
    container.innerHTML = '<div class="empty-state">No migrations recorded yet.</div>';
    return;
  }

  const rows = migrationLog
    .map(log => {
      const when = new Date(log.created_at).toLocaleString();
      const changes = JSON.stringify(log.changes || {});
      const stats = log.stats ? JSON.stringify(log.stats) : '';
      return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td>${escapeHtml(log.migration_type || '')}</td>
          <td>${escapeHtml(changes)}</td>
          <td>${escapeHtml(stats)}</td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Changes</th>
          <th>Stats</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function refreshMigrationLog() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/migration-log`);
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to refresh audit log', 'error');
      return;
    }
    migrationLog = data.migrations || [];
    renderMigrationLog();
  } catch (error) {
    showStatus(`Failed to refresh audit log: ${error.message}`, 'error');
  }
}

function openCategorizeModal(txn, selectedCategory, accountId, txnId) {
  const merchant = txn?.merchant_name || txn?.name || '';
  const categoryOptions = buildCategoryOptions(selectedCategory);
  const defaultRuleName = `${selectedCategory} - ${merchant}`.trim();
  const defaultMatchValue = merchant || txn?.name || '';

  openModal({
    title: 'Categorize Transaction',
    body: `
      <div>
        <p><strong>${escapeHtml(txn?.name || 'Transaction')}</strong></p>
        <p class="pill">${escapeHtml(txn?.date || '')}</p>
      </div>
      <div style="margin-top: 12px;">
        <label>Category</label>
        <select id="modal-category-select" class="table-inline-select">${categoryOptions}</select>
      </div>
      <div style="margin-top: 12px;">
        <label class="inline-checkbox"><input id="modal-save-rule" type="checkbox"> Save as rule for future transactions</label>
      </div>
      <div id="modal-rule-fields" style="margin-top: 8px; display: none;">
        <input id="modal-rule-name" type="text" placeholder="Rule name" value="${escapeHtml(defaultRuleName)}">
        <select id="modal-rule-match-type">
          <option value="merchant_contains">Merchant contains</option>
          <option value="name_contains">Name contains</option>
          <option value="description_contains">Description contains</option>
          <option value="category_equals">Category equals</option>
        </select>
        <input id="modal-rule-match-value" type="text" placeholder="Match value" value="${escapeHtml(defaultMatchValue)}">
        <label class="inline-checkbox"><input id="modal-rule-case" type="checkbox"> Case sensitive</label>
        <input id="modal-rule-priority" type="number" value="0" placeholder="Priority">
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Save', onClick: () => applyManualCategory(txnId, accountId) }
    ]
  });

  const saveRuleCheckbox = document.getElementById('modal-save-rule');
  if (saveRuleCheckbox) {
    saveRuleCheckbox.addEventListener('change', () => {
      const fields = document.getElementById('modal-rule-fields');
      fields.style.display = saveRuleCheckbox.checked ? 'grid' : 'none';
    });
  }
}

async function applyManualCategory(txnId, accountId) {
  const selectedCategory = document.getElementById('modal-category-select').value;
  const saveRule = document.getElementById('modal-save-rule').checked;

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_category: selectedCategory, plaid_account_id: accountId })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to categorize transaction', 'error');
      return;
    }

    if (saveRule) {
      await createRuleFromModal(selectedCategory);
    }

    closeModal();
    showStatus('Transaction categorized', 'success');
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to categorize transaction: ${error.message}`, 'error');
  }
}

async function createRuleFromModal(targetCategory) {
  const ruleName = document.getElementById('modal-rule-name').value.trim();
  const matchType = document.getElementById('modal-rule-match-type').value;
  const matchValue = document.getElementById('modal-rule-match-value').value.trim();
  const caseSensitive = document.getElementById('modal-rule-case').checked;
  const priority = parseInt(document.getElementById('modal-rule-priority').value || '0', 10);

  if (!ruleName || !matchValue) {
    showStatus('Rule name and match value are required', 'warning');
    return;
  }

  const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rule_name: ruleName,
      match_criteria: {
        match_type: matchType,
        match_value: matchValue,
        case_sensitive: caseSensitive
      },
      target_category: targetCategory,
      priority
    })
  });

  const data = await response.json();
  if (!response.ok) {
    showStatus(data.error || 'Failed to create rule', 'error');
  }
}

function openModal({ title, body, actions }) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const actionsEl = document.getElementById('modal-actions');

  titleEl.textContent = title;
  bodyEl.innerHTML = body;
  actionsEl.innerHTML = '';

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    if (action.className) btn.className = action.className;
    btn.addEventListener('click', action.onClick);
    actionsEl.appendChild(btn);
  });

  overlay.classList.remove('hidden');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
}

function buildCategoryOptions(selected) {
  const unique = new Set(availableCategories || []);
  if (selected) unique.add(selected);
  const list = Array.from(unique).sort((a, b) => a.localeCompare(b));
  return list
    .map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
    .join('');
}

function formatPlaidCategory(value) {
  return (value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
