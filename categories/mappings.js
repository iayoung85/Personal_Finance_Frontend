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

// ── Primary Mapping List ────────────────────────────────────

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

async function _finishMappingsSave(previousMappings, message) {
  markTransactionCacheStale();
  if (message === 'Mappings saved') {
    showStatus(message, 'success');
  } else {
    // The reload below posts its own status messages, which would replace a
    // toast before the user reads what moved.
    showResultBanner(message);
  }
  await _reconcileCustomCategoriesForPrimaryMappings(previousMappings, primaryCategoryMappings);
  await loadCategorizationData(true);
  setTimeout(() => clearStatus(), 2000);
}

async function saveCategoryMappings() {
  try {
    const previousMappings = await _fetchServerPrimaryMappings();
    // Use the in-memory categoryMappings — ensures ALL mappings are saved,
    // not just the currently visible (filtered) ones
    const newMappings = {};
    Object.entries(categoryMappings || {}).forEach(([key, value]) => {
      const trimmedValue = (value || '').trim();
      if (trimmedValue) {
        newMappings[key] = trimmedValue;
      }
    });

    const { response, data } = await _putCategoryMappings({ category_mappings: newMappings });
    if (!response.ok) {
      const questions = readMappingQuestions(data);
      if (response.status === 400 && (questions.labels.length > 0 || questions.keys.length > 0)) {
        openMappingAnswersModal(newMappings, questions, previousMappings);
        return;
      }
      showStatus(data.error || 'Failed to save mappings', 'error');
      return;
    }

    await _finishMappingsSave(previousMappings, 'Mappings saved');
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

function _labelQuestionHTML(item, index, targets) {
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
function openMappingAnswersModal(newMappings, questions, previousMappings) {
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
      { label: 'Save', className: 'answer-save-btn', onClick: () => submitMappingAnswers(newMappings, questions, previousMappings) },
    ],
  });

  const bodyElement = document.getElementById('modal-body');
  const saveButton = document.querySelector('#modal-actions .answer-save-btn');
  saveButton.disabled = true;
  bodyElement.addEventListener('change', () => {
    const { labelAnswers, pastRowAnswers } = _readMappingAnswers(questions);
    saveButton.disabled = !allQuestionsAnswered(questions, labelAnswers, pastRowAnswers);
  });
}

function _readMappingAnswers(questions) {
  const labelAnswers = {};
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

async function submitMappingAnswers(newMappings, questions, previousMappings) {
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
    await _finishMappingsSave(previousMappings, summarizeAnswerResult(data));
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

function _derivePrimaryMappingsFromMappings(mappings) {
  const primaryBuckets = {};

  (plaidTaxonomy || []).forEach(cat => {
    const displayPrimary = formatPlaidCategory(cat.primary || '');
    if (!displayPrimary) return;
    const mapped = mappings ? mappings[cat.detailed] : null;
    if (!mapped) return;
    const parsed = parseCategoryName(mapped);
    if (!parsed.primary) return;
    if (!primaryBuckets[displayPrimary]) primaryBuckets[displayPrimary] = new Set();
    primaryBuckets[displayPrimary].add(parsed.primary);
  });

  const derived = {};
  Object.keys(primaryBuckets).forEach(primary => {
    const values = Array.from(primaryBuckets[primary]);
    if (values.length === 1 && values[0] && values[0] !== primary) {
      derived[primary] = values[0];
    }
  });

  return derived;
}

function applyPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay) {
  const targetPrimary = targetPrimaryDisplay || plaidPrimaryDisplay;

  (plaidTaxonomy || [])
    .filter(cat => formatPlaidCategory(cat.primary || '') === plaidPrimaryDisplay)
    .forEach(cat => {
      const displayNames = getCategoryDisplayNames(cat);
      const detailed = displayNames.trimmed || '';
      const newLabel = detailed ? `${targetPrimary}: ${detailed}` : targetPrimary;
      categoryMappings[cat.detailed] = newLabel;
    });
}

// ── Reconciliation Helpers (sync custom categories when primary mapping changes) ──

async function _fetchServerPrimaryMappings() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories`);
    const data = await response.json();
    if (!response.ok) {
      return {};
    }
    const mappings = data.category_mappings || {};
    return _derivePrimaryMappingsFromMappings(mappings);
  } catch (fetchError) {
    console.warn('Failed to fetch previous mappings:', fetchError);
    return {};
  }
}

async function _reconcileCustomCategoriesForPrimaryMappings(previousMappings, currentMappings) {
  const previous = previousMappings || {};
  const current = currentMappings || {};

  const toRemove = [];
  Object.entries(previous).forEach(([plaidPrimaryDisplay, prevTarget]) => {
    const currentTarget = current[plaidPrimaryDisplay];
    if (!currentTarget || currentTarget !== prevTarget) {
      toRemove.push([plaidPrimaryDisplay, prevTarget]);
    }
  });

  for (const [plaidPrimaryDisplay, prevTarget] of toRemove) {
    await _deleteCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, prevTarget);
  }

  const entries = Object.entries(current);
  for (const [plaidPrimaryDisplay, targetPrimaryDisplay] of entries) {
    await _ensureCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay);
  }
}

async function _ensureCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay) {
  if (!targetPrimaryDisplay || targetPrimaryDisplay === plaidPrimaryDisplay) return;
  if (!isCustomPrimary(targetPrimaryDisplay)) return;

  const existing = new Set(customCategories || []);
  const toCreate = [];

  (plaidTaxonomy || [])
    .filter(cat => formatPlaidCategory(cat.primary || '') === plaidPrimaryDisplay)
    .forEach(cat => {
      const displayNames = getCategoryDisplayNames(cat);
      const detailed = displayNames.trimmed || '';
      if (!detailed) return;
      const label = `${targetPrimaryDisplay}: ${detailed}`;
      if (!existing.has(label)) {
        existing.add(label);
        toCreate.push(label);
      }
    });

  if (!toCreate.length) return;

  for (const categoryName of toCreate) {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_name: categoryName })
      });
      const data = await response.json();
      if (!response.ok) {
        console.warn('Failed to add custom category:', data.error || categoryName);
        continue;
      }
      customCategories.push(categoryName);
      if (!availableCategories.includes(categoryName)) {
        availableCategories.push(categoryName);
      }
    } catch (networkError) {
      console.warn('Failed to add custom category:', networkError);
    }
  }

  renderCustomCategories();
  renderRuleFormOptions();
}

async function _deleteCustomDetailedCategoriesForPrimaryMapping(plaidPrimaryDisplay, targetPrimaryDisplay) {
  if (!targetPrimaryDisplay || targetPrimaryDisplay === plaidPrimaryDisplay) return;
  if (!isCustomPrimary(targetPrimaryDisplay)) return;

  const existing = new Set(customCategories || []);
  const toDelete = [];

  (plaidTaxonomy || [])
    .filter(cat => formatPlaidCategory(cat.primary || '') === plaidPrimaryDisplay)
    .forEach(cat => {
      const displayNames = getCategoryDisplayNames(cat);
      const detailed = displayNames.trimmed || '';
      if (!detailed) return;
      const label = `${targetPrimaryDisplay}: ${detailed}`;
      if (existing.has(label)) {
        toDelete.push(label);
      }
    });

  if (!toDelete.length) return;

  for (const categoryName of toDelete) {
    try {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/categorization/categories/${encodeURIComponent(categoryName)}?action=delete`,
        { method: 'DELETE' }
      );
      if (!response.ok) {
        const data = await response.json();
        console.warn('Failed to delete custom category:', data.error || categoryName);
        continue;
      }
      markTransactionCacheStale();
      customCategories = customCategories.filter(cat => cat !== categoryName);
      availableCategories = availableCategories.filter(cat => cat !== categoryName);
    } catch (networkError) {
      console.warn('Failed to delete custom category:', networkError);
    }
  }

  renderCustomCategories();
  renderRuleFormOptions();
}
