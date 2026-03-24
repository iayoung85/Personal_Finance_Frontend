# Categories Page — API Routes

> **Page:** Category management hub (taxonomy, mappings, rules, overrides)
> **Blueprint:** `categorization` (`/api/categorization`)

---

## Category Taxonomy

### `GET /api/categorization/categories`

Fetch the user's complete category configuration: mappings from Plaid categories to user labels, custom categories, and a hash for cache invalidation.

**Response `200`:**
```json
{
  "category_mappings": {
    "FOOD_AND_DRINK_RESTAURANTS": "Food: Dining",
    "FOOD_AND_DRINK_GROCERIES": "Food: Groceries",
    "TRANSPORTATION_GAS": "Auto: Gas",
    "TRANSFER_DEBIT": "Transfer Out: Account Transfer"
  },
  "custom_categories": [
    "Food: Dining",
    "Food: Groceries",
    "Auto: Gas",
    "Housing: Rent"
  ],
  "updated_at": "2026-03-15T10:30:00",
  "category_list_hash": "a1b2c3d4"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `category_mappings` | object | `{ plaid_detailed_category → user_label }` — maps Plaid's PFC v2 categories to user's display labels |
| `custom_categories` | string[] | User-created categories not derived from Plaid mappings |
| `updated_at` | string (datetime) | Last modification time |
| `category_list_hash` | string | Hash for client-side cache invalidation |

**Category format:** All categories use `"Primary: Detailed"` format (e.g., `"Food: Dining"`). Transfer categories use `"[<account_name>]"` format.

---

### `GET /api/categorization/categories/available`

Get the full list of available categories (union of mapped + custom).

**Response `200`:**
```json
{
  "available_categories": [
    "Food: Dining",
    "Food: Groceries",
    "Auto: Gas",
    "Housing: Rent",
    "Transfer Out: Account Transfer",
    "Transfer In: Account Transfer"
  ]
}
```

This is the list to populate autocomplete dropdowns when the user enters a category.

---

### `PUT /api/categorization/categories/mappings`

Replace the user's Plaid-to-user category mapping table.

**Request:**
```json
{
  "category_mappings": {
    "FOOD_AND_DRINK_RESTAURANTS": "Food: Dining Out",
    "FOOD_AND_DRINK_GROCERIES": "Food: Groceries",
    "TRANSPORTATION_GAS": "Auto: Fuel"
  }
}
```

**Response `200`:**
```json
{
  "success": true,
  "category_mappings": { ...updated mappings... }
}
```

Updating mappings does **not** automatically recategorize existing transactions. Call the recategorization endpoint separately if desired.

---

### `POST /api/categorization/categories/custom`

Create a new custom category.

**Request:**
```json
{
  "category_name": "Pets: Vet Bills"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `category_name` | string | yes | Format: `"Primary: Detailed"`. Cannot start with `[` (reserved for transfers). |

**Response `201`:**
```json
{
  "success": true,
  "custom_categories": [ ...updated list... ],
  "category_name": "Pets: Vet Bills"
}
```

**Errors:**
- `400` — Category name starts with `[` (reserved for transfer categories).
- `409` — Category already exists.

---

### `DELETE /api/categorization/categories/<category_name>`

Delete a custom category. Must reassign affected transactions.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `action` | string | yes | Must be `"reassign"` |
| `reassign_to` | string | yes | Category to move affected transactions to |

**Response `200`:**
```json
{
  "success": true,
  "message": "Category deleted and 42 transactions reassigned",
  "affected_count": 42
}
```

---

## Transaction Categorization

### `POST /api/categorization/transactions/<transaction_id>/categorize`

Override the category for a single transaction.

**Request:**
```json
{
  "user_category": "Food: Dining",
  "suggest_rule": true
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `user_category` | string | yes | New category (`"Primary: Detailed"` or `"[<Account>]"` for transfers) |
| `suggest_rule` | boolean | no | If true, frontend should prompt user to create a rule from this override |

**Response `200`:**
```json
{
  "message": "Category updated",
  "override_created": true,
  "user_category": "Food: Dining",
  "transaction_id": "txn_abc123"
}
```

When `user_category` matches the `[<account_name>]` transfer format, this triggers the transfer assignment flow on the backend.

---

## Categorization Rules

### `GET /api/categorization/rules`

Fetch all categorization rules for the current user.

**Response `200`:**
```json
{
  "rules": [
    {
      "rule_id": 1,
      "name": "McDonald's → Fast Food",
      "criteria": {
        "match_type": "merchant_contains",
        "match_value": "McDonald",
        "case_sensitive": false
      },
      "target_category": "Food: Fast Food",
      "priority": 10,
      "is_active": true,
      "times_applied": 47,
      "last_applied": "2026-03-10T08:15:00"
    }
  ]
}
```

**Rule Object Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `rule_id` | integer | Unique identifier |
| `name` | string | Human-readable rule name |
| `criteria` | object | Match criteria (see below) |
| `target_category` | string | Category to assign when rule matches |
| `priority` | integer | Higher = applied first (in case of conflicts) |
| `is_active` | boolean | Enable/disable toggle |
| `times_applied` | integer | How many transactions this rule has categorized |
| `last_applied` | string (datetime) | Last time this rule matched a transaction |

**Match Criteria Types:**

| `match_type` | `match_value` | Description |
|--------------|---------------|-------------|
| `merchant_contains` | `"McDonald"` | Merchant name contains string |
| `name_contains` | `"AMZN"` | Description/name contains string |
| `plaid_category` | `"FOOD_AND_DRINK_FAST_FOOD"` | Exact Plaid category match |
| `amount_range` | `{"min": 5, "max": 50}` | Amount within range |
| `regex` | `"^AMZN.*MKTP"` | Regex match against description |
| `primary_category_contains` | `"FOOD"` | Plaid primary category contains string |

All criteria fields are AND-combined (all must match for the rule to apply).

---

### `POST /api/categorization/rules`

Create a new categorization rule. Optionally applies retroactively.

**Request:**
```json
{
  "rule_name": "Starbucks → Coffee",
  "match_criteria": {
    "match_type": "merchant_contains",
    "match_value": "Starbucks",
    "case_sensitive": false
  },
  "target_category": "Food: Coffee",
  "priority": 10,
  "is_active": true
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `rule_name` | string | yes | Human-readable name |
| `match_criteria` | object | yes | See match types above |
| `target_category` | string | yes | Category to assign |
| `priority` | integer | no | Default: 0. Higher = applied first |
| `is_active` | boolean | no | Default: true |

**Response `201`:**
```json
{
  "message": "Rule created and applied to 23 transactions",
  "rule_id": 5,
  "transactions_updated": 23,
  "overrides_skipped": 3
}
```

`overrides_skipped` — transactions with manual overrides are not recategorized by rules (overrides have highest priority).

---

### `PUT /api/categorization/rules/<rule_id>`

Update an existing rule (partial update).

**Request:**
```json
{
  "target_category": "Food: Espresso",
  "is_active": false
}
```

**Response `200`:**
```json
{
  "message": "Rule updated"
}
```

---

### `DELETE /api/categorization/rules/<rule_id>`

Delete a rule. Transactions previously categorized by this rule are recategorized using remaining pipeline (mappings → other rules → defaults).

**Response `200`:**
```json
{
  "message": "Rule deleted",
  "transactions_recategorized": 23
}
```

---

## Category Migrations

### `POST /api/categorization/categories/rename`

Rename a category across all mappings, rules, overrides, and transactions.

**Request:**
```json
{
  "old_name": "Food: Eating Out",
  "new_name": "Food: Dining"
}
```

**Response `200`:** Migration result with affected counts per entity type.

---

### `POST /api/categorization/categories/merge`

Merge multiple categories into one.

**Request:**
```json
{
  "source_categories": ["Food: Dining Out", "Food: Eating Out", "Food: Restaurants"],
  "target_category": "Food: Dining"
}
```

**Response `200`:** Migration result.

---

### `POST /api/categorization/categories/reassign-primary`

Reassign all detailed categories under one primary to a different primary.

**Request:**
```json
{
  "source_primary": "FOOD_AND_DRINK",
  "target_primary": "Food"
}
```

**Response `200`:** Migration result.

---

### `POST /api/categorization/categories/reassign-detailed`

Move a specific detailed category to a different primary.

**Request:**
```json
{
  "source_category": "Food: Coffee Shops",
  "target_primary": "Entertainment",
  "target_detailed_name": "Entertainment: Coffee"
}
```

**Response `200`:** Migration result.

---

### `GET /api/categorization/migration-log`

Audit log of all category migrations.

**Query Parameters:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | integer | 20 | Max entries to return |

**Response `200`:**
```json
{
  "migrations": [
    {
      "id": 1,
      "migration_type": "rename",
      "changes": {
        "old": "Food: Eating Out",
        "new": "Food: Dining"
      },
      "stats": {
        "mappings_updated": 3,
        "rules_updated": 1,
        "overrides_updated": 15,
        "transactions_updated": 142
      },
      "created_at": "2026-03-10T08:15:00"
    }
  ]
}
```

---

## Categorization Pipeline (Priority Order)

Understanding the pipeline is essential for the frontend:

1. **Manual Overrides** (highest priority) — One-off assignments via `POST /categorize`. These always win.
2. **Rules** — Pattern-based rules applied in priority order. Skipped if an override exists.
3. **Mappings** — Plaid category → user label lookup. Used when no rule matches.
4. **Default** — Plaid's own category label (if no mapping exists).

When a user changes a category in the transaction table, the frontend should:
1. Call `POST /api/categorization/transactions/{id}/categorize` (creates an override).
2. Optionally prompt: "Create a rule from this?" (if `suggest_rule` was set).
3. Update the local transaction in IndexedDB.

---

## Migration Notes for React + IndexedDB

### IndexedDB Schema for Categories
```
Object Store: categories
  keyPath: "user_id" (single entry per user)
  Data: { category_mappings, custom_categories, updated_at, category_list_hash }

Object Store: categorization_rules
  keyPath: "rule_id"
  Indexes: is_active, priority, target_category
```

### Category Autocomplete
Build the autocomplete list from `GET /categories/available`. Store in IndexedDB and refresh when `category_list_hash` changes. For transfer categories, dynamically add `"[<account_name>]"` entries from the accounts list — these are not in the static category list.

### Rule Management UI
The rule builder should let users:
1. Pick a match type from a dropdown.
2. Enter the match value.
3. Select a target category (with autocomplete).
4. Preview matching transactions (call `GET /api/transactions` and filter client-side, or show a dry-run count).
5. Set priority for conflict resolution.

### Cache Invalidation
When categories change (mapping update, rule create/delete), invalidate the transaction cache too — categories may have shifted. Compare `category_list_hash` on each category fetch to detect staleness.
