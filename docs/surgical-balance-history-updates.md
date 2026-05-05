# Surgical Balance History Updates — Frontend Plan

**Date:** 2026-04-10  
**Context:** The backend now returns `affected_balance_history` in all transaction mutation responses. The frontend should use this to **patch** its `balanceHistoryLookup` cache instead of clearing and refetching the full 10K-row ledger.

---

## What Changed (Backend)

All of the following endpoints now include an optional `affected_balance_history` array in their response:

| Endpoint | Method |
|---|---|
| `/api/transactions/manual` | POST (create) |
| `/api/transactions/<id>` | PUT (update & bill-missing reschedule) |
| `/api/transactions/manual/<id>` | DELETE |
| `/api/transactions/resolve_missing/<id>` | DELETE |
| `/api/transactions/resolve_missing/<id>` | POST (keep) |

### Response shape

```json
{
  "affected_balance_history": [
    {
      "transaction_id": "txn_abc123",
      "running_balance": "5432.10",
      "transaction_amount": "-45.23",
      "transaction_date": "2026-03-15"
    }
  ]
}
```

- Contains all ledger rows from the affected date forward (the date of the mutation, or `min(old_date, new_date)` for date edits).
- **MOB extension:** if the mutation affects a transaction that falls before the Opening Balance (OB) anchor, the returned rows extend back to the Minimum Opening Balance (MOB) date — the earliest ledger row — rather than starting only at the affected date. This ensures pre-OB running balances are included in the patch set. The frontend doesn't need to special-case this — the patch function iterates all returned rows by `transaction_id` regardless of how far back they go.
- Only present for accounts that have a balance ledger (offline/manual accounts and investment accounts).
- Absent (not in the response at all) when no ledger rows were affected.

---

## Frontend Changes Needed

### 1. Replace `_clearBalanceHistoryCache()` with surgical patch **DONE**

In `transactions/api.js` (or wherever mutation response handlers live), after a successful mutation:

**Instead of:**
```javascript
_clearBalanceHistoryCache();
```

**Do:**
```javascript
if (responseData.affected_balance_history) {
  _patchBalanceHistoryCache(accountId, responseData.affected_balance_history);
} else {
  // No balance history in response — clear cache to force refetch on next render
  _clearBalanceHistoryCache();
}
```

### 2. New function: `_patchBalanceHistoryCache(accountId, affectedRows)` **DONE**

```javascript
function _patchBalanceHistoryCache(accountId, affectedRows) {
  // Patch the in-memory lookup
  affectedRows.forEach(row => {
    if (row.transaction_id) {
      balanceHistoryLookup[row.transaction_id] = parseFloat(row.running_balance);
    }
  });

  // Patch the localStorage cache too so it survives page reload
  const cacheByAccountId = _loadBalanceHistoryCache();
  const cacheEntry = cacheByAccountId[accountId];
  if (cacheEntry && cacheEntry.lookup) {
    affectedRows.forEach(row => {
      if (row.transaction_id) {
        cacheEntry.lookup[row.transaction_id] = parseFloat(row.running_balance);
      }
    });
    // Update the signature + timestamp so the cache doesn't immediately
    // expire and trigger a full refetch
    cacheEntry.cached_at = Date.now();
    cacheEntry.signature = _buildBalanceHistorySignature(accountId);
    _saveBalanceHistoryCache(cacheByAccountId);
  }
}
```

### 3. Handle deleted transactions **DONE**

For DELETE operations, the deleted transaction's ledger row is already gone from `affected_balance_history`. The frontend should also remove the deleted txn from the lookup:

```javascript
// After DELETE /api/transactions/manual/<id>:
delete balanceHistoryLookup[deletedTransactionId];

// Then patch remaining affected rows:
if (responseData.affected_balance_history) {
  _patchBalanceHistoryCache(accountId, responseData.affected_balance_history);
}

// Also remove from localStorage cache
const cacheByAccountId = _loadBalanceHistoryCache();
const cacheEntry = cacheByAccountId[accountId];
if (cacheEntry && cacheEntry.lookup) {
  delete cacheEntry.lookup[deletedTransactionId];
  _saveBalanceHistoryCache(cacheByAccountId);
}
```

### 4. Affected files **DONE**

| File | What to change |
|---|---|
| `transactions/manual-transactions.js` | `saveManualTransaction()`, `_updateManualTransaction()`, `deleteManualTransaction()` — use patching instead of full cache clear |
| `transactions/resolution.js` | `resolveMissingTransaction()` — use patching instead of full cache clear |
| `transactions/api.js` | Add `_patchBalanceHistoryCache()` function and export it |

### 5. Edge case: signature mismatch **DONE**

After patching, the localStorage cache signature should be updated to match the current state. This prevents the next `fetchBalanceHistory()` call from thinking the cache is stale and doing a full refetch. The `_patchBalanceHistoryCache` function above handles this by updating both `cached_at` and `signature`.

---

## Testing

- Create a manual transaction on an offline account → verify ledger column updates immediately without a network call to balance-history
- Edit a manual transaction amount → verify the running balance in the ledger column updates for all rows from the edit date forward
- Delete a manual transaction → verify the deleted row disappears from the ledger column and subsequent rows recalculate
- Mark paid on a BILL_MISSING in an offline account → verify ledger updates
- Delete a BILL_MISSING → verify ledger updates
- Edit or delete a pre-OB transaction → verify that `affected_balance_history` includes rows back to the MOB date (earliest ledger row), and that the patch updates those early rows correctly
- Verify that the 5-minute cache TTL still works (cache doesn't expire immediately after a patch)
