// ============================================================
// transactions/insights.js — Insights Panel Rendering
// Uses the shared analytics slice so the cards stay aligned with
// the currently visible ledger rows.
// ============================================================

function _buildTotalSpendingInsight(analyticsView) {
  const rawTotal = analyticsView.spendingEntries.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    icon: '💰',
    label: 'Total Spending',
    value: formatAnalyticsCurrency(getAnalyticsDisplayTotal(rawTotal, 'Spending')),
    meta: `${analyticsView.spendingEntries.length} spending transactions`,
    subtext: 'Transfers, adjustments, income, and system rows excluded',
  };
}

function _buildTrackedCategoryInsight(primaryCategory, analyticsView) {
  const matchingEntries = analyticsView.trackableEntries.filter(entry => entry.primary_category === primaryCategory);
  const rawTotal = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const averageDisplayAmount = getAnalyticsAverageDisplayAmount(matchingEntries, primaryCategory);
  const averageLabel = isIncomeCategoryName(primaryCategory) ? 'Average credit' : 'Average debit';

  return {
    icon: '🏷️',
    label: primaryCategory,
    value: formatAnalyticsCurrency(getAnalyticsDisplayTotal(rawTotal, primaryCategory)),
    meta: `${matchingEntries.length} transactions`,
    subtext: averageDisplayAmount === null
      ? `${averageLabel} —`
      : `${averageLabel} ${formatAnalyticsCurrency(averageDisplayAmount)}`,
  };
}

function _buildLiveLedgerInsight(analyticsView) {
  const ledgerNetAmount = analyticsView.ledgerEntries.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    icon: '🔎',
    label: 'Live Result',
    value: formatAnalyticsCurrency(ledgerNetAmount),
    meta: `${analyticsView.ledgerEntries.length} displayed transactions`,
    subtext: 'Signed net sum of the current ledger view',
  };
}

function _buildCategorySummaryInsight() {
  return {
    icon: '📋',
    label: 'Category Summary',
    value: 'Open category table',
    meta: 'Income, spending, and investment trend',
    subtext: 'Transfers, adjustments, and balance anchors excluded',
    cardClass: ' insight-summary-card',
    title: 'Open category summary table',
    onClick: 'toggleCategorySummaryModal()',
  };
}

function generateSpendingInsights() {
  const analyticsView = buildNormalizedAnalyticsSlice();

  if (!analyticsView.ledgerEntries.length) {
    return null;
  }

  const insights = [_buildTotalSpendingInsight(analyticsView)];

  analyticsView.trackedPrimaryCategories.forEach(primaryCategory => {
    insights.push(_buildTrackedCategoryInsight(primaryCategory, analyticsView));
  });

  insights.push(_buildLiveLedgerInsight(analyticsView));
  insights.push(_buildCategorySummaryInsight());

  return insights;
}

function _renderInsightCard(insight) {
  const clickAttrs = insight.onClick
    ? ` onclick="${insight.onClick}" role="button" tabindex="0"`
    : '';
  const cardTitle = insight.title ? ` title="${escapeHtml(insight.title)}"` : '';

  return `
    <div class="insight-card${insight.cardClass || ''}"${clickAttrs}${cardTitle}>
      <div class="insight-icon">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-label">${escapeHtml(insight.label)}</div>
        <div class="insight-value">${escapeHtml(insight.value)}</div>
        ${insight.meta ? `<div class="insight-meta">${escapeHtml(insight.meta)}</div>` : ''}
        ${insight.subtext ? `<div class="insight-subtext">${escapeHtml(insight.subtext)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderInsightsPanel() {
  const container = document.getElementById('insights-container');
  if (!container) return;

  const insights = generateSpendingInsights();

  if (!insights || insights.length === 0) {
    container.innerHTML = '<div class="insights-empty">Select accounts and date range to view insights</div>';
    if (typeof renderCategorySummaryModal === 'function') {
      renderCategorySummaryModal();
    }
    return;
  }

  container.innerHTML = `
    <div class="insights-grid">
      ${insights.map(_renderInsightCard).join('')}
    </div>
  `;

  if (typeof renderCategorySummaryModal === 'function') {
    renderCategorySummaryModal();
  }
}

