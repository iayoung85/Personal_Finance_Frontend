# Reports Page — API Routes

> **Page:** Balance and category reports with date range and interval controls
> **Blueprint:** `reports` (`/api/reports`)

---

## Endpoints

### `GET /api/reports/balance`

Generate a balance report across accounts for a date range, grouped by time interval.

**Query Parameters:**

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `start_date` | string (date) | yes | — | Report start (YYYY-MM-DD) |
| `end_date` | string (date) | yes | — | Report end (YYYY-MM-DD) |
| `interval` | string | no | `"monthly"` | Grouping interval: `"monthly"` or `"yearly"` |
| `hide_zero_balance` | boolean | no | `false` | Exclude accounts with $0 balance throughout the period |
| `include_archived` | boolean | no | `false` | Include archived accounts |

**Response `200`:**
```json
{
  "periods": [
    {
      "period": "2026-01",
      "accounts": {
        "acc_f899f70a1e73": {
          "account_name": "Chase Checking",
          "bank_name": "Chase",
          "balance": "5200.00",
          "account_category": "depository"
        },
        "acc_xyz": {
          "account_name": "Savings",
          "bank_name": "Chase",
          "balance": "10000.00",
          "account_category": "depository"
        }
      },
      "total": "15200.00"
    },
    {
      "period": "2026-02",
      "accounts": { ... },
      "total": "15432.10"
    }
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `periods` | array | One entry per time interval |
| `periods[].period` | string | `"YYYY-MM"` for monthly, `"YYYY"` for yearly |
| `periods[].accounts` | object | `{ account_id → { account_name, bank_name, balance, account_category } }` |
| `periods[].total` | string (decimal) | Sum of all account balances for this period |

Use this to build:
- **End-of-month balance tables** — one row per period, columns per account.
- **Net worth over time charts** — plot `total` over periods.
- **Per-account balance trends** — plot individual account balances over time.

---

### `GET /api/reports/category`

Generate a category spending/income report for a date range, grouped by time interval.

**Query Parameters:**

| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `start_date` | string (date) | yes | — | Report start (YYYY-MM-DD) |
| `end_date` | string (date) | yes | — | Report end (YYYY-MM-DD) |
| `interval` | string | no | `"monthly"` | Grouping: `"monthly"` or `"yearly"` |
| `include_transfers` | boolean | no | `false` | Include transfer transactions in the report |

**Response `200`:**
```json
{
  "periods": [
    {
      "period": "2026-01",
      "income": "4500.00",
      "expenses": "-3200.00",
      "by_category": {
        "Food: Dining": {
          "total": "-450.00",
          "count": 12
        },
        "Food: Groceries": {
          "total": "-680.00",
          "count": 8
        },
        "Housing: Rent": {
          "total": "-1500.00",
          "count": 1
        },
        "Income: Salary": {
          "total": "4500.00",
          "count": 2
        }
      }
    }
  ],
  "summary": {
    "total_income": "9000.00",
    "total_expenses": "-6400.00",
    "net": "2600.00",
    "category_totals": {
      "Food: Dining": "-900.00",
      "Food: Groceries": "-1360.00"
    }
  }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `periods` | array | One entry per time interval |
| `periods[].period` | string | `"YYYY-MM"` for monthly, `"YYYY"` for yearly |
| `periods[].income` | string (decimal) | Total positive amounts |
| `periods[].expenses` | string (decimal) | Total negative amounts |
| `periods[].by_category` | object | `{ category → { total, count } }` per period |
| `summary` | object | Aggregated totals across all periods |
| `summary.total_income` | string (decimal) | Grand total income |
| `summary.total_expenses` | string (decimal) | Grand total expenses |
| `summary.net` | string (decimal) | Income + expenses |
| `summary.category_totals` | object | `{ category → grand total }` |

Use this to build:
- **Monthly category summary tables** — rows per category, columns per month.
- **Spending trend charts** — plot expenses over time.
- **Income vs. expenses comparison** — stacked bar: income vs expenses per period.
- **Category pie charts** — from period-level `by_category`.
- **Fiscal year summaries** — set `interval=yearly`.

---

## Migration Notes for React + IndexedDB

### Report Data is Computed, Not Cached
Reports are computed from live transaction data on each request. Do **not** store report results in IndexedDB — they become stale immediately when transactions change. Instead:
- Fetch report data on demand when the user navigates to the reports page.
- Show a loading state while computing.
- Cache in React state for the current session only.

### Date Range Controls
Build a reusable date range picker component with presets:
- Last 30 days
- Month to date
- Last month
- Year to date
- Last year
- Last 12 months
- Custom range

### Export from Reports
The transactions page has export buttons for CSV/JSON of report data. In the React app, you can generate these client-side from the report response data — no separate export endpoint needed.

### Chart Recommendations
- **Net worth over time:** Line chart using balance report periods.
- **Spending by category:** Pie chart from category report `by_category`.
- **Income vs expenses:** Grouped bar chart with income/expense bars per period.
- **Category trends:** Multi-line chart showing top categories over time.

Use Chart.js with `react-chartjs-2` or Recharts for React-native charting.
