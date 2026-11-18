// ============================================================
// categories/category-table.js — The Categories table
// Draws the tree from the GET's labels, keeps the selection and
// the folded primaries, and routes clicks, right-clicks and the
// Hidden boxes. The rules it applies live in category-tree.js.
// ============================================================

// The whole tree the table last built, so menus act on every category a primary holds.
let renderedCategoryTree = [];
// The rows the table last drew after search, filter and sort, in screen order.
let renderedViewRows = [];
// The row that keeps the table's one tab stop, as its data-row-key.
let categoryFocusRowKey = null;

const CATEGORY_SORT_ARROW_SVG = {
  asc: '<svg class="cat-sort-arrow" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" focusable="false"><path d="M5 2l4 6H1z" fill="currentColor"/></svg>',
  desc: '<svg class="cat-sort-arrow" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true" focusable="false"><path d="M5 8L1 2h8z" fill="currentColor"/></svg>'
};

const CATEGORY_CHEVRON_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function _primaryRowKey(primary) {
  return `p:${primary}`;
}

function _labelRowKey(label) {
  return `l:${label}`;
}

/** The tree as currently drawn; rebuilt when the table has not drawn yet. */
function currentCategoryTree() {
  if (renderedCategoryTree.length || !categoryLabels.length) return renderedCategoryTree;
  return buildCategoryTree(categoryLabels, primaryCategories);
}

/** @returns {Object|null} The `labels` entry for a label. */
function findCategoryEntry(label) {
  return (categoryLabels || []).find(entry => entry.label === label) || null;
}

/** @returns {Object|null} The tree group for a primary, matched exactly. */
function findCategoryGroup(primary) {
  return currentCategoryTree().find(group => group.primary === primary) || null;
}

// ── Drawing ─────────────────────────────────────────────────

function _usesCellHtml(count, target, nameForLabel) {
  if (count > 0) {
    const noun = count === 1 ? 'transaction' : 'transactions';
    return `<a class="cat-uses-link" href="${escapeHtml(categoryUsesHref(target))}" target="_blank" rel="noopener" `
      + `title="Open the ${count} ${noun} in ${escapeHtml(nameForLabel)} in a new tab">${count.toLocaleString()}</a>`;
  }
  return '<span class="cat-uses-zero">0</span>';
}

function _pinnedNoteId(primary) {
  return `pinned-note-${normalizePrimaryKey(primary).replace(/[^a-z0-9]+/g, '-')}`;
}

/** The Kind cell of a primary row. */
function _primaryKindCellHtml(group) {
  const view = group.kindView;
  if (view.mode === 'none') return '<span class="cat-kind-none">—</span>';
  if (view.mode === 'pinned') {
    const noteId = _pinnedNoteId(group.primary);
    const isOpen = pinnedNotesOpen.has(normalizePrimaryKey(group.primary));
    const name = escapeHtml(group.primary);
    return `<span class="cat-kind-text">${escapeHtml(view.label)}</span>`
      + `<button type="button" class="primary-kind-info" data-primary-name="${name}" data-note-id="${noteId}" `
      + `aria-label="Why ${name} always counts as ${escapeHtml(view.label)}" aria-expanded="${isOpen}" aria-controls="${noteId}">ⓘ</button>`;
  }
  const unsetClass = view.isSet ? '' : ' is-by-name';
  return `<span class="cat-kind-text${unsetClass}">${escapeHtml(view.label)}</span>`;
}

/** The full-width row under a pinned primary that holds its explanation. */
function _pinnedNoteRowHtml(group) {
  if (group.kindView.mode !== 'pinned') return '';
  const key = normalizePrimaryKey(group.primary);
  const paragraphs = group.kindView.explanations
    .map(text => `<p>${_renderNoteText(text)}</p>`)
    .join('');
  return `<tr class="cat-note-row" id="${_pinnedNoteId(group.primary)}" ${pinnedNotesOpen.has(key) ? '' : 'hidden'}>`
    + `<td colspan="4"><div class="primary-kind-note" role="note">${paragraphs}</div></td></tr>`;
}

/** Escaped HTML for note text, with its asterisk-marked runs in <em>. */
function _renderNoteText(text) {
  return splitEmphasis(text)
    .map(run => (run.emphasis ? `<em>${escapeHtml(run.text)}</em>` : escapeHtml(run.text)))
    .join('');
}

function _primaryRowHtml(group, isCollapsed, stripe) {
  const key = _primaryRowKey(group.primary);
  const name = escapeHtml(group.primary);
  const isSelected = selectedPrimaryRow === group.primary;
  const hiddenClass = group.hiddenState === 'all' ? ' is-hidden' : '';
  const boxState = group.hiddenState === 'all' ? 'checked' : '';
  const total = group.totalCount;
  const noun = total === 1 ? 'category' : 'categories';
  const countText = group.children.length === total ? `${total} ${noun}` : `${group.children.length} of ${total} ${noun}`;
  return `
    <tr class="cat-row cat-row-primary${hiddenClass}${isSelected ? ' is-selected' : ''}${stripe ? ' is-alt' : ''}"
        data-row-key="${escapeHtml(key)}" data-primary="${name}" aria-selected="${isSelected}"
        aria-expanded="${!isCollapsed}" tabindex="-1">
      <td class="cat-cell-name">
        <button type="button" class="cat-chevron${isCollapsed ? ' is-collapsed' : ''}" tabindex="-1"
                aria-label="${isCollapsed ? 'Expand' : 'Collapse'} ${name}">${CATEGORY_CHEVRON_SVG}</button>
        <span class="cat-name-text">${name}</span>
        <span class="cat-child-count">${countText}</span>
      </td>
      <td class="cat-cell-kind">${_primaryKindCellHtml(group)}</td>
      <td class="cat-cell-uses">${_usesCellHtml(group.uses, group.primary, group.primary)}</td>
      <td class="cat-cell-hidden">
        <input type="checkbox" class="cat-hidden-box" data-hide-primary="${name}" ${boxState}
               data-indeterminate="${group.hiddenState === 'some'}" tabindex="-1"
               aria-label="Hide every category under ${name} in lists">
      </td>
    </tr>`;
}

function _detailedRowHtml(group, entry, stripe) {
  const key = _labelRowKey(entry.label);
  const label = escapeHtml(entry.label);
  const isSelected = categorySelection.labels.includes(entry.label);
  const rowName = categoryRowName(entry);
  const description = entry.description ? String(entry.description) : '';
  const nameTitle = description ? ` title="${escapeHtml(description)}"` : '';
  const descriptionClass = description ? ' has-description' : '';
  const lockedTag = entry.locked
    ? `<span class="cat-tag" title="${escapeHtml(entry.locked_message || LOCKED_FALLBACK_REASON)}">Locked</span>`
    : '';
  const catchAllTag = isCatchAllEntry(entry)
    ? `<span class="cat-tag" title="${escapeHtml(CATCH_ALL_TAG_HOVER)}">Catch-all</span>`
    : '';
  const bareTag = entry.detailed ? '' : '<span class="cat-tag" title="This label has no detailed name. Edit it to give it one.">No detailed name</span>';
  const kindText = group.kindView.mode === 'none' ? '—' : group.kindView.label;
  return `
    <tr class="cat-row cat-row-detailed${entry.hidden ? ' is-hidden' : ''}${isSelected ? ' is-selected' : ''}${stripe ? ' is-alt' : ''}"
        data-row-key="${escapeHtml(key)}" data-label="${label}" data-primary="${escapeHtml(group.primary)}"
        aria-selected="${isSelected}" tabindex="-1">
      <td class="cat-cell-name"${nameTitle}>
        <span class="cat-name-text${descriptionClass}">${escapeHtml(rowName)}</span>${lockedTag}${catchAllTag}${bareTag}
      </td>
      <td class="cat-cell-kind"><span class="cat-kind-inherited">${escapeHtml(kindText)}</span></td>
      <td class="cat-cell-uses">${_usesCellHtml(Number(entry.uses) || 0, entry.label, entry.label)}</td>
      <td class="cat-cell-hidden">
        <input type="checkbox" class="cat-hidden-box" data-hide-label="${label}" ${entry.hidden ? 'checked' : ''}
               tabindex="-1" aria-label="Hide ${label} in lists">
      </td>
    </tr>`;
}

/** Drop selections and folds that point at rows no longer in the list. */
function _pruneCategoryTableState(tree) {
  const listed = new Set((categoryLabels || []).map(entry => entry.label));
  const anchor = listed.has(categorySelection.anchor) ? categorySelection.anchor : null;
  categorySelection = { labels: categorySelection.labels.filter(label => listed.has(label)), anchor };
  const primaries = new Set(tree.map(group => group.primary));
  if (selectedPrimaryRow && !primaries.has(selectedPrimaryRow)) selectedPrimaryRow = null;
  Array.from(collapsedPrimaries).forEach(primary => {
    if (!primaries.has(primary)) collapsedPrimaries.delete(primary);
  });
}

/** The folds in force right now: a search opens every primary it shows. */
function _foldsInForce() {
  return effectiveCollapsedPrimaries(categoryViewState, collapsedPrimaries);
}

/** One sortable column header; the active one shows its direction. */
function _sortHeadHtml(column, label, className, title) {
  const isActive = categoryViewState.sortColumn === column;
  const direction = categoryViewState.sortDirection === 'desc' ? 'desc' : 'asc';
  const ariaSort = isActive ? ` aria-sort="${direction === 'desc' ? 'descending' : 'ascending'}"` : '';
  const arrow = isActive ? CATEGORY_SORT_ARROW_SVG[direction] : '';
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
  return `<th scope="col" class="${className}"${ariaSort}>`
    + `<button type="button" class="cat-sort-btn" data-sort="${column}"${titleAttribute}>${label}${arrow}</button></th>`;
}

function renderCategoryTable() {
  const container = document.getElementById('category-table');
  if (!container) return;

  _setCategoryToolbarEnabled(!categoryLoadFailed);
  if (categoryLoadFailed) {
    renderedCategoryTree = [];
    renderedViewRows = [];
    const countElement = document.getElementById('category-table-count');
    if (countElement) countElement.textContent = '';
    container.innerHTML = '<div class="empty-state">Your categories could not be loaded. '
      + '<button type="button" class="cat-button cat-button-secondary cat-retry-btn">Retry</button></div>';
    return;
  }

  const tree = buildCategoryTree(labelsWithPendingHidden(categoryLabels, pendingHiddenChanges), primaryCategories);
  renderedCategoryTree = tree;
  _pruneCategoryTableState(tree);

  const viewRows = applyCategoryView(tree, categoryViewState);
  renderedViewRows = viewRows;
  const kept = pruneSelectionToView(categorySelection, selectedPrimaryRow, viewRows, _foldsInForce());
  categorySelection = kept.selection;
  selectedPrimaryRow = kept.selectedPrimary;

  const countElement = document.getElementById('category-table-count');
  if (countElement) {
    const total = categoryLabels.length;
    const hiddenCount = categoryLabels.filter(entry => entry.hidden).length;
    const parts = [`${total} ${total === 1 ? 'category' : 'categories'} under ${tree.length} ${tree.length === 1 ? 'primary' : 'primaries'}`];
    if (hiddenCount) parts.push(`${hiddenCount} hidden`);
    if (categoryViewNarrows(categoryViewState)) {
      parts.push(`${viewRows.reduce((sum, row) => sum + row.children.length, 0)} shown`);
    }
    countElement.textContent = total ? parts.join(' · ') : '';
  }

  if (!tree.length) {
    const message = categoryLabelsMissing
      ? 'The server sent no category table. Restart the API server and reload this page.'
      : 'No categories in your list yet. Use + New to add one.';
    container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    return;
  }

  // A header button that had focus is refocused by its own handler; only a row needs it here.
  const hadFocus = Boolean(document.activeElement && container.contains(document.activeElement)
    && document.activeElement.closest('tr.cat-row'));
  const folds = _foldsInForce();
  const rows = [];
  let stripe = false;
  viewRows.forEach(group => {
    const isCollapsed = folds.has(group.primary);
    rows.push(_primaryRowHtml(group, isCollapsed, stripe));
    stripe = !stripe;
    rows.push(_pinnedNoteRowHtml(group));
    if (isCollapsed) return;
    group.children.forEach(entry => {
      rows.push(_detailedRowHtml(group, entry, stripe));
      stripe = !stripe;
    });
  });

  container.innerHTML = `
    <table class="cat-table" role="grid" aria-label="Categories" aria-multiselectable="true">
      <colgroup>
        <col class="cat-col-name"><col class="cat-col-kind"><col class="cat-col-uses"><col class="cat-col-hidden">
      </colgroup>
      <thead>
        <tr>
          ${_sortHeadHtml('name', 'Name', 'cat-head-name', '')}
          ${_sortHeadHtml('kind', 'Kind', 'cat-head-kind', '')}
          ${_sortHeadHtml('uses', 'Uses', 'cat-head-uses', 'Transactions on each category, as the transactions list shows them')}
          ${_sortHeadHtml('hidden', 'Hidden', 'cat-head-hidden', 'Hidden categories leave the category pickers on every other page')}
        </tr>
      </thead>
      <tbody>${rows.length ? rows.join('') : '<tr class="cat-empty-row"><td colspan="4">No categories match</td></tr>'}</tbody>
    </table>`;

  container.querySelectorAll('.cat-hidden-box[data-indeterminate="true"]').forEach(box => {
    box.indeterminate = true;
  });
  _markPendingHiddenBoxes(container);
  _applyRovingTabStop(container, hadFocus);
}

/** The toolbar's change buttons need a loaded list to act on. */
function _setCategoryToolbarEnabled(enabled) {
  ['cat-new-btn', 'cat-remove-unused-btn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = !enabled;
  });
}

/** Show which boxes still wait on the server, so a queued click reads as taken. */
function _markPendingHiddenBoxes(container) {
  if (!pendingHiddenChanges.size) return;
  container.querySelectorAll('.cat-hidden-box').forEach(box => {
    const label = box.getAttribute('data-hide-label');
    let pending = false;
    if (label) {
      pending = pendingHiddenChanges.has(label);
    } else {
      const group = findCategoryGroup(box.getAttribute('data-hide-primary'));
      pending = Boolean(group) && group.children.some(entry => pendingHiddenChanges.has(entry.label));
    }
    if (!pending) return;
    box.classList.add('is-pending');
    box.setAttribute('aria-busy', 'true');
  });
}

/** Give one row the table's tab stop, and put focus back on it after a redraw. */
function _applyRovingTabStop(container, refocus) {
  const rows = Array.from(container.querySelectorAll('tr.cat-row'));
  if (!rows.length) return;
  let focusRow = rows.find(row => row.getAttribute('data-row-key') === categoryFocusRowKey);
  if (!focusRow) focusRow = rows[0];
  rows.forEach(row => { row.tabIndex = row === focusRow ? 0 : -1; });
  if (refocus) focusRow.focus({ preventScroll: true });
}

/** Update the selected look in place; a redraw between two clicks would swallow a double-click. */
function _paintCategorySelection() {
  const container = document.getElementById('category-table');
  if (!container) return;
  container.querySelectorAll('tr.cat-row').forEach(row => {
    const label = row.getAttribute('data-label');
    const isSelected = label
      ? categorySelection.labels.includes(label)
      : row.getAttribute('data-primary') === selectedPrimaryRow;
    row.classList.toggle('is-selected', isSelected);
    row.setAttribute('aria-selected', String(isSelected));
  });
}

// ── Selection ───────────────────────────────────────────────

function _selectRow(row, modifiers) {
  const label = row.getAttribute('data-label');
  if (label) {
    const ordered = visibleCategoryLabels(renderedViewRows, _foldsInForce());
    categorySelection = selectionAfterClick(categorySelection, label, modifiers, ordered);
    selectedPrimaryRow = null;
  } else {
    // A primary row is selected on its own: it never joins a Merge.
    selectedPrimaryRow = row.getAttribute('data-primary');
    categorySelection = { labels: [], anchor: null };
  }
  _focusRow(row);
  _paintCategorySelection();
}

function _focusRow(row) {
  categoryFocusRowKey = row.getAttribute('data-row-key');
  const container = document.getElementById('category-table');
  if (container) {
    container.querySelectorAll('tr.cat-row').forEach(other => { other.tabIndex = other === row ? 0 : -1; });
  }
  row.focus({ preventScroll: false });
}

/** What a row's menu acts on, with the selection settled for a right-click. */
function _menuContextForRow(row) {
  const label = row.getAttribute('data-label');
  if (!label) {
    const primary = row.getAttribute('data-primary');
    selectedPrimaryRow = primary;
    categorySelection = { labels: [], anchor: null };
    _paintCategorySelection();
    return { kind: 'primary', group: findCategoryGroup(primary) };
  }
  categorySelection = selectionAfterRightClick(categorySelection, label);
  selectedPrimaryRow = null;
  _paintCategorySelection();
  const selected = categorySelection.labels.map(findCategoryEntry).filter(Boolean);
  return { kind: 'detailed', entry: findCategoryEntry(label), selected };
}

function _menuItemsFor(context) {
  if (context.kind === 'primary') return primaryMenuEntries(context.group);
  return categoryMenuEntries(context.entry, context.selected);
}

function _openRowMenu(row, x, y) {
  categoryFocusRowKey = row.getAttribute('data-row-key');
  const context = _menuContextForRow(row);
  if ((context.kind === 'primary' && !context.group) || (context.kind === 'detailed' && !context.entry)) return;
  openCategoryMenu({
    x,
    y,
    items: _menuItemsFor(context),
    onPick: id => runCategoryMenuAction(id, context),
    returnFocusTo: row
  });
}

/** Open Edit for a row, or say why it can't be edited. */
function _editRow(row) {
  const label = row.getAttribute('data-label');
  const context = label
    ? { kind: 'detailed', entry: findCategoryEntry(label), selected: [findCategoryEntry(label)] }
    : { kind: 'primary', group: findCategoryGroup(row.getAttribute('data-primary')) };
  if ((context.kind === 'detailed' && !context.entry) || (context.kind === 'primary' && !context.group)) return;
  const edit = _menuItemsFor(context).find(item => item.id === 'edit');
  if (!edit.enabled) {
    showStatus(edit.reason, 'warning');
    return;
  }
  runCategoryMenuAction('edit', context);
}

/**
 * Carry out a menu choice.
 * @param {string} id A menu item id.
 * @param {Object} context From _menuContextForRow.
 */
function runCategoryMenuAction(id, context) {
  if (id === 'new') {
    openCategoryEditor({ mode: 'create' });
    return;
  }
  const primary = context.kind === 'primary' ? context.group.primary : context.entry.primary;
  if (id === 'new-sub') {
    openCategoryEditor({ mode: 'create', parent: primary, kindSourcePrimary: primary });
    return;
  }
  if (id === 'edit') {
    if (context.kind === 'primary') openCategoryEditor({ mode: 'edit-primary', primary });
    else openCategoryEditor({ mode: 'edit', label: context.entry.label });
    return;
  }
  if (id === 'delete') {
    confirmDeleteCategories(context);
    return;
  }
  if (id === 'hide' || id === 'unhide') {
    const labels = context.kind === 'primary'
      ? context.group.children.map(entry => entry.label)
      : context.selected.map(entry => entry.label);
    applyCategoriesHidden(labels, id === 'hide');
    return;
  }
  if (id === 'merge') {
    openMergeConfirm(context.selected, context.entry.label);
  }
}

// ── Hidden ──────────────────────────────────────────────────

// label -> hidden asked for, until the queue that sends it has settled.
const pendingHiddenChanges = new Map();

const _hiddenChangeQueue = createHiddenChangeQueue({
  send: async change => {
    const result = await setCategoriesHidden(change);
    if (result.ok) return { ok: true };
    return { ok: false, error: (result.data && result.data.error) || 'The server did not change it.' };
  },
  settle: async report => {
    // Cleared before the reload, so the redraw shows what the server holds.
    pendingHiddenChanges.clear();
    const outcome = hiddenQueueMessage(report);
    if (outcome.tone === 'error') {
      await refreshAfterCategoryChange('');
      showStatus(outcome.text, 'error');
      return;
    }
    await refreshAfterCategoryChange(outcome.text);
  }
});

/**
 * Hide or unhide labels. Changes queue behind any still being sent, and the
 * table reloads once the last of them settles.
 * @param {string[]} labels
 * @param {boolean} hidden
 */
function applyCategoriesHidden(labels, hidden) {
  if (!labels.length) return;
  labels.forEach(label => pendingHiddenChanges.set(label, hidden));
  renderCategoryTable();
  _hiddenChangeQueue.enqueue({ labels: labels.slice(), hidden });
}

function _onHiddenBoxChange(box) {
  const hidden = box.checked;
  const label = box.getAttribute('data-hide-label');
  if (label) {
    applyCategoriesHidden([label], hidden);
    return;
  }
  const group = findCategoryGroup(box.getAttribute('data-hide-primary'));
  if (!group) return;
  applyCategoriesHidden(group.children.map(entry => entry.label), hidden);
}

// ── After a change ──────────────────────────────────────────

/**
 * Reload the page's data after a change that succeeded, keeping the folds,
 * the scroll position and, when given, a new selection. Marks the
 * transactions page's cache stale and expires the shared picker cache.
 * @param {string} message Shown once the reload is done; '' for none.
 * @param {{selectLabels?: string[], selectPrimary?: string}} [options]
 * @returns {Promise<boolean>} Whether the list reloaded. The change itself
 *   succeeded either way, so the message still shows, with the failure.
 */
async function refreshAfterCategoryChange(message, options = {}) {
  markTransactionCacheStale();
  expireSharedCategoryPickerCache();
  if (options.selectLabels) {
    categorySelection = { labels: options.selectLabels.slice(), anchor: options.selectLabels[0] || null };
    selectedPrimaryRow = null;
    if (options.selectLabels[0]) categoryFocusRowKey = _labelRowKey(options.selectLabels[0]);
  }
  if (options.selectPrimary) {
    selectedPrimaryRow = options.selectPrimary;
    categorySelection = { labels: [], anchor: null };
    categoryFocusRowKey = _primaryRowKey(options.selectPrimary);
  }
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const loaded = await loadCategorizationData(true);
  window.scrollTo(scrollX, scrollY);
  if (!message) return loaded;
  // After the reload, which posts its own rule-check status.
  if (!loaded) {
    showStatus(`${message} The list could not be refreshed; use Retry.`, 'warning');
    return loaded;
  }
  showStatus(message, 'success');
  setTimeout(() => clearStatus(), 3500);
  return loaded;
}

// ── Pinned notes ────────────────────────────────────────────

/** Show or hide one pinned note and keep the button and the open set in step. */
function _setPinnedNoteOpen(button, open) {
  const key = normalizePrimaryKey(button.getAttribute('data-primary-name'));
  const note = document.getElementById(button.getAttribute('data-note-id'));
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (note) note.hidden = !open;
  if (open) pinnedNotesOpen.add(key);
  else pinnedNotesOpen.delete(key);
}

/** Close every open pinned note except the one belonging to `keepButton`. */
function _closePinnedNotes(keepButton) {
  document.querySelectorAll('.primary-kind-info[aria-expanded="true"]').forEach(button => {
    if (button !== keepButton) _setPinnedNoteOpen(button, false);
  });
}

// Capture phase, so a control that stops propagation still closes the notes:
// a click outside the ⓘ and its note, or Escape, closes them.
document.addEventListener('click', event => {
  if (event.target.closest('.primary-kind-info, .primary-kind-note')) return;
  _closePinnedNotes(null);
}, true);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openButton = document.querySelector('.cat-table .primary-kind-info[aria-expanded="true"]');
  if (!openButton) return;
  const focusWasInNote = document.activeElement && document.activeElement.closest('.primary-kind-note');
  _closePinnedNotes(null);
  if (focusWasInNote) openButton.focus();
});

// ── Wiring ──────────────────────────────────────────────────

function _rowFromEvent(event) {
  return event.target.closest('tr.cat-row');
}

function _isOnRowControl(target) {
  return Boolean(target.closest('.cat-chevron, .primary-kind-info, .primary-kind-note, .cat-uses-link, .cat-cell-hidden'));
}

function _toggleCollapsed(primary) {
  // While a search is open every primary shows expanded; a stored fold would change nothing on screen.
  if (categorySearchActive(categoryViewState)) return;
  if (collapsedPrimaries.has(primary)) collapsedPrimaries.delete(primary);
  else collapsedPrimaries.add(primary);
  categoryFocusRowKey = _primaryRowKey(primary);
  renderCategoryTable();
}

function _onTableKeydown(event) {
  const row = _rowFromEvent(event);
  if (!row || event.target !== row) return;
  const rows = Array.from(row.closest('tbody').querySelectorAll('tr.cat-row'));
  const index = rows.indexOf(row);

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = rows[event.key === 'ArrowDown' ? index + 1 : index - 1];
    if (next) _selectRow(next, { additive: false, range: event.shiftKey });
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const primary = row.getAttribute('data-label') ? null : row.getAttribute('data-primary');
    if (!primary) return;
    const shouldCollapse = event.key === 'ArrowLeft';
    if (shouldCollapse !== _foldsInForce().has(primary)) {
      event.preventDefault();
      _toggleCollapsed(primary);
    }
    return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    _selectRow(row, { additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    _editRow(row);
    return;
  }
  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    _openRowMenu(row, rect.left + 24, rect.bottom);
  }
}

/** Hook the toolbar and the table once; the table's rows are redrawn underneath. */
function initCategoryTable() {
  const container = document.getElementById('category-table');
  if (!container) return;

  container.addEventListener('mousedown', event => {
    // Shift-click extends the selection; it should not also highlight text.
    if (event.shiftKey && _rowFromEvent(event)) event.preventDefault();
  });

  container.addEventListener('click', event => {
    const retryButton = event.target.closest('.cat-retry-btn');
    if (retryButton) {
      retryButton.disabled = true;
      loadCategorizationData(true);
      return;
    }
    const sortButton = event.target.closest('.cat-sort-btn');
    if (sortButton) {
      _sortBy(sortButton.getAttribute('data-sort'));
      return;
    }
    const chevron = event.target.closest('.cat-chevron');
    if (chevron) {
      _toggleCollapsed(chevron.closest('tr').getAttribute('data-primary'));
      return;
    }
    const info = event.target.closest('.primary-kind-info');
    if (info) {
      const willOpen = info.getAttribute('aria-expanded') !== 'true';
      _closePinnedNotes(info);
      _setPinnedNoteOpen(info, willOpen);
      return;
    }
    if (_isOnRowControl(event.target)) return;
    const row = _rowFromEvent(event);
    if (!row) return;
    _selectRow(row, { additive: event.metaKey || event.ctrlKey, range: event.shiftKey });
  });

  container.addEventListener('dblclick', event => {
    if (_isOnRowControl(event.target)) return;
    const row = _rowFromEvent(event);
    if (row) _editRow(row);
  });

  container.addEventListener('contextmenu', event => {
    const row = _rowFromEvent(event);
    if (!row) return;
    event.preventDefault();
    _openRowMenu(row, event.clientX, event.clientY);
  });

  container.addEventListener('change', event => {
    const box = event.target.closest('.cat-hidden-box');
    if (box) _onHiddenBoxChange(box);
  });

  container.addEventListener('keydown', _onTableKeydown);

  const bind = (id, handler) => {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', handler);
  };
  bind('cat-new-btn', () => openCategoryEditor({ mode: 'create' }));
  // Both act on the primaries in view; the ones a search or filter hides keep their fold.
  bind('cat-expand-btn', () => {
    renderedViewRows.forEach(row => collapsedPrimaries.delete(row.primary));
    renderCategoryTable();
  });
  bind('cat-collapse-btn', () => {
    renderedViewRows.forEach(row => collapsedPrimaries.add(row.primary));
    renderCategoryTable();
  });
  bind('cat-remove-unused-btn', event => startRemoveUnused(event.currentTarget));
  _initCategoryViewControls();
}

// ── Sort, search and filter ─────────────────────────────────

/** Sort by a header, keeping keyboard focus on it through the redraw. */
function _sortBy(column) {
  const next = nextCategorySort(categoryViewState, column);
  categoryViewState = { ...categoryViewState, ...next };
  renderCategoryTable();
  const button = document.querySelector(`#category-table .cat-sort-btn[data-sort="${column}"]`);
  if (button) button.focus({ preventScroll: true });
}

function _setCategorySearch(text) {
  categoryViewState = { ...categoryViewState, searchText: text };
  const clear = document.getElementById('cat-search-clear');
  if (clear) clear.hidden = text === '';
  renderCategoryTable();
}

/** Fill the filter list and wire the search box, its clear button and the filter. */
function _initCategoryViewControls() {
  const input = document.getElementById('cat-search-input');
  const clear = document.getElementById('cat-search-clear');
  const select = document.getElementById('cat-filter-select');

  if (select) {
    select.innerHTML = categoryFilterOptions()
      .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
    select.value = categoryViewState.filter;
    select.addEventListener('change', () => {
      categoryViewState = { ...categoryViewState, filter: select.value };
      renderCategoryTable();
    });
  }
  if (input) {
    input.value = categoryViewState.searchText;
    input.addEventListener('input', () => _setCategorySearch(input.value));
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || input.value === '') return;
      event.preventDefault();
      input.value = '';
      _setCategorySearch('');
    });
  }
  if (clear) {
    clear.hidden = categoryViewState.searchText === '';
    clear.addEventListener('click', () => {
      if (input) {
        input.value = '';
        input.focus();
      }
      _setCategorySearch('');
    });
  }
}
