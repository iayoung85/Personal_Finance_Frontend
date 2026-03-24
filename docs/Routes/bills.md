# Bills Page — API Routes

> **Page:** Recurring bill management (CRUD, occurrence projection, skip/unskip)
> **Blueprint:** `bills` (`/api/bills`)

---

## Bill CRUD

### `GET /api/bills`

Fetch all bills for the current user (active and inactive).

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `upcoming` | integer | 10 | Number of future occurrences to project per bill |

**Response `200`:**
```json
{
  "bills": [
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
      "amount_variable": false,
      "is_active": true,
      "created_at": "2026-02-26T12:00:00",
      "updated_at": "2026-02-26T12:00:00",
      "skipped_occurrences": [],
      "upcoming_occurrences": [
        { "date": "2026-04-01", "amount": -1500.00, "occurrence_number": 2 },
        { "date": "2026-05-01", "amount": -1500.00, "occurrence_number": 3 }
      ]
    }
  ]
}
```

**Bill Object Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `bill_id` | string | `"bill_{uuid}"` — stable identifier |
| `account_id` | string \| null | Account where payment occurs (null if account was deleted) |
| `account_name` | string | Display: `"Bank - Account (mask)"` |
| `transfer_account_id` | string \| null | Counterpart account for transfer bills |
| `transfer_account_name` | string \| null | Display name of transfer counterpart |
| `description` | string | Bill name (e.g., "Rent", "Netflix") |
| `amount` | number | Negative = outflow, positive = inflow |
| `user_category` | string \| null | `"Primary: Detailed"` or `"[<Account>]"` for transfers |
| `memo` | string \| null | User annotation (encrypted at rest) |
| `frequency` | string | `once`, `daily`, `weekly`, `monthly`, `twice_monthly`, `yearly`, `twice_yearly` |
| `interval` | integer | "Every {interval} {unit}(s)" (e.g., every 2 months) |
| `start_date` | string (date) | First occurrence |
| `second_date` | string (date) \| null | 2nd date anchor for `twice_monthly`/`twice_yearly` |
| `day_of_month` | integer \| null | 1–31 or -1 for "last day" (monthly/twice_monthly) |
| `second_day_of_month` | integer \| null | 2nd anchor (twice_monthly only) |
| `day_of_week` | integer \| null | 0=Mon..6=Sun (weekly; monthly with -1 for "last weekday") |
| `end_type` | string | `never`, `on_date`, `after_occurrences` |
| `end_date` | string (date) \| null | Terminal date (when `end_type=on_date`) |
| `max_occurrences` | integer \| null | Total count (when `end_type=after_occurrences`) |
| `amount_variable` | boolean | When true, bill matching ignores amount (for variable bills like paychecks) |
| `is_active` | boolean | Soft-delete / pause toggle |
| `skipped_occurrences` | integer[] | 1-based occurrence slot numbers to skip |
| `upcoming_occurrences` | array | Projected future occurrences (see below) |
| `created_at` | string (datetime) | |
| `updated_at` | string (datetime) | |

**Occurrence Object:**

| Field | Type | Notes |
|-------|------|-------|
| `date` | string (date) | Projected date for this occurrence |
| `amount` | number | Same as bill amount |
| `occurrence_number` | integer | 1-based slot number in recurrence sequence |

---

### `GET /api/bills/<bill_id>`

Fetch a single bill with full details and projected occurrences.

**Query Parameters:**

| Param | Type | Default |
|-------|------|---------|
| `upcoming` | integer | 10 |

**Response `200`:** Same shape as a single bill in the list response.

**Errors:** `404` — Bill not found.

---

### `POST /api/bills`

Create a new recurring bill.

**Request:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "transfer_account_id": null,
  "description": "Netflix",
  "amount": -15.99,
  "user_category": "Entertainment: Streaming",
  "memo": "Family plan",
  "frequency": "monthly",
  "interval": 1,
  "start_date": "2026-04-01",
  "second_date": null,
  "day_of_month": 1,
  "second_day_of_month": null,
  "day_of_week": null,
  "end_type": "never",
  "end_date": null,
  "max_occurrences": null
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `account_id` | string | yes | Account for payment |
| `description` | string | yes | Bill name |
| `amount` | number | yes | Negative = outflow, positive = inflow |
| `frequency` | string | yes | One of: `once`, `daily`, `weekly`, `monthly`, `twice_monthly`, `yearly`, `twice_yearly` |
| `start_date` | string (date) | yes | First occurrence date |
| `interval` | integer | yes | Repeat interval (default: 1) |
| `transfer_account_id` | string | no | For transfer bills. When set, `user_category` auto-populates as `"[<account_name>]"` |
| `user_category` | string | no | |
| `memo` | string | no | |
| `second_date` | string (date) | conditional | Required for `twice_monthly`/`twice_yearly` |
| `day_of_month` | integer | conditional | Required for `monthly`/`twice_monthly`. Use -1 for "last day" |
| `second_day_of_month` | integer | conditional | Required for `twice_monthly` |
| `day_of_week` | integer | conditional | Required for `weekly`. Also used with `day_of_month=-1` for "last {weekday} of month" |
| `end_type` | string | no | Default: `"never"` |
| `end_date` | string (date) | conditional | Required when `end_type="on_date"` |
| `max_occurrences` | integer | conditional | Required when `end_type="after_occurrences"` |

**Frequency-Specific Field Requirements:**

| Frequency | Required Fields |
|-----------|----------------|
| `once` | `start_date` only |
| `daily` | `start_date`, `interval` |
| `weekly` | `start_date`, `interval`, `day_of_week` |
| `monthly` | `start_date`, `interval`, `day_of_month`. Optional: `day_of_week` (for "last {weekday}" mode when `day_of_month=-1`) |
| `twice_monthly` | `start_date`, `interval`, `day_of_month`, `second_day_of_month` |
| `yearly` | `start_date`, `interval` |
| `twice_yearly` | `start_date`, `second_date`, `interval` |

**Response `201`:** Created bill object with first 10 upcoming occurrences.

**Errors:** `400` — Missing required fields, invalid recurrence rule, account not found.

---

### `PUT /api/bills/<bill_id>`

Update an existing bill (partial update). Only include fields to change.

**Request:**
```json
{
  "amount": -17.99,
  "description": "Netflix (price increase)"
}
```

If frequency-related fields change (`frequency`, `interval`, `start_date`, `day_of_month`, etc.), the recurrence rule is re-validated and `skipped_occurrences` may be cleared (since slot numbers become invalid).

**Response `200`:** Updated bill object with refreshed occurrences.

---

### `DELETE /api/bills/<bill_id>`

Permanently delete a bill.

**Response `200`:**
```json
{
  "message": "Bill deleted"
}
```

---

### `PATCH /api/bills/<bill_id>/toggle`

Toggle `is_active` (pause/resume a bill without deleting it).

**Response `200`:** Bill object with toggled `is_active` value.

---

## Skip / Unskip Occurrences

### `POST /api/bills/<bill_id>/skip`

Skip a specific future occurrence.

**Request:**
```json
{
  "date": "2026-05-01"
}
```

The server resolves the date to a 1-based occurrence number and adds it to `skipped_occurrences`. The date must be a real future occurrence of this bill.

**Response `200`:** Updated bill with refreshed occurrences (skipped date excluded).

**Errors:** `400` — Date is not a valid future occurrence of this bill.

---

### `DELETE /api/bills/<bill_id>/skip`

Un-skip a previously skipped occurrence.

**Request:**
```json
{
  "date": "2026-05-01"
}
```

**Response `200`:** Updated bill with the occurrence restored.

---

## Cross-Bill Upcoming View

### `GET /api/bills/upcoming`

Flattened list of upcoming occurrences across all active bills, sorted by date. This is the data source for the transactions page's "scheduled future" block.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `count` | integer | 1 | Number of occurrences per bill |

**Response `200`:**
```json
{
  "upcoming": [
    {
      "bill_id": "bill_a1b2c3d4e5f6",
      "date": "2026-04-01",
      "amount": -1500.00,
      "description": "Rent",
      "account_id": "acc_f899f70a1e73",
      "account_name": "Chase Checking (1234)",
      "user_category": "Housing: Rent",
      "transfer_account_id": null,
      "memo": "Landlord autopay",
      "occurrence_number": 2,
      "is_transfer": false
    },
    {
      "bill_id": "bill_xyz789",
      "date": "2026-04-01",
      "amount": -15.99,
      "description": "Netflix",
      "account_id": "acc_f899f70a1e73",
      "account_name": "Chase Checking (1234)",
      "user_category": "Entertainment: Streaming",
      "transfer_account_id": null,
      "memo": null,
      "occurrence_number": 4,
      "is_transfer": false
    }
  ]
}
```

---

## How Bill Occurrences Appear in Transactions

Bill occurrences aren't stored as transaction rows until they materialize. They appear as **pseudo-transactions** in `GET /api/transactions`:

| Transaction Field | Value for Bill Occurrence |
|------------------|---------------------------|
| `source` | `"scheduled"` |
| `status` | `"future"` |
| `transaction_id` | `"bill_{bill_id}_occ_{n}"` (deterministic, not in DB) |
| `bill_id` | The originating bill's ID |
| `is_bill` | `true` |
| `occurrence_number` | 1-based slot number |
| `schedule_summary` | `"Monthly, on the 1st"` |
| `amount_variable` | From bill's `amount_variable` flag |

**Frontend lifecycle of a bill occurrence:**
1. **Virtual (BILL_FUTURE):** Greyed out, 📅 badge. Right-click: Mark Paid, Modify, Skip.
2. **Mark Paid:** Materializes into a `MANUAL_FUTURE` transaction (real DB row) with `is_bill=true`. The virtual occurrence disappears.
3. **Matured:** When date passes, becomes `BILL_MISSING` if no Plaid match, or `BILL_MATCHED` if matched.
4. **Skip:** Adds to `skipped_occurrences`, occurrence disappears from projections.

---

## Migration Notes for React + IndexedDB

### IndexedDB Schema for Bills
```
Object Store: bills
  keyPath: "bill_id"
  Indexes: account_id, is_active, frequency
```

### Recurrence Display
The frontend should render a human-readable summary from the recurrence fields:

```typescript
function describeRecurrence(bill: Bill): string {
  switch (bill.frequency) {
    case 'once': return `Once on ${bill.start_date}`;
    case 'daily': return `Every ${bill.interval} day(s)`;
    case 'weekly': return `Every ${bill.interval} week(s) on ${dayName(bill.day_of_week)}`;
    case 'monthly':
      if (bill.day_of_month === -1 && bill.day_of_week !== null)
        return `Last ${dayName(bill.day_of_week)} of every ${bill.interval} month(s)`;
      return `On the ${ordinal(bill.day_of_month)} of every ${bill.interval} month(s)`;
    case 'twice_monthly':
      return `On the ${ordinal(bill.day_of_month)} and ${ordinal(bill.second_day_of_month)} of every ${bill.interval} month(s)`;
    case 'yearly': return `Every ${bill.interval} year(s) on ${bill.start_date}`;
    case 'twice_yearly': return `Twice yearly on ${bill.start_date} and ${bill.second_date}`;
  }
}
```

### Bill Creation Form
The form is split horizontally:
- **Left column:** Frequency selection and customization controls.
- **Right column:** Transaction details (account, amount, category, memo).
- **Bottom:** Auto-generated description + next 10 projected dates.

Use React state to reactively show/hide frequency-specific fields based on the selected frequency.

### Bill-Transaction Integration
When displaying the transactions ledger, merge bill occurrences (from `GET /api/bills/upcoming` or from the `GET /api/transactions` response) into the future block. Render them with distinct visual treatment (opacity, badge) and attach context menu actions for Mark Paid / Skip / Modify.
