// ============================================================
// transactions/revalidation.js — Keeping the open page current
// The page draws rows from a local cache, so it can fall behind the
// server (a webhook sync, another device). The server's ETag is the only
// freshness signal; this file asks it when the tab returns to view, on a
// slow timer while visible and in use, and after the server refuses a write.
// A tab nobody has touched for a while stops asking until they come back.
// ============================================================

/** Shortest gap between two background checks, however often they are asked for. */
const TRANSACTION_REVALIDATE_MIN_GAP_MS = 60 * 1000;

/** How often a tab that stays in view checks on its own. */
const TRANSACTION_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long without any input before a visible tab counts as idle and the
 * timer stops asking. The first input after that runs a check at once, so an
 * idle tab is never more than one round trip behind when the user returns.
 */
const TRANSACTION_REVALIDATE_IDLE_AFTER_MS = 30 * 60 * 1000;

// Input that shows a person is at the page. Scroll and wheel cover reading
// without clicking; a visibility change is handled separately.
const USER_INPUT_EVENT_NAMES = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

/** Lets the caller's own error message go up before the refetch redraws rows. */
const REFUSED_WRITE_REFETCH_DELAY_MS = 250;

/** How long a check held back for the user waits before it tries again. */
const DEFERRED_REVALIDATION_RETRY_MS = 30 * 1000;

// Writes that change rows. Paths under these prefixes that are not about
// rows are listed in the second constant.
const TRANSACTION_WRITE_PATH_PREFIXES = [
  '/api/transactions/',
  '/api/categorization/transactions/',
  '/api/bills/',
];
const NON_ROW_WRITE_PATH_PREFIXES = [
  '/api/transactions/sync_transactions',
  '/api/transactions/import/analyze',
  '/api/transactions/bulk-edit/preflight',
  '/api/transactions/transaction_viewer_settings',
];

// Every container whose contents renderTransactionTable() rebuilds.
const REDRAWN_TABLE_CONTAINER_IDS = ['table-container', 'pending-table-container'];

// Inputs that hold no typed text; a focused checkbox is not an edit in progress.
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color']);

let _lastRevalidationAt = 0;
let _lastUserInputAt = 0;
let _idleNoticeShown = false;
let _revalidationStarted = false;
let _refusedWriteRefetchTimer = null;
let _revalidationRetryTimer = null;
let _backgroundCheckInFlight = false;

// Bumped when a row write is sent and again when it succeeds. A check that
// sees it move between its request and the reply cannot tell whether the
// server built the list before or after that write, so it drops the reply.
let _transactionRowWriteCount = 0;

/**
 * True when a background check ran too recently to run again.
 *
 * @param {number} now Current time in ms.
 * @param {number} lastRunAt Time of the last check in ms, 0 if none.
 * @param {number} [minGapMs]
 * @returns {boolean}
 */
function isRevalidationThrottled(now, lastRunAt, minGapMs) {
  const gap = minGapMs === undefined ? TRANSACTION_REVALIDATE_MIN_GAP_MS : minGapMs;
  if (!lastRunAt) return false;
  return (now - lastRunAt) < gap;
}

/**
 * True when nobody has touched the page for the idle period.
 *
 * @param {number} now Current time in ms.
 * @param {number} lastInputAt Time of the last user input in ms, 0 if unknown.
 * @param {number} [idleAfterMs]
 * @returns {boolean}
 */
function isUserIdle(now, lastInputAt, idleAfterMs) {
  const limit = idleAfterMs === undefined ? TRANSACTION_REVALIDATE_IDLE_AFTER_MS : idleAfterMs;
  if (!lastInputAt) return false;
  return (now - lastInputAt) >= limit;
}

/**
 * Whether a background check may start, and if not, why.
 *
 * It must not run while the tab is hidden, or when nobody has touched the
 * page for a while (a tab left open overnight would otherwise ask all night
 * and keep the session alive), or while a load or another check is in
 * flight (that request already asks the server, and starting another would
 * cancel it). While the user is editing in the table it waits: a changed
 * list redraws the table and would discard what they are typing.
 *
 * @param {{now: number, lastRunAt: number, lastInputAt?: number,
 *   visibilityState: string, loadsInFlight: number, editing: boolean}} state
 * @returns {'run'|'hidden'|'idle'|'busy'|'throttled'|'editing'}
 */
function revalidationGate(state) {
  if (state.visibilityState !== 'visible') return 'hidden';
  if (isUserIdle(state.now, state.lastInputAt || 0)) return 'idle';
  if (state.loadsInFlight > 0) return 'busy';
  if (isRevalidationThrottled(state.now, state.lastRunAt)) return 'throttled';
  if (state.editing) return 'editing';
  return 'run';
}

/**
 * @param {Parameters<typeof revalidationGate>[0]} state
 * @returns {boolean}
 */
function shouldRevalidateNow(state) {
  return revalidationGate(state) === 'run';
}

/**
 * What a background check does with a changed list once it has arrived.
 *
 * @param {{editing: boolean, writesAtStart: number, writesNow: number}} state
 * @returns {'apply'|'deferred'|'superseded'} deferred: the user is editing,
 *   try later. superseded: a row write overlapped the request, ask again now.
 */
function backgroundReplyAction(state) {
  if (state.editing) return 'deferred';
  if (state.writesNow !== state.writesAtStart) return 'superseded';
  return 'apply';
}

/**
 * True when an element takes typed input.
 *
 * @param {Element|null} element
 * @returns {boolean}
 */
function isTextEntryElement(element) {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tagName = String(element.tagName || '').toUpperCase();
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (tagName !== 'INPUT') return false;
  const inputType = String(element.type || 'text').toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(inputType);
}

/**
 * True when the user is editing something a table redraw would destroy.
 *
 * The inline editor counts only while its input is still on the page: a
 * redraw or virtual scroll can remove the input without a blur, leaving the
 * pointer set, and a stale pointer must not hold back every later check.
 * Editors that keep no pointer (the memo input, the category autocomplete)
 * are caught by focus.
 *
 * @param {{input?: Element}|null} inlineEditor The page's open inline editor, if any.
 * @param {Document|null} doc
 * @returns {boolean}
 */
function isEditingTable(inlineEditor, doc) {
  if (!doc) return false;
  const canCheckAttached = typeof doc.contains === 'function';
  if (inlineEditor && inlineEditor.input && canCheckAttached && doc.contains(inlineEditor.input)) {
    return true;
  }

  const focused = doc.activeElement;
  if (!isTextEntryElement(focused)) return false;
  if (typeof doc.getElementById !== 'function') return false;
  return REDRAWN_TABLE_CONTAINER_IDS.some(function(containerId) {
    const container = doc.getElementById(containerId);
    return !!(container && container.contains(focused));
  });
}

/** @returns {boolean} isEditingTable() for this page. */
function isUserEditingTable() {
  const inlineEditor = typeof _activeInlineEditor !== 'undefined' ? _activeInlineEditor : null;
  const doc = typeof document !== 'undefined' ? document : null;
  return isEditingTable(inlineEditor, doc);
}

/** @returns {number} The row-write counter, read before and after a check. */
function transactionRowWriteCount() {
  return _transactionRowWriteCount;
}

/**
 * Check the rows on screen against the server's ETag if the rules allow.
 * A 304 changes nothing visible; a 200 replaces the rows and says so.
 *
 * @returns {Promise<'skipped'|'unchanged'|'updated'|'deferred'|'superseded'|'failed'|'aborted'>}
 */
async function revalidateTransactions(trigger) {
  const source = trigger || 'manual';
  const now = Date.now();
  const gate = revalidationGate({
    now: now,
    lastRunAt: _lastRevalidationAt,
    lastInputAt: _lastUserInputAt,
    visibilityState: document.visibilityState,
    loadsInFlight: _transactionLoadsInFlight + (_backgroundCheckInFlight ? 1 : 0),
    editing: isUserEditingTable(),
  });
  if (gate !== 'run') {
    _logRevalidation(source, 'skipped: ' + gate);
    // An editing skip is still owed; without a retry it would wait for the
    // next five-minute tick.
    if (gate === 'editing') _scheduleRevalidationRetry();
    if (gate === 'idle') _showIdleNotice();
    return 'skipped';
  }

  _lastRevalidationAt = now;
  _logRevalidation(source, 'checking');
  const outcome = await _runGuardedCheck({ announce: true });
  _logRevalidation(source, outcome);
  return outcome;
}

/**
 * One console line per check against the dev backend, so the behaviour can
 * be watched in DevTools without the network panel.
 *
 * @param {string} source What asked for the check.
 * @param {string} result Gate reason, 'checking', or the outcome.
 */
function _logRevalidation(source, result) {
  // Dev backend only; a tab open all day against prod should not fill its console.
  if (typeof window === 'undefined' || !window.LOCAL_AUTO_LOGIN_ENABLED) return;
  console.info('[transactions revalidation] ' + source + ': ' + result);
}

/**
 * The check that follows a refused write. Visibility and the throttle do not
 * apply (the user just acted on this tab), but the editing guard does: an
 * ordinary input error gets a 304 and leaves the user's editor alone, and a
 * stale row waits until they leave the editor.
 *
 * @returns {Promise<'skipped'|'unchanged'|'updated'|'deferred'|'superseded'|'failed'|'aborted'>}
 */
async function revalidateAfterRefusedWrite() {
  // A load or check already in flight asked the server after the write.
  if (_transactionLoadsInFlight > 0 || _backgroundCheckInFlight) {
    _logRevalidation('refused write', 'skipped: busy');
    return 'skipped';
  }
  if (isUserEditingTable()) {
    _lastRevalidationAt = 0;
    _scheduleRevalidationRetry();
    _logRevalidation('refused write', 'deferred: editing');
    return 'deferred';
  }
  _lastRevalidationAt = Date.now();
  _logRevalidation('refused write', 'checking');
  const outcome = await _runGuardedCheck({ announce: false });
  _logRevalidation('refused write', outcome);
  return outcome;
}

/**
 * Run one guarded validation, and act on its outcome.
 *
 * @param {{announce: boolean}} options announce: say so in the status bar
 *   when the rows changed.
 * @returns {Promise<string>} The validation outcome.
 */
async function _runGuardedCheck(options) {
  let outcome = 'failed';
  _backgroundCheckInFlight = true;
  try {
    outcome = await _validateTransactionsWithServer({ guardUser: true });
    if (outcome === 'superseded' && _transactionLoadsInFlight === 0) {
      // The write has landed on the server by now, so a fresh list holds it.
      outcome = await _validateTransactionsWithServer({ guardUser: true });
    }
    if (outcome === 'updated') await _refreshAfterListChanged();
  } finally {
    _backgroundCheckInFlight = false;
  }

  if (outcome === 'deferred' || outcome === 'superseded') {
    // Nothing was kept, so the next tick or tab return must be free to ask.
    _lastRevalidationAt = 0;
    _scheduleRevalidationRetry();
  }
  if (outcome === 'updated' && options.announce) {
    showStatus('Transactions updated from the server', 'info');
    setTimeout(() => clearStatus(), 3000);
  }
  return outcome;
}

/**
 * After a changed list lands, bring the account balances and the ledger
 * column up to date the way a sync does: new rows need running balances,
 * and the sidebar should show post-sync balances.
 *
 * @returns {Promise<void>}
 */
async function _refreshAfterListChanged() {
  const isSingle = selectedAccountMode === 'single' && !!selectedAccountId;
  // The new rows are already drawn; the redraw only fills in balances, so it
  // is skipped when it would discard an edit the user has just started.
  await refreshBalancesAfterListChange({
    evictAccountIds: isSingle ? [selectedAccountId] : [],
    clearAll: false,
    refetchSelected: isSingle,
    reloadAccounts: true,
  }, { skipRenderWhileEditing: true });
}

/** One pending retry at most; a later request for one joins it. */
function _scheduleRevalidationRetry() {
  if (_revalidationRetryTimer) return;
  _revalidationRetryTimer = setTimeout(function() {
    _revalidationRetryTimer = null;
    revalidateTransactions('retry');
  }, DEFERRED_REVALIDATION_RETRY_MS);
}

/**
 * The status bar text for a tab that has stopped checking.
 *
 * @param {number} lastInputAt Time of the last input in ms.
 * @returns {string}
 */
function idleStatusMessage(lastInputAt) {
  const since = new Date(lastInputAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return 'Idle since ' + since + '. The list may be out of date; it is checked when you come back.';
}

/**
 * What the status bar says once the check that follows an idle spell has
 * finished. An updated list announces itself, so it needs nothing here.
 *
 * @param {string} outcome A revalidateTransactions() outcome.
 * @returns {{message: string, type: 'success'|'info'|'warning'}|null}
 */
function returnStatusForOutcome(outcome) {
  if (outcome === 'unchanged') return { message: 'Transactions are up to date', type: 'success' };
  if (outcome === 'updated') return null;
  if (outcome === 'failed' || outcome === 'aborted') {
    return { message: 'Could not check the server for changes', type: 'warning' };
  }
  return { message: 'Transactions will be checked shortly', type: 'info' };
}

/** Tell the user once per idle spell that the rows may be behind. */
function _showIdleNotice() {
  if (_idleNoticeShown) return;
  _idleNoticeShown = true;
  showStatus(idleStatusMessage(_lastUserInputAt), 'info');
}

/**
 * Record user input. Input that ends an idle spell checks at once, since the
 * timer has been standing down while they were away, and the status bar
 * follows the check so the idle notice does not outlive it.
 */
function noteUserInput() {
  const now = Date.now();
  const wasIdle = isUserIdle(now, _lastUserInputAt);
  _lastUserInputAt = now;
  if (!wasIdle) return;

  _idleNoticeShown = false;
  showStatus('Checking for changes since you were away...', 'info');
  revalidateTransactions('user returned').then(function(outcome) {
    const status = returnStatusForOutcome(outcome);
    if (status) showStatus(status.message, status.type);
  }).catch(function(checkError) {
    console.warn('Check after idle failed:', checkError);
  });
}

/**
 * Begin checking when the tab becomes visible and every few minutes while it
 * is in view and in use. Call once, after the first load, which counts as
 * the latest check and as input.
 */
function startTransactionRevalidation() {
  if (_revalidationStarted) return;
  _revalidationStarted = true;
  _lastRevalidationAt = Date.now();
  _lastUserInputAt = _lastRevalidationAt;

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState !== 'visible') return;
    // Switching to the tab is input; it must not be refused as idle. An idle
    // tab brought back takes the same path as a click, status bar included.
    if (isUserIdle(Date.now(), _lastUserInputAt)) {
      noteUserInput();
      return;
    }
    _lastUserInputAt = Date.now();
    revalidateTransactions('tab visible');
  });
  // Capture so a handler that stops propagation still counts as input;
  // passive so scrolling is not slowed.
  USER_INPUT_EVENT_NAMES.forEach(function(eventName) {
    document.addEventListener(eventName, noteUserInput, { capture: true, passive: true });
  });
  setInterval(function() { revalidateTransactions('timer'); }, TRANSACTION_REVALIDATE_INTERVAL_MS);
}

/**
 * True when a request writes to transaction rows.
 *
 * @param {string} method HTTP method of the request.
 * @param {string} url Request URL.
 * @returns {boolean}
 */
function isTransactionRowWrite(method, url) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return false;

  const urlText = String(url || '');
  const apiStart = urlText.indexOf('/api/');
  if (apiStart < 0) return false;
  const path = urlText.slice(apiStart).split('?')[0];

  const isNonRowWrite = NON_ROW_WRITE_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
  if (isNonRowWrite) return false;
  return TRANSACTION_WRITE_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
}

/**
 * True when a response is the server refusing a write to a transaction.
 * A refusal proves the page drew the row from out-of-date data (for example
 * it still showed a row as unmatched after a sync matched it). Failed sign-in
 * (401), rate limiting (429), network failures and server errors prove
 * nothing about the rows, so they do not count.
 *
 * @param {string} method HTTP method of the request.
 * @param {string} url Request URL.
 * @param {number} status HTTP status of the response.
 * @returns {boolean}
 */
function isRefusedTransactionWrite(method, url, status) {
  if (status < 400 || status >= 500 || status === 401 || status === 429) return false;
  return isTransactionRowWrite(method, url);
}

/**
 * Called before every API request on this page is sent.
 *
 * @param {string} method
 * @param {string} url
 */
function noteTransactionWriteStarted(method, url) {
  if (isTransactionRowWrite(method, url)) _transactionRowWriteCount += 1;
}

/**
 * Called for every API response on this page. Counts row writes that
 * succeeded, and when the server refused one, checks the list quietly so the
 * row redraws in its real state. The caller still shows its own error
 * message; this adds none. Several refusals in a burst (a bulk action)
 * share one check.
 *
 * @param {string} method
 * @param {string} url
 * @param {number} status
 */
function noteTransactionWriteResponse(method, url, status) {
  if (status >= 200 && status < 300 && isTransactionRowWrite(method, url)) {
    _transactionRowWriteCount += 1;
  }
  if (!isRefusedTransactionWrite(method, url, status)) return;

  if (_refusedWriteRefetchTimer) clearTimeout(_refusedWriteRefetchTimer);
  _refusedWriteRefetchTimer = setTimeout(function() {
    _refusedWriteRefetchTimer = null;
    revalidateAfterRefusedWrite().catch(function(refetchError) {
      console.warn('Check after a refused write failed:', refetchError);
    });
  }, REFUSED_WRITE_REFETCH_DELAY_MS);
}
