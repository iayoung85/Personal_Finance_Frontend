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
 * Return the user-facing description for a transaction.
 * Prefers merchant_name from Plaid, falls back to the raw name field,
 * then to the legacy description field for backward compatibility.
 */
function _txnDescription(txn) {
  return txn.merchant_name || txn.name || txn.description || '';
}


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
               value="${escapeHtml(categoryValue)}" placeholder="${escapeHtml(placeholder)}" title="${escapeHtml(categoryValue)}"
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
    displayName: _txnDescription(ctx.txn),
  };
}


function _renderInvestmentTrendingRow(ctx) {
  const lockedCategory = `<div class="category-cell"><span class="category-locked">${escapeHtml(ctx.currentFullCategory || 'System: Investment Performance')}</span></div>`;

  // Green/red amount class based on whether the month was a gain or loss
  const amountClass = ctx.txn.amount > 0 ? 'trending-gain' : ctx.txn.amount < 0 ? 'trending-loss' : '';

  return {
    typeBadge: '<span class="source-badge investment-trending" title="System investment performance estimate">📈</span> ',
    categoryCell: lockedCategory,
    actionCell: '<td></td>',
    rowCssClass: 'investment-trending-row',
    sourceBadge: {
      label: 'Trend',
      cssClass: 'investment-trending',
      title: 'Monthly investment performance (system generated)',
    },
    displayName: _txnDescription(ctx.txn),
    amountCssExtra: amountClass,
  };
}


function _renderScheduledRow(ctx) {
  const scheduledIsTransfer = isTransferCategory(ctx.txn.user_category) || !!ctx.txn.transfer_pair_id;

  const badge = '<span class="source-badge scheduled" title="Scheduled future transaction">📅</span> ';

  const buttons = '';

  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  return {
    typeBadge: badge,
    categoryCell,
    actionCell: '<td></td>',
    rowCssClass: 'scheduled-row',
    sourceBadge: { label: 'Scheduled', cssClass: 'scheduled', title: 'Scheduled future transaction' },
    displayName: _txnDescription(ctx.txn),
  };
}


/**
 * Virtual BILL_FUTURE row: greyed-out appearance to indicate the
 * occurrence is theoretical (projected from the bill template, no DB row).
 * Right-click context menu provides Mark Paid, Modify, and Skip actions.
 */
function _renderVirtualBillRow(ctx) {
  const scheduledIsTransfer = isTransferCategory(ctx.txn.user_category) || !!ctx.txn.transfer_pair_id;
  const occNum = ctx.txn.occurrence_number || '?';
  const billName = escapeHtml(_txnDescription(ctx.txn) || 'Bill');
  const scheduleSummary = escapeHtml(ctx.txn.schedule_summary || '');
  const hoverTitle = `#${occNum} of ${billName}` + (scheduleSummary ? ` — ${scheduleSummary}` : '');

  const badge = `<span class="source-badge scheduled bill-virtual" data-tooltip="${hoverTitle}">📅</span> `;

  let buttons = '';
  buttons += `<button class="bill-edit-btn" data-bill-id="${escapeHtml(ctx.txn.bill_id || '')}" title="Edit this bill template">📋 Edit Bill</button>`;

  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const actionCell = ctx.txn.bill_id
    ? `<td style="text-align: center;">
        <button class="skip-occurrence-btn" onclick="skipBillOccurrence('${escapeHtml(ctx.txn.bill_id)}', '${escapeHtml(ctx.txn.date)}')" title="Skip this bill occurrence">⏭</button>
      </td>`
    : '<td></td>';

  return {
    typeBadge: badge,
    categoryCell,
    actionCell,
    rowCssClass: 'scheduled-row bill-virtual-row',
    sourceBadge: { label: 'Bill', cssClass: 'scheduled bill-virtual', title: hoverTitle },
    displayName: _txnDescription(ctx.txn),
  };
}


/**
 * Materialized bill-originated MANUAL_FUTURE row: the user has acted on
 * this occurrence (mark paid, modify, etc.) so it has a real DB row.
 * Rendered with full opacity and a 📝 badge to distinguish from virtual
 * BILL_FUTURE rows, signaling it has been confirmed/customized.
 */
function _renderMaterializedBillRow(ctx) {
  const scheduledIsTransfer = isTransferCategory(ctx.txn.user_category) || !!ctx.txn.transfer_pair_id;
  const occNum = ctx.txn.occurrence_number || ctx.txn.bill_occurrence_number || '?';
  const billName = escapeHtml(_txnDescription(ctx.txn) || 'Bill');
  const scheduleSummary = escapeHtml(ctx.txn.schedule_summary || '');
  const hoverTitle = `Confirmed #${occNum} of ${billName}` + (scheduleSummary ? ` — ${scheduleSummary}` : '');

  const badge = `<span class="source-badge scheduled bill-materialized" data-tooltip="${hoverTitle}">📝</span> `;

  const buttons = '';

  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const actionCell = ctx.txnId
    ? `<td style="text-align: center;">
        <button class="delete-transaction-btn" onclick="deleteManualTransaction('${escapeHtml(ctx.txnId)}')" title="Delete this materialized occurrence">🗑</button>
      </td>`
    : '<td></td>';

  return {
    typeBadge: badge,
    categoryCell,
    actionCell,
    rowCssClass: 'scheduled-row bill-materialized-row',
    sourceBadge: { label: 'Confirmed', cssClass: 'scheduled bill-materialized', title: hoverTitle },
    displayName: _txnDescription(ctx.txn),
  };
}


function _renderMissingRow(ctx) {
  const buttons = '';
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const actionCell = ctx.txnId
    ? `<td style="text-align: center;">
        <button class="resolve-missing-btn" onclick="resolveMissingTransaction('${escapeHtml(ctx.txnId)}')" title="Mark as resolved — remove this missing transaction">✖</button>
      </td>`
    : '<td></td>';

  // Bill badge when this missing row originated from a bill template
  let typeBadge = '<span class="source-badge missing" title="Expected payment not found">⚠</span> ';
  if (ctx.txn.is_bill || ctx.txn.bill_id) {
    const occNum = ctx.txn.occurrence_number || ctx.txn.bill_occurrence_number || '?';
    const billName = escapeHtml(_txnDescription(ctx.txn) || 'Bill');
    const scheduleSummary = escapeHtml(ctx.txn.schedule_summary || '');
    const hoverTitle = `Missing bill #${occNum} of ${billName}` + (scheduleSummary ? ` — ${scheduleSummary}` : '');
    typeBadge = `<span class="source-badge bill-provenance" data-tooltip="${hoverTitle}" title="${hoverTitle}">📋</span> ` + typeBadge;
  }

  // Source badge differentiates bill-originated vs manual-originated missing
  const isBillMissing = ctx.rowType === TXN_TYPE.BILL_MISSING;
  const sourceTitle = isBillMissing
    ? 'Bill payment not yet matched to a plaid transaction'
    : 'Manual future transaction not yet matched to a plaid transaction';

  return {
    typeBadge,
    categoryCell,
    actionCell,
    rowCssClass: 'missing-row',
    sourceBadge: { label: 'Missing', cssClass: 'missing', title: sourceTitle },
    displayName: _txnDescription(ctx.txn),
  };
}


function _renderMatchedRow(ctx) {
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', ''
  );

  const approveOnclick = `event.stopPropagation(); approveMatch('${escapeHtml(ctx.txnId)}').then(() => { showStatus('Match approved', 'success'); refreshAccountTransactions('${escapeHtml(ctx.accountId)}'); }).catch(err => showStatus(err.message, 'error'));`;
  const unmatchOnclick = `event.stopPropagation(); unmatchScheduledTransaction('${escapeHtml(ctx.txnId)}')`;

  // Bill badge when this matched row originated from a bill template
  let billBadge = '';
  if (ctx.txn.is_bill || ctx.txn.bill_id) {
    const occNum = ctx.txn.occurrence_number || ctx.txn.bill_occurrence_number || '?';
    const billName = escapeHtml(_txnDescription(ctx.txn) || 'Bill');
    const scheduleSummary = escapeHtml(ctx.txn.schedule_summary || '');
    const hoverTitle = `Matched bill #${occNum} of ${billName}` + (scheduleSummary ? ` — ${scheduleSummary}` : '');
    billBadge = `<span class="source-badge bill-provenance" data-tooltip="${hoverTitle}" title="${hoverTitle}">📋</span> `;
  }

  const actionGroup = `<span class="match-action-group">`
    + `<button class="approve-match-badge" data-txn-id="${escapeHtml(ctx.txnId)}" onclick="${approveOnclick}" title="Approve this match — removes the manual counterpart">✓</button>`
    + `<button class="reject-match-badge" onclick="${unmatchOnclick}" title="Unmatch — revert to missing + unhide plaid transaction">✗</button>`
    + `</span> `;

  return {
    typeBadge: billBadge + actionGroup,
    categoryCell,
    actionCell: '<td></td>',
    rowCssClass: 'matched-row',
    sourceBadge: { label: 'Matched', cssClass: 'matched', title: ctx.txn.is_bill ? 'Bill-matched scheduled transaction' : 'Scheduled transaction matched with a plaid transaction' },
    displayName: _txnDescription(ctx.txn),
  };
}


function _renderMatchedPairRow(ctx) {
  const matchInfo = ctx.txn.match_info;
  const unmatchId = escapeHtml(matchInfo.matched_txn_id);
  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', ''
  );

  const approveOnclick = `event.stopPropagation(); approveMatch('${unmatchId}').then(() => { showStatus('Match approved', 'success'); refreshAccountTransactions('${escapeHtml(ctx.accountId)}'); }).catch(err => showStatus(err.message, 'error'));`;
  const unmatchOnclick = `event.stopPropagation(); unmatchScheduledTransaction('${unmatchId}')`;

  // Bill badge when the matched counterpart originated from a bill template
  let billBadge = '';
  if (matchInfo.matched_bill_id) {
    const occNum = matchInfo.matched_occurrence_number || '?';
    const billName = escapeHtml(matchInfo.matched_name || 'Bill');
    const scheduleSummary = escapeHtml(matchInfo.matched_schedule_summary || '');
    const hoverTitle = `Matched bill #${occNum} of ${billName}` + (scheduleSummary ? ` — ${scheduleSummary}` : '');
    billBadge = `<span class="source-badge bill-provenance" data-tooltip="${hoverTitle}" title="${hoverTitle}">📋</span> `;
  }

  const actionGroup = `<span class="match-action-group">`
    + `<button class="approve-match-badge" data-txn-id="${unmatchId}" onclick="${approveOnclick}" title="Approve this match — removes the manual counterpart">✓</button>`
    + `<button class="reject-match-badge" onclick="${unmatchOnclick}" title="Unmatch — revert manual to missing + detach from plaid">✗</button>`
    + `</span> `;

  return {
    typeBadge: billBadge + actionGroup,
    categoryCell,
    actionCell: '<td></td>',
    rowCssClass: 'matched-row',
    sourceBadge: { label: 'Matched', cssClass: 'matched', title: matchInfo.matched_bill_id ? 'Bill-matched plaid transaction' : 'Plaid transaction merged with user-entered counterpart' },
    displayName: matchInfo.matched_description || _txnDescription(ctx.txn),
  };
}


function _renderSuggestedPairRow(ctx) {
  const suggestionInfo = ctx.txn.suggestion_info;
  const suggestedTxnId = escapeHtml(suggestionInfo.suggested_txn_id);
  const proposalId = suggestionInfo.proposal_id;
  const confidencePct = Math.round((suggestionInfo.confidence || 0) * 100);

  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', ''
  );

  const approveOnclick = `event.stopPropagation(); approveSuggestion('${suggestedTxnId}', '${escapeHtml(ctx.txnId)}', '${escapeHtml(ctx.accountId)}')`;
  const dismissOnclick = `event.stopPropagation(); dismissSuggestion(${proposalId}, '${escapeHtml(ctx.accountId)}')`;

  const actionGroup = `<span class="match-action-group">`
    + `<button class="approve-suggestion-badge" data-txn-id="${suggestedTxnId}" onclick="${approveOnclick}" title="Approve suggested match (${confidencePct}% confidence)">✓</button>`
    + `<button class="reject-suggestion-badge" onclick="${dismissOnclick}" title="Dismiss suggestion — the manual row will reappear as missing">✗</button>`
    + `</span> `;

  return {
    typeBadge: actionGroup,
    categoryCell,
    actionCell: '<td></td>',
    rowCssClass: 'suggested-row',
    sourceBadge: { label: 'Suggested', cssClass: 'suggested', title: `System-suggested match (${confidencePct}% confidence)` },
    displayName: suggestionInfo.suggested_description || _txnDescription(ctx.txn),
  };
}


function _renderOrphanedRow(ctx) {
  const buttons = '';
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
    displayName: _txnDescription(ctx.txn),
  };
}


/**
 * PLAID_CONVERTED: transactions originally downloaded from Plaid that were
 * converted to offline when the bank was disconnected. Fully editable
 * (amount, description, date) like manual transactions, with delete & split.
 */
function _renderPlaidConvertedRow(ctx) {
  const clearOverrideBtn = ctx.txn.is_override
    ? `<button class='clear-override' data-txn-id='${ctx.txnId}' onclick='clearOverride(event)' title='Overridden category — click to restore default'>🔒</button>`
    : '';

  const buttons = clearOverrideBtn
    + `<button class="category-rule" data-txn-id="${ctx.txnId}" data-account-id="${ctx.accountId}">Rule</button>`
    + `<button class="category-split" data-txn-id="${ctx.txnId}" onclick="window.splitModalTxnId='${escapeHtml(ctx.txnId)}'; openSplitModal(transactions.find(t => t.transaction_id === '${escapeHtml(ctx.txnId)}')); return false;" title="Split this transaction">Split</button>`;

  const categoryCell = _buildCategoryAutocomplete(
    ctx.txnId, ctx.accountId, ctx.currentFullCategory,
    'Type to search categories…', buttons
  );

  const actionCell = ctx.txnId
    ? `<td style="text-align: center;">
        <button class="delete-transaction-btn" onclick="deleteManualTransaction('${escapeHtml(ctx.txnId)}')" title="Delete converted transaction">🗑</button>
      </td>`
    : '<td></td>';

  return {
    typeBadge: '',
    categoryCell,
    actionCell,
    rowCssClass: '',
    sourceBadge: { label: 'Prior Download', cssClass: 'plaid-converted', title: 'Originally downloaded from Plaid — now editable (bank disconnected)' },
    displayName: _txnDescription(ctx.txn),
  };
}


function _renderTransferRow(ctx) {
  const buttons = `<button class="transfer-unlink-btn" data-txn-id="${escapeHtml(ctx.txnId)}" onclick="unlinkTransfer('${escapeHtml(ctx.txnId)}')" title="Break this transfer pair">Unlink</button>`;
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
    displayName: _txnDescription(ctx.txn),
  };
}


function _renderManualClearedRow(ctx) {
  // Manual transactions have no Plaid-assigned category to revert to — overrides
  // don't apply here. Category edits go directly to PUT /api/transactions/<id>.
  const buttons =
      `<button class="category-rule" data-txn-id="${ctx.txnId}" data-account-id="${ctx.accountId}">Rule</button>`
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
    displayName: _txnDescription(ctx.txn),
  };
}


/**
 * Default renderer for plaid cleared/pending rows, reconciliation, and any
 * type that doesn't need special handling. Provides the full category
 * editing experience: autocomplete + override + rule + split buttons.
 */
function _renderDefaultRow(ctx) {
  const clearOverrideBtn = ctx.txn.is_override
    ? `<button class='clear-override' data-txn-id='${ctx.txnId}' onclick='clearOverride(event)' title='Overridden category — click to restore default'>🔒</button>`
    : '';

  const buttons = clearOverrideBtn
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
    displayName: _txnDescription(ctx.txn),
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
  if (ctx.txn.source === 'plaid' && ctx.txn.status === 'converted') {
    return { label: 'Prior Download', cssClass: 'plaid-converted', title: 'Originally downloaded from Plaid — now editable (bank disconnected)' };
  }
  return { label: 'Downloaded', cssClass: 'plaid', title: 'Downloaded from Plaid' };
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

  // Investment trending rows — locked system row, projected in future block
  if (rowType === TXN_TYPE.SYSTEM_INVESTMENT_TRENDING) {
    return _renderInvestmentTrendingRow(ctx);
  }

  // Scheduled future block: three distinct visual treatments
  if (rowType === TXN_TYPE.BILL_FUTURE) {
    return _renderVirtualBillRow(ctx);
  }
  if (rowType === TXN_TYPE.MANUAL_FUTURE && ctx.isBill) {
    return _renderMaterializedBillRow(ctx);
  }
  if (rowType === TXN_TYPE.MANUAL_FUTURE) {
    return _renderScheduledRow(ctx);
  }

  // Missing bills — resolve button
  if (rowType === TXN_TYPE.BILL_MISSING) {
    return _renderMissingRow(ctx);
  }

  // Missing manual transactions — same visual treatment as missing bills
  if (rowType === TXN_TYPE.MANUAL_MISSING) {
    return _renderMissingRow(ctx);
  }

  // Matched rows (the manual/scheduled side) — approve + unmatch
  if (rowType === TXN_TYPE.BILL_MATCHED || rowType === TXN_TYPE.MANUAL_MATCH) {
    return _renderMatchedRow(ctx);
  }

  // Suggested pair (plaid side with a pending system proposal) — yellow badge
  if (ctx.txn.suggestion_info) {
    return _renderSuggestedPairRow(ctx);
  }

  // Matched pair (the plaid side, carrying match_info) — approve + unmatch
  if (ctx.txn.match_info) {
    return _renderMatchedPairRow(ctx);
  }

  // Orphaned transactions — only shown in Resolution Center, not in ledger.
  // Renderer kept for Resolution Center usage if needed.
  if (rowType === TXN_TYPE.MANUAL_ORPHANED) {
    return _renderOrphanedRow(ctx);
  }

  // PLAID_CONVERTED — formerly plaid-synced, now editable (bank disconnected)
  if (rowType === TXN_TYPE.PLAID_CONVERTED) {
    return _renderPlaidConvertedRow(ctx);
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
