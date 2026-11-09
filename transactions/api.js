// ============================================================
// transactions/api.js — Auth & Backend Communication
// Authentication helpers, token refresh, and data-loading
// orchestration (sync, fetch). All network calls route through
// authenticatedFetch() for automatic 401 retry.
// ============================================================

function refreshAuthState() {
  token = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (e) {
    console.error('Error parsing currentUser', e);
    currentUser = null;
  }
}

// Re-read auth state on script load
refreshAuthState();

const RECENT_WINDOW_DAYS = 90;
const BALANCE_HISTORY_CACHE_KEY = 'pf_balance_history_by_account';
const BALANCE_HISTORY_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes — edits patch this cache directly, so age only matters for changes made elsewhere
const NO_ACTIVE_PLAID_SYNC_CACHE_KEY = 'pf_sync_no_active_plaid_items';
const NO_ACTIVE_PLAID_SYNC_TTL_MS = 5 * 60 * 1000;

// AbortController for in-flight transaction fetches — allows cancelling stale
// requests when a newer fetch is triggered before the previous one completes.
let _fetchAbortController = null;

// Counts full loads that have not finished, including the idle-time history
// backfill that outlives fetchAllTransactions(). A background revalidation
// checks it so it never starts on top of a load the user is waiting on.
let _transactionLoadsInFlight = 0;
const NO_ACTIVE_PLAID_ITEMS_ERROR_MESSAGE = 'No active Plaid items found';

function _recordNetworkMetric(url, method, status) {
  try {
    if (window.PFDevMetrics && typeof window.PFDevMetrics.recordNetworkHit === 'function') {
      window.PFDevMetrics.recordNetworkHit({ url, method, status });
    }
  } catch (error) {
    console.debug('Metrics recordNetworkHit failed:', error);
  }
}

function _recordBalanceHistoryCacheHitMetric() {
  try {
    if (window.PFDevMetrics && typeof window.PFDevMetrics.recordBalanceHistoryCacheHit === 'function') {
      window.PFDevMetrics.recordBalanceHistoryCacheHit();
    }
  } catch (error) {
    console.debug('Metrics recordBalanceHistoryCacheHit failed:', error);
  }
}

function _recordBalanceHistoryNetworkHitMetric() {
  try {
    if (window.PFDevMetrics && typeof window.PFDevMetrics.recordBalanceHistoryNetworkHit === 'function') {
      window.PFDevMetrics.recordBalanceHistoryNetworkHit();
    }
  } catch (error) {
    console.debug('Metrics recordBalanceHistoryNetworkHit failed:', error);
  }
}

function _recordFullHistoryCallMetric(callType) {
  try {
    if (window.PFDevMetrics && typeof window.PFDevMetrics.recordFullHistoryCall === 'function') {
      window.PFDevMetrics.recordFullHistoryCall(callType);
    }
  } catch (error) {
    console.debug('Metrics recordFullHistoryCall failed:', error);
  }
}

function _rememberNoActivePlaidItemsSyncError() {
  try {
    localStorage.setItem(
      NO_ACTIVE_PLAID_SYNC_CACHE_KEY,
      JSON.stringify({
        error: NO_ACTIVE_PLAID_ITEMS_ERROR_MESSAGE,
        cached_at: Date.now(),
      })
    );
  } catch (error) {
    console.debug('Failed to cache no-active-plaid sync error:', error);
  }
}

function _clearNoActivePlaidItemsSyncError() {
  try {
    localStorage.removeItem(NO_ACTIVE_PLAID_SYNC_CACHE_KEY);
  } catch (error) {
    console.debug('Failed to clear no-active-plaid sync error cache:', error);
  }
}

function _getNoActivePlaidItemsSyncErrorState() {
  try {
    const rawCache = localStorage.getItem(NO_ACTIVE_PLAID_SYNC_CACHE_KEY);
    if (!rawCache) {
      return { blocked: false, secondsRemaining: 0 };
    }

    const parsedCache = JSON.parse(rawCache);
    if (!parsedCache || parsedCache.error !== NO_ACTIVE_PLAID_ITEMS_ERROR_MESSAGE) {
      _clearNoActivePlaidItemsSyncError();
      return { blocked: false, secondsRemaining: 0 };
    }

    const cachedAt = Number(parsedCache.cached_at || 0);
    const ageMs = Date.now() - cachedAt;
    if (ageMs >= NO_ACTIVE_PLAID_SYNC_TTL_MS) {
      _clearNoActivePlaidItemsSyncError();
      return { blocked: false, secondsRemaining: 0 };
    }

    return {
      blocked: true,
      secondsRemaining: Math.ceil((NO_ACTIVE_PLAID_SYNC_TTL_MS - ageMs) / 1000),
    };
  } catch (error) {
    console.debug('Failed to read no-active-plaid sync error cache:', error);
    _clearNoActivePlaidItemsSyncError();
    return { blocked: false, secondsRemaining: 0 };
  }
}

function _loadBalanceHistoryCache() {
  try {
    const rawCache = localStorage.getItem(BALANCE_HISTORY_CACHE_KEY);
    if (!rawCache) {
      return {};
    }

    const parsedCache = JSON.parse(rawCache);
    if (!parsedCache || typeof parsedCache !== 'object') {
      return {};
    }

    return parsedCache;
  } catch (error) {
    console.debug('Failed to load balance history cache:', error);
    return {};
  }
}

function _saveBalanceHistoryCache(cacheByAccountId) {
  try {
    localStorage.setItem(BALANCE_HISTORY_CACHE_KEY, JSON.stringify(cacheByAccountId || {}));
  } catch (error) {
    console.debug('Failed to save balance history cache:', error);
  }
}

function _clearBalanceHistoryCache() {
  try {
    localStorage.removeItem(BALANCE_HISTORY_CACHE_KEY);
  } catch (error) {
    console.debug('Failed to clear balance history cache:', error);
  }
}

/**
 * Drop the cached balance history of specific accounts, leaving the rest.
 *
 * @param {string[]} accountIds
 */
function _evictBalanceHistoryCacheEntries(accountIds) {
  if (!Array.isArray(accountIds) || accountIds.length === 0) return;
  const cacheByAccountId = _loadBalanceHistoryCache();
  accountIds.forEach(function(accountId) {
    delete cacheByAccountId[accountId];
  });
  _saveBalanceHistoryCache(cacheByAccountId);
}

/**
 * Bring balances up to date after the transaction list changed on the server.
 *
 * @param {{evictAccountIds: string[], clearAll: boolean, refetchSelected: boolean, reloadAccounts: boolean}} plan
 *   From balanceRefreshAfterSync, or built directly by a caller with no sync response.
 * @param {{skipRenderWhileEditing?: boolean}} [options] skipRenderWhileEditing:
 *   leave the table alone while the user is editing a row.
 * @returns {Promise<void>}
 */
async function refreshBalancesAfterListChange(plan, options = {}) {
  const nothingStale = !plan.clearAll && !plan.reloadAccounts && !plan.refetchSelected
    && (!Array.isArray(plan.evictAccountIds) || plan.evictAccountIds.length === 0);
  if (nothingStale) return;
  try {
    if (plan.clearAll) {
      _clearBalanceHistoryCache();
    } else {
      _evictBalanceHistoryCacheEntries(plan.evictAccountIds);
    }
    // Accounts reload first: the balance-history cache signature is built
    // from the account's last_updated/current_balance, so fetching before the
    // reload would store an entry keyed to the stale account data.
    if (plan.reloadAccounts) {
      await loadAccounts({ quiet: true });
    }
    if (plan.refetchSelected && selectedAccountId) {
      await fetchBalanceHistory(selectedAccountId);
    }
    if (!(options.skipRenderWhileEditing && isUserEditingTable())) {
      renderTransactionTable();
    }
  } catch (refreshError) {
    console.warn('Refreshing balances after a list change failed:', refreshError);
  }
}

function _patchBalanceHistoryCache(accountId, affectedRows) {
  // Patch the in-memory lookup so the ledger column reflects the mutation immediately
  affectedRows.forEach(function(row) {
    if (row.transaction_id) {
      balanceHistoryLookup[row.transaction_id] = parseFloat(row.running_balance);
    }
  });
  // Patch the localStorage cache so it survives page reload
  var cacheByAccountId = _loadBalanceHistoryCache();
  var cacheEntry = cacheByAccountId[accountId];
  if (cacheEntry && cacheEntry.lookup) {
    affectedRows.forEach(function(row) {
      if (row.transaction_id) {
        cacheEntry.lookup[row.transaction_id] = parseFloat(row.running_balance);
      }
    });
    // Refresh signature + timestamp so the 5-min TTL doesn't expire immediately
    cacheEntry.cached_at = Date.now();
    cacheEntry.signature = _buildBalanceHistorySignature(accountId);
    _saveBalanceHistoryCache(cacheByAccountId);
  }
}

function _buildBalanceHistorySignature(accountId) {
  const matchedAccount = Array.isArray(accounts)
    ? accounts.find(account => account.account_id === accountId)
    : null;
  const accountLastUpdated = matchedAccount
    ? (matchedAccount.last_updated || matchedAccount.current_balance || '')
    : '';

  const accountTransactionCount = Array.isArray(transactions)
    ? transactions.filter(transaction => transaction.account_id === accountId).length
    : 0;

  const totalTransactionCount = Array.isArray(transactions) ? transactions.length : 0;
  return `${accountLastUpdated}|${accountTransactionCount}|${totalTransactionCount}`;
}

async function authenticatedFetch(url, options = {}) {
  const sentToken = token;
  const headers = {
    'Authorization': `Bearer ${sentToken}`,
    ...options.headers
  };

  const method = options.method || 'GET';

  noteTransactionWriteStarted(method, url);
  const response = await fetch(url, { ...options, headers });
  _recordNetworkMetric(url, method, response.status);

  if (response.status === 401) {
    const renewedToken = await renewSessionAfter401(sentToken);
    if (renewedToken) {
      token = renewedToken;
      headers['Authorization'] = `Bearer ${token}`;
      const retriedResponse = await fetch(url, { ...options, headers });
      _recordNetworkMetric(url, method, retriedResponse.status);
      noteTransactionWriteResponse(method, url, retriedResponse.status);
      return retriedResponse;
    }
  }

  noteTransactionWriteResponse(method, url, response.status);
  return response;
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('currentUser');
  // Clear data caches on logout for security
  if (window.txnDB) {
    window.txnDB.clear().catch(function() {});
  }
  localStorage.removeItem('pf_cached_categories');
  localStorage.removeItem('pf_cached_taxonomy');
  localStorage.removeItem('pf_categories_cached_at');
  localStorage.removeItem(BALANCE_HISTORY_CACHE_KEY);
  localStorage.removeItem(NO_ACTIVE_PLAID_SYNC_CACHE_KEY);
  // Clear date range memory on logout
  localStorage.removeItem('pf_date_range_preset');
  localStorage.removeItem('pf_date_range_start');
  localStorage.removeItem('pf_date_range_end');
  token = null;
  refreshToken = null;
  currentUser = null;
  window.location.href = 'index.html';
}

// ===== Plaid Sync & Transaction Fetching =====

async function performSync(accountIds, startDate, endDate, activate = false, force = false) {
  const response = await authenticatedFetch(`${BACKEND_URL}/api/transactions/sync_transactions`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      activate: activate,
      force: force,
      sync_all: true
    })
  });
  
  const data = await response.json();

  if (!response.ok) {
    if (data && data.error === NO_ACTIVE_PLAID_ITEMS_ERROR_MESSAGE) {
      _rememberNoActivePlaidItemsSyncError();
    }
    throw new Error((data && data.error) || 'Failed to sync transactions');
  }

  _clearNoActivePlaidItemsSyncError();
  
  if (data.error) {
    if (data.error === NO_ACTIVE_PLAID_ITEMS_ERROR_MESSAGE) {
      _rememberNoActivePlaidItemsSyncError();
    }
    throw new Error(data.error);
  }
  
  return data;
}

async function syncTransactions() {
  // This function is called when user manually clicks a sync button
  // Force network + force past cooldown for explicit user action
  await autoSyncAndLoadTransactions(true);
}

async function autoSyncAndLoadTransactions(forceNetwork = false) {
  // This function runs on page load and handles sync + fetch automatically
  const selectedAccounts = getSelectedAccounts();
  const startDate = document.getElementById('start-date').value;
  const endDate = document.getElementById('end-date').value;
  
  if (!startDate || !endDate) {
    showStatus('Please select a date range', 'error');
    return;
  }
  
  // If no accounts selected, still try to fetch existing transactions from DB
  if (selectedAccounts.length === 0) {
    console.warn('No accounts selected - skipping sync, loading existing transactions only');
    await fetchAllTransactions(false);
    return;
  }
  
  // ============= CACHE-FIRST STRATEGY =============
  // 1. Show cached transactions immediately if available (instant UI)
  // 2. Sync with Plaid in background (may be skipped by backend cooldown)
  // 3. Only re-fetch from server if Plaid returned actual changes
  
  const cached = await _readCachedTransactions();
  // Cache age no longer decides anything: any cached rows are shown at once,
  // and the server's ETag decides whether they are still current.
  const cacheValid = !!(cached && cached.data && cached.data.length > 0);

  if (!forceNetwork) {
    const syncBlockState = _getNoActivePlaidItemsSyncErrorState();
    if (syncBlockState.blocked) {
      if (cacheValid) {
        transactions = cached.data;
        autoExtendEndDateForScheduled();
        renderTransactionTable();
        renderDynamicPeriodButtons();
      } else {
        await fetchAllTransactions(false);
      }

      console.debug(
        `Skipping Plaid sync for ${syncBlockState.secondsRemaining}s: ${NO_ACTIVE_PLAID_ITEMS_ERROR_MESSAGE}`
      );
      return;
    }
  }
  
  // Show cached data immediately for instant page load
  if (cacheValid && !forceNetwork) {
    transactions = cached.data;
    autoExtendEndDateForScheduled();
    renderTransactionTable();
    renderDynamicPeriodButtons();
    showStatus(`Loaded ${transactions.length} transactions from cache. Checking for updates...`, 'info');
  }
  
  try {
    // Try to sync with Plaid first
    if (!forceNetwork && cacheValid) {
      showStatus('Checking for new transactions...', 'info');
    } else {
      showStatus('Syncing transactions from Plaid...', 'info');
    }
    
    const syncData = await performSync(selectedAccounts, startDate, endDate, false, forceNetwork);
    
    // Determine if we need to fetch from DB based on actual backend response fields
    const totalChanges = (syncData.added_count || 0) + (syncData.modified_count || 0) + (syncData.removed_count || 0);
    const trendingChanged = syncData.trending_changed === true;
    const shouldFetchFromDB = !cacheValid || totalChanges > 0 || trendingChanged || forceNetwork;
    const affectedAccountIds = syncData.affected_account_ids || [];
    
    if (shouldFetchFromDB) {
      // No cache OR sync returned changes OR force requested → fetch from DB
      let successMsg = totalChanges > 0 
        ? `Synced ${totalChanges} transactions (${syncData.added_count || 0} new, ${syncData.modified_count || 0} updated, ${syncData.removed_count || 0} removed)`
        : 'Sync complete, loading transactions...';
      showStatus(successMsg, 'info');
      
      // When we have a valid cache and only a few accounts changed,
      // refresh just those accounts instead of re-downloading everything.
      var useAccountScoped = cacheValid && !forceNetwork && affectedAccountIds.length > 0 && affectedAccountIds.length <= 3;
      if (useAccountScoped) {
        for (var syncAcctIdx = 0; syncAcctIdx < affectedAccountIds.length; syncAcctIdx++) {
          await refreshAccountTransactions(affectedAccountIds[syncAcctIdx]);
        }
      } else {
        await fetchAllTransactions(true);
      }

      await refreshBalancesAfterListChange(
        balanceRefreshAfterSync(syncData, selectedAccountMode, selectedAccountId)
      );

      // Orphan detection may have created new orphans during
      // post-sync processing — refresh the banner so it reflects the
      // latest resolution state without requiring a full page reload.
      await checkAndRenderReconciliationBanner();
    } else {
      // Plaid reported no changes, but a webhook sync or another device may
      // have changed the list since the cache was written (a cooldown reply
      // says nothing about that). Ask the server before calling it current.
      await _validateTransactionsWithServer();
      const cooldownMsg = syncData.cooldown 
        ? ` (next sync available in ${syncData.seconds_until_next_sync}s)`
        : '';
      showStatus(`Transactions are up to date — ${transactions.length} loaded${cooldownMsg}`, 'success');
      setTimeout(() => clearStatus(), 3000);
    }
    
  } catch (error) {
    console.error('Sync error:', error);
    showStatus(`Sync failed: ${error.message}`, 'error');
    
    // Always try to fetch existing transactions from DB when sync fails
    // This ensures the page shows something even if Plaid sync fails
    try {
      await fetchAllTransactions(false);
    } catch (fetchError) {
      console.error('Failed to fetch transactions after sync error:', fetchError);
      showStatus(`Failed to load transactions: ${fetchError.message}`, 'error');
    }
  }
}

/**
 * Load the full transaction list into `transactions` and render it.
 *
 * Cached rows are always shown first when they exist, then checked against
 * the server with the stored ETag (304 keeps them, 200 replaces them). Age
 * never decides whether to ask: only the server knows if the list changed.
 * With no cached rows the load is two-phase (recent window, then history).
 *
 * @param {boolean} [forceNetwork=false] Skip the ETag and download the full list.
 * @param {{quiet?: boolean}} [options] quiet: no status messages, for a refetch
 *   that must not replace the message the user is reading.
 * @returns {Promise<void>}
 */
async function fetchAllTransactions(forceNetwork = false, options = {}) {
  _transactionLoadsInFlight += 1;
  try {
    await _loadAllTransactions(forceNetwork, options || {});
  } finally {
    _transactionLoadsInFlight -= 1;
  }
}

/**
 * Ask the server whether the rows on screen are current, and replace them
 * if not. Never touches the screen on 304.
 *
 * @param {{guardUser?: boolean}} [options] guardUser: for a check the user
 *   did not ask for. A changed list is dropped, ETag and all, when the user
 *   is editing in the table or a row write overlapped the request; the
 *   caller decides when to ask again.
 * @returns {Promise<'unchanged'|'updated'|'deferred'|'superseded'|'failed'|'aborted'>}
 */
async function _validateTransactionsWithServer(options) {
  const guardUser = !!(options && options.guardUser);

  // A reload restores the ETag into memory in main.js, but another path may
  // have cleared it; with none, the request below is a plain full GET.
  if (!_fetchTransactionsFromServer._cachedEtag && window.txnDB) {
    const savedEtag = await window.txnDB.getMeta('etag').catch(() => null);
    if (savedEtag) _fetchTransactionsFromServer._cachedEtag = savedEtag;
  }

  const writesAtStart = transactionRowWriteCount();
  try {
    const reply = await _requestTransactionList(null);
    if (reply.notModified) {
      // Only the stamp moves; the rows in the cache are already the server's.
      if (window.txnDB) {
        window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
      }
      return 'unchanged';
    }

    if (guardUser) {
      // Asked only now, when the reply is in hand: an edit opened while the
      // request was out is just as easy to destroy as one open before it.
      const action = backgroundReplyAction({
        editing: isUserEditingTable(),
        writesAtStart: writesAtStart,
        writesNow: transactionRowWriteCount(),
      });
      // Nothing from the reply is kept, so the stored ETag still describes
      // the rows on screen and the next check gets the changed list again.
      if (action !== 'apply') return action;
    }

    transactions = reply.rows;
    _clearBalanceHistoryCache();
    autoExtendEndDateForScheduled();
    renderTransactionTable();
    renderDynamicPeriodButtons();
    // The unreviewed badges count from this list.
    if (typeof renderAccountsSidebar === 'function') renderAccountsSidebar();
    await _storeFullTransactionList(transactions, reply.etag);
    return 'updated';
  } catch (validationError) {
    if (validationError.name === 'AbortError') return 'aborted';
    console.warn('Transaction validation failed, keeping the rows on screen:', validationError);
    return 'failed';
  }
}

async function _loadAllTransactions(forceNetwork, options) {
  const quiet = options.quiet === true;
  const notify = function(message, type, clearAfterMs) {
    if (quiet) return;
    showStatus(message, type);
    if (clearAfterMs) setTimeout(() => clearStatus(), clearAfterMs);
  };

  const cached = await _readCachedTransactions();
  const hasCachedRows = !!(cached && cached.data && cached.data.length > 0);

  // --- Forced reload with rows already on screen: one plain full GET ---
  // The stored ETag is dropped first. The windowed request below never
  // refreshes it, so a 304 on the history request would leave only the
  // recent window in `transactions`.
  if (forceNetwork && (hasCachedRows || transactions.length > 0)) {
    _fetchTransactionsFromServer._cachedEtag = null;
    _recordFullHistoryCallMetric('transactions_full_history');
    try {
      notify('Loading transactions...', 'info');
      const forcedReply = await _requestTransactionList(null);
      if (forcedReply.notModified) {
        // A 304 cannot carry rows; keep the ones on screen rather than
        // replacing them, and the cache, with nothing.
        notify(`Transactions are up to date — ${transactions.length} loaded`, 'success', 2000);
        return;
      }
      transactions = forcedReply.rows;
      _clearBalanceHistoryCache();
      autoExtendEndDateForScheduled();
      renderTransactionTable();
      renderDynamicPeriodButtons();
      if (typeof renderAccountsSidebar === 'function') renderAccountsSidebar();
      await _storeFullTransactionList(transactions, forcedReply.etag);
      notify(`Loaded ${transactions.length} total transactions`, 'success', 2000);
    } catch (forcedError) {
      if (forcedError.name === 'AbortError') return;
      console.warn('Forced transaction reload failed, keeping the rows on screen:', forcedError);
      notify(`Load failed: ${forcedError.message}`, 'error');
    }
    return;
  }

  // --- Cached rows: show them at once, then ask the server ---
  if (!forceNetwork && hasCachedRows) {
    transactions = cached.data;
    autoExtendEndDateForScheduled();
    renderTransactionTable();
    renderDynamicPeriodButtons();
    notify('Checking for updated transactions...', 'info');

    const outcome = await _validateTransactionsWithServer();
    if (outcome === 'unchanged') {
      notify(`Transactions are up to date — ${transactions.length} loaded`, 'success', 2000);
    } else if (outcome === 'updated') {
      notify(`Loaded ${transactions.length} total transactions`, 'success', 2000);
    } else if (outcome === 'failed') {
      notify(`Loaded ${transactions.length} transactions (update check failed)`, 'warning', 3000);
    }
    return;
  }

  // --- Cold start: no rows anywhere, use the two-phase load ---
  _recordFullHistoryCallMetric('transactions_full_history');
  // A leftover ETag would turn the history request into a 304 that keeps only
  // the recent window, and one left in Dexie would come back on the next
  // reload over rows it does not describe.
  _fetchTransactionsFromServer._cachedEtag = null;
  if (window.txnDB) {
    window.txnDB.setMeta('etag', null).catch(function() {});
  }

  // --- Phase 1: Recent window for fast first paint ---
  const sinceDate = _formatDateForApi(_daysAgo(RECENT_WINDOW_DAYS));
  try {
    showStatus('Loading recent transactions...', 'info');

    const recentResponse = await _fetchTransactionsFromServer(sinceDate);
    if (recentResponse === null) {
      // 304 — cached data is still current, nothing to do
      showStatus(`Transactions are up to date — ${transactions.length} loaded`, 'success');
      setTimeout(() => clearStatus(), 2000);
      return;
    }

    transactions = recentResponse;
    autoExtendEndDateForScheduled();
    renderTransactionTable();
    renderDynamicPeriodButtons();
    showStatus(`Loaded ${transactions.length} recent transactions, loading full history...`, 'info');

  } catch (error) {
    showStatus(`Load failed: ${error.message}`, 'error');
    return;
  }

  // --- Phase 2: Full history backfill (non-blocking) ---
  // Use requestIdleCallback so the backfill network call doesn't block
  // initial paint or user interaction after Phase 1 renders.
  const _scheduleIdle = window.requestIdleCallback || (cb => setTimeout(cb, 50));
  _transactionLoadsInFlight += 1;
  _scheduleIdle(async () => {
    try {
      const fullReply = await _requestTransactionList(null);
      if (fullReply.notModified) {
        // 304 on full request — recent set was same as full set, we're done
        _cacheTransactions(transactions);
        showStatus(`Loaded ${transactions.length} total transactions`, 'success');
        setTimeout(() => clearStatus(), 2000);
        return;
      }

      transactions = fullReply.rows;
      _clearBalanceHistoryCache();

      autoExtendEndDateForScheduled();
      renderTransactionTable();
      renderDynamicPeriodButtons();
      // The sidebar's unreviewed badges count from this list, so redraw them
      // now that rows older than the recent window are here.
      if (typeof renderAccountsSidebar === 'function') renderAccountsSidebar();
      await _storeFullTransactionList(transactions, fullReply.etag);
      showStatus(`Loaded ${transactions.length} total transactions (filters applied on frontend)`, 'success');
      setTimeout(() => clearStatus(), 2000);

    } catch (error) {
      if (error.name === 'AbortError') return; // Cancelled by a newer request
      // Phase 1 already rendered — user sees recent data; log but don't block
      console.error('Full-history backfill failed (recent data still visible):', error);
      _cacheTransactions(transactions);
      showStatus(`Loaded ${transactions.length} recent transactions (full history unavailable)`, 'warning');
      setTimeout(() => clearStatus(), 3000);
    } finally {
      _transactionLoadsInFlight -= 1;
    }
  });
}

function _daysAgo(numberOfDays) {
  const target = new Date();
  target.setDate(target.getDate() - numberOfDays);
  return target;
}

function _formatDateForApi(dateObject) {
  return dateObject.toISOString().slice(0, 10);
}

/**
 * Fetch a windowed or account-scoped slice of the list. Returns the rows, or
 * null on 304. Never stores an ETag: only a full list has one, and the
 * full-list paths call _requestTransactionList() and
 * _storeFullTransactionList() themselves.
 *
 * `_fetchTransactionsFromServer._cachedEtag` is the ETag of the full list in
 * `transactions`, kept here because other files clear it by this name.
 *
 * @param {string|null} sinceDate
 * @param {string} [accountId]
 * @returns {Promise<Array|null>}
 */
async function _fetchTransactionsFromServer(sinceDate, accountId) {
  const reply = await _requestTransactionList(sinceDate, accountId);
  return reply.notModified ? null : reply.rows;
}

/**
 * One GET of the transaction list. A full request (no window, no account)
 * sends the ETag held in memory and cancels any full or windowed request
 * still in flight. An account-scoped one uses its own abort controller so
 * the two never cancel each other.
 *
 * The reply's ETag is returned, not stored: until the caller has kept the
 * rows, storing it would describe rows the page does not have.
 *
 * @param {string|null} sinceDate
 * @param {string} [accountId]
 * @returns {Promise<{notModified: boolean, rows?: Array, etag?: string|null}>}
 */
async function _requestTransactionList(sinceDate, accountId) {
  var isAccountScoped = !!accountId;

  // Account-scoped fetches use a dedicated abort controller so they
  // don't cancel in-flight full/windowed requests (or vice versa).
  if (!isAccountScoped) {
    if (_fetchAbortController) {
      _fetchAbortController.abort();
    }
    _fetchAbortController = new AbortController();
  }
  var controller = isAccountScoped ? new AbortController() : _fetchAbortController;

  let url = `${BACKEND_URL}/api/transactions`;
  var params = [];
  if (sinceDate) params.push('since_date=' + sinceDate);
  if (accountId) params.push('account_id=' + encodeURIComponent(accountId));
  if (params.length) url += '?' + params.join('&');

  const headers = {};
  // ETag only for full, non-windowed, non-account-scoped requests
  const storedEtag = _fetchTransactionsFromServer._cachedEtag || null;
  if (storedEtag && !sinceDate && !isAccountScoped) {
    headers['If-None-Match'] = storedEtag;
  }

  const response = await authenticatedFetch(url, {
    method: 'GET',
    mode: 'cors',
    headers,
    signal: controller.signal,
  });

  if (response.status === 304) {
    return { notModified: true };
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  const isFullList = !sinceDate && !isAccountScoped;
  return {
    notModified: false,
    rows: data.transactions || [],
    etag: isFullList ? (response.headers.get('ETag') || null) : null,
  };
}

/**
 * Keep a full list the server just sent: its ETag in memory at once, the
 * rows in Dexie, and the ETag in Dexie only once the rows have landed.
 * Stored the other way round, a failed or interrupted row write would leave
 * a new ETag over old rows, and the server would confirm those old rows
 * with a 304 on every later load.
 *
 * @param {Array} rows The full list, already in `transactions`.
 * @param {string|null} etag The ETag the server sent with it.
 * @returns {Promise<void>}
 */
async function _storeFullTransactionList(rows, etag) {
  const receivedEtag = etag || null;
  _fetchTransactionsFromServer._cachedEtag = receivedEtag;
  if (!window.txnDB) return;

  try {
    await window.txnDB.replaceAll(rows);
  } catch (replaceError) {
    // Dexie keeps its old rows with the old ETag that describes them.
    console.warn('IndexedDB replace-all failed:', replaceError);
    return;
  }
  window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
  // An edit that reset the cache while the rows were being written wins;
  // the next load then downloads the list in full.
  if (_fetchTransactionsFromServer._cachedEtag !== receivedEtag) return;
  window.txnDB.setMeta('etag', receivedEtag).catch(function() {});
}

/**
 * Read the transaction cache from IndexedDB via the Web Worker.
 * Returns { data: Array, age: number } or null if no cache exists.
 */
async function _readCachedTransactions() {
  if (!window.txnDB) return null;

  try {
    var results = await Promise.all([
      window.txnDB.query({}),
      window.txnDB.getMeta('cached_at'),
    ]);
    var data = results[0];
    var cachedAt = results[1];
    if (data && data.length > 0) {
      var ts = cachedAt || 0;
      return { data: data, age: ts ? (Date.now() - ts) : Infinity };
    }
  } catch (e) {
    console.warn('IndexedDB read failed:', e);
  }

  return null;
}

function _cacheTransactions(transactionsToCache) {
  if (!window.txnDB) return;
  const now = Date.now();
  // Atomic clear + insert prevents ghost rows from deleted transactions
  window.txnDB.replaceAll(transactionsToCache).catch(function(err) {
    console.warn('IndexedDB replace-all failed:', err);
  });
  window.txnDB.setMeta('cached_at', now).catch(function() {});
}

// ── Account-scoped cache refresh ────────────────────────
// Fetch only one account's transactions from the backend and merge them
// into the existing in-memory array + IndexedDB. One targeted network
// call instead of the two-phase full download (recent + full history).

/**
 * Re-sorts the in-memory transactions array to match backend ordering:
 * date descending, then anchor priority descending, then transaction_id
 * descending. Keeps the ledger column consistent after a partial merge.
 */
function _sortTransactionsInPlace() {
  var _anchorPri = function(source) {
    if (source === 'manual_opening_balance') return 0;
    if (source === 'opening_balance') return 1;
    return 2;
  };
  transactions.sort(function(txnA, txnB) {
    var dateA = txnA.date || '';
    var dateB = txnB.date || '';
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    var priA = _anchorPri(txnA.source);
    var priB = _anchorPri(txnB.source);
    if (priA !== priB) return priB - priA;
    return (txnB.transaction_id || '').localeCompare(txnA.transaction_id || '');
  });
}

/**
 * Refresh a single account's transactions from the backend and merge
 * them into the in-memory array + IndexedDB cache. Replaces the old
 * nuclear approach of invalidate + fetchAllTransactions(true) which
 * triggered two full round-trips for ALL accounts.
 *
 * Falls back to a full fetchAllTransactions(true) when accountId is
 * falsy (e.g. multi-account operations like Approve All Matches).
 */
async function refreshAccountTransactions(accountId) {
  if (!accountId) {
    await fetchAllTransactions(true);
    return;
  }

  try {
    var freshTxns = await _fetchTransactionsFromServer(null, accountId);
    if (freshTxns === null) {
      return;
    }

    // Merge: remove old rows for this account, add the fresh ones
    transactions = transactions.filter(function(txn) {
      return txn.account_id !== accountId;
    });
    for (var txnIndex = 0; txnIndex < freshTxns.length; txnIndex++) {
      transactions.push(freshTxns[txnIndex]);
    }
    _sortTransactionsInPlace();

    // Update IndexedDB: replace only this account's rows
    if (window.txnDB) {
      window.txnDB.replaceForAccount(accountId, freshTxns).catch(function(err) {
        console.warn('IndexedDB replace-for-account failed:', err);
      });
      window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
    }

    // The combined cache no longer matches the last full-fetch ETag,
    // so clear it — next full fetch will get a fresh one.
    _fetchTransactionsFromServer._cachedEtag = null;
    if (window.txnDB) {
      window.txnDB.setMeta('etag', null).catch(function() {});
    }

    autoExtendEndDateForScheduled();
    renderTransactionTable();
    renderDynamicPeriodButtons();
  } catch (refreshError) {
    console.error('Account refresh failed, falling back to full fetch:', refreshError);
    await fetchAllTransactions(true);
  }
}

// ── Analytics class freshness ───────────────────────────
// A category change can change a row's analytics_class, and only the server
// knows the new value. When a response does not include it, re-fetch the
// account so the cached rows carry it.

/**
 * Re-fetch the given accounts from the server so cached rows carry a
 * server-computed analytics_class. Null/undefined ids trigger one full fetch.
 */
async function _refreshAccountsForStaleAnalyticsClass(accountIds) {
  var unique = Array.from(new Set(accountIds || []));
  if (unique.length === 0) return;
  if (unique.some(function(id) { return !id; })) {
    await fetchAllTransactions(true);
    return;
  }
  for (var i = 0; i < unique.length; i++) {
    await refreshAccountTransactions(unique[i]);
  }
}

async function ensureTransactionCacheSchema() {
  if (!window.txnDB) return;
  try {
    var stored = await window.txnDB.getMeta('cache_schema');
    if (isTransactionCacheSchemaCurrent(stored)) return;
    // clear() drops the etag and cached_at too, so the next fetch is a cold full load.
    await window.txnDB.clear();
    await window.txnDB.setMeta('cache_schema', TRANSACTION_CACHE_SCHEMA);
    _fetchTransactionsFromServer._cachedEtag = null;
  } catch (schemaError) {
    console.warn('Transaction cache schema check failed (non-fatal):', schemaError);
  }
}

// ── Granular cache helpers ──────────────────────────────
// Patch in-memory transactions array AND IndexedDB without a full refetch.
// Used by single-field mutations (hide, description, delete) to avoid
// clearing and re-downloading 100k+ cached rows.

/**
 * Patch fields on a single transaction in both the in-memory array
 * and IndexedDB cache. Does NOT trigger a re-render — caller must
 * call renderTransactionTable() when ready.
 */
function _patchCachedTransaction(txnId, fields) {
  // Patch in-memory
  var txn = transactions.find(function(t) { return t.transaction_id === txnId; });
  if (txn) {
    Object.assign(txn, fields);
  }
  // Patch IndexedDB (non-blocking)
  if (window.txnDB) {
    window.txnDB.patch(txnId, fields).catch(function() {});
    window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
  }
}

/**
 * Patch the same fields on multiple transactions.
 */
function _patchCachedTransactions(txnIds, fields) {
  var idSet = new Set(txnIds);
  // Patch in-memory
  for (var i = 0; i < transactions.length; i++) {
    if (idSet.has(transactions[i].transaction_id)) {
      Object.assign(transactions[i], fields);
    }
  }
  // Patch IndexedDB (non-blocking)
  if (window.txnDB) {
    window.txnDB.patchBatch(txnIds, fields).catch(function() {});
    window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
  }
}

/**
 * Remove a single transaction from the in-memory array and IndexedDB.
 */
function _removeCachedTransaction(txnId) {
  // Remove from in-memory
  var idx = transactions.findIndex(function(t) { return t.transaction_id === txnId; });
  if (idx !== -1) {
    transactions.splice(idx, 1);
  }
  // Remove from IndexedDB (non-blocking)
  if (window.txnDB) {
    window.txnDB.deleteOne(txnId).catch(function() {});
    window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
  }
}

/**
 * Replace a single transaction in both the in-memory array and IndexedDB
 * using a full transaction object (e.g. from a PUT response).
 */
function _replaceCachedTransaction(txnId, fullTxn) {
  // Replace in-memory
  var idx = transactions.findIndex(function(t) { return t.transaction_id === txnId; });
  if (idx !== -1) {
    transactions[idx] = fullTxn;
  } else {
    transactions.unshift(fullTxn);
  }
  // Replace in IndexedDB (non-blocking)
  if (window.txnDB) {
    window.txnDB.putOne(fullTxn).catch(function() {});
    window.txnDB.setMeta('cached_at', Date.now()).catch(function() {});
  }
}

// ===== Balance History for Ledger Column =====

/**
 * How an account's ledger stands against the bank: the summary, the
 * snapshot days back to the last agreeing one, and the rows since.
 * @param {string} accountId
 * @returns {Promise<object>} The bank-agreement detail response.
 * @throws {Error} With the API's message when the request fails.
 */
async function fetchBankAgreement(accountId) {
  const response = await authenticatedFetch(
    `${BACKEND_URL}/api/accounts/${encodeURIComponent(accountId)}/bank-agreement`
  );
  let data = null;
  try {
    data = await response.json();
  } catch (parseError) {
    data = null;
  }
  if (!response.ok || !data || data.error) {
    throw new Error((data && data.error) || `Could not load the comparison (${response.status})`);
  }
  return data;
}

async function fetchBalanceHistory(accountId) {
  /**
   * Fetches all balance-history rows for a single account and builds
   * a lookup map: transactionId → running_balance (as a number).
   * Called when the user selects a single account in the sidebar.
   * The lookup is consumed by renderTransactionTable to populate
   * the "Balance Ledger" column.
   */
  if (!accountId) {
    balanceHistoryLookup = {};
    return;
  }

  const cacheByAccountId = _loadBalanceHistoryCache();
  const cacheEntry = cacheByAccountId[accountId];
  const currentSignature = _buildBalanceHistorySignature(accountId);
  const cacheAgeMs = cacheEntry ? (Date.now() - Number(cacheEntry.cached_at || 0)) : Infinity;

  if (
    cacheEntry
    && cacheEntry.signature === currentSignature
    && cacheAgeMs < BALANCE_HISTORY_CACHE_MAX_AGE_MS
    && cacheEntry.lookup
    && typeof cacheEntry.lookup === 'object'
  ) {
    _recordBalanceHistoryCacheHitMetric();
    balanceHistoryLookup = cacheEntry.lookup;
    return;
  }

  balanceHistoryLoading = true;
  _recordBalanceHistoryNetworkHitMetric();
  _recordFullHistoryCallMetric('account_balance_history');

  try {
    const response = await authenticatedFetch(
      `${BACKEND_URL}/api/accounts/${accountId}/balance-history?limit=10000`
    );

    if (!response.ok) {
      console.error('fetchBalanceHistory: non-OK response', response.status);
      balanceHistoryLookup = {};
      return;
    }

    const data = await response.json();
    const historyRows = data.balance_history || [];

    const lookup = {};
    historyRows.forEach(row => {
      const transactionKey = row.transaction_id;
      if (transactionKey) {
        lookup[transactionKey] = parseFloat(row.running_balance);
      }
    });

    balanceHistoryLookup = lookup;
    cacheByAccountId[accountId] = {
      cached_at: Date.now(),
      signature: currentSignature,
      lookup,
    };
    _saveBalanceHistoryCache(cacheByAccountId);
    console.debug(
      `fetchBalanceHistory: loaded ${Object.keys(lookup).length} ledger entries for account ${accountId}`
    );

  } catch (error) {
    console.error('fetchBalanceHistory error:', error);
    balanceHistoryLookup = {};
  } finally {
    balanceHistoryLoading = false;
  }
}
