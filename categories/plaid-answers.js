// ============================================================
// categories/plaid-answers.js — pure helpers for Plaid categories the
// user has not mapped yet: reading them from the categories GET, adding
// the user's answers to a save, and the words the page shows about them.
// No DOM access, so node tests can load this file.
//
// Depends on (loaded earlier): categories/label-answers.js
//   summarizeAnswerResult
// ============================================================

const PLAID_ANSWER_KEEP = 'keep';
const PLAID_ANSWER_LABEL = 'label';

/**
 * The unanswered Plaid categories the categories GET lists. An API that does
 * not send the field has none.
 * @param {Object} data The GET's body.
 * @returns {Array<{code: string, primary: string, name: string, transactions: number}>}
 */
function readUnansweredPlaidCategories(data) {
  const list = data && Array.isArray(data.unanswered_plaid_categories) ? data.unanswered_plaid_categories : [];
  return list
    .filter(entry => entry && typeof entry.code === 'string' && entry.code.trim() !== '')
    .map(entry => ({
      code: entry.code,
      primary: typeof entry.primary === 'string' ? entry.primary : '',
      name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : entry.code,
      transactions: Math.max(0, Math.floor(Number(entry.transactions) || 0)),
    }));
}

/**
 * The label an answer sends for its code.
 * @param {{choice: string, label?: string}|undefined} answer
 * @param {string} catchAllLabel The label "Keep" sends.
 * @returns {string} Empty when the answer is incomplete, so nothing is sent.
 */
function plaidAnswerLabel(answer, catchAllLabel) {
  if (!answer) return '';
  if (answer.choice === PLAID_ANSWER_KEEP) return (catchAllLabel || '').trim();
  if (answer.choice === PLAID_ANSWER_LABEL) return (answer.label || '').trim();
  return '';
}

/**
 * The answers a save will send: only codes still unanswered, and only ones
 * with a label to send. Each carries the label it sends.
 * @param {Object} answers {code: {choice, label?}}
 * @param {Array<{code: string}>} unanswered From readUnansweredPlaidCategories.
 * @param {string} catchAllLabel
 * @returns {Object} {code: {choice, label}}
 */
function plaidAnswersToSend(answers, unanswered, catchAllLabel) {
  const sent = {};
  (unanswered || []).forEach(entry => {
    const answer = (answers || {})[entry.code];
    const label = plaidAnswerLabel(answer, catchAllLabel);
    if (label) sent[entry.code] = { choice: answer.choice, label };
  });
  return sent;
}

/**
 * The mappings to save with the answered codes added. The API reads any
 * key present as an answer, so a code the user has not chosen for stays out.
 * @param {Object<string, string>} mappings The user's mapped keys.
 * @param {Object} sentAnswers From plaidAnswersToSend.
 * @returns {Object<string, string>} A copy.
 */
function withPlaidCategoryAnswers(mappings, sentAnswers) {
  const merged = { ...(mappings || {}) };
  Object.entries(sentAnswers || {}).forEach(([code, answer]) => {
    if (answer && answer.label) merged[code] = answer.label;
  });
  return merged;
}

function _transactionsText(count) {
  return `${count} ${count === 1 ? 'transaction' : 'transactions'}`;
}

/**
 * One sentence per answered code for the save's result. The sentence follows
 * the choice the user made; the API's count only says how many rows moved
 * when they picked a label, since a save that also renames the catch-all
 * can report rows for a "Keep" answer.
 * @param {Object} sentAnswers From plaidAnswersToSend.
 * @param {Object|undefined} answeredCounts The response's answered_plaid_categories.
 * @param {Array<{code: string, name: string}>} unanswered For the names.
 * @returns {string[]}
 */
function describePlaidCategoryAnswers(sentAnswers, answeredCounts, unanswered) {
  const names = {};
  (unanswered || []).forEach(entry => { names[entry.code] = entry.name; });
  const counts = answeredCounts && typeof answeredCounts === 'object' ? answeredCounts : null;

  return Object.entries(sentAnswers || {}).map(([code, answer]) => {
    const name = names[code] || code;
    if (answer.choice === PLAID_ANSWER_KEEP) {
      return `${name} now stays in ${answer.label}.`;
    }
    const sentCount = counts ? counts[code] : undefined;
    if (sentCount === undefined || sentCount === null || !Number.isFinite(Number(sentCount))) {
      return `${name} now files under ${answer.label}.`;
    }
    const moved = Math.max(0, Math.floor(Number(sentCount)));
    if (moved === 0) return `${name} now files under ${answer.label}; it had no transactions to move.`;
    return `${name} now files under ${answer.label}; ${_transactionsText(moved)} moved there.`;
  });
}

/**
 * The whole result message of a mappings save.
 * @param {Object} data The success response.
 * @param {Object} sentAnswers From plaidAnswersToSend.
 * @param {Array} unanswered For the names.
 * @returns {string} Exactly "Mappings saved" when nothing moved and nothing was answered.
 */
function summarizeMappingsSave(data, sentAnswers, unanswered) {
  const base = summarizeAnswerResult(data);
  const answerLines = describePlaidCategoryAnswers(sentAnswers, (data || {}).answered_plaid_categories, unanswered);
  if (answerLines.length === 0) return base;
  return `${base}. ${answerLines.join(' ')}`;
}

/**
 * The notice's heading.
 * @param {number} count Unanswered categories.
 * @returns {string}
 */
function unansweredNoticeTitle(count) {
  if (count === 1) return 'Plaid sent a category you haven\'t mapped';
  return `Plaid sent ${count} categories you haven't mapped`;
}

/**
 * The notice's explanation, one string per paragraph. It says that keeping
 * the rows in the catch-all is an answer too, and that only an answer ends
 * the notice, since a user content with where the rows landed has done
 * nothing wrong and would otherwise wonder why it stays.
 * @param {number} count Unanswered categories.
 * @param {string} catchAllLabel
 * @returns {string[]}
 */
function unansweredNoticeParagraphs(count, catchAllLabel) {
  const theirs = count === 1 ? 'Its transactions are' : 'Their transactions are';
  const each = count === 1 ? 'this category' : 'each one';
  return [
    `${theirs} filing under ${catchAllLabel} until you choose where they go.`,
    `Pick a label to move them there, or keep them in ${catchAllLabel} if that is where you want them. `
      + `Either is a fine answer, but it is one you give here: this notice stays until you choose for ${each}.`,
  ];
}

/**
 * The line under an unanswered category's name.
 * @param {number} count Its rows in the catch-all that a label answer would move.
 * @param {string} catchAllLabel
 * @returns {string}
 */
function describeRowsInCatchAll(count, catchAllLabel) {
  if (!(count > 0)) return `No transactions yet. New ones will file under ${catchAllLabel} until you choose.`;
  return `${_transactionsText(count)} waiting in ${catchAllLabel}`;
}
