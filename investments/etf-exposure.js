// ============================================================
// investments/etf-exposure.js — ETF Implied Exposure Panel
// Shows synthetic exposure through ETF holdings and allows
// users to contribute constituent data for unrecognized ETFs.
// ============================================================

/**
 * Main entry: detect ETFs in the user's holdings,
 * fetch exposure data, and render the panel.
 */
async function loadEtfExposurePanel() {
  const panel = document.getElementById('etf-exposure-panel');
  if (!panel) return;

  const etfHoldings = _collectUserEtfHoldings();
  if (etfHoldings.length === 0) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div class="etf-exposure-loading">Loading ETF exposure…</div>';

  try {
    const tickers = etfHoldings.map(h => h.ticker);
    const values = etfHoldings.map(h => h.value);
    const data = await fetchEtfExposure(tickers, values);

    const directTickers = _collectDirectStockTickers();
    _renderExposurePanel(panel, data, directTickers, etfHoldings);
  } catch (error) {
    console.error('ETF exposure error:', error);
    panel.innerHTML = `<div class="etf-exposure-error">Failed to load ETF exposure data.</div>`;
  }
}

// ─── Data collection ─────────────────────────────────────────

function _collectUserEtfHoldings() {
  const selectedPlaidIds = new Set(getSelectedPlaidAccountIds());
  const etfMap = {};

  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;

    const investmentAccs = item.accounts.filter(
      acc => acc.type === 'investment' && selectedPlaidIds.has(acc.account_id)
    );

    investmentAccs.forEach(account => {
      item.holdings.filter(h => h.account_id === account.account_id).forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;
        if (security.type !== 'etf') return;

        const ticker = security.ticker_symbol;
        if (!ticker) return;

        const price = derivePrice(security, holding);
        const quantity = holding.quantity || 0;
        const value = price > 0 ? (quantity * price) : (holding.institution_value || 0);

        if (!etfMap[ticker]) {
          etfMap[ticker] = { ticker, name: security.name, value: 0 };
        }
        etfMap[ticker].value += value;
      });
    });
  });

  return Object.values(etfMap);
}

function _collectDirectStockTickers() {
  const selectedPlaidIds = new Set(getSelectedPlaidAccountIds());
  const tickers = new Set();

  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;

    const investmentAccs = item.accounts.filter(
      acc => acc.type === 'investment' && selectedPlaidIds.has(acc.account_id)
    );

    investmentAccs.forEach(account => {
      item.holdings.filter(h => h.account_id === account.account_id).forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;
        if (security.type === 'etf' || security.type === 'mutual fund') return;
        if (security.ticker_symbol) {
          tickers.add(security.ticker_symbol.toUpperCase());
        }
      });
    });
  });

  return tickers;
}

// ─── Rendering ───────────────────────────────────────────────

function _renderExposurePanel(panel, data, directTickers, etfHoldings) {
  let html = `
    <div class="etf-exposure-container">
      <div class="etf-exposure-header">
        <h3>ETF Implied Exposure</h3>
        <button class="secondary" onclick="toggleEtfExposurePanel()" style="padding:2px 8px; font-size:11px;">Hide</button>
      </div>
      <div class="etf-exposure-note">
        Based on top-10 holdings of your ETFs. These are estimated positions, not direct holdings.
      </div>
  `;

  // Recognized ETF exposure table
  if (data.exposure && data.exposure.length > 0) {
    html += `
      <table class="transactions-table etf-exposure-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Company</th>
            <th>Implied Exposure</th>
            <th>Contributing ETFs</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
    `;

    data.exposure.forEach(entry => {
      const isAlsoHeld = directTickers.has(entry.ticker.toUpperCase());
      const overlapBadge = isAlsoHeld ? '<span class="direct-overlap-badge">Also held directly</span>' : '';

      html += `
        <tr${isAlsoHeld ? ' style="font-weight:600;"' : ''}>
          <td>${entry.ticker}${overlapBadge}</td>
          <td>${entry.name}</td>
          <td>${formatCurrency(entry.total_exposure)}</td>
          <td>${entry.contributing_etfs.join(', ')}</td>
          <td></td>
        </tr>
      `;
    });

    html += '</tbody></table>';
  }

  // Unrecognized ETFs section
  if (data.unrecognized && data.unrecognized.length > 0) {
    html += '<div class="etf-unrecognized-section">';
    html += '<h4>ETFs Without Constituent Data</h4>';
    html += '<div class="etf-exposure-note">We don\'t have top-holdings data for these ETFs yet. You can contribute it.</div>';

    data.unrecognized.forEach(ticker => {
      const etfInfo = etfHoldings.find(h => h.ticker.toUpperCase() === ticker);
      const displayName = etfInfo ? etfInfo.name : ticker;
      const displayValue = etfInfo ? formatCurrency(etfInfo.value) : '';

      html += `
        <div class="etf-unrecognized-row">
          <span class="etf-unrecognized-ticker">${ticker}</span>
          <span class="etf-unrecognized-name">${displayName}</span>
          <span class="etf-unrecognized-value">${displayValue}</span>
          <button class="secondary" onclick="openEtfContributeModal('${ticker}', '${displayName.replace(/'/g, "\\'")}')">
            Contribute Holdings
          </button>
        </div>
      `;
    });

    html += '</div>';
  }

  html += '</div>';
  panel.innerHTML = html;
}

// ─── ETF contribution modal ─────────────────────────────────

function openEtfContributeModal(etfTicker, etfName) {
  _removeEtfContributeModal();

  const modal = document.createElement('div');
  modal.id = 'etf-contribute-overlay';
  modal.className = 'assign-modal-overlay';
  modal.innerHTML = `
    <div class="assign-modal" style="width:520px;">
      <div class="assign-modal-header">
        Contribute Top Holdings: ${etfTicker}
        <button class="assign-modal-close" onclick="closeEtfContributeModal()">✕</button>
      </div>
      <div class="assign-modal-body">
        <div class="assign-field">
          <label>ETF Name</label>
          <input type="text" id="etf-contrib-name" value="${etfName}" readonly
            style="width:100%; padding:6px 10px; border-radius:4px; border:1px solid var(--border-primary); background:var(--bg-primary); color:var(--text-primary);" />
        </div>
        <div id="etf-contrib-rows">
          ${_buildContribRow(0)}
        </div>
        <div style="display:flex; gap:8px; margin-top:8px; align-items:center;">
          <button class="secondary" onclick="addEtfContribRow()">+ Add Row</button>
          <span id="etf-contrib-total" style="margin-left:auto; font-size:12px; color:var(--text-secondary);">Total: 0%</span>
        </div>
        <div id="etf-contrib-error" class="assign-error" style="margin-top:8px;"></div>
      </div>
      <div class="assign-modal-footer">
        <button class="secondary" onclick="closeEtfContributeModal()">Cancel</button>
        <button onclick="submitEtfContribution('${etfTicker}')">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', function(event) {
    if (event.target === modal) closeEtfContributeModal();
  });
}

function _buildContribRow(index) {
  return `
    <div class="etf-contrib-row" data-row-index="${index}">
      <input type="text" placeholder="Ticker" class="etf-contrib-ticker" style="width:80px;" />
      <input type="text" placeholder="Company Name" class="etf-contrib-name" style="flex:1;" />
      <input type="number" placeholder="Wt %" class="etf-contrib-weight" style="width:70px;" min="0" max="100" step="0.1" oninput="updateContribTotal()" />
      <button class="secondary" onclick="removeEtfContribRow(this)" style="padding:2px 6px;">✕</button>
    </div>
  `;
}

function addEtfContribRow() {
  const container = document.getElementById('etf-contrib-rows');
  const currentRows = container.querySelectorAll('.etf-contrib-row');
  if (currentRows.length >= 15) return;

  const newIndex = currentRows.length;
  const rowHtml = _buildContribRow(newIndex);
  container.insertAdjacentHTML('beforeend', rowHtml);
}

function removeEtfContribRow(button) {
  const container = document.getElementById('etf-contrib-rows');
  const rows = container.querySelectorAll('.etf-contrib-row');
  if (rows.length <= 1) return;
  button.closest('.etf-contrib-row').remove();
  updateContribTotal();
}

function updateContribTotal() {
  const weights = document.querySelectorAll('.etf-contrib-weight');
  let total = 0;
  weights.forEach(input => {
    total += parseFloat(input.value) || 0;
  });
  const totalEl = document.getElementById('etf-contrib-total');
  if (totalEl) {
    totalEl.textContent = `Total: ${total.toFixed(1)}%`;
    totalEl.style.color = total > 100 ? 'var(--accent-danger, #f87171)' : 'var(--text-secondary)';
  }
}

async function submitEtfContribution(etfTicker) {
  const errorEl = document.getElementById('etf-contrib-error');
  const etfName = document.getElementById('etf-contrib-name').value.trim();
  const rows = document.querySelectorAll('.etf-contrib-row');
  const holdings = [];

  rows.forEach(row => {
    const ticker = row.querySelector('.etf-contrib-ticker').value.trim();
    const name = row.querySelector('.etf-contrib-name').value.trim();
    const weight = parseFloat(row.querySelector('.etf-contrib-weight').value) || 0;
    if (ticker && name && weight > 0) {
      holdings.push({ ticker: ticker.toUpperCase(), name, weight_pct: weight });
    }
  });

  if (holdings.length === 0) {
    errorEl.textContent = 'Add at least one holding with ticker, name, and weight.';
    return;
  }

  const totalWeight = holdings.reduce((sum, h) => sum + h.weight_pct, 0);
  if (totalWeight > 100) {
    errorEl.textContent = `Total weight (${totalWeight.toFixed(1)}%) exceeds 100%.`;
    return;
  }

  try {
    errorEl.textContent = '';
    await submitEtfHoldingsApi(etfTicker, etfName, holdings);
    closeEtfContributeModal();
    showInvestmentMessage(`ETF holdings saved for ${etfTicker}`, 'success');
    await loadEtfExposurePanel();
  } catch (error) {
    errorEl.textContent = error.message || 'Failed to save ETF holdings.';
  }
}

function closeEtfContributeModal() {
  _removeEtfContributeModal();
}

function _removeEtfContributeModal() {
  const existing = document.getElementById('etf-contribute-overlay');
  if (existing) existing.remove();
}
