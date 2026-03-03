// ============================================================
// transactions/row-renderers.js — Type-Dispatched Row Renderers
//
// Each transaction type (or type group) has a dedicated renderer
// that returns the type-specific HTML fragments: badge, category
// cell, action cell, row CSS class, source badge, and display name.
//
// The main renderTransactionTable() classifies each row once via
// getTransactionType(), then dispatches to the appropriate renderer
// here — collapsing 6 parallel classification trees into one.
//
// Depends on: transaction-types.js, utils.js, categories.js
// ============================================================


/**
 * Shared autocomplete input + buttons template used by most category cells.
 * Avoids duplicating the same 8-line HTML block across every renderer.
 *
 * @param {string} txnId - Transaction ID for data binding.
 * @param {string} accountId - Account ID for data binding.
 * @param {string} categoryValue - Pre-filled category string.
 * @param {string} placeholder - Input placeholder text.
 * @param {string} buttonsHtml - Complete buttons HTML for the category-buttons div.
 *   Each renderer builds its own button bar so ordering is explicit.
 * @returns {string} HTML string for the category cell.
 */
function _buildCategoryAutocomplete(txnId, accountId, categoryValue, placeholder, buttonsHtml) {
  if (!txnId) {
    return `<div class="category-cell"><span class="category-locked">${escapeHtml(categoryValue || 'Uncategorized')}</span></div>`;
  }
  return `
    <div class="category-cell">
      <div class="category-autocomplete-wrap" data-txn-id="${txnId}">
        <input type="text" class="category-autocomplete" data-txn-id="${txnId}" data-account-id="${accountId}"
               value="${escapeHtml(categoryValue)}" placeholder="${escapeHtml(placeholder)}"
               autocomplete="off" spellcheck="false">
        <div class="category-ac-list" data-txn-id="${txnId}"></div>
      </div>
      <div class="category-buttons">
        ${buttonsHtml}
      </div>
    </div>
  `;
}


/**
 * Convenience: the ✓ "apply category" button used by most renderers.
 */
function _confirmButton(txnId, accountId) {
  return `<button class="category-override" data-txn-id="${txnId}" data-account-id="${accountId}" title="Apply category change">✓</button>`;
}


/**
 * Context object built once per-row in renderTransactionTable and passed
 * to every type renderer. Contains pre-computed values that all renderers
 * share so each renderer stays focused on type-specific logic only.
 *
 * @typedef {Object} RowRenderContext
 * @property {Object}  txn               - Raw transaction object from API.
 * @property {string}  txnId             - txn.transaction_id || ''.
 * @property {string}  accountId         - txn.account_id || ''.
 * @property {string}  currentFullCategory - Pre-parsed display category string.
 * @property {boolean} isBill            - Whether txn.is_bill is truthy.
 * @property {boolean} isTransfer        - Whether the row is a transfer.
 * @property {boolean} isPendingRow      - Whether txn.pending is truthy.
 * @property {boolean} isFutureBlockRow  - Whether the row sits in the future block.
 * @property {boolean} isMissingRow      - Whether the row sits in the missing block.
 * @property {string}  rowType           - The TXN_TYPE string from getTransactionType().
 */


/**
 * Result object returned by every type renderer.
 *
 * @typedef {Object} RowRenderResult
 * @property {string} typeBadge    - HTML for the badge in the description cell.
 * @property {string} categoryCell - HTML for the <td> category content.
 * @property {string} actionCell   - Full <td>...</td> HTML for the action column.
 * @property {string} rowCssClass  - CSS class(es) for the <tr>.
 * @property {Object} sourceBadge  - { label, cssClass, title } for the source column.
 * @property {string} displayName  - Transaction name to show in the description cell.
 */


// ── Type-specific renderers ────────────────────────────────────

function _renderOpeningBalanceRow(ctx) {
  const lockedCategory = `<div class="category-cell"><span class="category-locked">${escapeHtml(ctx.currentFullCategory || 'Uncategorized')}</span></div>`;
  const sourceTitle = ctx.txn.source === 'manual_opening_balance'
    ? 'Auto-generated manual opening balance'
    : 'Opening balance';

  return {
    typeBadge: '<span class="source-badge opening-balance" title="Opening balance">Opening Bal</span> ',
    categoryCell: lockedCategory,
    actionCell: '<td></td>',
    rowCssClass: '',
    sourceBadge: { label: 'Opening Bal', cssClass: 'opening-balance', title: sourceTitle },
    displayName: ctx.txn.name || '',
  };
}


function _renderScheduledRow(ctx) {
  const scheduledIsTransfer = isTransferCategory(ctx.txn.user_category) || !!ctx.txn.transfer_pair_id;

  const badge = ctx.isBill
    ? `<span class="source-badge scheduled" title="From bill: ${escapeHtml(ctx.txn.name || '')}">📅</span> `
    : '<span class="source-badge scheduled" title="Scheduled future transaction">📅</span> ';

  let buttons = '';
  if (!scheduledIsTransfer) {
    buttons += _confirmButton(ctx.txnId, ctx.accountId);
  }
  if (ctx.isBill) {
    buttons += `<button class="bill-edit-btn" data-bill-id="${escapeHtml(ctx.txn.bill_id || '')}" title="Edit this bill">Edit Bill</button>`;
  }

  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  let actionCell;
  if (ctx.isBill && ctx.txn.bill_id) {
    actionCell = `
      <td style="text-align: center;">
        <button class="skip-occurrence-btn" onclick="skipBillOccurrence('${escapeHtml(ctx.txn.bill_id)}', '${escapeHtml(ctx.txn.date)}')" title="Skip this bill occurrence">⏭</button>
      </td>
    `;
  } else {
    actionCell = '<td></td>';
  }

  const sourceLabel = ctx.isBill ? 'Bill' : 'Scheduled';
  const sourceTitle = ctx.isBill ? 'Upcoming bill payment' : 'Scheduled future transaction';

  return {
    typeBadge: badge,
    categoryCell,
    actionCell,
    rowCssClass: 'scheduled-row',
    sourceBadge: { label: sourceLabel, cssClass: 'scheduled', title: sourceTitle },
    displayName: ctx.txn.name || '',
  };
}


function _renderMissingRow(ctx) {
  const buttons = _confirmButton(ctx.txnId, ctx.accountId);
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const actionCell = ctx.txnId
    ? `<td style="text-align: center;">
        <button class="resolve-missing-btn" onclick="resolveMissingTransaction('${escapeHtml(ctx.txnId)}')" title="Mark as resolved — remove this missing transaction">✖</button>
      </td>`
    : '<td></td>';

  return {
    typeBadge: '<span class="source-badge missing" title="Expected payment not found">⚠</span> ',
    categoryCell,
    actionCell,
    rowCssClass: 'missing-row',
    sourceBadge: { label: 'Missing', cssClass: 'missing', title: 'Expected payment not yet matched to a plaid transaction' },
    displayName: ctx.txn.name || '',
  };
}


function _renderMatchedRow(ctx) {
  const buttons = _confirmButton(ctx.txnId, ctx.accountId)
    + `<button class="unmatch-btn" data-txn-id="${escapeHtml(ctx.txnId)}" onclick="unmatchScheduledTransaction('${escapeHtml(ctx.txnId)}')" title="Undo match — revert to missing + unhide plaid transaction">Unmatch</button>`;
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const approveOnclick = `event.stopPropagation(); approveMatch('${escapeHtml(ctx.txnId)}').then(() => { showStatus('Match approved', 'success'); localStorage.removeItem('pf_cached_transactions'); localStorage.removeItem('pf_transactions_cached_at'); fetchAllTransactions(true); }).catch(err => showStatus(err.message, 'error'));`;

  return {
    typeBadge: `<button class="approve-match-badge" data-txn-id="${escapeHtml(ctx.txnId)}" onclick="${approveOnclick}" title="Click to approve this match — removes the manual counterpart">✓</button> `,
    categoryCell,
    actionCell: '<td></td>',
    rowCssClass: 'matched-row',
    sourceBadge: { label: 'Matched', cssClass: 'matched', title: 'Scheduled transaction matched with a plaid transaction' },
    displayName: ctx.txn.name || '',
  };
}


function _renderMatchedPairRow(ctx) {
  const matchInfo = ctx.txn.match_info;
  const unmatchId = escapeHtml(matchInfo.matched_txn_id);
  const buttons = _confirmButton(ctx.txnId, ctx.accountId)
    + `<button class="unmatch-btn" data-txn-id="${unmatchId}" onclick="unmatchScheduledTransaction('${unmatchId}')" title="Undo match — revert manual to missing + detach from plaid">Unmatch</button>`;
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const approveOnclick = `event.stopPropagation(); approveMatch('${unmatchId}').then(() => { showStatus('Match approved', 'success'); localStorage.removeItem('pf_cached_transactions'); localStorage.removeItem('pf_transactions_cached_at'); fetchAllTransactions(true); }).catch(err => showStatus(err.message, 'error'));`;

  return {
    typeBadge: `<button class="approve-match-badge" data-txn-id="${unmatchId}" onclick="${approveOnclick}" title="Click to approve this match — removes the manual counterpart">✓</button> `,
    categoryCell,
    actionCell: '<td></td>',
    rowCssClass: 'matched-row',
    sourceBadge: { label: 'Matched', cssClass: 'matched', title: 'Plaid transaction merged with user-entered counterpart' },
    displayName: matchInfo.matched_name || ctx.txn.name || '',
  };
}


function _renderOrphanedRow(ctx) {
  const buttons = _confirmButton(ctx.txnId, ctx.accountId);
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const actionCell = ctx.txnId
    ? `<td style="text-align: center;">
        <button class="delete-transaction-btn" onclick="deleteManualTransaction('${escapeHtml(ctx.txnId)}')" title="Delete orphaned transaction">🗑</button>
      </td>`
    : '<td></td>';

  return {
    typeBadge: '<span class="source-badge orphaned" title="Orphaned manual transaction">⚡</span> ',
    categoryCell,
    actionCell,
    rowCssClass: 'orphaned-row',
    sourceBadge: { label: 'Orphaned', cssClass: 'orphaned', title: 'Manual transaction orphaned after account re-link' },
    displayName: ctx.txn.name || '',
  };
}


function _renderTransferRow(ctx) {
  const buttons = _confirmButton(ctx.txnId, ctx.accountId)
    + `<button class="transfer-unlink-btn" data-txn-id="${escapeHtml(ctx.txnId)}" onclick="unlinkTransfer('${escapeHtml(ctx.txnId)}')" title="Break this transfer pair">Unlink</button>`;
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type [ to reassign transfer…', buttons
  );

  return {
    typeBadge: '<span class="transfer-badge" title="Transfer">⇄</span> ',
    categoryCell,
    actionCell: '<td></td>',
    rowCssClass: ctx.isPendingRow ? 'pending-row' : '',
    sourceBadge: _getDefaultSourceBadge(ctx),
    displayName: ctx.txn.name || '',
  };
}


function _renderManualClearedRow(ctx) {
  const clearOverrideBtn = ctx.txn.is_override
    ? `<button class='clear-override' data-txn-id='${ctx.txnId}' onclick='clearOverride(event)' title='Remove override'>✕</button>`
    : '';

  const buttons = clearOverrideBtn
    + _confirmButton(ctx.txnId, ctx.accountId)
    + `<button class="category-rule" data-txn-id="${ctx.txnId}" data-account-id="${ctx.accountId}">Rule</button>`
    + `<button class="category-split" data-txn-id="${ctx.txnId}" onclick="window.splitModalTxnId='${escapeHtml(ctx.txnId)}'; openSplitModal(transactions.find(t => t.transaction_id === '${escapeHtml(ctx.txnId)}')); return false;" title="Split this transaction">Split</button>`;

  const enhancedCategory = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const actionCell = ctx.txnId
    ? `<td style="text-align: center;">
        <button class="delete-transaction-btn" onclick="deleteManualTransaction('${escapeHtml(ctx.txnId)}')" title="Delete manual transaction">🗑</button>
      </td>`
    : '<td></td>';

  return {
    typeBadge: '',
    categoryCell: enhancedCategory,
    actionCell,
    rowCssClass: '',
    sourceBadge: { label: 'Manual', cssClass: 'manual', title: 'Added manually by user' },
    displayName: ctx.txn.name || '',
  };
}


/**
 * Default renderer for plaid cleared/pending rows, reconciliation, and any
 * type that doesn't need special handling. Provides the full category
 * editing experience: autocomplete + override + rule + split buttons.
 */
function _renderDefaultRow(ctx) {
  const clearOverrideBtn = ctx.txn.is_override
    ? `<button class='clear-override' data-txn-id='${ctx.txnId}' onclick='clearOverride(event)' title='Remove override'>✕</button>`
    : '';

  const buttons = clearOverrideBtn
    + _confirmButton(ctx.txnId, ctx.accountId)
    + `<button class="category-rule" data-txn-id="${ctx.txnId}" data-account-id="${ctx.accountId}">Rule</button>`
    + `<button class="category-split" data-txn-id="${ctx.txnId}" onclick="window.splitModalTxnId='${escapeHtml(ctx.txnId)}'; openSplitModal(transactions.find(t => t.transaction_id === '${escapeHtml(ctx.txnId)}')); return false;" title="Split this transaction">Split</button>`;

  const enhancedCategory = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  return {
    typeBadge: '',
    categoryCell: enhancedCategory,
    actionCell: '<td></td>',
    rowCssClass: ctx.isPendingRow ? 'pending-row' : '',
    sourceBadge: _getDefaultSourceBadge(ctx),
    displayName: ctx.txn.name || '',
  };
}


/**
 * Source badge lookup for types that don't have a special source identity.
 * Falls back to standard manual/plaid/reconciliation labels.
 */
function _getDefaultSourceBadge(ctx) {
  if (ctx.txn.source === 'manual') {
    return { label: 'Manual', cssClass: 'manual', title: 'Added manually by user' };
  }
  if (ctx.txn.source === 'reconciliation') {
    return { label: 'Reconcil.', cssClass: 'reconciliation', title: 'Auto-generated balance reconciliation' };
  }
  return { label: 'Plaid', cssClass: 'plaid', title: 'From Plaid' };
}


// ── Dispatcher ─────────────────────────────────────────────────

/**
 * Classify a transaction once and dispatch to the appropriate renderer.
 * Returns a RowRenderResult with all type-specific HTML fragments that
 * renderTransactionTable() splices into the row.
 *
 * Priority order matters: matched-pair detection (plaid row that has been
 * merged with its counterpart) is checked before the raw type, because
 * the plaid row's own type is still PLAID_CLEARED — the match_info flag
 * is the distinguishing signal.
 *
 * Transfer detection is also orthogonal to type: any non-system cleared
 * row could be a transfer, so it's checked after type-specific renderers
 * that take priority (opening balance, scheduled, missing, matched, orphaned).
 *
 * @param {RowRenderContext} ctx - Pre-computed context for this row.
 * @returns {RowRenderResult}
 */
function renderRowByType(ctx) {
  const rowType = ctx.rowType;

  // Opening balance types — locked category, no actions
  if (rowType === TXN_TYPE.SYSTEM_OPENING_BALANCE || rowType === TXN_TYPE.SYSTEM_MANUAL_OPENING_BALANCE) {
    return _renderOpeningBalanceRow(ctx);
  }

  // Scheduled future transactions — bill skip button, edit-bill button
  if (rowType === TXN_TYPE.BILL_FUTURE || rowType === TXN_TYPE.MANUAL_FUTURE) {
    return _renderScheduledRow(ctx);
  }

  // Missing bills — resolve button
  if (rowType === TXN_TYPE.BILL_MISSING) {
    return _renderMissingRow(ctx);
  }

  // Matched rows (the manual/scheduled side) — approve + unmatch
  if (rowType === TXN_TYPE.BILL_MATCHED || rowType === TXN_TYPE.MANUAL_MATCH) {
    return _renderMatchedRow(ctx);
  }

  // Matched pair (the plaid side, carrying match_info) — approve + unmatch
  if (ctx.txn.match_info) {
    return _renderMatchedPairRow(ctx);
  }

  // Orphaned / manual missing — delete button
  if (rowType === TXN_TYPE.MANUAL_MISSING || rowType === TXN_TYPE.MANUAL_ORPHANED) {
    return _renderOrphanedRow(ctx);
  }

  // Transfer (orthogonal to type) — unlink button, bracket-notation category
  if (ctx.isTransfer) {
    return _renderTransferRow(ctx);
  }

  // Manual cleared rows — delete button, full category editing
  if (rowType === TXN_TYPE.MANUAL_CLEARED) {
    return _renderManualClearedRow(ctx);
  }

  // Everything else: plaid cleared/pending, reconciliation, investment trending, etc.
  return _renderDefaultRow(ctx);
}
