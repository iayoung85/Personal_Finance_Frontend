/**
 * Apply a response's changed rows to the page's transaction list.
 *
 * `removed_transaction_ids` and `affected_transactions` describe the list
 * after the request: drop the removed ids, then replace each affected row by
 * `transaction_id` or add it. Rows arrive in the shape `GET /api/transactions`
 * returns, which the page stores as it receives it, so nothing is normalized.
 *
 * A split piece lives inside its parent's `splits` and the API never lists it
 * as a row, so replacing the parent replaces its pieces. Rows with a
 * `<parent>_split_` id are the older flat form of a piece; they are dropped
 * with the parent they belong to so none outlives it.
 *
 * Returns new arrays and leaves the input alone. `patched: false` means a
 * field is missing or not an array (an older API, or one that could not build
 * them), and the caller must re-download instead.
 *
 * @param {Object[]} currentRows The in-memory transactions.
 * @param {Object|null|undefined} responseData Parsed JSON body of the save.
 * @returns {{patched: boolean, rows: Object[], removedIds: string[], upsertedRows: Object[]}}
 *   `removedIds` lists ids dropped from the list and not put back, and
 *   `upsertedRows` the rows written, so a cache can mirror the change.
 */
function patchTransactionsFromResponse(currentRows, responseData) {
  const held = Array.isArray(currentRows) ? currentRows : [];
  const unpatched = { patched: false, rows: held, removedIds: [], upsertedRows: [] };
  if (!responseData) return unpatched;

  if (!responseCarriesChangedRows(responseData)) return unpatched;
  const removedIds = responseData.removed_transaction_ids;
  const affectedRows = responseData.affected_transactions;

  const rowsById = new Map();
  affectedRows.forEach((row) => rowsById.set(row.transaction_id, row));

  const dropIds = new Set(removedIds);
  const splitPiecePrefixes = affectedRows
    .filter((row) => row.is_split || (Array.isArray(row.splits) && row.splits.length > 0))
    .map((row) => `${row.transaction_id}_split_`);

  const droppedIds = [];
  const keptRows = [];
  held.forEach((row) => {
    const rowId = row.transaction_id;
    const isStalePiece = splitPiecePrefixes.some((prefix) => typeof rowId === 'string' && rowId.startsWith(prefix));
    if (dropIds.has(rowId) || isStalePiece) {
      droppedIds.push(rowId);
      return;
    }
    keptRows.push(rowId !== undefined && rowsById.has(rowId) ? rowsById.get(rowId) : row);
  });

  const keptIds = new Set(keptRows.map((row) => row.transaction_id));
  const addedRows = [];
  rowsById.forEach((row, rowId) => {
    if (!keptIds.has(rowId)) addedRows.push(row);
  });

  const upsertedRows = Array.from(rowsById.values());
  const removedForCache = Array.from(new Set(removedIds.concat(droppedIds)))
    .filter((rowId) => !rowsById.has(rowId));
  return {
    patched: true,
    rows: keptRows.concat(addedRows),
    removedIds: removedForCache,
    upsertedRows,
  };
}

/**
 * Whether a response names the rows it changed: both fields present as
 * arrays, and every affected row carrying an id. Without them the page has
 * to fetch the rows again.
 *
 * @param {Object|null|undefined} responseData Parsed JSON body of the save.
 * @returns {boolean}
 */
function responseCarriesChangedRows(responseData) {
  if (!responseData) return false;
  const removedIds = responseData.removed_transaction_ids;
  const affectedRows = responseData.affected_transactions;
  if (!Array.isArray(removedIds) || !Array.isArray(affectedRows)) return false;
  return !affectedRows.some((row) => !row || !row.transaction_id);
}

/**
 * The row a save is about: the entry of `affected_transactions` whose id is
 * the response's `transaction_id`. A bill occurrence saved for the first time
 * gets a new id, and this is how a caller learns the row it became.
 *
 * @param {Object|null|undefined} responseData Parsed JSON body of the save.
 * @returns {Object|null} The row, or null when the response lacks it.
 */
function findSavedRowInResponse(responseData) {
  if (!responseData || !responseData.transaction_id) return null;
  const affectedRows = responseData.affected_transactions;
  if (!Array.isArray(affectedRows)) return null;
  return affectedRows.find((row) => row && row.transaction_id === responseData.transaction_id) || null;
}
