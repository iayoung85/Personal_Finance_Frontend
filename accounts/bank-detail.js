// ============================================================
// accounts/bank-detail.js — Bank Detail View
// Renders the main content area when a bank is selected:
// bank metadata card, connection info, and bank-level actions.
// ============================================================

/**
 * Render the Bank Detail View in the main content area.
 * Fetches full detail from the backend for institution metadata and Plaid item info.
 */
async function renderBankDetail(bankId) {
  const mainContent = document.getElementById('main-content');

  // Use cache for instant layout, then enrich with full detail from backend
  const cachedBank = banksCache.find(bankItem => bankItem.bank_id === bankId);
  if (!cachedBank) {
    mainContent.innerHTML =
      '<div style="padding: 20px; color: #c62828;">Bank not found.</div>';
    return;
  }

  // Show the basic view immediately from cache
  mainContent.innerHTML = _buildBankDetailHtml(cachedBank);

  // Fetch full detail in background to enrich with institution metadata
  try {
    const fullDetail = await apiFetchBankDetail(bankId);
    // Merge the enriched fields into the cached bank for this render
    const enrichedBank = { ...cachedBank, ...fullDetail };
    mainContent.innerHTML = _buildBankDetailHtml(enrichedBank);
  } catch (fetchError) {
    // Non-fatal — the cached view is still visible
    console.warn('Could not fetch full bank detail:', fetchError.message);
  }
}

function _buildBankDetailHtml(bank) {
  const displayName = buildBankDisplayName(bank);
  const childAccounts = bank.accounts || [];
  const activeCount = childAccounts.filter(acct => !acct.is_archived).length;
  const archivedCount = childAccounts.filter(acct => acct.is_archived).length;

  // Badges
  const badges = [
    renderOriginBadge(bank.origin),
    renderConnectionBadge(bank.connection_status),
    renderHealthBadge(bank.connection_status, bank.item_health),
    renderArchivedBadge(bank.is_archived)
  ].filter(Boolean).join(' ');

  // Bank total balance (sum of child accounts)
  const totalBalance = childAccounts.reduce((sum, acct) => sum + (parseFloat(acct.current_balance) || 0), 0);
  const totalBalanceStr = formatCurrency(totalBalance);

  // Contact info — user-provided overrides Plaid data
  const contactInfo = bank.contact_info || {};
  const phone = contactInfo.phone || '';
  const phoneSource = contactInfo.phone_source || null;
  const address = contactInfo.address || '';
  const addressSource = contactInfo.address_source || null;
  const website = contactInfo.website || (bank.institution_metadata ? bank.institution_metadata.url : null);

  return `
    <!-- Bank Metadata Card -->
    <div class="detail-card">
      <div class="detail-card-header">
        <h2>${_escapeHtml(displayName)}</h2>
        <div class="detail-card-badges">${badges}</div>
      </div>

      <div class="metadata-grid">
        <div class="metadata-item">
          <span class="metadata-label">Total Balance</span>
          <span class="metadata-value balance ${totalBalance < 0 ? 'negative' : ''}">${totalBalanceStr}</span>
        </div>
        <div class="metadata-item">
          <span class="metadata-label">Accounts</span>
          <span class="metadata-value">
            <div class="account-count-breakdown">
              <span>${activeCount} active</span>
              ${archivedCount > 0 ? `<span style="color:#f9a825;">${archivedCount} archived</span>` : ''}
            </div>
          </span>
        </div>
        ${website ? `
        <div class="metadata-item">
          <span class="metadata-label">Website</span>
          <span class="metadata-value">
            <a href="${_escapeHtml(website)}" target="_blank" rel="noopener">${_escapeHtml(website)}</a>
          </span>
        </div>
        ` : ''}
        <div class="metadata-item">
          <span class="metadata-label">Created</span>
          <span class="metadata-value">${bank.created_at ? new Date(bank.created_at).toLocaleDateString() : '—'}</span>
        </div>
      </div>

      <!-- Contact Info Section — editable by user -->
      <div class="contact-info-section">
        <h4 class="section-subheading">Contact Info</h4>
        <div class="contact-info-grid">
          <div class="contact-field">
            <label class="metadata-label" for="bank-phone-input">Phone</label>
            <div class="contact-input-row">
              <input type="tel" id="bank-phone-input"
                     value="${_escapeAttr(bank.user_phone || '')}"
                     placeholder="${phone && phoneSource === 'plaid' ? _escapeAttr(phone) : 'e.g. 1-800-935-9935'}"
                     class="contact-input" />
              ${phone ? `<a href="tel:${_escapeAttr(phone)}" class="contact-call-link" title="Call ${_escapeHtml(phone)}">📞</a>` : ''}
            </div>
            ${phone && phoneSource === 'plaid' && !bank.user_phone ? `<span class="contact-source-hint">From Plaid — add your own to override</span>` : ''}
          </div>
          <div class="contact-field">
            <label class="metadata-label" for="bank-address-input">Address</label>
            <div class="contact-input-row">
              <input type="text" id="bank-address-input"
                     value="${_escapeAttr(bank.user_address || '')}"
                     placeholder="${address && addressSource === 'plaid' ? _escapeAttr(address) : 'e.g. 123 Main St, City, ST 12345'}"
                     class="contact-input" />
            </div>
            ${address && addressSource === 'plaid' && !bank.user_address ? `<span class="contact-source-hint">From Plaid — add your own to override</span>` : ''}
          </div>
        </div>
        <div class="contact-save-row">
          <button class="btn-secondary btn-sm" onclick="saveBankContactInfo('${bank.bank_id}')">Save Contact Info</button>
        </div>
      </div>

      <!-- Accounts list under this bank -->
      <div style="margin-top: 16px;">
        <span class="metadata-label" style="display: block; margin-bottom: 8px;">Accounts Under This Bank</span>
        ${_buildBankAccountsList(bank)}
      </div>

      <!-- Notes Field -->
      <div class="notes-field">
        <label class="metadata-label" style="margin-bottom: 4px; display: block;">Notes</label>
        <textarea id="bank-notes-input" rows="2" placeholder="Add notes…">${_escapeHtml(bank.notes || '')}</textarea>
        <div class="notes-save-row">
          <button class="btn-secondary btn-sm" onclick="saveBankNotes('${bank.bank_id}')">Save Notes</button>
        </div>
      </div>

      <!-- Connection Details (collapsible — for users who want the raw info) -->
      ${_buildConnectionDetailsCollapsible(bank)}
    </div>

    <!-- Bank Actions Section -->
    <div class="actions-section">
      <h3>Bank Actions</h3>
      <div class="action-list">
        ${_buildBankActions(bank)}
      </div>
    </div>
  `;
}

/**
 * Build the small list of accounts under a bank for the detail card.
 */
function _buildBankAccountsList(bank) {
  const childAccounts = bank.accounts || [];
  if (childAccounts.length === 0) {
    return '<div style="color: #999; font-size: 13px;">No accounts under this bank.</div>';
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 4px;">';
  for (const account of childAccounts) {
    const displayName = buildAccountDisplayName(account);
    const balance = parseFloat(account.current_balance) || 0;
    const balanceStr = formatCurrency(balance);
    const archivedTag = account.is_archived ? ' <span class="badge badge-archived" style="font-size:9px; padding:1px 4px;">Archived</span>' : '';

    html += `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: #fafafa; border-radius: 4px; cursor: pointer;"
           onclick="selectAccount('${account.account_id}')">
        <span style="font-size: 13px;">
          ${_escapeHtml(displayName)}${archivedTag}
          <span class="account-type-badge" style="margin-left: 4px;">${account.account_subcategory || account.account_category || ''}</span>
        </span>
        <span style="font-size: 13px; font-weight: 500; ${balance < 0 ? 'color: #c62828;' : 'color: #2e7d32;'}">${balanceStr}</span>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

/**
 * Build the HTML for bank action items.
 */
function _buildBankActions(bank) {
  let actions = '';

  // ── Rename (manual banks only, or any bank via custom_name) ──
  actions += _actionItem(
    'Rename Bank',
    'Change the display name for this bank group.',
    `<button class="btn-action" onclick="promptRenameBank('${bank.bank_id}', '${_escapeAttr(bank.custom_name || '')}')">Rename</button>`,
    'info-rename-bank',
    'Sets a custom display name for this bank. For Plaid-linked banks, the institution name is preserved — custom_name is displayed as an override.'
  );

  // ── Convert to Manual (Plaid-linked only) ──
  if (bank.origin === 'plaid' && bank.connection_status === 'linked') {
    actions += _actionItem(
      'Convert Bank to Manual',
      'Remove the Plaid item (stops billing). All transaction history is preserved. You can re-link later.',
      `<button class="btn-warn btn-sm" onclick="convertBankToManual('${bank.bank_id}', '${_escapeAttr(buildBankDisplayName(bank))}')">Convert</button>`,
      'info-convert',
      'Removes the Plaid item from Plaid\'s API, stopping billing immediately. All existing transaction history is preserved — transaction source stays immutable (plaid-sourced transactions keep source=\'plaid\' as frozen history). Item metadata is snapshotted for future re-link. Bank\'s connection_status flips from "linked" to "converted".'
    );
  }

  // ── Archive / Unarchive Bank ──
  if (bank.is_archived) {
    actions += _actionItem(
      'Unarchive Bank',
      'Restore this bank and all its accounts to active views. Does not change connection status.',
      `<button class="btn-action" onclick="unarchiveBank('${bank.bank_id}')">Unarchive</button>`,
      'info-unarchive-bank',
      'Flips is_archived=false on the bank and all its child accounts. A converted bank stays converted — this is a visibility toggle only.'
    );
  } else {
    actions += _actionItem(
      'Archive Bank',
      bank.connection_status === 'linked'
        ? 'Converts to manual first (stops Plaid billing), then archives the bank and all accounts.'
        : 'Hides the bank and all its accounts from active views. All data is preserved.',
      `<button class="btn-warn btn-sm" onclick="archiveBank('${bank.bank_id}', '${_escapeAttr(buildBankDisplayName(bank))}')">Archive</button>`,
      'info-archive-bank',
      bank.connection_status === 'linked'
        ? 'Archiving a linked bank automatically converts it to manual first (Plaid billing stops). The bank and all child accounts become hidden from dashboard, transactions, and investments. Data is fully preserved. Reversible via Unarchive.'
        : 'Hides the bank and all its accounts from dashboard, transactions, and investments. All data is preserved. Reversible via Unarchive.'
    );
  }

  // ── Hard Delete Bank ──
  actions += _actionItem(
    'Delete Bank & All Data',
    'Permanently removes this bank, all accounts, all transactions, and all balance data. Irreversible.',
    `<button class="btn-danger btn-sm" onclick="hardDeleteBank('${bank.bank_id}', '${_escapeAttr(buildBankDisplayName(bank))}')">Delete</button>`,
    'info-delete-bank',
    'This is the nuclear option — permanently destroys the bank, every account under it, all their transactions, balance history, and snapshots. You will need to type the bank name to confirm. This action cannot be undone.'
  );

  return actions;
}

// ── Bank Action Handlers ─────────────────────────────────────

async function promptRenameBank(bankId, currentCustomName) {
  const newName = prompt('Enter a custom name for this bank (leave empty to reset):', currentCustomName);
  if (newName === null) return;

  try {
    showToast('Updating bank name…', 'info');
    await apiUpdateBank(bankId, { custom_name: newName.trim() || null });
    showToast('Bank renamed successfully', 'success');
    await reloadAndReselect();
  } catch (renameError) {
    showToast(`Failed to rename: ${renameError.message}`, 'error');
  }
}

function convertBankToManual(bankId, bankDisplayName) {
  openConfirmModal(
    'Convert Bank to Manual',
    `This will disconnect "${bankDisplayName}" from Plaid. Billing will stop immediately. ` +
    'All your existing transaction history is preserved. You can re-link this bank to Plaid at any time.',
    async () => {
      try {
        showToast('Converting bank to manual…', 'info');
        await apiConvertBankToManual(bankId);
        showToast('Bank converted to manual. Billing stopped. Transaction history preserved.', 'success');
        await reloadAndReselect();
      } catch (convertError) {
        showToast(`Failed to convert: ${convertError.message}`, 'error');
      }
    },
    { buttonLabel: 'Convert to Manual', buttonClass: 'btn-warn' }
  );
}

function archiveBank(bankId, bankDisplayName) {
  const linkedNote = banksCache.find(bankItem => bankItem.bank_id === bankId)?.connection_status === 'linked'
    ? ' Since this bank is Plaid-linked, it will be converted to manual first (billing stops).'
    : '';

  openConfirmModal(
    'Archive Bank',
    `This will archive "${bankDisplayName}" and all its accounts.${linkedNote} Data is fully preserved. You can unarchive at any time.`,
    async () => {
      try {
        showToast('Archiving bank…', 'info');
        await apiArchiveBank(bankId);
        showToast('Bank archived', 'success');
        selectedBankId = null;
        selectedAccountId = null;
        await reloadAndReselect();
      } catch (archiveError) {
        showToast(`Failed to archive: ${archiveError.message}`, 'error');
      }
    },
    { buttonLabel: 'Archive', buttonClass: 'btn-warn' }
  );
}

async function unarchiveBank(bankId) {
  try {
    showToast('Unarchiving bank…', 'info');
    await apiUnarchiveBank(bankId);
    showToast('Bank unarchived', 'success');
    await reloadAndReselect();
  } catch (unarchiveError) {
    showToast(`Failed to unarchive: ${unarchiveError.message}`, 'error');
  }
}

function hardDeleteBank(bankId, bankDisplayName) {
  openConfirmModal(
    'Delete Bank & All Data',
    `This will PERMANENTLY delete "${bankDisplayName}", all its accounts, all transactions, ` +
    'balance history, and snapshots. This action CANNOT be undone.',
    async () => {
      try {
        showToast('Deleting bank…', 'info');
        await apiHardDeleteBank(bankId);
        showToast('Bank and all data permanently deleted', 'success');
        selectedBankId = null;
        selectedAccountId = null;
        await reloadAndReselect();
      } catch (deleteError) {
        showToast(`Failed to delete: ${deleteError.message}`, 'error');
      }
    },
    {
      typedConfirmation: bankDisplayName,
      buttonLabel: 'Delete Permanently',
      buttonClass: 'btn-danger'
    }
  );
}

async function saveBankNotes(bankId) {
  const notesInput = document.getElementById('bank-notes-input');
  if (!notesInput) return;
  try {
    showToast('Saving notes…', 'info');
    await apiUpdateBank(bankId, { notes: notesInput.value });
    showToast('Notes saved', 'success');
  } catch (notesError) {
    showToast(`Failed to save notes: ${notesError.message}`, 'error');
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Build a collapsible section with connection/classification details.
 * Keeps the raw Plaid info accessible without cluttering the main view.
 */
function _buildConnectionDetailsCollapsible(bank) {
  const hasPlaidInfo = bank.plaid_item_info || bank.institution_id || bank.plaid_item_id;
  if (!hasPlaidInfo && bank.origin === 'manual') {
    // For simple manual banks with no Plaid heritage, skip entirely
    return '';
  }

  let detailRows = '';

  // Classification rows (always shown)
  detailRows += `
    <tr>
      <td>Origin</td>
      <td>${renderOriginBadge(bank.origin)}</td>
      <td>${bank.origin === 'plaid' ? 'Created from a Plaid Link connection — immutable' : 'Created by the user manually'}</td>
    </tr>
    <tr>
      <td>Connection</td>
      <td>${renderConnectionBadge(bank.connection_status)}</td>
      <td>${_connectionMeaning(bank.connection_status)}</td>
    </tr>`;

  if (bank.connection_status === 'linked') {
    detailRows += `
    <tr>
      <td>Health</td>
      <td>${renderHealthBadge(bank.connection_status, bank.item_health)}</td>
      <td>${_healthMeaning(bank.item_health)}</td>
    </tr>`;
  }

  // Plaid-specific technical info
  if (bank.institution_id) {
    detailRows += `
    <tr><td>Institution ID</td><td colspan="2">${_escapeHtml(bank.institution_id)}</td></tr>`;
  }
  if (bank.plaid_item_id) {
    detailRows += `
    <tr><td>Plaid Item ID</td><td colspan="2" style="font-size:12px;word-break:break-all;">${_escapeHtml(bank.plaid_item_id)}</td></tr>`;
  }
  if (bank.plaid_item_info) {
    const itemInfo = bank.plaid_item_info;
    if (itemInfo.billed_products && itemInfo.billed_products.length > 0) {
      detailRows += `
    <tr><td>Billed Products</td><td colspan="2" style="font-size:12px;">${itemInfo.billed_products.join(', ')}</td></tr>`;
    }
    if (itemInfo.last_webhook_at) {
      detailRows += `
    <tr><td>Last Webhook</td><td colspan="2">${new Date(itemInfo.last_webhook_at).toLocaleString()}</td></tr>`;
    }
  }
  if (bank.institution_metadata) {
    const instMeta = bank.institution_metadata;
    if (instMeta.routing_numbers && instMeta.routing_numbers.length > 0) {
      detailRows += `
    <tr><td>Routing Numbers</td><td colspan="2" style="font-size:12px;">${instMeta.routing_numbers.join(', ')}</td></tr>`;
    }
  }

  return `
    <details class="connection-details-collapsible">
      <summary class="section-subheading collapsible-trigger">Connection &amp; Technical Details</summary>
      <table class="classification-table">
        <thead>
          <tr><th>Field</th><th>Value</th><th>Meaning</th></tr>
        </thead>
        <tbody>${detailRows}</tbody>
      </table>
    </details>`;
}

// ── Contact Info Handler ─────────────────────────────────────

async function saveBankContactInfo(bankId) {
  const phoneInput = document.getElementById('bank-phone-input');
  const addressInput = document.getElementById('bank-address-input');
  if (!phoneInput && !addressInput) return;

  const fields = {};
  if (phoneInput) fields.user_phone = phoneInput.value.trim() || null;
  if (addressInput) fields.user_address = addressInput.value.trim() || null;

  try {
    showToast('Saving contact info…', 'info');
    await apiUpdateBank(bankId, fields);
    showToast('Contact info saved', 'success');
    // Re-render to update source hints and call link
    await reloadAndReselect();
  } catch (contactError) {
    showToast(`Failed to save: ${contactError.message}`, 'error');
  }
}

/**
 * Build metadata grid items for institution information.
 * @deprecated Kept for backward compat — contact info is now inline-editable.
 * Returns empty string when no institution metadata is available.
 */
function _buildInstitutionMetadataItems(institutionMetadata) {
  // No longer rendered in the main card — info is in contact section
  // and collapsible details. Kept as no-op for safety.
  return '';
}

/**
 * Build metadata grid items for live Plaid item info (billed products, status).
 * @deprecated Moved into collapsible connection details section.
 * Returns empty string.
 */
function _buildPlaidItemInfoItems(plaidItemInfo) {
  return '';
}

function _healthMeaning(itemHealth) {
  if (!itemHealth || itemHealth === 'active' || itemHealth === 'ok') {
    return 'Plaid item is healthy, syncing normally.';
  }
  if (itemHealth === 'needs_update') {
    return 'Credentials expired or permissions revoked. Relink action required.';
  }
  return 'Plaid item in error state. May need relink.';
}

/**
 * Render the empty-state prompt in main content.
 */
function renderEmptyMainContent() {
  document.getElementById('main-content').innerHTML = `
    <div class="empty-state-prompt">
      <div class="empty-state-icon">🏦</div>
      <h2>Select a bank or account</h2>
      <p>Choose an item from the sidebar to view its details and available actions.</p>
    </div>
  `;
}
