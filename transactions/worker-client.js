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
  var readyPromise = new Promise(function(resolve) { readyResolve = resolve; });

  function _init() {
    try {
      worker = new Worker('transactions/worker/db-worker.js');
    } catch (err) {
      console.error('Failed to start IndexedDB worker:', err);
      // Mark ready so callers don't hang; all ops will gracefully no-op
      readyResolve();
      return;
    }

    worker.onmessage = function(e) {
      var msg = e.data;

      // Worker startup signal
      if (msg.type === 'ready') {
        readyResolve();
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
    };
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
    return _send('query', params || {}).then(function(res) {
      return res.data || [];
    });
  }

  /** Get total transaction count in IndexedDB. */
  function count() {
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
    return _send('clear');
  }

  /** Get a metadata value by key. */
  function getMeta(key) {
    return _send('get-meta', { key: key }).then(function(res) {
      return res.value;
    });
  }

  /** Set a metadata value. */
  function setMeta(key, value) {
    return _send('set-meta', { key: key, value: value });
  }

  _init();

  return {
    ready: ready,
    bulkWrite: bulkWrite,
    query: query,
    count: count,
    deleteTxn: deleteTxn,
    clear: clear,
    getMeta: getMeta,
    setMeta: setMeta,
  };
})();
