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

  // Reset form fields
  document.getElementById('new-acct-bank').value = '';
  document.getElementById('new-acct-name').value = '';
  document.getElementById('new-acct-category').value = '';
  document.getElementById('new-acct-balance').value = '0';
  document.getElementById('new-acct-balance-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('new-acct-currency').value = 'USD';
  document.getElementById('new-acct-notes').value = '';
  document.getElementById('create-account-error').classList.add('hidden');

  // Reset bank type toggle to "custom"
  selectedInstitutionId = null;
  onBankTypeToggle('custom');

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
  document.getElementById('new-acct-bank').focus();
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
 * Handle switching between custom and official bank modes.
 */
function onBankTypeToggle(mode) {
  const customField = document.getElementById('custom-bank-field');
  const officialField = document.getElementById('official-bank-field');
  const toggleButtons = document.querySelectorAll('#bank-type-toggle .toggle-btn');

  toggleButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode === 'custom') {
    customField.classList.remove('hidden');
    officialField.classList.add('hidden');
    selectedInstitutionId = null;
  } else {
    customField.classList.add('hidden');
    officialField.classList.remove('hidden');
    // Clear custom bank input so it doesn't interfere with validation
    document.getElementById('new-acct-bank').value = '';
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
  const isOfficialMode = document.getElementById('official-bank-field').classList.contains('hidden') === false;
  const accountName = document.getElementById('new-acct-name').value.trim();
  const category = document.getElementById('new-acct-category').value;
  const subcategory = document.getElementById('new-acct-subcategory').value;
  const openingBalance = parseFloat(document.getElementById('new-acct-balance').value);
  const balanceDate = document.getElementById('new-acct-balance-date').value;
  const currency = document.getElementById('new-acct-currency').value.trim().toUpperCase();
  const notes = document.getElementById('new-acct-notes').value.trim();
  const errorEl = document.getElementById('create-account-error');
  errorEl.classList.add('hidden');

  // Resolve bank name and institution_id based on mode
  let bankName = '';
  let institutionId = null;

  if (isOfficialMode) {
    const officialSelect = document.getElementById('new-acct-official-bank');
    institutionId = selectedInstitutionId || officialSelect.value || null;
    if (!institutionId) {
      errorEl.textContent = 'Please select an institution.';
      errorEl.classList.remove('hidden');
      return;
    }
    // Use the institution name as the bank_name
    const selectedOption = officialSelect.querySelector(`option[value="${institutionId}"]`);
    bankName = selectedOption ? selectedOption.textContent : '';
  } else {
    bankName = document.getElementById('new-acct-bank').value.trim();
  }

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
  if (institutionId) payload.institution_id = institutionId;
  if (subcategory) payload.account_subcategory = subcategory;
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
