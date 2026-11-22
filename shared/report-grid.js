// ============================================================
// shared/report-grid.js — the rows and cells of the two reports
//
// The account-balance and category-summary reports are laid out
// here once, as a grid of cells. The reports modal turns the grid
// into the CSV it copies and downloads; the Excel add-in writes the
// same grid to cells. The budget workbook reads that layout by
// column position, so both must come from this one definition.
//
// A cell is one of:
//   null                          an empty cell
//   {text}                        a label
//   {text, role: 'mask'}          an account's mask
//   {text, role: 'periodEnd'}     a balance-report month header (ISO date)
//   {text, role: 'primary'}       a category row's primary name
//   {text, role: 'detailed'}      a category row's detailed name
//   {amount}                      an amount exactly as the API sent it
//
// No dependencies.
// ============================================================

const _REPORT_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── Category sections ────────────────────────────────────────

/**
 * True when any period amount of a category row is non-zero. The report has no
 * per-category transaction count, so a row that nets to zero in every period
 * counts as no activity.
 *
 * @param {{amounts: Array<number|string>}} catData
 * @returns {boolean}
 */
function reportCategoryHasActivity(catData) {
  return (catData.amounts || []).some(amount => Number(amount) !== 0);
}

/**
 * The category rows to display. With showInactive true the map is returned
 * as is; otherwise rows with no activity in any period are dropped. Subtotals
 * are not recomputed because dropped rows contribute nothing to them.
 *
 * @param {Object<string, {amounts: Array, total: *}>|undefined} categoryMap
 * @param {boolean} showInactive
 * @returns {Object<string, {amounts: Array, total: *}>}
 */
function filterReportCategories(categoryMap, showInactive) {
  if (showInactive || !categoryMap) return categoryMap || {};
  const kept = {};
  for (const [category, catData] of Object.entries(categoryMap)) {
    if (reportCategoryHasActivity(catData)) kept[category] = catData;
  }
  return kept;
}

/**
 * Keeps a report section only when it has categories left to show, and fills
 * a missing subtotal so the renderers never read undefined. Rows are filtered
 * by showInactive (default true: keep every row).
 */
function _keepReportSectionsWithCategories(candidates, showInactive = true) {
  return candidates
    .map(section => ({ ...section, categories: filterReportCategories(section.categories, showInactive) }))
    .filter(section => Object.keys(section.categories).length > 0)
    .map(section => ({ ...section, totalRow: section.totalRow || [], grandTotal: section.grandTotal || 0 }));
}

/**
 * The Other Inflow section of a category report, or null when it is empty.
 * It sits with Earned Income, above Total Income, because it counts in it.
 *
 * @param {Object} data - GET /api/reports/category response
 * @param {boolean} [showInactive=true]
 * @returns {{label: string, categories: Object, totalRow: Array, grandTotal: *}|null}
 */
function getReportOtherInflowSection(data, showInactive = true) {
  const sections = _keepReportSectionsWithCategories([
    { label: 'Other Inflow', categories: data.other_inflows, totalRow: data.total_other_inflows_row, grandTotal: data.total_other_inflows_grand },
  ], showInactive);
  return sections.length ? sections[0] : null;
}

/**
 * The Savings section of a category report, or null when it is empty. It sits
 * after Spending, above Total Outflow, because it counts in it.
 *
 * @param {Object} data - GET /api/reports/category response
 * @param {boolean} [showInactive=true]
 * @returns {{label: string, categories: Object, totalRow: Array, grandTotal: *}|null}
 */
function getReportSavingsSection(data, showInactive = true) {
  const sections = _keepReportSectionsWithCategories([
    { label: 'Savings', categories: data.savings, totalRow: data.total_savings_row, grandTotal: data.total_savings_grand },
  ], showInactive);
  return sections.length ? sections[0] : null;
}

/**
 * The sections of a category report that are counted in no total, in display
 * order: adjustments, retirement income, investment trend, excluded, transfers.
 * A section with no categories (or transfers not requested) is left out.
 *
 * @param {Object} data - GET /api/reports/category response
 * @param {boolean} [showInactive=true]
 * @returns {Array<{label: string, categories: Object, totalRow: Array, grandTotal: *}>}
 */
function getReportSeparateSections(data, showInactive = true) {
  return _keepReportSectionsWithCategories([
    { label: 'Adjustments', categories: data.adjustments, totalRow: data.total_adjustments_row, grandTotal: data.total_adjustments_grand },
    { label: 'Retirement Income', categories: data.retirement_income, totalRow: data.total_retirement_income_row, grandTotal: data.total_retirement_income_grand },
    { label: 'Investment Trend', categories: data.investment_trends, totalRow: data.total_investment_trends_row, grandTotal: data.total_investment_trends_grand },
    { label: 'Excluded', categories: data.excluded, totalRow: data.total_excluded_row, grandTotal: data.total_excluded_grand },
    { label: 'Transfers', categories: data.transfers, totalRow: data.total_transfers_row, grandTotal: data.total_transfers_grand },
  ], showInactive);
}

// ── Cell constructors ────────────────────────────────────────

function _gridLabel(text, role) {
  const cell = { text: text == null ? '' : String(text) };
  if (role) cell.role = role;
  return cell;
}

function _gridAmount(value) {
  return { amount: value };
}

function _gridAmounts(values) {
  return (values || []).map(_gridAmount);
}

// ── Balance report ───────────────────────────────────────────

/**
 * The account-balance report as a grid: a header row, then per section a
 * label row, per subgroup a label row, its accounts and its total, the
 * section total, and Net Worth last.
 *
 * Label rows are short (the label, plus an empty Mask cell when the column is
 * there), because the copied text has always been laid out that way.
 *
 * @param {Object} data - GET /api/reports/balance response
 * @param {{showMask: boolean}} options
 * @returns {Array<Array<Object|null>>}
 */
function buildBalanceReportGrid(data, options) {
  const showMask = Boolean(options && options.showMask);
  const maskPad = showMask ? [null] : [];
  const grid = [];

  const header = [_gridLabel('Account')];
  if (showMask) header.push(_gridLabel('Mask'));
  const periods = data.periods || [];
  for (const period of periods) header.push(_gridLabel(period, 'periodEnd'));
  // The copied text has always ended an empty header with a separator.
  if (periods.length === 0) header.push(null);
  grid.push(header);

  for (const [sectionKey, sectionData] of Object.entries(data.sections || {})) {
    const sectionLabel = sectionKey === 'assets' ? 'Assets' : 'Liabilities';
    grid.push([_gridLabel(sectionLabel), ...maskPad]);

    for (const [subgroupLabel, subgroupData] of Object.entries(sectionData.subgroups || {})) {
      grid.push([_gridLabel(`  ${subgroupLabel}`), ...maskPad]);

      for (const account of subgroupData.accounts || []) {
        const row = [_gridLabel(`    ${account.name || ''}`)];
        if (showMask) row.push(_gridLabel(account.effective_mask || '', 'mask'));
        row.push(..._gridAmounts(account.balances));
        grid.push(row);
      }

      grid.push([_gridLabel(`  Total ${subgroupLabel}`), ...maskPad, ..._gridAmounts(subgroupData.subtotals)]);
    }

    grid.push([_gridLabel(`Total ${sectionLabel}`), ...maskPad, ..._gridAmounts(sectionData.section_totals)]);
  }

  grid.push([_gridLabel('Net Worth'), ...maskPad, ..._gridAmounts(data.net_worth_row)]);
  return grid;
}

// ── Category report ──────────────────────────────────────────

/**
 * The three leading cells of a category row: an empty first cell, then the
 * primary and detailed names split at the first colon. A name with no colon
 * puts the whole name in the primary cell and leaves the detailed cell empty.
 *
 * @param {string} category - "Primary: Detailed"
 * @returns {Array<Object|null>}
 */
function _gridCategoryNameCells(category) {
  const colonIndex = category.indexOf(':');
  if (colonIndex === -1) {
    return [null, _gridLabel(category, 'primary'), null];
  }
  const primary = category.substring(0, colonIndex).trim();
  const detailed = category.substring(colonIndex + 1).trim();
  return [null, _gridLabel(primary, 'primary'), _gridLabel(detailed, 'detailed')];
}

function _gridPushCategoryRows(grid, categoryMap) {
  for (const [category, catData] of Object.entries(categoryMap)) {
    grid.push([..._gridCategoryNameCells(category), ..._gridAmounts(catData.amounts), _gridAmount(catData.total)]);
  }
}

function _gridPushTotalRow(grid, label, values, grandTotal) {
  grid.push([null, null, _gridLabel(label), ..._gridAmounts(values), _gridAmount(grandTotal)]);
}

/**
 * The month name a category period label starts in: "11/1/25 - 11/30/25"
 * gives "November". A yearly label gives an empty string.
 */
function _gridPeriodMonthName(period) {
  const monthNumber = parseInt(String(period).split('/')[0], 10);
  return _REPORT_MONTH_NAMES[monthNumber - 1] || '';
}

/**
 * The category-summary report as a grid. Row 1 holds the period labels, row 2
 * the month names; the workbook looks rows up by the detailed name in the
 * third column and reads months from the fourth column on.
 *
 * @param {Object} data - GET /api/reports/category response
 * @param {{showInactive?: boolean}} [options] - showInactive defaults to true
 * @returns {Array<Array<Object|null>>}
 */
function buildCategoryReportGrid(data, options) {
  const showInactive = !options || options.showInactive !== false;
  const periods = data.periods || [];
  const grid = [];

  // With no periods the copied text has always kept one empty cell where the
  // period columns would be, so the two header rows keep it too.
  const periodLabels = periods.length ? periods.map(period => _gridLabel(period)) : [null];
  const monthLabels = periods.length ? periods.map(period => _gridLabel(_gridPeriodMonthName(period))) : [null];
  grid.push([null, _gridLabel('Primary Category'), _gridLabel('Detailed Category'), ...periodLabels, _gridLabel('Total')]);
  grid.push([_gridLabel('Earned Income'), null, null, ...monthLabels]);

  _gridPushCategoryRows(grid, filterReportCategories(data.income, showInactive));
  _gridPushTotalRow(grid, 'Total Earned Income', data.total_income_row, data.total_income_grand);

  const otherInflow = getReportOtherInflowSection(data, showInactive);
  if (otherInflow) {
    grid.push([_gridLabel('Other Inflow')]);
    _gridPushCategoryRows(grid, otherInflow.categories);
    _gridPushTotalRow(grid, 'Total Other Inflow', otherInflow.totalRow, otherInflow.grandTotal);
  }

  _gridPushTotalRow(grid, 'Total Inflows', data.total_all_income_row || [], data.total_all_income_grand || 0);

  grid.push([_gridLabel('Spending')]);
  _gridPushCategoryRows(grid, filterReportCategories(data.expenses, showInactive));
  _gridPushTotalRow(grid, 'Total Spending', data.total_expenses_row, data.total_expenses_grand);

  const savings = getReportSavingsSection(data, showInactive);
  if (savings) {
    grid.push([_gridLabel('Savings')]);
    _gridPushCategoryRows(grid, savings.categories);
    _gridPushTotalRow(grid, 'Total Savings', savings.totalRow, savings.grandTotal);
  }

  _gridPushTotalRow(grid, 'Total Outflow', data.total_all_outflow_row || [], data.total_all_outflow_grand || 0);
  _gridPushTotalRow(grid, 'Total', data.total_row, data.total_grand);

  for (const section of getReportSeparateSections(data, showInactive)) {
    grid.push([_gridLabel(section.label)]);
    _gridPushCategoryRows(grid, section.categories);
    _gridPushTotalRow(grid, `Total ${section.label}`, section.totalRow, section.grandTotal);
  }

  return grid;
}

// ── CSV text ─────────────────────────────────────────────────

function _gridCsvCell(cell) {
  if (cell == null) return '';
  if (Object.prototype.hasOwnProperty.call(cell, 'amount')) return `${cell.amount}`;
  return `"${cell.text.replace(/"/g, '""')}"`;
}

/**
 * The CSV text of a report grid: labels quoted with inner quotes doubled,
 * amounts bare as the API sent them, empty cells empty. Each row ends in a
 * newline.
 *
 * @param {Array<Array<Object|null>>} grid
 * @returns {string}
 */
function reportGridToCsv(grid) {
  return grid.map(row => row.map(_gridCsvCell).join(',') + '\n').join('');
}
