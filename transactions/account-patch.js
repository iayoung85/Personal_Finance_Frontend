/**
 * Balance fields an API account carries, and how each maps to the in-memory
 * account. `GET /api/accounts` and the `affected_accounts` list in a save
 * response describe these fields the same way, so both read through this one
 * table.
 *
 * `sources` are the API keys a field reads, in priority order; a patch entry
 * only overwrites a field when it carries at least one of them.
 */
const ACCOUNT_BALANCE_FIELDS = [
  {
    key: 'current_balance',
    sources: ['current_balance'],
    // The API sends a decimal string ("0" for zero), so parse it.
    read: (apiAccount) => parseFloat(apiAccount.current_balance) || 0,
  },
  {
    key: 'last_updated',
    sources: ['last_balance_update', 'last_updated'],
    read: (apiAccount) => apiAccount.last_balance_update || apiAccount.last_updated || null,
  },
  {
    key: 'plaid_balance',
    sources: ['plaid_balance'],
    read: (apiAccount) => (apiAccount.plaid_balance != null ? parseFloat(apiAccount.plaid_balance) : null),
  },
  {
    key: 'bank_agreement',
    sources: ['bank_agreement'],
    read: (apiAccount) => apiAccount.bank_agreement || null,
  },
];

/**
 * Map the balance-derived fields of an API account to in-memory fields.
 *
 * @param {Object} apiAccount An account from `/api/accounts` or an entry of a
 *   response's `affected_accounts`.
 * @param {{onlyCarried?: boolean}} [options] With `onlyCarried`, skip fields
 *   the API object does not carry, so a partial entry cannot blank them.
 * @returns {Object} The mapped fields, keyed as the in-memory account keys them.
 */
function mapAccountBalanceFields(apiAccount, options) {
  const onlyCarried = !!(options && options.onlyCarried);
  const mapped = {};
  ACCOUNT_BALANCE_FIELDS.forEach((field) => {
    const carried = field.sources.some((source) => Object.prototype.hasOwnProperty.call(apiAccount, source));
    if (onlyCarried && !carried) return;
    mapped[field.key] = field.read(apiAccount);
  });
  return mapped;
}

/**
 * Merge a save response's `affected_accounts` into the page's accounts.
 *
 * Returns new account objects for the patched accounts and leaves the input
 * untouched. An empty list is a valid answer ("nothing changed") and patches
 * nothing. `patched: false` means the caller must reload accounts instead:
 * the list is missing (an older API, or the API could not build it) or names
 * an account this page does not hold.
 *
 * @param {Object[]} currentAccounts The in-memory accounts.
 * @param {Object[]|undefined} affectedAccounts The response's list.
 * @returns {{patched: boolean, accounts: Object[]}}
 */
function patchAccountsFromAffected(currentAccounts, affectedAccounts) {
  const held = Array.isArray(currentAccounts) ? currentAccounts : [];
  if (!Array.isArray(affectedAccounts)) {
    return { patched: false, accounts: held };
  }

  const fieldsByAccountId = new Map();
  for (const entry of affectedAccounts) {
    const entryId = entry && entry.account_id;
    if (!entryId || !held.some((account) => account.account_id === entryId)) {
      return { patched: false, accounts: held };
    }
    fieldsByAccountId.set(entryId, mapAccountBalanceFields(entry, { onlyCarried: true }));
  }

  if (fieldsByAccountId.size === 0) {
    return { patched: true, accounts: held };
  }

  const patchedAccounts = held.map((account) => {
    const fields = fieldsByAccountId.get(account.account_id);
    return fields ? { ...account, ...fields } : account;
  });
  return { patched: true, accounts: patchedAccounts };
}

/**
 * Whether the ledger column of the selected account is behind a response.
 *
 * True when the response lists the selected account among those it rebuilt
 * and brings no `affected_balance_history` to patch the column from. A site
 * that patches or fetches the column itself has the history and gets false.
 *
 * @param {Object|null|undefined} responseData Parsed JSON body of the save.
 * @param {string} selectedMode 'single' or 'all'.
 * @param {string|null} selectedId The selected account in single mode.
 * @returns {boolean}
 */
function selectedLedgerNeedsRefresh(responseData, selectedMode, selectedId) {
  if (!responseData || selectedMode !== 'single' || !selectedId) return false;
  if (responseData.affected_balance_history) return false;
  const affected = responseData.affected_accounts;
  if (!Array.isArray(affected)) return false;
  return affected.some((entry) => entry && entry.account_id === selectedId);
}
