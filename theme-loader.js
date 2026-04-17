// ============================================================
// theme-loader.js — Synchronous theme bootstrap
//
// Loaded in <head> BEFORE theme.css so that data-theme is set
// on <html> before the first paint. This prevents a flash of
// the wrong palette when the user has chosen light or auto.
// ============================================================
(function () {
  try {
    var config = JSON.parse(localStorage.getItem('appConfig') || '{}');
    var theme = config.theme;
    if (theme !== 'dark' && theme !== 'light' && theme !== 'auto') {
      theme = 'dark';
    }
    document.documentElement.dataset.theme = theme;
  } catch (_ignored) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
