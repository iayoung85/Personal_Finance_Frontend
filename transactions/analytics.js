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
  income: ANALYTICS_DISPLAY_MODE.INCOME,
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
 * investment trend. No counted entries falls back to spending.
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

function _normalizeTrackedInsightCategories(categoryList) {
  if (!Array.isArray(categoryList)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  categoryList.forEach(categoryName => {
    if (typeof categoryName !== 'string') {
      return;
    }

    const trimmed = categoryName.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized.slice(0, 3);
}

function getTrackedInsightPrimaryCategories() {
  return _normalizeTrackedInsightCategories(getAppConfig().trackedInsightCategories);
}

function _shouldSkipLedgerParentForAnalytics(txn) {
  if (!txn) {
    return true;
  }

  if (txn.hidden_by_match || txn.hidden_by_suggestion) {
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

function _hasSplitAmountMismatch(txn) {
  if (!txn || !Array.isArray(txn.splits) || txn.splits.length === 0) {
    return false;
  }

  const splitChildSum = txn.splits.reduce((sum, splitChild) => (
    sum + (splitChild.amount || 0)
  ), 0);

  return Math.abs(splitChildSum - (txn.amount || 0)) > 0.01;
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
      if (_hasSplitAmountMismatch(txn)) {
        ledgerEntries.push(_buildAnalyticsEntry(txn));
        return;
      }

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

  return {
    ledgerEntries,
    trackableEntries,
    spendingEntries,
    summaryEntries,
    trackedPrimaryCategories: getTrackedInsightPrimaryCategories(),
  };
}

function buildVisibleCategorySummaryData() {
  const analyticsView = buildNormalizedAnalyticsSlice();
  const groupedCategories = {};
  let spendingTotal = 0;
  let incomeTotal = 0;
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
    } else if (entry.analytics_class === 'income') {
      incomeTotal += entry.amount;
    } else {
      spendingTotal += entry.amount;
    }

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
    .sort((entryA, entryB) => Math.abs(entryB.total) - Math.abs(entryA.total));

  return {
    grand_total: Math.round(categories.reduce((sum, category) => sum + category.total, 0) * 100) / 100,
    spending_total: Math.round(spendingTotal * 100) / 100,
    income_total: Math.round(incomeTotal * 100) / 100,
    investment_trending_total: Math.round(investmentTrendingTotal * 100) / 100,
    transaction_count: analyticsView.summaryEntries.length,
    categories,
  };
}