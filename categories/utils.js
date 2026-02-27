// ============================================================
// categories/utils.js — Shared Pure Helpers
// Small utility functions used across multiple modules.
// No business logic, no network calls, no DOM rendering.
// ============================================================

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format an underscore-separated Plaid key to Title Case.
 * Example: "FOOD_AND_DRINK" → "Food And Drink"
 */
function formatPlaidCategory(value) {
  return (value || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase());
}

/**
 * Parse a "Primary: Detailed" category string into its parts.
 * "Food And Drink: Fast Food" → { primary: "Food And Drink", detailed: "Fast Food" }
 * "Food And Drink"            → { primary: "Food And Drink", detailed: null }
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

/**
 * Trim the primary category prefix from a detailed Plaid key.
 * "GENERAL_MERCHANDISE_SPORTING_GOODS" + "GENERAL_MERCHANDISE" → "SPORTING_GOODS"
 */
function trimCategoryPrefix(detailed, primary) {
  if (!detailed || !primary) return detailed || '';

  if (detailed.toUpperCase().startsWith(primary.toUpperCase() + '_')) {
    return detailed.substring(primary.length + 1);
  }

  return detailed;
}

/**
 * Get formatted display names for a Plaid taxonomy entry.
 * { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_FAST_FOOD" }
 *   → { primary: "Food And Drink", trimmed: "Fast Food", full: "Food And Drink: Fast Food" }
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

// ── Option-Builder Helpers ──────────────────────────────────
// These produce <option> HTML strings for <select> elements.
// Used by mappings, rules, overrides, and migrations.

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

  const taxonomyEntry = plaidTaxonomy.find(entry => entry.detailed === plaidCat);
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

function isCustomPrimary(primaryDisplay) {
  return (customCategories || []).some(cat => parseCategoryName(cat).primary === primaryDisplay);
}

// ── Status Messages ─────────────────────────────────────────

function showStatus(message, type = 'info') {
  if (statusTimeout) {
    clearTimeout(statusTimeout);
  }

  const container = document.getElementById('status-message');
  if (!container) {
    const statusElement = document.createElement('div');
    statusElement.id = 'status-message';
    document.body.insertBefore(statusElement, document.querySelector('.container'));
  }
  const statusElement = document.getElementById('status-message');
  statusElement.className = `status-message ${type}`;
  statusElement.textContent = message;
  statusElement.style.position = 'fixed';
  statusElement.style.top = '20px';
  statusElement.style.left = '50%';
  statusElement.style.transform = 'translateX(-50%)';
  statusElement.style.zIndex = '1001';
  statusElement.style.minWidth = '300px';
  statusElement.style.display = 'block';

  // Auto-hide after 20 seconds
  statusTimeout = setTimeout(() => {
    clearStatus();
  }, 20000);
}

function clearStatus() {
  const statusElement = document.getElementById('status-message');
  if (statusElement) {
    statusElement.style.display = 'none';
    statusElement.textContent = '';
  }
  if (statusTimeout) {
    clearTimeout(statusTimeout);
    statusTimeout = undefined;
  }
}

// ── Modal Helpers ───────────────────────────────────────────

function openModal({ title, body, actions }) {
  const overlay = document.getElementById('modal-overlay');
  const titleElement = document.getElementById('modal-title');
  const bodyElement = document.getElementById('modal-body');
  const actionsElement = document.getElementById('modal-actions');

  titleElement.textContent = title;
  bodyElement.innerHTML = body;
  actionsElement.innerHTML = '';

  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    if (action.className) btn.className = action.className;
    btn.addEventListener('click', action.onClick);
    actionsElement.appendChild(btn);
  });

  overlay.classList.remove('hidden');
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
}
