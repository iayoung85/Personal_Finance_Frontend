// ============================================================
// user-settings/state.js — Auth State & Global Variables
// Owns the in-memory auth state that all modules read.
// Loaded FIRST so every subsequent module can reference these.
// ============================================================

let authToken = localStorage.getItem('authToken');
let refreshToken = localStorage.getItem('refreshToken');
let currentUser = null;

/**
 * Re-reads auth values from localStorage into module-level vars.
 * Call this after any operation that may change stored tokens.
 */
function refreshAuthState() {
  authToken = localStorage.getItem('authToken');
  refreshToken = localStorage.getItem('refreshToken');
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch (e) {
    console.error('Error parsing currentUser from localStorage', e);
    localStorage.removeItem('currentUser');
    currentUser = null;
  }
}

// Populate state on script load
refreshAuthState();
