// ============================================================
// transactions/inspect-data.js — Inspect Transaction Data Modal
// Fetches the immutable Plaid raw blob and the app's working
// blob, then renders them side-by-side so the user can see
// exactly what Plaid sent vs. what the app currently holds.
// ============================================================

/**
 * Open the inspect data modal for a given transaction.
 * Fetches raw + app data from the backend, then renders
 * a two-column comparison view.
 */
async function openInspectDataModal(transactionId) {
  const overlay = document.getElementById('inspect-data-modal');
  if (!overlay) return;

  const bodyEl = document.getElementById('inspect-data-body');
  bodyEl.innerHTML = '<p class="inspect-loading">Loading transaction data…</p>';
  overlay.classList.remove('hidden');

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/raw/${encodeURIComponent(transactionId)}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      bodyEl.innerHTML = `<p class="inspect-error">Failed to load: ${errorData.error || response.statusText}</p>`;
      return;
    }

    const { plaid_raw: plaidRaw, app_data: appData } = await response.json();
    _renderInspectPanels(bodyEl, plaidRaw, appData);
  } catch (networkError) {
    bodyEl.innerHTML = `<p class="inspect-error">Network error: ${networkError.message}</p>`;
  }
}

function closeInspectDataModal() {
  const overlay = document.getElementById('inspect-data-modal');
  if (overlay) overlay.classList.add('hidden');
}

// ─── Rendering helpers ────────────────────────────────────────

function _renderInspectPanels(containerEl, plaidRaw, appData) {
  let html = '<div class="inspect-panels">';

  // Left panel: Plaid raw blob
  html += '<div class="inspect-panel">';
  html += '<h3 class="inspect-panel-title">Plaid Raw Data</h3>';
  if (plaidRaw) {
    html += _renderObjectAsTree(plaidRaw);
  } else {
    html += '<p class="inspect-empty">No raw Plaid blob stored for this transaction. '
          + 'This transaction was synced before the raw-blob column was added, '
          + 'or it is not a Plaid-sourced transaction.</p>';
  }
  html += '</div>';

  // Right panel: App working data
  html += '<div class="inspect-panel">';
  html += '<h3 class="inspect-panel-title">App Working Data</h3>';
  html += _renderObjectAsTree(appData);
  html += '</div>';

  html += '</div>';
  containerEl.innerHTML = html;
}

/**
 * Recursively render a JS object/array as a collapsible tree of
 * key-value rows.  Handles nested objects, arrays, and primitives.
 */
function _renderObjectAsTree(obj, depth = 0) {
  if (obj === null || obj === undefined) {
    return '<span class="inspect-null">null</span>';
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '<span class="inspect-empty-val">[]</span>';
    let html = '<div class="inspect-array">';
    obj.forEach((item, index) => {
      html += `<div class="inspect-row" style="padding-left:${depth * 12}px">`;
      html += `<span class="inspect-key">[${index}]</span>`;
      if (typeof item === 'object' && item !== null) {
        html += _renderObjectAsTree(item, depth + 1);
      } else {
        html += `<span class="inspect-value">${_escapeHtml(String(item))}</span>`;
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    if (keys.length === 0) return '<span class="inspect-empty-val">{}</span>';
    let html = '<div class="inspect-object">';
    keys.forEach(key => {
      const value = obj[key];
      html += `<div class="inspect-row" style="padding-left:${depth * 12}px">`;
      html += `<span class="inspect-key">${_escapeHtml(key)}:</span> `;
      if (typeof value === 'object' && value !== null) {
        html += _renderObjectAsTree(value, depth + 1);
      } else if (value === null || value === undefined) {
        html += '<span class="inspect-null">null</span>';
      } else if (typeof value === 'boolean') {
        html += `<span class="inspect-bool">${value}</span>`;
      } else if (typeof value === 'number') {
        html += `<span class="inspect-number">${value}</span>`;
      } else {
        html += `<span class="inspect-value">${_escapeHtml(String(value))}</span>`;
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  return `<span class="inspect-value">${_escapeHtml(String(obj))}</span>`;
}

function _escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
