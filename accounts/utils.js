// ============================================================
// accounts/utils.js — Shared Helpers
// Currency formatting, badge rendering, validation helpers,
// status toast, and confirmation dialogs. No network calls,
// no direct DOM rendering of page sections.
// ============================================================

/**
 * Format a numeric value as USD currency string.
 */
function formatCurrency(amount, currency = 'USD') {
  const numericAmount = parseFloat(amount) || 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(numericAmount);
}

/**
 * Build the human-readable display name for an account.
 * Custom name takes priority; otherwise "BankName - AccountName (mask)".
 */
function buildAccountDisplayName(account) {
  if (account.custom_name) return account.custom_name;

  const bankName = account.bank_name || '';
  const accountName = account.account_name || 'Unknown Account';
  const mask = account.mask;

  let nameWithMask = accountName;
  if (mask && !accountName.includes(mask)) {
    nameWithMask = `${accountName} (${mask})`;
  }

  return bankName ? `${bankName} - ${nameWithMask}` : nameWithMask;
}

/**
 * Build the display name for a bank. Prefers custom_name.
 */
function buildBankDisplayName(bank) {
  return bank.custom_name || bank.bank_name || 'Unknown Bank';
}

/**
 * Create HTML for an origin badge.
 */
function renderOriginBadge(origin) {
  const cssClass = origin === 'plaid' ? 'badge-origin-plaid' : 'badge-origin-manual';
  const label = origin === 'plaid' ? 'Plaid' : 'Manual';
  return `<span class="badge ${cssClass}">${label}</span>`;
}

/**
 * Create HTML for a connection status badge.
 */
function renderConnectionBadge(connectionStatus) {
  const map = {
    linked:    { css: 'badge-conn-linked',    label: 'Linked' },
    dormant:   { css: 'badge-conn-dormant',   label: 'Dormant' },
    converted: { css: 'badge-conn-converted', label: 'Converted' },
    manual:    { css: 'badge-conn-manual',    label: 'Manual' }
  };
  const entry = map[connectionStatus] || map.manual;
  return `<span class="badge ${entry.css}">${entry.label}</span>`;
}

/**
 * Create HTML for a health badge (only meaningful when connection=linked).
 * Requires bank-level item health info which may come from the plaid_item status.
 */
function renderHealthBadge(connectionStatus, itemHealth) {
  if (connectionStatus !== 'linked') return '';

  if (!itemHealth || itemHealth === 'active' || itemHealth === 'ok') {
    return '<span class="badge badge-health-ok">✓ OK</span>';
  }
  if (itemHealth === 'needs_update') {
    return '<span class="badge badge-health-warn">⚠ Needs Update</span>';
  }
  return '<span class="badge badge-health-error">✗ Error</span>';
}

/**
 * Create HTML for an archived badge (shown when is_archived=true).
 */
function renderArchivedBadge(isArchived) {
  if (!isArchived) return '';
  return '<span class="badge badge-archived">Archived</span>';
}

/**
 * Create HTML for a category badge.
 */
function renderCategoryBadge(category) {
  if (!category) return '';
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  return `<span class="badge badge-category">${label}</span>`;
}

/**
 * Return the CSS class for a status dot based on connection_status and optional health.
 */
function getStatusDotClass(connectionStatus, itemHealth) {
  if (connectionStatus === 'linked') {
    if (itemHealth === 'needs_update') return 'needs-update';
    if (itemHealth === 'error') return 'error';
    return 'linked';
  }
  if (connectionStatus === 'converted') return 'converted';
  return 'manual';
}

/**
 * Show a floating status toast message.
 */
function showToast(message, type = 'info') {
  const toast = document.getElementById('status-toast');
  toast.textContent = message;
  toast.className = `status-toast ${type}`;
  // Auto-hide after delay
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, type === 'error' ? 5000 : 3000);
}

/**
 * Open the reusable confirmation modal.
 * @param {string} title - Modal title.
 * @param {string} message - Description of what will happen.
 * @param {Function} onConfirm - Callback when user confirms.
 * @param {object} options - { buttonLabel: string, buttonClass: string }
 */
function openConfirmModal(title, message, onConfirm, options = {}) {
  const {
    buttonLabel = 'Confirm',
    buttonClass = 'btn-danger'
  } = options;

  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-message').textContent = message;

  const confirmBtn = document.getElementById('confirm-modal-btn');
  confirmBtn.textContent = buttonLabel;
  confirmBtn.className = buttonClass;

  pendingConfirmAction = { onConfirm };

  document.getElementById('confirm-modal').classList.remove('hidden');

  // Auto-focus the confirm button so Enter triggers it immediately
  confirmBtn.focus();
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.add('hidden');
  pendingConfirmAction = null;
}

function executeConfirmedAction() {
  if (!pendingConfirmAction) return;
  const { onConfirm } = pendingConfirmAction;
  closeConfirmModal();
  onConfirm();
}

/**
 * Populate the category <select> options from the categoriesReference cache.
 */
function populateCategorySelect(selectElement, selectedValue = '') {
  let html = '<option value="">— Select Category —</option>';
  for (const [key, catInfo] of Object.entries(categoriesReference)) {
    const selected = key === selectedValue ? ' selected' : '';
    const label = catInfo.label || key;
    html += `<option value="${key}"${selected}>${label}</option>`;
  }
  selectElement.innerHTML = html;
}

/**
 * Populate subcategory <select> based on a chosen category.
 */
function populateSubcategorySelect(selectElement, category, selectedValue = '') {
  let html = '<option value="">— Optional —</option>';
  const catInfo = categoriesReference[category];
  if (catInfo && catInfo.subtypes) {
    for (const subtype of catInfo.subtypes) {
      const selected = subtype === selectedValue ? ' selected' : '';
      const label = subtype.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      html += `<option value="${subtype}"${selected}>${label}</option>`;
    }
  }
  selectElement.innerHTML = html;
}

/**
 * Build an info-button + collapsible tooltip snippet.
 * @param {string} tooltipId - Unique ID for toggling.
 * @param {string} tooltipText - Help text.
 */
function renderInfoButton(tooltipId, tooltipText) {
  return `
    <button class="info-btn" onclick="toggleInfoTooltip('${tooltipId}')" title="More info">ⓘ</button>
    <div id="${tooltipId}" class="info-tooltip">${tooltipText}</div>
  `;
}

function toggleInfoTooltip(tooltipId) {
  const el = document.getElementById(tooltipId);
  if (el) el.classList.toggle('visible');
}
