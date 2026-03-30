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

      // ── Granular cache operations ─────────────────────────
      // Avoid clearing all 100k+ rows for single-field mutations.

      case 'patch': {
        // Patch specific fields on one cached transaction.
        // Uses Dexie.update() which is a no-op if the key doesn't exist.
        const { transactionId, fields } = e.data;
        const updated = await db.transactions.update(transactionId, fields);
        result = { patched: updated };
        break;
      }

      case 'patch-batch': {
        // Patch the same fields on multiple transactions (e.g. batch unhide).
        const { ids, fields } = e.data;
        let patchCount = 0;
        await db.transaction('rw', db.transactions, async () => {
          for (const txnId of ids) {
            patchCount += await db.transactions.update(txnId, fields);
          }
        });
        result = { patched: patchCount };
        break;
      }

      case 'put-one': {
        // Insert or overwrite a single transaction (upsert).
        await db.transactions.put(e.data.data);
        result = {};
        break;
      }

      case 'delete-one': {
        // Remove a single transaction by primary key.
        await db.transactions.delete(e.data.transactionId);
        result = {};
        break;
      }

      case 'replace-all': {
        // Atomic clear + bulk-insert of the transactions table.
        // Meta store (etag, cached_at) is preserved.
        const txns = e.data.data;
        await db.transaction('rw', db.transactions, async () => {
          await db.transactions.clear();
          if (Array.isArray(txns) && txns.length > 0) {
            await db.transactions.bulkPut(txns);
          }
        });
        result = { count: txns ? txns.length : 0 };
        break;
      }

      case 'replace-for-account': {
        // Atomic delete-by-account + bulk-insert for one account's rows.
        // All other accounts' data stays untouched in the store.
        const accountId = e.data.accountId;
        const txns = e.data.data;
        await db.transaction('rw', db.transactions, async () => {
          await db.transactions.where('account_id').equals(accountId).delete();
          if (Array.isArray(txns) && txns.length > 0) {
            await db.transactions.bulkPut(txns);
          }
        });
        result = { count: txns ? txns.length : 0 };
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
