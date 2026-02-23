// ============================================================
// transactions/insights.js — Spending Insight Calculations
// Generates statistical insight cards from filtered
// transactions and renders the insights panel.
// ============================================================

function generateSpendingInsights() {
  // Generate statistical insights based on filtered transactions and historical data
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  const selectedAccounts = getSelectedAccounts();
  const hideTransfers = document.getElementById('hide-transfers').checked;
  const showOverridesOnly = document.getElementById('show-overrides-only').checked;

  // Get filtered transactions (same filter as table, but always exclude pending)
  const filteredTransactions = transactions.filter(txn => {
    if (txn.date < startDate || txn.date > endDate) return false;
    if (selectedAccounts.length > 0 && !selectedAccounts.includes(txn.account_id || txn.plaid_account_id)) return false;
    if (txn.pending) return false;
    if (hideTransfers) {
      const primaryCat = (txn.personal_finance_category && txn.personal_finance_category.primary) || '';
      if (/transfer/i.test(primaryCat)) return false;
    }
    if (showOverridesOnly && !txn.is_override) return false;
    if (txn.personal_finance_category && txn.personal_finance_category.primary) {
      if (/income/i.test(txn.personal_finance_category.primary)) return false;
    }
    return true;
  });

  if (filteredTransactions.length === 0) {
    return null;
  }

  // Calculate current period stats
  const currentStats = {
    totalSpending: 0,
    transactionCount: filteredTransactions.length,
    categories: {},
    largestTransaction: null,
    averageTransaction: 0
  };

  filteredTransactions.forEach(txn => {
    const amount = Math.abs(txn.amount || 0);
    currentStats.totalSpending += amount;

    // Track largest transaction
    if (!currentStats.largestTransaction || amount > currentStats.largestTransaction.amount) {
      currentStats.largestTransaction = {
        amount: amount,
        merchant: txn.merchant_name || txn.name || 'Unknown',
        date: txn.date,
        category: (txn.personal_finance_category && txn.personal_finance_category.primary) || 'Uncategorized'
      };
    }

    // Aggregate by primary category
    const category = (txn.personal_finance_category && txn.personal_finance_category.primary) || 'Uncategorized';
    const categoryName = category.replace(/_/g, ' ');
    if (!currentStats.categories[categoryName]) {
      currentStats.categories[categoryName] = { total: 0, count: 0 };
    }
    currentStats.categories[categoryName].total += amount;
    currentStats.categories[categoryName].count += 1;
  });

  currentStats.averageTransaction = currentStats.totalSpending / currentStats.transactionCount;

  // Get top categories
  const topCategories = Object.entries(currentStats.categories)
    .map(([name, data]) => ({ name, total: data.total, count: data.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  // Build insights array
  const insights = [];

  // Insight 1: Total spending
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.totalSpending);
  insights.push({
    icon: '💰',
    label: 'Total Spending',
    value: `${formattedTotal} across ${currentStats.transactionCount} transactions`
  });

  // Insight 2: Top category
  if (topCategories.length > 0) {
    const topCat = topCategories[0];
    const percentage = ((topCat.total / currentStats.totalSpending) * 100).toFixed(0);
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(topCat.total);
    insights.push({
      icon: '📈',
      label: 'Top Category',
      value: `${topCat.name} (${formatted} - ${percentage}% of spending)`
    });
  }

  // Insight 3: Average transaction
  const formattedAvg = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.averageTransaction);
  insights.push({
    icon: '💳',
    label: 'Average Transaction',
    value: formattedAvg
  });

  // Insight 4: Largest transaction
  if (currentStats.largestTransaction) {
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentStats.largestTransaction.amount);
    insights.push({
      icon: '🔥',
      label: 'Largest Purchase',
      value: `${formatted} at ${currentStats.largestTransaction.merchant}`
    });
  }

  return insights;
}

function renderInsightsPanel() {
  const container = document.getElementById('insights-container');
  if (!container) return; // Insights panel not in DOM yet

  const insights = generateSpendingInsights();
  
  if (!insights || insights.length === 0) {
    container.innerHTML = '<div class="insights-empty">Select accounts and date range to view insights</div>';
    return;
  }

  let html = '<div class="insights-grid">';
  insights.forEach(insight => {
    const highlightClass = insight.highlight ? ' highlight' : '';
    html += `
      <div class="insight-card${highlightClass}">
        <div class="insight-icon">${insight.icon}</div>
        <div class="insight-content">
          <div class="insight-label">${insight.label}</div>
          <div class="insight-value">${insight.value}</div>
        </div>
      </div>
    `;
  });

  // Chart insight card — click opens chart modal
  html += `
    <div class="insight-card insight-chart-card"
         onclick="openChartModal()"
         title="View expense breakdown chart">
      <div class="insight-icon">📊</div>
      <div class="insight-content">
        <div class="insight-label">Chart</div>
      </div>
    </div>
  `;

  html += '</div>';

  container.innerHTML = html;
}
