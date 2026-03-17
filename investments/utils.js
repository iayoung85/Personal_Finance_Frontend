// ============================================================
// investments/utils.js — Pure utility/formatting helpers
// No DOM manipulation, no network calls, no side effects.
// ============================================================

function formatCurrency(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatCompactCurrency(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
}

function formatDateTime(isoString) {
  if (!isoString) return 'Never';
  return new Date(isoString).toLocaleString();
}

function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals) + '%';
}

/**
 * Price fallback helper: prefer security prices; fall back to holding-level
 * prices or compute implied price from institution_value / quantity.
 */
function derivePrice(security, holding) {
  const candidates = [
    security.close_price,
    security.price,
    security.institution_price,
    holding.institution_price,
    holding.price
  ];
  let price = candidates.find(value => value !== null && value !== undefined && Number.isFinite(value) && value > 0);
  if (!price && holding.institution_value && holding.quantity) {
    price = holding.quantity !== 0 ? (holding.institution_value / holding.quantity) : 0;
  }
  return price || 0;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Build a human-readable display name for an investment account.
 * Custom name takes priority.
 */
function buildAccountDisplayName(account) {
  if (account.custom_name) return account.custom_name;
  const institution = account.institution_name || '';
  const accountName = account.account_name || 'Unknown Account';
  const mask = account.mask;
  let nameWithMask = accountName;
  if (mask && !accountName.includes(mask)) {
    nameWithMask = `${accountName} (${mask})`;
  }
  return institution ? `${institution} - ${nameWithMask}` : nameWithMask;
}

/**
 * Look up a security object by its security_id from the global securitiesData array.
 */
function getSecurityById(securityId) {
  return securitiesData.find(sec => sec.security_id === securityId);
}

/**
 * Create a mapping from internal account_id to plaid_account_id
 * for matching selections against holdings data.
 */
function buildAccountIdToPlaidIdMap() {
  const mapping = {};
  investmentAccounts.forEach(acc => {
    mapping[acc.account_id] = acc.plaid_account_id;
  });
  return mapping;
}

/**
 * Get the set of plaid account IDs that correspond to currently selected accounts.
 */
function getSelectedPlaidAccountIds() {
  const accountIds = getSelectedAccountIds();
  const mapping = buildAccountIdToPlaidIdMap();
  return accountIds.map(id => mapping[id]).filter(Boolean);
}

/**
 * Returns array of selected internal account_ids based on current mode.
 */
function getSelectedAccountIds() {
  if (poolAllMode) {
    return investmentAccounts
      .filter(acc => acc.status === 'active')
      .map(acc => acc.account_id);
  }
  return Array.from(selectedAccountIds);
}

/**
 * Trigger a file download in the browser from a string.
 */
function downloadAsFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
