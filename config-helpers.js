// ============================================================
// config-helpers.js — Shared App Configuration Reader
//
// Loaded on every page AFTER config.js and BEFORE date-helpers.js.
// Provides getAppConfig() — the single read path for user
// preferences throughout the app. All modules should call
// getAppConfig() instead of parsing localStorage directly.
//
// The cache is populated in two ways:
//   1. On pages without the settings panel — from localStorage
//      (written during the last settings-page visit or login).
//   2. On the user-settings page — app-config.js calls
//      syncAppConfigFromServer() which fetches from the API,
//      merges with defaults, and writes to localStorage.
// ============================================================

const APP_CONFIG_KEY = 'appConfig';

const APP_CONFIG_DEFAULTS = {
  theme: 'dark',
  dateFormat: 'YYYY-MM-DD',
  dateInputFormat: 'YYYYMMDD',
  firstDayOfWeek: 'sunday',
  currencySymbol: '$',
  showCents: true,
  useCompactNotation: false,
  defaultDateRange: '30d',
  defaultAccount: 'all',
  emailWeeklySummary: false,
  emailBillReminders: true,
  billReminderDaysBefore: 3,
};

/**
 * Returns the current app config merged with defaults.
 * Reads from the localStorage cache — fast, synchronous,
 * safe to call from any render path.
 *
 * @returns {Object} Full config object with all keys guaranteed present.
 */
function getAppConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(APP_CONFIG_KEY) || '{}');
    return { ...APP_CONFIG_DEFAULTS, ...stored };
  } catch {
    return { ...APP_CONFIG_DEFAULTS };
  }
}
