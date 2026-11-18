// ============================================================
// transactions/category-filter.js — Category filter logic
// Pure functions behind the Category filter box and the
// ?category= deep link. No DOM; covered by tests.
//
// Depends on (loaded earlier): transactions/categories.js
//   parseCategoryString, extractPrimaryCategories
// ============================================================

/**
 * Read the parameters the transactions page takes from its address.
 *
 * `search` fills the search bar; `category` is a primary name or a full
 * "Primary: Detailed" label for the Category filter box. Either one means the
 * page was opened to show a specific slice of the ledger, so it must not be
 * narrowed by the saved date range or account.
 *
 * A category link comes from a Uses count on the Categories page, which counts
 * hidden transactions, so the page must show them or the list would not match
 * the number. A search link comes from a report, which leaves hidden
 * transactions out, so it does not.
 *
 * @param {string} queryString The address's query string, with or without "?".
 * @returns {{hasSearch: boolean, search: string, category: string, forcesFullLedger: boolean, showsHiddenRows: boolean}}
 */
function parseTransactionsDeepLink(queryString) {
  const params = new URLSearchParams(queryString || '');
  const category = (params.get('category') || '').trim();
  const hasSearch = params.has('search');
  return {
    hasSearch,
    search: params.get('search') || '',
    category,
    forcesFullLedger: hasSearch || category !== '',
    showsHiddenRows: category !== '',
  };
}

/**
 * What the page shows and what it saves on load. A deep link shows every
 * date and every account for this load only: the saved date filter and
 * account are shared with the user's other tabs, so they are left as they are.
 *
 * @param {{forcesFullLedger: boolean}} deepLink From parseTransactionsDeepLink.
 * @param {string|null} savedDateFilter The saved date filter's name.
 * @param {string|null} savedAccountId The saved account.
 * @param {boolean} savedAccountExists Whether that account is still listed.
 * @returns {{showAllDatesForPage: boolean, restoreAccountId: string|null, forgetSavedAccount: boolean}}
 *   showAllDatesForPage is false when "all" is already the saved filter, since
 *   there is nothing to change. forgetSavedAccount is true only on an ordinary
 *   load whose saved account is gone.
 */
function transactionsStartupPlan(deepLink, savedDateFilter, savedAccountId, savedAccountExists) {
  const isDeepLink = Boolean(deepLink && deepLink.forcesFullLedger);
  if (isDeepLink) {
    return {
      showAllDatesForPage: savedDateFilter !== 'all',
      restoreAccountId: null,
      forgetSavedAccount: false,
    };
  }
  const canRestore = Boolean(savedAccountId) && Boolean(savedAccountExists);
  return {
    showAllDatesForPage: false,
    restoreAccountId: canRestore ? savedAccountId : null,
    forgetSavedAccount: !canRestore,
  };
}

/**
 * Whether a label matches typed filter text. A text with a colon matches the
 * primary and the detailed part separately; otherwise it matches anywhere.
 */
function _filterLabelMatchesText(label, queryLower) {
  const lower = label.toLowerCase();
  if (queryLower.includes(':')) {
    const [queryPrimary, queryDetailed] = queryLower.split(':').map(segment => segment.trim());
    const parts = lower.split(':').map(segment => segment.trim());
    const primaryMatch = !queryPrimary || (parts[0] || '').includes(queryPrimary);
    const detailedMatch = !queryDetailed || (parts[1] || '').includes(queryDetailed);
    return primaryMatch && detailedMatch;
  }
  return lower.includes(queryLower);
}

/**
 * The suggestions for the Category filter box.
 *
 * With nothing typed the list is the opening list: primaries that have at
 * least one visible category. Once text is typed, hidden categories and
 * primaries with only hidden categories that match are added after the
 * visible ones, each flagged so the box can mark why it was not in the
 * opening list.
 *
 * @param {string[]} visibleLabels Labels the pickers offer.
 * @param {string[]} hiddenLabels Hidden labels.
 * @param {string} typedText What is in the box.
 * @returns {{isOpeningList: boolean,
 *   primaries: Array<{value: string, hidden: boolean}>,
 *   detailed: Array<{value: string, hidden: boolean}>}}
 */
function buildFilterSuggestions(visibleLabels, hiddenLabels, typedText) {
  const visible = visibleLabels || [];
  const hidden = hiddenLabels || [];
  const queryLower = (typedText || '').trim().toLowerCase();

  const visiblePrimaries = extractPrimaryCategories(visible);

  if (!queryLower) {
    return {
      isOpeningList: true,
      primaries: visiblePrimaries.map(value => ({ value, hidden: false })),
      detailed: [],
    };
  }

  const visiblePrimarySet = new Set(visiblePrimaries);
  const hiddenOnlyPrimaries = extractPrimaryCategories(hidden)
    .filter(primary => !visiblePrimarySet.has(primary));

  const primaries = visiblePrimaries
    .filter(primary => primary.toLowerCase().includes(queryLower))
    .map(value => ({ value, hidden: false }))
    .concat(
      hiddenOnlyPrimaries
        .filter(primary => primary.toLowerCase().includes(queryLower))
        .map(value => ({ value, hidden: true })),
    );

  // A primary-only label already shown as a primary row is not repeated.
  const shownPrimaryKeys = new Set(primaries.map(entry => entry.value.toLowerCase()));
  const keepLabel = label => {
    const parsed = parseCategoryString(label);
    return Boolean(parsed.detailed) || !shownPrimaryKeys.has(parsed.primary.toLowerCase());
  };

  const detailed = visible
    .filter(label => _filterLabelMatchesText(label, queryLower) && keepLabel(label))
    .map(value => ({ value, hidden: false }))
    .concat(
      hidden
        .filter(label => _filterLabelMatchesText(label, queryLower) && keepLabel(label))
        .map(value => ({ value, hidden: true })),
    );

  return { isOpeningList: false, primaries, detailed };
}

/**
 * What typed or linked filter text selects. Hidden labels count as known, so
 * a Uses link to a hidden label filters to it like any other.
 *
 * Exact primary first, then exact full label, then a partial primary name.
 * Text that matches nothing is kept as a primary filter, as typed.
 *
 * @param {string} text Typed or linked text.
 * @param {string[]} visibleLabels
 * @param {string[]} hiddenLabels
 * @returns {{primary: string, detailed: string, display: string|null}}
 *   `display` is the text to put back in the box, or null to leave it as typed.
 */
function resolveFilterCategoryText(text, visibleLabels, hiddenLabels) {
  const trimmed = (text || '').trim();
  const trimmedLower = trimmed.toLowerCase();
  const allLabels = (visibleLabels || []).concat(hiddenLabels || []);
  const primaries = extractPrimaryCategories(allLabels);

  const exactPrimary = primaries.find(primary => primary.toLowerCase() === trimmedLower);
  if (exactPrimary) {
    return { primary: exactPrimary, detailed: '', display: exactPrimary };
  }

  const exactFull = allLabels.find(label => label.toLowerCase() === trimmedLower);
  if (exactFull) {
    const parsed = parseCategoryString(exactFull);
    return { primary: parsed.primary, detailed: parsed.detailed, display: exactFull };
  }

  const fuzzyPrimary = primaries.find(primary => primary.toLowerCase().includes(trimmedLower));
  if (fuzzyPrimary) {
    return { primary: fuzzyPrimary, detailed: '', display: fuzzyPrimary };
  }

  return { primary: trimmed, detailed: '', display: null };
}
