// ============================================================
// investments/chart.js — Portfolio Breakdown Charts
// Three views: By Type (pie), By Sector (pie), Allocation Drift (bar).
// Uses Chart.js 4.x — loaded globally via CDN in investments.html.
// ============================================================

/**
 * Render or update the chart based on the current chartViewMode.
 */
function renderInvestmentChart() {
  const canvas = document.getElementById('investment-chart');
  const emptyState = document.getElementById('chart-empty-state');
  if (!canvas) return;

  const selectedIds = getSelectedAccountIds();
  if (selectedIds.length === 0) {
    _showChartEmpty(canvas, emptyState, 'Select accounts to see charts');
    return;
  }

  if (chartViewMode === 'type') {
    _renderTypeChart(canvas, emptyState, selectedIds);
  } else if (chartViewMode === 'sector') {
    _renderSectorChart(canvas, emptyState, selectedIds);
  } else if (chartViewMode === 'allocation') {
    _renderAllocationDriftChart(canvas, emptyState);
  }
}

// ─── By Type: Pie chart ──────────────────────────────────────

function _renderTypeChart(canvas, emptyState, selectedIds) {
  const breakdown = _computeBreakdownByField(selectedIds, 'type');
  if (breakdown.labels.length === 0) {
    _showChartEmpty(canvas, emptyState, 'No holdings data for chart');
    return;
  }
  _hideChartEmpty(canvas, emptyState);
  _renderPieChart(canvas, breakdown.labels, breakdown.values, 'Portfolio by Type');
}

// ─── By Sector: Pie chart ────────────────────────────────────

function _renderSectorChart(canvas, emptyState, selectedIds) {
  const breakdown = _computeBreakdownByField(selectedIds, 'sector');
  if (breakdown.labels.length === 0) {
    _showChartEmpty(canvas, emptyState, 'No sector data available');
    return;
  }
  _hideChartEmpty(canvas, emptyState);
  _renderPieChart(canvas, breakdown.labels, breakdown.values, 'Portfolio by Sector');
}

// ─── Allocation Drift: Grouped horizontal bar chart ──────────

async function _renderAllocationDriftChart(canvas, emptyState) {
  try {
    const selectedPlaidIds = getSelectedPlaidAccountIds();
    const summaryData = await fetchAllocationSummary(selectedPlaidIds);
    const summary = summaryData.summary || [];

    if (summary.length === 0) {
      _showChartEmpty(canvas, emptyState, 'No allocation categories defined');
      return;
    }

    _hideChartEmpty(canvas, emptyState);
    _destroyExistingChart();

    const labels = summary.map(row => row.category_name);
    const targetData = summary.map(row => row.target_pct);
    const actualData = summary.map(row => row.actual_pct);

    investmentChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Target %',
            data: targetData,
            backgroundColor: 'rgba(91, 155, 213, 0.35)',
            borderColor: 'rgba(91, 155, 213, 0.7)',
            borderWidth: 1,
          },
          {
            label: 'Actual %',
            data: actualData,
            backgroundColor: actualData.map((actual, index) => {
              const delta = Math.abs(actual - targetData[index]);
              if (delta <= 3) return 'rgba(52, 211, 153, 0.7)';
              if (delta <= 8) return 'rgba(251, 191, 36, 0.7)';
              return 'rgba(248, 113, 113, 0.7)';
            }),
            borderColor: actualData.map((actual, index) => {
              const delta = Math.abs(actual - targetData[index]);
              if (delta <= 3) return '#34D399';
              if (delta <= 8) return '#FBBF24';
              return '#F87171';
            }),
            borderWidth: 1,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#fff' },
          },
          tooltip: {
            callbacks: {
              afterLabel: function(context) {
                if (context.datasetIndex === 1) {
                  const catIndex = context.dataIndex;
                  const delta = summary[catIndex].delta_pct;
                  const sign = delta >= 0 ? '+' : '';
                  return `Drift: ${sign}${delta.toFixed(1)}%`;
                }
                return '';
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: function(value) { return value + '%'; },
              color: getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#aaa',
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: {
              color: getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#fff',
            },
            grid: { display: false },
          },
        },
      },
    });
  } catch (error) {
    console.error('Allocation drift chart error:', error);
    _showChartEmpty(canvas, emptyState, 'Failed to load allocation data');
  }
}

// ─── Shared helpers ──────────────────────────────────────────

function _computeBreakdownByField(selectedIds, field) {
  const selectedPlaidIds = new Set(getSelectedPlaidAccountIds());
  const breakdown = {};

  holdingsData.forEach(item => {
    if (!item || !item.holdings || !item.accounts) return;

    const investmentAccs = item.accounts.filter(
      acc => acc.type === 'investment' && selectedPlaidIds.has(acc.account_id)
    );

    investmentAccs.forEach(account => {
      item.holdings.filter(h => h.account_id === account.account_id).forEach(holding => {
        const security = getSecurityById(holding.security_id);
        if (!security) return;

        let key;
        if (field === 'type') {
          key = security.type || 'Unknown';
        } else if (field === 'sector') {
          key = security.enriched_sector || security.sector || 'Uncategorized';
        }

        const price = derivePrice(security, holding);
        const quantity = holding.quantity || 0;
        const value = price > 0 ? (quantity * price) : (holding.institution_value || 0);

        breakdown[key] = (breakdown[key] || 0) + value;
      });
    });
  });

  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  return {
    labels: entries.map(e => e[0]),
    values: entries.map(e => e[1]),
  };
}

function _renderPieChart(canvas, labels, values, title) {
  _destroyExistingChart();

  const colors = labels.map((_, index) => PASTEL_COLORS[index % PASTEL_COLORS.length]);

  investmentChart = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: 'rgba(0,0,0,0.2)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#fff',
            font: { size: 11 },
            padding: 8,
          },
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.parsed;
              const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
              const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
              return `${context.label}: ${formatCurrency(value)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function _destroyExistingChart() {
  if (investmentChart) {
    investmentChart.destroy();
    investmentChart = null;
  }
}

function _showChartEmpty(canvas, emptyState, message) {
  _destroyExistingChart();
  canvas.style.display = 'none';
  if (emptyState) {
    emptyState.style.display = 'block';
    emptyState.textContent = message;
  }
}

function _hideChartEmpty(canvas, emptyState) {
  canvas.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';
}

// ─── Allocation settings modal ───────────────────────────────

function openAllocationSettings() {
  _removeAllocationSettingsModal();

  const modal = document.createElement('div');
  modal.id = 'allocation-settings-overlay';
  modal.className = 'assign-modal-overlay';

  const categoriesHtml = allocationCategories.map((cat, index) => `
    <div class="alloc-settings-row" data-cat-id="${cat.id}">
      <input type="text" value="${cat.category_name}" class="alloc-cat-name" style="flex:1;" />
      <input type="number" value="${cat.target_pct}" class="alloc-cat-target" style="width:70px;" min="0" max="100" step="0.5" oninput="updateAllocTotal()" />
      <span>%</span>
      <button class="secondary" onclick="removeAllocCategory(${cat.id}, this)" style="padding:2px 6px;">✕</button>
    </div>
  `).join('');

  const total = allocationCategories.reduce((sum, cat) => sum + cat.target_pct, 0);

  modal.innerHTML = `
    <div class="assign-modal" style="width:480px;">
      <div class="assign-modal-header">
        Allocation Categories
        <button class="assign-modal-close" onclick="closeAllocationSettings()">✕</button>
      </div>
      <div class="assign-modal-body">
        <div id="alloc-settings-rows">${categoriesHtml}</div>
        <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
          <button class="secondary" onclick="addAllocCategoryRow()">+ Add Category</button>
          <span id="alloc-settings-total" style="margin-left:auto; font-size:12px;">Total: ${total.toFixed(1)}%</span>
        </div>
        <div id="alloc-settings-error" class="assign-error" style="margin-top:8px;"></div>
      </div>
      <div class="assign-modal-footer">
        <button class="secondary" onclick="closeAllocationSettings()">Close</button>
        <button onclick="saveAllocationSettings()">Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', function(event) {
    if (event.target === modal) closeAllocationSettings();
  });
}

function addAllocCategoryRow() {
  const container = document.getElementById('alloc-settings-rows');
  container.insertAdjacentHTML('beforeend', `
    <div class="alloc-settings-row" data-cat-id="new">
      <input type="text" placeholder="Category name" class="alloc-cat-name" style="flex:1;" />
      <input type="number" value="0" class="alloc-cat-target" style="width:70px;" min="0" max="100" step="0.5" oninput="updateAllocTotal()" />
      <span>%</span>
      <button class="secondary" onclick="this.closest('.alloc-settings-row').remove(); updateAllocTotal();" style="padding:2px 6px;">✕</button>
    </div>
  `);
}

async function removeAllocCategory(categoryId, button) {
  if (!confirm('Delete this allocation category? Securities assigned to it will become unassigned.')) return;
  try {
    await deleteAllocationCategoryApi(categoryId);
    button.closest('.alloc-settings-row').remove();
    allocationCategories = allocationCategories.filter(cat => cat.id !== categoryId);
    updateAllocTotal();
    showInvestmentMessage('Category deleted', 'success');
  } catch (error) {
    showInvestmentMessage(error.message, 'error');
  }
}

function updateAllocTotal() {
  const targets = document.querySelectorAll('.alloc-cat-target');
  let total = 0;
  targets.forEach(input => { total += parseFloat(input.value) || 0; });
  const totalEl = document.getElementById('alloc-settings-total');
  if (totalEl) {
    totalEl.textContent = `Total: ${total.toFixed(1)}%`;
    totalEl.style.color = total > 100 ? 'var(--accent-danger, #f87171)' : 'var(--text-secondary)';
  }
}

async function saveAllocationSettings() {
  const errorEl = document.getElementById('alloc-settings-error');
  const rows = document.querySelectorAll('.alloc-settings-row');
  errorEl.textContent = '';

  try {
    for (const row of rows) {
      const catId = row.dataset.catId;
      const name = row.querySelector('.alloc-cat-name').value.trim();
      const target = parseFloat(row.querySelector('.alloc-cat-target').value) || 0;

      if (!name) continue;

      if (catId === 'new') {
        await createAllocationCategoryApi(name, target);
      } else {
        const existing = allocationCategories.find(cat => cat.id === parseInt(catId));
        if (existing && (existing.category_name !== name || existing.target_pct !== target)) {
          await updateAllocationCategoryApi(catId, { category_name: name, target_pct: target });
        }
      }
    }

    // Refresh categories
    const refreshed = await fetchAllocationCategories();
    allocationCategories = refreshed.categories || [];

    closeAllocationSettings();
    renderInvestmentChart();
    renderHoldingsTable();
    showInvestmentMessage('Allocation categories saved', 'success');
  } catch (error) {
    errorEl.textContent = error.message || 'Failed to save categories.';
  }
}

function closeAllocationSettings() {
  _removeAllocationSettingsModal();
}

function _removeAllocationSettingsModal() {
  const existing = document.getElementById('allocation-settings-overlay');
  if (existing) existing.remove();
}
