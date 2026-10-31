// ============================================================
// user-settings/insight-cards.js — Insight Card Editor
// Edits the insightCards preference: up to three named cards,
// each summing a chosen set of whole primaries and single
// "Primary: Detailed" categories in the transactions insights
// bar. Edits stay local until the user presses Save, which
// sends the whole list in one PATCH.
// ============================================================

const INSIGHT_EDITOR_CARD_LIMIT = 3;
const INSIGHT_EDITOR_NAME_MAX_LENGTH = 40;
const INSIGHT_EDITOR_STATUS_CLEAR_MS = 2500;

// ── Pure helpers (covered by tests/insight-cards.test.js) ──

/**
 * True when a category may be offered as an insight card member. Bracketed
 * names are account transfers; transfer and adjustment rows never count in
 * the insights bar, so offering them would only build an always-empty card.
 * @param {string} categoryName
 * @returns {boolean}
 */
function isInsightEditorEligibleCategory(categoryName) {
  if (typeof categoryName !== 'string') {
    return false;
  }
  const trimmed = categoryName.trim();
  return Boolean(trimmed)
    && !trimmed.startsWith('[')
    && !/(transfer|adjust(?:ment)?)/i.test(trimmed);
}

/**
 * Splits a category name the way the transactions page does, so a detail
 * member built here matches the rows it is meant to match.
 * @param {string} categoryName
 * @returns {{primary: string, detailed: string}}
 */
function splitInsightEditorCategory(categoryName) {
  const parts = String(categoryName || '').split(':').map(part => part.trim());
  return { primary: parts[0] || '', detailed: parts[1] || '' };
}

/**
 * The picker's list: each primary with its detailed categories under it,
 * sorted by name. Members already on a card but missing from the user's
 * categories (renamed or deleted since) are added and flagged `missing`, so
 * they stay visible and removable.
 * @param {string[]} availableNames Names from /api/categorization/categories/available.
 * @param {Array<{primaries: string[], details: string[]}>} cards Current drafts.
 * @returns {Array<{primary: string, missing: boolean, details: Array<{label: string, detailed: string, missing: boolean}>}>}
 */
function buildInsightCategoryTree(availableNames, cards) {
  const groups = new Map();

  const ensureGroup = (primary, missing) => {
    if (!groups.has(primary)) {
      groups.set(primary, { primary, missing, details: new Map() });
    }
    return groups.get(primary);
  };

  (Array.isArray(availableNames) ? availableNames : []).forEach(categoryName => {
    if (!isInsightEditorEligibleCategory(categoryName)) {
      return;
    }
    const { primary, detailed } = splitInsightEditorCategory(categoryName);
    if (!primary) {
      return;
    }
    const group = ensureGroup(primary, false);
    if (detailed) {
      const label = `${primary}: ${detailed}`;
      group.details.set(label, { label, detailed, missing: false });
    }
  });

  (Array.isArray(cards) ? cards : []).forEach(card => {
    (card.primaries || []).forEach(primary => {
      ensureGroup(primary, true);
    });
    (card.details || []).forEach(label => {
      const { primary, detailed } = splitInsightEditorCategory(label);
      if (!primary || !detailed) {
        return;
      }
      const group = ensureGroup(primary, true);
      if (!group.details.has(label)) {
        group.details.set(label, { label, detailed, missing: true });
      }
    });
  });

  return Array.from(groups.values())
    .sort((left, right) => left.primary.localeCompare(right.primary))
    .map(group => ({
      primary: group.primary,
      missing: group.missing,
      details: Array.from(group.details.values())
        .sort((left, right) => left.detailed.localeCompare(right.detailed)),
    }));
}

let _insightDraftKeySequence = 0;

/**
 * Editable copies of the stored cards. Each draft gets a local key so open
 * pickers and filters survive re-renders; the key is never sent.
 * @param {*} cards The insightCards value from the server.
 * @returns {Array<{key: string, name: string, primaries: string[], details: string[]}>}
 */
function createInsightCardDrafts(cards) {
  if (!Array.isArray(cards)) {
    return [];
  }
  return cards
    .filter(card => card && typeof card === 'object')
    .slice(0, INSIGHT_EDITOR_CARD_LIMIT)
    .map(card => createInsightCardDraft(card));
}

function createInsightCardDraft(card = {}) {
  _insightDraftKeySequence += 1;
  const stringsOnly = list => (Array.isArray(list) ? list.filter(item => typeof item === 'string') : []);
  return {
    key: `insight-card-${_insightDraftKeySequence}`,
    name: typeof card.name === 'string' ? card.name : '',
    primaries: stringsOnly(card.primaries),
    details: stringsOnly(card.details),
  };
}

/**
 * Ticks or unticks a whole primary. Ticking drops that primary's separately
 * ticked detailed members: the whole primary already includes them.
 * @param {{primaries: string[], details: string[]}} draft Mutated in place.
 * @param {string} primary
 * @param {boolean} checked
 */
function setInsightDraftPrimary(draft, primary, checked) {
  draft.primaries = draft.primaries.filter(name => name !== primary);
  if (checked) {
    draft.primaries.push(primary);
    draft.details = draft.details.filter(label => splitInsightEditorCategory(label).primary !== primary);
  }
}

/**
 * Ticks or unticks one "Primary: Detailed" member.
 * @param {{details: string[]}} draft Mutated in place.
 * @param {string} label
 * @param {boolean} checked
 */
function setInsightDraftDetail(draft, label, checked) {
  draft.details = draft.details.filter(name => name !== label);
  if (checked) {
    draft.details.push(label);
  }
}

/**
 * Checks drafts against the same rules the API enforces, so a bad card is
 * caught here with a message beside it instead of a rejected save.
 * @param {Array<{name: string, primaries: string[], details: string[]}>} drafts
 * @returns {{cards: Array<{name: string, primaries: string[], details: string[]}>, errors: Object<number, string[]>, valid: boolean}}
 *   cards is the payload to send; errors maps a draft's index to its messages.
 */
function validateInsightCardDrafts(drafts) {
  const errors = {};
  const cards = [];

  (drafts || []).forEach((draft, index) => {
    const messages = [];
    const name = String(draft.name || '').trim();

    if (!name) {
      messages.push('Give this card a name.');
    } else if (name.length > INSIGHT_EDITOR_NAME_MAX_LENGTH) {
      messages.push(`Keep the name to ${INSIGHT_EDITOR_NAME_MAX_LENGTH} characters or fewer.`);
    }
    if (draft.primaries.length === 0 && draft.details.length === 0) {
      messages.push('Choose at least one category.');
    }

    if (messages.length > 0) {
      errors[index] = messages;
    }
    cards.push({ name, primaries: draft.primaries.slice(), details: draft.details.slice() });
  });

  if (cards.length > INSIGHT_EDITOR_CARD_LIMIT) {
    errors[INSIGHT_EDITOR_CARD_LIMIT] = [`You can keep at most ${INSIGHT_EDITOR_CARD_LIMIT} cards.`];
  }

  return { cards, errors, valid: Object.keys(errors).length === 0 };
}

function _insightCardComparable(card) {
  return {
    name: String(card.name || '').trim(),
    primaries: (card.primaries || []).slice().sort(),
    details: (card.details || []).slice().sort(),
  };
}

/**
 * True when the drafts would save the same cards as those stored. Card order
 * matters (it is the bar's order); member order does not.
 * @param {Array} drafts
 * @param {Array} savedCards
 * @returns {boolean}
 */
function insightDraftsMatchSaved(drafts, savedCards) {
  const left = (drafts || []).map(_insightCardComparable);
  const right = (savedCards || []).map(_insightCardComparable);
  return JSON.stringify(left) === JSON.stringify(right);
}

// ── Editor state ──────────────────────────────────────────────

const insightEditorState = {
  savedCards: [],
  drafts: [],
  availableNames: [],
  categoriesLoaded: true,
  tree: [],
  openPickerKeys: new Set(),
  filters: {},
  errors: {},
  saving: false,
  statusTimer: null,
};

/**
 * Loads the user's category names for the picker.
 * @returns {Promise<string[]|null>} The names, or null when they could not be loaded.
 */
async function fetchInsightEditorCategoryNames() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return Array.isArray(data.available_categories) ? data.available_categories : [];
  } catch (error) {
    console.warn('Unable to load categories for insight cards:', error.message);
    return null;
  }
}

/**
 * Resets the editor to the stored cards. Call before rendering the card.
 * @param {Object} config Merged preferences from the server.
 * @param {string[]|null} availableNames Category names, or null if they failed to load.
 */
function initInsightCardEditor(config, availableNames) {
  insightEditorState.savedCards = Array.isArray(config.insightCards) ? config.insightCards : [];
  insightEditorState.drafts = createInsightCardDrafts(insightEditorState.savedCards);
  insightEditorState.availableNames = availableNames || [];
  insightEditorState.categoriesLoaded = availableNames !== null;
  insightEditorState.openPickerKeys = new Set();
  insightEditorState.filters = {};
  insightEditorState.errors = {};
  insightEditorState.saving = false;
  _rebuildInsightCategoryTree();
}

function _rebuildInsightCategoryTree() {
  insightEditorState.tree = buildInsightCategoryTree(
    insightEditorState.availableNames,
    insightEditorState.drafts,
  );
}

// ── Rendering ─────────────────────────────────────────────────

/**
 * The Transaction Insights settings card. Bind it with
 * bindInsightCardEditor() once it is in the page.
 * @returns {string} HTML
 */
function renderInsightCardEditorCard() {
  return `
    <div class="card insight-editor-card">
      <div class="card-header">
        <h3 class="card-title">Transaction Insights</h3>
      </div>
      <p class="text-muted insight-editor-intro">Cards in the transactions insights bar, in this order. Each one sums the categories you choose into a single figure.</p>
      <div id="insight-editor-root">${_renderInsightEditorBody()}</div>
      <p class="text-muted stub-note">Name a card and add any primaries or detailed categories. Totals are net; a card that mixes income and spending shows a signed net with money in and out beneath it. Averages use credits for income, inflow and retirement categories and debits for spending categories, ignoring refunds and clawbacks. Transfers and adjustments are excluded.</p>
    </div>
  `;
}

function _renderInsightEditorBody() {
  const { drafts } = insightEditorState;
  const slotsHtml = drafts.length > 0
    ? drafts.map((draft, index) => _renderInsightSlot(draft, index)).join('')
    : `
      <div class="insight-editor-empty">
        <div class="insight-editor-empty-title">No insight cards</div>
        <div class="insight-editor-empty-text">Add a card to follow a group of categories, such as a "Total income" card over your income and inflow categories.</div>
      </div>
    `;

  return `
    <div class="insight-slot-list">${slotsHtml}</div>
    ${_renderInsightEditorFooter()}
    <div class="insight-editor-status" data-role="status" aria-live="polite"></div>
  `;
}

function _renderInsightEditorFooter() {
  const { drafts, saving } = insightEditorState;
  const canAdd = drafts.length < INSIGHT_EDITOR_CARD_LIMIT;
  const isDirty = !insightDraftsMatchSaved(drafts, insightEditorState.savedCards);
  const actionsDisabled = !isDirty || saving ? ' disabled' : '';

  return `
    <div class="insight-editor-footer">
      <div class="insight-editor-footer-left">
        ${canAdd ? `<button type="button" class="btn btn-secondary insight-add-card" data-action="add-card"${saving ? ' disabled' : ''}>+ Add card</button>` : ''}
        <span class="insight-editor-capacity">${drafts.length} of ${INSIGHT_EDITOR_CARD_LIMIT} cards</span>
      </div>
      <div class="insight-editor-footer-right">
        <span class="insight-unsaved-pill" data-role="unsaved"${isDirty ? '' : ' hidden'}>Unsaved changes</span>
        <button type="button" class="btn btn-secondary" data-action="discard"${actionsDisabled}>Discard</button>
        <button type="button" class="btn btn-primary" data-action="save"${actionsDisabled}>${saving ? 'Saving…' : 'Save cards'}</button>
      </div>
    </div>
  `;
}

function _renderInsightSlot(draft, index) {
  const slotErrors = insightEditorState.errors[index] || [];
  const nameId = `insight-slot-name-${draft.key}`;
  const isOpen = insightEditorState.openPickerKeys.has(draft.key);

  return `
    <section class="insight-slot${slotErrors.length ? ' has-error' : ''}" data-slot="${index}" data-key="${draft.key}">
      <div class="insight-slot-head">
        <span class="insight-slot-number" aria-hidden="true">${index + 1}</span>
        <div class="insight-slot-name">
          <label for="${nameId}">Card name</label>
          <div class="insight-name-row">
            <input type="text" id="${nameId}" data-field="name" maxlength="${INSIGHT_EDITOR_NAME_MAX_LENGTH}"
              placeholder="e.g. Total income" autocomplete="off" value="${escapeHtml(draft.name)}">
            <span class="insight-name-count" data-role="name-count">${draft.name.length}/${INSIGHT_EDITOR_NAME_MAX_LENGTH}</span>
          </div>
        </div>
        <button type="button" class="insight-slot-remove" data-action="remove-card"
          title="Remove this card" aria-label="Remove card ${index + 1}">Remove</button>
      </div>
      <div class="insight-slot-members">
        <div class="insight-members-label">Included categories</div>
        <div class="insight-member-chips" data-role="chips">${_renderInsightMemberChips(draft)}</div>
      </div>
      <details class="insight-picker" data-role="picker"${isOpen ? ' open' : ''}>
        <summary>
          <span class="insight-picker-caret" aria-hidden="true"></span>
          <span>Choose categories</span>
          <span class="insight-picker-count" data-role="picker-count">${_describeInsightSelection(draft)}</span>
        </summary>
        ${_renderInsightPickerBody(draft)}
      </details>
      <div class="insight-slot-error" data-role="error">${_renderInsightSlotErrors(slotErrors)}</div>
    </section>
  `;
}

function _renderInsightSlotErrors(messages) {
  return messages.map(message => `<div>${escapeHtml(message)}</div>`).join('');
}

function _describeInsightSelection(draft) {
  const parts = [];
  if (draft.primaries.length) {
    parts.push(`${draft.primaries.length} whole ${draft.primaries.length === 1 ? 'primary' : 'primaries'}`);
  }
  if (draft.details.length) {
    parts.push(`${draft.details.length} detailed`);
  }
  return parts.length ? parts.join(' · ') : 'None chosen';
}

function _findInsightTreeGroup(primary) {
  return insightEditorState.tree.find(group => group.primary === primary) || null;
}

function _isInsightMemberMissing(kind, value) {
  if (kind === 'primary') {
    const group = _findInsightTreeGroup(value);
    return !group || group.missing;
  }
  const group = _findInsightTreeGroup(splitInsightEditorCategory(value).primary);
  const detail = group && group.details.find(item => item.label === value);
  return !detail || detail.missing;
}

function _renderInsightMemberChips(draft) {
  if (draft.primaries.length === 0 && draft.details.length === 0) {
    return '<span class="insight-members-empty">None yet. Choose categories below.</span>';
  }

  const missingTitle = 'Not in your current categories. It matches nothing until a category with this name exists again.';

  const primaryChips = draft.primaries
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map(primary => {
      const missing = _isInsightMemberMissing('primary', primary);
      return `
        <span class="insight-chip insight-chip-primary${missing ? ' is-missing' : ''}"${missing ? ` title="${escapeHtml(missingTitle)}"` : ''}>
          <span class="insight-chip-text">${escapeHtml(primary)}</span>
          <span class="insight-chip-tag">all</span>
          <button type="button" class="insight-chip-remove" data-action="remove-member" data-kind="primary"
            data-value="${escapeHtml(primary)}" aria-label="Remove ${escapeHtml(primary)}">&times;</button>
        </span>
      `;
    });

  const detailChips = draft.details
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .map(label => {
      const { primary, detailed } = splitInsightEditorCategory(label);
      const missing = _isInsightMemberMissing('detail', label);
      return `
        <span class="insight-chip${missing ? ' is-missing' : ''}"${missing ? ` title="${escapeHtml(missingTitle)}"` : ''}>
          <span class="insight-chip-parent">${escapeHtml(primary)}:</span>
          <span class="insight-chip-text">${escapeHtml(detailed)}</span>
          <button type="button" class="insight-chip-remove" data-action="remove-member" data-kind="detail"
            data-value="${escapeHtml(label)}" aria-label="Remove ${escapeHtml(label)}">&times;</button>
        </span>
      `;
    });

  return primaryChips.concat(detailChips).join('');
}

function _renderInsightPickerBody(draft) {
  const { tree, categoriesLoaded } = insightEditorState;
  const filterText = insightEditorState.filters[draft.key] || '';
  const loadNote = categoriesLoaded
    ? ''
    : '<div class="insight-picker-note">Your categories could not be loaded. Only this card\'s current members are listed.</div>';

  const groupsHtml = tree.length > 0
    ? tree.map(group => _renderInsightPickerGroup(group, draft)).join('')
    : '<div class="insight-picker-note">No categories to choose from.</div>';

  return `
    <div class="insight-picker-body">
      <input type="text" class="insight-picker-filter" data-field="filter" placeholder="Filter categories"
        autocomplete="off" aria-label="Filter categories" value="${escapeHtml(filterText)}">
      ${loadNote}
      <div class="insight-picker-list" data-role="picker-list">${groupsHtml}</div>
      <div class="insight-picker-note insight-picker-no-match" data-role="no-match" hidden>No categories match that filter.</div>
    </div>
  `;
}

function _renderInsightPickerGroup(group, draft) {
  const isWhole = draft.primaries.includes(group.primary);
  const missingBadge = group.missing ? '<span class="insight-missing-badge">Not in your categories</span>' : '';

  const detailsHtml = group.details.map(detail => {
    const isChecked = isWhole || draft.details.includes(detail.label);
    return `
      <label class="insight-picker-detail${isWhole ? ' is-included' : ''}${detail.missing ? ' is-missing' : ''}"
        data-search="${escapeHtml(detail.label.toLowerCase())}">
        <input type="checkbox" data-kind="detail" data-value="${escapeHtml(detail.label)}"
          ${isChecked ? 'checked' : ''}${isWhole ? ' disabled' : ''}>
        <span>${escapeHtml(detail.detailed)}</span>
        ${detail.missing ? '<span class="insight-missing-badge">Missing</span>' : ''}
      </label>
    `;
  }).join('');

  return `
    <div class="insight-picker-group${isWhole ? ' is-whole' : ''}" data-primary="${escapeHtml(group.primary)}">
      <label class="insight-picker-primary">
        <input type="checkbox" data-kind="primary" data-value="${escapeHtml(group.primary)}"${isWhole ? ' checked' : ''}>
        <span class="insight-picker-primary-name">${escapeHtml(group.primary)}</span>
        ${missingBadge}
        <span class="insight-picker-hint" data-role="hint">${_describeInsightGroupHint(group, draft)}</span>
      </label>
      ${group.details.length ? `<div class="insight-picker-details">${detailsHtml}</div>` : ''}
    </div>
  `;
}

function _describeInsightGroupHint(group, draft) {
  const detailCount = group.details.length;
  if (draft.primaries.includes(group.primary)) {
    return detailCount > 0 ? `Whole primary · all ${detailCount} included` : 'Whole primary';
  }
  const chosenCount = group.details.filter(detail => draft.details.includes(detail.label)).length;
  if (chosenCount > 0) {
    return `${chosenCount} of ${detailCount} chosen`;
  }
  if (detailCount === 0) {
    return 'No detailed categories';
  }
  return `${detailCount} detailed`;
}

// ── DOM updates ───────────────────────────────────────────────

function _insightEditorRoot() {
  return document.getElementById('insight-editor-root');
}

function _renderInsightEditor() {
  const root = _insightEditorRoot();
  if (!root) {
    return;
  }
  root.innerHTML = _renderInsightEditorBody();
  root.querySelectorAll('.insight-slot').forEach(slotEl => {
    _applyInsightPickerFilter(slotEl);
  });
}

function _refreshInsightEditorFooter() {
  const root = _insightEditorRoot();
  const footer = root && root.querySelector('.insight-editor-footer');
  if (!footer) {
    return;
  }
  footer.outerHTML = _renderInsightEditorFooter();
}

/**
 * Brings one slot's chips, checkboxes and hints in line with its draft
 * without re-rendering it, so the picker keeps its scroll position.
 */
function _syncInsightSlot(slotEl, draft) {
  slotEl.querySelector('[data-role="chips"]').innerHTML = _renderInsightMemberChips(draft);
  slotEl.querySelector('[data-role="picker-count"]').textContent = _describeInsightSelection(draft);

  slotEl.querySelectorAll('.insight-picker-group').forEach(groupEl => {
    const primary = groupEl.dataset.primary;
    const group = _findInsightTreeGroup(primary);
    const isWhole = draft.primaries.includes(primary);

    groupEl.classList.toggle('is-whole', isWhole);
    groupEl.querySelector('input[data-kind="primary"]').checked = isWhole;
    if (group) {
      groupEl.querySelector('[data-role="hint"]').textContent = _describeInsightGroupHint(group, draft);
    }

    groupEl.querySelectorAll('input[data-kind="detail"]').forEach(detailInput => {
      detailInput.checked = isWhole || draft.details.includes(detailInput.dataset.value);
      detailInput.disabled = isWhole;
      detailInput.closest('.insight-picker-detail').classList.toggle('is-included', isWhole);
    });
  });
}

function _applyInsightPickerFilter(slotEl) {
  const filterInput = slotEl.querySelector('[data-field="filter"]');
  const query = filterInput ? filterInput.value.trim().toLowerCase() : '';
  let visibleGroups = 0;

  slotEl.querySelectorAll('.insight-picker-group').forEach(groupEl => {
    const primaryMatches = !query || groupEl.dataset.primary.toLowerCase().includes(query);
    let visibleDetails = 0;

    groupEl.querySelectorAll('.insight-picker-detail').forEach(detailEl => {
      const shows = primaryMatches || detailEl.dataset.search.includes(query);
      detailEl.hidden = !shows;
      if (shows) {
        visibleDetails += 1;
      }
    });

    const groupShows = primaryMatches || visibleDetails > 0;
    groupEl.hidden = !groupShows;
    if (groupShows) {
      visibleGroups += 1;
    }
  });

  const noMatch = slotEl.querySelector('[data-role="no-match"]');
  if (noMatch) {
    noMatch.hidden = visibleGroups > 0 || insightEditorState.tree.length === 0;
  }
}

function _clearInsightSlotErrorsIfFixed(slotEl, index) {
  if (!insightEditorState.errors[index]) {
    return;
  }
  const { errors } = validateInsightCardDrafts([insightEditorState.drafts[index]]);
  const remaining = errors[0] || [];
  if (remaining.length === 0) {
    delete insightEditorState.errors[index];
  } else {
    insightEditorState.errors[index] = remaining;
  }
  slotEl.classList.toggle('has-error', remaining.length > 0);
  slotEl.querySelector('[data-role="error"]').innerHTML = _renderInsightSlotErrors(remaining);
}

function _showInsightEditorStatus(kind, message, autoClear) {
  const root = _insightEditorRoot();
  const statusEl = root && root.querySelector('[data-role="status"]');
  if (!statusEl) {
    return;
  }
  clearTimeout(insightEditorState.statusTimer);
  statusEl.innerHTML = message
    ? `<div class="message ${kind}">${escapeHtml(message)}</div>`
    : '';
  if (autoClear) {
    insightEditorState.statusTimer = setTimeout(() => {
      statusEl.innerHTML = '';
    }, INSIGHT_EDITOR_STATUS_CLEAR_MS);
  }
}

// ── Event handling ────────────────────────────────────────────

/**
 * Wires the editor's controls. Call once each time the settings card is
 * rendered into the page.
 */
function bindInsightCardEditor() {
  const root = _insightEditorRoot();
  if (!root) {
    return;
  }

  root.addEventListener('input', _handleInsightEditorInput);
  root.addEventListener('change', _handleInsightEditorChange);
  root.addEventListener('click', _handleInsightEditorClick);
  // toggle does not bubble, so listen in the capture phase.
  root.addEventListener('toggle', _handleInsightPickerToggle, true);
}

function _slotContext(target) {
  const slotEl = target.closest('.insight-slot');
  if (!slotEl) {
    return null;
  }
  const index = Number(slotEl.dataset.slot);
  return { slotEl, index, draft: insightEditorState.drafts[index] };
}

function _handleInsightEditorInput(event) {
  const context = _slotContext(event.target);
  if (!context || !context.draft) {
    return;
  }
  const field = event.target.dataset.field;

  if (field === 'name') {
    context.draft.name = event.target.value;
    context.slotEl.querySelector('[data-role="name-count"]').textContent =
      `${event.target.value.length}/${INSIGHT_EDITOR_NAME_MAX_LENGTH}`;
    _clearInsightSlotErrorsIfFixed(context.slotEl, context.index);
    _refreshInsightEditorFooter();
  } else if (field === 'filter') {
    insightEditorState.filters[context.draft.key] = event.target.value;
    _applyInsightPickerFilter(context.slotEl);
  }
}

function _handleInsightEditorChange(event) {
  const input = event.target;
  if (input.type !== 'checkbox' || !input.dataset.kind) {
    return;
  }
  const context = _slotContext(input);
  if (!context || !context.draft) {
    return;
  }

  if (input.dataset.kind === 'primary') {
    setInsightDraftPrimary(context.draft, input.dataset.value, input.checked);
  } else {
    setInsightDraftDetail(context.draft, input.dataset.value, input.checked);
  }

  _syncInsightSlot(context.slotEl, context.draft);
  _clearInsightSlotErrorsIfFixed(context.slotEl, context.index);
  _refreshInsightEditorFooter();
}

function _handleInsightPickerToggle(event) {
  const picker = event.target;
  if (!picker.matches || !picker.matches('details[data-role="picker"]')) {
    return;
  }
  const context = _slotContext(picker);
  if (!context || !context.draft) {
    return;
  }
  if (picker.open) {
    insightEditorState.openPickerKeys.add(context.draft.key);
  } else {
    insightEditorState.openPickerKeys.delete(context.draft.key);
  }
}

function _handleInsightEditorClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl || actionEl.disabled) {
    return;
  }

  switch (actionEl.dataset.action) {
    case 'add-card':
      _addInsightCard();
      break;
    case 'remove-card':
      _removeInsightCard(_slotContext(actionEl));
      break;
    case 'remove-member':
      _removeInsightMember(actionEl);
      break;
    case 'discard':
      _discardInsightChanges();
      break;
    case 'save':
      saveInsightCards();
      break;
    default:
      break;
  }
}

function _addInsightCard() {
  if (insightEditorState.drafts.length >= INSIGHT_EDITOR_CARD_LIMIT) {
    return;
  }
  const draft = createInsightCardDraft();
  insightEditorState.drafts.push(draft);
  insightEditorState.openPickerKeys.add(draft.key);
  _renderInsightEditor();

  const nameInput = document.getElementById(`insight-slot-name-${draft.key}`);
  if (nameInput) {
    nameInput.focus();
  }
}

function _removeInsightCard(context) {
  if (!context) {
    return;
  }
  insightEditorState.drafts.splice(context.index, 1);
  insightEditorState.openPickerKeys.delete(context.draft.key);
  delete insightEditorState.filters[context.draft.key];
  // Error messages are stored by position, so re-check what is left.
  _revalidateShownInsightErrors();
  _rebuildInsightCategoryTree();
  _renderInsightEditor();
}

function _removeInsightMember(buttonEl) {
  const context = _slotContext(buttonEl);
  if (!context || !context.draft) {
    return;
  }
  if (buttonEl.dataset.kind === 'primary') {
    setInsightDraftPrimary(context.draft, buttonEl.dataset.value, false);
  } else {
    setInsightDraftDetail(context.draft, buttonEl.dataset.value, false);
  }
  _syncInsightSlot(context.slotEl, context.draft);
  _clearInsightSlotErrorsIfFixed(context.slotEl, context.index);
  _refreshInsightEditorFooter();
}

function _revalidateShownInsightErrors() {
  if (Object.keys(insightEditorState.errors).length === 0) {
    return;
  }
  insightEditorState.errors = validateInsightCardDrafts(insightEditorState.drafts).errors;
}

function _discardInsightChanges() {
  insightEditorState.drafts = createInsightCardDrafts(insightEditorState.savedCards);
  insightEditorState.openPickerKeys = new Set();
  insightEditorState.filters = {};
  insightEditorState.errors = {};
  _rebuildInsightCategoryTree();
  _renderInsightEditor();
}

/**
 * Validates the drafts and, if they pass, saves the whole card list. A
 * rejected save shows the server's own message.
 */
async function saveInsightCards() {
  if (insightEditorState.saving) {
    return;
  }

  const { cards, errors, valid } = validateInsightCardDrafts(insightEditorState.drafts);
  insightEditorState.errors = errors;
  if (!valid) {
    _renderInsightEditor();
    _showInsightEditorStatus('error', 'Fix the cards marked below, then save.', false);
    return;
  }

  insightEditorState.saving = true;
  _refreshInsightEditorFooter();

  // Inputs stay live during the request, so edits made meanwhile must survive.
  const draftsAtSend = JSON.stringify(insightEditorState.drafts);
  const { prefs, error } = await _patchPreferencesForResult({ insightCards: cards });
  insightEditorState.saving = false;

  if (!prefs) {
    _refreshInsightEditorFooter();
    _showInsightEditorStatus('error', error || 'Failed to save. Try again.', false);
    return;
  }

  insightEditorState.savedCards = Array.isArray(prefs.insightCards) ? prefs.insightCards : cards;
  if (JSON.stringify(insightEditorState.drafts) !== draftsAtSend) {
    _refreshInsightEditorFooter();
    _showInsightEditorStatus('success', 'Insight cards saved. Your newer edits are not saved yet.', false);
    return;
  }
  insightEditorState.drafts = createInsightCardDrafts(insightEditorState.savedCards);
  insightEditorState.openPickerKeys = new Set();
  insightEditorState.filters = {};
  insightEditorState.errors = {};
  _rebuildInsightCategoryTree();
  _renderInsightEditor();
  _showInsightEditorStatus('success', 'Insight cards saved.', true);
}
