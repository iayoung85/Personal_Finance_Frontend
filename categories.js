// BACKEND_URL is now defined in config.js and auto-detects environment

let categoryMappings = {};
let customCategories = [];
let availableCategories = [];
let rules = [];
let plaidTaxonomy = [];
let migrationLog = [];
let currentRuleEditId = null;
let selectedPrimaryCategories = new Set(['__all__']);
let primaryCategoryMappings = {};
let lastSelectedPrimaryIndex = null;
let selectedDetailedPrimaryFilter = '__all__';

// Check authentication
let token = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let idleTimeout;
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

if (!token) {
  alert('Please log in first');
  window.location.href = 'index.html';
}

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
      resetIdleTimeout();
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    return false;
  }
}

async function authenticatedFetch(url, options = {}) {
  const headers = {
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
    alert('Session expired. Please log in again.');
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
  }
  
  return response;
}

function resetIdleTimeout() {
  // Clear existing timeout
  if (idleTimeout) {
    clearTimeout(idleTimeout);
  }
  
  // Only set idle timeout if user is logged in
  if (token && currentUser) {
    idleTimeout = setTimeout(() => {
      logout();
      alert('You have been logged out due to inactivity for security reasons.');
    }, IDLE_TIMEOUT);
  }
}

function setupActivityListeners() {
  // List of events that indicate user activity
  const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  
  events.forEach(event => {
    document.addEventListener(event, resetIdleTimeout, true);
  });
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  token = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
  await window.BACKEND_URL_PROMISE;
  resetIdleTimeout();
  setupActivityListeners();

  // Load categorization data
  await loadCategorizationData();
  
  // Check for broken rules on load
  await checkBrokenRules(true);

  // Filter mappings
  document.addEventListener('input', function(e) {
    if (e.target.id === 'mapping-filter') {
      renderMappingsList(e.target.value);
    }
  });
});

// ============= STATUS MESSAGES =============

function showStatus(message, type = 'info') {
  const container = document.getElementById('status-message');
  if (!container) {
    const el = document.createElement('div');
    el.id = 'status-message';
    document.body.insertBefore(el, document.querySelector('.container'));
  }
  const statusEl = document.getElementById('status-message');
  statusEl.className = `status-message ${type}`;
  statusEl.textContent = message;
  statusEl.style.position = 'fixed';
  statusEl.style.top = '20px';
  statusEl.style.right = '20px';
  statusEl.style.zIndex = '1001';
  statusEl.style.minWidth = '300px';
}

function clearStatus() {
  const el = document.getElementById('status-message');
  if (el) el.textContent = '';
}

// ============= CATEGORIZATION MANAGEMENT =============

async function loadCategorizationData() {
  try {
    await window.BACKEND_URL_PROMISE;
    const [categoriesRes, availableRes, rulesRes, logRes, taxonomyRes] = await Promise.all([
      authenticatedFetch(`${BACKEND_URL}/api/categorization/categories`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/migration-log`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/plaid-taxonomy`)
    ]);

    const categoriesData = await categoriesRes.json();
    const availableData = await availableRes.json();
    const rulesData = await rulesRes.json();
    const logData = await logRes.json();
    const taxonomyData = await taxonomyRes.json();

    categoryMappings = categoriesRes.ok ? (categoriesData.category_mappings || {}) : {};
    customCategories = categoriesRes.ok ? (categoriesData.custom_categories || []) : [];
    availableCategories = availableRes.ok ? (availableData.available_categories || []) : [];
    rules = rulesRes.ok ? (rulesData.rules || []) : [];
    migrationLog = logRes.ok ? (logData.migrations || []) : [];
    plaidTaxonomy = taxonomyRes.ok ? (taxonomyData.categories || []) : [];

    // Ensure all Plaid categories are in categoryMappings, defaulting to original formatted name
    plaidTaxonomy.forEach(cat => {
      if (!(cat.detailed in categoryMappings)) {
        const displayNames = getCategoryDisplayNames(cat);
        categoryMappings[cat.detailed] = displayNames.full || formatPlaidCategory(cat.detailed);
      }
    });

    renderMappingsList();
    derivePrimaryMappingsFromDetailedMappings();
    renderPrimaryMappingsList();
    renderCustomCategories();
    renderRulesTable();
    renderRuleFormOptions();
    renderMigrationSelectors();
    renderMigrationLog();
    renderDetailedMappingFilterOptions();
    renderAvailableCategoriesPreview();
  } catch (error) {
    console.error('loadCategorizationData error:', error);
    showStatus(`Failed to load categorization data: ${error.message}`, 'error');
  }
}

function renderAvailableCategoriesPreview() {
  const primaryList = document.getElementById('primary-category-list');
  const detailedList = document.getElementById('detailed-category-list');
  const primaryCount = document.getElementById('primary-selected-count');
  const detailedCount = document.getElementById('detailed-count');

  if (!primaryList || !detailedList) return;

  const primarySet = new Set();
  (availableCategories || []).forEach(cat => {
    const parts = parseCategoryName(cat);
    if (parts.primary) primarySet.add(parts.primary);
  });

  const primaryOptions = Array.from(primarySet).sort((a, b) => a.localeCompare(b));

  if (!primaryOptions.length) {
    primaryList.innerHTML = '<div class="empty-state">No categories available.</div>';
    detailedList.innerHTML = '<div class="empty-state">No categories available.</div>';
    if (primaryCount) primaryCount.textContent = '';
    if (detailedCount) detailedCount.textContent = '';
    return;
  }

  if (!selectedPrimaryCategories || selectedPrimaryCategories.size === 0) {
    selectedPrimaryCategories = new Set(['__all__']);
  }

  const primaryItems = [
    { key: '__all__', label: 'All' },
    ...primaryOptions.map(primary => ({ key: primary, label: primary }))
  ];

  const rows = primaryItems
    .map((item, index) => {
      const isSelected = selectedPrimaryCategories.has(item.key);
      return `
        <div class="preview-item ${isSelected ? 'selected' : ''}" data-primary="${escapeHtml(item.key)}" data-index="${index}">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span>${escapeHtml(item.label)}</span>
            <div style="display: flex; gap: 6px; align-items: center;">
              ${item.key === '__all__' ? '<span class="pill">All</span>' : `<button class="secondary" style="padding: 3px 8px; font-size: 11px; white-space: nowrap;" onclick="startAddDetailsForPrimary('${escapeHtml(item.key)}'); event.stopPropagation();">+ Add Custom Detailed Cat</button>`}
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  primaryList.innerHTML = rows;

  primaryList.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('click', event => {
      const key = item.getAttribute('data-primary');
      const index = parseInt(item.getAttribute('data-index') || '0', 10);
      if (!key) return;

      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      if (key === '__all__') {
        selectedPrimaryCategories = new Set(['__all__']);
        lastSelectedPrimaryIndex = index;
        renderAvailableCategoriesPreview();
        return;
      }

      if (isShift && lastSelectedPrimaryIndex !== null) {
        const start = Math.min(lastSelectedPrimaryIndex, index);
        const end = Math.max(lastSelectedPrimaryIndex, index);
        const rangeKeys = primaryItems
          .slice(start, end + 1)
          .map(item => item.key)
          .filter(itemKey => itemKey !== '__all__');

        if (isCtrl) {
          selectedPrimaryCategories.delete('__all__');
          rangeKeys.forEach(k => selectedPrimaryCategories.add(k));
        } else {
          selectedPrimaryCategories = new Set(rangeKeys);
        }
      } else if (isCtrl) {
        if (selectedPrimaryCategories.has('__all__')) {
          selectedPrimaryCategories.delete('__all__');
        }
        if (selectedPrimaryCategories.has(key)) {
          selectedPrimaryCategories.delete(key);
        } else {
          selectedPrimaryCategories.add(key);
        }
      } else {
        selectedPrimaryCategories = new Set([key]);
      }

      if (selectedPrimaryCategories.size === 0) {
        selectedPrimaryCategories.add('__all__');
      }

      lastSelectedPrimaryIndex = index;
      renderAvailableCategoriesPreview();
    });
  });

  const selectedCount = selectedPrimaryCategories.has('__all__')
    ? primaryOptions.length
    : selectedPrimaryCategories.size;

  if (primaryCount) {
    primaryCount.textContent = `${selectedCount} selected`;
  }

  const detailedRows = buildDetailedPreviewRows(primaryOptions);
  detailedList.innerHTML = detailedRows.html;
  if (detailedCount) detailedCount.textContent = `${detailedRows.count} total`;
}

function buildDetailedPreviewRows(primaryOptions) {
  const list = availableCategories || [];
  const filtered = selectedPrimaryCategories.has('__all__')
    ? list
    : list.filter(cat => selectedPrimaryCategories.has(parseCategoryName(cat).primary));

  const sorted = filtered.slice().sort((a, b) => a.localeCompare(b));
  if (!sorted.length) {
    return { html: '<div class="empty-state">No detailed categories match your selection.</div>', count: 0 };
  }

  const html = sorted
    .map(cat => `<div class="preview-item disabled"><span>${escapeHtml(cat)}</span></div>`)
    .join('');

  return { html, count: sorted.length };
}

function refreshCategorizationData() {
  return loadCategorizationData();
}

function renderMappingsList(filterText = '') {
  const container = document.getElementById('mappings-list');
  const filter = (filterText || '').toLowerCase().trim();
  const entries = Object.entries(categoryMappings || {}).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No mappings yet.</div>';
    return;
  }

  const rows = entries
    .filter(([plaidCat, userLabel]) => {
      if (!filter) return true;
      return plaidCat.toLowerCase().includes(filter) || (userLabel || '').toLowerCase().includes(filter);
    })
    .filter(([plaidCat]) => {
      if (selectedDetailedPrimaryFilter === '__all__') return true;
      const taxonomyEntry = plaidTaxonomy.find(t => t.detailed === plaidCat);
      const primaryDisplay = getPrimaryDisplayForDetailed(plaidCat, taxonomyEntry);
      return primaryDisplay === selectedDetailedPrimaryFilter;
    })
    .map(([plaidCat, userLabel]) => {
      // Find the category in taxonomy to get primary for trimming
      const taxonomyEntry = plaidTaxonomy.find(t => t.detailed === plaidCat);
      const displayNames = getCategoryDisplayNames(taxonomyEntry || { detailed: plaidCat });
      const displayKey = displayNames.full || formatPlaidCategory(plaidCat);
      
      const options = buildDetailedOptionsForCategory(plaidCat, userLabel);
      
      return `
        <div class="mapping-row" data-plaid-category="${escapeHtml(plaidCat)}">
          <div class="mapping-key" title="${escapeHtml(plaidCat)}">${escapeHtml(displayKey)}</div>
          <select class="mapping-value" data-plaid-category="${escapeHtml(plaidCat)}">${options}</select>
          <button class="secondary mapping-clear" onclick="clearMapping('${escapeHtml(plaidCat)}')">Clear</button>
        </div>
      `;
    })
    .join('');

  container.innerHTML = rows || '<div class="empty-state">No mappings match your filter.</div>';

  container.querySelectorAll('.mapping-value').forEach(select => {
    select.addEventListener('change', event => {
      const plaidCat = event.target.getAttribute('data-plaid-category');
      if (!plaidCat) return;
      const value = event.target.value;
      const taxonomyEntry = plaidTaxonomy.find(t => t.detailed === plaidCat);
      const displayNames = getCategoryDisplayNames(taxonomyEntry || { detailed: plaidCat });
      const originalDisplay = displayNames.full || formatPlaidCategory(plaidCat);
      if (value === plaidCat) {
        categoryMappings[plaidCat] = originalDisplay;
      } else {
        categoryMappings[plaidCat] = value;
      }
    });
  });
}

function renderPrimaryMappingsList() {
  const container = document.getElementById('primary-mappings-list');
  if (!container) return;

  const plaidPrimaries = getPlaidPrimaryDisplayList();
  if (!plaidPrimaries.length) {
    container.innerHTML = '<div class="empty-state">No primary categories found.</div>';
    return;
  }

  const targetOptions = buildPrimaryCategoryOptions();

  container.innerHTML = plaidPrimaries
    .map(primary => {
      const selected = primaryCategoryMappings[primary] || '';
      return `
        <div class="mapping-row" data-plaid-primary="${escapeHtml(primary)}">
          <div class="mapping-key">${escapeHtml(primary)}</div>
          <select class="mapping-value" data-plaid-primary="${escapeHtml(primary)}">
            ${targetOptions(primary, selected)}
          </select>
          <button class="secondary mapping-clear" onclick="clearPrimaryMapping('${escapeHtml(primary)}')">Clear</button>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.mapping-value').forEach(select => {
    select.addEventListener('change', event => {
      const plaidPrimary = event.target.getAttribute('data-plaid-primary');
      if (!plaidPrimary) return;
      const value = (event.target.value || '').trim();
      if (value) {
        primaryCategoryMappings[plaidPrimary] = value;
      } else {
        delete primaryCategoryMappings[plaidPrimary];
      }
      applyPrimaryMapping(plaidPrimary, value);
      renderMappingsList(document.getElementById('mapping-filter').value);
    });
  });
}

function renderDetailedMappingFilterOptions() {
  const select = document.getElementById('detailed-mapping-primary-filter');
  if (!select) return;

  const primaries = getPlaidPrimaryDisplayList();
  const options = ['__all__', ...primaries];

  if (!options.includes(selectedDetailedPrimaryFilter)) {
    selectedDetailedPrimaryFilter = '__all__';
  }

  select.innerHTML = options
    .map(primary => {
      const label = primary === '__all__' ? 'All primaries' : primary;
      return `<option value="${escapeHtml(primary)}" ${primary === selectedDetailedPrimaryFilter ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');

  select.addEventListener('change', () => {
    selectedDetailedPrimaryFilter = select.value || '__all__';
    renderMappingsList(document.getElementById('mapping-filter').value);
  });
}

function clearMapping(plaidCategory) {
  const row = document.querySelector(`.mapping-row[data-plaid-category="${plaidCategory}"]`);
  if (row) {
    const select = row.querySelector('.mapping-value');
    if (select) select.value = plaidCategory;
  }
  const taxonomyEntry = plaidTaxonomy.find(t => t.detailed === plaidCategory);
  const displayNames = getCategoryDisplayNames(taxonomyEntry || { detailed: plaidCategory });
  categoryMappings[plaidCategory] = displayNames.full || formatPlaidCategory(plaidCategory);
}

function clearPrimaryMapping(plaidPrimary) {
  delete primaryCategoryMappings[plaidPrimary];
  applyPrimaryMapping(plaidPrimary, '');
  renderPrimaryMappingsList();
  renderMappingsList(document.getElementById('mapping-filter').value);
}

async function saveCategoryMappings() {
  try {
    const previousMappings = await fetchServerPrimaryMappings();
    // Use the in-memory categoryMappings object instead of querying the DOM
    // This ensures we save ALL mappings, not just the currently visible ones
    const newMappings = {};
    Object.entries(categoryMappings || {}).forEach(([key, value]) => {
      const trimmedValue = (value || '').trim();
      if (trimmedValue) {
        newMappings[key] = trimmedValue;
      }
    });

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/mappings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_mappings: newMappings })
    });

    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to save mappings', 'error');
      return;
    }

    showStatus('Mappings saved', 'success');
    await reconcileCustomCategoriesForPrimaryMappings(previousMappings, primaryCategoryMappings);
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to save mappings: ${error.message}`, 'error');
  }
}

async function fetchServerPrimaryMappings() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories`);
    const data = await response.json();
    if (!response.ok) {
      return {};
    }
    const mappings = data.category_mappings || {};
    return derivePrimaryMappingsFromMappings(mappings);
  } catch (error) {
    console.warn('Failed to fetch previous mappings:', error);
    return {};
  }
}

async function reconcileCustomCategoriesForPrimaryMappings(previousMappings, currentMappings) {
  const previous = previousMappings || {};
  const current = currentMappings || {};

  const toRemove = [];
  Object.entries(previous).forEach(([plaidPrimaryDisplay, prevTarget]) => {
    const currentTarget = current[plaidPrimaryDisplay];
    if (!currentTarget || currentTarget !== prevTarget) {
      toRemove.push([plaidPrimaryDisplay, prevTarget]);
    }
  });

  for (const [plaidPrimaryDisplay, prevTarget] of toRemove) {
    await deleteCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, prevTarget);
  }

  const entries = Object.entries(current);
  for (const [plaidPrimaryDisplay, targetPrimaryDisplay] of entries) {
    await ensureCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay);
  }
}


function addDetailedCategoryField(value = '') {
  const container = document.getElementById('detailed-categories-list');
  if (!container) return;

  const fieldId = `detailed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fieldDiv = document.createElement('div');
  fieldDiv.className = 'detailed-field-row';
  fieldDiv.innerHTML = `
    <input type="text" id="${fieldId}" placeholder="e.g., Lawn Care" value="${escapeHtml(value)}">
    <button type="button" class="secondary remove-detailed-btn" onclick="removeDetailedCategoryField('${fieldId}')">×</button>
  `;
  container.appendChild(fieldDiv);
  return fieldDiv.querySelector('input');
}

function removeDetailedCategoryField(fieldId) {
  const field = document.getElementById(fieldId);
  if (field && field.parentElement) {
    field.parentElement.remove();
  }
}

function getDetailedCategoryValues() {
  const container = document.getElementById('detailed-categories-list');
  if (!container) return [];
  
  const inputs = container.querySelectorAll('input[type="text"]');
  return Array.from(inputs)
    .map(input => (input.value || '').trim())
    .filter(Boolean);
}

function clearDetailedCategoryFields() {
  const container = document.getElementById('detailed-categories-list');
  if (container) {
    container.innerHTML = '';
  }
}

function startAddDetailsForCategory(categoryName) {
  const parts = parseCategoryName(categoryName);
  if (!parts.primary) return;

  const primaryInput = document.getElementById('custom-primary-input');
  if (primaryInput) {
    primaryInput.value = parts.primary;
    primaryInput.readOnly = true; // Prevent editing when coming from a category
  }

  clearDetailedCategoryFields();
  const newInput = addDetailedCategoryField();
  if (newInput) {
    newInput.focus();
  } else if (primaryInput) {
    primaryInput.focus();
  }

  const card = document.getElementById('custom-categories-card');
  if (card && card.scrollIntoView) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function startAddDetailsForPrimary(primaryName) {
  // Called from the Category Output Preview when user clicks "+ Add Details" on a primary
  // primaryName is the display format (e.g., "Food And Drink")
  
  const primaryInput = document.getElementById('custom-primary-input');
  if (primaryInput) {
    primaryInput.value = primaryName;
    primaryInput.readOnly = true; // Prevent editing when coming from preview
  }

  clearDetailedCategoryFields();
  const newInput = addDetailedCategoryField();
  if (newInput) {
    newInput.focus();
  } else if (primaryInput) {
    primaryInput.focus();
  }

  const card = document.getElementById('custom-categories-card');
  if (card && card.scrollIntoView) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function addCustomCategoryGroup() {
  const primaryInput = document.getElementById('custom-primary-input');
  const primary = (primaryInput?.value || '').trim();
  
  if (!primary) {
    showStatus('Enter a primary category', 'warning');
    return;
  }
  if (primary.includes(':')) {
    showStatus('Primary category should not include ":"', 'warning');
    return;
  }

  const detailedValues = getDetailedCategoryValues();
  const categoriesToAdd = detailedValues.length
    ? detailedValues.map(detail => `${primary}: ${detail}`)
    : [primary];
  const uniqueCategories = Array.from(new Set(categoriesToAdd));

  let successCount = 0;
  const errors = [];

  if (detailedValues.length && (customCategories || []).includes(primary)) {
    await deleteCategory(primary, 'delete');
  }

  for (const categoryName of uniqueCategories) {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: categoryName })
      });
      const data = await response.json();
      if (!response.ok) {
        errors.push(data.error || `Failed to add ${categoryName}`);
        continue;
      }
      successCount += 1;
    } catch (error) {
      errors.push(error.message || `Failed to add ${categoryName}`);
    }
  }

  if (successCount > 0) {
    if (primaryInput) {
      primaryInput.value = '';
      primaryInput.readOnly = false; // Reset readonly state
    }
    clearDetailedCategoryFields();
    const message = errors.length
      ? `Added ${successCount} categories. ${errors.length} failed.`
      : `Added ${successCount} ${successCount === 1 ? 'category' : 'categories'}.`;
    showStatus(message, errors.length ? 'warning' : 'success');
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2500);
  } else {
    showStatus(errors[0] || 'Failed to add categories', 'error');
  }
}

async function addCustomCategory() {
  return addCustomCategoryGroup();
}

let selectedCustomPrimaryCategories = new Set();
let lastSelectedCustomPrimaryIndex = null;

function renderCustomCategories() {
  const container = document.getElementById('custom-category-list');
  if (!customCategories.length) {
    const primaryContainer = document.getElementById('custom-primary-category-list');
    const detailedContainer = document.getElementById('custom-detailed-category-list');
    const primaryCount = document.getElementById('custom-primary-selected-count');
    const detailedCount = document.getElementById('custom-detailed-count');
    
    if (primaryContainer) primaryContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    if (detailedContainer) detailedContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    if (primaryCount) primaryCount.textContent = '';
    if (detailedCount) detailedCount.textContent = '';
    return;
  }

  renderCustomCategoryFiltered();
}

function renderCustomCategoryFiltered() {
  const primaryContainer = document.getElementById('custom-primary-category-list');
  const detailedContainer = document.getElementById('custom-detailed-category-list');
  const primaryCount = document.getElementById('custom-primary-selected-count');
  const detailedCount = document.getElementById('custom-detailed-count');

  if (!primaryContainer || !detailedContainer) return;

  // Group custom categories by primary
  const primaryMap = {};
  (customCategories || []).forEach(cat => {
    const parts = parseCategoryName(cat);
    if (!primaryMap[parts.primary]) {
      primaryMap[parts.primary] = [];
    }
    if (parts.detailed) {
      primaryMap[parts.primary].push(parts.detailed);
    }
  });

  const primaryOptions = Object.keys(primaryMap).sort((a, b) => a.localeCompare(b));

  if (!primaryOptions.length) {
    primaryContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    detailedContainer.innerHTML = '<div class="empty-state">No custom categories yet.</div>';
    if (primaryCount) primaryCount.textContent = '';
    if (detailedCount) detailedCount.textContent = '';
    return;
  }

  // Initialize selection if empty
  if (!selectedCustomPrimaryCategories || selectedCustomPrimaryCategories.size === 0) {
    selectedCustomPrimaryCategories = new Set([primaryOptions[0]]);
  }

  const primaryItems = primaryOptions.map((primary, index) => ({
    key: primary,
    label: primary,
    index
  }));

  const rows = primaryItems
    .map((item) => {
      const isSelected = selectedCustomPrimaryCategories.has(item.key);
      return `
        <div class="preview-item ${isSelected ? 'selected' : ''}" data-primary="${escapeHtml(item.key)}" data-index="${item.index}">
          <span>${escapeHtml(item.label)}</span>
        </div>
      `;
    })
    .join('');

  primaryContainer.innerHTML = rows;

  primaryContainer.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('click', event => {
      const key = item.getAttribute('data-primary');
      const index = parseInt(item.getAttribute('data-index') || '0', 10);
      if (!key) return;

      const isCtrl = event.ctrlKey || event.metaKey;
      const isShift = event.shiftKey;

      if (isShift && lastSelectedCustomPrimaryIndex !== null) {
        const start = Math.min(lastSelectedCustomPrimaryIndex, index);
        const end = Math.max(lastSelectedCustomPrimaryIndex, index);
        const rangeKeys = primaryItems
          .slice(start, end + 1)
          .map(item => item.key);

        if (isCtrl) {
          rangeKeys.forEach(k => selectedCustomPrimaryCategories.add(k));
        } else {
          selectedCustomPrimaryCategories = new Set(rangeKeys);
        }
      } else if (isCtrl) {
        if (selectedCustomPrimaryCategories.has(key)) {
          selectedCustomPrimaryCategories.delete(key);
        } else {
          selectedCustomPrimaryCategories.add(key);
        }
      } else {
        selectedCustomPrimaryCategories = new Set([key]);
      }

      if (selectedCustomPrimaryCategories.size === 0) {
        selectedCustomPrimaryCategories = new Set([primaryOptions[0]]);
      }

      lastSelectedCustomPrimaryIndex = index;
      renderCustomCategoryFiltered();
    });
  });

  // Display detailed categories with action buttons
  const detailedRows = buildCustomDetailedPreviewRows(primaryMap, primaryOptions);
  detailedContainer.innerHTML = detailedRows.html;
  
  if (primaryCount) {
    primaryCount.textContent = `${primaryOptions.length} total`;
  }
  if (detailedCount) {
    detailedCount.textContent = `${detailedRows.count} total`;
  }
}

function buildCustomDetailedPreviewRows(primaryMap, primaryOptions) {
  const rows = [];

  // Iterate through selected primaries in order
  Array.from(selectedCustomPrimaryCategories).forEach(selectedPrimary => {
    if (!primaryMap[selectedPrimary]) return;

    const detailedList = primaryMap[selectedPrimary];
    const primary = selectedPrimary;

    // Add primary category row with buttons
    rows.push(`
      <div class="custom-category-row" style="background: #f8f9fa; padding: 8px 12px; margin: 8px 0; border-radius: 4px; border-left: 3px solid #007bff;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600;">${escapeHtml(primary)}</span>
          <div style="display: flex; gap: 6px;">
            <button class="secondary" style="padding: 4px 8px; font-size: 12px;" onclick="startAddDetailsForCategory('${escapeHtml(primary)}')">+ Add Detailed</button>
            <button class="secondary" style="padding: 4px 8px; font-size: 12px;" onclick="openReassignPrimaryModal('${escapeHtml(primary)}')">Reassign</button>
            <button class="danger" style="padding: 4px 8px; font-size: 12px;" onclick="confirmDeletePrimaryCategory('${escapeHtml(primary)}')">Delete All</button>
          </div>
        </div>
      </div>
    `);

    // Add detailed categories
    if (detailedList && detailedList.length > 0) {
      detailedList.forEach(detailed => {
        const fullCategoryName = `${primary}: ${detailed}`;
        rows.push(`
          <div class="custom-detailed-row" style="padding: 6px 12px 6px 24px; margin: 4px 0; background: #fff; border-radius: 3px; display: flex; justify-content: space-between; align-items: center;">
            <span>${escapeHtml(detailed)}</span>
            <div style="display: flex; gap: 6px;">
              <button class="secondary" style="padding: 3px 8px; font-size: 11px;" onclick="openArchiveDetailedModal('${escapeHtml(fullCategoryName)}')">Archive</button>
              <button class="danger" style="padding: 3px 8px; font-size: 11px;" onclick="confirmDeleteDetailedCategory('${escapeHtml(fullCategoryName)}')">Delete</button>
            </div>
          </div>
        `);
      });
    } else {
      rows.push(`
        <div style="padding: 6px 12px 6px 24px; margin: 4px 0; color: #999; font-size: 13px; font-style: italic;">
          No detailed categories
        </div>
      `);
    }
  });

  if (rows.length === 0) {
    return { html: '<div class="empty-state">No custom categories match your selection.</div>', count: 0 };
  }

  // Count total detailed categories
  let totalDetailed = 0;
  Array.from(selectedCustomPrimaryCategories).forEach(primary => {
    if (primaryMap[primary]) {
      totalDetailed += primaryMap[primary].length;
    }
  });

  return { html: rows.join(''), count: totalDetailed };
}

function renderRuleFormOptions() {
  const targetSelect = document.getElementById('rule-target-category');
  if (!targetSelect) return;
  const options = buildCategoryOptions();
  targetSelect.innerHTML = options;

  const mergeTarget = document.getElementById('merge-target');
  if (mergeTarget) mergeTarget.innerHTML = options;
  const splitOld = document.getElementById('split-old');
  if (splitOld) splitOld.innerHTML = options;
}

function renderRulesTable() {
  const container = document.getElementById('rules-table');
  if (!rules.length) {
    container.innerHTML = '<div class="empty-state">No rules created yet.</div>';
    return;
  }

  const rows = rules
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map(rule => {
      const match = rule.match_criteria || {};
      const matchLabel = `${match.match_type || 'unknown'}: ${match.match_value || ''}`;
      return `
        <tr>
          <td>${rule.priority || 0}</td>
          <td>${escapeHtml(rule.rule_name || '')}</td>
          <td>${escapeHtml(matchLabel)}</td>
          <td>${escapeHtml(rule.target_category || '')}</td>
          <td>${rule.is_active ? 'Yes' : 'No'}</td>
          <td>
            <div class="rules-actions">
              <button class="secondary" onclick="editRule(${rule.id})">Edit</button>
              <button class="secondary" onclick="adjustRulePriority(${rule.id}, 'up')">↑</button>
              <button class="secondary" onclick="adjustRulePriority(${rule.id}, 'down')">↓</button>
              <button class="secondary" onclick="confirmDeleteRule(${rule.id})">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Priority</th>
          <th>Name</th>
          <th>Match</th>
          <th>Target</th>
          <th>Active</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function saveRule() {
  const ruleName = document.getElementById('rule-name').value.trim();
  const matchType = document.getElementById('rule-match-type').value;
  const matchValue = document.getElementById('rule-match-value').value.trim();
  const targetCategory = document.getElementById('rule-target-category').value;
  const priority = parseInt(document.getElementById('rule-priority').value || '0', 10);
  const caseSensitive = document.getElementById('rule-case-sensitive').checked;
  const isActive = document.getElementById('rule-active').checked;

  if (!ruleName || !matchType || !matchValue || !targetCategory) {
    showStatus('Fill in rule name, match, and target category', 'warning');
    return;
  }

  const payload = {
    rule_name: ruleName,
    match_criteria: {
      match_type: matchType,
      match_value: matchValue,
      case_sensitive: caseSensitive
    },
    target_category: targetCategory,
    priority: priority,
    is_active: isActive
  };

  try {
    const isEditing = !!currentRuleEditId;
    const url = isEditing
      ? `${BACKEND_URL}/api/categorization/rules/${currentRuleEditId}`
      : `${BACKEND_URL}/api/categorization/rules`;
    const method = isEditing ? 'PUT' : 'POST';

    const response = await authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to save rule', 'error');
      return;
    }

    showStatus(isEditing ? 'Rule updated' : 'Rule created', 'success');
    cancelRuleEdit();
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to save rule: ${error.message}`, 'error');
  }
}

function editRule(ruleId) {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;

  currentRuleEditId = ruleId;
  document.getElementById('rule-name').value = rule.rule_name || '';
  document.getElementById('rule-match-type').value = rule.match_criteria?.match_type || 'merchant_contains';
  document.getElementById('rule-match-value').value = rule.match_criteria?.match_value || '';
  document.getElementById('rule-target-category').value = rule.target_category || '';
  document.getElementById('rule-priority').value = rule.priority || 0;
  document.getElementById('rule-case-sensitive').checked = !!rule.match_criteria?.case_sensitive;
  document.getElementById('rule-active').checked = !!rule.is_active;
  document.getElementById('rule-save-btn').textContent = 'Update Rule';
  document.getElementById('rule-cancel-btn').classList.remove('hidden');
}

function cancelRuleEdit() {
  currentRuleEditId = null;
  document.getElementById('rule-name').value = '';
  document.getElementById('rule-match-value').value = '';
  document.getElementById('rule-priority').value = 0;
  document.getElementById('rule-case-sensitive').checked = false;
  document.getElementById('rule-active').checked = true;
  document.getElementById('rule-save-btn').textContent = 'Create Rule';
  document.getElementById('rule-cancel-btn').classList.add('hidden');
}

async function adjustRulePriority(ruleId, direction) {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;
  const delta = direction === 'up' ? 1 : -1;
  const newPriority = (rule.priority || 0) + delta;

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: newPriority })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to update priority', 'error');
      return;
    }
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to update priority: ${error.message}`, 'error');
  }
}

function confirmDeleteRule(ruleId) {
  openModal({
    title: 'Delete Rule',
    body: '<p>Delete this rule permanently?</p>',
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Delete', onClick: () => deleteRule(ruleId) }
    ]
  });
}

async function deleteRule(ruleId) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${ruleId}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to delete rule', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to delete rule: ${error.message}`, 'error');
  }
}

function renderMigrationSelectors() {
  const mergeList = document.getElementById('merge-source-list');
  if (mergeList) {
    mergeList.innerHTML = availableCategories
      .map(cat => `
        <label class="merge-item">
          <input type="checkbox" value="${escapeHtml(cat)}">
          <span>${escapeHtml(cat)}</span>
        </label>
      `)
      .join('');
  }
  const splitRows = document.getElementById('split-rows');
  if (splitRows && splitRows.children.length === 0) {
    addSplitRow();
  }
}

function addSplitRow() {
  const container = document.getElementById('split-rows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'split-row';
  row.innerHTML = `
    <input type="text" placeholder="Plaid categories (comma separated)">
    <input type="text" placeholder="Target category">
    <button class="secondary" type="button">Remove</button>
  `;
  row.querySelector('button').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function confirmRename() {
  const oldName = document.getElementById('rename-old').value.trim();
  const newName = document.getElementById('rename-new').value.trim();
  if (!oldName || !newName) {
    showStatus('Enter both old and new category names', 'warning');
    return;
  }
  openModal({
    title: 'Confirm Rename',
    body: `<p>Rename <strong>${escapeHtml(oldName)}</strong> to <strong>${escapeHtml(newName)}</strong>?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Rename', onClick: () => renameCategory(oldName, newName) }
    ]
  });
}

async function renameCategory(oldName, newName) {
  try {
    // Check if this is a primary category rename that affects detailed categories
    const isPrimaryRename = await checkPrimaryRename(oldName, newName);
    
    if (isPrimaryRename) {
      const affectedCategories = isPrimaryRename.affectedCategories;
      const confirmMessage = 
        `Rename \"${oldName}\" to \"${newName}\"?\n\n` +
        `This will also update ${affectedCategories.length} detailed categor${affectedCategories.length > 1 ? 'ies' : 'y'}:\n` +
        affectedCategories.slice(0, 5).map(c => `  • ${c.old} → ${c.new}`).join('\n') +
        (affectedCategories.length > 5 ? `\n  ... and ${affectedCategories.length - 5} more` : '');
      
      if (!confirm(confirmMessage)) {
        return;
      }
    }
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_name: oldName, new_name: newName })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to rename category', 'error');
      return;
    }
    closeModal();
    showStatus('Category renamed successfully', 'success');
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to rename category: ${error.message}`, 'error');
  }
}

/**
 * Check if renaming a category affects other detailed categories
 * Example: \"Food And Drink\" -> \"Dining\" should remap \"Food And Drink: Fast Food\" to \"Dining: Fast Food\"
 */
async function checkPrimaryRename(oldName, newName) {
  // Parse both old and new names to check if they're primaries
  const oldParts = parseCategoryName(oldName);
  const newParts = parseCategoryName(newName);
  
  // Only proceed if old name is a primary (no colon) and new name is also a primary
  if (oldParts.detailed || newParts.detailed) {
    return null;
  }
  
  // Find all categories that use this primary
  const affectedCategories = [];
  for (const cat of availableCategories) {
    const parts = parseCategoryName(cat);
    if (parts.primary === oldName && parts.detailed) {
      const newCategoryName = `${newName}: ${parts.detailed}`;
      affectedCategories.push({ old: cat, new: newCategoryName });
    }
  }
  
  if (affectedCategories.length > 0) {
    return { affectedCategories };
  }
  
  return null;
}

/**
 * Parse a category name into primary and detailed parts
 * Example: \"Food And Drink: Fast Food\" -> { primary: \"Food And Drink\", detailed: \"Fast Food\" }
 * Example: \"Food And Drink\" -> { primary: \"Food And Drink\", detailed: null }
 */
function parseCategoryName(categoryName) {
  if (!categoryName) return { primary: null, detailed: null };
  
  const colonIndex = categoryName.indexOf(':');
  if (colonIndex === -1) {
    return { primary: categoryName.trim(), detailed: null };
  }
  
  return {
    primary: categoryName.substring(0, colonIndex).trim(),
    detailed: categoryName.substring(colonIndex + 1).trim()
  };
}

function confirmMerge() {
  const sourceChecks = document.querySelectorAll('#merge-source-list input[type="checkbox"]:checked');
  const sourceCategories = Array.from(sourceChecks).map(c => c.value);
  const targetCategory = document.getElementById('merge-target').value;

  if (!sourceCategories.length || !targetCategory) {
    showStatus('Select source categories and a target category', 'warning');
    return;
  }

  openModal({
    title: 'Confirm Merge',
    body: `<p>Merge ${escapeHtml(sourceCategories.join(', '))} into <strong>${escapeHtml(targetCategory)}</strong>?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Merge', onClick: () => mergeCategories(sourceCategories, targetCategory) }
    ]
  });
}

async function mergeCategories(sourceCategories, targetCategory) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_categories: sourceCategories, target_category: targetCategory })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to merge categories', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to merge categories: ${error.message}`, 'error');
  }
}

function confirmSplit() {
  const oldCategory = document.getElementById('split-old').value;
  const splitRows = document.querySelectorAll('#split-rows .split-row');
  const splits = [];

  splitRows.forEach(row => {
    const plaidRaw = row.querySelector('input:nth-child(1)').value.trim();
    const target = row.querySelector('input:nth-child(2)').value.trim();
    if (!plaidRaw || !target) return;
    const plaidCategories = plaidRaw.split(',').map(v => v.trim()).filter(Boolean);
    if (plaidCategories.length) {
      splits.push({ plaid_categories: plaidCategories, target });
    }
  });

  if (!oldCategory || splits.length === 0) {
    showStatus('Provide a category to split and at least one split row', 'warning');
    return;
  }

  openModal({
    title: 'Confirm Split',
    body: `<p>Split <strong>${escapeHtml(oldCategory)}</strong> into ${splits.length} categories?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Split', onClick: () => splitCategory(oldCategory, splits) }
    ]
  });
}

async function splitCategory(oldCategory, splits) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_category: oldCategory, splits })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to split category', 'error');
      return;
    }
    closeModal();
    await loadCategorizationData();
  } catch (error) {
    showStatus(`Failed to split category: ${error.message}`, 'error');
  }
}

async function confirmDeleteCategory(categoryName) {
  // First, check if there are any rules or overrides using this category
  let affectedRules = [];
  let affectedOverrides = 0;
  
  // Check rules
  affectedRules = rules.filter(r => r.target_category === categoryName);
  
  // Check overrides via API
  try {
    const overrideResponse = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/transaction-overrides?category_name=${encodeURIComponent(categoryName)}`
    );
    if (overrideResponse.ok) {
      const overrideData = await overrideResponse.json();
      affectedOverrides = overrideData.count || 0;
    }
  } catch (error) {
    console.error('Error checking overrides:', error);
  }
  
  const warningText = affectedRules.length > 0 || affectedOverrides > 0
    ? `<div style="background: #fff3cd; padding: 12px; border-radius: 4px; margin-bottom: 12px; color: #856404;">
         <strong>⚠️ Warning:</strong> This category has:
         ${affectedRules.length > 0 ? `<br>• ${affectedRules.length} rule${affectedRules.length > 1 ? 's' : ''}` : ''}
         ${affectedOverrides > 0 ? `<br>• ${affectedOverrides} manual override${affectedOverrides > 1 ? 's' : ''}` : ''}
       </div>`
    : '';
  
  openModal({
    title: 'Delete Category',
    body: `
      ${warningText}
      <p>What would you like to do with <strong>${escapeHtml(categoryName)}</strong>?</p>
      <div style="margin-top: 12px;">
        <label class="inline-checkbox" style="display: block; margin-bottom: 8px;">
          <input type="radio" name="delete-action" value="archive" checked> 
          <strong>Archive</strong> - Disable safely (recommended)
        </label>
        <label class="inline-checkbox" style="display: block; margin-bottom: 8px;">
          <input type="radio" name="delete-action" value="reassign"> 
          <strong>Reassign</strong> - Move rules/overrides to another category
        </label>
        <label class="inline-checkbox" style="display: block;">
          <input type="radio" name="delete-action" value="delete"> 
          <strong>Delete</strong> - Remove completely (custom categories only)
        </label>
      </div>
      <div id="reassign-target-container" style="margin-top: 12px; display: none;">
        <label style="display: block; margin-bottom: 4px; font-weight: 500;">Reassign to:</label>
        <select id="reassign-target-category" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">
          ${buildCategoryOptions()}
        </select>
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Confirm', onClick: () => deleteCategory(categoryName) }
    ]
  });
  
  // Add listener to show/hide reassign target
  const radioButtons = document.querySelectorAll('input[name="delete-action"]');
  const reassignContainer = document.getElementById('reassign-target-container');
  radioButtons.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'reassign') {
        reassignContainer.style.display = 'block';
      } else {
        reassignContainer.style.display = 'none';
      }
    });
  });
}

function deleteCategoryInlineAction(categoryName, action) {
  deleteCategory(categoryName, action);
}

function openReassignCategoryModal(categoryName) {
  openModal({
    title: 'Reassign Category',
    body: `
      <p>Move all rules and overrides from <strong>${escapeHtml(categoryName)}</strong> to:</p>
      <div style="margin-top: 12px;">
        <select id="reassign-target-category" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">
          ${buildCategoryOptions()}
        </select>
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Reassign', onClick: () => confirmReassignCategory(categoryName) }
    ]
  });
}

function openReassignPrimaryModal(primaryName) {
  const otherPrimaries = Array.from(selectedCustomPrimaryCategories)
    .filter(p => p !== primaryName)
    .concat(
      Object.keys({}).filter(p => p !== primaryName) // Include all primaries from customCategories
    );
  
  const allPrimaries = new Set();
  (customCategories || []).forEach(cat => {
    const parts = parseCategoryName(cat);
    if (parts.primary && parts.primary !== primaryName) {
      allPrimaries.add(parts.primary);
    }
  });
  
  const targetOptions = Array.from(allPrimaries)
    .sort((a, b) => a.localeCompare(b))
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
    .join('');
  
  if (!targetOptions) {
    showStatus('No other custom primary categories to reassign to. Please create another one first.', 'warning');
    return;
  }
  
  openModal({
    title: 'Reassign Primary Category',
    body: `
      <p>Move all detailed categories from <strong>${escapeHtml(primaryName)}</strong> to which primary?</p>
      <div style="margin-top: 12px;">
        <select id="reassign-primary-target" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">
          ${targetOptions}
        </select>
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Reassign', onClick: () => confirmReassignPrimary(primaryName) }
    ]
  });
}

async function confirmReassignPrimary(primaryName) {
  const targetSelect = document.getElementById('reassign-primary-target');
  const targetPrimary = targetSelect ? targetSelect.value : '';
  
  if (!targetPrimary) {
    showStatus('Please select a target primary category', 'warning');
    return;
  }
  
  // Get all categories under the source primary
  const categoriesToMove = (customCategories || [])
    .filter(cat => {
      const parts = parseCategoryName(cat);
      return parts.primary === primaryName;
    });
  
  if (!categoriesToMove.length) {
    showStatus('No categories to move', 'warning');
    return;
  }
  
  // Check what detailed categories already exist under target
  const existingUnderTarget = new Set(
    (customCategories || [])
      .filter(cat => {
        const parts = parseCategoryName(cat);
        return parts.primary === targetPrimary && parts.detailed;
      })
      .map(cat => parseCategoryName(cat).detailed)
  );
  
  try {
    showStatus('Reassigning categories...', 'info');
    
    for (const oldCategoryName of categoriesToMove) {
      const oldParts = parseCategoryName(oldCategoryName);
      let newCategoryName;
      
      if (oldParts.detailed) {
        // Check for duplicates
        if (existingUnderTarget.has(oldParts.detailed)) {
          console.log(`Skipping ${oldCategoryName}: ${oldParts.detailed} already exists under ${targetPrimary}`);
          // Delete the old one
          await authenticatedFetch(
            `${BACKEND_URL}/api/categorization/categories/${encodeURIComponent(oldCategoryName)}?action=delete`,
            { method: 'DELETE' }
          );
          customCategories = customCategories.filter(cat => cat !== oldCategoryName);
          continue;
        }
        newCategoryName = `${targetPrimary}: ${oldParts.detailed}`;
      } else {
        newCategoryName = targetPrimary;
      }
      
      // Rename the category
      const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: oldCategoryName, new_name: newCategoryName })
      });
      
      if (!response.ok) {
        const data = await response.json();
        showStatus(`Failed to reassign ${oldCategoryName}: ${data.error}`, 'error');
        return;
      }
      
      existingUnderTarget.add(oldParts.detailed || '');
    }
    
    closeModal();
    showStatus(`Reassigned all categories from ${primaryName} to ${targetPrimary}`, 'success');
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to reassign categories: ${error.message}`, 'error');
  }
}

function openArchiveDetailedModal(categoryName) {
  openModal({
    title: 'Archive Category',
    body: `
      <p>Archive <strong>${escapeHtml(categoryName)}</strong>? It will no longer appear in dropdowns but won't be deleted.</p>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Archive', onClick: () => deleteCategory(categoryName, 'archive') }
    ]
  });
}

function confirmDeletePrimaryCategory(primaryName) {
  // Get all categories under this primary
  const categoriesToDelete = (customCategories || [])
    .filter(cat => {
      const parts = parseCategoryName(cat);
      return parts.primary === primaryName;
    });
  
  openModal({
    title: 'Delete Primary Category',
    body: `
      <div style="background: #fff3cd; padding: 12px; border-radius: 4px; margin-bottom: 12px; color: #856404;">
        <strong>⚠️ Warning:</strong> This will delete <strong>${categoriesToDelete.length}</strong> category(ies):
        <ul style="margin: 8px 0 0 20px; padding: 0;">
          ${categoriesToDelete.slice(0, 5).map(c => `<li>${escapeHtml(c)}</li>`).join('')}
          ${categoriesToDelete.length > 5 ? `<li>... and ${categoriesToDelete.length - 5} more</li>` : ''}
        </ul>
      </div>
      <p>This cannot be undone. Are you sure?</p>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Delete All', onClick: () => deleteAllUnderPrimary(primaryName, categoriesToDelete) }
    ]
  });
}

async function deleteAllUnderPrimary(primaryName, categoriesToDelete) {
  try {
    showStatus('Deleting categories...', 'info');
    
    for (const categoryName of categoriesToDelete) {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/categorization/categories/${encodeURIComponent(categoryName)}?action=delete`,
        { method: 'DELETE' }
      );
      
      if (!response.ok) {
        const data = await response.json();
        showStatus(`Failed to delete ${categoryName}: ${data.error}`, 'error');
        return;
      }
    }
    
    closeModal();
    showStatus(`Deleted ${categoriesToDelete.length} category(ies) under ${primaryName}`, 'success');
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to delete categories: ${error.message}`, 'error');
  }
}

function confirmDeleteDetailedCategory(categoryName) {
  openModal({
    title: 'Delete Category',
    body: `<p>Delete <strong>${escapeHtml(categoryName)}</strong> permanently?</p>`,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Delete', onClick: () => deleteCategory(categoryName, 'delete') }
    ]
  });
}

function confirmReassignCategory(categoryName) {
  const targetSelect = document.getElementById('reassign-target-category');
  const targetCategory = targetSelect ? targetSelect.value : '';
  if (!targetCategory) {
    showStatus('Please select a target category for reassignment', 'warning');
    return;
  }
  deleteCategory(categoryName, 'reassign', targetCategory);
}

async function deleteCategory(categoryName, actionOverride = null, reassignTargetOverride = null) {
  try {
    const actionEl = !actionOverride ? document.querySelector('input[name="delete-action"]:checked') : null;
    const action = actionOverride || (actionEl ? actionEl.value : 'archive');
    
    let url = `${BACKEND_URL}/api/categorization/categories/${encodeURIComponent(categoryName)}?action=${action}`;
    
    // If reassigning, add target category
    if (action === 'reassign') {
      const targetSelect = !reassignTargetOverride ? document.getElementById('reassign-target-category') : null;
      const targetCategory = reassignTargetOverride || (targetSelect ? targetSelect.value : '');
      if (!targetCategory) {
        showStatus('Please select a target category for reassignment', 'warning');
        return;
      }
      url += `&reassign_to=${encodeURIComponent(targetCategory)}`;
    }
    
    const response = await authenticatedFetch(url, {
      method: 'DELETE'
    });
    const data = await response.json();
    
    if (!response.ok) {
      showStatus(data.error || 'Failed to delete category', 'error');
      return;
    }
    
    closeModal();
    
    // Show success message with stats
    const actionLabel = action === 'archive' ? 'archived' : action === 'reassign' ? 'reassigned' : 'deleted';
    showStatus(
      `Category ${actionLabel}` +
      (data.rules_affected > 0 ? ` (${data.rules_affected} rules affected)` : '') +
      (data.overrides_affected > 0 ? ` (${data.overrides_affected} overrides affected)` : ''),
      'success'
    );
    
    await loadCategorizationData();
    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Failed to delete category: ${error.message}`, 'error');
  }
}

function renderMigrationLog() {
  const container = document.getElementById('audit-log');
  if (!migrationLog.length) {
    container.innerHTML = '<div class="empty-state">No migrations recorded yet.</div>';
    return;
  }

  const rows = migrationLog
    .map(log => {
      const when = new Date(log.created_at).toLocaleString();
      const changes = JSON.stringify(log.changes || {});
      const stats = log.stats ? JSON.stringify(log.stats) : '';
      return `
        <tr>
          <td>${escapeHtml(when)}</td>
          <td>${escapeHtml(log.migration_type || '')}</td>
          <td>${escapeHtml(changes)}</td>
          <td>${escapeHtml(stats)}</td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Changes</th>
          <th>Stats</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function refreshMigrationLog() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/migration-log`);
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to refresh audit log', 'error');
      return;
    }
    migrationLog = data.migrations || [];
    renderMigrationLog();
  } catch (error) {
    showStatus(`Failed to refresh audit log: ${error.message}`, 'error');
  }
}

function openModal({ title, body, actions }) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  const actionsEl = document.getElementById('modal-actions');

  titleEl.textContent = title;
  bodyEl.innerHTML = body;
  actionsEl.innerHTML = '';

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    if (action.className) btn.className = action.className;
    btn.addEventListener('click', action.onClick);
    actionsEl.appendChild(btn);
  });

  overlay.classList.remove('hidden');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
}

function buildCategoryOptions(selected) {
  const unique = new Set(availableCategories || []);
  if (selected) unique.add(selected);
  const list = Array.from(unique).sort((a, b) => a.localeCompare(b));
  return list
    .map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
    .join('');
}

function buildDetailedCategoryOptions() {
  const unique = new Set(availableCategories || []);
  return selected => {
    if (selected) unique.add(selected);
    const list = Array.from(unique).sort((a, b) => a.localeCompare(b));
    return `<option value="">-- Select category --</option>` +
      list
        .map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
        .join('');
  };
}

function buildDetailedOptionsForCategory(plaidCat, selected) {
  const unique = new Set(availableCategories || []);
  if (selected && selected !== plaidCat) unique.add(selected);
  const list = Array.from(unique).sort((a, b) => a.localeCompare(b));
  
  const taxonomyEntry = plaidTaxonomy.find(t => t.detailed === plaidCat);
  const displayNames = getCategoryDisplayNames(taxonomyEntry || { detailed: plaidCat });
  const originalDisplay = displayNames.full || formatPlaidCategory(plaidCat);
  
  let options = `<option value="${escapeHtml(plaidCat)}" ${selected === originalDisplay ? 'selected' : ''}>Use original (${escapeHtml(originalDisplay)})</option>`;
  options += list.map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('');
  return options;
}

function buildPrimaryCategoryOptions() {
  const primaries = extractAvailablePrimaryCategories();
  return (originalPrimary, selected) => {
    const options = [`<option value="">Use original (${escapeHtml(originalPrimary)})</option>`]
      .concat(primaries.map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`));
    return options.join('');
  };
}

function extractAvailablePrimaryCategories() {
  const primaries = new Set();
  (availableCategories || []).forEach(cat => {
    const parts = parseCategoryName(cat);
    if (parts.primary) primaries.add(parts.primary);
  });
  return Array.from(primaries).sort((a, b) => a.localeCompare(b));
}

function getPlaidPrimaryDisplayList() {
  const primaries = new Set();
  (plaidTaxonomy || []).forEach(cat => {
    const display = formatPlaidCategory(cat.primary || '');
    if (display) primaries.add(display);
  });
  return Array.from(primaries).sort((a, b) => a.localeCompare(b));
}

function getPrimaryDisplayForDetailed(plaidDetailed, taxonomyEntry) {
  if (taxonomyEntry && taxonomyEntry.primary) {
    return formatPlaidCategory(taxonomyEntry.primary);
  }
  if (!plaidDetailed) return '';
  const primaryRaw = plaidDetailed.split('_')[0] || plaidDetailed;
  return formatPlaidCategory(primaryRaw);
}

function derivePrimaryMappingsFromDetailedMappings() {
  const primaryBuckets = {};

  (plaidTaxonomy || []).forEach(cat => {
    const displayPrimary = formatPlaidCategory(cat.primary || '');
    if (!displayPrimary) return;
    const mapped = categoryMappings[cat.detailed];
    if (!mapped) return;
    const parsed = parseCategoryName(mapped);
    if (!parsed.primary) return;
    if (!primaryBuckets[displayPrimary]) primaryBuckets[displayPrimary] = new Set();
    primaryBuckets[displayPrimary].add(parsed.primary);
  });

  primaryCategoryMappings = {};
  Object.keys(primaryBuckets).forEach(primary => {
    const values = Array.from(primaryBuckets[primary]);
    if (values.length === 1 && values[0] && values[0] !== primary) {
      primaryCategoryMappings[primary] = values[0];
    }
  });
}

function derivePrimaryMappingsFromMappings(mappings) {
  const primaryBuckets = {};

  (plaidTaxonomy || []).forEach(cat => {
    const displayPrimary = formatPlaidCategory(cat.primary || '');
    if (!displayPrimary) return;
    const mapped = mappings ? mappings[cat.detailed] : null;
    if (!mapped) return;
    const parsed = parseCategoryName(mapped);
    if (!parsed.primary) return;
    if (!primaryBuckets[displayPrimary]) primaryBuckets[displayPrimary] = new Set();
    primaryBuckets[displayPrimary].add(parsed.primary);
  });

  const derived = {};
  Object.keys(primaryBuckets).forEach(primary => {
    const values = Array.from(primaryBuckets[primary]);
    if (values.length === 1 && values[0] && values[0] !== primary) {
      derived[primary] = values[0];
    }
  });

  return derived;
}

function applyPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay) {
  const targetPrimary = targetPrimaryDisplay || plaidPrimaryDisplay;

  (plaidTaxonomy || [])
    .filter(cat => formatPlaidCategory(cat.primary || '') === plaidPrimaryDisplay)
    .forEach(cat => {
      const displayNames = getCategoryDisplayNames(cat);
      const detailed = displayNames.trimmed || '';
      const newLabel = detailed ? `${targetPrimary}: ${detailed}` : targetPrimary;
      categoryMappings[cat.detailed] = newLabel;
    });

}

function isCustomPrimary(primaryDisplay) {
  return (customCategories || []).some(cat => parseCategoryName(cat).primary === primaryDisplay);
}

async function ensureCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay) {
  if (!targetPrimaryDisplay || targetPrimaryDisplay === plaidPrimaryDisplay) return;
  if (!isCustomPrimary(targetPrimaryDisplay)) return;

  const existing = new Set(customCategories || []);
  const toCreate = [];

  (plaidTaxonomy || [])
    .filter(cat => formatPlaidCategory(cat.primary || '') === plaidPrimaryDisplay)
    .forEach(cat => {
      const displayNames = getCategoryDisplayNames(cat);
      const detailed = displayNames.trimmed || '';
      if (!detailed) return;
      const label = `${targetPrimaryDisplay}: ${detailed}`;
      if (!existing.has(label)) {
        existing.add(label);
        toCreate.push(label);
      }
    });

  if (!toCreate.length) return;

  for (const categoryName of toCreate) {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: categoryName })
      });
      const data = await response.json();
      if (!response.ok) {
        console.warn('Failed to add custom category:', data.error || categoryName);
        continue;
      }
      customCategories.push(categoryName);
      if (!availableCategories.includes(categoryName)) {
        availableCategories.push(categoryName);
      }
    } catch (error) {
      console.warn('Failed to add custom category:', error);
    }
  }

  renderCustomCategories();
  renderRuleFormOptions();
}

async function deleteCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay) {
  if (!targetPrimaryDisplay || targetPrimaryDisplay === plaidPrimaryDisplay) return;
  if (!isCustomPrimary(targetPrimaryDisplay)) return;

  const existing = new Set(customCategories || []);
  const toDelete = [];

  (plaidTaxonomy || [])
    .filter(cat => formatPlaidCategory(cat.primary || '') === plaidPrimaryDisplay)
    .forEach(cat => {
      const displayNames = getCategoryDisplayNames(cat);
      const detailed = displayNames.trimmed || '';
      if (!detailed) return;
      const label = `${targetPrimaryDisplay}: ${detailed}`;
      if (existing.has(label)) {
        toDelete.push(label);
      }
    });

  if (!toDelete.length) return;

  for (const categoryName of toDelete) {
    try {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/categorization/categories/${encodeURIComponent(categoryName)}?action=delete`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json();
        console.warn('Failed to delete custom category:', data.error || categoryName);
        continue;
      }
      customCategories = customCategories.filter(cat => cat !== categoryName);
      availableCategories = availableCategories.filter(cat => cat !== categoryName);
    } catch (error) {
      console.warn('Failed to delete custom category:', error);
    }
  }

  renderCustomCategories();
  renderRuleFormOptions();
}


function formatPlaidCategory(value) {
  return (value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Trim the primary category prefix from a detailed category.
 * Example: "GENERAL_MERCHANDISE_SPORTING_GOODS" + "GENERAL_MERCHANDISE" → "SPORTING_GOODS"
 * 
 * @param {string} detailed - The full detailed category (e.g., "FOOD_AND_DRINK_FAST_FOOD")
 * @param {string} primary - The primary category (e.g., "FOOD_AND_DRINK")
 * @returns {string} The trimmed category (e.g., "FAST_FOOD")
 */
function trimCategoryPrefix(detailed, primary) {
  if (!detailed || !primary) return detailed || '';
  
  // Remove primary prefix if detailed starts with it
  if (detailed.toUpperCase().startsWith(primary.toUpperCase() + '_')) {
    return detailed.substring(primary.length + 1);
  }
  
  return detailed;
}

/**
 * Get a formatted display name for a category with both primary and trimmed detailed.
 * Example: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_FAST_FOOD" }
 *   → { primary: "Food And Drink", trimmed: "Fast Food", full: "Food And Drink: Fast Food" }
 * 
 * @param {Object} category - Object with 'primary' and 'detailed' fields
 * @returns {Object} Formatted display names
 */
function getCategoryDisplayNames(category) {
  if (!category || !category.detailed) {
    return { primary: '', trimmed: '', full: '' };
  }
  
  const primary = category.primary || '';
  const detailed = category.detailed || '';
  const trimmed = trimCategoryPrefix(detailed, primary);
  
  return {
    primary: formatPlaidCategory(primary),
    trimmed: formatPlaidCategory(trimmed),
    full: formatPlaidCategory(primary) + (trimmed ? ': ' + formatPlaidCategory(trimmed) : ''),
    rawPrimary: primary,
    rawDetailed: detailed,
    rawTrimmed: trimmed
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============= BROKEN RULES VALIDATION =============

async function checkBrokenRules(showIfValid = false) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/validation/broken-rules`);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to check broken rules:', data);
      return null;
    }
    
    if (data.has_broken_rules) {
      showBrokenRulesModal(data.broken_rules);
    } else if (showIfValid) {
      // Show success briefly
      showStatus('✓ All rules are valid', 'success');
      setTimeout(() => clearStatus(), 3000);
    }
    
    return data;
  } catch (error) {
    console.error('Error checking broken rules:', error);
    return null;
  }
}

function showBrokenRulesModal(brokenRules) {
  const rulesList = brokenRules.map(rule => {
    return `
      <div class="broken-rule-item" style="margin-bottom: 16px; padding: 12px; background: #fff3cd; border-radius: 4px;">
        <div style="font-weight: 600; color: #856404; margin-bottom: 4px;">
          Rule: ${escapeHtml(rule.rule_name)}
        </div>
        <div style="color: #856404; margin-bottom: 8px; font-size: 14px;">
          Invalid target: "${escapeHtml(rule.target_category)}"
        </div>
        <div style="margin-top: 8px;">
          <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">Fix by selecting valid category:</label>
          <select class="broken-rule-fix-select" data-rule-id="${rule.id}" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 4px;">
            <option value="">-- Select category --</option>
            ${rule.valid_categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('')}
          </select>
        </div>
      </div>
    `;
  }).join('');
  
  openModal({
    title: `⚠️ ${brokenRules.length} Broken Rule${brokenRules.length > 1 ? 's' : ''} Found`,
    body: `
      <div style="margin-bottom: 16px; color: #856404; font-size: 14px;">
        These rules reference categories that no longer exist. Please fix them before recategorizing transactions.
      </div>
      ${rulesList}
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Fix All Rules', onClick: () => fixAllBrokenRules(brokenRules) }
    ]
  });
}

async function fixAllBrokenRules(brokenRules) {
  const selects = document.querySelectorAll('.broken-rule-fix-select');
  const fixes = [];
  
  for (const select of selects) {
    const ruleId = parseInt(select.getAttribute('data-rule-id'));
    const newCategory = select.value;
    if (!newCategory) {
      showStatus('Please select a category for all broken rules', 'warning');
      return;
    }
    fixes.push({ ruleId, newCategory });
  }
  
  // Update each rule
  for (const fix of fixes) {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${fix.ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_category: fix.newCategory })
      });
      
      if (!response.ok) {
        const data = await response.json();
        showStatus(`Failed to fix rule ${fix.ruleId}: ${data.error}`, 'error');
        return;
      }
    } catch (error) {
      showStatus(`Error fixing rule ${fix.ruleId}: ${error.message}`, 'error');
      return;
    }
  }
  
  closeModal();
  showStatus(`✓ Fixed ${fixes.length} rule${fixes.length > 1 ? 's' : ''}`, 'success');
  await loadCategorizationData();
  setTimeout(() => clearStatus(), 2000);
}

// ============= RECATEGORIZE ALL TRANSACTIONS =============

async function recategorizeAllTransactions() {
  // Step 1: Check for broken rules
  const validation = await checkBrokenRules(false);
  
  if (validation && validation.has_broken_rules) {
    showStatus(
      `Cannot recategorize: ${validation.broken_rules_count} broken rule${validation.broken_rules_count > 1 ? 's' : ''} exist. Please fix them first.`,
      'error'
    );
    showBrokenRulesModal(validation.broken_rules);
    return;
  }
  
  // Step 2: Confirm with user
  if (!confirm(
    'Recategorize all historical transactions?\n\n' +
    'This will re-run the categorization pipeline (mappings → rules → overrides) on all transactions. This may take a moment.'
  )) {
    return;
  }
  
  // Step 3: Show progress
  showStatus('Recategorizing transactions...', 'info');
  
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/transactions/recategorize`,
      { method: 'POST' }
    );
    const data = await response.json();
    
    if (!response.ok) {
      if (data.broken_rules) {
        showBrokenRulesModal(data.broken_rules);
      } else {
        showStatus(data.error || 'Failed to recategorize', 'error');
      }
      return;
    }
    
    // Step 4: Show results
    showStatus(
      `✓ Recategorization complete: ${data.transactions_updated} transaction${data.transactions_updated !== 1 ? 's' : ''} updated` +
      (data.decryption_errors > 0 ? ` (${data.decryption_errors} errors)` : ''),
      'success'
    );
    
    setTimeout(() => clearStatus(), 5000);
  } catch (error) {
    showStatus(`Recategorization failed: ${error.message}`, 'error');
  }
}

// ============= OVERRIDE MANAGEMENT =============

async function deleteOverridesForCategory(categoryName) {
  if (!confirm(
    `Delete all manual overrides for "${categoryName}"?\n\n` +
    'This will remove all manual categorizations for this category. This cannot be undone.'
  )) {
    return;
  }
  
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/transaction-overrides?category_name=${encodeURIComponent(categoryName)}`,
      { method: 'DELETE' }
    );
    const data = await response.json();
    
    if (response.ok) {
      showStatus(`${data.deleted_count} override${data.deleted_count !== 1 ? 's' : ''} deleted`, 'success');
      setTimeout(() => clearStatus(), 3000);
    } else {
      showStatus(data.error || 'Failed to delete overrides', 'error');
    }
  } catch (error) {
    showStatus(`Failed to delete overrides: ${error.message}`, 'error');
  }
}

async function deleteAllOverrides() {
  if (!confirm(
    'Delete ALL manual categorization overrides?\n\n' +
    'This will remove all manual categorizations across all transactions. This cannot be undone.'
  )) {
    return;
  }
  
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/transaction-overrides`,
      { method: 'DELETE' }
    );
    const data = await response.json();
    
    if (response.ok) {
      showStatus(`Deleted all ${data.deleted_count} override${data.deleted_count !== 1 ? 's' : ''}`, 'success');
      setTimeout(() => clearStatus(), 3000);
    } else {
      showStatus(data.error || 'Failed to delete overrides', 'error');
    }
  } catch (error) {
    showStatus(`Failed to delete overrides: ${error.message}`, 'error');
  }
}
