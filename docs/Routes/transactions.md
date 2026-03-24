# Transactions Page — API Routes

> **Page:** Transaction viewing, manual entry, splits, transfers, import, and resolution
> **Blueprint:** `transactions` (`/api/transactions`)

---

## Core Transaction Endpoints

### `GET /api/transactions`

Fetch all transactions for the current user. Supports ETag caching.

**Request Headers:**

| Header | Required | Notes |
|--------|----------|-------|
| `If-None-Match` | no | ETag from previous response — returns 304 if unchanged |

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `since_date` | string (date) | — | Only return transactions on or after this date |

**Response `200`:**
```json
{
  "transactions": [ ...array of transaction objects... ]
}
```

**Response `304`:** No body (data unchanged since ETag).

**Response Headers:**
- `ETag: "<hash>"` — cache token for `If-None-Match`.

### Transaction Object Shape

Each transaction in the array:

```json
{
  "transaction_id": "txn_abc123",
  "source": "plaid",
  "status": "cleared",
  "account_id": "acc_xyz",
  "date": "2026-02-17",
  "amount": -42.50,
  "description": "Starbucks",
  "merchant_name": "STARBUCKS INC",
  "user_category": "Food: Dining",
  "category_computed_at": "2026-02-17T10:30:00",
  "user_memo": "Meeting with Sarah",
  "user_description_override": null,
  "pending": false,
  "is_override": true,
  "is_transfer": true,
  "transfer_pair_id": "xfer_123",
  "transfer_partner_account_id": "acc_456",
  "transfer_partner_account_name": "Bank B Savings",
  "transfer_partner_date": "2026-02-17",
  "is_hidden": false,
  "bill_id": "bill_xyz",
  "bill_occurrence_number": 3,
  "is_bill": true,
  "occurrence_number": 3,
  "schedule_summary": "Monthly, on the 15th",
  "amount_variable": false,
  "plaid_transaction_id": "plaid_txn_456",
  "bank_account": "Chase - Checking (1234)",
  "is_split": true,
  "splits": [
    {
      "transaction_id": "txn_split_1",
      "amount": -20.00,
      "user_category": "Food: Dining",
      "user_memo": "My share",
      "description": "Starbucks - Split 1"
    }
  ],
  "match_info": {
    "matched_txn_id": "txn_manual_789",
    "matched_name": "Starbucks coffee run",
    "matched_description": "Starbucks coffee run",
    "matched_source": "manual",
    "matched_bill_id": "bill_xyz",
    "matched_occurrence_number": 3
  },
  "hidden_by_match": false
}
```

**Field Reference:**

| Field | Type | Notes |
|-------|------|-------|
| `transaction_id` | string | `"txn_{uuid}"` — stable business key |
| `source` | string | `plaid`, `manual`, `scheduled`, `split`, `opening_balance`, `manual_opening_balance`, `investment_trending` |
| `status` | string | `cleared`, `pending`, `future`, `missing`, `orphaned`, `matched`, `converted` |
| `account_id` | string | Parent account |
| `date` | string (date) | Transaction date (YYYY-MM-DD) |
| `amount` | number | Negative = outflow, positive = inflow |
| `description` | string | Display name (from Plaid or user) |
| `merchant_name` | string \| null | Plaid's merchant name |
| `user_category` | string \| null | Final resolved category (format: `"Primary: Detailed"` or `"[<Account>]"` for transfers) |
| `category_computed_at` | string (datetime) | When category was last resolved |
| `user_memo` | string \| null | User annotation |
| `user_description_override` | string \| null | Friendly name override for Plaid descriptions |
| `pending` | boolean | Whether transaction is pending bank posting |
| `is_override` | boolean | Whether category was manually overridden |
| `is_transfer` | boolean | Part of a transfer pair |
| `transfer_pair_id` | string \| null | Shared UUID linking both sides of transfer |
| `transfer_partner_account_id` | string \| null | Other account in transfer pair |
| `transfer_partner_account_name` | string \| null | Display name of partner account |
| `transfer_partner_date` | string (date) \| null | Date from partner transaction |
| `is_hidden` | boolean | User-toggled visibility (plaid only) |
| `bill_id` | string \| null | Originating bill (if from bill recurrence) |
| `bill_occurrence_number` | integer \| null | Occurrence slot in bill recurrence |
| `is_bill` | boolean | Has bill metadata |
| `occurrence_number` | integer \| null | Alias for `bill_occurrence_number` |
| `schedule_summary` | string \| null | Human-readable recurrence description |
| `amount_variable` | boolean | Bill matching ignores amount when true |
| `plaid_transaction_id` | string \| null | Plaid's transaction ID (source=plaid only) |
| `bank_account` | string | Computed display: `"Bank - Account (mask)"` |
| `is_split` | boolean | Has split children |
| `splits` | array \| null | Child split transactions (when `is_split=true`) |
| `match_info` | object \| null | Details about matched manual/scheduled row |
| `hidden_by_match` | boolean | Frontend should hide matched manual/scheduled rows |

---

### `GET /api/transactions/raw/<transaction_id>`

Get raw Plaid data for a transaction (debugging/power user).

**Response `200`:**
```json
{
  "plaid_blob": { ...full Plaid API response... },
  "app_blob": { ...application-level encrypted fields... }
}
```

---

## Transaction Sync

### `POST /api/transactions/sync_transactions`

Trigger a Plaid transaction sync for one or all items.

**Request:**
```json
{
  "plaid_item_id": "item_abc123",
  "sync_all": false,
  "activate": false,
  "force": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `plaid_item_id` | string | no | Sync a specific item (omit for all) |
| `sync_all` | boolean | no | Sync all items |
| `activate` | boolean | no | Activate transactions product first |
| `force` | boolean | no | Force sync even if recently synced |

**Response `200`:**
```json
{
  "added_count": 15,
  "modified_count": 2,
  "removed_count": 0,
  "page_count": 1,
  "items_synced": 1,
  "errors": [],
  "matching": { "proposed": 3, "auto_approved": 1 },
  "last_sync": "2026-03-15T14:30:00"
}
```

**Errors:**
- `402` — Transactions product not billed for this item.

---

## Viewer Settings

### `GET /api/transactions/transaction_viewer_settings`

Fetch the user's saved transaction viewer preferences.

**Response `200`:**
```json
{
  "optional_fields": ["merchant_name", "authorized_datetime", "memo"],
  "field_order": ["date", "description", "amount", "category", "merchant_name"],
  "timezone": "America/Chicago",
  "hide_transfers": true,
  "show_overrides_only": false,
  "show_pending": false,
  "bills_future_days": 90
}
```

### `POST /api/transactions/transaction_viewer_settings`

Save viewer preferences. Partial update — only include fields to change.

**Request:**
```json
{
  "optional_fields": ["merchant_name", "memo"],
  "field_order": ["date", "description", "amount", "category"],
  "timezone": "America/New_York",
  "hide_transfers": false,
  "show_overrides_only": false,
  "show_pending": true,
  "bills_future_days": 60
}
```

| Field | Type | Notes |
|-------|------|-------|
| `optional_fields` | string[] | Which extra cols to show. Values: `"merchant_name"`, `"authorized_datetime"`, `"memo"`, `"plaid_category"`, `"show_pending"` |
| `field_order` | string[] | Column display order |
| `timezone` | string | IANA timezone (e.g., `"America/Chicago"`) |
| `hide_transfers` | boolean | Hide transfer pairs from main table |
| `show_overrides_only` | boolean | Show only manually categorized transactions |
| `show_pending` | boolean | Include pending Plaid transactions |
| `bills_future_days` | integer | Forecast horizon for bill projections (1–365, default 90) |

**Response `200`:**
```json
{
  "message": "Settings saved"
}
```

---

## Manual Transaction CRUD

### `POST /api/transactions/manual`

Create a manual transaction.

**Request:**
```json
{
  "amount": -45.00,
  "date": "2026-03-15",
  "description": "Grocery run",
  "account_id": "acc_f899f70a1e73",
  "merchant_name": "Whole Foods",
  "user_category": "Food: Groceries",
  "memo": "Weekly groceries",
  "pending": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `amount` | number | yes | Negative = outflow, positive = inflow |
| `date` | string (date) | yes | YYYY-MM-DD. Future dates create `MANUAL_FUTURE` type |
| `description` | string | yes | Transaction name |
| `account_id` | string | yes | Target account |
| `merchant_name` | string | no | |
| `user_category` | string | no | Format: `"Primary: Detailed"` or `"[<Account Name>]"` for transfers |
| `memo` | string | no | |
| `pending` | boolean | no | |

**Response `201`:**
```json
{
  "message": "Transaction created",
  "transaction_id": "txn_abc123",
  "transaction": { ...full transaction object... }
}
```

**Important:** If `date` is in the future, the transaction gets `source=manual, status=future` (MANUAL_FUTURE). When the date arrives, it matures to MANUAL_CLEARED (or MANUAL_MISSING if in a linked account).

**Transfer creation:** Setting `user_category` to `"[<Savings Account>]"` triggers the transfer flow. The server attempts to find a matching transaction in the target account. If none found, a counterpart transaction is auto-created.

---

### `PUT /api/transactions/manual/<transaction_id>`

Update a manual transaction (partial update).

**Request:**
```json
{
  "amount": -50.00,
  "date": "2026-03-16",
  "description": "Updated description"
}
```

Only manual-source, editable transactions can be modified. The server handles state transitions (e.g., moving date to future changes status).

**Response `200`:**
```json
{
  "message": "Transaction updated",
  "transaction_id": "txn_abc123",
  "transaction": { ...updated transaction object... }
}
```

**Errors:** `404` — Not found. `400` — Not a manual transaction.

---

### `DELETE /api/transactions/manual/<transaction_id>`

Delete a manual transaction.

**Response `200`:**
```json
{
  "message": "Transaction deleted"
}
```

**Errors:** `404` — Not found. `400` — Not a deletable transaction type.

---

## Description Override

### `PUT /api/transactions/<transaction_id>/description`

Set a user-friendly description override for any transaction (including Plaid transactions where the original description is cryptic).

**Request:**
```json
{
  "description": "Coffee with Sarah"
}
```

**Response `200`:**
```json
{
  "message": "Description updated",
  "transaction_id": "txn_abc123",
  "user_description_override": "Coffee with Sarah"
}
```

The original Plaid description is preserved in the encrypted blob. The override is displayed in the UI.

---

## Hide / Unhide

### `PUT /api/transactions/<transaction_id>/hide`

Toggle visibility of a transaction. Hidden transactions are excluded from balance calculations and ledger.

**Request:**
```json
{
  "hide": true
}
```

**Response `200`:**
```json
{
  "message": "Transaction hidden",
  "transaction_id": "txn_abc123",
  "is_hidden": true
}
```

### `POST /api/transactions/batch-unhide`

Unhide multiple transactions at once.

**Request:**
```json
{
  "transaction_ids": ["txn_abc123", "txn_def456"]
}
```

**Response `200`:**
```json
{
  "message": "Transactions unhidden",
  "unhidden_count": 2,
  "skipped_ids": []
}
```

---

## Memo

### `POST /api/transactions/add-memo`

Add or update a memo on any transaction.

**Request:**
```json
{
  "transaction_id": "txn_abc123",
  "user_memo": "Meeting with Sarah"
}
```

**Response `200`:**
```json
{
  "message": "Memo saved"
}
```

---

## Bulk Operations

### `POST /api/transactions/bulk-update`

Update category and/or memo on multiple transactions at once.

**Request:**
```json
{
  "updates": [
    {
      "transaction_id": "txn_abc123",
      "user_category": "Food: Dining"
    },
    {
      "transaction_id": "txn_def456",
      "user_memo": "Updated memo"
    }
  ]
}
```

**Response `200`:**
```json
{
  "updated_count": 2,
  "failures": []
}
```

---

## Splits

### `POST /api/transactions/split`

Split a transaction into sub-allocations. The split amounts must sum to the parent amount.

**Request:**
```json
{
  "transaction_id": "txn_abc123",
  "splits": [
    {
      "amount": -20.00,
      "category": "Food: Dining",
      "user_memo": "My share"
    },
    {
      "amount": -22.50,
      "category": "Gifts: Personal",
      "user_memo": "Friend's share"
    }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `transaction_id` | string | yes | Parent transaction to split |
| `splits` | array | yes | 2+ split items |
| `splits[].amount` | number | yes | Must sum to parent amount |
| `splits[].category` | string | yes | Category for this split |
| `splits[].user_memo` | string | no | |

**Response `201`:**
```json
{
  "message": "Transaction split",
  "original_transaction_id": "txn_abc123",
  "splits": [
    {
      "transaction_id": "txn_split_1",
      "amount": -20.00,
      "user_category": "Food: Dining"
    },
    {
      "transaction_id": "txn_split_2",
      "amount": -22.50,
      "user_category": "Gifts: Personal"
    }
  ]
}
```

### `GET /api/transactions/split/<parent_transaction_id>`

Get all splits for a parent transaction.

**Response `200`:**
```json
{
  "parent_transaction_id": "txn_abc123",
  "splits": [ ...split transaction objects... ]
}
```

### `DELETE /api/transactions/split/<parent_transaction_id>`

Remove all splits and restore the parent transaction to its unsplit state.

**Response `200`:**
```json
{
  "message": "Splits removed",
  "original_transaction_id": "txn_abc123"
}
```

---

## Transfers

### `POST /api/transactions/transfers/detect`

Auto-detect potential transfer pairs across accounts. Uses matching rules: equal/opposite amounts within ±3 days, different accounts, excluding nonsensical categories.

**Request:**
```json
{
  "transaction_ids": ["txn_abc123", "txn_def456"]
}
```

Omit `transaction_ids` to scan all unlinked transactions.

**Response `200`:**
```json
{
  "auto_linked": 3,
  "low_confidence": 2,
  "low_confidence_pairs": [
    {
      "transaction_a": { ...transaction object... },
      "transaction_b": { ...transaction object... },
      "confidence": 0.72
    }
  ],
  "skipped": 5
}
```

### `POST /api/transactions/transfers/link`

Manually link two transactions as a transfer pair.

**Request:**
```json
{
  "transaction_id_a": "txn_abc123",
  "transaction_id_b": "txn_def456"
}
```

**Response `201`:**
```json
{
  "transfer_pair_id": "xfer_abc123",
  "transaction_id_a": "txn_abc123",
  "transaction_id_b": "txn_def456",
  "account_name_a": "Chase Checking (1234)",
  "account_name_b": "Savings (5678)"
}
```

### `POST /api/transactions/transfers/unlink`

Break a transfer pair. Categories revert to appropriate defaults.

**Request:**
```json
{
  "transaction_id": "txn_abc123"
}
```

**Response `200`:**
```json
{
  "unlinked_transaction_ids": ["txn_abc123", "txn_def456"],
  "transfer_pair_id": "xfer_abc123"
}
```

**Post-unlink behavior:**
- Plaid transactions revert to their original Plaid-assigned category.
- Manual transactions get assigned `"Transfer Out: Account Transfer"` or `"Transfer In: Account Transfer"`.
- The partner account name is prepended to the memo: `"(Partner Account Name) original_memo"`.

### `POST /api/transactions/transfers/create`

Create a transfer by generating a counterpart transaction in another account.

**Request:**
```json
{
  "transaction_id": "txn_abc123",
  "target_account_id": "acc_savings"
}
```

**Response `201`:**
```json
{
  "transfer_pair_id": "xfer_abc123",
  "source_transaction_id": "txn_abc123",
  "counterpart_transaction_id": "txn_generated_456"
}
```

### `GET /api/transactions/transfers/candidates/<transaction_id>`

Find potential transfer match candidates in a specific account.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `target_account_id` | string | yes | Account to search for candidates |

**Response `200`:**
```json
{
  "candidates": [
    {
      "transaction_id": "txn_def456",
      "amount": 42.50,
      "date": "2026-02-17",
      "description": "Transfer from Checking"
    }
  ]
}
```

---

## Scheduled Transaction Matching

### `POST /api/transactions/match_scheduled`

Run the matching engine to pair scheduled/manual-future transactions with incoming Plaid transactions.

**Request:**
```json
{
  "account_ids": ["acc_f899f70a1e73"]
}
```

Omit `account_ids` to match across all linked accounts.

**Response `200`:** Matching result with counts of proposed and auto-approved matches.

### `POST /api/transactions/approve_match/<transaction_id>`

Approve a proposed match between a scheduled/manual transaction and a Plaid transaction.

**Response `200`:** Match approval details.

### `POST /api/transactions/approve_all_matches`

Approve all pending proposed matches at once.

**Response `200`:**
```json
{
  "approved_count": 5
}
```

### `POST /api/transactions/unmatch/<transaction_id>`

Reject/undo a proposed or approved match.

**Response `200`:** Unmatch result details.

---

## Missing Transaction Resolution

### `DELETE /api/transactions/resolve_missing/<transaction_id>`

Delete a missing transaction (acknowledge it will never clear).

**Response `200`:**
```json
{
  "message": "Missing transaction resolved"
}
```

### `POST /api/transactions/resolve_missing/<transaction_id>`

Keep a missing transaction (do not delete it).

**Request:**
```json
{
  "action": "keep"
}
```

**Response `200`:** Resolution details.

---

## Resolution Center (Post-Relink)

### `GET /api/transactions/resolution/status`

Check for pending reconciliation items (orphaned transactions, match proposals).

**Response `200`:**
```json
{
  "pending_proposals_count": 3,
  "orphaned_count": 7,
  "batch_id_list": ["batch_abc123"]
}
```

### `GET /api/transactions/resolution/proposals`

Get all match proposals and orphaned transactions for review.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `batch_id` | string | no | Filter to a specific relink batch |

**Response `200`:**
```json
{
  "proposals": [
    {
      "manual_transaction": { ...transaction object... },
      "plaid_transaction": { ...transaction object... },
      "confidence": 0.95,
      "match_reason": "exact_amount_close_date"
    }
  ],
  "orphaned_transactions": [
    { ...transaction objects with status='orphaned'... }
  ]
}
```

### `POST /api/transactions/resolution/resolve`

Bulk-resolve proposals and orphaned transactions.

**Request:**
```json
{
  "approve": ["txn_abc123", "txn_def456"],
  "reject": ["txn_ghi789"],
  "delete_orphaned": ["txn_orphan1", "txn_orphan2"]
}
```

**Response `200`:** Resolution result with counts.

### `POST /api/transactions/resolution/match`

Manually match a manual transaction to a Plaid transaction.

**Request:**
```json
{
  "manual_transaction_id": "txn_manual_abc",
  "plaid_transaction_id": "txn_plaid_xyz"
}
```

### `POST /api/transactions/resolution/force_match`

Force-match an orphaned transaction to a specific Plaid transaction (overrides confidence checks).

**Request:**
```json
{
  "orphan_transaction_id": "txn_orphan_abc",
  "target_plaid_transaction_id": "txn_plaid_xyz"
}
```

### `POST /api/transactions/resolution/relocate`

Move an orphaned transaction to a different account (instead of deleting it).

**Request:**
```json
{
  "orphan_transaction_id": "txn_orphan_abc",
  "target_account_id": "manual_acc_xyz"
}
```

---

## Transaction Import

### `POST /api/transactions/import/analyze`

Upload a CSV/OFX file for analysis before importing. Returns field mapping suggestions and parsed data preview.

**Request:** `multipart/form-data`
- File field: the CSV/OFX file

**Response `200`:**
```json
{
  "format": "csv",
  "accounts": ["Chase Checking", "Savings"],
  "categories": ["Food", "Transportation"],
  "field_mapping": {
    "date": "Date",
    "amount": "Amount",
    "description": "Description"
  },
  "turbo_mappings": { ...pre-configured mappings for known formats... },
  "parsed_rows": [ ...first N rows of parsed data... ]
}
```

### `POST /api/transactions/import/execute`

Execute the import with user-confirmed mappings.

**Request:** `multipart/form-data`
- File field: the CSV/OFX file
- `mappings`: JSON string of field mappings and account assignments

**Response `200`:**
```json
{
  "created_transactions": 150,
  "created_accounts": 2,
  "created_categories": 5
}
```

### `POST /api/transactions/import/turbo-execute`

Import using pre-configured mappings (for known export formats like Quicken).

**Request:** `multipart/form-data`
- File field: the CSV/OFX file

**Response `200`:** Same shape as `/import/execute`.

---

## Migration Notes for React + IndexedDB

### IndexedDB Schema for Transactions
```
Object Store: transactions
  keyPath: "transaction_id"
  Indexes:
    - account_id
    - date
    - source
    - status
    - user_category
    - transfer_pair_id
    - bill_id
    - is_hidden
  Compound Indexes:
    - [account_id, date] — for account-filtered date-range queries
    - [source, status] — for type filtering
```

### ETag-Based Sync Strategy
1. On first load: `GET /api/transactions` → store all in IndexedDB, save ETag.
2. On subsequent loads: Send `If-None-Match` header. If `304`, use IndexedDB cache.
3. On sync/mutation: After any write operation, refetch with ETag. Replace stale entries in IndexedDB.
4. Consider `since_date` for incremental sync when dealing with large datasets.

### Ledger Balance Computation
The running ledger balance is computed client-side. For a selected account:
1. Start from the account's `opening_balance`.
2. Walk transactions chronologically, adding each `amount`.
3. Skip hidden transactions (`is_hidden=true`).
4. Skip missing transactions (`status=missing`) — display `N/A` for their ledger cell.
5. For the "All Accounts" view, omit the ledger column entirely.

### Transaction Type Rendering Rules
Use `source` + `status` to determine:
- Which columns are editable (only manual-source for date/amount)
- Which context menu actions are available
- Visual treatment (opacity for missing/future, badges for pending/bill)
- Whether the row participates in ledger balance

### Split Management in React
Parent transactions with `is_split=true` contain their children inline in `splits[]`. Render children as expandable sub-rows. When user modifies a split, update the parent's `splits` locally and send `DELETE` + `POST` split requests.

### Transfer Display
When `is_transfer=true`:
- Show `⇄ Transfer` badge in category column
- Show partner account name
- Format date as `"older_date → newer_date"` when dates differ
- If `hide_transfers` setting is on, filter these out
