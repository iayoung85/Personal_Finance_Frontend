const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = relPath => fs.readFileSync(path.join(root, relPath), 'utf8');

// Results cross the vm boundary, so compare through JSON.
const plain = value => JSON.parse(JSON.stringify(value));

function loadLink() {
  const sandbox = { module: { exports: {} }, URLSearchParams };
  vm.runInNewContext(
    `${read('shared/budget-alert-link.js')}\nmodule.exports = { buildSetAlertAddress, readAlertPrefill, searchWithoutAlertPrefill };`,
    sandbox,
    { filename: 'shared/budget-alert-link.js' },
  );
  return sandbox.module.exports;
}

const { buildSetAlertAddress, readAlertPrefill, searchWithoutAlertPrefill } = loadLink();

const searchOf = address => address.slice(address.indexOf('?'));

test('a monthly target makes a monthly alert address', () => {
  const address = buildSetAlertAddress(
    { category: 'Food And Drink: Dining', cadence: 'monthly', amount: '600' }, 11);
  assert.equal(address,
    'spending-alerts.html?new_alert=1&category=Food+And+Drink%3A+Dining&amount=600.00&period=monthly');
});

test('an annual target makes a yearly alert that resets on day 1 of the fiscal start month', () => {
  const address = buildSetAlertAddress(
    { category: 'Annual: Insurance', cadence: 'annual', amount: 1234.5 }, 11);
  assert.equal(address,
    'spending-alerts.html?new_alert=1&category=Annual%3A+Insurance&amount=1234.50&period=yearly&reset_month=11&reset_day=1');
});

test('no address for a target that cannot make an alert', () => {
  assert.equal(buildSetAlertAddress({ category: 'Travel: Flights', cadence: 'monthly', amount: '' }, 1), null);
  assert.equal(buildSetAlertAddress({ category: 'Travel: Flights', cadence: 'weekly', amount: '5' }, 1), null);
  assert.equal(buildSetAlertAddress({ category: ' ', cadence: 'monthly', amount: '5' }, 1), null);
});

test('a backend override on this page is carried to the new tab', () => {
  const address = buildSetAlertAddress(
    { category: 'Travel: Flights', cadence: 'monthly', amount: '5' }, 1, '?backend=http://127.0.0.1:5501');
  assert.match(address, /&backend=http%3A%2F%2F127\.0\.0\.1%3A5501$/);
});

test('the alert form reads back what the address carries', () => {
  const monthly = buildSetAlertAddress(
    { category: 'Food And Drink: Dining', cadence: 'monthly', amount: '600' }, 11);
  assert.deepEqual(plain(readAlertPrefill(searchOf(monthly))), {
    category: 'Food And Drink: Dining', amount: '600.00', period: 'monthly', resetMonth: null, resetDay: null,
  });

  const annual = buildSetAlertAddress(
    { category: 'Annual: Insurance', cadence: 'annual', amount: '1200' }, 11);
  assert.deepEqual(plain(readAlertPrefill(searchOf(annual))), {
    category: 'Annual: Insurance', amount: '1200.00', period: 'yearly', resetMonth: 11, resetDay: 1,
  });
});

test('an address with nothing for the form asks for nothing', () => {
  assert.equal(readAlertPrefill(''), null);
  assert.equal(readAlertPrefill('?backend=http://127.0.0.1:5501'), null);
  assert.equal(readAlertPrefill('?category=Travel%3A+Flights'), null);
  assert.equal(readAlertPrefill('?new_alert=1'), null);
});

test('bad values in the address fall back instead of reaching the form', () => {
  const prefill = plain(readAlertPrefill(
    '?new_alert=1&category=Travel%3A+Flights&amount=-5&period=yearly&reset_month=13&reset_day=x'));
  assert.deepEqual(prefill, {
    category: 'Travel: Flights', amount: '', period: 'yearly', resetMonth: 1, resetDay: 1,
  });
  assert.equal(readAlertPrefill('?new_alert=1&category=A%3A+B&period=daily').period, 'monthly');
});

test('removing the prefill keeps the other parameters', () => {
  assert.equal(searchWithoutAlertPrefill('?new_alert=1&category=A&amount=1&period=yearly&reset_month=2&reset_day=1'), '');
  assert.equal(searchWithoutAlertPrefill('?new_alert=1&category=A&backend=x'), '?backend=x');
});

// ── The Spending Alerts page ────────────────────────────────

function fakeElement() {
  const classes = new Set();
  return {
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    focused: false,
    style: {},
    classList: {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
    },
    focus() { this.focused = true; },
    addEventListener() {},
  };
}

function loadSpendingAlertsPage(search) {
  const elements = {};
  const getElementById = id => {
    if (!elements[id]) elements[id] = fakeElement();
    return elements[id];
  };
  getElementById('sa-modal-overlay').classList.add('hidden');
  const replaced = [];
  const window = {
    LOCAL_AUTO_LOGIN_ENABLED: false,
    location: { search, pathname: '/spending-alerts.html', hash: '', href: '' },
  };
  const sandbox = {
    module: { exports: {} },
    console,
    URLSearchParams,
    window,
    history: { replaceState: (_state, _title, address) => replaced.push(address) },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      getElementById,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener() {},
    },
    wireUpCategoryAutocomplete() {},
  };
  vm.runInNewContext(
    `${read('shared/budget-alert-link.js')}\n${read('spending-alerts.js')}\n`
      + 'module.exports = { _openPrefilledAlertFromAddress };',
    sandbox,
    { filename: 'spending-alerts.js' },
  );
  return { page: sandbox.module.exports, elements, replaced };
}

test('Spending Alerts opens its create form filled in from a yearly address', () => {
  const address = buildSetAlertAddress(
    { category: 'Annual: Insurance', cadence: 'annual', amount: '1200' }, 11, '?backend=x');
  const { page, elements, replaced } = loadSpendingAlertsPage(searchOf(address));
  page._openPrefilledAlertFromAddress();

  assert.equal(elements['sa-modal-overlay'].classList.contains('hidden'), false);
  assert.equal(elements['sa-category'].value, 'Annual: Insurance');
  assert.equal(elements['sa-threshold'].value, '1200.00');
  assert.equal(elements['sa-period'].value, 'yearly');
  assert.equal(elements['sa-yearly-month'].value, 11);
  assert.equal(elements['sa-yearly-day'].value, 1);
  assert.equal(elements['sa-recipients'].focused, true);
  // A reload shows the page as usual; the backend override stays.
  assert.deepEqual(replaced, ['/spending-alerts.html?backend=x']);
});

test('Spending Alerts opens as it always has when the address carries nothing', () => {
  const { page, elements, replaced } = loadSpendingAlertsPage('');
  page._openPrefilledAlertFromAddress();
  assert.equal(elements['sa-modal-overlay'].classList.contains('hidden'), true);
  assert.equal(elements['sa-category'] === undefined || elements['sa-category'].value === '', true);
  assert.deepEqual(replaced, []);
});
