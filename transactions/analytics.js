// ============================================================
// transactions/analytics.js — Shared Ledger Analytics
// Normalizes the currently visible ledger rows into one analytics
// slice so insights, category summary, and exports stay aligned.
// ============================================================

const ANALYTICS_INVESTMENT_TRENDING_LABEL = 'Investments: Trending Performance';
const ANALYTICS_DISPLAY_MODE = Object.freeze({
  SPENDING: 'spending',
  INCOME: 'income',
  SIGNED: 'signed',
});

function formatAnalyticsCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount || 0);
}

// The API's analytics_class is the only definition of how a row counts.
// Any value not listed here (a class added later) maps to null: not counted.
const ANALYTICS_CLASS_TO_MODE = Object.freeze({
  spending: ANALYTICS_DISPLAY_MODE.SPENDING,
  savings: ANALYTICS_DISPLAY_MODE.SPENDING,
  income: ANALYTICS_DISPLAY_MODE.INCOME,
  other_inflow: ANALYTICS_DISPLAY_MODE.INCOME,
  retirement_income: ANALYTICS_DISPLAY_MODE.SIGNED,
  investment_trend: ANALYTICS_DISPLAY_MODE.SIGNED,
});

// Tie-break order when a category's rows carry mixed counted classes.
const ANALYTICS_MODE_TIE_ORDER = [
  ANALYTICS_DISPLAY_MODE.SPENDING,
  ANALYTICS_DISPLAY_MODE.INCOME,
  ANALYTICS_DISPLAY_MODE.SIGNED,
];

/**
 * Maps an analytics_class to a display mode. Returns null for classes that
 * do not count in totals (transfer, adjustment, excluded, unknown, missing).
 */
function getAnalyticsModeForClass(analyticsClass) {
  if (typeof analyticsClass !== 'string') {
    return null;
  }
  return Object.prototype.hasOwnProperty.call(ANALYTICS_CLASS_TO_MODE, analyticsClass)
    ? ANALYTICS_CLASS_TO_MODE[analyticsClass]
    : null;
}

function isAnalyticsCountedClass(analyticsClass) {
  return getAnalyticsModeForClass(analyticsClass) !== null;
}

/**
 * Display mode for a group of entries (a category). Mixed classes: the mode
 * whose rows carry the largest absolute amount wins; ties go spending, income,
 * signed (investment trend, retirement income). No counted entries falls back to spending.
 */
function getAnalyticsDisplayModeForEntries(entries) {
  const weights = {};
  (entries || []).forEach(entry => {
    const mode = entry && getAnalyticsModeForClass(entry.analytics_class);
    if (mode) {
      weights[mode] = (weights[mode] || 0) + Math.abs(Number(entry.amount) || 0);
    }
  });

  let bestMode = ANALYTICS_DISPLAY_MODE.SPENDING;
  let bestWeight = -1;
  ANALYTICS_MODE_TIE_ORDER.forEach(mode => {
    const weight = weights[mode];
    if (weight !== undefined && weight > bestWeight) {
      bestMode = mode;
      bestWeight = weight;
    }
  });
  return bestMode;
}

function getAnalyticsCategoryLabel(txn, analyticsClass = null) {
  if (analyticsClass === 'investment_trend') {
    return ANALYTICS_INVESTMENT_TRENDING_LABEL;
  }

  if (txn.user_category && txn.user_category.trim()) {
    return txn.user_category.trim();
  }

  if (txn.personal_finance_category) {
    const display = getCategoryDisplayNames(txn.personal_finance_category);
    if (display.primary && display.trimmed) {
      return `${display.primary}: ${display.trimmed}`;
    }
    if (display.primary) {
      return display.primary;
    }
  }

  return 'Uncategorized';
}

function getAnalyticsDisplayAmount(rawTotal, displayMode) {
  return displayMode === ANALYTICS_DISPLAY_MODE.SPENDING ? -rawTotal : rawTotal;
}

/**
 * Sign and tone for an amount in the category summary. rawTotal is the ledger
 * sign (positive = money in, negative = money out) in every mode; displayMode
 * only decides whether an outflow is the expected direction. A spending
 * outflow stays unsigned. An outflow anywhere else is an unexpected loss and
 * gets an explicit minus. Any inflow gets an explicit plus.
 * @param {number} rawTotal Net ledger amount.
 * @param {string} displayMode One of ANALYTICS_DISPLAY_MODE.
 * @returns {{text: string, tone: 'positive'|'negative'|'neutral'}}
 */
function getAnalyticsSignedDisplay(rawTotal, displayMode) {
  const cents = Math.round((Number(rawTotal) || 0) * 100);
  const magnitude = formatAnalyticsCurrency(Math.abs(cents) / 100);

  if (cents === 0) {
    return { text: magnitude, tone: 'neutral' };
  }
  if (cents > 0) {
    return { text: `+${magnitude}`, tone: 'positive' };
  }
  if (displayMode === ANALYTICS_DISPLAY_MODE.SPENDING) {
    return { text: magnitude, tone: 'neutral' };
  }
  return { text: `\u2212${magnitude}`, tone: 'negative' };
}

function getAnalyticsDisplayTotal(rawTotal, entries) {
  return getAnalyticsDisplayAmount(rawTotal, getAnalyticsDisplayModeForEntries(entries));
}

function getAnalyticsAverageDisplayAmount(entries) {
  const mode = getAnalyticsDisplayModeForEntries(entries);
  const matchingDirectionEntries = entries.filter(entry => {
    if (mode === ANALYTICS_DISPLAY_MODE.INCOME) return entry.amount > 0;
    if (mode === ANALYTICS_DISPLAY_MODE.SPENDING) return entry.amount < 0;
    return entry.amount !== 0;
  });

  if (matchingDirectionEntries.length === 0) {
    return null;
  }

  const absoluteTotal = matchingDirectionEntries.reduce((sum, entry) => (
    sum + Math.abs(entry.amount)
  ), 0);

  return absoluteTotal / matchingDirectionEntries.length;
}

const INSIGHT_CARD_LIMIT = 3;

/**
 * Normalizes a list of category names: strings only, trimmed, blanks and
 * repeats dropped, order kept.
 * @param {*} names
 * @returns {string[]}
 */
function _normalizeInsightCardNameList(names) {
  if (!Array.isArray(names)) {
    return [];
  }

  const normalized = [];
  names.forEach(name => {
    if (typeof name !== 'string') {
      return;
    }
    const trimmed = name.trim();
    if (trimmed && !normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  });
  return normalized;
}

/**
 * Puts a "Primary: Detailed" member into the spacing the ledger rows use, so
 * "Food:Groceries" and "Food: Groceries" match the same rows.
 * @param {string} label
 * @returns {string} The normalized label, or '' when it has no detailed part.
 */
function normalizeInsightCardDetailLabel(label) {
  if (typeof label !== 'string') {
    return '';
  }

  const separatorIndex = label.indexOf(':');
  if (separatorIndex === -1) {
    return '';
  }

  const primary = label.slice(0, separatorIndex).trim();
  const detailed = label.slice(separatorIndex + 1).trim();
  if (!primary || !detailed) {
    return '';
  }
  return `${primary}: ${detailed}`;
}

/**
 * Cleans the stored insightCards preference into cards the insights bar can
 * use. A card without a name or without any member is dropped; at most
 * INSIGHT_CARD_LIMIT cards are kept, in stored order.
 * @param {*} rawCards The insightCards value from the app config.
 * @returns {Array<{name: string, primaries: string[], details: string[]}>}
 */
function normalizeInsightCards(rawCards) {
  if (!Array.isArray(rawCards)) {
    return [];
  }

  const cards = [];
  rawCards.forEach(rawCard => {
    if (!rawCard || typeof rawCard !== 'object' || cards.length >= INSIGHT_CARD_LIMIT) {
      return;
    }

    const name = typeof rawCard.name === 'string' ? rawCard.name.trim() : '';
    const primaries = _normalizeInsightCardNameList(rawCard.primaries);
    const details = _normalizeInsightCardNameList(
      _normalizeInsightCardNameList(rawCard.details).map(normalizeInsightCardDetailLabel)
    );

    if (!name || (primaries.length === 0 && details.length === 0)) {
      return;
    }
    cards.push({ name, primaries, details });
  });

  return cards;
}

function getInsightCards() {
  return normalizeInsightCards(getAppConfig().insightCards);
}

/**
 * Rows that belong to an insight card: the row's primary is a whole-primary
 * member, or its "Primary: Detailed" label is a detail member. Filtering (not
 * concatenating per member) means a row matching both counts once.
 * @param {Array<{primary_category: string, detailed_category: string}>} entries
 * @param {{primaries: string[], details: string[]}} card
 * @returns {Array} The matching entries, in their original order.
 */
function filterEntriesForInsightCard(entries, card) {
  const primaries = new Set(card.primaries || []);
  const details = new Set(card.details || []);

  return (entries || []).filter(entry => {
    if (primaries.has(entry.primary_category)) {
      return true;
    }
    if (!entry.detailed_category) {
      return false;
    }
    return details.has(`${entry.primary_category}: ${entry.detailed_category}`);
  });
}

function _meanAbsoluteAmount(entries) {
  if (entries.length === 0) {
    return null;
  }
  const absoluteTotal = entries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  return absoluteTotal / entries.length;
}

// Classes whose rows bring money in, for a card's credit side. Retirement
// income joins earned income and other inflow here even though the category
// summary keeps it out of Total inflows.
const INSIGHT_CARD_CREDIT_CLASSES = Object.freeze(['income', 'other_inflow', 'retirement_income']);

function _isInsightCardCreditRow(entry) {
  return INSIGHT_CARD_CREDIT_CLASSES.includes(entry.analytics_class);
}

// Classes whose rows send money out, for a card's debit side. Savings sits
// beside spending so a card tracking a savings primary keeps its total and its
// "Average debit" line.
const INSIGHT_CARD_DEBIT_CLASSES = Object.freeze(['spending', 'savings']);

function _isInsightCardSpendingRow(entry) {
  return INSIGHT_CARD_DEBIT_CLASSES.includes(entry.analytics_class);
}

/**
 * The average lines an insight card shows. Credit-side rows (income, other
 * inflow, retirement income) give "Average credit" from their credits only;
 * spending and savings rows give "Average debit" from their debits only, so
 * refunds and clawbacks move neither. A card with both sides shows both lines. A card
 * with no income, other-inflow or spending rows (only retirement income, or
 * no rows) keeps the single average chosen by the group's display mode.
 * @param {Array<{analytics_class: string|null, amount: number}>} entries
 * @returns {Array<{label: string, amount: number|null}>} amount is null when no row qualifies.
 */
function getInsightCardAverageLines(entries) {
  const hasIncomeOrSpending = entries.some(entry => {
    const mode = getAnalyticsModeForClass(entry.analytics_class);
    return mode === ANALYTICS_DISPLAY_MODE.INCOME || mode === ANALYTICS_DISPLAY_MODE.SPENDING;
  });

  if (!hasIncomeOrSpending) {
    const mode = getAnalyticsDisplayModeForEntries(entries);
    return [{
      label: mode === ANALYTICS_DISPLAY_MODE.INCOME ? 'Average credit' : 'Average debit',
      amount: getAnalyticsAverageDisplayAmount(entries),
    }];
  }

  const creditSideEntries = entries.filter(_isInsightCardCreditRow);
  const spendingEntries = entries.filter(_isInsightCardSpendingRow);

  const lines = [];
  if (creditSideEntries.length > 0) {
    lines.push({
      label: 'Average credit',
      amount: _meanAbsoluteAmount(creditSideEntries.filter(entry => entry.amount > 0)),
    });
  }
  if (spendingEntries.length > 0) {
    lines.push({
      label: 'Average debit',
      amount: _meanAbsoluteAmount(spendingEntries.filter(entry => entry.amount < 0)),
    });
  }
  return lines;
}

/**
 * Money in and money out for a card that holds both credit-side and spending
 * rows. A one-sided card returns isMixed false and keeps its unsigned total.
 * inTotal is the net of the credit-side rows and outTotal the net outflow of
 * the spending rows, so inTotal - outTotal equals the card's net total.
 * @param {Array<{analytics_class: string|null, amount: number}>} entries
 * @returns {{isMixed: boolean, inTotal: number, outTotal: number}}
 */
function getInsightCardFlowSummary(entries) {
  const creditSideEntries = entries.filter(_isInsightCardCreditRow);
  const spendingEntries = entries.filter(_isInsightCardSpendingRow);
  const inTotal = creditSideEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const spendingNet = spendingEntries.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    isMixed: creditSideEntries.length > 0 && spendingEntries.length > 0,
    inTotal,
    outTotal: -spendingNet,
  };
}

function _shouldSkipLedgerParentForAnalytics(txn) {
  if (!txn) {
    return true;
  }

  if (txn.hidden_by_match) {
    return true;
  }

  // Show Hidden puts hidden rows back in the table, not back in the totals:
  // the API's reports and the phone leave them out, and the totals must agree.
  // A hidden split parent takes its pieces with it.
  if (txn.is_hidden) {
    return true;
  }

  const txnType = getTransactionType(txn);
  if (!txnType) {
    return true;
  }

  if (
    selectedAccountMode === 'all'
    && isSystemType(txnType)
    && txnType !== TXN_TYPE.SYSTEM_INVESTMENT_TRENDING
  ) {
    return true;
  }

  // Projected future rows (BILL_FUTURE, MANUAL_FUTURE) are intentionally
  // excluded from insights and the category summary — they represent
  // forecasted activity that has not occurred yet, so including them
  // would distort spending totals and category breakdowns regardless of
  // the active date filter window.
  if (txnType === TXN_TYPE.BILL_FUTURE || txnType === TXN_TYPE.MANUAL_FUTURE) {
    return true;
  }

  return txnType === TXN_TYPE.MANUAL_ORPHANED;
}

function _buildAnalyticsEntry(txn, parentTxn = null) {
  const txnType = parentTxn ? TXN_TYPE.SPLIT_CHILD : getTransactionType(txn);
  const analyticsClass = txn.analytics_class || null;
  const categoryLabel = getAnalyticsCategoryLabel(txn, analyticsClass);
  const parsedCategory = parseCategoryString(categoryLabel);
  const primaryCategory = parsedCategory.primary || categoryLabel || 'Uncategorized';
  const detailedCategory = parsedCategory.detailed || '';

  return {
    transaction_id: txn.transaction_id || parentTxn?.transaction_id || '',
    amount: Number(txn.amount || 0),
    category_label: categoryLabel,
    primary_category: primaryCategory,
    detailed_category: detailedCategory,
    analytics_class: analyticsClass,
    display_mode: getAnalyticsModeForClass(analyticsClass),
    txn_type: txnType,
  };
}

function _collectVisibleLedgerAnalyticsEntries() {
  const ledgerEntries = [];
  const parentRows = Array.isArray(visibleTransactions) ? visibleTransactions : [];

  parentRows.forEach(txn => {
    if (_shouldSkipLedgerParentForAnalytics(txn)) {
      return;
    }

    if (txn.is_split && txn.transaction_id && txn.transaction_id.includes('_split_')) {
      return;
    }

    if (txn.is_split && Array.isArray(txn.splits) && txn.splits.length > 0) {
      const visibleSplitRows = txn.splits.filter(split => (
        _splitMatchesSearch(txn, split) && _splitMatchesCategoryFilter(split)
      ));

      visibleSplitRows.forEach(split => {
        ledgerEntries.push(_buildAnalyticsEntry(split, txn));
      });
      return;
    }

    ledgerEntries.push(_buildAnalyticsEntry(txn));
  });

  return ledgerEntries;
}

function buildNormalizedAnalyticsSlice() {
  const ledgerEntries = _collectVisibleLedgerAnalyticsEntries();
  const summaryEntries = ledgerEntries.filter(entry => isAnalyticsCountedClass(entry.analytics_class));
  const trackableEntries = summaryEntries.filter(entry => entry.analytics_class !== 'investment_trend');
  const spendingEntries = summaryEntries.filter(entry => entry.analytics_class === 'spending');
  const savingsEntries = summaryEntries.filter(entry => entry.analytics_class === 'savings');
  // Total outflow is what the API defines as spending plus savings.
  const outflowEntries = summaryEntries.filter(entry => (
    entry.analytics_class === 'spending' || entry.analytics_class === 'savings'
  ));

  return {
    ledgerEntries,
    trackableEntries,
    spendingEntries,
    savingsEntries,
    outflowEntries,
    summaryEntries,
    insightCards: getInsightCards(),
  };
}

// Classes that have their own stat card in the category summary, so a
// primary group made only of them adds nothing to the grid.
const CATEGORY_SUMMARY_STAT_CARD_CLASSES = Object.freeze(['investment_trend', 'retirement_income']);

// Retirement lines shown before "+N more" folds the rest away.
const RETIREMENT_INCOME_COLLAPSED_LINE_LIMIT = 3;

/**
 * True when every row in a primary group is counted by a stat card (investment
 * trend or retirement income) rather than by spending or income. Decided from
 * the rows' classes, never from a category name.
 * @param {Array<{analytics_class: string|null}>} entries
 * @returns {boolean}
 */
function isStatCardOnlyEntries(entries) {
  return entries.length > 0
    && entries.every(entry => CATEGORY_SUMMARY_STAT_CARD_CLASSES.includes(entry.analytics_class));
}

/**
 * One line per detailed category holding retirement income rows, largest
 * absolute amount first. A line is named by its detailed part; when two lines
 * from different primaries share that name, both use "Primary: Detailed".
 * @param {Array<{analytics_class: string|null, amount: number, primary_category: string, detailed_category: string}>} entries
 * @returns {Array<{name: string, total: number}>}
 */
function buildRetirementIncomeLines(entries) {
  const linesByKey = new Map();

  entries.forEach(entry => {
    if (entry.analytics_class !== 'retirement_income') {
      return;
    }

    const detailed = entry.detailed_category || '';
    const key = `${entry.primary_category}\u0000${detailed}`;
    if (!linesByKey.has(key)) {
      linesByKey.set(key, {
        primary: entry.primary_category,
        detailed,
        shortName: detailed || entry.primary_category,
        total: 0,
      });
    }
    linesByKey.get(key).total += entry.amount;
  });

  const lines = Array.from(linesByKey.values());
  const shortNameCounts = new Map();
  lines.forEach(line => {
    shortNameCounts.set(line.shortName, (shortNameCounts.get(line.shortName) || 0) + 1);
  });

  return lines
    .map(line => ({
      name: shortNameCounts.get(line.shortName) > 1 && line.detailed
        ? `${line.primary}: ${line.detailed}`
        : line.shortName,
      total: Math.round(line.total * 100) / 100,
    }))
    .sort((lineA, lineB) => Math.abs(lineB.total) - Math.abs(lineA.total));
}

/**
 * Split lines into those shown now and the count folded behind "+N more".
 * @param {Array} lines
 * @param {boolean} expanded
 * @returns {{visible: Array, hiddenCount: number}}
 */
function splitRetirementIncomeLines(lines, expanded) {
  if (expanded || lines.length <= RETIREMENT_INCOME_COLLAPSED_LINE_LIMIT) {
    return { visible: lines, hiddenCount: 0 };
  }
  return {
    visible: lines.slice(0, RETIREMENT_INCOME_COLLAPSED_LINE_LIMIT),
    hiddenCount: lines.length - RETIREMENT_INCOME_COLLAPSED_LINE_LIMIT,
  };
}

// Primary groups read income first, then the signed groups counted in no
// outflow total, then spending and savings, so inflows never sit among outflows.
const CATEGORY_SUMMARY_MODE_ORDER = Object.freeze([
  ANALYTICS_DISPLAY_MODE.INCOME,
  ANALYTICS_DISPLAY_MODE.SIGNED,
  ANALYTICS_DISPLAY_MODE.SPENDING,
]);

/**
 * Order two category summary groups: by display mode band, then largest first.
 * @param {{display_mode: string, total: number}} groupA
 * @param {{display_mode: string, total: number}} groupB
 * @returns {number}
 */
function compareCategorySummaryGroups(groupA, groupB) {
  const bandDifference = CATEGORY_SUMMARY_MODE_ORDER.indexOf(groupA.display_mode)
    - CATEGORY_SUMMARY_MODE_ORDER.indexOf(groupB.display_mode);
  if (bandDifference !== 0) return bandDifference;
  return Math.abs(groupB.total) - Math.abs(groupA.total);
}

function buildVisibleCategorySummaryData() {
  const analyticsView = buildNormalizedAnalyticsSlice();
  const groupedCategories = {};
  let spendingTotal = 0;
  let savingsTotal = 0;
  let incomeTotal = 0;
  let otherInflowTotal = 0;
  let retirementIncomeTotal = 0;
  let investmentTrendingTotal = 0;

  analyticsView.summaryEntries.forEach(entry => {
    const primaryKey = entry.primary_category || 'Uncategorized';
    const detailedKey = entry.detailed_category || '';

    if (!groupedCategories[primaryKey]) {
      groupedCategories[primaryKey] = {
        total: 0,
        count: 0,
        entries: [],
        detailed: {},
      };
    }

    groupedCategories[primaryKey].total += entry.amount;
    groupedCategories[primaryKey].count += 1;
    groupedCategories[primaryKey].entries.push(entry);

    if (entry.analytics_class === 'investment_trend') {
      investmentTrendingTotal += entry.amount;
    } else if (entry.analytics_class === 'retirement_income') {
      retirementIncomeTotal += entry.amount;
    } else if (entry.analytics_class === 'other_inflow') {
      otherInflowTotal += entry.amount;
    } else if (entry.analytics_class === 'income') {
      incomeTotal += entry.amount;
    } else if (entry.analytics_class === 'spending') {
      spendingTotal += entry.amount;
    } else if (entry.analytics_class === 'savings') {
      savingsTotal += entry.amount;
    }
    // Any other class never reaches here: summaryEntries holds counted classes
    // only, and a class added later must name its own branch to count.

    if (detailedKey) {
      if (!groupedCategories[primaryKey].detailed[detailedKey]) {
        groupedCategories[primaryKey].detailed[detailedKey] = {
          total: 0,
          count: 0,
          entries: [],
        };
      }

      groupedCategories[primaryKey].detailed[detailedKey].total += entry.amount;
      groupedCategories[primaryKey].detailed[detailedKey].count += 1;
      groupedCategories[primaryKey].detailed[detailedKey].entries.push(entry);
    }
  });

  const categories = Object.entries(groupedCategories)
    .map(([categoryName, categoryData]) => ({
      category: categoryName,
      total: Math.round(categoryData.total * 100) / 100,
      count: categoryData.count,
      display_mode: getAnalyticsDisplayModeForEntries(categoryData.entries),
      detailed: Object.entries(categoryData.detailed)
        .map(([detailName, detailData]) => ({
          category: detailName,
          total: Math.round(detailData.total * 100) / 100,
          count: detailData.count,
          display_mode: getAnalyticsDisplayModeForEntries(detailData.entries),
        }))
        .sort((entryA, entryB) => Math.abs(entryB.total) - Math.abs(entryA.total)),
    }))
    .sort(compareCategorySummaryGroups);

  return {
    grand_total: Math.round(categories.reduce((sum, category) => sum + category.total, 0) * 100) / 100,
    spending_total: Math.round(spendingTotal * 100) / 100,
    savings_total: Math.round(savingsTotal * 100) / 100,
    all_outflow_total: Math.round((spendingTotal + savingsTotal) * 100) / 100,
    income_total: Math.round(incomeTotal * 100) / 100,
    other_inflow_total: Math.round(otherInflowTotal * 100) / 100,
    all_income_total: Math.round((incomeTotal + otherInflowTotal) * 100) / 100,
    retirement_income_total: Math.round(retirementIncomeTotal * 100) / 100,
    investment_trending_total: Math.round(investmentTrendingTotal * 100) / 100,
    transaction_count: analyticsView.summaryEntries.length,
    categories,
    // Display-only extras: the JSON export names its fields, so these stay out of it.
    retirement_income_lines: buildRetirementIncomeLines(analyticsView.summaryEntries),
    stat_card_only_categories: Object.entries(groupedCategories)
      .filter(([, categoryData]) => isStatCardOnlyEntries(categoryData.entries))
      .map(([categoryName]) => categoryName),
  };
}