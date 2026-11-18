// ============================================================
// categories/mappings.js — Plaid → User Category Mappings
// Rendering, saving, clearing, and primary-mapping logic for
// both detailed and primary category mappings.
// ============================================================

// ── Detailed Mapping List ───────────────────────────────────

function renderMappingsList(filterText = '') {
  const container = document.getElementById('mappings-list');
  const filter = (filterText || '').toLowerCase().trim();
  const entries = Object.entries(categoryMappings || {}).sort((a, b) => a[0].localeCompare(b[0]));

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No mappings yet.</div>';
    return;
  }

  const rows = entries
    .filter(([plaidCat, userLabel]) => {
      if (!filter) return true;
      return plaidCat.toLowerCase().includes(filter) || (userLabel || '').toLowerCase().includes(filter);
    })
    .filter(([plaidCat]) => {
      if (selectedDetailedPrimaryFilter === '__all__') return true;
      const taxonomyEntry = plaidTaxonomy.find(entry => entry.detailed === plaidCat);
      const primaryDisplay = getPrimaryDisplayForDetailed(plaidCat, taxonomyEntry);
      return primaryDisplay === selectedDetailedPrimaryFilter;
    })
    .map(([plaidCat, userLabel]) => {
      const taxonomyEntry = plaidTaxonomy.find(entry => entry.detailed === plaidCat);
      const displayNames = getCategoryDisplayNames(taxonomyEntry || { detailed: plaidCat });
      const displayKey = displayNames.full || formatPlaidCategory(plaidCat);

      const lockedKey = findLockedKey(plaidCat, lockedLabels);
      if (lockedKey) return _buildLockedMappingRow(plaidCat, displayKey, lockedKey);

      const options = buildDetailedOptionsForCategory(plaidCat, userLabel);

      return `
        <div class="mapping-row" data-plaid-category="${escapeHtml(plaidCat)}">
          <div class="mapping-key" title="${escapeHtml(plaidCat)}">${escapeHtml(displayKey)}</div>
          <select class="mapping-value" data-plaid-category="${escapeHtml(plaidCat)}">${options}</select>
          <button class="secondary mapping-clear" onclick="clearMapping('${escapeHtml(plaidCat)}')">Clear</button>
        </div>
      `;
    })
    .join('');

  container.innerHTML = rows || '<div class="empty-state">No mappings match your filter.</div>';

  // A locked key shows its reason on a tap, a click, or keyboard focus.
  container.querySelectorAll('[data-lock-message]').forEach(element => {
    const message = element.getAttribute('data-lock-message');
    element.addEventListener('click', () => showStatus(message, 'warning'));
    element.addEventListener('focus', () => showStatus(message, 'warning'));
  });

  container.querySelectorAll('.mapping-value').forEach(select => {
    select.addEventListener('change', event => {
      const plaidCat = event.target.getAttribute('data-plaid-category');
      if (!plaidCat) return;
      const value = event.target.value;
      const taxonomyEntry = plaidTaxonomy.find(entry => entry.detailed === plaidCat);
      const displayNames = getCategoryDisplayNames(taxonomyEntry || { detailed: plaidCat });
      const originalDisplay = displayNames.full || formatPlaidCategory(plaidCat);
      if (value === plaidCat) {
        categoryMappings[plaidCat] = originalDisplay;
      } else {
        categoryMappings[plaidCat] = value;
      }
    });
  });
}

/**
 * One mapping row for a key the app has locked: its label greyed and not
 * editable, with the API's reason on hover, tap and focus.
 */
function _buildLockedMappingRow(plaidCat, displayKey, lockedKey) {
  const message = escapeHtml(lockedKey.message);
  return `
        <div class="mapping-row is-locked" data-plaid-category="${escapeHtml(plaidCat)}">
          <div class="mapping-key" title="${escapeHtml(plaidCat)}">${escapeHtml(displayKey)}</div>
          <div class="mapping-locked-value" tabindex="0" role="note" data-lock-message="${message}" title="${message}">${escapeHtml(lockedKey.label)}</div>
          <button type="button" class="secondary is-locked mapping-clear" data-lock-message="${message}" aria-disabled="true" title="${message}">Clear</button>
        </div>
      `;
}

// ── Primary Mapping List ────────────────────────────────────

/**
 * The locked entry for a key under a Plaid primary, if it holds one. Such a
 * primary cannot be remapped as a whole; its other keys can, one at a time.
 */
function _lockedKeyUnderPlaidPrimary(plaidPrimaryDisplay) {
  return lockedKeyUnderPlaidPrimary(
    plaidPrimaryDisplay, plaidTaxonomy, lockedLabels, formatPlaidCategory
  );
}

/** The sentence a locked Plaid primary's row shows. */
function _lockedPrimaryMappingMessage(plaidPrimaryDisplay, lockedKey) {
  return `${plaidPrimaryDisplay} can't be remapped as a whole, because "${lockedKey.label}" is the app's own label and stays where it is. `
    + `Remap the other ${plaidPrimaryDisplay} categories one at a time in the detailed list.`;
}

/**
 * One primary row for a Plaid primary that holds a locked key: greyed and
 * not editable, with the reason on hover, tap and focus.
 */
function _buildLockedPrimaryMappingRow(plaidPrimaryDisplay, lockedKey) {
  const message = escapeHtml(_lockedPrimaryMappingMessage(plaidPrimaryDisplay, lockedKey));
  return `
        <div class="mapping-row is-locked" data-plaid-primary="${escapeHtml(plaidPrimaryDisplay)}">
          <div class="mapping-key">${escapeHtml(plaidPrimaryDisplay)}</div>
          <div class="mapping-locked-value" tabindex="0" role="note" data-lock-message="${message}" title="${message}">Set one at a time</div>
          <button type="button" class="secondary is-locked mapping-clear" data-lock-message="${message}" aria-disabled="true" title="${message}">Clear</button>
        </div>
      `;
}

function renderPrimaryMappingsList() {
  const container = document.getElementById('primary-mappings-list');
  if (!container) return;

  const plaidPrimaries = getPlaidPrimaryDisplayList();
  if (!plaidPrimaries.length) {
    container.innerHTML = '<div class="empty-state">No primary categories found.</div>';
    return;
  }

  const targetOptions = buildPrimaryCategoryOptions();

  container.innerHTML = plaidPrimaries
    .map(primary => {
      const lockedKey = _lockedKeyUnderPlaidPrimary(primary);
      if (lockedKey) return _buildLockedPrimaryMappingRow(primary, lockedKey);

      const selected = primaryCategoryMappings[primary] || '';
      return `
        <div class="mapping-row" data-plaid-primary="${escapeHtml(primary)}">
          <div class="mapping-key">${escapeHtml(primary)}</div>
          <select class="mapping-value" data-plaid-primary="${escapeHtml(primary)}">
            ${targetOptions(primary, selected)}
          </select>
          <button class="secondary mapping-clear" onclick="clearPrimaryMapping('${escapeHtml(primary)}')">Clear</button>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('[data-lock-message]').forEach(element => {
    const message = element.getAttribute('data-lock-message');
    element.addEventListener('click', () => showStatus(message, 'warning'));
    element.addEventListener('focus', () => showStatus(message, 'warning'));
  });

  container.querySelectorAll('.mapping-value').forEach(select => {
    select.addEventListener('change', event => {
      const plaidPrimary = event.target.getAttribute('data-plaid-primary');
      if (!plaidPrimary) return;
      const value = (event.target.value || '').trim();
      if (value) {
        primaryCategoryMappings[plaidPrimary] = value;
      } else {
        delete primaryCategoryMappings[plaidPrimary];
      }
      applyPrimaryMapping(plaidPrimary, value);
      renderMappingsList(document.getElementById('mapping-filter').value);
    });
  });
}

// ── Detailed-Mapping Primary Filter ─────────────────────────

function renderDetailedMappingFilterOptions() {
  const select = document.getElementById('detailed-mapping-primary-filter');
  if (!select) return;

  const primaries = getPlaidPrimaryDisplayList();
  const options = ['__all__', ...primaries];

  if (!options.includes(selectedDetailedPrimaryFilter)) {
    selectedDetailedPrimaryFilter = '__all__';
  }

  select.innerHTML = options
    .map(primary => {
      const label = primary === '__all__' ? 'All primaries' : primary;
      return `<option value="${escapeHtml(primary)}" ${primary === selectedDetailedPrimaryFilter ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');

  select.addEventListener('change', () => {
    selectedDetailedPrimaryFilter = select.value || '__all__';
    renderMappingsList(document.getElementById('mapping-filter').value);
  });
}

// ── Clear & Save ────────────────────────────────────────────

function clearMapping(plaidCategory) {
  if (findLockedKey(plaidCategory, lockedLabels)) return;
  const row = document.querySelector(`.mapping-row[data-plaid-category="${plaidCategory}"]`);
  if (row) {
    const select = row.querySelector('.mapping-value');
    if (select) select.value = plaidCategory;
  }
  const taxonomyEntry = plaidTaxonomy.find(entry => entry.detailed === plaidCategory);
  const displayNames = getCategoryDisplayNames(taxonomyEntry || { detailed: plaidCategory });
  categoryMappings[plaidCategory] = displayNames.full || formatPlaidCategory(plaidCategory);
}

function clearPrimaryMapping(plaidPrimary) {
  if (_lockedKeyUnderPlaidPrimary(plaidPrimary)) return;
  delete primaryCategoryMappings[plaidPrimary];
  applyPrimaryMapping(plaidPrimary, '');
  renderPrimaryMappingsList();
  renderMappingsList(document.getElementById('mapping-filter').value);
}

async function _putCategoryMappings(body) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/mappings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { response, data };
}

async function _finishMappingsSave(message) {
  markTransactionCacheStale();
  if (message === 'Mappings saved') {
    showStatus(message, 'success');
  } else {
    // The reload below posts its own status messages, which would replace a
    // toast before the user reads what moved.
    showResultBanner(message);
  }
  await loadCategorizationData(true);
  setTimeout(() => clearStatus(), 2000);
}

async function saveCategoryMappings() {
  try {
    // Use the in-memory categoryMappings — ensures ALL mappings are saved,
    // not just the currently visible (filtered) ones
    const editedMappings = {};
    Object.entries(categoryMappings || {}).forEach(([key, value]) => {
      const trimmedValue = (value || '').trim();
      if (trimmedValue) {
        editedMappings[key] = trimmedValue;
      }
    });
    // The page never edits a locked key, but the primary pickers rewrite every
    // key under a Plaid primary, so those values are put back before sending.
    const newMappings = withLockedMappingsKept(editedMappings, lockedLabels);

    const { response, data } = await _putCategoryMappings({ category_mappings: newMappings });
    if (!response.ok) {
      const questions = readMappingQuestions(data);
      if (response.status === 400 && (questions.labels.length > 0 || questions.keys.length > 0)) {
        openMappingAnswersModal(newMappings, questions);
        return;
      }
      showStatus(data.error || 'Failed to save mappings', 'error');
      return;
    }

    // A rename in effect moves a label's records without a question, so the
    // result says what moved.
    await _finishMappingsSave(summarizeAnswerResult(data));
  } catch (networkError) {
    showStatus(`Failed to save mappings: ${networkError.message}`, 'error');
  }
}

// ── Needs-an-answer dialog ──────────────────────────────────

/**
 * Labels the edited list still offers, used as merge targets.
 * @param {Object} newMappings
 * @param {Array} questions
 * @returns {string[]}
 */
function _mergeTargetLabels(newMappings, questions) {
  const leaving = new Set(questions.labels.map(item => item.label));
  const listed = new Set([...Object.values(newMappings), ...(customCategories || [])]);
  return Array.from(listed)
    .filter(label => label && !leaving.has(label))
    .sort((a, b) => a.localeCompare(b));
}

function _inspectLinkHTML(query, count) {
  if (!(Number(count) > 0)) return '';
  const link = buildInspectLink(query, count);
  return `<a class="inspect-link" href="${escapeHtml(link.href)}" target="_blank" rel="noopener">${escapeHtml(link.text)}</a>`;
}

function _keepOnlyQuestionHTML(item, index) {
  const reason = item.keep_only_reason
    ? `<div class="answer-reason">${escapeHtml(item.keep_only_reason)}</div>`
    : '';
  return `
    <div class="answer-item" data-label-index="${index}">
      <div class="answer-title"><strong>${escapeHtml(item.label)}</strong> is leaving your list.
        It is used by ${escapeHtml(describeUsageCounts(item))}.
        ${_inspectLinkHTML(buildInspectQuery(item.label), item.transactions)}</div>
      ${reason}
      <label class="answer-choice">
        <input type="radio" name="label-answer-${index}" value="keep" checked>
        Keep as a custom category (its Plaid transactions get an override so they keep it)
      </label>
    </div>`;
}

function _labelQuestionHTML(item, index, targets) {
  if (item.keep_only === true) return _keepOnlyQuestionHTML(item, index);
  const options = ['<option value="">Choose a category…</option>']
    .concat(targets.map(label => (
      `<option value="${escapeHtml(label)}" ${label === item.suggested_target ? 'selected' : ''}>${escapeHtml(label)}</option>`
    ))).join('');
  return `
    <div class="answer-item" data-label-index="${index}">
      <div class="answer-title"><strong>${escapeHtml(item.label)}</strong> is leaving your list.
        It is used by ${escapeHtml(describeUsageCounts(item))}.
        ${_inspectLinkHTML(buildInspectQuery(item.label), item.transactions)}</div>
      <label class="answer-choice">
        <input type="radio" name="label-answer-${index}" value="merge">
        Merge into
        <select class="modal-input answer-target">${options}</select>
      </label>
      <label class="answer-choice">
        <input type="radio" name="label-answer-${index}" value="keep">
        Keep as a custom category (its Plaid transactions get an override so they keep it)
      </label>
    </div>`;
}

function _pastRowsQuestionHTML(item, index) {
  const count = Number(item.transactions) || 0;
  return `
    <div class="answer-item" data-key-index="${index}">
      <div class="answer-title">${count} past ${count === 1 ? 'transaction' : 'transactions'} from
        <strong>${escapeHtml(item.key)}</strong> ${count === 1 ? 'is' : 'are'} labeled
        <strong>${escapeHtml(item.from)}</strong>; the mapping now gives <strong>${escapeHtml(item.to)}</strong>.
        ${_inspectLinkHTML(buildInspectQuery(item.from, item.key), item.transactions)}</div>
      <label class="answer-choice">
        <input type="radio" name="key-answer-${index}" value="move">
        Move them to ${escapeHtml(item.to)}
      </label>
      <label class="answer-choice">
        <input type="radio" name="key-answer-${index}" value="keep">
        Keep them on ${escapeHtml(item.from)} (each gets an override)
      </label>
    </div>`;
}

/**
 * Ask what to do with the labels and past rows the edit would strand, then
 * resend the same mappings with the answers.
 */
function openMappingAnswersModal(newMappings, questions) {
  const targets = _mergeTargetLabels(newMappings, questions);
  const body = `<p>${escapeHtml(describeMappingQuestions(questions))} Choose what happens to each.</p>`
    + '<div id="mapping-answers-error" class="answer-error"></div>'
    + '<div class="answer-list">'
    + questions.labels.map((item, i) => _labelQuestionHTML(item, i, targets)).join('')
    + questions.keys.map((item, i) => _pastRowsQuestionHTML(item, i)).join('')
    + '</div>';

  openModal({
    title: 'Where should these go?',
    body,
    actions: [
      { label: 'Cancel', onClick: closeModal },
      { label: 'Save', className: 'answer-save-btn', onClick: () => submitMappingAnswers(newMappings, questions) },
    ],
  });

  const bodyElement = document.getElementById('modal-body');
  const saveButton = document.querySelector('#modal-actions .answer-save-btn');
  const refreshSaveButton = () => {
    const { labelAnswers, pastRowAnswers } = _readMappingAnswers(questions);
    saveButton.disabled = !allQuestionsAnswered(questions, labelAnswers, pastRowAnswers);
  };
  refreshSaveButton();
  bodyElement.addEventListener('change', refreshSaveButton);
}

function _readMappingAnswers(questions) {
  const labelAnswers = seedKeepOnlyAnswers(questions);
  questions.labels.forEach((item, i) => {
    const checked = document.querySelector(`input[name="label-answer-${i}"]:checked`);
    if (!checked) return;
    const select = document.querySelector(`[data-label-index="${i}"] .answer-target`);
    labelAnswers[item.label] = { choice: checked.value, target: select ? select.value : '' };
  });
  const pastRowAnswers = {};
  questions.keys.forEach((item, i) => {
    const checked = document.querySelector(`input[name="key-answer-${i}"]:checked`);
    if (checked) pastRowAnswers[item.key] = checked.value;
  });
  return { labelAnswers, pastRowAnswers };
}

async function submitMappingAnswers(newMappings, questions) {
  const { labelAnswers, pastRowAnswers } = _readMappingAnswers(questions);
  if (!allQuestionsAnswered(questions, labelAnswers, pastRowAnswers)) return;

  const errorBox = document.getElementById('mapping-answers-error');
  const saveButton = document.querySelector('#modal-actions .answer-save-btn');
  errorBox.textContent = '';
  saveButton.disabled = true;
  try {
    const payload = buildMappingAnswersPayload(newMappings, questions, labelAnswers, pastRowAnswers);
    const { response, data } = await _putCategoryMappings(payload);
    if (!response.ok) {
      errorBox.textContent = data.error || 'Failed to save mappings';
      saveButton.disabled = false;
      return;
    }
    closeModal();
    await _finishMappingsSave(summarizeAnswerResult(data));
  } catch (networkError) {
    errorBox.textContent = `Failed to save mappings: ${networkError.message}`;
    saveButton.disabled = false;
  }
}

// ── Primary Mapping Derivation & Application ────────────────

function derivePrimaryMappingsFromDetailedMappings() {
  const primaryBuckets = {};

  (plaidTaxonomy || []).forEach(cat => {
    const displayPrimary = formatPlaidCategory(cat.primary || '');
    if (!displayPrimary) return;
    const mapped = categoryMappings[cat.detailed];
    if (!mapped) return;
    const parsed = parseCategoryName(mapped);
    if (!parsed.primary) return;
    if (!primaryBuckets[displayPrimary]) primaryBuckets[displayPrimary] = new Set();
    primaryBuckets[displayPrimary].add(parsed.primary);
  });

  primaryCategoryMappings = {};
  Object.keys(primaryBuckets).forEach(primary => {
    const values = Array.from(primaryBuckets[primary]);
    if (values.length === 1 && values[0] && values[0] !== primary) {
      primaryCategoryMappings[primary] = values[0];
    }
  });
}

function applyPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay) {
  if (_lockedKeyUnderPlaidPrimary(plaidPrimaryDisplay)) return;
  const targetPrimary = targetPrimaryDisplay || plaidPrimaryDisplay;

  (plaidTaxonomy || [])
    .filter(cat => formatPlaidCategory(cat.primary || '') === plaidPrimaryDisplay)
    .forEach(cat => {
      const displayNames = getCategoryDisplayNames(cat);
      const detailed = displayNames.trimmed || '';
      if (findLockedKey(cat.detailed, lockedLabels)) return;
      const newLabel = detailed ? `${targetPrimary}: ${detailed}` : targetPrimary;
      categoryMappings[cat.detailed] = newLabel;
    });
}
