// ============================================================
// investments/main.js — Page bootstrap & wiring
// Thin orchestrator: init auth, load data, bind events.
// Must be loaded LAST (depends on all other modules).
// ============================================================

document.addEventListener('DOMContentLoaded', async function() {
  await window.BACKEND_URL_PROMISE;

  if (window.ensureLocalDevSession) {
    window.ensureLocalDevSession();
  }

  // Refresh auth state from localStorage
  authToken = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (_) {
    currentUser = null;
  }

  if (!authToken) {
    window.location.href = 'index.html';
    return;
  }

  // Load accounts first so sidebar exists
  await loadInvestmentAccounts();

  // Load saved viewer settings (view mode, chart preference)
  try {
    const settingsData = await loadViewerSettings();
    const prefs = _parseViewerPrefs(settingsData.optional_fields);
    if (prefs.chartViewMode) chartViewMode = prefs.chartViewMode;
    if (prefs.poolAllMode === false) poolAllMode = false;
  } catch (_settingsError) {
    // Settings may not exist yet — defaults are fine
  }

  // Load vocabulary for sector/industry dropdowns (non-blocking)
  fetchVocabulary().then(data => {
    vocabularySectors = data.sectors || [];
    vocabularyIndustries = data.industries || [];
  }).catch(error => console.warn('Failed to load vocabulary:', error));

  // Load allocation categories (non-blocking)
  fetchAllocationCategories().then(data => {
    allocationCategories = data.categories || [];
  }).catch(error => console.warn('Failed to load allocation categories:', error));

  // Check for newly connected investment items and auto-sync
  const newInvItems = JSON.parse(sessionStorage.getItem('newInvestmentItems') || '[]');
  if (newInvItems.length > 0) {
    for (const itemId of newInvItems) {
      try {
        await syncItemApi(itemId, false);
      } catch (error) {
        console.error(`Auto-sync failed for item ${itemId}:`, error);
      }
    }
    sessionStorage.removeItem('newInvestmentItems');
  }

  // Load holdings
  await loadInvestmentHoldings();
});

/**
 * Load holdings from backend and render the table.
 */
async function loadInvestmentHoldings() {
  const container = document.getElementById('table-container');
  container.innerHTML = '<div class="empty-state">Loading holdings…</div>';

  try {
    const data = await fetchHoldings();
    holdingsData = data.items || [];
    securitiesData = data.securities || [];
    renderFilterStrip();
    renderHoldingsTable();
    renderInvestmentChart();
  } catch (error) {
    console.error('Error loading holdings:', error);
    container.innerHTML = `<div class="error">Error loading holdings: ${error.message}</div>`;
  }
}

/**
 * Called whenever account selection changes — re-render everything.
 */
function onAccountSelectionChanged() {
  renderFilterStrip();
  renderHoldingsTable();
  renderInvestmentChart();
}

/**
 * Show a temporary status message in the action bar.
 */
function showInvestmentMessage(msg, type) {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.innerHTML = `<div class="message ${type}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

// ── Stub: Chart panel toggle (Phase 5 will implement fully) ──

function toggleChartPanel() {
  const panel = document.getElementById('chart-panel');
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderInvestmentChart();
}

function toggleEtfExposurePanel() {
  const panel = document.getElementById('etf-exposure-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.innerHTML.trim();
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) loadEtfExposurePanel();
}

function switchInvestmentChart(mode) {
  chartViewMode = mode;
  document.getElementById('chart-type-btn').classList.toggle('active', mode === 'type');
  document.getElementById('chart-sector-btn').classList.toggle('active', mode === 'sector');
  document.getElementById('chart-alloc-btn').classList.toggle('active', mode === 'allocation');
  renderInvestmentChart();
  _saveViewerPrefs();
}

// ─── Export dropdown ─────────────────────────────────────────

function toggleExportDropdown() {
  const dropdown = document.getElementById('export-dropdown');
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

// Close export dropdown on outside click
document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('export-dropdown');
  const wrapper = event.target.closest('.export-dropdown-wrapper');
  if (!wrapper && dropdown) dropdown.style.display = 'none';
});

// ─── Settings persistence ────────────────────────────────────

function _parseViewerPrefs(optionalFields) {
  if (!optionalFields) return {};
  if (typeof optionalFields === 'string') {
    try { return JSON.parse(optionalFields); } catch (_) { return {}; }
  }
  if (typeof optionalFields === 'object' && !Array.isArray(optionalFields)) return optionalFields;
  return {};
}

function _saveViewerPrefs() {
  const prefs = {
    chartViewMode: chartViewMode,
    poolAllMode: poolAllMode,
  };
  saveViewerSettings(prefs, []).catch(error =>
    console.warn('Failed to save viewer settings:', error)
  );
}

// ── CSV Upload Modal ─────────────────────────────────────────

let _csvFileText = null;

function openCsvUploadModal() {
  _csvFileText = null;
  const modal = document.getElementById('csv-upload-modal');
  const fileInput = document.getElementById('csv-file-input');
  const dropLabel = document.getElementById('csv-drop-label');
  const selectError = document.getElementById('csv-select-error');
  const previewBtn = document.getElementById('csv-preview-btn');
  const bankSelect = document.getElementById('csv-bank-select');

  fileInput.value = '';
  selectError.style.display = 'none';
  previewBtn.disabled = true;
  dropLabel.innerHTML = '<span style="font-size: 24px;">📄</span><span>Drop CSV file here or <a href="#" onclick="event.preventDefault(); document.getElementById(\'csv-file-input\').click();">browse</a></span>';

  // Populate bank dropdown from investment accounts
  _populateCsvBankSelect(bankSelect);

  // Show step 1, hide others
  document.getElementById('csv-step-select').style.display = '';
  document.getElementById('csv-step-preview').style.display = 'none';
  document.getElementById('csv-step-done').style.display = 'none';

  modal.style.display = '';
  _setupCsvDropZone();
}

function closeCsvUploadModal() {
  document.getElementById('csv-upload-modal').style.display = 'none';
  _csvFileText = null;
}

function _populateCsvBankSelect(selectEl) {
  const seen = new Map();
  investmentAccounts.forEach(acc => {
    const bankId = acc.bank_id;
    if (!bankId) return;
    if (!seen.has(bankId)) {
      seen.set(bankId, acc.bank_name || acc.institution_name || 'Unknown Bank');
    }
  });

  let options = '<option value="">— Select a bank —</option>';
  seen.forEach((name, bankId) => {
    options += `<option value="${bankId}">${_escapeHtmlInv(name)}</option>`;
  });
  selectEl.innerHTML = options;
}

function _escapeHtmlInv(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function _setupCsvDropZone() {
  const dropZone = document.getElementById('csv-drop-zone');
  if (dropZone._csvListenersAttached) return;

  dropZone.addEventListener('dragover', function(event) {
    event.preventDefault();
    dropZone.classList.add('csv-drop-zone-active');
  });
  dropZone.addEventListener('dragleave', function() {
    dropZone.classList.remove('csv-drop-zone-active');
  });
  dropZone.addEventListener('drop', function(event) {
    event.preventDefault();
    dropZone.classList.remove('csv-drop-zone-active');
    const files = event.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.csv')) {
      _readCsvFile(files[0]);
    }
  });
  dropZone._csvListenersAttached = true;
}

function onCsvFileSelected() {
  const fileInput = document.getElementById('csv-file-input');
  if (fileInput.files.length > 0) {
    _readCsvFile(fileInput.files[0]);
  }
}

function _readCsvFile(file) {
  const reader = new FileReader();
  reader.onload = function(event) {
    _csvFileText = event.target.result;
    const dropLabel = document.getElementById('csv-drop-label');
    dropLabel.innerHTML = `<span style="font-size: 24px;">✅</span><span>${_escapeHtmlInv(file.name)} (${(file.size / 1024).toFixed(1)} KB)</span>`;
    document.getElementById('csv-preview-btn').disabled = false;
    document.getElementById('csv-select-error').style.display = 'none';
  };
  reader.readAsText(file);
}

async function submitCsvPreview() {
  const bankId = document.getElementById('csv-bank-select').value;
  const errorEl = document.getElementById('csv-select-error');

  if (!bankId) {
    errorEl.textContent = 'Please select a bank.';
    errorEl.style.display = '';
    return;
  }
  if (!_csvFileText) {
    errorEl.textContent = 'Please select a CSV file.';
    errorEl.style.display = '';
    return;
  }

  errorEl.style.display = 'none';
  document.getElementById('csv-preview-btn').disabled = true;

  try {
    const preview = await csvPreviewApi(_csvFileText, bankId);
    _renderCsvPreview(preview);
    document.getElementById('csv-step-select').style.display = 'none';
    document.getElementById('csv-step-preview').style.display = '';
  } catch (previewError) {
    errorEl.textContent = previewError.message;
    errorEl.style.display = '';
    document.getElementById('csv-preview-btn').disabled = false;
  }
}

function _renderCsvPreview(preview) {
  const container = document.getElementById('csv-preview-content');
  const importBtn = document.getElementById('csv-import-btn');

  const accounts = preview.accounts || [];
  const unmapped = preview.unmapped_csv_accounts || [];
  const canImport = preview.can_import;

  let html = '<h3 style="margin: 0 0 8px;">CSV Preview</h3>';

  if (accounts.length > 0) {
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 12px;">';
    html += '<thead><tr><th style="text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border-primary);">CSV Account</th>';
    html += '<th style="text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--border-primary);">Holdings</th>';
    html += '<th style="text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--border-primary);">Total Value</th></tr></thead><tbody>';
    accounts.forEach(acct => {
      const displayName = acct.csv_account_name
        ? `${acct.csv_account_name} (${acct.csv_account_number})`
        : acct.csv_account_number;
      html += `<tr>`;
      html += `<td style="padding: 4px 8px;">${_escapeHtmlInv(displayName)}</td>`;
      html += `<td style="padding: 4px 8px; text-align: right;">${acct.holdings_count}</td>`;
      html += `<td style="padding: 4px 8px; text-align: right;">$${parseFloat(acct.total_value || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>`;
      html += `</tr>`;
    });
    html += '</tbody></table>';
  }

  if (unmapped.length > 0) {
    html += '<div style="background: var(--bg-hover); padding: 10px; border-radius: 6px; margin-bottom: 8px;">';
    html += '<strong style="color: var(--text-heading);">⚠ Unmapped CSV Accounts</strong>';
    html += '<p style="font-size: 12px; color: var(--text-secondary); margin: 4px 0 8px;">These accounts in the CSV are not mapped to any app account. Go to <a href="accounts.html">Accounts</a> and use "Link CSV Data" on each investment account to set the CSV account number.</p>';
    html += '<ul style="margin: 0; padding-left: 20px; font-size: 13px;">';
    unmapped.forEach(acctNum => {
      html += `<li>${_escapeHtmlInv(acctNum)}</li>`;
    });
    html += '</ul></div>';
  }

  if (canImport) {
    html += '<p style="font-size: 13px; color: var(--text-secondary);">This will overwrite existing CSV holdings for the matched accounts.</p>';
    importBtn.disabled = false;
  } else {
    importBtn.disabled = true;
  }

  container.innerHTML = html;
}

function csvBackToSelect() {
  document.getElementById('csv-step-preview').style.display = 'none';
  document.getElementById('csv-step-select').style.display = '';
  document.getElementById('csv-preview-btn').disabled = false;
}

async function submitCsvImport() {
  const bankId = document.getElementById('csv-bank-select').value;
  const errorEl = document.getElementById('csv-preview-error');
  const importBtn = document.getElementById('csv-import-btn');

  errorEl.style.display = 'none';
  importBtn.disabled = true;

  try {
    const result = await csvImportApi(_csvFileText, bankId);
    _renderCsvDone(result);
    document.getElementById('csv-step-preview').style.display = 'none';
    document.getElementById('csv-step-done').style.display = '';

    // Refresh holdings and sidebar
    await loadInvestmentAccounts();
    await loadInvestmentHoldings();
  } catch (importError) {
    errorEl.textContent = importError.message;
    errorEl.style.display = '';
    importBtn.disabled = false;
  }
}

function _renderCsvDone(result) {
  const container = document.getElementById('csv-done-content');
  const accountsUpdated = result.accounts_updated || 0;
  const securitiesUpserted = result.securities_upserted || 0;
  const downloadDate = result.download_date || '—';

  container.innerHTML = `
    <div style="text-align: center; padding: 20px 0;">
      <div style="font-size: 36px; margin-bottom: 12px;">✅</div>
      <h3 style="margin: 0 0 8px;">Import Complete</h3>
      <p style="font-size: 13px; color: var(--text-secondary); margin: 4px 0;">
        ${accountsUpdated} account${accountsUpdated !== 1 ? 's' : ''} updated &bull;
        ${securitiesUpserted} securities processed &bull;
        CSV date: ${_escapeHtmlInv(downloadDate)}
      </p>
    </div>
  `;
}
