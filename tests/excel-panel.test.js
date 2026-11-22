const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// excel/panel.js against a stand-in for the page and for the API and workbook
// layers it calls. This proves what the panel reports and which buttons are on
// in each situation; it does not prove how any of it looks.

class FakeElement {
  constructor(id) {
    this.id = id;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.title = '';
    this.dataset = {};
    this.options = [];
    this.hidden = new Set();
    this.handlers = {};
    this.classList = {
      add: name => this.hidden.add(name),
      remove: name => this.hidden.delete(name),
      toggle: (name, force) => (force ? this.hidden.add(name) : this.hidden.delete(name)),
      contains: name => this.hidden.has(name),
    };
  }
  replaceChildren(...options) { this.options = options; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  focus() {}
}

function loadPanel(stubs) {
  const elements = new Map();
  const document = {
    getElementById: id => {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll: () => [],
  };
  const files = [
    'shared/fiscal-year.js', 'excel/constants.js', 'excel/cells.js', 'excel/default-range.js',
    'excel/checks.js', 'excel/targets.js', 'excel/panel.js',
  ].map(relPath => path.join(__dirname, '..', relPath));
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const sandbox = {
    module: { exports: {} },
    console: { ...console, warn() {}, error() {} },
    document,
    Option: class { constructor(label, value) { this.label = label; this.value = value; } },
    stubs,
    fetchExcelTargets: () => stubs.fetchExcelTargets(),
    saveExcelTargets: (...args) => stubs.saveExcelTargets(...args),
    readTargetsSheetValues: () => stubs.readTargetsSheetValues(),
    writeTargetsWorkbook: input => stubs.writeTargetsWorkbook(input),
    runWorkbookCheck: input => stubs.runWorkbookCheck(input),
    readBalanceHeaderRow: async () => [],
    fetchExcelBalanceReport: async () => ({}),
    fetchExcelCategoryReport: async () => ({}),
    buildBalanceReportGrid: () => [],
    buildCategoryReportGrid: () => [],
    initAppConfig: async () => {},
    getAppConfig: () => ({ theme: 'dark' }),
    applyTheme: () => {},
  };
  vm.runInNewContext(
    `${source}\nmodule.exports = { excelEnterPanel, initExcelPanel, _excelCheckTargets, _excelSendTargets, _excelCheckOrPaste, _excelPanelState };`,
    sandbox,
    { filename: files[files.length - 1] },
  );
  return { panel: sandbox.module.exports, el: id => document.getElementById(id) };
}

const plain = value => JSON.parse(JSON.stringify(value));

const CATEGORIES = [{ primary: 'Food', kind: 'spending', labels: ['Food: Groceries'] }];

function targetsResponse(targets) {
  return {
    editable_fiscal_years: [2026, 2025],
    years: [
      { fiscal_year: 2026, label: 'FY2026', start: '2025-11-01', end: '2026-10-31', targets },
      { fiscal_year: 2025, label: 'FY2025', start: '2024-11-01', end: '2025-10-31', targets: [] },
    ],
    categories: CATEGORIES,
  };
}

const APP_TARGETS = [{ category: 'Food: Groceries', cadence: 'monthly', amount: 400 }];

/** A panel in Excel with a targets sheet holding one edit: Groceries raised to 450. */
function readyPanel() {
  const written = [];
  const sent = [];
  let sheetValues = [
    ['Fiscal year', 2026, 'FY2026', '', ''],
    [],
    [],
    [],
    [],
    ['Primary', 'Category', 'Kind', 'Monthly target', 'Annual target'],
    ['Food', 'Food', 'spending', '', ''],
    ['Food', 'Food: Groceries', 'spending', 450, ''],
  ];
  const stubs = {
    fetchExcelTargets: async () => targetsResponse(APP_TARGETS),
    saveExcelTargets: async (year, targets) => {
      sent.push({ year, targets });
      return {
        ok: true,
        status: 200,
        body: targetsResponse([{ category: 'Food: Groceries', cadence: 'monthly', amount: 450 }]).years[0],
      };
    },
    readTargetsSheetValues: async () => sheetValues,
    writeTargetsWorkbook: async input => { written.push(input); },
    runWorkbookCheck: async () => ({ findings: [], pasted: false, blocked: [] }),
  };
  const harness = loadPanel(stubs);
  harness.panel.initExcelPanel(true);
  harness.panel._excelPanelState.targetYearsReady = true;
  harness.el('xl-targets-year').value = '2026';
  harness.el('xl-start-month').value = '2026-01';
  harness.el('xl-end-month').value = '2026-02';
  return { ...harness, stubs, written, sent, setSheet: values => { sheetValues = values; } };
}

const statusOf = harness => ({ text: harness.el('xl-status').textContent, tone: harness.el('xl-status').dataset.tone });

// ── The panel shows before the targets request answers ───────

test('the panel shows and the Reports card works while the targets request is still out', async () => {
  let answer;
  const harness = loadPanel({
    fetchExcelTargets: () => new Promise((resolve, reject) => { answer = { resolve, reject }; }),
  });
  harness.panel.initExcelPanel(true);

  await harness.panel.excelEnterPanel(true);

  assert.equal(harness.el('xl-main').classList.contains('hidden'), false, 'the panel is shown');
  assert.equal(harness.el('xl-check').disabled, false, 'the Reports card is usable');
  assert.equal(harness.el('xl-paste-both').disabled, false);
  for (const id of ['xl-targets-pull', 'xl-targets-check', 'xl-targets-send', 'xl-targets-year']) {
    assert.equal(harness.el(id).disabled, true, `${id} waits for the years`);
  }
  assert.equal(harness.el('xl-targets-year').options[0].label, 'Loading…');

  answer.resolve(targetsResponse(APP_TARGETS));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(plain(harness.el('xl-targets-year').options.map(option => option.label)), ['FY2026', 'FY2025']);
  assert.equal(harness.el('xl-targets-year').value, '2026');
  assert.equal(harness.el('xl-targets-pull').disabled, false);
  assert.equal(harness.el('xl-targets-check').disabled, false);
  assert.equal(harness.el('xl-targets-send').disabled, true, 'Send still needs a check');
});

test('a failed targets request goes to the status line and leaves the Reports card usable', async () => {
  const harness = loadPanel({
    fetchExcelTargets: async () => { throw new Error('Server error (500)'); },
  });
  harness.panel.initExcelPanel(true);

  await harness.panel.excelEnterPanel(true);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(harness.el('xl-check').disabled, false);
  assert.equal(harness.el('xl-targets-pull').disabled, true);
  assert.equal(harness.el('xl-targets-check').disabled, true);
  const status = statusOf(harness);
  assert.equal(status.tone, 'warning');
  assert.match(status.text, /Targets are off: Server error \(500\)/);
});

// ── A saved send never reads as a failed one ─────────────────

test('a send whose sheet rewrite fails says the targets were saved and points at Pull targets', async () => {
  const harness = readyPanel();
  await harness.panel._excelCheckTargets();
  assert.equal(harness.el('xl-targets-send').disabled, false);

  harness.stubs.writeTargetsWorkbook = async () => { throw new Error('The sheet is protected.'); };
  await harness.panel._excelSendTargets();

  assert.equal(harness.sent.length, 1, 'the PUT went out');
  const status = statusOf(harness);
  assert.equal(status.tone, 'warning');
  assert.match(status.text, /The app saved 1 targets for FY2026, but PF_TARGETS could not be rewritten \(The sheet is protected\.\)/);
  assert.match(status.text, /Press Pull targets/);
  assert.equal(harness.el('xl-targets-send').disabled, true, 'a spent check is gone');
});

test('a send that goes through rewrites both sheets and PF_CHECK says what was done', async () => {
  const harness = readyPanel();
  await harness.panel._excelCheckTargets();
  harness.written.length = 0;

  await harness.panel._excelSendTargets();

  assert.deepEqual(plain(harness.sent), [{
    year: 2026,
    targets: [{ category: 'Food: Groceries', cadence: 'monthly', amount: '450.00' }],
  }]);
  assert.equal(harness.written.length, 1);
  const { targetsSheet, checkRows } = harness.written[0];
  assert.ok(targetsSheet);
  assert.match(checkRows[0][0], /^Targets sent /);
  assert.equal(checkRows[3][2], 'Target changed');
  assert.equal(checkRows[3][5], 'Changed the monthly target from $400.00 to $450.00.');
  assert.equal(checkRows[3][6], '');
  assert.equal(statusOf(harness).tone, 'success');
});

// ── Anything else that writes PF_CHECK retires the targets check ──

test('the Reports card\'s Check clears the targets check, so Send needs a fresh Check targets', async () => {
  const harness = readyPanel();
  await harness.panel._excelCheckTargets();
  assert.equal(harness.el('xl-targets-send').disabled, false);

  await harness.panel._excelCheckOrPaste(false);
  assert.equal(harness.el('xl-targets-send').disabled, true);

  await harness.panel._excelSendTargets();
  assert.equal(harness.sent.length, 0, 'nothing is sent');
  assert.equal(statusOf(harness).text, 'Press Check targets first.');
});

test('the Reports card\'s Paste clears the targets check too', async () => {
  const harness = readyPanel();
  await harness.panel._excelCheckTargets();

  await harness.panel._excelCheckOrPaste(true);

  assert.equal(harness.el('xl-targets-send').disabled, true);
  assert.equal(harness.panel._excelPanelState.targetsCheck, null);
});
