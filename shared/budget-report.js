// ============================================================
// shared/budget-report.js — draws the Budget report
//
// The API sends the report finished: sections, nesting, targets,
// amounts, room left and pace are all its figures. This file only
// turns them into rows, bar widths and sentences, and into HTML.
// The Budget page and the Transactions modal both draw through
// renderBudgetReport, so the two always look the same.
//
// Everything above renderBudgetReport is pure, so tests can load it
// without a DOM.
// ============================================================

const BUDGET_KIND_SPENDING = 'spending';
const BUDGET_KIND_SAVINGS = 'savings';

const BUDGET_PACE_UNDER = 'under';
const BUDGET_PACE_ON = 'on';
const BUDGET_PACE_OVER = 'over';

const BUDGET_TONE_NORMAL = 'normal';
const BUDGET_TONE_PACE_OVER = 'pace-over';
const BUDGET_TONE_OVER = 'over';
const BUDGET_TONE_SAVINGS = 'savings';

// How far over target, as the API names it. Only the last is an alarm.
const BUDGET_OVER_FORGIVEN = 'forgiven';
const BUDGET_OVER_SLIGHT = 'slight';
const BUDGET_OVER_OVER = 'over';

const BUDGET_PACE_KEY_TEXT =
  "The tick is even spending through the month; the box around it is the line's on-pace range.";
const BUDGET_PACE_KEY_TEXT_ANNUAL =
  "The tick is even spending through the year; the box around it is the line's on-pace range.";
// Said beside the key, since nothing on the report itself shows that pace is a setting.
const BUDGET_PACE_KEY_HINT = 'Turn pace off for a line, or change its range, in ';

const _BUDGET_MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A dollar amount as the report prints it: whole dollars, always. The
 * report is read at a glance and nobody checks cents on it, so rounding is
 * for display only and each figure is rounded on its own.
 *
 * @param {number} amount
 * @returns {string} e.g. "$1,241", "$600", "-$50"
 */
function formatBudgetMoney(amount) {
  const dollars = Math.round(Number(amount) || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    // A rounded -0 would print as "-$0".
  }).format(dollars === 0 ? 0 : dollars);
}

/**
 * A gap between two figures. One that is real but rounds away says so,
 * since "over by $0" would read as not over at all.
 *
 * @param {number} amount - zero or above
 * @returns {string} e.g. "$141", "less than $1"
 */
function formatBudgetGap(amount) {
  const gap = Math.abs(Number(amount) || 0);
  if (gap > 0 && Math.round(gap) === 0) return 'less than $1';
  return formatBudgetMoney(gap);
}

/**
 * "Nov 21, 2026" from "2026-11-21", read as a calendar date so no time
 * zone can move it a day.
 *
 * @param {string} isoDate
 * @returns {string}
 */
function formatBudgetDate(isoDate) {
  const parts = String(isoDate || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return '';
  const [year, month, day] = parts;
  return `${_BUDGET_MONTH_ABBREVIATIONS[month - 1]} ${day}, ${year}`;
}

/**
 * Where the pace tick sits on a section's current bars, as a percent of
 * the track: the share of the month (or the fiscal year) gone, as the API
 * counts days.
 *
 * @param {{days_elapsed: number, days_total: number}} periodHeader
 * @returns {number|null} 0-100, or null when the header has no days
 */
function budgetTickPercent(periodHeader) {
  if (!periodHeader) return null;
  const total = Number(periodHeader.days_total);
  const elapsed = Number(periodHeader.days_elapsed);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(elapsed)) return null;
  return _clampPercent((elapsed / total) * 100);
}

/**
 * The on-pace mark's two edges on the track, in percent: the even mark
 * less the line's band to the even mark plus the band, cut off at the
 * ends of the track. A band of zero has no width to show, so it has no
 * box. The even mark itself is always kept: a box cut off at one end of
 * the track no longer shows where its middle is.
 *
 * @param {number} evenPercent - from budgetTickPercent
 * @param {number} bandPercent - the line's pace_band_percent
 * @returns {{evenPercent: number, startPercent: number, endPercent: number, isBox: boolean}}
 */
function budgetPaceMark(evenPercent, bandPercent) {
  const even = _clampPercent(evenPercent);
  const band = Number(bandPercent);
  if (!Number.isFinite(band) || band <= 0) {
    return { evenPercent: even, startPercent: even, endPercent: even, isBox: false };
  }
  // Four places is the band's own precision; it also keeps float noise out of the edges.
  return {
    evenPercent: even,
    startPercent: _roundPercent(_clampPercent(even - band)),
    endPercent: _roundPercent(_clampPercent(even + band)),
    isBox: true,
  };
}

function _roundPercent(percent) {
  return Number(percent.toFixed(4));
}

function _hasPaceAmount(entry) {
  return typeof entry.pace_amount === 'number' && Number.isFinite(entry.pace_amount);
}

function _clampPercent(percent) {
  if (!Number.isFinite(percent) || percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}

/**
 * Whether any line in a section is drawn with a pace mark, so the key
 * explaining it is shown only when there is something to explain.
 *
 * @param {{current?: Object, groups: Array}} section - the monthly or annual section
 * @returns {boolean}
 */
function sectionHasPaceMark(section) {
  if (budgetTickPercent(section && section.current) === null) return false;
  return buildBudgetSectionRows(section).some(row =>
    row.type === 'line' && row.kind === BUDGET_KIND_SPENDING
    && row.current && _hasPaceAmount(row.current));
}

function _paceWords(entry) {
  if (entry.pace === BUDGET_PACE_ON) return 'on pace';
  // The gap's sign is already in the word; -0 only comes with "on".
  const gap = formatBudgetGap(entry.pace_difference);
  if (entry.pace === BUDGET_PACE_OVER) return `over pace by ${gap}`;
  if (entry.pace === BUDGET_PACE_UNDER) return `under pace by ${gap}`;
  return '';
}

/**
 * One period's bar and its words, from the API's figures.
 *
 * Spending fills target-spent over target and never past the track; over
 * target it is full and red, with no pace word. Over pace fills orange.
 * Savings fills green toward the goal and is full at it. The pace mark
 * is drawn only when the caller passes tickPercent (the current period's
 * spending, the even mark) and the API sent pace for the line: a line
 * with track pace off has no pace_amount and no mark.
 *
 * @param {{target: number, actual: number, remaining: number,
 *          pace?: string|null, pace_amount?: number, pace_difference?: number,
 *          pace_band_percent?: number}} entry
 * @param {Object} options
 * @param {string} options.kind - 'spending' or 'savings'
 * @param {number|null} [options.tickPercent]
 * @returns {{tone: string, fillPercent: number, tickPercent: number|null,
 *            paceMark: {startPercent: number, endPercent: number, isBox: boolean}|null,
 *            isOver: boolean, isMet: boolean, summary: string,
 *            detail: string, text: string}}
 */
function buildBudgetBar(entry, options) {
  const kind = options.kind;
  const money = formatBudgetMoney;
  const target = Number(entry.target) || 0;
  const actual = Number(entry.actual) || 0;
  const remaining = Number(entry.remaining) || 0;
  const share = target > 0 ? (actual / target) * 100 : 0;

  if (kind === BUDGET_KIND_SAVINGS) {
    const isMet = remaining <= 0;
    let detail = `${formatBudgetGap(remaining)} to go`;
    if (isMet) {
      // Past the goal by under a dollar is simply met.
      detail = Math.round(-remaining) > 0 ? `goal met, ${money(-remaining)} past it` : 'goal met';
    }
    const summary = `saved ${money(actual)} of ${money(target)}`;
    return {
      tone: BUDGET_TONE_SAVINGS,
      fillPercent: isMet ? 100 : _clampPercent(share),
      tickPercent: null,
      paceMark: null,
      isOver: false,
      isMet,
      summary,
      detail,
      text: `${summary}, ${detail}`,
    };
  }

  const isOver = remaining < 0;
  const summary = `${money(actual)} of ${money(target)}`;
  const hasEvenMark = options.tickPercent !== undefined && options.tickPercent !== null;
  const tickPercent = hasEvenMark && _hasPaceAmount(entry) ? _clampPercent(options.tickPercent) : null;
  const paceMark = tickPercent === null ? null : budgetPaceMark(tickPercent, entry.pace_band_percent);

  if (isOver) {
    const detail = `over by ${formatBudgetGap(remaining)}`;
    // The words always say it is over. The colour follows how far: none
    // when forgiven, the caution colour when slight, red beyond that. A
    // line with no level named reads as fully over.
    const overLevel = entry.over_level || BUDGET_OVER_OVER;
    const toneByLevel = {
      [BUDGET_OVER_FORGIVEN]: BUDGET_TONE_NORMAL,
      [BUDGET_OVER_SLIGHT]: BUDGET_TONE_PACE_OVER,
    };
    return {
      tone: toneByLevel[overLevel] || BUDGET_TONE_OVER,
      fillPercent: 100,
      tickPercent,
      paceMark,
      isOver: overLevel === BUDGET_OVER_OVER,
      isMet: false,
      summary,
      detail,
      text: `${summary}, ${detail}`,
    };
  }

  const words = [`${formatBudgetGap(remaining)} left`];
  const paceWords = _paceWords(entry);
  if (paceWords) words.push(paceWords);
  const detail = words.join(', ');
  return {
    tone: entry.pace === BUDGET_PACE_OVER ? BUDGET_TONE_PACE_OVER : BUDGET_TONE_NORMAL,
    fillPercent: _clampPercent(share),
    tickPercent,
    paceMark,
    isOver: false,
    isMet: false,
    summary,
    detail,
    text: `${summary}, ${detail}`,
  };
}

/**
 * The rows one section draws, in order.
 *
 * Every detail reads "Primary: Detailed", whether it stands alone or with
 * others, so one name never changes shape with what sits beside it. A
 * primary with its own target is a line above its details. Each row says
 * where it sits in its primary's group, so the drawing can bind the group
 * into one block. A kind row opens each kind when the section holds both
 * spending and savings.
 *
 * @param {{groups: Array}} section - the API's monthly or annual section
 * @returns {Array<Object>} rows of type 'kind' or 'line'
 */
function buildBudgetSectionRows(section) {
  const groups = (section && Array.isArray(section.groups)) ? section.groups : [];
  const kinds = new Set(groups.map(group => group.kind));
  const showKindRows = kinds.size > 1;
  const rows = [];
  let lastKind = null;

  for (const group of groups) {
    if (showKindRows && group.kind !== lastKind) {
      rows.push({ type: 'kind', kind: group.kind });
    }
    lastKind = group.kind;
    const lines = Array.isArray(group.lines) ? group.lines : [];

    const groupRows = [];
    if (group.own) {
      groupRows.push(_budgetLineRow({
        label: group.primary,
        category: group.primary,
        kind: group.kind,
        depth: 0,
        isPrimary: true,
        current: group.own.current,
        previous: group.own.previous,
      }));
    }
    const detailDepth = group.own ? 1 : 0;
    for (const line of lines) groupRows.push(_detailRow(group, line, detailDepth));

    groupRows.forEach((row, position) => {
      row.groupPosition = _groupPosition(position, groupRows.length);
      rows.push(row);
    });
  }
  return rows;
}

function _groupPosition(position, groupSize) {
  if (groupSize === 1) return 'single';
  if (position === 0) return 'first';
  return position === groupSize - 1 ? 'last' : 'middle';
}

function _detailRow(group, line, depth) {
  const row = _budgetLineRow({
    label: `${group.primary}: ${line.name}`,
    category: line.category,
    kind: group.kind,
    depth,
    isPrimary: false,
    current: line.current,
    previous: line.previous,
  });
  // Kept apart so the primary's part can be drawn quieter than the detail's.
  row.primaryPart = group.primary;
  row.detailPart = line.name;
  return row;
}

function _budgetLineRow(fields) {
  return {
    type: 'line',
    label: fields.label,
    category: fields.category,
    kind: fields.kind,
    depth: fields.depth,
    isPrimary: fields.isPrimary,
    current: fields.current || null,
    previous: fields.previous || null,
  };
}

/**
 * Whether the report holds no target at all.
 *
 * @param {Object|null} report
 * @returns {boolean}
 */
function isBudgetReportEmpty(report) {
  if (!report) return true;
  const monthlyGroups = (report.monthly && report.monthly.groups) || [];
  const annualGroups = (report.annual && report.annual.groups) || [];
  return monthlyGroups.length === 0 && annualGroups.length === 0;
}

/**
 * Text made safe to put in HTML, quotes included, without a DOM.
 *
 * @param {*} text
 * @returns {string}
 */
function escapeBudgetHtml(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _periodHeadNote(header, cadence, isCurrent) {
  if (!header || !isCurrent) return '';
  if (header.days_elapsed >= header.days_total) return '';
  if (cadence === 'monthly') return `day ${header.days_elapsed} of ${header.days_total}`;
  return 'so far';
}

function _paceMarkHtml(mark) {
  if (!mark) return '';
  const tick = `<span class="bt-tick" style="left:${mark.evenPercent.toFixed(2)}%"></span>`;
  if (!mark.isBox) return tick;
  const width = mark.endPercent - mark.startPercent;
  return `<span class="bt-pace-box" style="left:${mark.startPercent.toFixed(2)}%;width:${width.toFixed(2)}%"></span>${tick}`;
}

function _barHtml(bar) {
  const tick = _paceMarkHtml(bar.paceMark);
  return `<div class="bt-bar bt-tone-${bar.tone}" aria-hidden="true">`
    + `<span class="bt-fill" style="width:${bar.fillPercent.toFixed(2)}%"></span>${tick}</div>`;
}

function _periodCellHtml(entry, row, periodLabel, options) {
  const labelAttr = ` data-period="${escapeBudgetHtml(periodLabel)}"`;
  if (!entry) {
    return `<div class="bt-cell bt-cell-empty" role="cell"${labelAttr}>`
      + '<span class="bt-no-target" title="No target" aria-label="No target">—</span></div>';
  }
  const bar = buildBudgetBar(entry, {
    kind: row.kind,
    tickPercent: options.tickPercent,
  });
  const stateClass = bar.isOver ? ' bt-cell-over' : (bar.isMet ? ' bt-cell-met' : '');
  const paceClass = bar.tone === BUDGET_TONE_PACE_OVER ? ' bt-cell-pace-over' : '';
  return `<div class="bt-cell${stateClass}${paceClass}" role="cell"${labelAttr}>`
    + _barHtml(bar)
    + `<div class="bt-cell-text"><span class="bt-summary">${escapeBudgetHtml(bar.summary)}</span>`
    + `<span class="bt-detail">${escapeBudgetHtml(bar.detail)}</span></div>`
    + '</div>';
}

function _kindRowHtml(row) {
  const label = row.kind === BUDGET_KIND_SAVINGS ? 'Savings' : 'Spending';
  return `<div class="bt-row bt-row-kind" role="row"><div class="bt-kind-label" role="cell">${label}</div></div>`;
}

function _rowNameHtml(row) {
  if (!row.primaryPart) return escapeBudgetHtml(row.label);
  return `<span class="bt-name-primary">${escapeBudgetHtml(row.primaryPart)}:</span> `
    + escapeBudgetHtml(row.detailPart);
}

function _lineRowHtml(row, section, cadence, options) {
  const isSpending = row.kind === BUDGET_KIND_SPENDING;
  const currentTick = isSpending ? budgetTickPercent(section.current) : null;
  const classes = [
    'bt-row', 'bt-row-line', `bt-depth-${row.depth}`, `bt-group-${row.groupPosition}`,
    `bt-kind-${escapeBudgetHtml(row.kind)}`,
  ];
  if (row.isPrimary) classes.push('bt-row-primary');
  return `<div class="${classes.join(' ')}" role="row">`
    + `<div class="bt-name" role="rowheader" title="${escapeBudgetHtml(row.category)}">${_rowNameHtml(row)}</div>`
    + _periodCellHtml(row.current, row, section.current && section.current.label, {
      tickPercent: currentTick,
    })
    + _periodCellHtml(row.previous, row, section.previous && section.previous.label, {
      tickPercent: null,
    })
    + '</div>';
}

function _sectionHeadRowHtml(section, cadence) {
  const columnHead = (header, isCurrent) => {
    if (!header) return '<div class="bt-col-head" role="columnheader"></div>';
    const note = _periodHeadNote(header, cadence, isCurrent);
    const noteHtml = note ? ` <span class="bt-col-note">${escapeBudgetHtml(note)}</span>` : '';
    const range = `${formatBudgetDate(header.start)} – ${formatBudgetDate(header.end)}`;
    return `<div class="bt-col-head" role="columnheader" title="${escapeBudgetHtml(range)}">`
      + `${escapeBudgetHtml(header.label)}${noteHtml}</div>`;
  };
  return '<div class="bt-row bt-row-head" role="row">'
    + '<div class="bt-col-head bt-col-name" role="columnheader">Category</div>'
    + columnHead(section.current, true)
    + columnHead(section.previous, false)
    + '</div>';
}

function _sectionHtml(section, cadence, options) {
  const title = cadence === 'monthly' ? 'Monthly' : 'Annual';
  const rows = buildBudgetSectionRows(section);
  let html = `<section class="bt-section bt-section-${cadence}">`;
  html += `<div class="bt-section-head"><h3>${title}</h3></div>`;

  if (rows.length === 0) {
    const noun = cadence === 'monthly' ? 'monthly' : 'annual';
    html += `<p class="bt-section-empty">No ${noun} targets. `
      + `<a href="${escapeBudgetHtml(options.targetsHref)}" data-budget-action="targets"${options.targetsLinkAttrs}>`
      + `Add one in Targets</a>.</p>`;
    return `${html}</section>`;
  }

  if (sectionHasPaceMark(section)) {
    const keyText = cadence === 'monthly' ? BUDGET_PACE_KEY_TEXT : BUDGET_PACE_KEY_TEXT_ANNUAL;
    html += '<p class="bt-key"><span class="bt-key-swatch" aria-hidden="true">'
      + '<span class="bt-key-box"></span><span class="bt-key-tick"></span></span>'
      + `<span>${escapeBudgetHtml(keyText)} ${escapeBudgetHtml(BUDGET_PACE_KEY_HINT)}`
      + `<a href="${escapeBudgetHtml(options.targetsHref)}" data-budget-action="targets"${options.targetsLinkAttrs}>`
      + 'Targets</a>.</span></p>';
  }

  html += `<div class="bt-grid" role="table" aria-label="${title} targets">`;
  html += _sectionHeadRowHtml(section, cadence);
  for (const row of rows) {
    if (row.type === 'kind') html += _kindRowHtml(row);
    else html += _lineRowHtml(row, section, cadence, options);
  }
  html += '</div>';
  return `${html}</section>`;
}

/**
 * The whole report as HTML.
 *
 * @param {Object} report - the API's GET /api/budget/report body
 * @param {Object} [options]
 * @param {string} [options.targetsHref='budget.html#targets'] - where "set targets" links go
 * @param {boolean} [options.targetsInNewTab=false] - open those links in a new tab
 * @returns {string}
 */
function buildBudgetReportHtml(report, options = {}) {
  const resolved = {
    targetsHref: options.targetsHref || 'budget.html#targets',
    targetsLinkAttrs: options.targetsInNewTab ? ' target="_blank" rel="noopener"' : '',
  };

  if (isBudgetReportEmpty(report)) {
    return '<div class="bt-report"><div class="bt-empty">'
      + '<div class="bt-empty-icon" aria-hidden="true">🎯</div>'
      + '<h3>No budget targets yet</h3>'
      + '<p>Give a spending or savings category a monthly or annual target, '
      + 'and this report shows how each one is tracking.</p>'
      + `<a class="bt-empty-action" href="${escapeBudgetHtml(resolved.targetsHref)}" `
      + `data-budget-action="targets"${resolved.targetsLinkAttrs}>Set targets</a>`
      + '</div></div>';
  }

  const asOf = formatBudgetDate(report.today);
  const asOfHtml = asOf ? `<p class="bt-asof">As of ${escapeBudgetHtml(asOf)}</p>` : '';
  return `<div class="bt-report">${asOfHtml}`
    + _sectionHtml(report.monthly || { groups: [] }, 'monthly', resolved)
    + _sectionHtml(report.annual || { groups: [] }, 'annual', resolved)
    + '</div>';
}

/**
 * Draw the report into a container.
 *
 * @param {HTMLElement} container
 * @param {Object} report
 * @param {Object} [options] - as buildBudgetReportHtml
 */
function renderBudgetReport(container, report, options = {}) {
  if (!container) return;
  container.innerHTML = buildBudgetReportHtml(report, options);
}
