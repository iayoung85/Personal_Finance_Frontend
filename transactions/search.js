// ============================================================
// transactions/search.js — Transaction Search Engine
// Parses simple and advanced (Gmail-style) search queries and
// filters transactions client-side. Supports field-specific
// operators, quoted phrases, negation, and numeric ranges.
// ============================================================

/**
 * Parse a search query string into structured tokens.
 *
 * Supported syntax:
 *   plain text        → matches across all searchable fields
 *   "quoted phrase"   → exact phrase match across all fields
 *   -term             → exclude transactions matching term
 *   field:value       → match specific field
 *   field:"phrase"    → match specific field with exact phrase
 *   -field:value      → exclude on specific field
 *   amount:800        → fuzzy: these digits appear in the amount, either direction
 *   amount:>100       → signed comparison: money in over 100
 *   amount:<-100      → signed comparison: money out over 100
 *   amount:-200..-50  → signed range
 *   amount:=800       → exact amount, either direction (also ==)
 *   amount:=-800      → exact amount in one direction (+ or -)
 *
 * Recognized field operators:
 *   description, desc     → description / user_description_override
 *   merchant, from        → merchant_name
 *   category, cat         → user_category (user-assigned only; Plaid PFC ignored)
 *   memo                  → user_memo
 *   amount, amt           → transaction amount (supports >, <, >=, <=, .., =)
 *   date                  → transaction date (supports ..)
 *   bank, account         → bank_account display name
 *   label                 → user_category, exact match (case-insensitive)
 *   pfc                   → Plaid detailed category key, exact match
 *   confidence            → Plaid category confidence level, exact match
 *   is                    → boolean flags: pending, hidden, transfer, split, override
 *   bill, bill_id         → bill_id, as shown in the inspect panel
 *   txn, id               → transaction_id
 *   plaid, plaid_id       → plaid_transaction_id
 *   account_id, acct_id   → account_id (account: is the display name)
 *
 * Returns an array of token objects:
 *   { type: 'text'|'field', negate: bool, field?: string, value: string,
 *     comparison?: '>'|'<'|'>='|'<='|'range'|'exact', rangeEnd?: string,
 *     sign?: 1|-1 }
 */
function parseSearchQuery(queryString) {
  const tokens = [];
  if (!queryString || !queryString.trim()) return tokens;

  const raw = queryString.trim();
  let position = 0;

  while (position < raw.length) {
    // Skip whitespace
    if (raw[position] === ' ') { position++; continue; }

    let negate = false;
    if (raw[position] === '-' && position + 1 < raw.length && raw[position + 1] !== ' ') {
      negate = true;
      position++;
    }

    // Check for quoted phrase
    if (raw[position] === '"') {
      const closeQuote = raw.indexOf('"', position + 1);
      if (closeQuote !== -1) {
        tokens.push({ type: 'text', negate, value: raw.substring(position + 1, closeQuote) });
        position = closeQuote + 1;
        continue;
      }
    }

    // Extract next word/token (up to space or end)
    let endOfToken = position;
    // Handle field:"quoted value" by tracking quote state
    let insideQuotes = false;
    while (endOfToken < raw.length) {
      if (raw[endOfToken] === '"') {
        insideQuotes = !insideQuotes;
      } else if (raw[endOfToken] === ' ' && !insideQuotes) {
        break;
      }
      endOfToken++;
    }
    const tokenStr = raw.substring(position, endOfToken);
    position = endOfToken;

    // Check for field:value pattern
    const colonIndex = tokenStr.indexOf(':');
    if (colonIndex > 0) {
      const fieldName = tokenStr.substring(0, colonIndex).toLowerCase();
      let fieldValue = tokenStr.substring(colonIndex + 1);

      // Strip surrounding quotes from value
      if (fieldValue.startsWith('"') && fieldValue.endsWith('"')) {
        fieldValue = fieldValue.substring(1, fieldValue.length - 1);
      }

      const knownField = _normalizeFieldName(fieldName);
      if (knownField) {
        const token = { type: 'field', negate, field: knownField, value: fieldValue };

        // Parse numeric comparisons for amount field
        if (knownField === 'amount') {
          _parseAmountComparison(token, fieldValue);
        }

        // Parse date ranges
        if (knownField === 'date' && fieldValue.includes('..')) {
          const parts = fieldValue.split('..');
          token.value = parts[0];
          token.rangeEnd = parts[1];
          token.comparison = 'range';
        }

        tokens.push(token);
        continue;
      }
    }

    // Plain text token (strip any leftover quotes)
    const cleanValue = tokenStr.replace(/"/g, '');
    if (cleanValue) {
      tokens.push({ type: 'text', negate, value: cleanValue });
    }
  }

  return tokens;
}

/**
 * Map user-friendly field aliases to canonical internal field names.
 */
function _normalizeFieldName(name) {
  const FIELD_ALIASES = {
    description: 'description',
    desc: 'description',
    merchant: 'merchant',
    from: 'merchant',
    category: 'category',
    cat: 'category',
    memo: 'memo',
    amount: 'amount',
    amt: 'amount',
    date: 'date',
    bank: 'bank',
    account: 'bank',
    is: 'is',
    label: 'label',
    pfc: 'pfc',
    confidence: 'confidence',
    bill: 'bill_id',
    bill_id: 'bill_id',
    txn: 'transaction_id',
    id: 'transaction_id',
    transaction_id: 'transaction_id',
    plaid: 'plaid_transaction_id',
    plaid_id: 'plaid_transaction_id',
    plaid_transaction_id: 'plaid_transaction_id',
    account_id: 'account_id',
    acct_id: 'account_id',
  };
  return FIELD_ALIASES[name] || null;
}

/**
 * Parse amount comparison operators (>, <, >=, <=, .., =) from the value string.
 * Mutates the token in-place with comparison type and cleaned numeric value.
 *
 * Comparisons and ranges read the ledger sign (negative is money out), so
 * amount:<-100 is spending over 100 and amount:>100 is income over 100.
 * The exact form is the forgiving one: amount:=800 matches either direction,
 * and amount:=-800 or amount:=+800 narrows it. The bare fuzzy form ignores sign.
 */
function _parseAmountComparison(token, rawValue) {
  // Exact: amount:=800, amount:==800, amount:=-800
  if (rawValue.startsWith('=')) {
    token.comparison = 'exact';
    let exactValue = rawValue.replace(/^==?/, '');
    if (exactValue.startsWith('-')) {
      token.sign = -1;
      exactValue = exactValue.substring(1);
    } else if (exactValue.startsWith('+')) {
      token.sign = 1;
      exactValue = exactValue.substring(1);
    }
    token.value = exactValue;
    return;
  }
  // Range: amount:50..200
  if (rawValue.includes('..')) {
    const parts = rawValue.split('..');
    token.value = parts[0];
    token.rangeEnd = parts[1];
    token.comparison = 'range';
    return;
  }
  // Comparison operators: >=, <=, >, <
  if (rawValue.startsWith('>=')) {
    token.comparison = '>=';
    token.value = rawValue.substring(2);
  } else if (rawValue.startsWith('<=')) {
    token.comparison = '<=';
    token.value = rawValue.substring(2);
  } else if (rawValue.startsWith('>')) {
    token.comparison = '>';
    token.value = rawValue.substring(1);
  } else if (rawValue.startsWith('<')) {
    token.comparison = '<';
    token.value = rawValue.substring(1);
  }
  // else: exact match (no comparison operator set)
}

/**
 * Gather all searchable text fields from a transaction into a single
 * lowercase string for broad (non-field-specific) matching.
 */
function _buildSearchableText(txn) {
  // Category matching uses ONLY user_category. The Plaid-assigned
  // personal_finance_category is intentionally excluded — when a user
  // overrides Plaid's classification (e.g., re-labels an INCOME row
  // as a Transfer), the search must reflect the user's intent, not
  // the stale Plaid label.
  const parts = [
    txn.description || txn.name || '',
    txn.user_description_override || '',
    txn.merchant_name || '',
    txn.user_category || '',
    txn.user_memo || '',
    txn.date || '',
    txn.bank_account || '',
  ];

  // Include amount as string so users can type dollar amounts
  if (txn.amount !== undefined && txn.amount !== null) {
    const absAmount = Math.abs(txn.amount);
    parts.push(String(absAmount));
    parts.push(absAmount.toFixed(2));
  }

  return parts.join(' ').toLowerCase();
}

/**
 * Test whether a single transaction matches a parsed search query.
 * All tokens use AND logic — every token must match (or not-match if negated).
 *
 * @param {Object} txn          - Transaction object from the global array
 * @param {Array}  parsedTokens - Output of parseSearchQuery()
 * @returns {boolean} true if the transaction satisfies all tokens
 */
function transactionMatchesSearch(txn, parsedTokens) {
  if (!parsedTokens || parsedTokens.length === 0) return true;

  const searchableText = _buildSearchableText(txn);

  for (const token of parsedTokens) {
    let matched = false;

    if (token.type === 'text') {
      matched = searchableText.includes(token.value.toLowerCase());
    } else if (token.type === 'field') {
      matched = _matchFieldToken(txn, token);
    }

    // Negate flips the match result
    if (token.negate) matched = !matched;

    // AND logic: all tokens must pass
    if (!matched) return false;
  }

  return true;
}

/**
 * Match a field-specific search token against the appropriate transaction property.
 */
function _matchFieldToken(txn, token) {
  const valueLower = (token.value || '').toLowerCase();

  switch (token.field) {
    case 'description': {
      const description = (txn.description || txn.name || '').toLowerCase();
      const override = (txn.user_description_override || '').toLowerCase();
      return description.includes(valueLower) || override.includes(valueLower);
    }

    case 'merchant': {
      const merchantName = (txn.merchant_name || '').toLowerCase();
      return merchantName.includes(valueLower);
    }

    case 'category': {
      // Only match the user-assigned category. Plaid's
      // personal_finance_category is deliberately ignored so a user-
      // overridden row (e.g., Plaid INCOME re-labeled as Transfer)
      // does not leak back into category-based search results.
      const userCat = (txn.user_category || '').toLowerCase();
      return userCat.includes(valueLower);
    }

    case 'label': {
      return (txn.user_category || '').toLowerCase() === valueLower;
    }

    case 'pfc': {
      const pfc = txn.personal_finance_category;
      return !!pfc && (pfc.detailed || '').toLowerCase() === valueLower;
    }

    case 'confidence': {
      const pfc = txn.personal_finance_category;
      return !!pfc && (pfc.confidence_level || '').toLowerCase() === valueLower;
    }

    case 'memo': {
      const memo = (txn.user_memo || '').toLowerCase();
      return memo.includes(valueLower);
    }

    case 'amount': {
      return _matchAmountToken(txn, token);
    }

    case 'date': {
      return _matchDateToken(txn, token);
    }

    case 'bank': {
      const bankAccount = (txn.bank_account || '').toLowerCase();
      return bankAccount.includes(valueLower);
    }

    case 'is': {
      return _matchIsToken(txn, valueLower);
    }

    case 'bill_id':
    case 'transaction_id':
    case 'plaid_transaction_id':
    case 'account_id': {
      // Ids come from the inspect panel; a pasted fragment still finds the row.
      const idValue = txn[token.field];
      if (idValue === undefined || idValue === null) return false;
      return String(idValue).toLowerCase().includes(valueLower);
    }

    default:
      return false;
  }
}

/**
 * Match amount with optional comparison operators.
 * Comparisons and ranges are signed, following the ledger convention that
 * negative is money out. Only the fuzzy and unsigned-exact forms drop the sign.
 */
function _matchAmountToken(txn, token) {
  const signedAmount = txn.amount || 0;
  const absAmount = Math.abs(signedAmount);
  const targetValue = parseFloat(token.value);
  if (isNaN(targetValue)) return false;

  if (token.comparison === 'range') {
    const rangeEnd = parseFloat(token.rangeEnd);
    if (isNaN(rangeEnd)) return false;
    // Written in either order: -50..-200 means the same as -200..-50.
    const low = Math.min(targetValue, rangeEnd);
    const high = Math.max(targetValue, rangeEnd);
    return signedAmount >= low && signedAmount <= high;
  }

  if (token.comparison === '>') return signedAmount > targetValue;
  if (token.comparison === '<') return signedAmount < targetValue;
  if (token.comparison === '>=') return signedAmount >= targetValue;
  if (token.comparison === '<=') return signedAmount <= targetValue;

  if (token.comparison === 'exact') {
    // Amounts are stored to the cent, so a half-cent tolerance absorbs
    // float noise without letting a neighbouring cent through.
    if (Math.abs(absAmount - Math.abs(targetValue)) >= 0.005) return false;
    if (!token.sign || absAmount === 0) return true;
    return signedAmount * token.sign > 0;
  }

  // Fuzzy match: the digits typed appear anywhere in the amount, so
  // amount:800 finds 800.00 and 10,800.00 alike. amount:=800 is the exact form.
  const txnAmountStr = absAmount.toFixed(2);
  return txnAmountStr.includes(token.value);
}

/**
 * Match date field with optional range support.
 * Supports both exact date match and date ranges via ".." separator.
 */
function _matchDateToken(txn, token) {
  const txnDate = txn.date || '';

  if (token.comparison === 'range') {
    return txnDate >= token.value && txnDate <= token.rangeEnd;
  }

  // Partial date match: typing "2026-03" matches all March 2026 transactions
  return txnDate.startsWith(token.value);
}

/**
 * Match boolean flag tokens like is:pending, is:hidden, is:transfer, etc.
 */
function _matchIsToken(txn, flagName) {
  switch (flagName) {
    case 'pending':
      return txn.pending === true || txn.status === 'pending';
    case 'hidden':
      return txn.is_hidden === true;
    case 'transfer':
      return !!txn.transfer_pair_id || isTransferCategory(txn.user_category);
    case 'split':
      return txn.is_split === true;
    case 'override':
      return txn.is_override === true;
    case 'manual':
      return txn.source === 'manual';
    case 'plaid':
      return txn.source === 'plaid';
    case 'bill':
      return !!txn.bill_id;
    case 'future':
      return txn.status === 'future';
    case 'missing':
      return txn.status === 'missing';
    default:
      return false;
  }
}

// ===== Search UI Controller =====

/**
 * Initialize the search bar: attach input listeners with debounce,
 * clear button behavior, and help modal toggle.
 */
function initSearchBar() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  // Honor a ?search=… URL parameter so deep-link drill-downs (e.g. from the
  // category summary report) arrive with the filter already applied.
  try {
    const urlSearch = new URLSearchParams(window.location.search).get('search');
    if (urlSearch) {
      searchInput.value = urlSearch;
      searchQuery = urlSearch;
      searchTokens = parseSearchQuery(urlSearch);
      _toggleSearchClearButton(urlSearch);
    }
  } catch (urlParseError) {
    // A malformed query string should never wedge the page — fall back to
    // an empty search and continue.
    console.warn('Ignoring malformed ?search= parameter:', urlParseError);
  }

  let debounceTimer = null;

  searchInput.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    const query = this.value;

    // Show/hide clear button based on input content
    _toggleSearchClearButton(query);

    // Debounce: wait 250ms after user stops typing before filtering
    debounceTimer = setTimeout(() => {
      searchQuery = query;
      searchTokens = parseSearchQuery(query);
      renderTransactionTable();
    }, 250);
  });

  // Clear search on Escape key
  searchInput.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      clearSearch();
      this.blur();
    }
  });

  // Global keyboard shortcut: Ctrl/Cmd + F focuses the search bar
  // (only when no inline editor or modal is active)
  document.addEventListener('keydown', function(event) {
    const isModifierKey = event.ctrlKey || event.metaKey;
    if (isModifierKey && event.key === 'f') {
      const activeElement = document.activeElement;
      const isEditingInline = activeElement && (
        activeElement.classList.contains('inline-edit-input')
        || activeElement.classList.contains('inline-memo-input')
        || activeElement.classList.contains('category-input')
      );
      const isModalOpen = document.querySelector('.modal:not(.hidden)');

      if (!isEditingInline && !isModalOpen) {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    }
  });
}

/**
 * Show or hide the small "×" clear button beside the search input.
 */
function _toggleSearchClearButton(query) {
  const clearButton = document.getElementById('search-clear-btn');
  if (!clearButton) return;
  clearButton.style.display = query ? 'flex' : 'none';
}

/**
 * Clear the search input, reset state, and re-render.
 */
function clearSearch() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  searchQuery = '';
  searchTokens = [];
  _toggleSearchClearButton('');
  renderTransactionTable();
}

/**
 * Open the search help modal that explains advanced query syntax.
 */
function openSearchHelpModal() {
  const modal = document.getElementById('search-help-modal');
  if (modal) modal.classList.remove('hidden');
}

/**
 * Close the search help modal.
 */
function closeSearchHelpModal() {
  const modal = document.getElementById('search-help-modal');
  if (modal) modal.classList.add('hidden');
}
