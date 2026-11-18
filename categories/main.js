// ============================================================
// categories/main.js — Bootstrap / DOMContentLoaded entry point
// Loaded LAST — every other categories/* module must be loaded first.
// ============================================================

/**
 * Called by nav-sidebar.js _switchPanel() whenever the user
 * clicks a sub-nav item. No panel needs lazy work today; the hook
 * stays so the sidebar's call has somewhere to land.
 */
function loadSectionContent(section) {
  // Leaving the table's panel closes its menu, which would float over another panel.
  if (section !== 'preview' && typeof closeCategoryMenu === 'function') closeCategoryMenu(false);
}

document.addEventListener('DOMContentLoaded', async function initCategoriesPage() {
  // Wait for BACKEND_URL to resolve (set in config.js)
  await window.BACKEND_URL_PROMISE;

  // Activate local-dev auto-login if available
  if (window.ensureLocalDevSession) {
    window.ensureLocalDevSession();
  }

  refreshAuthState();

  if (!token) {
    alert('Please log in first');
    window.location.href = 'index.html';
    return;
  }

  initCategoryTable();

  // Load all categorization data (cache-first, then network)
  await loadCategorizationData();

  // Wire up CSV file-input listener (advanced mode)
  _initCSVFileInput();
  _initCSVCopyButtons();

  // Live-filter the mappings list as the user types
  document.addEventListener('input', function onMappingFilter(event) {
    if (event.target.id === 'mapping-filter') {
      renderMappingsList(event.target.value);
    }
  });

  // Activate the correct panel from the URL hash (default: preview)
  const initialSection = window.location.hash.replace('#', '') || 'preview';
  _activateInitialPanel(initialSection);

  // If another page (e.g. transactions manual-txn modal) sent us a category
  // to pre-create, open the create modal with it.
  _applyPrefillCustomCategory();

  // If redirected from transactions page Rule button, pre-fill the rule form
  applyRulePrefill();
});

/**
 * Shows the right panel on first load without triggering the
 * nav-sidebar animation (the sidebar hasn't attached its
 * click handlers yet on first paint if DOMContentLoaded fires
 * before nav-sidebar).
 */
function _activateInitialPanel(section) {
  const panels = document.querySelectorAll('.categories-panel');
  panels.forEach(panel => {
    if (panel.id === section) {
      panel.classList.remove('hidden');
      panel.classList.add('active');
    } else {
      panel.classList.add('hidden');
      panel.classList.remove('active');
    }
  });

  // Also set the matching sub-nav link as active
  const subNavLinks = document.querySelectorAll('.nav-sidebar-subnav .nav-sidebar-link');
  subNavLinks.forEach(link => {
    link.classList.toggle('active', link.dataset.section === section);
  });
}

/**
 * If another page left a category to create in sessionStorage, open the
 * create modal with it filled in. Saving it hands it back to the waiting
 * transaction (see pending-category-return.js).
 */
function _applyPrefillCustomCategory() {
  const rawCategory = sessionStorage.getItem('pf_prefill_custom_category');
  if (!rawCategory) return;
  sessionStorage.removeItem('pf_prefill_custom_category');

  const parts = parseCategoryName(rawCategory);
  if (window.location.hash.replace('#', '') !== 'preview') _activateInitialPanel('preview');
  openCategoryEditor({
    mode: 'create',
    parent: parts.primary || '',
    name: parts.detailed || '',
    kindSourcePrimary: parts.primary || ''
  });
  if (!parts.detailed) {
    _setDialogMessage('A category needs a detailed name under its primary. Enter one in Name.', 'warning');
  }
}
