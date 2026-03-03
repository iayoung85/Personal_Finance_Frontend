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
  TXN_TYPE.MANUAL_CLEARED,
]);

/**
 * Return true if the transaction type is system-generated bookkeeping.
 * @param {string} txnType - A TXN_TYPE value.
 * @returns {boolean}
 */
function isSystemType(txnType) {
  return SYSTEM_TYPES.has(txnType);
}
