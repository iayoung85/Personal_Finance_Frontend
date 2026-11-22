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

const BUDGET_TICK_KEY_TEXT =
  "The tick marks today's pace: where spending would be if it were spread evenly over the month.";

const _BUDGET_MONTH_ABBREVIATIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * A dollar amount as the report prints it. With cents off, a whole
 * amount drops its ".00" and any other amount keeps its cents, which is
 * what the Settings checkbox ("Always show cents") describes.
 *
 * @param {number} amount
 * @param {boolean} showCents - the user's showCents preference
 * @returns {string} e.g. "$1,240.50", "$600", "-$50.00"
 */
function formatBudgetMoney(amount, showCents) {
  const cents = Math.round((Number(amount) || 0) * 100);
  // A rounded -0 would print as "-$0.00".
  const value = cents === 0 ? 0 : cents / 100;
  const isWhole = cents % 100 === 0;
  const fractionDigits = (showCents || !isWhole) ? 2 : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
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
 * Where the pace tick sits on this month's bars, as a percent of the
 * track: the share of the month gone, as the API counts days.
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

function _clampPercent(percent) {
  if (!Number.isFinite(percent) || percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}

function _paceWords(entry, money) {
  if (entry.pace === BUDGET_PACE_ON) return 'on pace';
  // The gap's sign is already in the word; -0 only comes with "on".
  const gap = money(Math.abs(Number(entry.pace_difference) || 0));
  if (entry.pace === BUDGET_PACE_OVER) return `over pace by ${gap}`;
  if (entry.pace === BUDGET_PACE_UNDER) return `under pace by ${gap}`;
  return '';
}

/**
 * One period's bar and its words, from the API's figures.
 *
 * Spending fills target-spent over target and never past the track; over
 * target it is full and red, with no pace word. Over pace fills orange.
 * Savings fills green toward the goal and is full at it. The tick is
 * drawn only when the caller passes tickPercent (this month's spending).
 *
 * @param {{target: number, actual: number, remaining: number,
 *          pace?: string|null, pace_difference?: number}} entry
 * @param {Object} options
 * @param {string} options.kind - 'spending' or 'savings'
 * @param {number|null} [options.tickPercent]
 * @param {boolean} [options.showCents]
 * @returns {{tone: string, fillPercent: number, tickPercent: number|null,
 *            isOver: boolean, isMet: boolean, summary: string,
 *            detail: string, text: string}}
 */
function buildBudgetBar(entry, options) {
  const kind = options.kind;
  const money = amount => formatBudgetMoney(amount, options.showCents);
  const target = Number(entry.target) || 0;
  const actual = Number(entry.actual) || 0;
  const remaining = Number(entry.remaining) || 0;
  const share = target > 0 ? (actual / target) * 100 : 0;

  if (kind === BUDGET_KIND_SAVINGS) {
    const isMet = remaining <= 0;
    let detail = `${money(remaining)} to go`;
    if (isMet) {
      detail = remaining < 0 ? `goal met, ${money(-remaining)} past it` : 'goal met';
    }
    const summary = `saved ${money(actual)} of ${money(target)}`;
    return {
      tone: BUDGET_TONE_SAVINGS,
      fillPercent: isMet ? 100 : _clampPercent(share),
      tickPercent: null,
      isOver: false,
      isMet,
      summary,
      detail,
      text: `${summary}, ${detail}`,
    };
  }

  const isOver = remaining < 0;
  const summary = `${money(actual)} of ${money(target)}`;
  const tickPercent = options.tickPercent === undefined || options.tickPercent === null
    ? null
    : _clampPercent(options.tickPercent);

  if (isOver) {
    const detail = `over by ${money(-remaining)}`;
    return {
      tone: BUDGET_TONE_OVER,
      fillPercent: 100,
      tickPercent,
      isOver: true,
      isMet: false,
      summary,
      detail,
      text: `${summary}, ${detail}`,
    };
  }

  const words = [`${money(remaining)} left`];
  const paceWords = _paceWords(entry, money);
  if (paceWords) words.push(paceWords);
  const detail = words.join(', ');
  return {
    tone: entry.pace === BUDGET_PACE_OVER ? BUDGET_TONE_PACE_OVER : BUDGET_TONE_NORMAL,
    fillPercent: _clampPercent(share),
    tickPercent,
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
 * A primary with its own target is a line with its details nested under
 * it. With no own target, two or more details sit under a plain heading,
 * and one detail alone is one flat "Primary: Detailed" line. A kind row
 * opens each kind when the section holds both spending and savings.
 *
 * @param {{groups: Array}} section - the API's monthly or annual section
 * @returns {Array<Object>} rows of type 'kind', 'heading' or 'line'
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

    if (group.own) {
      rows.push(_budgetLineRow({
        label: group.primary,
        category: group.primary,
        kind: group.kind,
        depth: 0,
        isPrimary: true,
        current: group.own.current,
        previous: group.own.previous,
      }));
      for (const line of lines) rows.push(_detailRow(group, line, 1));
      continue;
    }

    if (lines.length === 1) {
      const line = lines[0];
      rows.push(_budgetLineRow({
        label: `${group.primary}: ${line.name}`,
        category: line.category,
        kind: group.kind,
        depth: 0,
        isPrimary: false,
        current: line.current,
        previous: line.previous,
      }));
      continue;
    }

    if (lines.length > 1) {
      rows.push({ type: 'heading', label: group.primary, kind: group.kind });
      for (const line of lines) rows.push(_detailRow(group, line, 1));
    }
  }
  return rows;
}

function _detailRow(group, line, depth) {
  return _budgetLineRow({
    label: line.name,
    category: line.category,
    kind: group.kind,
    depth,
    isPrimary: false,
    current: line.current,
    previous: line.previous,
  });
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

function _barHtml(bar) {
  const tick = bar.tickPercent === null
    ? ''
    : `<span class="bt-tick" style="left:${bar.tickPercent.toFixed(2)}%"></span>`;
  return `<div class="bt-bar bt-tone-${bar.tone}" aria-hidden="true">`
    + `<span class="bt-fill" style="width:${bar.fillPercent.toFixed(2)}%"></span>${tick}</div>`;
}

function _periodCellHtml(entry, row, periodLabel, options) {
  const labelAttr = ` data-period="${escapeBudgetHtml(periodLabel)}"`;
  if (!entry) {
    return `<div class="bt-cell bt-cell-empty" role="cell"${labelAttr}>`
      + '<span class="bt-no-target">No target</span></div>';
  }
  const bar = buildBudgetBar(entry, {
    kind: row.kind,
    tickPercent: options.tickPercent,
    showCents: options.showCents,
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

function _headingRowHtml(row) {
  return `<div class="bt-row bt-row-heading bt-kind-${escapeBudgetHtml(row.kind)}" role="row">`
    + `<div class="bt-name" role="rowheader">${escapeBudgetHtml(row.label)}</div></div>`;
}

function _lineRowHtml(row, section, cadence, options) {
  const isSpending = row.kind === BUDGET_KIND_SPENDING;
  const currentTick = cadence === 'monthly' && isSpending
    ? budgetTickPercent(section.current)
    : null;
  const classes = ['bt-row', 'bt-row-line', `bt-depth-${row.depth}`, `bt-kind-${escapeBudgetHtml(row.kind)}`];
  if (row.isPrimary) classes.push('bt-row-primary');
  return `<div class="${classes.join(' ')}" role="row">`
    + `<div class="bt-name" role="rowheader" title="${escapeBudgetHtml(row.category)}">${escapeBudgetHtml(row.label)}</div>`
    + _periodCellHtml(row.current, row, section.current && section.current.label, {
      tickPercent: currentTick,
      showCents: options.showCents,
    })
    + _periodCellHtml(row.previous, row, section.previous && section.previous.label, {
      tickPercent: null,
      showCents: options.showCents,
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

  if (cadence === 'monthly') {
    html += '<p class="bt-key"><span class="bt-key-swatch" aria-hidden="true">'
      + '<span class="bt-key-tick"></span></span>'
      + `${escapeBudgetHtml(BUDGET_TICK_KEY_TEXT)}</p>`;
  }

  html += `<div class="bt-grid" role="table" aria-label="${title} targets">`;
  html += _sectionHeadRowHtml(section, cadence);
  for (const row of rows) {
    if (row.type === 'kind') html += _kindRowHtml(row);
    else if (row.type === 'heading') html += _headingRowHtml(row);
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
 * @param {boolean} [options.showCents=true]
 * @param {string} [options.targetsHref='budget.html#targets'] - where "set targets" links go
 * @param {boolean} [options.targetsInNewTab=false] - open those links in a new tab
 * @returns {string}
 */
function buildBudgetReportHtml(report, options = {}) {
  const resolved = {
    showCents: options.showCents !== false,
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
