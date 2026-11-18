// ============================================================
// categories/audit-log-text.js — Words for audit log entries
// Pure helpers: no DOM, no network. Entry types the categories
// table writes get a sentence; any other type keeps the raw JSON
// it has always shown.
// ============================================================

const AUDIT_LOG_TYPE_NAMES = {
  edit_category: 'Edit category',
  rename_primary: 'Rename primary',
  merge_categories: 'Merge categories',
  delete_category: 'Delete category',
  remove_unused_categories: 'Remove unused',
  hide_categories: 'Hide',
  unhide_categories: 'Unhide'
};

/** The longest list of names a sentence spells out before "and N more". */
const AUDIT_LOG_NAME_LIMIT = 8;

/** Stat keys of a move, in the order a sentence names them, with their nouns. */
const AUDIT_LOG_MOVE_NOUNS = [
  ['transactions', 'transaction', 'transactions'],
  ['rules', 'rule', 'rules'],
  ['overrides', 'override', 'overrides'],
  ['bills', 'bill', 'bills'],
  ['alerts', 'alert', 'alerts'],
  ['mappings_updated', 'Plaid category repointed', 'Plaid categories repointed']
];

function _auditNameList(names) {
  const list = (Array.isArray(names) ? names : []).filter(name => typeof name === 'string' && name);
  if (list.length === 0) return 'nothing';
  const shown = list.slice(0, AUDIT_LOG_NAME_LIMIT);
  const extra = list.length - shown.length;
  if (extra > 0) return `${shown.join(', ')} and ${extra} more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

function _auditMovedText(stats) {
  const parts = [];
  AUDIT_LOG_MOVE_NOUNS.forEach(([key, singular, plural]) => {
    const count = Number(stats && stats[key]) || 0;
    if (count > 0) parts.push(`${count} ${count === 1 ? singular : plural}`);
  });
  return parts.length ? `Moved ${parts.join(', ')}` : 'Nothing else moved';
}

function _auditKindText(changes) {
  if (!changes || !changes.kind) return '';
  const label = typeof primaryKindLabel === 'function' ? primaryKindLabel(changes.kind) : changes.kind;
  return `; its primary counts as ${label}`;
}

/**
 * The Type, Changes and Stats cells for one audit log entry.
 * @param {{migration_type: string, changes: Object, stats: Object}} entry
 * @returns {{type: string, changes: string, stats: string}}
 */
function describeAuditLogEntry(entry) {
  const type = (entry && entry.migration_type) || '';
  const changes = (entry && entry.changes) || {};
  const stats = (entry && entry.stats) || null;

  if (type === 'edit_category') {
    return {
      type: AUDIT_LOG_TYPE_NAMES[type],
      changes: `Renamed ${changes.old_name || '?'} to ${changes.new_name || '?'}${_auditKindText(changes)}`,
      stats: _auditMovedText(stats)
    };
  }
  if (type === 'rename_primary') {
    const renamed = Array.isArray(changes.categories_renamed) ? changes.categories_renamed.length : 0;
    const count = renamed === 1 ? '1 category' : `${renamed} categories`;
    return {
      type: AUDIT_LOG_TYPE_NAMES[type],
      changes: `Renamed ${changes.old_primary || '?'} to ${changes.new_primary || '?'}, with its ${count}${_auditKindText(changes)}`,
      stats: _auditMovedText(stats)
    };
  }
  if (type === 'merge_categories') {
    return {
      type: AUDIT_LOG_TYPE_NAMES[type],
      changes: `Merged ${_auditNameList(changes.source_categories)} into ${changes.target_category || '?'}`,
      stats: _auditMovedText(stats)
    };
  }
  if (type === 'delete_category') {
    return { type: AUDIT_LOG_TYPE_NAMES[type], changes: `Deleted ${changes.category_name || '?'}`, stats: '' };
  }
  if (type === 'remove_unused_categories') {
    const deleted = Array.isArray(changes.deleted) ? changes.deleted : [];
    const kept = Number(stats && stats.labels_kept) || 0;
    return {
      type: AUDIT_LOG_TYPE_NAMES[type],
      changes: `Deleted ${deleted.length === 1 ? '1 unused category' : `${deleted.length} unused categories`}: ${_auditNameList(deleted)}`,
      stats: kept ? `Kept ${kept === 1 ? '1 category' : `${kept} categories`} that something still holds` : ''
    };
  }
  if (type === 'hide_categories' || type === 'unhide_categories') {
    const verb = type === 'hide_categories' ? 'Hid' : 'Unhid';
    return {
      type: AUDIT_LOG_TYPE_NAMES[type],
      changes: `${verb} ${_auditNameList(changes.labels)}`,
      stats: ''
    };
  }

  return {
    type,
    changes: JSON.stringify(changes),
    stats: stats ? JSON.stringify(stats) : ''
  };
}
