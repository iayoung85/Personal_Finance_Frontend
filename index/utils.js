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
   * For dashboard messages, also shows a toast overlay so the user
   * doesn't have to scroll up to see it.
   * @param {string} containerId - DOM id of the message container.
   * @param {string} message - Text to display.
   * @param {'error'|'success'|'info'} type - Visual styling class.
   */
  function showMessage(containerId, message, type) {
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<div class="message ${type}">${message}</div>`;
    }
    // Always show a toast overlay for dashboard messages
    if (containerId === 'dashboard-message') {
      showToast(message, type);
    }
  }

  /**
   * Show a toast notification that auto-dismisses.
   * @param {string} message - Text to display.
   * @param {'error'|'success'|'info'} type - Visual styling class.
   * @param {number} [duration=10000] - Auto-dismiss delay in ms (0 = manual only).
   */
  function showToast(message, type, duration = 10000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML =
      `<span>${message}</span>` +
      `<button class="toast-close" aria-label="Dismiss">&times;</button>`;

    const dismiss = () => {
      toast.classList.add('toast-removing');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    toast.querySelector('.toast-close').addEventListener('click', dismiss);

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  }

  return {
    switchToView,
    clearMessages,
    showMessage,
    showToast,
  };
})();
