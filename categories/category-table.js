// ============================================================
// categories/category-table.js — The Categories table
// Draws the tree from the GET's labels, keeps the selection and
// the folded primaries, and routes clicks, right-clicks and the
// Hidden boxes. The rules it applies live in category-tree.js.
// ============================================================

// The tree the table last drew, so handlers read the same rows the user sees.
let renderedCategoryTree = [];
// The row that keeps the table's one tab stop, as its data-row-key.
let categoryFocusRowKey = null;

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
  const countText = group.children.length === 1 ? '1 category' : `${group.children.length} categories`;
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
  const bareTag = entry.detailed ? '' : '<span class="cat-tag" title="This label has no detailed name. Edit it to give it one.">No detailed name</span>';
  const kindText = group.kindView.mode === 'none' ? '—' : group.kindView.label;
  return `
    <tr class="cat-row cat-row-detailed${entry.hidden ? ' is-hidden' : ''}${isSelected ? ' is-selected' : ''}${stripe ? ' is-alt' : ''}"
        data-row-key="${escapeHtml(key)}" data-label="${label}" data-primary="${escapeHtml(group.primary)}"
        aria-selected="${isSelected}" tabindex="-1">
      <td class="cat-cell-name"${nameTitle}>
        <span class="cat-name-text${descriptionClass}">${escapeHtml(rowName)}</span>${lockedTag}${bareTag}
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

function renderCategoryTable() {
  const container = document.getElementById('category-table');
  if (!container) return;

  const tree = buildCategoryTree(categoryLabels, primaryCategories);
  renderedCategoryTree = tree;
  _pruneCategoryTableState(tree);

  const countElement = document.getElementById('category-table-count');
  if (countElement) {
    const total = categoryLabels.length;
    const hiddenCount = categoryLabels.filter(entry => entry.hidden).length;
    const parts = [`${total} ${total === 1 ? 'category' : 'categories'} under ${tree.length} ${tree.length === 1 ? 'primary' : 'primaries'}`];
    if (hiddenCount) parts.push(`${hiddenCount} hidden`);
    countElement.textContent = total ? parts.join(' · ') : '';
  }

  if (!tree.length) {
    const message = categoryLabelsMissing
      ? 'The server sent no category table. Restart the API server and reload this page.'
      : 'No categories in your list yet. Use + New to add one.';
    container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    return;
  }

  const hadFocus = container.contains(document.activeElement);
  const rows = [];
  let stripe = false;
  tree.forEach(group => {
    const isCollapsed = collapsedPrimaries.has(group.primary);
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
          <th scope="col" class="cat-head-name">Name</th>
          <th scope="col" class="cat-head-kind">Kind</th>
          <th scope="col" class="cat-head-uses" title="Transactions on each category, as the transactions list shows them">Uses</th>
          <th scope="col" class="cat-head-hidden" title="Hidden categories leave the category pickers on every other page">Hidden</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;

  container.querySelectorAll('.cat-hidden-box[data-indeterminate="true"]').forEach(box => {
    box.indeterminate = true;
  });
  _applyRovingTabStop(container, hadFocus);
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
    const ordered = visibleCategoryLabels(renderedCategoryTree, collapsedPrimaries);
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

/**
 * Hide or unhide labels, then reload.
 * @param {string[]} labels
 * @param {boolean} hidden
 */
async function applyCategoriesHidden(labels, hidden) {
  if (!labels.length) return;
  try {
    const result = await setCategoriesHidden({ labels, hidden });
    if (!result.ok) {
      showStatus((result.data && result.data.error) || 'Could not change Hidden.', 'error');
      renderCategoryTable();
      return;
    }
    const subject = labels.length === 1 ? labels[0] : `${labels.length} categories`;
    const message = hidden
      ? `Hid ${subject}. It stays on its transactions and leaves the pickers on other pages.`
      : `${subject} ${labels.length === 1 ? 'is' : 'are'} back in the pickers.`;
    await refreshAfterCategoryChange(message);
  } catch (networkError) {
    showStatus(`Could not change Hidden: ${networkError.message}`, 'error');
    renderCategoryTable();
  }
}

function _onHiddenBoxChange(box) {
  const hidden = box.checked;
  box.disabled = true;
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
 * @param {{selectLabels?: string[]}} [options]
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
  await loadCategorizationData(true);
  window.scrollTo(scrollX, scrollY);
  if (message) {
    // After the reload, which posts its own rule-check status.
    showStatus(message, 'success');
    setTimeout(() => clearStatus(), 3500);
  }
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
    if (shouldCollapse !== collapsedPrimaries.has(primary)) {
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
  bind('cat-expand-btn', () => {
    collapsedPrimaries.clear();
    renderCategoryTable();
  });
  bind('cat-collapse-btn', () => {
    renderedCategoryTree.forEach(group => collapsedPrimaries.add(group.primary));
    // Folded rows cannot stay selected out of sight.
    categorySelection = { labels: [], anchor: null };
    renderCategoryTable();
  });
  bind('cat-remove-unused-btn', event => startRemoveUnused(event.currentTarget));
}
