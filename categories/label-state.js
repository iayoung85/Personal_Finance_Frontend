// ============================================================
// categories/label-state.js — What each listed label is
// Pure helpers: no DOM, no network. They decide, from the data the
// API sent, whether a label is listed, custom or mapping-only, and
// whether the app has locked it. The API owns which labels are
// locked; nothing here names one.
// ============================================================

const LOCKED_LABEL_FALLBACK_MESSAGE = "The app writes this label itself, so it can't be changed.";

/**
 * Clean the API's locked_labels list.
 * @param {*} raw The GET's locked_labels, or undefined from an older API or cache.
 * @returns {Array<{label: string, mapping_key: string, reason: string, message: string}>}
 *   Empty when the list is missing or malformed.
 */
function normalizeLockedLabels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(entry => entry && typeof entry.label === 'string' && entry.label)
    .map(entry => ({
      label: entry.label,
      mapping_key: typeof entry.mapping_key === 'string' ? entry.mapping_key : '',
      reason: typeof entry.reason === 'string' ? entry.reason : '',
      message: typeof entry.message === 'string' && entry.message
        ? entry.message
        : LOCKED_LABEL_FALLBACK_MESSAGE
    }));
}

/**
 * Clean the API's plaid_named_labels list.
 * @param {*} raw The GET's plaid_named_labels, or undefined from an older API or cache.
 * @returns {string[]} Empty when the list is missing or malformed.
 */
function normalizePlaidNamedLabels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(label => typeof label === 'string' && label);
}

/**
 * The locked entry for a label, if the API locked it.
 * @param {string} label
 * @param {Array} lockedLabels Normalized locked_labels.
 * @returns {Object|null}
 */
function findLockedLabel(label, lockedLabels) {
  return (lockedLabels || []).find(entry => entry.label === label) || null;
}

/**
 * The locked entry for a Plaid key, if the API locked that key.
 * @param {string} mappingKey
 * @param {Array} lockedLabels Normalized locked_labels.
 * @returns {Object|null}
 */
function findLockedKey(mappingKey, lockedLabels) {
  if (!mappingKey) return null;
  return (lockedLabels || []).find(entry => entry.mapping_key === mappingKey) || null;
}

/**
 * The locked entry for a key under a Plaid primary, if the primary holds one.
 * @param {string} plaidPrimaryDisplay The primary as the page shows it.
 * @param {Array<{primary: string, detailed: string}>} taxonomy Plaid's categories.
 * @param {Array} lockedLabels Normalized locked_labels.
 * @param {function(string): string} formatPrimary Turns a taxonomy primary into its display name.
 * @returns {Object|null}
 */
function lockedKeyUnderPlaidPrimary(plaidPrimaryDisplay, taxonomy, lockedLabels, formatPrimary) {
  for (const entry of taxonomy || []) {
    if (formatPrimary(entry.primary || '') !== plaidPrimaryDisplay) continue;
    const lockedKey = findLockedKey(entry.detailed, lockedLabels);
    if (lockedKey) return lockedKey;
  }
  return null;
}

/**
 * Every label in the user's list: the custom ones and the ones a Plaid
 * key maps to.
 * @param {string[]} customCategories
 * @param {Object<string, string>} categoryMappings Plaid key to label.
 * @returns {string[]} Unique labels, in the order custom ones then mapped ones appear.
 */
function listedLabels(customCategories, categoryMappings) {
  const seen = new Set();
  const labels = [];
  const add = value => {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) return;
    seen.add(value);
    labels.push(value);
  };
  (customCategories || []).forEach(add);
  Object.values(categoryMappings || {}).forEach(add);
  return labels;
}

/**
 * What one label is.
 * @param {string} label
 * @param {{customCategories: string[], categoryMappings: Object, lockedLabels: Array,
 *   plaidNamedLabels: string[]}} lists
 * @returns {{label: string, isListed: boolean, isCustom: boolean, isMappingOnly: boolean,
 *   isPlaidNamed: boolean, locked: Object|null, lockMessage: string}}
 *   isMappingOnly: listed through a Plaid key and not in the custom list.
 *   isPlaidNamed: Plaid's own name for a key mapped to it, as the API says;
 *   this is what the `#plaid` badge marks.
 */
function describeLabel(label, lists) {
  const customCategories = lists.customCategories || [];
  const mappedValues = Object.values(lists.categoryMappings || {});
  const isCustom = customCategories.includes(label);
  const isMapped = mappedValues.includes(label);
  const locked = findLockedLabel(label, lists.lockedLabels);
  return {
    label,
    isListed: isCustom || isMapped,
    isCustom,
    isMappingOnly: isMapped && !isCustom,
    isPlaidNamed: (lists.plaidNamedLabels || []).includes(label),
    locked,
    lockMessage: locked ? locked.message : ''
  };
}

/**
 * Group the whole list by primary, with each label's state.
 * A primary is the part before the first colon, spelled as the list spells
 * it, because the API matches a primary exactly when reassigning it.
 * @param {{customCategories: string[], categoryMappings: Object, lockedLabels: Array}} lists
 * @returns {Array<{primary: string, labels: Array, primaryOnly: Object|null,
 *   holdsLocked: boolean, lockMessage: string}>}
 *   Sorted by primary. labels holds the "Primary: Detailed" entries (each
 *   with detailed and every describeLabel field), sorted by detailed name;
 *   primaryOnly is the label with no colon, when the list has one.
 *   holdsLocked and lockMessage say whether any label under the primary is locked.
 */
function groupListedLabels(lists) {
  const groups = new Map();
  listedLabels(lists.customCategories, lists.categoryMappings).forEach(label => {
    const parts = parseCategoryName(label);
    if (!parts.primary) return;
    if (!groups.has(parts.primary)) {
      groups.set(parts.primary, { primary: parts.primary, labels: [], primaryOnly: null });
    }
    const group = groups.get(parts.primary);
    const description = describeLabel(label, lists);
    if (parts.detailed) {
      group.labels.push({ ...description, detailed: parts.detailed });
    } else {
      group.primaryOnly = description;
    }
  });

  return Array.from(groups.values())
    .map(group => {
      group.labels.sort((a, b) => a.detailed.localeCompare(b.detailed));
      const everyLabel = group.primaryOnly ? [...group.labels, group.primaryOnly] : group.labels;
      const firstLocked = everyLabel.find(entry => entry.locked);
      return {
        ...group,
        holdsLocked: Boolean(firstLocked),
        lockMessage: firstLocked ? firstLocked.lockMessage : ''
      };
    })
    .sort((a, b) => a.primary.localeCompare(b.primary));
}

/**
 * The mappings to send on a save, with each locked key's value as the API
 * holds it, so a local edit to one never reaches the request.
 * @param {Object<string, string>} mappings Plaid key to label.
 * @param {Array} lockedLabels Normalized locked_labels.
 * @returns {Object<string, string>} A copy. A locked key the list does not have stays absent.
 */
function withLockedMappingsKept(mappings, lockedLabels) {
  const kept = { ...mappings };
  (lockedLabels || []).forEach(entry => {
    if (entry.mapping_key && Object.prototype.hasOwnProperty.call(kept, entry.mapping_key)) {
      kept[entry.mapping_key] = entry.label;
    }
  });
  return kept;
}
