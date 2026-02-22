// ============================================================
// transactions/settings.js — Viewer Settings
// Load, apply, and save transaction viewer preferences
// (optional fields, timezone, toggles) to/from backend.
// ============================================================

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
    
    const settings = {
      optional_fields: optionalFields,
      field_order: ['datetime', 'bank_account', 'name', 'amount', ...optionalFields],
      timezone: timezone,
      hide_transfers: hideTransfers,
      show_overrides_only: showOverridesOnly
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

  // Apply show_overrides_only setting (default to false if not set)
  const showOverridesOnly = settings.show_overrides_only !== undefined ? settings.show_overrides_only : false;
  document.getElementById('show-overrides-only').checked = showOverridesOnly;
}
