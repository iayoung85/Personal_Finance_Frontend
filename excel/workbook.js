// ============================================================
// excel/workbook.js — the only file that touches Excel
//
// Reads ranges, hands them to the pure rules, writes ranges. Every
// read and write is batched: a run queues its loads, syncs once
// per stage, and writes each grid as one block, never cell by
// cell. The Accounts and Categories sheets are only read.
//
// Dependencies: Office.js (Excel), excel/constants.js,
// excel/cells.js, excel/sheet-extent.js, excel/checks.js.
// ============================================================

// ── Reading ──────────────────────────────────────────────────

function _excelSheetOrNull(context, name) {
  const sheet = context.workbook.worksheets.getItemOrNullObject(name);
  sheet.load('name');
  return sheet;
}

/**
 * Queue a load of everything in use on a sheet from A1, so row and column
 * indexes in the values are sheet positions. Returns a holder whose values
 * (and formulas, when asked for) are filled after the next sync.
 *
 * The used range counts only cells with values, so a formula showing "" can
 * fall outside it. A paste passes the block its new grid and the two rows
 * under it cover, and that block is always read too: a formula cell there is
 * then seen, and one further down can only make the old grid look shorter,
 * which never clears more than the grid.
 *
 * @param {Excel.Worksheet} sheet
 * @param {Excel.Range} usedRange - loaded, from getUsedRangeOrNullObject(true)
 * @param {{rowCount: number, columnCount: number}} [pasteBlock] - also load formulas, over at least this block
 */
function _queueValuesFromA1(sheet, usedRange, pasteBlock) {
  let rowCount = usedRange.isNullObject ? 0 : usedRange.rowIndex + usedRange.rowCount;
  let columnCount = usedRange.isNullObject ? 0 : usedRange.columnIndex + usedRange.columnCount;
  if (pasteBlock) {
    rowCount = Math.max(rowCount, pasteBlock.rowCount);
    columnCount = Math.max(columnCount, pasteBlock.columnCount);
  }
  if (rowCount === 0 || columnCount === 0) return { range: null };
  const range = sheet.getRange(excelBlockAddress(rowCount, columnCount));
  range.load(pasteBlock ? 'values,formulas' : 'values');
  return { range, hasFormulas: Boolean(pasteBlock) };
}

function _queueTableReads(sheet) {
  return sheet.tables.items.map(table => {
    const header = table.getHeaderRowRange();
    header.load('values,rowIndex');
    const body = table.getDataBodyRange();
    body.load('values');
    return { header, body };
  });
}

function _tableCandidates(tableReads) {
  return tableReads.map(({ header, body }) => ({
    headerRow: header.values[0] || [],
    bodyRows: body.values,
    // rowIndex is zero-based; the body starts on the row after the header.
    firstDataRow: header.rowIndex + 2,
  }));
}

/**
 * Read the four sheets the check needs, in three syncs: which sheets exist,
 * how much of each is used, then the values themselves. When target sizes are
 * given, the paste sheets' formulas are read with their values, for the paste
 * rules, and the number formats under each new grid, so a paste can keep the
 * user's formats.
 *
 * @param {Excel.RequestContext} context
 * @param {{balances: {rowCount: number, columnCount: number}, categories: Object}|null} pasteSizes
 * @returns {Promise<Object>} sheet proxies and plain values
 */
async function _readWorkbookState(context, pasteSizes) {
  const names = EXCEL_SHEET_NAMES;
  const sheets = {
    balances: _excelSheetOrNull(context, names.balances),
    categories: _excelSheetOrNull(context, names.categories),
    accountTable: _excelSheetOrNull(context, names.accountTable),
    categoryTable: _excelSheetOrNull(context, names.categoryTable),
    check: _excelSheetOrNull(context, names.check),
  };
  await context.sync();

  const used = {};
  for (const key of ['balances', 'categories', 'accountTable', 'categoryTable']) {
    if (sheets[key].isNullObject) continue;
    used[key] = sheets[key].getUsedRangeOrNullObject(true);
    used[key].load('rowIndex,columnIndex,rowCount,columnCount');
    if (key === 'accountTable' || key === 'categoryTable') sheets[key].tables.load('items/name');
  }
  await context.sync();

  const reads = {};
  for (const key of Object.keys(used)) {
    const size = pasteSizes && pasteSizes[key];
    const pasteBlock = size
      ? { rowCount: size.rowCount + EXCEL_BLANK_ROWS_UNDER_GRID, columnCount: size.columnCount }
      : undefined;
    reads[key] = _queueValuesFromA1(sheets[key], used[key], pasteBlock);
  }
  const tableReads = {};
  for (const key of ['accountTable', 'categoryTable']) {
    if (used[key]) tableReads[key] = _queueTableReads(sheets[key]);
  }
  const formatReads = {};
  if (pasteSizes) {
    for (const key of ['balances', 'categories']) {
      if (sheets[key].isNullObject) continue;
      const size = pasteSizes[key];
      formatReads[key] = sheets[key].getRange(excelBlockAddress(size.rowCount, size.columnCount));
      formatReads[key].load('numberFormat');
    }
  }
  await context.sync();

  const valuesOf = key => {
    if (sheets[key].isNullObject) return null;
    return reads[key].range ? reads[key].range.values : [];
  };
  // Office.js throws on a property that was not loaded, and formulas are
  // loaded only for a paste.
  const formulasOf = key => {
    if (sheets[key].isNullObject || !reads[key].range || !reads[key].hasFormulas) return undefined;
    return reads[key].range.formulas;
  };
  const tableSheetOf = key => {
    if (sheets[key].isNullObject) return null;
    return { tables: _tableCandidates(tableReads[key]), usedValues: valuesOf(key), usedFirstRow: 1 };
  };

  return {
    sheets,
    balanceValues: valuesOf('balances'),
    categoryValues: valuesOf('categories'),
    balanceFormulas: formulasOf('balances'),
    categoryFormulas: formulasOf('categories'),
    accountSheet: tableSheetOf('accountTable'),
    categorySheet: tableSheetOf('categoryTable'),
    formats: {
      balances: formatReads.balances ? formatReads.balances.numberFormat : undefined,
      categories: formatReads.categories ? formatReads.categories.numberFormat : undefined,
    },
  };
}

/**
 * Row 1 of the balances sheet, for the panel's default start month.
 *
 * @returns {Promise<Array<*>|null>} null when the sheet does not exist
 */
async function readBalanceHeaderRow() {
  return Excel.run(async context => {
    const sheet = _excelSheetOrNull(context, EXCEL_SHEET_NAMES.balances);
    await context.sync();
    if (sheet.isNullObject) return null;

    const usedRange = sheet.getUsedRangeOrNullObject(true);
    usedRange.load('columnIndex,columnCount');
    await context.sync();
    if (usedRange.isNullObject) return [];

    const header = sheet.getRange(`A1:${excelColumnLetter(usedRange.columnIndex + usedRange.columnCount - 1)}1`);
    header.load('values');
    await context.sync();
    return header.values[0];
  });
}

// ── Writing ──────────────────────────────────────────────────

/** Queue a typed grid's formats then values onto a range of the same size. */
function _queueGridWrite(range, typed, existingFormats) {
  range.numberFormat = numberFormatsForGrid(typed.kinds, existingFormats);
  range.values = typed.values;
}

/**
 * The rows above a sheet's table that are one long line in column A and
 * nothing else: they are meant to spill across the empty cells to the right.
 *
 * @param {Array<Array<*>>} values
 * @param {number} tableTopIndex - zero-based row of the table's headings
 * @returns {number[]}
 */
function _spillLineRows(values, tableTopIndex) {
  const rows = [];
  for (let rowIndex = 0; rowIndex < tableTopIndex; rowIndex++) {
    const [first, ...rest] = values[rowIndex] || [];
    if (!isBlankSheetValue(first) && rest.every(isBlankSheetValue)) rows.push(rowIndex);
  }
  return rows;
}

/**
 * Queue a block write with its column widths fitted to everything but its
 * spill lines. Excel's autofit sizes whole columns, so a long line in column A
 * would widen it: the block goes in with those lines blank, the columns are
 * fitted, and only then are the lines written. Commands in a batch run in the
 * order queued, so the fit never sees them.
 *
 * @param {Excel.Worksheet} sheet
 * @param {{values: Array<Array<*>>, formats: string[][], columnCount: number}} block
 * @param {number} tableTopIndex - zero-based row of the table's headings
 * @param {string} fitAddress - the cells whose columns are fitted
 */
function _queueBlockFittedAroundSpillLines(sheet, block, tableTopIndex, fitAddress) {
  const spillRows = _spillLineRows(block.values, tableTopIndex);
  const range = sheet.getRange(excelBlockAddress(block.values.length, block.columnCount));
  range.numberFormat = block.formats;
  range.values = block.values.map((row, rowIndex) => (spillRows.includes(rowIndex) ? row.map(() => '') : row));
  sheet.getRange(fitAddress).format.autofitColumns();
  for (const rowIndex of spillRows) {
    sheet.getRange(excelCellAddress(rowIndex, 0)).values = [[block.values[rowIndex][0]]];
  }
}

/** Queue the rewrite of PF_CHECK: cleared whole, then the rows as text. */
function _queueCheckSheet(context, existingSheet, rows) {
  const sheet = existingSheet.isNullObject
    ? context.workbook.worksheets.add(EXCEL_SHEET_NAMES.check)
    : existingSheet;
  // The sheet is the add-in's own, so its old formats go too; column widths stay.
  sheet.getRange().clear(Excel.ClearApplyTo.all);

  const columnCount = EXCEL_CHECK_COLUMNS.length;
  const lastColumn = excelColumnLetter(columnCount - 1);
  // The long Detail and What to do columns wrap at a fixed width, so only the
  // short ones are fitted, to the headings and findings; row 1's summary
  // spills across.
  _queueBlockFittedAroundSpillLines(
    sheet,
    { values: rows, formats: rows.map(row => row.map(() => EXCEL_TEXT_FORMAT)), columnCount },
    2,
    `A3:E${rows.length}`,
  );

  sheet.getRange('A1').format.font.bold = true;
  sheet.getRange(`A3:${lastColumn}3`).format.font.bold = true;
  const longColumns = sheet.getRange(`F3:G${rows.length}`);
  longColumns.format.columnWidth = 320;
  longColumns.format.wrapText = true;
}

/** Add a paste sheet the workbook does not have yet. */
function _pasteSheet(context, sheet, name) {
  return sheet.isNullObject ? context.workbook.worksheets.add(name) : sheet;
}

/**
 * Check both paste sheets against the workbook's tables and write PF_CHECK.
 * With paste set, also write both grids, but only when neither would cover
 * the user's own rows; otherwise nothing but PF_CHECK is written.
 *
 * @param {Object} input
 * @param {Array<Array<Object|null>>} input.balanceGrid
 * @param {Array<Array<Object|null>>} input.categoryGrid
 * @param {string} input.startMonth - YYYY-MM
 * @param {string} input.endMonth - YYYY-MM
 * @param {Date} input.now
 * @param {boolean} input.paste
 * @returns {Promise<{findings: Array<Object>, pasted: boolean, blocked: Array<{sheet: string, address: string}>}>}
 */
async function runWorkbookCheck({ balanceGrid, categoryGrid, startMonth, endMonth, now, paste }) {
  const typedBalances = typeGridForSheet(balanceGrid);
  const typedCategories = typeGridForSheet(categoryGrid);

  return Excel.run(async context => {
    const pasteSizes = paste ? { balances: typedBalances, categories: typedCategories } : null;
    const state = await _readWorkbookState(context, pasteSizes);

    const targets = [
      { key: 'balances', name: EXCEL_SHEET_NAMES.balances, values: state.balanceValues, formulas: state.balanceFormulas, typed: typedBalances },
      { key: 'categories', name: EXCEL_SHEET_NAMES.categories, values: state.categoryValues, formulas: state.categoryFormulas, typed: typedCategories },
    ].map(target => ({
      ...target,
      plan: planGridPaste(target.values || [], target.typed.rowCount, target.typed.columnCount, target.formulas),
    }));
    const blocked = paste ? targets.filter(target => target.plan.blocker) : [];
    const pasted = paste && blocked.length === 0;

    const findings = collectWorkbookFindings({
      balanceGrid,
      categoryGrid,
      balanceValues: state.balanceValues,
      categoryValues: state.categoryValues,
      accountSheet: state.accountSheet,
      categorySheet: state.categorySheet,
      currentMonth: monthKeyOfDate(now),
      pasting: pasted,
    });
    for (const target of blocked) findings.push(pasteBlockedFinding(target.name, target.plan.blocker));

    if (pasted) {
      for (const target of targets) {
        const sheet = _pasteSheet(context, state.sheets[target.key], target.name);
        const { rowCount, columnCount } = target.plan.oldExtent;
        // Contents only: formats stay, and the grid's own old cells are the only ones cleared.
        if (rowCount > 0) sheet.getRange(excelBlockAddress(rowCount, columnCount)).clear(Excel.ClearApplyTo.contents);
        const range = sheet.getRange(excelBlockAddress(target.typed.rowCount, target.typed.columnCount));
        _queueGridWrite(range, target.typed, state.formats[target.key]);
      }
    }

    const outcome = paste ? (pasted ? 'Pasted both sheets' : 'Paste refused') : 'Checked';
    const rows = buildCheckSheetRows({ checkedAt: now, startMonth, endMonth, outcome, findings });
    _queueCheckSheet(context, state.sheets.check, rows);
    await context.sync();
    return {
      findings,
      pasted,
      blocked: blocked.map(target => ({
        sheet: target.name,
        address: target.plan.blocker.address,
        reason: target.plan.blocker.reason,
      })),
    };
  });
}

/**
 * Write one report grid with its top-left cell at the selection, over
 * whatever is there, with no checks.
 *
 * @param {Array<Array<Object|null>>} grid
 * @returns {Promise<string>} the address written, sheet included
 */
async function pasteGridAtSelection(grid) {
  const typed = typeGridForSheet(grid);
  return Excel.run(async context => {
    const target = context.workbook.getSelectedRange()
      .getCell(0, 0)
      .getResizedRange(typed.rowCount - 1, typed.columnCount - 1);
    target.load('numberFormat,address');
    await context.sync();

    _queueGridWrite(target, typed, target.numberFormat);
    await context.sync();
    return target.address;
  });
}

// ── Targets ──────────────────────────────────────────────────

/**
 * Everything in use on PF_TARGETS, from A1, as the sheet holds it now.
 *
 * @returns {Promise<Array<Array<*>>|null>} null when the sheet does not exist
 */
async function readTargetsSheetValues() {
  return Excel.run(async context => {
    const sheet = _excelSheetOrNull(context, EXCEL_SHEET_NAMES.targets);
    await context.sync();
    if (sheet.isNullObject) return null;

    const usedRange = sheet.getUsedRangeOrNullObject(true);
    usedRange.load('rowIndex,columnIndex,rowCount,columnCount');
    await context.sync();

    const holder = _queueValuesFromA1(sheet, usedRange);
    await context.sync();
    return holder.range ? holder.range.values : [];
  });
}

/** Queue the rewrite of PF_TARGETS: cleared whole, then formats, then values. */
function _queueTargetsSheet(context, existingSheet, built) {
  const sheet = existingSheet.isNullObject
    ? context.workbook.worksheets.add(EXCEL_SHEET_NAMES.targets)
    : existingSheet;
  // The sheet is the add-in's own, so a pull replaces everything on it.
  sheet.getRange().clear(Excel.ClearApplyTo.all);

  const lastColumn = excelColumnLetter(built.columnCount - 1);
  const headerRowNumber = built.headerRowIndex + 1;
  // The note above the table runs across; the year lines and the table are fitted.
  _queueBlockFittedAroundSpillLines(sheet, built, built.headerRowIndex, `A1:${lastColumn}${built.rowCount}`);

  sheet.getRange('A1:A3').format.font.bold = true;
  sheet.getRange(`A${headerRowNumber}:${lastColumn}${headerRowNumber}`).format.font.bold = true;
}

/**
 * Rewrite PF_TARGETS, PF_CHECK, or both, each whole, in one batch.
 *
 * @param {Object} input
 * @param {Object} [input.targetsSheet] - from targetsSheetFromYear
 * @param {string[][]} [input.checkRows] - from buildTargetsCheckSheetRows
 * @returns {Promise<void>}
 */
async function writeTargetsWorkbook({ targetsSheet, checkRows }) {
  return Excel.run(async context => {
    const targets = _excelSheetOrNull(context, EXCEL_SHEET_NAMES.targets);
    const check = _excelSheetOrNull(context, EXCEL_SHEET_NAMES.check);
    await context.sync();

    if (targetsSheet) _queueTargetsSheet(context, targets, targetsSheet);
    if (checkRows) _queueCheckSheet(context, check, checkRows);
    await context.sync();
  });
}
