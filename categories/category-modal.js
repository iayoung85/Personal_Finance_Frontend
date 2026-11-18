// ============================================================
// categories/category-modal.js — Dialogs for the Categories table
// One edit-and-create modal for a category and for a primary, and
// the Delete, Merge and Remove unused confirms. A refusal from the
// API shows inside the dialog and leaves it open.
// ============================================================

let _categoryDialog = null;

const HIDE_HELP_TEXT = 'A hidden category leaves the category pickers on every other page. '
  + 'It stays on its transactions, bills, rules and reports, and this page still lists it.';

// ── Dialog shell ────────────────────────────────────────────

/**
 * Open a dialog, replacing any open one.
 * @param {{title: string, subtitle?: string, bodyHtml: string, footerLeftHtml?: string,
 *   actions: Array<{label: string, kind?: string, onClick: function(): void, isDefault?: boolean}>,
 *   size?: string}} options kind is 'primary', 'danger' or 'secondary'.
 * @returns {HTMLElement} The dialog element.
 */
function _openCategoryDialog({ title, subtitle, bodyHtml, footerLeftHtml, actions, size }) {
  closeCategoryDialog();
  closeCategoryMenu(false);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay cat-dialog-overlay';
  overlay.innerHTML = `
    <div class="cat-dialog${size === 'wide' ? ' is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="cat-dialog-title">
      <header class="cat-dialog-header">
        <h3 id="cat-dialog-title">${escapeHtml(title)}</h3>
        ${subtitle ? `<p class="cat-dialog-subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </header>
      <div class="cat-dialog-body">
        <div class="cat-dialog-message" role="alert" hidden></div>
        ${bodyHtml}
      </div>
      <footer class="cat-dialog-footer">
        <div class="cat-dialog-footer-left">${footerLeftHtml || ''}</div>
        <div class="cat-dialog-footer-right"></div>
      </footer>
    </div>`;

  const dialog = overlay.querySelector('.cat-dialog');
  const right = overlay.querySelector('.cat-dialog-footer-right');
  actions.forEach(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.className = `cat-button cat-button-${action.kind || 'secondary'}`;
    if (action.isDefault) button.dataset.default = 'true';
    button.addEventListener('click', action.onClick);
    right.appendChild(button);
  });

  const state = { overlay, dialog, busy: false, returnFocusTo: document.activeElement };
  _categoryDialog = state;

  overlay.addEventListener('click', event => {
    if (event.target === overlay && !state.busy) closeCategoryDialog();
  });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !state.busy) {
      event.preventDefault();
      closeCategoryDialog();
      return;
    }
    if (event.key === 'Tab') _trapDialogFocus(event, dialog);
  });

  document.body.appendChild(overlay);
  document.body.classList.add('cat-dialog-open');
  return dialog;
}

function _trapDialogFocus(event, dialog) {
  const focusable = Array.from(dialog.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
  )).filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function closeCategoryDialog() {
  const state = _categoryDialog;
  if (!state) return;
  _categoryDialog = null;
  state.overlay.remove();
  document.body.classList.remove('cat-dialog-open');
  const target = state.returnFocusTo;
  if (target && document.contains(target) && typeof target.focus === 'function') {
    target.focus({ preventScroll: true });
  }
}

/**
 * Show a sentence at the top of the open dialog.
 * @param {string} text '' hides it.
 * @param {'error'|'warning'} [tone]
 */
function _setDialogMessage(text, tone = 'error') {
  if (!_categoryDialog) return;
  const box = _categoryDialog.dialog.querySelector('.cat-dialog-message');
  box.textContent = text || '';
  box.hidden = !text;
  box.classList.toggle('is-warning', tone === 'warning');
  if (text) box.scrollIntoView({ block: 'nearest' });
}

/** Lock the dialog's buttons while a request runs. */
function _setDialogBusy(busy, busyLabel) {
  if (!_categoryDialog) return;
  _categoryDialog.busy = busy;
  _categoryDialog.dialog.querySelectorAll('.cat-dialog-footer button').forEach(button => {
    button.disabled = busy;
    if (button.dataset.default === 'true') {
      if (busy) {
        button.dataset.idleLabel = button.textContent;
        button.textContent = busyLabel || 'Saving…';
      } else if (button.dataset.idleLabel) {
        button.textContent = button.dataset.idleLabel;
      }
    }
  });
}

function _apiErrorText(result, fallback) {
  return (result && result.data && result.data.error) || fallback;
}

// ── Edit and create ─────────────────────────────────────────

function _kindOptionsHtml(selected) {
  return PRIMARY_KIND_OPTIONS
    .map(option => `<option value="${option.value}" ${option.value === selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');
}

function _primaryDatalistHtml(tree) {
  return tree.map(group => `<option value="${escapeHtml(group.primary)}"></option>`).join('');
}

function _formRow(labelHtml, controlHtml, extraClass) {
  return `<div class="cat-form-row${extraClass ? ` ${extraClass}` : ''}">
      <div class="cat-form-label">${labelHtml}</div>
      <div class="cat-form-control">${controlHtml}</div>
    </div>`;
}

/** The read-only section listing the Plaid categories that point at a category. */
function _plaidSectionHtml(entry) {
  const view = plaidMappingView(entry.plaid_categories, entry.is_plaid_default);
  const link = '<a href="#mappings" class="cat-plaid-link" data-open-mappings>Open Mappings</a>';
  const defaultLine = view.defaultSentence
    ? `<p class="cat-plaid-default">${escapeHtml(view.defaultSentence)}</p>`
    : '';
  if (view.count === 0) {
    return `<div class="cat-plaid-head"><span class="cat-plaid-heading is-empty">${escapeHtml(view.heading)}</span>${link}</div>${defaultLine}`;
  }

  let listHtml;
  if (!view.collapsed) {
    listHtml = `<ul class="cat-plaid-list">${view.names.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul>`;
  } else {
    const groups = view.groups.map(group => `
      <div class="cat-plaid-group">
        <div class="cat-plaid-group-name">${escapeHtml(group.plaidPrimary)} <span class="cat-plaid-group-count">${group.names.length}</span></div>
        <ul class="cat-plaid-list">${group.names.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul>
      </div>`).join('');
    listHtml = `<button type="button" class="cat-plaid-toggle" aria-expanded="false" aria-controls="cat-plaid-groups">Show all ${view.count}</button>`
      + `<div class="cat-plaid-groups" id="cat-plaid-groups" hidden>${groups}</div>`;
  }
  return `<div class="cat-plaid-head"><span class="cat-plaid-heading">${escapeHtml(view.heading)}</span>${link}</div>`
    + `${defaultLine}${listHtml}`;
}

function _wirePlaidSection(dialog) {
  const toggle = dialog.querySelector('.cat-plaid-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const groups = dialog.querySelector('#cat-plaid-groups');
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      groups.hidden = !open;
      toggle.textContent = open ? 'Show fewer' : `Show all ${groups.querySelectorAll('li').length}`;
    });
  }
  const link = dialog.querySelector('[data-open-mappings]');
  if (link) {
    link.addEventListener('click', event => {
      event.preventDefault();
      closeCategoryDialog();
      _switchPanel('mappings', 'categories');
      window.scrollTo(0, 0);
    });
  }
}

/**
 * Open the modal to edit a category, edit a primary, or create a category.
 * @param {{mode: 'edit'|'edit-primary'|'create', label?: string, primary?: string,
 *   parent?: string, name?: string, kindSourcePrimary?: string,
 *   draft?: Object, message?: string, handBackOnSave?: boolean}} options
 *   draft restores typed values after a save that stopped part-way; message
 *   is shown at the top. handBackOnSave returns the category to a waiting
 *   transaction once saved, as a create does.
 */
function openCategoryEditor(options) {
  if (options.mode === 'edit-primary') {
    _openPrimaryEditor(options);
    return;
  }
  _openCategoryForm(options);
}

function _openCategoryForm(options) {
  const tree = currentCategoryTree();
  const isCreate = options.mode === 'create';
  const draft = options.draft || null;

  let original;
  let entry = null;
  if (isCreate) {
    original = { label: '', primary: '', detailed: '', description: '', hidden: false };
  } else {
    entry = findCategoryEntry(options.label);
    if (!entry) {
      showStatus('That category is no longer in your list.', 'warning');
      return;
    }
    original = {
      label: entry.label,
      primary: entry.primary || parseCategoryName(entry.label).primary || '',
      detailed: entry.detailed || '',
      description: entry.description || '',
      hidden: entry.hidden === true
    };
  }

  const sourcePrimary = isCreate ? (options.kindSourcePrimary || '') : original.primary;
  const sourceGroup = sourcePrimary ? findPrimaryGroup(sourcePrimary, tree) : null;
  const formState = {
    kind: (draft && draft.kind) || defaultKindForNewPrimary(sourceGroup ? sourceGroup.kindEntry : undefined)
  };

  const values = {
    name: draft ? draft.name : (isCreate ? (options.name || '') : original.detailed),
    parent: draft ? draft.parent : (isCreate ? (options.parent || '') : original.primary),
    description: draft ? draft.description : original.description,
    hidden: draft ? draft.hidden : original.hidden
  };

  const bodyHtml = `
    <div class="cat-form-section-title">General</div>
    <div class="cat-form-panel">
      ${_formRow('<label for="cat-edit-name">Name</label>',
        `<input id="cat-edit-name" class="modal-input" type="text" autocomplete="off" value="${escapeHtml(values.name)}" placeholder="e.g. Groceries">`)}
      ${_formRow('<label for="cat-edit-parent">Subcategory of</label>',
        `<input id="cat-edit-parent" class="modal-input" type="text" list="cat-edit-primaries" autocomplete="off" value="${escapeHtml(values.parent)}" placeholder="A primary, or a new name">`
        + `<datalist id="cat-edit-primaries">${_primaryDatalistHtml(tree)}</datalist>`
        + '<div class="cat-form-hint" id="cat-edit-parent-hint"></div>')}
      ${_formRow('<span id="cat-edit-kind-label">Kind</span>', '<div id="cat-edit-kind" class="cat-kind-slot"></div>')}
      ${_formRow('<label for="cat-edit-description">Description</label>',
        `<textarea id="cat-edit-description" class="modal-input" rows="3" maxlength="500" placeholder="Optional. Shows when you point at the name in the table.">${escapeHtml(values.description)}</textarea>`,
        'is-top')}
    </div>
    ${entry ? `<div class="cat-form-section-title">Plaid</div><div class="cat-form-panel cat-plaid-panel">${_plaidSectionHtml(entry)}</div>` : ''}`;

  const footerLeftHtml = `
    <label class="cat-hide-toggle"><input type="checkbox" id="cat-edit-hidden" ${values.hidden ? 'checked' : ''}> Hide in lists</label>
    <span class="cat-help-dot" tabindex="0" role="img" aria-label="${escapeHtml(HIDE_HELP_TEXT)}" title="${escapeHtml(HIDE_HELP_TEXT)}">i</span>`;

  const context = { isCreate, original, entry, tree, formState, handBackOnSave: Boolean(options.handBackOnSave) };
  const dialog = _openCategoryDialog({
    title: isCreate ? 'New Category' : 'Edit Category',
    subtitle: isCreate ? '' : original.label,
    bodyHtml,
    footerLeftHtml,
    actions: [
      { label: 'Cancel', kind: 'secondary', onClick: () => closeCategoryDialog() },
      { label: isCreate ? 'Add' : 'Save', kind: 'primary', isDefault: true, onClick: () => _saveCategoryForm(context) }
    ]
  });

  const parentInput = dialog.querySelector('#cat-edit-parent');
  const refreshKind = () => _renderKindSlot(dialog, context);
  parentInput.addEventListener('input', refreshKind);
  parentInput.addEventListener('change', refreshKind);
  refreshKind();
  _wirePlaidSection(dialog);
  _wireEnterToSave(dialog, () => _saveCategoryForm(context));

  if (options.message) _setDialogMessage(options.message, 'warning');
  const nameInput = dialog.querySelector('#cat-edit-name');
  nameInput.focus();
  if (!isCreate) nameInput.select();
}

/** Enter in a one-line field saves, as the default button would. */
function _wireEnterToSave(dialog, save) {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing) return;
    const target = event.target;
    if (target.tagName !== 'INPUT' || target.type === 'checkbox') return;
    // Enter there may be picking a suggestion from the primaries list.
    if (target.hasAttribute('list')) return;
    event.preventDefault();
    save();
  });
}

/** The Kind row: text for a listed primary, a picker for one new to the list. */
function _renderKindSlot(dialog, context) {
  const slot = dialog.querySelector('#cat-edit-kind');
  const hint = dialog.querySelector('#cat-edit-parent-hint');
  const parent = dialog.querySelector('#cat-edit-parent').value.trim();

  if (!parent) {
    slot.innerHTML = '<span class="cat-kind-text is-muted">Set on the primary</span>';
    hint.textContent = '';
    return;
  }
  const group = findPrimaryGroup(parent, context.tree);
  if (group) {
    const kindText = group.kindView.mode === 'none' ? 'Not set' : group.kindView.label;
    slot.innerHTML = `<span class="cat-kind-text">${escapeHtml(kindText)}, set on ${escapeHtml(group.primary)}</span>`;
    hint.textContent = group.primary !== parent ? `Goes under ${group.primary}.` : '';
    return;
  }
  slot.innerHTML = `<select id="cat-edit-kind-select" class="modal-input" aria-labelledby="cat-edit-kind-label">${_kindOptionsHtml(context.formState.kind)}</select>`;
  hint.innerHTML = `<span class="cat-new-badge">New primary</span> Choose how ${escapeHtml(parent)} counts.`;
  slot.querySelector('select').addEventListener('change', event => {
    context.formState.kind = event.target.value;
  });
}

function _readCategoryForm(dialog, context) {
  const typedParent = dialog.querySelector('#cat-edit-parent').value.trim();
  // A listed primary typed in another case goes under the list's spelling,
  // so one primary never splits into two.
  const listedGroup = findPrimaryGroup(typedParent, context.tree);
  const parent = listedGroup ? listedGroup.primary : typedParent;
  return {
    name: dialog.querySelector('#cat-edit-name').value.trim(),
    parent,
    parentIsNew: isNewPrimaryName(parent, context.tree),
    kind: context.formState.kind,
    description: dialog.querySelector('#cat-edit-description').value,
    hidden: dialog.querySelector('#cat-edit-hidden').checked
  };
}

/** Checks the page can make before asking the API; the API decides the rest. */
function _categoryFormProblem(form) {
  if (!form.name) return 'Enter a name.';
  if (!form.parent) return 'Enter the primary category this goes under.';
  if (form.name.includes(':') || form.parent.includes(':')) {
    return 'Names cannot contain ":". Put the primary in Subcategory of.';
  }
  return '';
}

/** The functions a save's steps call, from api.js. */
function _categorySaveApi() {
  return {
    editLabel: editCategoryLabel,
    renamePrimary: renameCategoryPrimary,
    createLabel: createCategoryLabel,
    setDescription: setCategoryDescription,
    setHidden: setCategoriesHidden
  };
}

async function _saveCategoryForm(context) {
  if (!_categoryDialog || _categoryDialog.busy) return;
  const dialog = _categoryDialog.dialog;
  const form = _readCategoryForm(dialog, context);
  const problem = _categoryFormProblem(form);
  if (problem) {
    _setDialogMessage(problem);
    return;
  }

  const steps = context.isCreate
    ? planCategoryCreateSteps(form)
    : planCategoryEditSteps(context.original, form);
  if (!steps.length) {
    closeCategoryDialog();
    return;
  }

  _setDialogMessage('');
  _setDialogBusy(true, context.isCreate ? 'Adding…' : 'Saving…');
  const outcome = await runCategorySaveSteps(steps, { label: context.original.label || undefined }, _categorySaveApi());

  if (outcome.ok) {
    closeCategoryDialog();
    const message = context.isCreate ? `Added ${outcome.label}.` : `Saved ${outcome.label}.`;
    await refreshAfterCategoryChange(message, { selectLabels: [outcome.label] });
    if (context.isCreate || context.handBackOnSave) _handlePendingTxnAfterCategoryCreate([outcome.label]);
    return;
  }

  if (!outcome.done.length) {
    _setDialogBusy(false);
    _setDialogMessage(outcome.error);
    return;
  }

  // Part of the save landed. Reload, then reopen on the label as it now is,
  // with what was typed, so a second Save sends only what is still owed.
  closeCategoryDialog();
  await refreshAfterCategoryChange('', { selectLabels: [outcome.label] });
  openCategoryEditor({
    mode: 'edit',
    label: outcome.label,
    draft: form,
    message: describePartialSave(outcome),
    handBackOnSave: context.isCreate || context.handBackOnSave
  });
}

// ── Editing a primary ───────────────────────────────────────

function _primaryKindRowHtml(group, draftKind) {
  const view = group.kindView;
  if (view.mode === 'picker') {
    const byName = view.isSet
      ? ''
      : `<option value="" ${draftKind ? '' : 'selected'} disabled>${escapeHtml(view.label)}</option>`;
    const selected = draftKind || (view.isSet ? view.kind : '');
    return `<select id="cat-edit-kind-select" class="modal-input" aria-labelledby="cat-edit-kind-label">${byName}${_kindOptionsHtml(selected)}</select>`;
  }
  if (view.mode === 'pinned') {
    const notes = view.explanations.map(text => `<p>${_renderNoteText(text)}</p>`).join('');
    return `<span class="cat-kind-text">${escapeHtml(view.label)}</span><div class="cat-kind-note">${notes}</div>`;
  }
  if (view.mode === 'legacy') return `<span class="cat-kind-text">${escapeHtml(view.label)}</span>`;
  return '<span class="cat-kind-text is-muted">Not set</span>';
}

function _openPrimaryEditor(options) {
  const group = findCategoryGroup(options.primary);
  if (!group) {
    showStatus('That primary category is no longer in your list.', 'warning');
    return;
  }
  const draft = options.draft || null;
  const childCount = group.children.length;
  const childText = childCount === 1 ? 'its category' : `its ${childCount} categories`;
  const name = draft ? draft.name : group.primary;

  const bodyHtml = `
    <div class="cat-form-section-title">General</div>
    <div class="cat-form-panel">
      ${_formRow('<label for="cat-edit-name">Name</label>',
        `<input id="cat-edit-name" class="modal-input" type="text" autocomplete="off" value="${escapeHtml(name)}">`
        + `<div class="cat-form-hint">Renaming moves ${childText}, with their transactions, rules, bills and Plaid categories.</div>`)}
      ${_formRow('<span id="cat-edit-kind-label">Kind</span>', _primaryKindRowHtml(group, draft && draft.kind), 'is-top')}
    </div>`;

  const hideLabel = childCount === 1 ? 'Hide in lists' : `Hide all ${childCount} in lists`;
  const footerLeftHtml = `
    <label class="cat-hide-toggle"><input type="checkbox" id="cat-edit-hidden" ${group.hiddenState === 'all' ? 'checked' : ''}> ${escapeHtml(hideLabel)}</label>
    <span class="cat-help-dot" tabindex="0" role="img" aria-label="${escapeHtml(HIDE_HELP_TEXT)}" title="${escapeHtml(HIDE_HELP_TEXT)}">i</span>`;

  const context = {
    original: {
      primary: group.primary,
      kind: group.kindView.mode === 'picker' && group.kindView.isSet ? group.kindView.kind : null,
      hiddenState: group.hiddenState,
      labels: group.children.map(entry => entry.label)
    },
    hiddenTouched: false
  };

  const dialog = _openCategoryDialog({
    title: 'Edit Primary Category',
    subtitle: group.primary,
    bodyHtml,
    footerLeftHtml,
    actions: [
      { label: 'Cancel', kind: 'secondary', onClick: () => closeCategoryDialog() },
      { label: 'Save', kind: 'primary', isDefault: true, onClick: () => _savePrimaryForm(context) }
    ]
  });

  const hiddenBox = dialog.querySelector('#cat-edit-hidden');
  hiddenBox.indeterminate = group.hiddenState === 'some';
  hiddenBox.addEventListener('change', () => { context.hiddenTouched = true; });
  _wireEnterToSave(dialog, () => _savePrimaryForm(context));
  if (options.message) _setDialogMessage(options.message, 'warning');
  const nameInput = dialog.querySelector('#cat-edit-name');
  nameInput.focus();
  nameInput.select();
}

async function _savePrimaryForm(context) {
  if (!_categoryDialog || _categoryDialog.busy) return;
  const dialog = _categoryDialog.dialog;
  const kindSelect = dialog.querySelector('#cat-edit-kind-select');
  const form = {
    name: dialog.querySelector('#cat-edit-name').value.trim(),
    kind: kindSelect && kindSelect.value ? kindSelect.value : null,
    hidden: context.hiddenTouched ? dialog.querySelector('#cat-edit-hidden').checked : null
  };
  if (!form.name) {
    _setDialogMessage('Enter a name.');
    return;
  }
  if (form.name.includes(':')) {
    _setDialogMessage('A primary name cannot contain ":".');
    return;
  }

  const steps = planPrimaryEditSteps(context.original, form);
  if (!steps.length) {
    closeCategoryDialog();
    return;
  }

  _setDialogMessage('');
  _setDialogBusy(true);
  const outcome = await runCategorySaveSteps(
    steps,
    { primary: context.original.primary, labels: context.original.labels },
    _categorySaveApi()
  );

  if (outcome.ok) {
    closeCategoryDialog();
    await refreshAfterCategoryChange(`Saved ${outcome.primary}.`, { selectPrimary: outcome.primary });
    return;
  }
  if (!outcome.done.length) {
    _setDialogBusy(false);
    _setDialogMessage(outcome.error);
    return;
  }
  closeCategoryDialog();
  await refreshAfterCategoryChange('', { selectPrimary: outcome.primary });
  openCategoryEditor({
    mode: 'edit-primary',
    primary: outcome.primary,
    draft: { name: outcome.primary, kind: form.kind },
    message: describePartialSave(outcome)
  });
}

// ── Delete ──────────────────────────────────────────────────

/**
 * Confirm and delete a category, or a primary with every category under it.
 * @param {Object} context From the table's menu: {kind: 'detailed', entry} or {kind: 'primary', group}.
 */
function confirmDeleteCategories(context) {
  const labels = context.kind === 'primary'
    ? context.group.children.map(entry => entry.label)
    : [context.entry.label];
  const subject = context.kind === 'primary' ? context.group.primary : context.entry.label;

  let bodyHtml = `<p class="cat-confirm-lead">Delete <strong>${escapeHtml(subject)}</strong>? Nothing uses it, so no transaction, rule, bill or alert changes.</p>`;
  if (context.kind === 'primary' && labels.length > 1) {
    bodyHtml = `<p class="cat-confirm-lead">Delete <strong>${escapeHtml(subject)}</strong> and the ${labels.length} categories under it? Nothing uses them, so no transaction, rule, bill or alert changes.</p>`
      + `<ul class="cat-confirm-list">${labels.map(label => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`;
  }

  _openCategoryDialog({
    title: labels.length > 1 ? 'Delete Categories' : 'Delete Category',
    bodyHtml,
    actions: [
      { label: 'Cancel', kind: 'secondary', onClick: () => closeCategoryDialog() },
      { label: 'Delete', kind: 'danger', isDefault: true, onClick: () => _runDelete(labels) }
    ]
  });
}

async function _runDelete(labels) {
  if (!_categoryDialog || _categoryDialog.busy) return;
  _setDialogMessage('');
  _setDialogBusy(true, 'Deleting…');
  const deleted = [];
  for (const label of labels) {
    let result;
    try {
      result = await deleteCategoryLabel(label);
    } catch (networkError) {
      result = { ok: false, data: { error: `Could not reach the server: ${networkError.message}` } };
    }
    if (!result.ok) {
      const error = _apiErrorText(result, 'The server did not delete it.');
      if (!deleted.length) {
        _setDialogBusy(false);
        _setDialogMessage(labels.length > 1 ? `${label}: ${error}` : error);
        return;
      }
      closeCategoryDialog();
      await refreshAfterCategoryChange('');
      showStatus(`Deleted ${deleted.length} of ${labels.length}. ${label} was not deleted: ${error}`, 'warning');
      return;
    }
    deleted.push(label);
  }
  closeCategoryDialog();
  categorySelection = { labels: [], anchor: null };
  const message = deleted.length === 1 ? `Deleted ${deleted[0]}.` : `Deleted ${deleted.length} categories.`;
  await refreshAfterCategoryChange(message);
}

// ── Merge ───────────────────────────────────────────────────

/**
 * Confirm a merge of the selected categories into the right-clicked one.
 * @param {Array<Object>} selectedEntries
 * @param {string} targetLabel
 */
function openMergeConfirm(selectedEntries, targetLabel) {
  const summary = mergeSummary(selectedEntries, targetLabel);
  if (!summary.sources.length) return;

  const rows = summary.rows.map(row => `
    <tr class="${row.isTarget ? 'is-target' : ''}">
      <td>${escapeHtml(row.label)}${row.isTarget ? ' <span class="cat-tag cat-tag-keep">Stays</span>' : ''}</td>
      <td class="cat-num">${row.uses.toLocaleString()}</td>
    </tr>`).join('');

  const bodyHtml = `
    <p class="cat-confirm-lead">Everything on these categories lands on <strong>${escapeHtml(summary.target)}</strong>:
      transactions, rules, overrides, bills, alerts and the Plaid categories that point at them.
      The others leave your list. This can't be undone.</p>
    <table class="cat-merge-table">
      <thead><tr><th>Category</th><th class="cat-num">Transactions</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total on ${escapeHtml(summary.target)} afterwards</td><td class="cat-num">${summary.total.toLocaleString()}</td></tr></tfoot>
    </table>`;

  _openCategoryDialog({
    title: `Merge ${summary.rows.length} Categories`,
    subtitle: `Into ${summary.target}`,
    bodyHtml,
    actions: [
      { label: 'Cancel', kind: 'secondary', onClick: () => closeCategoryDialog() },
      { label: 'Merge', kind: 'primary', isDefault: true, onClick: () => _runMerge(summary) }
    ]
  });
}

async function _runMerge(summary) {
  if (!_categoryDialog || _categoryDialog.busy) return;
  _setDialogMessage('');
  _setDialogBusy(true, 'Merging…');
  let result;
  try {
    result = await mergeCategoryLabels(summary.sources, summary.target);
  } catch (networkError) {
    result = { ok: false, data: { error: `Could not reach the server: ${networkError.message}` } };
  }
  if (!result.ok) {
    _setDialogBusy(false);
    _setDialogMessage(_apiErrorText(result, 'The server did not merge them.'));
    return;
  }
  closeCategoryDialog();
  const target = (result.data && result.data.target) || summary.target;
  const count = summary.sources.length;
  await refreshAfterCategoryChange(
    `Merged ${count === 1 ? summary.sources[0] : `${count} categories`} into ${target}.`,
    { selectLabels: [target] }
  );
}

// ── Remove unused ───────────────────────────────────────────

function _keptListHtml(items) {
  return `<ul class="cat-confirm-list cat-kept-list">${items.map(item => `
    <li><span class="cat-kept-label">${escapeHtml(item.label)}</span>
      <span class="cat-kept-reason">${escapeHtml(item.delete_reason || '')}</span></li>`).join('')}</ul>`;
}

/**
 * Ask the API what Remove unused would delete, then confirm.
 * @param {HTMLButtonElement} button The toolbar button, disabled while it asks.
 */
async function startRemoveUnused(button) {
  if (button) button.disabled = true;
  let result;
  try {
    result = await removeUnusedCategories(true);
  } catch (networkError) {
    result = { ok: false, data: { error: `Could not reach the server: ${networkError.message}` } };
  } finally {
    if (button) button.disabled = false;
  }
  if (!result.ok) {
    showStatus(_apiErrorText(result, 'Could not check for unused categories.'), 'error');
    return;
  }

  const summary = removeUnusedSummary(result.data);
  let bodyHtml = `<p class="cat-confirm-lead">${escapeHtml(summary.headline)}</p>`;
  if (summary.deleted.length) {
    bodyHtml += `<div class="cat-confirm-scroll"><ul class="cat-confirm-list">${summary.deleted.map(label => `<li>${escapeHtml(label)}</li>`).join('')}</ul></div>`;
  }
  if (summary.keptForPlaid.length) {
    const count = summary.keptForPlaid.length;
    bodyHtml += `<h4 class="cat-confirm-heading">Kept: Plaid sends categories to ${count === 1 ? 'it' : `these ${count}`}</h4>`
      + `<p class="cat-confirm-note">Merge ${count === 1 ? 'it' : 'one'} into another category, or hide it.</p>`
      + _keptListHtml(summary.keptForPlaid);
  }
  if (summary.keptOther.length) {
    const count = summary.keptOther.length;
    bodyHtml += `<h4 class="cat-confirm-heading">Kept: something else holds ${count === 1 ? 'it' : `these ${count}`}</h4>`
      + _keptListHtml(summary.keptOther);
  }
  if (summary.keptInUse) {
    bodyHtml += `<p class="cat-confirm-note">${summary.keptInUse === 1 ? '1 category is' : `${summary.keptInUse} categories are`} in use and stay${summary.keptInUse === 1 ? 's' : ''}.</p>`;
  }

  const actions = summary.nothingToRemove
    ? [{ label: 'Close', kind: 'primary', isDefault: true, onClick: () => closeCategoryDialog() }]
    : [
      { label: 'Cancel', kind: 'secondary', onClick: () => closeCategoryDialog() },
      {
        label: `Delete ${summary.deleted.length === 1 ? '1 category' : `${summary.deleted.length} categories`}`,
        kind: 'danger',
        isDefault: true,
        onClick: () => _runRemoveUnused()
      }
    ];

  const dialog = _openCategoryDialog({
    title: 'Remove Unused Categories',
    bodyHtml,
    actions,
    size: 'wide'
  });
  const defaultButton = dialog.querySelector('[data-default="true"]');
  if (defaultButton && summary.nothingToRemove) defaultButton.focus();
  else {
    const cancel = dialog.querySelector('.cat-button-secondary');
    if (cancel) cancel.focus();
  }
}

async function _runRemoveUnused() {
  if (!_categoryDialog || _categoryDialog.busy) return;
  _setDialogMessage('');
  _setDialogBusy(true, 'Deleting…');
  let result;
  try {
    result = await removeUnusedCategories(false);
  } catch (networkError) {
    result = { ok: false, data: { error: `Could not reach the server: ${networkError.message}` } };
  }
  if (!result.ok) {
    _setDialogBusy(false);
    _setDialogMessage(_apiErrorText(result, 'The server did not remove them.'));
    return;
  }
  closeCategoryDialog();
  const deleted = (result.data && result.data.deleted) || [];
  const message = deleted.length === 1
    ? `Deleted ${deleted[0]}.`
    : `Deleted ${deleted.length} unused categories.`;
  await refreshAfterCategoryChange(message);
}
