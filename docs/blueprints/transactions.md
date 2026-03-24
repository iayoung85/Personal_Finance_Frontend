# Transactions Page Blueprint (Target End State)

> **Disclaimer:** This document describes the **desired final UX and behavior** for the Transactions page. It is intentionally written as an end-state blueprint, not an implementation status log.
>
> **Schema reference:** See Transaction model docstring in `src/modules/transactions/transactions_models.py` for the blueprint type table and column-level encoding.

Source reference: transactions.html, transactions.js, transactions.css

## Modular File Map (Vanilla JS Target)

- `transactions.html`
  - Page shell, mount points, modal containers, script includes.
- `transactions.css`
  - Layout, sticky regions, table styles, modal styles, chart/insight styling.
- `transactions/main.js`
  - Page bootstrap and wiring only (initialize app, bind global listeners, trigger first load).
- `transactions/state.js`
  - Shared UI/data state (selected account mode, filters, transactions cache, chart mode).
- `transactions/api.js`
  - All backend calls (auth fetch, sync, fetch transactions, settings, manual/split/category endpoints).
- `transactions/accounts-sidebar.js`
  - Sidebar rendering, account grouping, selection, rename, activation, manual account button behavior.
- `transactions/filters.js`
  - Date/account/category/toggle filtering logic and quick-range helpers.
- `transactions/table-renderer.js`
  - Transaction table rendering and row-level interactions (category input, memo save, delete buttons).
- `transactions/insights.js`
  - Spending insight calculations and insights panel render.
- `transactions/chart.js`
  - Category chart aggregation, mode toggle (primary/detailed), chart lifecycle.
- `transactions/categories.js`
  - Category parsing/formatting, autocomplete lists, override/rule action handlers.
- `transactions/manual-transactions.js`
  - Manual transaction modal, validation, create/delete flows.
- `transactions/split-transactions.js`
  - Split modal, validation, create/modify/delete split workflows.
- `transactions/settings.js`
  - Load/apply/save viewer settings, optional field selection behavior.
- `transactions/export.js`
  - JSON/CSV generation, clipboard/export download actions.
- `transactions/utils.js`
  - Shared helpers (date formatting, currency formatting, escaping, small pure helpers).
- `transactions/context-menu.js`
  - Right-click context menu on transaction rows: type-dispatched action menus, action handlers.
- `transactions/inline-edit.js`
  - Click-to-edit on table cells: inline date and description editors, amount-click-opens-modal.
- `transactions/transfer-modal.js`
  - Transfer creation modal: account picker, counterpart creation, make-transfer flow.

### File Ownership Rules
- Keep DOM rendering code out of `api.js`.
- Keep network calls out of render modules.
- Keep filter logic pure (input -> output) where possible.
- Keep `main.js` thin; it should orchestrate modules, not contain business logic.

## Purpose
A single, fast workspace to review, filter, categorize, and maintain all transactions across active accounts.

## Page Structure
- **Top navigation:** links to Dashboard, Manage Categories, and Investments.
- **Left sidebar (sticky):** always visible account list and controls.
  - small settings button takes user to accounts.html (see accounts.md)
  - All Accounts summary with total current balance (not available balance)
    - button to top right "manage accounts" of the left sidebar on row with all accounts summary takes user to accounts.html.
  - Accounts grouped by type (depository, credit, investment, loan, asset, liability).
  - Per-account balance and account selection.
  
- **Main content area:**
  - Filtering tool area along the top (below navigation)
  - Just below filtering tool area: Spending insights panel
  - Reconciliation Banner and other status messages: This is a dedicated gap empty space sometimes but most of the time it shows messages indicating successful user actions. dedicated empty space because it's bad UX for the top of the transaction viewing pane to constantly jump around. the reconciliation banner Displays an alert if orphaned/missing transactions un-balanced with Plaid require review (only appears when active). 
  - Just above transactions viewing pane: Persistent re-sync with plaid, config, and manual transaction action control buttons.
  - below config and manual transaction buttons: Transaction browsing pane.
  - Along bottom: export data buttons for downloading transactions, account balance summaries for user selected date, or category summaries with one set of buttons for each: csv, json, copy csv.

## Transaction Viewing Pane scrolling model
- The transactions list renders inside an internal scroll pane (large sub-window which takes up approximately 75%-85% of the viewable area).
- Transaction table header remains visible during internal scrolling.

## Filtering 
- Changes to filters instantly updates transactions viewed.
- All filterng actions visible from main content area.
- Date filtering includes custom range plus quick-range shortcuts.
- Account filtering supports All Accounts and single-account focus.
- Category filtering supports primary and detailed categories.
- Additional toggles include transfer visibility, override-only visibility, and `[x] Show missing`.
- Search bar filters results to display from data in description, merchant name, category, date, memo, amount, bank name, and account name. 
  - advanced search queries supported in format like google's search system for gmail. 
  - small ? tag click button pulls up modal with advanced search querie structure.

## Insights & Visualization
- Insights cards summarize spending based on the **same active filter state** as the table. cards are:
  - Total spending, 
  - top category, 
  - average transaction, 
  - largest purchase, and 
  - a graph symbol with click on and click off functionality on the same button. 
    - displays modal of graph for expense breakdown by primary category until user moves pointer outside of modal. 
    - Graph has ability to click drilldown on primary which transitions to a subgraph of detailed categories for that primary category.
- Insights and chart update in sync with filter changes.

## Configuration
- Display as modal popup after clicking configuration button.
- Settings are persisted and restored for the user.
- User-selectable optional fields control which extra columns are shown.
  - Merchant Name
  - Show Pending
  - Authorized DateTime
  - Memo
  - Plaid's Category
- Forecast Horizon control: number input (1–365 days, default 90) determines how far into the future bills and scheduled transactions are projected. All active bills project over the same time window for consistent balance forecasting.

## Transaction Types:
- see Transaction_Type_Handling.md as the single source of truth on definitions and behaviors of transactions.

## Resolution Center:
- This center is designed for handling large volumes of Manual_orphan transactions and is only utilized by the user after relinking events. Orphaned transactions can be bulk deleted here after review with options to let user move transactions to a manual account if desired. matching engine also brings up a list of proposed matches which are matches generated with less strict matching rules.

## Linked Account Ledger Rule
Accounts that are linked to Plaid have a balance history ledger kept by the backend which does not tolerate manual transactions contaminating the synced history timespan of the account since its last connection (or reconnection/relinking) event.

**Applies to** all accounts where `connection_status='linked'`, regardless of origin:
- origin='manual', connection_status='linked' (manual bank re-linked to Plaid)
- origin='plaid', connection_status='linked' (converted bank re-linked to Plaid)
- origin='plaid', connection_status='linked' (originally linked, never disconnected)

## Transaction Viewing Pane ledger transaction history structure (single linked (or relinked) account displayed)
- Ledger is described below as a list of separate blocks delineated by key event dates: today, and date of the earliest transaction date downloaded during linking of the account. 

Date notation: 0 = today, positive = future, negative = past, and
  -a = date of the earliest transaction date downloaded during linking of the account. 
    a maximum of 2 years of transactions are downloaded during initial linking so a will be approximately 2 years in the past if there are transactions that old.
  -z = date of the oldest transaction in the ledger and could be PLAID_CLEARED or MANUAL_CLEARED

```
    scheduled future transactions block (`BILL_FUTURE` and/or `MANUAL_FUTURE`) | +1 to +n | 
    pending transactions block (`PLAID_PENDING`) | any date 
    plaid synced transactions block from most recent linking event to today (`PLAID_CLEARED`, `BILL_MISSING`, `MANUAL_MISSING`, `BILL_MATCH`, `MANUAL_MATCH`) | -a to 0
    ---- Opening Balance (SYSTEM_OPENING_BALANCE) | date = -a-1 ----
    "HISTORICAL" transaction block: (`MANUAL_CLEARED`, `PLAID_CONVERTED`, missing transactions could exist here if user never cleans them up but this is an edge case.) | -z to -a-1
    ---- Manual Opening Balance (`MANUAL_OPENING_BALANCE`) | date = -z-1 ----
```

  - In linked-account view, `BILL_MISSING` and `MANUAL_MISSING` render within the plaid synced transactions block (not as a separate block).
  - Ledger balance cell for `BILL_MISSING` and `MANUAL_MISSING` rows displays `N/A` and is excluded from running balance continuity.
  - Missing rows are visually differentiated at approximately 53% opacity and show a yellow `!` badge for alert visibility.
  - User may hide individual pending or cleared transactions that they believe will not clear or hide/unhide all in filtering. (once hidden they do not contribute to the ledger balance calc continuity)

## Transaction Viewing Pane ledger block structure (single converted account displayed)
- Ordered in blocks from future to past. Each block is a contiguous group of transactions of a certain set of transaction types, separated from other types by date boundary.

Date notation: 0 = today, positive = future, negative = past. -a = day of disconnection from plaid, -z = oldest transaction in the ledger.

```
    scheduled future transactions block (`BILL_FUTURE` and/or `MANUAL_FUTURE`) | +1 to +n | 
    block of manually created transactions (`MANUAL_CLEARED`, `BILL_MISSING`) | -a+1 to 0
    ---- Opening Balance (SYSTEM_OPENING_BALANCE) | date = -a ----
    "HISTORICAL" transaction block: collection of all transactions from most recent linking event to the earliest transaction on record. (PLAID_CONVERTED, MANUAL_CLEARED, BILL_MATCHED if user never approves matches, and MANUAL_MATCHED if user never approves matches) | -z to -a-1
    ---- Manual Opening Balance (MANUAL_OPENING_BALANCE) | date = -z-1 ----
```

## Transaction Viewing Pane ledger block structure (single manual account displayed)
- Ordered in blocks from future to past. Each block is a contiguous group of transactions of one type, separated from other types by date boundary.

Date notation: 0 = today, positive = future, negative = past,  
  -a = date of opening balance as set by user during mannual account creation process, 
  -z = date of oldest transaction in ledger

```
    scheduled future transactions block (`BILL_FUTURE` and/or `MANUAL_FUTURE`) | +1 to +n | 
    block of manually created transactions, as well as bills that haven't been marked down as paid (`MANUAL_CLEARED`, and `BILL_MISSING`) | -z to 0
    ---- System Opening Balance (`SYSTEM_OPENING_BALANCE`) | date = -a ----
    "HISTORICAL" transaction block: group of transactions created by user that predate the date set by user during account creation. |-z to -a-1
    ---- Manual Opening Balance (MANUAL_OPENING_BALANCE) | date = -z-1 ----

```
## Transaction Viewing Pane structure for linked type investment account view
- investment holdings uodates will periodically update from plaid. app functionality will enable user to view a basic performance metric of their overall investment balance over time vrs sp500. An experienced user will be sure to document all transactions involving money being deposited in or withdrawn from their investment accounts as this is critical to determining gains/losses separate from the contributions and deductions. 
- a series of historical system generated account gains/losses transactions are populated over time. 1 for the last day of each month 
- -a, -b, -c ... -y = last day of any given month in the past
- -z = syncing date.
- SYSTEM_INVESTMENT_TRENDING is a live recalc balance transaction which keeps end of month account balance the same no matter what transactions a user inserts during any given month. For example if a user inserted a -1000 debit during a month, indicating they withdrew money from their investment account, then their end of month gains were actually 1000 more than previously estimated or their end of month losses were actually 1000 less than they thought (SYSTEM_INVESTMENT_TRENDING += $1000.00)
- The current month row is treated as a projected/future ledger row (month-end dated) so users can schedule future deposits/withdrawals and still see the best current estimate for end-of-month balance.

```
    scheduled future transactions block (`BILL_FUTURE` and/or `MANUAL_FUTURE`) | +1 to +n | 
    ---- System Generated projected month-end transaction (SYSTEM_INVESTMENT_TRENDING) | date = +a ----
    block of current month's manually created transactions, as well as bills that haven't been marked down as paid (`MANUAL_CLEARED`, and BILL_MISSING) | -a+1 to 0
    ---- System Generated end of month (SYSTEM_INVESTMENT_TRENDING) | date = -a ----
    block of last month's manually created transactions, as well as bills that haven't been marked down as paid (`MANUAL_CLEARED`, and BILL_MISSING) | -b+1 to -a
    ...pattern repeats...
    ---- System Opening Balance (SYSTEM_OPENING_BALANCE) | date = -z-1 ----
```

## Transaction Viewing Pane structure transaction sorting ALL ACCOUNTS VIEW ONLY
```
    scheduled future transactions block (bill-future + manual-future) | +1 to +n
    pending transactions block (all pending in one block) | any date
  all transactions block with status:cleared plus missing statuses (`BILL_MISSING`, `MANUAL_MISSING`) (chronologically ordered)
```
- orphan transactions are hidden
- opening balances, manual opening balances and reconciliation transactions are hidden
- missing-status rows are shown in All Accounts view with the same visual treatment (approximately 53% opacity and yellow `!` badge)
- All Accounts view has no ledger balance column, so no `N/A` ledger cell is shown in this mode


## Details of scheduled future transactions block in transaction viewing pane
- Contains three visual sub-types, interleaved and sorted by date:
  - **Virtual bill-future rows** (`BILL_FUTURE`):
    - Auto-populated by the bills engine within the forecast horizon (default 90 days).
    - Visually greyed out (52% opacity) with 📅 badge to convey "theoretical / not yet confirmed".
    - Badge hover shows: "Occurrence #N of [BillName] — [schedule_summary]" (e.g. "Monthly on the 15th").
    - Right-click context menu: ✅ Mark Paid (materializes in-place as MANUAL_FUTURE), ✏️ Modify (opens edit modal, materializes transparently), ⏭ Skip Occurrence.
    - Cannot be split or transferred (no DB row to hold child/pair references).
  - **Materialized bill rows** (`MANUAL_FUTURE` with `is_bill=true`):
    - Created when a user marks paid/edits a virtual BILL_FUTURE occurrence — the virtual occurrence converts to a real DB row via the MATERIALIZE state-machine trigger.
    - Full visual prominence with 📝 badge and slightly stronger indigo accent.
    - Badge hover shows: "Confirmed #N of [BillName]".
    - Fully editable, deletable. Deleting restores the virtual occurrence.
  - **Plain manual-future rows** (`MANUAL_FUTURE` without `is_bill`):
    - Created when a user enters a manual transaction with a date > today.
    - 📅 badge, no bill metadata. Fully editable.
    - Right-click context menu includes "this is a bill" option to promote to a recurring bill template.
- All sub-types sorted together chronologically (furthest date at top, nearest at bottom).
- Frontend calculates projected balance forward through all scheduled rows. The ledger column shows italic projected amounts starting from the last pending balance (or current account balance if no pending).



## Transaction Interactions (Page-Level UX)
> **Which types support which actions (edit, delete, split, match, categorize, etc.) is governed by Transaction_Type_handling.md Part 1 and the transition/mutation CSV. This section covers only page-level interaction patterns — the controls and gestures, not the legality rules.**

- Right-click context menu options (availability per type governed by type definitions):
  - this is a bill (takes user to bills.html with +bill modal pre-filled)
  - delete transaction (same as trash icon)
  - make transfer: modal lists accounts; label says "money is coming from:" for credits, "money is going to:" for debits. Same behavior as entering [`<account_name>`] in category.
  - modify: for changing amount, date, description on manual and scheduled rows.
- **Inline cell editing** (click-to-edit, additive to the context menu modify path):
  - **Editable row keyboard flow (EDITABLE_TYPES):** Date, Description, and Amount are all inline-editable in-row. `Tab` stages the current cell edit and moves to the next editable cell for that same transaction; on the last editable cell it cycles back to the first (Shift+Tab moves backward with the same wrap). `Enter` sends one consolidated `PUT /api/transactions/manual/{id}` payload for the row with only changed fields. `Escape` cancels the inline session.
  - **Date cell click:** On EDITABLE_TYPES, clicking date overlays a date input. When tabbing away, the cell keeps the newly entered date visible so users can see the staged value before final Enter-save. Backend still owns state transitions (e.g. MANUAL_CLEARED → MANUAL_FUTURE when date moves to future) and plaid-window guards when the consolidated save is submitted.
  - **Description cell click:** On EDITABLE_TYPES, clicking description overlays a text input pre-filled with the current name and participates in the staged Tab/Enter row flow above. On PLAID_CLEARED and PLAID_PENDING, clicking description still sets `user_description_override` via `PUT /api/transactions/{id}/description` — the original plaid description is preserved in the encrypted blob.
  - **Amount cell click:** On EDITABLE_TYPES, clicking amount now uses inline editing (no modal launch). Amount edits preserve the transaction's existing sign (debit stays debit, credit stays credit) unless the user includes an explicit `+` or `-` symbol in the entered amount, which intentionally overrides sign.
  - Only one inline editor is active at a time. Clicking a different editable cell dismisses the current one without saving.
  - Non-editable types (plaid rows for date/amount, system rows, split children) show no hover affordance and ignore clicks.
- Line-by-line memo entry and save/update ability across all visible types.
- Line-by-line category override with tab-through and enter for fast sequential editing.
- Line-by-line rule creation (cleared and pending plaid rows only).
- Export options for JSON and CSV (transactions list, account balance summary report for user chosen date, or category summary report).
- Ledger column:
  - shows current balance and only appears when a single account is selected.
- Bank/Account column:
  - appears only in All Accounts view and is hidden when a single account is selected.

## UX Guardrails
- Keep primary actions visible during transaction review.
- Keep account switching immediate and predictable.
- Keep insights, chart, and table derived from one shared filter state.
- Optimize for high-volume transaction scanning with minimal scroll-jumping.

------------

# FUTURE PLANS TO FINISH CLOSING THE GAP
- **in dev** Transaction data import from Quicken.
- investigate splits behavior and limitations.. 
  - this feature feels like it's only partially implemented. splitting should be available for bill_future and manual_future transactions in all account types. plaid matches possible even if bill amounts don't exactly match. simply flag as broken split an user needs to repair. 
  - Also let manual creation build transactions as split from the getgo. can we split a transaction writing off part of the transaction as a transfer as in the example where i write a $200 loan payment and want 70% to be a transfer towards the loan balance and the remainder as a payment of interest to the bank. this last one is only a nice-to-have and perhaps not even desirable behavior. I don't know. 
  - Are transactions with amount = $0 allowed? a user might create a split transaction with total of 0 that acts as an internal accounting trick to markdown a categorization transfer of funds for budgeting. example use-case: user wants to account for $400 of income which didn't arrive in any of their accounts but automatically went to child-support expenses.
---
## BUGS:
Do a line-by-line audit of what transaction transitions are implemented and which are not and make them use the state machine.

## Important Features still missing
- Rules suggestion engine (research? what is it for?)
---

