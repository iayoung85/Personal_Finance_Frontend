// ============================================================
// categories/category-tree.js — The Categories table's logic
// Pure helpers: no DOM, no network, no page state. They shape the
// GET's `labels` into primaries and their categories, decide what
// the right-click menu offers, and plan the calls a save makes.
// Needs primary-kinds.js loaded first.
// ============================================================

/** A Plaid set longer than this starts collapsed in the edit modal. */
const PLAID_LIST_COLLAPSE_AFTER = 5;

/** The kind a new primary gets when nothing better is known. */
const DEFAULT_NEW_PRIMARY_KIND = 'spending';

const LOCKED_FALLBACK_REASON = "The app writes this category itself, so it can't be changed.";
const DELETE_FALLBACK_REASON = "This category can't be deleted.";
const MERGE_NEEDS_TWO_REASON = 'Select two or more categories to merge them: Cmd-click or Shift-click to add rows.';
const MERGE_PRIMARY_REASON = "A primary category can't be merged. Select the categories under it instead.";

function _compareNames(left, right) {
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });
}

/**
 * The primary a label entry sits under, as the list spells it.
 * @param {Object} entry One `labels` entry.
 * @returns {string} '' when the entry has none.
 */
function _entryPrimary(entry) {
  if (typeof entry.primary === 'string' && entry.primary.trim()) return entry.primary.trim();
  const text = String(entry.label || '');
  const colonIndex = text.indexOf(':');
  const primary = colonIndex === -1 ? text : text.substring(0, colonIndex);
  return primary.trim();
}

/**
 * The name a category's row shows: its detailed part, never the primary again.
 * @param {Object} entry One `labels` entry.
 * @returns {string} The whole label when it has no detailed part.
 */
function categoryRowName(entry) {
  if (entry && typeof entry.detailed === 'string' && entry.detailed.trim()) return entry.detailed.trim();
  return String((entry && entry.label) || '');
}

/**
 * Sum a primary's uses from its categories.
 * @param {Array<{uses: number}>} children
 * @returns {number}
 */
function sumPrimaryUses(children) {
  return (children || []).reduce((total, entry) => total + (Number(entry && entry.uses) || 0), 0);
}

/**
 * The state of a primary's Hidden box.
 * @param {Array<{hidden: boolean}>} children
 * @returns {'all'|'some'|'none'}
 */
function primaryHiddenState(children) {
  const list = children || [];
  const hiddenCount = list.filter(entry => entry && entry.hidden === true).length;
  if (list.length > 0 && hiddenCount === list.length) return 'all';
  if (hiddenCount > 0) return 'some';
  return 'none';
}

/**
 * Group the GET's labels into the table's tree.
 * @param {Array<Object>} labels The GET's `labels`.
 * @param {Array<Object>|null} primaryCategories The GET's `primary_categories`.
 * @returns {Array<{primary: string, children: Array<Object>, uses: number,
 *   hiddenState: string, kindEntry: Object|undefined, kindView: Object,
 *   lockedChild: Object|null}>}
 *   Primaries sorted by name ignoring case. Children sorted by row name,
 *   with a label that has no detailed part first.
 */
function buildCategoryTree(labels, primaryCategories) {
  const kindIndex = indexPrimaryKinds(primaryCategories);
  const groups = new Map();
  (labels || []).forEach(entry => {
    if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) return;
    const primary = _entryPrimary(entry);
    if (!primary) return;
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary).push(entry);
  });

  return Array.from(groups.entries())
    .map(([primary, children]) => {
      const sorted = children.slice().sort((left, right) => {
        const leftBare = !left.detailed;
        const rightBare = !right.detailed;
        if (leftBare !== rightBare) return leftBare ? -1 : 1;
        return _compareNames(categoryRowName(left), categoryRowName(right));
      });
      const kindEntry = kindIndex[normalizePrimaryKey(primary)];
      return {
        primary,
        children: sorted,
        uses: sumPrimaryUses(sorted),
        hiddenState: primaryHiddenState(sorted),
        kindEntry,
        kindView: describePrimaryKind(kindEntry),
        lockedChild: sorted.find(entry => entry.locked === true) || null
      };
    })
    .sort((left, right) => _compareNames(left.primary, right.primary));
}

/**
 * Every category label in the order the table shows them, skipping
 * collapsed primaries. Shift-click ranges run over this list.
 * @param {Array<Object>} tree From buildCategoryTree.
 * @param {Set<string>} collapsedPrimaries
 * @returns {string[]}
 */
function visibleCategoryLabels(tree, collapsedPrimaries) {
  const collapsed = collapsedPrimaries || new Set();
  const labels = [];
  (tree || []).forEach(group => {
    if (collapsed.has(group.primary)) return;
    group.children.forEach(entry => labels.push(entry.label));
  });
  return labels;
}

/**
 * Link target for a Uses number.
 * @param {string} categoryText A primary or a full label.
 * @returns {string}
 */
function categoryUsesHref(categoryText) {
  return `transactions.html?category=${encodeURIComponent(categoryText)}`;
}

// ── Selection ───────────────────────────────────────────────

/**
 * The selection after a click on a category row.
 * @param {{labels: string[], anchor: string|null}} selection
 * @param {string} clickedLabel
 * @param {{additive: boolean, range: boolean}} modifiers Cmd/Ctrl and Shift.
 * @param {string[]} orderedLabels The visible labels, top to bottom.
 * @returns {{labels: string[], anchor: string|null}}
 */
function selectionAfterClick(selection, clickedLabel, modifiers, orderedLabels) {
  const current = (selection && selection.labels) || [];
  const anchor = selection ? selection.anchor : null;
  const additive = Boolean(modifiers && modifiers.additive);
  const range = Boolean(modifiers && modifiers.range);
  const order = orderedLabels || [];

  if (range && anchor && order.includes(anchor) && order.includes(clickedLabel)) {
    const start = Math.min(order.indexOf(anchor), order.indexOf(clickedLabel));
    const end = Math.max(order.indexOf(anchor), order.indexOf(clickedLabel));
    const rangeLabels = order.slice(start, end + 1);
    const labels = additive ? Array.from(new Set([...current, ...rangeLabels])) : rangeLabels;
    return { labels, anchor };
  }
  if (additive) {
    const labels = current.includes(clickedLabel)
      ? current.filter(label => label !== clickedLabel)
      : [...current, clickedLabel];
    return { labels, anchor: clickedLabel };
  }
  return { labels: [clickedLabel], anchor: clickedLabel };
}

/**
 * The selection after a right-click: a selected row keeps the selection,
 * any other row is selected alone.
 * @param {{labels: string[], anchor: string|null}} selection
 * @param {string} clickedLabel
 * @returns {{labels: string[], anchor: string|null}}
 */
function selectionAfterRightClick(selection, clickedLabel) {
  const current = (selection && selection.labels) || [];
  if (current.includes(clickedLabel)) return { labels: current.slice(), anchor: selection.anchor };
  return { labels: [clickedLabel], anchor: clickedLabel };
}

// ── Right-click menu ────────────────────────────────────────

function _menuItem(id, label, reason) {
  return { id, label, enabled: !reason, reason: reason || '' };
}

const MENU_DIVIDER = { divider: true };

function _countedNoun(count, singular, plural) {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural}`;
}

/**
 * What the right-click menu offers for a category row.
 * @param {Object} target The right-clicked `labels` entry; it is the Merge target.
 * @param {Array<Object>} selectedEntries Every selected entry, the target included.
 * @returns {Array<Object>} Items {id, label, enabled, reason} and dividers {divider: true}.
 *   Ids: edit, delete, hide, merge, new, new-sub. A blocked item stays in
 *   the list with enabled false and the reason to show.
 */
function categoryMenuEntries(target, selectedEntries) {
  const selected = (selectedEntries && selectedEntries.length) ? selectedEntries : [target];
  const lockedReason = target.locked ? (target.locked_message || LOCKED_FALLBACK_REASON) : '';
  const deleteReason = target.can_delete === true ? '' : (target.delete_reason || DELETE_FALLBACK_REASON);

  const allHidden = selected.every(entry => entry.hidden === true);
  const hideVerb = allHidden ? 'Unhide' : 'Hide';
  const hideLabel = selected.length === 1
    ? `${hideVerb} Category`
    : `${hideVerb} ${_countedNoun(selected.length, 'Category', 'Categories')}`;

  let mergeReason = '';
  if (selected.length < 2) {
    mergeReason = MERGE_NEEDS_TWO_REASON;
  } else {
    const lockedSource = selected.find(entry => entry.label !== target.label && entry.locked === true);
    if (lockedSource) {
      mergeReason = `${lockedSource.label}: ${lockedSource.locked_message || LOCKED_FALLBACK_REASON}`;
    }
  }
  const mergeLabel = selected.length < 2
    ? 'Merge Categories…'
    : `Merge ${_countedNoun(selected.length, 'Category', 'Categories')}…`;

  return [
    _menuItem('edit', 'Edit Category…', lockedReason),
    _menuItem('delete', 'Delete Category', deleteReason),
    _menuItem(allHidden ? 'unhide' : 'hide', hideLabel, ''),
    _menuItem('merge', mergeLabel, mergeReason),
    MENU_DIVIDER,
    _menuItem('new', 'New Category…', ''),
    _menuItem('new-sub', 'New Subcategory…', '')
  ];
}

/**
 * What the right-click menu offers for a primary row.
 * @param {Object} group One buildCategoryTree group.
 * @returns {Array<Object>} As categoryMenuEntries.
 */
function primaryMenuEntries(group) {
  const locked = group.lockedChild;
  const editReason = locked ? (locked.locked_message || LOCKED_FALLBACK_REASON) : '';

  const blocked = group.children.find(entry => entry.can_delete !== true);
  const deleteReason = blocked
    ? `${categoryRowName(blocked)}: ${blocked.delete_reason || DELETE_FALLBACK_REASON}`
    : '';
  const deleteLabel = group.children.length > 1
    ? `Delete Category and its ${group.children.length} Subcategories`
    : 'Delete Category';

  const allHidden = group.hiddenState === 'all';
  const hideLabel = allHidden ? 'Unhide Category' : 'Hide Category';

  return [
    _menuItem('edit', 'Edit Category…', editReason),
    _menuItem('delete', deleteLabel, deleteReason),
    _menuItem(allHidden ? 'unhide' : 'hide', hideLabel, ''),
    _menuItem('merge', 'Merge Categories…', MERGE_PRIMARY_REASON),
    MENU_DIVIDER,
    _menuItem('new', 'New Category…', ''),
    _menuItem('new-sub', 'New Subcategory…', '')
  ];
}

// ── Kind for a new primary ──────────────────────────────────

/**
 * Whether a typed primary is new to the list. Matching ignores case and
 * surrounding space, as the API does.
 * @param {string} name
 * @param {Array<{primary: string}>} tree
 * @returns {boolean}
 */
function isNewPrimaryName(name, tree) {
  const key = normalizePrimaryKey(name);
  if (!key) return false;
  return !(tree || []).some(group => normalizePrimaryKey(group.primary) === key);
}

/**
 * The listed primary a typed name matches, ignoring case.
 * @param {string} name
 * @param {Array<Object>} tree
 * @returns {Object|null} The tree group.
 */
function findPrimaryGroup(name, tree) {
  const key = normalizePrimaryKey(name);
  if (!key) return null;
  return (tree || []).find(group => normalizePrimaryKey(group.primary) === key) || null;
}

/**
 * The kind to preselect for a primary new to the list: the kind the
 * category's current primary counts as, picked or by name, else Spending.
 * @param {Object|undefined} sourceKindEntry A primary_categories entry.
 * @returns {string} One of PRIMARY_KIND_OPTIONS' values.
 */
function defaultKindForNewPrimary(sourceKindEntry) {
  const kind = sourceKindEntry && sourceKindEntry.kind;
  if (kind && PRIMARY_KIND_OPTIONS.some(option => option.value === kind)) return kind;
  return DEFAULT_NEW_PRIMARY_KIND;
}

// ── Saving the edit and create modal ────────────────────────

function _trimmed(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * The calls a category's modal save makes, in order. The move goes first so
 * the description and Hidden land on the label as it ends up.
 * @param {{label: string, primary: string, detailed: string|null,
 *   description: string|null, hidden: boolean}} original
 * @param {{name: string, parent: string, parentIsNew: boolean, kind: string|null,
 *   description: string, hidden: boolean}} form
 * @returns {Array<Object>} Steps: {call: 'label', primary, detailed, kind?},
 *   {call: 'description', description}, {call: 'hidden', hidden}.
 */
function planCategoryEditSteps(original, form) {
  const steps = [];
  const name = _trimmed(form.name);
  const parent = _trimmed(form.parent);
  if (name !== _trimmed(original.detailed) || parent !== _trimmed(original.primary)) {
    const step = { call: 'label', primary: parent, detailed: name };
    if (form.parentIsNew && form.kind) step.kind = form.kind;
    steps.push(step);
  }
  const description = _trimmed(form.description);
  if (description !== _trimmed(original.description)) {
    steps.push({ call: 'description', description });
  }
  if (Boolean(form.hidden) !== Boolean(original.hidden)) {
    steps.push({ call: 'hidden', hidden: Boolean(form.hidden) });
  }
  return steps;
}

/**
 * The calls a primary's modal save makes, in order.
 * @param {{primary: string, kind: string|null, hiddenState: string}} original
 *   kind is the stored kind when one was picked, else null.
 * @param {{name: string, kind: string|null, hidden: boolean|null}} form
 *   kind is null when the picker was left alone; hidden is null while a
 *   mixed box is left alone.
 * @returns {Array<Object>} Steps: {call: 'primary', newPrimary, kind?}, {call: 'hidden', hidden}.
 */
function planPrimaryEditSteps(original, form) {
  const steps = [];
  const name = _trimmed(form.name);
  const kindChanged = Boolean(form.kind) && form.kind !== original.kind;
  if (name !== original.primary || kindChanged) {
    const step = { call: 'primary', newPrimary: name, renames: name !== original.primary };
    if (kindChanged) step.kind = form.kind;
    steps.push(step);
  }
  if (form.hidden !== null && form.hidden !== undefined) {
    const wasAll = original.hiddenState === 'all';
    const wasNone = original.hiddenState === 'none';
    const changed = form.hidden ? !wasAll : !wasNone;
    if (changed) steps.push({ call: 'hidden', hidden: Boolean(form.hidden) });
  }
  return steps;
}

/**
 * The calls the create modal makes, in order.
 * @param {{name: string, parent: string, parentIsNew: boolean, kind: string|null,
 *   description: string, hidden: boolean}} form
 * @returns {Array<Object>} {call: 'create', label, kind?}, then description and hidden as needed.
 */
function planCategoryCreateSteps(form) {
  const label = `${_trimmed(form.parent)}: ${_trimmed(form.name)}`;
  const create = { call: 'create', label };
  if (form.parentIsNew && form.kind) create.kind = form.kind;
  const steps = [create];
  const description = _trimmed(form.description);
  if (description) steps.push({ call: 'description', description });
  if (form.hidden) steps.push({ call: 'hidden', hidden: true });
  return steps;
}

function _apiError(result) {
  if (result && result.data && result.data.error) return result.data.error;
  return 'The server did not accept the change.';
}

/**
 * Run planned steps one at a time, stopping at the first refusal. Each later
 * step targets the label the earlier ones produced.
 * @param {Array<Object>} steps From one of the plan functions.
 * @param {{label?: string, primary?: string, labels?: string[]}} start
 *   label for a category, primary and labels for a primary.
 * @param {Object} api {editLabel, renamePrimary, createLabel, setDescription,
 *   setHidden}, each taking a request body and resolving to {ok, data}.
 * @returns {Promise<{ok: boolean, done: Array<Object>, failed: Object|null,
 *   error: string, label: string|undefined, primary: string|undefined, labels: string[]}>}
 */
async function runCategorySaveSteps(steps, start, api) {
  let label = start.label;
  let primary = start.primary;
  let labels = (start.labels || []).slice();
  const done = [];

  for (const step of steps) {
    let result;
    try {
      if (step.call === 'label') {
        const body = { label, primary: step.primary, detailed: step.detailed };
        if (step.kind) body.kind = step.kind;
        result = await api.editLabel(body);
        if (result.ok) label = (result.data && result.data.label) || `${step.primary}: ${step.detailed}`;
      } else if (step.call === 'primary') {
        const body = { primary, new_primary: step.newPrimary };
        if (step.kind) body.kind = step.kind;
        result = await api.renamePrimary(body);
        if (result.ok) {
          const moves = (result.data && result.data.moves) || [];
          const renamed = new Map(moves.map(move => [move.old, move.new]));
          labels = labels.map(old => renamed.get(old) || old);
          primary = (result.data && result.data.primary) || step.newPrimary;
        }
      } else if (step.call === 'create') {
        const body = { category_name: step.label };
        if (step.kind) body.kind = step.kind;
        result = await api.createLabel(body);
        if (result.ok) label = (result.data && result.data.category_name) || step.label;
      } else if (step.call === 'description') {
        result = await api.setDescription({ label, description: step.description });
      } else if (step.call === 'hidden') {
        const targets = label ? [label] : labels;
        result = await api.setHidden({ labels: targets, hidden: step.hidden });
      } else {
        continue;
      }
    } catch (networkError) {
      result = { ok: false, data: { error: `Could not reach the server: ${networkError.message}` } };
    }
    if (!result || !result.ok) {
      return { ok: false, done, failed: step, error: _apiError(result), label, primary, labels };
    }
    done.push(step);
  }
  return { ok: true, done, failed: null, error: '', label, primary, labels };
}

function _stepWords(step) {
  if (step.call === 'label') return 'the new name';
  if (step.call === 'primary') {
    if (step.renames && step.kind) return 'the new name and kind';
    if (step.renames) return 'the new name';
    return 'the kind';
  }
  if (step.call === 'create') return 'the new category';
  if (step.call === 'description') return 'the description';
  if (step.call === 'hidden') return 'the Hide setting';
  return 'a change';
}

/**
 * The sentence for a save that stopped part-way.
 * @param {{done: Array<Object>, failed: Object|null, error: string}} outcome From runCategorySaveSteps.
 * @returns {string} '' when nothing stopped it or nothing had been saved yet.
 */
function describePartialSave(outcome) {
  if (!outcome || !outcome.failed || !outcome.done.length) return '';
  const saved = outcome.done.map(_stepWords);
  const savedText = saved.length > 1
    ? `${saved.slice(0, -1).join(', ')} and ${saved[saved.length - 1]}`
    : saved[0];
  return `Saved ${savedText}, but not ${_stepWords(outcome.failed)}: ${outcome.error}`;
}

// ── The modal's Plaid section ───────────────────────────────

/**
 * How the modal shows the Plaid categories that point at a category.
 * @param {Array<{key: string, name: string}>} plaidCategories
 * @param {boolean} isPlaidDefault
 * @returns {{count: number, heading: string, collapsed: boolean, names: string[],
 *   groups: Array<{plaidPrimary: string, names: string[]}>, defaultSentence: string}}
 */
function plaidMappingView(plaidCategories, isPlaidDefault) {
  const list = (plaidCategories || []).filter(item => item && (item.name || item.key));
  const count = list.length;
  const names = list.map(item => item.name || item.key);
  const byPrimary = new Map();
  names.forEach(name => {
    const colonIndex = name.indexOf(':');
    const plaidPrimary = colonIndex === -1 ? name : name.substring(0, colonIndex).trim();
    const detailed = colonIndex === -1 ? name : name.substring(colonIndex + 1).trim();
    if (!byPrimary.has(plaidPrimary)) byPrimary.set(plaidPrimary, []);
    byPrimary.get(plaidPrimary).push(detailed);
  });
  const groups = Array.from(byPrimary.entries())
    .map(([plaidPrimary, detailedNames]) => ({ plaidPrimary, names: detailedNames.sort(_compareNames) }))
    .sort((left, right) => _compareNames(left.plaidPrimary, right.plaidPrimary));

  let heading = 'No Plaid categories are sent here, so new Plaid transactions never land here on their own.';
  if (count === 1) heading = 'Plaid sends 1 category here';
  if (count > 1) heading = `Plaid sends ${count} categories here`;

  return {
    count,
    heading,
    collapsed: count > PLAID_LIST_COLLAPSE_AFTER,
    names,
    groups,
    defaultSentence: isPlaidDefault
      ? "This name is the app's default for a Plaid category, taken from Plaid's own name for it."
      : ''
  };
}

// ── Merge and Remove unused confirms ────────────────────────

/**
 * What the Merge confirm lists.
 * @param {Array<Object>} selectedEntries The selected `labels` entries.
 * @param {string} targetLabel The right-clicked category, which survives.
 * @returns {{rows: Array<{label: string, uses: number, isTarget: boolean}>,
 *   total: number, target: string, sources: string[]}}
 *   rows list the merged categories first and the survivor last.
 */
function mergeSummary(selectedEntries, targetLabel) {
  const entries = selectedEntries || [];
  const sources = entries.filter(entry => entry.label !== targetLabel);
  const target = entries.find(entry => entry.label === targetLabel);
  const rows = sources.map(entry => ({ label: entry.label, uses: Number(entry.uses) || 0, isTarget: false }));
  if (target) rows.push({ label: target.label, uses: Number(target.uses) || 0, isTarget: true });
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.uses, 0),
    target: targetLabel,
    sources: sources.map(entry => entry.label)
  };
}

/**
 * What the Remove unused confirm says, from the dry run.
 * @param {{deleted: string[], kept: Array<{label, delete_blocked_by, delete_reason}>,
 *   kept_in_use: number}} dryRun
 * @returns {{deleted: string[], nothingToRemove: boolean, keptForPlaid: Array<Object>,
 *   keptOther: Array<Object>, keptInUse: number, headline: string}}
 */
function removeUnusedSummary(dryRun) {
  const data = dryRun || {};
  const deleted = Array.isArray(data.deleted) ? data.deleted.slice() : [];
  const kept = Array.isArray(data.kept) ? data.kept : [];
  const keptForPlaid = kept.filter(item => item.delete_blocked_by === 'plaid_keys');
  const keptOther = kept.filter(item => item.delete_blocked_by !== 'plaid_keys');
  const keptInUse = Number(data.kept_in_use) || 0;
  const headline = deleted.length
    ? `${_countedNoun(deleted.length, 'category', 'categories')} will be deleted.`
    : 'There is nothing to remove: every category is in use or held by something.';
  return { deleted, nothingToRemove: deleted.length === 0, keptForPlaid, keptOther, keptInUse, headline };
}
