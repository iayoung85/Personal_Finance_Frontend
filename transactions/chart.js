// ============================================================
// transactions/chart.js — Category Chart Visualization
// Aggregates filtered transactions by category and renders
// a Chart.js pie chart with toggle between primary/detailed.
// Supports drilldown: click a primary slice to see detailed
// subcategories for that primary, with a "← Back" button.
// ============================================================

function switchChartView(mode) {
  chartViewMode = mode;
  chartDrilldownPrimary = null; // Reset drilldown when switching view mode
  
  // Update button states
  document.getElementById('chart-primary-btn').classList.toggle('active', mode === 'primary');
  document.getElementById('chart-detailed-btn').classList.toggle('active', mode === 'detailed');
  _updateDrilldownBackButton();
  
  // Re-render chart
  renderCategoryChart();
}

/**
 * Show/hide the drilldown "← Back" button based on current state.
 */
function _updateDrilldownBackButton() {
  let backBtn = document.getElementById('chart-drilldown-back');
  if (!backBtn) return;
  
  if (chartDrilldownPrimary) {
    backBtn.classList.remove('hidden');
    backBtn.textContent = `← Back from "${chartDrilldownPrimary}"`;
  } else {
    backBtn.classList.add('hidden');
  }
}

/**
 * Exit drilldown mode and return to top-level primary chart.
 */
function chartDrilldownBack() {
  chartDrilldownPrimary = null;
  chartViewMode = 'primary';
  document.getElementById('chart-primary-btn').classList.add('active');
  document.getElementById('chart-detailed-btn').classList.remove('active');
  _updateDrilldownBackButton();
  renderCategoryChart();
}

function _getFilteredTransactionsForChart() {
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const hideTransfers = document.getElementById('hide-transfers').checked;
  
  return transactions.filter(txn => {
    if (txn.date < startDate || txn.date > endDate) return false;
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.account_id || txn.plaid_account_id)) return false;
    if (txn.pending) return false;

    // Exclude system-generated bookkeeping entries (opening balances, reconciliation, etc.)
    // Use txn.source (a controlled backend enum) not user_category which is user-editable.
    if (SYSTEM_SOURCES.has(txn.source)) return false;

    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) return false;
    }

    if (txn.personal_finance_category && txn.personal_finance_category.primary) {
      const primaryCat = txn.personal_finance_category.primary;
      if (/income/i.test(primaryCat)) return false;
    }
    
    return true;
  });
}

function aggregateCategoriesFromFilteredTransactions() {
  const filteredTransactions = _getFilteredTransactionsForChart();
  const categoryTotals = {};

  filteredTransactions.forEach(txn => {
    const categoryKey = txn.user_category || 'Uncategorized';
    const amount = Math.abs(txn.amount || 0);
    categoryTotals[categoryKey] = (categoryTotals[categoryKey] || 0) + amount;
  });
  
  return Object.entries(categoryTotals)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Aggregate transactions by primary category only (for top-level pie).
 * Returns array of { category, total } sorted by total descending.
 */
function _aggregateByPrimary() {
  const filteredTransactions = _getFilteredTransactionsForChart();
  const totals = {};

  filteredTransactions.forEach(txn => {
    const fullCategory = txn.user_category || 'Uncategorized';
    const parsed = parseCategoryString(fullCategory);
    const primaryKey = parsed.primary || 'Uncategorized';
    const amount = Math.abs(txn.amount || 0);
    totals[primaryKey] = (totals[primaryKey] || 0) + amount;
  });

  return Object.entries(totals)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Aggregate only transactions whose primary category matches the drilldown,
 * grouping by full user_category (primary: detailed).
 */
function _aggregateDetailedForPrimary(primaryCategory) {
  const filteredTransactions = _getFilteredTransactionsForChart();
  const totals = {};

  filteredTransactions.forEach(txn => {
    const fullCategory = txn.user_category || 'Uncategorized';
    const parsed = parseCategoryString(fullCategory);
    const txnPrimary = parsed.primary || 'Uncategorized';

    if (txnPrimary !== primaryCategory) return;

    // Group by the detailed part (or "Other" if no detailed)
    const detailedKey = parsed.detailed || txnPrimary;
    const amount = Math.abs(txn.amount || 0);
    totals[detailedKey] = (totals[detailedKey] || 0) + amount;
  });

  return Object.entries(totals)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

function renderCategoryChart() {
  // Determine which data to show based on drilldown state
  let categoryData;
  if (chartDrilldownPrimary) {
    categoryData = _aggregateDetailedForPrimary(chartDrilldownPrimary);
  } else if (chartViewMode === 'primary') {
    categoryData = _aggregateByPrimary();
  } else {
    categoryData = aggregateCategoriesFromFilteredTransactions();
  }
  const canvas = document.getElementById('category-chart');
  const emptyState = document.getElementById('chart-empty-state');
  
  // Show/hide empty state
  if (categoryData.length === 0) {
    emptyState.classList.add('visible');
    canvas.style.display = 'none';
    if (categoryChart) {
      categoryChart.destroy();
      categoryChart = null;
    }
    return;
  } else {
    emptyState.classList.remove('visible');
    canvas.style.display = 'block';
  }
  
  const labels = categoryData.map(item => item.category);
  const data = categoryData.map(item => item.total);
  const colors = categoryData.map((_, index) => PASTEL_COLORS[index % PASTEL_COLORS.length]);
  
  // Destroy existing chart
  if (categoryChart) {
    categoryChart.destroy();
  }
  
  // Create chart with drilldown support — clicking a primary slice
  // transitions to a detailed subcategory breakdown for that primary.
  const ctx = canvas.getContext('2d');
  categoryChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      // Drilldown: clicking a primary slice drills into detailed subcategories
      onClick: function(event, elements) {
        if (!elements || elements.length === 0) return;
        // Only allow drilldown from primary view (not already drilled down)
        if (chartDrilldownPrimary) return;
        if (chartViewMode !== 'primary') return;

        const clickedIndex = elements[0].index;
        const clickedLabel = labels[clickedIndex];
        chartDrilldownPrimary = clickedLabel;
        _updateDrilldownBackButton();
        renderCategoryChart();
      },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            padding: 10,
            font: {
              size: 9.5
            },
            boxWidth: 12,
            maxWidth: 160,
            generateLabels: function(chart) {
              const data = chart.data;
              if (data.labels.length && data.datasets.length) {
                const dataset = data.datasets[0];
                const total = dataset.data.reduce((sum, val) => sum + val, 0);
                
                return data.labels.map((label, i) => {
                  const value = dataset.data[i];
                  const percentage = ((value / total) * 100).toFixed(1);
                  // Truncate very long labels (>30 chars) with ellipsis
                  let displayLabel = label;
                  if (label.length > 30) {
                    displayLabel = label.substring(0, 27) + '...';
                  }
                  
                  return {
                    text: `${displayLabel} (${percentage}%)`,
                    fillStyle: dataset.backgroundColor[i],
                    hidden: false,
                    index: i
                  };
                });
              }
              return [];
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed;
              const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
              const percentage = ((value / total) * 100).toFixed(1);
              const formatted = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
              }).format(value);
              
              return `${label}: ${formatted} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}
