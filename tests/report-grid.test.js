const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The reports modal's copy and download text is pinned here byte for byte.
// The Excel add-in writes the same grid to cells, so a change to this text is
// a change to the workbook's layout too.

function loadReports(appConfig) {
  const files = ['shared/report-grid.js', 'transactions/reports.js']
    .map(relPath => path.join(__dirname, '..', relPath))
    .filter(file => fs.existsSync(file));
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const sandbox = { module: { exports: {} }, console, getAppConfig: () => appConfig };
  vm.runInNewContext(
    `${source}\nmodule.exports = { _generateBalanceCSV, _generateCategoryCSV };`,
    sandbox,
    { filename: files[files.length - 1] },
  );
  return sandbox.module.exports;
}

function loadGrid() {
  const file = path.join(__dirname, '..', 'shared', 'report-grid.js');
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(
    `${fs.readFileSync(file, 'utf8')}\nmodule.exports = { buildBalanceReportGrid, buildCategoryReportGrid, reportGridToCsv };`,
    sandbox,
    { filename: file },
  );
  return sandbox.module.exports;
}

const BALANCE_FIXTURE = {
  periods: ['2026-01-31', '2026-02-28', '2026-03-31'],
  sections: {
    assets: {
      subgroups: {
        Checking: {
          accounts: [
            { account_id: 'a1', name: 'Maple Street Checking', effective_mask: '0134', balances: ['1200.50', '1180.00', '990.25'] },
            { account_id: 'a2', name: 'Joint "Rainy Day" Checking', effective_mask: '5521', balances: ['10.00', '0.00', '-4.75'] },
          ],
          subtotals: ['1210.50', '1180.00', '985.50'],
        },
        Savings: {
          accounts: [
            { account_id: 'a3', name: 'Cash Box', effective_mask: null, balances: ['50.00', '50.00', '50.00'] },
          ],
          subtotals: ['50.00', '50.00', '50.00'],
        },
      },
      section_totals: ['1260.50', '1230.00', '1035.50'],
    },
    liabilities: {
      subgroups: {
        'Credit Card': {
          accounts: [
            { account_id: 'l1', name: 'Harbor Rewards Card', effective_mask: 'A12', balances: ['-300.00', '-410.10', '0.00'] },
          ],
          subtotals: ['-300.00', '-410.10', '0.00'],
        },
      },
      section_totals: ['-300.00', '-410.10', '0.00'],
    },
  },
  net_worth_row: ['960.50', '819.90', '1035.50'],
};

const cat = amounts => ({ amounts, total: Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100 });

const CATEGORY_FIXTURE = {
  periods: ['1/1/26 - 1/31/26', '2/1/26 - 2/28/26'],
  period_dates: [{ start: '2026-01-01', end: '2026-01-31' }, { start: '2026-02-01', end: '2026-02-28' }],
  income: { 'Income: Wages': cat([2500, 2500]), 'Income: Bonus': cat([0, 0]) },
  total_income_row: [2500, 2500],
  total_income_grand: 5000,
  other_inflows: { 'Other Inflow: Interest': cat([1.25, 0.5]) },
  total_other_inflows_row: [1.25, 0.5],
  total_other_inflows_grand: 1.75,
  total_all_income_row: [2501.25, 2500.5],
  total_all_income_grand: 5001.75,
  expenses: {
    'Food: Groceries': cat([-410.2, -388]),
    'Home: 8" Pipe Repair': cat([0, -120]),
    'Gifts': cat([-25, 0]),
    'Food: Dining': cat([0, 0]),
  },
  total_expenses_row: [-435.2, -508],
  total_expenses_grand: -943.2,
  savings: { 'Savings: Brokerage': cat([-200, -200]) },
  total_savings_row: [-200, -200],
  total_savings_grand: -400,
  total_all_outflow_row: [-635.2, -708],
  total_all_outflow_grand: -1343.2,
  total_row: [1866.05, 1792.5],
  total_grand: 3658.55,
  adjustments: { 'Adjustments: Opening': cat([0, 0]) },
  total_adjustments_row: [0, 0],
  total_adjustments_grand: 0,
  excluded: { 'Parked: Escrow': cat([15, 0]) },
  total_excluded_row: [15, 0],
  total_excluded_grand: 15,
};

const BALANCE_CSV_WITH_MASK =
  '"Account","Mask","2026-01-31","2026-02-28","2026-03-31"\n'
  + '"Assets",\n'
  + '"  Checking",\n'
  + '"    Maple Street Checking","0134",1200.50,1180.00,990.25\n'
  + '"    Joint ""Rainy Day"" Checking","5521",10.00,0.00,-4.75\n'
  + '"  Total Checking",,1210.50,1180.00,985.50\n'
  + '"  Savings",\n'
  + '"    Cash Box","",50.00,50.00,50.00\n'
  + '"  Total Savings",,50.00,50.00,50.00\n'
  + '"Total Assets",,1260.50,1230.00,1035.50\n'
  + '"Liabilities",\n'
  + '"  Credit Card",\n'
  + '"    Harbor Rewards Card","A12",-300.00,-410.10,0.00\n'
  + '"  Total Credit Card",,-300.00,-410.10,0.00\n'
  + '"Total Liabilities",,-300.00,-410.10,0.00\n'
  + '"Net Worth",,960.50,819.90,1035.50\n';

const BALANCE_CSV_WITHOUT_MASK =
  '"Account","2026-01-31","2026-02-28","2026-03-31"\n'
  + '"Assets"\n'
  + '"  Checking"\n'
  + '"    Maple Street Checking",1200.50,1180.00,990.25\n'
  + '"    Joint ""Rainy Day"" Checking",10.00,0.00,-4.75\n'
  + '"  Total Checking",1210.50,1180.00,985.50\n'
  + '"  Savings"\n'
  + '"    Cash Box",50.00,50.00,50.00\n'
  + '"  Total Savings",50.00,50.00,50.00\n'
  + '"Total Assets",1260.50,1230.00,1035.50\n'
  + '"Liabilities"\n'
  + '"  Credit Card"\n'
  + '"    Harbor Rewards Card",-300.00,-410.10,0.00\n'
  + '"  Total Credit Card",-300.00,-410.10,0.00\n'
  + '"Total Liabilities",-300.00,-410.10,0.00\n'
  + '"Net Worth",960.50,819.90,1035.50\n';

const CATEGORY_CSV_ALL =
  ',"Primary Category","Detailed Category","1/1/26 - 1/31/26","2/1/26 - 2/28/26","Total"\n'
  + '"Earned Income",,,"January","February"\n'
  + ',"Income","Wages",2500,2500,5000\n'
  + ',"Income","Bonus",0,0,0\n'
  + ',,"Total Earned Income",2500,2500,5000\n'
  + '"Other Inflow"\n'
  + ',"Other Inflow","Interest",1.25,0.5,1.75\n'
  + ',,"Total Other Inflow",1.25,0.5,1.75\n'
  + ',,"Total Inflows",2501.25,2500.5,5001.75\n'
  + '"Spending"\n'
  + ',"Food","Groceries",-410.2,-388,-798.2\n'
  + ',"Home","8"" Pipe Repair",0,-120,-120\n'
  + ',"Gifts",,-25,0,-25\n'
  + ',"Food","Dining",0,0,0\n'
  + ',,"Total Spending",-435.2,-508,-943.2\n'
  + '"Savings"\n'
  + ',"Savings","Brokerage",-200,-200,-400\n'
  + ',,"Total Savings",-200,-200,-400\n'
  + ',,"Total Outflow",-635.2,-708,-1343.2\n'
  + ',,"Total",1866.05,1792.5,3658.55\n'
  + '"Adjustments"\n'
  + ',"Adjustments","Opening",0,0,0\n'
  + ',,"Total Adjustments",0,0,0\n'
  + '"Excluded"\n'
  + ',"Parked","Escrow",15,0,15\n'
  + ',,"Total Excluded",15,0,15\n';

const CATEGORY_CSV_ACTIVE_ONLY =
  ',"Primary Category","Detailed Category","1/1/26 - 1/31/26","2/1/26 - 2/28/26","Total"\n'
  + '"Earned Income",,,"January","February"\n'
  + ',"Income","Wages",2500,2500,5000\n'
  + ',,"Total Earned Income",2500,2500,5000\n'
  + '"Other Inflow"\n'
  + ',"Other Inflow","Interest",1.25,0.5,1.75\n'
  + ',,"Total Other Inflow",1.25,0.5,1.75\n'
  + ',,"Total Inflows",2501.25,2500.5,5001.75\n'
  + '"Spending"\n'
  + ',"Food","Groceries",-410.2,-388,-798.2\n'
  + ',"Home","8"" Pipe Repair",0,-120,-120\n'
  + ',"Gifts",,-25,0,-25\n'
  + ',,"Total Spending",-435.2,-508,-943.2\n'
  + '"Savings"\n'
  + ',"Savings","Brokerage",-200,-200,-400\n'
  + ',,"Total Savings",-200,-200,-400\n'
  + ',,"Total Outflow",-635.2,-708,-1343.2\n'
  + ',,"Total",1866.05,1792.5,3658.55\n'
  + '"Excluded"\n'
  + ',"Parked","Escrow",15,0,15\n'
  + ',,"Total Excluded",15,0,15\n';

test('balance report text with the Mask column is unchanged', () => {
  const { _generateBalanceCSV } = loadReports({ showMaskWithName: true });
  assert.equal(_generateBalanceCSV(BALANCE_FIXTURE), BALANCE_CSV_WITH_MASK);
});

test('balance report text without the Mask column is unchanged', () => {
  const { _generateBalanceCSV } = loadReports({ showMaskWithName: false });
  assert.equal(_generateBalanceCSV(BALANCE_FIXTURE), BALANCE_CSV_WITHOUT_MASK);
});

test('category report text with inactive categories kept is unchanged', () => {
  const { _generateCategoryCSV } = loadReports({});
  assert.equal(_generateCategoryCSV(CATEGORY_FIXTURE, true), CATEGORY_CSV_ALL);
  assert.equal(_generateCategoryCSV(CATEGORY_FIXTURE), CATEGORY_CSV_ALL);
});

test('category report text with inactive categories hidden is unchanged', () => {
  const { _generateCategoryCSV } = loadReports({});
  assert.equal(_generateCategoryCSV(CATEGORY_FIXTURE, false), CATEGORY_CSV_ACTIVE_ONLY);
});

test('the shared grid gives the same text the modal copies', () => {
  const { buildBalanceReportGrid, buildCategoryReportGrid, reportGridToCsv } = loadGrid();
  assert.equal(reportGridToCsv(buildBalanceReportGrid(BALANCE_FIXTURE, { showMask: true })), BALANCE_CSV_WITH_MASK);
  assert.equal(reportGridToCsv(buildBalanceReportGrid(BALANCE_FIXTURE, { showMask: false })), BALANCE_CSV_WITHOUT_MASK);
  assert.equal(reportGridToCsv(buildCategoryReportGrid(CATEGORY_FIXTURE)), CATEGORY_CSV_ALL);
  assert.equal(reportGridToCsv(buildCategoryReportGrid(CATEGORY_FIXTURE, { showInactive: false })), CATEGORY_CSV_ACTIVE_ONLY);
});

test('a report with no periods keeps the empty header cell the copied text always had', () => {
  const { buildBalanceReportGrid, buildCategoryReportGrid, reportGridToCsv } = loadGrid();
  assert.equal(
    reportGridToCsv(buildBalanceReportGrid({ periods: [], sections: {}, net_worth_row: [] }, { showMask: true })),
    '"Account","Mask",\n"Net Worth",\n',
  );
  const emptyCategory = reportGridToCsv(buildCategoryReportGrid({
    periods: [], income: {}, total_income_row: [], total_income_grand: 0,
    expenses: {}, total_expenses_row: [], total_expenses_grand: 0, total_row: [], total_grand: 0,
  }));
  assert.ok(emptyCategory.startsWith(',"Primary Category","Detailed Category",,"Total"\n"Earned Income",,,\n'));
});

test('grid cells name the mask, month headers and category names the workbook looks up', () => {
  const { buildBalanceReportGrid, buildCategoryReportGrid } = loadGrid();
  const balance = buildBalanceReportGrid(BALANCE_FIXTURE, { showMask: true });
  assert.deepEqual({ ...balance[0][2] }, { text: '2026-01-31', role: 'periodEnd' });
  assert.deepEqual({ ...balance[3][1] }, { text: '0134', role: 'mask' });
  assert.deepEqual({ ...balance[3][2] }, { amount: '1200.50' });
  assert.deepEqual({ ...balance[7][1] }, { text: '', role: 'mask' });

  const category = buildCategoryReportGrid(CATEGORY_FIXTURE);
  const gifts = category.find(row => row[1] && row[1].text === 'Gifts');
  assert.equal(gifts[0], null);
  assert.deepEqual({ ...gifts[1] }, { text: 'Gifts', role: 'primary' });
  assert.equal(gifts[2], null);
  const pipe = category.find(row => row[2] && row[2].text === '8" Pipe Repair');
  assert.equal(pipe[2].role, 'detailed');
  const totalRow = category.find(row => row[2] && row[2].text === 'Total Spending');
  assert.equal(totalRow[2].role, undefined);
});
