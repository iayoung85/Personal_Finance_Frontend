// ============================================================
// categories/main.js — Bootstrap / DOMContentLoaded entry point
// Loaded LAST — every other categories/* module must be loaded first.
// ============================================================

/**
 * Called by nav-sidebar.js _switchPanel() whenever the user
 * clicks a sub-nav item.  Lets us lazy-render content that
 * only makes sense when a panel is visible.
 */
function loadSectionContent(section) {
  // Panels that need a one-detailed-field guarantee
  if (section === 'preview') {
    if (getDetailedCategoryValues().length === 0) {
      addDetailedCategoryField();
    }
  }
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

  resetIdleTimeout();
  setupActivityListeners();

  // Load all categorization data (cache-first, then network)
  await loadCategorizationData();

  // Ensure at least one detailed-category input row exists
  if (getDetailedCategoryValues().length === 0) {
    addDetailedCategoryField();
  }

  // Wire up CSV file-input listener (advanced mode)
  _initCSVFileInput();

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
  // to pre-create, populate the custom category form with it.
  _applyPrefillCustomCategory();
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
 * If sessionStorage contains a prefill category (set by another page),
 * populate the Custom Category form on the "My Categories" panel.
 * Handles both "Primary: Detailed" and bare strings gracefully —
 * bare strings go into the primary field with a hint to add details.
 */
function _applyPrefillCustomCategory() {
  const rawCategory = sessionStorage.getItem('pf_prefill_custom_category');
  if (!rawCategory) return;
  sessionStorage.removeItem('pf_prefill_custom_category');

  const parts = parseCategoryName(rawCategory);
  const primaryInput = document.getElementById('custom-primary-input');
  if (!primaryInput) return;

  if (parts.primary) {
    primaryInput.value = parts.primary;
  }

  // Clear existing detailed fields and add the prefilled one (or an empty row)
  clearDetailedCategoryFields();
  if (parts.detailed) {
    addDetailedCategoryField(parts.detailed);
  } else {
    addDetailedCategoryField();
    showStatus('Category must be "Primary: Detailed" format — enter a detailed name below.', 'warning');
  }

  // Scroll the custom-categories card into view so the user sees the prefilled form
  const customCard = document.getElementById('custom-categories-card');
  if (customCard) {
    customCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
