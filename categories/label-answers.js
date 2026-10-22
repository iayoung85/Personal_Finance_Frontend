// ============================================================
// categories/label-answers.js — pure helpers for the questions the API
// asks when a category-list edit would strand transactions, and for the
// CSV upload preview. No DOM access, so node tests can load this file.
// ============================================================

const USAGE_KINDS = [
  { key: 'transactions', singular: 'transaction', plural: 'transactions' },
  { key: 'rules', singular: 'rule', plural: 'rules' },
  { key: 'overrides', singular: 'override', plural: 'overrides' },
  { key: 'bills', singular: 'bill', plural: 'bills' },
  { key: 'alerts', singular: 'alert', plural: 'alerts' },
];

// The Plaid key whose mapping entry covers low-confidence rows of any key.
const CATCH_ALL_PLAID_KEY = 'OTHER_OTHER';

const CSV_TARGET_SOURCE_TEXT = {
  inferred: 'Inferred from your mappings',
  line: 'RETARGET line',
  keep: 'KEEP line',
};

/**
 * Describe what uses a label in words, e.g. "12 transactions, 2 rules, 1 bill".
 * @param {Object} usage - counts keyed transactions/rules/overrides/bills/alerts
 * @returns {string} Zero counts are left out; "nothing recorded" when all are zero.
 */
function describeUsageCounts(usage) {
  const parts = USAGE_KINDS
    .map(kind => ({ kind, count: Number((usage || {})[kind.key]) || 0 }))
    .filter(entry => entry.count > 0)
    .map(entry => `${entry.count} ${entry.count === 1 ? entry.kind.singular : entry.kind.plural}`);

  // A split transaction shows in the ledger as its pieces, so its own label
  // is only worth naming when nothing visible uses the label.
  const visibleTransactions = Number((usage || {}).transactions) || 0;
  const splitParents = Number((usage || {}).split_parents) || 0;
  if (visibleTransactions === 0 && splitParents > 0) {
    const splitNoun = splitParents === 1 ? 'split transaction' : 'split transactions';
    parts.unshift(`${splitParents} ${splitNoun}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'nothing recorded';
}

/**
 * Pull the two question lists out of a needs-an-answer 400. An older API sends
 * only labels_in_use, so a missing list counts as empty.
 * @param {Object} data
 * @returns {{ labels: Array, keys: Array }}
 */
function readMappingQuestions(data) {
  return {
    labels: Array.isArray(data && data.labels_in_use) ? data.labels_in_use : [],
    keys: Array.isArray(data && data.keys_with_past_rows) ? data.keys_with_past_rows : [],
  };
}

/**
 * Whether a label question has a complete answer.
 * @param {{choice?: string, target?: string}|undefined} answer
 */
function isLabelAnswered(answer) {
  if (!answer) return false;
  if (answer.choice === 'keep') return true;
  return answer.choice === 'merge' && Boolean(answer.target);
}

/**
 * True when every label and every key with past rows has an answer.
 * @param {{labels: Array, keys: Array}} questions
 * @param {Object} labelAnswers - {label: {choice, target}}
 * @param {Object} pastRowAnswers - {key: 'move'|'keep'}
 */
function allQuestionsAnswered(questions, labelAnswers, pastRowAnswers) {
  const labelsDone = questions.labels.every(item => isLabelAnswered((labelAnswers || {})[item.label]));
  const keysDone = questions.keys.every(item => {
    const answer = (pastRowAnswers || {})[item.key];
    return answer === 'move' || answer === 'keep';
  });
  return labelsDone && keysDone;
}

/**
 * Build the PUT body: the same mappings plus the user's answers. Empty answer
 * groups are left out so a plain save stays a plain save.
 * @param {Object} categoryMappings
 * @param {{labels: Array, keys: Array}} questions
 * @param {Object} labelAnswers
 * @param {Object} pastRowAnswers
 * @returns {Object}
 */
function buildMappingAnswersPayload(categoryMappings, questions, labelAnswers, pastRowAnswers) {
  const relabel = {};
  const keep = [];
  questions.labels.forEach(item => {
    const answer = (labelAnswers || {})[item.label];
    if (!answer) return;
    if (answer.choice === 'merge') relabel[item.label] = answer.target;
    if (answer.choice === 'keep') keep.push(item.label);
  });

  const pastRows = {};
  questions.keys.forEach(item => {
    const answer = (pastRowAnswers || {})[item.key];
    if (answer === 'move' || answer === 'keep') pastRows[item.key] = answer;
  });

  const payload = { category_mappings: categoryMappings };
  if (Object.keys(relabel).length > 0) payload.relabel = relabel;
  if (keep.length > 0) payload.keep = keep;
  if (Object.keys(pastRows).length > 0) payload.past_rows = pastRows;
  return payload;
}

/**
 * Opening sentence for the answer dialog, worded by what was asked.
 * @param {{labels: Array, keys: Array}} questions
 * @returns {string}
 */
function describeMappingQuestions(questions) {
  const labelsText = 'This change would leave transactions on labels that are no longer in your list.';
  const keysText = 'Some Plaid categories you remapped have past transactions on their old label.';
  if (questions.labels.length > 0 && questions.keys.length > 0) return `${labelsText} ${keysText}`;
  return questions.keys.length > 0 ? keysText : labelsText;
}

function _plural(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function _sumOfCounts(group) {
  return Object.values(group || {}).reduce((total, n) => total + (Number(n) || 0), 0);
}

/**
 * What an answered save or CSV apply moved, as short phrases. Zero or empty
 * groups are left out.
 * @param {Object} data - relabeled/kept/past_rows_moved/past_rows_kept, or the
 *   CSV names labels_relabeled/labels_kept
 * @returns {string[]}
 */
function _movePhrases(relabeled, kept, pastMoved, pastKept) {
  const parts = [];
  const relabeledEntries = Object.values(relabeled || {});
  if (relabeledEntries.length > 0) {
    const moved = relabeledEntries.reduce((total, entry) => total + (Number(entry && entry.transactions) || 0), 0);
    parts.push(`${_plural(relabeledEntries.length, 'label', 'labels')} merged (${_plural(moved, 'transaction', 'transactions')})`);
  }
  const keptCount = Object.keys(kept || {}).length;
  if (keptCount > 0) parts.push(`${_plural(keptCount, 'label', 'labels')} kept as custom ${keptCount === 1 ? 'category' : 'categories'}`);
  const movedPast = _sumOfCounts(pastMoved);
  if (movedPast > 0) parts.push(`${_plural(movedPast, 'past transaction', 'past transactions')} moved`);
  const keptPast = _sumOfCounts(pastKept);
  if (keptPast > 0) parts.push(`${_plural(keptPast, 'past transaction', 'past transactions')} kept on the old label`);
  return parts;
}

/**
 * One-line summary of an answered mapping save, from the success response.
 * @param {Object} data
 * @returns {string}
 */
function summarizeAnswerResult(data) {
  const d = data || {};
  const parts = _movePhrases(d.relabeled, d.kept, d.past_rows_moved, d.past_rows_kept);
  return parts.length > 0 ? `Mappings saved: ${parts.join('; ')}` : 'Mappings saved';
}

/**
 * Lines describing what a CSV apply moved, from its success response.
 * @param {Object} data
 * @returns {string[]} Empty when nothing moved.
 */
function describeCsvMoves(data) {
  const d = data || {};
  const lines = _movePhrases(d.labels_relabeled, d.labels_kept, d.past_rows_moved, d.past_rows_kept)
    .map(text => text.charAt(0).toUpperCase() + text.slice(1));
  const totals = [
    ['transactions_migrated', 'transaction', 'transactions'],
    ['bills_migrated', 'bill', 'bills'],
    ['alerts_migrated', 'alert', 'alerts'],
  ];
  totals.forEach(([field, singular, plural]) => {
    const count = Number(d[field]) || 0;
    if (count > 0) lines.push(`${_plural(count, singular, plural)} moved to new labels`);
  });
  return lines;
}

/**
 * Turn a CSV dry-run response into rows for the two preview tables.
 * @param {Object} dryRun - {labels_leaving, keys_remapped}; a missing list is empty
 * @returns {{labelRows: Array, keyRows: Array, movesNothing: boolean}}
 */
function buildCsvPreviewRows(dryRun) {
  const leaving = Array.isArray(dryRun && dryRun.labels_leaving) ? dryRun.labels_leaving : [];
  const remapped = Array.isArray(dryRun && dryRun.keys_remapped) ? dryRun.keys_remapped : [];

  const labelRows = leaving.map(entry => {
    let where = 'Needs a line';
    if (entry.target_source === 'keep') where = 'Kept as a custom category';
    else if (entry.target) where = entry.target;
    return {
      label: entry.label,
      counts: describeUsageCounts(entry),
      where,
      how: CSV_TARGET_SOURCE_TEXT[entry.target_source] || '',
      needsLine: !entry.target_source,
      inspect: buildInspectLink(buildInspectQuery(entry.label), entry.transactions),
      inspectable: (Number(entry.transactions) || 0) > 0,
    };
  });

  const keyRows = remapped.map(entry => {
    let answer = 'Needs a line';
    if (entry.answer === 'move') answer = 'Move to the new label';
    else if (entry.answer === 'keep') answer = 'Keep on the old label';
    return {
      key: entry.key,
      change: `${entry.from} → ${entry.to}`,
      transactions: Number(entry.transactions) || 0,
      answer,
      needsLine: !entry.answer,
      inspect: buildInspectLink(buildInspectQuery(entry.from, entry.key), entry.transactions),
      inspectable: (Number(entry.transactions) || 0) > 0,
    };
  });

  return { labelRows, keyRows, movesNothing: labelRows.length === 0 && keyRows.length === 0 };
}

/**
 * Transaction-search query for the rows a question is about.
 * @param {string} label - the label the rows carry now
 * @param {string} [plaidKey] - set for a remapped-key question
 * @returns {string}
 */
function buildInspectQuery(label, plaidKey) {
  const quoted = `label:"${String(label).replace(/"/g, '')}"`;
  if (!plaidKey) return quoted;
  const rest = '-is:override -is:transfer';
  if (plaidKey === CATCH_ALL_PLAID_KEY) return `${quoted} confidence:low is:plaid ${rest}`;
  return `${quoted} pfc:${plaidKey} is:plaid ${rest}`;
}

/**
 * Link target and text for inspecting a question's transactions.
 * @param {string} query
 * @param {number} count
 * @returns {{href: string, text: string}}
 */
function buildInspectLink(query, count) {
  const n = Number(count) || 0;
  return {
    href: `transactions.html?search=${encodeURIComponent(query)}`,
    text: `Inspect ${_plural(n, 'transaction', 'transactions')}`,
  };
}
