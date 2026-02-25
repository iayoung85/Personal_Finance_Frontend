/**
 * Shared helpers for the index/dashboard page.
 * View switching, message display, auth state checks, formatting utilities.
 */

const IndexUtils = (() => {
  const VIEW_IDS = [
    'login-view',
    'register-view',
    'dashboard-view',
    'forgot-password-view',
    'two-factor-view',
  ];

  /** Hide all views, then show the one matching viewId. */
  function switchToView(viewId) {
    VIEW_IDS.forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });
    document.getElementById(viewId)?.classList.remove('hidden');
    clearMessages();
  }

  /** Clear all status message containers. */
  function clearMessages() {
    const messageIds = [
      'login-message',
      'register-message',
      'dashboard-message',
      'forgot-message',
      'two-factor-message',
    ];
    messageIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) element.innerHTML = '';
    });
  }

  /**
   * Show a status message in the specified container.
   * @param {string} containerId - DOM id of the message container.
   * @param {string} message - Text to display.
   * @param {'error'|'success'} type - Visual styling class.
   */
  function showMessage(containerId, message, type) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<div class="message ${type}">${message}</div>`;
    }
  }

  return {
    switchToView,
    clearMessages,
    showMessage,
  };
})();
