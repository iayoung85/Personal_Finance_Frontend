// ============================================================
// accounts/main.js — Application Bootstrap
// Page initialization, data loading, modal wiring.
// Loaded LAST via <script> tag.
// ============================================================

$(document).ready(async function () {
  // 1. Wait for backend URL detection
  await window.BACKEND_URL_PROMISE;
  if (window.ensureLocalDevSession) {
    window.ensureLocalDevSession();
  }
  refreshAuthState();

  if (!token) {
    alert('Please log in first');
    window.location.href = 'index.html';
    return;
  }

  resetIdleTimeout();
  setupActivityListeners();

  // 2. Load banks (with nested accounts) and category reference in parallel
  showToast('Loading accounts…', 'info');
  try {
    const [banks, categories] = await Promise.all([
      apiFetchBanks(true),
      apiFetchCategories()
    ]);
    banksCache = banks;
    categoriesReference = categories;
    _rebuildFlatAccountsCache();
  } catch (loadError) {
    showToast(`Failed to load data: ${loadError.message}`, 'error');
    console.error('Initial data load failed:', loadError);
    return;
  }

  // 3. Render sidebar
  renderSidebar();
  showToast('Accounts loaded', 'success');

  // 4. Set default balance date in create-account modal to today
  const todayStr = new Date().toISOString().split('T')[0];
  const balanceDateInput = document.getElementById('new-acct-balance-date');
  if (balanceDateInput) balanceDateInput.value = todayStr;
});

// ── Data Reload Helper ───────────────────────────────────────

/**
 * Reload all banks from backend, rebuild sidebar, and re-render
 * the currently selected detail view (if any).
 */
async function reloadAndReselect() {
  try {
    const banks = await apiFetchBanks(true);
    banksCache = banks;
    _rebuildFlatAccountsCache();
    renderSidebar();

    // Re-render detail view for the current selection
    if (selectedAccountId) {
      // Verify the account still exists after the reload
      const stillExists = accountsCache.some(acct => acct.account_id === selectedAccountId);
      if (stillExists) {
        await renderAccountDetail(selectedAccountId);
      } else {
        selectedAccountId = null;
        renderEmptyMainContent();
      }
    } else if (selectedBankId) {
      const bankStillExists = banksCache.some(bankItem => bankItem.bank_id === selectedBankId);
      if (bankStillExists) {
        renderBankDetail(selectedBankId);
      } else {
        selectedBankId = null;
        renderEmptyMainContent();
      }
    }
  } catch (reloadError) {
    showToast(`Failed to reload: ${reloadError.message}`, 'error');
  }
}

/**
 * Flatten banksCache into a flat accountsCache for quick lookups.
 */
function _rebuildFlatAccountsCache() {
  accountsCache = [];
  for (const bank of banksCache) {
    for (const account of bank.accounts || []) {
      accountsCache.push({
        ...account,
        bank_name: bank.bank_name || bank.custom_name || '',
        bank_is_archived: bank.is_archived,
        item_health: bank.item_health || null
      });
    }
  }
}

// ── Create Account Modal ─────────────────────────────────────

function openCreateAccountModal() {
  // Close mobile sidebar if open
  document.getElementById('accounts-sidebar').classList.remove('open');

  // Populate bank datalist with known bank names
  const datalist = document.getElementById('bank-datalist');
  const uniqueBankNames = [...new Set(banksCache.map(bankItem => buildBankDisplayName(bankItem)))];
  datalist.innerHTML = uniqueBankNames
    .sort()
    .map(name => `<option value="${_escapeHtml(name)}">`)
    .join('');

  // Populate category dropdown from reference
  const categorySelect = document.getElementById('new-acct-category');
  populateCategorySelect(categorySelect);

  // Reset subcategory
  const subcategorySelect = document.getElementById('new-acct-subcategory');
  populateSubcategorySelect(subcategorySelect, '');

  // Reset form
  document.getElementById('new-acct-bank').value = '';
  document.getElementById('new-acct-name').value = '';
  document.getElementById('new-acct-category').value = '';
  document.getElementById('new-acct-balance').value = '0';
  document.getElementById('new-acct-balance-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('new-acct-currency').value = 'USD';
  document.getElementById('new-acct-notes').value = '';
  document.getElementById('create-account-error').classList.add('hidden');

  document.getElementById('create-account-modal').classList.remove('hidden');
  document.getElementById('new-acct-bank').focus();
}

function closeCreateAccountModal() {
  document.getElementById('create-account-modal').classList.add('hidden');
}

/**
 * Called when the category dropdown changes in the create-account modal.
 * Updates the subcategory dropdown options.
 */
function onNewAccountCategoryChange() {
  const category = document.getElementById('new-acct-category').value;
  const subcategorySelect = document.getElementById('new-acct-subcategory');
  populateSubcategorySelect(subcategorySelect, category);
}

async function submitCreateAccount() {
  const bankName = document.getElementById('new-acct-bank').value.trim();
  const accountName = document.getElementById('new-acct-name').value.trim();
  const category = document.getElementById('new-acct-category').value;
  const subcategory = document.getElementById('new-acct-subcategory').value;
  const openingBalance = parseFloat(document.getElementById('new-acct-balance').value);
  const balanceDate = document.getElementById('new-acct-balance-date').value;
  const currency = document.getElementById('new-acct-currency').value.trim().toUpperCase();
  const notes = document.getElementById('new-acct-notes').value.trim();
  const errorEl = document.getElementById('create-account-error');
  errorEl.classList.add('hidden');

  // Validation
  if (!bankName) {
    errorEl.textContent = 'Bank name is required.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!accountName) {
    errorEl.textContent = 'Account name is required.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!category) {
    errorEl.textContent = 'Please select an account category.';
    errorEl.classList.remove('hidden');
    return;
  }

  const payload = {
    bank_name: bankName,
    account_name: accountName,
    account_category: category,
    opening_balance: isNaN(openingBalance) ? 0 : openingBalance,
    currency: currency || 'USD'
  };
  if (subcategory) payload.account_subcategory = subcategory;
  if (notes) payload.notes = notes;
  // The backend doesn't currently accept opening_balance_date in the
  // create route, but we pass it as a field the backend can evolve to support.

  try {
    showToast('Creating account…', 'info');
    const result = await apiCreateAccount(payload);
    showToast(`Account "${accountName}" created`, 'success');
    closeCreateAccountModal();

    // Reload and auto-select the new account
    await reloadAndReselect();
    if (result.account_id) {
      selectAccount(result.account_id);
    }
  } catch (createError) {
    errorEl.textContent = createError.message;
    errorEl.classList.remove('hidden');
  }
}
