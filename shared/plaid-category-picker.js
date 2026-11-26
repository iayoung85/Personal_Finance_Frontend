// ============================================================
// shared/plaid-category-picker.js
// A searchable, several-choice pick list of Plaid detailed categories,
// grouped by primary category. Used by the bill form on both pages.
//
// The pure functions (filtering, the selected list, unknown codes, the
// changed-or-not decision) sit at the top and touch no DOM. The widget
// that wires them to the page is at the bottom.
//
// Taxonomy rows are the API's `{primary, detailed}` pairs from
// GET /api/categorization/plaid-taxonomy, already sorted by primary, then
// detailed. A taxonomy of null means "not loaded": the list cannot be
// searched and no stored code is called unknown, because nothing can be
// checked against it.
//
// Exports (globals):
//   plaidPickerNormalizeCode(code), plaidPickerNormalizeCodes(codes)
//   plaidPickerFilterGroups(taxonomy, query, selectedCodes)
//   plaidPickerSelectedItems(selectedCodes, taxonomy)
//   plaidPickerAdd(selectedCodes, code), plaidPickerRemove(selectedCodes, code)
//   plaidPickerCodesChanged(nextCodes, originalCodes)
//   createPlaidCategoryPicker(rootEl, options)
// ============================================================

/**
 * One code in the form Plaid and the API use: trimmed, ALL_CAPS.
 * @param {*} code
 * @returns {string}
 */
function plaidPickerNormalizeCode(code) {
  return String(code === null || code === undefined ? '' : code).trim().toUpperCase();
}

/**
 * Codes normalized, with blanks and repeats dropped; first-seen order kept.
 * @param {Array} codes
 * @returns {string[]}
 */
function plaidPickerNormalizeCodes(codes) {
  if (!Array.isArray(codes)) return [];
  const seen = new Set();
  const result = [];
  codes.forEach(code => {
    const normalized = plaidPickerNormalizeCode(code);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

// FOOD_AND_DRINK -> "Food and drink"
function _plaidPickerHumanize(text) {
  const words = String(text || '').toLowerCase().split('_').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// FOOD_AND_DRINK_COFFEE under FOOD_AND_DRINK -> "Coffee". The primary prefix
// is dropped because the group heading already says it.
function _plaidPickerDetailedLabel(primary, detailed) {
  const prefix = `${primary}_`;
  const rest = detailed.startsWith(prefix) && detailed.length > prefix.length
    ? detailed.slice(prefix.length)
    : detailed;
  return _plaidPickerHumanize(rest);
}

/**
 * Taxonomy rows that can be shown: both fields present, normalized, no repeats.
 * @param {Array<{primary: string, detailed: string}>} taxonomy
 * @returns {Array<{code: string, primary: string, primaryLabel: string, label: string}>}
 */
function _plaidPickerOptions(taxonomy) {
  const seen = new Set();
  const options = [];
  (Array.isArray(taxonomy) ? taxonomy : []).forEach(row => {
    const code = plaidPickerNormalizeCode(row && row.detailed);
    const primary = plaidPickerNormalizeCode(row && row.primary);
    if (!code || !primary || seen.has(code)) return;
    seen.add(code);
    options.push({
      code,
      primary,
      primaryLabel: _plaidPickerHumanize(primary),
      label: _plaidPickerDetailedLabel(primary, code),
    });
  });
  return options;
}

/**
 * The categories to offer for the text typed so far, grouped by primary, in
 * the order the API sent them. Every word typed must appear somewhere in the
 * code, its label, or its group name, so "food coffee" and "coffee" both find
 * FOOD_AND_DRINK_COFFEE. Codes already chosen are left out.
 *
 * @param {Array<{primary: string, detailed: string}>} taxonomy
 * @param {string} query
 * @param {string[]} selectedCodes
 * @returns {Array<{primary: string, label: string, items: Array<{code: string, label: string}>}>}
 */
function plaidPickerFilterGroups(taxonomy, query, selectedCodes) {
  const chosen = new Set(plaidPickerNormalizeCodes(selectedCodes));
  const words = String(query || '').toLowerCase().split(/[\s_]+/).filter(Boolean);
  const groups = [];
  const groupByPrimary = new Map();

  _plaidPickerOptions(taxonomy).forEach(option => {
    if (chosen.has(option.code)) return;
    const haystack = `${option.code.toLowerCase().replace(/_/g, ' ')} ${option.label.toLowerCase()} ${option.primaryLabel.toLowerCase()}`;
    if (!words.every(word => haystack.includes(word))) return;
    let group = groupByPrimary.get(option.primary);
    if (!group) {
      group = { primary: option.primary, label: option.primaryLabel, items: [] };
      groupByPrimary.set(option.primary, group);
      groups.push(group);
    }
    group.items.push({ code: option.code, label: option.label });
  });
  return groups;
}

/**
 * The chosen codes as they should be shown: a readable name when the code is
 * in the taxonomy, and `unknown: true` when it is not. With no taxonomy
 * loaded nothing can be called unknown, so each code shows as itself.
 *
 * @param {string[]} selectedCodes
 * @param {Array<{primary: string, detailed: string}>|null} taxonomy
 * @returns {Array<{code: string, label: string, unknown: boolean}>}
 */
function plaidPickerSelectedItems(selectedCodes, taxonomy) {
  const byCode = new Map();
  if (Array.isArray(taxonomy)) {
    _plaidPickerOptions(taxonomy).forEach(option => byCode.set(option.code, option));
  }
  const loaded = byCode.size > 0;
  return plaidPickerNormalizeCodes(selectedCodes).map(code => {
    const option = byCode.get(code);
    if (option) {
      return { code, label: `${option.primaryLabel}: ${option.label}`, unknown: false };
    }
    return { code, label: code, unknown: loaded };
  });
}

/**
 * The selection with one more code. A code already there is not added twice.
 * @param {string[]} selectedCodes
 * @param {string} code
 * @returns {string[]}
 */
function plaidPickerAdd(selectedCodes, code) {
  return plaidPickerNormalizeCodes([...plaidPickerNormalizeCodes(selectedCodes), code]);
}

/**
 * The selection without one code.
 * @param {string[]} selectedCodes
 * @param {string} code
 * @returns {string[]}
 */
function plaidPickerRemove(selectedCodes, code) {
  const target = plaidPickerNormalizeCode(code);
  return plaidPickerNormalizeCodes(selectedCodes).filter(item => item !== target);
}

/**
 * Whether the selection differs from the stored one, ignoring order and case.
 * An edit sends the field only when this is true, so a stored code outside the
 * list never goes back to the API (which refuses unknown codes) unless the
 * user touched the selection.
 *
 * @param {string[]} nextCodes
 * @param {string[]} originalCodes
 * @returns {boolean}
 */
function plaidPickerCodesChanged(nextCodes, originalCodes) {
  const next = plaidPickerNormalizeCodes(nextCodes);
  const original = new Set(plaidPickerNormalizeCodes(originalCodes));
  return next.length !== original.size || next.some(code => !original.has(code));
}

// ── Widget ───────────────────────────────────────────────────

function _plaidPickerEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the picker inside `rootEl`: chosen categories as removable chips, a
 * search box, and a grouped list that opens under it.
 *
 * @param {HTMLElement} rootEl
 * @param {Object} [options]
 * @param {string} [options.inputId] id for the search box, so a label can point at it.
 * @param {function(string[])} [options.onChange] called after the user adds or removes a code.
 * @returns {{
 *   setTaxonomy: function(Array|null),
 *   setSelected: function(string[]),
 *   getSelected: function(): string[],
 * }}
 */
function createPlaidCategoryPicker(rootEl, options = {}) {
  const state = {
    taxonomy: null,
    selected: [],
    query: '',
    open: false,
    activeIndex: 0,
    visibleCodes: [],
  };

  rootEl.classList.add('plaid-picker');
  rootEl.innerHTML = `
    <div class="plaid-picker-chips"></div>
    <div class="plaid-picker-field">
      <input type="text" class="plaid-picker-input" autocomplete="off" spellcheck="false"
        ${options.inputId ? `id="${_plaidPickerEscape(options.inputId)}"` : ''}>
      <div class="plaid-picker-list" role="listbox"></div>
    </div>`;
  const chipsEl = rootEl.querySelector('.plaid-picker-chips');
  const inputEl = rootEl.querySelector('.plaid-picker-input');
  const listEl = rootEl.querySelector('.plaid-picker-list');

  function isSearchable() {
    return Array.isArray(state.taxonomy) && state.taxonomy.length > 0;
  }

  function renderChips() {
    const items = plaidPickerSelectedItems(state.selected, isSearchable() ? state.taxonomy : null);
    chipsEl.style.display = items.length ? 'flex' : 'none';
    chipsEl.innerHTML = items.map(item => {
      const text = item.unknown ? `${item.code} (unknown)` : item.label;
      const title = item.unknown
        ? `${item.code} is not one of Plaid's categories. Remove it.`
        : item.code;
      return `<span class="plaid-picker-chip${item.unknown ? ' is-unknown' : ''}" title="${_plaidPickerEscape(title)}">`
        + `<span class="plaid-picker-chip-text">${_plaidPickerEscape(text)}</span>`
        + `<button type="button" class="plaid-picker-chip-remove" data-code="${_plaidPickerEscape(item.code)}"`
        + ` aria-label="Remove ${_plaidPickerEscape(item.code)}">&times;</button></span>`;
    }).join('');
  }

  function renderInputState() {
    const searchable = isSearchable();
    inputEl.disabled = !searchable;
    inputEl.placeholder = searchable
      ? 'Search Plaid categories, e.g. coffee or rent'
      : "Plaid's category list could not be loaded";
  }

  function renderList() {
    if (!state.open || !isSearchable()) {
      listEl.style.display = 'none';
      state.visibleCodes = [];
      return;
    }
    const groups = plaidPickerFilterGroups(state.taxonomy, state.query, state.selected);
    state.visibleCodes = [];
    let html = '';
    groups.forEach(group => {
      html += `<div class="plaid-picker-group">${_plaidPickerEscape(group.label)}</div>`;
      group.items.forEach(item => {
        const index = state.visibleCodes.length;
        state.visibleCodes.push(item.code);
        html += `<div class="plaid-picker-item${index === state.activeIndex ? ' active' : ''}" role="option"`
          + ` data-code="${_plaidPickerEscape(item.code)}" data-index="${index}">`
          + `<span class="plaid-picker-item-label">${_plaidPickerEscape(item.label)}</span>`
          + `<span class="plaid-picker-item-code">${_plaidPickerEscape(item.code)}</span></div>`;
      });
    });
    if (!html) {
      html = '<div class="plaid-picker-empty">No matching categories</div>';
    }
    listEl.innerHTML = html;
    listEl.style.display = 'block';
    const active = listEl.querySelector('.plaid-picker-item.active');
    if (active && typeof active.scrollIntoView === 'function') active.scrollIntoView({ block: 'nearest' });
  }

  function renderAll() {
    renderChips();
    renderInputState();
    renderList();
  }

  function openList() {
    state.open = true;
    renderList();
  }

  function closeList() {
    state.open = false;
    state.activeIndex = 0;
    renderList();
  }

  function commit(nextSelected) {
    state.selected = nextSelected;
    state.query = '';
    inputEl.value = '';
    state.activeIndex = 0;
    renderAll();
    if (typeof options.onChange === 'function') options.onChange(state.selected.slice());
  }

  function pick(code) {
    commit(plaidPickerAdd(state.selected, code));
  }

  inputEl.addEventListener('focus', openList);
  inputEl.addEventListener('blur', closeList);
  inputEl.addEventListener('input', () => {
    state.query = inputEl.value;
    state.activeIndex = 0;
    openList();
  });
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!state.open) { openList(); return; }
      const count = state.visibleCodes.length;
      if (count === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      state.activeIndex = (state.activeIndex + step + count) % count;
      renderList();
    } else if (event.key === 'Enter') {
      // The form is not a <form>, but the modal may still treat Enter as save.
      event.preventDefault();
      event.stopPropagation();
      const code = state.visibleCodes[state.activeIndex];
      if (state.open && code) pick(code);
    } else if (event.key === 'Escape' && state.open) {
      event.stopPropagation();
      closeList();
    }
  });

  // mousedown, not click: a click would blur the search box first and close
  // the list before the pick registers.
  listEl.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const itemEl = event.target.closest('.plaid-picker-item');
    if (itemEl) pick(itemEl.dataset.code);
  });

  chipsEl.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.plaid-picker-chip-remove');
    if (removeBtn) commit(plaidPickerRemove(state.selected, removeBtn.dataset.code));
  });

  renderAll();

  return {
    setTaxonomy(taxonomy) {
      state.taxonomy = Array.isArray(taxonomy) ? taxonomy : null;
      renderAll();
    },
    setSelected(codes) {
      state.selected = plaidPickerNormalizeCodes(codes);
      state.query = '';
      inputEl.value = '';
      state.activeIndex = 0;
      state.open = false;
      renderAll();
    },
    getSelected() {
      return state.selected.slice();
    },
  };
}
