# Personal Finance App — Development Plan (Frontend)

This document covers the frontend roadmap and shared app context. for information on the single sourc of truth, see docs/page-blueprints/, and docs/transaction-types/

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

 | Description |
|-------------|
**Transaction matching Testing** 
- do testing of scheduled transactions become manual on their date; app auto-detects duplicates between manual and Plaid transactions, shows matched-transaction badge with approve/unmatch modal.  |
**Investment account transaction generation**
- Auto-create synthetic transactions reflecting daily/periodic changes in investment holdings values.
- These flow into the balance engine like normal transactions so investment accounts show meaningful balance history.


### Tier 2 — Important

| Code | Location | Description |
|------|----------|-------------|
 | `transactions/` | Frontend transaction search bar (UI complement to backend 2g) |
 | `investments.html:23` | Investments page mirrors transactions.html layout with sidebar + main content |

### Tier 3 — Backlog

| Code | Location | Description |
|------|----------|-------------|

 | `investments.js:523` | Filter holdings by securities category |

### Tier 4 — Ideas / Low Priority

| Code | Location | Description |
|------|----------|-------------|
| `index.html:18` | Demo mode — sandbox Plaid accounts for portfolio/friend sharing |

---

### Frontend Next Steps

| Step | Depends on | Deliverable |
|------|-----------|------------|

test transaction matching functionality thoroughlhy
 (investment txns) | Synthetic investment transactions for balance history |
| Transaction search UI  | — | Client-side search bar filtering across all transaction fields (no backend needed) |
| Investments layout  | — | Mirror transactions.html sidebar + main content layout |

---
