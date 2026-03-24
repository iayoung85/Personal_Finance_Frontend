# Investments Page Blueprint (Target End State)

> **Disclaimer:** This document describes the **desired final UX and behavior** for the Investments page. It is intentionally written as an end-state blueprint, not an implementation status log.
>
> **Implementation plan:** See `docs/investments-rebuild-plan.md` for the phased build plan with task checklists.

Source reference: investments.html, investments.css, investments/ (module directory)

## Modular File Map (Vanilla JS)

- `investments.html`
  - Page shell mirroring `transactions.html` layout: page-header, main-wrapper, accounts-sidebar, main-content. Modal containers. Chart.js script tag. Script includes in dependency order.
- `investments.css`
  - Sidebar layout, holdings table, filter strip, ETF exposure panel, chart panel styles.
- `investments/state.js`
  - Shared UI/data state: `holdingsData`, `securitiesData`, `investmentAccounts`, `poolAllMode` flag, `selectedAccountIds` set, auth token helpers.
- `investments/api.js`
  - All backend calls: holdings fetch, sync, ETF exposure, security classification, ETF contribution, settings persistence, token refresh. Vanilla fetch only (no jQuery).
- `investments/main.js`
  - Page bootstrap and wiring only (initialize auth, load accounts, load holdings, bind sidebar toggle, trigger first render).
- `investments/accounts-sidebar.js`
  - Investment-only account sidebar with multi-select checkboxes, "Pool All Accounts" toggle, activate/sync buttons, rename, manage-accounts link.
- `investments/holdings-table.js`
  - Dual-mode rendering: pool mode (group by ticker) and account mode (group by account). Sortable columns. Inline "Assign" prompts for missing sector/industry.
- `investments/security-filter.js`
  - Filter by security type, sector, industry. Dropdowns populated from user's actual holdings data.
- `investments/etf-exposure.js`
  - ETF Implied Exposure panel. Synthetic exposure table for recognized ETFs. Unrecognized-ETF section with "Contribute Holdings" flow.
- `investments/chart.js`
  - Chart.js pie charts: allocation by security type and by sector. Respects current account selection and filters.
- `investments/export.js`
  - Holdings CSV/JSON export. ETF Exposure CSV export. Copy-to-clipboard.
- `investments/utils.js`
  - `formatCurrency()`, `formatDateTime()`, `derivePrice()`, `csvEscape()`, display name builder.

### File Ownership Rules
- Keep DOM rendering code out of `api.js`.
- Keep network calls out of render modules.
- Keep filter logic pure (input -> output) where possible.
- Keep `main.js` thin; it should orchestrate modules, not contain business logic.

## Purpose
A focused workspace to monitor investment holdings across all brokerage accounts, understand sector/industry exposure, see what companies ETFs actually hold, and export raw data for external rebalancing analysis.

## Page Structure
- **Page header:** Sidebar toggle button (hamburger icon + "Accounts" label), matching `transactions.html` pattern.
- **Left sidebar (sticky):**
  - "Pool All Accounts" row at top — distinct from individual account checkboxes. Triggers ticker-grouped view when active.
  - Multi-select checkboxes for individual investment accounts. Each shows: institution name, custom name (or account name), mask, active/inactive badge, last-synced timestamp.
  - Activate & Sync button for items where investments product is available but not yet billed.
  - "Manage Accounts" link navigates to `accounts.html`.
  - Sidebar toggle collapses/expands on desktop; overlay on mobile.
  - Future: custom account grouping (retirement, spouse's accounts, etc.) — deferred.
- **Main content area:**
  - **Filter strip:** Security type filter, sector filter, industry filter.
  - **Action bar:** Sync All Holdings button, export dropdown.
  - **Portfolio Breakdown panel (collapsible):** Pie charts by type and by sector.
  - **Holdings table:** Dual-mode display (see below).
  - **ETF Implied Exposure panel:** Synthetic exposure from ETF constituent data.

## Scrolling Model
- The holdings table renders inside an internal scroll pane.
- Table header remains visible during internal scrolling.

## Account Selection & Display Modes

Two mutually exclusive modes control how holdings are displayed:

**Pool All Accounts mode** (triggered by the "Pool All Accounts" toggle):
- All active investment accounts are included.
- Holdings grouped by ticker symbol across all accounts.
- Each ticker row shows: aggregated quantity, current price, total value, cost basis, gain/loss.
- Expandable detail rows show per-account breakdown (institution, account name, quantity, value).
- Summary row at bottom shows grand total portfolio value.

**Account mode** (triggered by selecting 1+ individual account checkboxes):
- Holdings grouped by account first, then by security within each account.
- Each account section header shows: account name, institution, total market value.
- Within each section, holdings listed with: ticker, name, type, quantity, price, value, cost basis, gain/loss, sector, industry.

## Holdings Table Columns
- Ticker
- Security Name
- Type (equity / etf / mutual fund / fixed income / cash / cryptocurrency / derivative)
- Quantity
- Current Price
- Total Value
- Cost Basis (when Plaid provides it)
- Gain/Loss (value minus cost basis, when cost basis is available)
- Sector (from Plaid, static CSV fallback, or user assignment)
- Industry (from Plaid, static CSV fallback, or user assignment)
- Allocation Category (user-assigned — from the user's custom allocation categories)

Sortable by clicking column headers. Default sort: total value descending.

## Securities Enrichment — Sector & Industry

Priority order for sector/industry data:
1. **Plaid-provided** — fields from the Plaid securities response (highest priority, never overwritten).
2. **Static CSV fallback** — `src/static_data/security-sector-industry.csv`, vocabulary strictly limited to Plaid's 22 sectors and 150+ industries.
3. **User-assigned** — when neither Plaid nor the CSV can classify a security, the user can assign sector/industry manually.

User assignment flow:
- Holdings with no sector/industry show an "Assign" link in the table cell.
- Clicking opens a dropdown form with sector (22 options) and industry (150+ options, optionally filtered by sector).
- On save: updates the `securities` row in the DB (`enriched_sector`, `enriched_industry` keys) and appends to the static CSV with `source=user` for backup.

Original Plaid blob data is never modified — enriched fields are stored as separate keys.

## ETF Implied Exposure Panel

Displayed below the holdings table. Shows what companies the user is actually exposed to through their ETF holdings.

**Data source:** `src/static_data/etf-top-holdings.json` — seeded with top-10 holdings for ~20 popular ETFs. Grows as users contribute data for unrecognized ETFs.

**Recognized ETFs:**
- One row per underlying company, aggregated across all held ETFs.
- Columns: company ticker, company name, total implied dollar exposure, contributing ETFs.
- Sorted by implied dollar exposure descending.
- Companies also held as direct stock positions are flagged visually ("also held directly" indicator).

**Unrecognized ETFs:**
- ETFs the user holds that are not in the static JSON are listed in a separate section.
- Each shows: ticker, name, value held, and a "Contribute Holdings" button.
- Contribution form: ticker (pre-filled), company name, rows for top holdings (ticker, name, weight %), add/remove rows.
- Submitted data is upserted into the JSON file with `user_created: true`.
- System-seeded ETF entries cannot be overwritten by user submissions.

## Charts

Three Chart.js views, toggled by button strip:
- **By Type:** Pie chart — portfolio value split across security types.
- **By Sector:** Pie chart — portfolio value split across sectors. Securities without sector data go into "Uncategorized."
- **Allocation Drift:** Grouped horizontal bar chart. One row per user-defined allocation category, sorted by the user's chosen order. Each row shows two bars: target % (muted) and actual % (vivid). A delta label on the right of each row (e.g. "+4.2%") is color-coded green/amber/red based on drift magnitude. An "Unassigned" row at the bottom captures securities not yet mapped to any category.

Charts respect current account selection and filter state.

## Allocation Categories

User-defined allocation categories (Morningstar-style buckets like "Large Growth", "International", "Bonds") with target percentages that should sum to ≤ 100%.

- **DB model:** `investment_allocation_categories` — one row per category per user. Fields: `category_name`, `target_pct`, `sort_order`.
- **Settings panel:** Accessible from the Allocation Drift chart. CRUD interface: add/edit/delete categories, reorder, running total of target %.
- **Security assignment:** Each security can be assigned to one allocation category. Stored as `enriched_allocation_category` in the security's JSON (same immutability pattern as `enriched_sector`). Holdings table shows an "Allocation" column with inline assignment dropdown.
- **Drift calculation:** For each category, sum the market value of all assigned securities → compute actual % of total portfolio → compare to target %.

## Synchronization & Export
- **Sync All Holdings** button triggers a full refresh from Plaid for all active items.
- **Export options:**
  - Holdings CSV: one row per holding with all columns (account, institution, ticker, name, type, sector, industry, quantity, price, value, cost basis, gain/loss).
  - Holdings JSON: full enriched holdings data.
  - ETF Exposure CSV: one row per implied company (ticker, name, implied exposure, contributing ETFs, also-held-directly flag).
  - Copy CSV to clipboard for quick paste into Excel.

## Settings Persistence
- Column visibility preferences and default view mode (pool vs last-selected accounts) saved via `Investment_Viewer_Settings` model.
- Account rename via `PATCH /api/accounts/:id`, same pattern as transactions sidebar.

## UX Guardrails
- Keep account selection immediate and predictable.
- Keep holdings table fast to scroll (internal pane with sticky header).
- Keep export options simple and sync with transaction page export patterns.
- ETF exposure panel is clearly labeled as implied/synthetic — never mixed with real holdings.
- Sector/industry assignment validates against controlled vocabulary — no free-text.
- Allocation drift chart shows the gap — it does not compute rebalancing recommendations. The user decides what action to take.
- Allocation categories are fully user-defined — no system-imposed taxonomy. The user decides which Morningstar-style (or personal) buckets to create.
