// ============================================================
// transactions/inspect-data.js — Inspect Transaction Data Modal
// Opens on the Bill matching view: each bill criterion, the
// row's value and, when a bill judges it, the API's verdict.
// Advanced renders the immutable Plaid raw blob and the app's
// working blob side-by-side, as Plaid sent it vs. as the app holds it.
// ============================================================

// Each open takes a number so a slow fetch for an earlier row cannot draw
// over the row the user opened since.
let _inspectOpenSerial = 0;

/**
 * Open the inspect data modal for a ledger row.
 * It opens on the Bill matching view; Advanced holds the raw panels.
 * Plaid-backed rows fetch the immutable raw blob; bill rows fetch only for
 * the Bill matching view; all other rows render from the transaction data
 * already loaded into the client. Inspect Match shows only the raw panels.
 */
async function openInspectDataModal(inspectRequest) {
  const overlay = document.getElementById('inspect-data-modal');
  if (!overlay) return;

  const openSerial = ++_inspectOpenSerial;
  const bodyEl = document.getElementById('inspect-data-body');
  const tabsEl = document.getElementById('inspect-data-tabs');
  const actionsEl = document.getElementById('inspect-data-actions');
  _resetInspectChrome(tabsEl, actionsEl);
  bodyEl.innerHTML = '<p class="inspect-loading">Loading transaction data…</p>';
  overlay.classList.remove('hidden');

  const inspectContext = _normalizeInspectRequest(inspectRequest);

  let sourceTitle = inspectContext.sourceTitle;
  let sourceData = inspectContext.sourceData;
  let sourceEmptyMessage = inspectContext.sourceEmptyMessage;
  let sourceErrorMessage = '';
  let appData = _buildInspectWorkingData(inspectContext.localTransaction, inspectContext);
  let billMatching = _localBillMatching(inspectContext);

  const fetchesRaw = inspectContext.shouldFetchPlaidRaw
    || inspectContext.billMatchingFetchKind === 'bill';

  if (!appData && !fetchesRaw && !sourceData) {
    bodyEl.innerHTML = '<p class="inspect-error">Transaction data is not available in the current ledger view.</p>';
    return;
  }

  if (fetchesRaw && inspectContext.transactionId) {
    try {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/raw/${encodeURIComponent(inspectContext.transactionId)}`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || response.statusText || 'Failed to load Plaid raw data';
        // A bill row's panels never came from this fetch, so its failure
        // only touches the Bill matching view.
        if (inspectContext.shouldFetchPlaidRaw) sourceErrorMessage = errorMessage;
        billMatching = { status: 'error' };
      } else {
        const {
          plaid_raw: plaidRaw,
          app_data: fetchedAppData,
          bill_matching: fetchedBillMatching,
        } = await response.json();
        if (inspectContext.shouldFetchPlaidRaw) {
          sourceTitle = 'Plaid Raw Data';
          sourceData = plaidRaw;
          sourceEmptyMessage = 'No raw Plaid blob stored for this transaction. This transaction was synced before the raw-blob column was added, or no Plaid source payload is available.';
          // For a piece the fetched record is the parent's, not the piece's.
          if (fetchedAppData && !inspectContext.isSplitChild) {
            appData = _buildInspectWorkingData(fetchedAppData, inspectContext);
          }
        }
        // An API from before the Bill matching view sends no block; the view reads that as error.
        billMatching = fetchedBillMatching || { status: 'error' };
      }
    } catch (networkError) {
      const errorMessage = `Network error: ${networkError.message}`;
      if (inspectContext.shouldFetchPlaidRaw) sourceErrorMessage = errorMessage;
      billMatching = { status: 'error' };
    }
  }

  if (openSerial !== _inspectOpenSerial) return;

  const panelOptions = {
    sourceTitle,
    sourceData,
    sourceEmptyMessage,
    sourceErrorMessage,
    workingTitle: inspectContext.workingTitle,
    workingData: appData,
  };

  if (!inspectContext.showsBillMatching) {
    _renderInspectPanels(bodyEl, panelOptions);
    return;
  }

  bodyEl.innerHTML = '<div class="inspect-view" id="inspect-view-matching" role="tabpanel"></div>'
    + '<div class="inspect-view" id="inspect-view-advanced" role="tabpanel" hidden></div>';
  const matchingEl = document.getElementById('inspect-view-matching');
  const advancedEl = document.getElementById('inspect-view-advanced');

  const view = buildBillMatchingView(billMatching, {
    describeAccount: _inspectDescribeAccount,
    inspectedTransactionId: inspectContext.transactionId,
    isSplitChild: inspectContext.isSplitChild,
  });
  _renderBillMatchingView(matchingEl, view);
  _renderInspectPanels(advancedEl, panelOptions);
  _renderInspectTabs(tabsEl, bodyEl, matchingEl, advancedEl);
  _renderInspectActions(actionsEl, view, inspectRequest, inspectContext);
}

function closeInspectDataModal() {
  _inspectOpenSerial += 1;
  const overlay = document.getElementById('inspect-data-modal');
  if (overlay) overlay.classList.add('hidden');
}

/**
 * The Bill matching payload for a row Inspect does not fetch, or the
 * placeholder until a fetch replaces it.
 * @param {Object} inspectContext - From _normalizeInspectRequest.
 * @returns {Object} A bill_matching-shaped stand-in.
 */
function _localBillMatching(inspectContext) {
  if (inspectContext.billMatchingFetchKind === 'forecast') {
    return { status: 'forecast', bill_id: inspectContext.billMatchingRow?.bill_id || null };
  }
  if (inspectContext.billMatchingFetchKind === 'none') {
    return { status: 'not_fetched' };
  }
  return { status: 'error' };
}

// ─── Bill matching view ───────────────────────────────────────

const _INSPECT_TONE_MARKS = Object.freeze({
  pass: '✓',
  fail: '✕',
  info: 'i',
  muted: '–',
  error: '!',
});

function _resetInspectChrome(tabsEl, actionsEl) {
  if (tabsEl) {
    tabsEl.innerHTML = '';
    tabsEl.classList.add('hidden');
  }
  if (actionsEl) actionsEl.innerHTML = '';
}

/**
 * Draw the Bill matching view from buildBillMatchingView's result.
 * @param {HTMLElement} containerEl
 * @param {Object} view - From buildBillMatchingView.
 */
function _renderBillMatchingView(containerEl, view) {
  const copyValues = [];
  let html = `<div class="bm-summary bm-tone-${_escapeHtml(view.tone)}">`;
  html += `<span class="bm-summary-mark" aria-hidden="true">${_INSPECT_TONE_MARKS[view.tone] || ''}</span>`;
  html += '<div class="bm-summary-text">';
  html += `<div class="bm-headline">${_escapeHtml(view.headline)}</div>`;
  if (view.subline) html += `<div class="bm-subline">${_escapeHtml(view.subline)}</div>`;
  html += '</div></div>';

  if (view.notes.length > 0) {
    html += '<ul class="bm-notes">';
    view.notes.forEach(note => {
      html += `<li>${_escapeHtml(note)}</li>`;
    });
    html += '</ul>';
  }

  if (view.lines.length > 0) {
    const columns = view.columns;
    let layoutClass = 'bm-cols-bill';
    if (columns.verdict) layoutClass = 'bm-cols-judged';
    else if (columns.row) layoutClass = 'bm-cols-row';

    html += `<div class="bm-table ${layoutClass}" role="table" aria-label="Bill matching criteria">`;
    html += '<div class="bm-line bm-head" role="row">';
    html += '<div class="bm-cell bm-label" role="columnheader">Criterion</div>';
    if (columns.row) html += '<div class="bm-cell bm-row" role="columnheader">This row</div>';
    if (columns.bill) html += '<div class="bm-cell bm-bill" role="columnheader">Bill</div>';
    if (columns.verdict) html += '<div class="bm-cell bm-verdict" role="columnheader">Result</div>';
    html += '</div>';

    view.lines.forEach(line => {
      const verdictClass = line.verdict ? ` bm-line-${line.verdict}` : '';
      html += `<div class="bm-line${verdictClass}" role="row">`;
      html += `<div class="bm-cell bm-label" role="rowheader">${_escapeHtml(line.label)}</div>`;

      if (columns.row) {
        html += '<div class="bm-cell bm-row" role="cell" data-caption="This row">';
        if (line.rowValue) {
          html += `<span class="bm-value">${_escapeHtml(line.rowValue)}</span>`;
          if (line.copyValue) {
            copyValues.push(line.copyValue);
            html += `<button type="button" class="bm-copy" data-bm-copy="${copyValues.length - 1}"`
              + ` title="Copy ${_escapeHtml(line.copyValue)}"`
              + ` aria-label="Copy ${_escapeHtml(line.label)} value">Copy</button>`;
          }
        } else {
          html += '<span class="bm-none">None</span>';
        }
        html += '</div>';
      }

      if (columns.bill) {
        html += '<div class="bm-cell bm-bill" role="cell" data-caption="Bill">';
        if (line.billSetting) {
          html += `<span class="bm-value">${_escapeHtml(line.billSetting)}</span>`;
        } else {
          html += `<span class="bm-none">${columns.verdict ? '—' : 'Not set'}</span>`;
        }
        html += '</div>';
      }

      if (columns.verdict) {
        html += '<div class="bm-cell bm-verdict" role="cell">';
        if (line.verdictLabel) {
          html += `<span class="bm-pill bm-pill-${_escapeHtml(line.verdict)}">${_escapeHtml(line.verdictLabel)}</span>`;
        }
        html += '</div>';
      }

      if (line.hint) {
        html += `<div class="bm-hint">${_escapeHtml(line.hint)}</div>`;
      }
      html += '</div>';
    });
    html += '</div>';
  }

  if (view.footnote) html += `<p class="bm-footnote">${_escapeHtml(view.footnote)}</p>`;

  containerEl.innerHTML = html;
  containerEl.querySelectorAll('[data-bm-copy]').forEach(button => {
    button.addEventListener('click', () => {
      _copyInspectValue(button, copyValues[Number(button.dataset.bmCopy)]);
    });
  });
}

function _copyInspectValue(button, value) {
  const restore = () => {
    button.textContent = 'Copy';
    button.classList.remove('bm-copy-done');
  };
  const show = (text) => {
    button.textContent = text;
    button.classList.add('bm-copy-done');
    setTimeout(restore, 1400);
  };
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    show('Copy failed');
    return;
  }
  navigator.clipboard.writeText(value).then(() => show('Copied'), () => show('Copy failed'));
}

/**
 * Draw the Bill matching / Advanced switch above the modal body.
 */
function _renderInspectTabs(tabsEl, bodyEl, matchingEl, advancedEl) {
  if (!tabsEl) return;
  tabsEl.innerHTML = '<button type="button" class="inspect-tab" role="tab" data-inspect-tab="matching"'
    + ' aria-controls="inspect-view-matching" aria-selected="true">Bill matching</button>'
    + '<button type="button" class="inspect-tab" role="tab" data-inspect-tab="advanced"'
    + ' aria-controls="inspect-view-advanced" aria-selected="false">Advanced</button>';
  tabsEl.classList.remove('hidden');

  tabsEl.querySelectorAll('[data-inspect-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const showAdvanced = tab.dataset.inspectTab === 'advanced';
      matchingEl.hidden = showAdvanced;
      advancedEl.hidden = !showAdvanced;
      tabsEl.querySelectorAll('[data-inspect-tab]').forEach(otherTab => {
        otherTab.setAttribute('aria-selected', otherTab === tab ? 'true' : 'false');
      });
      bodyEl.scrollTop = 0;
    });
  });
}

/**
 * Draw the footer buttons the view offers: This is a Bill or Edit bill.
 * Both close Inspect first, since saving the bill makes its verdicts stale.
 */
function _renderInspectActions(actionsEl, view, inspectRequest, inspectContext) {
  if (!actionsEl) return;
  actionsEl.innerHTML = '';
  view.actions.forEach(action => {
    const button = document.createElement('button');
    button.type = 'button';
    if (action === 'this-is-a-bill') {
      button.textContent = 'This is a Bill';
      button.addEventListener('click', () => {
        if (typeof _handleContextThisIsABill !== 'function') return;
        closeInspectDataModal();
        _handleContextThisIsABill(_inspectBillPrefillSource(inspectRequest, inspectContext));
      });
    } else if (action === 'edit-bill') {
      button.textContent = 'Edit bill';
      button.addEventListener('click', () => {
        if (typeof _handleContextEditSchedule !== 'function') return;
        closeInspectDataModal();
        _handleContextEditSchedule({ billId: view.billId });
      });
    } else {
      return;
    }
    actionsEl.appendChild(button);
  });
}

/**
 * The context-menu data This is a Bill expects, for the whole row a bill
 * would match: a piece hands over its parent's amount and account.
 */
function _inspectBillPrefillSource(inspectRequest, inspectContext) {
  const row = inspectContext.billMatchingRow || inspectContext.localTransaction || {};
  const base = (inspectRequest && typeof inspectRequest === 'object') ? inspectRequest : {};
  const prefillSource = {
    ...base,
    txnId: inspectContext.transactionId,
    amount: base.amount,
    accountId: base.accountId,
    name: base.name || row.description || row.name || '',
    merchantName: base.merchantName || row.merchant_name || '',
    userCategory: base.userCategory || row.user_category || '',
  };
  if (inspectContext.isSplitChild || prefillSource.amount === undefined) {
    prefillSource.amount = row.amount || 0;
  }
  if (inspectContext.isSplitChild || !prefillSource.accountId) {
    prefillSource.accountId = row.account_id || row.plaid_account_id || '';
  }
  return prefillSource;
}

function _inspectDescribeAccount(accountId) {
  const accountList = typeof accounts !== 'undefined' && Array.isArray(accounts) ? accounts : [];
  const account = accountList.find(acct => acct.account_id === accountId);
  if (!account) return accountId;
  const name = account.custom_name || account.account_name || 'Account';
  const label = account.bank_name ? `${account.bank_name} - ${name}` : name;
  return account.mask ? `${label} (${account.mask})` : label;
}

// ─── Rendering helpers ────────────────────────────────────────

function _renderInspectPanels(containerEl, options) {
  const {
    sourceTitle,
    sourceData,
    sourceEmptyMessage,
    sourceErrorMessage,
    workingTitle,
    workingData,
  } = options;

  let html = '<div class="inspect-panels">';

  // Left panel: source data (Plaid raw, parent transaction, or empty state)
  html += '<div class="inspect-panel">';
  html += `<h3 class="inspect-panel-title">${_escapeHtml(sourceTitle)}</h3>`;
  if (sourceData) {
    html += _renderObjectAsTree(sourceData);
  } else if (sourceErrorMessage) {
    html += `<p class="inspect-error">${_escapeHtml(sourceErrorMessage)}</p>`;
  } else {
    html += `<p class="inspect-empty">${_escapeHtml(sourceEmptyMessage)}</p>`;
  }
  html += '</div>';

  // Right panel: App working data
  html += '<div class="inspect-panel">';
  html += `<h3 class="inspect-panel-title">${_escapeHtml(workingTitle)}</h3>`;
  if (workingData) {
    html += _renderObjectAsTree(workingData);
  } else {
    html += '<p class="inspect-empty">No ledger data is available for this transaction.</p>';
  }
  html += '</div>';

  html += '</div>';
  containerEl.innerHTML = html;
}

function _normalizeInspectRequest(inspectRequest) {
  if (typeof inspectRequest === 'string') {
    const localTransaction = transactions.find(txn => txn.transaction_id === inspectRequest) || null;
    return {
      transactionId: inspectRequest,
      localTransaction,
      parentTransaction: null,
      sourceTitle: 'Plaid Raw Data',
      sourceData: null,
      sourceEmptyMessage: 'No immutable source data is available for this transaction.',
      workingTitle: 'Ledger Transaction Data',
      shouldFetchPlaidRaw: localTransaction ? _isPlaidInspectable(localTransaction) : true,
      inspectKind: 'transaction',
      isSplitChild: false,
      billMatchingRow: localTransaction,
      billMatchingFetchKind: localTransaction ? _inspectFetchKind(localTransaction) : 'plaid',
      showsBillMatching: true,
    };
  }

  const request = inspectRequest || {};
  const localTransaction = request.localTransaction
    || transactions.find(txn => txn.transaction_id === request.txnId || txn.transaction_id === request.transactionId)
    || null;
  // Context-menu data names the row itself as its "parent" when it is not a
  // split piece, so only a piece keeps a parent here.
  const isSplitChild = !!request.isSplitChild;
  const parentTransaction = isSplitChild ? (request.parentTransaction || null) : null;
  // A piece inspects its parent's Plaid record: the pieces have none of their own.
  const billMatchingRow = parentTransaction || localTransaction;
  const shouldFetchPlaidRaw = !request.forceLocal && _isPlaidInspectable(billMatchingRow);
  const parentTransactionId = parentTransaction?.transaction_id || request.txnId || request.transactionId || '';

  let sourceTitle = 'Source Data';
  let sourceData = request.relatedData || null;
  let sourceEmptyMessage = 'No immutable source blob is available for this transaction type. Showing the ledger data we currently have in memory.';

  if (shouldFetchPlaidRaw) {
    sourceTitle = 'Plaid Raw Data';
    sourceData = null;
    sourceEmptyMessage = 'No raw Plaid blob stored for this transaction.';
  } else if (request.relatedData) {
    sourceTitle = request.relatedTitle || 'Related Data';
    sourceEmptyMessage = 'No related transaction data is available.';
  }

  return {
    transactionId: isSplitChild
      ? parentTransactionId
      : (request.txnId || request.transactionId || localTransaction?.transaction_id || ''),
    localTransaction,
    parentTransaction,
    sourceTitle,
    sourceData,
    sourceEmptyMessage,
    workingTitle: isSplitChild ? 'Split Entry Data' : 'Ledger Transaction Data',
    shouldFetchPlaidRaw,
    inspectKind: isSplitChild ? 'split-child' : 'transaction',
    isSplitChild,
    billMatchingRow,
    billMatchingFetchKind: request.forceLocal ? 'none' : _inspectFetchKind(billMatchingRow),
    // Inspect Match compares a waiting pair from local data and keeps its two panels.
    showsBillMatching: !request.forceLocal,
  };
}

function _buildInspectWorkingData(localTransaction, inspectContext) {
  if (!localTransaction) return null;

  let rowType = null;
  try {
    if (inspectContext.isSplitChild) {
      rowType = TXN_TYPE.SPLIT_CHILD;
    } else {
      rowType = getTransactionType(localTransaction);
    }
  } catch (error) {
    rowType = null;
  }

  return {
    ...localTransaction,
    _inspect_meta: {
      inspect_kind: inspectContext.inspectKind,
      row_type: rowType,
      is_split_row: !!inspectContext.isSplitChild,
      is_transfer: !!(localTransaction.transfer_pair_id || isTransferCategory(localTransaction.user_category)),
      parent_transaction_id: _inspectParentId(inspectContext.parentTransaction),
      data_source: inspectContext.shouldFetchPlaidRaw ? 'frontend cache + optional plaid raw fetch' : 'frontend cache',
    },
  };
}

/**
 * The id of a piece's parent as the database holds it. A waiting match's
 * pieces are drawn under the Plaid row but still belong to the hidden manual
 * row until the match is approved.
 * @param {Object|null} parentTxn - The row the piece is drawn under.
 * @returns {string|null}
 */
function _inspectParentId(parentTxn) {
  if (!parentTxn) return null;
  if (parentTxn.splits_awaiting_match) {
    const owningRowId = parentTxn.match_info?.matched_txn_id;
    if (owningRowId) return owningRowId;
  }
  return parentTxn.transaction_id || null;
}

/**
 * Which /raw/ fetch the Bill matching view needs for a row.
 * @param {Object|null} txn
 * @returns {'plaid'|'bill'|'forecast'|'none'}
 */
function _inspectFetchKind(txn) {
  if (!txn) return 'none';
  return inspectBillMatchingFetchKind(txn, getTransactionType(txn));
}

function _isPlaidInspectable(txn) {
  if (!txn) return false;
  const txnType = getTransactionType(txn);
  return txnType === TXN_TYPE.PLAID_CLEARED
    || txnType === TXN_TYPE.PLAID_PENDING
    || txnType === TXN_TYPE.PLAID_CONVERTED;
}

/**
 * Recursively render a JS object/array as a collapsible tree of
 * key-value rows.  Handles nested objects, arrays, and primitives.
 */
function _renderObjectAsTree(obj, depth = 0) {
  if (obj === null || obj === undefined) {
    return '<span class="inspect-null">null</span>';
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '<span class="inspect-empty-val">[]</span>';
    let html = '<div class="inspect-array">';
    obj.forEach((item, index) => {
      html += `<div class="inspect-row" style="padding-left:${depth * 12}px">`;
      html += `<span class="inspect-key">[${index}]</span>`;
      if (typeof item === 'object' && item !== null) {
        html += _renderObjectAsTree(item, depth + 1);
      } else {
        html += `<span class="inspect-value">${_escapeHtml(String(item))}</span>`;
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    if (keys.length === 0) return '<span class="inspect-empty-val">{}</span>';
    let html = '<div class="inspect-object">';
    keys.forEach(key => {
      const value = obj[key];
      html += `<div class="inspect-row" style="padding-left:${depth * 12}px">`;
      html += `<span class="inspect-key">${_escapeHtml(key)}:</span> `;
      if (typeof value === 'object' && value !== null) {
        html += _renderObjectAsTree(value, depth + 1);
      } else if (value === null || value === undefined) {
        html += '<span class="inspect-null">null</span>';
      } else if (typeof value === 'boolean') {
        html += `<span class="inspect-bool">${value}</span>`;
      } else if (typeof value === 'number') {
        html += `<span class="inspect-number">${value}</span>`;
      } else {
        html += `<span class="inspect-value">${_escapeHtml(String(value))}</span>`;
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  return `<span class="inspect-value">${_escapeHtml(String(obj))}</span>`;
}

function _escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
