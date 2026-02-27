// ============================================================
// categories/rules-engine.js — Rule CRUD & Broken-Rules
// Create, edit, delete, re-prioritise categorization rules.
// Includes broken-rules validation and fix-all modal.
// ============================================================

// ── Render ──────────────────────────────────────────────────

function renderRuleFormOptions() {
  const targetSelect = document.getElementById('rule-target-category');
  if (!targetSelect) return;
  const options = buildCategoryOptions();
  targetSelect.innerHTML = options;

  const mergeTarget = document.getElementById('merge-target');
  if (mergeTarget) mergeTarget.innerHTML = options;
  const splitOld = document.getElementById('split-old');
  if (splitOld) splitOld.innerHTML = options;
  const renameOld = document.getElementById('rename-old');
  if (renameOld) renameOld.innerHTML = `<option value="">-- Select category to rename --</option>` + options;
}

function renderRulesTable() {
  const container = document.getElementById('rules-table');
  if (!rules.length) {
    container.innerHTML = '<div class="empty-state">No rules created yet.</div>';
    return;
  }

  const rows = rules
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))
    .map(rule => {
      const match = rule.match_criteria || {};
      const matchTypeLabels = {
        'name_contains': 'Description contains',
        'merchant_contains': 'Merchant contains',
        'amount_range': 'Amount range',
        'regex': 'Regex',
        'plaid_category': 'Plaid category'
      };
      const typeLabel = matchTypeLabels[match.match_type] || match.match_type || 'unknown';
      let valueLabel = '';
      if (match.match_type === 'amount_range' && typeof match.match_value === 'object') {
        const min = match.match_value.min != null ? `$${match.match_value.min}` : 'any';
        const max = match.match_value.max != null ? `$${match.match_value.max}` : 'any';
        valueLabel = `${min} – ${max}`;
      } else {
        valueLabel = match.match_value || '';
      }
      const matchLabel = `${typeLabel}: ${valueLabel}`;
      return `
        <tr>
          <td>${rule.priority || 0}</td>
          <td>${escapeHtml(rule.rule_name || '')}</td>
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

// ── CRUD ────────────────────────────────────────────────────

async function saveRule() {
  const ruleName = document.getElementById('rule-name').value.trim();
  const matchType = document.getElementById('rule-match-type').value;
  const matchValue = document.getElementById('rule-match-value').value.trim();
  const targetCategory = document.getElementById('rule-target-category').value;
  const priority = parseInt(document.getElementById('rule-priority').value || '0', 10);
  const caseSensitive = document.getElementById('rule-case-sensitive').checked;
  const isActive = document.getElementById('rule-active').checked;

  if (!ruleName || !matchType || !matchValue || !targetCategory) {
    showStatus('Fill in rule name, match, and target category', 'warning');
    return;
  }

  const payload = {
    rule_name: ruleName,
    match_criteria: {
      match_type: matchType,
      match_value: matchValue,
      case_sensitive: caseSensitive
    },
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
  document.getElementById('rule-match-type').value = rule.match_criteria?.match_type || 'name_contains';
  // For amount_range, display min-max as a string
  const matchValue = rule.match_criteria?.match_value;
  if (rule.match_criteria?.match_type === 'amount_range' && typeof matchValue === 'object') {
    const min = matchValue.min != null ? matchValue.min : '';
    const max = matchValue.max != null ? matchValue.max : '';
    document.getElementById('rule-match-value').value = `${min}-${max}`;
  } else {
    document.getElementById('rule-match-value').value = matchValue || '';
  }
  document.getElementById('rule-target-category').value = rule.target_category || '';
  document.getElementById('rule-priority').value = rule.priority || 0;
  document.getElementById('rule-case-sensitive').checked = !!rule.match_criteria?.case_sensitive;
  document.getElementById('rule-active').checked = !!rule.is_active;
  document.getElementById('rule-save-btn').textContent = 'Update Rule';
  document.getElementById('rule-cancel-btn').classList.remove('hidden');
}

function cancelRuleEdit() {
  currentRuleEditId = null;
  document.getElementById('rule-name').value = '';
  document.getElementById('rule-match-value').value = '';
  document.getElementById('rule-priority').value = 0;
  document.getElementById('rule-case-sensitive').checked = false;
  document.getElementById('rule-active').checked = true;
  document.getElementById('rule-save-btn').textContent = 'Create Rule';
  document.getElementById('rule-cancel-btn').classList.add('hidden');
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

    const recategorized = data.transactions_recategorized || 0;
    if (recategorized > 0) {
      showStatus(`Rule deleted — ${recategorized} transaction${recategorized !== 1 ? 's' : ''} recategorized`, 'success');
    } else {
      showStatus('Rule deleted', 'success');
    }

    await loadCategorizationData(true);
  } catch (networkError) {
    showStatus(`Failed to delete rule: ${networkError.message}`, 'error');
  }
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
