// ============================================================
// transactions/utils.js — Shared Pure Helpers
// Small utility functions used across multiple modules.
// No business logic, no network calls.
// ============================================================

// System-generated bookkeeping transaction source types.
// Mirror of SYSTEM_TRANSACTION_SOURCES in transactions_models.py.
// Kept for any remaining raw-source checks. Prefer isSystemType(getTransactionType(txn))
// from transaction-types.js for new code.
const SYSTEM_SOURCES = new Set([
  'opening_balance',
  'manual_opening_balance',
  'reconciliation',
  'investment_trending',
]);

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _REVIEW_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-03" -> "Oct 3"; anything unparseable is returned as given. */
function _reviewShortDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return String(isoDate || '');
  return `${_REVIEW_MONTHS[Number(match[2]) - 1]} ${Number(match[3])}`;
}

/** "-12.5" -> "-$12.50"; non-numeric values are returned as given. */
function _reviewMoney(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(number)) {
    return String(value ?? '');
  }
  const text = `$${Math.abs(number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return number < 0 ? `-${text}` : text;
}

/**
 * One entry of a plaid_modified detail's `changes` list, as a phrase that
 * carries its own verb ("changed ...", "replaced your ...").
 */
function _describeReviewChange(change) {
  const from = change.from;
  const to = change.to;
  if (change.reverted_user_edit) {
    if (change.field === 'amount') {
      return `replaced your edited amount ${_reviewMoney(from)} with ${_reviewMoney(to)}`;
    }
    if (change.field === 'transaction_date') {
      return `replaced your date ${_reviewShortDate(from)} with ${_reviewShortDate(to)}`;
    }
  }
  switch (change.field) {
    case 'amount':
      return `changed amount from ${_reviewMoney(from)} to ${_reviewMoney(to)}`;
    case 'transaction_date':
      return `changed date from ${_reviewShortDate(from)} to ${_reviewShortDate(to)}`;
    case 'description':
      return `changed description from "${from ?? ''}" to "${to ?? ''}"`;
    case 'merchant_name':
      return `changed merchant from ${from ?? 'none'} to ${to ?? 'none'}`;
    case 'status':
      return (from === 'pending' && to === 'cleared')
        ? 'cleared the pending charge'
        : `changed status from ${from ?? 'none'} to ${to ?? 'none'}`;
    default:
      return '';
  }
}

/**
 * Plain-language reason a transaction is unreviewed, from the API's
 * review_reason fields. Returns plain text (not HTML-escaped), or '' when
 * the reason is null or a code this client does not know.
 *
 * @param {Object} txn - Transaction with review_reason, review_reason_at (naive UTC ISO), review_reason_detail, pending.
 * @returns {string}
 */
function describeReviewReason(txn) {
  if (!txn || !txn.review_reason) return '';
  const detail = txn.review_reason_detail || {};
  let text;

  switch (txn.review_reason) {
    case 'plaid_new':
      text = txn.pending ? 'New pending charge from Plaid' : 'New from Plaid';
      break;
    case 'plaid_posted_from_pending':
      text = 'Posted by the bank, replacing its pending charge';
      break;
    case 'plaid_modified': {
      const phrases = (Array.isArray(detail.changes) ? detail.changes : [])
        .map(_describeReviewChange)
        .filter(Boolean);
      text = phrases.length ? `Plaid ${phrases.join(', ')}` : 'Plaid changed this transaction';
      break;
    }
    case 'plaid_redelivered':
      text = 'Plaid sent this back after removing it';
      break;
    case 'plaid_removed_kept':
      text = 'Plaid removed this from the bank feed; kept in your ledger';
      break;
    case 'transfer_unlinked':
      text = detail.partner_account_name
        ? `Its transfer pair with ${detail.partner_account_name} was unlinked`
        : 'Its transfer pair was unlinked';
      break;
    default:
      return '';
  }

  if (txn.review_reason_at) {
    // The API sends naive UTC; without the Z the browser would read it as local time.
    const raw = String(txn.review_reason_at);
    const when = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
    if (!Number.isNaN(when.getTime())) {
      text += ` (${_REVIEW_MONTHS[when.getMonth()]} ${when.getDate()})`;
    }
  }
  return text;
}

/**
 * Hover text for the unreviewed dot: the reason (if any), then the action.
 * Plain text with a newline; escape before putting it in an attribute.
 */
function unreviewedDotTitle(txn) {
  const reason = describeReviewReason(txn);
  return reason ? `${reason}\nClick to mark reviewed` : 'Click to mark reviewed';
}

/**
 * Format an underscore-separated string to Title Case.
 * Example: "FOOD_AND_DRINK" → "Food And Drink"
 */
function formatCategoryDisplay(value) {
  return (value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('status-message');
  statusDiv.className = `status-message ${type}`;
  statusDiv.textContent = message;
  // Do NOT toggle display — space is always reserved by CSS min-height.
  // Visibility is controlled by the type class in transactions.css.
}

function clearStatus() {
  // Intentionally empty — the status bar is dedicated space that always
  // shows the most recent message. showStatus() overwrites as needed.
}

/**
 * Build a date-range string for export filenames.
 * Returns "YYYY-MM-DD_to_YYYY-MM-DD".
 */
function getDateRange() {
  const start = document.getElementById('start-date').value;
  const end = document.getElementById('end-date').value;
  return `${start}_to_${end}`;
}

// ===== Generic Reusable Modal =====

function openModal({ title, body, actions }) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay) {
    const newOverlay = document.createElement('div');
    newOverlay.id = 'modal-overlay';
    newOverlay.className = 'modal-overlay hidden';
    newOverlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="modal-title"></h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div id="modal-body" class="modal-body"></div>
        <div id="modal-actions" class="modal-actions"></div>
      </div>
    `;
    document.body.appendChild(newOverlay);
  }

  const overlay2 = document.getElementById('modal-overlay');
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

  overlay2.classList.remove('hidden');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ===== Confirmation Dialog =====

function showConfirmationDialog(title, message, onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;';
  
  const dialog = document.createElement('div');
  dialog.className = 'confirmation-dialog';
  dialog.innerHTML = `
    <h3>${title}</h3>
    <p>${message}</p>
    <div class="confirmation-dialog-buttons">
      <button class="confirm-btn" onclick="this.closest('.confirmation-dialog').parentElement.remove()">No, Cancel</button>
      <button class="cancel-btn" onclick="this.closest('.confirmation-dialog').parentElement.remove()">Yes, Confirm</button>
    </div>
  `;
  
  const confirmBtn = dialog.querySelector('.cancel-btn');
  confirmBtn.onclick = () => {
    backdrop.remove();
    onConfirm();
  };
  
  const cancelBtn = dialog.querySelector('.confirm-btn');
  cancelBtn.onclick = () => {
    backdrop.remove();
  };
  
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
}
