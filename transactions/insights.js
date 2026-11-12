// ============================================================
// transactions/insights.js — Insights Panel Rendering
// Uses the shared analytics slice so the cards stay aligned with
// the currently visible ledger rows.
// ============================================================

/**
 * A card amount, masked when privacy mode is on. Only the cards go through
 * here; the category summary modal keeps the plain formatter.
 * @param {number} amount
 * @returns {string}
 */
function _insightMoney(amount) {
  return maskMoney(formatAnalyticsCurrency(amount));
}

function _buildTotalSpendingInsight(analyticsView) {
  const rawTotal = analyticsView.spendingEntries.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    icon: '💰',
    label: 'Total Spending',
    value: _insightMoney(getAnalyticsDisplayTotal(rawTotal, analyticsView.spendingEntries)),
    meta: `${analyticsView.spendingEntries.length} spending transactions`,
    subtext: 'Savings, transfers, adjustments, income, other inflow, retirement income, and system rows excluded',
  };
}

// Spending plus savings: the same two classes the API adds into Total outflow.
function _buildTotalOutflowInsight(analyticsView) {
  const rawTotal = analyticsView.outflowEntries.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    icon: '💸',
    label: 'Total Outflow',
    value: _insightMoney(getAnalyticsDisplayTotal(rawTotal, analyticsView.outflowEntries)),
    meta: `${analyticsView.outflowEntries.length} spending and savings transactions`,
    subtext: 'Spending plus savings. Transfers, adjustments, income, other inflow, retirement income, and system rows excluded',
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
      : `${line.label} ${_insightMoney(line.amount)}`
  ));
  const flow = getInsightCardFlowSummary(matchingEntries);

  if (flow.isMixed) {
    // Why: an unsigned total on a card holding both sides cannot say which
    // side is bigger, so it shows a signed net and both sides beneath it.
    const signedNet = getAnalyticsSignedDisplay(rawTotal, ANALYTICS_DISPLAY_MODE.INCOME);
    return {
      icon: '🏷️',
      label: card.name,
      value: maskMoney(signedNet.text),
      valueTone: signedNet.tone,
      meta: `${matchingEntries.length} transactions`,
      subtext: [
        `In ${_insightMoney(flow.inTotal)} · Out ${_insightMoney(flow.outTotal)}`,
        ...averageLines,
      ],
    };
  }

  return {
    icon: '🏷️',
    label: card.name,
    value: _insightMoney(getAnalyticsDisplayTotal(rawTotal, matchingEntries)),
    meta: `${matchingEntries.length} transactions`,
    subtext: averageLines,
  };
}

function _buildLiveLedgerInsight(analyticsView) {
  const ledgerNetAmount = analyticsView.ledgerEntries.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    icon: '🔎',
    label: 'Live Result',
    value: _insightMoney(ledgerNetAmount),
    meta: `${analyticsView.ledgerEntries.length} displayed transactions`,
    subtext: 'Signed net sum of the current ledger view',
  };
}

function _buildCategorySummaryInsight() {
  return {
    icon: '📋',
    label: 'Category Summary',
    value: 'Open category table',
    meta: 'Total outflow, total inflows, investment trend, and retirement income',
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

  const insights = [
    _buildTotalSpendingInsight(analyticsView),
    _buildTotalOutflowInsight(analyticsView),
  ];

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

