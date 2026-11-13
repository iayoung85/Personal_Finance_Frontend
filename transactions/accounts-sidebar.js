// ============================================================
// transactions/accounts-sidebar.js — Account Sidebar Management
// Loading accounts, rendering the sidebar, selection state,
// activation, renaming, and manual account creation.
// ============================================================

let _pendingSidebarFocusAccountId = null;
const _ALL_ACCOUNTS_NAV_ID = '__all_accounts__';
let _showHiddenAccounts = false;
// One pending re-fetch at most while the API is refreshing bank balances.
let _bankRefreshTimer = null;
let _bankRefreshTries = 0;

/**
 * Build the human-readable display name for an account.
 * Custom name takes priority and is shown as-is (user controls mask inclusion).
 * Default format: <bank_name> - <account_name>(...<mask>)
 */
/**
 * Build the human-readable display name for an account.
 * When showMaskWithName preference is on, appends (mask) to custom names
 * unless the mask is already embedded.
 */
function _buildAccountDisplayName(acc) {
  const mask = acc.effective_mask || acc.user_mask || acc.mask;
  const config = typeof getAppConfig === 'function' ? getAppConfig() : {};
  const showMask = config.showMaskWithName !== false;

  if (acc.custom_name) {
    if (showMask && mask && !acc.custom_name.includes(mask)) {
      return `${acc.custom_name} (${mask})`;
    }
    return acc.custom_name;
  }

  const bankPrefix = acc.bank_name || acc.institution_name || '';
  const accountName = acc.account_name || 'Unknown Account';

  let nameWithMask = accountName;
  if (mask && !accountName.includes(mask)) {
    nameWithMask = `${accountName} (${mask})`;
  }

  return bankPrefix ? `${bankPrefix} - ${nameWithMask}` : nameWithMask;
}

async function refreshAccounts() {
  try {
    showStatus('Syncing accounts from Plaid...', 'info');
    const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts`);
    
    if (!response.ok) {
      throw new Error('Failed to refresh accounts');
    }
    
    await loadAccounts(true);
    showStatus('Accounts refreshed successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
  } catch (error) {
    console.error('refreshAccounts error:', error);
    showStatus(`Failed to refresh accounts: ${error.message}`, 'error');
  }
}

function selectAllAccounts() {
  selectedAccountMode = 'all';
  selectedAccountId = null;
  renderAccountsSidebar();
  // Note: Don't render transaction table here during init - transactions may not be loaded yet
}

function deselectAllAccounts() {
  selectedAccountMode = 'all';
  selectedAccountId = null;
  renderAccountsSidebar();
  updatePlaidBalanceIndicator();
  // Note: Don't render transaction table here during init - transactions may not be loaded yet
}

function toggleSidebar() {
  const sidebar = document.getElementById('accounts-sidebar');
  sidebar.classList.toggle('open');
}

async function selectAccount(accountId, skipDebounce = false) {
  _saveScrollPosition();
  selectedAccountMode = 'single';
  selectedAccountId = accountId;
  if (bankSuspectHighlight && bankSuspectHighlight.accountId !== accountId) {
    bankSuspectHighlight = null;
  }
  localStorage.setItem('pf_selected_account', accountId);
  renderAccountsSidebar();
  updatePlaidBalanceIndicator();

  if (skipDebounce) {
    await fetchBalanceHistory(accountId);
    renderTransactionTable();
    return;
  }

  // Debounce the expensive work (balance-history fetch + table render)
  // so rapid arrow-key navigation skips intermediate accounts.
  if (_sidebarSelectDebounceTimer) clearTimeout(_sidebarSelectDebounceTimer);
  _sidebarSelectDebounceTimer = setTimeout(async () => {
    _sidebarSelectDebounceTimer = null;
    // Guard: if user navigated away from this account before timer fired, bail
    if (selectedAccountId !== accountId) return;
    await fetchBalanceHistory(accountId);
    renderTransactionTable();
  }, SIDEBAR_SELECT_DEBOUNCE_MS);
}

function selectAllAccountsMode() {
  _saveScrollPosition();
  selectedAccountMode = 'all';
  selectedAccountId = null;
  bankSuspectHighlight = null;
  localStorage.removeItem('pf_selected_account');
  balanceHistoryLookup = {};
  renderAccountsSidebar();
  updatePlaidBalanceIndicator();
  renderTransactionTable();
}

function updatePlaidBalanceIndicator() {
  const indicator = document.getElementById('plaid-balance-indicator');
  if (!indicator) return;

  const account = (selectedAccountMode === 'single' && selectedAccountId)
    ? accounts.find(a => a.account_id === selectedAccountId)
    : null;
  const state = bankAgreementIndicatorState(account, maskMoney);

  if (!state.visible) {
    indicator.classList.add('hidden');
    indicator.textContent = '';
    _setPlaidIndicatorClickable(indicator, false);
    _closeBankAgreementPanel();
    return;
  }

  indicator.textContent = state.text;
  indicator.title = state.title;
  indicator.classList.remove('hidden', 'plaid-balance-match', 'plaid-balance-mismatch');
  indicator.classList.add(state.mismatched ? 'plaid-balance-mismatch' : 'plaid-balance-match');
  // The panel traces history; an investment account has none to trace.
  const traceable = state.mismatched && state.hasHistory;
  _setPlaidIndicatorClickable(indicator, traceable);
  _refreshOpenBankAgreementPanel(account, traceable);
  // Once the ledger agrees again there is nothing left to point at.
  if (!state.mismatched && bankSuspectHighlight && bankSuspectHighlight.accountId === account.account_id) {
    clearBankSuspectHighlight();
  }
}

// ─── Bank agreement panel ────────────────────────────────────
// Opened from a mismatched Plaid indicator: where the ledger last agreed
// with the bank. Opening it highlights the table rows dated after that
// day, and the highlight outlives the panel so the user can scroll back
// to where the highlighting stops.

const BANK_AGREEMENT_PANEL_ID = 'bank-agreement-panel';
const _BANK_AGREEMENT_PANEL_GAP_PX = 6;
const _BANK_AGREEMENT_PANEL_EDGE_PX = 8;

// The account the open panel belongs to and what the API returned for it.
let _bankAgreementPanel = null;

/**
 * Make the indicator a button while the account is mismatched, and plain
 * text otherwise. Listeners are attached once; they check the class.
 * @param {HTMLElement} indicator
 * @param {boolean} clickable
 */
function _setPlaidIndicatorClickable(indicator, clickable) {
  if (!indicator.dataset.bankAgreementWired) {
    indicator.dataset.bankAgreementWired = 'true';
    indicator.addEventListener('click', _onPlaidIndicatorActivate);
    indicator.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        _onPlaidIndicatorActivate();
      }
    });
  }
  indicator.classList.toggle('plaid-balance-clickable', clickable);
  if (clickable) {
    indicator.setAttribute('role', 'button');
    indicator.setAttribute('tabindex', '0');
    indicator.setAttribute('aria-haspopup', 'dialog');
  } else {
    indicator.removeAttribute('role');
    indicator.removeAttribute('tabindex');
    indicator.removeAttribute('aria-haspopup');
  }
}

function _onPlaidIndicatorActivate() {
  const indicator = document.getElementById('plaid-balance-indicator');
  if (!indicator || !indicator.classList.contains('plaid-balance-clickable')) return;
  if (_bankAgreementPanel && _bankAgreementPanel.accountId === selectedAccountId) {
    _closeBankAgreementPanel();
    return;
  }
  openBankAgreementPanel(selectedAccountId);
}

/**
 * Open the panel for an account and load its bank-agreement detail.
 * @param {string} accountId
 */
async function openBankAgreementPanel(accountId) {
  _closeBankAgreementPanel();
  if (!accountId) return;

  const panel = document.createElement('div');
  panel.id = BANK_AGREEMENT_PANEL_ID;
  panel.className = 'bank-agreement-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Ledger against the bank');
  document.body.appendChild(panel);

  _bankAgreementPanel = { accountId, response: null, error: null };
  _renderBankAgreementPanel();

  document.addEventListener('mousedown', _onBankAgreementOutsideClick, true);
  document.addEventListener('keydown', _onBankAgreementEscape);
  window.addEventListener('resize', _positionBankAgreementPanel);

  try {
    const response = await fetchBankAgreement(accountId);
    if (!_bankAgreementPanel || _bankAgreementPanel.accountId !== accountId) return;
    _bankAgreementPanel.response = response;
    _applyBankSuspectHighlight(accountId, response);
  } catch (error) {
    if (!_bankAgreementPanel || _bankAgreementPanel.accountId !== accountId) return;
    _bankAgreementPanel.error = error.message || 'Could not load the comparison.';
  }
  _renderBankAgreementPanel();
}

/**
 * Close the panel, if open. Safe to call at any time.
 * @param {boolean} [returnFocus] - Put focus back on the indicator.
 */
function _closeBankAgreementPanel(returnFocus = false) {
  const panel = document.getElementById(BANK_AGREEMENT_PANEL_ID);
  if (panel) panel.remove();
  _bankAgreementPanel = null;
  document.removeEventListener('mousedown', _onBankAgreementOutsideClick, true);
  document.removeEventListener('keydown', _onBankAgreementEscape);
  window.removeEventListener('resize', _positionBankAgreementPanel);
  if (returnFocus) {
    const indicator = document.getElementById('plaid-balance-indicator');
    if (indicator && indicator.classList.contains('plaid-balance-clickable')) indicator.focus();
  }
}

/**
 * Keep an open panel in step with the indicator: close it when the account
 * changed or no longer mismatches, redraw it otherwise so a privacy-mode
 * toggle masks its figures too.
 * @param {object|null} account
 * @param {boolean} mismatched
 */
function _refreshOpenBankAgreementPanel(account, mismatched) {
  if (!_bankAgreementPanel) return;
  if (!account || !mismatched || account.account_id !== _bankAgreementPanel.accountId) {
    _closeBankAgreementPanel();
    return;
  }
  _renderBankAgreementPanel();
}

function _onBankAgreementOutsideClick(event) {
  const panel = document.getElementById(BANK_AGREEMENT_PANEL_ID);
  const indicator = document.getElementById('plaid-balance-indicator');
  if (panel && panel.contains(event.target)) return;
  // The indicator toggles the panel itself.
  if (indicator && indicator.contains(event.target)) return;
  _closeBankAgreementPanel();
}

function _onBankAgreementEscape(event) {
  if (event.key === 'Escape') _closeBankAgreementPanel(true);
}

/**
 * Turn the highlight on for the rows dated after the last-agreed day, and
 * widen the date filter when that day is off the start of the range.
 * @param {string} accountId
 * @param {object} response - GET /api/accounts/<id>/bank-agreement body.
 */
function _applyBankSuspectHighlight(accountId, response) {
  const model = buildBankAgreementPanelModel(response, {
    mask: text => text,
    todayIso: toISODateStr(new Date()),
  });
  if (model.state !== 'mismatched' || !model.highlightAfterDate) return;

  bankSuspectHighlight = { accountId, afterDate: model.highlightAfterDate };
  const currentStart = document.getElementById('start-date').value;
  const widenedStart = bankSuspectFilterStart(model.highlightAfterDate, currentStart);
  if (widenedStart) {
    showLedgerFromDate(widenedStart);
  } else {
    renderTransactionTable();
  }
}

/**
 * Turn the highlight off and redraw the table without it.
 */
function clearBankSuspectHighlight() {
  if (!bankSuspectHighlight) return;
  bankSuspectHighlight = null;
  renderTransactionTable();
}

/**
 * Show or hide the chip above the table that names the highlight and
 * offers to clear it. Called by the table renderer after each render.
 * @param {number} rowCount - Highlighted rows in the current table.
 */
function renderBankSuspectChip(rowCount) {
  const chip = document.getElementById('bank-suspect-chip');
  if (!chip) return;
  const active = bankSuspectHighlight
    && selectedAccountMode === 'single'
    && bankSuspectHighlight.accountId === selectedAccountId;
  if (!active) {
    chip.classList.add('hidden');
    chip.innerHTML = '';
    return;
  }
  const text = bankSuspectChipText(bankSuspectHighlight.afterDate, rowCount, toISODateStr(new Date()));
  chip.innerHTML = `<span class="bank-suspect-chip-text">${escapeHtml(text)}</span>`
    + '<button type="button" class="bank-suspect-chip-clear">Clear</button>';
  chip.querySelector('.bank-suspect-chip-clear').addEventListener('click', clearBankSuspectHighlight);
  chip.classList.remove('hidden');
}

function _renderBankAgreementPanel() {
  const panel = document.getElementById(BANK_AGREEMENT_PANEL_ID);
  if (!panel || !_bankAgreementPanel) return;

  panel.innerHTML = `
    <div class="bank-agreement-header">
      <span class="bank-agreement-title">Ledger vs. bank</span>
      <button type="button" class="bank-agreement-close" aria-label="Close" title="Close">&times;</button>
    </div>
    <div class="bank-agreement-body">${_bankAgreementPanelBodyHtml()}</div>`;

  panel.querySelector('.bank-agreement-close')
    .addEventListener('click', () => _closeBankAgreementPanel(true));
  _positionBankAgreementPanel();
}

/**
 * @returns {string} HTML for the panel body in its current state.
 */
function _bankAgreementPanelBodyHtml() {
  const { response, error } = _bankAgreementPanel;
  if (error) {
    return `<div class="bank-agreement-message bank-agreement-error">${escapeHtml(error)}</div>`;
  }
  if (!response) {
    return '<div class="bank-agreement-message">Loading…</div>';
  }

  const model = buildBankAgreementPanelModel(response, {
    mask: maskMoney,
    todayIso: toISODateStr(new Date()),
  });

  if (model.state !== 'mismatched') {
    return `<div class="bank-agreement-message">${escapeHtml(model.message)}</div>`;
  }

  let summaryHtml = '<dl class="bank-agreement-summary">';
  if (model.lastAgreedDate) {
    summaryHtml += `<div><dt>Last agreed</dt><dd>${escapeHtml(model.lastAgreedText)}</dd></div>`;
  }
  summaryHtml += `<div><dt>Gap today</dt><dd><span class="bank-agreement-figure">${escapeHtml(model.gapText)}</span>`
    + ' <span class="bank-agreement-hint">ledger minus bank</span></dd></div>';
  if (model.suspectText) {
    summaryHtml += `<div><dt>Since then</dt><dd>${escapeHtml(model.suspectText)}</dd></div>`;
  }
  summaryHtml += '</dl>';

  const messageHtml = model.message
    ? `<div class="bank-agreement-message bank-agreement-none">${escapeHtml(model.message)}</div>`
    : '';

  let tableHtml = '';
  if (model.days.length > 0) {
    const rowsHtml = model.days.map(day => {
      const rowClass = day.agreed ? ' class="bank-agreement-day-agreed"' : '';
      const markTitle = day.agreedNote || (day.agreed ? 'Agreed with the bank' : '');
      const markHtml = day.agreed
        ? `<span class="bank-agreement-mark" title="${escapeHtml(markTitle)}" aria-label="${escapeHtml(markTitle)}">${day.agreedMark}</span>`
        : '';
      return `<tr${rowClass}>`
        + `<td>${escapeHtml(day.dateText)}</td>`
        + `<td class="num">${escapeHtml(day.ledgerText)}</td>`
        + `<td class="num">${escapeHtml(day.bankText)}</td>`
        + `<td class="num">${escapeHtml(day.gapText)}</td>`
        + `<td class="mark">${markHtml}</td>`
        + '</tr>';
    }).join('');
    tableHtml = '<div class="bank-agreement-table-wrap"><table class="bank-agreement-table">'
      + '<thead><tr><th>Date</th><th class="num">Ledger</th><th class="num">Bank</th>'
      + '<th class="num">Gap</th><th class="mark"><span class="visually-hidden">Agreed</span></th></tr></thead>'
      + `<tbody>${rowsHtml}</tbody></table></div>`;
  }

  const highlightHtml = model.highlightAfterDate
    ? '<div class="bank-agreement-hint bank-agreement-highlight-note">'
      + 'Rows dated after the last agreed day are highlighted in the table.</div>'
    : '';

  return summaryHtml + messageHtml + tableHtml + highlightHtml;
}

/**
 * Hang the panel under the indicator, right edges aligned, flipping above
 * it when there is no room below and staying inside the window.
 */
function _positionBankAgreementPanel() {
  const panel = document.getElementById(BANK_AGREEMENT_PANEL_ID);
  const indicator = document.getElementById('plaid-balance-indicator');
  if (!panel || !indicator) return;

  const anchor = indicator.getBoundingClientRect();
  const panelWidth = panel.offsetWidth;
  const panelHeight = panel.offsetHeight;
  const maxLeft = window.innerWidth - panelWidth - _BANK_AGREEMENT_PANEL_EDGE_PX;
  const left = Math.max(_BANK_AGREEMENT_PANEL_EDGE_PX, Math.min(anchor.right - panelWidth, maxLeft));

  let top = anchor.bottom + _BANK_AGREEMENT_PANEL_GAP_PX;
  const roomBelow = window.innerHeight - top - _BANK_AGREEMENT_PANEL_EDGE_PX;
  if (panelHeight > roomBelow && anchor.top > roomBelow) {
    top = Math.max(_BANK_AGREEMENT_PANEL_EDGE_PX, anchor.top - _BANK_AGREEMENT_PANEL_GAP_PX - panelHeight);
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

/**
 * Reload the accounts list and redraw the sidebar.
 *
 * When the response says bank balances are still being refreshed, one quiet
 * reload is scheduled to pick them up. Any other call replaces that pending
 * reload and starts the count again, so reloads never stack.
 *
 * @param {{quiet?: boolean, bankRefreshRetry?: boolean}} [options] quiet:
 *   skip the progress and success messages so a status line the user is
 *   reading is not replaced. Errors still show. bankRefreshRetry: set only
 *   by the scheduled reload itself, to keep its try count.
 * @returns {Promise<void>}
 */
async function loadAccounts(options = {}) {
  const quiet = !!options && options.quiet === true;
  const isBankRefreshRetry = !!options && options.bankRefreshRetry === true;
  if (_bankRefreshTimer !== null) {
    clearTimeout(_bankRefreshTimer);
    _bankRefreshTimer = null;
  }
  if (!isBankRefreshRetry) _bankRefreshTries = 0;
  try {
    if (!quiet) showStatus('Loading accounts...', 'info');

    // 1) Get canonical accounts list (includes Plaid + manual accounts, all types)
    const resp = await authenticatedFetch(`${BACKEND_URL}/api/accounts`);
    const data = await resp.json();
    if (data.error) {
      showStatus(`Error: ${data.error}`, 'error');
      return;
    }

    const allAccounts = data.accounts || [];
    console.debug('loadAccounts: /api/accounts returned', allAccounts.length, 'accounts');

    // 2) Map to internal format (all account types now included)
    const mappedAccounts = allAccounts.map(a => ({
      account_id: a.account_id || null,
      plaid_account_id: a.plaid_account_id || null,
      plaid_item_id: a.plaid_item_id || a.item_id || null,
      bank_id: a.bank_id || null,
      bank_name: a.bank_name || null,
      institution_name: a.institution_name || a.bank_name || null,
      account_name: a.account_name || '',
      account_category: a.account_category || a.account_type || '',
      account_subcategory: a.account_subcategory || a.account_subtype || '',
      custom_name: a.custom_name || null,
      origin: a.origin || 'manual',
      connection_status: a.connection_status || 'manual',
      plaid_type: a.plaid_type || null,
      mask: a.mask || null,
      user_mask: a.user_mask || null,
      effective_mask: a.effective_mask || a.user_mask || a.mask || null,
      is_archived: a.is_archived || false,
      is_hidden: a.is_hidden || false,
      billed_products: a.billed_products || [],
      available_products: a.available_products || [],
      // Backend-authoritative boundary for manual txn date guard (Problem 5 alignment)
      earliest_plaid_transaction_date: a.earliest_plaid_transaction_date || null,
      // Exact bracket string the API stores for transfers to this account.
      transfer_label: a.transfer_label || null,
      // current_balance, last_updated, plaid_balance and bank_agreement: the
      // same mapping a save response's affected_accounts entries go through.
      ...mapAccountBalanceFields(a),
    }))
    .filter(a => a.account_id); // Filter out any without account_id

    accounts = mappedAccounts;
    console.debug('loadAccounts: mapped', accounts.length, 'accounts');

    renderAccountsSidebar();
    // Keep the Plaid balance indicator in sync with freshly loaded account data.
    updatePlaidBalanceIndicator();

    _scheduleBankRefreshReload(data.bank_balances_refreshing === true);

    if (!quiet) {
      showStatus('Accounts loaded successfully', 'success');
      setTimeout(() => clearStatus(), 2000);
    }

  } catch (error) {
    console.error('loadAccounts error:', error);
    showStatus(`Failed to load accounts: ${error.message}`, 'error');
  }
}

/**
 * Schedule the next quiet accounts reload while the API is still fetching
 * bank balances, or reset the count once it has finished.
 *
 * @param {boolean} stillRefreshing The response's bank_balances_refreshing.
 * @returns {void}
 */
function _scheduleBankRefreshReload(stillRefreshing) {
  if (!stillRefreshing) {
    _bankRefreshTries = 0;
    return;
  }
  const waitMs = nextBankRefreshWaitMs(_bankRefreshTries);
  if (waitMs === null) return;
  _bankRefreshTries += 1;
  _bankRefreshTimer = setTimeout(() => {
    _bankRefreshTimer = null;
    loadAccounts({ quiet: true, bankRefreshRetry: true });
  }, waitMs);
}

/**
 * Bring the page's accounts up to date after a change, from the save
 * response instead of a fresh `GET /api/accounts`.
 *
 * Patches the in-memory accounts from the response's `affected_accounts`, then
 * redraws the sidebar and the Plaid indicator as `loadAccounts` does. When the
 * list is missing or names an account the page does not hold, it falls back to
 * one quiet `loadAccounts`. Call it before `_patchBalanceHistoryCache`, which
 * signs the ledger cache with the account's `last_updated`.
 *
 * @param {Object|null|undefined} responseData Parsed JSON body of the save.
 * @returns {Promise<void>}
 */
async function applyAffectedAccounts(responseData) {
  const affected = responseData ? responseData.affected_accounts : undefined;
  const result = patchAccountsFromAffected(accounts, affected);
  if (!result.patched) {
    await loadAccounts({ quiet: true });
    return;
  }
  if (affected.length === 0) return;

  accounts = result.accounts;
  renderAccountsSidebar();
  updatePlaidBalanceIndicator();
}

function _wireSidebarKeyboardNavigation(container) {
  if (!container) return;
  if (container.dataset.arrowNavBound === 'true') return;

  const handleArrowNavigation = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    const activeElement = document.activeElement;
    const isTypingContext = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.isContentEditable
    );
    if (isTypingContext) return;

    const sidebarRows = Array.from(container.querySelectorAll('.sidebar-all-accounts, .sidebar-account-item'));
    if (sidebarRows.length === 0) return;

    const focusedSidebarRow = activeElement && activeElement.closest
      ? activeElement.closest('.sidebar-all-accounts, .sidebar-account-item')
      : null;
    const focusIsInSidebar = !!focusedSidebarRow;
    const hasSelectedSidebarAccount = selectedAccountMode === 'single' && !!selectedAccountId;

    if (!focusIsInSidebar && !hasSelectedSidebarAccount) return;

    let currentIndex = -1;
    if (focusedSidebarRow) {
      currentIndex = sidebarRows.indexOf(focusedSidebarRow);
    }

    if (currentIndex < 0 && hasSelectedSidebarAccount) {
      currentIndex = sidebarRows.findIndex(row => row.dataset.accountId === selectedAccountId);
    }

    if (currentIndex < 0) {
      currentIndex = 0;
    }

    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= sidebarRows.length) return;

    const nextAccountId = sidebarRows[nextIndex].dataset.accountId || _ALL_ACCOUNTS_NAV_ID;

    event.preventDefault();
    _pendingSidebarFocusAccountId = nextAccountId;
    if (nextAccountId === _ALL_ACCOUNTS_NAV_ID) {
      selectAllAccountsMode();
      return;
    }

    void selectAccount(nextAccountId);
  };

  // container.addEventListener('keydown', handleArrowNavigation);
  document.addEventListener('keydown', handleArrowNavigation);

  container.dataset.arrowNavBound = 'true';
}

function renderAccountsSidebar() {
  const container = document.getElementById('accounts-list');
  
  if (accounts.length === 0) {
    container.innerHTML = '<p style="padding: 10px; color: #999;">No accounts found</p>';
    return;
  }

  const formatSidebarCurrency = (amount) => maskMoney(new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount));

  const sumAccountBalances = (accountList) => accountList.reduce((sum, account) => {
    return sum + (account.current_balance || 0);
  }, 0);

  // Separate visible vs hidden accounts
  const visibleAccounts = accounts.filter(acc => !acc.is_hidden);
  const hiddenAccounts = accounts.filter(acc => acc.is_hidden)
    .sort((a, b) => _buildAccountDisplayName(a).localeCompare(_buildAccountDisplayName(b)));

  // Compute total balance across visible accounts only
  const totalBalance = sumAccountBalances(visibleAccounts);
  const totalBalanceStr = formatSidebarCurrency(totalBalance);

  // Group accounts by category
  const categoryOrder = ['depository', 'credit', 'investment', 'loan', 'asset', 'liability'];
  const categoryLabels = {
    'depository': '🔹 Depository',
    'credit': '💳 Credit',
    'investment': '📈 Investment',
    'loan': '📋 Loan',
    'asset': '💎 Asset',
    'liability': '⚠️ Liability'
  };

  const grouped = {
    active: {},
  };

  visibleAccounts.forEach(acc => {
    const cat = acc.account_category || 'asset';
    if (!grouped.active[cat]) {
      grouped.active[cat] = [];
    }
    grouped.active[cat].push(acc);
  });

  // Sort accounts within each category by account_name
  Object.keys(grouped.active).forEach(cat => {
    grouped.active[cat].sort((a, b) => {
      const nameA = (a.custom_name || a.account_name).toLowerCase();
      const nameB = (b.custom_name || b.account_name).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  });

  const categoryTotals = {};
  Object.keys(grouped.active).forEach(cat => {
    categoryTotals[cat] = sumAccountBalances(grouped.active[cat]);
  });

  const superCategoryDefinitions = [
    {
      id: 'banking',
      label: 'Banking Net:',
      categories: ['depository', 'credit']
    },
    {
      id: 'assets-liabilities',
      label: 'Assets/Liabilities:',
      categories: ['investment', 'loan', 'asset', 'liability']
    }
  ];

  let html = '';

  const netWorthTotalClass = totalBalance < 0
    ? 'sidebar-super-group-total sidebar-super-group-total-negative'
    : 'sidebar-super-group-total sidebar-super-group-total-positive';

  const superCategoryRows = superCategoryDefinitions.map(superCategory => {
    const superCategoryTotal = superCategory.categories.reduce((sum, cat) => {
      return sum + (categoryTotals[cat] || 0);
    }, 0);
    const superCategoryTotalClass = superCategoryTotal < 0
      ? 'sidebar-super-group-total sidebar-super-group-total-negative'
      : 'sidebar-super-group-total sidebar-super-group-total-positive';

    return `
      <div class="sidebar-super-group-title">
        <span>${superCategory.label}</span>
        <span class="${superCategoryTotalClass}">${formatSidebarCurrency(superCategoryTotal)}</span>
      </div>
    `;
  }).join('');

  // Render summary box into separate non-scrolling container
  const summaryContainer = document.getElementById('accounts-summary');
  summaryContainer.innerHTML = `
    <div class="sidebar-super-group-box">
      <div class="sidebar-super-group-title">
        <span>Net Worth: ${privacyToggleButtonHtml()}</span>
        <span class="${netWorthTotalClass}">${totalBalanceStr}</span>
      </div>
      ${superCategoryRows}
    </div>
  `;

  // ===== ALL ACCOUNTS ITEM =====
  const allAccountsClass = selectedAccountMode === 'all' ? 'selected' : '';
  html += `
    <div class="sidebar-all-accounts ${allAccountsClass}" tabindex="0" data-account-id="${_ALL_ACCOUNTS_NAV_ID}" onclick="selectAllAccountsMode()">
      <span>⊕ All Accounts</span>
    </div>
  `;

  const renderCategoryBlock = (cat) => {
    if (grouped.active[cat] && grouped.active[cat].length > 0) {
      html += `<div class="sidebar-account-group">`;
      html += `
        <div class="sidebar-group-title">
          <span>${categoryLabels[cat] || cat}</span>
          <span class="sidebar-group-total">${formatSidebarCurrency(categoryTotals[cat] || 0)}</span>
        </div>
      `;

      grouped.active[cat].forEach(acc => {
        html += _renderSidebarAccountItem(acc, formatSidebarCurrency);
      });

      html += '</div>';
    }
  };

  // ===== ACTIVE ACCOUNTS (grouped by category) =====
  categoryOrder.forEach(cat => {
    renderCategoryBlock(cat);
  });

  // ===== HIDDEN ACCOUNTS TOGGLE & LIST =====
  if (hiddenAccounts.length > 0) {
    const hiddenTotal = sumAccountBalances(hiddenAccounts);
    const hiddenTotalStr = formatSidebarCurrency(hiddenTotal);
    const hiddenTotalClass = hiddenTotal < 0 ? 'sidebar-account-balance-negative' : 'sidebar-account-balance';
    const toggleClass = _showHiddenAccounts ? 'expanded' : '';
    // Hidden accounts are collapsed by default, so their unreviewed rows need
    // a count on the header or they sit unseen.
    const hiddenUnreviewedCount = hiddenAccounts.reduce(
      (total, acc) => total + _getUnreviewedCountForAccount(acc.account_id), 0);
    const hiddenUnreviewedBadge = _unreviewedBadgeHtml(
      hiddenUnreviewedCount, 'margin-left: 6px; vertical-align: middle;');
    html += `
      <div class="sidebar-hidden-toggle ${toggleClass}" onclick="_toggleHiddenAccountsView()">
        <span>${_showHiddenAccounts ? '▾' : '▸'} Hidden Accounts (${hiddenAccounts.length})</span>${hiddenUnreviewedBadge}
        <span class="${hiddenTotalClass}" style="margin-left: auto; font-size: 12px;">${hiddenTotalStr}</span>
      </div>
    `;

    if (_showHiddenAccounts) {
      html += '<div class="sidebar-hidden-list">';
      hiddenAccounts.forEach(acc => {
        const displayName = _buildAccountDisplayName(acc);
        const accBalance = acc.current_balance || 0;
        const accBalanceStr = accBalance !== 0 ? formatSidebarCurrency(accBalance) : '';
        const accBalanceClass = accBalance < 0 ? 'sidebar-account-balance-negative' : 'sidebar-account-balance';
        html += `
          <div class="sidebar-hidden-account-item"
               oncontextmenu="event.preventDefault(); _showAccountContextMenu(event, '${acc.account_id}', true)">
            <span class="sidebar-hidden-account-name" title="${displayName}">${displayName}</span>
            ${_unreviewedBadgeHtml(_getUnreviewedCountForAccount(acc.account_id), 'margin-left: 6px;')}
            ${accBalanceStr ? `<span class="${accBalanceClass}" style="font-size: 12px; white-space: nowrap; margin-left: 8px;">${accBalanceStr}</span>` : ''}
            <button class="sidebar-unhide-btn" title="Unhide account"
                    onclick="event.stopPropagation(); _unhideAccount('${acc.account_id}')">
              Unhide
            </button>
          </div>
        `;
      });
      html += '</div>';
    }
  }

  // ===== CREATE MANUAL ACCOUNT LINK =====
  html += `
    <a href="accounts.html#create-account" class="sidebar-create-btn">
      + Create Manual Account
    </a>
  `;

  container.innerHTML = html;
  _wireSidebarKeyboardNavigation(container);

  if (_pendingSidebarFocusAccountId) {
    const focusTarget = container.querySelector(`[data-account-id="${_pendingSidebarFocusAccountId}"]`);
    if (focusTarget) {
      focusTarget.focus();
    }
    _pendingSidebarFocusAccountId = null;
  }
}

// ─── Sidebar account item renderer ───────────────────────────

/**
 * Green dot = actively syncing from Plaid (transactions or holdings).
 * Blue dot = manual, converted, or linked but not syncing relevant data.
 */
function _getSyncDotHtml(acc) {
  if (acc.connection_status === 'linked') {
    const billed = acc.billed_products || [];
    const isInvestment = (acc.account_category || '').toLowerCase() === 'investment';
    const hasSyncProduct = isInvestment
      ? billed.includes('investments')
      : billed.includes('transactions');
    if (hasSyncProduct) {
      return '<span class="sync-dot sync-dot-linked" title="Syncing from Plaid"></span>';
    }
  }
  return '<span class="sync-dot sync-dot-manual" title="Manual"></span>';
}

function _getPlaidMismatchDotHtml(acc) {
  const state = bankAgreementIndicatorState(acc, maskMoney);
  if (!state.mismatched) return '';
  return `<span class="plaid-mismatch-dot" title="${escapeHtml(state.dotTitle)}"></span>`;
}

function _getUnreviewedCountForAccount(accountId) {
  if (!Array.isArray(transactions) || transactions.length === 0) return 0;
  let count = 0;
  for (const txn of transactions) {
    if (txn.account_id === accountId && rowNeedsReview(txn)) count++;
  }
  return count;
}

/**
 * Badge markup for an unreviewed count, or '' when there is nothing to review.
 * @param {number} unreviewedCount - Unreviewed rows plus waiting matches.
 * @param {string} [extraStyle] - inline style for spots outside a flex row
 * @returns {string}
 */
function _unreviewedBadgeHtml(unreviewedCount, extraStyle = '') {
  if (unreviewedCount <= 0) return '';
  const plural = unreviewedCount > 1 ? 's' : '';
  const styleAttr = extraStyle ? ` style="${extraStyle}"` : '';
  return `<span class="sidebar-unreviewed-badge"${styleAttr} title="${unreviewedCount} transaction${plural} to review">${unreviewedCount}</span>`;
}

function _renderSidebarAccountItem(acc, formatSidebarCurrency) {
  const displayName = _buildAccountDisplayName(acc);
  const maskMatch = displayName.match(/^(.*?)(\s*\(\d{3,6}\))$/);
  const displayNameMain = maskMatch ? maskMatch[1] : displayName;
  const displayNameSuffix = maskMatch ? maskMatch[2] : '';
  const currentBalance = acc.current_balance || 0;
  const balanceStr = formatSidebarCurrency(currentBalance);
  const balanceColorClass = currentBalance < 0 ? 'sidebar-account-balance-negative' : 'sidebar-account-balance';

  const isSelected = selectedAccountMode === 'single' && selectedAccountId === acc.account_id;
  const selectedClass = isSelected ? 'selected' : '';
  const syncDot = _getSyncDotHtml(acc);
  const mismatchDot = _getPlaidMismatchDotHtml(acc);

  const unreviewedBadge = _unreviewedBadgeHtml(_getUnreviewedCountForAccount(acc.account_id));

  return `
    <div class="sidebar-account-item ${selectedClass}" tabindex="0"
         data-account-id="${acc.account_id}"
         onclick="selectAccount('${acc.account_id}', true)"
         oncontextmenu="event.preventDefault(); _showAccountContextMenu(event, '${acc.account_id}', false)">
      <div class="sidebar-account-label">
        ${syncDot}<span class="sidebar-account-name-text" title="${displayName}">${displayNameMain}</span><span class="sidebar-account-mask">${displayNameSuffix}</span>${unreviewedBadge}
      </div>
      <div class="${balanceColorClass} sidebar-balance-cell">${mismatchDot}${balanceStr}</div>
    </div>
  `;
}

// ─── Account Sidebar Context Menu ────────────────────────────

function _showAccountContextMenu(event, accountId, isHidden) {
  _dismissAccountContextMenu();

  const acc = accounts.find(a => a.account_id === accountId);
  if (!acc) return;

  const menu = document.createElement('div');
  menu.id = 'account-context-menu';
  menu.className = 'account-context-menu';

  let items = '';

  if (isHidden) {
    items += `<div class="account-ctx-item" onclick="_unhideAccount('${accountId}')">👁 Unhide Account</div>`;
  } else {
    // Rename
    items += `<div class="account-ctx-item" onclick="_ctxRenameAccount('${accountId}')">✏ Rename Account</div>`;
    // Clear custom name (only if custom name is set)
    if (acc.custom_name) {
      items += `<div class="account-ctx-item" onclick="_ctxClearCustomName('${accountId}')">↩ Reset to Default Name</div>`;
    }
    // Add Trending Transaction (investment accounts only)
    if (acc.account_category === 'investment') {
      items += '<div class="account-ctx-separator"></div>';
      items += `<div class="account-ctx-item" onclick="_ctxAddTrendingTransaction('${accountId}')">📈 Add Trending Transaction</div>`;
    }
    items += '<div class="account-ctx-separator"></div>';
    // Hide
    items += `<div class="account-ctx-item account-ctx-item-warn" onclick="_hideAccount('${accountId}')">🙈 Hide Account</div>`;
  }

  menu.innerHTML = items;
  document.body.appendChild(menu);

  // Position near the click, keeping it on screen
  const menuWidth = 200;
  const menuHeight = menu.offsetHeight || 120;
  let x = event.clientX;
  let y = event.clientY;
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Dismiss on click outside or Escape
  setTimeout(() => {
    document.addEventListener('click', _dismissAccountContextMenu, { once: true });
    document.addEventListener('keydown', _handleAccountCtxEscape);
  }, 0);
}

function _handleAccountCtxEscape(event) {
  if (event.key === 'Escape') _dismissAccountContextMenu();
}

function _dismissAccountContextMenu() {
  const existing = document.getElementById('account-context-menu');
  if (existing) existing.remove();
  document.removeEventListener('keydown', _handleAccountCtxEscape);
}

// ─── Context menu actions ────────────────────────────────────

function _ctxRenameAccount(accountId) {
  _dismissAccountContextMenu();
  const acc = accounts.find(a => a.account_id === accountId);
  promptRename(accountId, (acc && acc.custom_name) || '');
}

function _ctxClearCustomName(accountId) {
  _dismissAccountContextMenu();
  _updateAccountField(accountId, { custom_name: null }, 'Name reset to default');
}

async function _hideAccount(accountId) {
  _dismissAccountContextMenu();
  await _updateAccountField(accountId, { is_hidden: true }, 'Account hidden');
}

async function _unhideAccount(accountId) {
  _dismissAccountContextMenu();
  await _updateAccountField(accountId, { is_hidden: false }, 'Account unhidden');
}

function _ctxAddTrendingTransaction(accountId) {
  _dismissAccountContextMenu();
  _openAddTrendingModal(accountId);
}

function _openAddTrendingModal(accountId) {
  const account = accounts.find(a => a.account_id === accountId);
  const accountName = account?.custom_name || account?.name || account?.official_name || 'Account';

  let overlay = document.getElementById('add-trending-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'add-trending-modal';
    overlay.className = 'modal-overlay hidden';
    document.body.appendChild(overlay);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const currentMonth = todayIso.slice(0, 7);

  overlay.innerHTML = `
    <div class="modal modal-edit-balance">
      <div class="modal-header">
        <h2>📈 Add Trending Transaction</h2>
        <button class="modal-close" id="add-trending-close">✕</button>
      </div>
      <div class="modal-body">
        <p class="edit-balance-context">
          <strong>${escapeHtml(accountName)}</strong>
        </p>
        <div class="form-group">
          <label for="add-trending-month">Month</label>
          <input type="month" id="add-trending-month" value="${currentMonth}" max="${currentMonth}">
        </div>
        <div class="form-group">
          <label for="add-trending-balance">Account Balance at End of Month ($)</label>
          <input type="number" id="add-trending-balance" step="0.01" placeholder="e.g. 105000.00" autofocus>
        </div>
      </div>
      <div class="modal-footer">
        <button class="secondary" id="add-trending-cancel">Cancel</button>
        <button class="primary" id="add-trending-save">Create</button>
      </div>
    </div>
  `;

  overlay.classList.remove('hidden');

  const closeModal = () => overlay.classList.add('hidden');
  document.getElementById('add-trending-close').onclick = closeModal;
  document.getElementById('add-trending-cancel').onclick = closeModal;
  overlay.onclick = (event) => { if (event.target === overlay) closeModal(); };

  const balanceInput = document.getElementById('add-trending-balance');
  balanceInput.focus();

  const saveTrending = async () => {
    const month = document.getElementById('add-trending-month').value;
    const balanceValue = parseFloat(balanceInput.value);

    if (!month) {
      showStatus('Please select a month', 'error');
      return;
    }
    if (isNaN(balanceValue)) {
      showStatus('Please enter a valid dollar amount', 'error');
      return;
    }

    try {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/investment-trending`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accountId,
            balance_at_date: balanceValue,
            month: month,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        showStatus(data.error || 'Failed to create trending transaction', 'error');
        return;
      }

      closeModal();

      // Without the changed-rows fields the account's rows are fetched again,
      // and the month saved stands in for the new row's date.
      const createdRow = await applyRowChangesFromResponse(data, [accountId], { siteSettlesLedger: true });
      _expandDateFiltersForTransaction((createdRow && createdRow.date) || `${month}-01`);

      showStatus('Trending transaction created', 'success');

      if (selectedAccountMode === 'single' && selectedAccountId) {
        await fetchBalanceHistory(selectedAccountId);
      }

      renderTransactionTable();
    } catch (networkError) {
      showStatus(`Failed to create trending: ${networkError.message}`, 'error');
    }
  };

  document.getElementById('add-trending-save').onclick = saveTrending;
  balanceInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveTrending();
    if (event.key === 'Escape') closeModal();
  });
}

async function _updateAccountField(accountId, fields, successMessage) {
  try {
    showStatus('Updating account…', 'info');
    const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update account');
    }
    showStatus(successMessage, 'success');
    setTimeout(() => clearStatus(), 2000);
    await loadAccounts(true);
    renderTransactionTable();
  } catch (error) {
    console.error('_updateAccountField error:', error);
    showStatus(`Failed: ${error.message}`, 'error');
  }
}

// ─── Hidden accounts toggle ─────────────────────────────────

function _toggleHiddenAccountsView() {
  _showHiddenAccounts = !_showHiddenAccounts;
  renderAccountsSidebar();
}

function getSelectedAccounts() {
  if (selectedAccountMode === 'all') {
    // Return all account IDs — every account in the sidebar is usable.
    // Dormant accounts operate as manual and are included.
    return accounts.map(a => a.account_id);
  } else if (selectedAccountMode === 'single' && selectedAccountId) {
    // Return single selected account
    return [selectedAccountId];
  }
  return [];
}

async function promptRename(accountId, currentCustomName) {
  const newName = prompt('Enter a custom name for this account (leave empty to reset):', currentCustomName);
  
  if (newName === null) return; // User cancelled
  
  try {
    showStatus('Updating account name...', 'info');
    
    const response = await authenticatedFetch(`${BACKEND_URL}/api/accounts/${accountId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        custom_name: newName.trim() || null
      })
    });
    
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to rename account');
    }
    
    showStatus('Account renamed successfully', 'success');
    setTimeout(() => clearStatus(), 2000);
    
    // Refresh accounts list
    await loadAccounts(true);

    // Propagate updated display name into in-memory transactions so the
    // table reflects the rename without a full re-fetch from the server.
    const renamedAccount = accounts.find(a => a.account_id === accountId);
    if (renamedAccount) {
      const updatedDisplayName = _buildAccountDisplayName(renamedAccount);
      transactions.forEach(txn => {
        if (txn.account_id === accountId) {
          txn.bank_account = updatedDisplayName;
        }
      });
    }
    renderTransactionTable();
    
  } catch (error) {
    console.error('Rename error:', error);
    showStatus(`Failed to rename account: ${error.message}`, 'error');
  }
}
