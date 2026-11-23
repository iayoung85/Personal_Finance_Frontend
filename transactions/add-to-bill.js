// ============================================================
// transactions/add-to-bill.js — Add a past row to an existing bill
//
// The small modal behind the context menu's "Add to existing bill", and its
// undo, "Remove from bill". The bill picker (bill-picker.js) owns the
// dropdown and the details; this file owns the row card, the buttons, and
// patching the page from the API's answer.
// ============================================================

/**
 * The name the table shows for a row: the user's own name first.
 *
 * @param {Object} txn
 * @returns {string}
 */
function _addToBillRowName(txn) {
  return txn.user_description_override || txn.merchant_name || txn.name || txn.description || '';
}

/** Close the modal and drop its Escape listener. */
function _closeAddToBillModal() {
  const existing = document.getElementById('add-to-bill-modal');
  if (existing) existing.remove();
  document.removeEventListener('keydown', _onAddToBillModalKeydown);
}

function _onAddToBillModalKeydown(event) {
  if (event.key === 'Escape') _closeAddToBillModal();
}

/**
 * The card at the top of the modal that names the row being added.
 *
 * @param {Object} txn
 * @returns {HTMLElement}
 */
function _buildAddToBillRowCard(txn) {
  const card = document.createElement('div');
  card.className = 'add-to-bill-row';

  const main = document.createElement('div');
  main.className = 'add-to-bill-row-main';
  const name = document.createElement('span');
  name.className = 'add-to-bill-row-name';
  name.textContent = _addToBillRowName(txn) || 'Transaction';
  const amount = document.createElement('span');
  const amountValue = Number(txn.amount || 0);
  amount.className = `add-to-bill-row-amount ${amountValue < 0 ? 'is-negative' : 'is-positive'}`;
  amount.textContent = billPickerMoney(amountValue);
  main.append(name, amount);

  const sub = document.createElement('div');
  sub.className = 'add-to-bill-row-sub';
  const accountName = billPickerAccountName(txn.account_id);
  sub.textContent = [billPickerDate(txn.date), accountName].filter(Boolean).join(' · ');

  card.append(main, sub);
  return card;
}

/**
 * Open the "Add to existing bill" modal for one right-clicked row.
 *
 * @param {Object} txnData - Context data for the right-clicked row.
 */
function openAddToBillModal(txnData) {
  const txn = (txnData && txnData.localTransaction)
    || transactions.find((candidate) => candidate.transaction_id === txnData.txnId);
  if (!txn) {
    showStatus('This transaction is not loaded; refresh the page and try again', 'error');
    return;
  }

  _closeAddToBillModal();

  const overlay = document.createElement('div');
  overlay.id = 'add-to-bill-modal';
  overlay.className = 'modal-overlay';
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) _closeAddToBillModal();
  });

  const modal = document.createElement('div');
  modal.className = 'modal modal-add-to-bill';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'add-to-bill-title');
  modal.innerHTML = `
    <div class="modal-header">
      <h2 id="add-to-bill-title">Add to existing bill</h2>
      <button class="modal-close" type="button" aria-label="Close">✕</button>
    </div>
    <div class="modal-body add-to-bill-body">
      <div class="add-to-bill-row-slot"></div>
      <div class="add-to-bill-label">Bill</div>
      <div class="add-to-bill-picker-slot"></div>
      <div class="add-to-bill-error hidden" role="alert"></div>
    </div>
    <div class="modal-footer">
      <button class="secondary" type="button" data-role="cancel">Cancel</button>
      <button type="button" data-role="confirm" disabled>Add to bill</button>
    </div>
  `;
  overlay.appendChild(modal);

  modal.querySelector('.add-to-bill-row-slot').appendChild(_buildAddToBillRowCard(txn));

  const errorBox = modal.querySelector('.add-to-bill-error');
  const confirmBtn = modal.querySelector('[data-role="confirm"]');
  const cancelBtn = modal.querySelector('[data-role="cancel"]');

  const showError = (message) => {
    errorBox.textContent = message;
    errorBox.classList.toggle('hidden', !message);
  };

  const picker = mountBillPicker(modal.querySelector('.add-to-bill-picker-slot'), {
    rows: [txn],
    onChange: (bill) => {
      showError('');
      confirmBtn.disabled = !bill;
    },
  });

  modal.querySelector('.modal-close').addEventListener('click', _closeAddToBillModal);
  cancelBtn.addEventListener('click', _closeAddToBillModal);
  confirmBtn.addEventListener('click', async () => {
    const bill = picker.getSelectedBill();
    if (!bill) return;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Adding…';
    showError('');

    const done = await _sendAddToBill(bill, txn, showError);

    if (done) {
      _closeAddToBillModal();
      return;
    }
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    confirmBtn.textContent = 'Add to bill';
  });

  document.body.appendChild(overlay);
  document.addEventListener('keydown', _onAddToBillModalKeydown);
  picker.focus();
}

/**
 * Send the add for one row and put the answer into the page. A refusal,
 * whole or for the row, is shown in the modal in the API's own words.
 *
 * @param {Object} bill - The chosen bill.
 * @param {Object} txn - The row being added.
 * @param {function(string): void} showError
 * @returns {Promise<boolean>} True when the row was added.
 */
async function _sendAddToBill(bill, txn, showError) {
  let answer;
  try {
    answer = await attachTransactionsToBill(bill.bill_id, [txn.transaction_id]);
  } catch (networkError) {
    showError(`Could not reach the server: ${networkError.message}`);
    return false;
  }

  if (!answer.ok) {
    showError(answer.body.error || `The transaction was not added (status ${answer.status}).`);
    return false;
  }

  const results = Array.isArray(answer.body.results) ? answer.body.results : [];
  const ownResult = results.find((result) => result.transaction_id === txn.transaction_id);
  if (ownResult && !ownResult.ok) {
    showError(ownResult.error || 'The transaction was not added.');
    return false;
  }

  await applyRowChangesFromResponse(answer.body, fallbackAccountIdsForRow(txn));
  renderTransactionTable();
  showStatus(`Added to ${bill.description || 'the bill'}`, 'success');
  return true;
}

/**
 * The question asked before a row leaves its bill. The API takes both sides
 * of a linked transfer off together, so the question says so.
 *
 * @param {boolean} isLinkedRow - Whether the row is one side of a linked transfer.
 * @returns {string}
 */
function removeFromBillConfirmText(isLinkedRow) {
  const subject = isLinkedRow ? 'Remove both sides of this transfer from its bill?' : 'Remove this transaction from its bill?';
  return `${subject}\n\nOnly the bill link is removed. The name, category and memo stay as they are.`;
}

/**
 * "Remove from bill": take a row that was added to its bill by hand off it
 * again. Its name, category and memo are left as they are.
 *
 * @param {Object} txnData - Context data for the right-clicked row.
 */
async function removeFromBillFromMenu(txnData) {
  const cachedRow = transactions.find((txn) => txn.transaction_id === txnData.txnId);
  const confirmText = removeFromBillConfirmText(!!(cachedRow && cachedRow.transfer_pair_id));
  if (!confirm(confirmText)) return;

  let answer;
  try {
    answer = await removeTransactionFromBill(txnData.txnId);
  } catch (networkError) {
    showStatus(`Failed to remove from bill: ${networkError.message}`, 'error');
    return;
  }

  if (!answer.ok) {
    showStatus(answer.body.error || `Failed to remove from bill (status ${answer.status})`, 'error');
    return;
  }

  await applyRowChangesFromResponse(answer.body, fallbackAccountIdsForRow(cachedRow));
  renderTransactionTable();
  showStatus(answer.body.message || 'Removed from bill', 'success');
}
