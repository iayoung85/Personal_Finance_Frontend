// ============================================================
// excel/cells.js — what each report cell becomes on a sheet
//
// The workbook was built on pastes of the copied report text, and
// Excel typed those cells as it pasted them: an all-digit mask
// became a number, a month header a real date, an amount a number.
// The workbook's lookups depend on those types (a number never
// matches text), so the add-in writes the same types on purpose
// instead of leaving it to Excel's guessing.
//
// Pure functions; reads the report-grid cell shapes from
// shared/report-grid.js but calls nothing in it.
// ============================================================

const EXCEL_KIND_EMPTY = 'empty';
const EXCEL_KIND_TEXT = 'text';
const EXCEL_KIND_NUMBER = 'number';
const EXCEL_KIND_DATE = 'date';

const EXCEL_TEXT_FORMAT = '@';
const EXCEL_GENERAL_FORMAT = 'General';
const EXCEL_DATE_FORMAT = 'm/d/yyyy';

// Excel stores a date as days since 30 December 1899 (its 1900 date system,
// counted so that 1 March 1900 onward is right, which covers every report).
const _EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const _MS_PER_DAY = 86400000;

// Excel keeps 15 significant digits; a longer digit string would lose its
// tail as a number, so it stays text.
const _EXCEL_MAX_EXACT_DIGITS = 15;

const _ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const _ISO_MONTH_PATTERN = /^(\d{4})-(\d{2})(?:-\d{2})?$/;
const _US_DATE_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/;

// ── Addresses ────────────────────────────────────────────────

/**
 * Column letters for a zero-based column index: 0 is A, 25 is Z, 26 is AA.
 *
 * @param {number} columnIndex
 * @returns {string}
 */
function excelColumnLetter(columnIndex) {
  let remaining = columnIndex + 1;
  let letters = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + digit) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/**
 * A1-style address of one cell from zero-based indexes.
 *
 * @param {number} rowIndex
 * @param {number} columnIndex
 * @returns {string}
 */
function excelCellAddress(rowIndex, columnIndex) {
  return `${excelColumnLetter(columnIndex)}${rowIndex + 1}`;
}

/**
 * A1-style address of the block that starts at A1 and spans the given size.
 *
 * @param {number} rowCount - at least 1
 * @param {number} columnCount - at least 1
 * @returns {string}
 */
function excelBlockAddress(rowCount, columnCount) {
  return `A1:${excelCellAddress(rowCount - 1, columnCount - 1)}`;
}

// ── Dates ────────────────────────────────────────────────────

/**
 * Excel's date number for an ISO date.
 *
 * @param {string} isoDate - YYYY-MM-DD
 * @returns {number|null} null when the text is not an ISO date
 */
function excelSerialFromIsoDate(isoDate) {
  const match = _ISO_DATE_PATTERN.exec(String(isoDate));
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((utc - _EXCEL_EPOCH_UTC) / _MS_PER_DAY);
}

/**
 * The ISO date of an Excel date number. A fraction (a time of day) is dropped.
 *
 * @param {number} serial
 * @returns {string} YYYY-MM-DD
 */
function isoDateFromExcelSerial(serial) {
  const date = new Date(_EXCEL_EPOCH_UTC + Math.floor(serial) * _MS_PER_DAY);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The month a header cell names, read the ways a report header reaches a
 * sheet: an Excel date number (a pasted balance header), ISO text, or the
 * category report's "11/1/25 - 11/30/25" label.
 *
 * @param {*} value - a cell value as Excel returns it
 * @returns {string|null} YYYY-MM, or null when the cell names no month
 */
function monthKeyFromHeaderValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1) return null;
    return isoDateFromExcelSerial(value).slice(0, 7);
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();

  const isoMatch = _ISO_MONTH_PATTERN.exec(text);
  if (isoMatch) return _monthKey(Number(isoMatch[1]), Number(isoMatch[2]));

  const usMatch = _US_DATE_PATTERN.exec(text);
  if (usMatch) {
    const yearText = usMatch[3];
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    return _monthKey(year, Number(usMatch[1]));
  }
  return null;
}

function _monthKey(year, month) {
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

// ── Cell typing ──────────────────────────────────────────────

/**
 * The value and kind one report-grid cell is written as.
 *
 * @param {Object|null} cell - a cell from shared/report-grid.js
 * @returns {{value: (string|number), kind: string}}
 */
function sheetValueOfCell(cell) {
  if (cell == null) return { value: '', kind: EXCEL_KIND_EMPTY };

  if (Object.prototype.hasOwnProperty.call(cell, 'amount')) {
    const amount = Number(cell.amount);
    if (cell.amount === null || cell.amount === '' || !Number.isFinite(amount)) {
      return { value: String(cell.amount == null ? '' : cell.amount), kind: EXCEL_KIND_TEXT };
    }
    return { value: amount, kind: EXCEL_KIND_NUMBER };
  }

  const text = cell.text;
  if (text === '') return { value: '', kind: EXCEL_KIND_EMPTY };

  if (cell.role === 'mask' && /^\d+$/.test(text) && text.length <= _EXCEL_MAX_EXACT_DIGITS) {
    return { value: Number(text), kind: EXCEL_KIND_NUMBER };
  }
  if (cell.role === 'periodEnd') {
    const serial = excelSerialFromIsoDate(text);
    if (serial !== null) return { value: serial, kind: EXCEL_KIND_DATE };
  }
  return { value: text, kind: EXCEL_KIND_TEXT };
}

/**
 * A report grid as the rectangle Excel writes: every row padded to the widest
 * one with empty cells.
 *
 * @param {Array<Array<Object|null>>} grid
 * @returns {{values: Array<Array<string|number>>, kinds: string[][], rowCount: number, columnCount: number}}
 */
function typeGridForSheet(grid) {
  const columnCount = Math.max(1, ...grid.map(row => row.length));
  const values = [];
  const kinds = [];
  for (const row of grid) {
    const rowValues = [];
    const rowKinds = [];
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const typed = sheetValueOfCell(columnIndex < row.length ? row[columnIndex] : null);
      rowValues.push(typed.value);
      rowKinds.push(typed.kind);
    }
    values.push(rowValues);
    kinds.push(rowKinds);
  }
  return { values, kinds, rowCount: grid.length, columnCount };
}

// ── Number formats ───────────────────────────────────────────

/**
 * Whether a number format shows a date or time. Quoted text, bracketed codes
 * and escaped or spacing characters are ignored, so a currency format with a
 * literal "d" in its text is not mistaken for one.
 */
function _isDateTimeFormat(format) {
  const stripped = String(format || '')
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[\\_*]./g, '');
  return /[dyh]/i.test(stripped);
}

/**
 * The number format to give a cell before its value is written. Text needs
 * the text format, or Excel would turn "0134" into 134 or a name that looks
 * like a date into a date. Numbers and dates keep the user's own format when
 * it suits them, so a currency or month style survives a paste.
 *
 * @param {string} kind - EXCEL_KIND_*
 * @param {string|undefined} existingFormat - the cell's current format
 * @returns {string}
 */
function chooseNumberFormat(kind, existingFormat) {
  const existing = existingFormat == null ? '' : String(existingFormat);
  const isText = existing === EXCEL_TEXT_FORMAT;

  if (kind === EXCEL_KIND_TEXT) return EXCEL_TEXT_FORMAT;
  if (kind === EXCEL_KIND_NUMBER) {
    if (!existing || isText || _isDateTimeFormat(existing)) return EXCEL_GENERAL_FORMAT;
    return existing;
  }
  if (kind === EXCEL_KIND_DATE) {
    return _isDateTimeFormat(existing) ? existing : EXCEL_DATE_FORMAT;
  }
  return existing || EXCEL_GENERAL_FORMAT;
}

/**
 * Number formats for a whole typed grid, cell by cell.
 *
 * @param {string[][]} kinds - from typeGridForSheet
 * @param {Array<Array<string>>|undefined} existingFormats - same size, or missing
 * @returns {string[][]}
 */
function numberFormatsForGrid(kinds, existingFormats) {
  return kinds.map((rowKinds, rowIndex) => rowKinds.map((kind, columnIndex) => {
    const existingRow = existingFormats && existingFormats[rowIndex];
    return chooseNumberFormat(kind, existingRow ? existingRow[columnIndex] : undefined);
  }));
}

/**
 * Whether a value read from a sheet is an empty cell.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isBlankSheetValue(value) {
  return value === '' || value === null || value === undefined;
}
