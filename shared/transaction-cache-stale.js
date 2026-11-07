/**
 * Reset the browser's transaction cache (Dexie/IndexedDB 'PersonalFinanceDB')
 * so the transactions page downloads the list again on its next load.
 *
 * Why raw IndexedDB: pages that edit data affecting transactions (bills,
 * categories) do not load the transactions cache worker. The rows are kept
 * and drawn first; only the stored ETag and cache time are reset, so the next
 * load sends no If-None-Match, cannot get a 304, and replaces the rows in one
 * step when the fresh response arrives.
 *
 * Failure is non-fatal: the transactions page still validates its rows with
 * the stored ETag on load, and the server answers with new data if the edit
 * changed the list.
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
