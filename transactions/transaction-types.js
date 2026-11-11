// ============================================================
// transactions/transaction-types.js — Centralized Type Classifier
//
// Maps every valid (source, status) pair to a canonical type string.
// Single source of truth for transaction type identity in the frontend.
// All branching on transaction type should dispatch on the string
// returned by getTransactionType() rather than inspecting raw
// source/status fields directly.
//
// Mirrors: src/modules/transactions/transaction_types.py
// ============================================================

// ── The 15 canonical transaction types ─────────────────────────
const TXN_TYPE = Object.freeze({
  PLAID_CLEARED:                'PLAID_CLEARED',
  PLAID_PENDING:                'PLAID_PENDING',
  PLAID_CONVERTED:              'PLAID_CONVERTED',
  MANUAL_CLEARED:               'MANUAL_CLEARED',
  MANUAL_ORPHANED:              'MANUAL_ORPHANED',
  MANUAL_FUTURE:                'MANUAL_FUTURE',
  MANUAL_MATCH:                 'MANUAL_MATCH',
  MANUAL_MISSING:               'MANUAL_MISSING',
  BILL_FUTURE:                  'BILL_FUTURE',
  BILL_MISSING:                 'BILL_MISSING',
  BILL_MATCHED:                 'BILL_MATCHED',
  SPLIT_CHILD:                  'SPLIT_CHILD',
  SYSTEM_OPENING_BALANCE:       'SYSTEM_OPENING_BALANCE',
  SYSTEM_MANUAL_OPENING_BALANCE:'SYSTEM_MANUAL_OPENING_BALANCE',
  SYSTEM_RECONCILIATION:        'SYSTEM_RECONCILIATION',
  SYSTEM_INVESTMENT_TRENDING:   'SYSTEM_INVESTMENT_TRENDING',
});

// ── (source:status) → type lookup ──────────────────────────────
const _SOURCE_STATUS_MAP = Object.freeze({
  'plaid:cleared':                TXN_TYPE.PLAID_CLEARED,
  'plaid:pending':                TXN_TYPE.PLAID_PENDING,
  'plaid:converted':              TXN_TYPE.PLAID_CONVERTED,
  'manual:cleared':               TXN_TYPE.MANUAL_CLEARED,
  'manual:orphaned':              TXN_TYPE.MANUAL_ORPHANED,
  'manual:future':                TXN_TYPE.MANUAL_FUTURE,
  'manual:matched':               TXN_TYPE.MANUAL_MATCH,
  'manual:missing':               TXN_TYPE.MANUAL_MISSING,
  'scheduled:future':             TXN_TYPE.BILL_FUTURE,
  'scheduled:missing':            TXN_TYPE.BILL_MISSING,
  'scheduled:matched':            TXN_TYPE.BILL_MATCHED,
  'split:cleared':                TXN_TYPE.SPLIT_CHILD,
  'opening_balance:cleared':      TXN_TYPE.SYSTEM_OPENING_BALANCE,
  'manual_opening_balance:cleared': TXN_TYPE.SYSTEM_MANUAL_OPENING_BALANCE,
  'reconciliation:cleared':       TXN_TYPE.SYSTEM_RECONCILIATION,
  'investment_trending:cleared':   TXN_TYPE.SYSTEM_INVESTMENT_TRENDING,
});


/**
 * Return the canonical type string for a transaction object.
 *
 * Reads txn.source and txn.status (from the API response) and maps
 * them to one of the 15 TXN_TYPE constants.
 *
 * @param {Object} txn - Transaction object with source and status fields.
 * @returns {string} One of the TXN_TYPE values (e.g. 'PLAID_CLEARED').
 * @throws {Error} If the (source, status) pair is not recognized.
 */
function getTransactionType(txn) {
  const key = `${txn.source}:${txn.status}`;
  const txnType = _SOURCE_STATUS_MAP[key];
  if (!txnType) {
    console.error(`Unknown transaction type: source='${txn.source}', status='${txn.status}'`);
    return null;
  }
  return txnType;
}


// ── Type groupings for capability checks ───────────────────────

const SYSTEM_TYPES = new Set([
  TXN_TYPE.SYSTEM_OPENING_BALANCE,
  TXN_TYPE.SYSTEM_MANUAL_OPENING_BALANCE,
  TXN_TYPE.SYSTEM_RECONCILIATION,
  TXN_TYPE.SYSTEM_INVESTMENT_TRENDING,
]);

const EDITABLE_TYPES = new Set([
  TXN_TYPE.MANUAL_CLEARED,
  TXN_TYPE.MANUAL_FUTURE,
  TXN_TYPE.MANUAL_MISSING,
  TXN_TYPE.MANUAL_ORPHANED,
  TXN_TYPE.PLAID_CONVERTED,
  TXN_TYPE.BILL_FUTURE,
  TXN_TYPE.BILL_MISSING,
]);

const DATE_EDITABLE_TYPES = new Set([
  ...EDITABLE_TYPES,
  TXN_TYPE.PLAID_CLEARED,
]);

const DESCRIPTION_EDITABLE_TYPES = new Set(EDITABLE_TYPES);

const AMOUNT_EDITABLE_TYPES = new Set([
  ...EDITABLE_TYPES,
  // Users can correct a plaid amount when Plaid reports the wrong value.
  // The backend sets amount_modified=true on the txn so the row can show
  // a "Modified" badge; the reset endpoint restores the original amount
  // from plaid_raw_blob.
  TXN_TYPE.PLAID_CLEARED,
]);

function isRowInlineEditable(txnType) {
  // PLAID_CLEARED supports date and amount editing but is excluded from
  // EDITABLE_TYPES (which gates description/full edits). Treat it as
  // inline-editable so the row click handler opens an edit session.
  return EDITABLE_TYPES.has(txnType) || txnType === TXN_TYPE.PLAID_CLEARED;
}

function canInlineEditDate(txnType) {
  // SPLIT_CHILD rows expose date editing too: the edit cascades to the
  // parent (which goes through the parent's normal state-machine date
  // rules) and to all sibling split children. Constraint resolution
  // (e.g. PLAID_CLEARED ±3 day window) still uses the parent's type.
  if (txnType === TXN_TYPE.SPLIT_CHILD) return true;
  return DATE_EDITABLE_TYPES.has(txnType);
}

function canInlineEditDescription(txnType) {
  return DESCRIPTION_EDITABLE_TYPES.has(txnType);
}

function canInlineEditAmount(txnType) {
  return AMOUNT_EDITABLE_TYPES.has(txnType);
}

function getInlineEditableFields(txnType) {
  const fields = [];
  if (canInlineEditDate(txnType)) fields.push('date');
  if (canInlineEditDescription(txnType)) fields.push('description');
  if (canInlineEditAmount(txnType)) fields.push('amount');
  return fields;
}


// ── Waiting matches ────────────────────────────────────────────

/** Tooltip for every edit a waiting match refuses. */
const WAITING_MATCH_LOCK_REASON = 'Approve or unmatch this match first';

/**
 * Whether a row is either side of a waiting match: the Plaid row that
 * carries `match_info`, or a matched manual or bill row pointing at it.
 * The API refuses edits to both until the match is approved or unmatched;
 * hide, unhide and mark reviewed stay allowed. A split piece is not a
 * waiting row: the API lets its pieces be edited.
 *
 * A matched row waits only while it points at a bank row. The list sends
 * that pointer as `matched_transaction_id` and drops it once the bank row
 * is deleted, and `hidden_by_match` marks a pointer whose bank row is in
 * the same list; a matched row with neither is no longer waiting.
 *
 * @param {Object|null} txn - A row as the API returned it.
 * @returns {boolean}
 */
function isWaitingMatchRow(txn) {
  if (!txn) return false;
  if (txn.match_info || txn.hidden_by_match) return true;
  if (!txn.matched_transaction_id) return false;
  const txnType = _SOURCE_STATUS_MAP[`${txn.source}:${txn.status}`];
  return txnType === TXN_TYPE.MANUAL_MATCH || txnType === TXN_TYPE.BILL_MATCHED;
}

/**
 * Whether a row is waiting on the user: an unreviewed row, or the Plaid row
 * of a waiting match. The list sends a waiting Plaid row as approving will
 * leave it, `reviewed: true` included, so its own flag says nothing until
 * the match is approved or unmatched. The hidden matched row is not
 * counted, so a match counts once.
 *
 * @param {Object|null} txn - A row as the API returned it.
 * @returns {boolean}
 */
function rowNeedsReview(txn) {
  return !!txn && (txn.reviewed === false || !!txn.match_info);
}

/**
 * Which inline edits a ledger row offers. A waiting match offers none, so
 * the row never opens an editor the API would refuse.
 *
 * @param {Object} txn - The row as the API returned it.
 * @param {string} txnType - Its TXN_TYPE.
 * @returns {{date: boolean, description: boolean, amount: boolean, memo: boolean, category: boolean, lockReason: string}}
 */
function getRowEditAffordances(txn, txnType) {
  if (isWaitingMatchRow(txn)) {
    return {
      date: false,
      description: false,
      amount: false,
      memo: false,
      category: false,
      lockReason: WAITING_MATCH_LOCK_REASON,
    };
  }

  // Plaid rows edit their name through the description-override editor.
  const isPlaidRow = txnType === TXN_TYPE.PLAID_CLEARED || txnType === TXN_TYPE.PLAID_PENDING;
  return {
    date: canInlineEditDate(txnType),
    description: canInlineEditDescription(txnType) || isPlaidRow,
    // An auto-split bill keeps its parent equal to its pieces' sum.
    amount: canInlineEditAmount(txnType) && !(txn && txn.has_splits_template),
    memo: true,
    category: true,
    lockReason: '',
  };
}

const MATCHABLE_TYPES = new Set([
  TXN_TYPE.BILL_MATCHED,
  TXN_TYPE.BILL_MISSING,
  TXN_TYPE.MANUAL_MATCH,
  TXN_TYPE.MANUAL_MISSING,
  TXN_TYPE.MANUAL_ORPHANED,
]);

const SPLITTABLE_TYPES = new Set([
  TXN_TYPE.PLAID_CLEARED,
  TXN_TYPE.PLAID_CONVERTED,
  TXN_TYPE.MANUAL_CLEARED,
  // BILL_FUTURE intentionally excluded: virtual rows have no DB record
  // for split children to reference. User must materialize first (→ MANUAL_FUTURE).
  TXN_TYPE.MANUAL_FUTURE,
  TXN_TYPE.BILL_MISSING,
  TXN_TYPE.MANUAL_MISSING,
]);

/**
 * Return true if the transaction type is system-generated bookkeeping.
 * @param {string} txnType - A TXN_TYPE value.
 * @returns {boolean}
 */
function isSystemType(txnType) {
  return SYSTEM_TYPES.has(txnType);
}

// ── Sort priority for anchor transactions ──────────────────────────
// Mirrors: transaction_types.py  anchor_sort_priority()
// Anchor rows (opening balance, manual opening balance) must always sort
// before regular transactions within the same day in the balance walk.
// In linked accounts this is a non-issue (OB date is the day before the
// earliest plaid transaction), but in converted accounts OB shares its
// date with other transactions.
const ANCHOR_SORT_PRIORITIES = {
  'manual_opening_balance': 0,
  'manual': 0.5,
  'opening_balance': 1,
  'investment_trending': 3,
};
const DEFAULT_SORT_PRIORITY = 2;
const PLAID_CONVERTED_SORT_PRIORITY = 0.75;

/**
 * Return a numeric sort key that orders anchors before regular rows.
 * Must stay in sync with backend anchor_sort_priority in transaction_types.py.
 * @param {string} source - Transaction source string.
 * @param {string} [status] - Transaction status string.
 * @returns {number} Sort priority (lower = earlier in ascending balance walk).
 */
function anchorSortPriority(source, status) {
  if (source === 'plaid' && status === 'converted') return PLAID_CONVERTED_SORT_PRIORITY;
  return ANCHOR_SORT_PRIORITIES[source] ?? DEFAULT_SORT_PRIORITY;
}
