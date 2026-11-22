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
//
// A monthly spending row's pace settings sit in the same draft under
// their own keys ("paceOn|Category", "paceBand|Category"), so a year's
// switch, Undo and the unsaved check treat them like the amounts. The
// dollar form of the band is never stored: it is the percent of the
// monthly amount, worked out when drawn.
// ============================================================

const BUDGET_CADENCES = ['monthly', 'annual'];

const BUDGET_CADENCE_LABELS = {
  monthly: 'Monthly',
  annual: 'Annual',
};

const PACE_DEFAULT_ON = true;
const PACE_DEFAULT_BAND_TEXT = '5';
const PACE_TOGGLE_TITLE = 'Show pace on this line';
const PACE_NEEDS_MONTHLY_TITLE = 'Enter a monthly amount first';
const PACE_BAND_PERCENT_TITLE = 'On-pace band, as a percent of the monthly amount';
const PACE_BAND_DOLLARS_TITLE = 'On-pace band, in dollars';
const PACE_BAND_OFF_TITLE = 'Turn Pace on to set the band';
const PACE_REFUSAL_REASONS = ['invalid_pace_band', 'invalid_track_pace'];

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
 * The draft key for one of a row's pace settings.
 *
 * @param {'paceOn'|'paceBand'} field
 * @param {string} category
 * @returns {string}
 */
function paceDraftKey(field, category) {
  return `${field}|${category}`;
}

function _isPaceDraftKey(key) {
  return key.startsWith('paceOn|') || key.startsWith('paceBand|');
}

/**
 * A band percent as its field shows it, without needless trailing zeros.
 *
 * @param {number|string} value
 * @returns {string} "5", "29.347"; '' when it is not a number
 */
function formatPaceBandPercent(value) {
  if (value === '' || value === null || value === undefined) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return String(Number(number.toFixed(4)));
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
    if (target.cadence !== 'monthly') continue;
    if (typeof target.track_pace === 'boolean') {
      draft[paceDraftKey('paceOn', target.category)] = String(target.track_pace);
    }
    const band = formatPaceBandPercent(target.pace_band_percent);
    if (band !== '') draft[paceDraftKey('paceBand', target.category)] = band;
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
 * Every monthly spending target also carries its two pace settings,
 * from the draft or else from what the API remembers for the category.
 * A band that is not a number is sent as typed, so the API refuses it
 * and the refusal lands on the row.
 *
 * @param {Array<Object>} rows - from flattenTargetsFormRows
 * @param {Object<string, string>} draft
 * @param {Object<string, {track_pace: boolean, pace_band_percent: number}>} [remembered]
 * @returns {Array<{category: string, cadence: string, amount: string,
 *   track_pace?: boolean, pace_band_percent?: number|string}>}
 */
function buildTargetsPayload(rows, draft, remembered) {
  const targets = [];
  for (const row of rows) {
    for (const cadence of BUDGET_CADENCES) {
      const text = normalizeTargetInput(draft[targetDraftKey(row.category, cadence)]);
      if (!text) continue;
      const target = { category: row.category, cadence, amount: text };
      if (cadence === 'monthly' && row.kind === 'spending') {
        const pace = resolveRowPace(draft, row.category, remembered);
        const band = normalizeTargetInput(pace.bandText);
        target.track_pace = pace.on;
        target.pace_band_percent = band !== '' && Number.isFinite(Number(band)) ? Number(band) : band;
      }
      targets.push(target);
    }
  }
  return targets;
}

/**
 * A row's pace settings as the form holds them: the draft's own, else
 * the category's remembered ones, else on and 5.
 *
 * @param {Object<string, string>} draft - the year being edited
 * @param {string} category
 * @param {Object} [remembered] - the API's pace_settings
 * @returns {{on: boolean, bandText: string}}
 */
function resolveRowPace(draft, category, remembered) {
  const onText = (draft || {})[paceDraftKey('paceOn', category)];
  const bandText = (draft || {})[paceDraftKey('paceBand', category)];
  const memory = remembered && remembered[category];
  let on = PACE_DEFAULT_ON;
  if (onText !== undefined) on = onText === 'true';
  else if (memory && typeof memory.track_pace === 'boolean') on = memory.track_pace;

  let band = PACE_DEFAULT_BAND_TEXT;
  if (bandText !== undefined) band = bandText;
  else if (memory && formatPaceBandPercent(memory.pace_band_percent) !== '') {
    band = formatPaceBandPercent(memory.pace_band_percent);
  }
  return { on, bandText: band };
}

/**
 * Write one change to a row's pace settings into the draft. Both keys
 * are written, so the row keeps what it showed even if the remembered
 * settings change later.
 *
 * @param {Object<string, string>} draft - changed in place
 * @param {string} category
 * @param {Object} [remembered]
 * @param {{on?: boolean, bandText?: string}} change
 */
function setRowPace(draft, category, remembered, change) {
  const current = resolveRowPace(draft, category, remembered);
  const on = change.on === undefined ? current.on : change.on;
  const bandText = change.bandText === undefined ? current.bandText : change.bandText;
  draft[paceDraftKey('paceOn', category)] = String(on);
  draft[paceDraftKey('paceBand', category)] = bandText;
}

function _positiveAmount(text) {
  const normalized = normalizeTargetInput(text);
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * The band in dollars: the monthly amount times the percent, to the cent.
 *
 * @param {string} monthlyText - the Monthly field
 * @param {string} percentText - the band's percent field
 * @returns {string} '' when either is not a usable number
 */
function bandDollarsFromPercent(monthlyText, percentText) {
  const monthly = _positiveAmount(monthlyText);
  const percentField = normalizeTargetInput(percentText);
  const percent = Number(percentField);
  if (monthly === null || percentField === '' || !Number.isFinite(percent) || percent < 0) return '';
  const cents = Math.round(Number((monthly * percent).toFixed(6)));
  return formatTargetFieldValue(cents / 100);
}

/**
 * The band as a percent: dollars over the monthly amount times 100, to
 * 4 places, the precision the API stores.
 *
 * @param {string} monthlyText
 * @param {string} dollarsText
 * @returns {string} '' when either is not a usable number
 */
function bandPercentFromDollars(monthlyText, dollarsText) {
  const monthly = _positiveAmount(monthlyText);
  const dollarsField = normalizeTargetInput(dollarsText);
  const dollars = Number(dollarsField);
  if (monthly === null || dollarsField === '' || !Number.isFinite(dollars) || dollars < 0) return '';
  return formatPaceBandPercent((dollars / monthly) * 100);
}

/**
 * What a row's pace controls show and whether they can be used.
 * Savings rows have none.
 *
 * @param {{kind: string}} row
 * @param {string} monthlyText - the Monthly field now
 * @param {{on: boolean, bandText: string}} pace - from resolveRowPace
 * @returns {null|{toggleDisabled: boolean, toggleTitle: string, bandDisabled: boolean,
 *   percentTitle: string, dollarsTitle: string, dollarsText: string}}
 */
function paceControlState(row, monthlyText, pace) {
  if (row.kind !== 'spending') return null;
  const hasMonthly = normalizeTargetInput(monthlyText) !== '';
  if (!hasMonthly) {
    return {
      toggleDisabled: true,
      toggleTitle: PACE_NEEDS_MONTHLY_TITLE,
      bandDisabled: true,
      percentTitle: PACE_NEEDS_MONTHLY_TITLE,
      dollarsTitle: PACE_NEEDS_MONTHLY_TITLE,
      dollarsText: '',
    };
  }
  const bandDisabled = !pace.on;
  return {
    toggleDisabled: false,
    toggleTitle: PACE_TOGGLE_TITLE,
    bandDisabled,
    percentTitle: bandDisabled ? PACE_BAND_OFF_TITLE : PACE_BAND_PERCENT_TITLE,
    dollarsTitle: bandDisabled ? PACE_BAND_OFF_TITLE : PACE_BAND_DOLLARS_TITLE,
    dollarsText: bandDollarsFromPercent(monthlyText, pace.bandText),
  };
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
    const now = _comparableDraftValue(draft || {}, key);
    const before = _comparableDraftValue(savedDraft || {}, key);
    if (now !== before) return true;
  }
  return false;
}

// A pace setting on a row with no monthly amount is never sent, so it
// is not a change; a band is compared as a number, since "5" and "5.0"
// are the same band.
function _comparableDraftValue(draft, key) {
  if (!_isPaceDraftKey(key)) return normalizeTargetInput(draft[key]);
  const category = key.slice(key.indexOf('|') + 1);
  if (normalizeTargetInput(draft[targetDraftKey(category, 'monthly')]) === '') return '';
  const text = normalizeTargetInput(draft[key]);
  if (!key.startsWith('paceBand|')) return text;
  const formatted = formatPaceBandPercent(text);
  return formatted === '' ? text : formatted;
}

/**
 * Whether a draft holds any amount.
 *
 * @param {Object<string, string>} draft
 * @returns {boolean}
 */
function targetsDraftHasValues(draft) {
  return Object.keys(draft || {}).some(key =>
    !_isPaceDraftKey(key) && normalizeTargetInput(draft[key]) !== '');
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
 * A pace refusal also says so (paceReason), so the editor can mark the
 * pace controls on that row instead of the amount.
 *
 * @returns {{category: string|null, cadence: string|null, message: string, paceReason?: string}}
 */
function placeTargetsRefusal(refusal, sentTargets) {
  const body = refusal || {};
  const message = body.error || 'The targets could not be saved.';

  if (body.reason === 'details_exceed_primary' && body.primary) {
    return { category: body.primary, cadence: body.cadence || null, message };
  }

  const index = Number.isInteger(body.index) ? body.index : null;
  const sentEntry = index !== null && Array.isArray(sentTargets) ? sentTargets[index] : null;
  const paceFields = PACE_REFUSAL_REASONS.includes(body.reason) ? { paceReason: body.reason } : {};
  if (sentEntry) {
    return { category: sentEntry.category, cadence: sentEntry.cadence || null, message, ...paceFields };
  }
  if (body.category) {
    return { category: body.category, cadence: body.cadence || null, message, ...paceFields };
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

/**
 * Which way a key moves between target fields, or null when the key should
 * do its usual work inside the field. Left and Right leave the field only
 * from its edge with nothing selected, so they still move the caret through
 * an amount being corrected.
 *
 * @param {string} key - the KeyboardEvent key
 * @param {number} selectionStart - caret or selection start in the field
 * @param {number} selectionEnd - caret or selection end in the field
 * @param {number} valueLength - length of the field's text
 * @returns {'up'|'down'|'left'|'right'|null}
 */
function targetFieldMoveForKey(key, selectionStart, selectionEnd, valueLength) {
  if (key === 'ArrowUp') return 'up';
  if (key === 'ArrowDown' || key === 'Enter') return 'down';
  if (selectionStart !== selectionEnd) return null;
  if (key === 'ArrowLeft' && selectionStart === 0) return 'left';
  if (key === 'ArrowRight' && selectionEnd === valueLength) return 'right';
  return null;
}

/**
 * The field a move lands on, counting only the rows on screen. A move off
 * the edge of the grid lands nowhere, so the caret stays where it is.
 *
 * @param {number} rowCount - rows currently shown
 * @param {number} rowIndex - the focused field's row among them
 * @param {string} cadence - the focused field's cadence
 * @param {'up'|'down'|'left'|'right'} move
 * @returns {{rowIndex: number, cadence: string}|null}
 */
function nextTargetFieldPosition(rowCount, rowIndex, cadence, move) {
  const cadenceIndex = BUDGET_CADENCES.indexOf(cadence);
  if (rowIndex < 0 || rowIndex >= rowCount || cadenceIndex < 0) return null;

  let nextRow = rowIndex;
  let nextCadence = cadenceIndex;
  if (move === 'up') nextRow -= 1;
  else if (move === 'down') nextRow += 1;
  else if (move === 'left') nextCadence -= 1;
  else if (move === 'right') nextCadence += 1;
  else return null;

  if (nextRow < 0 || nextRow >= rowCount) return null;
  if (nextCadence < 0 || nextCadence >= BUDGET_CADENCES.length) return null;
  return { rowIndex: nextRow, cadence: BUDGET_CADENCES[nextCadence] };
}
