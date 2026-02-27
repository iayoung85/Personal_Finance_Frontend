// ============================================================
// transactions/utils.js — Shared Pure Helpers
// Small utility functions used across multiple modules.
// No business logic, no network calls.
// ============================================================

// System-generated bookkeeping transaction source types.
// Mirror of SYSTEM_TRANSACTION_SOURCES in transactions_models.py.
// These rows are internal to the balance engine and must be excluded from
// all user-facing charts, insights, category lists, and aggregations.
const SYSTEM_SOURCES = new Set([
  'opening_balance',
  'manual_opening_balance',
  'reconciliation',
]);

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  statusDiv.style.display = 'block';
}

function clearStatus() {
  const statusDiv = document.getElementById('status-message');
  statusDiv.style.display = 'none';
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
