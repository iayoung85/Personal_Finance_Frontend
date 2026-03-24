# Dashboard Page — API Routes

> **Page:** Index / Dashboard (login, register, 2FA, forgot password, and post-login hub)
> **Blueprints:** `auth` (`/api/auth`), `connections` (`/api/connections`)

---

## Authentication Endpoints

### `GET /api/auth/registration-status`

**Auth required:** No

Check whether new user registration is enabled on this server instance.

**Response `200`:**
```json
{
  "registration_enabled": true,
  "message": "Registration is open"
}
```

---

### `POST /api/auth/register`

**Auth required:** No
**Rate limit:** 5/hour

Create a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "first_name": "Jane",
  "last_name": "Doe",
  "frontend_url": "https://myapp.example.com"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | yes | Must be valid email format, unique |
| `password` | string | yes | Minimum strength requirements apply |
| `first_name` | string | yes | |
| `last_name` | string | yes | |
| `frontend_url` | string | yes | Used for email verification/reset links |

**Response `201`:**
```json
{
  "user_id": "user_abc123",
  "email": "user@example.com",
  "token": "<jwt_access_token>",
  "refresh_token": "<jwt_refresh_token>"
}
```

**Errors:**
- `400` — Missing fields, weak password, email already registered.

---

### `POST /api/auth/login`

**Auth required:** No
**Rate limit:** 10/minute

Authenticate a user. If 2FA is enabled, must include `totp_code`.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "totp_code": "123456"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | yes | |
| `password` | string | yes | |
| `totp_code` | string | conditional | Required when user has 2FA enabled |

**Response `200` (no 2FA or 2FA verified):**
```json
{
  "user_id": "user_abc123",
  "email": "user@example.com",
  "token": "<jwt_access_token>",
  "refresh_token": "<jwt_refresh_token>"
}
```

**Response `200` (2FA required, code not provided):**
```json
{
  "requires_2fa": true
}
```

**Errors:**
- `401` — Invalid credentials, account locked, invalid TOTP code.

---

### `POST /api/auth/refresh`

**Auth required:** No (uses refresh token)

Exchange a refresh token for a new access + refresh token pair.

**Request:**
```json
{
  "refresh_token": "<jwt_refresh_token>"
}
```
Also accepts `auth_refresh_token` as an alternative key name.

**Response `200`:**
```json
{
  "token": "<new_jwt_access_token>",
  "refresh_token": "<new_jwt_refresh_token>"
}
```

**Errors:**
- `401` — Invalid or expired refresh token.

---

### `POST /api/auth/forgot_password`

**Auth required:** No
**Rate limit:** 3/hour

Request a password reset email.

**Request:**
```json
{
  "email": "user@example.com",
  "frontend_url": "https://myapp.example.com"
}
```

**Response `200`:**
```json
{
  "message": "Password reset email sent"
}
```

> Always returns 200 regardless of whether the email exists (prevents enumeration).

---

### `POST /api/auth/reset_password`

**Auth required:** No

Complete a password reset using the token from the email link.

**Request:**
```json
{
  "token": "<reset_token_from_email>",
  "password": "NewSecurePassword456!"
}
```

**Response `200`:**
```json
{
  "message": "Password reset successful"
}
```

**Errors:**
- `400` — Invalid or expired token, weak password.

---

### `GET /api/auth/health`

**Auth required:** No

Server health check.

**Response `200`:**
```json
{
  "status": "ok"
}
```

---

## Dashboard Data Endpoints (Post-Login)

### `GET /api/auth/profile-info`

Fetch the current user's profile.

**Response `200`:**
```json
{
  "user_id": "user_abc123",
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "user@example.com"
}
```

---

### `GET /api/connections/items`

Fetch all Plaid items (bank connections) for the current user. This is the primary data source for the dashboard's "Banks" section.

**Response `200`:**
```json
{
  "items": [
    {
      "plaid_item_id": "item_abc123",
      "institution_id": "ins_3",
      "institution_name": "Chase",
      "billed_products": ["transactions"],
      "consented_products": ["transactions", "investments"],
      "available_products": ["investments", "auth"],
      "status": "active",
      "error_code": null,
      "new_accounts_available": false,
      "last_webhook_timestamp": "2026-03-15T10:30:00"
    }
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `plaid_item_id` | string | Unique Plaid identifier |
| `institution_id` | string | Plaid institution ID (e.g., `"ins_3"`) |
| `institution_name` | string | Display name |
| `billed_products` | string[] | Currently billed: `"transactions"`, `"investments"` |
| `status` | string | `"active"` or error state |
| `error_code` | string \| null | `"ITEM_LOGIN_REQUIRED"`, `"INTERNAL_SERVER_ERROR"`, etc. |
| `new_accounts_available` | boolean | Plaid detected new accounts at this institution |

---

### `GET /api/connections/create_link_token`

Generate a Plaid Link token for launching the Plaid Link UI.

**Query Parameters:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `item_id` | string | no | For update mode (fix broken connection) |
| `mode` | string | no | Link mode hint |
| `bank_id` | string | no | For re-linking a converted bank |
| `institution_id` | string | no | Pre-select institution in Plaid Link |

**Response `200`:** Plaid link token response (pass directly to Plaid Link SDK).

---

### `POST /api/connections/set_access_token`

Exchange the public token from Plaid Link for a server-side access token. Called after successful Plaid Link completion.

**Request:**
```json
{
  "public_token": "<plaid_public_token>",
  "bank_id": "bank_abc123"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `public_token` | string | yes | From Plaid Link `onSuccess` callback |
| `bank_id` | string | no | Existing bank to attach this item to (re-link flow) |

**Response `200`:**
```json
{
  "message": "Access token set",
  "item_id": "item_abc123",
  "user_id": "user_abc123",
  "billed_products": ["transactions"]
}
```

---

### `POST /api/connections/item_info`

Get detailed info about a specific Plaid item.

**Request:**
```json
{
  "item_id": "item_abc123"
}
```

**Response `200`:**
```json
{
  "item_id": "item_abc123",
  "institution_id": "ins_3",
  "billed_products": ["transactions"],
  "available_products": ["investments"],
  "products": ["transactions"],
  "error": null,
  "cached": false
}
```

---

### `POST /api/connections/remove_item`

Disconnect a Plaid item. Multiple modes control what happens to the data.

**Request:**
```json
{
  "item_id": "item_abc123",
  "mode": "convert"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `item_id` | string | conditional | Plaid item to remove (one of `item_id` or `bank_id` required) |
| `bank_id` | string | conditional | Alternative: identify by bank |
| `mode` | string | yes | `"convert"` — keep data, stop billing; `"archive"` — convert + hide; `"delete"` — destroy everything |

**Response `200`:**
```json
{
  "message": "Item removed and bank converted to manual",
  "details": { ... }
}
```

---

### `POST /api/connections/refresh_item_accounts`

Refresh account data from Plaid for an item (detect new/closed accounts).

**Request:**
```json
{
  "item_id": "item_abc123"
}
```

**Response `200`:** Updated account list and refresh details.

---

### `POST /api/connections/banks/<bank_id>/activate-transactions`

Activate the transactions product for a Plaid item associated with this bank. Triggers initial transaction sync.

**Response `200`:**
```json
{
  "message": "Transactions activated",
  "result": { ... }
}
```

---

### `POST /api/connections/banks/<bank_id>/retry-initial-sync`

Retry an initial transaction sync that failed.

**Response `200`:** Sync result details.

---

### `POST /api/connections/banks/<bank_id>/retry-relink`

Retry the re-link reconciliation process.

**Response `200`:** Relink result details.

---

### `POST /api/connections/banks/<bank_id>/convert-to-manual`

Convert a Plaid-linked bank to manual mode. Stops billing, preserves all data.

**Response `200`:**
```json
{
  "connection_status": "converted",
  "is_archived": false,
  "message": "Bank converted to manual. Billing stopped.",
  ...
}
```

---

## Webhook (Server-to-Server)

### `POST /api/connections/webhook`

**Auth required:** No (Plaid-signed)
**Rate limit:** 60/minute

Receives Plaid webhook events. Not called by the frontend directly, but understanding it helps debug sync timing:

- `SYNC_UPDATES_AVAILABLE` — new transactions ready, triggers auto-sync.
- `ITEM_ERROR` — connection needs repair.
- `NEW_ACCOUNTS_AVAILABLE` — user added accounts at their bank.

---

## Migration Notes for React + IndexedDB

### Token Storage
Store JWT tokens in React state/context (memory), **not** `localStorage`. Use a React context provider at the app root:

```tsx
const AuthContext = createContext<AuthState>(null);

function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ token: null, refreshToken: null });
  // On mount: try silent refresh
  // On 401: trigger refresh flow
  return <AuthContext.Provider value={{ auth, setAuth }}>{children}</AuthContext.Provider>;
}
```

### Auth Flow State Machine
The dashboard login/register/2FA/forgot-password views map naturally to a React Router setup or a state machine:

```
/login → /register → /login (on success)
/login → /2fa (when requires_2fa=true) → /dashboard
/login → /forgot-password → /login
/ → /dashboard (when token valid)
```

Use React Router with a `<ProtectedRoute>` wrapper that checks auth state.

### Plaid Link Integration
Use the official `react-plaid-link` package. The flow:
1. Call `GET /api/connections/create_link_token` to get the token.
2. Pass token to `usePlaidLink()` hook.
3. On success, call `POST /api/connections/set_access_token` with the public token.
4. Refresh connections list.

### Cache Connection Data
Store Plaid items in IndexedDB. On dashboard mount, show cached items immediately and refetch in background. Connections rarely change, so a long cache TTL is fine.
