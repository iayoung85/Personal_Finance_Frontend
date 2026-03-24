# Accounts Page Blueprint (Target End State)

> **Disclaimer:** This document describes the **desired final UX and behavior** for the Accounts page. It is intentionally written as an end-state blueprint, not an implementation status log.

Source reference: accounts.html, accounts.js, accounts.css (new page — distinct from account.html which handles user profile/auth settings but the current account.html is going to be renamed to user-settings.html. see user-settings.md)

## Modular File Map (Vanilla JS Target)

- `accounts.html`
  - Page shell, left sidebar mount (bank list + account list columns), main content mount, modal containers, script includes.
- `accounts.css`
  - Sidebar two-column layout, bank/account list styles, metadata card styles, action button styles, status badges, modal styling.
- `accounts/main.js`
  - Page bootstrap and wiring (initialize app, load banks and accounts, bind listeners).
- `accounts/state.js`
  - UI state (selected bank, selected account, sidebar filter text, accounts cache, banks cache).
- `accounts/api.js`
  - All backend calls (fetch accounts, fetch items/banks, rename, update account, archive/unarchive, reset, convert to manual, delete, Plaid Link triggers).
- `accounts/sidebar.js`
  - Two-column sidebar rendering: bank list (left column) and account list (right column), filter/search bar, selection highlighting, bank→account filtering.
- `accounts/account-detail.js`
  - Main content rendering when an account is selected: metadata card, account action buttons, action confirmation modals.
- `accounts/bank-detail.js`
  - Main content rendering when a bank is selected: bank metadata card, connection status, bank-level action buttons, convert-to-manual flow.
- `accounts/utils.js`
  - Shared helpers (currency formatting, status badge rendering, validation, confirmation dialogs).

### File Ownership Rules
- Keep DOM rendering code out of `api.js`.
- Keep network calls out of render modules.
- Keep validation logic pure (input -> output).
- Keep `main.js` thin; it should orchestrate modules, not contain business logic.
- Sidebar selection drives main content: `sidebar.js` emits selection events, `account-detail.js` and `bank-detail.js` each render their own view.

## Purpose
A centralized hub for managing all banks and accounts (Plaid-linked and manual). Users can view and act on banks (Plaid items or manual bank groups) and individual accounts within them — performing maintenance actions like rename, reset, archive, convert to manual, and manage Plaid connection lifecycle.
## Page Structure
- **Top navigation:** link back to Dashboard, link to transactions, link to investments.
- **Left sidebar (sticky):** two columns: always visible bank list on left and account list on right.
  - At top of lists: Filter/search to find account quickly by bank, account name, account type, or mask.
  - Left column bank list: all banks selector at top, banks below listed in alphabetical order
    - when all banks selected, main content area loads blank indicating select account or bank.
    - banks listed include the bank names of manual accounts created.. so silly made-up banks might be present like piggy-bank, or "My Kid's Bank"
  - clicking a bank filters the accounts list to the right, and all banks shows all accounts.
  - clicking a bank changes the view of main content area to a focus on bank specific information and settings/congif.
  - mirrors behavior of transactions.html (see transactions.md) left sidebar in principle. a complete sorted and categorized list of all accounts. minus the all accounts button
  - clicking an account brings up metadata,configs, and options for that account in main content area.

- **Main content:**
-when a single account is selected on left sidebar:
  - account metadata card showing: name, type, current balance, connection status, etc.
  - actions listed below metadata (order not set)
    - rename,
    - change account type(category),
    - retire account,
    - hide account,
    - archive account,
    - delete account and all related data,
    - reset account. 
      - get rid of all historical plaid transaction data if a plaid-transaction-account-online then start sync with fresh cursor with reset opening balance.
      - if manual-offline-account, deletes all transaction data and asks user for a new opening balance and date.
- when a bank is selected on left sidebar.
  - bank metadata card showing: name, number of accounts, origin/connection classification table, phone numbers, address, etc
  - actions listed below metadata card:
    - activate and sync transactions or activate and sync investments or indicate both are connected
    - ability to convert the plaid online bank (plaid item) to an offline manual set of bank accounts.
      - app removes the plaid item so billing stops but preserves all transaction data (transaction `source` stays immutable — plaid-sourced transactions keep `source='plaid'` as frozen history). Snapshots item metadata in case user ever wants to reconnect, then our app will have functionality in place to re-link.
      

## Account Detail View (Main Content — Account Selected)
Metadata card displays:
- Account name (custom_name if set, otherwise default institution name).
- Account type badge (depository, credit, investment, loan, asset, liability) with subcategory label (checking, savings, credit_card, 401k, mortgage, etc.).
- **Origin badge** (immutable): "Plaid" or "Manual" — how the account was born. Never changes.
- **Connection badge** (mutable): "Linked", "Converted", or "Manual" — current lifecycle state. See Account & Bank Classification below.
- **Health badge** (Plaid-linked only): "OK", "Needs Update", or "Error" — derived from Plaid item health.
- **Visibility badge** (when applicable): "Archived" — derived from `is_archived`. Shown when `is_archived=true`.
- Current balance and balance date.
- Mask (last 4 digits) if available.
- Bank name the account belongs to (clickable — navigates sidebar to that bank).
- Currency.
- Notes field (editable inline).

Classification detail table (displayed in metadata card):

| Field | Value | Meaning |
|---|---|---|
| Origin | "Plaid" or "Manual" | Where this account came from — set once at creation, never changes |
| Connection | "Linked" / "Converted" / "Manual" | Current data-entry mode — changes during convert-to-manual or re-link flows |

This makes it clear to the user that a Plaid-origin account can operate in manual mode. Example: a user connects a bank for investments, and Plaid also reports a checking account under that item. The user doesn't want to pay for the `transactions` product, so the checking account has `origin=plaid` (it was born from the Plaid Link flow) but `connection_status=manual` (the user enters transactions by hand). The Plaid heritage is preserved — if they later decide to activate transaction syncing, the account can flip to `connection_status=linked` without losing its history.

### Account Actions (Detail)
Actions render as a list below the metadata card. Each destructive action requires a confirmation dialog.
- **Rename:** edit custom_name inline or via small edit form. Saves immediately.
- **Change account type (category):** dropdown to reassign account_category and account_subcategory. Does not affect transaction data.
- **Archive account:** sets is_archived=true. Archived accounts are hidden from dashboard totals, transactions sidebar, and investments page. Data is fully preserved. If parent bank is linked, Plaid keeps syncing in the background (data stays fresh for when the user unarchives). If parent bank is NOT archived, the account still appears in the accounts.html sidebar under its bank. Reversible.
- **Unarchive account:** sets is_archived=false. Account reappears in all active views. Reversible.
- **Delete account and all related data:** hard delete — removes the account, all its transactions, balance history, and snapshots. Requires typed confirmation (e.g., "delete my-account-name"). Irreversible.
- **Reset account:**
  - Plaid account: deletes all historical Plaid transaction data, resets the sync cursor, and re-derives opening balance from the next sync. Confirmation required.
  - Manual account: deletes all transaction data and prompts the user for a new opening balance amount and date. Confirmation required.
- **ⓘ Info buttons:** each action that might confuse the user (archive vs delete, reset implications) has a small info tooltip or expandable help text explaining exactly what happens, what data is affected, and whether the action is reversible.

## Bank Detail View (Main Content — Bank Selected)
Metadata card displays:
- Bank/institution name with badges (origin, connection, health, archived).
- Total balance (sum of child accounts).
- Number of accounts under this bank (with breakdown: active vs archived).
- Website link (from Plaid institution metadata, when available).
- Created date.

Contact Info section (editable inline):
- **Phone** — user-editable input field. Placeholder shows Plaid-sourced phone if available. A "call" link (📞) appears when a phone number is set. Stored in `Bank.user_phone` (user override > Plaid institution phone).
- **Address** — user-editable input field. Placeholder shows Plaid-sourced address if available. Stored in `Bank.user_address`.
- Why: Users want quick access to their bank's contact info (e.g., the number on the back of their credit card). Plaid may or may not supply this, so users can always enter their own.
- Save button persists both fields via PATCH.

Accounts Under This Bank: compact list of child accounts with balances, clickable to navigate.

Notes field (editable inline, same as before).

Connection & Technical Details (collapsible `<details>` section — hidden by default):
- Classification table: Origin badge + meaning, Connection badge + meaning, Health badge (if linked).
- Technical IDs: Institution ID, Plaid Item ID (only shown when applicable).
- Plaid billing info: Billed products, last webhook timestamp.
- Routing numbers (from Plaid institution metadata).
- This section exists for power users / debugging — most users never need to expand it.

For manual bank groups with no Plaid heritage: the collapsible section is omitted entirely.

### Bank Actions (Detail)
Actions render as a list below the bank metadata card.
- **Activate and sync transactions:** for Plaid items — initiate or confirm that transaction syncing is active for this item. Badge indicates current state.
- **Activate and sync investments:** for Plaid items — initiate or confirm that investment syncing is active. Badge indicates current state.
- **Relink bank:** trigger Plaid Link update flow to repair a broken connection (item with `needs_update` or `error` status). Only appears when connection is unhealthy. Also available for **manual banks with `institution_id` set** (shown as "Link to Plaid" on the dashboard) — initiates a fresh Plaid Link session scoped to the bank's known institution so the user goes directly to the login page (no institution picker). On success, the bank transitions from `manual` → `linked`.
- **Add new account from this bank:** for Plaid items with `new_accounts_available=true`, trigger Plaid Link update mode to pull in newly detected accounts.
- **Convert bank to manual (Plaid items only):**
  - Removes the Plaid item from Plaid's API so billing stops immediately.
  - Preserves ALL transaction data — transaction `source` stays immutable (`source='plaid'` remains as frozen history; it records where the data came from, not the bank's current mode).
  - Snapshots item metadata (`institution_id`, `institution_name`, `billed_products`, `consented_products`) into `Bank.preserved_item_metadata` so the app can offer a well-informed re-link flow in the future.
  - Bank's `connection_status` flips from `linked` → `converted`. `origin` stays `plaid` forever.
  - All child accounts' `connection_status` flips to `converted`. New transactions for these accounts are entered manually.
  - Confirmation dialog explains: "Billing will stop. All your existing transaction history is preserved. You can re-link this bank to Plaid at any time."
- **Archive bank (applies to any bank):** same as convert-to-manual (if it was a plaid item), plus sets `is_archived=true` on the bank and all its accounts, hiding transaction and investment data from active views. Use when the user has closed the bank or simply wants it shelved. Data is fully preserved. The bank and its accounts appear in the collapsed "Archived" group on accounts.html. Reversible via unarchive.
- **Unarchive bank (any archived bank):** flips `is_archived=false` on bank and all child accounts. Visibility toggle only — does not change connection_status. A converted bank stays converted.
- **Rename bank group (manual banks only):** rename the institution label used to group manual accounts.
- **Hard delete bank:** permanently removes the bank, all its accounts, all transactions, balance history, and snapshots. Requires typed confirmation (e.g., "delete Chase"). Irreversible. This is the nuclear option — only for when the user truly wants all data gone.
- **ⓘ Info buttons:** each action has a tooltip or expandable help text explaining what happens, what data is affected, and whether the action is reversible. Critical for distinguishing convert vs archive vs delete.

## Account & Bank Classification System

Banks and accounts use a **composite badge system** built from independent dimensions. This replaces the old flat badge list and maps directly to the `origin` + `connection_status` columns in the database schema.

### Origin Badge (immutable — set once at creation)
| Badge | Meaning | When set |
|---|---|---|
| **"Plaid"** (purple) | Created from a Plaid Link connection | During Plaid onboarding — even if the account never activates a billable product |
| **"Manual"** (gray) | Created by the user | During manual account creation |

`origin` never changes. A Plaid-origin bank that gets converted to manual still shows "Plaid" origin — it records heritage, not current behavior.

### Connection Badge (mutable — changes during lifecycle transitions)
| Badge | Meaning | `connection_status` value |
|---|---|---|
| **"Linked"** (green) | Actively connected to Plaid. Syncing data. Plaid item exists and is billed. | `linked` |
| **"Converted"** (teal) | Was Plaid-linked, formally converted to manual mode. Plaid item removed (billing stopped). Transaction history preserved. Re-link available. | `converted` |
| **"Manual"** (blue/gray) | Operates in manual data-entry mode. Either always-manual or a Plaid-discovered account that the user chose not to activate for sync. | `manual` |

### Health Badge (only shown when connection=linked)
| Badge | Meaning | Source |
|---|---|---|
| **"✓ OK"** (green) | Plaid item healthy, syncing normally | `Plaid_Items.status = 'active'` |
| **"⚠ Needs Update"** (orange) | Credentials expired or permissions revoked. Relink action required. | `Plaid_Items.error_code` is set (recoverable) |
| **"✗ Error"** (red) | Plaid item in error state. Error code displayed with relink prompt. | `Plaid_Items.error_code` is set (may be unrecoverable) |

Health badges only appear for banks/accounts with `connection_status='linked'`. Converted and manual entities have no Plaid health to report.

### Visibility Badge (independent of connection state)
| Badge | Meaning | Column |
|---|---|---|
| *(none)* | Active and visible everywhere | `is_archived=false` |
| **"Archived"** (yellow, dimmed/collapsed) | Hidden from dashboard, transactions, and investments. Data preserved. Plaid keeps syncing if linked (data stays fresh). Visible on accounts page. When parent bank is also archived, relegated to collapsed "Archived" group. | `is_archived=true` |

**Key rule:** `Bank.is_archived=true` with `connection_status='linked'` is an invalid state. If a user archives a linked bank, the bank must first be converted to manual (so Plaid billing stops). The `archive_bank()` flow handles this automatically.

**Key rule:** `Account.is_archived=true` with `connection_status='linked'` IS valid. The user simply doesn't want to see this account in their dashboard or transactions, but Plaid keeps syncing data in the background so it's fresh when they unarchive it.

**accounts.html display rules:**
- Archived account under a non-archived bank: appears in the sidebar normally (just hidden from other pages).
- Archived account under an archived bank: relegated to the collapsed "Archived" group at the bottom of the sidebar.

### Sidebar Badge Rendering
Sidebar list items show a compact composite: a small colored dot combining connection + health (if linked), plus a dimmed/collapsed treatment for visibility state. The full breakdown is visible in the detail view metadata card.

### Scenario Reference Table
| Scenario | `origin` | `connection_status` | Identifying columns |
|---|---|---|---|
| Plaid bank syncing transactions | `plaid` | `linked` | `plaid_item_id` SET, billed has `transactions` |
| Plaid bank syncing investments only | `plaid` | `linked` | `plaid_item_id` SET, billed has `investments` |
| Plaid bank syncing both | `plaid` | `linked` | `plaid_item_id` SET, billed has both |
| Plaid-origin account, user enters txns manually | `plaid` | `manual` | Account born from Plaid item but user chose not to activate billable product for it |
| Former Plaid bank, converted to manual | `plaid` | `converted` | `plaid_item_id` NULL, `preserved_item_metadata` SET |
| Manual bank + official institution | `manual` | `manual` | `institution_id` SET, `plaid_item_id` NULL |
| User custom bank (Piggy Bank) | `manual` | `manual` | `institution_id` NULL, `plaid_item_id` NULL |
| Manual bank → Plaid (re-link) | `manual` | `linked` | `plaid_item_id` SET (newly) |
| Converted bank → Plaid (re-link) | `plaid` | `linked` | `plaid_item_id` SET again |

## Manual Account Creation
- A "+ New Account" button lives at the bottom of the sidebar account list (right column). Clicking it opens a creation modal.
- Creation modal fields:
  - **Bank** (required): presented as a **Custom / Official toggle** with two modes:
    - **Custom Bank** (default): a free-text input where the user types any bank name. Pre-populated suggestions from existing banks the user owns. Supports arbitrary names ("Piggy Bank", "My Kid's Bank"). No `institution_id` is set — the bank is a pure manual group.
    - **Official Bank**: a dropdown of ~26 curated popular institutions (Chase, Wells Fargo, Bank of America, Wealthfront, etc.) served by `GET /api/accounts/reference/popular-institutions`. Below the dropdown, a "My bank isn't listed" link opens an inline search panel that queries `GET /api/accounts/reference/search-institutions?q=…` against the full 9,700+ Plaid institution cache. Selecting an institution sets `institution_id` on the new bank, inheriting metadata (logo, phone, website) from the Plaid cache. This enables the **manual → linked** flow: banks created with an `institution_id` can later be linked to Plaid via the dashboard "Link to Plaid" button (see Scenario 6/8 in the reference table).
  - **Account name** (required).
  - **Account category** (required): dropdown — depository, credit, investment, loan, asset, liability.
  - **Account subcategory** (optional): context-dependent dropdown that updates based on the selected category (e.g., selecting "depository" offers checking, savings; selecting "credit" offers credit_card, etc.).
  - **Opening balance** (optional, defaults to 0): sets the starting balance.
  - **Opening balance date** (optional, defaults to today).
  - **Currency** (optional, defaults to USD).
  - **Notes** (optional).
- On submit: creates the account, the opening balance transaction, and the initial balance snapshot. If the bank name is new, the new bank group appears in the sidebar bank list immediately. The newly created account is auto-selected in the sidebar and its Account Detail View loads in the main content area.

## Manual Account Deletion
- Deletion is handled from the Account Detail View via the "Delete account and all related data" action (see Account Actions above).
- When a manual account is deleted and it was the last account under its bank group, the now-empty bank group is automatically removed from the sidebar bank list. No orphan bank groups persist.
- Plaid-linked accounts cannot be fully deleted from this flow — they can be retired, hidden, archived, or converted to manual (at which point they become deletable).

## Sidebar Behavior (Additional Detail)
- Sidebar mirrors the transactions.html left sidebar in structure and interaction patterns (see transactions.md).
- Bank list (left column) and account list (right column) are always visible side-by-side.
- Filter/search bar at top filters both columns simultaneously by bank name, account name, account type, or mask.
- Selecting "All Banks" in the left column shows all accounts in the right column and clears the main content area to an empty state prompting the user to select a bank or account.
- Selecting a specific bank filters the right column to that bank's accounts and loads the Bank Detail View.
- Selecting a specific account in the right column loads the Account Detail View. The associated bank remains highlighted in the left column.
- Account list entries show: account name (custom_name preferred), type badge, truncated balance, and a small status dot.
- Bank list entries show: bank name and a small connection status dot.
- Retired/hidden accounts appear dimmed or in a collapsible "Archived" group at the bottom of the accounts list.

## UX Guardrails
- Keep sidebar interactions snappy — bank and account selection should feel instant.
- All destructive actions (delete, reset, convert) require explicit confirmation dialogs with clear descriptions of what will be lost.
- Reversible actions (retire, hide, archive) should offer an undo affordance or prominent reactivation path.
- Connection health should be immediately visible — don't bury error states behind clicks.
- Keep manual and Plaid accounts visually distinguishable via origin and connection badges.
- Main content area should never be empty without guidance — show contextual prompts ("Select a bank or account to view details").
- Keep the page responsive: sidebar collapses to a single-column or drawer on narrow viewports.

## Backup / Restore Modal

A modal accessible from the sidebar filter row via a small "⇅ Backup" button next to the "Show archived" checkbox. Opens a two-section dialog for data portability.

### Sidebar Entry Point
- Small secondary-styled button (`btn-sidebar-action`) in the `.sidebar-filter-row`, right-aligned alongside the "Show archived" label.
- Label: "⇅ Backup". On hover: accent color fill.

### Modal Structure (`#backup-restore-modal`)

**Backup Section (top):**
- Title: "Download Backup".
- Description text explaining that the export contains structural bank/account data only (no balances, timestamps, or investment metrics).
- "⬇ Download Backup" button. On click: calls `GET /api/accounts/backup/export`, receives a JSON blob, triggers a browser download with the filename from the `Content-Disposition` header (or falls back to `pfc-accounts-backup-{date}.json`). Button shows "⏳ Exporting…" while in flight.

**Restore Section (below divider):**
- Title: "Restore from Backup".
- Description text explaining merge-only behavior — existing data is never destroyed, only missing banks/accounts are created.
- File picker: hidden `<input type="file" accept=".json">` activated by a "📁 Choose JSON File" button. Selected filename displayed inline.
- "⬆ Upload & Restore" button (disabled until a file is selected). On click:
  1. Reads the file via `file.text()`, parses as JSON.
  2. Validates `format === "PFC_ACCOUNTS_BACKUP"` before sending.
  3. POSTs the parsed JSON to `POST /api/accounts/backup/import`.
  4. On success: renders the restore summary card and reloads the sidebar.
  5. On error: shows inline error message.

**Restore Summary Card (`#restore-summary`, hidden until restore completes):**
- 2×2 grid displaying: Banks Created, Banks Skipped, Accounts Created, Accounts Skipped.
- Two hash-match rows below the grid:
  - "Bank structure" — shows "✓ Match" (green) or "⚠ Mismatch" (yellow) comparing the file's `bank_list_hash` against the post-import DB hash.
  - "Account structure" — same for `account_list_hash`.
- Hash match meaning: ✓ Match = the DB now contains exactly the bank/account topology from the file. ⚠ Mismatch = the DB has additional or different banks/accounts beyond what the file contained (expected when restoring into a DB with pre-existing data).

### File Ownership
- Modal markup: `accounts.html` (alongside other modals).
- API calls: `accounts/api.js` — `apiExportAccounts()` (returns `{blob, filename}`), `apiImportAccounts(jsonData)` (returns summary object).
- Modal handlers: `accounts/main.js` — `openBackupRestoreModal()`, `closeBackupRestoreModal()`, `handleBackupDownload()`, `onRestoreFileSelected()`, `handleRestoreUpload()`, `renderRestoreSummary(summary)`.
- Styles: `accounts.css` — `.btn-sidebar-action`, `.backup-section`, `.restore-section`, `.backup-divider`, `.restore-upload-area`, `.restore-summary`, `.restore-summary-grid`, `.summary-stat`, `.hash-match-row`, `.hash-status.hash-match`, `.hash-status.hash-mismatch`.


# BUGS and Changes needed
