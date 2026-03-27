// ============================================================
// accounts/sidebar.js — Two-Column Sidebar Rendering
// Bank list (left column) and account list (right column).
// Filter/search, selection highlighting, bank→account filtering.
// Emits selection by calling into account-detail / bank-detail.
// ============================================================

/**
 * Master render — redraws both sidebar columns based on current state.
 * Called after data loads, selection changes, or filter text changes.
 */
function renderSidebar() {
  _renderBankList();
  _renderAccountList();
}

// ── Bank List (left column) ──────────────────────────────────

function _renderBankList() {
  const container = document.getElementById('bank-list');
  const filterLower = sidebarFilterText.toLowerCase();

  // "All Banks" selector at top
  const allBanksSelected = selectedBankId === null && selectedAccountId === null;
  let html = `
    <div class="sidebar-all-banks ${allBanksSelected ? 'selected' : ''}"
         data-bank-id="__all__"
         onclick="selectAllBanks()">
      ⊕ All Banks
    </div>
  `;

  // Separate active vs archived banks
  const activeBanks = [];
  const archivedBanks = [];

  const sortedBanks = [...banksCache].sort((bankA, bankB) =>
    buildBankDisplayName(bankA).localeCompare(buildBankDisplayName(bankB))
  );

  for (const bank of sortedBanks) {
    // Apply filter: check bank name and its account names/types
    if (filterLower && !_bankMatchesFilter(bank, filterLower)) continue;

    if (bank.is_archived) {
      // Only add to the archived group when the toggle is on
      if (showArchivedAccounts) archivedBanks.push(bank);
    } else {
      activeBanks.push(bank);
    }
  }

  // Active banks
  for (const bank of activeBanks) {
    html += _renderBankListItem(bank);
  }

  // Archived banks (collapsible group)
  if (archivedBanks.length > 0) {
    html += `
      <div class="sidebar-archived-group">
        <div class="sidebar-archived-toggle" onclick="toggleArchivedBanks()">
          ▸ Archived (${archivedBanks.length})
        </div>
        <div class="sidebar-archived-items" id="archived-banks-list">
    `;
    for (const bank of archivedBanks) {
      html += _renderBankListItem(bank, true);
    }
    html += '</div></div>';
  }

  container.innerHTML = html;
}

function _renderBankListItem(bank, isArchived = false) {
  const displayName = buildBankDisplayName(bank);
  const isSelected = selectedBankId === bank.bank_id;
  const dotClass = getStatusDotClass(bank.connection_status, bank.item_health);
  const archivedClass = isArchived ? 'archived' : '';

  return `
    <div class="sidebar-bank-item ${isSelected ? 'selected' : ''} ${archivedClass}"
         data-bank-id="${bank.bank_id}"
         onclick="selectBank('${bank.bank_id}')"
         title="${displayName}">
      <span class="status-dot ${dotClass}"></span>
      <span class="bank-name">${_escapeHtml(displayName)}</span>
    </div>
  `;
}

// ── Account List (right column) ──────────────────────────────

function _renderAccountList() {
  const container = document.getElementById('account-list');
  const filterLower = sidebarFilterText.toLowerCase();

  // Get accounts to display — filter by selected bank and search text
  let visibleAccounts = _getFilteredAccounts(filterLower);

  // Separate active vs archived
  const activeAccounts = [];
  const archivedAccounts = [];

  for (const account of visibleAccounts) {
    const parentBank = banksCache.find(b => b.bank_id === account.bank_id);
    const bankIsArchived = parentBank && parentBank.is_archived;

    // When toggle is off, hide ALL accounts under archived banks
    if (!showArchivedAccounts && bankIsArchived) continue;
    if (!showArchivedAccounts && account.is_archived) continue;

    // When toggle is on, route archived items to the collapsed group
    const inArchivedGroup = account.is_archived || bankIsArchived;

    if (inArchivedGroup) {
      archivedAccounts.push(account);
    } else {
      activeAccounts.push(account);
    }
  }

  // Sort active accounts by bank name then account name
  activeAccounts.sort((accountA, accountB) => {
    const bankCmp = (accountA.bank_name || '').localeCompare(accountB.bank_name || '');
    if (bankCmp !== 0) return bankCmp;
    return buildAccountDisplayName(accountA).localeCompare(buildAccountDisplayName(accountB));
  });

  let html = '';

  if (activeAccounts.length === 0 && archivedAccounts.length === 0) {
    html = '<div style="padding: 12px; color: #999; font-size: 13px; text-align: center;">No accounts found</div>';
  }

  for (const account of activeAccounts) {
    html += _renderAccountListItem(account);
  }

  // Archived accounts under archived banks
  if (archivedAccounts.length > 0) {
    html += `
      <div class="sidebar-archived-group">
        <div class="sidebar-archived-toggle" onclick="toggleArchivedAccounts()">
          ▸ Archived (${archivedAccounts.length})
        </div>
        <div class="sidebar-archived-items" id="archived-accounts-list">
    `;
    for (const account of archivedAccounts) {
      html += _renderAccountListItem(account, true);
    }
    html += '</div></div>';
  }

  // "+ New Account" button at the bottom
  html += `
    <div class="sidebar-add-btn" onclick="openCreateAccountModal()">
      + New Account
    </div>
  `;

  container.innerHTML = html;
}

function _renderAccountListItem(account, isInArchivedGroup = false) {
  const displayName = buildAccountDisplayName(account);
  const balance = parseFloat(account.current_balance) || 0;
  const balanceStr = formatCurrency(balance, account.currency || 'USD');
  const isNegative = balance < 0;
  const isSelected = selectedAccountId === account.account_id;
  const dotClass = getStatusDotClass(account.connection_status, account.item_health);
  const archivedClass = isInArchivedGroup ? 'archived' : '';
  const archivedIndicator = account.is_archived && !isInArchivedGroup
    ? '<span class="badge badge-archived" style="font-size:9px; padding:1px 4px;">Archived</span>'
    : '';
  const hiddenIndicator = account.is_hidden
    ? '<span class="badge badge-hidden" style="font-size:9px; padding:1px 4px;">Hidden</span>'
    : '';
  const holdingsHiddenIndicator = account.holdings_hidden
    ? '<span class="badge badge-holdings-hidden" style="font-size:9px; padding:1px 4px;">Holdings Hidden</span>'
    : '';

  return `
    <div class="sidebar-account-item ${isSelected ? 'selected' : ''} ${archivedClass}"
         data-account-id="${account.account_id}"
         onclick="selectAccount('${account.account_id}')">
      <span class="status-dot ${dotClass}"></span>
      <div class="account-info">
        <div class="account-display-name" title="${_escapeHtml(displayName)}">
          ${_escapeHtml(displayName)}
        </div>
        <div class="account-meta-row">
          <span class="account-balance ${isNegative ? 'negative' : ''}">${balanceStr}</span>
          <span class="account-type-badge">${account.account_subcategory || account.account_category || ''}</span>
          ${archivedIndicator}
          ${hiddenIndicator}
          ${holdingsHiddenIndicator}
        </div>
      </div>
    </div>
  `;
}

// ── Filter Helpers ───────────────────────────────────────────

function _bankMatchesFilter(bank, filterLower) {
  const bankName = buildBankDisplayName(bank).toLowerCase();
  if (bankName.includes(filterLower)) return true;

  // Check child accounts
  const childAccounts = bank.accounts || [];
  for (const account of childAccounts) {
    if (_accountMatchesFilter(account, filterLower)) return true;
  }
  return false;
}

function _accountMatchesFilter(account, filterLower) {
  const displayName = buildAccountDisplayName(account).toLowerCase();
  if (displayName.includes(filterLower)) return true;
  if ((account.account_category || '').toLowerCase().includes(filterLower)) return true;
  if ((account.account_subcategory || '').toLowerCase().includes(filterLower)) return true;
  if ((account.mask || '').includes(filterLower)) return true;
  if ((account.bank_name || '').toLowerCase().includes(filterLower)) return true;
  return false;
}

function _getFilteredAccounts(filterLower) {
  let results = [];

  for (const bank of banksCache) {
    const childAccounts = bank.accounts || [];
    for (const account of childAccounts) {
      // Filter by selected bank
      if (selectedBankId && bank.bank_id !== selectedBankId) continue;

      // Filter by search text
      if (filterLower && !_accountMatchesFilter(account, filterLower)) {
        // Also allow if the parent bank matches
        if (!buildBankDisplayName(bank).toLowerCase().includes(filterLower)) continue;
      }

      // Attach bank_name for display convenience
      results.push({
        ...account,
        bank_name: bank.custom_name || bank.bank_name || '',
        bank_is_archived: bank.is_archived,
        item_health: bank.item_health || null
      });
    }
  }

  return results;
}

// ── Selection Handlers ───────────────────────────────────────

function selectAllBanks() {
  selectedBankId = null;
  selectedAccountId = null;
  _activeColumn = 'banks';
  renderSidebar();
  _highlightActiveColumn();
  renderEmptyMainContent();
}

function selectBank(bankId) {
  selectedBankId = bankId;
  selectedAccountId = null;
  _activeColumn = 'banks';
  renderSidebar();
  _highlightActiveColumn();
  renderBankDetail(bankId);
}

function selectAccount(accountId) {
  // Find the account's parent bank and highlight it
  for (const bank of banksCache) {
    const found = (bank.accounts || []).find(a => a.account_id === accountId);
    if (found) {
      selectedBankId = bank.bank_id;
      break;
    }
  }
  selectedAccountId = accountId;
  _activeColumn = 'accounts';
  renderSidebar();
  _highlightActiveColumn();
  renderAccountDetail(accountId);
}

// ── Sidebar Toggle Helpers ───────────────────────────────────

function toggleArchivedVisibility() {
  showArchivedAccounts = document.getElementById('show-archived-toggle').checked;
  renderSidebar();
}

function onSidebarFilterChange() {
  sidebarFilterText = document.getElementById('sidebar-filter').value.trim();
  renderSidebar();
}

function toggleSidebar() {
  const sidebar = document.getElementById('accounts-sidebar');
  sidebar.classList.toggle('open');
}

function toggleArchivedBanks() {
  const list = document.getElementById('archived-banks-list');
  if (list) list.classList.toggle('expanded');
  const toggleBtn = list?.previousElementSibling;
  if (toggleBtn) {
    toggleBtn.textContent = list.classList.contains('expanded')
      ? `▾ Archived (${list.children.length})`
      : `▸ Archived (${list.children.length})`;
  }
}

function toggleArchivedAccounts() {
  const list = document.getElementById('archived-accounts-list');
  if (list) list.classList.toggle('expanded');
  const toggleBtn = list?.previousElementSibling;
  if (toggleBtn) {
    toggleBtn.textContent = list.classList.contains('expanded')
      ? `▾ Archived (${list.children.length})`
      : `▸ Archived (${list.children.length})`;
  }
}

// ── HTML Escaping ────────────────────────────────────────────

function _escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// ── Keyboard Navigation ──────────────────────────────────────

/** Which sidebar column currently accepts arrow-key input: 'banks' or 'accounts'. */
let _activeColumn = 'banks';

/**
 * Return the ordered list of selectable DOM nodes in a column.
 * Banks column: .sidebar-all-banks + visible .sidebar-bank-item
 * Accounts column: visible .sidebar-account-item (excludes "+ New Account" button)
 */
function _getColumnItems(column) {
  if (column === 'banks') {
    return Array.from(document.querySelectorAll('#bank-list .sidebar-all-banks, #bank-list .sidebar-bank-item'));
  }
  return Array.from(document.querySelectorAll('#account-list .sidebar-account-item'));
}

/**
 * Find the index of the currently selected item within a column's node list.
 * Returns -1 when nothing is selected.
 */
function _findSelectedIndex(items) {
  return items.findIndex(node => node.classList.contains('selected'));
}

/**
 * Activate a bank or account item by reading its data attribute and calling
 * the existing selection handler.
 */
function _activateItem(node, column) {
  if (column === 'banks') {
    const bankId = node.dataset.bankId;
    if (bankId === '__all__') {
      selectAllBanks();
    } else {
      selectBank(bankId);
    }
  } else {
    const accountId = node.dataset.accountId;
    if (accountId) selectAccount(accountId);
  }
}

/**
 * Scroll selected item into view within its scrollable column.
 */
function _scrollSelectedIntoView(column) {
  const containerId = column === 'banks' ? 'bank-list' : 'account-list';
  const container = document.getElementById(containerId);
  const selected = container?.querySelector('.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function _handleSidebarKeydown(event) {
  // Only act when the sidebar (or body) has focus — ignore when typing in inputs/textareas
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // Don't hijack modifier combos (Cmd+arrows, etc.)
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const key = event.key;

  // Left/Right switches active column
  if (key === 'ArrowLeft') {
    event.preventDefault();
    _activeColumn = 'banks';
    _highlightActiveColumn();
    return;
  }
  if (key === 'ArrowRight') {
    event.preventDefault();
    _activeColumn = 'accounts';
    _highlightActiveColumn();
    return;
  }

  if (key !== 'ArrowUp' && key !== 'ArrowDown') return;
  event.preventDefault();

  const items = _getColumnItems(_activeColumn);
  if (items.length === 0) return;

  const currentIndex = _findSelectedIndex(items);
  let nextIndex;

  if (key === 'ArrowUp') {
    nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
  } else {
    nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
  }

  _activateItem(items[nextIndex], _activeColumn);
  // renderSidebar() is called inside the selection handler, so re-query after render
  requestAnimationFrame(() => _scrollSelectedIntoView(_activeColumn));
}

/**
 * Visual indicator showing which column is the keyboard-active one.
 */
function _highlightActiveColumn() {
  const bankCol = document.getElementById('bank-list');
  const accountCol = document.getElementById('account-list');
  if (!bankCol || !accountCol) return;

  bankCol.classList.toggle('keyboard-active', _activeColumn === 'banks');
  accountCol.classList.toggle('keyboard-active', _activeColumn === 'accounts');
}

// Attach once on page load
document.addEventListener('keydown', _handleSidebarKeydown);
