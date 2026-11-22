// ============================================================
// excel/main.js — task pane startup
//
// Waits for Office.js and the backend address, then shows the
// sign-in form or the panel. Opened in a plain browser, the panel
// still signs in and renders, with the workbook buttons off.
//
// Dependencies: everything else in excel/, config.js,
// shared/auth-session.js (takeSessionExpiredNotice).
// ============================================================

/**
 * Whether Office.js has loaded and says the host is Excel.
 *
 * @returns {Promise<boolean>}
 */
async function _excelHostIsExcel() {
  if (typeof Office === 'undefined' || typeof Office.onReady !== 'function') return false;
  try {
    const info = await Office.onReady();
    return Boolean(info && info.host === Office.HostType.Excel);
  } catch (_officeError) {
    return false;
  }
}

async function startExcelPanel() {
  const [inExcel] = await Promise.all([_excelHostIsExcel(), window.BACKEND_URL_PROMISE]);
  const isDev = Boolean(window.LOCAL_AUTO_LOGIN_ENABLED);
  initExcelPanel(inExcel);
  excelShowEnvironment(BACKEND_URL, isDev);

  const sessionExpired = takeSessionExpiredNotice();
  if (!excelHasSession()) {
    excelShowSignIn(sessionExpired ? 'Your session expired. Sign in again.' : null);
    return;
  }
  try {
    await excelEnterPanel(isDev);
  } catch (startError) {
    console.error('[excel] Startup failed:', startError);
    excelSetStatus(startError && startError.message ? startError.message : 'The panel could not start.', 'error');
  }
}

startExcelPanel();
