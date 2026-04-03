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
        const overrideBtn = $(input).closest('.category-cell').find('.category-override');
        if (overrideBtn.length) {
          overrideBtn.click();
        }
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

  // ===== Override button click handler =====
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
    const txn = transactions.find(t => t.transaction_id === txnId);
    openCategoryRuleModal(txn, parsed.primary, parsed.detailed, txnId, accountId);
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
    
    // Update local array directly instead of full re-sync —
    // the backend already updated the encrypted_transactions table.
    const txn = transactions.find(t => t.transaction_id === txnId);
    if (txn) {
      txn.user_category = categoryString;
      txn.is_override = true;
      _cacheTransactions(transactions);
    }
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

    // Refresh transactions and sidebar balances — the counterpart
    // transaction changes the target account's balance.
    await Promise.all([fetchAllTransactions(true), loadAccounts()]);

    // fetchAllTransactions renders the table immediately, but reads the stale
    // balanceHistoryLookup that was built when the account was last selected.
    // Re-fetching history and re-rendering ensures the new transfer transaction
    // row shows a running balance without the user having to re-click the account.
    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
      renderTransactionTable();
    }

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

    showStatus('Transfer pair unlinked', 'success');
    // Refresh both transactions and sidebar balances — the unlinked
    // counterpart may have changed a different account's balance.
    await Promise.all([fetchAllTransactions(true), loadAccounts()]);

    if (selectedAccountMode === 'single' && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
      renderTransactionTable();
    }

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
function openCategoryRuleModal(txn, selectedPrimary, selectedDetailed, txnId, accountId) {
  if (!selectedPrimary) {
    showStatus('Please select a primary category', 'warning');
    return;
  }

  const resolvedTarget = resolveTargetCategory(selectedPrimary, selectedDetailed);
  if (resolvedTarget.error) {
    showStatus(resolvedTarget.error, 'warning');
    return;
  }

  // originalCategory is used later to detect whether the user changed the
  // category inside the modal (triggers an override on the source transaction).
  const originalCategory = resolvedTarget.value;

  // --- Transaction field values for preview & smart defaults ---
  const txnDescription = txn?.name || '';
  const txnMerchant   = txn?.merchant_name || '';
  const txnAmount     = txn?.amount != null ? Math.abs(txn.amount) : '';
  const txnCurrency   = txn?.iso_currency_code || 'USD';

  // Smart default: prefer merchant if available, fall back to description
  const hasMerchant = !!txnMerchant;
  const defaultMatchType  = hasMerchant ? 'merchant_contains' : 'name_contains';
  const defaultMatchValue = hasMerchant ? txnMerchant : txnDescription;
  const bestLabel = hasMerchant ? txnMerchant : txnDescription;
  const defaultRuleName = `${selectedPrimary}${selectedDetailed ? ' - ' + selectedDetailed : ''} (${bestLabel})`.trim();

  // Format amount for display
  const fmtAmount = txnAmount !== '' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: txnCurrency }).format(txnAmount) : '—';

  // Pre-build category dropdown options using the same helpers used in table rows.
  const primaryOptions   = buildPrimaryDropdownOptions(selectedPrimary);
  const detailedOptions  = buildDetailedDropdownOptions(selectedPrimary, selectedDetailed);
  // Disable the detailed select when the selected primary has no detailed categories
  // (buildDetailedDropdownOptions renders a placeholder option in that case).
  const noDetailedAvailable = selectedPrimary === 'Uncategorized' ||
                               extractDetailedCategories(availableCategories, selectedPrimary).length === 0;

  // Build rule configuration form — all colors use CSS variables so they
  // automatically match the VS Code dark theme defined in theme.css.
  const formHtml = `
    <div style="display: grid; gap: 14px;">

      <!-- Transaction preview so users can see what each field refers to -->
      <details open class="rule-modal-preview">
        <summary style="font-weight: 600; cursor: pointer; user-select: none;">Transaction being matched</summary>
        <table style="width:100%; margin-top: 8px; font-size: 0.92em; border-collapse: collapse;">
          <tr>
            <td class="rule-modal-label">Description</td>
            <td style="padding:3px 0; font-family: monospace;">${escapeHtml(txnDescription) || '<em class="rule-modal-empty">empty</em>'}</td>
          </tr>
          <tr>
            <td class="rule-modal-label">Merchant</td>
            <td style="padding:3px 0; font-family: monospace;">${escapeHtml(txnMerchant) || '<em class="rule-modal-empty">not available</em>'}</td>
          </tr>
          <tr>
            <td class="rule-modal-label">Amount</td>
            <td style="padding:3px 0; font-family: monospace;">${fmtAmount}</td>
          </tr>
        </table>
      </details>

      <div>
        <label class="rule-modal-field-label">Rule Name</label>
        <input id="rule-modal-name" type="text" placeholder="Rule name"
               value="${escapeHtml(defaultRuleName)}" class="modal-input">
      </div>

      <div>
        <label class="rule-modal-field-label">Match Type</label>
        <select id="rule-modal-match-type" onchange="_ruleModalMatchTypeChanged()" class="modal-input">
          <option value="name_contains"${defaultMatchType === 'name_contains' ? ' selected' : ''}>Description contains</option>
          <option value="merchant_contains"${defaultMatchType === 'merchant_contains' ? ' selected' : ''}>Merchant contains</option>
          <option value="amount_range">Amount range</option>
          <option value="regex">Regular expression (advanced)</option>
        </select>
        <small id="rule-modal-match-hint" class="rule-modal-hint"></small>
      </div>

      <!-- Text-based match value (description / merchant / regex) -->
      <div id="rule-modal-text-group">
        <label class="rule-modal-field-label">Match Value</label>
        <input id="rule-modal-match-value" type="text" placeholder="Text to search for"
               value="${escapeHtml(defaultMatchValue)}" class="modal-input">
      </div>

      <!-- Amount range inputs (shown only for amount_range) -->
      <div id="rule-modal-amount-group" style="display: none;">
        <label class="rule-modal-field-label">Amount Range</label>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input id="rule-modal-amount-min" type="number" step="0.01" min="0"
                 placeholder="Min" value="" class="modal-input" style="flex:1;">
          <span style="color: var(--text-secondary);">to</span>
          <input id="rule-modal-amount-max" type="number" step="0.01" min="0"
                 placeholder="Max" value="" class="modal-input" style="flex:1;">
        </div>
        <small class="rule-modal-hint">Leave either blank for no limit. Matches absolute value of amount.</small>
      </div>

      <div>
        <label class="rule-modal-field-label">Priority</label>
        <input id="rule-modal-priority" type="number" placeholder="0" value="0" class="modal-input">
        <small class="rule-modal-hint">Higher priority rules are applied first. Default is 0.</small>
      </div>

      <label id="rule-modal-case-row" style="display: flex; align-items: center; gap: 6px;">
        <input id="rule-modal-case-sensitive" type="checkbox">
        <span style="font-weight: 500;">Case sensitive</span>
      </label>

      <label style="display: flex; align-items: center; gap: 6px;">
        <input id="rule-modal-active" type="checkbox" checked>
        <span style="font-weight: 500;">Active</span>
      </label>

      <!-- Editable category assignment — changing this also updates the
           source transaction (override), same as editing it in the table. -->
      <div class="rule-modal-category-block">
        <div class="rule-modal-category-header">
          <span class="rule-modal-category-title">Assign category</span>
          <span class="rule-modal-category-sub">Changing this will also update this transaction</span>
        </div>
        <div style="display: grid; gap: 8px; margin-top: 8px;">
          <select id="rule-modal-primary" class="modal-input">${primaryOptions}</select>
          <select id="rule-modal-detailed" class="modal-input"${noDetailedAvailable ? ' disabled' : ''}>${detailedOptions}</select>
        </div>
      </div>

    </div>
  `;

  openModal({
    title: 'Create Categorization Rule',
    body: formHtml,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Create Rule', onClick: () => submitCategoryRule(txnId, accountId, originalCategory) }
    ]
  });

  // Wire primary dropdown → refresh detailed options
  const primarySelect  = document.getElementById('rule-modal-primary');
  const detailedSelect = document.getElementById('rule-modal-detailed');
  if (primarySelect && detailedSelect) {
    primarySelect.addEventListener('change', () => {
      const newPrimary = primarySelect.value;
      detailedSelect.innerHTML = buildDetailedDropdownOptions(newPrimary, '');
      const hasOptions = extractDetailedCategories(availableCategories, newPrimary).length > 0;
      detailedSelect.disabled = !hasOptions;
    });
  }

  // Store txn data on the modal for match-type switching
  window._ruleModalTxn = { description: txnDescription, merchant: txnMerchant, amount: txnAmount };

  // Trigger hint update for initial match type
  _ruleModalMatchTypeChanged();
}

/**
 * Update the rule modal form when the match type dropdown changes.
 * Toggles between text input and amount-range inputs and updates hints.
 */
function _ruleModalMatchTypeChanged() {
  const matchType  = document.getElementById('rule-modal-match-type').value;
  const textGroup  = document.getElementById('rule-modal-text-group');
  const amtGroup   = document.getElementById('rule-modal-amount-group');
  const hintEl     = document.getElementById('rule-modal-match-hint');
  const caseRow    = document.getElementById('rule-modal-case-row');
  const matchInput = document.getElementById('rule-modal-match-value');
  const txnData    = window._ruleModalTxn || {};

  // Toggle field visibility
  const isAmount = matchType === 'amount_range';
  textGroup.style.display  = isAmount ? 'none' : '';
  amtGroup.style.display   = isAmount ? ''     : 'none';
  caseRow.style.display    = isAmount ? 'none' : 'flex';

  // Update hint & pre-fill based on selected match type
  switch (matchType) {
    case 'name_contains':
      hintEl.textContent = 'Matches the Description column of your transactions.';
      matchInput.value = txnData.description || '';
      matchInput.placeholder = 'Text to search for in description';
      break;
    case 'merchant_contains':
      hintEl.textContent = 'Matches the Merchant field (may be empty for some transactions).';
      matchInput.value = txnData.merchant || '';
      matchInput.placeholder = 'Text to search for in merchant name';
      break;
    case 'amount_range': {
      hintEl.textContent = 'Matches transactions whose absolute amount falls within this range.';
      // Pre-fill with a reasonable range around the current amount
      const amt = txnData.amount;
      if (amt !== '' && amt != null) {
        const rounded = Math.round(amt * 100) / 100;
        document.getElementById('rule-modal-amount-min').value = Math.max(0, rounded - 5).toFixed(2);
        document.getElementById('rule-modal-amount-max').value = (rounded + 5).toFixed(2);
      }
      break;
    }
    case 'regex':
      hintEl.textContent = 'Advanced: matches the Description field using a regular expression pattern.';
      matchInput.value = txnData.description || '';
      matchInput.placeholder = 'Regular expression pattern';
      break;
  }
}

/**
 * Submit the rule creation form and call the API.
 *
 * If the user changed the category inside the modal (vs originalCategory),
 * we first apply a manual override to the source transaction — same behavior
 * as editing the category inline in the table.
 */
async function submitCategoryRule(txnId, accountId, originalCategory) {
  const ruleName = document.getElementById('rule-modal-name').value.trim();
  const matchType = document.getElementById('rule-modal-match-type').value;
  const priority = parseInt(document.getElementById('rule-modal-priority').value || '0', 10);
  const caseSensitive = document.getElementById('rule-modal-case-sensitive').checked;
  const isActive = document.getElementById('rule-modal-active').checked;

  // Read the (possibly edited) category from the dropdowns
  const selectedPrimary  = document.getElementById('rule-modal-primary')?.value || '';
  const selectedDetailed = document.getElementById('rule-modal-detailed')?.value || '';
  const resolvedTarget   = resolveTargetCategory(selectedPrimary, selectedDetailed);
  if (resolvedTarget.error) {
    showStatus(resolvedTarget.error, 'warning');
    return;
  }
  const targetCategory = resolvedTarget.value;

  if (!ruleName) {
    showStatus('Rule name is required', 'warning');
    return;
  }

  // Build matchValue based on match type
  let matchValue;
  if (matchType === 'amount_range') {
    const minVal = document.getElementById('rule-modal-amount-min').value.trim();
    const maxVal = document.getElementById('rule-modal-amount-max').value.trim();
    if (!minVal && !maxVal) {
      showStatus('Please enter at least a minimum or maximum amount', 'warning');
      return;
    }
    matchValue = {};
    if (minVal) matchValue.min = parseFloat(minVal);
    if (maxVal) matchValue.max = parseFloat(maxVal);
  } else {
    matchValue = document.getElementById('rule-modal-match-value').value.trim();
  }

  if (matchType !== 'amount_range' && !matchValue) {
    showStatus('Match value is required', 'warning');
    return;
  }

  const targetValidation = validateTargetCategory(targetCategory);
  if (targetValidation.error) {
    showStatus(targetValidation.error, 'warning');
    return;
  }

  try {
    // If the user changed the category, apply an override to the source
    // transaction before creating the rule, so both changes land atomically
    // from the user's perspective.
    if (txnId && targetCategory !== originalCategory) {
      const overrideResponse = await authenticatedFetch(
        `${BACKEND_URL}/api/categorization/transactions/${encodeURIComponent(txnId)}/categorize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_category: targetCategory })
        }
      );
      const overrideData = await overrideResponse.json();
      if (!overrideResponse.ok) {
        showStatus(overrideData.error || 'Failed to update transaction category', 'error');
        return;
      }
      // Sync the local transactions array so the table reflects this immediately
      const txn = transactions.find(t => t.transaction_id === txnId);
      if (txn) {
        txn.user_category = overrideData.updated_category || targetCategory;
        txn.is_override = true;
      }
    }

    const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rule_name: ruleName,
        match_criteria: {
          match_type: matchType,
          match_value: matchValue,
          case_sensitive: caseSensitive
        },
        target_category: targetCategory,
        priority: priority,
        is_active: isActive
      })
    });

    const data = await response.json();

    if (!response.ok) {
      showStatus(data.error || 'Failed to create rule', 'error');
      return;
    }

    closeModal();
    showStatus(`Rule created: "${ruleName}". Recategorizing transactions...`, 'success');

    // Backend already applied rule to matching transactions.
    // Re-fetch transaction list if any were updated (no Plaid sync needed).
    const updatedCount = data.transactions_updated || 0;
    const skippedCount = data.overrides_skipped || 0;

    if (updatedCount > 0 || skippedCount > 0) {
      await fetchAllTransactions(true);
      let msg = `Rule created: "${ruleName}" — applied to ${updatedCount} transaction${updatedCount !== 1 ? 's' : ''}`;
      if (skippedCount > 0) {
        msg += `. ${skippedCount} transaction${skippedCount !== 1 ? 's were' : ' was'} skipped because ${skippedCount !== 1 ? 'they have' : 'it has'} a manual override.`;
      }
      showStatus(msg, 'success');
    } else {
      showStatus(`Rule created: "${ruleName}" — will apply to future transactions`, 'success');
    }

    setTimeout(() => clearStatus(), 3000);
  } catch (error) {
    showStatus(`Failed to create rule: ${error.message}`, 'error');
  }
}

// ───── Categorize Modal (legacy simple modal) ─────

function openCategorizeModal(txn, selectedCategory, accountId, txnId) {
  const merchant = txn?.merchant_name || txn?.name || '';
  const categoryOptions = buildCategoryOptions(selectedCategory);
  const defaultRuleName = `${selectedCategory} - ${merchant}`.trim();
  const defaultMatchValue = merchant || txn?.name || '';

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
      <div style="margin-top: 12px;">
        <label class="inline-checkbox"><input id="modal-save-rule" type="checkbox"> Save as rule for future transactions</label>
      </div>
      <div id="modal-rule-fields" style="margin-top: 8px; display: none;">
        <input id="modal-rule-name" type="text" placeholder="Rule name" value="${escapeHtml(defaultRuleName)}">
        <select id="modal-rule-match-type">
          <option value="merchant_contains">Merchant contains</option>
          <option value="name_contains">Name contains</option>
          <option value="amount_range">Amount range</option>
          <option value="regex">Regular expression (advanced)</option>
        </select>
        <input id="modal-rule-match-value" type="text" placeholder="Match value" value="${escapeHtml(defaultMatchValue)}">
        <label class="inline-checkbox"><input id="modal-rule-case" type="checkbox"> Case sensitive</label>
        <input id="modal-rule-priority" type="number" value="0" placeholder="Priority">
      </div>
    `,
    actions: [
      { label: 'Cancel', className: 'secondary', onClick: closeModal },
      { label: 'Save', onClick: () => applyManualCategory(txnId, accountId) }
    ]
  });

  const saveRuleCheckbox = document.getElementById('modal-save-rule');
  if (saveRuleCheckbox) {
    saveRuleCheckbox.addEventListener('change', () => {
      const fields = document.getElementById('modal-rule-fields');
      fields.style.display = saveRuleCheckbox.checked ? 'grid' : 'none';
    });
  }
}

async function applyManualCategory(txnId, accountId) {
  const selectedCategory = document.getElementById('modal-category-select').value;
  const saveRule = document.getElementById('modal-save-rule').checked;

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

    if (saveRule) {
      await createRuleFromModal(selectedCategory);
    }

    closeModal();
    // Update local array directly — backend already persisted the override
    const txn = transactions.find(t => t.transaction_id === txnId);
    if (txn) {
      txn.user_category = selectedCategory;
      txn.is_override = true;
      _cacheTransactions(transactions);
    }
    showStatus('Transaction categorized', 'success');
    renderTransactionTable();
    setTimeout(() => clearStatus(), 2000);
    // Invalidate categories page cache so overrides summary refreshes
    try {
      localStorage.removeItem('pf_catpage_data');
      localStorage.removeItem('pf_catpage_cached_at');
    } catch (e) { /* cache removal failure is non-fatal */ }
  } catch (error) {
    showStatus(`Failed to categorize transaction: ${error.message}`, 'error');
  }
}

async function createRuleFromModal(targetCategory) {
  const ruleName = document.getElementById('modal-rule-name').value.trim();
  const matchType = document.getElementById('modal-rule-match-type').value;
  const matchValue = document.getElementById('modal-rule-match-value').value.trim();
  const caseSensitive = document.getElementById('modal-rule-case').checked;
  const priority = parseInt(document.getElementById('modal-rule-priority').value || '0', 10);

  if (!ruleName || !matchValue) {
    showStatus('Rule name and match value are required', 'warning');
    return;
  }

  const targetValidation = validateTargetCategory(targetCategory);
  if (targetValidation.error) {
    showStatus(targetValidation.error, 'warning');
    return;
  }

  const response = await authenticatedFetch(`${BACKEND_URL}/api/categorization/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rule_name: ruleName,
      match_criteria: {
        match_type: matchType,
        match_value: matchValue,
        case_sensitive: caseSensitive
      },
      target_category: targetCategory,
      priority
    })
  });

  const data = await response.json();
  if (!response.ok) {
    showStatus(data.error || 'Failed to create rule', 'error');
    return;
  }

  // Invalidate categories page cache so newly created rule shows up immediately
  try {
    localStorage.removeItem('pf_catpage_data');
    localStorage.removeItem('pf_catpage_cached_at');
  } catch (e) { /* cache removal failure is non-fatal */ }

  showStatus(`Rule "${ruleName}" created successfully (${data.transactions_updated} transactions updated)`, 'success');
  setTimeout(() => clearStatus(), 2000);
  
  // Close the modal after successful creation
  closeModal();
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
 * Trigger backend recategorization of all transactions.
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
