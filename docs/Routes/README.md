# API Route Reference — Frontend Developer Manual

> **Audience:** Frontend engineers rebuilding the app in React with IndexedDB.
> **Base URL:** All endpoints are relative to the server origin (e.g., `http://localhost:5000`).
> **Auth:** Unless noted otherwise, every endpoint requires `Authorization: Bearer <jwt_token>` header.

---

## Document Index

Each file maps to one page/feature area of the frontend application:

| File | Page | Blueprint Prefix | Description |
|------|------|-------------------|-------------|
| [dashboard.md](dashboard.md) | Index / Dashboard | `/api/auth`, `/api/connections` | Auth flows, dashboard data, Plaid Link |
| [accounts.md](accounts.md) | Accounts | `/api/accounts`, `/api/balances` | Account & bank CRUD, balance management |
| [transactions.md](transactions.md) | Transactions | `/api/transactions` | Transaction viewing, manual entry, splits, transfers, import |
| [categories.md](categories.md) | Categories | `/api/categorization` | Category mappings, rules, overrides, migrations |
| [bills.md](bills.md) | Bills | `/api/bills` | Recurring bill CRUD, occurrence projection |
| [investments.md](investments.md) | Investments | `/api/investments` | Holdings, securities, ETF exposure, allocation |
| [user-settings.md](user-settings.md) | User Settings | `/api/auth` | Profile, password, 2FA, app config |
| [admin.md](admin.md) | Admin | `/admin` | Logs, webhooks, Plaid backup/restore |
| [reports.md](reports.md) | Reports | `/api/reports` | Balance & category reports |

---

## Global Conventions

### Authentication

```
Authorization: Bearer <jwt_token>
```

- Obtain `token` and `refresh_token` from `POST /api/auth/login`.
- When token expires, call `POST /api/auth/refresh` with the refresh token.
- Public (no auth): `/api/auth/login`, `/api/auth/register`, `/api/auth/registration-status`, `/api/auth/forgot_password`, `/api/auth/reset_password`, `/api/auth/health`.

### Request Format

- **JSON body:** `Content-Type: application/json`
- **File uploads:** `Content-Type: multipart/form-data` (transaction import only)
- All dates are `YYYY-MM-DD` (ISO 8601 date) unless stated otherwise.
- All datetimes are ISO 8601 with timezone (e.g., `2026-03-15T14:30:00`).

### Response Format

All responses return JSON with `Content-Type: application/json` unless noted (file downloads, ETag 304s).

**Success:** HTTP 200/201 with JSON body.
**Errors:** HTTP 4xx/5xx with:
```json
{
  "error": "Human-readable error message"
}
```

### Status Codes Used

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 304 | Not Modified (ETag cache hit) |
| 400 | Validation error (missing/invalid fields) |
| 401 | Unauthorized / invalid token |
| 402 | Product not billed (e.g., transactions product not activated) |
| 403 | Forbidden |
| 404 | Resource not found |
| 409 | Conflict (duplicate entry) |
| 429 | Rate limited / cooldown active |
| 500 | Server error |

### Amount Convention (Ledger Sign)

All amounts follow **ledger convention**:
- **Negative** = money out (debits, expenses, payments)
- **Positive** = money in (credits, income, deposits)

This applies to transactions, bills, and balances.

### ETag Caching

`GET /api/transactions` supports ETag-based caching:
- Response includes `ETag` header.
- Send `If-None-Match: <etag>` on subsequent requests.
- If data hasn't changed, server returns `304 Not Modified` with no body.

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/auth/register` | 5/hour |
| `POST /api/auth/login` | 10/minute |
| `POST /api/auth/forgot_password` | 3/hour |
| `POST /api/auth/change-password` | 5/hour |
| `POST /api/connections/webhook` | 60/minute |
| `GET /api/accounts/*/balance-history` | 6000/hour |

---

## Key Enums & Taxonomy

### Account Categories
`depository`, `credit`, `investment`, `loan`, `asset`, `liability`

### Account Subcategories
`checking`, `savings`, `credit_card`, `taxable`, `retirement_ira`, `401k`, `mortgage`, `student_loan`, `auto_loan`, `personal_loan`, `other`

### Account Origin (immutable)
`plaid`, `manual`

### Account Connection Status (mutable)
`linked`, `dormant`, `converted`, `manual`, `relink_pending`

### Transaction Source
`plaid`, `manual`, `scheduled`, `split`, `opening_balance`, `manual_opening_balance`, `investment_trending`

### Transaction Status
`cleared`, `pending`, `future`, `missing`, `orphaned`, `matched`, `converted`

### 15 Canonical Transaction Types (source × status)

| # | Type Name | source | status | Notes |
|---|-----------|--------|--------|-------|
| 1 | PLAID_CLEARED | plaid | cleared | Bank-confirmed, downloaded from Plaid |
| 2 | PLAID_PENDING | plaid | pending | Awaiting bank posting |
| 3 | PLAID_CONVERTED | plaid | converted | Was plaid, account disconnected |
| 4 | MANUAL_CLEARED | manual | cleared | User-created, posted |
| 5 | MANUAL_ORPHANED | manual | orphaned | Manual txn unmatched after re-link |
| 6 | MANUAL_FUTURE | manual | future | User-created with future date |
| 7 | MANUAL_MATCH | manual | matched | Manual matched to plaid txn |
| 8 | MANUAL_MISSING | manual | missing | Matured manual-future, no plaid match |
| 9 | BILL_FUTURE | scheduled | future | System-generated from bill template |
| 10 | BILL_MISSING | scheduled | missing | Scheduled matured, no plaid match |
| 11 | BILL_MATCHED | scheduled | matched | Matched to plaid txn |
| 12 | SPLIT_CHILD | split | cleared | Child allocation of a split parent |
| 13 | SYSTEM_OPENING_BALANCE | opening_balance | cleared | Auto-derived, one per account |
| 14 | SYSTEM_MANUAL_OPENING_BALANCE | manual_opening_balance | cleared | Pre-OB-date txns exist |
| 15 | SYSTEM_INVESTMENT_TRENDING | investment_trending | cleared | Month-end investment performance |

### Bill Frequencies
`once`, `daily`, `weekly`, `monthly`, `twice_monthly`, `yearly`, `twice_yearly`

### Bill End Types
`never`, `on_date`, `after_occurrences`

### Category Format
Categories use the format `"Primary: Detailed"` (e.g., `"Food: Dining"`).
Transfer categories use the format `"[<account_name>]"` (e.g., `"[<Chase Savings>]"`).

---

## React + IndexedDB Migration Tips

See each route document's **"Migration Notes"** section for page-specific guidance. General advice:

1. **IndexedDB as cache, server as source of truth.** Store full transaction/account payloads in IndexedDB on first fetch, then use ETag or `since_date` for incremental sync. Never modify local data without a successful API call first.

2. **Optimistic UI with rollback.** For fast interactions (category override, memo save), update IndexedDB and UI immediately, fire the API call, and rollback on failure.

3. **React Query / TanStack Query** is ideal for managing server state with caching, background refetch, and optimistic updates. The ETag support on `GET /api/transactions` maps directly to conditional fetching.

4. **Normalize relational data in IndexedDB.** Store accounts, transactions, bills, and categories in separate object stores with indexes on `account_id`, `transaction_id`, `bill_id`, etc. This mirrors the server's relational model and enables fast lookups.

5. **Batch writes to IndexedDB.** When syncing hundreds of transactions, use IndexedDB transactions (the DB kind) to batch `put()` calls for performance.

6. **Stale-while-revalidate pattern.** Show cached data from IndexedDB instantly, then fetch fresh data in the background. Users see content immediately while the app syncs.

7. **Handle offline gracefully.** Queue mutation requests when offline and replay when connectivity returns. IndexedDB mutations should be idempotent so retries are safe.

8. **Token management.** Store JWT and refresh token in memory (React context/state) — not localStorage (XSS risk). Use an HTTP-only cookie if the server supports it, or at minimum keep tokens in a non-persistent store and refresh on page load.

9. **Split code by route.** Each page doc below maps to a React route. Lazy-load page components to keep the initial bundle small.

10. **WebSocket/polling for real-time.** The server uses webhook-driven Plaid syncs. After triggering a sync, poll `GET /api/transactions?since_date=...` or the resolution status endpoint to detect when new data arrives.
