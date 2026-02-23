// ============================================================
// transactions/chart.js — Category Chart Visualization
// Aggregates filtered transactions by category and renders
// a Chart.js pie chart with toggle between primary/detailed.
// ============================================================

function switchChartView(mode) {
  chartViewMode = mode;
  
  // Update button states
  document.getElementById('chart-primary-btn').classList.toggle('active', mode === 'primary');
  document.getElementById('chart-detailed-btn').classList.toggle('active', mode === 'detailed');
  
  // Re-render chart
  renderCategoryChart();
}

function aggregateCategoriesFromFilteredTransactions() {
  // Get the same filtered transactions that the table uses
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const hideTransfers = document.getElementById('hide-transfers').checked;
  
  const filteredTransactions = transactions.filter(txn => {
    // Filter by date range
    if (txn.date < startDate || txn.date > endDate) {
      return false;
    }
    
    // Filter by selected accounts (use account_id for both Plaid and future custom accounts)
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.account_id || txn.plaid_account_id)) {
      return false;
    }
    
    // Always exclude pending from chart aggregation
    if (txn.pending) {
      return false;
    }

    // Hide transfers if requested
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) {
        return false;
      }
    }

    // Exclude income transactions from chart
    if (txn.personal_finance_category && txn.personal_finance_category.primary) {
      const primaryCat = txn.personal_finance_category.primary;
      if (/income/i.test(primaryCat)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Aggregate by category
  const categoryTotals = {};

  filteredTransactions.forEach(txn => {
    // Use user_category — the final label after mappings, rules, and overrides.
    // Falls back to Uncategorized if not yet categorized.
    const categoryKey = txn.user_category || 'Uncategorized';

    // Sum amounts (use absolute value for visualization)
    const amount = Math.abs(txn.amount || 0);
    categoryTotals[categoryKey] = (categoryTotals[categoryKey] || 0) + amount;
  });
  
  // Convert to array and sort by amount descending
  const categoriesArray = Object.entries(categoryTotals)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
  
  return categoriesArray;
}

function renderCategoryChart() {
  const categoryData = aggregateCategoriesFromFilteredTransactions();
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
  
  // Create new chart
  // TODO: 3b: drilldown pie chart - click a slice to break it into subcategories.
  // When clicking a slice, filter transactions to that user_category and re-render
  // in a detailed breakdown. Add a "Back" button to return to the top-level view.
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
