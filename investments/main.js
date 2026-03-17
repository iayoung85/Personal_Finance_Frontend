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
    loadEtfExposurePanel();
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
  loadEtfExposurePanel();
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
