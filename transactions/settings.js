// ============================================================
// transactions/settings.js — Viewer Settings
// Load, apply, and save transaction viewer preferences
// (optional fields, timezone, toggles) to/from backend.
// ============================================================

const SHOW_UNMATCHED_ONLY_STORAGE_KEY = 'pf_show_unmatched_only';

function isShowUnmatchedOnlyEnabled() {
  return localStorage.getItem(SHOW_UNMATCHED_ONLY_STORAGE_KEY) === 'true';
}

function setShowUnmatchedOnlyEnabled(enabled) {
  localStorage.setItem(SHOW_UNMATCHED_ONLY_STORAGE_KEY, String(!!enabled));
}

function applyLocalViewerSettings() {
  const showUnmatchedToggle = document.getElementById('show-unmatched-toggle');
  if (showUnmatchedToggle) {
    showUnmatchedToggle.checked = isShowUnmatchedOnlyEnabled();
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
    const showOverridesOnly = document.getElementById('show-overrides-only').checked;
    setShowUnmatchedOnlyEnabled(document.getElementById('show-unmatched-toggle')?.checked);
    
    const settings = {
      optional_fields: optionalFields,
      field_order: ['datetime', 'bank_account', 'description', 'amount', ...optionalFields],
      timezone: timezone,
      hide_transfers: hideTransfers,
      show_overrides_only: showOverridesOnly,
      show_pending: document.getElementById('show-pending-toggle').checked,
      bills_future_days: parseInt(document.getElementById('bills-future-days').value, 10) || 90
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
    
    showStatus('Settings saved successfully — refreshing transactions…', 'success');

    // Why: bills_future_days and other settings affect the server-side
    // transaction payload (e.g. number of bill occurrence pseudo-txns).
    // Re-fetch so the transaction viewer reflects the new settings.
    await fetchAllTransactions(true);
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
    applySettings(null);
  }
}

function applySettings(settings) {
  const resolvedSettings = settings || {};

  if (resolvedSettings.timezone) {
    document.getElementById('timezone').value = resolvedSettings.timezone;
  }
  
  if (resolvedSettings.optional_fields && Array.isArray(resolvedSettings.optional_fields)) {
    $('.field-checkbox').prop('checked', false);
    resolvedSettings.optional_fields.forEach(field => {
      $(`.field-checkbox[value="${field}"]`).prop('checked', true);
    });
  }
  
  // Apply hide_transfers setting (default to false if not set)
  const hideTransfers = resolvedSettings.hide_transfers !== undefined ? resolvedSettings.hide_transfers : false;
  document.getElementById('hide-transfers').checked = hideTransfers;

  // Apply show_overrides_only setting (default to false if not set)
  const showOverridesOnly = resolvedSettings.show_overrides_only !== undefined ? resolvedSettings.show_overrides_only : false;
  document.getElementById('show-overrides-only').checked = showOverridesOnly;

  // Apply show_pending setting (default to false if not set)
  const showPending = resolvedSettings.show_pending !== undefined ? resolvedSettings.show_pending : false;
  document.getElementById('show-pending-toggle').checked = showPending;

  // Apply bills_future_days setting (default to 90 if not set)
  const billsFutureDays = resolvedSettings.bills_future_days !== undefined ? resolvedSettings.bills_future_days : 90;
  document.getElementById('bills-future-days').value = String(billsFutureDays);

  applyLocalViewerSettings();
}
