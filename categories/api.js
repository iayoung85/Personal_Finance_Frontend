// ============================================================
// categories/api.js — Auth & Backend Communication
// Authentication helpers, token refresh, and data-loading
// orchestration. All network calls route through
// authenticatedFetch() for automatic 401 retry.
// ============================================================

function refreshAuthState() {
  token = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (parseError) {
    console.error('Error parsing currentUser', parseError);
    currentUser = null;
  }
}

// Re-read auth state on script load
refreshAuthState();

async function refreshAccessToken() {
  if (!refreshToken) {
    return false;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (response.ok) {
      const data = await response.json();
      token = data.access_token;
      localStorage.setItem('authToken', token);
      if (data.refresh_token) {
        refreshToken = data.refresh_token;
        localStorage.setItem('refreshToken', refreshToken);
      }
      resetIdleTimeout();
      return true;
    } else {
      return false;
    }
  } catch (networkError) {
    console.error('Token refresh failed:', networkError);
    return false;
  }
}

async function authenticatedFetch(url, options = {}) {
  const headers = {
    'ngrok-skip-browser-warning': 'true',
    'Authorization': `Bearer ${token}`,
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    }
    // Session expired and refresh failed — logout and redirect
    logout();
    alert('Session expired. Please log in again.');
    return Promise.reject(new Error('Session expired'));
  }

  return response;
}

function resetIdleTimeout() {
  if (window.LOCAL_AUTO_LOGIN_ENABLED) {
    return;
  }
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }

  if (token && currentUser) {
    idleTimeout = setTimeout(() => {
      logout();
      alert('You have been logged out due to inactivity for security reasons.');
    }, IDLE_TIMEOUT);
  }
}

function setupActivityListeners() {
  if (window.LOCAL_AUTO_LOGIN_ENABLED) {
    return;
  }
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  events.forEach(eventName => {
    document.addEventListener(eventName, resetIdleTimeout, true);
  });
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  // Clear data caches on logout for security
  try {
    var req = indexedDB.open('PersonalFinanceDB');
    req.onsuccess = function(e) {
      var db = e.target.result;
      if (db.objectStoreNames.contains('transactions')) {
        var txn = db.transaction(['transactions', 'meta'], 'readwrite');
        txn.objectStore('transactions').clear();
        txn.objectStore('meta').clear();
      }
      db.close();
    };
  } catch (e) { /* non-fatal */ }
  localStorage.removeItem('pf_cached_categories');
  localStorage.removeItem('pf_cached_taxonomy');
  localStorage.removeItem('pf_categories_cached_at');
  localStorage.removeItem('pf_catpage_data');
  localStorage.removeItem('pf_catpage_cached_at');
  localStorage.removeItem('pf_catpage_taxonomy');
  localStorage.removeItem('pf_catpage_taxonomy_at');
  token = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// ── Cache Helpers ───────────────────────────────────────────

/**
 * Derive availableCategories locally from mappings + custom categories.
 * Mirrors the /categories/available endpoint, saving one API call.
 */
function _deriveAvailableCategories() {
  const available = new Set();
  if (categoryMappings) {
    Object.values(categoryMappings).forEach(value => available.add(value));
  }
  if (customCategories) {
    customCategories.forEach(category => available.add(category));
  }
  return Array.from(available).sort();
}

/** Save current categorization state to localStorage cache. */
function _saveCatPageCache() {
  try {
    const cacheData = {
      categoryMappings,
      customCategories,
      availableCategories,
      categoryListHash,
      rules,
      migrationLog
    };
    localStorage.setItem(CAT_PAGE_CACHE_KEY, JSON.stringify(cacheData));
    localStorage.setItem(CAT_PAGE_CACHE_TS_KEY, String(Date.now()));
  } catch (storageError) {
    console.warn('Could not cache categories page data:', storageError);
  }
  // Taxonomy cached separately with longer TTL
  try {
    localStorage.setItem(CAT_PAGE_TAXONOMY_KEY, JSON.stringify(plaidTaxonomy));
    localStorage.setItem(CAT_PAGE_TAXONOMY_TS_KEY, String(Date.now()));
  } catch (storageError) { /* non-fatal */ }
}

/**
 * Try to load cached taxonomy from localStorage (long TTL).
 * Returns the array or null if stale/missing.
 */
function _loadCachedTaxonomy() {
  try {
    const timestamp = localStorage.getItem(CAT_PAGE_TAXONOMY_TS_KEY);
    if (timestamp && (Date.now() - parseInt(timestamp)) < CAT_PAGE_TAXONOMY_MAX_AGE_MS) {
      const data = JSON.parse(localStorage.getItem(CAT_PAGE_TAXONOMY_KEY) || '[]');
      if (data.length > 0) return data;
    }
  } catch (parseError) { /* ignore */ }
  return null;
}

// ── Main Data Loader ────────────────────────────────────────

async function loadCategorizationData(forceNetwork = false) {
  try {
    await window.BACKEND_URL_PROMISE;

    // ── Cache-first strategy ──
    // On page load (forceNetwork=false): serve from cache if fresh.
    // After mutations (forceNetwork=true): always fetch from server.
    if (!forceNetwork) {
      const cachedTs = localStorage.getItem(CAT_PAGE_CACHE_TS_KEY);
      const cacheAge = cachedTs ? (Date.now() - parseInt(cachedTs)) : Infinity;

      if (cacheAge < CAT_PAGE_CACHE_MAX_AGE_MS) {
        try {
          const cached = JSON.parse(localStorage.getItem(CAT_PAGE_CACHE_KEY) || 'null');
          const cachedTax = _loadCachedTaxonomy();
          if (cached && cached.categoryMappings && cachedTax) {
            categoryMappings = cached.categoryMappings;
            customCategories = cached.customCategories || [];
            availableCategories = cached.availableCategories || [];
            categoryListHash = cached.categoryListHash || null;
            rules = cached.rules || [];
            migrationLog = cached.migrationLog || [];
            plaidTaxonomy = cachedTax;

            console.log(`Loaded categories page from cache (age: ${Math.round(cacheAge / 1000)}s)`);
            renderAllCategoryViews();
            checkBrokenRulesLocally();
            return;
          }
        } catch (parseError) {
          console.warn('Category cache parse error, fetching from server:', parseError);
        }
      }
    }

    // ── Network fetch ──
    const cachedTaxonomy = _loadCachedTaxonomy();
    const needTaxonomy = !cachedTaxonomy;

    const fetches = [
      authenticatedFetch(`${BACKEND_URL}/api/categorization/categories`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/migration-log`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/validation/broken-rules`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/transaction-overrides/summary`),
    ];
    if (needTaxonomy) {
      fetches.push(authenticatedFetch(`${BACKEND_URL}/api/categorization/plaid-taxonomy`));
    }

    const responses = await Promise.all(fetches);

    const categoriesData = await responses[0].json();
    const rulesData = await responses[1].json();
    const logData = await responses[2].json();
    const brokenRulesData = await responses[3].json();
    const overridesData = await responses[4].json();

    categoryMappings = responses[0].ok ? (categoriesData.category_mappings || {}) : {};
    customCategories = responses[0].ok ? (categoriesData.custom_categories || []) : [];
    categoryListHash = responses[0].ok ? (categoriesData.category_list_hash || null) : null;
    rules = responses[1].ok ? (rulesData.rules || []) : [];
    migrationLog = responses[2].ok ? (logData.migrations || []) : [];
    overrides = responses[4].ok ? (overridesData.overrides_by_category || []) : [];

    // Handle broken rules from the batch response
    if (responses[3].ok && brokenRulesData.has_broken_rules) {
      showBrokenRulesModal(brokenRulesData.broken_rules);
    } else if (forceNetwork) {
      showStatus('✓ All rules are valid', 'success');
      setTimeout(() => clearStatus(), 3000);
    }

    if (needTaxonomy) {
      const taxonomyData = await responses[5].json();
      plaidTaxonomy = responses[5].ok ? (taxonomyData.categories || []) : [];
    } else {
      plaidTaxonomy = cachedTaxonomy;
    }

    // Derive availableCategories locally (eliminates /categories/available call)
    availableCategories = _deriveAvailableCategories();

    // Ensure all Plaid categories are in categoryMappings
    plaidTaxonomy.forEach(cat => {
      if (!(cat.detailed in categoryMappings)) {
        const displayNames = getCategoryDisplayNames(cat);
        categoryMappings[cat.detailed] = displayNames.full || formatPlaidCategory(cat.detailed);
      }
    });

    // Update cache
    _saveCatPageCache();

    // Also update the shared category caches used by transactions page
    try {
      localStorage.setItem('pf_cached_categories', JSON.stringify(availableCategories));
      localStorage.setItem('pf_cached_taxonomy', JSON.stringify(plaidTaxonomy));
      localStorage.setItem('pf_categories_cached_at', String(Date.now()));
    } catch (storageError) { /* non-fatal */ }

    renderAllCategoryViews();
  } catch (loadError) {
    console.error('loadCategorizationData error:', loadError);
    showStatus(`Failed to load categorization data: ${loadError.message}`, 'error');
  }
}

function refreshCategorizationData() {
  return loadCategorizationData(true);
}

/**
 * Render all category page views.
 * Extracted so both cache-hit and network-fetch paths call the same set of renders.
 */
function renderAllCategoryViews() {
  renderMappingsList();
  derivePrimaryMappingsFromDetailedMappings();
  renderPrimaryMappingsList();
  renderCustomCategories();
  renderRulesTable();
  renderOverridesTable();
  renderRuleFormOptions();
  renderMigrationSelectors();
  renderMigrationLog();
  renderDetailedMappingFilterOptions();
  renderAvailableCategoriesPreview();
  updateCategoryHashDisplay();
}
