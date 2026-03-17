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

// ── Stub: Export functions (Phase 6 will implement fully) ────

function exportHoldingsJSON() {
  const selected = getSelectedAccountIds();
  if (selected.length === 0) { alert('Select at least one account.'); return; }
  // Minimal JSON export of grouped holdings
  const grouped = _buildGroupedByTicker(selected);
  const jsonStr = JSON.stringify(grouped, null, 2);
  downloadAsFile(jsonStr, 'holdings.json', 'application/json');
}

function copyHoldingsCSV() {
  const csv = _buildHoldingsCSV();
  if (!csv) return;
  navigator.clipboard.writeText(csv)
    .then(() => showInvestmentMessage('CSV copied to clipboard', 'success'))
    .catch(() => alert('Failed to copy CSV'));
}

function downloadHoldingsCSV() {
  const csv = _buildHoldingsCSV();
  if (!csv) return;
  downloadAsFile(csv, 'holdings.csv', 'text/csv;charset=utf-8;');
}

function _buildHoldingsCSV() {
  const selected = getSelectedAccountIds();
  if (selected.length === 0) { alert('Select at least one account.'); return null; }
  const grouped = _buildGroupedByTicker(selected);
  if (grouped.length === 0) { alert('No holdings found.'); return null; }

  const rows = [['Ticker', 'Name', 'Type', 'Sector', 'Industry', 'Qty', 'Price', 'Value', 'Cost Basis', 'Gain/Loss']];
  grouped.forEach(group => {
    const gainLoss = _computeGainLoss(group.total_value, group.total_cost_basis);
    rows.push([
      group.ticker || '',
      group.name || '',
      group.type || '',
      group.sector || '',
      group.industry || '',
      group.total_quantity.toFixed(4),
      group.price != null ? group.price.toFixed(2) : '',
      group.total_value != null ? group.total_value.toFixed(2) : '',
      group.total_cost_basis != null ? group.total_cost_basis.toFixed(2) : '',
      gainLoss != null ? gainLoss.toFixed(2) : ''
    ]);
  });

  return rows.map(row => row.map(csvEscape).join(',')).join('\n');
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
}
