// ============================================================
// transactions/category-summary.js — Read-Only Category Summary
// Replaces the old chart modal with a grouped category table.
// ============================================================

// Whether the Retirement Income card shows every line or just the first few.
let categorySummaryRetirementExpanded = false;
let categorySummaryLastData = null;

function toggleCategorySummaryModal() {
  const modal = document.getElementById('category-summary-modal');
  if (!modal) {
    return;
  }

  if (modal.classList.contains('hidden')) {
    categorySummaryRetirementExpanded = false;
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

function _renderCategorySummaryAmount(rawTotal, displayMode, className) {
  const signed = getAnalyticsSignedDisplay(rawTotal, displayMode);
  return `<span class="${className} tone-${signed.tone}">${escapeHtml(signed.text)}</span>`;
}

function _renderCategorySummaryGroup(categoryGroup) {
  const detailRows = categoryGroup.detailed.map(detail => `
    <div class="category-summary-row detail">
      <span class="category-summary-label">${escapeHtml(detail.category)}</span>
      ${_renderCategorySummaryAmount(detail.total, detail.display_mode, 'category-summary-value')}
    </div>
  `).join('');

  return `
    <section class="category-summary-group">
      <div class="category-summary-row primary">
        <span class="category-summary-label">${escapeHtml(categoryGroup.category)}</span>
        ${_renderCategorySummaryAmount(categoryGroup.total, categoryGroup.display_mode, 'category-summary-value')}
      </div>
      ${detailRows || '<div class="category-summary-empty-detail">No detailed categories</div>'}
    </section>
  `;
}

function _renderRetirementIncomeLine(line) {
  return `
    <div class="category-summary-stat-part">
      <span class="category-summary-stat-part-name" title="${escapeHtml(line.name)}">${escapeHtml(line.name)}</span>
      ${_renderCategorySummaryAmount(line.total, 'signed', 'category-summary-stat-part-value')}
    </div>
  `;
}

// Lines past the collapsed limit open in a panel that floats over the cards
// below, so expanding never pushes the grid down or unevens the stat row.
function _renderRetirementIncomeLines(lines) {
  const { visible, hiddenCount } = splitRetirementIncomeLines(lines, false);
  const lineHtml = visible.map(_renderRetirementIncomeLine).join('');
  if (hiddenCount === 0) {
    return lineHtml;
  }

  if (!categorySummaryRetirementExpanded) {
    return lineHtml
      + `<button type="button" class="category-summary-stat-toggle" aria-expanded="false" onclick="toggleCategorySummaryRetirementLines()">+${hiddenCount} more</button>`;
  }

  const overflowHtml = lines.slice(visible.length).map(_renderRetirementIncomeLine).join('');
  return lineHtml + `
    <div class="category-summary-stat-overflow">
      ${overflowHtml}
      <button type="button" class="category-summary-stat-toggle" aria-expanded="true" onclick="toggleCategorySummaryRetirementLines()">Show less</button>
    </div>
  `;
}

function toggleCategorySummaryRetirementLines() {
  if (!categorySummaryLastData) {
    return;
  }
  categorySummaryRetirementExpanded = !categorySummaryRetirementExpanded;
  _renderCategorySummaryStats(categorySummaryLastData);
}

function _renderCategorySummaryStats(summaryData) {
  const statsEl = document.getElementById('category-summary-stats');
  if (!statsEl) {
    return;
  }

  statsEl.innerHTML = `
    <div class="category-summary-stat">
      <span class="category-summary-stat-label">Spending</span>
      ${_renderCategorySummaryAmount(summaryData.spending_total, 'spending', 'category-summary-stat-value')}
    </div>
    <div class="category-summary-stat">
      <span class="category-summary-stat-label">Total Income</span>
      ${_renderCategorySummaryAmount(summaryData.all_income_total, 'income', 'category-summary-stat-value')}
      <div class="category-summary-stat-part">
        <span>Earned income</span>
        ${_renderCategorySummaryAmount(summaryData.income_total, 'income', 'category-summary-stat-part-value')}
      </div>
      <div class="category-summary-stat-part">
        <span>Other inflow</span>
        ${_renderCategorySummaryAmount(summaryData.other_inflow_total, 'income', 'category-summary-stat-part-value')}
      </div>
    </div>
    <div class="category-summary-stat">
      <span class="category-summary-stat-label">Investment Trend</span>
      ${_renderCategorySummaryAmount(summaryData.investment_trending_total, 'signed', 'category-summary-stat-value')}
    </div>
    <div class="category-summary-stat category-summary-stat-retirement">
      <span class="category-summary-stat-label">Retirement Income</span>
      ${_renderCategorySummaryAmount(summaryData.retirement_income_total, 'signed', 'category-summary-stat-value')}
      ${_renderRetirementIncomeLines(summaryData.retirement_income_lines)}
    </div>
  `;
}

function renderCategorySummaryModal() {
  const modal = document.getElementById('category-summary-modal');
  const statsEl = document.getElementById('category-summary-stats');
  const contentEl = document.getElementById('category-summary-content');
  const emptyEl = document.getElementById('category-summary-empty');
  const countEl = document.getElementById('category-summary-count');

  if (!modal || !statsEl || !contentEl || !emptyEl || !countEl) {
    return;
  }

  const summaryData = buildVisibleCategorySummaryData();

  if (!summaryData.categories.length) {
    statsEl.innerHTML = '';
    contentEl.innerHTML = '';
    countEl.textContent = '';
    emptyEl.classList.add('visible');
    emptyEl.textContent = 'No category summary data in the current ledger view';
    return;
  }

  emptyEl.classList.remove('visible');
  const transactionCount = summaryData.transaction_count;
  countEl.textContent = `${transactionCount.toLocaleString('en-US')} ${transactionCount === 1 ? 'transaction' : 'transactions'}`;
  categorySummaryLastData = summaryData;
  _renderCategorySummaryStats(summaryData);
  contentEl.innerHTML = summaryData.categories
    .filter(group => !summaryData.stat_card_only_categories.includes(group.category))
    .map(_renderCategorySummaryGroup)
    .join('');
}
