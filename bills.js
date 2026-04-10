// ============================================================
// bills.js — Full CRUD logic for the Bills management page.
//
// Loaded after config.js (provides BACKEND_URL, authenticatedFetch
// pattern). This file is self-contained: auth, API calls, DOM
// rendering, modal logic, and frequency form generation.
// ============================================================

// ── Auth State ──────────────────────────────────────────────
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (_) { currentUser = null; }

const IDLE_TIMEOUT = 15 * 60 * 1000;
let idleTimeout = null;

// ── App State ───────────────────────────────────────────────
let allBills = [];
let allAccounts = [];
let allCategories = [];
let editingBillId = null; // null = creating, string = editing

// ── Sort State (persisted to localStorage) ──────────────────
let currentSortColumn = localStorage.getItem('bills_sort_column') || 'next_payment';
let currentSortAscending = localStorage.getItem('bills_sort_asc') !== 'false';

/**
 * Invalidate the transactions cache so the next visit
 * to the transactions page forces a fresh fetch from the server.
 * Why: bill create/update/delete changes the scheduled transactions
 * that the backend generates, but the frontend cache is unaware.
 * Uses raw IndexedDB API since this page doesn't load the worker.
 */
function _invalidateTransactionCache() {
  try {
    var req = indexedDB.open('PersonalFinanceDB');
    req.onsuccess = function(e) {
      var db = e.target.result;
      // Mark cache as stale instead of nuking 100k+ rows.
      // The transactions page will force a network refetch and
      // atomically replace the data via replaceAll.
      if (db.objectStoreNames.contains('meta')) {
        var txn = db.transaction(['meta'], 'readwrite');
        var store = txn.objectStore('meta');
        store.put({ key: 'etag', value: null });
        store.put({ key: 'cached_at', value: 0 });
      }
      db.close();
    };
  } catch (e) { /* non-fatal */ }
}

// ── Auth helpers (same pattern as other pages) ──────────────

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
      token = data.access_token;
      localStorage.setItem('authToken', token);
      if (data.refresh_token) {
        refreshToken = data.refresh_token;
        localStorage.setItem('refreshToken', refreshToken);
      }
      resetIdleTimeout();
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function authenticatedFetch(url, options = {}) {
  const headers = { 'Authorization': `Bearer ${token}`, 'ngrok-skip-browser-warning': 'true', ...options.headers };
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
  if (window.LOCAL_AUTO_LOGIN_ENABLED) return;
  if (idleTimeout) clearTimeout(idleTimeout);
  if (token && currentUser) {
    idleTimeout = setTimeout(() => {
      localStorage.removeItem('authToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('currentUser');
      alert('You have been logged out due to inactivity.');
      window.location.href = 'index.html';
    }, IDLE_TIMEOUT);
  }
}

function setupActivityListeners() {
  if (window.LOCAL_AUTO_LOGIN_ENABLED) return;
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(eventName => {
    document.addEventListener(eventName, resetIdleTimeout, true);
  });
}

// ── Status helpers ──────────────────────────────────────────

function showStatus(message, type = 'info') {
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = message;
  statusBar.className = `status-bar ${type}`;
  statusBar.classList.remove('hidden');
}

function clearStatus() {
  const statusBar = document.getElementById('status-bar');
  statusBar.classList.add('hidden');
}

// ── Utility ─────────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

// formatDate() is provided by the shared date-helpers.js

/** Ordinal suffix: 1→1st, 2→2nd, 3→3rd, 11→11th, etc. */
function _ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_ABBREV = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const FREQUENCY_LABELS = {
  once: 'One-time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  twice_monthly: '2×/Month',
  yearly: 'Yearly',
  twice_yearly: '2×/Year'
};

// ── API Calls ───────────────────────────────────────────────

async function fetchBills() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/?upcoming=10`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch bills');
  }
  const data = await response.json();
  return data.bills || [];
}

async function fetchAccounts() {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/banks?include_archived=false`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to fetch accounts');
  }
  const data = await response.json();
  // Flatten banks → accounts with display names
  const flatAccounts = [];
  (data.banks || []).forEach(bank => {
    const bankName = bank.bank_name || bank.custom_name || bank.institution_id || 'Bank';
    (bank.accounts || []).forEach(account => {
      flatAccounts.push({
        account_id: account.account_id,
        display_name: `${bankName} - ${account.custom_name || account.account_name || 'Account'} (${account.mask || '****'})`,
        bank_name: bankName
      });
    });
  });
  return flatAccounts;
}

async function apiCreateBill(billData) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billData)
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to create bill');
  }
  return response.json();
}

async function apiUpdateBill(billId, billData) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/${billId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(billData)
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update bill');
  }
  return response.json();
}

async function apiDeleteBill(billId) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/${billId}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to delete bill');
  }
  return response.json();
}

async function apiToggleBill(billId) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/${billId}/toggle`, {
    method: 'PATCH'
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to toggle bill');
  }
  return response.json();
}

// ── Dashboard ───────────────────────────────────────────────

const MONTHLY_MULTIPLIERS = {
  daily: 30.44,
  weekly: 4.33,
  twice_monthly: 1,
  monthly: 1,
  twice_yearly: null,
  yearly: null,
  once: null
};

function _isRegularFrequency(frequency) {
  return MONTHLY_MULTIPLIERS[frequency] !== null && MONTHLY_MULTIPLIERS[frequency] !== undefined;
}

function _toMonthlyAmount(amount, frequency, interval) {
  const multiplier = MONTHLY_MULTIPLIERS[frequency];
  if (multiplier == null) return 0;
  const effectiveInterval = interval || 1;
  return (amount * multiplier) / effectiveInterval;
}

function _formatShortDate(isoDate) {
  const parts = isoDate.split('-');
  const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dayNames[dateObj.getDay()]} ${monthNames[dateObj.getMonth()]} ${dateObj.getDate()}`;
}

function renderDashboard() {
  const container = document.getElementById('bills-dashboard');
  if (!container) return;

  const activeBills = allBills.filter(bill => bill.is_active);

  if (activeBills.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  _renderMonthlySummary(activeBills);
  _renderTwoWeekOutlook(activeBills);
}

function _renderMonthlySummary(activeBills) {
  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  let monthlyTransfers = 0;

  activeBills.forEach(bill => {
    if (!_isRegularFrequency(bill.frequency)) return;

    const monthlyAmount = _toMonthlyAmount(Math.abs(bill.amount), bill.frequency, bill.interval);
    const isTransfer = !!bill.transfer_account_id;

    if (isTransfer) {
      monthlyTransfers += monthlyAmount;
    } else if (bill.amount < 0) {
      monthlyExpenses += monthlyAmount;
    } else {
      monthlyIncome += monthlyAmount;
    }
  });

  const net = monthlyIncome - monthlyExpenses;

  document.getElementById('dash-monthly-income').textContent = formatCurrency(monthlyIncome);
  document.getElementById('dash-monthly-expenses').textContent = formatCurrency(monthlyExpenses);
  document.getElementById('dash-monthly-transfers').textContent = formatCurrency(monthlyTransfers);

  const netElement = document.getElementById('dash-monthly-net');
  netElement.textContent = (net >= 0 ? '+' : '−') + formatCurrency(Math.abs(net));
  netElement.className = 'monthly-value ' + (net >= 0 ? 'positive' : 'negative');
}

function _renderTwoWeekOutlook(activeBills) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const twoWeeksOut = new Date(today);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  const todayIso = today.toISOString().slice(0, 10);
  const cutoffIso = twoWeeksOut.toISOString().slice(0, 10);

  const rangeElement = document.getElementById('dash-outlook-range');
  rangeElement.textContent = `${_formatShortDate(todayIso)} – ${_formatShortDate(cutoffIso)}`;

  const upcomingItems = [];

  activeBills.forEach(bill => {
    const occurrences = bill.upcoming_occurrences || [];
    occurrences.forEach(occ => {
      if (occ.date >= todayIso && occ.date <= cutoffIso) {
        const isTransfer = !!bill.transfer_account_id;
        const isIncome = bill.amount >= 0 && !isTransfer;
        const isVariableNonIncome = bill.amount_variable && !isIncome;

        upcomingItems.push({
          date: occ.date,
          description: bill.description,
          amount: bill.amount,
          isTransfer: isTransfer,
          isIncome: isIncome,
          amountVariable: bill.amount_variable,
          isVariableNonIncome: isVariableNonIncome,
          billId: bill.bill_id
        });
      }
    });
  });

  upcomingItems.sort((itemA, itemB) => {
    if (itemA.isVariableNonIncome !== itemB.isVariableNonIncome) {
      return itemA.isVariableNonIncome ? -1 : 1;
    }
    if (itemA.isIncome !== itemB.isIncome) {
      return itemA.isIncome ? 1 : -1;
    }
    return itemA.date.localeCompare(itemB.date);
  });

  const listElement = document.getElementById('dash-outlook-list');
  const emptyElement = document.getElementById('dash-outlook-empty');
  const footerElement = document.getElementById('dash-outlook-footer');

  if (upcomingItems.length === 0) {
    listElement.style.display = 'none';
    emptyElement.style.display = 'block';
    footerElement.innerHTML = '';
    return;
  }

  listElement.style.display = 'flex';
  emptyElement.style.display = 'none';

  listElement.innerHTML = upcomingItems.map(item => {
    const urgentClass = item.isVariableNonIncome ? ' urgent' : '';
    const isOut = item.amount < 0;
    const amountColor = item.isTransfer ? 'color:var(--color-info)'
      : isOut ? 'color:var(--color-negative)'
      : 'color:var(--color-positive)';
    const amountPrefix = isOut ? '−' : '+';
    const variableTag = item.amountVariable
      ? '<span class="outlook-variable-tag">variable</span>'
      : '';

    return `<div class="outlook-item${urgentClass}">
      <span class="outlook-date">${_formatShortDate(item.date)}</span>
      <span class="outlook-desc">${escapeHtml(item.description)}</span>
      ${variableTag}
      <span class="outlook-amount" style="${amountColor}">${amountPrefix}${formatCurrency(item.amount)}</span>
    </div>`;
  }).join('');

  const totalExpenses = upcomingItems
    .filter(item => !item.isIncome && !item.isTransfer)
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const totalIncome = upcomingItems
    .filter(item => item.isIncome)
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const variableCount = upcomingItems.filter(item => item.isVariableNonIncome).length;

  let footerHtml = `<span>Expenses: <strong style="color:var(--color-negative)">−${formatCurrency(totalExpenses)}</strong></span>`;
  footerHtml += `<span>Income: <strong style="color:var(--color-positive)">+${formatCurrency(totalIncome)}</strong></span>`;
  if (variableCount > 0) {
    footerHtml += `<span style="color:var(--accent-orange)">${variableCount} variable bill${variableCount > 1 ? 's' : ''} — amounts may change</span>`;
  }
  footerElement.innerHTML = footerHtml;
}

// ── Render Bills Table ──────────────────────────────────────

function _getFilteredBills() {
  const searchTerm = (document.getElementById('bills-search-input')?.value || '').trim().toLowerCase();
  const accountFilter = document.getElementById('bills-filter-account')?.value || '';
  const frequencyFilter = document.getElementById('bills-filter-frequency')?.value || '';
  const statusFilter = document.getElementById('bills-filter-status')?.value || '';
  const directionFilter = document.getElementById('bills-filter-direction')?.value || '';

  return allBills.filter(bill => {
    if (searchTerm) {
      const descMatch = (bill.description || '').toLowerCase().includes(searchTerm);
      const memoMatch = (bill.memo || '').toLowerCase().includes(searchTerm);
      if (!descMatch && !memoMatch) return false;
    }
    if (accountFilter && bill.account_id !== accountFilter) return false;
    if (frequencyFilter && bill.frequency !== frequencyFilter) return false;
    if (statusFilter === 'active' && !bill.is_active) return false;
    if (statusFilter === 'paused' && bill.is_active) return false;
    if (directionFilter === 'transfer' && !bill.transfer_account_id) return false;
    if (directionFilter === 'expense' && (bill.amount >= 0 || bill.transfer_account_id)) return false;
    if (directionFilter === 'income' && (bill.amount < 0 || bill.transfer_account_id)) return false;
    return true;
  });
}

const FREQUENCY_SORT_ORDER = {
  daily: 0, weekly: 1, twice_monthly: 2, monthly: 3,
  twice_yearly: 4, yearly: 5, once: 6
};

function _sortBills(bills) {
  const direction = currentSortAscending ? 1 : -1;

  return [...bills].sort((billA, billB) => {
    let comparison = 0;

    switch (currentSortColumn) {
      case 'next_payment': {
        const dateA = billA.upcoming_occurrences?.[0]?.date || '9999-12-31';
        const dateB = billB.upcoming_occurrences?.[0]?.date || '9999-12-31';
        comparison = dateA.localeCompare(dateB);
        break;
      }
      case 'direction': {
        const dirA = billA.amount < 0 ? 0 : 1;
        const dirB = billB.amount < 0 ? 0 : 1;
        comparison = dirA - dirB;
        break;
      }
      case 'description':
        comparison = (billA.description || '').localeCompare(billB.description || '');
        break;
      case 'amount':
        comparison = Math.abs(billA.amount) - Math.abs(billB.amount);
        break;
      case 'frequency': {
        const orderA = FREQUENCY_SORT_ORDER[billA.frequency] ?? 99;
        const orderB = FREQUENCY_SORT_ORDER[billB.frequency] ?? 99;
        comparison = orderA - orderB;
        break;
      }
      case 'account':
        comparison = (billA.account_name || '').localeCompare(billB.account_name || '');
        break;
      case 'category':
        comparison = (billA.user_category || '').localeCompare(billB.user_category || '');
        break;
      default: {
        const dateA = billA.upcoming_occurrences?.[0]?.date || '9999-12-31';
        const dateB = billB.upcoming_occurrences?.[0]?.date || '9999-12-31';
        comparison = dateA.localeCompare(dateB);
      }
    }

    return comparison * direction;
  });
}

function _updateSortIndicators() {
  const headers = document.querySelectorAll('#bills-table th.sortable');
  headers.forEach(header => {
    const indicator = header.querySelector('.sort-indicator');
    const column = header.dataset.sort;
    if (column === currentSortColumn) {
      header.classList.add('sort-active');
      indicator.textContent = currentSortAscending ? ' ▲' : ' ▼';
    } else {
      header.classList.remove('sort-active');
      indicator.textContent = '';
    }
  });
}

function _onSortHeaderClick(event) {
  const header = event.currentTarget;
  const column = header.dataset.sort;
  if (column === currentSortColumn) {
    currentSortAscending = !currentSortAscending;
  } else {
    currentSortColumn = column;
    currentSortAscending = true;
  }
  localStorage.setItem('bills_sort_column', currentSortColumn);
  localStorage.setItem('bills_sort_asc', String(currentSortAscending));
  renderBillsTable();
}

function _populateAccountFilter() {
  const select = document.getElementById('bills-filter-account');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">All Accounts</option>';
  const accountIdsWithBills = new Set(allBills.map(bill => bill.account_id));
  allAccounts
    .filter(account => accountIdsWithBills.has(account.account_id))
    .forEach(account => {
      const option = document.createElement('option');
      option.value = account.account_id;
      option.textContent = account.display_name;
      select.appendChild(option);
    });
  select.value = currentValue;
}

function clearBillsSearch() {
  const input = document.getElementById('bills-search-input');
  if (input) input.value = '';
  document.getElementById('bills-search-clear').style.display = 'none';
  renderBillsTable();
}

function _wireUpBillFilters() {
  const searchInput = document.getElementById('bills-search-input');
  const clearBtn = document.getElementById('bills-search-clear');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearBtn.style.display = searchInput.value ? 'flex' : 'none';
      renderBillsTable();
    });
  }

  ['bills-filter-account', 'bills-filter-frequency', 'bills-filter-status', 'bills-filter-direction', 'bills-group-by'].forEach(filterId => {
    const element = document.getElementById(filterId);
    if (element) element.addEventListener('change', () => renderBillsTable());
  });

  document.querySelectorAll('#bills-table th.sortable').forEach(header => {
    header.addEventListener('click', _onSortHeaderClick);
  });
}

function _renderBillRow(bill) {
  const nextOcc = bill.upcoming_occurrences?.[0];
  const nextDate = nextOcc ? formatDate(nextOcc.date) : (bill.is_active ? 'No upcoming' : 'Paused');
  const isTransfer = !!bill.transfer_account_id;
  const isOut = bill.amount < 0;
  const dirBadge = isTransfer
    ? '<span class="dir-badge transfer">XFER</span>'
    : isOut
      ? '<span class="dir-badge out">OUT</span>'
      : '<span class="dir-badge in">IN</span>';
  const amountClass = isOut ? 'amount-out' : 'amount-in';
  const amountDisplay = (isOut ? '−' : '+') + formatCurrency(bill.amount);
  const freqLabel = FREQUENCY_LABELS[bill.frequency] || bill.frequency;
  const intervalNote = bill.interval > 1 ? ` (every ${bill.interval})` : '';
  const variableNote = bill.amount_variable ? ' <span title="Amount varies" style="color:#e67e22;font-weight:600;">~</span>' : '';
  const autoPayNote = bill.auto_pay ? ' <span title="Auto-pay enabled" class="auto-pay-badge">AUTO</span>' : '';
  const accountName = escapeHtml(bill.account_name || bill.account_id);
  const category = escapeHtml(bill.user_category || '');
  const destAccount = bill.transfer_account_name ? escapeHtml(bill.transfer_account_name) : '';
  const rowClass = bill.is_active ? '' : 'bill-inactive';
  const toggleLabel = bill.is_active ? 'Pause' : 'Resume';

  return `<tr class="${rowClass}">
    <td>${nextDate}</td>
    <td>${dirBadge}</td>
    <td>${escapeHtml(bill.description)}${variableNote}${autoPayNote}</td>
    <td class="${amountClass}">${amountDisplay}</td>
    <td>${freqLabel}${intervalNote}</td>
    <td style="font-size:12px;">${accountName}</td>
    <td style="font-size:12px;">${category}</td>
    <td style="font-size:12px;">${destAccount}</td>
    <td style="white-space:nowrap;">
      <button class="bill-action-btn" onclick="openBillModal('${bill.bill_id}')" title="Edit">✏️</button>
      <button class="bill-action-btn toggle-active" onclick="toggleBill('${bill.bill_id}')" title="${toggleLabel}">${bill.is_active ? '⏸' : '▶️'}</button>
      <button class="bill-action-btn delete" onclick="deleteBill('${bill.bill_id}')" title="Delete">🗑️</button>
    </td>
  </tr>`;
}

function _groupBills(bills, groupBy) {
  const groups = new Map();
  for (const bill of bills) {
    let key;
    switch (groupBy) {
      case 'auto_pay':
        key = bill.auto_pay ? 'Auto-pay' : 'Manual Pay';
        break;
      case 'category':
        key = bill.user_category || 'Uncategorized';
        break;
      case 'account':
        key = bill.account_name || bill.account_id || 'Unknown Account';
        break;
      case 'frequency':
        key = FREQUENCY_LABELS[bill.frequency] || bill.frequency;
        break;
      default:
        key = 'All';
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bill);
  }

  // Sort group keys: for auto_pay put Manual Pay first so users focus on it
  const sortedKeys = [...groups.keys()].sort((keyA, keyB) => {
    if (groupBy === 'auto_pay') {
      if (keyA === 'Manual Pay') return -1;
      if (keyB === 'Manual Pay') return 1;
    }
    if (groupBy === 'frequency') {
      const orderMap = { Daily: 0, Weekly: 1, '2×/Month': 2, Monthly: 3, '2×/Year': 4, Yearly: 5, 'One-time': 6 };
      return (orderMap[keyA] ?? 99) - (orderMap[keyB] ?? 99);
    }
    return keyA.localeCompare(keyB);
  });

  return sortedKeys.map(groupKey => ({
    name: groupKey,
    bills: groups.get(groupKey),
  }));
}

function _getCollapsedGroups() {
  try {
    return JSON.parse(localStorage.getItem('bills_collapsed_groups') || '{}');
  } catch (_parseError) {
    return {};
  }
}

function _toggleGroupCollapse(groupKey) {
  const collapsed = _getCollapsedGroups();
  collapsed[groupKey] = !collapsed[groupKey];
  localStorage.setItem('bills_collapsed_groups', JSON.stringify(collapsed));
  renderBillsTable();
}

// Expose for inline onclick
window._toggleGroupCollapse = _toggleGroupCollapse;

function renderBillsTable() {
  const loading = document.getElementById('bills-loading');
  const emptyState = document.getElementById('bills-empty');
  const table = document.getElementById('bills-table');
  const tbody = document.getElementById('bills-tbody');
  const countSpan = document.getElementById('bill-count');

  loading.style.display = 'none';

  if (allBills.length === 0) {
    emptyState.style.display = 'block';
    table.style.display = 'none';
    countSpan.textContent = '';
    return;
  }

  const filtered = _getFilteredBills();
  const sorted = _sortBills(filtered);

  const activeBills = allBills.filter(bill => bill.is_active).length;
  const totalCount = allBills.length;
  const shownCount = filtered.length;
  const filterActive = shownCount < totalCount;
  countSpan.textContent = filterActive
    ? `Showing ${shownCount} of ${totalCount} bill${totalCount !== 1 ? 's' : ''} (${activeBills} active)`
    : `${totalCount} bill${totalCount !== 1 ? 's' : ''} (${activeBills} active)`;

  if (sorted.length === 0) {
    emptyState.style.display = 'block';
    emptyState.innerHTML = '<p>No bills match current filters.</p>';
    table.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  table.style.display = 'table';

  _updateSortIndicators();

  const groupBy = document.getElementById('bills-group-by')?.value || '';

  if (!groupBy) {
    tbody.innerHTML = sorted.map(_renderBillRow).join('');
  } else {
    const groups = _groupBills(sorted, groupBy);
    const collapsed = _getCollapsedGroups();
    const columnCount = table.querySelector('thead tr')?.children.length || 9;

    tbody.innerHTML = groups.map(group => {
      const isCollapsed = !!collapsed[group.name];
      const totalAmount = group.bills.reduce((sum, bill) => sum + bill.amount, 0);
      const amountClass = totalAmount < 0 ? 'amount-out' : 'amount-in';
      const amountSign = totalAmount < 0 ? '−' : '+';
      const chevron = isCollapsed ? '▶' : '▼';

      const headerRow = `<tr class="group-header-row" onclick="_toggleGroupCollapse('${escapeHtml(group.name)}')">
        <td colspan="${columnCount}">
          <span class="group-chevron">${chevron}</span>
          <span class="group-name">${escapeHtml(group.name)}</span>
          <span class="group-meta">${group.bills.length} bill${group.bills.length !== 1 ? 's' : ''}</span>
          <span class="group-total ${amountClass}">${amountSign}${formatCurrency(totalAmount)}</span>
        </td>
      </tr>`;

      if (isCollapsed) return headerRow;
      return headerRow + group.bills.map(_renderBillRow).join('');
    }).join('');
  }
}

// ── Bill Actions ────────────────────────────────────────────

async function toggleBill(billId) {
  try {
    await apiToggleBill(billId);
    _invalidateTransactionCache();
    showStatus('Bill updated', 'success');
    await reloadBills();
    setTimeout(clearStatus, 2000);
  } catch (toggleError) {
    showStatus(`Failed to toggle bill: ${toggleError.message}`, 'error');
  }
}

async function deleteBill(billId) {
  const bill = allBills.find(findBill => findBill.bill_id === billId);
  const label = bill ? bill.description : billId;
  if (!confirm(`Delete bill "${label}"? This cannot be undone.`)) return;
  try {
    await apiDeleteBill(billId);
    _invalidateTransactionCache();
    showStatus('Bill deleted', 'success');
    await reloadBills();
    setTimeout(clearStatus, 2000);
  } catch (deleteError) {
    showStatus(`Failed to delete bill: ${deleteError.message}`, 'error');
  }
}

async function reloadBills() {
  allBills = await fetchBills();
  renderDashboard();
  renderBillsTable();
}

// ══════════════════════════════════════════════════════════════
// MODAL LOGIC — Create / Edit
// ══════════════════════════════════════════════════════════════

function openBillModal(billId = null) {
  editingBillId = billId || null;
  const titleEl = document.getElementById('bill-modal-title');
  const submitBtn = document.getElementById('bill-submit-btn');

  if (editingBillId) {
    titleEl.textContent = 'Edit Bill';
    submitBtn.textContent = 'Save Changes';
  } else {
    titleEl.textContent = 'New Bill';
    submitBtn.textContent = 'Create Bill';
  }

  // Reset error banner
  const banner = document.getElementById('bill-error-banner');
  banner.style.display = 'none';

  // Populate account dropdown
  _populateAccountDropdown();

  if (editingBillId) {
    const bill = allBills.find(findBill => findBill.bill_id === editingBillId);
    if (bill) _populateFormFromBill(bill);
  } else {
    _resetForm();
  }

  // Show modal
  document.getElementById('bill-modal-overlay').classList.remove('hidden');

  // Wire up category autocomplete
  _wireUpBillCategoryAutocomplete();

  // Render frequency options for the current selection
  onFrequencyChange();

  // Wire up amount type sync
  setTimeout(() => {
    const amountInput = document.getElementById('bill-amount');
    const typeSelect = document.getElementById('bill-type');
    if (amountInput && typeSelect) {
      amountInput.addEventListener('input', () => _syncAmountPrefix(amountInput, typeSelect));
      typeSelect.addEventListener('change', () => _syncTypeDropdown(amountInput, typeSelect));
      amountInput.addEventListener('blur', () => _decorateAmountOnBlur(amountInput, typeSelect));
      amountInput.addEventListener('focus', () => _stripDecorationOnFocus(amountInput, typeSelect));
    }
  }, 50);

  // Auto-update preview when fields change
  setTimeout(_wireUpLivePreview, 80);

  // Wire segmented input on the end-date field (persists across frequency changes)
  setTimeout(() => {
    const endDateInput = document.getElementById('bill-end-date');
    if (endDateInput) autoFormatDateInput(endDateInput);
  }, 90);
}

function closeBillModal() {
  document.getElementById('bill-modal-overlay').classList.add('hidden');
  editingBillId = null;
}

function _populateAccountDropdown() {
  const select = document.getElementById('bill-account');
  let optionsHtml = '<option value="">— Select Account —</option>';
  allAccounts.forEach(account => {
    optionsHtml += `<option value="${escapeHtml(account.account_id)}">${escapeHtml(account.display_name)}</option>`;
  });
  select.innerHTML = optionsHtml;
}

function _resetForm() {
  document.getElementById('bill-frequency').value = 'monthly';
  document.getElementById('bill-end-type').value = 'never';
  document.getElementById('bill-account').value = '';
  document.getElementById('bill-description').value = '';
  document.getElementById('bill-amount').value = '';
  document.getElementById('bill-type').value = 'debit';
  document.getElementById('bill-amount-variable').checked = false;
  document.getElementById('bill-auto-pay').checked = false;
  document.getElementById('bill-category').value = '';
  document.getElementById('bill-memo').value = '';
  document.getElementById('bill-match-description').value = '';
  document.getElementById('bill-end-date').value = '';
  document.getElementById('bill-end-date').dataset.isoValue = '';
  document.getElementById('bill-max-occurrences').value = '12';
  onEndTypeChange();
}

function _populateFormFromBill(bill) {
  document.getElementById('bill-frequency').value = bill.frequency;
  document.getElementById('bill-account').value = bill.account_id;
  document.getElementById('bill-description').value = bill.description || '';
  const isCredit = bill.amount >= 0;
  document.getElementById('bill-type').value = isCredit ? 'credit' : 'debit';
  document.getElementById('bill-amount').value = Math.abs(bill.amount).toFixed(2);
  document.getElementById('bill-amount-variable').checked = !!bill.amount_variable;
  document.getElementById('bill-auto-pay').checked = !!bill.auto_pay;
  document.getElementById('bill-category').value = bill.user_category || '';
  document.getElementById('bill-memo').value = bill.memo || '';
  document.getElementById('bill-match-description').value = bill.match_description || '';
  document.getElementById('bill-end-type').value = bill.end_type || 'never';
  onEndTypeChange();
  if (bill.end_type === 'on_date' && bill.end_date) {
    setDateInputValue('bill-end-date', bill.end_date);
  }
  if (bill.end_type === 'after_occurrences' && bill.max_occurrences) {
    document.getElementById('bill-max-occurrences').value = bill.max_occurrences;
  }

  // Frequency-specific fields are populated inside onFrequencyChange()
  // by storing them temporarily so the render can pick them up.
  window._billEditData = bill;
}

// ── Frequency Options Rendering ─────────────────────────────

function onFrequencyChange() {
  const frequency = document.getElementById('bill-frequency').value;
  const container = document.getElementById('freq-options');
  const endSection = document.getElementById('end-condition-section');

  // "Once" hides the end condition entirely
  endSection.style.display = frequency === 'once' ? 'none' : '';

  const editData = window._billEditData || null;

  // Default start date = today
  const today = _todayStr();
  let html = '';

  switch (frequency) {
    case 'once':
      html = _renderOnceOptions(editData, today);
      break;
    case 'daily':
      html = _renderDailyOptions(editData, today);
      break;
    case 'weekly':
      html = _renderWeeklyOptions(editData, today);
      break;
    case 'monthly':
      html = _renderMonthlyOptions(editData, today);
      break;
    case 'twice_monthly':
      html = _renderTwiceMonthlyOptions(editData, today);
      break;
    case 'yearly':
      html = _renderYearlyOptions(editData, today);
      break;
    case 'twice_yearly':
      html = _renderTwiceYearlyOptions(editData, today);
      break;
  }

  container.innerHTML = html;

  // If editing, populate frequency-specific fields from editData
  if (editData && editData.frequency === frequency) {
    _applyFreqFieldsFromEdit(frequency, editData);
  }

  // Clear edit data after first render so switching frequency doesn't re-apply
  // old values to an incompatible form
  if (editData && editData.frequency !== frequency) {
    window._billEditData = null;
  }

  // Wire segmented date inputs on freshly rendered fields
  container.querySelectorAll('input.date-input').forEach(autoFormatDateInput);
  container.querySelectorAll('input.month-year-input').forEach(autoFormatMonthYearInput);

  updatePreview();
}

// Delegates to todayISO() from date-helpers.js
function _todayStr() {
  return todayISO();
}

function _sixMonthsFromNow() {
  const date = new Date();
  date.setMonth(date.getMonth() + 6);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _renderOnceOptions(editData, today) {
  const startDate = editData?.start_date || today;
  return `
    <div class="bill-field">
      <label for="bill-start-date">Payment Date</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}" onchange="updatePreview()">
    </div>`;
}

function _renderDailyOptions(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  return `
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}" onchange="updatePreview()">
      <span>day(s)</span>
    </div>
    <div class="bill-field">
      <label for="bill-start-date">Starting</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}" onchange="updatePreview()">
    </div>`;
}

function _renderWeeklyOptions(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  // Determine active day-of-week from start_date
  const startDow = editData?.day_of_week ?? _dowFromDateStr(startDate);

  let dowButtons = '';
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const active = dayIndex === startDow ? 'active' : '';
    dowButtons += `<button type="button" class="dow-btn ${active}" data-dow="${dayIndex}" onclick="selectDayOfWeek(${dayIndex})">${DAY_ABBREV[dayIndex]}</button>`;
  }

  return `
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}" onchange="updatePreview()">
      <span>week(s)</span>
    </div>
    <div class="bill-field">
      <label for="bill-start-date">Starting</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}" onchange="onWeeklyStartDateChange(); updatePreview()">
    </div>
    <div class="bill-field">
      <label>Day of Week</label>
      <div class="dow-buttons" id="dow-buttons">${dowButtons}</div>
    </div>`;
}

function _renderMonthlyOptions(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  const dayOfMonth = editData?.day_of_month ?? parseInt(today.split('-')[2], 10);
  const dayOfWeek = editData?.day_of_week;

  let dayOptions = '';
  for (let dayNum = 1; dayNum <= 30; dayNum++) {
    const selected = dayNum === dayOfMonth ? 'selected' : '';
    dayOptions += `<option value="${dayNum}" ${selected}>${_ordinal(dayNum)}</option>`;
  }
  // "Last day" uses value 31; the backend clamps to the actual last day of each month
  const lastDaySelected = dayOfMonth === 31 ? 'selected' : '';
  dayOptions += `<option value="31" ${lastDaySelected}>Last day</option>`;
  // "Last weekday" enables a day-of-week dropdown for "last Friday of month" patterns
  const lastWeekdaySelected = dayOfMonth === -1 ? 'selected' : '';
  dayOptions += `<option value="-1" ${lastWeekdaySelected}>Last weekday\u2026</option>`;

  // Day-of-week dropdown for "last X of month" pattern
  let dowSelect = '<select id="bill-day-of-week" style="display:none;width:auto;" onchange="updatePreview()">';
  for (let dowIndex = 0; dowIndex < 7; dowIndex++) {
    const sel = dowIndex === dayOfWeek ? 'selected' : '';
    dowSelect += `<option value="${dowIndex}" ${sel}>${DAY_NAMES[dowIndex]}</option>`;
  }
  dowSelect += '</select>';

  return `
    <div class="bill-field">
      <label for="bill-start-date">Starting Month</label>
      <input type="text" id="bill-start-date" class="month-year-input" value="${startDate}" onchange="updatePreview()">
    </div>
    <div class="freq-inline-row">
      <span>On the</span>
      <select id="bill-day-of-month" onchange="onDayOfMonthChange(); updatePreview()" style="width:auto;">
        ${dayOptions}
      </select>
      ${dowSelect}
      <span>of the month</span>
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}" onchange="updatePreview()">
      <span>month(s)</span>
    </div>`;
}

function _renderTwiceMonthlyOptions(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  const dayOfMonth = editData?.day_of_month ?? 1;
  const secondDayOfMonth = editData?.second_day_of_month ?? 15;

  let dayOptions1 = '';
  let dayOptions2 = '';
  for (let dayNum = 1; dayNum <= 30; dayNum++) {
    dayOptions1 += `<option value="${dayNum}" ${dayNum === dayOfMonth ? 'selected' : ''}>${_ordinal(dayNum)}</option>`;
    dayOptions2 += `<option value="${dayNum}" ${dayNum === secondDayOfMonth ? 'selected' : ''}>${_ordinal(dayNum)}</option>`;
  }
  dayOptions1 += `<option value="31" ${31 === dayOfMonth ? 'selected' : ''}>Last day</option>`;
  dayOptions2 += `<option value="31" ${31 === secondDayOfMonth ? 'selected' : ''}>Last day</option>`;

  return `
    <div class="freq-inline-row">
      <span>On the</span>
      <select id="bill-day-of-month" style="width:auto;" onchange="updatePreview()">${dayOptions1}</select>
      <span>and</span>
      <select id="bill-second-day-of-month" style="width:auto;" onchange="updatePreview()">${dayOptions2}</select>
    </div>
    <div class="bill-field">
      <label for="bill-start-date">Starting Month</label>
      <input type="text" id="bill-start-date" class="month-year-input" value="${startDate}" onchange="updatePreview()">
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}" onchange="updatePreview()">
      <span>month(s)</span>
    </div>`;
}

function _renderYearlyOptions(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  return `
    <div class="bill-field">
      <label for="bill-start-date">Payment Date</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}" onchange="updatePreview()">
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}" onchange="updatePreview()">
      <span>year(s)</span>
    </div>`;
}

function _renderTwiceYearlyOptions(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  const secondDate = editData?.second_date || _sixMonthsFromNow();
  return `
    <div class="bill-field">
      <label for="bill-start-date">First Payment Date</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}" onchange="updatePreview()">
    </div>
    <div class="bill-field">
      <label for="bill-second-date">Second Payment Date</label>
      <input type="text" id="bill-second-date" class="date-input" value="${secondDate}" onchange="updatePreview()">
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}" onchange="updatePreview()">
      <span>year(s)</span>
    </div>`;
}

/** When editing, apply stored frequency-specific values into the freshly rendered form. */
function _applyFreqFieldsFromEdit(frequency, editData) {
  const startDateInput = document.getElementById('bill-start-date');
  if (startDateInput && editData.start_date) startDateInput.value = editData.start_date;

  const intervalInput = document.getElementById('bill-interval');
  if (intervalInput && editData.interval) intervalInput.value = editData.interval;

  if (frequency === 'weekly' && editData.day_of_week != null) {
    selectDayOfWeek(editData.day_of_week);
  }
  if ((frequency === 'monthly') && editData.day_of_month != null) {
    const domSelect = document.getElementById('bill-day-of-month');
    if (domSelect) domSelect.value = editData.day_of_month;
    onDayOfMonthChange();
  }
  if (frequency === 'twice_monthly') {
    const dom1 = document.getElementById('bill-day-of-month');
    const dom2 = document.getElementById('bill-second-day-of-month');
    if (dom1 && editData.day_of_month != null) dom1.value = editData.day_of_month;
    if (dom2 && editData.second_day_of_month != null) dom2.value = editData.second_day_of_month;
  }
  if (frequency === 'twice_yearly') {
    const secondDateInput = document.getElementById('bill-second-date');
    if (secondDateInput && editData.second_date) secondDateInput.value = editData.second_date;
  }
}

// ── Frequency Interaction Handlers ──────────────────────────

function selectDayOfWeek(dayIndex) {
  // Update button active states
  document.querySelectorAll('.dow-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`.dow-btn[data-dow="${dayIndex}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  // Snap start date to nearest occurrence of this day of week
  const startDateInput = document.getElementById('bill-start-date');
  if (startDateInput) {
    const currentValue = getDateInputValue(startDateInput);
    if (currentValue) {
      const currentDate = new Date(currentValue + 'T00:00:00');
      const currentDow = (currentDate.getDay() + 6) % 7; // JS Sun=0 → Mon=0 system
      let diff = dayIndex - currentDow;
      // Go to nearest (could be backward or forward)
      if (diff > 3) diff -= 7;
      if (diff < -3) diff += 7;
      currentDate.setDate(currentDate.getDate() + diff);
      setDateInputValue(startDateInput, _dateToStr(currentDate));
    }
  }

  updatePreview();
}

function onWeeklyStartDateChange() {
  const startDateInput = document.getElementById('bill-start-date');
  if (!startDateInput) return;
  const dateValue = getDateInputValue(startDateInput);
  if (!dateValue) return;
  const dow = _dowFromDateStr(dateValue);
  // Update active button
  document.querySelectorAll('.dow-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`.dow-btn[data-dow="${dow}"]`);
  if (activeBtn) activeBtn.classList.add('active');
}

function onDayOfMonthChange() {
  const domSelect = document.getElementById('bill-day-of-month');
  const dowSelect = document.getElementById('bill-day-of-week');
  if (!domSelect || !dowSelect) return;
  // Show day-of-week dropdown only when "Last" is selected
  dowSelect.style.display = domSelect.value === '-1' ? 'inline-block' : 'none';
}

function onEndTypeChange() {
  const endType = document.getElementById('bill-end-type').value;
  document.getElementById('end-date-input').style.display = endType === 'on_date' ? '' : 'none';
  document.getElementById('end-occurrences-input').style.display = endType === 'after_occurrences' ? '' : 'none';
}

function _dowFromDateStr(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return (date.getDay() + 6) % 7; // Convert JS Sun=0 to Mon=0 system
}

// Delegates to toISODateStr() from date-helpers.js
function _dateToStr(date) {
  return toISODateStr(date);
}

// ── Live Preview ────────────────────────────────────────────

function _wireUpLivePreview() {
  // Watch all inputs in the modal for changes and live-update preview
  const modal = document.getElementById('bill-modal-overlay');
  if (!modal) return;
  modal.querySelectorAll('input, select').forEach(input => {
    input.addEventListener('change', updatePreview);
    input.addEventListener('input', updatePreview);
  });
}

function updatePreview() {
  const summaryEl = document.getElementById('bill-preview-summary');
  const datesEl = document.getElementById('bill-preview-dates');

  const formData = _readFormData();
  if (!formData) {
    summaryEl.textContent = 'Select a frequency and fill in the details above to see a preview.';
    datesEl.innerHTML = '';
    return;
  }

  // Generate summary description
  const summary = _generateFrequencyDescription(formData);
  summaryEl.innerHTML = summary;

  // Generate next 10 dates client-side for preview
  const dates = _generatePreviewDates(formData, 10);
  if (dates.length === 0) {
    datesEl.innerHTML = '<div style="color: #999; font-size: 12px;">No upcoming dates to display.</div>';
    return;
  }

  const amountStr = formData.amount ? formatCurrency(formData.amount) : '—';
  const amountPrefix = formData.isCredit ? '+' : '−';

  datesEl.innerHTML = dates.map((dateStr, idx) => {
    const displayDate = formatDate(dateStr);
    return `<div class="preview-date-item">
      <span class="date-label">#${idx + 1} — ${displayDate}</span>
      <span class="date-amount">${amountPrefix}${amountStr}</span>
    </div>`;
  }).join('');
}

function _generateFrequencyDescription(formData) {
  const desc = formData.description || '<em>Untitled</em>';
  const amountStr = formData.amount ? formatCurrency(formData.amount) : '$0.00';
  const direction = formData.isCredit ? 'receive' : 'pay';
  const variable = formData.amount_variable ? ' <span style="color:#e67e22;">(amount varies)</span>' : '';
  let freqDesc = '';

  switch (formData.frequency) {
    case 'once':
      freqDesc = `One-time payment on ${formatDate(formData.start_date)}`;
      break;
    case 'daily':
      freqDesc = formData.interval === 1
        ? `Every day starting ${formatDate(formData.start_date)}`
        : `Every ${formData.interval} days starting ${formatDate(formData.start_date)}`;
      break;
    case 'weekly': {
      const dayName = DAY_NAMES[formData.day_of_week ?? 0];
      freqDesc = formData.interval === 1
        ? `Every ${dayName} starting ${formatDate(formData.start_date)}`
        : `Every ${formData.interval} weeks on ${dayName} starting ${formatDate(formData.start_date)}`;
      break;
    }
    case 'monthly': {
      const dayLabel = formData.day_of_month === -1
        ? `last ${DAY_NAMES[formData.day_of_week ?? 0]}`
        : formData.day_of_month === 31
          ? 'last day'
          : _ordinal(formData.day_of_month || 1);
      freqDesc = formData.interval === 1
        ? `Monthly on the ${dayLabel}`
        : `Every ${formData.interval} months on the ${dayLabel}`;
      break;
    }
    case 'twice_monthly': {
      const dom1Label = formData.day_of_month === 31 ? 'last day' : _ordinal(formData.day_of_month || 1);
      const dom2Label = formData.second_day_of_month === 31 ? 'last day' : _ordinal(formData.second_day_of_month || 15);
      freqDesc = `Twice monthly on the ${dom1Label} and ${dom2Label}`;
      if (formData.interval > 1) freqDesc += ` (every ${formData.interval} months)`;
      break;
    }
    case 'yearly':
      freqDesc = formData.interval === 1
        ? `Yearly on ${formatDate(formData.start_date)}`
        : `Every ${formData.interval} years on ${formatDate(formData.start_date)}`;
      break;
    case 'twice_yearly':
      freqDesc = `Twice a year: ${formatDate(formData.start_date)} and ${formatDate(formData.second_date)}`;
      if (formData.interval > 1) freqDesc += ` (every ${formData.interval} years)`;
      break;
  }

  let endDesc = '';
  if (formData.end_type === 'on_date' && formData.end_date) {
    endDesc = ` until ${formatDate(formData.end_date)}`;
  } else if (formData.end_type === 'after_occurrences' && formData.max_occurrences) {
    endDesc = ` for ${formData.max_occurrences} occurrences`;
  }

  return `<strong>${desc}</strong> — ${direction} ${amountStr}${variable}<br>${freqDesc}${endDesc}`;
}

/**
 * Client-side preview date generation.
 * Only used for the modal preview — the backend does the authoritative generation.
 */
function _generatePreviewDates(formData, count) {
  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = formData.start_date ? new Date(formData.start_date + 'T00:00:00') : today;
  const maxIterations = 500;
  let iterations = 0;

  if (formData.frequency === 'once') {
    dates.push(_dateToStr(startDate));
    return dates;
  }

  const interval = formData.interval || 1;
  const endDate = formData.end_type === 'on_date' && formData.end_date
    ? new Date(formData.end_date + 'T00:00:00') : null;
  const maxOcc = formData.end_type === 'after_occurrences' ? (formData.max_occurrences || 999) : 999;
  let occurrenceCount = 0;

  switch (formData.frequency) {
    case 'daily': {
      let cursor = new Date(startDate);
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        if (endDate && cursor > endDate) break;
        dates.push(_dateToStr(cursor));
        occurrenceCount++;
        cursor.setDate(cursor.getDate() + interval);
        iterations++;
      }
      break;
    }
    case 'weekly': {
      let cursor = new Date(startDate);
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        if (endDate && cursor > endDate) break;
        dates.push(_dateToStr(cursor));
        occurrenceCount++;
        cursor.setDate(cursor.getDate() + 7 * interval);
        iterations++;
      }
      break;
    }
    case 'monthly': {
      let monthCursor = startDate.getMonth();
      let yearCursor = startDate.getFullYear();
      const dom = formData.day_of_month || 1;
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        let occDate;
        if (dom === -1) {
          // Last day or last weekday-of-month
          if (formData.day_of_week != null) {
            occDate = _lastWeekdayOfMonth(yearCursor, monthCursor, formData.day_of_week);
          } else {
            occDate = new Date(yearCursor, monthCursor + 1, 0); // last day
          }
        } else {
          const lastDay = new Date(yearCursor, monthCursor + 1, 0).getDate();
          const clampedDay = Math.min(dom, lastDay);
          occDate = new Date(yearCursor, monthCursor, clampedDay);
        }
        if (endDate && occDate > endDate) break;
        dates.push(_dateToStr(occDate));
        occurrenceCount++;
        monthCursor += interval;
        while (monthCursor > 11) { monthCursor -= 12; yearCursor++; }
        iterations++;
      }
      break;
    }
    case 'twice_monthly': {
      let monthCursor = startDate.getMonth();
      let yearCursor = startDate.getFullYear();
      const dom1 = formData.day_of_month || 1;
      const dom2 = formData.second_day_of_month || 15;
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        const lastDay = new Date(yearCursor, monthCursor + 1, 0).getDate();
        const d1 = Math.min(dom1, lastDay);
        const d2 = Math.min(dom2, lastDay);
        const date1 = new Date(yearCursor, monthCursor, d1);
        const date2 = new Date(yearCursor, monthCursor, d2);
        // Add in chronological order
        const pair = [date1, date2].sort((a, b) => a - b);
        for (const pairDate of pair) {
          if (dates.length >= count || occurrenceCount >= maxOcc) break;
          if (endDate && pairDate > endDate) break;
          dates.push(_dateToStr(pairDate));
          occurrenceCount++;
        }
        monthCursor += interval;
        while (monthCursor > 11) { monthCursor -= 12; yearCursor++; }
        iterations++;
      }
      break;
    }
    case 'yearly': {
      let cursor = new Date(startDate);
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        if (endDate && cursor > endDate) break;
        dates.push(_dateToStr(cursor));
        occurrenceCount++;
        cursor.setFullYear(cursor.getFullYear() + interval);
        iterations++;
      }
      break;
    }
    case 'twice_yearly': {
      const secondDate = formData.second_date ? new Date(formData.second_date + 'T00:00:00') : null;
      let yearOffset = 0;
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        const date1 = new Date(startDate);
        date1.setFullYear(date1.getFullYear() + yearOffset * interval);
        if (endDate && date1 > endDate) break;
        dates.push(_dateToStr(date1));
        occurrenceCount++;

        if (secondDate && dates.length < count && occurrenceCount < maxOcc) {
          const date2 = new Date(secondDate);
          date2.setFullYear(date2.getFullYear() + yearOffset * interval);
          if (!endDate || date2 <= endDate) {
            dates.push(_dateToStr(date2));
            occurrenceCount++;
          }
        }
        yearOffset++;
        iterations++;
      }
      break;
    }
  }

  return dates;
}

function _lastWeekdayOfMonth(year, month, targetDow) {
  // targetDow: 0=Mon..6=Sun in our system
  const lastDay = new Date(year, month + 1, 0);
  const lastDayDow = (lastDay.getDay() + 6) % 7;
  let diff = lastDayDow - targetDow;
  if (diff < 0) diff += 7;
  return new Date(year, month, lastDay.getDate() - diff);
}

// ── Read Form Data ──────────────────────────────────────────

function _readFormData() {
  const frequency = document.getElementById('bill-frequency').value;
  const accountId = document.getElementById('bill-account').value;
  const description = document.getElementById('bill-description').value.trim();
  const rawAmount = document.getElementById('bill-amount').value.replace(/[^0-9.]/g, '');
  const typeSelect = document.getElementById('bill-type').value;
  const isCredit = typeSelect === 'credit';
  const amount = parseFloat(rawAmount) || 0;
  const amountVariable = document.getElementById('bill-amount-variable').checked;
  const autoPay = document.getElementById('bill-auto-pay').checked;
  const category = document.getElementById('bill-category').value.trim();
  const memo = document.getElementById('bill-memo').value.trim();
  const matchDescription = document.getElementById('bill-match-description').value.trim();

  const startDateInput = document.getElementById('bill-start-date');
  let startDate;
  if ((frequency === 'monthly' || frequency === 'twice_monthly') && startDateInput) {
    const monthYearValue = getMonthYearInputValue(startDateInput);
    startDate = monthYearValue ? `${monthYearValue}-01` : _todayStr();
  } else {
    startDate = startDateInput ? getDateInputValue(startDateInput) : _todayStr();
  }

  const intervalInput = document.getElementById('bill-interval');
  const interval = intervalInput ? parseInt(intervalInput.value, 10) || 1 : 1;

  const endType = document.getElementById('bill-end-type').value;
  const endDate = endType === 'on_date' ? getDateInputValue('bill-end-date') : null;
  const maxOccurrences = endType === 'after_occurrences'
    ? parseInt(document.getElementById('bill-max-occurrences').value, 10) || null
    : null;

  // Frequency-specific fields
  let dayOfMonth = null;
  let secondDayOfMonth = null;
  let dayOfWeek = null;
  let secondDate = null;

  const domSelect = document.getElementById('bill-day-of-month');
  if (domSelect) dayOfMonth = parseInt(domSelect.value, 10);

  const dom2Select = document.getElementById('bill-second-day-of-month');
  if (dom2Select) secondDayOfMonth = parseInt(dom2Select.value, 10);

  const dowSelect = document.getElementById('bill-day-of-week');
  if (dowSelect && dowSelect.style.display !== 'none') {
    dayOfWeek = parseInt(dowSelect.value, 10);
  }

  // For weekly, read from active button
  if (frequency === 'weekly') {
    const activeBtn = document.querySelector('.dow-btn.active');
    if (activeBtn) dayOfWeek = parseInt(activeBtn.dataset.dow, 10);
  }

  const secondDateInput = document.getElementById('bill-second-date');
  if (secondDateInput) secondDate = getDateInputValue(secondDateInput);

  return {
    frequency,
    account_id: accountId,
    description,
    amount,
    isCredit,
    amount_variable: amountVariable,
    auto_pay: autoPay,
    user_category: category || null,
    memo: memo || null,
    match_description: matchDescription || null,
    start_date: startDate,
    interval,
    day_of_month: dayOfMonth,
    second_day_of_month: secondDayOfMonth,
    day_of_week: dayOfWeek,
    second_date: secondDate,
    end_type: endType,
    end_date: endDate,
    max_occurrences: maxOccurrences
  };
}

// ── Save Bill ───────────────────────────────────────────────

async function saveBill() {
  const banner = document.getElementById('bill-error-banner');
  banner.style.display = 'none';

  const formData = _readFormData();

  // Client-side validation
  if (!formData.account_id) {
    _showBillError('Please select an account.');
    return;
  }
  if (!formData.description) {
    _showBillError('Please enter a description.');
    return;
  }
  if (!formData.amount || formData.amount <= 0) {
    _showBillError('Please enter a valid amount greater than 0.');
    return;
  }
  if (!formData.start_date) {
    _showBillError('Please set a start date.');
    return;
  }

  // Validate that dates parse to real calendar dates
  if (formData.start_date && !parseDateInput(formData.start_date)) {
    _showBillError('Invalid start date. Please check the date and try again.');
    return;
  }
  if (formData.end_date && !parseDateInput(formData.end_date)) {
    _showBillError('Invalid end date. Please check the date and try again.');
    return;
  }
  if (formData.second_date && !parseDateInput(formData.second_date)) {
    _showBillError('Invalid second payment date. Please check the date and try again.');
    return;
  }

  // Build payload — sign amount based on credit/debit
  const signedAmount = formData.isCredit ? formData.amount : -(formData.amount);

  // Detect transfer category pattern: [AccountName]
  let transferAccountId = null;
  if (formData.user_category && formData.user_category.startsWith('[') && formData.user_category.endsWith(']') && formData.user_category.length > 2) {
    const transferName = formData.user_category.slice(1, -1);
    const matchedAccount = allAccounts.find(acct =>
      acct.display_name.toLowerCase() === transferName.toLowerCase()
    );
    if (matchedAccount) transferAccountId = matchedAccount.account_id;
  }

  const payload = {
    account_id: formData.account_id,
    transfer_account_id: transferAccountId,
    description: formData.description,
    amount: signedAmount,
    user_category: formData.user_category,
    memo: formData.memo,
    match_description: formData.match_description,
    amount_variable: formData.amount_variable,
    auto_pay: formData.auto_pay,
    frequency: formData.frequency,
    interval: formData.interval,
    start_date: formData.start_date,
    second_date: formData.second_date,
    day_of_month: formData.day_of_month,
    second_day_of_month: formData.second_day_of_month,
    day_of_week: formData.day_of_week,
    end_type: formData.end_type,
    end_date: formData.end_date,
    max_occurrences: formData.max_occurrences
  };

  try {
    if (editingBillId) {
      await apiUpdateBill(editingBillId, payload);
      showStatus('Bill updated successfully', 'success');
    } else {
      await apiCreateBill(payload);
      showStatus('Bill created successfully', 'success');
    }
    _invalidateTransactionCache();
    closeBillModal();
    await reloadBills();

    // Redirect back to the referring page if one was recorded before navigating here.
    if (window._returnUrl) {
      window.location.href = window._returnUrl;
      return;
    }

    // Legacy: redirect back after create-from-transactions context-menu flow.
    if (!editingBillId && window._returnToTransactionsAfterCreate) {
      window._returnToTransactionsAfterCreate = false;
      window.location.href = 'transactions.html';
      return;
    }

    setTimeout(clearStatus, 3000);
  } catch (saveError) {
    _showBillError(saveError.message);
  }
}

function _showBillError(message) {
  const banner = document.getElementById('bill-error-banner');
  banner.textContent = message;
  banner.style.display = 'block';
  setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// ── Amount +/− Helpers (same pattern as manual-transactions.js) ──

function _syncAmountPrefix(amountInput, typeSelect) {
  const value = amountInput.value;
  if (value.startsWith('+')) {
    typeSelect.value = 'credit';
    amountInput.value = value.slice(1);
  } else if (value.startsWith('-') || value.startsWith('−')) {
    typeSelect.value = 'debit';
    amountInput.value = value.slice(1);
  }
}

function _syncTypeDropdown(amountInput, typeSelect) {
  // strip any prefix
  amountInput.value = amountInput.value.replace(/^[+\-−]/, '');
}

function _decorateAmountOnBlur(amountInput, typeSelect) {
  const raw = amountInput.value.replace(/[^0-9.]/g, '');
  if (!raw) return;
  const num = parseFloat(raw);
  if (isNaN(num)) return;
  amountInput.value = (typeSelect.value === 'debit' ? '−' : '') + num.toFixed(2);
}

function _stripDecorationOnFocus(amountInput) {
  amountInput.value = amountInput.value.replace(/^[−]/, '');
}

// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// CATEGORY AUTOCOMPLETE
// ══════════════════════════════════════════════════════════════

/**
 * Fetch available categories from the backend (or localStorage cache).
 * Populates the module-level allCategories array for autocomplete.
 */
async function _fetchCategories() {
  const CACHE_KEY = 'pf_cached_categories';
  const TS_KEY = 'pf_categories_cached_at';
  const MAX_AGE_MS = 30 * 60 * 1000;

  // Try cache first — categories change rarely
  const cachedAt = localStorage.getItem(TS_KEY);
  const cacheAge = cachedAt ? (Date.now() - parseInt(cachedAt)) : Infinity;
  if (cacheAge < MAX_AGE_MS) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      if (cached.length > 0) return cached;
    } catch (_parseError) { /* fall through to network */ }
  }

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`);
    if (response.ok) {
      const data = await response.json();
      const categories = data.available_categories || [];
      // Cache for future use
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(categories));
        localStorage.setItem(TS_KEY, String(Date.now()));
      } catch (_storageError) { /* non-critical */ }
      return categories;
    }
  } catch (fetchError) {
    console.error('Failed to fetch categories:', fetchError);
  }
  return [];
}

/**
 * Highlight matching substring in category text for autocomplete display.
 */
function _highlightCategoryMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  return escapeHtml(text).replace(regex, '<strong>$1</strong>');
}

/**
 * Wire up category autocomplete for the bill modal.
 * Supports regular category search and bracket-notation transfer accounts.
 */
function _wireUpBillCategoryAutocomplete() {
  const input = document.getElementById('bill-category');
  const list = document.getElementById('bill-category-ac-list');
  if (!input || !list) return;

  // Clone to remove any previously-attached listeners (modal reuse)
  const freshInput = input.cloneNode(true);
  input.parentNode.replaceChild(freshInput, input);

  freshInput.addEventListener('input', () => {
    _showBillCategoryDropdown(freshInput, list);
  });

  freshInput.addEventListener('focus', () => {
    freshInput.select();
    if (freshInput.value.trim()) {
      _showBillCategoryDropdown(freshInput, list);
    }
  });

  freshInput.addEventListener('keydown', (event) => {
    const items = list.querySelectorAll('.bill-category-ac-item');
    const activeItem = list.querySelector('.bill-category-ac-item.active');
    const activeIndex = Array.from(items).indexOf(activeItem);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = Math.min(activeIndex + 1, items.length - 1);
      items.forEach(item => item.classList.remove('active'));
      if (items[nextIndex]) {
        items[nextIndex].classList.add('active');
        items[nextIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIndex = Math.max(activeIndex - 1, 0);
      items.forEach(item => item.classList.remove('active'));
      if (items[prevIndex]) {
        items[prevIndex].classList.add('active');
        items[prevIndex].scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      const target = activeItem || items[0];
      if (target) {
        event.preventDefault();
        freshInput.value = target.dataset.value;
        list.innerHTML = '';
        list.style.display = 'none';
      }
    } else if (event.key === 'Escape') {
      list.innerHTML = '';
      list.style.display = 'none';
    }
  });

  freshInput.addEventListener('blur', () => {
    setTimeout(() => {
      list.innerHTML = '';
      list.style.display = 'none';
    }, 200);
  });

  list.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.bill-category-ac-item');
    if (item) {
      event.preventDefault();
      freshInput.value = item.dataset.value;
      list.innerHTML = '';
      list.style.display = 'none';
    }
  });
}

/**
 * Show filtered category suggestions (or transfer account list on "[").
 */
function _showBillCategoryDropdown(input, list) {
  const query = (input.value || '').trim();
  const queryLower = query.toLowerCase();

  if (!query) {
    list.innerHTML = '';
    list.style.display = 'none';
    return;
  }

  // Transfer mode: "[" prefix triggers account list for transfer assignment
  if (query.startsWith('[')) {
    _showBillTransferAccountDropdown(list, query);
    return;
  }

  // Smart filtering: split on ":" to match primary/detailed independently
  let matches;
  if (queryLower.includes(':')) {
    const [queryPrimary, queryDetailed] = queryLower.split(':').map(segment => segment.trim());
    matches = (allCategories || []).filter(cat => {
      const lower = cat.toLowerCase();
      const parts = lower.split(':').map(segment => segment.trim());
      const primaryMatch = !queryPrimary || (parts[0] || '').includes(queryPrimary);
      const detailedMatch = !queryDetailed || (parts[1] || '').includes(queryDetailed);
      return primaryMatch && detailedMatch;
    });
  } else {
    matches = (allCategories || []).filter(cat =>
      cat.toLowerCase().includes(queryLower)
    );
  }

  const maxVisible = 10;
  const shown = matches.slice(0, maxVisible);

  if (shown.length === 0) {
    list.innerHTML = '<div class="bill-category-ac-empty">No matching categories</div>';
    list.style.display = 'block';
    return;
  }

  const html = shown.map((cat, index) => {
    const highlighted = _highlightCategoryMatch(cat, query);
    return `<div class="bill-category-ac-item${index === 0 ? ' active' : ''}" data-value="${escapeHtml(cat)}">${highlighted}</div>`;
  }).join('');

  const overflow = matches.length > maxVisible
    ? `<div class="bill-category-ac-more">${matches.length - maxVisible} more\u2026</div>` : '';

  list.innerHTML = html + overflow;
  list.style.display = 'block';
}

/**
 * Show transfer-account suggestions when user types "[" in the bill category field.
 * Excludes the currently selected bill account (can't transfer to self).
 */
function _showBillTransferAccountDropdown(list, rawQuery) {
  const accountQuery = rawQuery.slice(1).replace(/]$/, '').toLowerCase();
  const currentAccountId = document.getElementById('bill-account')?.value || null;

  const matchingAccounts = allAccounts.filter(acct => {
    if (acct.account_id === currentAccountId) return false;
    if (!accountQuery) return true;
    return acct.display_name.toLowerCase().includes(accountQuery);
  });

  const maxVisible = 10;
  const shown = matchingAccounts.slice(0, maxVisible);

  if (shown.length === 0) {
    list.innerHTML = '<div class="bill-category-ac-empty">No matching accounts for transfer</div>';
    list.style.display = 'block';
    return;
  }

  const html = shown.map((acct, index) => {
    const displayName = acct.display_name;
    const transferValue = `[${displayName}]`;
    const highlighted = accountQuery ? _highlightCategoryMatch(displayName, accountQuery) : escapeHtml(displayName);
    return `<div class="bill-category-ac-item${index === 0 ? ' active' : ''}" data-value="${escapeHtml(transferValue)}">${highlighted}</div>`;
  }).join('');

  list.innerHTML = html;
  list.style.display = 'block';
}

// INITIALIZATION
// ══════════════════════════════════════════════════════════════

$(document).ready(function () {
  window.BACKEND_URL_PROMISE.then(async () => {
    if (!token && !window.LOCAL_AUTO_LOGIN_ENABLED) {
      window.location.href = 'index.html';
      return;
    }

    setupActivityListeners();
    resetIdleTimeout();

    try {
      // Fetch accounts, bills, and categories in parallel
      const [accountsResult, billsResult, categoriesResult] = await Promise.all([
        fetchAccounts(),
        fetchBills(),
        _fetchCategories()
      ]);
      allAccounts = accountsResult;
      allBills = billsResult;
      allCategories = categoriesResult;
      _populateAccountFilter();
      _wireUpBillFilters();
      renderDashboard();
      renderBillsTable();

      // If navigated here from transactions with ?edit=<bill_id>, auto-open the edit modal
      const urlParams = new URLSearchParams(window.location.search);
      const editBillId = urlParams.get('edit');

      // Read the generic return URL set by any referring page before navigating here.
      // Consumed once on init so a page refresh doesn't stale-redirect.
      window._returnUrl = sessionStorage.getItem('pf_return_url') || null;
      sessionStorage.removeItem('pf_return_url');

      if (editBillId) {
        const billExists = allBills.some(findBill => findBill.bill_id === editBillId);
        if (billExists) {
          openBillModal(editBillId);
        } else {
          showStatus(`Bill not found: ${editBillId}`, 'error');
        }
        // Clean up the URL so a refresh doesn't re-trigger
        window.history.replaceState({}, '', 'bills.html');
      }

      // If navigated here from transactions with ?prefill=<base64>, auto-open the
      // create modal with transaction data pre-filled so user only needs to set
      // frequency/recurrence and submit.
      const prefillParam = urlParams.get('prefill');
      if (prefillParam && !editBillId) {
        try {
          const returnFlag = sessionStorage.getItem('pf_return_to_transactions_after_bill_create');
          window._returnToTransactionsAfterCreate = returnFlag === '1';
          sessionStorage.removeItem('pf_return_to_transactions_after_bill_create');

          const prefillData = JSON.parse(atob(prefillParam));
          openBillModal(); // create mode (no bill_id)
          // Populate fields from the transaction data after the modal is rendered
          setTimeout(() => {
            if (prefillData.description) {
              document.getElementById('bill-description').value = prefillData.description;
            }
            if (prefillData.amount) {
              document.getElementById('bill-amount').value = Math.abs(prefillData.amount).toFixed(2);
            }
            if (prefillData.type) {
              document.getElementById('bill-type').value = prefillData.type;
            }
            if (prefillData.account_id) {
              document.getElementById('bill-account').value = prefillData.account_id;
            }
            if (prefillData.user_category) {
              document.getElementById('bill-category').value = prefillData.user_category;
            }
            if (prefillData.match_description) {
              document.getElementById('bill-match-description').value = prefillData.match_description;
            } else if (prefillData.merchant_name) {
              // Fallback for older prefill data without match_description
              document.getElementById('bill-match-description').value = prefillData.merchant_name;
            }

            // The modal opens with an initial preview before prefill values are injected.
            // Force a second preview render so the summary amount reflects prefilled data.
            updatePreview();
          }, 60);
        } catch (prefillError) {
          console.warn('Failed to parse prefill data:', prefillError);
        }
        window.history.replaceState({}, '', 'bills.html');
      } else {
        // Ensure stale redirect state doesn't leak into normal bills usage.
        window._returnToTransactionsAfterCreate = false;
        sessionStorage.removeItem('pf_return_to_transactions_after_bill_create');
      }
    } catch (initError) {
      console.error('Failed to initialize bills page:', initError);
      showStatus(`Failed to load: ${initError.message}`, 'error');
      document.getElementById('bills-loading').style.display = 'none';
    }
  });
});
