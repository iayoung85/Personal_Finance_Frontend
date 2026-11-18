// ============================================================
// categories/pending-category-return.js — Back to a waiting transaction
// The transactions page sends the user here to create a category
// its manual-transaction modal did not know. Once a category is
// created, these hand it back and return to that page.
// ============================================================

/**
 * After a category is created, hand it to a waiting manual transaction:
 * one new category is assigned at once; several ask which one.
 * Does nothing when no transaction is waiting.
 * @param {string[]} justCreatedCategories
 */
function _handlePendingTxnAfterCategoryCreate(justCreatedCategories) {
  if (!sessionStorage.getItem('pf_pending_manual_txn')) return;
  if (!justCreatedCategories.length) return;

  // Accumulates across several creates in one visit from the transactions page.
  const existing = JSON.parse(sessionStorage.getItem('pf_pending_txn_new_categories') || '[]');
  const allNewCategories = [...existing, ...justCreatedCategories];
  sessionStorage.setItem('pf_pending_txn_new_categories', JSON.stringify(allNewCategories));

  if (allNewCategories.length === 1) {
    _assignPendingTxnCategoryAndRedirect(allNewCategories[0]);
  } else {
    _showPendingTxnCategoryPicker(allNewCategories);
  }
}

/**
 * Ask which of the newly created categories goes on the waiting transaction.
 * @param {string[]} allNewCategories
 */
function _showPendingTxnCategoryPicker(allNewCategories) {
  const existingOverlay = document.getElementById('pending-txn-category-picker');
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pending-txn-category-picker';
  overlay.className = 'modal-overlay cat-dialog-overlay';

  const radioRows = allNewCategories.map((categoryName, index) => `
    <label class="cat-pick-row">
      <input type="radio" name="pending-txn-cat-choice" value="${index}" ${index === 0 ? 'checked' : ''}>
      <span>${escapeHtml(categoryName)}</span>
    </label>
  `).join('');

  overlay.innerHTML = `
    <div class="cat-dialog" role="dialog" aria-modal="true" aria-labelledby="pending-txn-cat-title">
      <header class="cat-dialog-header">
        <h3 id="pending-txn-cat-title">Which category for your transaction?</h3>
        <p class="cat-dialog-subtitle">You created several. Choose the one the waiting transaction gets.</p>
      </header>
      <div class="cat-dialog-body"><div class="cat-form-panel cat-pick-list">${radioRows}</div></div>
      <footer class="cat-dialog-footer">
        <div class="cat-dialog-footer-left"></div>
        <div class="cat-dialog-footer-right">
          <button type="button" id="pending-txn-cat-skip" class="cat-button cat-button-secondary">Skip (no category)</button>
          <button type="button" id="pending-txn-cat-confirm" class="cat-button cat-button-primary">Confirm &amp; Return</button>
        </div>
      </footer>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('pending-txn-cat-confirm').addEventListener('click', () => {
    const selectedRadio = document.querySelector('input[name="pending-txn-cat-choice"]:checked');
    const chosenCategory = selectedRadio ? allNewCategories[parseInt(selectedRadio.value, 10)] : allNewCategories[0];
    _assignPendingTxnCategoryAndRedirect(chosenCategory);
  });
  document.getElementById('pending-txn-cat-skip').addEventListener('click', () => {
    _assignPendingTxnCategoryAndRedirect(null);
  });
  document.getElementById('pending-txn-cat-confirm').focus();
}

/**
 * Put the chosen category on the waiting transaction, clear this visit's
 * keys, and go back to the transactions page.
 * @param {string|null} category
 */
function _assignPendingTxnCategoryAndRedirect(category) {
  const pendingRaw = sessionStorage.getItem('pf_pending_manual_txn');
  if (!pendingRaw) return;

  const pending = JSON.parse(pendingRaw);
  pending.category = category;
  pending.categoryResolved = true;
  sessionStorage.setItem('pf_pending_manual_txn', JSON.stringify(pending));

  sessionStorage.removeItem('pf_pending_txn_new_categories');
  sessionStorage.removeItem('pf_prefill_custom_category');

  window.location.href = 'transactions.html';
}
