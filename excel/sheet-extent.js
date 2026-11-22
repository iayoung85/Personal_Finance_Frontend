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

/**
 * The block the previous paste left at A1: from row 1 down to the last filled
 * row before the first run of two blank rows, as wide as its header row.
 * A row counts as blank when it is empty across that width.
 *
 * @param {Array<Array<*>>} values - the sheet's values from A1 (may be empty)
 * @returns {{rowCount: number, columnCount: number}} zero rows on an empty sheet
 */
function findOldGridExtent(values) {
  const columnCount = _oldGridWidth(values);
  if (columnCount === 0) return { rowCount: 0, columnCount: 0 };

  let lastFilledRow = -1;
  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    if (!_isBlankRow(values[rowIndex], columnCount)) {
      lastFilledRow = rowIndex;
      continue;
    }
    if (_isBlankRow(values[rowIndex + 1], columnCount)) break;
  }
  return { rowCount: lastFilledRow + 1, columnCount };
}

/**
 * The first filled cell the new grid would write over that is not part of the
 * old grid, reading row by row. The old grid is cleared before the write, so
 * only cells outside it can be in the way.
 *
 * @param {Array<Array<*>>} values - the sheet's values from A1
 * @param {{rowCount: number, columnCount: number}} oldExtent
 * @param {number} newRowCount
 * @param {number} newColumnCount
 * @returns {{rowIndex: number, columnIndex: number, address: string}|null}
 */
function findPasteBlocker(values, oldExtent, newRowCount, newColumnCount) {
  for (let rowIndex = 0; rowIndex < Math.min(newRowCount, values.length); rowIndex++) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < Math.min(newColumnCount, row.length); columnIndex++) {
      const insideOldGrid = rowIndex < oldExtent.rowCount && columnIndex < oldExtent.columnCount;
      if (insideOldGrid || isBlankSheetValue(row[columnIndex])) continue;
      return { rowIndex, columnIndex, address: excelCellAddress(rowIndex, columnIndex) };
    }
  }
  return null;
}

/**
 * What a paste onto a sheet will do: the block to clear and anything in the
 * way of the new grid.
 *
 * @param {Array<Array<*>>} values - the sheet's values from A1
 * @param {number} newRowCount
 * @param {number} newColumnCount
 * @returns {{oldExtent: {rowCount: number, columnCount: number}, blocker: Object|null}}
 */
function planGridPaste(values, newRowCount, newColumnCount) {
  const oldExtent = findOldGridExtent(values);
  const blocker = findPasteBlocker(values, oldExtent, newRowCount, newColumnCount);
  return { oldExtent, blocker };
}
