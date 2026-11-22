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
 * are filled after the next sync.
 */
function _queueValuesFromA1(sheet, usedRange) {
  if (usedRange.isNullObject) return { range: null };
  const rowCount = usedRange.rowIndex + usedRange.rowCount;
  const columnCount = usedRange.columnIndex + usedRange.columnCount;
  const range = sheet.getRange(excelBlockAddress(rowCount, columnCount));
  range.load('values');
  return { range };
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
 * given, the number formats under each new grid are read too, so a paste can
 * keep the user's formats.
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
    reads[key] = _queueValuesFromA1(sheets[key], used[key]);
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
  const tableSheetOf = key => {
    if (sheets[key].isNullObject) return null;
    return { tables: _tableCandidates(tableReads[key]), usedValues: valuesOf(key), usedFirstRow: 1 };
  };

  return {
    sheets,
    balanceValues: valuesOf('balances'),
    categoryValues: valuesOf('categories'),
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

/** Queue the rewrite of PF_CHECK: cleared whole, then the rows as text. */
function _queueCheckSheet(context, existingSheet, rows) {
  const sheet = existingSheet.isNullObject
    ? context.workbook.worksheets.add(EXCEL_SHEET_NAMES.check)
    : existingSheet;
  // The sheet is the add-in's own, so its old formats go too; column widths stay.
  sheet.getRange().clear(Excel.ClearApplyTo.all);

  const columnCount = EXCEL_CHECK_COLUMNS.length;
  const block = sheet.getRange(excelBlockAddress(rows.length, columnCount));
  block.numberFormat = rows.map(row => row.map(() => EXCEL_TEXT_FORMAT));
  block.values = rows;

  sheet.getRange('A1').format.font.bold = true;
  const headings = sheet.getRange(`A3:${excelColumnLetter(columnCount - 1)}3`);
  headings.format.font.bold = true;

  // The long Detail and What to do columns wrap at a fixed width; the short
  // ones fit their findings. Row 1's summary is left to run across.
  if (rows.length > 3) {
    sheet.getRange(`A3:E${rows.length}`).format.autofitColumns();
  }
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
      { key: 'balances', name: EXCEL_SHEET_NAMES.balances, values: state.balanceValues, typed: typedBalances },
      { key: 'categories', name: EXCEL_SHEET_NAMES.categories, values: state.categoryValues, typed: typedCategories },
    ].map(target => ({ ...target, plan: planGridPaste(target.values || [], target.typed.rowCount, target.typed.columnCount) }));
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
      blocked: blocked.map(target => ({ sheet: target.name, address: target.plan.blocker.address })),
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
