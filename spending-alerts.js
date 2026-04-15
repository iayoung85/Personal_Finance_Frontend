// ============================================================
// spending-alerts.js — CRUD logic for the Spending Alerts page.
//
// Loaded after config.js (provides BACKEND_URL).
// Follows the same auth, fetch, and rendering patterns as bills.js.
// ============================================================

// ── Auth State ──────────────────────────────────────────────
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = null;
try { currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (_) { currentUser = null; }

// ── App State ───────────────────────────────────────────────
let allAlerts = [];
let allCategories = [];
let editingAlertId = null; // null = creating, string = editing
let pendingDeleteId = null;

// ── Sort State (persisted) ──────────────────────────────────
let currentSortColumn = localStorage.getItem('sa_sort_column') || 'user_category';
let currentSortAscending = localStorage.getItem('sa_sort_asc') !== 'false';

// ── Auth Helpers ─────────────────────────────────────────────

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

// ── Category Autocomplete ────────────────────────────────────
// Fetch/cache handled by shared/categories-autocomplete.js

function _wireCategoryAutocomplete() {
  const input = document.getElementById('sa-category');
  const list = document.getElementById('sa-category-ac-list');
  if (!input || !list) return;

  wireUpCategoryAutocomplete(input, list, {
    categories: allCategories,
    itemClass:  'sa-category-ac-item',
    emptyClass: 'sa-category-ac-empty',
    moreClass:  'sa-category-ac-more',
  });
}

// ── Status Bar ───────────────────────────────────────────────

function showStatus(msg, type = 'info') {
  const bar = document.getElementById('status-bar');
  bar.textContent = msg;
  bar.className = `status-bar status-${type}`;
  bar.classList.remove('hidden');
  if (type === 'success' || type === 'info') {
    setTimeout(() => bar.classList.add('hidden'), 3500);
  }
}

// ── API Calls ─────────────────────────────────────────────────

async function fetchAlerts() {
  const res = await authenticatedFetch(`${BACKEND_URL}/api/spending-alerts`);
  if (!res) return;
  if (!res.ok) {
    showStatus('Failed to load spending alerts.', 'error');
    return;
  }
  const data = await res.json();
  allAlerts = data.alerts || [];
}

async function apiCreateAlert(payload) {
  return authenticatedFetch(`${BACKEND_URL}/api/spending-alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function apiUpdateAlert(alertId, payload) {
  return authenticatedFetch(`${BACKEND_URL}/api/spending-alerts/${alertId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function apiDeleteAlert(alertId) {
  return authenticatedFetch(`${BACKEND_URL}/api/spending-alerts/${alertId}`, {
    method: 'DELETE'
  });
}

async function apiManualCheck() {
  return authenticatedFetch(`${BACKEND_URL}/api/spending-alerts/check`, {
    method: 'POST'
  });
}

// ── Filtering & Sorting ───────────────────────────────────────

function getFilteredSortedAlerts() {
  const search  = document.getElementById('sa-search-input').value.trim().toLowerCase();
  const period  = document.getElementById('sa-filter-period').value;
  const status  = document.getElementById('sa-filter-status').value;

  let list = allAlerts.filter(a => {
    if (search && !a.user_category.toLowerCase().includes(search)) return false;
    if (period && a.period !== period) return false;
    if (status === 'active'   && !a.is_active)  return false;
    if (status === 'inactive' &&  a.is_active)  return false;
    return true;
  });

  list.sort((a, b) => {
    let va, vb;
    switch (currentSortColumn) {
      case 'user_category':     va = a.user_category.toLowerCase(); vb = b.user_category.toLowerCase(); break;
      case 'threshold_amount':  va = a.threshold_amount;            vb = b.threshold_amount;            break;
      case 'period':            va = a.period;                      vb = b.period;                      break;
      case 'notification_mode': va = a.notification_mode;           vb = b.notification_mode;           break;
      case 'last_notified_at':  va = a.last_notified_at || '';      vb = b.last_notified_at || '';      break;
      case 'is_active':         va = a.is_active ? 0 : 1;          vb = b.is_active ? 0 : 1;           break;
      default:                  va = a.user_category.toLowerCase(); vb = b.user_category.toLowerCase();
    }
    if (va < vb) return currentSortAscending ? -1 : 1;
    if (va > vb) return currentSortAscending ?  1 : -1;
    return 0;
  });

  return list;
}

function getGroupKey(alert) {
  const groupBy = document.getElementById('sa-group-by').value;
  if (groupBy === 'primary_category') {
    return alert.user_category.includes(':')
      ? alert.user_category.split(':')[0].trim()
      : alert.user_category;
  }
  if (groupBy === 'period') {
    return alert.period.charAt(0).toUpperCase() + alert.period.slice(1);
  }
  return null;
}

// ── Rendering ─────────────────────────────────────────────────

function renderAlerts() {
  const list = getFilteredSortedAlerts();
  const groupBy = document.getElementById('sa-group-by').value;

  const tbody = document.getElementById('sa-tbody');
  const table = document.getElementById('sa-table');
  const empty = document.getElementById('sa-empty');

  // Update sort indicators on headers
  document.querySelectorAll('#sa-table th.sortable').forEach(th => {
    th.classList.remove('sort-active');
    th.querySelector('.sort-indicator').textContent = '';
  });
  const activeTh = document.querySelector(`#sa-table th[data-sort="${currentSortColumn}"]`);
  if (activeTh) {
    activeTh.classList.add('sort-active');
    activeTh.querySelector('.sort-indicator').textContent = currentSortAscending ? '▲' : '▼';
  }

  // Update count
  const countEl = document.getElementById('alert-count');
  countEl.textContent = list.length === allAlerts.length
    ? `${allAlerts.length} alert${allAlerts.length !== 1 ? 's' : ''}`
    : `${list.length} of ${allAlerts.length} alerts`;

  if (list.length === 0) {
    table.style.display = 'none';
    empty.style.display = '';
    empty.innerHTML = allAlerts.length === 0
      ? `<p>No spending alerts configured yet.</p><p style="font-size:14px;">Click <strong>+ New Alert</strong> to get notified when you overspend in a category.</p>`
      : `<p>No alerts match the current filters.</p>`;
    return;
  }

  table.style.display = '';
  empty.style.display = 'none';
  tbody.innerHTML = '';

  if (!groupBy) {
    list.forEach(a => tbody.appendChild(buildAlertRow(a)));
    return;
  }

  // Grouped render
  const groups = new Map();
  list.forEach(a => {
    const key = getGroupKey(a);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  });

  groups.forEach((alerts, groupName) => {
    // Group header
    const headerRow = document.createElement('tr');
    headerRow.className = 'group-header-row';
    headerRow.dataset.group = groupName;
    headerRow.innerHTML = `
      <td colspan="8">
        <span class="group-chevron">▼</span>
        <span class="group-name">${escHtml(groupName)}</span>
        <span class="group-meta">${alerts.length} alert${alerts.length !== 1 ? 's' : ''}</span>
        <span class="group-count">${alerts.filter(a => a.is_active).length} active</span>
      </td>`;
    headerRow.addEventListener('click', () => toggleGroup(groupName, headerRow));
    tbody.appendChild(headerRow);

    alerts.forEach(a => {
      const row = buildAlertRow(a);
      row.dataset.group = groupName;
      tbody.appendChild(row);
    });
  });
}

function buildAlertRow(alert) {
  const tr = document.createElement('tr');
  if (!alert.is_active) tr.style.opacity = '0.55';

  // Category
  const catParts = alert.user_category.includes(':')
    ? alert.user_category.split(':').map(s => s.trim())
    : [alert.user_category];
  const catDisplay = catParts.length > 1
    ? `<span style="color:var(--text-muted);font-size:11px;">${escHtml(catParts[0])}:</span> ${escHtml(catParts.slice(1).join(': '))}`
    : escHtml(catParts[0]);

  // Period badge
  const periodBadge = `<span class="period-badge ${alert.period}">${escHtml(alert.period)}</span>`;

  // Mode
  const modeLabel = alert.notification_mode === 'every_purchase'
    ? `<span class="mode-badge every-purchase" title="Email fires after every sync over threshold">Every purchase</span>`
    : `<span class="mode-badge" title="One email per period when threshold is first crossed">Once / period</span>`;

  // Recipients — show first two, "+N more" tooltip for the rest
  const emails = alert.recipient_emails || [];
  let recipHtml = '';
  const show = emails.slice(0, 2);
  const extra = emails.length - show.length;
  show.forEach(e => { recipHtml += `<span class="sa-recipient-tag" title="${escHtml(e)}">${escHtml(e)}</span>`; });
  if (extra > 0) recipHtml += `<span class="sa-more-recipients" title="${escHtml(emails.slice(2).join('\n'))}">+${extra} more</span>`;

  // Last triggered
  let lastHtml;
  if (alert.last_notified_at) {
    const d = new Date(alert.last_notified_at);
    const age = Date.now() - d.getTime();
    const cls = age < 7 * 24 * 60 * 60 * 1000 ? 'recent' : '';
    lastHtml = `<span class="sa-last-triggered ${cls}" title="${escHtml(alert.last_notified_at)}">${formatRelativeDate(d)}</span>`;
  } else {
    lastHtml = `<span class="sa-last-triggered never">Never</span>`;
  }

  // Status badge
  const statusBadge = alert.is_active
    ? `<span class="status-badge active">Active</span>`
    : `<span class="status-badge inactive">Paused</span>`;

  // Toggle button label
  const toggleLabel = alert.is_active ? 'Pause' : 'Resume';

  tr.innerHTML = `
    <td>${catDisplay}</td>
    <td><span class="sa-threshold-value">$${fmtAmount(alert.threshold_amount)}</span></td>
    <td>${periodBadge}</td>
    <td>${modeLabel}</td>
    <td class="sa-recipients-cell">${recipHtml}</td>
    <td>${lastHtml}</td>
    <td>${statusBadge}</td>
    <td>
      <div class="sa-row-actions">
        <button class="sa-row-btn" onclick="openAlertModal('${escHtml(alert.alert_id)}')">Edit</button>
        <button class="sa-row-btn toggle-active" onclick="toggleActive('${escHtml(alert.alert_id)}')">${toggleLabel}</button>
        <button class="sa-row-btn danger" onclick="openDeleteModal('${escHtml(alert.alert_id)}')">Delete</button>
      </div>
    </td>`;

  return tr;
}

function toggleGroup(groupName, headerRow) {
  const isCollapsed = headerRow.dataset.collapsed === 'true';
  headerRow.dataset.collapsed = isCollapsed ? 'false' : 'true';
  const chevron = headerRow.querySelector('.group-chevron');
  chevron.textContent = isCollapsed ? '▼' : '▶';

  const tbody = document.getElementById('sa-tbody');
  Array.from(tbody.querySelectorAll(`tr[data-group="${CSS.escape(groupName)}"]`))
    .filter(r => !r.classList.contains('group-header-row'))
    .forEach(r => { r.style.display = isCollapsed ? '' : 'none'; });
}

// ── Formatting Helpers ────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtAmount(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRelativeDate(date) {
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString();
}

// ── Sort Handler ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#sa-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (currentSortColumn === col) {
        currentSortAscending = !currentSortAscending;
      } else {
        currentSortColumn = col;
        currentSortAscending = true;
      }
      localStorage.setItem('sa_sort_column', currentSortColumn);
      localStorage.setItem('sa_sort_asc', currentSortAscending);
      renderAlerts();
    });
  });

  // Filter/group change handlers
  ['sa-search-input', 'sa-filter-period', 'sa-filter-status', 'sa-group-by'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderAlerts);
  });
  const searchInput = document.getElementById('sa-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      document.getElementById('sa-search-clear').style.display =
        searchInput.value ? '' : 'none';
      renderAlerts();
    });
  }
});

function clearSearch() {
  const input = document.getElementById('sa-search-input');
  input.value = '';
  document.getElementById('sa-search-clear').style.display = 'none';
  renderAlerts();
}

// ── Create / Edit Modal ───────────────────────────────────────

function openAlertModal(alertId) {
  editingAlertId = alertId || null;

  const modal  = document.getElementById('sa-modal-overlay');
  const title  = document.getElementById('sa-modal-title');
  const submit = document.getElementById('sa-submit-btn');
  const errBanner = document.getElementById('sa-error-banner');

  errBanner.style.display = 'none';
  errBanner.textContent = '';

  if (editingAlertId) {
    const alert = allAlerts.find(a => a.alert_id === editingAlertId);
    if (!alert) return;

    title.textContent = 'Edit Alert';
    submit.textContent = 'Save Changes';

    document.getElementById('sa-category').value    = alert.user_category;
    document.getElementById('sa-threshold').value   = String(alert.threshold_amount);
    document.getElementById('sa-period').value      = alert.period;
    document.getElementById('sa-mode').value        = alert.notification_mode;
    document.getElementById('sa-recipients').value  = (alert.recipient_emails || []).join(', ');
    document.getElementById('sa-is-active').checked = alert.is_active;
    document.getElementById('sa-yearly-month').value = alert.yearly_reset_month || 1;
    document.getElementById('sa-yearly-day').value   = alert.yearly_reset_day   || 1;
  } else {
    title.textContent = 'New Spending Alert';
    submit.textContent = 'Create Alert';

    document.getElementById('sa-category').value    = '';
    document.getElementById('sa-threshold').value   = '';
    document.getElementById('sa-period').value      = 'monthly';
    document.getElementById('sa-mode').value        = 'once_per_period';
    document.getElementById('sa-recipients').value  = '';
    document.getElementById('sa-is-active').checked = true;
    document.getElementById('sa-yearly-month').value = 1;
    document.getElementById('sa-yearly-day').value   = 1;
  }

  onPeriodChange();
  _wireCategoryAutocomplete();
  modal.classList.remove('hidden');
  document.getElementById('sa-category').focus();
}

function closeAlertModal() {
  document.getElementById('sa-modal-overlay').classList.add('hidden');
  editingAlertId = null;
}

function onPeriodChange() {
  const period = document.getElementById('sa-period').value;
  const yearlySection = document.getElementById('sa-yearly-section');
  yearlySection.style.display = period === 'yearly' ? '' : 'none';
}

function parseRecipients(raw) {
  return raw.split(/[,\n]+/).map(e => e.trim()).filter(Boolean);
}

function buildAlertPayload() {
  const category   = document.getElementById('sa-category').value.trim();
  const thresholdRaw = document.getElementById('sa-threshold').value.trim();
  const period     = document.getElementById('sa-period').value;
  const mode       = document.getElementById('sa-mode').value;
  const recipientsRaw = document.getElementById('sa-recipients').value;
  const isActive   = document.getElementById('sa-is-active').checked;

  // Validate
  if (!category) return { error: 'Category is required.' };
  const threshold = parseFloat(thresholdRaw);
  if (isNaN(threshold) || threshold <= 0) return { error: 'Threshold must be a positive number.' };
  const recipients = parseRecipients(recipientsRaw);
  if (recipients.length === 0) return { error: 'At least one recipient email is required.' };
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const e of recipients) {
    if (!emailRe.test(e)) return { error: `Invalid email address: ${e}` };
  }

  const payload = {
    user_category:     category,
    threshold_amount:  threshold,
    period,
    notification_mode: mode,
    recipient_emails:  recipients,
    is_active:         isActive,
  };

  if (period === 'yearly') {
    const month = parseInt(document.getElementById('sa-yearly-month').value, 10);
    const day   = parseInt(document.getElementById('sa-yearly-day').value, 10);
    if (month >= 1 && month <= 12) payload.yearly_reset_month = month;
    if (day   >= 1 && day   <= 31) payload.yearly_reset_day   = day;
  }

  return { payload };
}

async function saveAlert() {
  const { error, payload } = buildAlertPayload();
  const errBanner = document.getElementById('sa-error-banner');

  if (error) {
    errBanner.textContent = error;
    errBanner.style.display = '';
    return;
  }

  errBanner.style.display = 'none';
  const submitBtn = document.getElementById('sa-submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = editingAlertId ? 'Saving…' : 'Creating…';

  try {
    const res = editingAlertId
      ? await apiUpdateAlert(editingAlertId, payload)
      : await apiCreateAlert(payload);

    if (!res) return;

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errBanner.textContent = data.error || `Request failed (${res.status})`;
      errBanner.style.display = '';
      return;
    }

    const updated = await res.json();
    if (editingAlertId) {
      const idx = allAlerts.findIndex(a => a.alert_id === editingAlertId);
      if (idx !== -1) allAlerts[idx] = updated;
    } else {
      allAlerts.push(updated);
    }

    closeAlertModal();
    renderAlerts();
    showStatus(editingAlertId ? 'Alert updated.' : 'Alert created.', 'success');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = editingAlertId ? 'Save Changes' : 'Create Alert';
  }
}

// ── Toggle Active ─────────────────────────────────────────────

async function toggleActive(alertId) {
  const alert = allAlerts.find(a => a.alert_id === alertId);
  if (!alert) return;

  const res = await apiUpdateAlert(alertId, { is_active: !alert.is_active });
  if (!res || !res.ok) {
    showStatus('Failed to update alert.', 'error');
    return;
  }
  const updated = await res.json();
  const idx = allAlerts.findIndex(a => a.alert_id === alertId);
  if (idx !== -1) allAlerts[idx] = updated;
  renderAlerts();
  showStatus(`Alert ${updated.is_active ? 'activated' : 'paused'}.`, 'success');
}

// ── Delete ────────────────────────────────────────────────────

function openDeleteModal(alertId) {
  pendingDeleteId = alertId;
  const alert = allAlerts.find(a => a.alert_id === alertId);
  if (!alert) return;
  document.getElementById('sa-delete-msg').textContent =
    `Delete the alert for "${alert.user_category}"? This cannot be undone.`;
  document.getElementById('sa-delete-overlay').classList.remove('hidden');
}

function closeDeleteModal() {
  document.getElementById('sa-delete-overlay').classList.add('hidden');
  pendingDeleteId = null;
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('sa-delete-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  try {
    const res = await apiDeleteAlert(pendingDeleteId);
    if (!res || !res.ok) {
      showStatus('Failed to delete alert.', 'error');
      return;
    }
    allAlerts = allAlerts.filter(a => a.alert_id !== pendingDeleteId);
    closeDeleteModal();
    renderAlerts();
    showStatus('Alert deleted.', 'success');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
}

// ── Manual Check ──────────────────────────────────────────────

async function triggerManualCheck() {
  const btn = document.querySelector('.btn-manual-check');
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Checking…';

  try {
    const res = await apiManualCheck();
    if (!res || !res.ok) {
      showStatus('Manual check failed.', 'error');
      return;
    }
    const data = await res.json();
    showStatus(
      `Check complete — ${data.alerts_checked} alert${data.alerts_checked !== 1 ? 's' : ''} evaluated, ${data.emails_sent} email${data.emails_sent !== 1 ? 's' : ''} sent.`,
      'success'
    );
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// ── Init ───────────────────────────────────────────────────────

async function init() {
  // Auth guard
  if (!window.LOCAL_AUTO_LOGIN_ENABLED) {
    if (!token || !currentUser) {
      window.location.href = 'index.html';
      return;
    }
  }

  const loading = document.getElementById('sa-loading');
  loading.style.display = '';

  const [, categories] = await Promise.all([fetchAlerts(), fetchCategoriesWithCache()]);
  allCategories = categories;

  loading.style.display = 'none';
  renderAlerts();
}

init();
