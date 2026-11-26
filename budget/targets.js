// ============================================================
// budget/targets.js — the Targets panel: the editor's DOM.
//
// The rules (rows, payload, refusal placement, Set alert) are in
// budget/targets-form.js. This file draws them and keeps each year's
// typed fields in budgetDrafts until Save sends the year.
// ============================================================

let _budgetTargetsWired = false;

/**
 * Load the editor's data the first time the panel opens.
 *
 * @param {boolean} [force=false] - reload even when loaded; the fields
 *   are rebuilt from what the API sends
 */
async function loadBudgetTargets(force = false) {
  _wireBudgetTargets();
  if (budgetTargetsLoading) return;
  if (budgetTargetsData && !force) return;

  const body = document.getElementById('bt-form-body');
  budgetTargetsLoading = true;
  if (!budgetTargetsData) body.innerHTML = '<div class="bt-loading">Loading your targets…</div>';
  try {
    budgetTargetsData = await fetchBudgetTargets();
    budgetPaceSettings = budgetTargetsData.pace_settings || {};
    budgetPaceDefaults = budgetTargetsData.pace_defaults || {};
    budgetDrafts = {};
    budgetRefusals = {};
    for (const year of budgetTargetsData.years || []) {
      budgetDrafts[year.fiscal_year] = draftFromYearTargets(year.targets);
    }
    const editable = budgetTargetsData.editable_fiscal_years || [];
    if (!editable.includes(budgetEditingYear)) budgetEditingYear = editable[0];
    renderBudgetTargets();
  } catch (loadError) {
    body.innerHTML = '<div class="bt-error" role="alert">'
      + `<p>Couldn't load your targets: ${escapeBudgetHtml(loadError.message || 'unknown error')}</p>`
      + '<button type="button" class="secondary" data-budget-action="retry-targets">Try again</button>'
      + '</div>';
  } finally {
    budgetTargetsLoading = false;
  }
}

function _budgetYearEntry(fiscalYear) {
  if (!budgetTargetsData) return null;
  return (budgetTargetsData.years || []).find(year => year.fiscal_year === fiscalYear) || null;
}

function _budgetPreviousYear() {
  const editable = (budgetTargetsData && budgetTargetsData.editable_fiscal_years) || [];
  return editable[1];
}

function _budgetSavedDraft(fiscalYear) {
  const entry = _budgetYearEntry(fiscalYear);
  return draftFromYearTargets(entry ? entry.targets : []);
}

function _budgetYearChanged(fiscalYear) {
  return isTargetsDraftChanged(budgetDrafts[fiscalYear] || {}, _budgetSavedDraft(fiscalYear));
}

/** True when any year holds typed changes not yet saved. */
function budgetTargetsHaveUnsavedChanges() {
  if (!budgetTargetsData) return false;
  return (budgetTargetsData.editable_fiscal_years || []).some(_budgetYearChanged);
}

function _budgetFormSections() {
  return buildTargetsFormSections((budgetTargetsData && budgetTargetsData.categories) || []);
}

// ── Drawing ─────────────────────────────────────────────────

/** Redraw the whole editor for the year being edited. */
function renderBudgetTargets() {
  if (!budgetTargetsData) return;
  _renderBudgetYearSwitch();
  _renderBudgetCadenceSwitch();
  _renderBudgetFormBody();
  _renderBudgetFormBanner();
  _applyBudgetTargetsFilter();
  _updateBudgetSaveBar();
}

function _renderBudgetYearSwitch() {
  const switchEl = document.getElementById('bt-year-switch');
  const editable = budgetTargetsData.editable_fiscal_years || [];
  const words = ['this year', 'last year'];
  switchEl.innerHTML = editable.map((fiscalYear, position) => {
    const entry = _budgetYearEntry(fiscalYear);
    const label = entry ? entry.label : `FY${fiscalYear}`;
    const isActive = fiscalYear === budgetEditingYear;
    const unsaved = _budgetYearChanged(fiscalYear)
      ? '<span class="bt-unsaved-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>'
      : '';
    return `<button type="button" role="tab" class="bt-year-tab${isActive ? ' active' : ''}" `
      + `aria-selected="${isActive}" data-year="${fiscalYear}">`
      + `<span class="bt-year-tab-label">${escapeBudgetHtml(label)}</span>`
      + `<span class="bt-year-tab-note">${words[position] || ''}</span>${unsaved}</button>`;
  }).join('');

  const entry = _budgetYearEntry(budgetEditingYear);
  document.getElementById('bt-year-dates').textContent = entry
    ? `${formatBudgetDate(entry.start)} – ${formatBudgetDate(entry.end)}`
    : '';

  const copyButton = document.getElementById('bt-copy-btn');
  const previousYear = _budgetPreviousYear();
  const previousEntry = _budgetYearEntry(previousYear);
  const previousLabel = previousEntry ? previousEntry.label : `FY${previousYear}`;
  copyButton.textContent = `Copy from ${previousLabel}`;
  const isEditingPrevious = budgetEditingYear === previousYear;
  const hasNothingToCopy = !previousEntry || (previousEntry.targets || []).length === 0;
  copyButton.disabled = isEditingPrevious || hasNothingToCopy;
  if (isEditingPrevious) {
    copyButton.title = `You are editing ${previousLabel}. Switch to this year to copy from it.`;
  } else if (hasNothingToCopy) {
    copyButton.title = `${previousLabel} has no targets to copy.`;
  } else {
    copyButton.title = `Fill this form with ${previousLabel}'s targets. Nothing is saved until you press Save.`;
  }
}

// The clear buttons follow the form, not the saved year, so a typed
// amount can be cleared and a just-cleared scope disables its button.
// Drawn from the save bar's refresh because every edit passes through it.
function _renderBudgetClearButtons() {
  const entry = _budgetYearEntry(budgetEditingYear);
  const yearLabel = entry ? entry.label : `FY${budgetEditingYear}`;
  const draft = budgetDrafts[budgetEditingYear] || {};
  for (const button of document.querySelectorAll('[data-clear-scope]')) {
    const state = clearTargetsButtonState(draft, button.dataset.clearScope, yearLabel);
    button.textContent = state.label;
    button.disabled = state.disabled;
    button.title = state.title;
  }
}

function _renderBudgetFormBody() {
  const body = document.getElementById('bt-form-body');
  const sections = _budgetFormSections();
  if (sections.length === 0) {
    body.innerHTML = '<div class="bt-empty bt-empty-compact">'
      + '<h3>No categories can take a target yet</h3>'
      + '<p>Targets go on spending and savings categories. Add some on the '
      + '<a href="categories.html">Categories page</a>.</p></div>';
    return;
  }
  const draft = budgetDrafts[budgetEditingYear] || {};
  const refusal = budgetRefusals[budgetEditingYear] || null;
  body.innerHTML = sections.map(section => _budgetFormSectionHtml(section, draft, refusal)).join('')
    + '<p id="bt-filter-empty" class="bt-filter-empty" hidden>No categories match.</p>';
}

// One cadence at a time keeps a row to one amount and its own controls.
// The other cadence's amounts stay in the draft and are saved with these.
function _renderBudgetCadenceSwitch() {
  const switchEl = document.getElementById('bt-cadence-switch');
  if (!switchEl) return;
  switchEl.innerHTML = BUDGET_CADENCES.map(cadence => {
    const isActive = cadence === budgetEditingCadence;
    return `<button type="button" role="tab" class="bt-year-tab bt-cadence-tab${isActive ? ' active' : ''}" `
      + `data-cadence="${cadence}" aria-selected="${isActive}">`
      + `<span class="bt-year-tab-label">${BUDGET_CADENCE_LABELS[cadence]}</span>`
      + '<span class="bt-year-tab-note">targets</span></button>';
  }).join('');
}

function _onBudgetCadenceSwitch(cadence) {
  if (!BUDGET_CADENCES.includes(cadence) || cadence === budgetEditingCadence) return;
  budgetEditingCadence = cadence;
  renderBudgetTargets();
}

function _budgetFormSectionHtml(section, draft, refusal) {
  const isSavings = section.kind === 'savings';
  const title = isSavings ? 'Savings' : 'Spending';
  const note = isSavings
    ? `<p class="bt-form-note">${escapeBudgetHtml(SET_ALERT_SAVINGS_REASON)}</p>`
    : '<p class="bt-form-note">Leave a field blank for no target. A primary\'s target covers every category under it, and the targets under it may not add up to more.</p>';
  let html = `<section class="bt-form-section bt-kind-${section.kind}" data-kind="${section.kind}">`;
  html += `<div class="bt-form-section-head"><h3>${title}</h3>${note}</div>`;
  html += '<div class="bt-form-grid">';
  html += '<div class="bt-form-row bt-form-row-head" aria-hidden="true">'
    + `<div>Category</div><div>${BUDGET_CADENCE_LABELS[budgetEditingCadence]}</div></div>`;
  for (const group of section.groups) {
    html += `<div class="bt-form-group" data-primary="${escapeBudgetHtml(group.primary)}">`;
    for (const row of group.rows) html += _budgetFormItemHtml(row, draft, refusal);
    html += '</div>';
  }
  html += '</div></section>';
  return html;
}

function _budgetFormItemHtml(row, draft, refusal) {
  const isRefused = refusal && refusal.category === row.category;
  const classes = ['bt-form-item', row.isPrimary ? 'bt-form-item-primary' : 'bt-form-item-detail'];
  if (isRefused) classes.push('bt-form-item-refused');
  const hint = row.isPrimary && row.kind !== 'savings'
    ? '<span class="bt-form-hint">Covers everything under it. Alerts go on the categories below.</span>'
    : '';
  let html = `<div class="${classes.join(' ')}" data-category="${escapeBudgetHtml(row.category)}" `
    + `data-search="${escapeBudgetHtml(`${row.category}`.toLowerCase())}">`;
  html += '<div class="bt-form-row">';
  html += `<div class="bt-form-name"><span class="bt-form-label" title="${escapeBudgetHtml(row.category)}">`
    + `${escapeBudgetHtml(row.name)}</span>${hint}</div>`;
  const cadence = budgetEditingCadence;
  const isAtCadence = isRefused && refusal.cadence === cadence;
  const isPaceRefusal = isAtCadence && Boolean(refusal.paceReason);
  html += _budgetFieldHtml(row, cadence, draft, isAtCadence && !isPaceRefusal, isPaceRefusal);
  html += '</div>';
  html += `<div class="bt-row-error" role="alert"${isRefused ? '' : ' hidden'}>`
    + `${isRefused ? escapeBudgetHtml(refusal.message) : ''}</div>`;
  html += '</div>';
  return html;
}

function _budgetFieldHtml(row, cadence, draft, isInvalid, isPaceInvalid) {
  const key = targetDraftKey(row.category, cadence);
  const value = draft[key] || '';
  const label = BUDGET_CADENCE_LABELS[cadence];
  const availability = setAlertAvailability(row, cadence, value);
  const inputId = `bt-input-${cadence}-${_budgetIdFragment(row.category)}`;
  const hasPace = row.kind === 'spending';
  return `<div class="bt-form-field${hasPace ? ' bt-form-field-paced' : ''}" data-cadence="${cadence}">`
    + `<label class="bt-field-label" for="${inputId}">${label}</label>`
    + `<span class="bt-input-wrap${isInvalid ? ' bt-input-invalid' : ''}">`
    + '<span class="bt-input-prefix" aria-hidden="true">$</span>'
    + `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="${inputId}" `
    + `class="bt-target-input" data-key="${escapeBudgetHtml(key)}" data-category="${escapeBudgetHtml(row.category)}" `
    + `data-cadence="${cadence}" value="${escapeBudgetHtml(value)}" placeholder="—" `
    + `aria-label="${escapeBudgetHtml(`${label} target for ${row.category}`)}"${isInvalid ? ' aria-invalid="true"' : ''}>`
    + '</span>'
    + (hasPace ? _budgetPaceHtml(row, cadence, draft, isPaceInvalid) : '')
    + _budgetAlertButtonHtml(row, cadence, availability)
    + '</div>';
}

function _budgetPaceHtml(row, cadence, draft, isInvalid) {
  const category = escapeBudgetHtml(row.category);
  const pace = resolveRowPace(draft, row.category, cadence, budgetPaceSettings, budgetPaceDefaults);
  const state = paceControlState(row, cadence, draft[targetDraftKey(row.category, cadence)], pace);
  const bandDisabled = state.bandDisabled ? ' disabled' : '';
  const invalid = isInvalid ? ' aria-invalid="true"' : '';
  // Out of the Tab order and not .bt-target-input, so Tab and the arrow keys
  // keep running over the amount fields only.
  return `<span class="bt-pace" data-category="${category}">`
    + `<label class="bt-pace-toggle-label" title="${escapeBudgetHtml(state.toggleTitle)}">`
    + `<input type="checkbox" class="bt-pace-toggle" tabindex="-1" data-category="${category}" `
    + `title="${escapeBudgetHtml(state.toggleTitle)}"${pace.on ? ' checked' : ''}`
    + `${state.toggleDisabled ? ' disabled' : ''}${isInvalid ? ' aria-invalid="true"' : ''}>`
    + '<span>Pace</span></label>'
    + `<span class="bt-pace-band${isInvalid ? ' bt-pace-invalid' : ''}">`
    + '<span class="bt-pace-sign" aria-hidden="true">±</span>'
    + '<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" tabindex="-1" '
    + `class="bt-pace-percent" data-category="${category}" value="${escapeBudgetHtml(pace.bandText)}" `
    + `title="${escapeBudgetHtml(state.percentTitle)}" `
    + `aria-label="${escapeBudgetHtml(`${BUDGET_CADENCE_LABELS[cadence]} on-pace band, percent, for ${row.category}`)}"${bandDisabled}${invalid}>`
    + '<span class="bt-pace-sign" aria-hidden="true">% =</span>'
    + '<span class="bt-pace-sign" aria-hidden="true">$</span>'
    + '<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" tabindex="-1" '
    + `class="bt-pace-dollars" data-category="${category}" value="${escapeBudgetHtml(state.dollarsText)}" `
    + `title="${escapeBudgetHtml(state.dollarsTitle)}" `
    + `aria-label="${escapeBudgetHtml(`${BUDGET_CADENCE_LABELS[cadence]} on-pace band, dollars, for ${row.category}`)}"${bandDisabled}${invalid}>`
    + '</span></span>';
}

function _budgetAlertButtonHtml(row, cadence, availability) {
  // Out of the Tab order, so Tab runs Monthly, Annual, then the next row.
  return `<button type="button" class="bt-alert-btn" tabindex="-1" data-budget-action="set-alert" `
    + `data-category="${escapeBudgetHtml(row.category)}" data-cadence="${cadence}" `
    + `title="${escapeBudgetHtml(availability.reason)}" aria-label="${escapeBudgetHtml(`Set alert: ${availability.reason}`)}"`
    + `${availability.enabled ? '' : ' disabled'}>`
    + '<span aria-hidden="true">🔔</span><span class="bt-alert-btn-text">Set alert</span></button>';
}

// Ids only need to be unique on the page; the data attributes carry the text.
function _budgetIdFragment(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `${text.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40)}-${(hash >>> 0).toString(36)}`;
}

function _renderBudgetFormBanner() {
  const banner = document.getElementById('bt-form-banner');
  const refusal = budgetRefusals[budgetEditingYear];
  const isFormLevel = refusal && !refusal.category;
  banner.hidden = !isFormLevel;
  banner.innerHTML = isFormLevel ? escapeBudgetHtml(refusal.message) : '';
  // A refusal on a row the API named but the form no longer shows still
  // has to be seen somewhere.
  if (refusal && refusal.category && !_budgetFormItem(refusal.category)) {
    banner.hidden = false;
    banner.textContent = refusal.message;
  }
}

function _budgetFormItem(category) {
  const items = document.querySelectorAll('#bt-form-body .bt-form-item');
  for (const item of items) {
    if (item.dataset.category === category) return item;
  }
  return null;
}

function _updateBudgetSaveBar() {
  _renderBudgetClearButtons();
  const changed = _budgetYearChanged(budgetEditingYear);
  const entry = _budgetYearEntry(budgetEditingYear);
  const label = entry ? entry.label : `FY${budgetEditingYear}`;
  const note = document.getElementById('bt-dirty-note');
  const saveButton = document.getElementById('bt-save-btn');
  const undoButton = document.getElementById('bt-undo-btn');
  const saveBar = document.getElementById('bt-savebar');

  note.textContent = changed ? `Unsaved changes to ${label}` : `${label} is saved`;
  saveBar.classList.toggle('bt-savebar-dirty', changed);
  saveButton.textContent = budgetSaving ? 'Saving…' : `Save ${label}`;
  saveButton.disabled = budgetSaving || !changed;
  undoButton.disabled = budgetSaving || !changed;

  // The tab's unsaved dot follows typing without redrawing the fields.
  const tab = document.querySelector(`#bt-year-switch .bt-year-tab[data-year="${budgetEditingYear}"]`);
  if (tab) {
    const dot = tab.querySelector('.bt-unsaved-dot');
    if (changed && !dot) {
      tab.insertAdjacentHTML('beforeend',
        '<span class="bt-unsaved-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>');
    } else if (!changed && dot) {
      dot.remove();
    }
  }
}

// ── Filtering ───────────────────────────────────────────────

function _applyBudgetTargetsFilter() {
  const query = budgetTargetsSearch.trim().toLowerCase();
  const draft = budgetDrafts[budgetEditingYear] || {};
  let anyShown = false;

  document.querySelectorAll('#bt-form-body .bt-form-section').forEach(section => {
    let sectionShown = false;
    section.querySelectorAll('.bt-form-group').forEach(group => {
      const items = Array.from(group.querySelectorAll('.bt-form-item'));
      const primaryMatches = query && items[0] && items[0].dataset.search.includes(query);
      let groupShown = false;
      items.forEach((item, position) => {
        const matchesQuery = !query || primaryMatches || item.dataset.search.includes(query);
        // "With a target" means a target of the kind being edited.
        const hasValue = normalizeTargetInput(
          draft[targetDraftKey(item.dataset.category, budgetEditingCadence)]) !== '';
        const shown = matchesQuery && (!budgetTargetsOnlySet || hasValue);
        item.hidden = !shown && position !== 0;
        if (shown) groupShown = true;
      });
      // The primary's row stays as the heading of any detail shown under it.
      if (items[0]) items[0].hidden = !groupShown;
      group.hidden = !groupShown;
      if (groupShown) sectionShown = true;
    });
    section.hidden = !sectionShown;
    if (sectionShown) anyShown = true;
  });

  const emptyNote = document.getElementById('bt-filter-empty');
  if (emptyNote) emptyNote.hidden = anyShown;
}

function _clearBudgetTargetsFilter() {
  budgetTargetsSearch = '';
  budgetTargetsOnlySet = false;
  document.getElementById('bt-search-input').value = '';
  document.getElementById('bt-only-set').checked = false;
}

// ── Actions ─────────────────────────────────────────────────

function _onBudgetFieldInput(input) {
  const draft = budgetDrafts[budgetEditingYear] || (budgetDrafts[budgetEditingYear] = {});
  draft[input.dataset.key] = input.value;

  const item = input.closest('.bt-form-item');
  _clearBudgetRowRefusal(item);

  const row = {
    category: input.dataset.category,
    isPrimary: item ? item.classList.contains('bt-form-item-primary') : false,
    kind: input.closest('.bt-form-section').dataset.kind,
  };
  const button = input.closest('.bt-form-field').querySelector('.bt-alert-btn');
  const availability = setAlertAvailability(row, input.dataset.cadence, input.value);
  button.disabled = !availability.enabled;
  button.title = availability.reason;
  button.setAttribute('aria-label', `Set alert: ${availability.reason}`);

  // The percent holds and the dollars follow the new amount.
  _syncBudgetPaceControls(item);
  _updateBudgetSaveBar();
}

/** Take a refusal off its row once the user edits that row. */
function _clearBudgetRowRefusal(item) {
  const refusal = budgetRefusals[budgetEditingYear];
  if (!refusal || !item || refusal.category !== item.dataset.category) return;
  delete budgetRefusals[budgetEditingYear];
  item.classList.remove('bt-form-item-refused');
  item.querySelectorAll('.bt-input-invalid, .bt-pace-invalid').forEach(wrap => {
    wrap.classList.remove('bt-input-invalid', 'bt-pace-invalid');
  });
  item.querySelectorAll('[aria-invalid]').forEach(field => field.removeAttribute('aria-invalid'));
  const errorLine = item.querySelector('.bt-row-error');
  errorLine.hidden = true;
  errorLine.textContent = '';
}

/**
 * Bring a row's pace controls in line with its draft: enabled or not, the
 * titles, and the dollars. The field being typed in keeps its own text.
 */
function _syncBudgetPaceControls(item) {
  const toggle = item ? item.querySelector('.bt-pace-toggle') : null;
  if (!toggle) return;
  const category = item.dataset.category;
  const draft = budgetDrafts[budgetEditingYear] || {};
  const cadence = budgetEditingCadence;
  const pace = resolveRowPace(draft, category, cadence, budgetPaceSettings, budgetPaceDefaults);
  const state = paceControlState(
    { kind: 'spending' }, cadence, draft[targetDraftKey(category, cadence)], pace);
  const percent = item.querySelector('.bt-pace-percent');
  const dollars = item.querySelector('.bt-pace-dollars');

  toggle.disabled = state.toggleDisabled;
  toggle.checked = pace.on;
  toggle.title = state.toggleTitle;
  toggle.closest('label').title = state.toggleTitle;
  percent.disabled = state.bandDisabled;
  percent.title = state.percentTitle;
  dollars.disabled = state.bandDisabled;
  dollars.title = state.dollarsTitle;
  if (document.activeElement !== percent) percent.value = pace.bandText;
  if (document.activeElement !== dollars) dollars.value = state.dollarsText;
}

function _onBudgetPaceToggle(toggle) {
  const draft = budgetDrafts[budgetEditingYear] || (budgetDrafts[budgetEditingYear] = {});
  const item = toggle.closest('.bt-form-item');
  setRowPace(draft, toggle.dataset.category, budgetEditingCadence, budgetPaceSettings,
    budgetPaceDefaults, { on: toggle.checked });
  _clearBudgetRowRefusal(item);
  _syncBudgetPaceControls(item);
  _updateBudgetSaveBar();
}

function _onBudgetPaceBandInput(input) {
  const draft = budgetDrafts[budgetEditingYear] || (budgetDrafts[budgetEditingYear] = {});
  const item = input.closest('.bt-form-item');
  const category = input.dataset.category;
  const cadence = budgetEditingCadence;
  const amountText = draft[targetDraftKey(category, cadence)];
  const bandText = input.classList.contains('bt-pace-dollars')
    ? bandPercentFromDollars(amountText, input.value)
    : input.value;
  setRowPace(draft, category, cadence, budgetPaceSettings, budgetPaceDefaults, { bandText });
  _clearBudgetRowRefusal(item);
  _syncBudgetPaceControls(item);
  _updateBudgetSaveBar();
}

function _onBudgetSetAlert(button) {
  const draft = budgetDrafts[budgetEditingYear] || {};
  const category = button.dataset.category;
  const cadence = button.dataset.cadence;
  const amount = normalizeTargetInput(draft[targetDraftKey(category, cadence)]);
  const address = buildSetAlertAddress(
    { category, cadence, amount },
    fiscalStartMonthOfYear(_budgetYearEntry(budgetEditingYear)),
    window.location.search,
  );
  if (!address) return;
  // A new tab, so whatever is typed here and not saved stays put.
  window.open(address, '_blank', 'noopener');
}

function _onBudgetYearSwitch(fiscalYear) {
  if (fiscalYear === budgetEditingYear) return;
  budgetEditingYear = fiscalYear;
  renderBudgetTargets();
}

function _onBudgetCopyFromLastYear() {
  const previousYear = _budgetPreviousYear();
  const previousEntry = _budgetYearEntry(previousYear);
  if (!previousEntry || budgetEditingYear === previousYear) return;
  const currentEntry = _budgetYearEntry(budgetEditingYear);
  const currentLabel = currentEntry ? currentEntry.label : `FY${budgetEditingYear}`;

  if (targetsDraftHasValues(budgetDrafts[budgetEditingYear])) {
    const confirmed = window.confirm(
      `Replace what the ${currentLabel} form holds with ${previousEntry.label}'s targets?\n\n`
      + 'Nothing is saved until you press Save.'
    );
    if (!confirmed) return;
  }
  budgetDrafts[budgetEditingYear] = draftFromYearTargets(previousEntry.targets);
  delete budgetRefusals[budgetEditingYear];
  renderBudgetTargets();
  showBudgetStatus(`Filled in from ${previousEntry.label}. Nothing is saved until you press Save.`, 'info');
}

function _onBudgetClear(scope) {
  if (budgetSaving || !TARGETS_CLEAR_SCOPES.includes(scope)) return;
  const draft = budgetDrafts[budgetEditingYear] || {};
  if (!targetsDraftHasScopeValues(draft, scope)) return;
  const entry = _budgetYearEntry(budgetEditingYear);
  const yearLabel = entry ? entry.label : `FY${budgetEditingYear}`;

  if (!window.confirm(clearTargetsConfirmText(yearLabel, scope))) return;
  budgetDrafts[budgetEditingYear] = clearTargetsDraft(draft, scope);
  delete budgetRefusals[budgetEditingYear];
  renderBudgetTargets();
  showBudgetStatus(clearTargetsStatusText(yearLabel, scope), 'info');
}

function _onBudgetUndo() {
  budgetDrafts[budgetEditingYear] = _budgetSavedDraft(budgetEditingYear);
  delete budgetRefusals[budgetEditingYear];
  renderBudgetTargets();
}

async function _onBudgetSave() {
  if (budgetSaving) return;
  const fiscalYear = budgetEditingYear;
  const rows = flattenTargetsFormRows(_budgetFormSections());
  const targets = buildTargetsPayload(
    rows, budgetDrafts[fiscalYear] || {}, budgetPaceSettings, budgetPaceDefaults);

  budgetSaving = true;
  _updateBudgetSaveBar();
  let result;
  try {
    result = await saveBudgetTargets(fiscalYear, targets);
  } catch (networkError) {
    result = { ok: false, status: 0, body: { error: `Could not reach the server: ${networkError.message}` } };
  } finally {
    budgetSaving = false;
  }

  if (result.ok) {
    const years = budgetTargetsData.years || [];
    const position = years.findIndex(year => year.fiscal_year === fiscalYear);
    if (position >= 0) years[position] = result.body;
    else years.push(result.body);
    budgetDrafts[fiscalYear] = draftFromYearTargets(result.body.targets);
    delete budgetRefusals[fiscalYear];
    budgetReportStale = true;
    await _refreshBudgetPaceSettings(result.body);
    if (fiscalYear === budgetEditingYear) renderBudgetTargets();
    showBudgetStatus(`Saved ${result.body.label || `FY${fiscalYear}`} targets.`, 'success');
    return;
  }

  budgetRefusals[fiscalYear] = placeTargetsRefusal(result.body, targets);
  if (fiscalYear !== budgetEditingYear) budgetEditingYear = fiscalYear;
  // A filter could be hiding the row the refusal names.
  if (budgetRefusals[fiscalYear].category) _clearBudgetTargetsFilter();
  renderBudgetTargets();
  _revealBudgetRefusal(budgetRefusals[fiscalYear]);
}

/**
 * Re-read the remembered pace settings after a save, since the save's
 * response does not carry them and the most recent row for a category
 * may now be a different year's. If the read fails, the saved year's
 * settings stand in for the categories it holds.
 *
 * @param {Object} savedYear - the PUT response
 */
async function _refreshBudgetPaceSettings(savedYear) {
  try {
    const reloaded = await fetchBudgetTargets();
    budgetPaceSettings = reloaded.pace_settings || {};
    budgetPaceDefaults = reloaded.pace_defaults || budgetPaceDefaults;
  } catch (_reloadError) {
    const merged = { ...budgetPaceSettings };
    for (const target of savedYear.targets || []) {
      merged[target.category] = {
        ...merged[target.category],
        [target.cadence]: {
          track_pace: target.track_pace,
          pace_band_percent: target.pace_band_percent,
        },
      };
    }
    budgetPaceSettings = merged;
  }
}

function _revealBudgetRefusal(refusal) {
  if (!refusal.category) {
    document.getElementById('bt-form-banner').scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  // A refusal about the cadence not on screen brings that cadence up first.
  if (refusal.cadence && refusal.cadence !== budgetEditingCadence) {
    budgetEditingCadence = refusal.cadence;
    renderBudgetTargets();
  }
  const item = _budgetFormItem(refusal.category);
  if (!item) return;
  item.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const cadence = refusal.cadence || budgetEditingCadence;
  const paceSelector = refusal.paceReason === 'invalid_track_pace' ? '.bt-pace-toggle' : '.bt-pace-percent';
  const field = refusal.paceReason
    ? item.querySelector(paceSelector)
    : item.querySelector(`.bt-target-input[data-cadence="${cadence}"]`);
  if (field) field.focus({ preventScroll: true });
}

/**
 * Arrow keys and Enter move between target fields like cells in a sheet,
 * over the rows the filter is showing.
 *
 * @param {KeyboardEvent} event - a keydown on a target field
 */
function _onBudgetFieldKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  const input = event.target;
  const move = targetFieldMoveForKey(
    event.key, input.selectionStart, input.selectionEnd, input.value.length);
  if (!move) return;

  const shownItems = Array.from(document.querySelectorAll('#bt-form-body .bt-form-item'))
    .filter(item => !item.closest('[hidden]'));
  const position = nextTargetFieldPosition(
    shownItems.length, shownItems.indexOf(input.closest('.bt-form-item')), input.dataset.cadence, move);
  // At the edge of the grid the key keeps its usual meaning inside the field.
  if (!position) return;

  const nextInput = shownItems[position.rowIndex]
    .querySelector(`.bt-target-input[data-cadence="${position.cadence}"]`);
  if (!nextInput) return;
  event.preventDefault();
  nextInput.focus();
  nextInput.select();
}

function _wireBudgetTargets() {
  if (_budgetTargetsWired) return;
  _budgetTargetsWired = true;

  const panel = document.getElementById('targets');
  panel.addEventListener('input', event => {
    const target = event.target;
    if (target.classList.contains('bt-target-input')) _onBudgetFieldInput(target);
    else if (target.classList.contains('bt-pace-percent') || target.classList.contains('bt-pace-dollars')) {
      _onBudgetPaceBandInput(target);
    }
  });
  panel.addEventListener('change', event => {
    if (event.target.classList.contains('bt-pace-toggle')) _onBudgetPaceToggle(event.target);
  });
  panel.addEventListener('keydown', event => {
    if (event.target.classList.contains('bt-target-input')) _onBudgetFieldKeydown(event);
  });
  panel.addEventListener('click', event => {
    const cadenceTab = event.target.closest('.bt-cadence-tab');
    if (cadenceTab) {
      _onBudgetCadenceSwitch(cadenceTab.dataset.cadence);
      return;
    }
    const yearTab = event.target.closest('.bt-year-tab');
    if (yearTab) {
      _onBudgetYearSwitch(Number(yearTab.dataset.year));
      return;
    }
    const alertButton = event.target.closest('[data-budget-action="set-alert"]');
    if (alertButton && !alertButton.disabled) _onBudgetSetAlert(alertButton);
  });

  document.getElementById('bt-copy-btn').addEventListener('click', _onBudgetCopyFromLastYear);
  document.querySelectorAll('[data-clear-scope]').forEach(button => {
    button.addEventListener('click', () => _onBudgetClear(button.dataset.clearScope));
  });
  document.getElementById('bt-undo-btn').addEventListener('click', _onBudgetUndo);
  document.getElementById('bt-save-btn').addEventListener('click', _onBudgetSave);
  document.getElementById('bt-search-input').addEventListener('input', event => {
    budgetTargetsSearch = event.target.value;
    _applyBudgetTargetsFilter();
  });
  document.getElementById('bt-only-set').addEventListener('change', event => {
    budgetTargetsOnlySet = event.target.checked;
    _applyBudgetTargetsFilter();
  });

  window.addEventListener('beforeunload', event => {
    if (!budgetTargetsHaveUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
