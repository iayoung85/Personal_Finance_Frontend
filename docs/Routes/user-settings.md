# User Settings Page — API Routes

> **Page:** User profile, password, 2FA, app configuration
> **Blueprint:** `auth` (`/api/auth`)

---

## Profile Management

### `GET /api/auth/profile-info`

Fetch the current user's profile information.

**Response `200`:**
```json
{
  "user_id": "user_abc123",
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "user@example.com"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `user_id` | string | Stable user identifier |
| `first_name` | string | Decrypted from encrypted PII field |
| `last_name` | string | Decrypted from encrypted PII field |
| `email` | string | Read-only in the UI (changes require admin) |

---

### `POST /api/auth/update-profile-info`

Update the user's name.

**Request:**
```json
{
  "first_name": "Jane",
  "last_name": "Smith"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `first_name` | string | yes | |
| `last_name` | string | yes | |

**Response `200`:** Updated profile object.

> **Note:** Email cannot be changed through this endpoint.

---

## Password Management

### `POST /api/auth/change-password`

Change the current user's password.

**Rate limit:** 5/hour

**Request:**
```json
{
  "current_password": "OldPassword123!",
  "new_password": "NewSecurePassword456!",
  "twofa_code": "123456"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `current_password` | string | yes | Must match current password |
| `new_password` | string | yes | Minimum strength requirements |
| `twofa_code` | string | conditional | Required if user has 2FA enabled |

**Response `200`:**
```json
{
  "message": "Password changed"
}
```

**Errors:**
- `401` — Wrong current password or invalid 2FA code.
- `400` — New password too weak.

---

## Two-Factor Authentication

### `POST /api/auth/setup_2fa`

Start the 2FA setup flow. Generates a TOTP secret and QR code.

**Response `200`:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qr_code_url": "otpauth://totp/MyFinance:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=MyFinance",
  "manual_entry_key": "JBSWY3DPEHPK3PXP"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `secret` | string | Base32-encoded TOTP secret |
| `qr_code_url` | string | `otpauth://` URI for QR code generation |
| `manual_entry_key` | string | For manual entry in authenticator apps |

**Frontend flow:**
1. Call this endpoint.
2. Render `qr_code_url` as a QR code (use a library like `qrcode.react`).
3. Show `manual_entry_key` as fallback.
4. Prompt user to enter a TOTP code from their authenticator app.
5. Verify with `POST /verify_2fa_setup`.

---

### `POST /api/auth/verify_2fa_setup`

Complete 2FA setup by verifying a TOTP code from the user's authenticator app.

**Request:**
```json
{
  "code": "123456"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `code` | string | yes | 6-digit TOTP code from authenticator app |

**Response `200`:**
```json
{
  "message": "2FA enabled"
}
```

**Errors:**
- `400` — Invalid code.

---

### `POST /api/auth/disable_2fa`

Disable 2FA for the current user.

**Response `200`:**
```json
{
  "message": "2FA disabled"
}
```

---

## Migration Notes for React + IndexedDB

### Settings Page as React Router Sub-Routes
Model the four settings sections as nested routes:

```
/settings/profile
/settings/password
/settings/2fa
/settings/delete-account
```

Use a sidebar nav component with `<NavLink>` for active state. The main content area renders the active section via `<Outlet>`.

### 2FA Setup Flow
Use a multi-step component:
1. **Step 1:** Button "Enable 2FA" → calls `POST /setup_2fa`.
2. **Step 2:** Display QR code + manual key. Show TOTP input field.
3. **Step 3:** User enters code → calls `POST /verify_2fa_setup`.
4. **Step 4:** Success confirmation.

Use component state to track the current step. Don't store the TOTP secret in IndexedDB or any persistent storage.

### Account Deletion
This is the most destructive action in the app. Implement a multi-gate confirmation:
1. Type "DELETE" in a text field.
2. Enter password.
3. Final modal confirmation.
4. On success: clear all IndexedDB stores, clear auth tokens, redirect to login.

### Profile Data Caching
Profile data changes rarely. Cache in React state (not IndexedDB) and refetch only when the settings page mounts. No need for background sync.

### App Configuration (Future)
The page blueprints describe app-wide configuration settings (theme, date format, currency display, notifications). These may not all have backend endpoints yet but should be planned for:

| Setting | Scope | Storage |
|---------|-------|---------|
| Light/Dark mode | Frontend only | `localStorage` or IndexedDB |
| Date format | Frontend only | IndexedDB preference store |
| Currency display | Frontend only | IndexedDB preference store |
| Show cents | Frontend only | IndexedDB preference store |
| Default date range | Frontend only | IndexedDB preference store |
| Email notifications | Backend | Future API endpoint |

For frontend-only settings, create an IndexedDB `preferences` object store and sync on page load.
