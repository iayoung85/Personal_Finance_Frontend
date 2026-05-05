# Backend Request: Modify Transaction With Splits (Unified)

**Date:** 2026-04-11  
**Requested by:** Frontend  
**Priority:** Required before unified modify modal can ship

---

## Context

The frontend is building a new unified "modify transaction" modal that handles both:
1. Right-click → "Modify" on **split parent rows** (parent fields + all split rows in one shot)
2. Manual transaction **create** and **edit** with an optional "Is split" section

Currently the only way to modify splits is:
- `DELETE /api/transactions/split/{parentId}` — wipe all splits
- `POST /api/transactions/split` — recreate them

And the only way to modify a manual txn's own fields is:
- `PUT /api/transactions/{id}` — no awareness of splits

There is **no single call** that lets the frontend modify the parent txn metadata (date, amount, description, merchant, category, memo) **and** update its split rows atomically. This request adds that capability.

---

## What the Frontend Will Send

### Endpoint

```
PUT /api/transactions/{transaction_id}
```

**This is an extension of the existing route.** No new URL needed.

### New Optional Field: `splits`

When the `splits` key is present in the request body, the backend must apply the split update atomically alongside any parent field changes. When `splits` is absent (or `null`), the route behaves exactly as it does today — no change to existing callers.

### Request Shape

```json
PUT /api/transactions/txn_abc123
{
  "amount": -65.00,
  "date": "2026-04-10",
  "description": "Target Run",
  "merchant_name": "Target",
  "user_category": null,
  "memo": "Weekly household",
  "splits": [
    {
      "amount": -40.00,
      "description": "Groceries items",
      "category": "Food: Groceries",
      "user_memo": "Food for the week"
    },
    {
      "amount": -25.00,
      "description": "Cleaning supplies",
      "category": "Home: Supplies",
      "user_memo": null
    }
  ]
}
```

#### `splits` array rules (same as existing `POST /api/transactions/split`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `amount` | number | yes | Must sum to the parent `amount`. Same sign-convention as existing split route. |
| `category` | string | yes | `"Primary: Detailed"` format |
| `description` | string | no | Inherits parent `description` if omitted/null |
| `user_memo` | string | no | |

#### Behavior when `splits` is present

1. Validate that `splits` has ≥ 2 entries
2. Validate that `sum(splits[].amount) == parent amount` (within ±0.01 float tolerance)
3. Apply all parent field edits **first** (same logic as today's PUT)
4. **Delete** all existing split children for this transaction (same as `DELETE /api/transactions/split/{id}`)
5. **Create** new split children from the provided array (same as `POST /api/transactions/split`)
6. Return the updated parent + new split children in the response

#### Behavior when `splits` is `null` or absent

No change to existing behavior. The route does not touch splits at all.

#### What about split children in the `splits` array with Plaid parent transactions?

When the parent is a **Plaid** transaction, the frontend will **only** send `splits` (to re-set the split rows). It will **not** send parent-level fields like `date`, `amount`, or `description` because those are locked on Plaid transactions. The backend should continue to reject parent-field edits on Plaid txns as it does today, while still accepting the `splits` replacement.

> **Note:** This edge case (Plaid parent + split-only PUT) may require the backend to relax the "must be manual source" guard to allow Plaid parents when the payload contains only `splits`. Frontend will not be sending conflicting fields together.

---

## What the Frontend Expects Back

The existing `PUT /api/transactions/{id}` response shape should be **extended** to include the updated split rows. All existing response fields remain unchanged.

### Extended Response Shape (`200`)

```json
{
  "message": "Transaction updated successfully",
  "transaction_id": "txn_abc123",
  "transaction": {
    "transaction_id": "txn_abc123",
    "is_split": true,
    "splits": [
      {
        "transaction_id": "txn_split_new_1",
        "amount": -40.00,
        "user_category": "Food: Groceries",
        "description": "Groceries items",
        "user_memo": "Food for the week"
      },
      {
        "transaction_id": "txn_split_new_2",
        "amount": -25.00,
        "user_category": "Home: Supplies",
        "description": "Cleaning supplies",
        "user_memo": null
      }
    ],
    "...all other existing transaction fields...": "..."
  },
  "affected_trending_transactions": [],
  "affected_balance_history": [],
  "affected_transfer_partner": null,
  "affected_mob": null
}
```

#### Key requirement: `transaction.splits` in the response

The `transaction` object in the response **must** include the `splits` array with full split child objects (as it already does in `GET /api/transactions`). This is critical so the frontend can do a **surgical Dexie upsert** of the parent row (which embeds the splits) without a full account re-fetch.

Currently, `PUT /api/transactions/{id}` returns `transaction` but it is **unclear whether `splits` is populated on that returned object**. If it isn't today, please include it going forward. The frontend upsert logic is:

```js
// After successful PUT, upsert parent (which now carries updated splits inline)
_replaceCachedTransaction(data.transaction.transaction_id, data.transaction);
// Re-render — no full refresh needed
```

---

## What Should NOT Change

- All existing callers of `PUT /api/transactions/{id}` that do **not** send `splits` continue working unmodified
- `POST /api/transactions/split` continues to exist and function — the existing split creation modal still uses it
- `DELETE /api/transactions/split/{id}` continues to exist — the existing split modal still uses it
- `GET /api/transactions/split/{id}` continues to exist — the existing split modal still fetches via it

---

## Error Cases Frontend Expects

| HTTP Status | Scenario | Error key |
|-------------|----------|-----------|
| `400` | `splits` has < 2 items | `"error"` |
| `400` | Split amounts don't sum to parent amount | `"error"` |
| `400` | A split entry is missing `amount` or `category` | `"error"` |
| `400` | (existing) Non-editable transaction type | `"error"` |
| `404` | Transaction not found | `"error"` |

Frontend will display the `error` string in the modal's inline error banner.

---

## Create Flow (`POST /api/transactions/manual`) — Future Phase

For the initial version, **create with splits is out of scope for this backend request**. The frontend will handle it as a two-step call:
1. `POST /api/transactions/manual` → get back the new `transaction_id`
2. `POST /api/transactions/split` → create splits on the new txn

If the backend team wants to support `POST /api/transactions/manual` with a `splits` field in a single call (same shape as above), that would be ideal for the future but is not required to unblock the frontend now.

---

## Summary of Backend Work Required

1. **Extend `PUT /api/transactions/{id}`** to accept an optional `splits` array
2. When `splits` is present: atomically apply parent edits → delete old splits → create new splits
3. **Ensure `transaction.splits` is populated in the `PUT` response** (may already be the case — please verify)
4. Consider relaxing the "manual source only" guard to allow Plaid parents when payload only contains `splits` and no locked parent fields
