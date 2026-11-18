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

async function authenticatedFetch(url, options = {}) {
  const sentToken = token;
  const headers = {
    'Authorization': `Bearer ${sentToken}`,
    ...options.headers
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const renewedToken = await renewSessionAfter401(sentToken);
    if (renewedToken) {
      token = renewedToken;
      headers['Authorization'] = `Bearer ${token}`;
      return fetch(url, { ...options, headers });
    }
  }

  return response;
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
      lockedLabels,
      catchAllState,
      plaidNamedLabels,
      availableCategories,
      categoryLabels,
      categoryListHash,
      rules,
      migrationLog,
      primaryCategories
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

/**
 * Load the page's data, from the short-lived cache or the network.
 * @param {boolean} [forceNetwork]
 * @returns {Promise<boolean>} Whether the category list loaded. When it did
 *   not, categoryLoadFailed is set and the table says so.
 */
async function loadCategorizationData(forceNetwork = false) {
  let categoriesLoaded = false;
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
          // A copy saved before primary_categories or labels existed counts as a miss.
          if (cached && cached.categoryMappings && cachedTax && 'primaryCategories' in cached && 'categoryLabels' in cached) {
            categoryMappings = cached.categoryMappings;
            customCategories = cached.customCategories || [];
            // A copy saved before locked_labels existed has none.
            lockedLabels = normalizeLockedLabels(cached.lockedLabels);
            // A copy saved before the catch-all fields existed has none.
            catchAllState = readCatchAll(
              { catch_all_plaid_key: (cached.catchAllState || {}).plaidKey, catch_all_label: (cached.catchAllState || {}).label },
              CATCH_ALL_PLAID_KEY
            );
            plaidNamedLabels = normalizePlaidNamedLabels(cached.plaidNamedLabels);
            availableCategories = cached.availableCategories || [];
            categoryLabels = Array.isArray(cached.categoryLabels) ? cached.categoryLabels : [];
            categoryListHash = cached.categoryListHash || null;
            rules = cached.rules || [];
            migrationLog = cached.migrationLog || [];
            primaryCategories = cached.primaryCategories;
            plaidTaxonomy = cachedTax;
            categoryLoadFailed = false;
            categoriesLoaded = true;

            console.log(`Loaded categories page from cache (age: ${Math.round(cacheAge / 1000)}s)`);
            renderAllCategoryViews();
            checkBrokenRulesLocally();
            return true;
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
      authenticatedFetch(`${BACKEND_URL}/api/accounts/banks`),
    ];
    if (needTaxonomy) {
      fetches.push(authenticatedFetch(`${BACKEND_URL}/api/categorization/plaid-taxonomy`));
    }

    const responses = await Promise.all(fetches);

    // An error page may not be JSON; a failed list is reported below, not thrown.
    const categoriesData = responses[0].ok ? await responses[0].json() : {};
    const rulesData = await responses[1].json();
    const logData = await responses[2].json();
    const brokenRulesData = await responses[3].json();
    const overridesData = await responses[4].json();
    const banksData = await responses[5].json();

    categoryMappings = responses[0].ok ? (categoriesData.category_mappings || {}) : {};
    customCategories = responses[0].ok ? (categoriesData.custom_categories || []) : [];
    lockedLabels = responses[0].ok ? normalizeLockedLabels(categoriesData.locked_labels) : [];
    catchAllState = readCatchAll(responses[0].ok ? categoriesData : {}, CATCH_ALL_PLAID_KEY);
    plaidNamedLabels = responses[0].ok ? normalizePlaidNamedLabels(categoriesData.plaid_named_labels) : [];
    categoryListHash = responses[0].ok ? (categoriesData.category_list_hash || null) : null;
    categoryLabelsMissing = responses[0].ok && !Array.isArray(categoriesData.labels);
    categoryLabels = responses[0].ok && Array.isArray(categoriesData.labels) ? categoriesData.labels : [];
    primaryCategories = responses[0].ok && Array.isArray(categoriesData.primary_categories)
      ? categoriesData.primary_categories
      : null;
    categoryLoadFailed = !responses[0].ok;
    categoriesLoaded = responses[0].ok;
    rules = responses[1].ok ? (rulesData.rules || []) : [];
    migrationLog = responses[2].ok ? (logData.migrations || []) : [];
    overrides = responses[4].ok ? (overridesData.overrides_by_category || []) : [];

    // Build account options for account-scoped rules.
    // Exclude archived/hidden accounts so users only target active ones.
    ruleAccountOptions = [];
    if (responses[5].ok && banksData.banks) {
      for (const bank of banksData.banks) {
        if (bank.is_archived) continue;
        for (const account of (bank.accounts || [])) {
          if (account.is_archived || account.is_hidden) continue;
          ruleAccountOptions.push({
            account_id: account.account_id,
            display_name: `${account.custom_name || account.account_name || 'Unknown'} (${bank.custom_name || bank.bank_name || 'Unknown Bank'})`,
          });
        }
      }
      ruleAccountOptions.sort((a, b) => a.display_name.localeCompare(b.display_name));
    }

    // Handle broken rules from the batch response
    if (responses[3].ok && brokenRulesData.has_broken_rules) {
      showBrokenRulesModal(brokenRulesData.broken_rules);
    } else if (forceNetwork) {
      showStatus('✓ All rules are valid', 'success');
      setTimeout(() => clearStatus(), 3000);
    }

    if (needTaxonomy) {
      const taxonomyData = await responses[6].json();
      plaidTaxonomy = responses[6].ok ? (taxonomyData.categories || []) : [];
    } else {
      plaidTaxonomy = cachedTaxonomy;
    }

    // This page's own pickers (rules, overrides, mappings) offer every listed
    // label, hidden ones included, so the list is derived here rather than
    // read from /available, which leaves hidden labels out.
    availableCategories = _deriveAvailableCategories();

    // Ensure all Plaid categories are in categoryMappings
    plaidTaxonomy.forEach(cat => {
      if (!(cat.detailed in categoryMappings)) {
        const displayNames = getCategoryDisplayNames(cat);
        categoryMappings[cat.detailed] = displayNames.full || formatPlaidCategory(cat.detailed);
      }
    });

    // A failed list must not be saved, or the next visit would show it as empty.
    if (!categoryLoadFailed) _saveCatPageCache();

    // The list above holds hidden labels, so it must not reach the other
    // pages' pickers; expiring their copy makes them ask /available again.
    expireSharedCategoryPickerCache();

    renderAllCategoryViews();
    if (categoryLoadFailed) showStatus('Could not load your categories.', 'error');
    return categoriesLoaded;
  } catch (loadError) {
    console.error('loadCategorizationData error:', loadError);
    showStatus(`Failed to load categorization data: ${loadError.message}`, 'error');
    if (!categoriesLoaded) {
      categoryLoadFailed = true;
      renderCategoryTable();
    }
    return false;
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
  renderCategoryTable();
  renderRulesTable();
  renderOverridesTable();
  renderRuleFormOptions();
  renderMigrationLog();
  renderDetailedMappingFilterOptions();
  updateCategoryHashDisplay();
}

/**
 * Make the other pages' category pickers fetch /available on their next
 * load instead of trusting a copy saved before a change made here.
 */
function expireSharedCategoryPickerCache() {
  try {
    localStorage.removeItem('pf_categories_cached_at');
  } catch (storageError) { /* non-fatal */ }
}

// ── The Categories table's calls ────────────────────────────
// Each resolves to {ok, status, data}: data is the parsed body, which on a
// refusal is {error, reason, ...}. A network failure rejects.

async function _categoryTableCall(method, path, body) {
  await window.BACKEND_URL_PROMISE;
  const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = null;
  try {
    data = await response.json();
  } catch (parseError) { /* body was not JSON */ }
  return { ok: response.ok, status: response.status, data };
}

/** @param {{labels: string[], hidden: boolean}} body */
function setCategoriesHidden(body) {
  return _categoryTableCall('PUT', '/categories/hidden', body);
}

/** @param {{label: string, description: string}} body Blank clears it. */
function setCategoryDescription(body) {
  return _categoryTableCall('PUT', '/categories/description', body);
}

/** @param {{label: string, primary: string, detailed: string, kind?: string}} body */
function editCategoryLabel(body) {
  return _categoryTableCall('PUT', '/categories/label', body);
}

/** @param {{primary: string, new_primary: string, kind?: string}} body */
function renameCategoryPrimary(body) {
  return _categoryTableCall('PUT', '/categories/primary', body);
}

/** @param {{category_name: string, kind?: string}} body */
function createCategoryLabel(body) {
  return _categoryTableCall('POST', '/categories/custom', body);
}

/** @param {string[]} sources @param {string} target */
function mergeCategoryLabels(sources, target) {
  return _categoryTableCall('POST', '/categories/merge-labels', { sources, target });
}

/** @param {string} label */
function deleteCategoryLabel(label) {
  return _categoryTableCall('POST', '/categories/delete-label', { label });
}

/**
 * @param {boolean} dryRun
 * @param {string[]} [labels] On the real run, the dry run's list, so a category
 *   that became unused while the confirm was open is not deleted unseen.
 */
function removeUnusedCategories(dryRun, labels) {
  const body = { dry_run: dryRun };
  if (Array.isArray(labels)) body.labels = labels;
  return _categoryTableCall('POST', '/categories/remove-unused', body);
}
