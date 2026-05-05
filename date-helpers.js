// ============================================================
// date-helpers.js — Shared Date Formatting & Input Helpers
//
// Loaded on every page AFTER config-helpers.js.
// Provides a single source of truth for date display format
// and date input parsing/auto-formatting across the app.
//
// Display format is driven by the user's App Configuration
// preference accessed via getAppConfig() from config-helpers.js.
//
// All date inputs across the app should be <input type="text">
// with the class "date-input". This module auto-formats on
// blur: the user types "20260304" (or "03042026" depending
// on their input format preference) and the field normalizes
// to "2026-03-04".
// ============================================================

/**
 * Read the user's preferred date display format.
 * Falls back to 'YYYY-MM-DD' when nothing is stored.
 *
 * @returns {string} One of the format keys from APP_CONFIG_DEFAULTS.
 */
function _getDateFormatPreference() {
  return getAppConfig().dateFormat || 'YYYY-MM-DD';
}

/**
 * Read the user's preferred date INPUT format (digit entry order).
 * 'YYYYMMDD' = year-first (default), 'MMDDYYYY' = month-first.
 *
 * @returns {'YYYYMMDD'|'MMDDYYYY'}
 */
function _getDateInputFormatPreference() {
  const pref = getAppConfig().dateInputFormat || 'YYYYMMDD';
  return pref === 'SEGMENTED' ? 'MMDDYYYY' : pref;
}

/**
 * Returns the placeholder string matching the user's input format.
 * @returns {string}
 */
function _getDateInputPlaceholder() {
  return _getDateInputFormatPreference() === 'YYYYMMDD'
    ? 'YYYY / MM / DD'
    : 'MM / DD / YYYY';
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

// ── Segmented Date Input ──────────────────────────────────────
//
// Arrow-key-friendly date entry. Two layouts share the same
// interaction model — only the visual order differs:
//   MMDDYYYY  →  MM / DD / YYYY   (month-first, the default)
//   YYYYMMDD  →  YYYY / MM / DD   (year-first)
//
// Left/Right arrows navigate segments, Up/Down change values,
// digit keys overwrite the active segment then auto-advance.
// On blur the value normalizes to YYYY-MM-DD for storage.
// ───────────────────────────────────────────────────────────────

/**
 * Layout definitions for the two segmented modes.
 *
 * Each layout describes the visual order of the three fields
 * (month, day, year) in the text box, the character offsets
 * for programmatic selection, and a builder function that
 * assembles the display string.
 *
 * `segmentTypes` maps positional indices (0, 1, 2) to the
 * data field they represent so the shared keydown handler can
 * apply the right logic regardless of layout order.
 */
const _SEGMENTED_LAYOUTS = {
  MMDDYYYY: {
    segmentTypes:  ['month', 'day', 'year'],
    segmentRanges: [
      { start: 0,  end: 2  },   // MM   (indices 0–1)
      { start: 5,  end: 7  },   // DD   (indices 5–6)
      { start: 10, end: 14 },   // YYYY (indices 10–13)
    ],
    buildDisplay(month, day, year) {
      const monthStr = String(month).padStart(2, '0');
      const dayStr   = String(day).padStart(2, '0');
      const yearStr  = String(year).padStart(4, '0');
      return `${monthStr} / ${dayStr} / ${yearStr}`;
    },
  },
  YYYYMMDD: {
    segmentTypes:  ['year', 'month', 'day'],
    segmentRanges: [
      { start: 0,  end: 4  },   // YYYY (indices 0–3)
      { start: 7,  end: 9  },   // MM   (indices 7–8)
      { start: 12, end: 14 },   // DD   (indices 12–13)
    ],
    buildDisplay(month, day, year) {
      const monthStr = String(month).padStart(2, '0');
      const dayStr   = String(day).padStart(2, '0');
      const yearStr  = String(year).padStart(4, '0');
      return `${yearStr} / ${monthStr} / ${dayStr}`;
    },
  },
};

/**
 * Returns the number of days in a given month/year.
 * @param {number} month - 1-based month (1 = January).
 * @param {number} year  - Full four-digit year.
 * @returns {number}
 */
function _maxDaysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

/**
 * Clamp a day value to the valid range for the given month/year.
 * @param {number} day
 * @param {number} month - 1-based.
 * @param {number} year
 * @returns {number}
 */
function _clampDay(day, month, year) {
  const maxDay = _maxDaysInMonth(month, year);
  if (day < 1) return 1;
  return day > maxDay ? maxDay : day;
}

/**
 * Parse a YYYY-MM-DD value (or today if blank) into {month, day, year}.
 * @param {string} isoValue
 * @returns {{month: number, day: number, year: number}}
 */
function _parseISOToParts(isoValue) {
  const trimmed = (isoValue || '').trim();
  const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return {
      year:  parseInt(match[1], 10),
      month: parseInt(match[2], 10),
      day:   parseInt(match[3], 10),
    };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * Wires the segmented date input behavior onto a single element.
 * The layout (MMDDYYYY or YYYYMMDD) determines segment order.
 * All state is tracked per-element via a closure so multiple
 * date inputs on the same page stay independent.
 *
 * @param {HTMLInputElement} inputEl
 * @param {Object} layout - One of the _SEGMENTED_LAYOUTS entries.
 */
function _wireSegmentedDateInput(inputEl, layout, options = {}) {
  const { segmentTypes, segmentRanges, buildDisplay } = layout;

  let activeSegment = 0;
  let digitBuffer   = '';
  let parts = { month: 0, day: 0, year: 0 };

  function _normalizeISOValue(isoValue) {
    if (typeof options.normalizeISOValue !== 'function') return isoValue;
    return options.normalizeISOValue(isoValue) || isoValue;
  }

  function _currentISOValueFromParts() {
    const yearStr = String(parts.year).padStart(4, '0');
    const monthStr = String(parts.month).padStart(2, '0');
    const dayStr = String(parts.day).padStart(2, '0');
    return `${yearStr}-${monthStr}-${dayStr}`;
  }

  function _syncISOValueFromParts({ normalize = false, reason = '' } = {}) {
    const rawValue = _currentISOValueFromParts();
    const nextValue = normalize ? _normalizeISOValue(rawValue) : rawValue;

    if (normalize && rawValue !== nextValue) {
      inputEl.dataset.lastNormalizedFrom = rawValue;
      inputEl.dataset.lastNormalizedTo = nextValue;
      inputEl.dataset.lastNormalizedReason = reason;
    } else {
      delete inputEl.dataset.lastNormalizedFrom;
      delete inputEl.dataset.lastNormalizedTo;
      delete inputEl.dataset.lastNormalizedReason;
    }

    const normalizedDate = parseDateInput(nextValue);
    if (normalize && normalizedDate && !Number.isNaN(normalizedDate.getTime())) {
      parts = {
        year: normalizedDate.getFullYear(),
        month: normalizedDate.getMonth() + 1,
        day: normalizedDate.getDate(),
      };
    }
    inputEl.dataset.isoValue = nextValue;
  }

  /** Which data field the currently-active visual segment controls. */
  function _activeType() {
    return segmentTypes[activeSegment];
  }

  /** How many digits the active segment accepts before auto-advancing. */
  function _maxDigitsForSegment() {
    return _activeType() === 'year' ? 4 : 2;
  }

  /** Highlight (select) the active segment in the text box. */
  function _highlight() {
    const range = segmentRanges[activeSegment];
    requestAnimationFrame(() => {
      inputEl.setSelectionRange(range.start, range.end);
    });
  }

  /** Rewrite the visible value from `parts` and highlight. */
  function _render() {
    parts.day = _clampDay(parts.day, parts.month, parts.year);
    _syncISOValueFromParts();
    inputEl.value = buildDisplay(parts.month, parts.day, parts.year);
    _highlight();
  }

  /** Commit a partially-typed digit buffer into the active segment. */
  function _commitBuffer() {
    if (!digitBuffer) return;
    const numericValue = parseInt(digitBuffer, 10) || 0;
    const type = _activeType();

    if (type === 'month') {
      parts.month = Math.max(1, Math.min(12, numericValue));
    } else if (type === 'day') {
      parts.day = _clampDay(numericValue || 1, parts.month, parts.year);
    } else {
      parts.year = Math.max(1900, Math.min(2099, numericValue));
    }
    digitBuffer = '';
    _syncISOValueFromParts();
  }

  /** Move to a different segment, committing pending digits first. */
  function _moveTo(newSegment) {
    _commitBuffer();
    activeSegment = Math.max(0, Math.min(2, newSegment));
    digitBuffer = '';
    _render();
  }

  // ── Focus: parse existing ISO value, enter segmented display ──
  inputEl.addEventListener('focus', () => {
    // Prefer the stashed ISO value since the visible .value may be
    // in display format (e.g. "04 / 07 / 2026") after initial wiring.
    const source = inputEl.dataset.isoValue || inputEl.value;
    parts = _parseISOToParts(source);
    activeSegment = 0;
    digitBuffer = '';
    _render();
  });

  // ── Click: detect which segment was clicked ──
  inputEl.addEventListener('mouseup', (event) => {
    event.preventDefault();
    const cursorPos = inputEl.selectionStart;
    if (cursorPos <= segmentRanges[0].end + 1) {
      _moveTo(0);
    } else if (cursorPos <= segmentRanges[1].end + 1) {
      _moveTo(1);
    } else {
      _moveTo(2);
    }
  });

  // ── Keyboard: arrow navigation, digit entry, increment/decrement ──
  inputEl.addEventListener('keydown', (event) => {
    const key = event.key;

    // Let Tab / Shift+Tab move to the next/previous field naturally.
    // We only commit any partially typed segment before focus leaves.
    if (key === 'Tab') {
      _commitBuffer();
      return;
    }

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
         'Backspace', 'Delete'].includes(key)
        || (key >= '0' && key <= '9')) {

      event.preventDefault();
    } else if (key === 'Enter') {
      _commitBuffer();
      _render();
      inputEl.blur();
      return;
    } else {
      event.preventDefault();
      return;
    }

    // ── Arrow navigation ──
    if (key === 'ArrowLeft') {
      if (activeSegment > 0) _moveTo(activeSegment - 1);
      return;
    }
    if (key === 'ArrowRight') {
      if (activeSegment < 2) _moveTo(activeSegment + 1);
      return;
    }

    // ── Increment / Decrement ──
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      _commitBuffer();
      if (options.useWholeDateArrowStep) {
        const direction = key === 'ArrowUp' ? 1 : -1;
        const currentDate = parseDateInput(inputEl.dataset.isoValue || _currentISOValueFromParts());
        if (!currentDate || Number.isNaN(currentDate.getTime())) return;

        currentDate.setDate(currentDate.getDate() + direction);
        parts = {
          year: currentDate.getFullYear(),
          month: currentDate.getMonth() + 1,
          day: currentDate.getDate(),
        };
        _syncISOValueFromParts({ normalize: true, reason: 'arrow-step' });
        inputEl.value = buildDisplay(parts.month, parts.day, parts.year);
        _highlight();
        return;
      }

      const direction = key === 'ArrowUp' ? 1 : -1;
      const type = _activeType();

      if (type === 'month') {
        parts.month += direction;
        if (parts.month > 12) parts.month = 1;
        if (parts.month < 1)  parts.month = 12;
      } else if (type === 'day') {
        const maxDay = _maxDaysInMonth(parts.month, parts.year);
        parts.day += direction;
        if (parts.day > maxDay) parts.day = 1;
        if (parts.day < 1)     parts.day = maxDay;
      } else {
        parts.year = Math.max(1900, Math.min(2099, parts.year + direction));
      }

      _render();
      return;
    }

    // ── Backspace / Delete: reset the active segment ──
    if (key === 'Backspace' || key === 'Delete') {
      digitBuffer = '';
      const type = _activeType();
      if (type === 'month')    parts.month = 1;
      else if (type === 'day') parts.day = 1;
      else                     parts.year = new Date().getFullYear();
      _render();
      return;
    }

    // ── Digit entry ──
    if (key >= '0' && key <= '9') {
      digitBuffer += key;
      const maxDigits = _maxDigitsForSegment();
      const type = _activeType();

      if (type === 'month') {
        const tentativeMonth = parseInt(digitBuffer, 10);
        // First digit 2–9 can only be a single-digit month → advance immediately
        if (digitBuffer.length === 1 && tentativeMonth >= 2) {
          parts.month = tentativeMonth;
          digitBuffer = '';
          _render();
          if (activeSegment < 2) _moveTo(activeSegment + 1);
          return;
        }
        if (digitBuffer.length >= maxDigits) {
          parts.month = Math.max(1, Math.min(12, tentativeMonth));
          digitBuffer = '';
          _render();
          if (activeSegment < 2) _moveTo(activeSegment + 1);
          return;
        }
        parts.month = tentativeMonth || parts.month;
        _render();

      } else if (type === 'day') {
        const tentativeDay = parseInt(digitBuffer, 10);
        const maxDay = _maxDaysInMonth(parts.month, parts.year);
        // First digit too high for a valid two-digit day → advance immediately
        if (digitBuffer.length === 1 && tentativeDay > Math.floor(maxDay / 10)) {
          parts.day = _clampDay(tentativeDay, parts.month, parts.year);
          digitBuffer = '';
          _render();
          if (activeSegment < 2) _moveTo(activeSegment + 1);
          return;
        }
        if (digitBuffer.length >= maxDigits) {
          parts.day = _clampDay(tentativeDay, parts.month, parts.year);
          digitBuffer = '';
          _render();
          if (activeSegment < 2) _moveTo(activeSegment + 1);
          return;
        }
        parts.day = tentativeDay || parts.day;
        _render();

      } else {
        // Year segment — no early-advance, always waits for 4 digits
        const tentativeYear = parseInt(digitBuffer, 10);
        if (digitBuffer.length >= maxDigits) {
          parts.year = Math.max(1900, Math.min(2099, tentativeYear));
          digitBuffer = '';
          _render();
          // Auto-advance to next segment if not the last
          if (activeSegment < 2) _moveTo(activeSegment + 1);
          return;
        }
        // Show partial year while typing
        inputEl.value = buildDisplay(parts.month, parts.day, tentativeYear);
        _highlight();
      }

      return;
    }
  });

  // ── Blur: stash canonical ISO value for programmatic reads,
  //    display the user's preferred format visually ──
  inputEl.addEventListener('blur', () => {
    _commitBuffer();
    parts.day = _clampDay(parts.day, parts.month, parts.year);
    _syncISOValueFromParts({ normalize: true, reason: 'blur' });
    inputEl.value = buildDisplay(parts.month, parts.day, parts.year);
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // Pasted text is parsed and loaded into the segments
  inputEl.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData).getData('text');
    const parsed = parseDateInput(pasted);
    if (parsed && !Number.isNaN(parsed.getTime())) {
      parts = {
        year:  parsed.getFullYear(),
        month: parsed.getMonth() + 1,
        day:   parsed.getDate(),
      };
      _render();
    }
  });
}

// ── Auto-format / Segmented Wiring ────────────────────────────

/**
 * Read the ISO YYYY-MM-DD value from a .date-input element.
 * Because the visible .value is now in the user's display format,
 * code that needs the canonical ISO date should call this instead
 * of reading .value directly.
 *
 * Falls back to .value for non-segmented inputs or when the
 * data attribute hasn't been set yet (first render).
 *
 * @param {HTMLInputElement|string} elOrId - Element or its DOM id.
 * @returns {string} ISO date string (YYYY-MM-DD) or raw value.
 */
function getDateInputValue(elOrId) {
  const el = typeof elOrId === 'string'
    ? document.getElementById(elOrId)
    : elOrId;
  if (!el) return '';
  return el.dataset.isoValue || el.value;
}

/**
 * Wires segmented date input behavior onto a single <input>.
 * The layout (month-first or year-first) is chosen from the
 * user's dateInputFormat preference.
 *
 * Idempotent — safe to call multiple times on the same element.
 *
 * @param {HTMLInputElement} inputEl - The text input to watch.
 */
function autoFormatDateInput(inputEl, options = {}) {
  if (!inputEl || inputEl.dataset.dateAutoFormatWired) return;
  inputEl.dataset.dateAutoFormatWired = 'true';

  inputEl.placeholder = _getDateInputPlaceholder();

  const pref = _getDateInputFormatPreference();
  const layout = _SEGMENTED_LAYOUTS[pref] || _SEGMENTED_LAYOUTS.MMDDYYYY;

  // Format any pre-populated value so the user sees their preferred
  // layout immediately, not raw ISO. The blur handler normalizes
  // back to YYYY-MM-DD when the field loses focus.
  if (inputEl.value) {
    const initParts = _parseISOToParts(inputEl.value);
    if (initParts.year && initParts.month && initParts.day) {
      // Stash the canonical ISO value so focus can always recover it
      const yearStr  = String(initParts.year).padStart(4, '0');
      const monthStr = String(initParts.month).padStart(2, '0');
      const dayStr   = String(initParts.day).padStart(2, '0');
      const initialIsoValue = `${yearStr}-${monthStr}-${dayStr}`;
      const normalizedIsoValue = typeof options.normalizeISOValue === 'function'
        ? (options.normalizeISOValue(initialIsoValue) || initialIsoValue)
        : initialIsoValue;
      const normalizedParts = _parseISOToParts(normalizedIsoValue);
      inputEl.dataset.isoValue = normalizedIsoValue;
      inputEl.value = layout.buildDisplay(normalizedParts.month, normalizedParts.day, normalizedParts.year);
    }
  }

  _wireSegmentedDateInput(inputEl, layout, options);
}

/**
 * Programmatically set the value of a segmented date input.
 * Updates both the canonical ISO data attribute and the visual
 * display so the next focus cycle picks up the new value.
 *
 * @param {HTMLInputElement|string} elOrId - Element or its DOM id.
 * @param {string} isoValue - YYYY-MM-DD string.
 */
function setDateInputValue(elOrId, isoValue) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.dataset.isoValue = isoValue;
  if (el.dataset.dateAutoFormatWired) {
    const pref = _getDateInputFormatPreference();
    const layout = _SEGMENTED_LAYOUTS[pref] || _SEGMENTED_LAYOUTS.MMDDYYYY;
    const parts = _parseISOToParts(isoValue);
    el.value = layout.buildDisplay(parts.month, parts.day, parts.year);
  } else {
    el.value = isoValue;
  }
}

// ── Month/Year Segmented Input ────────────────────────────────
//
// A two-segment variant for inputs that only need Month + Year.
// Used where the day-of-month is chosen via a separate dropdown
// (e.g. bill creation for monthly/twice_monthly frequencies).
//
// Same interaction model as the full date segmented input:
// Left/Right arrows navigate, Up/Down change values,
// digit keys overwrite then auto-advance.
// On blur the value normalizes to YYYY-MM for storage.
// ───────────────────────────────────────────────────────────────

const _MONTH_YEAR_LAYOUTS = {
  MMDDYYYY: {
    segmentTypes:  ['month', 'year'],
    segmentRanges: [
      { start: 0, end: 2 },    // MM   (indices 0–1)
      { start: 5, end: 9 },    // YYYY (indices 5–8)
    ],
    buildDisplay(month, year) {
      const monthStr = String(month).padStart(2, '0');
      const yearStr  = String(year).padStart(4, '0');
      return `${monthStr} / ${yearStr}`;
    },
  },
  YYYYMMDD: {
    segmentTypes:  ['year', 'month'],
    segmentRanges: [
      { start: 0, end: 4 },    // YYYY (indices 0–3)
      { start: 7, end: 9 },    // MM   (indices 7–8)
    ],
    buildDisplay(month, year) {
      const monthStr = String(month).padStart(2, '0');
      const yearStr  = String(year).padStart(4, '0');
      return `${yearStr} / ${monthStr}`;
    },
  },
};

function _wireSegmentedMonthYearInput(inputEl, layout) {
  const { segmentTypes, segmentRanges, buildDisplay } = layout;

  let activeSegment = 0;
  let digitBuffer   = '';
  let parts = { month: 0, year: 0 };

  function _activeType() {
    return segmentTypes[activeSegment];
  }

  function _maxDigitsForSegment() {
    return _activeType() === 'year' ? 4 : 2;
  }

  function _highlight() {
    const range = segmentRanges[activeSegment];
    requestAnimationFrame(() => {
      inputEl.setSelectionRange(range.start, range.end);
    });
  }

  function _render() {
    inputEl.value = buildDisplay(parts.month, parts.year);
    _highlight();
  }

  function _commitBuffer() {
    if (!digitBuffer) return;
    const numericValue = parseInt(digitBuffer, 10) || 0;
    const type = _activeType();
    if (type === 'month') {
      parts.month = Math.max(1, Math.min(12, numericValue));
    } else {
      parts.year = Math.max(1900, Math.min(2099, numericValue));
    }
    digitBuffer = '';
  }

  function _moveTo(newSegment) {
    _commitBuffer();
    activeSegment = Math.max(0, Math.min(1, newSegment));
    digitBuffer = '';
    _render();
  }

  function _parseMonthYear(value) {
    const trimmed = (value || '').trim();
    const fullMatch = trimmed.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
    if (fullMatch) {
      return {
        year:  parseInt(fullMatch[1], 10),
        month: parseInt(fullMatch[2], 10),
      };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  inputEl.addEventListener('focus', () => {
    const source = inputEl.dataset.isoValue || inputEl.value;
    parts = _parseMonthYear(source);
    activeSegment = 0;
    digitBuffer = '';
    _render();
  });

  inputEl.addEventListener('mouseup', (event) => {
    event.preventDefault();
    const cursorPos = inputEl.selectionStart;
    if (cursorPos <= segmentRanges[0].end + 1) {
      _moveTo(0);
    } else {
      _moveTo(1);
    }
  });

  inputEl.addEventListener('keydown', (event) => {
    const key = event.key;

    if (key === 'Tab') {
      _commitBuffer();
      return;
    }

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
         'Backspace', 'Delete'].includes(key)
        || (key >= '0' && key <= '9')) {
      event.preventDefault();
    } else if (key === 'Enter') {
      _commitBuffer();
      _render();
      inputEl.blur();
      return;
    } else {
      event.preventDefault();
      return;
    }

    if (key === 'ArrowLeft') {
      if (activeSegment > 0) _moveTo(activeSegment - 1);
      return;
    }
    if (key === 'ArrowRight') {
      if (activeSegment < 1) _moveTo(activeSegment + 1);
      return;
    }

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      _commitBuffer();
      const direction = key === 'ArrowUp' ? 1 : -1;
      const type = _activeType();
      if (type === 'month') {
        parts.month += direction;
        if (parts.month > 12) { parts.month = 1; parts.year++; }
        if (parts.month < 1)  { parts.month = 12; parts.year--; }
      } else {
        parts.year = Math.max(1900, Math.min(2099, parts.year + direction));
      }
      _render();
      return;
    }

    if (key === 'Backspace' || key === 'Delete') {
      digitBuffer = '';
      const type = _activeType();
      if (type === 'month') parts.month = 1;
      else                  parts.year = new Date().getFullYear();
      _render();
      return;
    }

    if (key >= '0' && key <= '9') {
      digitBuffer += key;
      const maxDigits = _maxDigitsForSegment();
      const type = _activeType();

      if (type === 'month') {
        const tentativeMonth = parseInt(digitBuffer, 10);
        if (digitBuffer.length === 1 && tentativeMonth >= 2) {
          parts.month = tentativeMonth;
          digitBuffer = '';
          _render();
          if (activeSegment < 1) _moveTo(activeSegment + 1);
          return;
        }
        if (digitBuffer.length >= maxDigits) {
          parts.month = Math.max(1, Math.min(12, tentativeMonth));
          digitBuffer = '';
          _render();
          if (activeSegment < 1) _moveTo(activeSegment + 1);
          return;
        }
        parts.month = tentativeMonth || parts.month;
        _render();
      } else {
        const tentativeYear = parseInt(digitBuffer, 10);
        if (digitBuffer.length >= maxDigits) {
          parts.year = Math.max(1900, Math.min(2099, tentativeYear));
          digitBuffer = '';
          _render();
          return;
        }
        inputEl.value = buildDisplay(parts.month, tentativeYear);
        _highlight();
      }
      return;
    }
  });

  inputEl.addEventListener('blur', () => {
    _commitBuffer();
    const yearStr  = String(parts.year).padStart(4, '0');
    const monthStr = String(parts.month).padStart(2, '0');
    inputEl.dataset.isoValue = `${yearStr}-${monthStr}`;
    inputEl.value = buildDisplay(parts.month, parts.year);
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  });

  inputEl.addEventListener('paste', (event) => {
    event.preventDefault();
    const pasted = (event.clipboardData || window.clipboardData).getData('text');
    const parsed = _parseMonthYear(pasted);
    if (parsed) {
      parts = parsed;
      _render();
    }
  });
}

/**
 * Wire month/year segmented input behavior onto a single <input>.
 * Idempotent — safe to call multiple times on the same element.
 *
 * @param {HTMLInputElement} inputEl - The text input to watch.
 */
function autoFormatMonthYearInput(inputEl) {
  if (!inputEl || inputEl.dataset.monthYearWired) return;
  inputEl.dataset.monthYearWired = 'true';

  const pref = _getDateInputFormatPreference();
  const layout = _MONTH_YEAR_LAYOUTS[pref] || _MONTH_YEAR_LAYOUTS.MMDDYYYY;
  inputEl.placeholder = pref === 'YYYYMMDD' ? 'YYYY / MM' : 'MM / YYYY';

  if (inputEl.value) {
    const trimmed = (inputEl.value || '').trim();
    const match = trimmed.match(/^(\d{4})-(\d{1,2})/);
    if (match) {
      const year  = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      inputEl.dataset.isoValue = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
      inputEl.value = layout.buildDisplay(month, year);
    }
  }

  _wireSegmentedMonthYearInput(inputEl, layout);
}

/**
 * Read the canonical YYYY-MM value from a month/year segmented input.
 *
 * @param {HTMLInputElement|string} elOrId - Element or its DOM id.
 * @returns {string} YYYY-MM string or raw value.
 */
function getMonthYearInputValue(elOrId) {
  const el = typeof elOrId === 'string'
    ? document.getElementById(elOrId)
    : elOrId;
  if (!el) return '';
  return el.dataset.isoValue || el.value;
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
