// ============================================================
// transactions/worker/db-worker.js — IndexedDB Web Worker
// Handles all IndexedDB reads/writes off the main thread via
// Dexie.js. Communicates with worker-client.js via postMessage.
// ============================================================

importScripts('https://cdn.jsdelivr.net/npm/dexie@4/dist/dexie.min.js');

// ── Dexie schema ────────────────────────────────────────────
const db = new Dexie('PersonalFinanceDB');
db.version(1).stores({
  // Primary key: transaction_id
  // Indexes: date, account_id, compound [account_id+date]
  transactions: 'transaction_id, date, account_id, [account_id+date]',
  // Key-value store for etag, sync timestamps, schema version
  meta: 'key',
});

// ── Message handler ─────────────────────────────────────────
self.onmessage = async function(e) {
  const { id, type } = e.data;

  try {
    let result;

    switch (type) {

      case 'bulk-write': {
        const txns = e.data.data;
        if (Array.isArray(txns) && txns.length > 0) {
          await db.transactions.bulkPut(txns);
        }
        result = { count: txns ? txns.length : 0 };
        break;
      }

      case 'query': {
        // Params: dateStart, dateEnd, accountId (all optional)
        const { dateStart, dateEnd, accountId } = e.data;
        let items;

        if (accountId && (dateStart || dateEnd)) {
          items = await db.transactions
            .where('[account_id+date]')
            .between(
              [accountId, dateStart || ''],
              [accountId, dateEnd || '\uffff'],
              true, true
            )
            .toArray();
        } else if (accountId) {
          items = await db.transactions
            .where('account_id')
            .equals(accountId)
            .toArray();
        } else if (dateStart || dateEnd) {
          items = await db.transactions
            .where('date')
            .between(dateStart || '', dateEnd || '\uffff', true, true)
            .toArray();
        } else {
          items = await db.transactions.toArray();
        }

        result = { data: items, totalCount: items.length };
        break;
      }

      case 'count': {
        result = { count: await db.transactions.count() };
        break;
      }

      case 'delete': {
        await db.transactions.delete(e.data.transactionId);
        result = {};
        break;
      }

      case 'clear': {
        await db.transactions.clear();
        await db.meta.clear();
        result = {};
        break;
      }

      case 'get-meta': {
        const row = await db.meta.get(e.data.key);
        result = { value: row ? row.value : undefined };
        break;
      }

      case 'set-meta': {
        await db.meta.put({ key: e.data.key, value: e.data.value });
        result = {};
        break;
      }

      default:
        throw new Error('Unknown message type: ' + type);
    }

    self.postMessage({ id, type: 'result', ...result });

  } catch (err) {
    self.postMessage({ id, type: 'error', error: err.message || String(err) });
  }
};

// Signal the main thread that the worker is ready
self.postMessage({ type: 'ready' });
