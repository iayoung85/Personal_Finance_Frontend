# Backend Request: Import Parser — `balance_at_date` Support

**From:** Frontend team
**Date:** 2026-03-27
**Priority:** Medium
**Related:** Investment Trending Overhaul (frontend todos complete)

---

## Context

The frontend CSV export now includes a `Balance At Date` column as
the last backup/restore column. This column is populated on
`investment_trending` rows with the `balance_at_date` value and left
empty for all other transaction types.

## What the frontend already does

- **Export:** `Balance At Date` is appended after `User Description Override`
  in the CSV header. The value is written via `_formatCsvRow()` for every
  row (empty string for non-trending rows).
- **JSON export:** `balance_at_date` is included automatically since it's
  already on the transaction object from the API response.

## What the backend needs to do

1. **CSV parser:** Recognize the `Balance At Date` column (position after
   `User Description Override`, or by header name) during re-import analysis.
   Map it to `balance_at_date` on the parsed transaction dict.

2. **Import writer:** When the parsed source is `investment_trending` and
   `balance_at_date` is present, set `balance_at_date` on the created
   transaction record. This ensures round-trip fidelity: export → re-import
   preserves the account balance checkpoints.

3. **JSON re-import:** Should already work since `balance_at_date` is on the
   transaction object — verify that the JSON import path passes it through
   to the writer.

## CSV column position

```
Date,Bank/Account,Description,Amount,Account ID,Transaction ID,Source,Status,User Category,Memo,Parent Transaction ID,Transfer Pair ID,User Description Override,Balance At Date,...optional columns
```

Column index for `Balance At Date`: **13** (0-based), immediately after
`User Description Override` (index 12).

## Acceptance criteria

- Re-importing a PFC CSV export that contains `Balance At Date` should
  restore `balance_at_date` on the created trending rows.
- Non-trending rows with an empty `Balance At Date` cell should not be
  affected.
- JSON re-import should preserve `balance_at_date` values.
