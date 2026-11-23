// ============================================================
// transactions/bill-picker.js — Bill picker with details
//
// One dropdown of the user's bills, the chosen bill's details, and how the
// rows being added compare to it. The "Add to existing bill" modal and bulk
// modify both mount it, so a wrong pick reads the same way in either before
// it is confirmed.
//
// Which rows and bills may be joined is the API's rule. This file only lays
// out what the API says about a bill next to the rows the user picked.
// ============================================================

/** The API's own refusal for a transfer bill, shown on its greyed-out line. */
const BILL_PICKER_TRANSFER_REASON = 'Past transactions cannot be added to a transfer bill.';

const BILL_PICKER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Formatting ───────────────────────────────────────────────

/**
 * "-12.5" -> "-$12.50". Anything not a number is shown as given.
 *
 * @param {number|string} value
 * @returns {string}
 */
function billPickerMoney(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(number)) {
    return String(value ?? '');
  }
  const text = `$${Math.abs(number).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return number < 0 ? `-${text}` : text;
}

/**
 * "2026-10-03" -> "Oct 3, 2026". Anything unparseable is shown as given.
 *
 * @param {string} isoDate
 * @returns {string}
 */
function billPickerDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!match) return String(isoDate || '');
  return `${BILL_PICKER_MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${match[1]}`;
}

/** Whole cents, so two amounts compare without float noise. */
function _billPickerCents(value) {
  return Math.round(Number(value || 0) * 100);
}

/** Plural helper: "1 transaction", "3 transactions". */
function _billPickerCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Whether a bill moves money between two of the user's accounts.
 *
 * @param {Object} bill - A bill as the API serializes it.
 * @returns {boolean}
 */
function billPickerIsTransferBill(bill) {
  return !!(bill && bill.transfer_account_id);
}

// ── Pure parts: the dropdown line, details, comparison ───────

/**
 * What the dropdown shows for one bill: name, amount, schedule and account,
 * a Paused tag, and for a transfer bill a disabled line with the reason.
 *
 * @param {Object} bill - A bill as `GET /api/bills` lists it.
 * @returns {{billId: string, name: string, amount: string, schedule: string,
 *   account: string, isPaused: boolean, disabled: boolean,
 *   disabledReason: string, text: string}}
 */
function billPickerOptionLine(bill) {
  const isTransfer = billPickerIsTransferBill(bill);
  const isPaused = bill.is_active === false;
  const name = bill.description || 'Untitled bill';
  const amount = billPickerMoney(bill.amount);
  const schedule = bill.schedule_summary || '';
  let account = bill.account_name || '';
  if (isTransfer && bill.transfer_account_name) {
    account = `${account} → ${bill.transfer_account_name}`;
  }

  const textParts = [name, amount, schedule, account].filter(Boolean);
  let text = textParts.join(' · ');
  if (isPaused) text += ' (Paused)';

  return {
    billId: bill.bill_id,
    name,
    amount,
    schedule,
    account,
    isPaused,
    disabled: isTransfer,
    disabledReason: isTransfer ? BILL_PICKER_TRANSFER_REASON : '',
    text,
  };
}

/**
 * The dropdown's order: bills that can be chosen first, then paused ones,
 * then the transfer bills that cannot; by name within each group.
 *
 * @param {Object[]} bills
 * @returns {Object[]} A new array.
 */
function billPickerSortBills(bills) {
  const groupOf = (bill) => {
    if (billPickerIsTransferBill(bill)) return 2;
    if (bill.is_active === false) return 1;
    return 0;
  };
  return (bills || []).slice().sort((left, right) => {
    const groupGap = groupOf(left) - groupOf(right);
    if (groupGap !== 0) return groupGap;
    return String(left.description || '').localeCompare(String(right.description || ''));
  });
}

/**
 * The dropdown lines whose text holds every word of the search.
 *
 * @param {Object[]} lines - From billPickerOptionLine.
 * @param {string} query
 * @returns {Object[]}
 */
function billPickerFilterLines(lines, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return lines.slice();
  return lines.filter((line) => {
    const haystack = line.text.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * The label and value pairs of the chosen bill's details, in the order shown.
 *
 * @param {Object} bill - A bill as the API serializes it.
 * @returns {Array<{label: string, value: string}>}
 */
function billPickerDetailRows(bill) {
  const isPaused = bill.is_active === false;
  const upcoming = Array.isArray(bill.upcoming_occurrences) ? bill.upcoming_occurrences : [];
  let nextDate = 'None scheduled';
  if (isPaused) {
    nextDate = 'None while paused';
  } else if (upcoming.length > 0 && upcoming[0].date) {
    nextDate = billPickerDate(upcoming[0].date);
  }

  let account = bill.account_name || '';
  if (billPickerIsTransferBill(bill) && bill.transfer_account_name) {
    account = `${account} → ${bill.transfer_account_name}`;
  }

  const rows = [
    { label: 'Amount', value: billPickerMoney(bill.amount) },
    { label: 'Schedule', value: bill.schedule_summary || '' },
    { label: 'Account', value: account },
    { label: 'Bank', value: bill.bank_name || '' },
    { label: 'Category', value: bill.user_category || 'None' },
    { label: 'Memo', value: bill.memo || 'None' },
    { label: 'Auto-pay', value: bill.auto_pay ? 'Yes' : 'No' },
    { label: 'Status', value: isPaused ? 'Paused' : 'Active' },
    { label: 'Next date', value: nextDate },
  ];
  return rows.filter((row) => row.value !== '');
}

/**
 * How the rows being added compare to the bill: how many and over what
 * dates, their amounts beside the bill's, and one warning line each for a
 * different amount, an opposite sign, and a different account.
 *
 * @param {Object} bill - A bill as the API serializes it.
 * @param {Array<{date: string, amount: number, account_id: string}>} rows
 * @param {function(string): string} [accountNameFor] - Names an account by id;
 *   '' when it does not know it.
 * @returns {{countLine: string, amountLine: string, warnings: string[]}}
 */
function billPickerComparison(bill, rows, accountNameFor) {
  const heldRows = Array.isArray(rows) ? rows : [];
  const nameFor = typeof accountNameFor === 'function' ? accountNameFor : () => '';
  const billAmount = billPickerMoney(bill.amount);
  const isSingle = heldRows.length === 1;

  const dates = heldRows.map((row) => row.date).filter(Boolean).sort();
  let countLine = _billPickerCount(heldRows.length, 'transaction', 'transactions');
  if (dates.length > 0) {
    const first = billPickerDate(dates[0]);
    const last = billPickerDate(dates[dates.length - 1]);
    countLine += first === last ? ` on ${first}` : `, ${first} to ${last}`;
  }

  const cents = heldRows.map((row) => _billPickerCents(row.amount));
  let amountLine = '';
  if (cents.length > 0) {
    const low = Math.min(...cents);
    const high = Math.max(...cents);
    let shown = billPickerMoney(low / 100);
    if (low !== high) {
      shown = `${billPickerMoney(low / 100)} to ${billPickerMoney(high / 100)}`;
    } else if (!isSingle) {
      shown += ' each';
    }
    amountLine = `${shown}, against the bill's ${billAmount}`;
  }

  const warnings = [];
  const billCents = _billPickerCents(bill.amount);
  const billSign = Math.sign(billCents);

  const oppositeRows = heldRows.filter((row) => {
    const rowSign = Math.sign(_billPickerCents(row.amount));
    return billSign !== 0 && rowSign !== 0 && rowSign !== billSign;
  });
  if (oppositeRows.length > 0) {
    const billWay = billSign < 0 ? 'takes money out' : 'puts money in';
    const rowWay = billSign < 0 ? 'in' : 'out';
    if (isSingle) {
      warnings.push(`This transaction puts money ${rowWay}, but the bill ${billWay}.`);
    } else {
      warnings.push(`${oppositeRows.length} of ${heldRows.length} transactions put money ${rowWay}, but the bill ${billWay}.`);
    }
  }

  const otherAmountRows = heldRows.filter((row) => {
    if (oppositeRows.includes(row)) return false;
    return _billPickerCents(row.amount) !== billCents;
  });
  if (otherAmountRows.length > 0) {
    if (isSingle) {
      warnings.push(`The amount differs from the bill's: ${billPickerMoney(otherAmountRows[0].amount)} against ${billAmount}.`);
    } else {
      warnings.push(`${otherAmountRows.length} of ${heldRows.length} transactions differ from the bill's amount of ${billAmount}.`);
    }
  }

  const otherAccountRows = heldRows.filter((row) => row.account_id !== bill.account_id);
  if (otherAccountRows.length > 0) {
    const billAccountName = nameFor(bill.account_id) || bill.account_name || 'its own account';
    const otherNames = [];
    otherAccountRows.forEach((row) => {
      const name = nameFor(row.account_id) || 'another account';
      if (!otherNames.includes(name)) otherNames.push(name);
    });
    if (isSingle) {
      warnings.push(`This transaction is in ${otherNames[0]}, but the bill is in ${billAccountName}.`);
    } else {
      warnings.push(`${otherAccountRows.length} of ${heldRows.length} transactions are in ${otherNames.join(', ')}, but the bill is in ${billAccountName}.`);
    }
  }

  return { countLine, amountLine, warnings };
}

// ── The component ────────────────────────────────────────────

/**
 * Names an account the way the page's sidebar does, or '' when the page
 * does not hold it.
 *
 * @param {string} accountId
 * @returns {string}
 */
function billPickerAccountName(accountId) {
  if (!accountId || typeof accounts === 'undefined' || !Array.isArray(accounts)) return '';
  const account = accounts.find((acct) => acct.account_id === accountId);
  if (!account) return '';
  return typeof _buildAccountDisplayName === 'function'
    ? _buildAccountDisplayName(account)
    : (account.custom_name || account.account_name || '');
}

/** Make an element with a class and, optionally, its text. */
function _billPickerEl(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

/**
 * Mount the picker into a container: a dropdown button, a searchable list
 * of every bill, and the chosen bill's details with the comparison below.
 *
 * @param {HTMLElement} container
 * @param {{rows: Object[], onChange?: function(Object|null): void,
 *   accountNameFor?: function(string): string}} options - `rows` are the
 *   transactions being added, as the page holds them.
 * @returns {{getSelectedBillId: function(): string, getSelectedBill: function(): (Object|null), focus: function(): void}}
 */
function mountBillPicker(container, options) {
  const rows = (options && options.rows) || [];
  const onChange = (options && options.onChange) || (() => {});
  const accountNameFor = (options && options.accountNameFor) || billPickerAccountName;

  const state = {
    bills: [],
    lines: [],
    shownLines: [],
    loaded: false,
    loadError: '',
    selectedId: '',
    activeIndex: -1,
    isOpen: false,
    detailRequest: 0,
    history: null,
    historyError: '',
  };

  const root = _billPickerEl('div', 'bill-picker');
  const trigger = _billPickerEl('button', 'bill-picker-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const triggerText = _billPickerEl('span', 'bill-picker-trigger-text', 'Loading bills…');
  const caret = _billPickerEl('span', 'bill-picker-caret', '▾');
  caret.setAttribute('aria-hidden', 'true');
  trigger.append(triggerText, caret);

  const panel = _billPickerEl('div', 'bill-picker-panel hidden');
  const search = _billPickerEl('input', 'modal-input bill-picker-search');
  search.type = 'text';
  search.placeholder = 'Search by name, amount, schedule or account';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Search bills');
  const list = _billPickerEl('ul', 'bill-picker-list');
  list.setAttribute('role', 'listbox');
  panel.append(search, list);

  const details = _billPickerEl('div', 'bill-picker-details hidden');
  details.setAttribute('aria-live', 'polite');

  root.append(trigger, panel, details);
  container.appendChild(root);

  function selectedBill() {
    return state.bills.find((bill) => bill.bill_id === state.selectedId) || null;
  }

  function renderTrigger() {
    triggerText.classList.remove('is-placeholder');
    if (!state.loaded) {
      triggerText.textContent = state.loadError ? 'Bills could not be loaded' : 'Loading bills…';
      trigger.disabled = !!state.loadError || !state.loaded;
      return;
    }
    trigger.disabled = state.bills.length === 0;
    const bill = selectedBill();
    if (bill) {
      triggerText.textContent = billPickerOptionLine(bill).text;
    } else {
      triggerText.textContent = state.bills.length === 0 ? 'No bills yet' : 'Choose a bill';
      triggerText.classList.add('is-placeholder');
    }
  }

  function renderList() {
    list.innerHTML = '';
    state.shownLines = billPickerFilterLines(state.lines, search.value);
    if (state.shownLines.length === 0) {
      list.appendChild(_billPickerEl('li', 'bill-picker-empty', 'No bill matches that search.'));
      return;
    }
    state.shownLines.forEach((line, index) => {
      const item = _billPickerEl('li', 'bill-picker-option');
      item.setAttribute('role', 'option');
      item.dataset.billId = line.billId;
      item.dataset.index = String(index);
      if (line.disabled) {
        item.classList.add('is-disabled');
        item.setAttribute('aria-disabled', 'true');
        item.title = line.disabledReason;
      }
      if (line.billId === state.selectedId) {
        item.classList.add('is-selected');
        item.setAttribute('aria-selected', 'true');
      }
      if (index === state.activeIndex) item.classList.add('is-active');

      const top = _billPickerEl('div', 'bill-picker-option-top');
      top.appendChild(_billPickerEl('span', 'bill-picker-option-name', line.name));
      if (line.isPaused) top.appendChild(_billPickerEl('span', 'bill-picker-tag bill-picker-tag-paused', 'Paused'));
      if (line.disabled) top.appendChild(_billPickerEl('span', 'bill-picker-tag bill-picker-tag-transfer', 'Transfer'));
      top.appendChild(_billPickerEl('span', 'bill-picker-option-amount', line.amount));
      item.appendChild(top);

      const subParts = [line.schedule, line.account].filter(Boolean);
      if (subParts.length > 0) {
        item.appendChild(_billPickerEl('div', 'bill-picker-option-sub', subParts.join(' · ')));
      }
      if (line.disabled) {
        item.appendChild(_billPickerEl('div', 'bill-picker-option-reason', line.disabledReason));
      }
      list.appendChild(item);
    });
  }

  function renderDetails() {
    const bill = selectedBill();
    details.innerHTML = '';
    if (!bill) {
      details.classList.add('hidden');
      return;
    }
    details.classList.remove('hidden');

    const header = _billPickerEl('div', 'bill-picker-details-header');
    header.appendChild(_billPickerEl('span', 'bill-picker-details-name', bill.description || 'Untitled bill'));
    const statusTag = bill.is_active === false
      ? _billPickerEl('span', 'bill-picker-tag bill-picker-tag-paused', 'Paused')
      : _billPickerEl('span', 'bill-picker-tag bill-picker-tag-active', 'Active');
    header.appendChild(statusTag);
    details.appendChild(header);

    const facts = _billPickerEl('dl', 'bill-picker-facts');
    billPickerDetailRows(bill)
      .filter((row) => row.label !== 'Status')
      .forEach((row) => {
        facts.appendChild(_billPickerEl('dt', '', row.label));
        facts.appendChild(_billPickerEl('dd', '', row.value));
      });
    details.appendChild(facts);

    details.appendChild(renderHistory());
    details.appendChild(renderComparison(bill));
  }

  function renderHistory() {
    const section = _billPickerEl('div', 'bill-picker-history');
    const title = _billPickerEl('div', 'bill-picker-section-title');
    section.appendChild(title);

    if (state.historyError) {
      title.textContent = 'Payments';
      section.appendChild(_billPickerEl('div', 'bill-picker-muted', state.historyError));
      return section;
    }
    if (!state.history) {
      title.textContent = 'Payments';
      section.appendChild(_billPickerEl('div', 'bill-picker-muted', 'Loading payments…'));
      return section;
    }

    const count = Number(state.history.payment_count || 0);
    const recent = Array.isArray(state.history.recent_payments) ? state.history.recent_payments : [];
    title.textContent = count === 0
      ? 'No payments yet'
      : `${_billPickerCount(count, 'payment', 'payments')} so far${recent.length < count ? `, latest ${recent.length}` : ''}`;

    if (recent.length > 0) {
      const paymentList = _billPickerEl('ul', 'bill-picker-payments');
      recent.forEach((payment) => {
        const item = _billPickerEl('li', 'bill-picker-payment');
        item.appendChild(_billPickerEl('span', 'bill-picker-payment-date', billPickerDate(payment.date)));
        const nameCell = _billPickerEl('span', 'bill-picker-payment-name', payment.name || '');
        if (payment.bill_attached_by_hand) {
          nameCell.appendChild(_billPickerEl('span', 'bill-picker-tag bill-picker-tag-hand', 'Added by hand'));
        }
        item.appendChild(nameCell);
        item.appendChild(_billPickerEl('span', 'bill-picker-payment-account', payment.account_name || ''));
        item.appendChild(_billPickerEl('span', 'bill-picker-payment-amount', billPickerMoney(payment.amount)));
        paymentList.appendChild(item);
      });
      section.appendChild(paymentList);
    }
    return section;
  }

  function renderComparison(bill) {
    const section = _billPickerEl('div', 'bill-picker-compare');
    section.appendChild(_billPickerEl('div', 'bill-picker-section-title', 'Being added'));
    const comparison = billPickerComparison(bill, rows, accountNameFor);
    section.appendChild(_billPickerEl('div', 'bill-picker-compare-line', comparison.countLine));
    if (comparison.amountLine) {
      section.appendChild(_billPickerEl('div', 'bill-picker-compare-line', comparison.amountLine));
    }
    if (comparison.warnings.length === 0) {
      section.appendChild(_billPickerEl('div', 'bill-picker-compare-ok', 'Amount, direction and account all match the bill.'));
    } else {
      const warningList = _billPickerEl('ul', 'bill-picker-warnings');
      comparison.warnings.forEach((warning) => {
        warningList.appendChild(_billPickerEl('li', 'bill-picker-warning', warning));
      });
      section.appendChild(warningList);
    }
    return section;
  }

  function setOpen(shouldOpen) {
    state.isOpen = shouldOpen && state.loaded && state.bills.length > 0;
    panel.classList.toggle('hidden', !state.isOpen);
    trigger.setAttribute('aria-expanded', state.isOpen ? 'true' : 'false');
    root.classList.toggle('is-open', state.isOpen);
    if (state.isOpen) {
      search.value = '';
      state.activeIndex = -1;
      renderList();
      search.focus();
    }
  }

  async function loadHistory(billId) {
    state.detailRequest += 1;
    const requestNumber = state.detailRequest;
    state.history = null;
    state.historyError = '';
    try {
      const fullBill = await fetchBill(billId);
      if (requestNumber !== state.detailRequest) return;
      state.history = {
        payment_count: fullBill.payment_count,
        recent_payments: fullBill.recent_payments,
      };
    } catch (historyError) {
      if (requestNumber !== state.detailRequest) return;
      state.historyError = `Payments could not be loaded: ${historyError.message}`;
    }
    renderDetails();
  }

  function choose(billId) {
    const line = state.lines.find((candidate) => candidate.billId === billId);
    if (!line || line.disabled) return;
    state.selectedId = billId;
    setOpen(false);
    renderTrigger();
    renderDetails();
    trigger.focus();
    onChange(selectedBill());
    loadHistory(billId);
  }

  function moveActive(step) {
    const enabledIndexes = state.shownLines
      .map((line, index) => (line.disabled ? -1 : index))
      .filter((index) => index >= 0);
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(state.activeIndex);
    let nextPosition = position + step;
    if (position === -1) nextPosition = step > 0 ? 0 : enabledIndexes.length - 1;
    nextPosition = Math.max(0, Math.min(enabledIndexes.length - 1, nextPosition));
    state.activeIndex = enabledIndexes[nextPosition];
    renderList();
    const activeItem = list.querySelector('.bill-picker-option.is-active');
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }

  trigger.addEventListener('click', () => setOpen(!state.isOpen));
  search.addEventListener('input', () => {
    state.activeIndex = -1;
    renderList();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const line = state.shownLines[state.activeIndex];
      if (line) choose(line.billId);
    } else if (event.key === 'Escape') {
      // Close the list only; the modal around it stays open.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.focus();
    }
  });
  list.addEventListener('click', (event) => {
    const item = event.target.closest('.bill-picker-option');
    if (!item || item.classList.contains('is-disabled')) return;
    choose(item.dataset.billId);
  });

  fetchBills()
    .then((bills) => {
      state.bills = billPickerSortBills(bills);
      state.lines = state.bills.map(billPickerOptionLine);
      state.loaded = true;
      renderTrigger();
    })
    .catch((loadError) => {
      state.loadError = loadError.message || 'Bills could not be loaded';
      renderTrigger();
      details.classList.remove('hidden');
      details.innerHTML = '';
      details.appendChild(_billPickerEl('div', 'bill-picker-error', `Bills could not be loaded: ${state.loadError}`));
    });

  renderTrigger();

  return {
    getSelectedBillId: () => state.selectedId,
    getSelectedBill: selectedBill,
    isOpen: () => state.isOpen,
    focus: () => trigger.focus(),
  };
}
