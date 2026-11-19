// ============================================================
// transactions/unmatched-toggle.js — When "Show unmatched" is offered
// The checkbox narrows the ledger to bank rows with no match, which only
// helps while most rows are matched (a relink). Once the unmatched rows are
// the bulk of the ledger the narrowing hides nothing worth hiding, so the
// control is taken away to keep the toggle row short.
// ============================================================

// The ledger share at or above which the checkbox is hidden.
const UNMATCHED_TOGGLE_HIDE_SHARE = 0.51;

/**
 * Whether a row carries a match. Same two fields the backend uses to tie a
 * bank row to a manual or scheduled one.
 * @param {Object} txn
 * @returns {boolean}
 */
function isMatchedLedgerRow(txn) {
  return !!(txn && (txn.match_info || txn.matched_transaction_id));
}

/**
 * Decide whether the "Show unmatched" checkbox is offered.
 * @param {number} totalRows Rows in the displayed ledger, before the unmatched narrowing.
 * @param {number} notMatchedRows How many of those carry no match, of any type.
 * @param {boolean} isTicked An active filter always keeps its control.
 * @returns {boolean}
 */
function shouldShowUnmatchedToggle(totalRows, notMatchedRows, isTicked) {
  if (isTicked) return true;
  if (totalRows <= 0) return false;
  return notMatchedRows / totalRows < UNMATCHED_TOGGLE_HIDE_SHARE;
}
