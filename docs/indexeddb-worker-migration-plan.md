# IndexedDB + Background Worker Migration Plan

## Summary
Move the large transaction cache out of `localStorage` into an async, non-blocking IndexedDB store and introduce a background worker (Web Worker) to handle heavy parsing, syncing, and incremental updates. This eliminates main-thread JSON.parse/stringify jank for large datasets (10k–20k transactions), enables per-transaction storage and incremental writes, and allows an off-main-thread sync process that keeps the local DB aligned with the backend.

## Goals
- Eliminate synchronous localStorage parsing of large JSON blobs.
- Keep UI responsive during cache reads/writes and syncs.
- Allow incremental updates (per-transaction or per-account) instead of rewriting a monolithic blob.
- Support background sync logic that can safely retry, back off, and persist progress.
- Provide a migration path (fallback to existing localStorage while rolling out).

## High-level architecture
- IndexedDB schema
  - `transactions` store (key: `transaction_id`, value: transaction object)
  - `accounts` store (key: `account_id`, metadata)
  - `meta` store (keys: `etag`, `last_full_sync`, `last_backfill_ts`, `schema_version`)
  - Optional `deltas` store for pending local edits
- Web Worker responsibilities (dedicated worker, not a service worker)
  - Fetch data from backend (via main thread or via fetch inside worker if CORS & auth manageable)
  - Parse and write transaction batches into IndexedDB (bulk put operations)
  - Compute and apply deltas, pruning, index maintenance
  - Respond to messages from main thread (query window, return N transactions, start/stop sync)
- Main thread responsibilities
  - UI rendering reads from IndexedDB via async API (wrap IndexedDB access in a small helper); maintain a small in-memory window for fast UI interactions
  - Send user actions and filter requests to worker; request incremental windows for rendering
  - Keep light-weight memory cache for the active viewport/page to avoid repeated reads
- Sync flow options
  - Worker-driven schedule: worker polls or reacts to messages to call `performSync` endpoints, then writes changes into IndexedDB and notifies main thread
  - Main-thread triggers: e.g., user clicks Sync → main thread asks worker to run sync immediately

## Migration Phases & Tasks
Phase 0 — Discovery & Safety (1 day)
- Audit transaction sizes and shapes (typical MB per user).
- Confirm backend endpoints for partial sync (by account, since_date) and ETag usage.
- Decide whether the worker will perform authenticated fetches (needs token) or main thread proxies network requests.

Phase 1 — Prototype (4–8 hours)
- Minimal changes only in `transactions/api.js`:
  - Add in-memory parsed cache: read `localStorage` once, parse once and reuse during session.
  - Add `AbortController` support to `_fetchTransactionsFromServer` and store last controller to cancel stale requests.
  - Wrap full-history backfill call in `requestIdleCallback` (fallback to setTimeout) so initial paint isn't blocked.
- Add unit test or manual test instructions to measure parse time and UI responsiveness.

Phase 2 — IndexedDB scaffold + Worker (1–2 days)
- Add module `transactions/indexeddb.js` with a small promise-based wrapper around IndexedDB (open DB, create objectStores, helper CRUD batch operations).
- Add `transactions/worker/transactions-worker.js` implementing message-based API:
  - messages: `init`, `query-window`, `bulk-write`, `run-sync`, `migrate-localstorage`
  - worker writes batches into IndexedDB and posts progress messages
- Add a light main-thread adapter `transactions/worker-client.js` to start the worker, send messages, and provide Promise-based helpers to the rest of app.
- Update `transactions/api.js` to read from IndexedDB for UI windows (fall back to localStorage if DB not ready). Replace uses of `localStorage.getItem(TRANSACTION_CACHE_KEY)` with worker-client queries.
- Implement migration path: on first run, worker reads `pf_cached_transactions` from localStorage (if present), bulk-writes to IndexedDB, and then clears localStorage blob (optionally keep a short-lived flag until successful). Ensure this migration is idempotent and can be retried.

Phase 3 — Full migration & optimizations (1–2 days)
- Replace `_cacheTransactions` to write per-transaction or per-account entries into IndexedDB rather than a single blob.
- Implement query optimizations in worker: secondary indexes, time-range queries.
- Implement streaming reads from IndexedDB to renderer to enable virtualization and fast first-paint (fetch only N items needed for viewport).
- Add offline resilience and retry/backoff logic in worker for network failures.

Phase 4 — Rollout & Monitoring (half day)
- Deploy behind a feature flag or user opt-in first.
- Add telemetry hooks to record parse times, DB write durations, and page jank metrics.
- Provide a rollback path (restore localStorage blob if migration fails).

## Required changes to repository (rough)
- Add files
  - `transactions/indexeddb.js` (IndexedDB helper)
  - `transactions/worker/transactions-worker.js` (Web Worker)
  - `transactions/worker-client.js` (main-thread wrapper)
  - `docs/indexeddb-worker-migration-plan.md` (this doc)
- Modify
  - `transactions/api.js` (replace localStorage sync cache reads/writes; add AbortController; idle backfill; call worker-client)
  - `transactions/rendering.js` or wherever `renderTransactionTable()` is implemented to support async data source and virtualization
- Tests & docs
  - Add manual testing steps and measurements in `docs/`

## Risks & considerations
- Auth in Worker: Web Workers do not share DOM; if you want worker to fetch directly, you'll need to pass tokens to worker safely (postMessage) or proxy network calls through main thread.
- Browser support: IndexedDB and Web Workers are widely supported; still include feature detection and fallback to localStorage for older browsers.
- Storage quotas: IndexedDB typically has higher quotas than localStorage but verify for target platforms.
- Complexity: moving to IndexedDB + worker is a larger change; do incremental rollout and keep the localStorage approach as fallback.

## Quick indicators of success
- Main-thread `JSON.parse(localStorage.getItem('pf_cached_transactions'))` time reduces to near-zero after migration.
- Page load paint & first input delay (FID) measurably improved on devices previously impacted.
- Full-history backfill no longer impacts interactivity.

## Estimated effort
- Prototype (fast wins): 4–8 hours
- IndexedDB + Worker scaffold: 1–2 days
- Full migration and polish: additional 1–2 days

## Next steps (suggested)
1. Approve prototype work: I'll implement the in-memory parse caching, add `AbortController` to `_fetchTransactionsFromServer`, and run idle backfill changes in `transactions/api.js` (small PR). (I can implement this now.)
2. After prototype verifies gains, implement the IndexedDB scaffold + worker in Phase 2.

---

### Notes & links
- Use `idb` library (small wrapper) if you prefer less boilerplate: https://github.com/jakearchibald/idb
- Worker message pattern: keep messages small and use structured cloning; send progress events for large bulk writes.

Prepared by: GitHub Copilot — migration plan for `transactions` caching and sync.
