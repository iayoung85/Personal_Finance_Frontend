// ============================================================
// excel/panel.js — the task pane's controls
//
// Wires the sign-in form, the month pickers and the buttons to the
// API and workbook layers. Everything the panel has to say goes to
// its one status line; nothing opens a dialog.
//
// Dependencies: excel/constants.js, excel/default-range.js,
// excel/checks.js (describeWorkbookRun), excel/api.js,
// excel/workbook.js, shared/report-grid.js, config-helpers.js
// (initAppConfig, getAppConfig, applyTheme), shared/fiscal-year.js.
// ============================================================

const _excelPanelState = {
  inExcel: false,
  busy: false,
  awaitingCode: false,
};

const _EXCEL_NOT_IN_EXCEL = 'Open this panel from Excel to read or write the workbook.';

function _excelElement(id) {
  return document.getElementById(id);
}

// ── Status line ──────────────────────────────────────────────

/**
 * Show one sentence in the status line.
 *
 * @param {string} message
 * @param {'info'|'busy'|'success'|'warning'|'error'} [tone='info']
 */
function excelSetStatus(message, tone = 'info') {
  const statusEl = _excelElement('xl-status');
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function _excelErrorText(error) {
  if (error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}

// ── Views ────────────────────────────────────────────────────

/**
 * Show which API the panel talks to, so a dev panel is never mistaken for
 * the live one.
 *
 * @param {string} backendUrl
 * @param {boolean} isDev
 */
function excelShowEnvironment(backendUrl, isDev) {
  const envEl = _excelElement('xl-env');
  envEl.textContent = isDev ? 'Dev API' : 'Live';
  envEl.dataset.env = isDev ? 'dev' : 'live';
  try {
    envEl.title = new URL(backendUrl).host;
  } catch (_ignored) {
    envEl.title = backendUrl;
  }
}

/**
 * Show the sign-in form.
 *
 * @param {string|null} message - why, for the status line
 */
function excelShowSignIn(message) {
  _excelPanelState.awaitingCode = false;
  _excelElement('xl-main').classList.add('hidden');
  _excelElement('xl-signin').classList.remove('hidden');
  _excelElement('xl-code-field').classList.add('hidden');
  _excelElement('xl-signout').classList.add('hidden');
  _excelElement('xl-code').value = '';
  excelSetStatus(message || 'Sign in with your IAY Financial account.', message ? 'warning' : 'info');
  _excelElement('xl-email').focus();
}

function _excelFillMonthSelect(selectEl, options, value) {
  selectEl.replaceChildren(...options.map(option => new Option(option.label, option.value)));
  selectEl.value = value;
}

/**
 * Load the user's preferences, set the month pickers to the default range,
 * and show the panel.
 *
 * @param {boolean} isDev - whether the dev session is in use (no sign-out)
 */
async function excelEnterPanel(isDev) {
  excelSetStatus('Loading your settings…', 'busy');
  await initAppConfig();
  applyTheme(getAppConfig().theme);

  const now = new Date();
  let headerRow = null;
  if (_excelPanelState.inExcel) {
    try {
      headerRow = await readBalanceHeaderRow();
    } catch (readError) {
      console.warn('[excel] Could not read the balances header:', readError);
    }
  }
  const range = defaultPasteRange(now, getFiscalStartMonth(), headerRow, EXCEL_LAYOUT.balanceFirstMonthColumn);
  const options = monthPickerOptions(now, EXCEL_MONTH_PICKER_YEARS, [range.startMonth]);
  _excelFillMonthSelect(_excelElement('xl-start-month'), options, range.startMonth);
  _excelFillMonthSelect(_excelElement('xl-end-month'), options, range.endMonth);

  _excelElement('xl-signin').classList.add('hidden');
  _excelElement('xl-main').classList.remove('hidden');
  _excelElement('xl-signout').classList.toggle('hidden', isDev);
  _excelSetBusy(false);

  if (!_excelPanelState.inExcel) {
    excelSetStatus(_EXCEL_NOT_IN_EXCEL, 'warning');
    return;
  }
  const startsOnSheet = firstMonthOnSheet(headerRow, EXCEL_LAYOUT.balanceFirstMonthColumn) === range.startMonth;
  excelSetStatus(startsOnSheet
    ? `Ready. The range starts on ${monthKeyLabel(range.startMonth)}, the first month on ${EXCEL_SHEET_NAMES.balances}.`
    : `Ready. ${EXCEL_SHEET_NAMES.balances} has no months yet, so the range starts on ${monthKeyLabel(range.startMonth)}.`);
}

// ── Busy state ───────────────────────────────────────────────

function _excelSetBusy(busy) {
  _excelPanelState.busy = busy;
  const workbookButtonsOff = busy || !_excelPanelState.inExcel;
  for (const id of ['xl-check', 'xl-paste-both', 'xl-paste-selection']) {
    _excelElement(id).disabled = workbookButtonsOff;
  }
  for (const id of ['xl-start-month', 'xl-end-month', 'xl-selection-report']) {
    _excelElement(id).disabled = busy;
  }
}

/**
 * Run one panel action with the controls locked and any failure on the
 * status line.
 */
async function _excelRunAction(action) {
  if (_excelPanelState.busy) return;
  _excelSetBusy(true);
  try {
    await action();
  } catch (actionError) {
    console.error('[excel]', actionError);
    excelSetStatus(_excelErrorText(actionError), 'error');
  } finally {
    _excelSetBusy(false);
  }
}

function _excelPickedRange() {
  const startMonth = _excelElement('xl-start-month').value;
  const endMonth = _excelElement('xl-end-month').value;
  const problem = monthRangeProblem(startMonth, endMonth);
  if (problem) {
    excelSetStatus(problem, 'error');
    return null;
  }
  return { startMonth, endMonth };
}

// ── Actions ──────────────────────────────────────────────────

async function _excelFetchBothGrids(range) {
  const [balanceData, categoryData] = await Promise.all([
    fetchExcelBalanceReport(range.startMonth, range.endMonth),
    fetchExcelCategoryReport(range.startMonth, range.endMonth),
  ]);
  return {
    balanceGrid: buildBalanceReportGrid(balanceData, { showMask: EXCEL_REPORT_OPTIONS.showMask }),
    categoryGrid: buildCategoryReportGrid(categoryData, { showInactive: EXCEL_REPORT_OPTIONS.showInactive }),
  };
}

function _excelCheckOrPaste(paste) {
  return _excelRunAction(async () => {
    const range = _excelPickedRange();
    if (!range) return;
    excelSetStatus('Fetching both reports…', 'busy');
    const grids = await _excelFetchBothGrids(range);
    excelSetStatus(paste ? 'Checking and pasting…' : 'Checking…', 'busy');
    const result = await runWorkbookCheck({ ...grids, ...range, now: new Date(), paste });
    const { message, tone } = describeWorkbookRun(result, paste);
    excelSetStatus(message, tone);
  });
}

function _excelPasteAtSelection() {
  return _excelRunAction(async () => {
    const range = _excelPickedRange();
    if (!range) return;
    const isBalance = _excelElement('xl-selection-report').value === 'balance';
    const reportName = isBalance ? 'account balances' : 'category summary';
    excelSetStatus(`Fetching the ${reportName}…`, 'busy');
    const grid = isBalance
      ? buildBalanceReportGrid(await fetchExcelBalanceReport(range.startMonth, range.endMonth), { showMask: EXCEL_REPORT_OPTIONS.showMask })
      : buildCategoryReportGrid(await fetchExcelCategoryReport(range.startMonth, range.endMonth), { showInactive: EXCEL_REPORT_OPTIONS.showInactive });
    const address = await pasteGridAtSelection(grid);
    excelSetStatus(`Pasted the ${reportName} at ${address}.`, 'success');
  });
}

// ── Sign-in ──────────────────────────────────────────────────

async function _excelSubmitSignIn(submitEvent) {
  submitEvent.preventDefault();
  if (_excelPanelState.busy) return;

  const email = _excelElement('xl-email').value.trim();
  const password = _excelElement('xl-password').value;
  const code = _excelElement('xl-code').value.trim();
  if (!email || !password) {
    excelSetStatus('Enter your email and password.', 'error');
    return;
  }
  if (_excelPanelState.awaitingCode && !code) {
    excelSetStatus('Enter the code from your authenticator app.', 'error');
    return;
  }

  const button = _excelElement('xl-signin-button');
  button.disabled = true;
  _excelPanelState.busy = true;
  excelSetStatus('Signing in…', 'busy');
  try {
    const result = await excelSignIn(email, password, _excelPanelState.awaitingCode ? code : undefined);
    if (result.needsCode) {
      _excelPanelState.awaitingCode = true;
      _excelElement('xl-code-field').classList.remove('hidden');
      _excelElement('xl-code').focus();
      excelSetStatus('Enter the code from your authenticator app.', 'info');
      return;
    }
    if (!result.ok) {
      excelSetStatus(result.error, 'error');
      return;
    }
    _excelElement('xl-password').value = '';
    _excelElement('xl-code').value = '';
    _excelPanelState.awaitingCode = false;
    _excelPanelState.busy = false;
    await excelEnterPanel(false);
  } catch (networkError) {
    excelSetStatus(`Could not reach the server: ${_excelErrorText(networkError)}`, 'error');
  } finally {
    button.disabled = false;
    _excelPanelState.busy = false;
  }
}

function _excelSignOutClicked() {
  excelSignOut();
  excelShowSignIn('Signed out.');
}

/**
 * Attach the panel's event handlers. Called once at startup.
 *
 * @param {boolean} inExcel - whether Office.js says this is Excel
 */
function initExcelPanel(inExcel) {
  _excelPanelState.inExcel = inExcel;
  for (const nameEl of document.querySelectorAll('[data-sheet]')) {
    nameEl.textContent = EXCEL_SHEET_NAMES[nameEl.dataset.sheet] || '';
  }
  _excelElement('xl-signin').addEventListener('submit', _excelSubmitSignIn);
  _excelElement('xl-signout').addEventListener('click', _excelSignOutClicked);
  _excelElement('xl-check').addEventListener('click', () => _excelCheckOrPaste(false));
  _excelElement('xl-paste-both').addEventListener('click', () => _excelCheckOrPaste(true));
  _excelElement('xl-paste-selection').addEventListener('click', _excelPasteAtSelection);
}
