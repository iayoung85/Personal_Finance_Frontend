// ============================================================
// user-settings/app-config.js — App Configuration Panel
// Renders all global app-level preferences (theme, date
// format, number display, dashboard defaults, notifications).
//
// Storage: localStorage under the key APP_CONFIG_KEY.
// These settings are intentionally client-side only until a
// backend preferences API is built. See the implementation
// plan in docs/page-blueprints/app-config-implementation.md
// for the full server-sync strategy.
// ============================================================

const APP_CONFIG_KEY = 'appConfig';

/**
 * Default values for every configurable preference.
 * Adding a new setting means adding a key here first — the
 * rest of the UI is driven off this object's shape.
 */
const APP_CONFIG_DEFAULTS = {
  // Appearance
  theme: 'dark',                  // 'dark' | 'light'  (light not yet built)

  // Date & time
  dateFormat: 'YYYYMMDD',         // 'YYYYMMDD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'MMM D, YYYY'
  firstDayOfWeek: 'sunday',       // 'sunday' | 'monday'

  // Number & currency display
  currencySymbol: '$',            // '$' | '€' | '£' — cosmetic only, no conversion
  showCents: true,                // whether to always render two decimal places
  useCompactNotation: false,      // 143,200 → 143.2K for large numbers

  // Dashboard & transaction defaults
  defaultDateRange: '30d',        // '7d' | '30d' | '90d' | 'current-month' | 'ytd'
  defaultAccount: 'all',          // 'all' | specific account_id

  // Notifications (stub — no backend wiring yet)
  emailWeeklySummary: false,      // weekly digest email
  emailBillReminders: true,       // reminder N days before a bill is due
  billReminderDaysBefore: 3,      // how many days before due date to send reminder
};

/**
 * Reads the persisted config from localStorage and merges with
 * defaults so new keys added to APP_CONFIG_DEFAULTS are always
 * present even for users who saved a config before the key existed.
 *
 * @returns {Object} Merged config object safe to read from directly.
 */
function readAppConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(APP_CONFIG_KEY) || '{}');
    return { ...APP_CONFIG_DEFAULTS, ...stored };
  } catch {
    return { ...APP_CONFIG_DEFAULTS };
  }
}

/**
 * Persists a partial config update by merging into the existing
 * stored config. Only the keys in `updates` are changed.
 *
 * @param {Object} updates - Partial config object with new values.
 */
function writeAppConfig(updates) {
  const current = readAppConfig();
  localStorage.setItem(APP_CONFIG_KEY, JSON.stringify({ ...current, ...updates }));
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
    { value: 'YYYYMMDD',    label: 'YYYYMMDD',         example: '20260304' },
    { value: 'MM/DD/YYYY',  label: 'MM/DD/YYYY',       example: '03/04/2026' },
    { value: 'DD/MM/YYYY',  label: 'DD/MM/YYYY',       example: '04/03/2026' },
    { value: 'MMM D, YYYY', label: 'MMM D, YYYY',      example: 'Mar 4, 2026' },
    { value: 'YYYY-MM-DD',  label: 'YYYY-MM-DD (ISO)', example: '2026-03-04' },
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
        <p class="text-muted stub-note">Affects date display across all pages once wired to the shared <code>formatDate()</code> helper.</p>
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
    { value: '7d',            label: 'Last 7 days' },
    { value: '30d',           label: 'Last 30 days' },
    { value: '90d',           label: 'Last 90 days' },
    { value: 'current-month', label: 'Current month' },
    { value: 'ytd',           label: 'Year to date' },
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
 * Reads the persisted config, renders all setting cards, and
 * injects the result into #app-config-content.
 */
function loadAppConfigSettings() {
  const container = $('#app-config-content');
  const config = readAppConfig();

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
 * inline onchange. Persists the updated key and shows a brief
 * confirmation message.
 *
 * @param {string} key   - APP_CONFIG_DEFAULTS key to update.
 * @param {*}      value - New value for that key.
 */
function handleAppConfigChange(key, value) {
  writeAppConfig({ [key]: value });

  const messageEl = $('#app-config-message');
  messageEl.html('<div class="message success">Preference saved.</div>');
  setTimeout(() => messageEl.html(''), 2000);
}
