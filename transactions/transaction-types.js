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
