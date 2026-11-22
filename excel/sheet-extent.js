// ============================================================
// excel/sheet-extent.js — where the last paste ends
//
// The user keeps rows of their own under each paste area: a few
// blank rows, then labels and formulas. A paste may clear and
// rewrite the old grid, but must never write over those rows.
//
// Pure functions. Depends on excel/cells.js (isBlankSheetValue,
// excelCellAddress).
// ============================================================

/**
 * The width of the old grid: its header row's run of filled cells, from the
 * first filled one to the cell before the next blank. The category header
 * starts with a blank A1, so the run starts at the first filled cell; a note
 * the user keeps to the right, past a blank column, is outside the grid.
 *
 * @param {Array<Array<*>>} values - the sheet's values from A1
 * @returns {number}
 */
function _oldGridWidth(values) {
  const header = values[0] || [];
  let columnIndex = 0;
  while (columnIndex < header.length && isBlankSheetValue(header[columnIndex])) columnIndex++;
  if (columnIndex === header.length) return 0;
  while (columnIndex < header.length && !isBlankSheetValue(header[columnIndex])) columnIndex++;
  return columnIndex;
}

function _isBlankRow(row, columnCount) {
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    if (!isBlankSheetValue(row ? row[columnIndex] : '')) return false;
  }
  return true;
}

// The report grids never hold a fully blank row, and the next paste finds
// where this one ends by the first two blank rows under it. So two blank rows
// must stay under every grid written.
const EXCEL_BLANK_ROWS_UNDER_GRID = 2;

/**
 * The sheet as the paste rules see it: a cell is filled when it shows a value
 * or holds a formula, even one that shows "". Without the formulas, a row of
 * formulas showing "" would read as blank and be written over.
 *
 * @param {Array<Array<*>>} values - the sheet's values from A1
 * @param {Array<Array<*>>|undefined} formulas - the same block's formulas, or missing
 * @returns {Array<Array<*>>} values, with the formula text in blank-looking formula cells
 */
function pasteOccupancy(values, formulas) {
  if (!formulas) return values;
  return values.map((row, rowIndex) => row.map((value, columnIndex) => {
    if (!isBlankSheetValue(value)) return value;
    const formula = (formulas[rowIndex] || [])[columnIndex];
    return typeof formula === 'string' && formula.startsWith('=') ? formula : value;
  }));
}

/**
 * The block the previous paste left at A1: from row 1 down to the last filled
 * row before the first run of two blank rows, as wide as its header row.
 * A row counts as blank when it is empty across that width.
 *
 * A single blank row inside that block cannot come from a paste, since the
 * report grids have none. It means the user's rows sit one blank row under the
 * grid, and which rows are whose cannot be told; gapRowIndex names it so the
 * paste refuses instead of clearing through the user's rows.
 *
 * @param {Array<Array<*>>} values - the sheet from A1, as pasteOccupancy gives it (may be empty)
 * @returns {{rowCount: number, columnCount: number, gapRowIndex: number|null}} zero rows on an empty sheet
 */
function findOldGridExtent(values) {
  const columnCount = _oldGridWidth(values);
  if (columnCount === 0) return { rowCount: 0, columnCount: 0, gapRowIndex: null };

  let lastFilledRow = -1;
  let gapRowIndex = null;
  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    if (!_isBlankRow(values[rowIndex], columnCount)) {
      lastFilledRow = rowIndex;
      continue;
    }
    if (_isBlankRow(values[rowIndex + 1], columnCount)) break;
    // A filled row follows, so this blank row is inside the block.
    if (gapRowIndex === null) gapRowIndex = rowIndex;
  }
  return { rowCount: lastFilledRow + 1, columnCount, gapRowIndex };
}

function _blockerAt(rowIndex, columnIndex, reason) {
  return { rowIndex, columnIndex, address: excelCellAddress(rowIndex, columnIndex), reason };
}

function _firstFilledOutsideGrid(values, oldExtent, firstRow, lastRow, columnCount, reason) {
  for (let rowIndex = firstRow; rowIndex <= Math.min(lastRow, values.length - 1); rowIndex++) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < Math.min(columnCount, row.length); columnIndex++) {
      const insideOldGrid = rowIndex < oldExtent.rowCount && columnIndex < oldExtent.columnCount;
      if (insideOldGrid || isBlankSheetValue(row[columnIndex])) continue;
      return _blockerAt(rowIndex, columnIndex, reason);
    }
  }
  return null;
}

/**
 * Why the new grid cannot be pasted, or null. In order:
 *   'gap'     the old block holds a single blank row (see findOldGridExtent);
 *   'overlap' a filled cell outside the old grid lies where the new grid goes;
 *   'guard'   a filled cell outside the old grid lies in one of the two rows
 *             right under the new grid, across its width, so the next paste
 *             could not find the grid's end.
 * The old grid is cleared before the write, so its own cells never block.
 *
 * @param {Array<Array<*>>} values - the sheet from A1, as pasteOccupancy gives it
 * @param {{rowCount: number, columnCount: number, gapRowIndex: (number|null)}} oldExtent
 * @param {number} newRowCount
 * @param {number} newColumnCount
 * @returns {{rowIndex: number, columnIndex: number, address: string, reason: string}|null}
 */
function findPasteBlocker(values, oldExtent, newRowCount, newColumnCount) {
  if (oldExtent.gapRowIndex !== null && oldExtent.gapRowIndex !== undefined) {
    return _blockerAt(oldExtent.gapRowIndex, 0, 'gap');
  }
  return _firstFilledOutsideGrid(values, oldExtent, 0, newRowCount - 1, newColumnCount, 'overlap')
    || _firstFilledOutsideGrid(values, oldExtent, newRowCount, newRowCount + EXCEL_BLANK_ROWS_UNDER_GRID - 1, newColumnCount, 'guard');
}

/**
 * What a paste onto a sheet will do: the block to clear and anything in the
 * way of the new grid.
 *
 * @param {Array<Array<*>>} values - the sheet's values from A1
 * @param {number} newRowCount
 * @param {number} newColumnCount
 * @param {Array<Array<*>>} [formulas] - the same block's formulas
 * @returns {{oldExtent: {rowCount: number, columnCount: number, gapRowIndex: (number|null)}, blocker: Object|null}}
 */
function planGridPaste(values, newRowCount, newColumnCount, formulas) {
  const occupied = pasteOccupancy(values, formulas);
  const oldExtent = findOldGridExtent(occupied);
  const blocker = findPasteBlocker(occupied, oldExtent, newRowCount, newColumnCount);
  return { oldExtent, blocker };
}
