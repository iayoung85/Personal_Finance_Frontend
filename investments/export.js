// ============================================================
// investments/export.js — Holdings & ETF Exposure exports
// CSV, JSON, and clipboard. Consumed by the action bar.
// ============================================================

/**
 * Download holdings as JSON (full enriched data).
 */
function exportHoldingsJSON() {
  const selected = getSelectedAccountIds();
  if (selected.length === 0) { alert('Select at least one account.'); return; }

  const grouped = _buildGroupedByTicker(selected);
  const jsonStr = JSON.stringify(grouped, null, 2);
  downloadAsFile(jsonStr, 'holdings.json', 'application/json');
  showInvestmentMessage('JSON downloaded', 'success');
}

/**
 * Download holdings as CSV.
 */
function downloadHoldingsCSV() {
  const csv = _buildHoldingsCSV();
  if (!csv) return;
  downloadAsFile(csv, 'holdings.csv', 'text/csv;charset=utf-8;');
  showInvestmentMessage('CSV downloaded', 'success');
}

/**
 * Copy holdings CSV to clipboard.
 */
function copyHoldingsCSV() {
  const csv = _buildHoldingsCSV();
  if (!csv) return;
  navigator.clipboard.writeText(csv)
    .then(() => showInvestmentMessage('CSV copied to clipboard', 'success'))
    .catch(() => alert('Failed to copy CSV'));
}

/**
 * Download ETF exposure data as CSV — only when the exposure panel has data.
 */
function exportEtfExposureCSV() {
  const panel = document.getElementById('etf-exposure-panel');
  if (!panel || panel.style.display === 'none') {
    alert('No ETF exposure data available. Load the exposure panel first.');
    return;
  }

  const rows = panel.querySelectorAll('.etf-exposure-table tbody tr');
  if (rows.length === 0) {
    alert('No ETF exposure data to export.');
    return;
  }

  const csvRows = [['Company Ticker', 'Company Name', 'Implied Exposure ($)', 'Contributing ETFs', 'Also Held Directly']];

  rows.forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 4) {
      const ticker = (cells[0].textContent || '').trim();
      const name = (cells[1].textContent || '').trim();
      const exposure = (cells[2].textContent || '').trim().replace(/[^0-9.-]/g, '');
      const etfs = (cells[3].textContent || '').trim();
      const hasBadge = row.querySelector('.direct-overlap-badge') !== null;
      csvRows.push([ticker, name, exposure, etfs, hasBadge ? 'Yes' : 'No'].map(csvEscape));
    }
  });

  const csvStr = csvRows.map(row => row.join(',')).join('\n');
  downloadAsFile(csvStr, 'etf-exposure.csv', 'text/csv;charset=utf-8;');
  showInvestmentMessage('ETF exposure CSV downloaded', 'success');
}

// ─── Shared CSV builder ──────────────────────────────────────

function _buildHoldingsCSV() {
  const selected = getSelectedAccountIds();
  if (selected.length === 0) { alert('Select at least one account.'); return null; }
  const grouped = _buildGroupedByTicker(selected);
  if (grouped.length === 0) { alert('No holdings found.'); return null; }

  const rows = [['Ticker', 'Name', 'Type', 'Sector', 'Industry', 'Allocation', 'Qty', 'Price', 'Value', 'Cost Basis', 'Gain/Loss']];
  grouped.forEach(group => {
    const gainLoss = _computeGainLoss(group.total_value, group.total_cost_basis);
    const security = securitiesData.find(s => s.security_id === group.security_id);
    const allocCategory = security ? (security.enriched_allocation_category || '') : '';

    rows.push([
      group.ticker || '',
      group.name || '',
      group.type || '',
      group.sector || '',
      group.industry || '',
      allocCategory,
      group.total_quantity.toFixed(4),
      group.price != null ? group.price.toFixed(2) : '',
      group.total_value != null ? group.total_value.toFixed(2) : '',
      group.total_cost_basis != null ? group.total_cost_basis.toFixed(2) : '',
      gainLoss != null ? gainLoss.toFixed(2) : ''
    ].map(csvEscape));
  });

  return rows.map(row => row.join(',')).join('\n');
}

/**
 * Download holdings as CSV broken out per account.
 */
function downloadHoldingsByAccountCSV() {
  const selected = getSelectedAccountIds();
  if (selected.length === 0) { alert('Select at least one account.'); return; }
  const accountGroups = _buildGroupedByAccount(selected);
  if (accountGroups.length === 0) { alert('No holdings found.'); return; }

  const rows = [['Account', 'Ticker', 'Name', 'Type', 'Sector', 'Industry', 'Qty', 'Price', 'Value', 'Cost Basis', 'Gain/Loss']];

  accountGroups.forEach(group => {
    const accountLabel = `${group.institution} — ${group.account_name}`;
    group.holdings.forEach(h => {
      const gainLoss = (h.value != null && h.cost_basis != null) ? (h.value - h.cost_basis) : null;
      rows.push([
        accountLabel,
        h.ticker || '',
        h.name || '',
        h.type || '',
        h.sector || '',
        h.industry || '',
        h.quantity.toFixed(4),
        h.price != null ? h.price.toFixed(2) : '',
        h.value != null ? h.value.toFixed(2) : '',
        h.cost_basis != null ? h.cost_basis.toFixed(2) : '',
        gainLoss != null ? gainLoss.toFixed(2) : ''
      ].map(csvEscape));
    });
  });

  const csv = rows.map(row => row.join(',')).join('\n');
  downloadAsFile(csv, 'holdings-by-account.csv', 'text/csv;charset=utf-8;');
  showInvestmentMessage('Per-account CSV downloaded', 'success');
}
