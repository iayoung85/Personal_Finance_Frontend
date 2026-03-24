# Categories Page Blueprint (Target End State)

> **Disclaimer:** This document describes the **desired final UX and behavior** for the Categories management page. It is intentionally written as an end-state blueprint, not an implementation status log.

Source reference: categories.html, categories.js, categories.css

## Modular File Map (Vanilla JS Target)

- `categories.html`
  - Page shell, card containers, modal mounts, script includes.
- `categories.css`
  - Card layouts, form styles, category preview grids, modal styling.
- `categories/main.js`
  - Page bootstrap and wiring (initialize app, load category data, bind listeners).
- `categories/state.js`
  - UI state (active tab, edit mode, pending changes, rules/mappings/overrides cache).
- `categories/api.js`
  - All backend calls (fetch mappings/rules/overrides, create/edit/delete operations, recategorization endpoint).
- `categories/preview-panel.js`
  - Category taxonomy preview rendering (primary + detailed categories with counts).
- `categories/mappings.js`
  - Plaid → User category mapping manager (create, edit, delete mappings).
- `categories/rules-engine.js`
  - Rule creation, editing, deletion, validation. Includes rule suggestion UI (2a).
- `categories/overrides.js`
  - Manual override management, bulk override operations (delete all, export).
- `categories/securities-categories.js`
  - Investment securities categorization separate taxonomy (parallel to transactions, for 2b).
- `categories/bulk-actions.js`
  - Recategorize all transactions, check for broken rules, dry-run preview.
- `categories/advanced-mode.js`
  - CSV import/export for bulk rule/mapping management.
- `categories/utils.js`
  - Shared helpers (category formatting, validation, search/filter helpers).

### File Ownership Rules
- Keep DOM rendering code out of `api.js`.
- Keep network calls out of render modules.
- Keep rule validation logic pure (input -> output).
- Keep `main.js` thin; it should orchestrate modules, not contain business logic.

## Purpose
A management hub for category taxonomy, transaction categorization rules, and investment holdings categorization. Allows user to design custom categories and fine-tune the categorization pipeline.

## Core Sections

### 1. Category Preview
- Live display of all primary and detailed categories.
- Count of transactions per category (read-only insight).
- Quick search to find a category.
- Read-only until user navigates to edit mode.

### 2. Mappings → Rules → Overrides Workflow
This section walks through the three-phase categorization pipeline:

#### Phase 1: Mappings
- Plaid detailed category → User label (mapping).
- Create new mapping or edit existing.
- Preview which Plaid categories match the mapping rule.
- Activating a mapping automatically applies it to all future transactions.

#### Phase 2: Rules
- Pattern-based rules (merchant_contains, name_contains, amount_range, regex, primary_category_contains).
- Rule builder UI with visual logic (for simplicity: all rules are AND-combined).
- Includes rule suggestion modal (2a): when user manually overrides a transaction, suggest a rule based on that override.
- Dry-run preview: show matching transactions before confirming rule creation.
- Edit/delete existing rules.

#### Phase 3: Overrides
- One-off manual category assignments (highest priority in the pipeline).
- Bulk operations: delete all overrides, export override list.
- Clear individual override via modal.

### 3. Securities Categorization (Future: 2b)
- Separate UI parallel to transaction categories.
- User-customizable taxonomy for holdings (e.g., "US Equities", "International Bonds", "Crypto").
- Securities → Custom category assignment.

### 4. Bulk Actions & Tools
- **Recategorize All Transactions**: re-run the full categorization pipeline on all transactions (useful after rule/mapping changes).
- **Check for Broken Rules**: identify rules that no longer match any transactions or mappings that have become orphaned.
- **Delete All Overrides**: reset all manual overrides to let mappings/rules take over.
- **Advanced Mode (CSV)**: import/export rules and mappings as CSV for bulk editing or backup.

## Interaction Patterns
- Single-page card layout; user navigates between sections without page reloads.
- Modals for:
  - Rule creation/editing with multi-field builder.
  - Dry-run preview before confirming bulk actions.
  - Rule suggestion after manual override (2a).
  - Advanced CSV import/export.
- Real-time validation: show error/success status for each operation.
- Undo/reset confirmations for destructive actions (delete overrides, bulk recategorize).

## UX Guardrails
- Keep the three-phase pipeline clearly visible and intuitive.
- Show impact preview before executing bulk actions (dry-run, transaction count affected).
- Keep rule suggestion (2a) non-intrusive; only show when user creates an override.
- Optimize for experts: advanced mode (CSV) for power users, simplified UI for casual users.
- Keep securities categorization visually separate from transaction categorization.


FUTURE GAP FILLER GOALS
when PLAID "invents" new categories, they might make them but not update their taxonomy.. we alreaady have new category discovery which adds them as new rows in taxonomy. We should set front end and backend to receive an alert of some sort when new categories are discovered so a user may remap them in a way which matches their own mental model of categorization.
do we have a way to handle the possibility that plaid deprecates old taxonomy rows and deletes them? it probably doesn't matter.. maybe worth thinking about. 
recategorize all button lives deeply embedded in the categories settings area.. is that all we need? maybe....

IMPLEMENTED: don't let user create custom categories that start with "[" need to verify what exactly but categories window will now have transfers with account name in form 
      id | --account-- | ----Tx_ID----- | ---Category ---
       1 | account_abc | tranaction_abc | [<account_xyz>]
       2 | account_xyz | tranaction_xyz | [<account_abc>]

#### BUGS:
