# Personal Finance App — Development Plan (Frontend)

This document covers the frontend roadmap and shared app context. For backend architecture, database design, and backend TODOs see [BACKEND_DEVELOPMENT_PLAN.md](BACKEND_DEVELOPMENT_PLAN.md).

---

## App Purpose & Scope

Personal-use financial tracking app. The user is the **only user**. Deployed locally with an ngrok tunnel for Plaid webhooks.

**Core use case**: 1. Allow user to monitor spending and be alerted to surprise transactions. 2. Track scheduled bills, any future transactions user knows about, and account balances to ensure that checking accounts don't go negative, warning user via email if they are at risk. 3. Export monthly category summaries, transactions history, and account balance snapshots to feed into an external Excel budget system. This app does **not** and will **not** handle:
- Net worth calculations or trending
- Retirement planning
- Budgeting or spending targets
- Any multi-user features

**Key deliverables**: 1. account-by-account transaction and balance monitoring UI. 2. bill tracking with scheduled transactions system. 3. Month-end balance snapshots and category summaries in exportable form (CSV/JSON).

---

## Architecture Overview

- **Backend**: Python/Flask with blueprints, SQLAlchemy ORM, PostgreSQL — see [BACKEND_DEVELOPMENT_PLAN.md](BACKEND_DEVELOPMENT_PLAN.md)
- **Frontend**: Vanilla JS (jQuery), 6 pages, ~11k lines
- **Auth**: JWT tokens, 2FA (TOTP), session versioning
- **External**: Plaid API (transactions, investments, liabilities products)
- **Production Deployment**: Local machine → ngrok → Plaid webhooks and serve front end at bank.isaacyoung.com hosted on github pages.

---

## TODO Priority System

Codes use onion-layer prioritization:
- **1x** = Urgent — build now
- **2x** = Important — build next
- **3x** = Backlog — do when convenient
- **4x** = Low priority / ideas

---

## Prioritized Frontend TODO Roadmap

### Tier 1 — Urgent

| Code | Location | Description |
|------|----------|-------------|


### Tier 2 — Important

| Code | Location | Description |
|------|----------|-------------|
| 2h | `index.html:116` | Account management page — new page for editing account names, custom categories, and account-level settings |

### Tier 3 — Backlog

| Code | Location | Description |
|------|----------|-------------|

| 3d | `transactions/` | Frontend transaction search bar (UI complement to backend 2g) |
| 3e | `investments.js:523` | Filter holdings by securities category |
| 3f | `transactions/table-renderer.js` | Move delete button to icon in description column |

### Tier 4 — Ideas / Low Priority

| Code | Location | Description |
|------|----------|-------------|
| 4a | `index.html:18` | Demo mode — sandbox Plaid accounts for portfolio/friend sharing |
| 4b | `investments.html:23` | Investments page mirrors transactions.html layout with sidebar + main content |
| 4c | `transactions/table-renderer.js` | **Transaction matching** — scheduled transactions become manual on their date; app auto-detects duplicates between manual and Plaid transactions, shows matched-transaction badge with approve/unmatch modal. (Blueprint feature, deferred to Tier 4 because it depends on Calendar/Bills module 2i.) |

---

## Execution Phases (Frontend)

### Phase 2: Transactions Page Overhaul

Phase 2 is a full rework of the transactions frontend to match the [Transactions Page Blueprint](docs/page-blueprints/transactions.md). It covers modularization, layout restructuring, and the remaining Tier 1 deliverables. Work is sequenced so each step produces a testable, non-broken state.

#### 2-A. Modularize transactions.js (Done)

Broke the monolithic `transactions.js` (4 500 lines) into the module map defined in the blueprint. Deleted three duplicate function pairs, removed dead variables, separated API+DOM functions. All 14 files under `transactions/` plus `transactions.html` script tags in dependency order.

**Target file map** (all under `Personal_Finance_Frontend/transactions/`):

| File | Responsibility | Approx current lines moving in |
|------|----------------|-------------------------------|
| `main.js` | Page bootstrap, jQuery ready block, global listener wiring. Orchestrates modules — no business logic. | L133–278 |
| `state.js` | All shared mutable state (accounts, transactions, filters, tokens, chart state, split state). Single source of truth imported by every other module. | L3–23, L2669–2677, L3913–3915 |
| `api.js` | Every `authenticatedFetch` call — pure request/response, no DOM. Auth helpers (`refreshAccessToken`, `authenticatedFetch`, `resetIdleTimeout`, `setupActivityListeners`, `logout`). | L25–131, network portions of L393, L454, L478, L762–915, L1399, L1745, L2024, L2394, L2430–2490, L3524, L3592, L3780, L3875, L4282, L4356, L4427 |
| `accounts-sidebar.js` | Sidebar rendering, account grouping, selection, rename prompt, activation, manual account modal. | L393–558, L567–757, L2102–2112, L2394–2428, L4411–4494 |
| `filters.js` | Date/account/category/toggle filtering logic, quick-range helpers, dynamic period buttons. Pure input → output where possible. | L279–391, L2265–2380, L3190–3267 |
| `table-renderer.js` | Transaction table build, row HTML, split-child rows, inline category input hookup, memo field hookup. (The current `renderTransactionTable` is ~481 lines — break into sub-helpers during move.) | L916–1397 |
| `insights.js` | Spending insight calculations and panel render. | L2523–2663 |
| `chart.js` | Category aggregation, Chart.js lifecycle, primary/detailed toggle, color palette. | L2669–2858 |
| `categories.js` | Category parsing/formatting, autocomplete, override/rule action handlers, taxonomy lookup, filter dropdown population. Consolidate the three duplicate function pairs here. | L1458–2100, L2862–3604 (de-duped) |
| `manual-transactions.js` | Manual transaction modal, validation, create/delete flows. | L3669–3909 |
| `split-transactions.js` | Split modal, row management, split-specific autocomplete, validation, create/modify/delete. | L3910–4375 |
| `settings.js` | Load / apply / save viewer settings, optional field toggling. | L2430–2521 |
| `export.js` | JSON/CSV generation, clipboard copy, download actions. | L2114–2260 |
| `utils.js` | `escapeHtml`, `formatCategoryDisplay`, `showStatus`, `clearStatus`, `showConfirmationDialog`, `openModal`, `closeModal`, `getDateRange`, and any other small pure helpers. | L2382–2393, L3306–3340, L3461–3500, L4376–4407 |

**File ownership rules** (from blueprint):
- DOM rendering stays out of `api.js`.
- Network calls stay out of render modules.
- Filter logic is pure (input → output) where possible.
- `main.js` stays thin — orchestrate, don't implement.

**Modularization approach**: Use plain `<script>` tag ordering (no bundler) for now. Modules communicate through shared `state.js` globals loaded first. `transactions.html` will load scripts in dependency order. If a bundler is introduced later, the module boundaries are already clean.

**Cleanup during move**:
- Delete the three duplicate function pairs (keep the authoritative version of each).
- Remove dead variables (`synced`, `syncing` appear unused).
- Separate mixed API+DOM functions into a pure API call in `api.js` and an orchestrating wrapper in the owning module.



| Change | Detail |
|--------|--------|
| **Config → modal popup** | Replaced inline collapsible config panel with `#config-modal`. Timezone and optional field checkboxes inside. Open via ⚙ button, close via ✕ or Close. |
| **Filtering strip** | Persistent horizontal strip: date range inputs, Earliest/MTD/Last Month quick-range, category dropdowns, Quick Select period buttons, and Hide transfers / Overrides only toggles — all on one compact row. |
| **Action buttons row** | Compact Re-sync + Manual Txn buttons above scroll pane; ⚙ settings gear on right. |
| **Insights panel** | Compact single-row cards below filter strip: Total Spending, Top Category, Average Transaction, Largest Purchase, and 📊 Chart click-to-open card. |
| **Transaction scroll pane** | Internal scrollable region with sticky table header. Tighter row padding (5px 10px) and 13px font for maximum data density. |
| **Export bar along bottom** | Three groups (Transactions, Balance Summary, Category Summary) each with JSON/CSV/Copy CSV buttons. Balance and Category groups placeholder-disabled for Phase 2-E. |
| **Chart modal** | Wider modal (`min(800px, 92vw)`) with Primary/Detailed toggle and Chart.js pie chart. Opened via 📊 insight card click. |
| **Extra: Negative balance coloring** | Sidebar account balances turn red when negative (credit cards, loans, etc.). |
| **Extra: Compact category action buttons** | Override/Rule/Split buttons shrunk to 9px micro-buttons tucked under the category autocomplete. Memo Save button similarly compacted. |
| **Extra: Pending table placeholder** | Empty `#pending-table-container` div ready for Phase 2-D. |

#### 2-C. Ledger column (Done)

- Appears only when a single account is selected.
- Shows running balance per row, fetched from `Account_Balance_History` via `/api/accounts/<id>/balance-history`.
- Frontend calls `fetchBalanceHistory()` on account select, builds a txnId → running_balance lookup map in `balanceHistoryLookup` (state.js).
- Table renderer looks up each transaction's running balance from the map. Negative balances styled red.
- Split transactions: top child row shows the parent's running balance; remaining children show "—".
- Backend balance-history endpoint limit raised from 1000 → 10000 for ledger use.
- When pending transactions are displayed (Phase 2-D), the ledger will show available balance.

#### 2-D. Pending transactions display (Done)

- Dedicated "Show Pending" toggle in config modal (separate from optional column checkboxes).
- When enabled AND pending transactions exist, they render in a muted `<tbody class="pending-tbody">` above posted rows within the same `<table>` — single shared header, no duplication.
- Each pending row has amber "Pending" badge in description cell, muted opacity, warm-tinted background.
- Separator row between pending and posted sections: "▲ N Pending Transactions Above ▲".
- Ledger column extended for pending rows: projects forward from account's `current_balance` by walking pending txns in balance-engine order (date ASC, txn_id ASC) and accumulating negated amounts.
- Pending transactions excluded from spending insights and chart aggregation.
- Setting persisted via existing `transaction_viewer_settings` endpoint (`show_pending` key).
- Removed stale `showPendingCheckbox` selector from insights.js and chart.js; cleaned up dead `optionalFields.includes('pending')` column code.

#### 2-E. Month-end balance snapshot export (TODO 1i)

- Backend endpoint returns per-account balance at any user-chosen month-end date (already supported by `Account_Balance_Snapshot`).
- Frontend: export button in the bottom export bar generates account-by-account balance summary for the selected date range's end date.
- Parallel implementation on the investments page (`investments.js`).

#### 2-F. Insight card chart interaction



- **Drilldown**: clicking a primary category slice transitions to a sub-chart of that primary's detailed categories (existing TODO 3b, promoted to Phase 2 since blueprint requires it).

#### 2-G. Investment account transaction generation (TODO 1b)

- Auto-create synthetic transactions reflecting daily/periodic changes in investment holdings values.
- These flow into the balance engine like normal transactions so investment accounts show meaningful balance history.

#### Phase 2 sequencing

| Step | Depends on | Deliverable |
|------|-----------|------------|

| 2-E (snapshot export) | 2-A, 2-B | Month-end balance export buttons in export bar |

| 2-G (investment txns) | 2-C | Synthetic investment transactions for balance history |

### Frontend Next Steps

| Step | Depends on | Deliverable |
|------|-----------|------------|


| 2-G (investment txns) | 2-C | Synthetic investment transactions for balance history |
| Transaction search UI (3d) | — | Client-side search bar filtering across all transaction fields (no backend needed) |
| Account management page (2h) | — | New page for account names, categories, settings |
| Investments layout (4b) | — | Mirror transactions.html sidebar + main content layout |

---

## Critical Frontend Files
- [Personal_Finance_Frontend/config.js](../Personal_Finance_Frontend/config.js) — backend URL, auto-login
- [Personal_Finance_Frontend/transactions.html](../Personal_Finance_Frontend/transactions.html) — page shell, mount points, modal containers, script includes
- [Personal_Finance_Frontend/transactions.css](../Personal_Finance_Frontend/transactions.css) — layout, filter strip, scroll pane, export bar, modal styles
- [Personal_Finance_Frontend/transactions/](../Personal_Finance_Frontend/transactions/) — 14 modular JS files (state, api, filters, table-renderer, insights, chart, categories, etc.)
- [Personal_Finance_Frontend/investments.js](../Personal_Finance_Frontend/investments.js) — holdings UI
- [Personal_Finance_Frontend/categories.js](../Personal_Finance_Frontend/categories.js) — category management UI
