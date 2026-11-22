// ============================================================
// excel/targets.js — the PF_TARGETS sheet's pure logic
//
// Builds the sheet from the app's targets, reads it back into the
// targets a save would send, diffs that against what the app holds,
// and turns a refusal into findings. No Office.js here: workbook.js
// reads and writes the cells, this file decides what they mean.
//
// A target is {category, cadence, cents}. Amounts are whole cents so
// that comparing, diffing and sending never meet binary floating
// point: a sheet number is turned into its decimal text before it is
// read as cents, and the body sends that text.
//
// Dependencies: excel/constants.js, excel/cells.js (isBlankSheetValue),
// excel/checks.js (countFindings), excel/default-range.js.
// ============================================================

// The largest amount the app stores, in cents.
const _TARGET_MAX_CENTS = 999999999999;
const _TARGET_AMOUNT_TEXT = /^(\d+\.?\d*|\.\d+)$/;
const _TARGET_NEGATIVE_TEXT = /^-(\d+\.?\d*|\.\d+)$/;
const _TARGETS_NOTE = 'Edit only the two target columns; a blank amount means no target. '
  + 'Nothing reaches the app until Check targets, then Send.';

// ── Findings ─────────────────────────────────────────────────

function _targetsFinding(level, problem, key, name, detail, action) {
  return {
    sheet: EXCEL_SHEET_NAMES.targets,
    level,
    problem,
    key: key == null ? '' : String(key),
    name: name || '',
    detail: detail || '',
    action: action || '',
  };
}

/**
 * Whole cents as dollars for a sentence: $1,210.00.
 *
 * @param {number} cents
 * @returns {string}
 */
function formatTargetCents(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Whole cents as the decimal text the app is sent: 1210 is "12.10".
 *
 * @param {number} cents
 * @returns {string}
 */
function centsToAmountText(cents) {
  const whole = Math.floor(cents / 100);
  return `${whole}.${String(cents % 100).padStart(2, '0')}`;
}

function _centsOfApiAmount(amount) {
  return Math.round(Number(amount) * 100);
}

// ── Amounts ──────────────────────────────────────────────────

/**
 * Decimal text as whole cents, rounded half up the way the app rounds.
 *
 * @param {string} decimalText - digits with an optional point, no sign or exponent
 * @returns {{cents: number, rounded: boolean}} rounded is true when digits past the cent were dropped
 */
function _centsFromDecimalText(decimalText) {
  const [whole, fraction = ''] = decimalText.split('.');
  const padded = fraction.padEnd(3, '0');
  const cents = Number(whole || '0') * 100 + Number(padded.slice(0, 2)) + (padded[2] >= '5' ? 1 : 0);
  return { cents, rounded: /[1-9]/.test(fraction.slice(2)) };
}

function _badAmount(problem, value) {
  const shown = typeof value === 'string' ? value.trim() : String(value);
  const detail = shown.length > 40 ? `${shown.slice(0, 40)}…` : shown;
  return { state: 'bad', problem, typed: detail };
}

/**
 * Read one amount cell. A number is read through its shortest decimal text, so
 * 12.1 is 1210 cents; text may carry "$", commas and spaces, as the web
 * client's fields allow.
 *
 * @param {*} value - what Excel reports for the cell
 * @returns {{state: 'blank'}|{state: 'ok', cents: number, rounded: boolean, typed: string}|
 *   {state: 'bad', problem: string, typed: string}}
 */
function parseTargetAmountCell(value) {
  if (isBlankSheetValue(value)) return { state: 'blank' };
  if (typeof value === 'string' && value.trim() === '') return { state: 'blank' };

  const notNumber = 'Amount is not a number';
  const notAboveZero = 'Amount must be above zero';
  const tooLarge = 'Amount is too large';

  let decimalText;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return _badAmount(notNumber, value);
    if (value <= 0) return _badAmount(notAboveZero, value);
    if (value >= 1e21) return _badAmount(tooLarge, value);
    decimalText = String(value);
    // Exponent form only appears below a millionth of a dollar.
    if (/e/i.test(decimalText)) return _badAmount(notAboveZero, value);
  } else if (typeof value === 'string') {
    const normalized = value.replace(/[$,\s]/g, '');
    if (_TARGET_NEGATIVE_TEXT.test(normalized)) return _badAmount(notAboveZero, value);
    if (!_TARGET_AMOUNT_TEXT.test(normalized)) return _badAmount(notNumber, value);
    decimalText = normalized;
  } else {
    return _badAmount(notNumber, value);
  }

  const { cents, rounded } = _centsFromDecimalText(decimalText);
  if (cents <= 0) return _badAmount(notAboveZero, value);
  if (cents > _TARGET_MAX_CENTS) return _badAmount(tooLarge, value);
  return { state: 'ok', cents, rounded, typed: decimalText };
}

function _amountAction(problem) {
  if (problem === 'Amount must be above zero') return 'Enter an amount above zero, or clear the cell for no target.';
  if (problem === 'Amount is too large') return 'Enter a smaller amount.';
  return 'Enter the amount as a number, or clear the cell for no target.';
}

// ── Building the sheet ───────────────────────────────────────

/**
 * The PF_TARGETS sheet for one fiscal year: the year and its dates, a note,
 * then one row per category the app lets take a target, each primary above its
 * detailed categories, with an amount where the year holds a target and blank
 * where it does not.
 *
 * @param {{fiscal_year: number, label: string, start: string, end: string,
 *   targets: Array<{category: string, cadence: string, amount: number}>}} year
 * @param {Array<{primary: string, kind: string, labels: string[]}>} categories - the GET's list
 * @returns {{values: Array<Array<string|number>>, formats: string[][], headerRowIndex: number,
 *   rowCount: number, columnCount: number}}
 */
function targetsSheetFromYear(year, categories) {
  const headers = EXCEL_TARGETS_HEADERS;
  const headerRow = [headers.primary, headers.category, headers.kind, headers.monthly, headers.annual];
  const columnCount = headerRow.length;
  const text = EXCEL_TEXT_FORMAT;
  const general = EXCEL_GENERAL_FORMAT;
  const amount = EXCEL_TARGETS_AMOUNT_FORMAT;
  const pad = cells => [...cells, ...Array(columnCount - cells.length).fill('')];

  const values = [
    pad([EXCEL_TARGETS_YEAR_LABEL, year.fiscal_year, year.label || '']),
    pad([EXCEL_TARGETS_START_LABEL, year.start || '']),
    pad([EXCEL_TARGETS_END_LABEL, year.end || '']),
    pad([_TARGETS_NOTE]),
    pad([]),
    headerRow,
  ];
  const formats = [
    [text, general, text, text, text],
    [text, text, text, text, text],
    [text, text, text, text, text],
    [text, text, text, text, text],
    [text, text, text, text, text],
    [text, text, text, text, text],
  ];
  const headerRowIndex = values.length - 1;

  const centsByKey = new Map();
  for (const target of year.targets || []) {
    centsByKey.set(`${target.category}\u0000${target.cadence}`, _centsOfApiAmount(target.amount));
  }
  const amountCell = (category, cadence) => {
    const cents = centsByKey.get(`${category}\u0000${cadence}`);
    return cents === undefined ? '' : cents / 100;
  };

  for (const group of categories || []) {
    for (const category of [group.primary, ...(group.labels || [])]) {
      values.push([
        group.primary,
        category,
        group.kind,
        amountCell(category, 'monthly'),
        amountCell(category, 'annual'),
      ]);
      formats.push([text, text, text, amount, amount]);
    }
  }
  return { values, formats, headerRowIndex, rowCount: values.length, columnCount };
}

// ── Reading the sheet ────────────────────────────────────────

function _cellText(value) {
  return isBlankSheetValue(value) ? '' : String(value).trim();
}

function _headerKey(value) {
  return _cellText(value).toLowerCase();
}

/**
 * The table's heading row and the columns it names, found among the first
 * rows so a sheet with extra lines above it still reads.
 *
 * @param {Array<Array<*>>} values - the sheet from A1
 * @returns {{rowIndex: number, columns: {category: number, monthly: number, annual: number}}|null}
 */
function _findTargetsHeader(values) {
  const wanted = {
    category: EXCEL_TARGETS_HEADERS.category.toLowerCase(),
    monthly: EXCEL_TARGETS_HEADERS.monthly.toLowerCase(),
    annual: EXCEL_TARGETS_HEADERS.annual.toLowerCase(),
  };
  const searchRows = Math.min(values.length, EXCEL_TARGETS_HEADER_SEARCH_ROWS);
  for (let rowIndex = 0; rowIndex < searchRows; rowIndex++) {
    const keys = (values[rowIndex] || []).map(_headerKey);
    const columns = {
      category: keys.indexOf(wanted.category),
      monthly: keys.indexOf(wanted.monthly),
      annual: keys.indexOf(wanted.annual),
    };
    if (columns.category !== -1 && columns.monthly !== -1 && columns.annual !== -1) {
      return { rowIndex, columns };
    }
  }
  return null;
}

function _fiscalYearOnSheet(values, headerRowIndex) {
  const label = EXCEL_TARGETS_YEAR_LABEL.toLowerCase();
  for (let rowIndex = 0; rowIndex < headerRowIndex; rowIndex++) {
    const row = values[rowIndex] || [];
    if (_headerKey(row[0]) !== label) continue;
    const raw = row[1];
    const year = typeof raw === 'number' ? raw : Number(_cellText(raw));
    return Number.isInteger(year) && year > 0 ? year : null;
  }
  return null;
}

function _eligibleIndex(categories) {
  const exact = new Set();
  const byLowerCase = new Map();
  for (const group of categories || []) {
    for (const category of [group.primary, ...(group.labels || [])]) {
      exact.add(category);
      byLowerCase.set(category.toLowerCase(), category);
    }
  }
  return { exact, byLowerCase };
}

function _addTargetFinding(findings, problem, category, cadence, detail, action) {
  findings.push(_targetsFinding(EXCEL_LEVEL_FIX, problem, category, cadence, detail, action));
}

/**
 * Read PF_TARGETS back into the targets a save would send. A row that cannot
 * be sent is a fix finding and its target is left out of the list, so the
 * caller must treat any fix finding as blocking.
 *
 * @param {Object} input
 * @param {Array<Array<*>>} input.values - the sheet from A1
 * @param {Array<{primary: string, labels: string[]}>} input.categories - the app's list
 * @param {number[]} input.editableYears
 * @returns {{fiscalYear: number|null, targets: Array<{category: string, cadence: string, cents: number, sheetRow: number}>,
 *   sheetCategories: string[], findings: Array<Object>}}
 */
function parseTargetsSheet({ values, categories, editableYears }) {
  const findings = [];
  const header = _findTargetsHeader(values);
  if (!header) {
    findings.push(_targetsFinding(EXCEL_LEVEL_FIX, 'Table not found', '', '',
      `No row has the headings ${EXCEL_TARGETS_HEADERS.category}, ${EXCEL_TARGETS_HEADERS.monthly} and ${EXCEL_TARGETS_HEADERS.annual}.`,
      'Press Pull targets to rebuild the sheet.'));
    return { fiscalYear: null, targets: [], sheetCategories: [], findings };
  }

  const fiscalYear = _fiscalYearOnSheet(values, header.rowIndex);
  if (fiscalYear === null) {
    findings.push(_targetsFinding(EXCEL_LEVEL_FIX, 'Fiscal year not found', '', '',
      `The sheet needs "${EXCEL_TARGETS_YEAR_LABEL}" in column A with the year's number beside it, above the headings.`,
      'Press Pull targets to rebuild the sheet.'));
  } else if (!editableYears.includes(fiscalYear)) {
    findings.push(_targetsFinding(EXCEL_LEVEL_FIX, 'Fiscal year cannot be set', fiscalYear, '',
      `The app takes targets for ${editableYears.join(' and ')} only.`,
      'Press Pull targets for a year the picker lists.'));
  }

  const eligible = _eligibleIndex(categories);
  const targets = [];
  const sheetCategories = [];
  const seenRows = new Map();
  const { columns } = header;
  const amountColumns = { monthly: columns.monthly, annual: columns.annual };

  for (let rowIndex = header.rowIndex + 1; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex] || [];
    const sheetRow = rowIndex + 1;
    const category = _cellText(row[columns.category]);
    const amounts = EXCEL_TARGET_CADENCES.map(cadence => ({
      cadence,
      parsed: parseTargetAmountCell(row[amountColumns[cadence]]),
    }));
    const hasAmount = amounts.some(amount => amount.parsed.state !== 'blank');
    if (!category && !hasAmount) continue;

    if (!category) {
      findings.push(_targetsFinding(EXCEL_LEVEL_FIX, 'Amount with no category', `Row ${sheetRow}`, '',
        `Row ${sheetRow} has an amount but no ${EXCEL_TARGETS_HEADERS.category}, so it cannot be sent.`,
        `Fill in the ${EXCEL_TARGETS_HEADERS.category} as Pull targets wrote it, or clear the amount.`));
      continue;
    }
    if (!eligible.exact.has(category)) {
      const nearMiss = eligible.byLowerCase.get(category.toLowerCase());
      _addTargetFinding(findings, 'Category not in the app', category, '',
        `Row ${sheetRow} names a category the app does not list for targets.`,
        nearMiss
          ? `The app spells it "${nearMiss}". Match it exactly.`
          : 'Press Pull targets to see the categories the app takes, then match one exactly.');
      continue;
    }
    sheetCategories.push(category);

    for (const { cadence, parsed } of amounts) {
      if (parsed.state === 'blank') continue;
      if (parsed.state === 'bad') {
        _addTargetFinding(findings, parsed.problem, category, cadence,
          `Row ${sheetRow} holds "${parsed.typed}" as its ${cadence} target.`, _amountAction(parsed.problem));
        continue;
      }
      const key = `${category}\u0000${cadence}`;
      if (seenRows.has(key)) {
        _addTargetFinding(findings, 'Same target twice', category, cadence,
          `Rows ${seenRows.get(key)} and ${sheetRow} both give a ${cadence} target.`,
          'Keep one row with an amount and clear the other.');
        continue;
      }
      seenRows.set(key, sheetRow);
      if (parsed.rounded) {
        findings.push(_targetsFinding(EXCEL_LEVEL_INFO, 'Amount rounded to the cent', category, cadence,
          `Row ${sheetRow}: ${parsed.typed} will be saved as ${formatTargetCents(parsed.cents)}.`, ''));
      }
      targets.push({ category, cadence, cents: parsed.cents, sheetRow });
    }
  }
  return { fiscalYear, targets, sheetCategories, findings };
}

// ── Diff ─────────────────────────────────────────────────────

function _targetKey(target) {
  return `${target.category}\u0000${target.cadence}`;
}

/**
 * What a send would change: sheet targets the app lacks, targets whose amount
 * differs, and app targets the sheet no longer gives.
 *
 * @param {{targets: Array<Object>, sheetCategories: string[]}} parsed - from parseTargetsSheet
 * @param {Array<{category: string, cadence: string, cents: number}>} appTargets
 * @returns {{added: Array<Object>, changed: Array<Object>, removed: Array<Object>, unchanged: number}}
 */
function diffTargets(parsed, appTargets) {
  const appByKey = new Map(appTargets.map(target => [_targetKey(target), target]));
  const sheetKeys = new Set(parsed.targets.map(_targetKey));
  const onSheet = new Set(parsed.sheetCategories);

  const added = [];
  const changed = [];
  let unchanged = 0;
  for (const target of parsed.targets) {
    const app = appByKey.get(_targetKey(target));
    if (!app) added.push(target);
    else if (app.cents !== target.cents) changed.push({ ...target, fromCents: app.cents });
    else unchanged += 1;
  }
  const removed = appTargets
    .filter(target => !sheetKeys.has(_targetKey(target)))
    .map(target => ({ ...target, rowMissing: !onSheet.has(target.category) }));
  return { added, changed, removed, unchanged };
}

/**
 * The diff as PF_CHECK rows. These are notes, not problems: they say what the
 * send will do.
 *
 * @param {{added: Array<Object>, changed: Array<Object>, removed: Array<Object>}} diff
 * @returns {Array<Object>}
 */
function findingsFromTargetsDiff(diff) {
  const findings = [];
  for (const target of diff.added) {
    findings.push(_targetsFinding(EXCEL_LEVEL_INFO, 'Target to add', target.category, target.cadence,
      `New ${target.cadence} target of ${formatTargetCents(target.cents)} (row ${target.sheetRow}).`,
      'Send adds it.'));
  }
  for (const target of diff.changed) {
    findings.push(_targetsFinding(EXCEL_LEVEL_INFO, 'Target to change', target.category, target.cadence,
      `The app has ${formatTargetCents(target.fromCents)}; the sheet has ${formatTargetCents(target.cents)} (row ${target.sheetRow}).`,
      'Send changes it.'));
  }
  for (const target of diff.removed) {
    const why = target.rowMissing ? 'the sheet has no row for it' : 'its amount is blank on the sheet';
    findings.push(_targetsFinding(EXCEL_LEVEL_INFO, 'Target to remove', target.category, target.cadence,
      `The app has ${formatTargetCents(target.cents)}, but ${why}.`,
      'Send deletes it. Put the amount back on the sheet to keep it.'));
  }
  return findings;
}

/**
 * Whether two target lists hold the same targets, whatever their order or the
 * rows they came from.
 *
 * @param {Array<{category: string, cadence: string, cents: number}>} first
 * @param {Array<{category: string, cadence: string, cents: number}>} second
 * @returns {boolean}
 */
function sameTargetSets(first, second) {
  const describe = list => list.map(target => `${_targetKey(target)}\u0000${target.cents}`).sort();
  const firstKeys = describe(first);
  const secondKeys = describe(second);
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) => key === secondKeys[index]);
}

// ── Check ────────────────────────────────────────────────────

function _appTargetsOfYear(yearEntry) {
  if (!yearEntry) return [];
  return (yearEntry.targets || []).map(target => ({
    category: target.category,
    cadence: target.cadence,
    cents: _centsOfApiAmount(target.amount),
  }));
}

/**
 * Check PF_TARGETS against the app: read the sheet, find what cannot be sent,
 * and diff what can against the app's targets for the sheet's year.
 *
 * @param {Object} input
 * @param {Array<Array<*>>|null} input.values - the sheet from A1, or null when there is no such sheet
 * @param {Object} input.targetsResponse - GET /api/budget/targets
 * @param {number|null} input.pickedFiscalYear - the panel's picker; the sheet must be for it
 * @returns {{fiscalYear: number|null, label: string, findings: Array<Object>,
 *   parsed: Object|null, appTargets: Array<Object>, diff: Object, counts: {fix: number, info: number},
 *   changeCount: number, canSend: boolean}}
 */
function checkTargetsSheet({ values, targetsResponse, pickedFiscalYear }) {
  const emptyDiff = { added: [], changed: [], removed: [], unchanged: 0 };
  if (values === null) {
    const findings = [_targetsFinding(EXCEL_LEVEL_FIX, 'Sheet not found', '', '',
      'There is no targets sheet to check.', 'Press Pull targets, which makes it.')];
    return {
      fiscalYear: null, label: '', findings, parsed: null, appTargets: [], diff: emptyDiff,
      counts: countFindings(findings), changeCount: 0, canSend: false,
    };
  }

  const editableYears = targetsResponse.editable_fiscal_years || [];
  const parsed = parseTargetsSheet({ values, categories: targetsResponse.categories, editableYears });
  const findings = [...parsed.findings];
  const yearEntry = (targetsResponse.years || []).find(year => year.fiscal_year === parsed.fiscalYear);
  const label = yearEntry ? yearEntry.label : '';

  if (parsed.fiscalYear !== null && pickedFiscalYear !== null && parsed.fiscalYear !== pickedFiscalYear) {
    findings.push(_targetsFinding(EXCEL_LEVEL_FIX, 'Sheet is for another year', parsed.fiscalYear, '',
      `The sheet holds fiscal year ${parsed.fiscalYear}, but the picker says ${pickedFiscalYear}.`,
      'Pick the sheet\'s year, or press Pull targets for the picked one.'));
  }

  const appTargets = _appTargetsOfYear(yearEntry);
  // With rows that cannot be read, a diff would call their targets removed.
  const readable = yearEntry !== undefined && countFindings(parsed.findings).fix === 0;
  const diff = readable ? diffTargets(parsed, appTargets) : emptyDiff;
  findings.push(...findingsFromTargetsDiff(diff));

  const counts = countFindings(findings);
  const changeCount = diff.added.length + diff.changed.length + diff.removed.length;
  return {
    fiscalYear: parsed.fiscalYear,
    label,
    findings,
    parsed,
    appTargets,
    diff,
    counts,
    changeCount,
    canSend: counts.fix === 0 && yearEntry !== undefined && changeCount > 0,
  };
}

/**
 * The year as the app labels it, or its number when the label is unknown.
 *
 * @param {{label: string, fiscalYear: number|null}} result
 * @returns {string} '' when no year was read
 */
function targetsYearText(result) {
  if (result.label) return result.label;
  return result.fiscalYear === null ? '' : String(result.fiscalYear);
}

/**
 * What the panel's status line says after a targets check.
 *
 * @param {{label: string, fiscalYear: number|null, counts: {fix: number}, diff: Object, canSend: boolean}} result
 * @returns {{message: string, tone: string}}
 */
function describeTargetsCheck(result) {
  const yearText = targetsYearText(result) || 'The sheet';
  if (result.counts.fix > 0) {
    return {
      message: `${result.counts.fix} to fix on ${EXCEL_SHEET_NAMES.targets}. See ${EXCEL_SHEET_NAMES.check}; Send stays off until it is clean.`,
      tone: 'warning',
    };
  }
  if (!result.canSend) {
    return { message: `${yearText} matches the app: nothing to send.`, tone: 'success' };
  }
  const { added, changed, removed } = result.diff;
  return {
    message: `Checked ${yearText}: ${added.length} to add, ${changed.length} to change, ${removed.length} to remove. `
      + `See ${EXCEL_SHEET_NAMES.check}, then Send.`,
    tone: 'success',
  };
}

/**
 * The PF_CHECK rows for a targets run.
 *
 * @param {Object} input
 * @param {Date} input.checkedAt
 * @param {string} input.yearText - the year as the app labels it, or its number
 * @param {string} input.outcome - e.g. "Targets checked"
 * @param {Array<Object>} input.findings
 * @returns {string[][]}
 */
function buildTargetsCheckSheetRows({ checkedAt, yearText, outcome, findings }) {
  const scope = yearText ? `fiscal year ${yearText}` : 'no fiscal year read';
  return buildScopedCheckSheetRows({ checkedAt, scope, outcome, findings });
}

// ── Send ─────────────────────────────────────────────────────

/**
 * Decide whether a send may go ahead and build its body. The sheet is read
 * again and must hold exactly the targets that were checked, for the same year,
 * with nothing left to fix; the app must still hold what it held then.
 *
 * @param {Object} input
 * @param {Array<Array<*>>|null} input.values - the sheet now
 * @param {Object} input.targetsResponse - GET /api/budget/targets now
 * @param {number|null} input.pickedFiscalYear
 * @param {{fiscalYear: number, parsed: Object, appTargets: Array<Object>}} input.checked - the last check's result
 * @returns {{ok: false, message: string}|{ok: true, fiscalYear: number, body: {targets: Array<Object>},
 *   sent: Array<Object>, check: Object}}
 */
function planTargetsSend({ values, targetsResponse, pickedFiscalYear, checked }) {
  const current = checkTargetsSheet({ values, targetsResponse, pickedFiscalYear });
  const sheetChanged = current.counts.fix > 0
    || current.fiscalYear !== checked.fiscalYear
    || !sameTargetSets(current.parsed.targets, checked.parsed.targets);
  if (sheetChanged) {
    return { ok: false, message: `${EXCEL_SHEET_NAMES.targets} changed since the check. Press Check targets again.` };
  }
  if (!sameTargetSets(current.appTargets, checked.appTargets)) {
    return { ok: false, message: 'The targets in the app changed since the check. Press Check targets again.' };
  }
  return {
    ok: true,
    fiscalYear: current.fiscalYear,
    body: {
      targets: current.parsed.targets.map(target => ({
        category: target.category,
        cadence: target.cadence,
        amount: centsToAmountText(target.cents),
      })),
    },
    sent: current.parsed.targets,
    check: current,
  };
}

// ── Refusal ──────────────────────────────────────────────────

const _REFUSAL_PROBLEMS = {
  invalid_request: ['The app could not read the request', 'Press Pull targets and try again.'],
  year_not_editable: ['The app does not take that year', 'Pull a year the picker lists, then send again.'],
  invalid_cadence: ['The app refused a cadence', 'Keep amounts in the Monthly and Annual columns.'],
  invalid_amount: ['The app refused an amount', 'Enter an amount above zero, or clear the cell.'],
  category_not_eligible: ['The app refused a category', 'Press Pull targets to see the categories the app takes.'],
  duplicate_target: ['Same target twice', 'Keep one row with an amount and clear the other.'],
  save_conflict: ['The targets changed in the app while saving', 'Press Pull targets, redo the edit, and check again.'],
};

/**
 * A refused save as PF_CHECK findings. The refusal names the entry by its
 * place in the body that was sent; that is traced back to its sheet row.
 *
 * @param {{error?: string, reason?: string, index?: number, category?: string, cadence?: string,
 *   primary?: string}} refusal - the 400 or 409 body
 * @param {Array<{category: string, cadence: string, sheetRow: number}>} sent - the targets in body order
 * @returns {Array<Object>}
 */
function findingsFromTargetsRefusal(refusal, sent) {
  const body = refusal || {};
  const entry = Number.isInteger(body.index) ? sent[body.index] : undefined;
  const category = body.category || body.primary || (entry ? entry.category : '');
  const cadence = body.cadence || (entry ? entry.cadence : '');
  const where = entry ? ` (row ${entry.sheetRow})` : '';
  const message = body.error || 'The app refused the targets.';

  if (body.reason === 'details_exceed_primary') {
    return [_targetsFinding(EXCEL_LEVEL_FIX, 'Detailed targets add up to more than the primary\'s', category, cadence,
      message, `Lower the detailed ${cadence} targets, or raise the primary's.`)];
  }
  const [problem, action] = _REFUSAL_PROBLEMS[body.reason]
    || ['The app refused the targets', 'Read the detail, fix the sheet, and check again.'];
  return [_targetsFinding(EXCEL_LEVEL_FIX, problem, category, cadence, `${message}${where}`, action)];
}

/**
 * Whether a save's answer is a refusal to write to PF_CHECK, as opposed to a
 * failure for the status line.
 *
 * @param {number} status
 * @param {*} body
 * @returns {boolean}
 */
function isTargetsRefusal(status, body) {
  return (status === 400 || status === 409) && Boolean(body) && typeof body.reason === 'string';
}
