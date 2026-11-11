// ============================================================
// transactions/ledger-forecast.js — Ledger column forecast walk
//
// The pending and scheduled rows have no history in the API's balance
// snapshots, so the ledger column projects them forward from the posted
// balance. Pure functions: no DOM, so the walk can be tested.
// ============================================================

/**
 * Whether a row is a pending hold the user hid. Such a row is out of the
 * forecast in every view, because hiding a hold is how the user says it
 * should not count. A hidden posted row is not this: the bank counts it, so
 * the ledger does too.
 *
 * @param {Object} txn - Transaction row.
 * @returns {boolean}
 */
function isHiddenPendingRow(txn) {
  return !!txn && !!txn.pending && !!txn.is_hidden;
}

/**
 * Project the ledger column's running balance for the pending rows, then
 * for the scheduled rows on top of the pending total.
 *
 * @param {number} postedBalance - The current posted balance.
 * @param {Object[]} pendingNewestFirst - Pending rows, newest first.
 * @param {Object[]} scheduledNewestFirst - Scheduled future rows, furthest date first.
 * @returns {{pendingLedgerLookup: Object<string, number>, scheduledLedgerLookup: Object<string, number>}}
 *   Running balance by transaction id. A hidden pending row has no entry.
 */
function projectLedgerForecast(postedBalance, pendingNewestFirst, scheduledNewestFirst) {
  const pendingLedgerLookup = {};
  const scheduledLedgerLookup = {};
  let runningProjected = postedBalance;

  [...pendingNewestFirst].reverse().forEach(txn => {
    if (isHiddenPendingRow(txn)) return;
    runningProjected += txn.amount;
    if (txn.transaction_id) {
      pendingLedgerLookup[txn.transaction_id] = runningProjected;
    }
  });

  [...scheduledNewestFirst].reverse().forEach(txn => {
    runningProjected += txn.amount;
    if (txn.transaction_id) {
      scheduledLedgerLookup[txn.transaction_id] = runningProjected;
    }
  });

  return { pendingLedgerLookup, scheduledLedgerLookup };
}
