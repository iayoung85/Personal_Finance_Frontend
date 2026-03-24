# Accounts Page — API Routes

> **Page:** Accounts management hub
> **Blueprints:** `accounts` (`/api/accounts`), `balances` (`/api/balances`)

---

## Account Endpoints

### `GET /api/accounts`

Fetch all accounts for the current user with summary statistics.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `include_archived` | boolean | `false` | Include archived accounts in results |

**Response `200`:**
```json
{
  "accounts": [
    {
      "account_id": "acc_f899f70a1e73",
      "account_name": "Chase Checking",
      "custom_name": "My Main Account",
      "bank_id": "bank_abc",
      "bank_name": "Chase",
      "account_category": "depository",
      "account_subcategory": "checking",
      "origin": "plaid",
      "connection_status": "linked",
      "plaid_account_id": "plaid_acc_456",
      "plaid_item_id": "plaid_item_789",
      "mask": "1234",
      "institution_name": "Chase",
      "current_balance": "5432.10",
      "opening_balance": "5000.00",
      "balance_date": "2026-02-17",
      "currency": "USD",
      "is_archived": false,
      "created_at": "2025-08-15T10:30:00",
      "last_balance_update": "2026-02-17T14:30:00",
      "last_updated": "2026-02-17T14:30:00",
      "earliest_plaid_transaction_date": "2025-08-15"
    }
  ],
  "summary": {
    "total_balance": "15432.10",
    "account_count": 2,
    "by_category": {
      "depository": "15432.10",
      "credit": "0.00",
      "investment": "0.00",
      "loan": "0.00",
      "asset": "0.00",
      "liability": "0.00"
    }
  }
}
```

**Account Object Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `account_id` | string | `"acc_{uuid}"` or `"manual_{uuid}"` — business key |
| `account_name` | string | Default name from Plaid or user input |
| `custom_name` | string \| null | User-set display name override |
| `bank_id` | string | Parent bank group ID |
| `bank_name` | string | Parent bank display name |
| `account_category` | string | Primary type: `depository`, `credit`, `investment`, `loan`, `asset`, `liability` |
| `account_subcategory` | string | Secondary type: `checking`, `savings`, `credit_card`, `taxable`, `retirement_ira`, `401k`, `mortgage`, etc. |
| `origin` | string | **Immutable.** `"plaid"` or `"manual"` — how account was created |
| `connection_status` | string | **Mutable.** `"linked"`, `"dormant"`, `"converted"`, `"manual"`, `"relink_pending"` |
| `plaid_account_id` | string \| null | Plaid's account identifier (null for manual) |
| `plaid_item_id` | string \| null | Associated Plaid item (null for manual/converted) |
| `mask` | string \| null | Last 4 digits of account number |
| `institution_name` | string | Institution display name |
| `current_balance` | string (decimal) | Current balance as decimal string |
| `opening_balance` | string (decimal) \| null | Derived opening balance |
| `balance_date` | string (date) | Date of `current_balance` reading |
| `currency` | string | ISO 4217 code (e.g., `"USD"`) |
| `is_archived` | boolean | Visibility flag |
| `created_at` | string (datetime) | Account creation timestamp |
| `last_balance_update` | string (datetime) | Last time balance was updated |
| `earliest_plaid_transaction_date` | string (date) \| null | Earliest synced transaction (Plaid accounts only) |

---

### `GET /api/accounts/<account_id>`

Fetch a single account with full details.

**Response `200`:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "account_name": "Chase Checking",
  "custom_name": "My Main Account",
  "bank_id": "bank_abc",
  "bank_name": "Chase",
  "account_category": "depository",
  "account_subcategory": "checking",
  "origin": "plaid",
  "connection_status": "linked",
  "plaid_account_id": "plaid_acc_456",
  "plaid_item_id": "plaid_item_789",
  "mask": "1234",
  "institution_name": "Chase",
  "current_balance": "5432.10",
  "opening_balance": "5000.00",
  "balance_date": "2026-02-17",
  "currency": "USD",
  "is_archived": false,
  "notes": "Primary checking account",
  "created_at": "2025-08-15T10:30:00",
  "last_balance_update": "2026-02-17T14:30:00",
  "last_updated": "2026-02-17T14:30:00",
  "transaction_count": 342,
  "earliest_plaid_transaction_date": "2025-08-15"
}
```

Additional field vs list endpoint:
- `notes` — User annotations (only on detail view).
- `transaction_count` — Number of transactions in this account.

**Errors:** `404` — Account not found.

---

### `POST /api/accounts`

Create a new manual account.

**Request:**
```json
{
  "account_name": "Emergency Fund",
  "bank_name": "My Savings",
  "account_category": "depository",
  "account_subcategory": "savings",
  "opening_balance": 10000.00,
  "balance_date": "2026-03-01",
  "currency": "USD",
  "custom_name": null,
  "notes": "Rainy day fund"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `account_name` | string | yes | |
| `bank_name` | string | conditional | Name for a new bank group (provide `bank_name` OR `bank_id`) |
| `bank_id` | string | conditional | Existing bank to add this account under |
| `account_category` | string | yes | One of: `depository`, `credit`, `investment`, `loan`, `asset`, `liability` |
| `account_subcategory` | string | no | One of the valid subcategories for the category |
| `opening_balance` | number | no | Starting balance (default: 0) |
| `balance_date` | string (date) | no | Date for opening balance (default: today) |
| `currency` | string | no | ISO 4217 code (default: `"USD"`) |
| `custom_name` | string | no | Display name override |
| `notes` | string | no | |
| `institution_id` | string | no | Plaid institution ID (for manual accts under known institutions) |

**Response `201`:** The created account object (same shape as GET detail).

**Errors:** `400` — Missing required fields, invalid category.

---

### `PATCH /api/accounts/<account_id>`

Update account metadata. Partial update — only include fields you want to change.

**Request:**
```json
{
  "custom_name": "Primary Checking",
  "account_category": "depository",
  "account_subcategory": "checking",
  "is_archived": false,
  "notes": "Updated notes",
  "currency": "USD"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `custom_name` | string | Display name override |
| `account_category` | string | Change account type |
| `account_subcategory` | string | Change subtype |
| `is_archived` | boolean | Archive/unarchive |
| `notes` | string | User annotations |
| `currency` | string | ISO 4217 code |

**Response `200`:** Updated account object.

---

### `DELETE /api/accounts/<account_id>`

Delete or archive an account.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `mode` | string | no | `"archive"` (soft delete, default) or `"delete"` (hard delete) |

When `mode=delete`: permanently removes the account, all transactions, balance history, and snapshots. **Irreversible.**

When `mode=archive`: sets `is_archived=true`. Data preserved. Reversible via PATCH.

**Response `200`:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "is_archived": true,
  "message": "Account archived successfully"
}
```

---

### `POST /api/accounts/<account_id>/move`

Move an account from one bank group to another.

**Request:**
```json
{
  "target_bank_id": "bank_xyz"
}
```

**Response `200`:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "source_bank_id": "bank_abc",
  "target_bank_id": "bank_xyz",
  "target_bank_name": "My Other Bank",
  "source_bank_deleted": false
}
```

`source_bank_deleted` is `true` if the source bank had no remaining accounts and was auto-cleaned.

---

### `POST /api/accounts/<account_id>/unlink-archive`

Unlink a Plaid account from its item and archive it in one step.

**Response `200`:** Unlinked and archived account details.

---

### `GET /api/accounts/<account_id>/balance-history`

Fetch the balance history ledger for an account.

**Rate limit:** 6000/hour

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `start_date` | string (date) | — | Filter start |
| `end_date` | string (date) | — | Filter end |
| `limit` | integer | — | Max rows (capped at 10000) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "account_name": "Chase Checking",
  "balance_history": [
    {
      "date": "2026-03-15",
      "balance": "5432.10",
      "source": "plaid_sync"
    }
  ],
  "earliest_date": "2025-08-15",
  "latest_date": "2026-03-15",
  "total_count": 342
}
```

---

### `GET /api/accounts/<account_id>/balance-snapshots`

Fetch point-in-time balance snapshots.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `start_date` | string (date) | — | Filter start |
| `end_date` | string (date) | — | Filter end |
| `limit` | integer | — | Max rows (capped at 1000) |

**Response `200`:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "snapshots": [
    {
      "date": "2026-02-28",
      "balance": "5100.00",
      "source": "plaid_sync"
    }
  ],
  "count": 12
}
```

---

### `GET /api/accounts/<account_id>/validate`

Validate account balance consistency between ledger and snapshots.

**Response `200`:**
```json
{
  "is_valid": true,
  "calculated_balance": "5432.10",
  "account_balance": "5432.10",
  "snapshot_balance": "5432.10",
  "discrepancies": [],
  "last_updated": "2026-03-15T14:30:00"
}
```

---

## Reference Data Endpoints

### `GET /api/accounts/reference/categories`

Get the valid account categories and their subcategories.

**Response `200`:**
```json
{
  "categories": {
    "depository": ["checking", "savings", "money_market", "cd", "hsa"],
    "investment": ["taxable", "retirement_ira", "retirement_401k", "529", "brokerage"],
    "credit": ["credit_card", "line_of_credit"],
    "loan": ["mortgage", "student_loan", "auto_loan", "personal_loan", "home_equity"],
    "asset": ["real_estate", "vehicle", "other_asset"],
    "liability": ["other_liability"]
  }
}
```

---

### `GET /api/accounts/reference/popular-institutions`

Get a list of popular financial institutions for quick selection during manual account creation.

**Response `200`:**
```json
{
  "institutions": [
    { "institution_id": "ins_3", "name": "Chase" },
    { "institution_id": "ins_4", "name": "Wells Fargo" }
  ]
}
```

---

### `GET /api/accounts/reference/search-institutions`

Search financial institutions by name.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `q` | string | yes | Search query (min 2 characters) |

**Response `200`:**
```json
{
  "institutions": [
    { "institution_id": "ins_3", "name": "Chase", "url": "https://chase.com" }
  ],
  "query": "cha",
  "count": 1
}
```

---

## Balance Management Endpoints

### `GET /api/balances/summary/net-worth`

Get the total net worth across all accounts.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `as_of_date` | string (date) | today | Calculate net worth as of this date |

**Response `200`:**
```json
{
  "total_net_worth": "125432.10",
  "as_of_date": "2026-03-15",
  "account_count": 5,
  "by_category": {
    "depository": "25432.10",
    "credit": "-3200.00",
    "investment": "98000.00",
    "loan": "-45000.00",
    "asset": "50200.00",
    "liability": "0.00"
  }
}
```

---

### `GET /api/balances/balance-snapshot`

Get a point-in-time snapshot of all account balances.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `date` | string (date) | Last day of previous month | Snapshot date |
| `include_archived` | boolean | `false` | Include archived accounts |

**Response `200`:**
```json
{
  "snapshots_by_account": {
    "acc_f899f70a1e73": {
      "account_name": "Chase Checking",
      "balance": "5100.00",
      "bank_name": "Chase"
    }
  },
  "total": "15200.00",
  "as_of_date": "2026-02-28"
}
```

---

### `POST /api/balances/<account_id>/balance`

Manually set an account's balance (for manual accounts).

**Request:**
```json
{
  "balance": 10500.00,
  "balance_date": "2026-03-15",
  "notes": "Manual balance correction"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `balance` | number | yes | New balance amount |
| `balance_date` | string (date) | no | Date for this balance (default: today) |
| `notes` | string | no | Reason for update |

**Response `201`:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "balance": "10500.00",
  "balance_date": "2026-03-15",
  "balance_source": "manual_entry",
  "last_update": "2026-03-15T14:30:00"
}
```

---

### `POST /api/balances/reset-balance-history`

Rebuild balance history ledger from transaction data.

**Request:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "flip_plaid_amounts": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `account_id` | string | no | Specific account (omit for all accounts) |
| `flip_plaid_amounts` | boolean | no | Reverse Plaid amount signs (edge-case fix) |

**Response `200`:**
```json
{
  "message": "Balance history reset",
  "scope": "single_account",
  "accounts_processed": 1
}
```

---

### `POST /api/balances/repair-balance-history`

Repair gaps and inconsistencies in balance history.

**Request:**
```json
{
  "account_id": "acc_f899f70a1e73",
  "active_only": true
}
```

**Response `200`:**
```json
{
  "message": "Balance history repaired",
  "scope": "single_account",
  "accounts_repaired": 1
}
```

---

## Account & Bank Classification System

Understanding the origin/connection badge system is critical for the frontend:

### Origin (immutable — set once at creation)
| Value | Meaning |
|-------|---------|
| `"plaid"` | Created from a Plaid Link connection |
| `"manual"` | Created by the user |

### Connection Status (mutable — changes during lifecycle)
| Value | Meaning |
|-------|---------|
| `"linked"` | Actively connected to Plaid, syncing data |
| `"dormant"` | Plaid item exists but transactions not billed; acts as manual |
| `"converted"` | Was Plaid-linked, now manual (item removed, billing stopped, history preserved) |
| `"manual"` | Manual data entry mode (always-manual or never-activated Plaid account) |
| `"relink_pending"` | Re-link in progress, awaiting transaction sync |

### Health (derived, only when connection_status=linked)
| State | Source |
|-------|--------|
| OK | `Plaid_Items.status = 'active'` and no error code |
| Needs Update | `Plaid_Items.error_code` is set (recoverable) |
| Error | `Plaid_Items.error_code` is set (may be unrecoverable) |

### Important Rules
- `Bank.is_archived=true` + `connection_status='linked'` is **invalid**. Archiving a linked bank auto-converts it first.
- `Account.is_archived=true` + `connection_status='linked'` is **valid**. Plaid keeps syncing in background.

---

## Migration Notes for React + IndexedDB

### IndexedDB Schema for Accounts
```
Object Store: accounts
  keyPath: "account_id"
  Indexes: bank_id, account_category, is_archived, connection_status

Object Store: banks (derived from accounts response, or from connections/items)
  keyPath: "bank_id"
  Indexes: origin, connection_status
```

### Sidebar State Management
The accounts sidebar is a two-level tree (banks → accounts). In React, model this as:
- Store a flat `accounts` array in IndexedDB.
- Derive the tree view from `bank_id` grouping at render time.
- Selected bank/account lives in React state (URL params for deep linking).

### Balance Display
Balances come as decimal strings (e.g., `"5432.10"`) to avoid floating-point issues. Use a formatting utility that handles:
- Negative display (red color, parentheses or minus sign)
- Currency symbol
- Comma separators

Consider libraries like `Intl.NumberFormat` or `dinero.js` for reliable currency formatting.
