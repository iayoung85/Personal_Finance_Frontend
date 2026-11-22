// ============================================================
// budget/targets-form.js — the targets editor's pure logic
//
// Rows, the draft a year's fields hold, the PUT body, where a
// refusal goes, and whether Set alert can be used. No DOM here;
// budget/targets.js draws and wires the editor.
//
// A draft is {key: text} where the key names a category and a
// cadence; blank text means no target. The API decides what counts
// as a valid amount, so the text is sent as typed, less "$" and
// thousands commas.
// ============================================================

const BUDGET_CADENCES = ['monthly', 'annual'];

const BUDGET_CADENCE_LABELS = {
  monthly: 'Monthly',
  annual: 'Annual',
};

const SET_ALERT_PRIMARY_REASON =
  'An alert watches one detailed category. Set it on a category under this one.';
const SET_ALERT_SAVINGS_REASON =
  'Alerts watch spending, so a savings target cannot have one.';

/**
 * The draft key for one field.
 *
 * @param {string} category - a full label, or a bare primary
 * @param {string} cadence - 'monthly' or 'annual'
 * @returns {string}
 */
function targetDraftKey(category, cadence) {
  return `${cadence}|${category}`;
}

/**
 * A stored amount as the field shows it: "600" or "612.50".
 *
 * @param {number} amount
 * @returns {string}
 */
function formatTargetFieldValue(amount) {
  const number = Number(amount);
  if (!Number.isFinite(number)) return '';
  const cents = Math.round(number * 100);
  if (cents % 100 === 0) return String(cents / 100);
  return (cents / 100).toFixed(2);
}

/**
 * One fiscal year's saved targets as a draft.
 *
 * @param {Array<{category: string, cadence: string, amount: number}>} targets
 * @returns {Object<string, string>}
 */
function draftFromYearTargets(targets) {
  const draft = {};
  for (const target of targets || []) {
    draft[targetDraftKey(target.category, target.cadence)] = formatTargetFieldValue(target.amount);
  }
  return draft;
}

/**
 * Field text as it is sent: trimmed, without "$", commas or spaces.
 *
 * @param {string} rawText
 * @returns {string} '' for a blank field
 */
function normalizeTargetInput(rawText) {
  return String(rawText === undefined || rawText === null ? '' : rawText)
    .replace(/[$,\s]/g, '');
}

function _detailedName(label) {
  const colonIndex = label.indexOf(':');
  if (colonIndex < 0) return label;
  return label.slice(colonIndex + 1).trim();
}

/**
 * The editor's sections and rows from the GET's categories, in the
 * API's order: spending primaries, then savings, each primary's own
 * row first and its labels under it.
 *
 * @param {Array<{primary: string, kind: string, labels: string[]}>} categories
 * @returns {Array<{kind: string, groups: Array<{primary: string, kind: string,
 *   rows: Array<{category: string, name: string, kind: string, isPrimary: boolean}>}>}>}
 */
function buildTargetsFormSections(categories) {
  const sections = [];
  for (const group of categories || []) {
    let section = sections.find(candidate => candidate.kind === group.kind);
    if (!section) {
      section = { kind: group.kind, groups: [] };
      sections.push(section);
    }
    const rows = [{ category: group.primary, name: group.primary, kind: group.kind, isPrimary: true }];
    for (const label of group.labels || []) {
      rows.push({ category: label, name: _detailedName(label), kind: group.kind, isPrimary: false });
    }
    section.groups.push({ primary: group.primary, kind: group.kind, rows });
  }
  return sections;
}

/**
 * Every row of the form, in the order it is drawn.
 *
 * @param {Array} sections - from buildTargetsFormSections
 * @returns {Array<Object>}
 */
function flattenTargetsFormRows(sections) {
  const rows = [];
  for (const section of sections) {
    for (const group of section.groups) rows.push(...group.rows);
  }
  return rows;
}

/**
 * The PUT body's targets for one year: every non-blank field, in the
 * order the rows are drawn, monthly before annual.
 *
 * @param {Array<Object>} rows - from flattenTargetsFormRows
 * @param {Object<string, string>} draft
 * @returns {Array<{category: string, cadence: string, amount: string}>}
 */
function buildTargetsPayload(rows, draft) {
  const targets = [];
  for (const row of rows) {
    for (const cadence of BUDGET_CADENCES) {
      const text = normalizeTargetInput(draft[targetDraftKey(row.category, cadence)]);
      if (!text) continue;
      targets.push({ category: row.category, cadence, amount: text });
    }
  }
  return targets;
}

/**
 * Whether a draft differs from the saved year. Blank fields and a
 * missing key are the same thing; "600" and "600.00" are not compared
 * as numbers, since the API is the one that reads them.
 *
 * @param {Object<string, string>} draft
 * @param {Object<string, string>} savedDraft
 * @returns {boolean}
 */
function isTargetsDraftChanged(draft, savedDraft) {
  const keys = new Set([...Object.keys(draft || {}), ...Object.keys(savedDraft || {})]);
  for (const key of keys) {
    const now = normalizeTargetInput((draft || {})[key]);
    const before = normalizeTargetInput((savedDraft || {})[key]);
    if (now !== before) return true;
  }
  return false;
}

/**
 * Whether a draft holds any amount.
 *
 * @param {Object<string, string>} draft
 * @returns {boolean}
 */
function targetsDraftHasValues(draft) {
  return Object.values(draft || {}).some(value => normalizeTargetInput(value) !== '');
}

/**
 * Where a save refusal belongs.
 *
 * An entry the API names by index is the field that entry came from.
 * A parent-rule refusal carries no index; it goes to the primary's
 * field for the cadence it names. Anything else is for the whole form.
 *
 * @param {Object} refusal - the 400/409 body: {error, reason, index?, primary?, cadence?, category?}
 * @param {Array<{category: string, cadence: string}>} sentTargets - the body that was sent
 * @returns {{category: string|null, cadence: string|null, message: string}}
 */
function placeTargetsRefusal(refusal, sentTargets) {
  const body = refusal || {};
  const message = body.error || 'The targets could not be saved.';

  if (body.reason === 'details_exceed_primary' && body.primary) {
    return { category: body.primary, cadence: body.cadence || null, message };
  }

  const index = Number.isInteger(body.index) ? body.index : null;
  const sentEntry = index !== null && Array.isArray(sentTargets) ? sentTargets[index] : null;
  if (sentEntry) {
    return { category: sentEntry.category, cadence: sentEntry.cadence || null, message };
  }
  if (body.category) {
    return { category: body.category, cadence: body.cadence || null, message };
  }
  return { category: null, cadence: null, message };
}

/**
 * Whether one field's Set alert can be pressed, and why not.
 *
 * @param {{isPrimary: boolean, kind: string}} row
 * @param {string} cadence
 * @param {string} fieldText - what the field holds now
 * @returns {{enabled: boolean, reason: string}}
 */
function setAlertAvailability(row, cadence, fieldText) {
  if (row.kind === 'savings') return { enabled: false, reason: SET_ALERT_SAVINGS_REASON };
  if (row.isPrimary) return { enabled: false, reason: SET_ALERT_PRIMARY_REASON };
  const amount = Number(normalizeTargetInput(fieldText));
  const cadenceWord = (BUDGET_CADENCE_LABELS[cadence] || cadence).toLowerCase();
  if (!normalizeTargetInput(fieldText) || !Number.isFinite(amount) || amount <= 0) {
    const article = cadenceWord === 'annual' ? 'an' : 'a';
    return { enabled: false, reason: `Enter ${article} ${cadenceWord} target first.` };
  }
  return {
    enabled: true,
    reason: `Open Spending Alerts in a new tab with this ${cadenceWord} target filled in.`,
  };
}

/**
 * The fiscal start month, read off a year the API sent, so the alert's
 * yearly reset matches the API's dates.
 *
 * @param {{start: string}} yearEntry - e.g. {start: "2026-11-01"}
 * @returns {number} 1-12, January when the date is unreadable
 */
function fiscalStartMonthOfYear(yearEntry) {
  const month = Number(String((yearEntry && yearEntry.start) || '').split('-')[1]);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1;
}
