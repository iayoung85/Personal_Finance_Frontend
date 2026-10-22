/**
 * Mark the browser's transaction cache (Dexie/IndexedDB 'PersonalFinanceDB')
 * as stale, so the transactions page refetches from the server on its next load.
 *
 * Why raw IndexedDB: pages that edit data affecting transactions (bills,
 * categories) do not load the transactions cache worker. The rows are kept,
 * only the stored ETag and cache time are reset; the transactions page then
 * fails its freshness check, skips the 304 short-circuit, and replaces the
 * rows in one step when the fresh response arrives.
 *
 * Failure is non-fatal: the transactions page falls back to its normal
 * five-minute freshness window.
 */
function markTransactionCacheStale() {
  try {
    var req = indexedDB.open('PersonalFinanceDB');
    req.onsuccess = function(e) {
      var db = e.target.result;
      if (db.objectStoreNames.contains('meta')) {
        var txn = db.transaction(['meta'], 'readwrite');
        var store = txn.objectStore('meta');
        store.put({ key: 'etag', value: null });
        store.put({ key: 'cached_at', value: 0 });
      }
      db.close();
    };
  } catch (e) { /* non-fatal */ }
}
