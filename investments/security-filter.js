// ============================================================
// investments/security-filter.js — Filter controls for holdings
// Renders type / sector / industry dropdowns above the table.
// Filters apply additively (type AND sector AND industry).
// ============================================================

/**
 * Build and render the filter strip into #filter-strip.
 * Populates dropdowns from the user's current holdings data
 * so only relevant options appear.
 */
function renderFilterStrip() {
  const container = document.getElementById('filter-strip');
  if (!container) return;

  const presentTypes = _collectPresentValues('type');
  const presentSectors = _collectPresentValues('sector');
  const presentIndustries = _collectPresentIndustries();

  container.innerHTML = `
    <label class="inv-filter-label">
      Type
      <select id="filter-type" onchange="onFilterChange()">
        <option value="">All Types</option>
        ${presentTypes.map(type =>
          `<option value="${type}" ${filterSecurityType === type ? 'selected' : ''}>${_formatTypeName(type)}</option>`
        ).join('')}
      </select>
    </label>
    <label class="inv-filter-label">
      Sector
      <select id="filter-sector" onchange="onSectorFilterChange()">
        <option value="">All Sectors</option>
        ${presentSectors.map(sector =>
          `<option value="${sector}" ${filterSector === sector ? 'selected' : ''}>${sector}</option>`
        ).join('')}
      </select>
    </label>
    <label class="inv-filter-label">
      Industry
      <select id="filter-industry" onchange="onFilterChange()">
        <option value="">All Industries</option>
        ${presentIndustries.map(industry =>
          `<option value="${industry}" ${filterIndustry === industry ? 'selected' : ''}>${industry}</option>`
        ).join('')}
      </select>
    </label>
    <button class="btn-clear-filters" onclick="clearAllFilters()" style="display:${_hasActiveFilters() ? 'inline-block' : 'none'};">
      Clear Filters
    </button>
    <label class="inv-filter-label inv-pool-toggle">
      <input type="checkbox" id="pool-holdings-cb" ${poolHoldings ? 'checked' : ''}
             onchange="onPoolHoldingsToggle(this.checked)">
      Pool Holdings
    </label>
    <div class="inv-filter-actions">
      <button class="btn-chart-toggle" onclick="toggleChartPanel()">
        📊 Chart
      </button>
      <button class="btn-chart-toggle" onclick="toggleEtfExposurePanel()">
        🔍 ETF Exposure
      </button>
    </div>
  `;
}

function onFilterChange() {
  filterSecurityType = document.getElementById('filter-type').value;
  filterSector = document.getElementById('filter-sector').value;
  filterIndustry = document.getElementById('filter-industry').value;
  renderHoldingsTable();
  _updateClearButton();
}

function onSectorFilterChange() {
  filterSector = document.getElementById('filter-sector').value;
  filterIndustry = '';
  _rebuildIndustryDropdown();
  renderHoldingsTable();
  _updateClearButton();
}

function clearAllFilters() {
  filterSecurityType = '';
  filterSector = '';
  filterIndustry = '';
  renderFilterStrip();
  renderHoldingsTable();
}

function onPoolHoldingsToggle(checked) {
  poolHoldings = checked;
  renderHoldingsTable();
  renderInvestmentChart();
  if (typeof _saveViewerPrefs === 'function') _saveViewerPrefs();
}

// ── Internal helpers ─────────────────────────────────────────

function _collectPresentValues(field) {
  const values = new Set();
  const selectedPlaidIds = new Set(getSelectedPlaidAccountIds());

  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;
    const investmentAccs = item.accounts.filter(
      acc => acc.type === 'investment' && selectedPlaidIds.has(acc.account_id)
    );
    investmentAccs.forEach(account => {
      item.holdings.filter(h => h.account_id === account.account_id).forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;

        if (field === 'type' && security.type) {
          values.add(security.type);
        } else if (field === 'sector') {
          const sector = security.enriched_sector || security.sector || '';
          if (sector) values.add(sector);
        }
      });
    });
  });

  return Array.from(values).sort();
}

function _collectPresentIndustries() {
  const values = new Set();
  const selectedPlaidIds = new Set(getSelectedPlaidAccountIds());

  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;
    const investmentAccs = item.accounts.filter(
      acc => acc.type === 'investment' && selectedPlaidIds.has(acc.account_id)
    );
    investmentAccs.forEach(account => {
      item.holdings.filter(h => h.account_id === account.account_id).forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;

        const sector = security.enriched_sector || security.sector || '';
        const industry = security.enriched_industry || security.industry || '';

        if (!industry) return;
        if (filterSector && sector !== filterSector) return;
        values.add(industry);
      });
    });
  });

  return Array.from(values).sort();
}

function _rebuildIndustryDropdown() {
  const industrySelect = document.getElementById('filter-industry');
  if (!industrySelect) return;

  const presentIndustries = _collectPresentIndustries();
  industrySelect.innerHTML = `
    <option value="">All Industries</option>
    ${presentIndustries.map(industry =>
      `<option value="${industry}">${industry}</option>`
    ).join('')}
  `;
}

function _hasActiveFilters() {
  return filterSecurityType || filterSector || filterIndustry;
}

function _updateClearButton() {
  const clearBtn = document.querySelector('.btn-clear-filters');
  if (clearBtn) {
    clearBtn.style.display = _hasActiveFilters() ? 'inline-block' : 'none';
  }
}

function _formatTypeName(type) {
  if (!type) return 'Unknown';
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
