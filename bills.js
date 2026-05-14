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
/**
 * Update the transactions Dexie cache after a bill CRUD operation.
 *
 * When the backend returns affected_virtual_transactions and purged_virtual_ids,
 * this function applies a granular patch: removes stale BILL_FUTURE rows
 * and upserts the new/updated ones. This avoids a full cache invalidation
 * and lets the transactions page show the changes instantly from cache.
 *
 * Falls back to full cache invalidation if no granular data is provided
 * or if the IndexedDB write fails.
 *
 * Uses raw IndexedDB API since this page doesn't load the worker.
 */
function _updateTransactionCacheForBill(purgedVirtualIds, affectedVirtualTransactions) {
  var hasPurge = Array.isArray(purgedVirtualIds) && purgedVirtualIds.length > 0;
  var hasNew = Array.isArray(affectedVirtualTransactions) && affectedVirtualTransactions.length > 0;

  if (!hasPurge && !hasNew) {
    // No granular data — fall back to full invalidation
    _invalidateTransactionCache();
    return;
  }

  try {
    var req = indexedDB.open('PersonalFinanceDB');
    req.onsuccess = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('transactions') || !db.objectStoreNames.contains('meta')) {
        // DB schema doesn't have the expected stores — fall back
        db.close();
        _invalidateTransactionCache();
        return;
      }

      var txn = db.transaction(['transactions', 'meta'], 'readwrite');
      var txnStore = txn.objectStore('transactions');
      var metaStore = txn.objectStore('meta');

      // Delete stale BILL_FUTURE rows
      if (hasPurge) {
        for (var purgeIdx = 0; purgeIdx < purgedVirtualIds.length; purgeIdx++) {
          txnStore.delete(purgedVirtualIds[purgeIdx]);
        }
      }

      // Upsert new/updated BILL_FUTURE rows
      if (hasNew) {
        for (var addIdx = 0; addIdx < affectedVirtualTransactions.length; addIdx++) {
          txnStore.put(affectedVirtualTransactions[addIdx]);
        }
      }

      // Wipe the ETag so the next full fetch re-validates with the server,
      // but keep cached_at so Tier 1 cache still serves the patched data.
      metaStore.put({ key: 'etag', value: null });

      db.close();
    };
    req.onerror = function() {
      _invalidateTransactionCache();
    };
  } catch (e) {
    _invalidateTransactionCache();
  }
}

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
      return true;
    }
    return false;
  } catch (_) { return false; }
}

async function authenticatedFetch(url, options = {}) {
  const headers = { 'Authorization': `Bearer ${token}`, ...options.headers };
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
// Moved to bills/api.js
// (fetchBills, fetchAccounts, apiCreateBill, apiUpdateBill,
//  apiDeleteBill, apiToggleBill)

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
        const isApproximate = !!bill.amount_is_approximate;
        const isVariableNonIncome = isApproximate && !isIncome;

        upcomingItems.push({
          date: occ.date,
          description: bill.description,
          amount: bill.amount,
          isTransfer: isTransfer,
          isIncome: isIncome,
          amountVariable: isApproximate,
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
  const variableNote = bill.amount_is_approximate ? ' <span title="Amount is approximate (range match)" style="color:#e67e22;font-weight:600;">~</span>' : '';
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
    var result = await apiToggleBill(billId);
    _updateTransactionCacheForBill(result.purged_virtual_ids, result.affected_virtual_transactions);
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
    var result = await apiDeleteBill(billId);
    _updateTransactionCacheForBill(result.purged_virtual_ids, result.affected_virtual_transactions);
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
// BACKUP / RESTORE
// ══════════════════════════════════════════════════════════════

function openBillsBackupRestoreModal() {
  document.getElementById('bills-import-file').value = '';
  const result = document.getElementById('bills-import-result');
  result.style.display = 'none';
  result.innerHTML = '';
  document.getElementById('bills-backup-restore-modal').classList.remove('hidden');
}

function closeBillsBackupRestoreModal() {
  document.getElementById('bills-backup-restore-modal').classList.add('hidden');
}

async function exportBillsCSV() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/backup/export`);
    if (!response.ok) throw new Error(`Export failed (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `pfc-bills-backup-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    showStatus(`Export failed: ${err.message}`, 'error');
  }
}

async function importBillsCSV() {
  const fileInput = document.getElementById('bills-import-file');
  const resultEl = document.getElementById('bills-import-result');
  if (!fileInput.files.length) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = '<span style="color:#c0392b;">Please select a CSV file first.</span>';
    return;
  }
  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);
  try {
    resultEl.style.display = 'block';
    resultEl.innerHTML = 'Importing…';
    const response = await authenticatedFetch(`${BACKEND_URL}/api/bills/backup/import`, {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) {
      resultEl.innerHTML = `<span style="color:#c0392b;">Import error: ${data.error || response.status}</span>`;
      return;
    }
    let html = `<span style="color:#27ae60;">✓ Import complete.</span> `
      + `Created: <strong>${data.bills_created}</strong>, `
      + `Skipped: <strong>${data.bills_skipped}</strong>`;
    if (data.bills_unbound > 0) {
      html += `, Unbound (inactive): <strong>${data.bills_unbound}</strong>`;
      if (data.unbound_bills && data.unbound_bills.length) {
        html += '<ul style="margin:6px 0 0 0; padding-left:18px; color:#888;">';
        for (const ub of data.unbound_bills) {
          const missing = ub.missing_source_account || ub.missing_transfer_account || '(unknown account)';
          html += `<li>${ub.description} — missing account: ${missing}</li>`;
        }
        html += '</ul>';
      }
    }
    resultEl.innerHTML = html;
    await reloadBills();
  } catch (err) {
    resultEl.innerHTML = `<span style="color:#c0392b;">Import failed: ${err.message}</span>`;
  }
}

// ══════════════════════════════════════════════════════════════
// MODAL — Thin wrapper over bills/modal.js
// ══════════════════════════════════════════════════════════════

// Capture the shared modal function before this script shadows it.
// bills/modal.js must load before bills.js for this reference to work.
const _sharedOpenBillModal = openBillModal;

/**
 * Open the bill create/edit modal from the bills page.
 * Delegates to the shared bills/modal.js module, supplying page-level
 * accounts, categories, and an onSave callback that handles cache
 * updates + table re-render. Extra options (e.g. prefill) are merged in.
 */
window.openBillModal = function(billId, extraOptions) {
  const bill = billId ? allBills.find(findBill => findBill.bill_id === billId) : null;

  _sharedOpenBillModal(billId, Object.assign({
    accounts: allAccounts,
    categories: allCategories,
    bill: bill,
    onSave: (result) => {
      _updateTransactionCacheForBill(
        result.purged_virtual_ids,
        result.affected_virtual_transactions
      );
      reloadBills();
    },
  }, extraOptions || {}));
};

// INITIALIZATION
// ══════════════════════════════════════════════════════════════

$(document).ready(function () {
  window.BACKEND_URL_PROMISE.then(async () => {
    if (!token && !window.LOCAL_AUTO_LOGIN_ENABLED) {
      window.location.href = 'index.html';
      return;
    }

    try {
      // Fetch accounts, bills, and categories in parallel
      const [accountsResult, billsResult, categoriesResult] = await Promise.all([
        fetchAccounts(),
        fetchBills(),
        fetchCategoriesWithCache()
      ]);
      allAccounts = accountsResult;
      allBills = billsResult;
      allCategories = categoriesResult;
      _populateAccountFilter();
      _wireUpBillFilters();
      renderDashboard();
      renderBillsTable();

      // If navigated here with ?edit=<bill_id>, auto-open the edit modal
      const urlParams = new URLSearchParams(window.location.search);
      const editBillId = urlParams.get('edit');

      if (editBillId) {
        const billExists = allBills.some(findBill => findBill.bill_id === editBillId);
        if (billExists) {
          openBillModal(editBillId);
        } else {
          showStatus(`Bill not found: ${editBillId}`, 'error');
        }
        window.history.replaceState({}, '', 'bills.html');
      }

      // If navigated here with ?prefill=<base64>, open create modal with
      // transaction data pre-filled via the shared modal's prefill support.
      const prefillParam = urlParams.get('prefill');
      if (prefillParam && !editBillId) {
        try {
          const prefillData = JSON.parse(atob(prefillParam));
          openBillModal(null, { prefill: prefillData });
        } catch (prefillError) {
          console.warn('Failed to parse prefill data:', prefillError);
        }
        window.history.replaceState({}, '', 'bills.html');
      }
    } catch (initError) {
      console.error('Failed to initialize bills page:', initError);
      showStatus(`Failed to load: ${initError.message}`, 'error');
      document.getElementById('bills-loading').style.display = 'none';
    }
  });
});
