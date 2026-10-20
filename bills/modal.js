// ============================================================
// bills/modal.js — Shared Bill Create / Edit Modal
//
// Extracted from bills.js so both bills.html and transactions.html
// can open the full bill modal without page navigation.
//
// Dependencies (globals, must be loaded before this file):
//   BACKEND_URL             — config.js
//   authenticatedFetch      — config-helpers.js or page auth
//   escapeHtml              — page utility (bills.js or transactions/utils.js)
//   formatCurrency          — page utility (bills.js or transactions/utils.js)
//   formatDate              — date-helpers.js
//   todayISO                — date-helpers.js
//   toISODateStr            — date-helpers.js
//   autoFormatDateInput     — date-helpers.js
//   autoFormatMonthYearInput— date-helpers.js
//   getDateInputValue       — date-helpers.js
//   setDateInputValue       — date-helpers.js
//   getMonthYearInputValue  — date-helpers.js
//   parseDateInput          — date-helpers.js
//   apiCreateBill           — bills/api.js
//   apiUpdateBill           — bills/api.js
//   fetchCategoriesWithCache — shared/categories-autocomplete.js
//   wireUpCategoryAutocomplete — shared/categories-autocomplete.js
//   highlightCategoryMatch  — shared/categories-autocomplete.js
//   showStatus              — page utility
//   clearStatus             — page utility
//
// Exports (globals):
//   openBillModal(billIdOrNull, options)
//   closeBillModal()
// ============================================================

// ── Module State ─────────────────────────────────────────────
let _billModalEditingId = null;
let _billModalAccounts = [];
let _billModalCategories = [];
let _billModalOnSave = null;
let _billModalEditData = null;
let _billModalSplitRowSeq = 0;

const _BILL_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _BILL_DAY_ABBREV = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Polyfill for pages that don't define formatCurrency (e.g. transactions.html)
if (typeof formatCurrency === 'undefined') {
  window.formatCurrency = function(amount) {
    const num = Number(amount);
    if (isNaN(num)) return '$0.00';
    return '$' + Math.abs(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
}

// ── Modal HTML (injected once on first open) ─────────────────

function _billModalEnsureDOM() {
  if (document.getElementById('bill-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'bill-modal-overlay';
  overlay.className = 'modal-overlay hidden';
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeBillModal();
  });

  overlay.innerHTML = `
    <div class="modal bill-modal">
      <div class="modal-header">
        <h3 id="bill-modal-title">New Bill</h3>
        <button class="modal-close" id="bill-modal-close-btn">&times;</button>
      </div>
      <div class="modal-body">
        <div id="bill-error-banner" class="bill-error-banner" style="display: none;"></div>

        <div class="bill-form-top">
          <!-- LEFT COLUMN: Frequency Settings -->
          <div class="bill-freq-col">
            <h4>Frequency Settings</h4>

            <div class="bill-field">
              <label for="bill-frequency">Frequency</label>
              <select id="bill-frequency">
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly" selected>Monthly</option>
                <option value="twice_monthly">Twice a Month</option>
                <option value="yearly">Yearly</option>
                <option value="twice_yearly">Twice a Year</option>
              </select>
            </div>

            <div id="freq-options"></div>

            <div id="end-condition-section" class="bill-field">
              <label for="bill-end-type">Ends</label>
              <select id="bill-end-type">
                <option value="never">Never</option>
                <option value="on_date">On Date</option>
                <option value="after_occurrences">After X Occurrences</option>
              </select>
              <div id="end-date-input" style="display: none; margin-top: 8px;">
                <input type="text" id="bill-end-date" class="date-input">
              </div>
              <div id="end-occurrences-input" style="display: none; margin-top: 8px;">
                <input type="number" id="bill-max-occurrences" min="1" max="999" value="12" style="width: 80px;">
                <span style="color: #666; font-size: 13px; margin-left: 4px;">occurrences</span>
              </div>
            </div>
          </div>

          <!-- RIGHT COLUMN: Payment Details -->
          <div class="bill-details-col">
            <h4>Payment Details</h4>

            <div class="bill-field">
              <label for="bill-account">Account *</label>
              <select id="bill-account">
                <option value="">— Select Account —</option>
              </select>
            </div>

            <div class="bill-field">
              <label for="bill-description">Description *</label>
              <input type="text" id="bill-description" placeholder="e.g., Rent, Netflix, Paycheck" maxlength="500">
            </div>

            <div class="bill-field" style="display: grid; grid-template-columns: 1fr auto; gap: 8px;">
              <div>
                <label for="bill-amount">Default Amount *</label>
                <input type="text" id="bill-amount" inputmode="decimal" placeholder="0.00">
              </div>
              <div>
                <label for="bill-type">Type</label>
                <select id="bill-type" style="min-width: 100px;">
                  <option value="debit" selected>Debit (&minus;)</option>
                  <option value="credit">Credit (+)</option>
                </select>
              </div>
            </div>

            <div class="bill-field">
              <label>
                <input type="checkbox" id="bill-auto-pay" style="margin-right: 6px;">
                Auto-pay (payment is automated)
              </label>
              <small style="color: #888; display: block; margin-top: 2px;">
                Auto-pay bills are marked as paid automatically &mdash; no manual action needed
              </small>
            </div>

            <div class="bill-field">
              <label>
                <input type="checkbox" id="bill-is-important" style="margin-right: 6px;">
                Mark as important
              </label>
              <small style="color: #888; display: block; margin-top: 2px;">
                Unpaid occurrences of important bills get an orange pulsing UNPAID / AUTO-PAY badge in the transactions list. The pulse clears once the bill is marked paid.
              </small>
            </div>

            <div class="bill-field">
              <label for="bill-category">Category</label>
              <div style="position: relative;">
                <input type="text" id="bill-category" placeholder="Type to search, or [ for transfers" autocomplete="off">
                <div id="bill-category-ac-list" class="bill-category-ac-list"></div>
              </div>
              <small style="color: #666;">Type <kbd>[</kbd> to mark as transfer to another account</small>
              <small id="bill-category-splits-note" style="display:none; color: var(--text-secondary, #888); font-style: italic;">
                Category is set by the auto-split allocations below.
              </small>
            </div>

            <div class="bill-field">
              <label for="bill-memo">Memo</label>
              <input type="text" id="bill-memo" placeholder="Optional note" maxlength="256">
            </div>
          </div>
        </div>

        <!-- Matching criteria (collapsible) -->
        <div class="bill-criteria-section">
          <div class="bill-criteria-header" id="bill-criteria-toggle" role="button" tabindex="0">
            <span class="bill-criteria-caret" id="bill-criteria-caret">▶</span>
            <h4>Matching criteria</h4>
            <span class="bill-criteria-badge" id="bill-criteria-badge" style="display:none;"></span>
            <span class="bill-criteria-hint">click to expand</span>
          </div>
          <div class="bill-criteria-body" id="bill-criteria-body" style="display:none;">
            <div class="bill-criteria-intro">
              All criteria you set must pass for a downloaded transaction to auto-match this bill (strict AND).
              Leave a field blank to disable that criterion.
            </div>

            <div class="bill-field">
              <label class="bill-criteria-label">Amount match mode</label>
              <div class="bill-criteria-radio-row">
                <label><input type="radio" name="bill-match-amount-mode" value="exact" checked> Exact</label>
                <label><input type="radio" name="bill-match-amount-mode" value="range"> Range</label>
              </div>
              <small>Exact requires the Plaid amount to equal the bill amount. Range allows a min–max band (useful for paychecks, utilities).</small>
            </div>

            <div class="bill-field bill-range-bounds" id="bill-range-bounds" style="display:none;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div>
                  <label for="bill-match-amount-min">Min</label>
                  <input type="text" id="bill-match-amount-min" inputmode="decimal" placeholder="0.00">
                </div>
                <div>
                  <label for="bill-match-amount-max">Max</label>
                  <input type="text" id="bill-match-amount-max" inputmode="decimal" placeholder="0.00">
                </div>
              </div>
              <small>Plaid amount magnitude must fall within this band. Sign is enforced separately.</small>
              <div id="bill-range-splits-warning" class="bill-range-splits-warning" style="display:none;">
                Range-mode matching disables auto-splits. Remove the split allocations below, or switch back to Exact mode.
              </div>
            </div>

            <div class="bill-field">
              <label for="bill-match-date-tolerance">Date tolerance (days)</label>
              <div class="bill-criteria-inline-row">
                <input type="number" id="bill-match-date-tolerance" min="0" max="14" value="2" style="width:90px;">
                <label style="margin-left:10px;">
                  <input type="checkbox" id="bill-match-date-disable"> Disable date check
                </label>
              </div>
              <small>Plaid date must fall within ± this many days of the scheduled occurrence. Maximum 14 — the matching engine only considers Plaid transactions within a 14-day window. Disable if the bill posts on wildly varying dates.</small>
            </div>

            <div class="bill-field">
              <label for="bill-match-account-scope">Account scope</label>
              <select id="bill-match-account-scope">
                <option value="bill_account" selected>This bill's account</option>
                <option value="any">Any of my accounts</option>
              </select>
              <small>Restrict matching to this bill's account, or allow matching against transactions on any linked account.</small>
            </div>

            <div class="bill-field">
              <label>
                <input type="checkbox" id="bill-match-sign-enforced" checked>
                Enforce sign
              </label>
              <small>Plaid amount sign must match the bill amount sign (debit bill → negative Plaid amount; credit bill → positive).</small>
            </div>

            <div class="bill-field">
              <label for="bill-match-plaid-name-patterns">Plaid name patterns</label>
              <input type="text" id="bill-match-plaid-name-patterns" placeholder="e.g., NETFLIX.COM, NETFLIX 866-716-0414">
              <small>Comma-separated, case-insensitive substrings tested against Plaid's transaction <code>name</code>. Any match passes. Leave blank to disable.</small>
            </div>

            <div class="bill-field">
              <label for="bill-match-merchant-name-patterns">Merchant name patterns</label>
              <input type="text" id="bill-match-merchant-name-patterns" placeholder="e.g., Netflix, Spotify">
              <small>Same as above but tested against Plaid's <code>merchant_name</code>. Any match passes.</small>
            </div>

            <div class="bill-field">
              <label for="bill-match-pfc-categories">PFC detailed categories</label>
              <input type="text" id="bill-match-pfc-categories" placeholder="e.g., INCOME_WAGES, RENT_AND_UTILITIES_GAS_AND_ELECTRICITY">
              <small>
                Comma-separated Plaid <code>personal_finance_category.detailed</code> codes in <strong>ALL_CAPS_SNAKE_CASE</strong>.
                The most reliable workflow: inspect the raw Plaid data for past instances of this bill and copy/paste the <code>detailed</code> value here as-is.
                Any code in this list will pass.
              </small>
            </div>

            <div class="bill-field">
              <label for="bill-match-day-of-month">Day-of-month allowlist</label>
              <input type="text" id="bill-match-day-of-month" placeholder="e.g., 1, 15">
              <small>Comma-separated days (1–31). The Plaid date must fall on one of these days. Useful for bills that post 1st-or-15th but never anywhere else. Leave blank to disable.</small>
            </div>
          </div>
        </div>

        <!-- Bottom: Preview -->
        <div class="bill-preview-section">
          <h4>Schedule Preview</h4>
          <div id="bill-preview-summary" class="bill-preview-summary">
            Select a frequency and fill in the details above to see a preview.
          </div>
          <div id="bill-preview-dates" class="bill-preview-dates"></div>
        </div>

        <!-- Splits template (optional auto-split on maturation) -->
        <div class="bill-splits-section">
          <h4>Auto-split allocations <small style="color:#888;font-weight:normal;">(optional)</small></h4>
          <div class="bill-splits-help">
            Break this bill into category-specific allocations that are applied
            automatically when the bill matures (e.g. a $0 paycheck split into
            +$400 income and &minus;$400 child-care). Split totals must equal
            the bill amount. Leave empty for a standard single-category bill.
          </div>
          <div id="bill-split-rows" class="split-rows"></div>
          <div class="bill-split-actions">
            <button type="button" id="bill-split-add-btn" class="secondary">+ Add allocation</button>
            <div class="bill-split-summary">
              <span>Sum: <span id="bill-split-sum">$0.00</span></span>
              <span>Remaining: <span id="bill-split-remaining" class="balanced">$0.00</span></span>
            </div>
          </div>
          <div id="bill-split-validation-error" class="split-rows-validation hidden"></div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="secondary" id="bill-modal-cancel-btn">Cancel</button>
        <button id="bill-submit-btn">Create Bill</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Wire static event listeners once
  document.getElementById('bill-modal-close-btn').addEventListener('click', closeBillModal);
  document.getElementById('bill-modal-cancel-btn').addEventListener('click', closeBillModal);
  document.getElementById('bill-submit-btn').addEventListener('click', _billModalSave);
  document.getElementById('bill-frequency').addEventListener('change', _billModalOnFrequencyChange);
  document.getElementById('bill-end-type').addEventListener('change', _billModalOnEndTypeChange);

  // Amount type sync — wired once here (not on every open)
  const amountInput = document.getElementById('bill-amount');
  const typeSelect = document.getElementById('bill-type');
  amountInput.addEventListener('input', () => _billModalSyncAmountPrefix(amountInput, typeSelect));
  typeSelect.addEventListener('change', () => _billModalSyncTypeDropdown(amountInput, typeSelect));
  amountInput.addEventListener('blur', () => _billModalDecorateAmountOnBlur(amountInput, typeSelect));
  amountInput.addEventListener('focus', () => _billModalStripDecorationOnFocus(amountInput));

  // Splits UI: add-allocation button + recompute on amount/type change
  document.getElementById('bill-split-add-btn').addEventListener('click', () => {
    _billModalAddSplitRow();
    _billModalUpdateSplitsValidation();
  });
  amountInput.addEventListener('input', _billModalUpdateSplitsValidation);
  typeSelect.addEventListener('change', _billModalUpdateSplitsValidation);

  // Matching criteria: collapsible toggle, range/exact swap, date-disable wiring.
  const criteriaToggle = document.getElementById('bill-criteria-toggle');
  criteriaToggle.addEventListener('click', _billModalToggleCriteria);
  criteriaToggle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      _billModalToggleCriteria();
    }
  });
  document.querySelectorAll('input[name="bill-match-amount-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      _billModalOnAmountModeChange();
      _billModalUpdateCriteriaBadge();
      _billModalUpdateSplitsValidation();
    });
  });
  document.getElementById('bill-match-date-disable').addEventListener('change', (event) => {
    document.getElementById('bill-match-date-tolerance').disabled = event.target.checked;
    _billModalUpdateCriteriaBadge();
  });
  // Live badge update on any criteria input edit.
  document.querySelectorAll(
    '#bill-criteria-body input, #bill-criteria-body select'
  ).forEach(field => {
    field.addEventListener('input', _billModalUpdateCriteriaBadge);
    field.addEventListener('change', _billModalUpdateCriteriaBadge);
  });
}

// ── Public API ───────────────────────────────────────────────

/**
 * Open the bill create/edit modal.
 *
 * @param {string|null}  billId   null = create mode, string = edit mode.
 * @param {object}       options
 *   accounts   {Array}    Account objects with account_id + display_name.
 *   bill       {object}   Full bill object for edit mode (skips re-fetch).
 *   prefill    {object}   Pre-fill data for create mode (from transaction).
 *   categories {Array}    Category strings. Fetched automatically if omitted.
 *   onSave     {function(result)} Called after successful create/update with
 *              the API response (includes purged_virtual_ids, affected_virtual_transactions).
 */
async function openBillModal(billId, options = {}) {
  _billModalEnsureDOM();

  _billModalEditingId = billId || null;
  _billModalAccounts = options.accounts || [];
  _billModalOnSave = options.onSave || null;
  _billModalEditData = null;

  // Fetch categories if not provided
  if (options.categories && options.categories.length > 0) {
    _billModalCategories = options.categories;
  } else {
    _billModalCategories = await fetchCategoriesWithCache();
  }

  const titleEl = document.getElementById('bill-modal-title');
  const submitBtn = document.getElementById('bill-submit-btn');

  if (_billModalEditingId) {
    titleEl.textContent = 'Edit Bill';
    submitBtn.textContent = 'Save Changes';
  } else {
    titleEl.textContent = 'New Bill';
    submitBtn.textContent = 'Create Bill';
  }

  // Reset error banner
  document.getElementById('bill-error-banner').style.display = 'none';

  // Populate account dropdown
  _billModalPopulateAccountDropdown();

  if (_billModalEditingId && options.bill) {
    _billModalPopulateFromBill(options.bill);
  } else {
    _billModalResetForm();
  }

  // Show modal
  document.getElementById('bill-modal-overlay').classList.remove('hidden');

  // Wire category autocomplete
  _billModalWireCategoryAutocomplete();

  // Render frequency options
  _billModalOnFrequencyChange();

  // Segmented end-date input
  setTimeout(() => {
    const endDateInput = document.getElementById('bill-end-date');
    if (endDateInput) autoFormatDateInput(endDateInput);
  }, 90);

  // Apply prefill data after modal rendering settles
  if (!_billModalEditingId && options.prefill) {
    setTimeout(() => _billModalApplyPrefill(options.prefill), 100);
  }
}

function closeBillModal() {
  const overlay = document.getElementById('bill-modal-overlay');
  if (overlay) overlay.classList.add('hidden');
  _billModalEditingId = null;
  _billModalOnSave = null;
  _billModalEditData = null;
}

// ── Prefill (create from transaction) ────────────────────────

function _billModalApplyPrefill(prefill) {
  if (prefill.description) {
    document.getElementById('bill-description').value = prefill.description;
  }
  if (prefill.amount) {
    document.getElementById('bill-amount').value = Math.abs(prefill.amount).toFixed(2);
  }
  if (prefill.type) {
    document.getElementById('bill-type').value = prefill.type;
  }
  if (prefill.account_id) {
    document.getElementById('bill-account').value = prefill.account_id;
  }
  if (prefill.user_category) {
    document.getElementById('bill-category').value = prefill.user_category;
  }

  // Seed pattern lists from the originating Plaid transaction so the user
  // sees a reasonable starting matcher instead of an empty form.
  const plaidNameSeed = prefill.plaid_name || prefill.match_description;
  if (plaidNameSeed) {
    document.getElementById('bill-match-plaid-name-patterns').value = plaidNameSeed;
  }
  if (prefill.merchant_name) {
    document.getElementById('bill-match-merchant-name-patterns').value = prefill.merchant_name;
  }
  if (prefill.pfc_detailed) {
    document.getElementById('bill-match-pfc-categories').value = prefill.pfc_detailed;
  }

  _billModalUpdateCriteriaBadge();
  _billModalUpdatePreview();
}

// ── Account Dropdown ─────────────────────────────────────────

function _billModalPopulateAccountDropdown() {
  const select = document.getElementById('bill-account');
  let optionsHtml = '<option value="">— Select Account —</option>';
  _billModalAccounts.forEach(account => {
    optionsHtml += `<option value="${escapeHtml(account.account_id)}">${escapeHtml(account.display_name)}</option>`;
  });
  select.innerHTML = optionsHtml;
}

// ── Form Reset / Populate ────────────────────────────────────

function _billModalResetForm() {
  document.getElementById('bill-frequency').value = 'monthly';
  document.getElementById('bill-end-type').value = 'never';
  document.getElementById('bill-account').value = '';
  document.getElementById('bill-description').value = '';
  document.getElementById('bill-amount').value = '';
  document.getElementById('bill-type').value = 'debit';
  document.getElementById('bill-auto-pay').checked = false;
  document.getElementById('bill-is-important').checked = false;
  document.getElementById('bill-category').value = '';
  document.getElementById('bill-memo').value = '';
  document.getElementById('bill-end-date').value = '';
  document.getElementById('bill-end-date').dataset.isoValue = '';
  document.getElementById('bill-max-occurrences').value = '12';
  _billModalSetSplitRows([]);
  _billModalResetCriteriaForm();
  _billModalSetCriteriaExpanded(true); // expanded by default for new bills
  _billModalOnEndTypeChange();
}

function _billModalResetCriteriaForm() {
  document.querySelector('input[name="bill-match-amount-mode"][value="exact"]').checked = true;
  document.getElementById('bill-match-amount-min').value = '';
  document.getElementById('bill-match-amount-max').value = '';
  document.getElementById('bill-match-date-tolerance').value = '2';
  document.getElementById('bill-match-date-tolerance').disabled = false;
  document.getElementById('bill-match-date-disable').checked = false;
  document.getElementById('bill-match-account-scope').value = 'bill_account';
  document.getElementById('bill-match-sign-enforced').checked = true;
  document.getElementById('bill-match-plaid-name-patterns').value = '';
  document.getElementById('bill-match-merchant-name-patterns').value = '';
  document.getElementById('bill-match-pfc-categories').value = '';
  document.getElementById('bill-match-day-of-month').value = '';
  _billModalOnAmountModeChange();
  _billModalUpdateCriteriaBadge();
}

function _billModalPopulateFromBill(bill) {
  document.getElementById('bill-frequency').value = bill.frequency;
  document.getElementById('bill-account').value = bill.account_id;
  document.getElementById('bill-description').value = bill.description || '';
  const isCredit = bill.amount >= 0;
  document.getElementById('bill-type').value = isCredit ? 'credit' : 'debit';
  document.getElementById('bill-amount').value = Math.abs(bill.amount).toFixed(2);
  document.getElementById('bill-auto-pay').checked = !!bill.auto_pay;
  document.getElementById('bill-is-important').checked = !!bill.is_important;
  document.getElementById('bill-category').value = bill.user_category || '';
  document.getElementById('bill-memo').value = bill.memo || '';
  document.getElementById('bill-end-type').value = bill.end_type || 'never';
  _billModalOnEndTypeChange();
  if (bill.end_type === 'on_date' && bill.end_date) {
    setDateInputValue('bill-end-date', bill.end_date);
  }
  if (bill.end_type === 'after_occurrences' && bill.max_occurrences) {
    document.getElementById('bill-max-occurrences').value = bill.max_occurrences;
  }

  _billModalSetSplitRows(Array.isArray(bill.splits_template) ? bill.splits_template : []);
  _billModalPopulateCriteriaFromBill(bill);

  // Stash for frequency-specific field population inside onFrequencyChange
  _billModalEditData = bill;
}

function _billModalPopulateCriteriaFromBill(bill) {
  const mode = bill.match_amount_mode === 'range' ? 'range' : 'exact';
  document.querySelector(`input[name="bill-match-amount-mode"][value="${mode}"]`).checked = true;
  document.getElementById('bill-match-amount-min').value =
    (bill.match_amount_min !== null && bill.match_amount_min !== undefined) ? Number(bill.match_amount_min).toFixed(2) : '';
  document.getElementById('bill-match-amount-max').value =
    (bill.match_amount_max !== null && bill.match_amount_max !== undefined) ? Number(bill.match_amount_max).toFixed(2) : '';

  const toleranceNull = bill.match_date_tolerance_days === null || bill.match_date_tolerance_days === undefined;
  document.getElementById('bill-match-date-disable').checked = toleranceNull;
  const toleranceInput = document.getElementById('bill-match-date-tolerance');
  toleranceInput.value = toleranceNull ? '' : String(bill.match_date_tolerance_days);
  toleranceInput.disabled = toleranceNull;

  document.getElementById('bill-match-account-scope').value = bill.match_account_scope || 'bill_account';
  document.getElementById('bill-match-sign-enforced').checked = bill.match_sign_enforced !== false;

  document.getElementById('bill-match-plaid-name-patterns').value =
    Array.isArray(bill.match_plaid_name_patterns) ? bill.match_plaid_name_patterns.join(', ') : '';
  document.getElementById('bill-match-merchant-name-patterns').value =
    Array.isArray(bill.match_merchant_name_patterns) ? bill.match_merchant_name_patterns.join(', ') : '';
  document.getElementById('bill-match-pfc-categories').value =
    Array.isArray(bill.match_pfc_detailed_categories) ? bill.match_pfc_detailed_categories.join(', ') : '';
  document.getElementById('bill-match-day-of-month').value =
    Array.isArray(bill.match_day_of_month_set) ? bill.match_day_of_month_set.join(', ') : '';

  _billModalOnAmountModeChange();
  const badgeCount = _billModalUpdateCriteriaBadge();
  _billModalSetCriteriaExpanded(badgeCount > 0);
}

// ── Frequency Rendering ──────────────────────────────────────

function _billModalOnFrequencyChange() {
  const frequency = document.getElementById('bill-frequency').value;
  const container = document.getElementById('freq-options');
  const endSection = document.getElementById('end-condition-section');

  endSection.style.display = frequency === 'once' ? 'none' : '';

  const editData = _billModalEditData;
  const today = todayISO();
  let html = '';

  switch (frequency) {
    case 'once':      html = _bmRenderOnce(editData, today); break;
    case 'daily':     html = _bmRenderDaily(editData, today); break;
    case 'weekly':    html = _bmRenderWeekly(editData, today); break;
    case 'monthly':   html = _bmRenderMonthly(editData, today); break;
    case 'twice_monthly': html = _bmRenderTwiceMonthly(editData, today); break;
    case 'yearly':    html = _bmRenderYearly(editData, today); break;
    case 'twice_yearly': html = _bmRenderTwiceYearly(editData, today); break;
  }

  container.innerHTML = html;

  if (editData && editData.frequency === frequency) {
    _bmApplyFreqFieldsFromEdit(frequency, editData);
  }


  // Wire segmented date inputs on freshly rendered fields
  container.querySelectorAll('input.date-input').forEach(autoFormatDateInput);
  container.querySelectorAll('input.month-year-input').forEach(autoFormatMonthYearInput);

  _billModalUpdatePreview();
}

function _bmOrdinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}

function _bmTodayStr() { return todayISO(); }

function _bmSixMonthsFromNow() {
  const date = new Date();
  date.setMonth(date.getMonth() + 6);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _bmRenderOnce(editData, today) {
  const startDate = editData?.start_date || today;
  return `
    <div class="bill-field">
      <label for="bill-start-date">Payment Date</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}">
    </div>`;
}

function _bmRenderDaily(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  return `
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}">
      <span>day(s)</span>
    </div>
    <div class="bill-field">
      <label for="bill-start-date">Starting</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}">
    </div>`;
}

function _bmRenderWeekly(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  const startDow = editData?.day_of_week ?? _bmDowFromDateStr(startDate);

  let dowButtons = '';
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const active = dayIndex === startDow ? 'active' : '';
    dowButtons += `<button type="button" class="dow-btn ${active}" data-dow="${dayIndex}">${_BILL_DAY_ABBREV[dayIndex]}</button>`;
  }

  return `
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}">
      <span>week(s)</span>
    </div>
    <div class="bill-field">
      <label for="bill-start-date">Starting</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}">
    </div>
    <div class="bill-field">
      <label>Day of Week</label>
      <div class="dow-buttons" id="dow-buttons">${dowButtons}</div>
    </div>`;
}

function _bmRenderMonthly(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  const dayOfMonth = editData?.day_of_month ?? parseInt(today.split('-')[2], 10);
  const dayOfWeek = editData?.day_of_week;
  const isLastWeekdaySelection = dayOfMonth === -2 || (dayOfMonth === -1 && dayOfWeek != null);
  const isLastDaySelection = dayOfMonth === -1 && !isLastWeekdaySelection;

  let dayOptions = '';
  for (let dayNum = 1; dayNum <= 30; dayNum++) {
    const selected = dayNum === dayOfMonth ? 'selected' : '';
    dayOptions += `<option value="${dayNum}" ${selected}>${_bmOrdinal(dayNum)}</option>`;
  }
  const lastDaySelected = isLastDaySelection ? 'selected' : '';
  dayOptions += `<option value="-1" ${lastDaySelected}>Last day</option>`;
  const lastWeekdaySelected = isLastWeekdaySelection ? 'selected' : '';
  dayOptions += `<option value="-2" ${lastWeekdaySelected}>Last weekday…</option>`;

  let dowSelect = '<select id="bill-day-of-week" style="display:none;width:auto;">';
  for (let dowIndex = 0; dowIndex < 7; dowIndex++) {
    const sel = dowIndex === dayOfWeek ? 'selected' : '';
    dowSelect += `<option value="${dowIndex}" ${sel}>${_BILL_DAY_NAMES[dowIndex]}</option>`;
  }
  dowSelect += '</select>';

  return `
    <div class="bill-field">
      <label for="bill-start-date">Starting Month</label>
      <input type="text" id="bill-start-date" class="month-year-input" value="${startDate}">
    </div>
    <div class="freq-inline-row">
      <span>On the</span>
      <select id="bill-day-of-month" style="width:auto;">
        ${dayOptions}
      </select>
      ${dowSelect}
      <span>of the month</span>
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}">
      <span>month(s)</span>
    </div>`;
}

function _bmRenderTwiceMonthly(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  const dayOfMonth = editData?.day_of_month ?? 1;
  const secondDayOfMonth = editData?.second_day_of_month ?? 15;

  let dayOptions1 = '';
  let dayOptions2 = '';
  for (let dayNum = 1; dayNum <= 30; dayNum++) {
    dayOptions1 += `<option value="${dayNum}" ${dayNum === dayOfMonth ? 'selected' : ''}>${_bmOrdinal(dayNum)}</option>`;
    dayOptions2 += `<option value="${dayNum}" ${dayNum === secondDayOfMonth ? 'selected' : ''}>${_bmOrdinal(dayNum)}</option>`;
  }
  dayOptions1 += `<option value="-1" ${dayOfMonth === -1 ? 'selected' : ''}>Last day</option>`;
  dayOptions2 += `<option value="-1" ${secondDayOfMonth === -1 ? 'selected' : ''}>Last day</option>`;

  return `
    <div class="freq-inline-row">
      <span>On the</span>
      <select id="bill-day-of-month" style="width:auto;">${dayOptions1}</select>
      <span>and</span>
      <select id="bill-second-day-of-month" style="width:auto;">${dayOptions2}</select>
    </div>
    <div class="bill-field">
      <label for="bill-start-date">Starting Month</label>
      <input type="text" id="bill-start-date" class="month-year-input" value="${startDate}">
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}">
      <span>month(s)</span>
    </div>`;
}

function _bmRenderYearly(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  return `
    <div class="bill-field">
      <label for="bill-start-date">Payment Date</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}">
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}">
      <span>year(s)</span>
    </div>`;
}

function _bmRenderTwiceYearly(editData, today) {
  const interval = editData?.interval || 1;
  const startDate = editData?.start_date || today;
  const secondDate = editData?.second_date || _bmSixMonthsFromNow();
  return `
    <div class="bill-field">
      <label for="bill-start-date">First Payment Date</label>
      <input type="text" id="bill-start-date" class="date-input" value="${startDate}">
    </div>
    <div class="bill-field">
      <label for="bill-second-date">Second Payment Date</label>
      <input type="text" id="bill-second-date" class="date-input" value="${secondDate}">
    </div>
    <div class="freq-inline-row">
      <span>Every</span>
      <input type="number" id="bill-interval" min="1" max="99" value="${interval}">
      <span>year(s)</span>
    </div>`;
}

function _bmApplyFreqFieldsFromEdit(frequency, editData) {
  const startDateInput = document.getElementById('bill-start-date');
  if (startDateInput && editData.start_date) startDateInput.value = editData.start_date;

  const intervalInput = document.getElementById('bill-interval');
  if (intervalInput && editData.interval) intervalInput.value = editData.interval;

  if (frequency === 'weekly' && editData.day_of_week != null) {
    _bmSelectDayOfWeek(editData.day_of_week);
  }
  if (frequency === 'monthly' && editData.day_of_month != null) {
    const domSelect = document.getElementById('bill-day-of-month');
    if (domSelect) {
      const monthlyValue = editData.day_of_month === -1 && editData.day_of_week != null ? '-2' : String(editData.day_of_month);
      domSelect.value = monthlyValue;
    }
    _bmOnDayOfMonthChange();
  }
  if (frequency === 'twice_monthly') {
    const dom1 = document.getElementById('bill-day-of-month');
    const dom2 = document.getElementById('bill-second-day-of-month');
    if (dom1 && editData.day_of_month != null) dom1.value = editData.day_of_month;
    if (dom2 && editData.second_day_of_month != null) dom2.value = editData.second_day_of_month;
  }
  if (frequency === 'twice_yearly') {
    const secondDateInput = document.getElementById('bill-second-date');
    if (secondDateInput && editData.second_date) secondDateInput.value = editData.second_date;
  }
}

// ── Frequency Interaction Handlers ───────────────────────────

function _bmSelectDayOfWeek(dayIndex) {
  document.querySelectorAll('#bill-modal-overlay .dow-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`#bill-modal-overlay .dow-btn[data-dow="${dayIndex}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  const startDateInput = document.getElementById('bill-start-date');
  if (startDateInput) {
    const currentValue = getDateInputValue(startDateInput);
    if (currentValue) {
      const currentDate = new Date(currentValue + 'T00:00:00');
      const currentDow = (currentDate.getDay() + 6) % 7;
      let diff = dayIndex - currentDow;
      if (diff > 3) diff -= 7;
      if (diff < -3) diff += 7;
      currentDate.setDate(currentDate.getDate() + diff);
      setDateInputValue(startDateInput, toISODateStr(currentDate));
    }
  }

  _billModalUpdatePreview();
}

function _bmOnWeeklyStartDateChange() {
  const startDateInput = document.getElementById('bill-start-date');
  if (!startDateInput) return;
  const dateValue = getDateInputValue(startDateInput);
  if (!dateValue) return;
  const dow = _bmDowFromDateStr(dateValue);
  document.querySelectorAll('#bill-modal-overlay .dow-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`#bill-modal-overlay .dow-btn[data-dow="${dow}"]`);
  if (activeBtn) activeBtn.classList.add('active');
}

function _bmOnDayOfMonthChange() {
  const domSelect = document.getElementById('bill-day-of-month');
  const dowSelect = document.getElementById('bill-day-of-week');
  if (!domSelect || !dowSelect) return;
  dowSelect.style.display = domSelect.value === '-2' ? 'inline-block' : 'none';
}

function _billModalOnEndTypeChange() {
  const endType = document.getElementById('bill-end-type').value;
  document.getElementById('end-date-input').style.display = endType === 'on_date' ? '' : 'none';
  document.getElementById('end-occurrences-input').style.display = endType === 'after_occurrences' ? '' : 'none';
}

function _bmDowFromDateStr(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return (date.getDay() + 6) % 7;
}

// ── Live Preview ─────────────────────────────────────────────
// Preview updates are driven by delegated change/input listeners in
// _billModalWireEventDelegation() and direct calls from _billModalOnFrequencyChange.

function _billModalUpdatePreview() {
  const summaryEl = document.getElementById('bill-preview-summary');
  const datesEl = document.getElementById('bill-preview-dates');
  if (!summaryEl || !datesEl) return;

  const formData = _billModalReadFormData();
  if (!formData) {
    summaryEl.textContent = 'Select a frequency and fill in the details above to see a preview.';
    datesEl.innerHTML = '';
    return;
  }

  summaryEl.innerHTML = _bmGenerateDescription(formData);

  const dates = _bmGeneratePreviewDates(formData, 10);
  if (dates.length === 0) {
    datesEl.innerHTML = '<div style="color: #999; font-size: 12px;">No upcoming dates to display.</div>';
    return;
  }

  const amountStr = formData.amount ? formatCurrency(formData.amount) : '—';
  const amountPrefix = formData.isCredit ? '+' : '−';

  datesEl.innerHTML = dates.map((dateStr, idx) => {
    const displayDate = formatDate(dateStr);
    return `<div class="preview-date-item">
      <span class="date-label">#${idx + 1} — ${displayDate}</span>
      <span class="date-amount">${amountPrefix}${amountStr}</span>
    </div>`;
  }).join('');
}

function _bmGenerateDescription(formData) {
  const desc = formData.description || '<em>Untitled</em>';
  const amountStr = formData.amount ? formatCurrency(formData.amount) : '$0.00';
  const direction = formData.isCredit ? 'receive' : 'pay';
  const variable = formData.match_amount_mode === 'range' ? ' <span style="color:#e67e22;">(amount approximate — range match)</span>' : '';
  let freqDesc = '';

  switch (formData.frequency) {
    case 'once':
      freqDesc = `One-time payment on ${formatDate(formData.start_date)}`;
      break;
    case 'daily':
      freqDesc = formData.interval === 1
        ? `Every day starting ${formatDate(formData.start_date)}`
        : `Every ${formData.interval} days starting ${formatDate(formData.start_date)}`;
      break;
    case 'weekly': {
      const dayName = _BILL_DAY_NAMES[formData.day_of_week ?? 0];
      freqDesc = formData.interval === 1
        ? `Every ${dayName} starting ${formatDate(formData.start_date)}`
        : `Every ${formData.interval} weeks on ${dayName} starting ${formatDate(formData.start_date)}`;
      break;
    }
    case 'monthly': {
      const dayLabel = formData.day_of_month === -1 && formData.day_of_week != null
        ? `last ${_BILL_DAY_NAMES[formData.day_of_week]}`
        : formData.day_of_month === -1
          ? 'last day'
          : formData.day_of_month === 31
            ? 'last day'
            : _bmOrdinal(formData.day_of_month || 1);
      freqDesc = formData.interval === 1
        ? `Monthly on the ${dayLabel}`
        : `Every ${formData.interval} months on the ${dayLabel}`;
      break;
    }
    case 'twice_monthly': {
      const dom1Label = formData.day_of_month === 31 ? 'last day' : _bmOrdinal(formData.day_of_month || 1);
      const dom2Label = formData.second_day_of_month === 31 ? 'last day' : _bmOrdinal(formData.second_day_of_month || 15);
      freqDesc = `Twice monthly on the ${dom1Label} and ${dom2Label}`;
      if (formData.interval > 1) freqDesc += ` (every ${formData.interval} months)`;
      break;
    }
    case 'yearly':
      freqDesc = formData.interval === 1
        ? `Yearly on ${formatDate(formData.start_date)}`
        : `Every ${formData.interval} years on ${formatDate(formData.start_date)}`;
      break;
    case 'twice_yearly':
      freqDesc = `Twice a year: ${formatDate(formData.start_date)} and ${formatDate(formData.second_date)}`;
      if (formData.interval > 1) freqDesc += ` (every ${formData.interval} years)`;
      break;
  }

  let endDesc = '';
  if (formData.end_type === 'on_date' && formData.end_date) {
    endDesc = ` until ${formatDate(formData.end_date)}`;
  } else if (formData.end_type === 'after_occurrences' && formData.max_occurrences) {
    endDesc = ` for ${formData.max_occurrences} occurrences`;
  }

  return `<strong>${desc}</strong> — ${direction} ${amountStr}${variable}<br>${freqDesc}${endDesc}`;
}

function _bmGeneratePreviewDates(formData, count) {
  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = formData.start_date ? new Date(formData.start_date + 'T00:00:00') : today;
  const maxIterations = 500;
  let iterations = 0;

  if (formData.frequency === 'once') {
    dates.push(toISODateStr(startDate));
    return dates;
  }

  const interval = formData.interval || 1;
  const endDate = formData.end_type === 'on_date' && formData.end_date
    ? new Date(formData.end_date + 'T00:00:00') : null;
  const maxOcc = formData.end_type === 'after_occurrences' ? (formData.max_occurrences || 999) : 999;
  let occurrenceCount = 0;

  switch (formData.frequency) {
    case 'daily': {
      let cursor = new Date(startDate);
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        if (endDate && cursor > endDate) break;
        dates.push(toISODateStr(cursor));
        occurrenceCount++;
        cursor.setDate(cursor.getDate() + interval);
        iterations++;
      }
      break;
    }
    case 'weekly': {
      let cursor = new Date(startDate);
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        if (endDate && cursor > endDate) break;
        dates.push(toISODateStr(cursor));
        occurrenceCount++;
        cursor.setDate(cursor.getDate() + 7 * interval);
        iterations++;
      }
      break;
    }
    case 'monthly': {
      let monthCursor = startDate.getMonth();
      let yearCursor = startDate.getFullYear();
      const dom = formData.day_of_month || 1;
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        let occDate;
        if (dom === -1) {
          if (formData.day_of_week != null) {
            occDate = _bmLastWeekdayOfMonth(yearCursor, monthCursor, formData.day_of_week);
          } else {
            occDate = new Date(yearCursor, monthCursor + 1, 0);
          }
        } else {
          const lastDay = new Date(yearCursor, monthCursor + 1, 0).getDate();
          const clampedDay = Math.min(dom, lastDay);
          occDate = new Date(yearCursor, monthCursor, clampedDay);
        }
        if (endDate && occDate > endDate) break;
        dates.push(toISODateStr(occDate));
        occurrenceCount++;
        monthCursor += interval;
        while (monthCursor > 11) { monthCursor -= 12; yearCursor++; }
        iterations++;
      }
      break;
    }
    case 'twice_monthly': {
      let monthCursor = startDate.getMonth();
      let yearCursor = startDate.getFullYear();
      const dom1 = formData.day_of_month || 1;
      const dom2 = formData.second_day_of_month || 15;
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        const lastDay = new Date(yearCursor, monthCursor + 1, 0).getDate();
        const d1 = Math.min(dom1, lastDay);
        const d2 = Math.min(dom2, lastDay);
        const date1 = new Date(yearCursor, monthCursor, d1);
        const date2 = new Date(yearCursor, monthCursor, d2);
        const pair = [date1, date2].sort((a, b) => a - b);
        for (const pairDate of pair) {
          if (dates.length >= count || occurrenceCount >= maxOcc) break;
          if (endDate && pairDate > endDate) break;
          dates.push(toISODateStr(pairDate));
          occurrenceCount++;
        }
        monthCursor += interval;
        while (monthCursor > 11) { monthCursor -= 12; yearCursor++; }
        iterations++;
      }
      break;
    }
    case 'yearly': {
      let cursor = new Date(startDate);
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        if (endDate && cursor > endDate) break;
        dates.push(toISODateStr(cursor));
        occurrenceCount++;
        cursor.setFullYear(cursor.getFullYear() + interval);
        iterations++;
      }
      break;
    }
    case 'twice_yearly': {
      const secondDate = formData.second_date ? new Date(formData.second_date + 'T00:00:00') : null;
      let yearOffset = 0;
      while (dates.length < count && occurrenceCount < maxOcc && iterations < maxIterations) {
        const date1 = new Date(startDate);
        date1.setFullYear(date1.getFullYear() + yearOffset * interval);
        if (endDate && date1 > endDate) break;
        dates.push(toISODateStr(date1));
        occurrenceCount++;

        if (secondDate && dates.length < count && occurrenceCount < maxOcc) {
          const date2 = new Date(secondDate);
          date2.setFullYear(date2.getFullYear() + yearOffset * interval);
          if (!endDate || date2 <= endDate) {
            dates.push(toISODateStr(date2));
            occurrenceCount++;
          }
        }
        yearOffset++;
        iterations++;
      }
      break;
    }
  }

  return dates;
}

function _bmLastWeekdayOfMonth(year, month, targetDow) {
  const lastDay = new Date(year, month + 1, 0);
  const lastDayDow = (lastDay.getDay() + 6) % 7;
  let diff = lastDayDow - targetDow;
  if (diff < 0) diff += 7;
  return new Date(year, month, lastDay.getDate() - diff);
}

// ── Read Form Data ───────────────────────────────────────────

function _billModalReadFormData() {
  const frequency = document.getElementById('bill-frequency').value;
  const accountId = document.getElementById('bill-account').value;
  const description = document.getElementById('bill-description').value.trim();
  const rawAmount = document.getElementById('bill-amount').value.replace(/[^0-9.]/g, '');
  const typeSelect = document.getElementById('bill-type').value;
  const isCredit = typeSelect === 'credit';
  const amount = parseFloat(rawAmount) || 0;
  const autoPay = document.getElementById('bill-auto-pay').checked;
  const isImportant = document.getElementById('bill-is-important').checked;
  const category = document.getElementById('bill-category').value.trim();
  const memo = document.getElementById('bill-memo').value.trim();
  const criteria = _billModalReadCriteria();

  const startDateInput = document.getElementById('bill-start-date');
  let startDate;
  if ((frequency === 'monthly' || frequency === 'twice_monthly') && startDateInput) {
    const monthYearValue = getMonthYearInputValue(startDateInput);
    startDate = monthYearValue ? `${monthYearValue}-01` : _bmTodayStr();
  } else {
    startDate = startDateInput ? getDateInputValue(startDateInput) : _bmTodayStr();
  }

  const intervalInput = document.getElementById('bill-interval');
  const interval = intervalInput ? parseInt(intervalInput.value, 10) || 1 : 1;

  const endType = document.getElementById('bill-end-type').value;
  const endDate = endType === 'on_date' ? getDateInputValue('bill-end-date') : null;
  const maxOccurrences = endType === 'after_occurrences'
    ? parseInt(document.getElementById('bill-max-occurrences').value, 10) || null
    : null;

  let dayOfMonth = null;
  let secondDayOfMonth = null;
  let dayOfWeek = null;
  let secondDate = null;

  const domSelect = document.getElementById('bill-day-of-month');
  if (domSelect) {
    const rawDayOfMonthValue = domSelect.value;
    dayOfMonth = rawDayOfMonthValue === '-2' ? -1 : parseInt(rawDayOfMonthValue, 10);
  }

  const dom2Select = document.getElementById('bill-second-day-of-month');
  if (dom2Select) secondDayOfMonth = parseInt(dom2Select.value, 10);

  const dowSelect = document.getElementById('bill-day-of-week');
  if (dowSelect && dowSelect.style.display !== 'none') {
    dayOfWeek = parseInt(dowSelect.value, 10);
  }

  if (frequency === 'weekly') {
    const activeBtn = document.querySelector('#bill-modal-overlay .dow-btn.active');
    if (activeBtn) dayOfWeek = parseInt(activeBtn.dataset.dow, 10);
  }

  const secondDateInput = document.getElementById('bill-second-date');
  if (secondDateInput) secondDate = getDateInputValue(secondDateInput);

  const splitsTemplate = _billModalReadSplitRows();
  if (frequency === 'once') {
    endType = 'never';
    endDate = null;
    maxOccurrences = null;
    interval = 1; // Good to normalize this too!
  }
  return {
    frequency,
    account_id: accountId,
    description,
    amount,
    isCredit,
    auto_pay: autoPay,
    is_important: isImportant,
    user_category: category || null,
    memo: memo || null,
    match_amount_mode: criteria.match_amount_mode,
    match_amount_min: criteria.match_amount_min,
    match_amount_max: criteria.match_amount_max,
    match_date_tolerance_days: criteria.match_date_tolerance_days,
    match_plaid_name_patterns: criteria.match_plaid_name_patterns,
    match_merchant_name_patterns: criteria.match_merchant_name_patterns,
    match_pfc_detailed_categories: criteria.match_pfc_detailed_categories,
    match_day_of_month_set: criteria.match_day_of_month_set,
    match_account_scope: criteria.match_account_scope,
    match_sign_enforced: criteria.match_sign_enforced,
    start_date: startDate,
    interval,
    day_of_month: dayOfMonth,
    second_day_of_month: secondDayOfMonth,
    day_of_week: dayOfWeek,
    second_date: secondDate,
    end_type: endType,
    end_date: endDate,
    max_occurrences: maxOccurrences,
    splits_template: splitsTemplate
  };
}

function _normalizeBillEditComparable(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map(item => _normalizeBillEditComparable(item));
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return null;
    return Object.keys(value).sort().reduce((accumulator, key) => {
      accumulator[key] = _normalizeBillEditComparable(value[key]);
      return accumulator;
    }, {});
  }
  return value;
}

function _setBillEditPayloadField(payload, fieldName, nextValue, originalValue) {
  const normalizedNext = _normalizeBillEditComparable(nextValue);
  const normalizedOriginal = _normalizeBillEditComparable(originalValue);
  if (JSON.stringify(normalizedNext) !== JSON.stringify(normalizedOriginal)) {
    payload[fieldName] = normalizedNext;
  }
}

function _synthesizeStartDate(formData) {
  // If we aren't dealing with a monthly bill, or missing data, return as-is
  if ((formData.frequency !== 'monthly' && formData.frequency !== 'twice_monthly') || !formData.start_date) {
    return formData.start_date;
  }

  const hasMonthlySelection = formData.frequency === 'monthly'
    ? formData.day_of_month != null
    : formData.day_of_month != null || formData.second_day_of_month != null;
  if (!hasMonthlySelection) {
    return formData.start_date;
  }

  // Extract YYYY and MM from whatever the month picker gave us (e.g., '2026-07-01')
  const [year, month] = formData.start_date.split('-');
  let day = formData.day_of_month;
  let secondDay = formData.second_day_of_month;

  if (formData.frequency === 'twice_monthly' && secondDay != null) {
    const today = new Date();
    const todayDay = today.getDate();
    const candidateDays = [day, secondDay].sort((first, second) => first - second);
    const nextDay = candidateDays.find(candidateDay => candidateDay > todayDay);
    day = nextDay ?? candidateDays[0];
  }

  // Handle "Last day of month" (-1)
  if (day === -1) {
    // JS Date trick: day 0 of the *next* month gives the last day of the *current* month
    day = new Date(year, month, 0).getDate();
  }

  // Pad the day with a leading zero if necessary and stitch it together
  const paddedDay = String(day).padStart(2, '0');
  return `${year}-${month}-${paddedDay}`;
}

function _buildBillUpdatePayload(billId, formData, signedAmount, transferAccountId) {
  const originalBill = _billModalEditData || null;
  if (!originalBill || !billId) return {};

  const payload = {};

  // 1. Synthesize the true start date right away
  const effectiveStartDate = _synthesizeStartDate(formData);

  const nextAmount = Number.isFinite(signedAmount)
    ? Number(Number(signedAmount).toFixed(2))
    : null;
  const originalAmount = Number.isFinite(Number(originalBill.amount))
    ? Number(Number(originalBill.amount).toFixed(2))
    : null;
  if (nextAmount !== originalAmount) {
    payload.amount = nextAmount;
  }

  _setBillEditPayloadField(payload, 'account_id', formData.account_id, originalBill.account_id);
  _setBillEditPayloadField(payload, 'transfer_account_id', transferAccountId, originalBill.transfer_account_id);
  _setBillEditPayloadField(payload, 'description', formData.description, originalBill.description);
  _setBillEditPayloadField(payload, 'user_category', formData.user_category, originalBill.user_category);
  _setBillEditPayloadField(payload, 'memo', formData.memo, originalBill.memo);
  _setBillEditPayloadField(payload, 'auto_pay', formData.auto_pay, originalBill.auto_pay);
  _setBillEditPayloadField(payload, 'is_important', formData.is_important, originalBill.is_important);
  _setBillEditPayloadField(payload, 'frequency', formData.frequency, originalBill.frequency);
  _setBillEditPayloadField(payload, 'interval', formData.interval, originalBill.interval);
  _setBillEditPayloadField(payload, 'start_date', effectiveStartDate, originalBill.start_date);
  _setBillEditPayloadField(payload, 'second_date', formData.second_date, originalBill.second_date);
  _setBillEditPayloadField(payload, 'day_of_month', formData.day_of_month, originalBill.day_of_month);
  _setBillEditPayloadField(payload, 'second_day_of_month', formData.second_day_of_month, originalBill.second_day_of_month);
  _setBillEditPayloadField(payload, 'day_of_week', formData.day_of_week, originalBill.day_of_week);
  _setBillEditPayloadField(payload, 'end_type', formData.end_type, originalBill.end_type);
  _setBillEditPayloadField(payload, 'end_date', formData.end_date, originalBill.end_date);
  _setBillEditPayloadField(payload, 'max_occurrences', formData.max_occurrences, originalBill.max_occurrences);
  _setBillEditPayloadField(payload, 'splits_template', formData.splits_template, originalBill.splits_template);
  _setBillEditPayloadField(payload, 'match_amount_mode', formData.match_amount_mode, originalBill.match_amount_mode);
  _setBillEditPayloadField(payload, 'match_amount_min', formData.match_amount_min, originalBill.match_amount_min);
  _setBillEditPayloadField(payload, 'match_amount_max', formData.match_amount_max, originalBill.match_amount_max);
  _setBillEditPayloadField(payload, 'match_date_tolerance_days', formData.match_date_tolerance_days, originalBill.match_date_tolerance_days);
  _setBillEditPayloadField(payload, 'match_plaid_name_patterns', formData.match_plaid_name_patterns, originalBill.match_plaid_name_patterns);
  _setBillEditPayloadField(payload, 'match_merchant_name_patterns', formData.match_merchant_name_patterns, originalBill.match_merchant_name_patterns);
  _setBillEditPayloadField(payload, 'match_pfc_detailed_categories', formData.match_pfc_detailed_categories, originalBill.match_pfc_detailed_categories);
  _setBillEditPayloadField(payload, 'match_day_of_month_set', formData.match_day_of_month_set, originalBill.match_day_of_month_set);
  _setBillEditPayloadField(payload, 'match_account_scope', formData.match_account_scope, originalBill.match_account_scope);
  _setBillEditPayloadField(payload, 'match_sign_enforced', formData.match_sign_enforced, originalBill.match_sign_enforced);

  // 1. Define the fields that constitute a "recurrence rule change"
  const recurrenceFields = [
    'frequency', 'interval', 'day_of_month', 'second_day_of_month', 
    'day_of_week', 'second_date', 'end_type', 'end_date', 'max_occurrences'
  ];

  // 2. Check if any of these fields were added to the payload
  const recurrenceChanged = recurrenceFields.some(field => payload.hasOwnProperty(field));

  // 3. If recurrence changed, ensure start_date is present in the payload
  // (We use formData to get the most recent value from the user's input)
  if (recurrenceChanged && !payload.hasOwnProperty('start_date')) {
    payload.start_date = effectiveStartDate;
  }

  return payload;
}
// ── Save Bill ────────────────────────────────────────────────

async function _billModalSave() {
  const banner = document.getElementById('bill-error-banner');
  banner.style.display = 'none';

  const formData = _billModalReadFormData();

  if (!formData.account_id) { _bmShowError('Please select an account.'); return; }
  if (!formData.description) { _bmShowError('Please enter a description.'); return; }
  // Variable-amount bills may be saved at $0 so the user isn't tricked into
  // seeing a real pending amount before the bill actually materializes.
  // Fixed-amount bills still need a non-zero amount.
  const amountValue = Number(formData.amount);
  if (isNaN(amountValue) || amountValue < 0) {
    _bmShowError('Please enter a valid amount (zero or greater).'); return;
  }
  const splitsTemplate = Array.isArray(formData.splits_template) ? formData.splits_template : [];
  const hasSplits = splitsTemplate.length > 0;
  const isRangeMode = formData.match_amount_mode === 'range';
  if (!isRangeMode && amountValue === 0 && !hasSplits) {
    _bmShowError('Please enter a valid amount greater than 0, or switch matching to Range mode.'); return;
  }
  if (isRangeMode) {
    const minValue = formData.match_amount_min;
    const maxValue = formData.match_amount_max;
    if (minValue === null || maxValue === null || isNaN(minValue) || isNaN(maxValue)) {
      _bmShowError('Range mode requires both Min and Max amount bounds.'); return;
    }
    if (minValue < 0 || maxValue < 0) {
      _bmShowError('Range bounds must be zero or greater.'); return;
    }
    if (minValue > maxValue) {
      _bmShowError('Range Min must be less than or equal to Max.'); return;
    }
    if (hasSplits) {
      _bmShowError('Splits are not allowed in Range matching mode. Remove splits, or switch back to Exact.'); return;
    }
  }
  if (hasSplits) {
    if (splitsTemplate.length < 2) {
      _bmShowError('Add at least 2 split allocations, or remove all of them.'); return;
    }
    if (splitsTemplate.some(s => s.amount === null || s.amount === undefined || isNaN(s.amount))) {
      _bmShowError('Every split allocation needs a valid amount.'); return;
    }
    if (splitsTemplate.some(s => !s.category)) {
      _bmShowError('Every split allocation needs a category.'); return;
    }
    const signedTarget = formData.isCredit ? amountValue : -amountValue;
    const sum = splitsTemplate.reduce((acc, s) => acc + Number(s.amount), 0);
    if (Math.abs(sum - signedTarget) >= 0.01) {
      _bmShowError(`Split allocations must sum to the bill amount. Sum: ${sum.toFixed(2)}, Target: ${signedTarget.toFixed(2)}.`); return;
    }
  }
  if (!formData.start_date) { _bmShowError('Please set a start date.'); return; }

  if (formData.start_date && !parseDateInput(formData.start_date)) {
    _bmShowError('Invalid start date. Please check the date and try again.'); return;
  }
  if (formData.end_date && !parseDateInput(formData.end_date)) {
    _bmShowError('Invalid end date. Please check the date and try again.'); return;
  }
  if (formData.second_date && !parseDateInput(formData.second_date)) {
    _bmShowError('Invalid second payment date. Please check the date and try again.'); return;
  }

  const signedAmount = formData.isCredit ? formData.amount : -(formData.amount);

  let transferAccountId = null;
  if (formData.user_category && formData.user_category.startsWith('[') && formData.user_category.endsWith(']') && formData.user_category.length > 2) {
    const transferName = formData.user_category.slice(1, -1);
    const matchedAccount = _billModalAccounts.find(acct =>
      acct.display_name.toLowerCase() === transferName.toLowerCase()
    );
    if (matchedAccount) transferAccountId = matchedAccount.account_id;
  }

  let payload;
  if (_billModalEditingId) {
    payload = _buildBillUpdatePayload(_billModalEditingId, formData, signedAmount, transferAccountId);
    if (Object.keys(payload).length === 0) {
      closeBillModal();
      showStatus('No changes were made', 'success');
      return;
    }
  } else {
    const effectiveStartDate = _synthesizeStartDate(formData);

    payload = {
      account_id: formData.account_id,
      transfer_account_id: transferAccountId,
      description: formData.description,
      amount: signedAmount,
      user_category: formData.user_category,
      memo: formData.memo,
      auto_pay: formData.auto_pay,
      is_important: formData.is_important,
      frequency: formData.frequency,
      interval: formData.interval,
      start_date: effectiveStartDate,
      second_date: formData.second_date,
      day_of_month: formData.day_of_month,
      second_day_of_month: formData.second_day_of_month,
      day_of_week: formData.day_of_week,
      end_type: formData.end_type,
      end_date: formData.end_date,
      max_occurrences: formData.max_occurrences,
      splits_template: splitsTemplate,
      match_amount_mode: formData.match_amount_mode,
      match_amount_min: formData.match_amount_min,
      match_amount_max: formData.match_amount_max,
      match_date_tolerance_days: formData.match_date_tolerance_days,
      match_plaid_name_patterns: formData.match_plaid_name_patterns,
      match_merchant_name_patterns: formData.match_merchant_name_patterns,
      match_pfc_detailed_categories: formData.match_pfc_detailed_categories,
      match_day_of_month_set: formData.match_day_of_month_set,
      match_account_scope: formData.match_account_scope,
      match_sign_enforced: formData.match_sign_enforced
    };
  }

  try {
    let result;
    if (_billModalEditingId) {
      result = await apiUpdateBill(_billModalEditingId, payload);
      showStatus('Bill updated successfully', 'success');
    } else {
      result = await apiCreateBill(payload);
      showStatus('Bill created successfully', 'success');
    }

    const onSave = _billModalOnSave;
    closeBillModal();

    if (onSave) {
      onSave(result);
    }

    setTimeout(clearStatus, 3000);
  } catch (saveError) {
    _bmShowError(saveError.message);
  }
}

function _bmShowError(message) {
  const banner = document.getElementById('bill-error-banner');
  banner.textContent = message;
  banner.style.display = 'block';
  setTimeout(() => { banner.style.display = 'none'; }, 6000);
}

// ── Matching Criteria UI ─────────────────────────────────────

function _billModalToggleCriteria() {
  const body = document.getElementById('bill-criteria-body');
  const expanded = body.style.display !== 'none';
  _billModalSetCriteriaExpanded(!expanded);
}

function _billModalSetCriteriaExpanded(expanded) {
  const body = document.getElementById('bill-criteria-body');
  const caret = document.getElementById('bill-criteria-caret');
  const hint = document.querySelector('.bill-criteria-hint');
  body.style.display = expanded ? 'block' : 'none';
  if (caret) caret.textContent = expanded ? '▼' : '▶';
  if (hint) hint.textContent = expanded ? 'click to collapse' : 'click to expand';
}

function _billModalOnAmountModeChange() {
  const modeRadio = document.querySelector('input[name="bill-match-amount-mode"]:checked');
  const isRange = modeRadio && modeRadio.value === 'range';
  document.getElementById('bill-range-bounds').style.display = isRange ? 'block' : 'none';

  // When switching to range mode while splits exist, surface the conflict.
  // The save handler will still hard-block submission; this is just UX nudge.
  const splitsCount = document.querySelectorAll('#bill-split-rows .split-row').length;
  const warning = document.getElementById('bill-range-splits-warning');
  const splitAddBtn = document.getElementById('bill-split-add-btn');
  if (isRange && splitsCount > 0) {
    if (warning) warning.style.display = 'block';
  } else if (warning) {
    warning.style.display = 'none';
  }
  if (splitAddBtn) splitAddBtn.disabled = isRange;
}

function _parseCommaList(rawValue) {
  if (!rawValue) return [];
  return rawValue
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function _billModalReadCriteria() {
  const modeRadio = document.querySelector('input[name="bill-match-amount-mode"]:checked');
  const mode = modeRadio ? modeRadio.value : 'exact';

  const minRaw = document.getElementById('bill-match-amount-min').value.replace(/[^0-9.]/g, '');
  const maxRaw = document.getElementById('bill-match-amount-max').value.replace(/[^0-9.]/g, '');
  const matchAmountMin = mode === 'range' && minRaw !== '' ? parseFloat(minRaw) : null;
  const matchAmountMax = mode === 'range' && maxRaw !== '' ? parseFloat(maxRaw) : null;

  const dateDisabled = document.getElementById('bill-match-date-disable').checked;
  const toleranceRaw = document.getElementById('bill-match-date-tolerance').value;
  let matchDateTolerance = dateDisabled ? null : (toleranceRaw === '' ? null : parseInt(toleranceRaw, 10));
  // The matching engine only considers Plaid transactions within a 14-day
  // window, so larger tolerances would silently have no effect. Clamp here
  // and let the backend enforce the same cap on save.
  if (matchDateTolerance !== null && Number.isFinite(matchDateTolerance)) {
    if (matchDateTolerance < 0) matchDateTolerance = 0;
    if (matchDateTolerance > 14) matchDateTolerance = 14;
  }

  const plaidNames = _parseCommaList(document.getElementById('bill-match-plaid-name-patterns').value);
  const merchantNames = _parseCommaList(document.getElementById('bill-match-merchant-name-patterns').value);
  // PFC codes are uppercased so the user can paste them in any case and they
  // still hit Plaid's canonical ALL_CAPS_SNAKE_CASE form.
  const pfcCodes = _parseCommaList(document.getElementById('bill-match-pfc-categories').value)
    .map(code => code.toUpperCase());
  const dayOfMonthRaw = _parseCommaList(document.getElementById('bill-match-day-of-month').value);
  const dayOfMonth = dayOfMonthRaw
    .map(value => parseInt(value, 10))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 31);

  return {
    match_amount_mode: mode,
    match_amount_min: matchAmountMin !== null && !isNaN(matchAmountMin) ? matchAmountMin : null,
    match_amount_max: matchAmountMax !== null && !isNaN(matchAmountMax) ? matchAmountMax : null,
    match_date_tolerance_days: matchDateTolerance,
    match_plaid_name_patterns: plaidNames,
    match_merchant_name_patterns: merchantNames,
    match_pfc_detailed_categories: pfcCodes,
    match_day_of_month_set: dayOfMonth,
    match_account_scope: document.getElementById('bill-match-account-scope').value || 'bill_account',
    match_sign_enforced: document.getElementById('bill-match-sign-enforced').checked,
  };
}

// Defaults considered "no criterion configured" for the badge count.
// Stays in sync with the backend defaults declared in bills_models.py.
function _billModalUpdateCriteriaBadge() {
  const criteria = _billModalReadCriteria();
  let count = 0;
  if (criteria.match_amount_mode === 'range') count++;
  if (criteria.match_date_tolerance_days === null || criteria.match_date_tolerance_days !== 2) count++;
  if (criteria.match_plaid_name_patterns.length > 0) count++;
  if (criteria.match_merchant_name_patterns.length > 0) count++;
  if (criteria.match_pfc_detailed_categories.length > 0) count++;
  if (criteria.match_day_of_month_set.length > 0) count++;
  if (criteria.match_account_scope !== 'bill_account') count++;
  if (criteria.match_sign_enforced !== true) count++;

  const badge = document.getElementById('bill-criteria-badge');
  if (!badge) return count;
  if (count === 0) {
    badge.style.display = 'none';
    badge.textContent = '';
  } else {
    badge.style.display = 'inline-block';
    badge.textContent = `${count} criteri${count === 1 ? 'on' : 'a'} set`;
  }
  return count;
}

// ── Splits Template UI ───────────────────────────────────────

function _billModalSetSplitRows(splits) {
  const container = document.getElementById('bill-split-rows');
  if (!container) return;
  container.innerHTML = '';
  _billModalSplitRowSeq = 0;
  (splits || []).forEach(split => {
    _billModalAddSplitRow({
      amount: split.amount,
      category: split.category || '',
      user_memo: split.user_memo || '',
      description: split.description || '',
    });
  });
  _billModalUpdateSplitsValidation();
}

function _billModalAddSplitRow(initial) {
  const container = document.getElementById('bill-split-rows');
  if (!container) return;
  const seq = _billModalSplitRowSeq++;
  const data = initial || {};
  const amountStr = (data.amount !== undefined && data.amount !== null && data.amount !== '')
    ? Number(data.amount).toFixed(2) : '';

  const row = document.createElement('div');
  row.className = 'split-row';
  row.dataset.rowSeq = seq;
  row.innerHTML = `
    <div>
      <div class="split-row-label">Amount</div>
      <input type="text" inputmode="decimal" class="bill-split-amount" placeholder="0.00" value="${escapeHtml(amountStr)}">
    </div>
    <div>
      <div class="split-row-label">Description (Optional)</div>
      <input type="text" class="bill-split-description" placeholder="Inherits bill description" maxlength="500" value="${escapeHtml(data.description || '')}">
    </div>
    <div>
      <div class="split-row-label">Category</div>
      <div style="position: relative;">
        <input type="text" class="bill-split-category" placeholder="Type to search, or [ for transfers" autocomplete="off" value="${escapeHtml(data.category || '')}">
        <div class="bill-split-category-ac-list bill-category-ac-list" style="display:none;"></div>
      </div>
    </div>
    <div>
      <div class="split-row-label">Memo (Optional)</div>
      <input type="text" class="bill-split-memo" placeholder="Optional note" maxlength="256" value="${escapeHtml(data.user_memo || '')}">
    </div>
    <button type="button" class="split-row-remove" title="Remove this allocation">&minus;</button>
  `;
  container.appendChild(row);

  row.querySelector('.split-row-remove').addEventListener('click', () => {
    row.remove();
    _billModalUpdateSplitsValidation();
  });
  row.querySelector('.bill-split-amount').addEventListener('input', _billModalUpdateSplitsValidation);

  const catInput = row.querySelector('.bill-split-category');
  const catList = row.querySelector('.bill-split-category-ac-list');
  // Match the main bill-category field: same autocomplete classes (so
  // dropdown styling inherits from bill-modal.css) and the [transfer]
  // mode that lets users pick a counterpart account.
  const liveInput = wireUpCategoryAutocomplete(catInput, catList, {
    categories: _billModalCategories,
    itemClass: 'bill-category-ac-item',
    emptyClass: 'bill-category-ac-empty',
    moreClass: 'bill-category-ac-more',
    onCustomQuery: (query, dropdownList) => {
      if (!query.startsWith('[')) return false;
      _bmShowTransferAccountDropdown(dropdownList, query);
      return true;
    },
  });
  liveInput.addEventListener('change', _billModalUpdateSplitsValidation);
  liveInput.addEventListener('input', _billModalUpdateSplitsValidation);
}

function _billModalReadSplitRows() {
  const rows = document.querySelectorAll('#bill-split-rows .split-row');
  const splits = [];
  rows.forEach(row => {
    const amountRaw = (row.querySelector('.bill-split-amount').value || '').trim();
    const category = (row.querySelector('.bill-split-category').value || '').trim();
    const memo = (row.querySelector('.bill-split-memo').value || '').trim();
    const description = (row.querySelector('.bill-split-description').value || '').trim();
    if (!amountRaw && !category) return; // skip empty rows
    const amount = parseFloat(amountRaw.replace(/[$,]/g, ''));
    splits.push({
      amount: isNaN(amount) ? null : amount,
      category,
      user_memo: memo || null,
      description: description || null,
    });
  });
  return splits;
}

function _billModalCurrentSignedAmount() {
  const rawAmount = (document.getElementById('bill-amount').value || '').replace(/[^0-9.]/g, '');
  const amount = parseFloat(rawAmount) || 0;
  const isCredit = document.getElementById('bill-type').value === 'credit';
  return isCredit ? amount : -amount;
}

function _billModalUpdateSplitsValidation() {
  const sumEl = document.getElementById('bill-split-sum');
  const remainEl = document.getElementById('bill-split-remaining');
  const errorEl = document.getElementById('bill-split-validation-error');
  if (!sumEl || !remainEl || !errorEl) return;

  const splits = _billModalReadSplitRows();
  const total = splits.reduce((acc, s) => acc + (typeof s.amount === 'number' && !isNaN(s.amount) ? s.amount : 0), 0);
  const target = _billModalCurrentSignedAmount();
  const remaining = target - total;

  const fmt = (n) => {
    const sign = n < 0 ? '-' : '';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  };

  sumEl.textContent = fmt(total);
  remainEl.textContent = fmt(remaining);

  const balanced = Math.abs(remaining) < 0.01;
  remainEl.classList.toggle('balanced', balanced);
  remainEl.classList.toggle('unbalanced', !balanced);

  // When splits are present the parent category becomes meaningless
  // (every dollar lives in a child), so we disable the main field and
  // surface a small inline note.
  const splitsActive = splits.length > 0;
  const categoryInput = document.getElementById('bill-category');
  const categoryNote = document.getElementById('bill-category-splits-note');
  if (categoryInput) {
    categoryInput.disabled = splitsActive;
    if (splitsActive) {
      categoryInput.value = '';
      categoryInput.placeholder = 'Auto-split — see allocations below';
    } else {
      categoryInput.placeholder = 'Type to search, or [ for transfers';
    }
  }
  if (categoryNote) categoryNote.style.display = splitsActive ? 'block' : 'none';

  // Keep the range-mode warning + add-button state in sync as rows change.
  const modeRadio = document.querySelector('input[name="bill-match-amount-mode"]:checked');
  const isRangeMode = modeRadio && modeRadio.value === 'range';
  const rangeWarning = document.getElementById('bill-range-splits-warning');
  if (rangeWarning) rangeWarning.style.display = (isRangeMode && splitsActive) ? 'block' : 'none';
  const splitAddBtn = document.getElementById('bill-split-add-btn');
  if (splitAddBtn) splitAddBtn.disabled = isRangeMode;

  let message = '';
  if (splits.length === 0) {
    // Empty is allowed (single-category bill)
  } else if (splits.length < 2) {
    message = 'Add at least 2 allocations, or remove the lone row.';
  } else if (splits.some(s => s.amount === null || s.amount === undefined || isNaN(s.amount))) {
    message = 'Every allocation needs a valid amount.';
  } else if (splits.some(s => !s.category)) {
    message = 'Every allocation needs a category.';
  } else if (!balanced) {
    message = `Allocations don't balance. Remaining: ${fmt(remaining)}.`;
  }

  if (message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  } else {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
}

// ── Amount +/- Helpers ───────────────────────────────────────

function _billModalSyncAmountPrefix(amountInput, typeSelect) {
  const value = amountInput.value;
  if (value.startsWith('+')) {
    typeSelect.value = 'credit';
    amountInput.value = value.slice(1);
  } else if (value.startsWith('-') || value.startsWith('−')) {
    typeSelect.value = 'debit';
    amountInput.value = value.slice(1);
  }
}

function _billModalSyncTypeDropdown(amountInput) {
  amountInput.value = amountInput.value.replace(/^[+\-−]/, '');
}

function _billModalDecorateAmountOnBlur(amountInput, typeSelect) {
  const raw = amountInput.value.replace(/[^0-9.]/g, '');
  if (!raw) return;
  const num = parseFloat(raw);
  if (isNaN(num)) return;
  amountInput.value = (typeSelect.value === 'debit' ? '−' : '') + num.toFixed(2);
}

function _billModalStripDecorationOnFocus(amountInput) {
  amountInput.value = amountInput.value.replace(/^[−]/, '');
}

// ── Category Autocomplete ────────────────────────────────────

function _billModalWireCategoryAutocomplete() {
  const input = document.getElementById('bill-category');
  const list = document.getElementById('bill-category-ac-list');
  if (!input || !list) return;

  wireUpCategoryAutocomplete(input, list, {
    categories: _billModalCategories,
    itemClass:  'bill-category-ac-item',
    emptyClass: 'bill-category-ac-empty',
    moreClass:  'bill-category-ac-more',
    onCustomQuery: (query, dropdownList) => {
      if (!query.startsWith('[')) return false;
      _bmShowTransferAccountDropdown(dropdownList, query);
      return true;
    },
  });
}

function _bmShowTransferAccountDropdown(list, rawQuery) {
  const accountQuery = rawQuery.slice(1).replace(/]$/, '').toLowerCase();
  const currentAccountId = document.getElementById('bill-account')?.value || null;

  const matchingAccounts = _billModalAccounts.filter(acct => {
    if (acct.account_id === currentAccountId) return false;
    if (!accountQuery) return true;
    return acct.display_name.toLowerCase().includes(accountQuery);
  });

  const maxVisible = 10;
  const shown = matchingAccounts.slice(0, maxVisible);

  if (shown.length === 0) {
    list.innerHTML = '<div class="bill-category-ac-empty">No matching accounts for transfer</div>';
    list.style.display = 'block';
    return;
  }

  const html = shown.map((acct, index) => {
    const displayName = acct.display_name;
    const transferValue = `[${displayName}]`;
    const highlighted = accountQuery ? highlightCategoryMatch(displayName, accountQuery) : escapeHtml(displayName);
    return `<div class="bill-category-ac-item${index === 0 ? ' active' : ''}" data-value="${escapeHtml(transferValue)}">${highlighted}</div>`;
  }).join('');

  list.innerHTML = html;
  list.style.display = 'block';
}

// ── Event Delegation (DOW buttons, day-of-month, etc.) ───────
// Frequency-rendered controls use event delegation on the modal overlay
// instead of inline onclick handlers, so they work even when the modal
// HTML is dynamically injected.

(function _billModalWireEventDelegation() {
  document.addEventListener('click', (event) => {
    // DOW button clicks
    const dowBtn = event.target.closest('#bill-modal-overlay .dow-btn');
    if (dowBtn) {
      const dayIndex = parseInt(dowBtn.dataset.dow, 10);
      _bmSelectDayOfWeek(dayIndex);
      return;
    }
  });

  document.addEventListener('change', (event) => {
    // Day-of-month dropdown change → show/hide DOW dropdown
    if (event.target.id === 'bill-day-of-month') {
      _bmOnDayOfMonthChange();
      _billModalUpdatePreview();
    }
    // Weekly start date → sync DOW buttons
    const freqEl = document.getElementById('bill-frequency');
    if (event.target.id === 'bill-start-date' && freqEl && freqEl.value === 'weekly') {
      _bmOnWeeklyStartDateChange();
      _billModalUpdatePreview();
    }
    // All other inputs in the modal
    if (event.target.closest('#bill-modal-overlay')) {
      _billModalUpdatePreview();
    }
  });

  // Live preview on text input (description, amount, memo, etc.)
  document.addEventListener('input', (event) => {
    if (event.target.closest('#bill-modal-overlay')) {
      _billModalUpdatePreview();
    }
  });
})();
