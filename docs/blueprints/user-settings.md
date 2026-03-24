# User Settings Page Blueprint (Target End State)

> **Disclaimer:** This document describes the **desired final UX and behavior** for the User Settings page. It is intentionally written as an end-state blueprint, not an implementation status log.

Source reference: user-settings.html, user-settings.js, user-settings.css (rename from account.*)

## Modular File Map (Vanilla JS Target)

- `user-settings.html`
  - Page shell, settings navigation menu, content panels, script includes.
- `user-settings.css`
  - Layout (sidebar + content), panel styles, form styles, alert/banner styling.
- `user-settings/main.js`
  - Page bootstrap and wiring (initialize app, load user data, bind navigation listeners).
- `user-settings/state.js`
  - UI state (active section, edit modes, form data cache).
- `user-settings/api.js`
  - All backend calls (fetch user profile, update profile, change password, 2FA endpoints, account deletion).
- `user-settings/nav.js`
  - Navigation menu rendering and section switching logic.
- `user-settings/profile.js`
  - Profile details panel: display and edit user info (email, name, etc.).
- `user-settings/password.js`
  - Change password panel: current password verification, new password validation, confirmation.
- `user-settings/two-factor.js`
  - 2FA panel: enable/disable TOTP, display secret key, show recovery codes, validate setup.
- `user-settings/account-deletion.js`
  - Account deletion panel: confirmation modal, password re-verification, irreversible action warning.
- `user-settings/utils.js`
  - Shared helpers (validation, error formatting, status messaging).
- `profile.js`
  - renders profile info and edit form. email is read-only with changes made by admin.


### File Ownership Rules
- Keep DOM rendering code out of `api.js`.
- Keep network calls out of render modules.
- Keep password/2FA validation logic pure (input -> output).
- Keep `main.js` thin; it should orchestrate modules, not contain business logic.

## Purpose
A single hub for user account settings, authentication management, and account lifecycle (profile, password, 2FA, deletion).

## Page Structure
- **Top navigation:** link back to Dashboard.
- **Left sidebar (sticky):** settings navigation menu.
  - Profile Details
  - Change Password
  - Two-Factor Authentication
  - Delete Account
- **Main content (right):** active settings panel.
  - One panel visible at a time.
  - Smooth transitions between sections.

## Settings Sections

### Profile Details
- Display current user information (email, name, account creation date).
- Edit profile: name field (editable), email field (read-only or separate verification flow).
- Save/Cancel buttons.
- Confirmation message on successful update.

### Change Password
- Current password field (required for verification).
- New password field (with strength indicator).
- Confirm new password field (match validation).
- Save/Cancel buttons.
- Error messages for weak passwords or mismatch.
- Confirmation message on successful change.

### Two-Factor Authentication (TOTP)
- **Status display:** "Enabled" or "Disabled" badge.
- **If disabled:**
  - Setup button → shows secret key + QR code.
  - User scans QR with authenticator app.
  - Verification field: user enters 6-digit TOTP code.
  - Recovery codes display after successful setup.
  - Confirmation message.
- **If enabled:**
  - Disable button (with re-authentication).
  - View/download recovery codes.
  - Regenerate recovery codes button.

### Account Deletion
- **Warning banner:** "This action is permanent and cannot be undone."
- **Confirmation flow:**
  - Text input asking user to type "DELETE" to confirm.
  - Password re-verification (security measure).
  - Delete button (disabled until confirmation is valid).
  - Final confirmation modal before executing deletion.
- **On deletion:** clear all local storage, redirect to login, show farewell message.

### App Configuration
- App appearance 
  - Light/Dark mode
- Dates and Formatting
  - ability to choose preferred date formatting for entire app: YYYYMMDD, MM/DD/YYYY, DD/MM/YYYY, MMM D,YYYY
  - First day of the week pref (Sun or Mon) for calendar pickers and weekly rollup views
- Number and currency display
  - Currency USD, Eur, GBP
  - Show cents toggle yes/no
  - Use compact notation for large amounts
- Dashboard and view defaults let user choose how many days of transactions should be filtered by result choices include:
  - last 30 days
  - Month to date
  - last month
  - YTD
- Notifications
  - weekly spending summary emails
  - bill due-date reminder emails
  - negative balance warning emails

## UX Guardrails
- Keep settings sections one per screen (no scrolling through multiple sections).
- Require explicit confirmation for destructive actions (password change, 2FA changes, account deletion).
- Show loading states during API calls (disable buttons, show spinner).
- Display success/error messages clearly and with auto-dismiss (3-5 seconds).
- Keep sensitive operations (password, deletion) non-repeatable without re-verification.
- Show last updated timestamp for non-critical fields (profile, 2FA status).
