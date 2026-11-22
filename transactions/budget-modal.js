// ============================================================
// transactions/budget-modal.js — the Budget report over the ledger
//
// Draws through shared/budget-report.js, the same as the Budget
// page. The modal only overlays the page: it reads and writes no
// ledger state, so the filters and scroll are as they were when it
// closes.
// ============================================================

let _budgetModalReport = null;
let _budgetModalOpener = null;
let _budgetModalRequest = 0;

function openBudgetModal() {
  const modal = document.getElementById('budget-modal');
  _budgetModalOpener = document.activeElement;
  modal.classList.remove('hidden');
  document.addEventListener('keydown', _onBudgetModalKeydown);
  document.getElementById('budget-modal-close').focus({ preventScroll: true });

  const container = document.getElementById('budget-modal-container');
  if (_budgetModalReport) {
    _drawBudgetModalReport();
  } else {
    container.innerHTML = '<div class="bt-loading">Loading the report…</div>';
  }
  _loadBudgetModalReport();
}

function closeBudgetModal() {
  document.getElementById('budget-modal').classList.add('hidden');
  document.removeEventListener('keydown', _onBudgetModalKeydown);
  if (_budgetModalOpener && typeof _budgetModalOpener.focus === 'function') {
    _budgetModalOpener.focus({ preventScroll: true });
  }
  _budgetModalOpener = null;
}

function _onBudgetModalKeydown(event) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  closeBudgetModal();
}

// The report is fetched on every open, since targets may have been
// changed in another tab; the last copy shows meanwhile.
async function _loadBudgetModalReport() {
  const requestNumber = ++_budgetModalRequest;
  const container = document.getElementById('budget-modal-container');
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/budget/report`);
    const body = await response.json().catch(() => ({}));
    if (requestNumber !== _budgetModalRequest) return;
    if (!response.ok) throw new Error(body.error || `Server error (${response.status})`);
    _budgetModalReport = body;
    _drawBudgetModalReport();
  } catch (loadError) {
    if (requestNumber !== _budgetModalRequest) return;
    if (_budgetModalReport) return;
    container.innerHTML = '<div class="bt-error" role="alert">'
      + `<p>Couldn't load the Budget report: ${escapeBudgetHtml(loadError.message || 'unknown error')}</p>`
      + '<button type="button" class="secondary" onclick="_loadBudgetModalReport()">Try again</button>'
      + '</div>';
  }
}

function _drawBudgetModalReport() {
  renderBudgetReport(document.getElementById('budget-modal-container'), _budgetModalReport, {
    targetsHref: 'budget.html#targets',
    targetsInNewTab: true,
  });
}
