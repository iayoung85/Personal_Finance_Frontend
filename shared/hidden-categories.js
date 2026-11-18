// ============================================================
// shared/hidden-categories.js
// Pure helpers for categories the user has hidden on the Categories page.
// A hidden label is still legal on a transaction, bill, split, rule or
// alert; it is only left out of what the pickers offer. These helpers keep
// the one check and the one sentence in a single place.
//
// No DOM and no globals needed, so tests load this file as is.
//
// Exports (globals):
//   hiddenCategoryKey(label)
//   findHiddenCategory(typed, hiddenCategories)
//   hiddenCategoryNotice(label)
//   hiddenCategoryEntry(typed, hiddenCategories, heldValue)
// ============================================================

/**
 * Comparison key for a category label: spacing collapsed, case ignored.
 * @param {string} label
 * @returns {string}
 */
function hiddenCategoryKey(label) {
  return String(label || '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The hidden label a typed text names exactly, or '' when it names none.
 * @param {string} typed
 * @param {string[]} hiddenCategories
 * @returns {string} The hidden label as the API spells it.
 */
function findHiddenCategory(typed, hiddenCategories) {
  const key = hiddenCategoryKey(typed);
  if (!key) return '';
  const match = (hiddenCategories || []).find(label => hiddenCategoryKey(label) === key);
  return match || '';
}

/**
 * The sentence shown when someone tries to assign a hidden category.
 * @param {string} label
 * @returns {string}
 */
function hiddenCategoryNotice(label) {
  return `${label} is hidden. Unhide it on the Categories page to use it.`;
}

/**
 * Decide what a typed category means when it names a hidden one.
 *
 * A control that already holds a hidden category must keep saving it, so a
 * typed value equal to the value the control held when it opened is
 * acceptable. Any other hidden label is refused with the notice.
 *
 * @param {string} typed What the user typed or picked.
 * @param {string[]} hiddenCategories Labels the API reports as hidden.
 * @param {string|string[]} [heldValue] The value the control held when it
 *   opened, or several when more than one counts as already held.
 * @returns {{label: string, held: boolean, notice: string}} `label` is ''
 *   when the text names no hidden category. `held` is true when it is the
 *   value the control already held. `notice` is set only when it must be
 *   refused.
 */
function hiddenCategoryEntry(typed, hiddenCategories, heldValue) {
  const label = findHiddenCategory(typed, hiddenCategories);
  if (!label) return { label: '', held: false, notice: '' };
  const heldValues = Array.isArray(heldValue) ? heldValue : [heldValue];
  if (heldValues.some(value => hiddenCategoryKey(value) === hiddenCategoryKey(label))) {
    return { label, held: true, notice: '' };
  }
  return { label, held: false, notice: hiddenCategoryNotice(label) };
}
