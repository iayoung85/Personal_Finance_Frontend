// ============================================================
// transactions/category-summary.js — Read-Only Category Summary
// Replaces the old chart modal with a grouped category table.
// ============================================================

function toggleCategorySummaryModal() {
  const modal = document.getElementById('category-summary-modal');
  if (!modal) {
    return;
  }

  if (modal.classList.contains('hidden')) {
    renderCategorySummaryModal();
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

function closeCategorySummaryModal() {
  const modal = document.getElementById('category-summary-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function _formatCategorySummaryAmount(rawTotal, displayMode) {
  return formatAnalyticsCurrency(getAnalyticsDisplayAmount(rawTotal, displayMode));
}

function _renderCategorySummaryGroup(categoryGroup) {
  const detailRows = categoryGroup.detailed.map(detail => `
    <div class="category-summary-row detail">
      <span class="category-summary-label">${escapeHtml(detail.category)}</span>
      <span class="category-summary-value">${escapeHtml(_formatCategorySummaryAmount(detail.total, detail.display_mode))}</span>
    </div>
  `).join('');

  return `
    <section class="category-summary-group">
      <div class="category-summary-row primary">
        <span class="category-summary-label">${escapeHtml(categoryGroup.category)}</span>
        <span class="category-summary-value">${escapeHtml(_formatCategorySummaryAmount(categoryGroup.total, categoryGroup.display_mode))}</span>
      </div>
      ${detailRows || '<div class="category-summary-empty-detail">No detailed categories</div>'}
    </section>
  `;
}

function renderCategorySummaryModal() {
  const modal = document.getElementById('category-summary-modal');
  const statsEl = document.getElementById('category-summary-stats');
  const contentEl = document.getElementById('category-summary-content');
  const emptyEl = document.getElementById('category-summary-empty');

  if (!modal || !statsEl || !contentEl || !emptyEl) {
    return;
  }

  const summaryData = buildVisibleCategorySummaryData();

  if (!summaryData.categories.length) {
    statsEl.innerHTML = '';
    contentEl.innerHTML = '';
    emptyEl.classList.add('visible');
    emptyEl.textContent = 'No category summary data in the current ledger view';
    return;
  }

  emptyEl.classList.remove('visible');
  statsEl.innerHTML = `
    <div class="category-summary-stat">
      <span class="category-summary-stat-label">Spending</span>
      <span class="category-summary-stat-value">${escapeHtml(_formatCategorySummaryAmount(summaryData.spending_total, 'spending'))}</span>
    </div>
    <div class="category-summary-stat">
      <span class="category-summary-stat-label">Income</span>
      <span class="category-summary-stat-value">${escapeHtml(_formatCategorySummaryAmount(summaryData.income_total, 'income'))}</span>
    </div>
    <div class="category-summary-stat">
      <span class="category-summary-stat-label">Investment Trend</span>
      <span class="category-summary-stat-value">${escapeHtml(_formatCategorySummaryAmount(summaryData.investment_trending_total, 'signed'))}</span>
    </div>
    <div class="category-summary-stat">
      <span class="category-summary-stat-label">Transactions</span>
      <span class="category-summary-stat-value">${summaryData.transaction_count}</span>
    </div>
  `;
  contentEl.innerHTML = summaryData.categories.map(_renderCategorySummaryGroup).join('');
}