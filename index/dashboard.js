/**
 * Dashboard view — orchestrates the dashboard section after login.
 * Renders user info, manages deletion banners, delegates bank list to connections-list module.
 */

const IndexDashboard = (() => {
  try {
    localStorage.removeItem('pf_sync_no_active_plaid_items');
  } catch (error) {
    console.debug('Failed to clear cached sync suppression marker:', error);
  }

  // No extra init needed — dashboard rendering is triggered by showDashboard() in auth-views.js
  // This module exists as a namespace for future dashboard-specific logic
  // (e.g. webhook alerts, deletion banners, net-worth summary widget)
  return {};
})();
