// ============================================================
// transactions/categories.js — Category Management
// All category parsing, formatting, autocomplete, override,
// rule, and data-loading logic. Largest module — every
// function that touches category concepts lives here.
// ============================================================

// ───── Transfer Category Helpers ─────

/**
 * Check if a category string represents a transfer: [AccountName]
 * Transfer categories are wrapped in square brackets to distinguish
 * them from normal "Primary: Detailed" categories.
 */
function isTransferCategory(categoryStr) {
  if (!categoryStr || typeof categoryStr !== 'string') return false;
  const trimmed = categoryStr.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.length > 2;
}

/**
 * Extract the account name from a transfer category string.
 * "[My Checking Account]" → "My Checking Account"
 */
function parseTransferAccountName(categoryStr) {
  if (!isTransferCategory(categoryStr)) return '';
  return categoryStr.trim().slice(1, -1);
}

/**
 * Build a transfer category string from an account name.
 * "My Checking Account" → "[My Checking Account]"
 */
function buildTransferCategory(accountName) {
  return `[${accountName}]`;
}

/**
 * Find the account object that matches a transfer category display name.
 * Searches by custom_name, account_name, and _buildAccountDisplayName.
 */
function _findAccountByTransferName(transferName) {
  if (!transferName) return null;
  const lower = transferName.toLowerCase();
  return accounts.find(acc => {
    if (acc.custom_name && acc.custom_name.toLowerCase() === lower) return true;
    if (acc.account_name && acc.account_name.toLowerCase() === lower) return true;
    if (_buildAccountDisplayName(acc).toLowerCase() === lower) return true;
    return false;
  }) || null;
}

// ───── Parsing & Formatting ─────

/**
 * Parse a category string into primary and detailed components.
 * Handles multiple formats:
 * 1. Transfer notation: "[Account Name]" → {primary: "[Account Name]", detailed: "", isTransfer: true}
 * 2. Colon-separated: "Getting Around: Bikes and Scooters" → {primary: "Getting Around", detailed: "Bikes and Scooters"}
 * 3. Underscore-separated: "TRANSPORTATION_BIKES_AND_SCOOTERS" → {primary: "Transportation", detailed: "Bikes And Scooters"}
 * 4. Custom categories without separator: "bike stuff" → {primary: "bike stuff", detailed: ""}
 */
function parseCategoryString(categoryStr) {
  if (!categoryStr || typeof categoryStr !== 'string') {
    return { primary: '', detailed: '', full: '' };
  }

  const trimmed = categoryStr.trim();

  // Transfer category notation: [AccountName]
  // Return early — transfers are not Primary: Detailed combos
  if (isTransferCategory(trimmed)) {
    return {
      primary: trimmed,
      detailed: '',
      full: trimmed,
      isTransfer: true
    };
  }
  
  // Check for colon-separated format (new format)
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map(p => p.trim());
    return {
      primary: parts[0] || '',
      detailed: parts[1] || '',
      full: trimmed
    };
  }
  
  // Check for underscore-separated format (legacy Plaid format)
  if (trimmed.includes('_')) {
    // Try to match against plaid taxonomy to identify primary
    const parsed = parsePlaidCategoryString(trimmed);
    if (parsed.primary) {
      return parsed;
    }
  }
  
  // Custom category without separator - treat whole thing as primary
  return {
    primary: trimmed,
    detailed: '',
    full: trimmed
  };
}

/**
 * Parse a Plaid underscore-separated category using taxonomy lookup.
 * Example: "TRANSPORTATION_BIKES_AND_SCOOTERS" → {primary: "Transportation", detailed: "Bikes And Scooters"}
 */
function parsePlaidCategoryString(categoryStr) {
  if (!categoryStr) {
    return { primary: '', detailed: '', full: categoryStr };
  }
  
  // Try to find matching entry in plaid taxonomy
  const matchingTaxonomy = plaidTaxonomy.find(t => t.detailed === categoryStr);
  
  if (matchingTaxonomy) {
    const primary = matchingTaxonomy.primary || '';
    const detailed = categoryStr;
    const trimmedDetailed = trimCategoryPrefix(detailed, primary);
    
    return {
      primary: formatCategoryDisplay(primary),
      detailed: formatCategoryDisplay(trimmedDetailed),
      full: categoryStr,
      rawPrimary: primary,
      rawDetailed: detailed
    };
  }
  
  // Fallback: try to split intelligently by finding common primary patterns
  const commonPrimaries = [
    'BANK_FEES', 'ENTERTAINMENT', 'FOOD_AND_DRINK', 'GENERAL_MERCHANDISE',
    'GENERAL_SERVICES', 'GOVERNMENT_AND_NON_PROFIT', 'HOME_IMPROVEMENT',
    'INCOME', 'LOAN_DISBURSEMENTS', 'LOAN_PAYMENTS', 'MEDICAL',
    'PERSONAL_CARE', 'RENT_AND_UTILITIES', 'TRANSFER_IN', 'TRANSFER_OUT',
    'TRANSPORTATION', 'TRAVEL'
  ];
  
  for (const primaryPattern of commonPrimaries) {
    if (categoryStr.startsWith(primaryPattern + '_')) {
      const detailed = categoryStr.substring(primaryPattern.length + 1);
      return {
        primary: formatCategoryDisplay(primaryPattern),
        detailed: formatCategoryDisplay(detailed),
        full: categoryStr,
        rawPrimary: primaryPattern,
        rawDetailed: categoryStr
      };
    } else if (categoryStr === primaryPattern) {
      return {
        primary: formatCategoryDisplay(primaryPattern),
        detailed: '',
        full: categoryStr,
        rawPrimary: primaryPattern,
        rawDetailed: categoryStr
      };
    }
  }
  
  // Last resort: treat whole thing as primary
  return {
    primary: formatCategoryDisplay(categoryStr),
    detailed: '',
    full: categoryStr,
    rawPrimary: categoryStr,
    rawDetailed: categoryStr
  };
}

/**
 * Build a category string from primary and detailed components.
 * Returns format: "Primary: Detailed" or just "Primary" if no detailed.
 */
function buildCategoryString(primary, detailed) {
  if (!primary) return '';
  if (!detailed) return primary;
  return `${primary}: ${detailed}`;
}

function normalizeCategoryLabel(label) {
  return String(label || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trim the primary category prefix from a detailed category.
 * Example: "GENERAL_MERCHANDISE_SPORTING_GOODS" + "GENERAL_MERCHANDISE" → "SPORTING_GOODS"
 */
function trimCategoryPrefix(detailed, primary) {
  if (!detailed || !primary) return detailed || '';
  
  // Remove primary prefix if detailed starts with it
  if (detailed.toUpperCase().startsWith(primary.toUpperCase() + '_')) {
    return detailed.substring(primary.length + 1);
  }
  
  return detailed;
}

/**
 * Get formatted category display names from personal_finance_category object.
 */
function getCategoryDisplayNames(pfc) {
  if (!pfc || !pfc.detailed) {
    return { primary: '', trimmed: '', confidence: '' };
  }
  
  const primary = pfc.primary || '';
  const detailed = pfc.detailed || '';
  const trimmed = trimCategoryPrefix(detailed, primary);
  const confidence = (pfc.confidence_level || '').replace(/_/g, ' ');
  
  return {
    primary: formatCategoryDisplay(primary),
    trimmed: formatCategoryDisplay(trimmed),
    confidence: confidence,
    rawPrimary: primary,
    rawDetailed: detailed,
    rawTrimmed: trimmed
  };
}

// ───── Extraction & Validation ─────

function resolveTargetCategory(primary, detailed) {
  const normalizedPrimary = normalizeCategoryLabel(primary);
  const normalizedDetailed = normalizeCategoryLabel(detailed);

  if (!normalizedPrimary || normalizedPrimary === 'Uncategorized') {
    return { error: 'Please select a valid category (not Uncategorized)' };
  }

  const candidate = buildCategoryString(normalizedPrimary, normalizedDetailed);
  const candidateNorm = normalizeCategoryLabel(candidate);

  const matchingAvailable = (availableCategories || []).find(cat => normalizeCategoryLabel(cat) === candidateNorm);
  if (matchingAvailable) {
    return { value: matchingAvailable };
  }

  if (!normalizedDetailed) {
    const matchingPrimary = (availableCategories || []).find(cat => normalizeCategoryLabel(cat) === normalizedPrimary);
    if (matchingPrimary) {
      return { value: matchingPrimary };
    }
  }

  const detailedOptions = extractDetailedCategories(availableCategories, normalizedPrimary);
  if (!normalizedDetailed && detailedOptions.length > 0) {
    return { error: 'Please select a detailed category' };
  }

  return { error: 'Selected category is not available. Please choose a valid category.' };
}

function validateTargetCategory(targetCategory) {
  const normalizedTarget = normalizeCategoryLabel(targetCategory);
  if (!normalizedTarget || normalizedTarget === 'Uncategorized') {
    return { error: 'Please select a valid category (not Uncategorized)' };
  }

  if (availableCategories && !(availableCategories || []).some(cat => normalizeCategoryLabel(cat) === normalizedTarget)) {
    return { error: 'Selected category is not available. Please choose a valid category.' };
  }

  const matching = (availableCategories || []).find(cat => normalizeCategoryLabel(cat) === normalizedTarget);
  return { value: matching || targetCategory };
}

/**
 * Extract unique primary categories from available categories list.
 * Returns sorted array of primary category names.
 */
function extractPrimaryCategories(categories) {
  const primaries = new Set();
  
  (categories || []).forEach(cat => {
    const parsed = parseCategoryString(cat);
    if (parsed.primary) {
      primaries.add(parsed.primary);
    }
  });
  
  return Array.from(primaries).sort((a, b) => a.localeCompare(b));
}

/**
 * Extract detailed categories for a specific primary category.
 * Returns sorted array of detailed category names.
 */
function extractDetailedCategories(categories, primaryCategory) {
  if (!primaryCategory) return [];
  
  const detailed = new Set();
  
  (categories || []).forEach(cat => {
    const parsed = parseCategoryString(cat);
    if (parsed.primary === primaryCategory && parsed.detailed) {
      detailed.add(parsed.detailed);
    }
  });
  
  return Array.from(detailed).sort((a, b) => a.localeCompare(b));
}

function buildCategoryOptions(selected) {
  const unique = new Set(availableCategories || []);
  if (selected) unique.add(selected);
  const list = Array.from(unique).sort((a, b) => a.localeCompare(b));
  return list
    .map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
    .join('');
}

// ───── Dropdown Builders ─────

/**
 * Build primary category dropdown options from available categories.
 */
function buildPrimaryDropdownOptions(selected = '') {
  const primaries = extractPrimaryCategories(availableCategories);
  
  // Always include "Uncategorized" as an option
  const options = ['Uncategorized', ...primaries];
  
  return options
    .map(cat => `<option value="${escapeHtml(cat)}" ${cat === selected ? 'selected' : ''}>${escapeHtml(cat)}</option>`)
    .join('');
}

/**
 * Build detailed category dropdown options based on selected primary.
 */
function buildDetailedDropdownOptions(selectedPrimary = '', selected = '') {
  if (!selectedPrimary || selectedPrimary === 'Uncategorized') {
    return '<option value="">— No detailed categories —</option>';
  }
  
  const detailed = extractDetailedCategories(availableCategories, selectedPrimary);
  
  if (detailed.length === 0) {
    return '<option value="">— No detailed categories —</option>';
  }
  
  // Auto-select the first detailed category when none is specified,
  // so the user always has a valid "Primary: Detailed" combination.
  const effectiveSelected = selected || detailed[0];
  
  return detailed
    .map(cat => {
      return `<option value="${escapeHtml(cat)}" ${cat === effectiveSelected ? 'selected' : ''}>${escapeHtml(cat)}</option>`;
    })
    .join('');
}

// ───── Autocomplete System ─────

/**
 * Attach event listeners for category dropdown changes.
 */
function attachCategoryDropdownListeners() {
  // Remove any previously-bound delegated handlers to prevent stacking
  $(document).off('input', '.category-autocomplete');
  $(document).off('keydown', '.category-autocomplete');
  $(document).off('focus', '.category-autocomplete');
  $(document).off('blur', '.category-autocomplete');
  $(document).off('click', '.category-ac-item');
  $(document).off('click', '.category-override');
  $(document).off('click', '.category-rule');

  // ===== Autocomplete input handler =====
  $(document).on('input', '.category-autocomplete', function() {
    const input = this;
    const query = input.value;
    const txnId = $(input).data('txn-id');
    _showCategoryAutocomplete(input, query, txnId);
  });

  // Select all text on focus for easy replacement
  $(document).on('focus', '.category-autocomplete', function() {
    // Snapshot the current persisted value for this editing session.
    // If the user cancels (Escape) or leaves without applying override,
    // we restore this value so unsaved text does not linger in the table.
    $(this).data('committedCategoryValue', this.value || '');
    this.select();
  });

  // ===== Keyboard navigation: Tab to accept, Escape to close, Arrow keys =====
  $(document).on('keydown', '.category-autocomplete', function(e) {
    const input = this;
    const txnId = $(input).data('txn-id');
    const list = $(`.category-ac-list[data-txn-id="${txnId}"]`);
    const items = list.find('.category-ac-item');
    const activeIndex = items.index(items.filter('.active'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(activeIndex + 1, items.length - 1);
      items.removeClass('active');
      $(items[next]).addClass('active');
      items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(activeIndex - 1, 0);
      items.removeClass('active');
      $(items[prev]).addClass('active');
      items[prev]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Tab') {
      // If dropdown is open with suggestions, accept the highlighted (or first) suggestion
      // Otherwise, validate the current input and move to memo if valid
      const active = items.filter('.active').first();
      const first = active.length ? active : items.first();
      
      if (first.length) {
        // Dropdown is open with items, accept the highlighted suggestion
        e.preventDefault();
        input.value = first.data('value');
        list.empty().hide();
      } else {
        // Dropdown is closed or empty, check if current input is valid
        const currentValue = (input.value || '').trim();
        if (currentValue) {
          const resolved = _resolveAutocompleteCategory(currentValue);
          if (!resolved.error) {
            // Valid category — stage via batch manager for deferred
            // bulk submission instead of firing an immediate API call.
            // This prevents rapid Tab-cycling from overwhelming the backend.
            e.preventDefault();
            const resolvedValue = resolved.value || currentValue;
            const batchTxnId = $(input).data('txn-id');

            if (resolved.isTransfer && resolved.account) {
              // Transfer assignments still need the full interactive flow
              const accountId = $(input).data('account-id') || $(input).closest('tr').data('account-id');
              _applyTransferAssignment(batchTxnId, accountId, resolved.account);
            } else if (batchTxnId && typeof stageBatchEdit === 'function') {
              stageBatchEdit(batchTxnId, { user_category: resolvedValue });
              $(input).data('committedCategoryValue', resolvedValue);
              input.value = resolvedValue;
            }

            // Tab from category → next row's memo (inline click-to-edit)
            const nextRow = $(input).closest('tr').next('tr');
            if (nextRow.length) {
              const nextMemoSpan = nextRow.find('.txn-memo-text');
              if (nextMemoSpan.length) {
                _openInlineMemoEditor(nextMemoSpan[0]);
              }
            }
          }
          // If error, allow default Tab behavior (move to next focusable element)
        }
        // If no value, allow default Tab behavior
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = items.filter('.active').first();
      const first = active.length ? active : items.first();
      if (first.length) {
        // If dropdown is open with items, accept the highlighted suggestion
        input.value = first.data('value');
        list.empty().hide();
      } else if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+Enter (with dropdown closed) = Open Rule modal
        const ruleBtn = $(input).closest('.category-cell').find('.category-rule');
        if (ruleBtn.length) {
          ruleBtn.click();
        }
      } else {
        // Enter (with dropdown closed) = Apply Override
        _applyCategoryFromInput(input);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const committedValue = $(input).data('committedCategoryValue');
      if (committedValue !== undefined) {
        input.value = committedValue;
      }
      list.empty().hide();
    }
  });

  // ===== Click on autocomplete item =====
  $(document).on('mousedown', '.category-ac-item', function(e) {
    // mousedown instead of click so it fires before blur
    e.preventDefault();
    const value = $(this).data('value');
    const txnId = $(this).closest('.category-ac-list').data('txn-id');
    const input = $(`.category-autocomplete[data-txn-id="${txnId}"]`);
    input.val(value);
    $(this).closest('.category-ac-list').empty().hide();
  });

  // ===== Hide list on blur =====
  $(document).on('blur', '.category-autocomplete', function() {
    const input = this;
    const txnId = $(input).data('txn-id');
    const committedValue = $(input).data('committedCategoryValue');
    // Small delay so click-on-item can fire first
    setTimeout(() => {
      $(`.category-ac-list[data-txn-id="${txnId}"]`).empty().hide();
      if (committedValue !== undefined && (input.value || '') !== committedValue) {
        input.value = committedValue;
      }
    }, 200);
  });

  // ===== Apply category from input (Enter key or legacy override button) =====
  function _applyCategoryFromInput(inputEl) {
    const input = $(inputEl);
    const txnId = input.data('txn-id');
    const accountId = input.data('account-id');
    const fullValue = (input.val() || '').trim();

    const resolved = _resolveAutocompleteCategory(fullValue);
    if (resolved.error) {
      showStatus(resolved.error, 'warning');
      return;
    }

    if (resolved.isTransfer && resolved.account) {
      _applyTransferAssignment(txnId, accountId, resolved.account);
      return;
    }

    const committedValue = (input.data('committedCategoryValue') || '').trim();
    if (resolved.value === committedValue) {
      return;
    }

    // Manual transactions have no original Plaid category to revert to —
    // skip the override system and update the transaction directly.
    const txnObj = transactions.find(t => t.transaction_id === txnId);
    if (txnObj && txnObj.source === 'manual') {
      _updateManualTransactionCategory(txnId, resolved.value);
      return;
    }

    const parsed = parseCategoryString(resolved.value);
    applyOverride(txnId, accountId, parsed.primary, parsed.detailed);
  }

  // ===== Override button click handler (kept for backward compat) =====
  $(document).on('click', '.category-override', function() {
    const txnId = $(this).data('txn-id');
    const accountId = $(this).data('account-id');
    const input = $(`.category-autocomplete[data-txn-id="${txnId}"]`);
    const fullValue = (input.val() || '').trim();

    // Validate against known categories (or transfer accounts)
    const resolved = _resolveAutocompleteCategory(fullValue);
    if (resolved.error) {
      showStatus(resolved.error, 'warning');
      return;
    }

    // Transfer assignment: user entered [AccountName]
    if (resolved.isTransfer && resolved.account) {
      _applyTransferAssignment(txnId, accountId, resolved.account);
      return;
    }

    // Skip the override when the resolved category is the same as what
    // was already committed — avoids creating a redundant user_category
    // override when the user just clicked into the cell and pressed Enter
    // without actually changing the category.
    const committedValue = (input.data('committedCategoryValue') || '').trim();
    if (resolved.value === committedValue) {
      return;
    }

    // Manual transactions: direct PUT, not override.
    const txnObjOverride = transactions.find(t => t.transaction_id === txnId);
    if (txnObjOverride && txnObjOverride.source === 'manual') {
      _updateManualTransactionCategory(txnId, resolved.value);
      return;
    }

    const parsed = parseCategoryString(resolved.value);
    applyOverride(txnId, accountId, parsed.primary, parsed.detailed);
  });

  // ===== Rule button click handler =====
  $(document).on('click', '.category-rule', function() {
    const txnId = $(this).data('txn-id');
    const accountId = $(this).data('account-id');
    const input = $(`.category-autocomplete[data-txn-id="${txnId}"]`);
    const fullValue = (input.val() || '').trim();

    const resolved = _resolveAutocompleteCategory(fullValue);
    if (resolved.error) {
      showStatus(resolved.error, 'warning');
      return;
    }

    // Transfer categories cannot be saved as rules — transfers are per-transaction
    if (resolved.isTransfer) {
      showStatus('Transfer assignments cannot be saved as rules. Use Override to assign this transfer.', 'warning');
      return;
    }

    const parsed = parseCategoryString(resolved.value);
    let txn = transactions.find(t => t.transaction_id === txnId);
    if (!txn) {
      for (const parentTxn of transactions) {
        if (parentTxn.splits) {
          const splitChild = parentTxn.splits.find(s => s.transaction_id === txnId);
          if (splitChild) { txn = splitChild; break; }
        }
      }
    }
    _redirectToRulesPage(txn, parsed.primary, parsed.detailed, accountId);
  });
}

// ===== Autocomplete helper: show filtered list =====
function _showCategoryAutocomplete(input, query, txnId) {
  const list = $(`.category-ac-list[data-txn-id="${txnId}"]`);
  const q = (query || '').trim();
  const qLower = q.toLowerCase();

  if (!q) {
    list.empty().hide();
    return;
  }

  // Transfer mode: user typed "[" to initiate manual transfer assignment.
  // Show account list instead of category list.
  if (q.startsWith('[')) {
    _showTransferAccountAutocomplete(list, q, txnId);
    return;
  }

  // Smart filtering:
  // - If query contains ':', split and match primary + detailed separately
  // - Otherwise match anywhere in the full string
  let matches;
  if (qLower.includes(':')) {
    const [qPrimary, qDetailed] = qLower.split(':').map(s => s.trim());
    matches = (availableCategories || []).filter(cat => {
      const lower = cat.toLowerCase();
      const parts = lower.split(':').map(s => s.trim());
      const primaryMatch = !qPrimary || (parts[0] || '').includes(qPrimary);
      const detailedMatch = !qDetailed || (parts[1] || '').includes(qDetailed);
      return primaryMatch && detailedMatch;
    });
  } else {
    matches = (availableCategories || []).filter(cat =>
      cat.toLowerCase().includes(qLower)
    );
  }

  // Limit visible results
  const maxShow = 10;
  const shown = matches.slice(0, maxShow);

  if (shown.length === 0) {
    list.html('<div class="category-ac-empty">No matching categories</div>').show();
    return;
  }

  // Build list HTML with highlighted matching text
  const html = shown.map((cat, i) => {
    const highlighted = _highlightMatch(cat, q);
    return `<div class="category-ac-item${i === 0 ? ' active' : ''}" data-value="${escapeHtml(cat)}">${highlighted}</div>`;
  }).join('');

  const extra = matches.length > maxShow
    ? `<div class="category-ac-more">${matches.length - maxShow} more…</div>` : '';

  list.html(html + extra).show();
}

/**
 * Show account list when user types "[" in the category autocomplete.
 * Typing "[ch" narrows the list to accounts containing "ch".
 * Selecting an item fills the input with "[Account Name]".
 */
function _showTransferAccountAutocomplete(list, rawQuery, txnId) {
  // Strip the leading "[" and optional trailing "]" for search purposes
  const accountQuery = rawQuery.slice(1).replace(/]$/, '').toLowerCase();
  const currentTxn = transactions.find(txn => txn.transaction_id === txnId);
  const currentAccountId = currentTxn ? (currentTxn.account_id || currentTxn.plaid_account_id) : null;

  // Filter accounts: exclude the transaction's own account (can't transfer to self)
  const matchingAccounts = accounts.filter(acc => {
    if (acc.account_id === currentAccountId) return false;
    if (acc.is_archived) return false;
    if (!accountQuery) return true; // show all accounts when just "[" is typed
    const displayName = _buildAccountDisplayName(acc).toLowerCase();
    const accountName = (acc.account_name || '').toLowerCase();
    return displayName.includes(accountQuery) || accountName.includes(accountQuery);
  });

  const maxShow = 10;
  const shown = matchingAccounts.slice(0, maxShow);

  if (shown.length === 0) {
    list.html('<div class="category-ac-empty">No matching accounts for transfer</div>').show();
    return;
  }

  const html = shown.map((acc, idx) => {
    const displayName = _buildAccountDisplayName(acc);
    const transferValue = buildTransferCategory(displayName);
    const typeBadge = `<span class="transfer-ac-type">${acc.account_category || 'account'}</span>`;
    const highlighted = accountQuery ? _highlightMatch(displayName, accountQuery) : escapeHtml(displayName);
    return `<div class="category-ac-item transfer-ac-item${idx === 0 ? ' active' : ''}" data-value="${escapeHtml(transferValue)}" data-account-id="${escapeHtml(acc.account_id)}">`
      + `<span class="transfer-ac-icon">\u21C4</span> ${highlighted} ${typeBadge}</div>`;
  }).join('');

  const extra = matchingAccounts.length > maxShow
    ? `<div class="category-ac-more">${matchingAccounts.length - maxShow} more accounts\u2026</div>` : '';

  list.html(html + extra).show();
}

// Highlight matching portions of the category string
function _highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  // Case-insensitive highlight
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<strong>$1</strong>');
}

// Validate that the autocomplete value resolves to a known category
function _resolveAutocompleteCategory(value) {
  if (!value) {
    return { error: 'Please type or select a category' };
  }

  const normalized = normalizeCategoryLabel(value);

  // Transfer category: [AccountName] — validate the account exists
  if (isTransferCategory(normalized)) {
    const accountName = parseTransferAccountName(normalized);
    const matchedAccount = _findAccountByTransferName(accountName);
    if (matchedAccount) {
      return { value: normalized, isTransfer: true, account: matchedAccount };
    }
    return { error: `No account named "${accountName}" found. Type [ to see available accounts.` };
  }

  // Exact match (case-insensitive)
  const exact = (availableCategories || []).find(cat =>
    normalizeCategoryLabel(cat) === normalized
  );
  if (exact) return { value: exact };

  // Partial match — if only one category matches, use it
  const partial = (availableCategories || []).filter(cat =>
    normalizeCategoryLabel(cat).includes(normalized)
  );
  if (partial.length === 1) return { value: partial[0] };

  if (partial.length > 1) {
    return { error: `Multiple categories match "${value}". Please select a specific one.` };
  }

  return { error: `"${value}" is not a known category. Please type to search and select from the list.` };
}

// ───── Override & Rule Actions ─────

/**
 * Directly update the category of a manual transaction via PUT.
 * Unlike applyOverride, this does not create an override entry —
 * manual transactions own their category directly; there is no
 * Plaid-assigned original to revert to.
 */
async function _updateManualTransactionCategory(txnId, categoryString) {
  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/${encodeURIComponent(txnId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_category: categoryString }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to update category', 'error');
      return;
    }
    const txn = transactions.find(t => t.transaction_id === txnId);
    if (txn) {
      txn.user_category = data.transaction?.user_category || categoryString;
      // is_override intentionally NOT set — manual txns don't use overrides
      _cacheTransactions(transactions);
    }
    renderTransactionTable();
    showStatus(`Category updated: ${categoryString}`, 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    showStatus(`Failed to update category: ${error.message}`, 'error');
  }
}

/**
 * Apply an override to a single transaction.
 * Combines primary and detailed into "Primary: Detailed" format.
 */
async function applyOverride(txnId, accountId, selectedPrimary, selectedDetailed) {
  if (!selectedPrimary) {
    showStatus('Please select a primary category', 'warning');
    return;
  }

  // Ensure a detailed category is selected when detailed options exist
  const detailedOptions = extractDetailedCategories(availableCategories, selectedPrimary);
  if (detailedOptions.length > 0 && !selectedDetailed) {
    showStatus('Please select a detailed category', 'warning');
    return;
  }

  const categoryString = buildCategoryString(selectedPrimary, selectedDetailed);
  
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_category: categoryString
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      showStatus(data.error || 'Failed to apply override', 'error');
      return;
    }

    showStatus(`Override applied: ${categoryString}. Recategorizing transactions...`, 'success');

    _patchCategorizationCache(txnId, data, categoryString, true);
    renderTransactionTable();
    
    showStatus(`Override applied: ${categoryString}`, 'success');
    setTimeout(() => clearStatus(), 3000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (e) { /* cache removal failure is non-fatal */ }
  } catch (error) {
    showStatus(`Failed to apply override: ${error.message}`, 'error');
  }
}

function _patchCategorizationCache(requestedTxnId, responseData, fallbackCategory, fallbackIsOverride) {
  const purgedVirtualIds = Array.isArray(responseData.purged_virtual_ids)
    ? responseData.purged_virtual_ids
    : [];

  purgedVirtualIds.forEach(virtualId => _removeCachedTransaction(virtualId));

  const resolvedTxn = responseData.transaction;
  if (resolvedTxn && resolvedTxn.transaction_id) {
    if (
      requestedTxnId !== resolvedTxn.transaction_id
      && !purgedVirtualIds.includes(requestedTxnId)
    ) {
      _removeCachedTransaction(requestedTxnId);
    }

    _replaceCachedTransaction(resolvedTxn.transaction_id, resolvedTxn);

    if (
      responseData.affected_transfer_partner
      && responseData.affected_transfer_partner.transaction_id
    ) {
      _replaceCachedTransaction(
        responseData.affected_transfer_partner.transaction_id,
        responseData.affected_transfer_partner,
      );
    }

    _sortTransactionsInPlace();
    return;
  }

  let txn = transactions.find(t => t.transaction_id === requestedTxnId);
  if (!txn) {
    for (const parentTxn of transactions) {
      if (parentTxn.splits) {
        const splitChild = parentTxn.splits.find(s => s.transaction_id === requestedTxnId);
        if (splitChild) {
          txn = splitChild;
          break;
        }
      }
    }
  }

  if (!txn) {
    return;
  }

  txn.user_category = responseData.user_category || fallbackCategory;
  txn.is_override = fallbackIsOverride;
  _cacheTransactions(transactions);
}

// ───── Transfer Assignment ─────

/**
 * Handle manual transfer assignment when user enters [AccountName] in the
 * category field and clicks Override.
 *
 * Flow:
 * 1. Try to find an existing matching transaction in the target account via
 *    the /transfers/candidates endpoint.
 * 2. If a high-confidence candidate exists, link the pair directly.
 * 3. If no candidate exists, create a counterpart transaction in the target
 *    account and link them.
 */
async function _applyTransferAssignment(txnId, sourceAccountId, targetAccount) {
  const targetAccountId = targetAccount.account_id;
  const targetDisplayName = _buildAccountDisplayName(targetAccount);

  showStatus(`Assigning transfer to ${targetDisplayName}…`, 'info');

  try {
    // Step 1: Look for candidate match in the target account
    const candidatesResponse = await authenticatedFetch(
      `${BACKEND_URL}/api/transactions/transfers/candidates/${encodeURIComponent(txnId)}?target_account_id=${encodeURIComponent(targetAccountId)}`
    );

    if (!candidatesResponse.ok) {
      const errorData = await candidatesResponse.json();
      showStatus(errorData.error || 'Failed to find transfer candidates', 'error');
      return;
    }

    const candidateData = await candidatesResponse.json();
    const candidates = candidateData.candidates || [];

    let result;

    if (candidates.length > 0) {
      // High-confidence candidate found — link directly
      const bestCandidate = candidates[0];

      const linkResponse = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transfers/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id_a: txnId,
          transaction_id_b: bestCandidate.transaction_id
        })
      });

      if (!linkResponse.ok) {
        const linkError = await linkResponse.json();
        showStatus(linkError.error || 'Failed to link transfer pair', 'error');
        return;
      }

      result = await linkResponse.json();
      showStatus(`Transfer linked with existing transaction in ${targetDisplayName}`, 'success');
    } else {
      // No candidate — create a counterpart transaction and link
      const createResponse = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transfers/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: txnId,
          target_account_id: targetAccountId
        })
      });

      if (!createResponse.ok) {
        const createError = await createResponse.json();
        showStatus(createError.error || 'Failed to create transfer counterpart', 'error');
        return;
      }

      result = await createResponse.json();
    }

    // Auto-uncheck "Hide Transfers" so the user can see the result of their
    // manual transfer assignment. Without this, the new transfer pair would
    // be immediately hidden by the filter, which is confusing.
    const hideTransfersCheckbox = document.getElementById('hide-transfers');
    const wasHidden = hideTransfersCheckbox && hideTransfersCheckbox.checked;
    if (wasHidden) {
      hideTransfersCheckbox.checked = false;
    }

    // Surgical cache patch — replace only the affected transactions
    // instead of refetching all 10k+ rows from the server.
    if (result.affected_transactions) {
      result.affected_transactions.forEach(txnObj => {
        _replaceCachedTransaction(txnObj.transaction_id, txnObj);
      });
    }
    _invalidateTransactionCache();

    // Patch balance history cache for the target account (create path
    // adds a new transaction that shifts the running balance).
    if (result.affected_balance_history && result.counterpart_account_id) {
      _patchBalanceHistoryCache(result.counterpart_account_id, result.affected_balance_history);
    }

    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
    }
    // Refresh sidebar balances for both accounts in the transfer pair.
    // Without this, the new running balance stays stale in the sidebar
    // until a full page refresh or account switch.
    await loadAccounts();
    renderTransactionTable();

    // Build a descriptive status message
    const unhideNote = wasHidden ? ' ("Hide Transfers" unchecked so you can see it)' : '';
    showStatus(`Transfer paired with ${targetDisplayName}${unhideNote}`, 'success');
    setTimeout(() => clearStatus(), 5000);

  } catch (error) {
    showStatus(`Transfer assignment failed: ${error.message}`, 'error');
  }
}

/**
 * Unlink a transfer pair. The source transaction reverts to uncategorized
 * and the counterpart (if auto-created) may be left for user cleanup.
 */
async function unlinkTransfer(txnId) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/transfers/unlink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: txnId })
    });

    if (!response.ok) {
      const errorData = await response.json();
      showStatus(errorData.error || 'Failed to unlink transfer', 'error');
      return;
    }

    const data = await response.json();

    showStatus('Transfer pair unlinked', 'success');

    // Surgical cache patch — replace only the 2 affected transactions
    // instead of refetching all 10k+ rows from the server.
    if (data.affected_transactions) {
      data.affected_transactions.forEach(txnObj => {
        _replaceCachedTransaction(txnObj.transaction_id, txnObj);
      });
    }
    _invalidateTransactionCache();

    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
    }
    // Mirror the assignment path — sidebar balances need refreshing since
    // unlinking also moves money between accounts from an accounting view.
    await loadAccounts();
    renderTransactionTable();

    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Failed to unlink transfer: ${error.message}`, 'error');
  }
}

/**
 * Clear an override from a transaction.
 */
async function clearOverride(event) {
  const txnId = event.target.getAttribute('data-txn-id');
  
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/override`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    
    if (!response.ok) {
      showStatus(data.error || 'Failed to clear override', 'error');
      return;
    }

    // Update local transaction object
    const txn = transactions.find(t => t.transaction_id === txnId);
    if (txn) {
      txn.is_override = false;
      if (data.updated_category) {
        txn.user_category = data.updated_category;
      }
      _cacheTransactions(transactions);
    }

    renderTransactionTable();
    showStatus('Override cleared', 'success');
    setTimeout(() => clearStatus(), 2000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (e) { /* cache removal failure is non-fatal */ }
  } catch (error) {
    showStatus(`Failed to clear override: ${error.message}`, 'error');
  }
}

/**
 * Open modal to create a rule from transaction categorization.
 * The category section is editable — changing it here also updates the
 * source transaction (same as applying a manual override directly).
 */
/**
 * Stash transaction context into sessionStorage and navigate to the
 * categories Rules Engine panel, where the form will be pre-filled.
 * Consolidates rule creation into one place so the user always sees
 * existing rules + the conflict detector when building a new rule.
 */
function _redirectToRulesPage(txn, selectedPrimary, selectedDetailed, accountId) {
  if (!selectedPrimary) {
    showStatus('Please select a primary category', 'warning');
    return;
  }

  const resolvedTarget = resolveTargetCategory(selectedPrimary, selectedDetailed);
  if (resolvedTarget.error) {
    showStatus(resolvedTarget.error, 'warning');
    return;
  }

  const txnDescription = txn?.name || '';
  const txnMerchant   = txn?.merchant_name || '';
  const txnAmount     = txn?.amount != null ? Math.abs(txn.amount) : '';
  const txnCurrency   = txn?.iso_currency_code || 'USD';
  const txnSource     = txn?.source || '';
  const userOverride  = txn?.user_description_override || '';

  const hasMerchant = !!txnMerchant;
  const defaultMatchType  = hasMerchant ? 'merchant_contains' : 'name_contains';
  const defaultMatchValue = hasMerchant ? txnMerchant : txnDescription;
  const bestLabel = hasMerchant ? txnMerchant : txnDescription;

  // Resolve account display name for the prefill banner
  const acct = accountId ? accounts.find(a => a.account_id === accountId) : null;
  const accountDisplayName = acct ? _buildAccountDisplayName(acct) : '';

  sessionStorage.setItem('pf_rule_prefill', JSON.stringify({
    txnName: txnDescription,
    txnMerchant: txnMerchant,
    txnAmount: txnAmount,
    txnCurrency: txnCurrency,
    txnSource: txnSource,
    userOverride: userOverride,
    accountId: accountId || '',
    accountDisplayName: accountDisplayName,
    targetCategory: resolvedTarget.value,
    defaultMatchType: defaultMatchType,
    defaultMatchValue: defaultMatchValue,
    defaultRuleName: `${selectedPrimary}${selectedDetailed ? ' - ' + selectedDetailed : ''} (${bestLabel})`.trim(),
  }));

  // Invalidate categories cache so freshly created rules appear immediately
  try {
    localStorage.removeItem('pf_catpage_data');
    localStorage.removeItem('pf_catpage_cached_at');
  } catch (cacheError) { /* non-fatal */ }

  window.location.href = 'categories.html#rules';
}


// ───── Categorize Modal ─────

function openCategorizeModal(txn, selectedCategory, accountId, txnId) {
  const categoryOptions = buildCategoryOptions(selectedCategory);

  openModal({
    title: 'Categorize Transaction',
    body: `
      <div>
        <p><strong>${escapeHtml(txn?.name || 'Transaction')}</strong></p>
        <p class="pill">${escapeHtml(txn?.date || '')}</p>
      </div>
      <div style="margin-top: 12px;">
        <label>Category</label>
        <select id="modal-category-select" class="table-inline-select">${categoryOptions}</select>
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Save', onClick: () => _applyCategorizeAndClose(txn, txnId, accountId) }
    ]
  });
}

async function _applyCategorizeAndClose(txn, txnId, accountId) {
  const selectedCategory = document.getElementById('modal-category-select').value;

  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/categorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_category: selectedCategory })
    });
    const data = await response.json();
    if (!response.ok) {
      showStatus(data.error || 'Failed to categorize transaction', 'error');
      return;
    }

    closeModal();

    _patchCategorizationCache(txnId, data, selectedCategory, true);
    showStatus('Transaction categorized', 'success');
    renderTransactionTable();
    setTimeout(() => clearStatus(), 2000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (cacheError) { /* non-fatal */ }
  } catch (networkError) {
    showStatus(`Failed to categorize transaction: ${networkError.message}`, 'error');
  }
}

// ───── Category Data Loading ─────

/**
 * Load available categories and Plaid taxonomy for categorization features.
 * Uses localStorage cache to avoid redundant API calls (categories rarely change).
 */
async function loadAvailableCategories(forceNetwork = false) {
  const CAT_CACHE_KEY = 'pf_cached_categories';
  const TAX_CACHE_KEY = 'pf_cached_taxonomy';
  const CAT_TS_KEY = 'pf_categories_cached_at';
  const CAT_MAX_AGE_MS = 10 * 1000; // 10 seconds — kept ultra-short during development to avoid stale-data confusion

  // Try cache first
  if (!forceNetwork) {
    const cachedAt = localStorage.getItem(CAT_TS_KEY);
    const cacheAge = cachedAt ? (Date.now() - parseInt(cachedAt)) : Infinity;
    if (cacheAge < CAT_MAX_AGE_MS) {
      try {
        const cachedCats = JSON.parse(localStorage.getItem(CAT_CACHE_KEY) || '[]');
        const cachedTax = JSON.parse(localStorage.getItem(TAX_CACHE_KEY) || '[]');
        if (cachedCats.length > 0) {
          availableCategories = cachedCats;
          plaidTaxonomy = cachedTax;
          console.log(`Loaded ${availableCategories.length} categories and ${plaidTaxonomy.length} taxonomy from cache`);
          return;
        }
      } catch (e) {
        console.warn('Category cache parse error, fetching from server:', e);
      }
    }
  }

  try {
    const [categoriesRes, taxonomyRes] = await Promise.all([
      authenticatedFetch(`${BACKEND_URL}/api/categorization/categories/available`),
      authenticatedFetch(`${BACKEND_URL}/api/categorization/plaid-taxonomy`)
    ]);

    if (categoriesRes.ok) {
      const data = await categoriesRes.json();
      availableCategories = data.available_categories || [];
    } else {
      console.error('Failed to load available categories');
      availableCategories = [];
    }

    if (taxonomyRes.ok) {
      const data = await taxonomyRes.json();
      plaidTaxonomy = data.categories || [];
    } else {
      console.error('Failed to load Plaid taxonomy');
      plaidTaxonomy = [];
    }
    
    console.log(`Loaded ${availableCategories.length} available categories and ${plaidTaxonomy.length} taxonomy entries`);
    
    // Cache for future page loads
    try {
      localStorage.setItem(CAT_CACHE_KEY, JSON.stringify(availableCategories));
      localStorage.setItem(TAX_CACHE_KEY, JSON.stringify(plaidTaxonomy));
      localStorage.setItem(CAT_TS_KEY, String(Date.now()));
    } catch (e) {
      console.warn('Could not cache categories to localStorage:', e);
    }
  } catch (error) {
    console.error('Error loading category data:', error);
    availableCategories = [];
    plaidTaxonomy = [];
  }
}

/**
 * DEAD CODE. Trigger backend recategorization of all transactions.
 * Updates the transactions table with computed user_category values.
 */
async function recategorizeTransactions() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/transactions/recategorize`, {
      method: 'POST'
    });

    if (!response.ok) {
      const data = await response.json();
      console.error('Recategorization failed:', data.error);
      throw new Error(data.error || 'Recategorization failed');
    }

    const data = await response.json();
    console.log('Recategorization complete:', data);
    return data;
  } catch (error) {
    console.error('Error recategorizing transactions:', error);
    throw error;
  }
}

// ───── Dev Utility ─────

/**
 * TEST FUNCTION: Run category parsing tests.
 * Call this from browser console: testCategoryParsing()
 */
function testCategoryParsing() {
  console.log('=== Testing Category Parsing Functions ===\n');
  
  const testCases = [
    'Getting Around: Bikes and Scooters',
    'Food And Drink: Fast Food',
    'TRANSPORTATION_BIKES_AND_SCOOTERS',
    'TRANSFER_IN_WIRE',
    'FOOD_AND_DRINK_FAST_FOOD',
    'bike stuff',
    'INCOME'
  ];
  
  testCases.forEach(testCase => {
    const parsed = parseCategoryString(testCase);
    console.log(`Input: "${testCase}"`);
    console.log(`  Primary: "${parsed.primary}"`);
    console.log(`  Detailed: "${parsed.detailed}"`);
    console.log(`  Full: "${parsed.full}"`);
    
    if (parsed.primary && parsed.detailed) {
      const rebuilt = buildCategoryString(parsed.primary, parsed.detailed);
      console.log(`  Rebuilt: "${rebuilt}"`);
    }
    console.log('');
  });
  
  console.log('=== Testing Category Extraction ===\n');
  const mockCategories = [
    'Food And Drink: Fast Food',
    'Food And Drink: Restaurant',
    'Food And Drink: Groceries',
    'Transportation: Gas',
    'Transportation: Parking',
    'bike stuff'
  ];
  
  const primaries = extractPrimaryCategories(mockCategories);
  console.log('Extracted primaries:', primaries);
  
  const foodDetails = extractDetailedCategories(mockCategories, 'Food And Drink');
  console.log('Food And Drink detailed categories:', foodDetails);
  
  const transportDetails = extractDetailedCategories(mockCategories, 'Transportation');
  console.log('Transportation detailed categories:', transportDetails);
  
  console.log('\n=== Tests Complete ===');
}
