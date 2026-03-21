/**
 * Plaid Link integration — generate tokens and open Plaid Link for new bank connections.
 * Handles both transaction-focused and investment-focused connection flows.
 */

const IndexPlaidIntegration = (() => {
  function init() {
    const transactionButton = document.getElementById('link-button');
    const investmentButton = document.getElementById('link-investment-button');

    if (transactionButton) {
      transactionButton.addEventListener('click', () => _connectNewBank(null));
    }
    if (investmentButton) {
      investmentButton.addEventListener('click', () => _connectNewBank('investments_only'));
    }
  }

  /**
   * Start a new-bank Plaid Link session.
   * @param {string|null} mode - null for transaction token, 'investments_only' for investment token.
   */
  async function _connectNewBank(mode) {
    if (!IndexState.getAuthToken()) {
      IndexUtils.showMessage('dashboard-message', 'Please login first', 'error');
      return;
    }

    try {
      const linkToken = await IndexApi.fetchLinkToken({ mode });
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken) => {
          try {
            const result = await IndexApi.exchangePublicToken(publicToken);
            IndexUtils.showMessage('dashboard-message', '✓ Bank connected successfully!', 'success');

            // Clear caches from other pages so they pick up the new bank
            localStorage.removeItem('transactionsCache');
            localStorage.removeItem('transactionsAccountsCache');
            invalidateItemInfoCache();

            // Flag for investments page to auto-sync if investments were included
            const billedForInvestments =
              (result.billed_products && result.billed_products.includes('investments')) ||
              (mode === 'investments_only' && result.item_id);

            if (billedForInvestments && result.item_id) {
              sessionStorage.setItem('newInvestmentItems', JSON.stringify([result.item_id]));
            }

            // Record when the initial sync for this newly-connected bank started.
            // Store strictly under the Plaid item id key.
            try {
              const itemId = result.item_id || result.plaid_item_id || null;
              if (itemId) IndexState.setActionTimestamp(itemId, 'initial_sync');
            } catch (tsErr) {
              console.warn('Could not persist initial sync timestamp', tsErr);
            }

            IndexConnectionsList.loadBanks();
          } catch (exchangeError) {
            IndexUtils.showMessage('dashboard-message', 'Error: ' + exchangeError.message, 'error');
          }
        },
        onExit: (exitError) => {
          if (exitError != null) {
            IndexUtils.showMessage('dashboard-message', 'Connection cancelled or failed', 'error');
          }
        },
      });
      handler.open();
    } catch (linkError) {
      IndexUtils.showMessage('dashboard-message', 'Error: ' + linkError.message, 'error');
    }
  }

  return { init };
})();
