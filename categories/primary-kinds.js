// ============================================================
// categories/primary-kinds.js — How a primary category counts
// Pure helpers for the kind control in the Category Output
// Preview. No DOM and no network, so tests can load this file.
// ============================================================

/** The kinds a user may pick, in the order the picker lists them: inflows, then spending, then the ones that stay out of both. */
const PRIMARY_KIND_OPTIONS = [
  { value: 'income', label: 'Earned income' },
  { value: 'other_inflow', label: 'Other inflow' },
  { value: 'retirement_income', label: 'Retirement income' },
  { value: 'spending', label: 'Spending' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'adjustment', label: 'Adjustment' }
];

/** A kind the API no longer accepts but may still send for an old entry. It is shown, never offered. */
const LEGACY_PRIMARY_KIND_LABELS = {
  excluded: 'Excluded'
};

/**
 * Same normalization the API keys primaries by: text before the first colon,
 * trimmed, lowercased.
 * @param {string} name A primary name or a "Primary: Detailed" label.
 * @returns {string}
 */
function normalizePrimaryKey(name) {
  const text = String(name || '');
  const colonIndex = text.indexOf(':');
  const primary = colonIndex === -1 ? text : text.substring(0, colonIndex);
  return primary.trim().toLowerCase();
}

/**
 * Display label for a kind value.
 * @param {string} kind
 * @returns {string} The kind itself when it is not one this client knows.
 */
function primaryKindLabel(kind) {
  const option = PRIMARY_KIND_OPTIONS.find(candidate => candidate.value === kind);
  if (option) return option.label;
  if (Object.prototype.hasOwnProperty.call(LEGACY_PRIMARY_KIND_LABELS, kind)) {
    return LEGACY_PRIMARY_KIND_LABELS[kind];
  }
  return String(kind || '');
}

/**
 * Index the GET's primary_categories by normalized primary name.
 * @param {Array|null|undefined} primaryCategories
 * @returns {Object<string, Object>} Empty when the API sent none.
 */
function indexPrimaryKinds(primaryCategories) {
  const index = {};
  if (!Array.isArray(primaryCategories)) return index;
  primaryCategories.forEach(entry => {
    if (entry && entry.name) index[normalizePrimaryKey(entry.name)] = entry;
  });
  return index;
}

/**
 * Why the API pins a primary, in words for the ⓘ note. Keyed by the API's
 * pinned_reason values. Text between asterisks is shown as emphasis; see
 * splitEmphasis.
 */
const PINNED_REASON_EXPLANATIONS = {
  unlinked_transfer_in: "The app files the money-in half of a transfer here when a transfer pair is unlinked or repaired, using the label your Plaid mapping gives Plaid's *Transfer In → Account Transfer* category. So this primary always counts as a transfer. You may rename it or that label: the mapping, and this role, follow the new name.",
  unlinked_transfer_out: "The app files the money-out half of a transfer here when a transfer pair is unlinked or repaired, using the label your Plaid mapping gives Plaid's *Transfer Out → Account Transfer* category. So this primary always counts as a transfer. You may rename it or that label: the mapping, and this role, follow the new name.",
  investment_gain_loss: "This label appeared when you converted an investment account or imported investment history: the app writes *Adjustments: Investment Gain/Loss* for those gains and losses. Balances and investment trends find those rows by that exact label, so this primary always counts as an adjustment and that label can't be renamed. Your own labels here can be renamed into another primary, which you can then set to any kind."
};

const PINNED_FALLBACK_EXPLANATION = 'The app writes its own entries into this primary, so how it counts is fixed.';

/**
 * Split note text into plain and emphasized runs. Text between a pair of
 * asterisks is emphasized; an unpaired asterisk stays literal.
 * @param {string} text
 * @returns {Array<{text: string, emphasis: boolean}>} Callers escape each run before rendering.
 */
function splitEmphasis(text) {
  const parts = String(text || '').split('*');
  const hasUnpaired = parts.length % 2 === 0;
  const runs = [];
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    if (hasUnpaired && isLast) {
      // The final asterisk had no partner, so it and the text after it are plain.
      const previous = runs[runs.length - 1];
      if (previous && !previous.emphasis) previous.text += '*' + part;
      else runs.push({ text: '*' + part, emphasis: false });
      return;
    }
    if (part === '' ) return;
    runs.push({ text: part, emphasis: index % 2 === 1 });
  });
  return runs;
}

/**
 * Normalize an entry's pinned_reason to a list of reason strings.
 * @param {*} value null, undefined, a string, or a list of strings.
 * @returns {string[]} Empty when the primary is not pinned.
 */
function pinnedReasonList(value) {
  if (Array.isArray(value)) {
    return value.filter(reason => typeof reason === 'string' && reason);
  }
  if (typeof value === 'string' && value) return [value];
  return [];
}

/**
 * Explanation text for each pinned reason.
 * @param {string[]} reasons
 * @returns {string[]} A reason this client does not know gets a generic line.
 */
function pinnedExplanations(reasons) {
  return reasons.map(reason => PINNED_REASON_EXPLANATIONS[reason] || PINNED_FALLBACK_EXPLANATION);
}

/**
 * Decide what the preview shows for one primary.
 * @param {Object|undefined} entry One primary_categories entry, if any.
 * @returns {{mode: string, kind: string, label: string, isSet: boolean, reasons?: string[], explanations?: string[]}}
 *   mode is 'none' (render no control), 'pinned' (kind as text with an
 *   explanation of why it is fixed), 'legacy' (a kind no longer offered,
 *   as plain text with no explanation) or 'picker'. A pinned entry's label is
 *   the plain kind label. For an unset picker, label reads
 *   "By name: <kind label>" and the picker shows it as its current state
 *   until a kind is picked. A stray kind_is_locked from an older API is ignored.
 */
function describePrimaryKind(entry) {
  if (!entry || !entry.kind) {
    return { mode: 'none', kind: '', label: '', isSet: false };
  }
  const isSet = entry.kind_is_set === true;
  const kindLabel = primaryKindLabel(entry.kind);
  const reasons = pinnedReasonList(entry.pinned_reason);
  if (reasons.length > 0) {
    return {
      mode: 'pinned',
      kind: entry.kind,
      label: kindLabel,
      isSet,
      reasons,
      explanations: pinnedExplanations(reasons)
    };
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_PRIMARY_KIND_LABELS, entry.kind)) {
    return { mode: 'legacy', kind: entry.kind, label: kindLabel, isSet };
  }
  return {
    mode: 'picker',
    kind: entry.kind,
    label: isSet ? kindLabel : `By name: ${kindLabel}`,
    isSet
  };
}

/**
 * Message to show when the kind PUT is refused or fails.
 * @param {Object|null} body The response body, if it parsed.
 * @returns {string}
 */
function primaryKindErrorMessage(body) {
  if (body && body.error) return body.error;
  return 'Could not change how this category counts.';
}
