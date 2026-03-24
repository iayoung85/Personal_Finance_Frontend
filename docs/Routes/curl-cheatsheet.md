# curl Cheatsheet — Local Dev

> **TL;DR** — In the local sandbox environment every `@require_auth` endpoint is
> wide open from `localhost`. No token, no login, just `curl`.

---

## Why it works

The `require_auth` decorator has a dev-only bypass
(`src/common/decorators.py`).  When **all three** conditions are true the
decorator skips JWT verification and injects `user_1` automatically:

| Condition | How it's met locally |
|---|---|
| `RUNNING_ON_RAILWAY` is falsy | Not set on your machine |
| Request comes from loopback (`127.0.0.1` / `::1`) | You're curling `localhost` |
| `LOCAL_ALWAYS_LOGGED_IN=true` **or** `PLAID_ENV=sandbox` with no `Authorization` header | `APP_ENV=dev` defaults `LOCAL_ALWAYS_LOGGED_IN` to `true` |

**Important:** Requests arriving through ngrok carry an external IP after
ProxyFix, so the bypass does **not** fire for tunnel traffic — those must
authenticate normally with a JWT.

---

## Base URL

```
http://localhost:5501
```

(`5501` is the default `SANDBOX_PORT` when `APP_ENV=dev`.)

---

## Quick examples

### Accounts

```bash
# List all accounts
curl http://localhost:5501/api/accounts

# Get one account
curl http://localhost:5501/api/accounts/42

# Create a manual account
curl -X POST http://localhost:5501/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Checking","type":"depository","subtype":"checking","balance":1500.00}'

# Rename
curl -X PUT http://localhost:5501/api/accounts/42 \
  -H "Content-Type: application/json" \
  -d '{"name":"Renamed Checking"}'

# Delete
curl -X DELETE http://localhost:5501/api/accounts/42
```

### Transactions

```bash
# Fetch all (paginated)
curl "http://localhost:5501/api/transactions?page=1&per_page=50"

# Fetch with filters
curl "http://localhost:5501/api/transactions?account_id=3&start_date=2025-01-01&end_date=2025-12-31"

# Create a manual transaction
curl -X POST http://localhost:5501/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": 3,
    "date": "2026-03-20",
    "amount": -42.50,
    "description": "Test purchase",
    "category": "Shopping"
  }'

# Update
curl -X PUT http://localhost:5501/api/transactions/100 \
  -H "Content-Type: application/json" \
  -d '{"category":"Groceries"}'

# Bulk update
curl -X PUT http://localhost:5501/api/transactions/bulk-update \
  -H "Content-Type: application/json" \
  -d '{"transaction_ids":[100,101,102],"category":"Groceries"}'

# Delete
curl -X DELETE http://localhost:5501/api/transactions/100

# Sync (pull latest from Plaid)
curl -X POST http://localhost:5501/api/transactions/sync
```

### Categories

```bash
# List all categories
curl http://localhost:5501/api/categorization/categories

# Override a transaction's category
curl -X PUT http://localhost:5501/api/categorization/transactions/100/categorize \
  -H "Content-Type: application/json" \
  -d '{"category":"Dining Out"}'

# List rules
curl http://localhost:5501/api/categorization/rules

# Create a rule
curl -X POST http://localhost:5501/api/categorization/rules \
  -H "Content-Type: application/json" \
  -d '{"pattern":"STARBUCKS","category":"Coffee Shops"}'
```

### Bills

```bash
# List all bills
curl http://localhost:5501/api/bills

# Create a bill
curl -X POST http://localhost:5501/api/bills \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Netflix",
    "amount": -15.99,
    "frequency": "monthly",
    "account_id": 3,
    "day_of_month": 15,
    "category": "Subscriptions"
  }'

# Upcoming occurrences across all bills
curl http://localhost:5501/api/bills/upcoming
```

### Investments

```bash
# Sync holdings
curl -X POST http://localhost:5501/api/investments/sync

# Get holdings
curl http://localhost:5501/api/investments/holdings

# Get securities
curl http://localhost:5501/api/investments/securities

# Allocation summary
curl http://localhost:5501/api/investments/allocation/summary
```

### Balances

```bash
# Net worth
curl http://localhost:5501/api/balances/net-worth

# Manual balance snapshot
curl -X POST http://localhost:5501/api/balances/manual-balance \
  -H "Content-Type: application/json" \
  -d '{"account_id":3,"balance":2500.00,"date":"2026-03-20"}'
```

### Reports

```bash
# Balance report (monthly, last 12 months)
curl "http://localhost:5501/api/reports/balance-report?interval=monthly&months=12"

# Category report
curl "http://localhost:5501/api/reports/category-report?interval=monthly&months=6"
```

### Connections (Plaid)

```bash
# List connected items
curl http://localhost:5501/api/connections/items

# Item details
curl http://localhost:5501/api/connections/item_info/item_abc123

# Create link token (for Plaid Link)
curl -X POST http://localhost:5501/api/connections/create_link_token
```

### Admin

```bash
# Download logs (requires X-Admin-Secret header)
curl http://localhost:5501/admin/logs \
  -H "X-Admin-Secret: YOUR_ADMIN_SECRET" \
  -o logs.zip
```

---

## Tips
- if the server is offline, just use a quick vs code askQuestion telling me (the developer) to launch the local dev server again before continuing.
- **No `-H "Authorization: Bearer ..."`** needed for any `@require_auth`
  endpoint when curling from localhost in dev.
- **`Content-Type: application/json`** is required on all POST/PUT bodies.
- **Amounts** are signed: negative = money out (debits/purchases), positive =
  money in (credits/deposits).
- **Dates** are `YYYY-MM-DD` strings.
- **Admin routes** (`/admin/*`) use `@require_admin_secret` instead — pass
  `X-Admin-Secret` in the header or `admin_secret` in the JSON body.
- Pipe through `| jq .` for pretty output if you have jq installed.
