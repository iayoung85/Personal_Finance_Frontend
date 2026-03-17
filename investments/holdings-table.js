// ============================================================
// investments/holdings-table.js — Dual-mode holdings table
// Pool mode: group by ticker across all accounts.
// Account mode: group by account, then list holdings.
// ============================================================

/**
 * Main entry point — called whenever account selection or filters change.
 */
function renderHoldingsTable() {
  const container = document.getElementById('table-container');
  const selectedIds = getSelectedAccountIds();

  if (selectedIds.length === 0) {
    container.innerHTML = '<div class="empty-state">Select at least one investment account to view holdings.</div>';
    return;
  }

  if (poolAllMode) {
    _renderPoolModeTable(container, selectedIds);
  } else {
    _renderAccountModeTable(container, selectedIds);
  }
}

// ─── Pool Mode: group by ticker ───────────────────────────────

function _renderPoolModeTable(container, selectedIds) {
  const grouped = _buildGroupedByTicker(selectedIds);

  if (grouped.length === 0) {
    container.innerHTML = '<div class="empty-state">No holdings found for selected accounts. Try syncing.</div>';
    return;
  }

  // Apply filters
  const filtered = _applyFilters(grouped);
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No holdings match the current filters.</div>';
    return;
  }

  // Sort
  _sortGroupedHoldings(filtered);

  // Grand total
  const grandTotal = filtered.reduce((sum, group) => sum + group.total_value, 0);

  let html = `
    <table class="transactions-table">
      <thead>
        <tr>
          <th style="width:30px;"></th>
          <th class="sortable" onclick="changeSort('ticker')">Ticker ${_sortIcon('ticker')}</th>
          <th class="sortable" onclick="changeSort('name')">Name ${_sortIcon('name')}</th>
          <th class="sortable" onclick="changeSort('type')">Type ${_sortIcon('type')}</th>
          <th class="sortable" onclick="changeSort('sector')">Sector ${_sortIcon('sector')}</th>
          <th class="sortable" onclick="changeSort('industry')">Industry ${_sortIcon('industry')}</th>
          <th class="sortable" onclick="changeSort('quantity')">Qty ${_sortIcon('quantity')}</th>
          <th class="sortable" onclick="changeSort('price')">Price ${_sortIcon('price')}</th>
          <th class="sortable" onclick="changeSort('total_value')">Value ${_sortIcon('total_value')}</th>
          <th class="sortable" onclick="changeSort('cost_basis')">Cost Basis ${_sortIcon('cost_basis')}</th>
          <th class="sortable" onclick="changeSort('gain_loss')">Gain/Loss ${_sortIcon('gain_loss')}</th>
        </tr>
      </thead>
      <tbody>
  `;

  filtered.forEach((group, index) => {
    const gainLoss = _computeGainLoss(group.total_value, group.total_cost_basis);
    const gainLossClass = gainLoss !== null ? (gainLoss >= 0 ? 'positive-gain' : 'negative-gain') : '';

    html += `
      <tr class="holding-group-header" onclick="toggleGroup('group-${index}', this)">
        <td><span class="expand-icon">▶</span></td>
        <td>${group.ticker || '—'}</td>
        <td>${group.name}</td>
        <td>${group.type || '—'}</td>
        <td>${group.sector || '—'}</td>
        <td>${group.industry || '—'}</td>
        <td>${group.total_quantity.toFixed(4)}</td>
        <td>${formatCurrency(group.price)}</td>
        <td>${formatCurrency(group.total_value)}</td>
        <td>${formatCurrency(group.total_cost_basis)}</td>
        <td class="${gainLossClass}">${_formatGainLoss(gainLoss)}</td>
      </tr>
    `;

    // Detail rows (per-account breakdown)
    group.holdings.forEach(holding => {
      const holdingGainLoss = _computeGainLoss(holding.value, holding.cost_basis);
      const holdingGainClass = holdingGainLoss !== null ? (holdingGainLoss >= 0 ? 'positive-gain' : 'negative-gain') : '';

      html += `
        <tr class="holding-detail-row group-${index}">
          <td></td>
          <td colspan="2" style="font-style:italic; padding-left:40px;">${holding.institution} — ${holding.account_name}</td>
          <td></td>
          <td></td>
          <td></td>
          <td>${holding.quantity.toFixed(4)}</td>
          <td>${formatCurrency(holding.price)}</td>
          <td>${formatCurrency(holding.value)}</td>
          <td>${formatCurrency(holding.cost_basis)}</td>
          <td class="${holdingGainClass}">${_formatGainLoss(holdingGainLoss)}</td>
        </tr>
      `;
    });
  });

  // Grand total row
  html += `
      <tr class="holding-group-header" style="border-top: 2px solid var(--border-primary);">
        <td></td>
        <td colspan="7" style="text-align:right; font-weight:bold;">Total Portfolio Value:</td>
        <td style="font-weight:bold;">${formatCurrency(grandTotal)}</td>
        <td></td>
        <td></td>
      </tr>
    </tbody></table>
  `;

  container.innerHTML = html;
}

// ─── Account Mode: group by account ───────────────────────────

function _renderAccountModeTable(container, selectedIds) {
  const accountGroups = _buildGroupedByAccount(selectedIds);

  if (accountGroups.length === 0) {
    container.innerHTML = '<div class="empty-state">No holdings found for selected accounts. Try syncing.</div>';
    return;
  }

  let html = '';

  accountGroups.forEach(accountGroup => {
    // Apply filters to this account's holdings
    const filtered = _applyFiltersToHoldings(accountGroup.holdings);
    if (filtered.length === 0) return;

    _sortHoldings(filtered);

    const accountTotal = filtered.reduce((sum, holding) => sum + holding.value, 0);

    html += `
      <div class="account-section">
        <div class="account-section-header">
          <span>${accountGroup.institution} — ${accountGroup.account_name}</span>
          <span class="account-section-total">${formatCurrency(accountTotal)}</span>
        </div>
        <table class="transactions-table">
          <thead>
            <tr>
              <th class="sortable" onclick="changeSort('ticker')">Ticker ${_sortIcon('ticker')}</th>
              <th class="sortable" onclick="changeSort('name')">Name ${_sortIcon('name')}</th>
              <th class="sortable" onclick="changeSort('type')">Type ${_sortIcon('type')}</th>
              <th class="sortable" onclick="changeSort('sector')">Sector ${_sortIcon('sector')}</th>
              <th class="sortable" onclick="changeSort('industry')">Industry ${_sortIcon('industry')}</th>
              <th class="sortable" onclick="changeSort('quantity')">Qty ${_sortIcon('quantity')}</th>
              <th class="sortable" onclick="changeSort('price')">Price ${_sortIcon('price')}</th>
              <th class="sortable" onclick="changeSort('total_value')">Value ${_sortIcon('total_value')}</th>
              <th class="sortable" onclick="changeSort('cost_basis')">Cost Basis ${_sortIcon('cost_basis')}</th>
              <th class="sortable" onclick="changeSort('gain_loss')">Gain/Loss ${_sortIcon('gain_loss')}</th>
            </tr>
          </thead>
          <tbody>
    `;

    filtered.forEach(holding => {
      const gainLoss = _computeGainLoss(holding.value, holding.cost_basis);
      const gainLossClass = gainLoss !== null ? (gainLoss >= 0 ? 'positive-gain' : 'negative-gain') : '';

      html += `
        <tr>
          <td>${holding.ticker || '—'}</td>
          <td>${holding.name}</td>
          <td>${holding.type || '—'}</td>
          <td>${holding.sector || '—'}</td>
          <td>${holding.industry || '—'}</td>
          <td>${holding.quantity.toFixed(4)}</td>
          <td>${formatCurrency(holding.price)}</td>
          <td>${formatCurrency(holding.value)}</td>
          <td>${formatCurrency(holding.cost_basis)}</td>
          <td class="${gainLossClass}">${_formatGainLoss(gainLoss)}</td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
  });

  if (!html) {
    container.innerHTML = '<div class="empty-state">No holdings match the current filters.</div>';
    return;
  }

  container.innerHTML = html;
}

// ─── Data builders ────────────────────────────────────────────

function _buildGroupedByTicker(selectedAccountIds) {
  const selectedPlaidIds = new Set(getSelectedPlaidAccountIds());
  const grouped = {};

  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;
    const institution = item.institution_name || 'Unknown';

    const investmentAccs = item.accounts.filter(
      acc => acc.type === 'investment' && selectedPlaidIds.has(acc.account_id)
    );

    investmentAccs.forEach(account => {
      const accountHoldings = item.holdings.filter(h => h.account_id === account.account_id);

      accountHoldings.forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;

        const price = derivePrice(security, holding);
        const key = security.ticker_symbol || security.name;
        const quantity = holding.quantity || 0;
        const value = price > 0 ? (quantity * price) : (holding.institution_value || 0);
        const costBasis = holding.cost_basis != null ? holding.cost_basis : null;

        if (!grouped[key]) {
          grouped[key] = {
            ticker: security.ticker_symbol,
            name: security.name,
            type: security.type,
            sector: security.enriched_sector || security.sector || '',
            industry: security.enriched_industry || security.industry || '',
            price: price,
            total_quantity: 0,
            total_value: 0,
            total_cost_basis: null,
            holdings: []
          };
        }

        if (!grouped[key].price && price) grouped[key].price = price;

        grouped[key].total_quantity += quantity;
        grouped[key].total_value += value;

        // Accumulate cost basis (only when available)
        if (costBasis !== null) {
          grouped[key].total_cost_basis = (grouped[key].total_cost_basis || 0) + costBasis;
        }

        grouped[key].holdings.push({
          institution: institution,
          account_name: account.name || account.official_name || 'Unknown Account',
          quantity: quantity,
          price: price,
          value: value,
          cost_basis: costBasis
        });
      });
    });
  });

  return Object.values(grouped);
}

function _buildGroupedByAccount(selectedAccountIds) {
  const selectedPlaidIds = new Set(getSelectedPlaidAccountIds());
  const accountGroups = [];

  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;
    const institution = item.institution_name || 'Unknown';

    const investmentAccs = item.accounts.filter(
      acc => acc.type === 'investment' && selectedPlaidIds.has(acc.account_id)
    );

    investmentAccs.forEach(account => {
      const accountHoldings = item.holdings.filter(h => h.account_id === account.account_id);
      const holdings = [];

      accountHoldings.forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;

        const price = derivePrice(security, holding);
        const quantity = holding.quantity || 0;
        const value = price > 0 ? (quantity * price) : (holding.institution_value || 0);
        const costBasis = holding.cost_basis != null ? holding.cost_basis : null;

        holdings.push({
          ticker: security.ticker_symbol,
          name: security.name,
          type: security.type,
          sector: security.enriched_sector || security.sector || '',
          industry: security.enriched_industry || security.industry || '',
          quantity: quantity,
          price: price,
          value: value,
          cost_basis: costBasis,
          security_id: holding.security_id
        });
      });

      if (holdings.length > 0) {
        accountGroups.push({
          institution: institution,
          account_name: account.name || account.official_name || 'Unknown Account',
          holdings: holdings
        });
      }
    });
  });

  return accountGroups;
}

// ─── Filtering ────────────────────────────────────────────────

function _applyFilters(groupedHoldings) {
  return groupedHoldings.filter(group => {
    if (filterSecurityType && group.type !== filterSecurityType) return false;
    if (filterSector && group.sector !== filterSector) return false;
    if (filterIndustry && group.industry !== filterIndustry) return false;
    return true;
  });
}

function _applyFiltersToHoldings(holdings) {
  return holdings.filter(holding => {
    if (filterSecurityType && holding.type !== filterSecurityType) return false;
    if (filterSector && holding.sector !== filterSector) return false;
    if (filterIndustry && holding.industry !== filterIndustry) return false;
    return true;
  });
}

// ─── Sorting ──────────────────────────────────────────────────

function changeSort(column) {
  if (holdingsSortColumn === column) {
    holdingsSortDirection = holdingsSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    holdingsSortColumn = column;
    holdingsSortDirection = (column === 'ticker' || column === 'name' || column === 'type' || column === 'sector' || column === 'industry') ? 'asc' : 'desc';
  }
  renderHoldingsTable();
}

function _sortGroupedHoldings(groups) {
  const col = holdingsSortColumn;
  const dir = holdingsSortDirection === 'asc' ? 1 : -1;

  groups.sort((a, b) => {
    let valA = _getSortValue(a, col);
    let valB = _getSortValue(b, col);

    if (typeof valA === 'string') return dir * valA.localeCompare(valB);
    return dir * ((valA || 0) - (valB || 0));
  });
}

function _sortHoldings(holdings) {
  const col = holdingsSortColumn;
  const dir = holdingsSortDirection === 'asc' ? 1 : -1;

  holdings.sort((a, b) => {
    let valA = _getHoldingSortValue(a, col);
    let valB = _getHoldingSortValue(b, col);

    if (typeof valA === 'string') return dir * valA.localeCompare(valB);
    return dir * ((valA || 0) - (valB || 0));
  });
}

function _getSortValue(group, column) {
  switch (column) {
    case 'ticker': return (group.ticker || '').toLowerCase();
    case 'name': return (group.name || '').toLowerCase();
    case 'type': return (group.type || '').toLowerCase();
    case 'sector': return (group.sector || '').toLowerCase();
    case 'industry': return (group.industry || '').toLowerCase();
    case 'quantity': return group.total_quantity;
    case 'price': return group.price;
    case 'total_value': return group.total_value;
    case 'cost_basis': return group.total_cost_basis;
    case 'gain_loss': return _computeGainLoss(group.total_value, group.total_cost_basis);
    default: return group.total_value;
  }
}

function _getHoldingSortValue(holding, column) {
  switch (column) {
    case 'ticker': return (holding.ticker || '').toLowerCase();
    case 'name': return (holding.name || '').toLowerCase();
    case 'type': return (holding.type || '').toLowerCase();
    case 'sector': return (holding.sector || '').toLowerCase();
    case 'industry': return (holding.industry || '').toLowerCase();
    case 'quantity': return holding.quantity;
    case 'price': return holding.price;
    case 'total_value': return holding.value;
    case 'cost_basis': return holding.cost_basis;
    case 'gain_loss': return _computeGainLoss(holding.value, holding.cost_basis);
    default: return holding.value;
  }
}

function _sortIcon(column) {
  if (holdingsSortColumn !== column) return '';
  return holdingsSortDirection === 'asc' ? '▲' : '▼';
}

// ─── Helpers ──────────────────────────────────────────────────

function _computeGainLoss(value, costBasis) {
  if (costBasis === null || costBasis === undefined || !Number.isFinite(costBasis)) return null;
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value - costBasis;
}

function _formatGainLoss(gainLoss) {
  if (gainLoss === null) return '—';
  const prefix = gainLoss >= 0 ? '+' : '';
  return prefix + formatCurrency(gainLoss);
}

function toggleGroup(groupId, headerRow) {
  document.querySelectorAll(`.${groupId}`).forEach(row => row.classList.toggle('expanded'));
  headerRow.classList.toggle('expanded');
}
