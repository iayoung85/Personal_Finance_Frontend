# Accounts Backup & Restore — Phased Plan

## Decisions Log

These decisions were made during the brainstorming session and are the source of truth for implementation.

| Topic | Decision |
|---|---|
| **File format** | JSON download (not CSV). JSON preserves structured fields (notes, addresses, preserved metadata) without quoting/escaping issues. The file is machine-readable for restore and human-readable enough for inspection. |
| **Hash scope** | Two separate hashes: one for banks, one for accounts. Hashes cover only immutable/unlikely-to-change fields (origin, original names, IDs, category, subcategory, parent-child FKs) — not custom names, notes, balances, or other metadata the user frequently edits. Hashes are embedded in the JSON export and also in transaction exports so the transaction import pipeline can verify structural alignment. |
| **Hash algorithm** | SHA-256 truncated to 12 hex chars — matches existing `compute_category_list_hash()` pattern. |
| **Institution data** | Export includes only `institution_id`. The app re-resolves full institution metadata from the seeded `plaid_institutions` table on restore. |
| **Empty banks** | Banks with zero accounts are excluded from export. Every bank is assumed to have at least one account. |
| **App IDs** | `bank_id` and `account_id` strings are preserved in the export and restored as-is. This makes transaction restore trivial (FKs match directly). Primary use case is full restore from empty DB so ID conflicts are extremely unlikely. |
| **Plaid IDs** | `plaid_account_id`, `plaid_item_id` are included. Needed for admin Plaid re-link after restore. |
| **Restore behavior** | Merge alongside existing data. If a `bank_id` already exists, skip that bank. If an `account_id` already exists, skip that account. New banks are created only when their `bank_id` doesn't exist in the DB. No data is destroyed. |
| **Excluded fields (ephemeral/derived)** | `current_balance`, `available_balance`, `opening_balance`, `opening_balance_derived_at`, `balance_date`, `last_balance_update`, `balance_source`, `created_at`, `updated_at`, `market_value`, `cost_basis`, `gain_loss`, `gain_loss_pct`, `investment_last_calculated`, `transaction_count`, `access_token` (sensitive — handled separately by admin). On restore, balance fields default to 0/null; dates are set to restore timestamp. |
| **Plaid credential backup** | Included in this plan as a later phase. Admin-only. Encrypted export of `plaid_items` access tokens and item metadata. Stored separate from the user-facing accounts export for security. |
| **Admin re-link request** | User clicks "Request Plaid Re-link" after restore → creates a row in a new `admin_requests` table AND sends an email to admin via existing Resend email service. |
| **Code location** | New sub-package under accounts module: `src/modules/accounts/services/backup/`. Keeps backup logic near the models it serializes without bloating the main services files. |
| **Frontend location** | Backup/Restore modal triggered from accounts.html sidebar, next to "Show archived" checkbox. No new page needed. |

---

## Architecture Overview

### JSON Export Schema (v1)

```json
{
  "format": "PFC_ACCOUNTS_BACKUP",
  "version": 1,
  "exported_at": "2026-03-18T14:30:00Z",
  "user_id": "user_1",
  "bank_list_hash": "a1b2c3d4e5f6",
  "account_list_hash": "f6e5d4c3b2a1",
  "banks": [
    {
      "bank_id": "bank_abc123",
      "bank_name": "Unknown Bank",
      "custom_name": "My Assets",
      "origin": "manual",
      "connection_status": "manual",
      "institution_id": null,
      "plaid_item_id": null,
      "is_archived": false,
      "notes": "Personal tracking accounts",
      "user_phone": null,
      "user_address": null,
      "preserved_item_metadata": null,
      "accounts": [
        {
          "account_id": "manual_def456",
          "account_name": "Ankeny House est sale value",
          "custom_name": "Ankeny House est sale value",
          "origin": "manual",
          "connection_status": "manual",
          "account_category": "asset",
          "account_subcategory": "real_estate",
          "plaid_account_id": null,
          "plaid_item_id": null,
          "plaid_type": null,
          "plaid_subtype": null,
          "mask": null,
          "currency": "USD",
          "is_archived": false,
          "notes": null
        }
      ]
    }
  ]
}
```

### Hash Computation

**Bank list hash** — deterministic fingerprint of the bank topology:
```
sorted list of: { bank_id, bank_name, origin, connection_status, institution_id }
→ JSON encode with sort_keys=True
→ SHA-256 → first 12 hex chars
```

**Account list hash** — deterministic fingerprint of the account topology:
```
sorted list of: { account_id, account_name, bank_id, origin, connection_status,
                   account_category, account_subcategory, plaid_account_id }
→ JSON encode with sort_keys=True
→ SHA-256 → first 12 hex chars
```

These hashes are embedded in both the accounts backup JSON and the transaction export CSV header. During transaction restore, the importer compares both hashes against the user's current DB state to determine whether banks/accounts need to be created or already exist.

### Backend File Structure

```
src/modules/accounts/services/backup/
├── __init__.py
├── export_accounts.py       # Serialize banks+accounts → JSON dict + compute hashes
├── import_accounts.py       # Parse JSON upload → merge banks+accounts into DB
└── hash.py                  # compute_bank_list_hash(), compute_account_list_hash()
```

### Admin Plaid Backup File Structure

```
src/modules/admin/
├── admin_routes.py           # Existing + new routes for Plaid credential backup/restore
└── plaid_backup.py           # Encrypt/decrypt Plaid item credentials for admin export/import
```

### Frontend

```
Personal_Finance_Frontend/
├── accounts.html             # Add Backup/Restore button + modal markup
├── accounts.css              # Modal styles for backup/restore
└── accounts/
    ├── api.js                # Add apiExportAccounts(), apiImportAccounts(), apiRequestPlaidRelink()
    └── main.js               # Add backup/restore modal handlers
```

---

## Phase 1: Backend Export — Accounts JSON Download

**Goal:** User can hit an API endpoint and receive a JSON file containing their full bank+account structure with integrity hashes.

### Backend

- [x] **1a — Create `hash.py`.** Two functions: `compute_bank_list_hash(user_id)` and `compute_account_list_hash(user_id)`. Query banks/accounts from DB, extract the hash-relevant fields listed above, sort deterministically, JSON-encode, SHA-256, truncate to 12 hex chars. Follow the same pattern as `compute_category_list_hash()`.
- [x] **1b — Create `export_accounts.py`.** Single function `build_accounts_export(user_id)` that:
  - Queries all banks for the user (with nested accounts via relationship or join).
  - Skips banks with zero accounts.
  - Serializes each bank and its accounts into the JSON schema above.
  - Calls the hash functions from 1a and embeds both hashes in the output.
  - Populates `format`, `version`, `exported_at`, `user_id` header fields.
  - Returns a Python dict (the route handler converts to JSON response).
- [x] **1c — Add export route to `accounts_routes.py`.** `GET /api/accounts/backup/export` — authenticated. Calls `build_accounts_export()`, returns JSON with `Content-Disposition: attachment; filename="pfc-accounts-backup-{date}.json"`.
- [ ] **1d — Wire the hash into transaction exports.** When the transaction export feature is built, ensure the CSV header comment includes `bank_list_hash` and `account_list_hash` alongside the existing `category_list_hash`. (This is a note for the transaction export plan — no code change needed now unless export already exists.)

### Frontend

- No frontend changes in Phase 1 (API can be tested via curl).

### Verification

- `GET /api/accounts/backup/export` returns valid JSON matching the schema.
- Hashes are deterministic — calling the endpoint twice with no DB changes produces identical hashes.
- Banks with zero accounts are excluded.
- Excluded fields (balances, timestamps, investment metrics) are not present in the output.
- Plaid IDs (`plaid_account_id`, `plaid_item_id`) are present.

---

## Phase 2: Backend Import — Accounts JSON Restore

**Goal:** User uploads a JSON backup file and the app merges banks+accounts into the database without destroying existing data.

### Backend

- [x] **2a — Create `import_accounts.py`.** Main function `restore_accounts_from_backup(user_id, json_data)`:
  - Validates `format == "PFC_ACCOUNTS_BACKUP"` and `version == 1`.
  - Extracts `bank_list_hash` and `account_list_hash` from the file for later comparison.
  - Iterates through `banks` array. For each bank:
    - If `bank_id` already exists in DB for this user → skip bank creation, log as "already exists".
    - Otherwise → create new Bank row preserving the original `bank_id`, `bank_name`, `custom_name`, `origin`, `connection_status`, `institution_id`, `is_archived`, `notes`, `user_phone`, `user_address`, `preserved_item_metadata`. Set `plaid_item_id` to null (Plaid re-link is a separate admin step). Set `created_at` to now.
  - For each account within each bank:
    - If `account_id` already exists in DB for this user → skip, log as "already exists".
    - Otherwise → create new Account row preserving `account_id`, `account_name`, `custom_name`, `bank_id` (FK to the bank just created or already existing), `origin`, `connection_status` (forced to `manual` or `converted` since Plaid isn't linked yet — if original was `linked`, set to `dormant`), `account_category`, `account_subcategory`, `plaid_account_id`, `plaid_type`, `plaid_subtype`, `mask`, `currency`, `is_archived`, `notes`. Set balance fields to 0/null. Set `created_at` to now.
  - Returns a summary: `{ banks_created, banks_skipped, accounts_created, accounts_skipped, bank_list_hash, account_list_hash }`.
- [x] **2b — Add import route to `accounts_routes.py`.** `POST /api/accounts/backup/import` — authenticated. Accepts JSON body (the uploaded file contents). Calls `restore_accounts_from_backup()`. Returns the summary.
- [x] **2c — Recompute hashes after restore.** After import completes, call `compute_bank_list_hash()` and `compute_account_list_hash()` against the current DB state. Include current hashes in the response alongside the file's original hashes so the frontend can show whether the restore produced an exact match.

### Frontend

- No frontend changes in Phase 2 (API can be tested via curl).

### Verification

- Upload a backup JSON to an empty DB → all banks and accounts created, summary shows correct counts.
- Upload the same file again → all banks and accounts skipped, zero created.
- Upload a file with some new and some existing banks/accounts → correct merge behavior.
- Plaid-linked accounts are restored with `connection_status = 'dormant'` (not `linked`).
- Balance fields are 0/null after restore.
- Recomputed hashes match the file's hashes when restoring to an empty DB.

---

## Phase 3: Frontend — Backup/Restore Modal in accounts.html

**Goal:** User can click a button in the accounts sidebar to open a modal, download their backup, or upload a restore file. Provide clear feedback on what happened.

### Frontend

- [x] **3a — Add Backup/Restore button to sidebar.** In `accounts.html`, add a small button (icon or text) next to the "Show archived" checkbox. Label: "Backup / Restore" or a backup icon (e.g., `⇅`).
- [x] **3b — Add modal markup to `accounts.html`.** New modal with two sections:
  - **Backup section:** "Download Backup" button. Clicking it calls the export endpoint and triggers a browser file download of the JSON.
  - **Restore section:** File upload input (accepts `.json`). "Upload & Restore" button. After upload completes, display a summary card showing: banks created/skipped, accounts created/skipped, hash match status (checkmark if hashes match, warning if they don't).
  - **Plaid Re-link Request section** deferred to Phase 5 (backend endpoint not yet built).
- [x] **3c — Add API functions to `accounts/api.js`.** Two new functions:
  - `apiExportAccounts()` — GET to export endpoint, returns blob+filename for download.
  - `apiImportAccounts(jsonData)` — POST to import endpoint with parsed JSON body.
  - `apiRequestPlaidRelink()` — deferred to Phase 5.
- [x] **3d — Add modal handlers to `accounts/main.js`.** Wire up:
  - Open/close modal.
  - Backup button → call `apiExportAccounts()`, create blob URL, trigger download, show toast.
  - Restore button → read file via `file.text()`, parse JSON, validate format header, call `apiImportAccounts()`, display summary in the modal, reload sidebar.
  - Plaid Re-link button — deferred to Phase 5.
- [x] **3e — Add modal styles to `accounts.css`.** Style the modal sections, summary card, hash match indicators. Reuse existing modal patterns from the create-account modal.

### Backend

- No backend changes in Phase 3 (endpoints built in Phases 1–2).

### Verification

- Backup button downloads a `.json` file with correct name and content.
- Restore upload parses the file, shows summary with correct counts.
- After restore, sidebar refreshes and shows the newly created banks/accounts.
- Hash match indicators correctly show match or mismatch.
- Restore of non-JSON or malformed files shows a clear error message.
- Plaid Re-link Request button is only visible when the restore included Plaid-origin accounts.

---

## Phase 4: Transaction Import Integration — Hash Verification

**Goal:** The transaction import pipeline uses bank and account hashes to determine whether the user's current account structure matches the export, skipping bank/account creation when hashes align.

### Backend

- [ ] **4a — Embed hashes in transaction export header.** When transaction CSV export is built, the header comment line becomes:
  ```
  # PFC Export v1, exported={timestamp}, category_list_hash={hash}, bank_list_hash={hash}, account_list_hash={hash}
  ```
  This requires updating the export code to call `compute_bank_list_hash()` and `compute_account_list_hash()` at export time.
- [ ] **4b — Parse new hashes in transaction import parser.** Extend the header parser in `parsers.py` to extract `bank_list_hash` and `account_list_hash` from the CSV header comment. Add them to the analysis result payload returned to the frontend.
- [ ] **4c — Hash comparison logic in import analysis.** During the analysis step, compute the user's current bank and account hashes. Compare against the file's hashes. Return comparison results:
  - `bank_hash_match: true/false` — if true, all banks from the export already exist.
  - `account_hash_match: true/false` — if true, all accounts from the export already exist.
  - The frontend can show: "Your account structure matches the export — transactions will be mapped automatically" vs. "Account structure has changed — you may need to map accounts manually."
- [ ] **4d — Fast-path account mapping when hashes match.** When both hashes match, the import mapper can skip the manual account-mapping step entirely — every `account_id` in the CSV has a matching account in the DB already. The mapper auto-resolves all FKs without user intervention.

### Frontend

- [ ] **4e — Show hash match status in import wizard.** On the mapping step of the transaction import wizard, display a banner:
  - Green: "Account structure matches export — all transactions will be auto-mapped."
  - Yellow: "Account structure has changed since export. Please verify account mappings below."

### Verification

- Export a transaction CSV after accounts backup → header contains all three hashes.
- Restore accounts from backup, then import transactions → hashes match, auto-mapping succeeds.
- Modify an account (add/remove), then import same CSV → account hash mismatch, user is warned.

---

## Phase 5: Plaid Re-link Request Flow

**Goal:** After restoring accounts that were originally Plaid-linked, the user can request admin assistance to restore Plaid connections. The request is logged and an email is sent.

### Database

- [ ] **5a — Create `admin_requests` table.** Migration adds:
  ```
  admin_requests:
    id                (Integer PK)
    request_id        (String[255], unique) — "req_{uuid}"
    user_id           (String[255], FK)
    request_type      (String[50]) — 'plaid_relink', future types
    status            (String[50]) — 'pending', 'in_progress', 'completed', 'rejected'
    details           (JSON) — { bank_ids: [...], plaid_item_ids: [...], message: "..." }
    admin_notes       (Text) — admin can add resolution notes
    created_at        (DateTime)
    updated_at        (DateTime)
  ```

### Backend

- [ ] **5b — Add re-link request endpoint.** `POST /api/accounts/backup/request-plaid-relink` — authenticated. Creates an `admin_requests` row with `request_type = 'plaid_relink'`. The `details` JSON includes a list of bank_ids that have `origin = 'plaid'` and `connection_status = 'dormant'` (i.e., restored Plaid banks not yet re-linked).
- [ ] **5c — Send admin notification email.** After creating the request row, call `send_email()` to the admin email address (from env var `ADMIN_EMAIL`) with subject "PFC: Plaid Re-link Request from {user_id}" and an HTML body listing the banks that need re-linking.
- [ ] **5d — Admin request list endpoint.** `GET /admin/requests` — admin-secret-authenticated. Returns all pending admin requests for the admin dashboard/tool.
- [ ] **5e — Admin request status update endpoint.** `PATCH /admin/requests/<request_id>` — admin-secret-authenticated. Accepts `{ status, admin_notes }`. Updates the request row.

### Frontend

- [ ] **5f — Wire up the Plaid Re-link Request button** from Phase 3 modal. Call the endpoint, show success toast.

### Verification

- After restoring Plaid accounts, clicking "Request Plaid Re-link" creates a DB row and sends an email.
- Admin can list pending requests and update their status.
- Requesting twice for the same user creates a second request (idempotency is not required — admin resolves duplicates manually).

---

## Phase 6: Admin Plaid Credential Backup

**Goal:** Admin can export all Plaid access tokens and item metadata to an encrypted file for disaster recovery. This is a security-sensitive admin-only operation.

### Backend

- [x] **6a — Create `admin/plaid_backup.py`.** Two functions:
  - `export_plaid_credentials(encryption_key)` — Queries all `plaid_items` rows. For each item, serializes: `plaid_item_id`, `user_id`, `access_token` (still encrypted with app key), `institution_id`, `institution_name`, `status`, product arrays, `error_code`. Wraps the full list in an envelope: `{ format: "PFC_PLAID_BACKUP", version: 1, exported_at, item_count, items: [...] }`. The entire JSON payload is then AES-encrypted with the provided `encryption_key` (separate from the app's token encryption key — admin provides this at export time). Returns the encrypted blob.
  - `import_plaid_credentials(encrypted_blob, encryption_key)` — Decrypts the blob with the admin-provided key. For each item in the list: if a `plaid_items` row with that `plaid_item_id` already exists, update the `access_token` and `status`. If not, create a new row. Also updates the corresponding Bank row's `plaid_item_id` FK if the bank exists and currently has `plaid_item_id = null` (the restore scenario). Returns a summary of items restored/updated/skipped.
- [x] **6b — Add admin export route.** `POST /admin/plaid-backup/export` — admin-secret-authenticated. Accepts `{ encryption_passphrase }` in the body. Derives an encryption key from the passphrase (using PBKDF2 or similar KDF). Calls `export_plaid_credentials()`. Returns the encrypted blob as a downloadable file. The passphrase is never stored.
- [x] **6c — Add admin import route.** `POST /admin/plaid-backup/import` — admin-secret-authenticated. Accepts multipart: encrypted file + `encryption_passphrase`. Decrypts and restores. Returns summary.
- [ ] **6d — Re-link restored banks.** After Plaid credentials are restored, the admin calls a new endpoint `POST /admin/plaid-relink/<bank_id>` which:
  - Finds the bank and its matching `plaid_items` row.
  - Updates the bank's `connection_status` to `linked` and sets `plaid_item_id`.
  - Updates all child accounts' `connection_status` to `linked` and sets `plaid_item_id`.
  - Triggers an initial transaction sync for the item.
  - Marks the corresponding `admin_requests` row (if any) as `completed`.

### Frontend

- No user-facing frontend for Phase 6. Admin uses curl or a future admin dashboard.

### Verification

- Admin exports Plaid credentials → encrypted file is downloaded.
- Encrypted file cannot be read without the correct passphrase.
- Admin imports credentials to a fresh DB (after accounts restore) → Plaid items are created, banks are linked.
- Transaction sync runs successfully after re-link.
- Wrong passphrase → clear error, no partial import.
- Export with no active Plaid items → empty but valid file.

---

## Implementation Order & Dependencies

```
Phase 1 (Export)        — No dependencies, can start immediately
Phase 2 (Import)        — Depends on Phase 1 (hash functions)
Phase 3 (Frontend)      — Depends on Phases 1 + 2 (API endpoints)
Phase 4 (Txn Integration) — Depends on Phase 1 (hash functions) + transaction export existing
Phase 5 (Re-link Request) — Depends on Phase 3 (frontend button) + DB migration
Phase 6 (Admin Plaid)   — Depends on Phase 5 (re-link flow) but can be built in parallel
```

Phases 1–3 are the core user-facing feature. Phase 4 enhances the transaction import pipeline. Phases 5–6 complete the Plaid disaster recovery story.
