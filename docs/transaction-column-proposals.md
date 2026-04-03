# Transaction Table Column Redesign Proposals

## Problem Statement

The current "Merchant" column in `transactions.html` transaction-viewing-pane is doing too much:

- It cascades through `merchant_name → name → description` with a priority fallback
- It stacks badges (type, pending, override, split) inline with the text
- The name "Merchant" is misleading — it often shows raw Plaid strings like `"STARBUCKS #1234"`
- The separate "Memo" column overlaps in purpose with the editable description/override
- Users face a "which one do I type in?" confusion between Description and Memo

### Current Column Layout

`Date | Bank/Account | Merchant | Type | Category | Payment Channel | Pre-Override Description | Authorized DateTime | Plaid's Category | Memo | Amount | Balance | Actions`

(Many columns are optional/toggleable via settings)

### Current Merchant Cell Rendering

```
[type badge] [pending badge] [override badge] [split badge]  Starbucks #1234
```

Data source priority: `merchant_name → name → description → ""`

---

## Option A — "Label" + Collapse Memo Into It

Rename "Merchant" to **Label**. This is the user-facing name for the transaction — whatever the user wants to call it. For Plaid rows, it defaults to the cleanest available name (`merchant_name → name → description`), but once the user edits it, it's *their* label. Drop the separate Memo column entirely; instead, clicking a row (or a small `+note` affordance) opens an inline sub-row or popover for the memo.

**Columns:** `Date | Label | Category | Amount | Balance`

**Memo:** accessible via expand/popover per row, not a column.

**Pros:**
- Minimal column count — clean, scannable table
- One text field to edit, no confusion
- "Label" is intuitive — it's what you call the transaction

**Cons:**
- Memo is hidden — users who rely on it lose at-a-glance visibility
- Requires UI work for the expand/popover interaction

---

## Option B — Two-Line Cell: Merchant on Top, Note Underneath

Keep one column but render it as a **stacked cell**: the top line is the resolved merchant/description (bold, truncated), and a second smaller line underneath shows the user memo in muted text (or "add note…" placeholder). Badges sit on the top line. No separate Memo column needed.

**Columns:** `Date | Transaction | Category | Amount | Balance`

**Cell layout:**
```
  Starbucks #1234
  ᴍᴇᴍᴏ  Coffee with Sarah
```

**Pros:**
- Matches modern finance app patterns (Mint, Monarch, Copilot Finance)
- Both data points visible without extra columns
- Clean column count

**Cons:**
- Row height increases slightly
- Editing UX needs thought — which line do you click to edit?
- Dense tables may feel cramped

---

## Option C — "Payee" + "Note" (Two Distinct Columns, Clear Roles)

Rename "Merchant" to **Payee** — a term that's accurate for both income and expense rows. Make Payee non-editable for Plaid rows (it's the bank's label) and editable only for manual rows. Then rename Memo to **Note** — this is always the user's free-text annotation. Remove the override concept from the payee column entirely; overrides become Notes.

**Columns:** `Date | Payee | Note | Category | Amount | Balance`

**Rule:** Payee = system-provided, Note = user-provided. No ambiguity.

**Pros:**
- Crystal-clear separation of concerns — *who* vs *your comment*
- "Payee" is a well-understood financial term
- Both fields always visible

**Cons:**
- Still two text columns (though with distinct roles now)
- Losing the ability to override Payee display could frustrate users who want to rename "AMZN MKTP US*2X7K" to "Amazon"
- Wider table

---

## Option D — "Description" with Smart Sub-Text + Icon Strip

Rename "Merchant" to **Description**. Show the user-facing display name as primary text. Move all badges out of the text flow and into a thin **icon strip** to the left of the description (a narrow ~30px column with stacked tiny icons for pending/split/override/type). Memo becomes a tooltip or expandable row — not a column.

**Columns:** `Date | [icons] | Description | Category | Amount | Balance`

**Benefit:** Badges no longer break the text flow; scanning the icon strip gives you transaction status at a glance.

**Pros:**
- Declutters the description text completely
- Icon strip enables fast visual scanning of transaction status
- Familiar pattern from email clients (Gmail flags/stars column)

**Cons:**
- Icon strip requires good iconography — too many icons and it becomes noise
- Memo still needs a home (tooltip/expandable)
- Adds a narrow column that may feel odd on small screens

---

## Option E — "Merchant" + "Details" (Rename & Redefine)

Keep the name **Merchant** but *narrow its scope*: it only ever shows the clean merchant name (`merchant_name` for Plaid, user-entered name for manual). If no merchant name exists, show a placeholder like "Unknown Merchant." Then add a **Details** column that combines the raw Plaid `name` field and the user memo into one editable cell — the raw bank string shows as muted prefix text, and the user can type their own note after it.

**Columns:** `Date | Merchant | Details | Category | Amount | Balance`

**Merchant:** clean name only, never raw bank strings.
**Details:** raw bank text (read-only, muted) + user note (editable).

**Pros:**
- Separates *who* from *what/why*
- Merchant column becomes reliably clean
- Details gives a home for both raw data and user notes

**Cons:**
- Two text columns again
- "Details" is vague — users may not know what goes there
- Rendering mixed read-only + editable content in one cell is complex

---

## Quick Comparison

| | Columns | Memo Handling | Badge Handling | Edit Model |
|---|---|---|---|---|
| **A** | 5 cols, minimal | Expand/popover | In Label cell | One editable field |
| **B** | 5 cols, two-line cell | Second line in cell | Top line | One cell, two zones |
| **C** | 6 cols, clear roles | Dedicated "Note" col | In Payee cell | Two editable fields |
| **D** | 6 cols (icon strip) | Tooltip/expandable | Separate icon column | One editable field |
| **E** | 6 cols, split concerns | Merged into Details | In Merchant cell | Two editable fields |
