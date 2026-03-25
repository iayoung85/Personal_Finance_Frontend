# IndexedDB + Dexie Migration Plan

## Summary
Replace the broken `localStorage` transaction cache with Dexie.js (IndexedDB wrapper). localStorage has a hard 5–10 MB quota that fails at ~8k transactions — it is not a viable cache for this app's scale target of 10k–100k transactions. The migration introduces per-transaction IndexedDB storage via Dexie, a Web Worker for off-main-thread writes, and streaming reads to support future table virtualization.

## Why localStorage caching was always doomed
- `localStorage` quota is 5–10 MB per origin (browser-dependent, not configurable).
- 10k transactions serialized via `JSON.stringify` ≈ 8–15 MB → `QuotaExceededError`.
- Every write re-serializes the entire array — O(n) stringify on every single-field edit.
- Every read re-parses the entire blob — O(n) `JSON.parse` on main thread.
- Phase 1 mitigated parse cost with an in-memory cache, but the write quota is a hard wall.
- **Decision: remove `localStorage` transaction caching entirely in this migration.**

## Goals
- Store transactions in IndexedDB via Dexie (per-transaction rows, not a monolithic blob).
- Eliminate `QuotaExceededError` — IndexedDB quotas are 100s of MB to GB.
- Keep UI responsive: heavy reads/writes happen off main thread in a Web Worker.
- Enable incremental updates (write only changed transactions, not the full array).
- Support streaming reads for future table virtualization (fetch only viewport rows).
- Provide a clean migration path from localStorage → IndexedDB → localStorage deletion.

## Technology choice: Dexie.js
- **Size:** ~45 KB minified
- **API:** Promise-based, query-builder style (`.where()`, `.between()`, `.offset()/.limit()`)
- **Why over raw `idb`:** Built-in compound indexes, bulk operations, schema versioning, `liveQuery()` for reactive reads. Significantly less boilerplate for the query patterns we need (date ranges, account filtering, pagination).
- **CDN / install:** `<script src="https://unpkg.com/dexie@latest/dist/dexie.min.js"></script>` or vendored locally.

## High-level architecture

### IndexedDB schema (via Dexie)
```js
const db = new Dexie('PersonalFinanceDB');
db.version(1).stores({
  // Primary key: transaction_id. Indexes on date, account_id, and compound.
  transactions: 'transaction_id, date, account_id, [account_id+date]',
  // Metadata: etag, last sync timestamps, schema version
  meta: 'key',
});
```

### Web Worker responsibilities
- Receive bulk transaction arrays from main thread via `postMessage`.
- Write batches to IndexedDB using `db.transactions.bulkPut()`.
- Respond to query messages: date-range window, account filter, count.
- Handle migrate-from-localStorage message (one-time, idempotent).
- Post progress events for large bulk writes.

### Main thread responsibilities
- Network fetches stay on main thread (authenticated via `authenticatedFetch`).
- After fetch, post transaction array to worker for persistence.
- For rendering: query worker for the active date/account window only.
- Keep lightweight in-memory array (`transactions[]`) for the active viewport.
- User edits mutate `transactions[]` optimistically, then post deltas to worker.

### Data flow: page load
```
1. Main thread → Worker: { type: 'query', dateRange, accountId, limit }
2. Worker → IndexedDB: db.transactions.where('[account_id+date]').between(...)
3. Worker → Main thread: { type: 'query-result', data: [...] }
4. Main thread: transactions = data; renderTransactionTable();
5. Main thread → Backend: _fetchTransactionsFromServer(sinceDate) [Phase 1 two-phase]
6. If 304 → done. If new data → Main thread → Worker: { type: 'bulk-write', data }
7. Worker: db.transactions.bulkPut(data) → posts 'write-complete'
8. Main thread: re-query if needed, re-render
```

### Data flow: user edit (category/memo via batch-edit)
```
1. stageBatchEdit() → mutate transactions[] in memory (optimistic)
2. DOM patch (cell-only, no full re-render)
3. flushBatchEdits() → POST /api/transactions/bulk-update
4. On success → Worker: { type: 'bulk-write', data: [updatedTxns] }
5. Worker: db.transactions.bulkPut(updatedTxns)
```

### Data flow: user edit (inline date/amount/description)
```
1. PUT /api/transactions/manual/{id} → success
2. Worker: { type: 'delete', id } (stale row)
3. fetchAllTransactions(true) → new data → Worker: { type: 'bulk-write', data }
4. renderTransactionTable()
```

## Migration Phases & Tasks

### Phase 0 — Discovery & Safety **DONE**
- ~~Audit transaction sizes and shapes (typical MB per user).~~ **DONE** — 10k txns ≈ 8–15 MB, exceeds localStorage quota.
- ~~Confirm backend endpoints for partial sync (by account, since_date) and ETag usage.~~ **DONE** — two-phase loading with ETag 304 support confirmed working.
- ~~Decide whether the worker will perform authenticated fetches.~~ **DONE** — main thread owns network calls, worker owns IndexedDB writes.

### Phase 1 — Fast Wins **DONE**
- ~~In-memory parsed cache in `transactions/api.js`.~~ **DONE** — `_readCachedTransactions()` / `_inMemoryTransactionCache`.
- ~~AbortController on `_fetchTransactionsFromServer`.~~ **DONE** — `_fetchAbortController` cancels stale in-flight requests.
- ~~`requestIdleCallback` wrapper for Phase 2 backfill.~~ **DONE** — full-history backfill deferred via idle callback.
- ~~Centralize all cache writes through `_cacheTransactions()`.~~ **DONE** — 6 direct `localStorage.setItem` calls consolidated.
- ~~Graceful quota failure: in-memory cache always updated even when localStorage throws.~~ **DONE**
- ~~Default date filter to last 12 months to reduce initial DOM size.~~ **DONE** — "Last 12 Months" default + "Show All Dates" button.

### Phase 2 — Dexie + IndexedDB scaffold **DONE**
**New files:**
- `transactions/worker/db-worker.js` — Web Worker with Dexie CDN import, IndexedDB schema, message handlers. **DONE**
- `transactions/worker-client.js` — Main-thread Promise adapter over postMessage. Exposes `window.txnDB`. **DONE**

**Completed tasks:**
1. **Dexie loaded in worker via CDN `importScripts()`.** No main-thread Dexie script needed. **DONE**
2. **Schema defined in `db-worker.js`:** `transactions` store keyed on `transaction_id`, indexed on `date`, `account_id`, `[account_id+date]`. `meta` store for cached_at timestamp. **DONE**
3. **Worker message handler** supports: `bulk-write`, `query`, `count`, `delete`, `clear`, `get-meta`, `set-meta`. **DONE**
4. **`worker-client.js`** starts worker, assigns message IDs, resolves Promises on response. Exposes: `txnDB.ready()`, `.bulkWrite()`, `.query()`, `.count()`, `.deleteTxn()`, `.clear()`, `.getMeta()`, `.setMeta()`. **DONE**
5. **`api.js` updated:** `_cacheTransactions()` writes to IndexedDB via worker (+ localStorage best-effort fallback). `_readCachedTransactions()` is now `async` — checks in-memory → IndexedDB → localStorage fallback. Both callers (`autoSyncAndLoadTransactions`, `fetchAllTransactions`) now `await` it. **DONE**
6. **One-time migration in `main.js`:** On first load, if IndexedDB is empty and localStorage has `pf_cached_transactions`, migrates data via `bulkWrite()`, then removes localStorage keys. **DONE**
7. **`inline-edit.js` updated:** `_refreshAfterInlineEdit()` clears in-memory cache + IndexedDB (`txnDB.clear()`) + localStorage before force-fetching. **DONE**
8. **`transactions.html`:** `worker-client.js` script tag added before `state.js` (loads before `api.js`). **DONE**

### Phase 3 — Remove localStorage, streaming reads, prep for virtualization
1. **Delete all localStorage transaction cache code.** **DONE**
   - Remove constants: `TRANSACTION_CACHE_KEY`, `TRANSACTION_CACHE_TS_KEY`, `TRANSACTION_CACHE_MAX_AGE_MS`. **DONE** — removed `TRANSACTION_CACHE_KEY`, `TRANSACTION_CACHE_TS_KEY`, `TRANSACTION_ETAG_KEY`; `TRANSACTION_CACHE_MAX_AGE_MS` kept (used for cache-age checks against IndexedDB `cached_at`).
   - Remove `_readCachedTransactions()` localStorage fallback path. **DONE** — reads from IndexedDB only now.
   - Remove `_inMemoryTransactionCache` / `_inMemoryTransactionCacheTs` (IndexedDB + worker replaces this). **DONE**
   - Clean up `logout()` — remove `localStorage.removeItem('pf_cached_transactions')` etc. **DONE** — `logout()` now calls `txnDB.clear()`.
   - Clean up all other files: `context-menu.js`, `manual-transactions.js`, `row-renderers.js`, `resolution.js`, `inline-edit.js`, `import/file-upload.js`, `import/review.js` — replaced `localStorage.removeItem` calls with `_invalidateTransactionCache()`. **DONE**
   - Clean up `bills.js` and `categories/api.js` — replaced with raw IndexedDB API calls (these pages don't load the worker). **DONE**
   - One-time migration in `main.js` preserved — safely migrates any lingering localStorage data + ETag to IndexedDB, then deletes the localStorage keys. **DONE**
4. **ETag storage in IndexedDB.** **DONE**
   - Moved `pf_transactions_etag` from localStorage to `meta` store (key: `etag`). **DONE**
   - `main.js` loads persisted ETag into `_fetchTransactionsFromServer._cachedEtag` on startup. **DONE**
   - `_fetchTransactionsFromServer` reads/writes ETag from/to IndexedDB meta store. **DONE**
   - `_invalidateTransactionCache()` clears cached ETag to prevent stale 304s. **DONE**
2. **Streaming reads for table rendering.**
   - `renderTransactionTable()` requests only the filtered window from worker: `workerClient.query({ dateStart, dateEnd, accountId, offset: 0, limit: PAGE_SIZE })`.
   - Worker returns rows + total count.
   - Table renderer receives pre-filtered, pre-paginated data.
   - This naturally limits DOM nodes — no need to render 100k rows.
3. **Incremental writes on edits.**
   - `stageBatchEdit` / `flushBatchEdits`: after API success, `workerClient.bulkWrite([updatedTxn])` — single-row upsert, not full-array rewrite.
   - Category overrides, memo saves, manual transaction adds: same pattern.
5. **Balance history in IndexedDB (optional).**
   - Add `balance_history` store: `[account_id+transaction_id]`.
   - Eliminates another localStorage blob that can hit quota.

### Phase 4 — Virtual scrolling (separate but enabled by Phase 3)
- With streaming reads from Phase 3, the table renderer can request pages on scroll.
- Options: Clusterize.js (4 KB, vanilla JS, drop-in) or custom `IntersectionObserver` implementation.
- Table renders a fixed-size DOM window (~50–100 rows), requests more from worker as user scrolls.
- This is the unlock for 100k transactions rendering without browser tab crashes.

### Phase 5 — Cleanup & monitoring
- Remove any remaining localStorage fallback code.
- Add performance telemetry: IndexedDB read/write latency, worker message round-trip, render time.
- Verify on slow devices / mobile browsers.

## Required changes to repository

### New files
| File | Purpose |
|------|---------|
| `transactions/db.js` | Dexie schema + helper functions |
| `transactions/worker/db-worker.js` | Web Worker for IndexedDB operations |
| `transactions/worker-client.js` | Main-thread Promise wrapper for worker |
| `lib/dexie.min.js` (or CDN) | Dexie.js dependency |

### Modified files
| File | Changes |
|------|---------|
| `transactions.html` | Add `<script>` for Dexie + new modules |
| `transactions/api.js` | Replace localStorage cache with worker-client calls |
| `transactions/batch-edit-manager.js` | `_persistTransactionCache()` → `workerClient.bulkWrite()` |
| `transactions/categories.js` | Cache writes → `workerClient.bulkWrite()` |
| `transactions/manual-transactions.js` | Cache writes → `workerClient.bulkWrite()` |
| `transactions/table-renderer.js` | Cache writes → `workerClient.bulkWrite()`; Phase 3: accept async data source |
| `transactions/inline-edit.js` | `_refreshAfterInlineEdit()` — remove localStorage.removeItem calls |
| `transactions/filters.js` | No changes needed (date range logic unchanged) |

### Deleted (Phase 3)
- All references to `TRANSACTION_CACHE_KEY`, `TRANSACTION_CACHE_TS_KEY` in localStorage.
- `_inMemoryTransactionCache`, `_inMemoryTransactionCacheTs` variables.
- `_readCachedTransactions()` function (replaced by worker queries).

## Risks & considerations
- **Auth in Worker:** Workers cannot access `localStorage` or DOM. Auth token must be passed via `postMessage` if worker ever needs to fetch directly. Current plan: main thread owns all network calls, so this is not an issue.
- **Browser support:** IndexedDB and Web Workers are supported in all modern browsers. Dexie handles IndexedDB quirks (Safari private browsing, Firefox transaction limits).
- **Storage quotas:** IndexedDB is typically 50% of disk space (Chrome) or up to 2 GB (Firefox). 100k transactions ≈ 80–150 MB — well within limits.
- **Worker startup cost:** First `new Worker()` has ~10–50ms overhead. Mitigated by starting worker early in page load, before network fetch completes.
- **Structured cloning:** `postMessage` uses structured cloning for arrays — faster than JSON.stringify/parse for large datasets, but still has a cost. For 100k transactions, expect ~50–200ms clone time. Consider `Transferable` if profiling shows this is a bottleneck.

## Quick indicators of success
- `QuotaExceededError` never appears in console.
- Page load with 10k cached transactions: < 500ms to first meaningful paint (IndexedDB async read).
- Category/memo edits: no perceptible lag (single-row upsert vs full-array serialize).
- 100k transactions: page remains responsive (streaming reads + future virtualization).

## Estimated effort
| Phase | Effort | Status |
|-------|--------|--------|
| Phase 0 — Discovery | 1 day | **DONE** |
| Phase 1 — Fast wins | 4–8 hours | **DONE** |
| Phase 2 — Dexie + Worker scaffold | 1–2 days | **DONE** |
| Phase 3 — Remove localStorage, streaming | 1–2 days | **Partially done** (localStorage removed + ETag migrated; streaming reads + incremental writes not started) |
| Phase 4 — Virtual scrolling | 1–2 days | Not started |
| Phase 5 — Cleanup & monitoring | Half day | Not started |

## Next steps
1. **Phase 2:** ~~Add Dexie dependency, create `db.js`, `db-worker.js`, `worker-client.js`. Wire into `api.js`. Run one-time localStorage → IndexedDB migration.~~ **DONE**
2. **Phase 3:** ~~Rip out all localStorage transaction cache code.~~ **DONE** Remaining: streaming reads, incremental writes.
3. **Phase 4:** Add virtual scrolling to table renderer.

---

### Notes & links
- Dexie.js docs: https://dexie.org/docs/
- Dexie `bulkPut` for batch writes: https://dexie.org/docs/Table/Table.bulkPut()
- Dexie `liveQuery` for reactive reads (potential future use): https://dexie.org/docs/liveQuery()
- Web Worker `postMessage` structured cloning: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
