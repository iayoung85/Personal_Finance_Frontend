# Investments Page — API Routes

> **Page:** Investment holdings, securities enrichment, ETF exposure, allocation tracking
> **Blueprint:** `investments` (`/api/investments`)

---

## Holdings Sync

### `POST /api/investments/sync`

Trigger a holdings sync from Plaid for a specific item.

**Request:**
```json
{
  "item_id": "item_abc123",
  "activate": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `item_id` | string | yes | Plaid item to sync |
| `activate` | boolean | no | Activate investments product before syncing |

**Response `200`:**
```json
{
  "message": "Holdings synced successfully",
  "timestamp": "2026-03-15T14:30:00"
}
```

**Errors:**
- `402` — Investments product not available for this item.
- `429` — Sync cooldown active (too many recent syncs).

---

### `GET /api/investments/holdings`

Fetch all investment holdings across all items.

**Response `200`:**
```json
{
  "items": [
    {
      "plaid_item_id": "item_abc123",
      "institution_name": "Fidelity",
      "last_updated": "2026-03-15T14:30:00",
      "accounts": [
        {
          "account_id": "acc_invest_1",
          "name": "Individual Brokerage",
          "mask": "5678",
          "type": "investment",
          "subtype": "brokerage",
          "balances": {
            "current": 98000.00,
            "available": null
          }
        }
      ],
      "holdings": [
        {
          "account_id": "acc_invest_1",
          "security_id": "sec_abc123",
          "quantity": 100,
          "cost_basis": 15000.00,
          "institution_value": 18500.00,
          "institution_price": 185.00,
          "institution_price_as_of": "2026-03-14"
        }
      ]
    }
  ],
  "securities": [
    {
      "security_id": "sec_abc123",
      "ticker_symbol": "AAPL",
      "name": "Apple Inc.",
      "type": "equity",
      "close_price": 185.50,
      "close_price_as_of": "2026-03-14",
      "cusip": "037833100",
      "isin": "US0378331005",
      "iso_currency_code": "USD",
      "enriched_sector": "Technology",
      "enriched_industry": "Consumer Electronics",
      "enriched_allocation_category": "Large Growth"
    }
  ]
}
```

**Holdings are grouped by Plaid item.** Each item contains accounts and their holdings. Securities are shared globally (same security across items uses the same `security_id`).

**Security Object Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `security_id` | string | Unique identifier |
| `ticker_symbol` | string \| null | Ticker (null for unlisted securities) |
| `name` | string | Security name |
| `type` | string | `equity`, `etf`, `mutual fund`, `fixed income`, `cash`, `cryptocurrency`, `derivative` |
| `close_price` | number | Latest closing price |
| `close_price_as_of` | string (date) | Date of close price |
| `cusip` | string \| null | CUSIP identifier |
| `isin` | string \| null | ISIN identifier |
| `iso_currency_code` | string | Currency code |
| `enriched_sector` | string \| null | Sector classification (Plaid, CSV fallback, or user-assigned) |
| `enriched_industry` | string \| null | Industry classification |
| `enriched_allocation_category` | string \| null | User-assigned allocation bucket |

**Holdings Object Fields:**

| Field | Type | Notes |
|-------|------|-------|
| `account_id` | string | Which investment account holds this |
| `security_id` | string | References the securities array |
| `quantity` | number | Number of shares/units |
| `cost_basis` | number \| null | Total cost basis (null if Plaid doesn't provide) |
| `institution_value` | number | Value as reported by institution |
| `institution_price` | number | Per-unit price from institution |
| `institution_price_as_of` | string (date) | Date of institution price |

---

## Securities Enrichment

### `POST /api/investments/securities/<security_id>/classify`

Manually assign sector and/or industry to a security when Plaid and the static CSV don't have data.

**Request:**
```json
{
  "sector": "Technology",
  "industry": "Consumer Electronics"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sector` | string | no | Must match one of the 22 Plaid sectors (use `/vocabulary` to get the list) |
| `industry` | string | no | Must match a valid industry |

**Response `200`:**
```json
{
  "message": "Security classified",
  "security_id": "sec_abc123",
  "enriched_sector": "Technology",
  "enriched_industry": "Consumer Electronics"
}
```

---

### `GET /api/investments/vocabulary`

Get the controlled vocabulary of sectors and industries for security classification.

**Response `200`:**
```json
{
  "sectors": [
    "Basic Materials",
    "Communication Services",
    "Consumer Cyclical",
    "Consumer Defensive",
    "Energy",
    "Financial Services",
    "Healthcare",
    "Industrials",
    "Real Estate",
    "Technology",
    "Utilities"
  ],
  "industries": [
    "Aerospace & Defense",
    "Agricultural Inputs",
    "Asset Management",
    "Auto Manufacturers",
    "Banks - Diversified",
    "Biotechnology",
    "Consumer Electronics",
    "..."
  ]
}
```

There are ~22 sectors and 150+ industries. The frontend should use these as dropdown options — no free-text entry.

---

## ETF Exposure

### `GET /api/investments/etf-exposure`

Get implied exposure through ETF holdings. Shows what companies the user is actually exposed to.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `tickers` | string | yes | Comma-separated ETF tickers (e.g., `"VOO,QQQ,VTI"`) |
| `values` | string | no | Comma-separated market values for each ticker (for weighted exposure) |

**Response `200`:**
```json
{
  "recognized": ["VOO", "QQQ"],
  "unrecognized": ["ARKK"],
  "exposure": [
    {
      "company_ticker": "AAPL",
      "company_name": "Apple Inc.",
      "total_implied_value": 5432.10,
      "contributing_etfs": [
        { "etf_ticker": "VOO", "weight_pct": 6.5, "implied_value": 3250.00 },
        { "etf_ticker": "QQQ", "weight_pct": 8.2, "implied_value": 2182.10 }
      ],
      "also_held_directly": true
    }
  ]
}
```

---

### `POST /api/investments/etf-holdings`

Contribute top holdings data for an ETF that's not in the system.

**Request:**
```json
{
  "etf_ticker": "ARKK",
  "etf_name": "ARK Innovation ETF",
  "holdings": [
    { "ticker": "TSLA", "name": "Tesla Inc.", "weight_pct": 10.5 },
    { "ticker": "ROKU", "name": "Roku Inc.", "weight_pct": 7.2 },
    { "ticker": "SQ", "name": "Block Inc.", "weight_pct": 6.8 }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `etf_ticker` | string | yes | ETF's ticker symbol |
| `etf_name` | string | yes | Full name |
| `holdings` | array | yes | Top holdings with weights |
| `holdings[].ticker` | string | yes | Underlying company ticker |
| `holdings[].name` | string | yes | Company name |
| `holdings[].weight_pct` | number | yes | Weight percentage in the ETF |

**Response `201`:**
```json
{
  "message": "ETF holdings saved",
  "etf_ticker": "ARKK"
}
```

User-contributed data gets `user_created: true` flag. System-seeded ETF data cannot be overwritten.

---

## Allocation Categories

User-defined portfolio allocation buckets (e.g., "Large Growth", "International Bonds") with target percentages.

### `GET /api/investments/allocation-categories`

**Response `200`:**
```json
{
  "categories": [
    {
      "id": 1,
      "category_name": "Large Growth",
      "target_pct": 30.00,
      "sort_order": 1
    },
    {
      "id": 2,
      "category_name": "International",
      "target_pct": 20.00,
      "sort_order": 2
    }
  ]
}
```

### `POST /api/investments/allocation-categories`

Create a new allocation category.

**Request:**
```json
{
  "category_name": "Bonds",
  "target_pct": 15.00
}
```

**Response `201`:** Created category object.

### `PUT /api/investments/allocation-categories/<category_id>`

Update an allocation category.

**Request:**
```json
{
  "category_name": "Fixed Income",
  "target_pct": 20.00,
  "sort_order": 3
}
```

**Response `200`:** Updated category object.

### `DELETE /api/investments/allocation-categories/<category_id>`

Delete an allocation category. Securities assigned to it become "Unassigned."

**Response `200`:**
```json
{
  "message": "Allocation category deleted"
}
```

---

## Security-to-Allocation Assignment

### `POST /api/investments/securities/<security_id>/allocate`

Assign a security to a user-defined allocation category.

**Request:**
```json
{
  "category_name": "Large Growth"
}
```

**Response `200`:**
```json
{
  "message": "Security allocated",
  "security_id": "sec_abc123",
  "enriched_allocation_category": "Large Growth"
}
```

---

## Allocation Summary

### `GET /api/investments/allocation-summary`

Get the drift analysis: target vs actual allocation for each category.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `account_ids` | string | no | Comma-separated account IDs to include (omit for all) |

**Response `200`:**
```json
{
  "summary": [
    {
      "category_name": "Large Growth",
      "target_pct": 30.00,
      "actual_pct": 34.20,
      "delta_pct": 4.20,
      "actual_value": 33516.00
    },
    {
      "category_name": "International",
      "target_pct": 20.00,
      "actual_pct": 15.80,
      "delta_pct": -4.20,
      "actual_value": 15484.00
    },
    {
      "category_name": "Unassigned",
      "target_pct": 0,
      "actual_pct": 5.00,
      "delta_pct": 5.00,
      "actual_value": 4900.00
    }
  ],
  "total_portfolio_value": 98000.00
}
```

`delta_pct` = `actual_pct - target_pct`. Positive = overweight, negative = underweight. Color-code in the UI: green (within 2%), amber (2–5%), red (>5%).

---

## Viewer Settings

### `GET /api/investments/settings`

Fetch investment page display preferences.

**Response `200`:**
```json
{
  "optional_fields": ["cost_basis", "gain_loss", "sector", "industry"],
  "field_order": ["ticker", "name", "type", "quantity", "price", "value"]
}
```

### `POST /api/investments/settings`

Save investment page display preferences.

**Request:**
```json
{
  "optional_fields": ["cost_basis", "sector"],
  "field_order": ["ticker", "name", "quantity", "value"]
}
```

**Response `200`:**
```json
{
  "message": "Settings updated"
}
```

---

## Migration Notes for React + IndexedDB

### IndexedDB Schema for Investments
```
Object Store: holdings
  keyPath: auto-increment
  Indexes: account_id, security_id, plaid_item_id

Object Store: securities
  keyPath: "security_id"
  Indexes: ticker_symbol, type, enriched_sector

Object Store: allocation_categories
  keyPath: "id"
```

### Pool vs Account Mode
The two display modes (pool all accounts vs individual account selection) are purely frontend logic:

**Pool mode:**
- Group holdings by `security_id` (ticker).
- Sum `quantity` and `institution_value` across accounts.
- Expandable sub-rows show per-account breakdown.

**Account mode:**
- Group by `account_id` first, then list securities within each.
- Account header shows total market value.

### Charts
Use Chart.js (already in the vanilla app). In React, wrap with `react-chartjs-2`:
- **By Type pie chart:** Group securities by `type`, sum values.
- **By Sector pie chart:** Group by `enriched_sector`, sum values. "Uncategorized" for null sectors.
- **Allocation Drift bar chart:** One horizontal bar per allocation category. Two bars per row (target muted, actual vivid). Delta label color-coded.

### Enrichment Workflow
Securities without sector/industry show an "Assign" link. On click:
1. Show a dropdown populated from `GET /vocabulary`.
2. On save, call `POST /securities/{id}/classify`.
3. Update the security in IndexedDB.
4. Refresh the charts.
