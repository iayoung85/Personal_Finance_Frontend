// ============================================================
// transactions/inspect-data.js — Inspect Transaction Data Modal
// Fetches the immutable Plaid raw blob and the app's working
// blob, then renders them side-by-side so the user can see
// exactly what Plaid sent vs. what the app currently holds.
// ============================================================

/**
 * Open the inspect data modal for a ledger row.
 * Plaid-backed rows fetch the immutable raw blob; all other rows render
 * from the transaction data already loaded into the client.
 */
async function openInspectDataModal(inspectRequest) {
  const overlay = document.getElementById('inspect-data-modal');
  if (!overlay) return;

  const bodyEl = document.getElementById('inspect-data-body');
  bodyEl.innerHTML = '<p class="inspect-loading">Loading transaction data…</p>';
  overlay.classList.remove('hidden');

  const inspectContext = _normalizeInspectRequest(inspectRequest);

  let sourceTitle = inspectContext.sourceTitle;
  let sourceData = inspectContext.sourceData;
  let sourceEmptyMessage = inspectContext.sourceEmptyMessage;
  let sourceErrorMessage = '';
  let appData = _buildInspectWorkingData(inspectContext.localTransaction, inspectContext);

  if (!appData && !inspectContext.shouldFetchPlaidRaw && !sourceData) {
    bodyEl.innerHTML = '<p class="inspect-error">Transaction data is not available in the current ledger view.</p>';
    return;
  }

  if (inspectContext.shouldFetchPlaidRaw && inspectContext.transactionId) {
    try {
      const response = await authenticatedFetch(
        `${BACKEND_URL}/api/transactions/raw/${encodeURIComponent(inspectContext.transactionId)}`
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        sourceErrorMessage = errorData.error || response.statusText || 'Failed to load Plaid raw data';
      } else {
        const { plaid_raw: plaidRaw, app_data: fetchedAppData } = await response.json();
        sourceTitle = 'Plaid Raw Data';
        sourceData = plaidRaw;
        sourceEmptyMessage = 'No raw Plaid blob stored for this transaction. This transaction was synced before the raw-blob column was added, or no Plaid source payload is available.';
        if (fetchedAppData) {
          appData = _buildInspectWorkingData(fetchedAppData, inspectContext);
        }
      }
    } catch (networkError) {
      sourceErrorMessage = `Network error: ${networkError.message}`;
    }
  }

  _renderInspectPanels(bodyEl, {
    sourceTitle,
    sourceData,
    sourceEmptyMessage,
    sourceErrorMessage,
    workingTitle: inspectContext.workingTitle,
    workingData: appData,
  });
}

function closeInspectDataModal() {
  const overlay = document.getElementById('inspect-data-modal');
  if (overlay) overlay.classList.add('hidden');
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
      isSplitRow: false,
    };
  }

  const request = inspectRequest || {};
  const localTransaction = request.localTransaction
    || transactions.find(txn => txn.transaction_id === request.txnId || txn.transaction_id === request.transactionId)
    || null;
  const parentTransaction = request.parentTransaction || null;
  const isSplitRow = !!request.isSplit;
  const isSplitChild = !!request.isSplitChild;
  const shouldFetchPlaidRaw = !isSplitRow && _isPlaidInspectable(parentTransaction || localTransaction);

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
    transactionId: request.txnId || request.transactionId || localTransaction?.transaction_id || '',
    localTransaction,
    parentTransaction,
    sourceTitle,
    sourceData,
    sourceEmptyMessage,
    workingTitle: isSplitChild ? 'Split Entry Data' : 'Ledger Transaction Data',
    shouldFetchPlaidRaw,
    inspectKind: isSplitChild ? 'split-child' : 'transaction',
    isSplitRow,
  };
}

function _buildInspectWorkingData(localTransaction, inspectContext) {
  if (!localTransaction) return null;

  let rowType = null;
  try {
    if (inspectContext.isSplitRow) {
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
      is_split_row: !!inspectContext.isSplitRow,
      is_transfer: !!(localTransaction.transfer_pair_id || isTransferCategory(localTransaction.user_category)),
      parent_transaction_id: inspectContext.parentTransaction?.transaction_id || null,
      data_source: inspectContext.shouldFetchPlaidRaw ? 'frontend cache + optional plaid raw fetch' : 'frontend cache',
    },
  };
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
