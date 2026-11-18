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

// ── The catch-all category ──────────────────────────────────
// The API says which label holds the role and which Plaid key it follows.
// Nothing here works the role out from the mappings.

const CATCH_ALL_TAG_HOVER = 'Bank transactions the app can\'t place land here. It means "not categorized yet". Open Edit for the details.';
const CATCH_ALL_NOTE_HEADING = 'This is your catch-all category';
const CATCH_ALL_NOTE_INTRO = 'Bank transactions land here when the app can\'t tell what they are:';
const CATCH_ALL_NOTE_REASONS = [
  'Plaid wasn\'t sure of its own category, and none of your rules matched.',
  'Plaid sent a category you haven\'t mapped.'
];
const CATCH_ALL_NOTE_CLOSING = 'The app treats everything in it as not categorized yet. '
  + 'Renaming it changes the name only: the same transactions keep landing here. '
  + 'A name like "Uncategorized" says what it is. '
  + 'A name like "Shopping: Misc" would fill a spending category with transactions nobody has sorted.';
const CATCH_ALL_PRIMARY_NOTE_HEADING = 'This primary holds your catch-all category';
const CATCH_ALL_PRIMARY_KIND_ADVICE = 'Keep the kind as Spending, so they count in your totals until you sort them. '
  + 'A kind like Adjustment or Transfer leaves them out of every total, '
  + 'and money goes uncounted without your knowing what it was.';
const CATCH_ALL_PRIMARY_NAME_ADVICE = 'Renaming the primary renames that category too. '
  + 'A name like "Uncategorized" says what it is.';
const CATCH_ALL_MAPPING_NOTE = 'Catch-all: transactions the app can\'t place go to this category.';
const CATCH_ALL_REMAP_TITLE = 'Move the catch-all?';
const CATCH_ALL_REMAP_CONFIRM_LABEL = 'Save mappings';

/**
 * Read the catch-all fields from the categories GET.
 * @param {Object} data The GET's body.
 * @param {string} fallbackKey The key to use when an API sends a label but no key.
 * @returns {{plaidKey: string, label: string}} An empty label means the API
 *   did not say, as an older API does not, and nothing catch-all shows.
 */
function readCatchAll(data, fallbackKey) {
  const body = data || {};
  const label = typeof body.catch_all_label === 'string' ? body.catch_all_label : '';
  const sentKey = typeof body.catch_all_plaid_key === 'string' ? body.catch_all_plaid_key : '';
  return { plaidKey: sentKey || fallbackKey || '', label };
}

/**
 * Whether a labels entry is the catch-all.
 * @param {Object|null|undefined} entry A `labels` entry from the GET.
 * @returns {boolean}
 */
function isCatchAllEntry(entry) {
  return Boolean(entry) && entry.catch_all === true;
}

/**
 * The catch-all among a primary's categories.
 * @param {Array|null|undefined} entries The primary's `labels` entries.
 * @returns {Object|null} The entry, or null when the primary does not hold it.
 */
function catchAllEntryIn(entries) {
  return (entries || []).find(isCatchAllEntry) || null;
}

/**
 * What the Edit dialog of the primary holding the catch-all says, one string
 * per paragraph. The advice on the kind is left out when the kind cannot be
 * changed there, since it could not be followed.
 * @param {string} catchAllLabel The catch-all category's label.
 * @param {boolean} kindIsEditable Whether the dialog offers a kind picker.
 * @returns {string[]}
 */
function catchAllPrimaryNoteParagraphs(catchAllLabel, kindIsEditable) {
  const paragraphs = [
    `${catchAllLabel} sits under this primary. It collects the bank transactions the app can't place, `
      + 'and most of them are real purchases nobody has sorted yet.'
  ];
  if (kindIsEditable) paragraphs.push(CATCH_ALL_PRIMARY_KIND_ADVICE);
  paragraphs.push(CATCH_ALL_PRIMARY_NAME_ADVICE);
  return paragraphs;
}

/**
 * Whether a Plaid key is the one the catch-all follows.
 * @param {string} plaidKey
 * @param {{plaidKey: string, label: string}} catchAll From readCatchAll.
 * @returns {boolean} False when the API did not name a catch-all label.
 */
function isCatchAllKey(plaidKey, catchAll) {
  return Boolean(catchAll && catchAll.label) && plaidKey === catchAll.plaidKey;
}

/**
 * Whether a merge hands the catch-all role to another category.
 * @param {Array<Object>} selectedEntries The selected `labels` entries.
 * @param {string} targetLabel The category that survives.
 * @returns {{source: string, target: string}|null} Null when the catch-all
 *   is not among the merged-away categories, or is the one that survives.
 */
function catchAllMergeMove(selectedEntries, targetLabel) {
  const source = (selectedEntries || []).find(
    entry => isCatchAllEntry(entry) && entry.label !== targetLabel
  );
  return source ? { source: source.label, target: targetLabel } : null;
}

/**
 * Whether saving these mappings points the catch-all key at another label.
 * @param {Object<string, string>} mappings What the save would send.
 * @param {{plaidKey: string, label: string}} catchAll As last loaded.
 * @returns {{from: string, to: string}|null} Null when the API named no
 *   catch-all, the key is unmapped, or its label is the one already holding the role.
 */
function catchAllRemapMove(mappings, catchAll) {
  if (!catchAll || !catchAll.label || !catchAll.plaidKey) return null;
  const sent = ((mappings || {})[catchAll.plaidKey] || '').trim();
  if (!sent || sent === catchAll.label) return null;
  return { from: catchAll.label, to: sent };
}

/**
 * The merge confirm's warning.
 * @param {string} source The catch-all being merged away.
 * @param {string} target The category that survives.
 * @returns {string} Plain text; the caller escapes it.
 */
function catchAllMergeWarning(source, target) {
  return `${source} is your catch-all category. After this merge, ${target} becomes the catch-all: `
    + 'bank transactions the app can\'t place will land in it, '
    + 'and the app will treat everything in it as not categorized yet.';
}

/**
 * The remap confirm's body.
 * @param {string} from The label holding the role now.
 * @param {string} to The label the save would give it to.
 * @returns {string} Plain text; the caller escapes it.
 */
function catchAllRemapBody(from, to) {
  return `${from} is your catch-all category. Saving makes ${to} the catch-all: `
    + 'bank transactions the app can\'t place will land in it, '
    + 'and the app will treat everything in it as not categorized yet.';
}
