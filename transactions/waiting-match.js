// ============================================================
// transactions/waiting-match.js — Waiting Match Compare & Refresh
//
// A waiting match's Plaid row already shows what approval will
// write, so the bank's own values reach the screen only through
// `match_info.compare`. This file draws that compare popover from
// the ⇄ button beside the row's ✓ and ✗, and works out which
// accounts' cached rows an unmatch changes.
//
// Depends on: date-helpers.js (formatDate), table-renderer.js
// (_fmtCurrency), utils.js (escapeHtml), state.js (transactions)
// ============================================================

const MATCH_COMPARE_POPOVER_ID = 'match-compare-popover';
const MATCH_COMPARE_VIEWPORT_MARGIN = 8;
const MATCH_COMPARE_ANCHOR_GAP = 4;

let _matchCompareAnchor = null;


// ── Content ────────────────────────────────────────────────────

/**
 * The two sections the compare popover lists, built from `compare`.
 * Values are left raw; the HTML builder formats them.
 *
 * @param {{yours: Object, bank: Object}} compare - `match_info.compare`.
 * @returns {Array<{title: string, rows: Array<{label: string, kind: string, value: *}>}>}
 *   Empty when there is nothing to compare.
 */
function buildMatchCompareSections(compare) {
  if (!compare || (!compare.yours && !compare.bank)) return [];

  const yours = compare.yours || {};
  const bank = compare.bank || {};

  const bankRows = [
    { label: 'Date', kind: 'date', value: bank.date },
    { label: 'Name', kind: 'text', value: bank.name },
    { label: 'Amount', kind: 'amount', value: bank.amount },
  ];
  const bankMemo = typeof bank.memo === 'string' ? bank.memo.trim() : '';
  if (bankMemo) {
    bankRows.push({ label: 'Memo', kind: 'text', value: bankMemo });
  }

  return [
    {
      title: 'Your transaction',
      rows: [
        { label: 'Date', kind: 'date', value: yours.date },
        { label: 'Name', kind: 'text', value: yours.name },
        { label: 'Amount', kind: 'amount', value: yours.amount },
        { label: 'Category', kind: 'text', value: yours.category },
      ],
    },
    { title: 'Bank transaction', rows: bankRows },
  ];
}


/**
 * One value cell, formatted the way the ledger shows it.
 *
 * @param {{kind: string, value: *}} row
 * @param {string} currencyCode - The Plaid row's currency.
 * @returns {string} HTML for the `<dd>`.
 */
function _matchCompareValueHtml(row, currencyCode) {
  const isBlank = row.value === null || row.value === undefined || row.value === '';
  if (isBlank) {
    return '<dd class="match-compare-blank">—</dd>';
  }
  if (row.kind === 'date') {
    return `<dd>${escapeHtml(formatDate(row.value))}</dd>`;
  }
  if (row.kind === 'amount') {
    const amount = Number(row.value);
    const negativeClass = amount < 0 ? ' class="ledger-negative"' : '';
    return `<dd${negativeClass}>${escapeHtml(_fmtCurrency(amount, currencyCode))}</dd>`;
  }
  return `<dd>${escapeHtml(String(row.value))}</dd>`;
}


/**
 * The popover's inner HTML: a heading and a label/value grid per side.
 *
 * @param {{yours: Object, bank: Object}} compare - `match_info.compare`.
 * @param {string} [currencyCode] - The Plaid row's currency; USD when absent.
 * @returns {string} HTML, or '' when there is nothing to compare.
 */
function renderMatchCompareHtml(compare, currencyCode) {
  const sections = buildMatchCompareSections(compare);
  if (sections.length === 0) return '';

  return sections.map((section, sectionIndex) => {
    const headingId = `${MATCH_COMPARE_POPOVER_ID}-heading-${sectionIndex}`;
    const rowsHtml = section.rows
      .map(row => `<dt>${escapeHtml(row.label)}</dt>${_matchCompareValueHtml(row, currencyCode)}`)
      .join('');
    return `<section class="match-compare-section" aria-labelledby="${headingId}">`
      + `<h4 class="match-compare-heading" id="${headingId}">${escapeHtml(section.title)}</h4>`
      + `<dl class="match-compare-grid">${rowsHtml}</dl>`
      + `</section>`;
  }).join('');
}


// ── Placement ──────────────────────────────────────────────────

/**
 * Where the popover goes: below the button, left edges aligned, flipped
 * above when it would run off the bottom, and pulled in from the right
 * edge. It never leaves the viewport while the viewport can hold it.
 *
 * @param {{top: number, bottom: number, left: number, right: number}} anchorRect
 * @param {{width: number, height: number}} popoverSize
 * @param {{width: number, height: number}} viewport
 * @returns {{left: number, top: number}}
 */
function placeMatchComparePopover(anchorRect, popoverSize, viewport) {
  const margin = MATCH_COMPARE_VIEWPORT_MARGIN;
  const gap = MATCH_COMPARE_ANCHOR_GAP;

  let left = anchorRect.left;
  if (left + popoverSize.width > viewport.width - margin) {
    left = viewport.width - margin - popoverSize.width;
  }
  left = Math.max(margin, left);

  let top = anchorRect.bottom + gap;
  const fitsBelow = top + popoverSize.height <= viewport.height - margin;
  if (!fitsBelow) {
    const aboveTop = anchorRect.top - gap - popoverSize.height;
    top = aboveTop >= margin
      ? aboveTop
      : viewport.height - margin - popoverSize.height;
  }
  top = Math.max(margin, top);

  return { left, top };
}


// ── Open / close ───────────────────────────────────────────────

function _getMatchComparePopover() {
  let popoverEl = document.getElementById(MATCH_COMPARE_POPOVER_ID);
  if (!popoverEl) {
    popoverEl = document.createElement('div');
    popoverEl.id = MATCH_COMPARE_POPOVER_ID;
    popoverEl.className = 'match-compare-popover hidden';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-label', 'Compare your transaction with the bank transaction');
    popoverEl.tabIndex = -1;
    document.body.appendChild(popoverEl);
  }
  return popoverEl;
}


/**
 * Open the compare popover for a waiting match, or close it when this
 * button's popover is already open.
 *
 * @param {HTMLElement} anchorButton - The ⇄ button that was clicked.
 * @param {string} plaidTxnId - The Plaid row whose `match_info.compare` to show.
 */
function toggleMatchCompare(anchorButton, plaidTxnId) {
  if (_matchCompareAnchor && _matchCompareAnchor === anchorButton) {
    closeMatchCompare();
    return;
  }
  closeMatchCompare();

  const plaidTxn = (typeof transactions !== 'undefined' ? transactions : [])
    .find(txn => txn.transaction_id === plaidTxnId);
  const compare = plaidTxn && plaidTxn.match_info && plaidTxn.match_info.compare;
  const contentHtml = renderMatchCompareHtml(compare, plaidTxn && plaidTxn.iso_currency_code);
  if (!contentHtml) return;

  const popoverEl = _getMatchComparePopover();
  popoverEl.innerHTML = contentHtml;
  popoverEl.style.left = '0px';
  popoverEl.style.top = '0px';
  popoverEl.classList.remove('hidden');

  const popoverRect = popoverEl.getBoundingClientRect();
  const position = placeMatchComparePopover(
    anchorButton.getBoundingClientRect(),
    { width: popoverRect.width, height: popoverRect.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  popoverEl.style.left = `${position.left}px`;
  popoverEl.style.top = `${position.top}px`;

  _matchCompareAnchor = anchorButton;
  anchorButton.setAttribute('aria-expanded', 'true');
  anchorButton.setAttribute('aria-controls', MATCH_COMPARE_POPOVER_ID);
  anchorButton.classList.add('is-open');

  document.addEventListener('mousedown', _onMatchCompareOutsidePointer, true);
  document.addEventListener('touchstart', _onMatchCompareOutsidePointer, true);
  document.addEventListener('keydown', _onMatchCompareKeydown, true);
  document.addEventListener('scroll', _onMatchCompareDismiss, true);
  window.addEventListener('resize', _onMatchCompareDismiss);
}


/**
 * Close the compare popover if it is open.
 *
 * @param {{restoreFocus?: boolean}} [options] - Return focus to the button,
 *   as after Escape (default false).
 */
function closeMatchCompare(options = {}) {
  const anchorButton = _matchCompareAnchor;
  _matchCompareAnchor = null;

  document.removeEventListener('mousedown', _onMatchCompareOutsidePointer, true);
  document.removeEventListener('touchstart', _onMatchCompareOutsidePointer, true);
  document.removeEventListener('keydown', _onMatchCompareKeydown, true);
  document.removeEventListener('scroll', _onMatchCompareDismiss, true);
  window.removeEventListener('resize', _onMatchCompareDismiss);

  const popoverEl = document.getElementById(MATCH_COMPARE_POPOVER_ID);
  if (popoverEl) {
    popoverEl.classList.add('hidden');
    popoverEl.innerHTML = '';
  }

  if (!anchorButton) return;
  anchorButton.setAttribute('aria-expanded', 'false');
  anchorButton.classList.remove('is-open');
  if (options.restoreFocus && anchorButton.isConnected) {
    anchorButton.focus();
  }
}


function _onMatchCompareOutsidePointer(event) {
  const popoverEl = document.getElementById(MATCH_COMPARE_POPOVER_ID);
  if (popoverEl && popoverEl.contains(event.target)) return;
  // A press on the open button is left to its click, which closes it.
  if (_matchCompareAnchor && _matchCompareAnchor.contains(event.target)) return;
  closeMatchCompare();
}


function _onMatchCompareKeydown(event) {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  closeMatchCompare({ restoreFocus: true });
}


function _onMatchCompareDismiss(event) {
  // Scrolling inside the popover itself is not a reason to close it.
  const popoverEl = document.getElementById(MATCH_COMPARE_POPOVER_ID);
  if (event && event.target && popoverEl && popoverEl.contains(event.target)) return;
  closeMatchCompare();
}


// ── Cache refresh after unmatch ────────────────────────────────

/**
 * The accounts whose cached rows change when a waiting match is undone.
 *
 * Unmatching puts the Plaid row back to the bank's own values, and a
 * transfer row that named the Plaid row as its partner while the match
 * waited names the manual row again, so the far side's account changes
 * too, even when it is not the one on screen.
 *
 * @param {string} manualTxnId - The matched manual or bill row's id.
 * @param {Array<Object>} rows - Every cached transaction.
 * @returns {Array<string>|null} Account ids, or null when one cannot be
 *   told and every account should be fetched.
 */
function accountsTouchedByMatch(manualTxnId, rows) {
  const cachedRows = Array.isArray(rows) ? rows : [];
  const manualRow = cachedRows.find(txn => txn && txn.transaction_id === manualTxnId);
  const plaidRow = cachedRows.find(txn => (
    txn && txn.match_info && txn.match_info.matched_txn_id === manualTxnId
  ));
  const sides = [manualRow, plaidRow].filter(Boolean);
  if (sides.length === 0) return null;

  const rowAccount = txn => txn.account_id || txn.plaid_account_id || '';
  const accountIds = new Set();
  let accountUnknown = false;

  const addAccount = accountId => {
    if (accountId) {
      accountIds.add(accountId);
    } else {
      accountUnknown = true;
    }
  };

  sides.forEach(side => addAccount(rowAccount(side)));

  // The two rows of a transfer share one `transfer_pair_id`, and while the
  // match waits both sides can carry the same pair, so a partner is any
  // other cached row with that id. An uncached partner is found through
  // the account a side names for it.
  const sideIds = new Set(sides.map(txn => txn.transaction_id));
  const pairIds = new Set(sides.map(txn => txn.transfer_pair_id).filter(Boolean));
  pairIds.forEach(pairId => {
    const partnerRows = cachedRows.filter(txn => (
      txn && txn.transfer_pair_id === pairId && !sideIds.has(txn.transaction_id)
    ));
    if (partnerRows.length > 0) {
      partnerRows.forEach(partnerRow => addAccount(rowAccount(partnerRow)));
      return;
    }
    const namingSide = sides.find(side => (
      side.transfer_pair_id === pairId && side.transfer_partner_account_id
    ));
    addAccount(namingSide ? namingSide.transfer_partner_account_id : '');
  });

  return accountUnknown ? null : Array.from(accountIds);
}
