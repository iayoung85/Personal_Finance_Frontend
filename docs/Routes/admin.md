# Admin Page — API Routes

> **Page:** Admin utilities (logs, webhooks, Plaid backup/restore)
> **Blueprint:** `admin` (`/admin`)
> **Note:** These endpoints use the `/admin` prefix, not `/api/admin`.

---

## Endpoints

### `GET /admin/logs`

Download the application log file.

**Response `200`:**
- Content-Type: `text/plain`
- Body: Raw log file contents (not JSON).

---

### `POST /admin/update_webhooks`

Update the Plaid webhook URL for all connected items. Used when the server URL changes (e.g., after deploying to a new domain).

**Request:**
```json
{
  "webhook_url": "https://myapp.example.com/api/connections/webhook"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `webhook_url` | string | no | New webhook URL. If omitted, uses the server's configured URL. |

**Response `200`:**
```json
{
  "message": "Webhooks updated",
  "webhook_url": "https://myapp.example.com/api/connections/webhook",
  "total_items": 3,
  "success_count": 3,
  "error_count": 0,
  "errors": []
}
```

---

### `POST /admin/plaid-backup/export`

Export all Plaid access tokens and item metadata as an encrypted backup file.

**Request:**
```json
{
  "encryption_passphrase": "user-chosen-passphrase"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `encryption_passphrase` | string | yes | Passphrase for encrypting the backup (user must remember this) |

**Response `200`:**
- Content-Type: `application/octet-stream`
- Body: Encrypted binary blob.
- Use as a file download.

---

### `POST /admin/plaid-backup/import`

Restore Plaid access tokens from a previously exported backup.

**Request:** `multipart/form-data`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | file | yes | The encrypted backup file |
| `encryption_passphrase` | string | yes | Must match the passphrase used during export |

**Response `200`:**
```json
{
  "message": "Plaid backup restored",
  "imported_items": 3
}
```

**Errors:**
- `400` — Wrong passphrase or corrupted file.

---

## Migration Notes for React + IndexedDB

### Admin Page Visibility
The admin page should only be accessible to authorized users. Check user role/permissions before rendering the admin route. In React Router:

```tsx
<Route path="/admin" element={<AdminGuard><AdminPage /></AdminGuard>} />
```

### File Download Handling
For the log download and backup export, use `fetch()` with `blob()` response handling:

```typescript
const response = await fetch('/admin/logs', { headers: { Authorization: `Bearer ${token}` } });
const blob = await response.blob();
const url = URL.createObjectURL(blob);
// Trigger download via hidden <a> element
```

### Backup/Restore UX
The backup flow involves sensitive data (Plaid access tokens). Implement a clear warning:
- Export: "This file contains encrypted API credentials. Store it securely."
- Import: "This will overwrite existing Plaid connections. Are you sure?"
