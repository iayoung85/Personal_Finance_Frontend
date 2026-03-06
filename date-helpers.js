// ============================================================
// date-helpers.js — Shared Date Formatting & Input Helpers
//
// Loaded on every page BEFORE page-specific scripts.
// Provides a single source of truth for date display format
// and date input parsing/auto-formatting across the app.
//
// Display format is driven by the user's App Configuration
// preference stored in localStorage under 'appConfig'.
//
// All date inputs across the app should be <input type="text">
// with the class "date-input". This module auto-formats on
// blur: the user types "20260304" (or "03042026" depending
// on their input format preference) and the field normalizes
// to "2026-03-04".
// ============================================================

/**
 * Read the user's preferred date display format from localStorage.
 * Falls back to 'YYYY-MM-DD' when nothing is stored.
 *
 * @returns {string} One of the format keys from APP_CONFIG_DEFAULTS.
 */
function _getDateFormatPreference() {
  try {
    const stored = JSON.parse(localStorage.getItem('appConfig') || '{}');
    return stored.dateFormat || 'YYYY-MM-DD';
  } catch {
    return 'YYYY-MM-DD';
  }
}

/**
 * Read the user's preferred date INPUT format (digit entry order).
 * 'YYYYMMDD' = year-first (default), 'MMDDYYYY' = month-first.
 *
 * @returns {'YYYYMMDD'|'MMDDYYYY'}
 */
function _getDateInputFormatPreference() {
  try {
    const stored = JSON.parse(localStorage.getItem('appConfig') || '{}');
    return stored.dateInputFormat || 'YYYYMMDD';
  } catch {
    return 'YYYYMMDD';
  }
}

/**
 * Returns the placeholder string matching the user's input format.
 * @returns {string}
 */
function _getDateInputPlaceholder() {
  return _getDateInputFormatPreference() === 'MMDDYYYY' ? 'MMDDYYYY' : 'YYYYMMDD';
}

/**
 * Format an ISO date string (or Date object) for display using
 * the user's preferred format from App Configuration.
 *
 * @param {string|Date} rawDate - ISO date string ('2026-03-04') or Date.
 * @returns {string} Formatted date string, or '—' if input is falsy/invalid.
 */
function formatDate(rawDate) {
  if (!rawDate) return '—';

  // Interpret date strings as local midnight, not UTC
  const date = rawDate instanceof Date
    ? rawDate
    : new Date(rawDate + (typeof rawDate === 'string' && !rawDate.includes('T') ? 'T00:00:00' : ''));

  if (Number.isNaN(date.getTime())) return String(rawDate);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const preference = _getDateFormatPreference();

  switch (preference) {
    case 'YYYY-MM-DD':  return `${year}-${month}-${day}`;
    case 'MM/DD/YYYY':  return `${month}/${day}/${year}`;
    case 'DD/MM/YYYY':  return `${day}/${month}/${year}`;
    case 'MMM D, YYYY': return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${year}`;
    default:            return `${year}-${month}-${day}`;
  }
}

/**
 * Convert a Date to an ISO YYYY-MM-DD string (always, regardless
 * of the user's display preference). Used for API payloads, value
 * attributes on inputs, and internal comparisons.
 *
 * @param {Date} date - Date object.
 * @returns {string} 'YYYY-MM-DD' string.
 */
function toISODateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Shorthand: today's date as an ISO YYYY-MM-DD string.
 * Replaces scattered `new Date().toISOString().split('T')[0]` calls.
 *
 * @returns {string} e.g. '2026-03-05'
 */
function todayISO() {
  return toISODateStr(new Date());
}

/**
 * Parse a user-typed date string in multiple formats into a Date.
 *
 * Compact 8-digit input (no separators) is interpreted according
 * to the user's dateInputFormat preference:
 *   - 'YYYYMMDD' → 20260304 = 2026-03-04
 *   - 'MMDDYYYY' → 03042026 = 2026-03-04
 *
 * Separated formats are always accepted regardless of preference:
 *   - YYYY-MM-DD   (2026-03-04) — ISO with dashes
 *   - M/D/YYYY     (3/4/2026)   — US format with slashes
 *
 * Uses `new Date(year, month-1, day)` so invalid dates roll forward
 * (e.g. Feb 29 on a non-leap year → Mar 1). Returns null only for
 * completely unparseable input.
 *
 * @param {string} rawInput - User-typed date string (untrimmed is OK).
 * @returns {Date|null} Parsed Date or null if unparseable.
 */
function parseDateInput(rawInput) {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return null;

  // 8-digit compact input — order depends on user's input format preference
  const compactMatch = trimmed.match(/^(\d{8})$/);
  if (compactMatch) {
    const inputFormat = _getDateInputFormatPreference();
    let year, month, day;

    if (inputFormat === 'MMDDYYYY') {
      month = parseInt(trimmed.substring(0, 2), 10);
      day   = parseInt(trimmed.substring(2, 4), 10);
      year  = parseInt(trimmed.substring(4, 8), 10);
    } else {
      year  = parseInt(trimmed.substring(0, 4), 10);
      month = parseInt(trimmed.substring(4, 6), 10);
      day   = parseInt(trimmed.substring(6, 8), 10);
    }

    if (month < 1 || month > 12 || day < 1) return null;
    return new Date(year, month - 1, day);
  }

  // YYYY-MM-DD — ISO with dashes
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const year  = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day   = parseInt(isoMatch[3], 10);
    if (month < 1 || month > 12 || day < 1) return null;
    return new Date(year, month - 1, day);
  }

  // M/D/YYYY — US slashes
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day   = parseInt(slashMatch[2], 10);
    const year  = parseInt(slashMatch[3], 10);
    if (month < 1 || month > 12 || day < 1) return null;
    return new Date(year, month - 1, day);
  }

  return null;
}

/**
 * Auto-format a date input's value on blur: whatever the user
 * typed is parsed and normalized to YYYY-MM-DD for storage.
 *
 * Attaches to a single <input> element. Idempotent — safe to
 * call multiple times on the same element.
 *
 * @param {HTMLInputElement} inputEl - The text input to watch.
 */
function autoFormatDateInput(inputEl) {
  if (!inputEl || inputEl.dataset.dateAutoFormatWired) return;
  inputEl.dataset.dateAutoFormatWired = 'true';

  // Set placeholder to match the user's input format preference
  inputEl.placeholder = _getDateInputPlaceholder();

  // Select all on focus so the user can immediately start typing a new date
  inputEl.addEventListener('focus', () => inputEl.select());

  inputEl.addEventListener('blur', () => {
    const raw = inputEl.value.trim();
    if (!raw) return;

    const parsed = parseDateInput(raw);
    if (parsed && !Number.isNaN(parsed.getTime())) {
      inputEl.value = toISODateStr(parsed);
    }
  });
}

/**
 * Find all <input> elements with the class "date-input" inside
 * the given container (or document) and wire auto-formatting.
 * Also used after dynamic DOM injection (modals, inline editors).
 *
 * @param {HTMLElement} [container=document] - Scope to search in.
 */
function wireDateInputs(container) {
  const scope = container || document;
  scope.querySelectorAll('input.date-input').forEach(autoFormatDateInput);
}

/**
 * Update placeholder text on all wired date inputs to reflect
 * the current input format preference. Called when the user
 * changes the "Date Input Order" setting in App Configuration.
 */
function refreshDateInputPlaceholders() {
  const placeholder = _getDateInputPlaceholder();
  document.querySelectorAll('input.date-input').forEach(inputEl => {
    inputEl.placeholder = placeholder;
  });
}

/**
 * Wire auto-formatting once the DOM is ready.
 * Pages that inject date inputs dynamically (modals, inline rows)
 * should call wireDateInputs(container) after injection.
 */
document.addEventListener('DOMContentLoaded', () => {
  wireDateInputs();
});
