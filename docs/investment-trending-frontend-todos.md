# Investment Trending Overhaul — Frontend To-Do List

Backend changes are complete. The following frontend work is needed to
fully support the new investment trending model.

---

## 1. Display `balance_at_date` on Trending Rows

**DONE**

The backend now returns `balance_at_date` (a float) on every
`investment_trending` transaction in the `/api/transactions` response.
This field is only present when the value is non-null (i.e., only on
trending rows).

**Where**: `transactions/row-renderers.js` (and any detail view)

**What to do**:
- Show `balance_at_date` as the primary value on investment trending rows
  (e.g., "Account Balance: $53,000.00" or similar prominent display)
- `amount` is still shown but is secondary — it represents the net
  growth/loss for that month
- Format: currency, 2 decimal places

---

## 2. Right-Click "Edit Account Balance" on Historical Trending Rows

**DONE**

New backend endpoint:
```
PATCH /api/transactions/<transaction_id>/investment-balance
Body: { "balance_at_date": 53000.00 }
```

**Rules for the UI**:
- **Historical trending rows (any account status)**: show "Edit Account
  Balance" in the context menu. Opens an input field for the dollar amount.
- **Current-month trending on LINKED accounts**: grayed out / disabled
  with tooltip "Locked to holdings value". The backend will reject the
  request with a 400 anyway.
- **Current-month trending on MANUAL/CONVERTED accounts**: editable
  (same as historical).

**Response handling**:
- On success, the response includes `updated_transaction` and optionally
  `next_month_transaction`. Update both in the local transaction list.
- If the response contains `{ deleted: true, rows_deleted: N }`, the
  trending row was auto-deleted (balance set to $0 on oldest row).
  Remove it from the UI.

---

## 3. Delete Historical Trending Rows

**DONE**

The state machine now allows `DELETE` on `SYSTEM_INVESTMENT_TRENDING`
rows. The existing delete flow should work — just ensure the context
menu shows "Delete" on trending rows. The backend handles the deletion
via the standard delete endpoint.

---

## 4. Export: Include `investment_trending` and `balance_at_date`

**DONE**

**File**: `transactions/export.js`

**Changes needed**:

1. **Do NOT filter out `investment_trending` rows** — they are currently
   not explicitly filtered (only OB/MOB/split are), but verify this.
   Trending rows should appear in both CSV and JSON exports.

2. **Add `balance_at_date` to CSV header** — after the existing backup
   columns, add `Balance At Date` as a new column.
   ```
   Date,Bank/Account,Description,Amount,...,User Description Override,Balance At Date
   ```

3. **Add `balance_at_date` to `_formatCsvRow()`** — read
   `txn.balance_at_date` and include it in the row. Empty string for
   non-trending rows.

4. **JSON export** — `balance_at_date` is already in the transaction
   object from the API, so JSON export should work automatically. Verify.

---

## 5. Import: Re-import `balance_at_date` from App Exports

**DONE** — Backend parsing and round-trip now fully implemented.

The backend now:
- Parses `Balance At Date` from PFC CSV exports
- Preserves `source=investment_trending` and `status=cleared` on re-import
- Writes `balance_at_date` to the Transaction model on creation
- Correctly bypasses category filtering for trending rows (they have no category)
- Post-import trending generation finds the re-imported rows and recalculates amounts from stored `balance_at_date`

Also fixed a pre-existing bug: the app re-import path was checking `row['source']` but the parser stored the key as `exported_source`. Source/status preservation now works for ALL re-imported transaction types, not just trending.

No frontend changes needed for this item — the export already includes `Balance At Date` in the CSV and the re-import round-trip is handled entirely by the backend parser/writer.

---

## 6. Import Report: Update Stats Display

**DONE**

The import report already shows `investment_trending_months` when
present. The response from `execute_import()` now includes expanded stats:

```json
{
  "investment_trending_months_adjusted": 0,
  "investment_trending_rows_created": 3,
  "investment_trending_rows_updated": 1
}
```

Update `transactions/import/report.js` to display all three values
when they are non-zero.

---

## 7. Account Detail / Investments Page

If the investments page or account detail view shows balance history
for investment accounts, it should now work from the trending rows
rather than OB-anchored balances. Verify that:

- The balance displayed matches what the ledger computes (starts from $0,
  no OB/MOB anchor)
- Trending rows are visible in the transaction timeline
- The investment account shows its `balance_at_date` values as the
  monthly balance checkpoints

---

## 8. Quicken Import: Investment Adjustment Autodetection

The backend now auto-detects Quicken "Adjustment" rows that look like
investment gains/losses and routes them to the trending engine instead
of creating regular manual transactions.

**How it works**:
- The analysis response flags categories with `is_investment_adjustment: true`
  when rows match the gain/loss keyword pattern
- In turbo mode, these categories are automatically set to
  `action: 'ignore'` with `route_to_investment_trending: true`
- In manual mapping mode, the frontend can show a toggle:
  "Route to investment trending" for categories flagged with
  `is_investment_adjustment`

**Frontend import wizard changes** (optional UX improvement):
- When `is_investment_adjustment` is true on a category in the analysis,
  show a note: "Detected as investment gain/loss — will be routed to
  trending system"
- Allow the user to override: toggle off `route_to_investment_trending`
  to import as a regular transaction instead
- The category mapping payload already supports `route_to_investment_trending`
  as a boolean field alongside the `action`

---

## Summary of New/Changed API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transactions/<id>/investment-balance` | `PATCH` | Edit `balance_at_date` on a trending row |
| `/api/transactions` (GET response) | — | Now includes `balance_at_date` field on trending rows |
| Delete on trending rows | `DELETE` | Now allowed via standard delete endpoint |

## Summary of Backend Behavioral Changes

- **No OB/MOB** for investment accounts (any connection status)
- **Trending rows auto-generated** on import and manual txn creation
- **`balance_at_date`** is the invariant; `amount` is derived
- **All investment accounts** participate in trending (not just linked)
- **Current month locked** on linked accounts (holdings value)
- **Non-cascading edits**: editing `balance_at_date` only recalculates
  month M and M+1
