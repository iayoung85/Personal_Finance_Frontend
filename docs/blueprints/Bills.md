# Purpose
high level:
bills.html will be a webpage where a user can view, manage (CRUD) a list of recurring bills that they know about.

## Creation frequency form modal:
split horizontally into top and bottom halves
top halve is for frequency, bottom half is transaction details
**top half**
two columns: 
    -left column user enters frequency settings described below
    - right column transaction details fillable form
**frequency settings left column**
user will be first be presented to set custom intervals
frequency dropdown list items (once, daily, weekly, monthly, twice a month, yearly, twice a year)
after selecting option on frequency dropdown, user will be presented with customization of frequency form

when daily selected, 
    - every x days with 1 as the preset
        means user could have a bill occur once every 6 days or once every 5 days any number up to 99 days
    - dropdown selection choose never, end date, or after x occurences 
        - if end date selected, date input shows up, if x occurences selected, user enters integer in box
when weekly selected,
    similar to daily but for weeks as the unit instead of days (both interval and end date selection)
    - start date: additional option for user to select day of week for start date which updates live when user changes start date
        -day of week indicator displays as 7 button s {m},{t},{w},{t},{f},{s},{s}
            - clicking day of week button live updates the date fill form for nearest start date to which satisfies the day of week selected and could be forward or backward. IE user selects Friday and date form was on Thurs, Feb 26th, 2026
when monthly selected, below user sees followign in form:
    -user picks starting month/year in date fill form
    -"on the {xth} {day} of month": 
        where {xth} located, there is a drop down menu  lets user pick a number between "1st" and "31st" or "last"
        if user picks "last" from this dropdown menu, {day} changes to a dropdown for user to pick day of week.. IE they want to have a bill repeat on the last monday of every...
    - every: {x} month(s):
        x can be any number between 99 but prepopulates with 1.. 
    - end date selection similar to daily
when "twice a month selected" 
    - on the {x} and {y} days
        x can be any number between 1st and 31st
        y can be any number between 1st and 31st
    - starting: user selects month and year
    - every: {x} month(s):
        x can be any number between 99 but prepopulates with 1.. 
    - ending setting similar to others
when yearly is selected
    - user choose start date year/month/day
    - every {x} year(s)
        x can be any number between 99 but prepopulates with 1.. 
    - ending selection similar to others abo e
when twice a year is selected
    - user selects two dates: first payment of year (defaults to today) and 2nd payment of year (defaults to 6 months after today)
    - every: {x} year(s)
        x can be any number between 99 but prepopulates with 1.. 
    ending selection similar to others.
**Bill Creation Right half** 
form fillable information
account selection as dropdown (bank - account (mask)) (example <`account_xyz`> selected)
Description
default amount (same debit/credit functionality as in manual transaction creation of transactions.html)
category
    same category entry as in manual transaction creation of transactions.html 
    transfers: same [<account_abc>] format where account_abc will be the destination or source of funds to/from account_xyz and depends on whether it is input as a debit or credit in the amount form
memo

**bottom half**
automatically generated description of exactly what frequency the bill will repeat and a listing of the next 10 payment dates as well as exactly what will happen, payment that will be made, description, if transfer, tells user money will be moved from account x to account y

## List of bills created displayed here as a table.
table with columns: Next pmt date, moneyin/out, amount, account, category, destination account (blank unless transfer), update/delete
rows sorted by next payment date with the nearest date at top and furthest out date at bottom.
---

# Implementation Plan

> **Scope:** Core CRUD for recurring bills, occurrence projection (including skip), and integration surface with transactions.  
> **Out of scope (for now):** Recurring transaction auto-detection (`bills_detection.py`), transaction-to-bill matching.

## 1. Schema — `bills_models.py`

### `Bill` table

Stores one row per user-defined recurring bill. The recurrence rule is encoded inline (no RRULE library needed — the frontend already does all the heavy lifting for presentation and the backend only needs to project dates).

```
bills
├── IDENTITY
│   ├── id                  Integer, PK, auto-increment
│   ├── bill_id             String(255), unique, not-null, index  — "bill_{uuid}"
│   └── user_id             String(255), FK users.user_id CASCADE, not-null
│
├── ACCOUNT BINDING
│   ├── account_id          String(255), FK accounts.account_id CASCADE, not-null
│   │                       — which account the payment occurs in
│   └── transfer_account_id String(255), FK accounts.account_id SET NULL, nullable
│                           — destination/source when bill is a transfer (mirrors
│                             the [<account_name>] category convention in transactions)
│
├── TRANSACTION TEMPLATE
│   ├── description         String(500), not-null — e.g. "Rent", "Netflix"
│   ├── amount              Numeric(15,2), not-null — ledger convention:
│   │                         positive = money in, negative = money out
│   ├── user_category       Text, nullable — "Primary: Detailed" format,
│   │                         or "[<account_name>]" for transfers
│   └── memo                Text, nullable — encrypted via encrypt_data()
│
├── RECURRENCE RULE
│   ├── frequency           String(20), not-null
│   │                       — enum: 'once','daily','weekly','monthly',
│   │                         'twice_monthly','yearly','twice_yearly'
│   ├── interval            Integer, not-null, default 1
│   │                       — "every {interval} {frequency unit}(s)"
│   │                         for 'once' always 1; for 'twice_monthly'/'twice_yearly'
│   │                         still applies as the outer cycle interval
│   ├── start_date          Date, not-null — first occurrence
│   ├── second_date         Date, nullable
│   │                       — only used when frequency in ('twice_monthly','twice_yearly'):
│   │                         stores the 2nd occurrence date within the cycle
│   │                         for twice_monthly: the 2nd day-of-month anchor
│   │                         for twice_yearly: the 2nd payment date in the year
│   ├── day_of_month        Integer, nullable
│   │                       — 1–31 or -1 for "last day"; used by monthly/twice_monthly
│   ├── second_day_of_month Integer, nullable
│   │                       — 2nd anchor for twice_monthly only
│   ├── day_of_week         Integer, nullable
│   │                       — 0=Mon..6=Sun; used by weekly and monthly-last-weekday
│   ├── end_type            String(20), not-null, default 'never'
│   │                       — 'never', 'on_date', 'after_occurrences'
│   ├── end_date            Date, nullable — when end_type='on_date'
│   └── max_occurrences     Integer, nullable — when end_type='after_occurrences'
│
├── SKIP TRACKING
│   └── skipped_occurrences  JSON, nullable, default []
│                           — list of ISO date strings ("2026-03-01") the user
│                             has chosen to skip. _generate_occurrences() excludes
│                             these dates when projecting future occurrences.
│                             Skipping can be initiated from bills page or
│                             transactions page (via the scheduled bill row).
│
├── LIFECYCLE
│   ├── is_active           Boolean, not-null, default True
│   │                       — soft-delete / pause toggle
│   ├── created_at          DateTime, default utcnow
│   └── updated_at          DateTime, default utcnow, onupdate utcnow
│
└── INDEXES / CONSTRAINTS
    ├── Index('idx_bill_user', user_id)
    ├── Index('idx_bill_user_account', user_id, account_id)
    └── Index('idx_bill_active', user_id, is_active)
```

#### Design Decisions

- **No separate `bill_occurrences` table.** Occurrences are computed on-the-fly by `bills_services.generate_occurrences()`. This avoids write-amplification and keeps the schema simple — bills are pure recurrence rules.
- **`second_date` / `second_day_of_month`** handle the dual-anchor frequencies (`twice_monthly`, `twice_yearly`) without needing a generic multi-anchor system.
- **`day_of_month = -1` sentinel** represents "last day of month" which is calendar-variable (28/29/30/31). The occurrence generator handles this via `calendar.monthrange()`.
- **`transfer_account_id`** links the counterpart account. When set, `user_category` is auto-populated as `[<counterpart_account_name>]` following the transfer convention from `transactions.md § Type 9`.
- **`memo` is encrypted** (same pattern as `Transaction.user_memo`) for PII consistency.
- **No `encrypted_blob`** unlike transactions. Bills are user-created templates, not Plaid data. The fields are stored as plain columns for direct queryability. Only `memo` is encrypted.
- **`skipped_occurrences` as JSON array of integers** is the skip-tracking mechanism. Each entry is a 1-based occurrence slot number (e.g. `[5, 8]` suppresses the 5th and 8th occurrences). Using slot numbers rather than ISO date strings means the entries survive `day_of_month` or `day_of_week` changes — the Nth slot stays the Nth slot regardless of which calendar date it resolves to. Only `frequency`/`interval`/`start_date` changes invalidate the sequence and clear the list. Past slot entries are pruned on any write.
- **`is_active` soft-delete** keeps bill history visible for audit / undo without complicating the schema.

---

## 2. Routes — `bills_routes.py`

Blueprint: `bp = Blueprint('bills', __name__, url_prefix='/api/bills')`

All routes are `@require_auth` decorated.

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| `GET` | `/` | `list_bills` | Return all bills for user (active + inactive). Each bill includes next N occurrences (N from query param `?upcoming=10`, default from viewer settings `bills_upcoming_count`). |
| `GET` | `/<bill_id>` | `get_bill` | Single bill with full recurrence metadata + next N occurrences. |
| `POST` | `/` | `create_bill` | Create new bill. Validates recurrence rule, account ownership, optional transfer account. Returns created bill + next 10 occurrences. |
| `PUT` | `/<bill_id>` | `update_bill` | Partial update of any mutable field. Re-validates recurrence rule if frequency fields change. Returns updated bill + refreshed occurrences. |
| `DELETE` | `/<bill_id>` | `delete_bill` | Hard delete (dev stage — no data persistence requirement). Returns `{ deleted: bill_id }`. |
| `PATCH` | `/<bill_id>/toggle` | `toggle_bill` | Flip `is_active`. Lightweight alternative to full PUT for pause/resume. |
| `POST` | `/<bill_id>/skip` | `skip_occurrence` | Resolve date to occurrence number, add to `skipped_occurrences`. Body: `{ "date": "2026-03-01" }`. Validates date is a real future occurrence of this bill. Returns updated bill + refreshed occurrences. |
| `DELETE` | `/<bill_id>/skip` | `unskip_occurrence` | Resolve date to occurrence number, remove from `skipped_occurrences`. Body: `{ "date": "2026-03-01" }`. Returns updated bill + refreshed occurrences. |
| `GET` | `/upcoming` | `get_upcoming_bills` | Cross-bill view: flattened list of next N occurrences across all active bills for user, sorted by date ascending. Used by transaction viewer to inject into scheduled future block. |

### Request / Response Shapes

**POST / PUT body** (create / update):
```json
{
  "account_id": "acc_f899f70a1e73",
  "transfer_account_id": "acc_abc123",     // optional, null to clear
  "description": "Rent",
  "amount": -1500.00,
  "user_category": "Housing: Rent",        // or "[<Savings>]" for transfers
  "memo": "Landlord autopay",              // optional
  "frequency": "monthly",
  "interval": 1,
  "start_date": "2026-03-01",
  "second_date": null,
  "day_of_month": 1,
  "second_day_of_month": null,
  "day_of_week": null,
  "end_type": "never",
  "end_date": null,
  "max_occurrences": null
}
```

**GET response** (single bill or list element):
```json
{
  "bill_id": "bill_a1b2c3d4e5f6",
  "account_id": "acc_f899f70a1e73",
  "account_name": "Chase Checking (1234)",
  "transfer_account_id": null,
  "transfer_account_name": null,
  "description": "Rent",
  "amount": -1500.00,
  "user_category": "Housing: Rent",
  "memo": "Landlord autopay",
  "frequency": "monthly",
  "interval": 1,
  "start_date": "2026-03-01",
  "second_date": null,
  "day_of_month": 1,
  "second_day_of_month": null,
  "day_of_week": null,
  "end_type": "never",
  "end_date": null,
  "max_occurrences": null,
  "is_active": true,
  "created_at": "2026-02-26T12:00:00",
  "updated_at": "2026-02-26T12:00:00",
  "upcoming_occurrences": [
    { "date": "2026-03-01", "amount": -1500.00, "occurrence_number": 1 },
    { "date": "2026-04-01", "amount": -1500.00, "occurrence_number": 2 }
  ]
}
```

**GET `/upcoming`** response (used by transactions endpoint):
```json
{
  "upcoming": [
    {
      "bill_id": "bill_a1b2c3d4e5f6",
      "date": "2026-03-01",
      "amount": -1500.00,
      "description": "Rent",
      "account_id": "acc_f899f70a1e73",
      "account_name": "Chase Checking (1234)",
      "user_category": "Housing: Rent",
      "transfer_account_id": null,
      "memo": "Landlord autopay",
      "occurrence_number": 1,
      "is_transfer": false
    }
  ]
}
```

---

## 3. Services — `bills_services.py`

### Public API

| Function | Called By | Description |
|----------|-----------|-------------|
| `create_bill(user_id, data)` | `bills_routes.create_bill` | Validate + insert `Bill` row. Returns serialized bill + occurrences. |
| `update_bill(user_id, bill_id, data)` | `bills_routes.update_bill` | Partial update, re-validate recurrence if frequency fields touched. |
| `delete_bill(user_id, bill_id)` | `bills_routes.delete_bill` | Hard delete with ownership check. |
| `get_bill(user_id, bill_id, upcoming_count)` | `bills_routes.get_bill` | Fetch + serialize single bill with N occurrences. |
| `list_bills(user_id, upcoming_count)` | `bills_routes.list_bills` | Fetch all bills for user, each with N occurrences. |
| `toggle_bill(user_id, bill_id)` | `bills_routes.toggle_bill` | Flip `is_active`, return updated bill. |
| `skip_occurrence(user_id, bill_id, date_str)` | `bills_routes.skip_occurrence` | Validate the date is a real occurrence, resolve to occurrence number, append to `skipped_occurrences`, prune past entries. |
| `unskip_occurrence(user_id, bill_id, date_str)` | `bills_routes.unskip_occurrence` | Resolve date to occurrence number, remove from `skipped_occurrences`. |
| `get_upcoming_occurrences(user_id, count)` | `bills_routes.get_upcoming_bills` AND transaction services | Core integration point: generates next `count` occurrences per active bill, flattens + sorts by date. This is what the transactions endpoint calls to populate the scheduled future block. |

### Internal Helpers

| Function | Purpose |
|----------|---------|
| `_validate_bill_data(data, user_id)` | Check required fields, validate frequency-specific constraints (e.g. `day_of_month` required when frequency='monthly'), verify account ownership via Account query. |
| `_validate_recurrence_rule(data)` | Ensure the recurrence parameters are internally consistent: interval >= 1, day_of_month in 1–31 or -1, end_date > start_date, etc. |
| `_generate_occurrences(bill, count, after_date=None)` | Pure function: given a Bill row, produce the next `count` future dates from `after_date` (default: today). Handles all 7 frequency types. Excludes slot numbers in `bill.skipped_occurrences`. Returns list of `{ date, amount, occurrence_number }` dicts. |
| `_is_valid_occurrence_date(bill, date)` | Return True if date is a real occurrence of the recurrence rule (skipped entries ignored). Delegates to `_find_occurrence_number_for_date`. |
| `_find_occurrence_number_for_date(bill, date)` | Return the 1-based occurrence number for a given date, or None. Used by skip/unskip to resolve dates to stable slot numbers. |
| `_prune_past_occurrences(bill)` | Remove occurrence numbers from `skipped_occurrences` whose dates are now in the past. Called on any write to keep the list tidy. |
| `_serialize_bill(bill, upcoming_count, account_map=None)` | Convert Bill ORM row + computed occurrences to the JSON response dict, including resolved account names. |
| `_resolve_account_names(user_id, account_ids)` | Batch-fetch account display names for a set of account_ids. Returns `{ account_id: "Bank - Account (mask)" }` map. Avoids N+1 queries. |

### `_generate_occurrences()` — Recurrence Engine Detail

This is the core algorithm. It walks forward from `start_date` applying the recurrence rule until `count` future dates (relative to `after_date`, default today) are collected or end conditions are met.

```
def _generate_occurrences(bill, count, after_date=None):
    Frequency dispatch:
    ├── 'once'           → [start_date] if still in future
    ├── 'daily'          → start_date + (interval * n) days
    ├── 'weekly'         → start_date + (interval * n) weeks, 
    │                      snapped to day_of_week if set
    ├── 'monthly'        → advance month by interval, pin to day_of_month
    │                      (-1 = last day via monthrange)
    ├── 'twice_monthly'  → two dates per cycle: day_of_month and 
    │                      second_day_of_month, advance month by interval
    ├── 'yearly'         → advance year by interval, same month/day
    └── 'twice_yearly'   → start_date and second_date anchors,
                           advance year by interval

    End conditions (checked each iteration):
    ├── end_type='on_date'           → stop when date > end_date
    ├── end_type='after_occurrences' → stop when total generated > max_occurrences
    └── end_type='never'             → no end (but still capped by count param)

    Edge-case handling:
    ├── day_of_month > actual month length → clamp to last day
    ├── Feb 29 in non-leap year → clamp to Feb 28
    └── Safety cap: never generate more than 1000 iterations to
        prevent infinite loops from misconfigured rules
```

### Integration with Transactions Module (future session)

The seam is `get_upcoming_occurrences()`. When the transactions module is ready to include scheduled bill occurrences in the get_transactions response:

1. `transactions_services.get_all_transactions_for_user()` calls `bills_services.get_upcoming_occurrences(user_id, count)` where `count` comes from `Transaction_Viewer_Settings.bills_upcoming_count` (default 1, per transactions.md § Configuration).
2. Each occurrence is shaped into a pseudo-transaction dict matching the transaction response format:
   - `source='scheduled'`, `status='future'`
   - `transaction_id` = `"bill_{bill_id}_occ_{n}"` (deterministic, not persisted)
   - `bill_id` field added so frontend can link back to bill CRUD
   - `is_bill = true` flag for frontend badge rendering
3. These pseudo-transactions are merged into the scheduled future block alongside any other scheduled transactions.
4. This approach means **no rows are written to the transactions table for bill occurrences** — they are computed views. Only when a bill occurrence matures and needs matching/conversion would a real transaction row be created (future work tied to recurring detection).

---

## 4. Detection — `bills_detection.py` (DEFERRED)

Placeholder for recurring transaction pattern detection. Will analyze cleared transaction history to suggest bills the user hasn't manually created. Not required for basic CRUD flow.

---

## 5. Migration

Single Alembic migration: `add_bills_table`

```
flask --app run.py db migrate -m "add bills table"
flask --app run.py db upgrade
```

Fields map directly from § 1 schema above. No data migration needed (new table, no existing data).

---

## 6. Blueprint Registration

Add to `src/__init__.py` `create_app()`:

```python
from src.modules.Bills import bills_routes
app.register_blueprint(bills_routes.bp)
```

---

## 7. Implementation Order

| Step | File(s) | What |
|------|---------|------|
| 1 | `bills_models.py` | Define `Bill` model with all columns, indexes, constraints |
| 2 | Alembic migration | Generate + apply migration |
| 3 | `bills_services.py` | `_validate_bill_data`, `_validate_recurrence_rule`, `_generate_occurrences`, `_serialize_bill`, `_resolve_account_names` |
| 4 | `bills_services.py` | `create_bill`, `get_bill`, `list_bills`, `update_bill`, `delete_bill`, `toggle_bill` |
| 5 | `bills_services.py` | `get_upcoming_occurrences` (cross-bill flattened view) |
| 6 | `bills_routes.py` | All 9 routes wired to services (CRUD + toggle + skip/unskip + upcoming) |
| 7 | `__init__.py` (Bills) | Export `bills_routes` |
| 8 | `src/__init__.py` | Register blueprint |
| 9 | Smoke test | curl CRUD cycle: create → list → get → update → toggle → upcoming → delete |
| 10 | *(completed)* | Wire `get_upcoming_occurrences` into `get_all_transactions_for_user` |
| 11 | *(completed)* | Frontend `bills.html` + JS modules |
| 12 | *(future)* | `bills_detection.py` — recurring pattern detection |

---

## 8. Known Future Overlap with Transactions Module

These items are explicitly deferred to a later session:

- **Occurrence-to-transaction injection** (step 10 above): `get_all_transactions_for_user` calls `get_upcoming_occurrences` and merges them into the scheduled future block.
- **Bill maturation**: When a bill occurrence date reaches today, it could auto-generate a real `source='scheduled', status='future'` transaction row — or stay virtual. Decision deferred.
- **Bill-to-plaid matching**: Matching a matured bill occurrence to an incoming plaid transaction (same amount ± 3 days) is conceptually identical to the existing scheduled→matched flow in `transactions_services.run_scheduled_transaction_matching()`. The bill just becomes the source of the scheduled row.
- **`bills_upcoming_count` setting**: Add column to `Transaction_Viewer_Settings` (default 1) to control how many future occurrences per bill are shown in the transactions view. Migration + settings save/load update needed.
- **Transfer bill counterpart injection**: When a bill is a transfer, the occurrence injector should produce two pseudo-transaction rows (one per account side), matching the transfer pair convention.
- **Transaction-to-bill matching**: When a plaid transaction arrives that matches a bill occurrence (same account, same amount, date within ±3 days), auto-link them. Conceptually identical to the existing scheduled→matched flow in `transactions_services.run_scheduled_transaction_matching()`.