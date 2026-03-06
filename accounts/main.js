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
  const todayStr = todayISO();
  const balanceDateInput = document.getElementById('new-acct-balance-date');
  if (balanceDateInput) balanceDateInput.value = todayStr;

  // 5. Check if navigating from transactions page with #create-account hash
  if (window.location.hash === '#create-account') {
    openCreateAccountModal();
    window.history.replaceState(null, '', 'accounts.html');
  }
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

/**
 * Build a user-friendly type label for the bank dropdown.
 *
 * Plaid-linked banks say "Plaid-linked" so the user knows it's
 * actively syncing.  Manual banks show "custom" vs "institution"
 * depending on whether they were created with a known institution_id.
 */
function _bankTypeLabel(bank) {
  if (bank.connection_status === 'linked') return 'Plaid-linked';
  if (bank.institution_id) return 'institution';
  return 'custom';
}

/**
 * Cached popular institutions from the backend.
 * Loaded once on first modal open, reused on subsequent opens.
 */
let popularInstitutionsCache = null;

/**
 * Tracks which institution the user selected in official bank mode.
 * Reset each time the modal opens.
 */
let selectedInstitutionId = null;

/**
 * Tracks whether the user is adding to an existing bank (bank_id)
 * or creating a new one (bank_name).  Set by onBankSelectChange().
 */
let selectedExistingBankId = null;

function openCreateAccountModal() {
  // Close mobile sidebar if open
  document.getElementById('accounts-sidebar').classList.remove('open');

  // ── Populate the unified bank dropdown ──
  const bankSelect = document.getElementById('new-acct-bank-select');
  bankSelect.innerHTML = '<option value="">— Select a Bank —</option>';

  // Group existing banks by origin for clarity
  const sortedBanks = [...banksCache].sort((a, b) =>
    (a.bank_name || '').localeCompare(b.bank_name || '')
  );

  if (sortedBanks.length > 0) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = 'Your Banks';
    for (const bank of sortedBanks) {
      if (bank.is_archived) continue;
      const option = document.createElement('option');
      option.value = bank.bank_id;
      const displayName = buildBankDisplayName(bank);
      const typeLabel = _bankTypeLabel(bank);
      option.textContent = `${displayName} — ${typeLabel}`;
      optgroup.appendChild(option);
    }
    bankSelect.appendChild(optgroup);
  }

  // "Create custom bank" and "Use Official Institution" sentinel options
  const customBankOption = document.createElement('option');
  customBankOption.value = '__custom__';
  customBankOption.textContent = '➕ Create custom bank';
  bankSelect.appendChild(customBankOption);

  const officialBankOption = document.createElement('option');
  officialBankOption.value = '__official__';
  officialBankOption.textContent = '➕ Use official institution';
  bankSelect.appendChild(officialBankOption);

  // Populate category dropdown from reference
  const categorySelect = document.getElementById('new-acct-category');
  populateCategorySelect(categorySelect);

  // Reset subcategory
  const subcategorySelect = document.getElementById('new-acct-subcategory');
  populateSubcategorySelect(subcategorySelect, '');

  // Reset form fields
  document.getElementById('new-acct-bank').value = '';
  document.getElementById('new-acct-name').value = '';
  document.getElementById('new-acct-category').value = '';
  document.getElementById('new-acct-balance').value = '0';
  document.getElementById('new-acct-balance-date').value = todayISO();
  document.getElementById('new-acct-currency').value = 'USD';
  document.getElementById('new-acct-notes').value = '';
  document.getElementById('create-account-error').classList.add('hidden');

  // Reset bank selection state
  selectedInstitutionId = null;
  selectedExistingBankId = null;

  // Hide conditional bank fields
  document.getElementById('custom-bank-fields').classList.add('hidden');
  document.getElementById('official-institution-fields').classList.add('hidden');

  // Reset official bank dropdown
  const officialSelect = document.getElementById('new-acct-official-bank');
  officialSelect.value = '';

  // Reset institution search panel
  document.getElementById('institution-search-panel').classList.add('hidden');
  document.getElementById('institution-search-results').innerHTML = '';

  // Load popular institutions on first open
  if (!popularInstitutionsCache) {
    _loadPopularInstitutions();
  } else {
    _populateOfficialBankDropdown(popularInstitutionsCache);
  }

  document.getElementById('create-account-modal').classList.remove('hidden');
}

/**
 * Handle the unified bank dropdown changing.
 * Shows/hides the "new bank" fields based on selection.
 */
function onBankSelectChange() {
  const value = document.getElementById('new-acct-bank-select').value;
  const customFields = document.getElementById('custom-bank-fields');
  const officialFields = document.getElementById('official-institution-fields');

  // Reset everything first
  customFields.classList.add('hidden');
  officialFields.classList.add('hidden');
  selectedExistingBankId = null;
  selectedInstitutionId = null;
  document.getElementById('new-acct-bank').value = '';
  document.getElementById('new-acct-official-bank').value = '';
  document.getElementById('institution-search-panel').classList.add('hidden');
  document.getElementById('institution-search-results').innerHTML = '';

  if (value === '__custom__') {
    customFields.classList.remove('hidden');
    document.getElementById('new-acct-bank').focus();
  } else if (value === '__official__') {
    officialFields.classList.remove('hidden');
  } else if (value) {
    // Existing bank selected
    selectedExistingBankId = value;
  }
}

/**
 * Fetch popular institutions from backend (once) and populate dropdown.
 */
async function _loadPopularInstitutions() {
  try {
    const institutions = await apiFetchPopularInstitutions();
    popularInstitutionsCache = institutions;
    _populateOfficialBankDropdown(institutions);
  } catch (fetchError) {
    console.warn('Could not load popular institutions:', fetchError.message);
  }
}

/**
 * Populate the official bank dropdown with a list of institutions.
 */
function _populateOfficialBankDropdown(institutions) {
  const officialSelect = document.getElementById('new-acct-official-bank');
  // Preserve the placeholder option
  officialSelect.innerHTML = '<option value="">— Choose an institution —</option>';
  for (const inst of institutions) {
    const option = document.createElement('option');
    option.value = inst.institution_id;
    option.textContent = inst.name;
    officialSelect.appendChild(option);
  }
}

/**
 * Called when the official bank dropdown value changes.
 */
function onOfficialBankChange() {
  const officialSelect = document.getElementById('new-acct-official-bank');
  selectedInstitutionId = officialSelect.value || null;
}

/**
 * Show the full institution search panel (when "My bank isn't listed" is clicked).
 */
function showInstitutionSearch(event) {
  event.preventDefault();
  document.getElementById('institution-search-panel').classList.remove('hidden');
  document.getElementById('institution-search-input').focus();
}

/**
 * Search all institutions via backend and display results.
 */
async function searchInstitutions() {
  const searchInput = document.getElementById('institution-search-input');
  const resultsContainer = document.getElementById('institution-search-results');
  const query = searchInput.value.trim();

  if (query.length < 2) {
    resultsContainer.innerHTML = '<div class="institution-search-status">Type at least 2 characters.</div>';
    return;
  }

  resultsContainer.innerHTML = '<div class="institution-search-status">Searching…</div>';

  try {
    const results = await apiSearchInstitutions(query);
    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="institution-search-status">No results found.</div>';
      return;
    }

    resultsContainer.innerHTML = results.map(inst => `
      <div class="institution-search-result"
           data-institution-id="${inst.institution_id}"
           onclick="selectSearchResultInstitution('${inst.institution_id}', '${_escapeAttr(inst.name)}')">
        ${_escapeHtml(inst.name)}
      </div>`
    ).join('');
  } catch (searchError) {
    resultsContainer.innerHTML = `<div class="institution-search-status" style="color:#c62828;">Search failed: ${searchError.message}</div>`;
  }
}

/**
 * Called when a user clicks a search result to select that institution.
 * Updates the dropdown and highlights the selected result.
 */
function selectSearchResultInstitution(institutionId, institutionName) {
  selectedInstitutionId = institutionId;

  // Update the official dropdown — add the institution if not already present
  const officialSelect = document.getElementById('new-acct-official-bank');
  let existingOption = officialSelect.querySelector(`option[value="${institutionId}"]`);
  if (!existingOption) {
    existingOption = document.createElement('option');
    existingOption.value = institutionId;
    existingOption.textContent = institutionName;
    officialSelect.appendChild(existingOption);
  }
  officialSelect.value = institutionId;

  // Highlight selected result
  document.querySelectorAll('.institution-search-result').forEach(el => {
    el.classList.toggle('selected', el.dataset.institutionId === institutionId);
  });
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
  const accountName = document.getElementById('new-acct-name').value.trim();
  const category = document.getElementById('new-acct-category').value;
  const subcategory = document.getElementById('new-acct-subcategory').value;
  const openingBalance = parseFloat(document.getElementById('new-acct-balance').value);
  const balanceDate = document.getElementById('new-acct-balance-date').value;
  const currency = document.getElementById('new-acct-currency').value.trim().toUpperCase();
  const notes = document.getElementById('new-acct-notes').value.trim();
  const errorEl = document.getElementById('create-account-error');
  errorEl.classList.add('hidden');

  const bankSelectValue = document.getElementById('new-acct-bank-select').value;

  // Resolve bank_name / bank_id / institution_id based on selection
  let bankName = '';
  let bankId = null;
  let institutionId = null;

  if (selectedExistingBankId) {
    // Adding to an existing bank — send bank_id directly
    bankId = selectedExistingBankId;
    // Backend still needs bank_name; look it up from cache
    const matchedBank = banksCache.find(b => b.bank_id === bankId);
    bankName = matchedBank ? (matchedBank.bank_name || buildBankDisplayName(matchedBank)) : '';
  } else if (bankSelectValue === '__custom__') {
    // Creating a custom bank
    bankName = document.getElementById('new-acct-bank').value.trim();
    if (!bankName) {
      errorEl.textContent = 'New bank name is required.';
      errorEl.classList.remove('hidden');
      return;
    }
  } else if (bankSelectValue === '__official__') {
    // Using an official institution as the bank
    institutionId = selectedInstitutionId || document.getElementById('new-acct-official-bank').value || null;
    if (!institutionId) {
      errorEl.textContent = 'Please select an institution.';
      errorEl.classList.remove('hidden');
      return;
    }
    // Use the institution name as bank_name
    const officialSelect = document.getElementById('new-acct-official-bank');
    const selectedOption = officialSelect.querySelector(`option[value="${institutionId}"]`);
    bankName = selectedOption ? selectedOption.textContent : '';
  } else {
    errorEl.textContent = 'Please select a bank.';
    errorEl.classList.remove('hidden');
    return;
  }

  // Validation
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
  if (bankId) payload.bank_id = bankId;
  if (institutionId) payload.institution_id = institutionId;
  if (subcategory) payload.account_subcategory = subcategory;
  if (balanceDate) payload.balance_date = balanceDate;
  if (notes) payload.notes = notes;

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
