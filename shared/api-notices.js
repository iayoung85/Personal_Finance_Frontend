// ============================================================
// shared/api-notices.js — Notices the API attaches to a success
// ============================================================

/**
 * The notices an API success response carries, as a list of non-empty strings.
 * An older API sends none, so a missing or malformed field is an empty list.
 *
 * @param {object|null|undefined} responseBody - Parsed JSON of a success response.
 * @returns {string[]}
 */
function extractNotices(responseBody) {
  if (!responseBody || !Array.isArray(responseBody.notices)) return [];
  return responseBody.notices.filter(
    notice => typeof notice === 'string' && notice.trim() !== ''
  );
}
