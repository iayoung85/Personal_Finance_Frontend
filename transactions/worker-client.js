// ============================================================
// transactions/worker-client.js — Main-Thread Worker Adapter
// Promise-based API over the db-worker.js Web Worker.
// Loaded via <script> tag BEFORE api.js.
// ============================================================

var txnDB = (function() {
  var worker = null;
  var messageId = 0;
  var pending = new Map();
  var readyResolve = null;
  var readySettled = false;
  var readyTimeoutId = null;
  var readyPromise = new Promise(function(resolve) { readyResolve = resolve; });
  var WORKER_READY_TIMEOUT_MS = 2500;

  var _workerDegraded = false;

  function _resolveReadyOnce() {
    if (readySettled) return;
    readySettled = true;
    if (readyTimeoutId) {
      clearTimeout(readyTimeoutId);
      readyTimeoutId = null;
    }
    readyResolve();
  }

  function _degradeWorker(detail) {
    if (_workerDegraded && !worker) {
      _resolveReadyOnce();
      return;
    }

    _workerDegraded = true;

    if (worker) {
      try { worker.terminate(); } catch (_ignored) {}
      worker = null;
    }

    pending.forEach(function(callbacks) {
      callbacks.reject(new Error(detail));
    });
    pending.clear();

    _surfaceWorkerFailure(detail);
    _resolveReadyOnce();
  }

  function _init() {
    try {
      worker = new Worker('transactions/worker/db-worker.js');
    } catch (err) {
      _degradeWorker('IndexedDB worker failed to start: ' + err.message);
      return;
    }

    readyTimeoutId = setTimeout(function() {
      _degradeWorker(
        'IndexedDB worker did not become ready within ' +
        WORKER_READY_TIMEOUT_MS + 'ms'
      );
    }, WORKER_READY_TIMEOUT_MS);

    worker.onmessage = function(e) {
      var msg = e.data;

      // Worker startup signal
      if (msg.type === 'ready') {
        _resolveReadyOnce();
        return;
      }

      // Response to a pending request
      if (msg.id !== undefined && pending.has(msg.id)) {
        var callbacks = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.type === 'error') {
          callbacks.reject(new Error(msg.error));
        } else {
          callbacks.resolve(msg);
        }
      }
    };

    worker.onerror = function(err) {
      console.error('IndexedDB worker error:', err);
      _degradeWorker('IndexedDB worker encountered an error');
    };
  }

  function _surfaceWorkerFailure(detail) {
    // Dev visibility: structured console warning
    console.warn('[txnDB] DEGRADED — local caching is offline. Detail:', detail);

    // User visibility: show a status message if the transactions page is active
    if (typeof showStatus === 'function') {
      showStatus('Local cache unavailable — performance may be reduced', 'warning');
    }
  }

  function _send(type, payload) {
    if (!worker) {
      return Promise.reject(new Error('IndexedDB worker not available'));
    }
    return new Promise(function(resolve, reject) {
      var id = messageId++;
      pending.set(id, { resolve: resolve, reject: reject });
      worker.postMessage(Object.assign({ id: id, type: type }, payload || {}));
    });
  }

  // ── Public API ──────────────────────────────────────────

  /** Wait for the worker to finish initializing. */
  function ready() {
    return readyPromise;
  }

  /** Write an array of transaction objects into IndexedDB (upsert). */
  function bulkWrite(txns) {
    if (!worker || !Array.isArray(txns) || txns.length === 0) {
      return Promise.resolve({ count: 0 });
    }
    return _send('bulk-write', { data: txns });
  }

  /** Query transactions. All params optional. Returns array. */
  function query(params) {
    if (!worker) return Promise.resolve([]);
    return _send('query', params || {}).then(function(res) {
      return res.data || [];
    });
  }

  /** Get total transaction count in IndexedDB. */
  function count() {
    if (!worker) return Promise.resolve(0);
    return _send('count').then(function(res) {
      return res.count || 0;
    });
  }

  /** Delete a single transaction by ID. */
  function deleteTxn(transactionId) {
    return _send('delete', { transactionId: transactionId });
  }

  /** Clear all transactions and metadata from IndexedDB. */
  function clear() {
    if (!worker) return Promise.resolve();
    return _send('clear');
  }

  /** Get a metadata value by key. */
  function getMeta(key) {
    if (!worker) return Promise.resolve(undefined);
    return _send('get-meta', { key: key }).then(function(res) {
      return res.value;
    });
  }

  /** Set a metadata value. */
  function setMeta(key, value) {
    if (!worker) return Promise.resolve();
    return _send('set-meta', { key: key, value: value });
  }

  // ── Granular cache operations ───────────────────────────

  /** Patch specific fields on one cached transaction. */
  function patch(transactionId, fields) {
    if (!worker || !transactionId) return Promise.resolve();
    return _send('patch', { transactionId: transactionId, fields: fields });
  }

  /** Patch the same fields on multiple cached transactions. */
  function patchBatch(ids, fields) {
    if (!worker || !Array.isArray(ids) || ids.length === 0) return Promise.resolve();
    return _send('patch-batch', { ids: ids, fields: fields });
  }

  /** Insert or overwrite a single transaction (upsert). */
  function putOne(txn) {
    if (!worker || !txn) return Promise.resolve();
    return _send('put-one', { data: txn });
  }

  /** Remove a single transaction by ID. */
  function deleteOne(transactionId) {
    if (!worker || !transactionId) return Promise.resolve();
    return _send('delete-one', { transactionId: transactionId });
  }

  /** Atomically clear and replace all cached transactions.
   *  Meta store (etag, cached_at) is preserved. */
  function replaceAll(txns) {
    if (!worker) return Promise.resolve({ count: 0 });
    return _send('replace-all', { data: txns || [] });
  }

  /** Atomically clear one account's rows and replace with new data.
   *  All other accounts' cached transactions stay untouched. */
  function replaceForAccount(accountId, txns) {
    if (!worker || !accountId) return Promise.resolve({ count: 0 });
    return _send('replace-for-account', { accountId: accountId, data: txns || [] });
  }

  _init();

  /** Returns true if the worker failed to start or errored at runtime. */
  function isDegraded() {
    return _workerDegraded;
  }

  return {
    ready: ready,
    bulkWrite: bulkWrite,
    query: query,
    count: count,
    deleteTxn: deleteTxn,
    clear: clear,
    getMeta: getMeta,
    setMeta: setMeta,
    isDegraded: isDegraded,
    patch: patch,
    patchBatch: patchBatch,
    putOne: putOne,
    deleteOne: deleteOne,
    replaceAll: replaceAll,
    replaceForAccount: replaceForAccount,
  };
})();
