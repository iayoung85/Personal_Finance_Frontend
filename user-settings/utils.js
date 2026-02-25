// ============================================================
// user-settings/utils.js — Shared Pure Helpers
// No network calls, no DOM side-effects beyond the single
// element referenced by ID. All functions are input → output
// or target a named container element.
// ============================================================

/**
 * Renders a success/error/info/warning message inside a
 * named container element. Auto-dismisses nothing, caller
 * is responsible for clearing if needed.
 *
 * @param {string} elementId - ID of the target DOM element
 * @param {string} message   - HTML string to display
 * @param {string} type      - 'success' | 'error' | 'info' | 'warning'
 */
function showMessage(elementId, message, type) {
  $(`#${elementId}`).html(`<div class="message ${type}">${message}</div>`);
}

/**
 * Escapes HTML special characters to prevent XSS when
 * interpolating user-controlled strings into innerHTML.
 *
 * @param {string} text - Raw string to sanitize
 * @returns {string} HTML-safe string
 */
function escapeHtml(text) {
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text || '').replace(/[&<>"']/g, character => escapeMap[character]);
}


