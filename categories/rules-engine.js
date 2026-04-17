// ============================================================
// categories/rules-engine.js — Rule CRUD & Broken-Rules
// Create, edit, delete, re-prioritise categorization rules.
// Includes broken-rules validation and fix-all modal.
// ============================================================

// ── Prefill from Transactions Page ──────────────────────────

/**
 * Called after categorization data loads. If sessionStorage has a rule
 * prefill payload (set by the transactions page Rule button), pre-fill
 * the rule form and show a context banner with the source transaction's
 * Plaid data so the user can see what the rule will match against.
 */
function applyRulePrefill() {
  const raw = sessionStorage.getItem('pf_rule_prefill');
  if (!raw) return;
  sessionStorage.removeItem('pf_rule_prefill');

  let prefill;
  try { prefill = JSON.parse(raw); } catch (parseError) { return; }

  // Pre-fill rule name
  const nameInput = document.getElementById('rule-name');
  if (nameInput) nameInput.value = prefill.defaultRuleName || '';

  // Pre-fill target category
  const targetSelect = document.getElementById('rule-target-category');
  if (targetSelect && prefill.targetCategory) {
    targetSelect.value = prefill.targetCategory;
  }

  // Clear default condition row and replace with prefilled one
  const container = document.getElementById('rule-conditions-container');
  if (container) {
    container.innerHTML = '';
    addConditionRow({
      match_type: prefill.defaultMatchType,
      match_value: prefill.defaultMatchValue,
    });
  }

  // Show the transaction context banner above the form
  _showPrefillBanner(prefill);

  // Scroll the rules card into view
  const rulesCard = document.getElementById('rules-card');
  if (rulesCard) {
    rulesCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function _showPrefillBanner(prefill) {
  const isManualTxn = prefill.txnSource === 'manual';
  const fmtAmount = prefill.txnAmount !== ''
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: prefill.txnCurrency || 'USD' }).format(prefill.txnAmount)
    : '\u2014';

  let fieldRows = '';
  if (isManualTxn) {
    fieldRows = `
      <tr><td class="prefill-label">User-Entered Merchant / Desc</td><td class="prefill-value">${escapeHtml(prefill.txnMerchant || prefill.txnName) || '<em>empty</em>'}</td></tr>
    `;
  } else {
    const overrideNote = (prefill.userOverride && prefill.userOverride !== prefill.txnName)
      ? `<br><span style="color: var(--text-muted); font-size: 0.85em;">You renamed this to: <strong>${escapeHtml(prefill.userOverride)}</strong></span>`
      : '';
    fieldRows = `
      <tr><td class="prefill-label">Plaid Name</td><td class="prefill-value">${escapeHtml(prefill.txnName) || '<em>empty</em>'}${overrideNote}</td></tr>
      <tr><td class="prefill-label">Plaid Merchant</td><td class="prefill-value">${escapeHtml(prefill.txnMerchant) || '<em>not available</em>'}</td></tr>
    `;
  }
  fieldRows += `<tr><td class="prefill-label">Amount</td><td class="prefill-value">${fmtAmount}</td></tr>`;

  if (prefill.accountDisplayName) {
    fieldRows += `<tr><td class="prefill-label">Account</td><td class="prefill-value">${escapeHtml(prefill.accountDisplayName)}</td></tr>`;
  }

  const banner = document.createElement('div');
  banner.className = 'rule-prefill-banner';
  banner.innerHTML = `
    <div class="prefill-header">
      <strong>Creating rule from transaction</strong>
      <button type="button" class="secondary prefill-dismiss" onclick="this.closest('.rule-prefill-banner').remove()" title="Dismiss">\u2715</button>
    </div>
    <table class="prefill-table">${fieldRows}</table>
    <small style="color: var(--text-muted);">
      ${isManualTxn
        ? 'Rules match against the merchant / description you entered.'
        : 'Rules match against the original Plaid blob data shown above, not any custom labels.'}
    </small>
  `;

  const form = document.querySelector('.rule-form');
  if (form) {
    form.parentElement.insertBefore(banner, form);
  }
}

// ── Render ──────────────────────────────────────────────────

function renderRuleFormOptions() {
  // Wire the shared category autocomplete onto the rule target input
  const targetInput = document.getElementById('rule-target-category');
  const targetList  = document.getElementById('rule-target-category-list');
  if (targetInput && targetList) {
    wireUpCategoryAutocomplete(targetInput, targetList, {
      categories: availableCategories || [],
      itemClass:  'rule-cat-ac-item',
      emptyClass: 'rule-cat-ac-empty',
      moreClass:  'rule-cat-ac-more',
      maxVisible: 10,
    });
  }

  // Bulk-actions selectors still use <select> dropdowns
  const options = buildCategoryOptions();
  const mergeTarget = document.getElementById('merge-target');
  if (mergeTarget) mergeTarget.innerHTML = options;
  const splitOld = document.getElementById('split-old');
  if (splitOld) splitOld.innerHTML = options;
  const renameOld = document.getElementById('rename-old');
  if (renameOld) renameOld.innerHTML = `<option value="">-- Select category to rename --</option>` + options;

  // Initialize condition rows if empty
  const container = document.getElementById('rule-conditions-container');
  if (container && container.children.length === 0) {
    addConditionRow();
  }
}

function _formatSingleConditionLabel(condition) {
  const typeLabel = CONDITION_TYPE_LABELS[condition.match_type] || condition.match_type || 'unknown';
  if (condition.match_type === 'amount_range' && typeof condition.match_value === 'object') {
    const min = condition.match_value.min != null ? `$${condition.match_value.min}` : 'any';
    const max = condition.match_value.max != null ? `$${condition.match_value.max}` : 'any';
    return `${typeLabel}: ${min} – ${max}`;
  }
  if (condition.match_type === 'account_is') {
    const account = ruleAccountOptions.find(a => a.account_id === condition.match_value);
    return `${typeLabel}: ${account ? account.display_name : condition.match_value}`;
  }
  return `${typeLabel}: ${condition.match_value || ''}`;
}

function _formatMatchLabel(match) {
  if (match.match_type === 'compound') {
    const parts = (match.conditions || []).map(_formatSingleConditionLabel);
    return parts.join(' AND ');
  }
  return _formatSingleConditionLabel(match);
}

function renderRulesTable() {
  const container = document.getElementById('rules-table');
  if (!rules.length) {
    container.innerHTML = '<div class="empty-state">No rules created yet.</div>';
    return;
  }

  // Sort by priority desc, then created_at asc so same-priority ties resolve
  // to oldest-created rule first (matches backend evaluation order).
  const sortedRules = rules.slice().sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });

  const supersededIds = _detectSupersededRules(sortedRules);

  const rows = sortedRules
    .map(rule => {
      const match = rule.match_criteria || {};
      const matchLabel = _formatMatchLabel(match);
      const createdLabel = rule.created_at
        ? new Date(rule.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';

      const conflict = supersededIds.get(rule.id);
      const conflictBadge = conflict
        ? `<span class="rule-conflict-badge" title="Always superseded by &quot;${escapeHtml(conflict.supersededByName)}&quot; (priority ${conflict.supersededByPriority}). This rule will never fire.">⚠</span>`
        : '';

      return `
        <tr class="${conflict ? 'rule-row-conflicted' : ''}">
          <td>${rule.priority || 0}</td>
          <td>${createdLabel}</td>
          <td>${escapeHtml(rule.rule_name || '')} ${conflictBadge}</td>
          <td>${escapeHtml(matchLabel)}</td>
          <td>${escapeHtml(rule.target_category || '')}</td>
          <td>${rule.is_active ? 'Yes' : 'No'}</td>
          <td>
            <div class="rules-actions">
              <button class="secondary" onclick="editRule(${rule.id})">Edit</button>
              <button class="secondary" onclick="adjustRulePriority(${rule.id}, 'up')">↑</button>
              <button class="secondary" onclick="adjustRulePriority(${rule.id}, 'down')">↓</button>
              <button class="secondary" onclick="confirmDeleteRule(${rule.id})">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Priority</th>
          <th>Created</th>
          <th>Name</th>
          <th>Match</th>
          <th>Target</th>
          <th>Active</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/**
 * Detect rules that will never fire because a higher-priority rule
 * always matches the same (or broader) set of transactions.
 *
 * A rule A supersedes rule B when:
 *   - A is evaluated before B (higher priority, or same priority + created earlier)
 *   - Every condition in A is also satisfied by any transaction that matches B
 *     (A's conditions are a subset of B's conditions)
 *
 * Returns a Map of rule_id → { supersededByName, supersededByPriority }.
 */
function _detectSupersededRules(sortedRules) {
  const result = new Map();

  for (let higherIndex = 0; higherIndex < sortedRules.length; higherIndex++) {
    for (let lowerIndex = higherIndex + 1; lowerIndex < sortedRules.length; lowerIndex++) {
      const higherRule = sortedRules[higherIndex];
      const lowerRule = sortedRules[lowerIndex];

      // Skip inactive rules — they don't fire so can't conflict
      if (!higherRule.is_active) continue;

      // Only flag the lower rule once (the highest-priority superseder wins)
      if (result.has(lowerRule.id)) continue;

      if (_ruleSubsumes(higherRule, lowerRule)) {
        result.set(lowerRule.id, {
          supersededByName: higherRule.rule_name,
          supersededByPriority: higherRule.priority || 0,
        });
      }
    }
  }

  return result;
}

/** Returns true if every transaction that matches ruleB would also match ruleA. */
function _ruleSubsumes(ruleA, ruleB) {
  const conditionsA = _normalizeToConditions(ruleA.match_criteria);
  const conditionsB = _normalizeToConditions(ruleB.match_criteria);
  if (conditionsA.length === 0) return false;
  // A subsumes B when all of A's conditions are covered by B's conditions.
  // (B is more specific — it has A's conditions plus extras.)
  return conditionsA.every(condA => conditionsB.some(condB => _conditionACoversB(condA, condB)));
}

function _normalizeToConditions(criteria) {
  if (!criteria) return [];
  if (criteria.match_type === 'compound') return criteria.conditions || [];
  return [criteria];
}

const _TEXT_CONTAINS_TYPES = new Set(['merchant_contains', 'name_contains']);

/**
 * True when condition A is at least as broad as condition B (same match_type).
 * - Text "contains" types: A covers B if A's search string appears inside B's
 *   search string (case-insensitive). A shorter needle matches more haystacks.
 * - amount_range: A covers B if A's range fully contains B's range.
 * - Everything else (plaid_category, account_is, regex): exact equality.
 */
function _conditionACoversB(a, b) {
  if (a.match_type !== b.match_type) return false;

  if (a.match_type === 'amount_range') {
    const aMin = a.match_value?.min ?? 0;
    const aMax = a.match_value?.max ?? Infinity;
    const bMin = b.match_value?.min ?? 0;
    const bMax = b.match_value?.max ?? Infinity;
    return aMin <= bMin && aMax >= bMax;
  }

  const aVal = typeof a.match_value === 'string' ? a.match_value.toLowerCase() : JSON.stringify(a.match_value);
  const bVal = typeof b.match_value === 'string' ? b.match_value.toLowerCase() : JSON.stringify(b.match_value);

  if (_TEXT_CONTAINS_TYPES.has(a.match_type)) {
    // "Generation" covers "GENERATION NEXT" because any merchant containing
    // "generation next" also contains "generation".
    return bVal.includes(aVal);
  }

  return aVal === bVal;
}

// ── CRUD ────────────────────────────────────────────────────

/**
 * Build the match_criteria payload from the condition rows in the form.
 * Single-condition rules use the flat format for backward compatibility.
 * Multi-condition rules use the compound format.
 */
function _buildMatchCriteriaFromForm() {
  const rows = document.querySelectorAll('.condition-row');
  const conditions = [];

  for (const row of rows) {
    const matchType = row.querySelector('.condition-match-type').value;
    const rawValue = row.querySelector('.condition-match-value')?.value?.trim() ?? '';
    const caseSensitive = row.querySelector('.condition-case-sensitive')?.checked ?? false;

    if (!matchType) continue;

    let matchValue;
    if (matchType === 'amount_range') {
      const minInput = row.querySelector('.condition-amount-min');
      const maxInput = row.querySelector('.condition-amount-max');
      const min = minInput?.value !== '' ? parseFloat(minInput.value) : undefined;
      const max = maxInput?.value !== '' ? parseFloat(maxInput.value) : undefined;
      if (min === undefined && max === undefined) continue;
      matchValue = {};
      if (min !== undefined) matchValue.min = min;
      if (max !== undefined) matchValue.max = max;
    } else if (matchType === 'account_is') {
      const accountSelect = row.querySelector('.condition-account-select');
      matchValue = accountSelect?.value || '';
    } else {
      if (!rawValue) continue;
      matchValue = rawValue;
    }

    const condition = { match_type: matchType, match_value: matchValue };
    if (caseSensitive && ['merchant_contains', 'name_contains'].includes(matchType)) {
      condition.case_sensitive = true;
    }
    conditions.push(condition);
  }

  if (conditions.length === 0) return null;

  // Single condition: use flat format (backward compat with existing rules)
  if (conditions.length === 1) return conditions[0];

  return {
    match_type: 'compound',
    conditions,
  };
}

async function saveRule() {
  const ruleName = document.getElementById('rule-name').value.trim();
  const targetCategory = document.getElementById('rule-target-category').value;
  const priority = parseInt(document.getElementById('rule-priority').value || '0', 10);
  const isActive = document.getElementById('rule-active').checked;

  const matchCriteria = _buildMatchCriteriaFromForm();

  if (!ruleName || !matchCriteria || !targetCategory) {
    showStatus('Fill in rule name, at least one condition, and target category', 'warning');
    return;
  }

  const payload = {
    rule_name: ruleName,
    match_criteria: matchCriteria,
    target_category: targetCategory,
    priority: priority,
    is_active: isActive
  };

  try {
    const isEditing = !!currentRuleEditId;
    const url = isEditing
      ? `${BACKEND_URL}/api/categorization/rules/${currentRuleEditId}`
      : `${BACKEND_URL}/api/categorization/rules`;
    const method = isEditing ? 'PUT' : 'POST';

    const response = await authenticatedFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to save rule', 'error');
      return;
    }

    showStatus(isEditing ? 'Rule updated' : 'Rule created', 'success');
    cancelRuleEdit();
    await loadCategorizationData(true);
    setTimeout(() => clearStatus(), 2000);
  } catch (networkError) {
    showStatus(`Failed to save rule: ${networkError.message}`, 'error');
  }
}

function editRule(ruleId) {
  const rule = rules.find(ruleItem => ruleItem.id === ruleId);
  if (!rule) return;

  currentRuleEditId = ruleId;
  document.getElementById('rule-name').value = rule.rule_name || '';

  // Populate condition rows from match_criteria
  const container = document.getElementById('rule-conditions-container');
  container.innerHTML = '';

  const criteria = rule.match_criteria || {};
  const conditions = criteria.match_type === 'compound'
    ? (criteria.conditions || [])
    : [criteria];

  for (const condition of conditions) {
    addConditionRow(condition);
  }

  document.getElementById('rule-target-category').value = rule.target_category || '';
  document.getElementById('rule-priority').value = rule.priority || 0;
  document.getElementById('rule-active').checked = !!rule.is_active;
  document.getElementById('rule-save-btn').textContent = 'Update Rule';
  document.getElementById('rule-cancel-btn').classList.remove('hidden');
}

function cancelRuleEdit() {
  currentRuleEditId = null;
  document.getElementById('rule-name').value = '';
  document.getElementById('rule-target-category').value = '';
  document.getElementById('rule-priority').value = 0;
  document.getElementById('rule-active').checked = true;
  document.getElementById('rule-save-btn').textContent = 'Create Rule';
  document.getElementById('rule-cancel-btn').classList.add('hidden');
  // Reset to one empty condition row
  const container = document.getElementById('rule-conditions-container');
  container.innerHTML = '';
  addConditionRow();
}

async function adjustRulePriority(ruleId, direction) {
  const rule = rules.find(ruleItem => ruleItem.id === ruleId);
  if (!rule) return;
  const delta = direction === 'up' ? 1 : -1;
  const newPriority = (rule.priority || 0) + delta;

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: newPriority })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to update priority', 'error');
      return;
    }
    await loadCategorizationData(true);
  } catch (networkError) {
    showStatus(`Failed to update priority: ${networkError.message}`, 'error');
  }
}

function confirmDeleteRule(ruleId) {
  openModal({
    title: 'Delete Rule',
    body: '<p>Delete this rule permanently?</p>',
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Delete', onClick: () => _deleteRule(ruleId) }
    ]
  });
}

async function _deleteRule(ruleId) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${ruleId}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to delete rule', 'error');
      return;
    }
    closeModal();
    showStatus('Rule deleted', 'success');

    await loadCategorizationData(true);
  } catch (networkError) {
    showStatus(`Failed to delete rule: ${networkError.message}`, 'error');
  }
}

// ── Condition Row Builder ────────────────────────────────────

const CONDITION_TYPE_LABELS = {
  'name_contains': 'Plaid Name contains',
  'merchant_contains': 'Merchant contains',
  'amount_range': 'Amount range',
  'account_is': 'In account',
  'regex': 'Regex (advanced)',
  'plaid_category': 'Plaid category',
};

/**
 * Add a condition row to the rule form.
 * If prefill is provided, populate the row with existing condition data.
 */
function addConditionRow(prefill = null) {
  const container = document.getElementById('rule-conditions-container');
  const existingRows = container.querySelectorAll('.condition-row');

  // Show AND label between conditions
  if (existingRows.length > 0) {
    const andLabel = document.createElement('div');
    andLabel.className = 'condition-operator-label';
    andLabel.textContent = 'AND';
    container.appendChild(andLabel);
  }

  const row = document.createElement('div');
  row.className = 'condition-row';

  const matchType = prefill?.match_type || 'merchant_contains';

  const typeOptions = Object.entries(CONDITION_TYPE_LABELS)
    .map(([value, label]) => `<option value="${value}" ${value === matchType ? 'selected' : ''}>${label}</option>`)
    .join('');

  row.innerHTML = `
    <select class="condition-match-type" onchange="onConditionTypeChange(this)">
      ${typeOptions}
    </select>
    <span class="condition-value-container"></span>
    <button type="button" class="secondary condition-remove-btn" onclick="removeConditionRow(this)" title="Remove condition">✕</button>
  `;

  container.appendChild(row);

  // Populate the value input based on match type
  _renderConditionValueInput(row, matchType, prefill);
}

function removeConditionRow(button) {
  const row = button.closest('.condition-row');
  const container = document.getElementById('rule-conditions-container');

  // Remove the AND label before or after this row
  const prevSibling = row.previousElementSibling;
  if (prevSibling && prevSibling.classList.contains('condition-operator-label')) {
    prevSibling.remove();
  } else {
    const nextSibling = row.nextElementSibling;
    if (nextSibling && nextSibling.classList.contains('condition-operator-label')) {
      nextSibling.remove();
    }
  }
  row.remove();

  // Always keep at least one condition row
  if (container.querySelectorAll('.condition-row').length === 0) {
    addConditionRow();
  }
}

function onConditionTypeChange(selectElement) {
  const row = selectElement.closest('.condition-row');
  const matchType = selectElement.value;
  _renderConditionValueInput(row, matchType, null);
}

function _renderConditionValueInput(row, matchType, prefill) {
  const valueContainer = row.querySelector('.condition-value-container');

  if (matchType === 'amount_range') {
    const minVal = prefill?.match_value?.min ?? '';
    const maxVal = prefill?.match_value?.max ?? '';
    valueContainer.innerHTML = `
      <input type="number" class="condition-amount-min" placeholder="Min $" value="${minVal}" step="0.01">
      <span class="condition-range-dash">–</span>
      <input type="number" class="condition-amount-max" placeholder="Max $" value="${maxVal}" step="0.01">
    `;
  } else if (matchType === 'account_is') {
    const options = ruleAccountOptions
      .map(acct => `<option value="${escapeHtml(acct.account_id)}" ${prefill?.match_value === acct.account_id ? 'selected' : ''}>${escapeHtml(acct.display_name)}</option>`)
      .join('');
    valueContainer.innerHTML = `
      <select class="condition-account-select">
        <option value="">-- Select account --</option>
        ${options}
      </select>
    `;
  } else {
    const currentValue = prefill?.match_value || '';
    const caseSensitive = prefill?.case_sensitive || false;
    const showCaseSensitive = ['merchant_contains', 'name_contains'].includes(matchType);
    valueContainer.innerHTML = `
      <input type="text" class="condition-match-value" placeholder="Match value" value="${escapeHtml(currentValue)}">
      ${showCaseSensitive ? `<label class="inline-checkbox"><input type="checkbox" class="condition-case-sensitive" ${caseSensitive ? 'checked' : ''}> Case sensitive</label>` : ''}
    `;
  }
}

// ── Help Modal ──────────────────────────────────────────────

function showRuleHelp() {
  openModal({
    title: 'Rule Building Guide',
    body: `
      <div style="max-height: 60vh; overflow-y: auto; font-size: 14px; line-height: 1.6;">
        <h4 style="margin-top: 0;">Condition Types</h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <tr><td style="padding: 4px 8px;"><strong>Merchant contains</strong></td><td style="padding: 4px 8px;">Matches if the merchant name includes the text you enter. <em>Example: "Tesla" matches "Tesla Supercharger"</em></td></tr>
          <tr><td style="padding: 4px 8px;"><strong>Plaid Name contains</strong></td><td style="padding: 4px 8px;">Matches against the Plaid blob's <code>name</code> field — the raw transaction description from your bank. Inspect any transaction's Plaid data to see this value.</td></tr>
          <tr><td style="padding: 4px 8px;"><strong>Amount range</strong></td><td style="padding: 4px 8px;">Matches if the transaction amount falls within the min–max range (inclusive). Must be combined with another condition.</td></tr>
          <tr><td style="padding: 4px 8px;"><strong>In account</strong></td><td style="padding: 4px 8px;">Matches transactions in a specific bank account.</td></tr>
          <tr><td style="padding: 4px 8px;"><strong>Regex (advanced)</strong></td><td style="padding: 4px 8px;">Matches using a regular expression pattern (case-insensitive). See cheatsheet link below.</td></tr>
          <tr><td style="padding: 4px 8px;"><strong>Plaid category</strong></td><td style="padding: 4px 8px;">Matches Plaid's original category code exactly.</td></tr>
        </table>

        <h4>Compound Rules (multiple conditions)</h4>
        <p>Click <strong>"+ Add condition"</strong> to create rules with multiple criteria. All conditions must match (AND logic).</p>
        <p><strong>Example:</strong> Merchant contains "Tesla" <strong>AND</strong> Amount range $90–$100 → applies "Merchandise: Shopping"</p>
        <p><strong>Note:</strong> Amount range cannot be used alone — it must be combined with at least one other condition.</p>

        <h4>Priority</h4>
        <p>When a transaction is categorized, rules are evaluated in priority order (highest first). The <strong>first rule that matches</strong> is applied, and no further rules are checked.</p>
        <p><strong>Example:</strong> If Rule A (priority 10) and Rule B (priority 5) both match a transaction, Rule A's category is applied and Rule B is skipped.</p>
        <p><strong>Same priority:</strong> If two rules have identical priority and both match, the one created first is applied.</p>
        <p>Use the ↑ and ↓ buttons in the rules table to adjust priority.</p>

        <h4>Regex Cheatsheet</h4>
        <p>Regular expressions let you write flexible text-matching patterns. Here are common patterns:</p>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px;">
          <tr><td style="padding: 4px 8px; font-family: monospace;">AMZN.*MKTP</td><td style="padding: 4px 8px;">"AMZN" followed by anything then "MKTP"</td></tr>
          <tr><td style="padding: 4px 8px; font-family: monospace;">^PAYPAL</td><td style="padding: 4px 8px;">Starts with "PAYPAL"</td></tr>
          <tr><td style="padding: 4px 8px; font-family: monospace;">UBER|LYFT</td><td style="padding: 4px 8px;">Matches "UBER" or "LYFT"</td></tr>
          <tr><td style="padding: 4px 8px; font-family: monospace;">STORE\\s*#?\\d+</td><td style="padding: 4px 8px;">"STORE" followed by optional # and digits</td></tr>
        </table>
        <p>Full regex reference: <a href="https://regexr.com/" target="_blank" rel="noopener noreferrer" style="color: var(--color-accent);">regexr.com</a> — an interactive regex tester and cheatsheet.</p>
      </div>
    `,
    actions: [
      { label: 'Close', className: 'secondary', onClick: closeModal }
    ]
  });
}

// ── Broken-Rules Validation ─────────────────────────────────

/**
 * Check for broken rules using already-loaded in-memory data (no API call).
 * A rule is "broken" if its target_category is not in availableCategories.
 */
function checkBrokenRulesLocally() {
  if (!rules || !rules.length || !availableCategories || !availableCategories.length) return;
  const validSet = new Set(availableCategories);
  const broken = rules.filter(ruleItem => ruleItem.target_category && !validSet.has(ruleItem.target_category));
  if (broken.length > 0) {
    const brokenWithFixes = broken.map(ruleItem => ({
      ...ruleItem,
      rule_name: ruleItem.name || ruleItem.rule_name || `Rule #${ruleItem.id}`,
      valid_categories: availableCategories
    }));
    showBrokenRulesModal(brokenWithFixes);
  }
}

async function checkBrokenRules(showIfValid = false) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/validation/broken-rules`);
    const data = await response.json();

    if (!response.ok) {
      console.error('Failed to check broken rules:', data);
      return null;
    }

    if (data.has_broken_rules) {
      showBrokenRulesModal(data.broken_rules);
    } else if (showIfValid) {
      showStatus('✓ All rules are valid', 'success');
      setTimeout(() => clearStatus(), 3000);
    }

    return data;
  } catch (networkError) {
    console.error('Error checking broken rules:', networkError);
    return null;
  }
}

function showBrokenRulesModal(brokenRules) {
  const rulesList = brokenRules.map(rule => {
    return `
      <div class="broken-rule-item" style="margin-bottom: 16px; padding: 12px; background: var(--color-warning-bg); border: 1px solid var(--color-warning-border); border-radius: 4px;">
        <div style="font-weight: 600; color: var(--color-warning); margin-bottom: 4px;">
          Rule: ${escapeHtml(rule.rule_name)}
        </div>
        <div style="color: var(--color-warning); margin-bottom: 8px; font-size: 14px;">
          Invalid target: "${escapeHtml(rule.target_category)}"
        </div>
        <div style="margin-top: 8px;">
          <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500;">Fix by selecting valid category:</label>
          <select class="broken-rule-fix-select" data-rule-id="${rule.id}">
            <option value="">-- Select category --</option>
            ${rule.valid_categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('')}
          </select>
        </div>
      </div>
    `;
  }).join('');

  openModal({
    title: `⚠️ ${brokenRules.length} Broken Rule${brokenRules.length > 1 ? 's' : ''} Found`,
    body: `
      <div style="margin-bottom: 16px; color: var(--color-warning); font-size: 14px;">
        These rules reference categories that no longer exist. Please fix them before recategorizing transactions.
      </div>
      ${rulesList}
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Fix All Rules', onClick: () => _fixAllBrokenRules(brokenRules) }
    ]
  });
}

async function _fixAllBrokenRules(brokenRules) {
  const selects = document.querySelectorAll('.broken-rule-fix-select');
  const fixes = [];

  for (const select of selects) {
    const ruleId = parseInt(select.getAttribute('data-rule-id'));
    const newCategory = select.value;
    if (!newCategory) {
      showStatus('Please select a category for all broken rules', 'warning');
      return;
    }
    fixes.push({ ruleId, newCategory });
  }

  for (const fix of fixes) {
    try {
      const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules/${fix.ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_category: fix.newCategory })
      });

      if (!response.ok) {
        const data = await response.json();
        showStatus(`Failed to fix rule ${fix.ruleId}: ${data.error}`, 'error');
        return;
      }
    } catch (networkError) {
      showStatus(`Error fixing rule ${fix.ruleId}: ${networkError.message}`, 'error');
      return;
    }
  }

  closeModal();
  showStatus(`✓ Fixed ${fixes.length} rule${fixes.length > 1 ? 's' : ''}`, 'success');
  await loadCategorizationData(true);
  setTimeout(() => clearStatus(), 2000);
}
