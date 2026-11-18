// ============================================================
// categories/category-view.js — Sort, search and filter for the table
// Pure helpers: no DOM, no network, no page state. They take the tree
// from buildCategoryTree and a view state, and return the rows to draw.
// Needs primary-kinds.js and category-tree.js loaded first.
// ============================================================

/** The columns a header click can sort by. */
const CATEGORY_SORT_COLUMNS = ['name', 'kind', 'uses', 'hidden'];

/** Filter values that name a kind start with this, then the kind's value. */
const KIND_FILTER_PREFIX = 'kind:';

/** Where a primary's Hidden state falls when sorted ascending: unchecked before checked. */
const HIDDEN_STATE_RANK = { none: 0, some: 1, all: 2 };

/**
 * The entries of the filter dropdown, in the order it lists them.
 * @returns {Array<{value: string, label: string}>} The kind entries follow
 *   PRIMARY_KIND_OPTIONS, labelled with each kind's display name.
 */
function categoryFilterOptions() {
  return [
    { value: 'all', label: 'Show all' },
    { value: 'unused', label: 'Unused categories' },
    { value: 'used', label: 'Used categories' },
    { value: 'hidden', label: 'Hidden categories' },
    ...PRIMARY_KIND_OPTIONS.map(option => ({ value: KIND_FILTER_PREFIX + option.value, label: option.label }))
  ];
}

/**
 * A view state with every field present and valid, so a stray value from
 * the page can never reach the sort or the filter.
 * @param {Object} [viewState] {sortColumn, sortDirection, searchText, filter}
 * @returns {{sortColumn: string, sortDirection: string, searchText: string, filter: string}}
 */
function normalizeCategoryView(viewState) {
  const state = viewState || {};
  const filterValues = categoryFilterOptions().map(option => option.value);
  return {
    sortColumn: CATEGORY_SORT_COLUMNS.includes(state.sortColumn) ? state.sortColumn : 'name',
    sortDirection: state.sortDirection === 'desc' ? 'desc' : 'asc',
    searchText: typeof state.searchText === 'string' ? state.searchText : '',
    filter: filterValues.includes(state.filter) ? state.filter : 'all'
  };
}

/**
 * The search needle: trimmed and lowercased, so a stray space does not
 * hide every row.
 * @param {Object} viewState
 * @returns {string} '' when the box is empty.
 */
function categorySearchNeedle(viewState) {
  return normalizeCategoryView(viewState).searchText.trim().toLowerCase();
}

/**
 * Whether the search box has text that narrows the table.
 * @param {Object} viewState
 * @returns {boolean}
 */
function categorySearchActive(viewState) {
  return categorySearchNeedle(viewState) !== '';
}

/**
 * Whether search or filter is hiding any rows.
 * @param {Object} viewState
 * @returns {boolean}
 */
function categoryViewNarrows(viewState) {
  return categorySearchActive(viewState) || normalizeCategoryView(viewState).filter !== 'all';
}

/**
 * The sort after a click on a header: a new column starts ascending, the
 * active column reverses.
 * @param {Object} viewState
 * @param {string} column One of CATEGORY_SORT_COLUMNS.
 * @returns {{sortColumn: string, sortDirection: string}}
 */
function nextCategorySort(viewState, column) {
  const state = normalizeCategoryView(viewState);
  if (!CATEGORY_SORT_COLUMNS.includes(column)) {
    return { sortColumn: state.sortColumn, sortDirection: state.sortDirection };
  }
  if (state.sortColumn === column) {
    return { sortColumn: column, sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc' };
  }
  return { sortColumn: column, sortDirection: 'asc' };
}

/**
 * The folds in force: a search opens every primary it shows, and clearing
 * the box brings the stored folds back.
 * @param {Object} viewState
 * @param {Set<string>} collapsedPrimaries The folds the user set.
 * @returns {Set<string>}
 */
function effectiveCollapsedPrimaries(viewState, collapsedPrimaries) {
  return categorySearchActive(viewState) ? new Set() : (collapsedPrimaries || new Set());
}

function _primaryKindName(group) {
  const kind = group.kindView && group.kindView.kind;
  return kind ? primaryKindLabel(kind) : '';
}

function _entryUses(entry) {
  return Number(entry && entry.uses) || 0;
}

function _entryPassesFilter(group, entry, filter) {
  if (filter === 'unused') return _entryUses(entry) === 0;
  if (filter === 'used') return _entryUses(entry) > 0;
  if (filter === 'hidden') return entry.hidden === true;
  if (filter.startsWith(KIND_FILTER_PREFIX)) {
    // The kind the Kind column shows, picked or by name.
    return Boolean(group.kindView) && group.kindView.kind === filter.slice(KIND_FILTER_PREFIX.length);
  }
  return true;
}

/** Name order for detailed rows: a label with no detailed part leads, as the tree lists it. */
function _compareEntryNames(left, right) {
  const leftBare = !left.detailed;
  const rightBare = !right.detailed;
  if (leftBare !== rightBare) return leftBare ? -1 : 1;
  return _compareNames(categoryRowName(left), categoryRowName(right));
}

/**
 * Order items by a column, then by Name ascending whatever the direction.
 * @param {Array<Object>} items
 * @param {{sortColumn: string, sortDirection: string}} state
 * @param {function(Object): number|string} columnValue The item's value in a non-Name column.
 * @param {function(Object, Object): number} compareNames Name order, ascending.
 * @returns {Array<Object>} A new array.
 */
function _sortByColumn(items, state, columnValue, compareNames) {
  const sign = state.sortDirection === 'desc' ? -1 : 1;
  return items.slice().sort((left, right) => {
    if (state.sortColumn === 'name') return sign * compareNames(left, right);
    const leftValue = columnValue(left);
    const rightValue = columnValue(right);
    let byColumn = 0;
    if (typeof leftValue === 'string') byColumn = _compareNames(leftValue, rightValue);
    else if (leftValue !== rightValue) byColumn = leftValue < rightValue ? -1 : 1;
    if (byColumn !== 0) return sign * byColumn;
    return compareNames(left, right);
  });
}

function _primaryColumnValue(state) {
  return group => {
    if (state.sortColumn === 'kind') return _primaryKindName(group);
    if (state.sortColumn === 'uses') return group.uses;
    return HIDDEN_STATE_RANK[group.hiddenState];
  };
}

function _entryColumnValue(state, group) {
  return entry => {
    // Every detailed row counts as its primary's kind, so Kind leaves them to the Name tie-break.
    if (state.sortColumn === 'kind') return _primaryKindName(group);
    if (state.sortColumn === 'uses') return _entryUses(entry);
    return entry.hidden === true ? 1 : 0;
  };
}

/**
 * The rows the table draws: the tree narrowed by filter and search, then sorted.
 * @param {Array<Object>} tree From buildCategoryTree.
 * @param {Object} viewState {sortColumn, sortDirection, searchText, filter}
 * @returns {Array<Object>} Each row is the tree group with `children` cut down
 *   to the categories in view, plus `totalCount` (all its categories) and
 *   `forceExpanded` (a search is open). `uses` and `hiddenState` stay the
 *   figures over every category the primary holds, because they describe the
 *   primary, not the narrowed view.
 */
function applyCategoryView(tree, viewState) {
  const state = normalizeCategoryView(viewState);
  const needle = categorySearchNeedle(state);
  const rows = [];

  (tree || []).forEach(group => {
    const primaryMatches = needle !== '' && group.primary.toLowerCase().includes(needle);
    let children = group.children.filter(entry => _entryPassesFilter(group, entry, state.filter));
    if (needle !== '' && !primaryMatches) {
      children = children.filter(entry => categoryRowName(entry).toLowerCase().includes(needle));
    }
    if (!children.length) return;
    rows.push({
      ...group,
      children: _sortByColumn(children, state, _entryColumnValue(state, group), _compareEntryNames),
      totalCount: group.children.length,
      forceExpanded: needle !== ''
    });
  });

  return _sortByColumn(
    rows,
    state,
    _primaryColumnValue(state),
    (left, right) => _compareNames(left.primary, right.primary)
  );
}

/**
 * Keep only the selection that is still on screen, so Merge, Hide and Delete
 * cannot act on a row the user cannot see: a row search or filter dropped,
 * or a row under a folded primary.
 * @param {{labels: string[], anchor: string|null}} selection
 * @param {string|null} selectedPrimary The primary row selected by itself.
 * @param {Array<Object>} viewRows From applyCategoryView.
 * @param {Set<string>} [foldedPrimaries] The folds in force, from
 *   effectiveCollapsedPrimaries. A folded primary's own row stays on screen.
 * @returns {{selection: {labels: string[], anchor: string|null}, selectedPrimary: string|null}}
 */
function pruneSelectionToView(selection, selectedPrimary, viewRows, foldedPrimaries) {
  const folded = foldedPrimaries || new Set();
  const inView = new Set();
  const primariesInView = new Set();
  (viewRows || []).forEach(row => {
    primariesInView.add(row.primary);
    if (folded.has(row.primary)) return;
    row.children.forEach(entry => inView.add(entry.label));
  });
  const current = (selection && selection.labels) || [];
  const anchor = selection && inView.has(selection.anchor) ? selection.anchor : null;
  return {
    selection: { labels: current.filter(label => inView.has(label)), anchor },
    selectedPrimary: selectedPrimary && primariesInView.has(selectedPrimary) ? selectedPrimary : null
  };
}
