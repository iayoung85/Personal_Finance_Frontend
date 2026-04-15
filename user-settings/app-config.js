// ============================================================
// user-settings/app-config.js — App Configuration Panel
// Renders all global app-level preferences (theme, date
// format, number display, dashboard defaults, notifications).
//
// Reads/writes via the backend preferences API and keeps
// localStorage as a local cache so other pages can read
// synchronously via getAppConfig() from config-helpers.js.
// ============================================================

/**
 * Fetch the user's preferences from the backend, merge with
 * defaults, and cache the result in localStorage. Called once
 * when the App Configuration section is opened.
 *
 * @returns {Promise<Object>} Merged config object.
 */
async function _fetchPreferencesFromServer() {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/user/preferences`);
    if (response.ok) {
      const serverPrefs = await response.json();
      localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(serverPrefs));
      return serverPrefs;
    }
    console.warn('Failed to fetch preferences from server, using local cache');
  } catch (error) {
    console.warn('Preferences API unreachable, using local cache:', error.message);
  }
  return getAppConfig();
}

/**
 * PATCH a partial update to the backend and refresh the local cache.
 *
 * @param {Object} updates - Partial config with changed keys only.
 * @returns {Promise<Object|null>} Updated merged config or null on failure.
 */
async function _patchPreferencesToServer(updates) {
  try {
    const response = await authenticatedFetch(`${BACKEND_URL}/api/user/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (response.ok) {
      const merged = await response.json();
      localStorage.setItem(APP_CONFIG_KEY, JSON.stringify(merged));
      return merged;
    }
    console.error('Preferences PATCH failed:', response.status);
  } catch (error) {
    console.error('Preferences PATCH error:', error.message);
  }
  return null;
}

// ── Section Renderers ─────────────────────────────────────────

/**
 * Builds the Appearance card HTML.
 *
 * Light mode is not yet implemented, so the theme toggle is
 * rendered as disabled with an explanatory note rather than
 * hiding it entirely — this signals to users that it is planned.
 */
function _renderAppearanceCard(config) {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Appearance</h3>
      </div>
      <div class="form-group">
        <label>Color Theme</label>
        <div class="stub-option-group">
          <label class="stub-radio-label">
            <input type="radio" name="theme" value="dark" checked disabled>
            <span>Dark</span>
            <span class="badge-active">Active</span>
          </label>
          <label class="stub-radio-label stub-disabled">
            <input type="radio" name="theme" value="light" disabled>
            <span>Light</span>
            <span class="badge-coming-soon">Coming soon</span>
          </label>
        </div>
        <p class="text-muted stub-note">Light mode is not yet available. The toggle is shown here for future wiring.</p>
      </div>
    </div>
  `;
}

/**
 * Builds the Dates & Formatting card HTML.
 *
 * The selected dateFormat value is what downstream formatDate()
 * helpers will read via readAppConfig().dateFormat once wired.
 */
function _renderDateFormattingCard(config) {
  const formatOptions = [
    { value: 'YYYY-MM-DD',  label: 'YYYY-MM-DD (ISO)', example: '2026-03-04' },
    { value: 'MM/DD/YYYY',  label: 'MM/DD/YYYY',       example: '03/04/2026' },
    { value: 'DD/MM/YYYY',  label: 'DD/MM/YYYY',       example: '04/03/2026' },
    { value: 'MMM D, YYYY', label: 'MMM D, YYYY',      example: 'Mar 4, 2026' },
  ];

  const inputFormatOptions = [
    { value: 'MMDDYYYY', label: 'Month first', example: 'MM / DD / YYYY — enter month, day, then year' },
    { value: 'YYYYMMDD', label: 'Year first',  example: 'YYYY / MM / DD — enter year, month, then day' },
  ];

  const dayOptions = [
    { value: 'sunday', label: 'Sunday' },
    { value: 'monday', label: 'Monday' },
  ];

  const formatRadios = formatOptions.map(opt => `
    <label class="stub-radio-label${config.dateFormat === opt.value ? ' selected' : ''}">
      <input type="radio" name="dateFormat" value="${opt.value}"
        ${config.dateFormat === opt.value ? 'checked' : ''}
        onchange="handleAppConfigChange('dateFormat', this.value)">
      <span>${opt.label}</span>
      <span class="example-value">${opt.example}</span>
    </label>
  `).join('');

  const inputFormatRadios = inputFormatOptions.map(opt => `
    <label class="stub-radio-label${config.dateInputFormat === opt.value ? ' selected' : ''}">
      <input type="radio" name="dateInputFormat" value="${opt.value}"
        ${config.dateInputFormat === opt.value ? 'checked' : ''}
        onchange="handleAppConfigChange('dateInputFormat', this.value); refreshDateInputPlaceholders();">
      <span>${opt.label}</span>
      <span class="example-value">${opt.example}</span>
    </label>
  `).join('');

  const dayRadios = dayOptions.map(opt => `
    <label class="stub-radio-label${config.firstDayOfWeek === opt.value ? ' selected' : ''}">
      <input type="radio" name="firstDayOfWeek" value="${opt.value}"
        ${config.firstDayOfWeek === opt.value ? 'checked' : ''}
        onchange="handleAppConfigChange('firstDayOfWeek', this.value)">
      <span>${opt.label}</span>
    </label>
  `).join('');

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Dates &amp; Formatting</h3>
      </div>
      <div class="form-group">
        <label>Preferred Date Format</label>
        <div class="stub-option-group">${formatRadios}</div>
        <p class="text-muted stub-note">Controls date display across all pages (tables, detail panels, exports).</p>
      </div>
      <div class="form-group">
        <label>Date Input Order</label>
        <div class="stub-option-group">${inputFormatRadios}</div>
        <p class="text-muted stub-note">Controls the segment order in date fields. Arrow keys navigate between segments, Up/Down adjusts values, or just type all digits straight through.</p>
      </div>
      <div class="form-group">
        <label>First Day of Week</label>
        <div class="stub-option-group">${dayRadios}</div>
        <p class="text-muted stub-note">Used by calendar pickers and weekly rollup views.</p>
      </div>
    </div>
  `;
}

/**
 * Builds the Number & Currency Display card HTML.
 */
function _renderNumberDisplayCard(config) {
  const symbolOptions = [
    { value: '$', label: 'USD  $' },
    { value: '€', label: 'EUR  €' },
    { value: '£', label: 'GBP  £' },
  ];

  const symbolRadios = symbolOptions.map(opt => `
    <label class="stub-radio-label${config.currencySymbol === opt.value ? ' selected' : ''}">
      <input type="radio" name="currencySymbol" value="${opt.value}"
        ${config.currencySymbol === opt.value ? 'checked' : ''}
        onchange="handleAppConfigChange('currencySymbol', this.value)">
      <span>${opt.label}</span>
    </label>
  `).join('');

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Number &amp; Currency Display</h3>
      </div>
      <div class="form-group">
        <label>Currency Symbol</label>
        <div class="stub-option-group">${symbolRadios}</div>
        <p class="text-muted stub-note">Cosmetic only — no conversion. Affects the symbol shown next to amounts.</p>
      </div>
      <div class="form-group">
        <label class="stub-checkbox-label">
          <input type="checkbox" id="showCents"
            ${config.showCents ? 'checked' : ''}
            onchange="handleAppConfigChange('showCents', this.checked)">
          <span>Always show cents (e.g. $45.00 instead of $45)</span>
        </label>
      </div>
      <div class="form-group">
        <label class="stub-checkbox-label">
          <input type="checkbox" id="useCompactNotation"
            ${config.useCompactNotation ? 'checked' : ''}
            onchange="handleAppConfigChange('useCompactNotation', this.checked)">
          <span>Use compact notation for large amounts (e.g. $143.2K)</span>
        </label>
        <p class="text-muted stub-note">Affects dashboard totals and account balance displays.</p>
      </div>
    </div>
  `;
}

/**
 * Builds the Dashboard &amp; View Defaults card HTML.
 */
function _renderViewDefaultsCard(config) {
  const rangeOptions = [
    { value: 'last_12_months', label: 'Last 12 Months' },
    { value: 'mtd',            label: 'Month to Date' },
    { value: 'ytd',            label: 'Year to Date' },
    { value: 'last_month',     label: 'Last Month' },
    { value: 'last_year',      label: 'Last Year' },
  ];

  const rangeOptions_html = rangeOptions.map(opt => `
    <option value="${opt.value}" ${config.defaultDateRange === opt.value ? 'selected' : ''}>${opt.label}</option>
  `).join('');

  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Dashboard &amp; View Defaults</h3>
      </div>
      <div class="form-group">
        <label for="defaultDateRange">Default Date Range</label>
        <select id="defaultDateRange"
          onchange="handleAppConfigChange('defaultDateRange', this.value)">
          ${rangeOptions_html}
        </select>
        <p class="text-muted stub-note">The date range pre-selected when opening the Transactions or Dashboard page.</p>
      </div>
      <div class="form-group">
        <label class="stub-checkbox-label">
          <input type="checkbox" id="showMaskWithName"
            ${config.showMaskWithName !== false ? 'checked' : ''}
            onchange="handleAppConfigChange('showMaskWithName', this.checked)">
          <span>Show account mask alongside display name (e.g. "My Checking (1234)")</span>
        </label>
        <p class="text-muted stub-note">Appends the last digits of the account number to custom names in sidebars and dropdowns. Accounts that already include the mask in their name are unaffected.</p>
      </div>
    </div>
  `;
}

/**
 * Builds the Notifications card HTML.
 * These controls are stubs — no backend persistence exists yet.
 */
function _renderNotificationsCard(config) {
  return `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Notifications</h3>
      </div>
      <div class="form-group">
        <label class="stub-checkbox-label">
          <input type="checkbox" id="emailWeeklySummary"
            ${config.emailWeeklySummary ? 'checked' : ''}
            onchange="handleAppConfigChange('emailWeeklySummary', this.checked)">
          <span>Weekly spending summary email</span>
        </label>
      </div>
      <div class="form-group">
        <label class="stub-checkbox-label">
          <input type="checkbox" id="emailBillReminders"
            ${config.emailBillReminders ? 'checked' : ''}
            onchange="handleAppConfigChange('emailBillReminders', this.checked)">
          <span>Bill due-date reminder emails</span>
        </label>
      </div>
      <div class="form-group">
        <label for="billReminderDaysBefore">Remind me this many days before a bill is due</label>
        <input type="number" id="billReminderDaysBefore"
          min="1" max="14" value="${config.billReminderDaysBefore}"
          onchange="handleAppConfigChange('billReminderDaysBefore', parseInt(this.value, 10))">
      </div>
      <p class="text-muted stub-note">Notification delivery is not yet wired to the backend. Selections are saved locally and will be synced once the email preferences API is built.</p>
    </div>
  `;
}

// ── Public Entry Point ────────────────────────────────────────

/**
 * Entry point called by loadSectionContent() in nav.js.
 * Fetches preferences from the backend to ensure the panel
 * reflects the server's view, then renders all setting cards.
 */
async function loadAppConfigSettings() {
  const container = $('#app-config-content');
  const config = await _fetchPreferencesFromServer();

  const html = `
    ${_renderAppearanceCard(config)}
    ${_renderDateFormattingCard(config)}
    ${_renderNumberDisplayCard(config)}
    ${_renderViewDefaultsCard(config)}
    ${_renderNotificationsCard(config)}
    <div id="app-config-message"></div>
  `;

  container.html(html);
}

/**
 * Generic change handler wired directly to every input via
 * inline onchange. PATCHes the update to the server and
 * refreshes the local cache. Shows a brief confirmation.
 *
 * @param {string} key   - APP_CONFIG_DEFAULTS key to update.
 * @param {*}      value - New value for that key.
 */
async function handleAppConfigChange(key, value) {
  const messageEl = $('#app-config-message');

  const result = await _patchPreferencesToServer({ [key]: value });

  if (result) {
    messageEl.html('<div class="message success">Preference saved.</div>');
  } else {
    messageEl.html('<div class="message error">Failed to save — try again.</div>');
  }
  setTimeout(() => messageEl.html(''), 2000);
}
