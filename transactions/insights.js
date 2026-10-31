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
    value: formatAnalyticsCurrency(getAnalyticsDisplayTotal(rawTotal, analyticsView.spendingEntries)),
    meta: `${analyticsView.spendingEntries.length} spending transactions`,
    subtext: 'Transfers, adjustments, income, other inflow, retirement income, and system rows excluded',
  };
}

/**
 * One insights-bar card for a user-named group of categories.
 * @param {{name: string, primaries: string[], details: string[]}} card
 * @param {Object} analyticsView The slice from buildNormalizedAnalyticsSlice().
 * @returns {Object} Insight card view model.
 */
function _buildInsightCardInsight(card, analyticsView) {
  const matchingEntries = filterEntriesForInsightCard(analyticsView.trackableEntries, card);
  const rawTotal = matchingEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const averageLines = getInsightCardAverageLines(matchingEntries).map(line => (
    line.amount === null
      ? `${line.label} —`
      : `${line.label} ${formatAnalyticsCurrency(line.amount)}`
  ));
  const flow = getInsightCardFlowSummary(matchingEntries);

  if (flow.isMixed) {
    // Why: an unsigned total on a card holding both sides cannot say which
    // side is bigger, so it shows a signed net and both sides beneath it.
    const signedNet = getAnalyticsSignedDisplay(rawTotal, ANALYTICS_DISPLAY_MODE.INCOME);
    return {
      icon: '🏷️',
      label: card.name,
      value: signedNet.text,
      valueTone: signedNet.tone,
      meta: `${matchingEntries.length} transactions`,
      subtext: [
        `In ${formatAnalyticsCurrency(flow.inTotal)} · Out ${formatAnalyticsCurrency(flow.outTotal)}`,
        ...averageLines,
      ],
    };
  }

  return {
    icon: '🏷️',
    label: card.name,
    value: formatAnalyticsCurrency(getAnalyticsDisplayTotal(rawTotal, matchingEntries)),
    meta: `${matchingEntries.length} transactions`,
    subtext: averageLines,
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
    meta: 'Spending, total income, investment trend, and retirement income',
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

  analyticsView.insightCards.forEach(card => {
    insights.push(_buildInsightCardInsight(card, analyticsView));
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
  const subtextLines = Array.isArray(insight.subtext) ? insight.subtext : [insight.subtext];
  const subtextHtml = subtextLines
    .filter(Boolean)
    .map(line => `<div class="insight-subtext">${escapeHtml(line)}</div>`)
    .join('');

  return `
    <div class="insight-card${insight.cardClass || ''}"${clickAttrs}${cardTitle}>
      <div class="insight-icon">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-label">${escapeHtml(insight.label)}</div>
        <div class="insight-value${insight.valueTone ? ` tone-${insight.valueTone}` : ''}">${escapeHtml(insight.value)}</div>
        ${insight.meta ? `<div class="insight-meta">${escapeHtml(insight.meta)}</div>` : ''}
        ${subtextHtml}
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

