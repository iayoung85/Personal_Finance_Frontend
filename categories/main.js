// ============================================================
// categories/main.js — Bootstrap / DOMContentLoaded entry point
// Loaded LAST — every other categories/* module must be loaded first.
// ============================================================

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
});
