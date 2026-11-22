// ============================================================
// excel/checks.js — what the workbook's lookups will miss
//
// The workbook reads each account's balances with
// XLOOKUP(mask, PF_BALANCES!B:B, <month column>, 0) and each
// category's amounts the same way by detailed name. A key that is
// not found reads as 0 with no error, so a mismatch is silent.
// These rules find those misses before or with a paste, by
// matching keys exactly as XLOOKUP does. They only report; the
// user's tables are never changed.
//
// Pure functions. Depends on excel/constants.js, excel/cells.js
// and excel/default-range.js (monthKeyLabel, monthKeyOfDate).
// ============================================================

// A difference under half a cent is rounding, not a change.
const _CHECK_AMOUNT_TOLERANCE = 0.005;

const _NEAR_MISS_NUMBER_TEXT = 'numberText';
const _NEAR_MISS_SPACES = 'spaces';

// Retired-flag cells that mean "not retired" when typed as text.
const _NOT_RETIRED_TEXT = ['', 'no', 'n', 'false', '0'];

// ── XLOOKUP matching ─────────────────────────────────────────

/**
 * Whether XLOOKUP's exact match would pair these two cell values. Text is
 * compared without regard to case and without trimming; a number matches only
 * a number, so the number 5747 never matches the text "5747".
 *
 * @param {*} lookupValue
 * @param {*} cellValue
 * @returns {boolean}
 */
function xlookupMatches(lookupValue, cellValue) {
  const lookupType = typeof lookupValue;
  if (lookupType !== typeof cellValue) return false;
  if (lookupType === 'string') return lookupValue.toLowerCase() === cellValue.toLowerCase();
  if (lookupType === 'number' || lookupType === 'boolean') return lookupValue === cellValue;
  return false;
}

/**
 * The index XLOOKUP would return: the first cell that matches, or -1.
 *
 * @param {*} lookupValue
 * @param {Array<*>} column
 * @returns {number}
 */
function xlookupIndex(lookupValue, column) {
  for (let index = 0; index < column.length; index++) {
    if (xlookupMatches(lookupValue, column[index])) return index;
  }
  return -1;
}

/**
 * Why two keys that look alike do not match: a number against the same digits
 * as text, or text that differs only in spaces. Null when they are unrelated
 * (or already match).
 *
 * @param {*} first
 * @param {*} second
 * @returns {string|null}
 */
function nearMissKind(first, second) {
  if (xlookupMatches(first, second)) return null;
  const isDigitsText = value => typeof value === 'string' && /^\s*\d+\s*$/.test(value);
  if (typeof first === 'number' && isDigitsText(second) && Number(second) === first) return _NEAR_MISS_NUMBER_TEXT;
  if (typeof second === 'number' && isDigitsText(first) && Number(first) === second) return _NEAR_MISS_NUMBER_TEXT;
  if (typeof first === 'string' && typeof second === 'string'
      && first.trim().toLowerCase() === second.trim().toLowerCase()) {
    return _NEAR_MISS_SPACES;
  }
  return null;
}

/**
 * Whether a retired-flag cell marks its row retired. Anything filled in counts
 * except FALSE, 0, and the text "no", "n", "false" or "0".
 *
 * @param {*} value
 * @returns {boolean}
 */
function isRetiredFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return !_NOT_RETIRED_TEXT.includes(value.trim().toLowerCase());
  return false;
}

// ── Lookup tables ────────────────────────────────────────────

function _headerIndex(headerRow, headerText) {
  const wanted = headerText.trim().toLowerCase();
  return (headerRow || []).findIndex(cell => typeof cell === 'string' && cell.trim().toLowerCase() === wanted);
}

/**
 * Pick the table that holds the key column: the first candidate whose header
 * row has it. Candidates are the sheet's Excel tables, then the sheet itself
 * read as a plain range, so a table turned back into cells still works.
 *
 * @param {Array<{headerRow: Array, bodyRows: Array<Array>, firstDataRow: number}>} candidates
 * @param {string} keyHeader
 * @returns {Object|null}
 */
function pickLookupTable(candidates, keyHeader) {
  return candidates.find(candidate => _headerIndex(candidate.headerRow, keyHeader) !== -1) || null;
}

/**
 * Read a sheet's plain values as a lookup table: the first row that holds the
 * key header is the header row, every row under it is a data row.
 *
 * @param {Array<Array<*>>} values - from the sheet's first used cell
 * @param {number} firstSheetRow - 1-based sheet row of values[0]
 * @param {string} keyHeader
 * @returns {{headerRow: Array, bodyRows: Array<Array>, firstDataRow: number}|null}
 */
function lookupTableFromSheetValues(values, firstSheetRow, keyHeader) {
  const headerRowIndex = values.findIndex(row => _headerIndex(row, keyHeader) !== -1);
  if (headerRowIndex === -1) return null;
  return {
    headerRow: values[headerRowIndex],
    bodyRows: values.slice(headerRowIndex + 1),
    firstDataRow: firstSheetRow + headerRowIndex + 1,
  };
}

/**
 * The key and retired flag of each data row of a lookup table. Rows with a
 * blank key are spacers and are left out. A header that cannot be found is
 * named in missingHeaders; without the key column there are no rows.
 *
 * @param {{headerRow: Array, bodyRows: Array<Array>, firstDataRow: number}} table
 * @param {string} keyHeader
 * @param {string} retiredHeader
 * @returns {{rows: Array<{key: *, retired: boolean, sheetRow: number}>, missingHeaders: string[]}}
 */
function readLookupTable(table, keyHeader, retiredHeader) {
  const keyIndex = _headerIndex(table.headerRow, keyHeader);
  const retiredIndex = _headerIndex(table.headerRow, retiredHeader);
  const missingHeaders = [];
  if (keyIndex === -1) missingHeaders.push(keyHeader);
  if (retiredIndex === -1) missingHeaders.push(retiredHeader);
  if (keyIndex === -1) return { rows: [], missingHeaders };

  const rows = [];
  table.bodyRows.forEach((row, offset) => {
    const key = row[keyIndex];
    if (isBlankSheetValue(key)) return;
    rows.push({
      key,
      retired: retiredIndex !== -1 && isRetiredFlag(row[retiredIndex]),
      sheetRow: table.firstDataRow + offset,
    });
  });
  return { rows, missingHeaders };
}

// ── Findings ─────────────────────────────────────────────────

function _finding(sheet, level, problem, key, name, detail, action) {
  return {
    sheet,
    level,
    problem,
    key: key == null ? '' : String(key),
    name: name || '',
    detail: detail || '',
    action: action || '',
  };
}

/**
 * The finding for a sheet the add-in needs but cannot find.
 *
 * @param {string} sheetName
 * @param {string} consequence - what cannot be checked or done without it
 * @returns {Object}
 */
function missingSheetFinding(sheetName, consequence) {
  return _finding(sheetName, EXCEL_LEVEL_FIX, 'Sheet not found', '', '', consequence,
    `Add a sheet named "${sheetName}", or rename the one that should be it.`);
}

/**
 * The finding for a lookup table column whose header cannot be found.
 *
 * @param {string} sheetName
 * @param {string} headerText
 * @returns {Object}
 */
function missingColumnFinding(sheetName, headerText) {
  return _finding(sheetName, EXCEL_LEVEL_FIX, 'Column not found', headerText, '',
    `No table on this sheet has a column headed "${headerText}", so its rows were not checked against the report.`,
    `Head the column "${headerText}" exactly, in any case.`);
}

/**
 * The finding for a paste that would write over the user's own rows.
 *
 * @param {string} sheetName
 * @param {{address: string, rowIndex: number}} blocker
 * @returns {Object}
 */
function pasteBlockedFinding(sheetName, blocker) {
  return _finding(sheetName, EXCEL_LEVEL_FIX, 'Paste would overwrite your rows', blocker.address, '',
    `The new grid reaches cell ${blocker.address}, which holds something that is not part of the last paste. Nothing was pasted.`,
    `Move your rows down so at least two blank rows sit under the grid's new end, or clear row ${blocker.rowIndex + 1}.`);
}

function _formatAmount(value) {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _nonZeroCount(amounts) {
  return amounts.filter(amount => Math.abs(amount) >= _CHECK_AMOUNT_TOLERANCE).length;
}

function _describeKey(value) {
  return typeof value === 'number' ? `the number ${value}` : `the text "${value}"`;
}

// ── Shared rule bodies ───────────────────────────────────────

/**
 * Report rows whose key no table row matches. A near miss is reported as
 * such instead, and the table rows it names are returned so the reverse rule
 * does not report them a second time.
 */
function _reportKeysMissingFromTable(entries, tableRows, words) {
  const findings = [];
  const nearMissRows = new Set();
  const tableKeys = tableRows.map(row => row.key);

  for (const entry of entries) {
    if (xlookupIndex(entry.key, tableKeys) !== -1) continue;
    const nonZero = _nonZeroCount(entry.amounts);
    const nearRowIndex = tableRows.findIndex(row => nearMissKind(entry.key, row.key) !== null);

    if (nearRowIndex !== -1) {
      const tableRow = tableRows[nearRowIndex];
      nearMissRows.add(nearRowIndex);
      const level = tableRow.retired ? EXCEL_LEVEL_INFO : EXCEL_LEVEL_FIX;
      if (nearMissKind(entry.key, tableRow.key) === _NEAR_MISS_NUMBER_TEXT) {
        findings.push(_finding(words.tableSheet, level, `${words.KeyNoun} matches only as number against text`, entry.key, entry.name,
          `The report writes ${_describeKey(entry.key)}; ${words.tableSheet} row ${tableRow.sheetRow} holds ${_describeKey(tableRow.key)}. XLOOKUP treats them as different, so the row reads 0.`,
          `Retype the "${words.keyHeader}" cell in row ${tableRow.sheetRow} as ${typeof entry.key === 'number' ? 'a number' : 'text'}.`));
      } else {
        findings.push(_finding(words.tableSheet, level, `${words.KeyNoun} differs only in spaces`, entry.key, entry.name,
          `${words.tableSheet} row ${tableRow.sheetRow} holds "${tableRow.key}". XLOOKUP does not trim spaces, so the row reads 0.`,
          `Remove the extra spaces from the "${words.keyHeader}" cell in row ${tableRow.sheetRow}.`));
      }
      continue;
    }

    const level = nonZero > 0 ? EXCEL_LEVEL_FIX : EXCEL_LEVEL_INFO;
    findings.push(_finding(words.tableSheet, level, `${words.ThingNoun} not in the ${words.tableSheet} table`, entry.key, entry.name,
      `New ${words.thingNoun} or changed ${words.keyNoun}. ${nonZero} of ${entry.amounts.length} months are not zero.`,
      `Add a row with this ${words.keyNoun} to the ${words.tableSheet} table, or update the old row's "${words.keyHeader}".`));
  }
  return { findings, nearMissRows };
}

/**
 * Table rows whose key the new grid's lookup range does not hold: those rows
 * will read 0 in every month. When the lookup range stops short of the grid
 * (fullColumn holds the whole column, by grid row), a key that is in the grid
 * but below the range is named as that instead.
 */
function _tableKeysMissingFromReport(tableRows, lookupColumn, nearMissRows, words, fullColumn) {
  const findings = [];
  tableRows.forEach((row, index) => {
    if (nearMissRows.has(index)) return;
    if (xlookupIndex(row.key, lookupColumn) !== -1) return;
    const gridRowIndex = fullColumn ? xlookupIndex(row.key, fullColumn) : -1;
    if (gridRowIndex !== -1) {
      findings.push(_finding(words.pasteSheet, row.retired ? EXCEL_LEVEL_INFO : EXCEL_LEVEL_FIX, 'Below the lookup range', row.key, '',
        `It lands on row ${gridRowIndex + 1}; the workbook's lookups read rows ${words.firstLookupRow} to ${words.lastLookupRow}, so ${words.tableSheet} row ${row.sheetRow} reads 0.`,
        `Extend the lookup range in the ${words.tableSheet} sheet's formulas past row ${gridRowIndex + 1}.`));
      return;
    }
    if (row.retired) {
      findings.push(_finding(words.tableSheet, EXCEL_LEVEL_INFO, `Retired row's ${words.keyNoun} is not in the report`, row.key, '',
        `${words.tableSheet} row ${row.sheetRow} is flagged retired; it will read 0.`, 'Nothing, unless the row should not be retired.'));
      return;
    }
    findings.push(_finding(words.tableSheet, EXCEL_LEVEL_FIX, `${words.KeyNoun} not in the report`, row.key, '',
      `${words.tableSheet} row ${row.sheetRow} will read 0 in every month. The ${words.thingNoun} was ${words.goneWhy}.`,
      `Update the "${words.keyHeader}" to the app's current one, or flag the row retired.`));
  });
  return findings;
}

/**
 * Report rows that repeat an earlier row's key: XLOOKUP returns the first, so
 * the later one is never read.
 */
function _duplicateKeys(entries, words) {
  const findings = [];
  const seen = [];
  for (const entry of entries) {
    const firstIndex = xlookupIndex(entry.key, seen.map(earlier => earlier.key));
    if (firstIndex === -1) {
      seen.push(entry);
      continue;
    }
    findings.push(_finding(words.pasteSheet, EXCEL_LEVEL_FIX, words.duplicateProblem, entry.key, entry.name,
      `Lookups find "${seen[firstIndex].name}" first, so this one's ${entry.amounts.length} months are never read.`,
      words.duplicateAction));
  }
  return findings;
}

/**
 * A change of first month: every month column in the workbook reads by
 * position, so all of them would point at a different month.
 */
function _firstMonthShift(oldHeaderRow, firstMonthColumn, newFirstMonth, words) {
  const oldFirstMonth = monthKeyFromHeaderValue((oldHeaderRow || [])[firstMonthColumn]);
  if (!oldFirstMonth || !newFirstMonth || oldFirstMonth === newFirstMonth) return [];
  return [_finding(words.pasteSheet, EXCEL_LEVEL_FIX, 'First month moves', '', '',
    `The sheet's first month column holds ${monthKeyLabel(oldFirstMonth)}; this range starts at ${monthKeyLabel(newFirstMonth)}. Every month column in the workbook reads by position and would shift.`,
    `Set the start month to ${monthKeyLabel(oldFirstMonth)}, or move the workbook's month columns to match.`)];
}

/**
 * Past months whose amount differs from what the sheet holds now, one finding
 * per row listing each changed month. The current month is still moving and
 * is left out.
 */
function _pastMonthChanges(entries, monthKeys, oldValues, words, currentMonth) {
  if (!oldValues || oldValues.length === 0) return [];
  const oldHeader = oldValues[0] || [];
  const oldColumnByMonth = new Map();
  for (let columnIndex = words.firstMonthColumn; columnIndex < oldHeader.length; columnIndex++) {
    const monthKey = monthKeyFromHeaderValue(oldHeader[columnIndex]);
    if (monthKey && !oldColumnByMonth.has(monthKey)) oldColumnByMonth.set(monthKey, columnIndex);
  }
  const oldKeys = oldValues.slice(words.firstDataRowIndex).map(row => (row || [])[words.keyColumn]);

  const findings = [];
  for (const entry of entries) {
    const oldRowOffset = xlookupIndex(entry.key, oldKeys);
    if (oldRowOffset === -1) continue;
    const oldRow = oldValues[words.firstDataRowIndex + oldRowOffset] || [];
    const changes = [];
    monthKeys.forEach((monthKey, monthIndex) => {
      if (!monthKey || monthKey >= currentMonth || !oldColumnByMonth.has(monthKey)) return;
      const oldValue = oldRow[oldColumnByMonth.get(monthKey)];
      if (isBlankSheetValue(oldValue) || !Number.isFinite(Number(oldValue))) return;
      const newValue = entry.amounts[monthIndex];
      if (Math.abs(Number(oldValue) - newValue) < _CHECK_AMOUNT_TOLERANCE) return;
      changes.push(`${monthKeyLabel(monthKey)}: ${_formatAmount(oldValue)} to ${_formatAmount(newValue)}`);
    });
    if (changes.length === 0) continue;
    findings.push(_finding(words.pasteSheet, EXCEL_LEVEL_INFO, 'Past months changed', entry.key, entry.name,
      changes.join('; '), 'Nothing, if the change is expected. Otherwise look at those months in the app.'));
  }
  return findings;
}

function _tableFindings(table, words) {
  if (!table) return [missingSheetFinding(words.tableSheet, `The report's ${words.keyNoun}s were not checked against it.`)];
  return table.missingHeaders.map(header => missingColumnFinding(words.tableSheet, header));
}

function _hasKeyColumn(table, keyHeader) {
  return Boolean(table) && !table.missingHeaders.includes(keyHeader);
}

// ── Balances ─────────────────────────────────────────────────

/**
 * Every check of the balances paste against the Accounts table and the
 * balances sheet as it is now.
 *
 * @param {Object} input
 * @param {Array<Array<Object|null>>} input.grid - buildBalanceReportGrid with the Mask column
 * @param {{rows: Array, missingHeaders: string[]}|null} input.accountTable - readLookupTable, or null when the sheet is missing
 * @param {Array<Array<*>>|null} input.oldValues - the balances sheet from A1, or null when missing
 * @param {string} input.currentMonth - YYYY-MM
 * @returns {Array<Object>} findings
 */
function checkBalanceSheet({ grid, accountTable, oldValues, currentMonth }) {
  const keyColumn = EXCEL_LAYOUT.balanceKeyColumn;
  const firstMonthColumn = EXCEL_LAYOUT.balanceFirstMonthColumn;
  const words = {
    pasteSheet: EXCEL_SHEET_NAMES.balances,
    tableSheet: EXCEL_SHEET_NAMES.accountTable,
    keyHeader: EXCEL_TABLE_HEADERS.accountKey,
    keyNoun: 'mask',
    KeyNoun: 'Mask',
    thingNoun: 'account',
    ThingNoun: 'Account',
    goneWhy: 'archived, removed, or its mask changed',
    duplicateProblem: 'Mask on more than one account',
    duplicateAction: 'Give one of the accounts its own mask in the app.',
    keyColumn,
    firstMonthColumn,
    firstDataRowIndex: 1,
  };

  const header = grid[0] || [];
  const monthKeys = header.slice(firstMonthColumn).map(cell => (cell && cell.role === 'periodEnd' ? cell.text.slice(0, 7) : null));
  const accounts = [];
  const unmasked = [];
  grid.forEach(row => {
    const maskCell = row[keyColumn];
    if (!maskCell || maskCell.role !== 'mask') return;
    const entry = {
      key: sheetValueOfCell(maskCell).value,
      name: row[0] ? row[0].text.trim() : '',
      amounts: row.slice(firstMonthColumn).map(cell => Number(cell && cell.amount)),
    };
    if (isBlankSheetValue(entry.key)) unmasked.push(entry);
    else accounts.push(entry);
  });

  const findings = [];
  for (const entry of unmasked) {
    const nonZero = _nonZeroCount(entry.amounts);
    findings.push(_finding(words.pasteSheet, nonZero > 0 ? EXCEL_LEVEL_FIX : EXCEL_LEVEL_INFO, 'Account has no mask', '', entry.name,
      `Lookups by mask cannot reach it. ${nonZero} of ${entry.amounts.length} months are not zero.`,
      'Set a mask on the account in the app.'));
  }
  findings.push(..._duplicateKeys(accounts, words));

  const distinctAccounts = accounts.filter((entry, index) => xlookupIndex(entry.key, accounts.map(other => other.key)) === index);
  findings.push(..._tableFindings(accountTable, words));
  if (_hasKeyColumn(accountTable, words.keyHeader)) {
    const lookupColumn = typeGridForSheet(grid).values.map(row => row[keyColumn]);
    const missing = _reportKeysMissingFromTable(distinctAccounts, accountTable.rows, words);
    findings.push(...missing.findings);
    findings.push(..._tableKeysMissingFromReport(accountTable.rows, lookupColumn, missing.nearMissRows, words));
  }

  findings.push(..._firstMonthShift(oldValues && oldValues[0], firstMonthColumn, monthKeys[0], words));
  findings.push(..._pastMonthChanges(distinctAccounts, monthKeys, oldValues, words, currentMonth));
  return findings;
}

// ── Categories ───────────────────────────────────────────────

/**
 * Every check of the categories paste against the Categories table and the
 * categories sheet as it is now.
 *
 * @param {Object} input
 * @param {Array<Array<Object|null>>} input.grid - buildCategoryReportGrid
 * @param {{rows: Array, missingHeaders: string[]}|null} input.categoryTable - readLookupTable, or null when the sheet is missing
 * @param {Array<Array<*>>|null} input.oldValues - the categories sheet from A1, or null when missing
 * @param {string} input.currentMonth - YYYY-MM
 * @returns {Array<Object>} findings
 */
function checkCategorySheet({ grid, categoryTable, oldValues, currentMonth }) {
  const keyColumn = EXCEL_LAYOUT.categoryKeyColumn;
  const primaryColumn = EXCEL_LAYOUT.categoryPrimaryColumn;
  const firstMonthColumn = EXCEL_LAYOUT.categoryFirstMonthColumn;
  const firstLookupIndex = EXCEL_LAYOUT.categoryFirstLookupRow - 1;
  const lastLookupIndex = EXCEL_LAYOUT.categoryLastLookupRow - 1;
  const words = {
    pasteSheet: EXCEL_SHEET_NAMES.categories,
    tableSheet: EXCEL_SHEET_NAMES.categoryTable,
    keyHeader: EXCEL_TABLE_HEADERS.categoryKey,
    keyNoun: 'detailed name',
    KeyNoun: 'Detailed name',
    thingNoun: 'category',
    ThingNoun: 'Category',
    goneWhy: 'renamed or removed, or had no activity and is hidden',
    duplicateProblem: 'Detailed name under more than one primary',
    duplicateAction: 'Rename one of the detailed categories in the app.',
    keyColumn,
    firstMonthColumn,
    firstDataRowIndex: firstLookupIndex,
    firstLookupRow: EXCEL_LAYOUT.categoryFirstLookupRow,
    lastLookupRow: EXCEL_LAYOUT.categoryLastLookupRow,
  };

  // The header ends in a Total column, which names no month.
  const header = grid[0] || [];
  const periodCount = Math.max(0, header.length - firstMonthColumn - 1);
  const monthKeys = header.slice(firstMonthColumn, firstMonthColumn + periodCount)
    .map(cell => (cell ? monthKeyFromHeaderValue(cell.text) : null));

  const categories = [];
  const undetailed = [];
  grid.forEach(row => {
    const primaryCell = row[primaryColumn];
    if (!primaryCell || primaryCell.role !== 'primary') return;
    const detailedCell = row[keyColumn];
    const entry = {
      key: sheetValueOfCell(detailedCell).value,
      name: detailedCell ? `${primaryCell.text}: ${detailedCell.text}` : primaryCell.text,
      amounts: row.slice(firstMonthColumn, firstMonthColumn + periodCount).map(cell => Number(cell && cell.amount)),
    };
    if (isBlankSheetValue(entry.key)) undetailed.push(entry);
    else categories.push(entry);
  });

  const findings = [];
  for (const entry of undetailed) {
    const nonZero = _nonZeroCount(entry.amounts);
    findings.push(_finding(words.pasteSheet, nonZero > 0 ? EXCEL_LEVEL_FIX : EXCEL_LEVEL_INFO, 'Category has no detailed name', '', entry.name,
      `Lookups by detailed name cannot reach it. ${nonZero} of ${entry.amounts.length} months are not zero.`,
      'Give it a detailed category in the app, or read it by its primary name in the workbook.'));
  }
  findings.push(..._duplicateKeys(categories, words));

  const distinctCategories = categories.filter((entry, index) => xlookupIndex(entry.key, categories.map(other => other.key)) === index);
  findings.push(..._tableFindings(categoryTable, words));
  if (_hasKeyColumn(categoryTable, words.keyHeader)) {
    // Blank the rows outside the lookup range rather than slicing them off, so
    // an index into either column is a grid row.
    const fullColumn = typeGridForSheet(grid).values.map(row => row[keyColumn]);
    const lookupColumn = fullColumn.map((value, rowIndex) => (rowIndex >= firstLookupIndex && rowIndex <= lastLookupIndex ? value : ''));
    const missing = _reportKeysMissingFromTable(distinctCategories, categoryTable.rows, words);
    findings.push(...missing.findings);
    findings.push(..._tableKeysMissingFromReport(categoryTable.rows, lookupColumn, missing.nearMissRows, words, fullColumn));
  }

  findings.push(..._firstMonthShift(oldValues && oldValues[0], firstMonthColumn, monthKeys[0], words));
  findings.push(..._pastMonthChanges(distinctCategories, monthKeys, oldValues, words, currentMonth));
  return findings;
}

// ── The whole workbook ───────────────────────────────────────

/**
 * The lookup table on a sheet: the Excel table holding the key column, or
 * failing that the sheet's own cells, read by header text.
 *
 * @param {{tables: Array, usedValues: Array<Array>, usedFirstRow: number}} sheetState
 * @param {string} keyHeader
 * @param {string} retiredHeader
 * @returns {{rows: Array, missingHeaders: string[]}}
 */
function _lookupTableOnSheet(sheetState, keyHeader, retiredHeader) {
  const source = pickLookupTable(sheetState.tables || [], keyHeader)
    || lookupTableFromSheetValues(sheetState.usedValues || [], sheetState.usedFirstRow || 1, keyHeader)
    || { headerRow: [], bodyRows: [], firstDataRow: 1 };
  return readLookupTable(source, keyHeader, retiredHeader);
}

function _pasteSheetFinding(sheetName, pasting) {
  if (pasting) {
    return _finding(sheetName, EXCEL_LEVEL_INFO, 'Sheet created', '', '', 'There was no sheet by this name, so the paste added one.',
      'Point the workbook\'s lookups at it if they do not already.');
  }
  return missingSheetFinding(sheetName, 'There is nothing to compare the report with. Paste both sheets will create it.');
}

/**
 * Every finding for both paste sheets, from what was read off the workbook.
 * A sheet that is missing is passed as null.
 *
 * @param {Object} input
 * @param {Array<Array<Object|null>>} input.balanceGrid
 * @param {Array<Array<Object|null>>} input.categoryGrid
 * @param {Array<Array<*>>|null} input.balanceValues - PF_BALANCES from A1
 * @param {Array<Array<*>>|null} input.categoryValues - MYAPP Categories from A1
 * @param {{tables: Array, usedValues: Array, usedFirstRow: number}|null} input.accountSheet
 * @param {{tables: Array, usedValues: Array, usedFirstRow: number}|null} input.categorySheet
 * @param {string} input.currentMonth - YYYY-MM
 * @param {boolean} input.pasting - a missing paste sheet will be created
 * @returns {Array<Object>}
 */
function collectWorkbookFindings(input) {
  const findings = [];
  if (input.balanceValues === null) findings.push(_pasteSheetFinding(EXCEL_SHEET_NAMES.balances, input.pasting));
  if (input.categoryValues === null) findings.push(_pasteSheetFinding(EXCEL_SHEET_NAMES.categories, input.pasting));

  const accountTable = input.accountSheet
    ? _lookupTableOnSheet(input.accountSheet, EXCEL_TABLE_HEADERS.accountKey, EXCEL_TABLE_HEADERS.accountRetired)
    : null;
  const categoryTable = input.categorySheet
    ? _lookupTableOnSheet(input.categorySheet, EXCEL_TABLE_HEADERS.categoryKey, EXCEL_TABLE_HEADERS.categoryRetired)
    : null;

  findings.push(...checkBalanceSheet({
    grid: input.balanceGrid, accountTable, oldValues: input.balanceValues, currentMonth: input.currentMonth,
  }));
  findings.push(...checkCategorySheet({
    grid: input.categoryGrid, categoryTable, oldValues: input.categoryValues, currentMonth: input.currentMonth,
  }));
  return findings;
}

// ── The PF_CHECK sheet ───────────────────────────────────────

/**
 * Fix findings first, then notes; within a level the order the rules ran in.
 *
 * @param {Array<Object>} findings
 * @returns {Array<Object>}
 */
function sortFindings(findings) {
  const rank = finding => (finding.level === EXCEL_LEVEL_FIX ? 0 : 1);
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((first, second) => rank(first.finding) - rank(second.finding) || first.index - second.index)
    .map(item => item.finding);
}

/**
 * How many findings need a fix and how many are notes.
 *
 * @param {Array<Object>} findings
 * @returns {{fix: number, info: number}}
 */
function countFindings(findings) {
  const fix = findings.filter(finding => finding.level === EXCEL_LEVEL_FIX).length;
  return { fix, info: findings.length - fix };
}

/**
 * The panel's status line after a Check or a Paste both sheets, and its tone.
 *
 * @param {{findings: Array<Object>, pasted: boolean, blocked: Array<{sheet: string, address: string}>}} result
 * @param {boolean} paste - whether a paste was asked for
 * @returns {{message: string, tone: string}} tone is 'success', 'warning' or 'error'
 */
function describeWorkbookRun(result, paste) {
  const counts = countFindings(result.findings);
  const tally = result.findings.length === 0
    ? 'no problems found'
    : `${counts.fix} to fix, ${counts.info} ${counts.info === 1 ? 'note' : 'notes'}`;
  const tone = counts.fix > 0 ? 'warning' : 'success';

  if (paste && !result.pasted) {
    const first = result.blocked[0];
    return {
      message: `Nothing pasted: ${first.sheet} cell ${first.address} is in the way. See ${EXCEL_SHEET_NAMES.check}.`,
      tone: 'error',
    };
  }
  if (paste) return { message: `Pasted both sheets; ${tally}. See ${EXCEL_SHEET_NAMES.check}.`, tone };
  return { message: `Checked: ${tally}. See ${EXCEL_SHEET_NAMES.check}.`, tone };
}

function _formatCheckTime(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The rows of the PF_CHECK sheet: a line saying when and over which months it
 * ran, a blank row, the column headings, then one row per finding. Every row
 * is as wide as the headings.
 *
 * @param {Object} input
 * @param {Date} input.checkedAt
 * @param {string} input.startMonth - YYYY-MM
 * @param {string} input.endMonth - YYYY-MM
 * @param {string} input.outcome - what the run did, e.g. "Checked" or "Pasted both sheets"
 * @param {Array<Object>} input.findings
 * @returns {string[][]}
 */
function buildCheckSheetRows({ checkedAt, startMonth, endMonth, outcome, findings }) {
  const scope = `months ${monthKeyLabel(startMonth)} to ${monthKeyLabel(endMonth)}`;
  return buildScopedCheckSheetRows({ checkedAt, scope, outcome, findings });
}

/**
 * The same sheet rows for a run whose scope is not a month range, such as a
 * targets check. The first line reads "<outcome> <time>, <scope>. <counts>".
 *
 * @param {Object} input
 * @param {Date} input.checkedAt
 * @param {string} input.scope - what the run covered, e.g. "fiscal year FY2026"
 * @param {string} input.outcome
 * @param {Array<Object>} input.findings
 * @returns {string[][]}
 */
function buildScopedCheckSheetRows({ checkedAt, scope, outcome, findings }) {
  const width = EXCEL_CHECK_COLUMNS.length;
  const pad = cells => [...cells, ...Array(Math.max(0, width - cells.length)).fill('')];
  const counts = countFindings(findings);
  const summary = `${outcome} ${_formatCheckTime(checkedAt)}, ${scope}. `
    + `${counts.fix} to fix, ${counts.info} ${counts.info === 1 ? 'note' : 'notes'}.`;

  const rows = [pad([summary]), pad([]), [...EXCEL_CHECK_COLUMNS]];
  const sorted = sortFindings(findings);
  if (sorted.length === 0) {
    rows.push(pad(['', '', 'No problems found.']));
  }
  for (const finding of sorted) {
    rows.push([finding.sheet, finding.level, finding.problem, finding.key, finding.name, finding.detail, finding.action]);
  }
  return rows;
}
