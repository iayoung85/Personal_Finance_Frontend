// ============================================================
// excel/constants.js — the budget workbook's names, in one place
//
// The add-in serves one workbook laid out by hand. Its sheet names,
// the header text of the lookup columns, and the column positions
// its formulas read are fixed here; nothing else in the add-in
// spells them. A missing sheet or column is reported as a finding
// on PF_CHECK, never as an error box.
// ============================================================

const EXCEL_SHEET_NAMES = {
  balances: 'PF_BALANCES',
  categories: 'MYAPP Categories',
  accountTable: 'Accounts',
  categoryTable: 'Categories',
  check: 'PF_CHECK',
  targets: 'PF_TARGETS',
};

// Header text of the lookup tables' columns. Matched without regard to case
// or surrounding spaces, so a retyped header still counts.
const EXCEL_TABLE_HEADERS = {
  accountKey: 'lookup mask',
  accountRetired: 'Retired account flag',
  categoryKey: 'PF Detailed Category',
  categoryRetired: 'RETIRED CATEGORY FLAG',
};

// Zero-based positions the workbook's formulas read. The balances sheet is
// looked up by mask in column B with the first month in column C; the
// categories sheet by detailed name in column C, first month in column D,
// over rows 3 to 248 only.
const EXCEL_LAYOUT = {
  balanceKeyColumn: 1,
  balanceFirstMonthColumn: 2,
  categoryPrimaryColumn: 1,
  categoryKeyColumn: 2,
  categoryFirstMonthColumn: 3,
  categoryFirstLookupRow: 3,
  categoryLastLookupRow: 248,
};

// The report options the workbook was built around. They are not choices in
// the panel: a different option would change which rows the lookups find.
const EXCEL_REPORT_OPTIONS = {
  showMask: true,
  hideZeroBalance: false,
  includeArchived: false,
  includeTransfers: false,
  showInactive: true,
};

// How far back the month pickers reach.
const EXCEL_MONTH_PICKER_YEARS = 6;

const EXCEL_CHECK_COLUMNS = ['Sheet', 'Level', 'Problem', 'Key', 'Name', 'Detail', 'What to do'];

const EXCEL_LEVEL_FIX = 'fix';
const EXCEL_LEVEL_INFO = 'info';

// The PF_TARGETS sheet. The first block names the year; the table under it
// is found by its headings, so only these words matter, not row numbers.
const EXCEL_TARGETS_HEADERS = {
  primary: 'Primary',
  category: 'Category',
  kind: 'Kind',
  monthly: 'Monthly target',
  annual: 'Annual target',
};
const EXCEL_TARGETS_YEAR_LABEL = 'Fiscal year';
const EXCEL_TARGETS_START_LABEL = 'Starts';
const EXCEL_TARGETS_END_LABEL = 'Ends';
const EXCEL_TARGETS_AMOUNT_FORMAT = '#,##0.00';
// How far down the sheet the table's heading row is looked for.
const EXCEL_TARGETS_HEADER_SEARCH_ROWS = 20;
// The cadences the app accepts, in the order the sheet's columns run.
const EXCEL_TARGET_CADENCES = ['monthly', 'annual'];
