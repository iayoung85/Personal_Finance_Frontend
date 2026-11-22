// ============================================================
// shared/budget-alert-link.js — the Set alert address
//
// A budget target's Set alert button opens Spending Alerts in a new
// tab with the create form filled in. The two pages agree on the
// address through this one file: the Budget page builds it, Spending
// Alerts reads it. Nothing is created until the user saves there,
// and the alert keeps no tie to the target.
//
// spending-alerts.html?new_alert=1&category=<label>&amount=600.00&period=monthly
// spending-alerts.html?new_alert=1&category=<label>&amount=6000.00&period=yearly&reset_month=11&reset_day=1
// ============================================================

const ALERT_PREFILL_PAGE = 'spending-alerts.html';
const ALERT_PREFILL_FLAG = 'new_alert';
const ALERT_PREFILL_PARAMS = [
  ALERT_PREFILL_FLAG, 'category', 'amount', 'period', 'reset_month', 'reset_day',
];

// A target's cadence, and the alert period that watches the same span.
const ALERT_PERIOD_BY_CADENCE = {
  monthly: 'monthly',
  annual: 'yearly',
};

/**
 * The Spending Alerts address for one target.
 *
 * An annual target's alert resets on day 1 of the fiscal start month, so
 * it watches the same year the target does.
 *
 * @param {{category: string, cadence: string, amount: (number|string)}} target
 * @param {number} fiscalStartMonth - 1-12
 * @param {string} [currentSearch] - this page's query string; a backend
 *   override in it is carried along so the new tab talks to the same API
 * @returns {string|null} null when the target cannot make an alert
 */
function buildSetAlertAddress(target, fiscalStartMonth, currentSearch = '') {
  if (!target || typeof target.category !== 'string' || !target.category.trim()) return null;
  const period = ALERT_PERIOD_BY_CADENCE[target.cadence];
  if (!period) return null;
  const amount = Number(target.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const params = new URLSearchParams();
  params.set(ALERT_PREFILL_FLAG, '1');
  params.set('category', target.category.trim());
  params.set('amount', amount.toFixed(2));
  params.set('period', period);
  if (period === 'yearly') {
    const month = Number(fiscalStartMonth);
    params.set('reset_month', String(Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1));
    params.set('reset_day', '1');
  }

  const backend = new URLSearchParams(currentSearch || '').get('backend');
  if (backend) params.set('backend', backend);
  return `${ALERT_PREFILL_PAGE}?${params.toString()}`;
}

function _alertPrefillWholeNumber(rawValue, low, high) {
  if (rawValue === null || !/^\d+$/.test(rawValue)) return null;
  const value = Number(rawValue);
  return value >= low && value <= high ? value : null;
}

/**
 * What the create form should hold, read from the address.
 *
 * @param {string} search - window.location.search
 * @returns {{category: string, amount: string, period: string,
 *            resetMonth: number|null, resetDay: number|null}|null}
 *   null when the address asks for nothing, so the page opens as usual
 */
function readAlertPrefill(search) {
  const params = new URLSearchParams(search || '');
  if (params.get(ALERT_PREFILL_FLAG) !== '1') return null;
  const category = (params.get('category') || '').trim();
  if (!category) return null;

  const rawAmount = (params.get('amount') || '').trim();
  const amountNumber = Number(rawAmount);
  const amount = rawAmount && Number.isFinite(amountNumber) && amountNumber > 0 ? rawAmount : '';

  const period = params.get('period') === 'yearly' ? 'yearly' : 'monthly';
  let resetMonth = null;
  let resetDay = null;
  if (period === 'yearly') {
    resetMonth = _alertPrefillWholeNumber(params.get('reset_month'), 1, 12) || 1;
    resetDay = _alertPrefillWholeNumber(params.get('reset_day'), 1, 31) || 1;
  }
  return { category, amount, period, resetMonth, resetDay };
}

/**
 * The query string with the prefill removed, so a reload does not open
 * the form again. Other parameters, such as a backend override, stay.
 *
 * @param {string} search
 * @returns {string} '' or '?...'
 */
function searchWithoutAlertPrefill(search) {
  const params = new URLSearchParams(search || '');
  for (const name of ALERT_PREFILL_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
