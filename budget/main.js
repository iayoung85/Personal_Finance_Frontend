// ============================================================
// budget/main.js — Budget page startup and panel switching.
// Loaded last.
// ============================================================

const BUDGET_PANELS = ['report', 'targets'];
const BUDGET_DEFAULT_PANEL = 'report';

let _budgetStatusTimer = null;

/**
 * Called by nav-sidebar.js when a Budget link switches the panel in
 * place, and by showBudgetPanel. Loads what the panel shows.
 *
 * @param {string} section - 'report' or 'targets'
 */
function loadSectionContent(section) {
  if (section === 'targets') {
    loadBudgetTargets();
  } else {
    loadBudgetReport();
  }
}

function _budgetPanelFromHash() {
  const section = window.location.hash.replace('#', '');
  return BUDGET_PANELS.includes(section) ? section : BUDGET_DEFAULT_PANEL;
}

/**
 * Show one panel, mark its sidebar link, and load its content.
 *
 * @param {string} section
 */
function showBudgetPanel(section) {
  const target = BUDGET_PANELS.includes(section) ? section : BUDGET_DEFAULT_PANEL;
  document.querySelectorAll('.budget-panel').forEach(panel => {
    const isTarget = panel.id === target;
    panel.classList.toggle('hidden', !isTarget);
    panel.classList.toggle('active', isTarget);
  });
  document.querySelectorAll('.nav-sidebar-subnav .nav-sidebar-link').forEach(link => {
    const isOwn = link.dataset.parentPage === 'budget';
    link.classList.toggle('active', isOwn && link.dataset.section === target);
  });
  const wantedHash = target === BUDGET_DEFAULT_PANEL ? '' : `#${target}`;
  if (window.location.hash !== wantedHash) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${wantedHash}`);
  }
  loadSectionContent(target);
}

/**
 * A short message above the panels. Success and info fade on their own.
 *
 * @param {string} message
 * @param {'success'|'info'|'error'} [type='info']
 */
function showBudgetStatus(message, type = 'info') {
  const bar = document.getElementById('budget-status');
  bar.textContent = message;
  bar.className = `budget-status budget-status-${type}`;
  clearTimeout(_budgetStatusTimer);
  if (type !== 'error') {
    _budgetStatusTimer = setTimeout(() => bar.classList.add('hidden'), 4000);
  }
}

function _wireBudgetPageActions() {
  document.addEventListener('click', event => {
    const actionEl = event.target.closest('[data-budget-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.budgetAction;
    if (action === 'targets') {
      event.preventDefault();
      showBudgetPanel('targets');
      window.scrollTo(0, 0);
    } else if (action === 'retry-report') {
      loadBudgetReport(true);
    } else if (action === 'retry-targets') {
      loadBudgetTargets(true);
    }
  });

  document.getElementById('budget-report-refresh').addEventListener('click', () => loadBudgetReport(true));

  // The browser's back and forward buttons move between #targets and the report.
  window.addEventListener('hashchange', () => showBudgetPanel(_budgetPanelFromHash()));
}

document.addEventListener('DOMContentLoaded', async function initBudgetPage() {
  await window.BACKEND_URL_PROMISE;
  if (window.ensureLocalDevSession) window.ensureLocalDevSession();
  refreshAuthState();

  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  _wireBudgetPageActions();
  showBudgetPanel(_budgetPanelFromHash());
});
