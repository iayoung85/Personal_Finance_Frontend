# Index / Dashboard Page Blueprint (Target End State)

> **Disclaimer:** This document describes the **desired final UX and behavior** for the Index/Dashboard page. It is intentionally written as an end-state blueprint, not an implementation status log.

Source reference: index.html, index.js, index.css

## Modular File Map (Vanilla JS Target)

- `index.html`
  - Page shell, view mount points (login, register, 2FA, forgot password, dashboard), script includes.
- `index.css`
  - Auth form styles, dashboard layout, connection cards, button styling.
- `index/main.js`
  - Page bootstrap and smart view routing (detect auth state, load dashboard or auth view, bind listeners).
- `index/state.js`
  - Global UI state (current view, current user, connections cache, auth status).
- `index/api.js`
  - All backend calls (login, register, forgot password, 2FA verify, fetch connections, Plaid link token).
- `index/auth-views.js`
  - Manage four auth view sections: login, register, forgot password, 2FA prompt.
- `index/login.js`
  - Login form handling, email/password validation, error display.
- `index/register.js`
  - Registration form handling, password strength validation, account creation.
- `index/password-reset.js`
  - Forgot password flow: email entry, reset link request, token verification.
- `index/two-factor.js`
  - 2FA TOTP code input, validation, fallback options (recovery codes).
- `index/dashboard.js`
  - Dashboard view rendering: user info, connections list, Plaid link buttons, navigation to other pages.
- `index/connections-list.js`
  - Render connected banks/institutions, account count, sync status, quick actions (relink, disconnect).
- `index/plaid-integration.js`
  - Generate Plaid link tokens (transactions and investments), open Plaid Link, handle flow completion.
- `index/utils.js`
  - Shared helpers (view switching, auth state checks, error formatting, storage management).

### File Ownership Rules
- Keep DOM rendering code out of `api.js`.
- Keep network calls out of view modules.
- Keep auth state checks pure (input -> boolean).
- Keep `main.js` thin; it should route to correct view and orchestrate modules.

## Purpose
Entry point and hub: handle user authentication (login, register, password reset, 2FA) and serve as the launching point for the rest of the app (transactions, investments, accounts, categories, user settings).

## Page Structure

The page toggles between **five views**, only one visible at a time:

### 1. Login View
- Email input field.
- Password input field.
- Submit button.
- Links: "Don't have an account? Register" and "Forgot Password?".
- Status messages (errors, loading state).
- After login: if user has 2FA enabled, switch to 2FA view; otherwise, redirect to dashboard.

### 2. Register View
- First name input.
- Last name input.
- Email input.
- Password input with strength meter.
- Submit button.
- Link: "Already have an account? Login".
- Status messages and validation feedback.
- On success: auto-login or redirect to login view.

### 3. Forgot Password View
- Email input field.
- Submit button to request reset link.
- Link: "Back to Login".
- Status messages (success: "Check your email", errors).
- (Future) Token entry screen if using in-app reset flow instead of email.

### 4. Two-Factor Authentication View
- 6-digit TOTP code input (numeric-only, centered, spaced).
- Submit button to verify.
- Link: "Back to Login".
- Status messages (invalid code, expired, etc.).
- (Future) Recovery code fallback option.

### 5. Dashboard View (After Login)
- **User info section:** email, name, Account Settings button, Logout button.
- **Navigation buttons** (quick link bar):
  - User Settings (user-settings.html)
  - Manage Categories (categories.html)
  - View Transactions (transactions.html)
  - View Investments (investments.html)
  - account settings (accounts.html)
  - manage bills (bills.html)
- **Banks section:** list of active Plaid items + Manual accounts. (archived banks not listed here)
  - this is a shortened and condensed summary of some of the information and actions also found in accounts.html see details in accounts.md for more complete details.
  - Per-bank: 
    - institution name, 
    - account count, 
    - sync status badges: investments billed? transactions billed? both billed?, 
    - quick action refresh bank: refresh bank button has two different separate behaviors depending on whether it is for a broken plaid item institution (EG user permission revoked etc) or a 'converted' bank which could be reconnected to a new plaid_item
      - EITHER: start link session in update mode: to fix broken connection statuses or let user update account data sharing permissions with the institution's oauth flow, OR 
      - Start link session in mode for connecting new bank: relink 'converted' bank, and lastly
    - quick action disconnect: asks followup question asking which type of disconnection they want
      - 1. they want to disconnect and use as manual (moves bank connection (`connection_status`) from 'linked' to 'converted' ), or 
      - 2. disconnect and archive (does all as in #1 AND updates archived status (`is_archived`) to true, or
        - note that all account information and bank information only shows up in accounts.html with transactions and investments information not being included in any other part of the app)  
      - 3. hard delete if they really want. (deletes everything for that bank and is unrecoverable)
- **Connection buttons:** (only location in entire application for connecting a new bank via plaid)
  - "Connect New Bank" with Transaction token (for checking/savings/credit).
  - "Connect New Bank" with Investment token (for brokerage/retirement).
- **Manual account creation:** No button just small subtext note telling user they may create manual accounts in accounts management section.
- **Webhook alerts:** display real-time alerts from backend (sync updates, errors).
- **Deletion banner** (if account deletion is pending).

## Router Logic
- **No auth token → show auth views** (login is default).
- **Valid token, no 2FA required → show dashboard**.
- **Valid token, 2FA required → show 2FA view**.
- **Expired token → show login view with "Session expired" message**.

## Plaid Link Integration
- Two separate link tokens: transactions and investments.
- On bank connection success: refresh connections list, show success message.
- On link close/cancel: dismiss without action, stay on dashboard.
- Webhook-based background sync: refresh connections list when webhooks arrive.

## Navigation Patterns
- Auth views are isolated; switching between them stays on index.html (no page reloads).
- Dashboard links navigate to other pages (transactions.html, etc.).
- Logout: clear tokens, show login view, clear local cache.

## UX Guardrails
- Keep auth flows simple and mobile-friendly (single form per view).
- Show clear error messages (invalid email, password too weak, etc.).
- Disable submit buttons during loading.
- Require password re-entry for sensitive operations (password reset, 2FA setup).
- Show connection status visually (green = active, yellow = needs attention, red = failed).
- Optimize for two-step onboarding: register → connect first bank → explore transactions.
