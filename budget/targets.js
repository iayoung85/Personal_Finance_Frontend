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
    + '<div>Category</div><div>Monthly</div><div>Annual</div></div>';
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
  for (const cadence of BUDGET_CADENCES) {
    html += _budgetFieldHtml(row, cadence, draft, isRefused && refusal.cadence === cadence);
  }
  html += '</div>';
  html += `<div class="bt-row-error" role="alert"${isRefused ? '' : ' hidden'}>`
    + `${isRefused ? escapeBudgetHtml(refusal.message) : ''}</div>`;
  html += '</div>';
  return html;
}

function _budgetFieldHtml(row, cadence, draft, isInvalid) {
  const key = targetDraftKey(row.category, cadence);
  const value = draft[key] || '';
  const label = BUDGET_CADENCE_LABELS[cadence];
  const availability = setAlertAvailability(row, cadence, value);
  const inputId = `bt-input-${cadence}-${_budgetIdFragment(row.category)}`;
  return `<div class="bt-form-field" data-cadence="${cadence}">`
    + `<label class="bt-field-label" for="${inputId}">${label}</label>`
    + `<span class="bt-input-wrap${isInvalid ? ' bt-input-invalid' : ''}">`
    + '<span class="bt-input-prefix" aria-hidden="true">$</span>'
    + `<input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="${inputId}" `
    + `class="bt-target-input" data-key="${escapeBudgetHtml(key)}" data-category="${escapeBudgetHtml(row.category)}" `
    + `data-cadence="${cadence}" value="${escapeBudgetHtml(value)}" placeholder="—" `
    + `aria-label="${escapeBudgetHtml(`${label} target for ${row.category}`)}"${isInvalid ? ' aria-invalid="true"' : ''}>`
    + '</span>'
    + _budgetAlertButtonHtml(row, cadence, availability)
    + '</div>';
}

function _budgetAlertButtonHtml(row, cadence, availability) {
  return `<button type="button" class="bt-alert-btn" data-budget-action="set-alert" `
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
        const hasValue = BUDGET_CADENCES.some(cadence =>
          normalizeTargetInput(draft[targetDraftKey(item.dataset.category, cadence)]) !== '');
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
  const refusal = budgetRefusals[budgetEditingYear];
  if (refusal && item && refusal.category === item.dataset.category) {
    delete budgetRefusals[budgetEditingYear];
    item.classList.remove('bt-form-item-refused');
    item.querySelectorAll('.bt-input-invalid').forEach(wrap => wrap.classList.remove('bt-input-invalid'));
    item.querySelectorAll('[aria-invalid]').forEach(field => field.removeAttribute('aria-invalid'));
    const errorLine = item.querySelector('.bt-row-error');
    errorLine.hidden = true;
    errorLine.textContent = '';
  }

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

function _onBudgetUndo() {
  budgetDrafts[budgetEditingYear] = _budgetSavedDraft(budgetEditingYear);
  delete budgetRefusals[budgetEditingYear];
  renderBudgetTargets();
}

async function _onBudgetSave() {
  if (budgetSaving) return;
  const fiscalYear = budgetEditingYear;
  const rows = flattenTargetsFormRows(_budgetFormSections());
  const targets = buildTargetsPayload(rows, budgetDrafts[fiscalYear] || {});

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

function _revealBudgetRefusal(refusal) {
  if (!refusal.category) {
    document.getElementById('bt-form-banner').scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  const item = _budgetFormItem(refusal.category);
  if (!item) return;
  item.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const cadence = refusal.cadence || BUDGET_CADENCES[0];
  const field = item.querySelector(`.bt-target-input[data-cadence="${cadence}"]`);
  if (field) field.focus({ preventScroll: true });
}

function _wireBudgetTargets() {
  if (_budgetTargetsWired) return;
  _budgetTargetsWired = true;

  const panel = document.getElementById('targets');
  panel.addEventListener('input', event => {
    if (event.target.classList.contains('bt-target-input')) _onBudgetFieldInput(event.target);
  });
  panel.addEventListener('click', event => {
    const yearTab = event.target.closest('.bt-year-tab');
    if (yearTab) {
      _onBudgetYearSwitch(Number(yearTab.dataset.year));
      return;
    }
    const alertButton = event.target.closest('[data-budget-action="set-alert"]');
    if (alertButton && !alertButton.disabled) _onBudgetSetAlert(alertButton);
  });

  document.getElementById('bt-copy-btn').addEventListener('click', _onBudgetCopyFromLastYear);
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
