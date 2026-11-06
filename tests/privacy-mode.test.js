const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relPaths, exportsList, extraSandbox = {}) {
  const files = Array.isArray(relPaths) ? relPaths : [relPaths];
  const source = files
    .map(relPath => fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'))
    .join('\n');
  const sandbox = { module: { exports: {} }, console, ...extraSandbox };
  vm.runInNewContext(`${source}\nmodule.exports = { ${exportsList} };`, sandbox);
  return sandbox.module.exports;
}

function loadPrivacy(config, extra = {}) {
  return load('transactions/privacy.js', [
    'isPrivacyModeOn', 'maskMoney', 'initPrivacyMode', 'togglePrivacyMode',
    'privacyToggleButtonHtml', 'isPrivacyByDefault',
  ].join(', '), { getAppConfig: () => config, ...extra });
}

test('off by default: money passes through untouched', () => {
  const P = loadPrivacy({});
  P.initPrivacyMode();
  assert.equal(P.isPrivacyModeOn(), false);
  assert.equal(P.maskMoney('$1,234'), '$1,234');
  assert.equal(P.maskMoney('-$12.50'), '-$12.50');
});

test('the saved default turns privacy on at load', () => {
  const P = loadPrivacy({ transactionsPrivacyByDefault: true });
  P.initPrivacyMode();
  assert.equal(P.isPrivacyModeOn(), true);
  assert.equal(P.maskMoney('$600,000'), '$**.**');
  assert.equal(P.isPrivacyByDefault(), true);
});

test('a non-boolean default never masks', () => {
  const P = loadPrivacy({ transactionsPrivacyByDefault: 'true' });
  P.initPrivacyMode();
  assert.equal(P.isPrivacyModeOn(), false);
});

test('toggle flips the mode and redraws the sidebar, indicator and insights', () => {
  const calls = [];
  const P = loadPrivacy({}, {
    renderAccountsSidebar: () => calls.push('sidebar'),
    updatePlaidBalanceIndicator: () => calls.push('indicator'),
    renderInsightsPanel: () => calls.push('insights'),
  });
  P.initPrivacyMode();
  P.togglePrivacyMode();
  assert.equal(P.isPrivacyModeOn(), true);
  assert.deepEqual(calls, ['sidebar', 'indicator', 'insights']);
  P.togglePrivacyMode();
  assert.equal(P.isPrivacyModeOn(), false);
  assert.equal(P.maskMoney('$5'), '$5');
});

test('the button reflects the mode', () => {
  const P = loadPrivacy({});
  P.initPrivacyMode();
  assert.match(P.privacyToggleButtonHtml(), /Hide balances/);
  assert.match(P.privacyToggleButtonHtml(), /aria-pressed="false"/);
  P.togglePrivacyMode();
  assert.match(P.privacyToggleButtonHtml(), /Show balances/);
  assert.match(P.privacyToggleButtonHtml(), / active/);
});

test('insight cards mask their totals, averages and in/out lines', () => {
  const I = load(['transactions/privacy.js', 'transactions/analytics.js', 'transactions/insights.js'], [
    'initPrivacyMode', 'togglePrivacyMode',
    '_buildTotalSpendingInsight', '_buildInsightCardInsight', '_buildLiveLedgerInsight',
  ].join(', '), {
    getAppConfig: () => ({ transactionsPrivacyByDefault: true }),
    escapeHtml: (s) => s,
    document: { body: { dataset: {} }, getElementById: () => null },
  });
  const spending = { amount: -40, analytics_class: 'spending', primary_category: 'Food', detailed_category: 'Coffee' };
  const income = { amount: 100, analytics_class: 'income', primary_category: 'Income', detailed_category: 'Pay' };
  const view = {
    spendingEntries: [spending],
    trackableEntries: [spending, income],
    ledgerEntries: [spending, income],
  };
  const mixedCard = { name: 'Mixed', primaries: ['food', 'income'], details: [] };

  I.initPrivacyMode();
  const cards = [
    I._buildTotalSpendingInsight(view),
    I._buildInsightCardInsight(mixedCard, view),
    I._buildLiveLedgerInsight(view),
  ];
  for (const card of cards) {
    assert.equal(card.value, '$**.**', card.label);
    const lines = Array.isArray(card.subtext) ? card.subtext : [card.subtext];
    for (const line of lines) assert.doesNotMatch(String(line), /\$\d/, `${card.label}: ${line}`);
  }

  I.togglePrivacyMode();
  assert.equal(I._buildTotalSpendingInsight(view).value, '$40.00');
  assert.match(I._buildInsightCardInsight(mixedCard, view).value, /\$\d/);
  assert.equal(I._buildLiveLedgerInsight(view).value, '$60.00');
});
