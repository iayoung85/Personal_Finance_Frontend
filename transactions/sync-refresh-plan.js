/**
 * Decide which balance data a finished sync made stale.
 *
 * @param {Object} syncData The sync response (added_count, modified_count,
 *   removed_count, trending_changed, affected_account_ids).
 * @param {string} selectedAccountMode 'single' or 'all'.
 * @param {string|null} selectedAccountId The selected account in single mode.
 * @returns {{evictAccountIds: string[], clearAll: boolean, refetchSelected: boolean, reloadAccounts: boolean}}
 */
function balanceRefreshAfterSync(syncData, selectedAccountMode, selectedAccountId) {
  const data = syncData || {};
  const totalChanges = (data.added_count || 0) + (data.modified_count || 0) + (data.removed_count || 0);
  const trendingChanged = data.trending_changed === true;
  const affected = Array.isArray(data.affected_account_ids) ? data.affected_account_ids : [];

  if (totalChanges === 0 && !trendingChanged) {
    return { evictAccountIds: [], clearAll: false, refetchSelected: false, reloadAccounts: false };
  }

  // The sync response does not name the investment accounts whose trending
  // rows were recalculated, so every cached history is suspect.
  const clearAll = trendingChanged;
  const selectedIsAffected = !!selectedAccountId
    && (clearAll || affected.includes(selectedAccountId));
  return {
    evictAccountIds: clearAll ? [] : affected.slice(),
    clearAll: clearAll,
    refetchSelected: selectedAccountMode === 'single' && selectedIsAffected,
    reloadAccounts: true,
  };
}
