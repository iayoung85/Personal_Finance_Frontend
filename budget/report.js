// ============================================================
// budget/report.js — the Report panel. Draws through the shared
// renderBudgetReport, the same one the Transactions modal uses.
// ============================================================

/**
 * Load the report when it has never loaded or a save made it stale.
 *
 * @param {boolean} [force=false] - reload even when it is current
 */
async function loadBudgetReport(force = false) {
  const container = document.getElementById('budget-report-container');
  if (!container || budgetReportLoading) return;
  if (!force && budgetReport && !budgetReportStale) return;

  budgetReportLoading = true;
  if (!budgetReport) {
    container.innerHTML = '<div class="bt-loading">Loading the report…</div>';
  }
  _setReportRefreshBusy(true);
  try {
    budgetReport = await fetchBudgetReport();
    budgetReportStale = false;
    renderBudgetReportPanel();
  } catch (loadError) {
    _renderBudgetReportError(container, loadError.message);
  } finally {
    budgetReportLoading = false;
    _setReportRefreshBusy(false);
  }
}

function renderBudgetReportPanel() {
  const container = document.getElementById('budget-report-container');
  renderBudgetReport(container, budgetReport, {
    targetsHref: '#targets',
  });
}

function _renderBudgetReportError(container, message) {
  const text = message || 'The report could not be loaded.';
  container.innerHTML = '<div class="bt-error" role="alert">'
    + `<p>Couldn't load the Budget report: ${escapeBudgetHtml(text)}</p>`
    + '<button type="button" class="secondary" data-budget-action="retry-report">Try again</button>'
    + '</div>';
}

function _setReportRefreshBusy(isBusy) {
  const button = document.getElementById('budget-report-refresh');
  if (!button) return;
  button.disabled = isBusy;
  button.textContent = isBusy ? 'Refreshing…' : 'Refresh';
}
