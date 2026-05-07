// ============================================================
// transactions/analytics.js — Shared Ledger Analytics
// Normalizes the currently visible ledger rows into one analytics
// slice so insights, category summary, and exports stay aligned.
// ============================================================

const ANALYTICS_EXCLUSION_REGEX = /(transfer|adjust(?:ment)?)/i;
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

function getAnalyticsCategoryLabel(txn, txnType = null) {
  if (txnType === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING) {
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

function isAnalyticsExcludedCategory(categoryLabel) {
  if (!categoryLabel || typeof categoryLabel !== 'string') {
    return false;
  }

  const trimmed = categoryLabel.trim();
  if (trimmed.startsWith('[')) {
    return true;
  }

  return ANALYTICS_EXCLUSION_REGEX.test(trimmed);
}

function isIncomeCategoryName(categoryName) {
  return /income/i.test(categoryName || '');
}

function getAnalyticsDisplayMode(categoryName, txnType = null) {
  if (txnType === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING) {
    return ANALYTICS_DISPLAY_MODE.SIGNED;
  }

  return isIncomeCategoryName(categoryName)
    ? ANALYTICS_DISPLAY_MODE.INCOME
    : ANALYTICS_DISPLAY_MODE.SPENDING;
}

function getAnalyticsDisplayAmount(rawTotal, displayMode) {
  return displayMode === ANALYTICS_DISPLAY_MODE.SPENDING ? -rawTotal : rawTotal;
}

function getAnalyticsDisplayTotal(rawTotal, categoryName) {
  return getAnalyticsDisplayAmount(rawTotal, getAnalyticsDisplayMode(categoryName));
}

function getAnalyticsAverageDisplayAmount(entries, categoryName) {
  const isIncomeCategory = isIncomeCategoryName(categoryName);
  const matchingDirectionEntries = entries.filter(entry => (
    isIncomeCategory ? entry.amount > 0 : entry.amount < 0
  ));

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
  const categoryLabel = getAnalyticsCategoryLabel(txn, txnType);
  const parsedCategory = parseCategoryString(categoryLabel);
  const primaryCategory = parsedCategory.primary || categoryLabel || 'Uncategorized';
  const detailedCategory = parsedCategory.detailed || '';
  const displayMode = getAnalyticsDisplayMode(primaryCategory, txnType);

  return {
    transaction_id: txn.transaction_id || parentTxn?.transaction_id || '',
    amount: Number(txn.amount || 0),
    category_label: categoryLabel,
    primary_category: primaryCategory,
    detailed_category: detailedCategory,
    display_mode: displayMode,
    is_income: displayMode === ANALYTICS_DISPLAY_MODE.INCOME,
    is_system: !!txnType && isSystemType(txnType),
    txn_type: txnType,
  };
}

function _isCategorySummaryEligibleEntry(entry) {
  if (!entry) {
    return false;
  }

  if (entry.txn_type === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING) {
    return true;
  }

  return !entry.is_system && !isAnalyticsExcludedCategory(entry.category_label);
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
  const trackableEntries = ledgerEntries.filter(entry => (
    !entry.is_system && !isAnalyticsExcludedCategory(entry.category_label)
  ));
  const spendingEntries = trackableEntries.filter(entry => !entry.is_income);
  const summaryEntries = ledgerEntries.filter(_isCategorySummaryEligibleEntry);

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
        display_mode: entry.display_mode,
        detailed: {},
      };
    }

    groupedCategories[primaryKey].total += entry.amount;
    groupedCategories[primaryKey].count += 1;

    if (entry.txn_type === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING) {
      investmentTrendingTotal += entry.amount;
    } else if (entry.display_mode === ANALYTICS_DISPLAY_MODE.INCOME) {
      incomeTotal += entry.amount;
    } else {
      spendingTotal += entry.amount;
    }

    if (detailedKey) {
      if (!groupedCategories[primaryKey].detailed[detailedKey]) {
        groupedCategories[primaryKey].detailed[detailedKey] = {
          total: 0,
          count: 0,
          display_mode: entry.display_mode,
        };
      }

      groupedCategories[primaryKey].detailed[detailedKey].total += entry.amount;
      groupedCategories[primaryKey].detailed[detailedKey].count += 1;
    }
  });

  const categories = Object.entries(groupedCategories)
    .map(([categoryName, categoryData]) => ({
      category: categoryName,
      total: Math.round(categoryData.total * 100) / 100,
      count: categoryData.count,
      display_mode: categoryData.display_mode,
      detailed: Object.entries(categoryData.detailed)
        .map(([detailName, detailData]) => ({
          category: detailName,
          total: Math.round(detailData.total * 100) / 100,
          count: detailData.count,
          display_mode: detailData.display_mode,
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