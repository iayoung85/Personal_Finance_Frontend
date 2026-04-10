// ============================================================
// shared/categories-autocomplete.js
// Shared category typeahead: fetch-with-cache + generic wiring.
//
// Dependencies (must be present as globals before this file loads):
//   BACKEND_URL          — from config.js
//   authenticatedFetch   — from the page's own auth setup
//
// Exports (globals):
//   fetchCategoriesWithCache()
//   wireUpCategoryAutocomplete(inputEl, listEl, options)
//   highlightCategoryMatch(text, query)
// ============================================================

// ── Cache Constants ──────────────────────────────────────────
const _CAT_CACHE_KEY   = 'pf_cached_categories';
const _CAT_TS_KEY      = 'pf_categories_cached_at';
const _CAT_MAX_AGE_MS  = 30 * 60 * 1000; // 30 minutes

// ── Internal Escape (no DOM dependency) ─────────────────────
function _escCatHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Public: Fetch with Cache ─────────────────────────────────

/**
 * Fetch available user categories from the backend, with 30-min
 * localStorage cache. Returns a plain string array.
 *
 * Requires `authenticatedFetch` and `BACKEND_URL` to be defined
 * as globals by the time this is called (i.e. after page init).
 */
async function fetchCategoriesWithCache() {
  const cachedAt = localStorage.getItem(_CAT_TS_KEY);
  const cacheAge = cachedAt ? (Date.now() - parseInt(cachedAt, 10)) : Infinity;

  if (cacheAge < _CAT_MAX_AGE_MS) {
    try {
      const cached = JSON.parse(localStorage.getItem(_CAT_CACHE_KEY) || '[]');
      if (cached.length > 0) return cached;
    } catch (_) { /* fall through to network */ }
  }

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/categorization/categories/available`
    );
    if (response && response.ok) {
      const data = await response.json();
      const categories = data.available_categories || [];
      try {
        localStorage.setItem(_CAT_CACHE_KEY, JSON.stringify(categories));
        localStorage.setItem(_CAT_TS_KEY, String(Date.now()));
      } catch (_) { /* non-critical — storage quota */ }
      return categories;
    }
  } catch (e) {
    console.error('[categories-autocomplete] Failed to fetch:', e);
  }
  return [];
}

// ── Public: Highlight Match ──────────────────────────────────

/**
 * Returns HTML with the matching substring wrapped in <strong>.
 * Uses the module-private _escCatHtml so it has no external dependencies.
 */
function highlightCategoryMatch(text, query) {
  if (!query) return _escCatHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return _escCatHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<strong>$1</strong>');
}

// ── Internal: Filter ─────────────────────────────────────────

function _filterCategories(categories, query) {
  const queryLower = query.toLowerCase();
  if (queryLower.includes(':')) {
    const [qPrimary, qDetail] = queryLower.split(':').map(s => s.trim());
    return categories.filter(cat => {
      const parts = cat.toLowerCase().split(':').map(s => s.trim());
      return (!qPrimary || (parts[0] || '').includes(qPrimary)) &&
             (!qDetail  || (parts[1] || '').includes(qDetail));
    });
  }
  return categories.filter(cat => cat.toLowerCase().includes(queryLower));
}

// ── Internal: Render Dropdown ────────────────────────────────

function _renderCategoryDropdown(input, list, opts) {
  const query = (input.value || '').trim();

  if (!query) {
    list.innerHTML = '';
    list.style.display = 'none';
    return;
  }

  // Optional hook — return true to suppress default filtering.
  // Used by bills.js to handle the "[" transfer-account mode.
  if (opts.onCustomQuery && opts.onCustomQuery(query, list)) return;

  const matches = _filterCategories(opts.categories, query);
  const maxVisible = opts.maxVisible;
  const shown = matches.slice(0, maxVisible);

  if (shown.length === 0) {
    list.innerHTML = `<div class="${opts.emptyClass}">No matching categories</div>`;
    list.style.display = 'block';
    return;
  }

  const overflow = matches.length > maxVisible
    ? `<div class="${opts.moreClass}">${matches.length - maxVisible} more\u2026</div>` : '';

  list.innerHTML = shown.map((cat, i) =>
    `<div class="${opts.itemClass}${i === 0 ? ' active' : ''}" data-value="${_escCatHtml(cat)}">${highlightCategoryMatch(cat, query)}</div>`
  ).join('') + overflow;
  list.style.display = 'block';
}

// ── Public: Wire Up ──────────────────────────────────────────

/**
 * Attach full keyboard + mouse autocomplete behaviour to an input/list pair.
 * Clones the input element to safely drop any previously-attached listeners
 * (important for modal reuse patterns).
 *
 * @param {HTMLInputElement} inputEl   The text input to attach to.
 * @param {HTMLElement}      listEl    The dropdown container element.
 * @param {object}           options
 *   categories    {string[]}   Array of category strings to search.
 *   itemClass     {string}     CSS class for each suggestion item div.
 *   emptyClass    {string}     CSS class for the "no results" div.
 *   moreClass     {string}     CSS class for the overflow hint div.
 *   maxVisible    {number}     Max items shown before the overflow hint (default 10).
 *   onCustomQuery {function(query:string, listEl:HTMLElement) → boolean}
 *                              Called before default filtering. Return true to
 *                              suppress default behaviour (e.g. bills "[" mode).
 *
 * @returns {HTMLInputElement}  The cloned (live) input element, in case the
 *                              caller needs to reference it after wiring.
 */
function wireUpCategoryAutocomplete(inputEl, listEl, options) {
  const opts = Object.assign({
    categories:    [],
    itemClass:     'cat-ac-item',
    emptyClass:    'cat-ac-empty',
    moreClass:     'cat-ac-more',
    maxVisible:    10,
    onCustomQuery: null,
  }, options);

  // Clone to drop old listeners (safe for modal reuse)
  const input = inputEl.cloneNode(true);
  inputEl.parentNode.replaceChild(input, inputEl);

  input.addEventListener('input', () => _renderCategoryDropdown(input, listEl, opts));

  input.addEventListener('focus', () => {
    input.select();
    if (input.value.trim()) _renderCategoryDropdown(input, listEl, opts);
  });

  input.addEventListener('keydown', e => {
    const items     = listEl.querySelectorAll(`.${opts.itemClass}`);
    const activeItem = listEl.querySelector(`.${opts.itemClass}.active`);
    const activeIdx  = Array.from(items).indexOf(activeItem);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(activeIdx + 1, items.length - 1);
      items.forEach(it => it.classList.remove('active'));
      if (items[next]) { items[next].classList.add('active'); items[next].scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(activeIdx - 1, 0);
      items.forEach(it => it.classList.remove('active'));
      if (items[prev]) { items[prev].classList.add('active'); items[prev].scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      const target = activeItem || items[0];
      if (target) {
        e.preventDefault();
        input.value = target.dataset.value;
        listEl.innerHTML = '';
        listEl.style.display = 'none';
      }
    } else if (e.key === 'Escape') {
      listEl.innerHTML = '';
      listEl.style.display = 'none';
    }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { listEl.innerHTML = ''; listEl.style.display = 'none'; }, 200);
  });

  listEl.addEventListener('mousedown', e => {
    const item = e.target.closest(`.${opts.itemClass}`);
    if (item) {
      e.preventDefault();
      input.value = item.dataset.value;
      listEl.innerHTML = '';
      listEl.style.display = 'none';
    }
  });

  return input;
}
