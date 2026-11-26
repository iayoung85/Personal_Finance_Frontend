const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'nav-sidebar.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadNav() {
  const sandbox = {
    module: { exports: {} },
    window: { location: { hash: '', pathname: '/x.html' } },
    document: { addEventListener() {}, body: { getAttribute: () => null } },
  };
  vm.runInNewContext(
    `${source}\nmodule.exports = { countBadgeText, buildCountBadge, readNavCounts, catchAllTransactionsHref, navCountsNeedAttention, navOpenFromWidth, navModeForWidth };`,
    sandbox,
    { filename: sourcePath },
  );
  return sandbox.module.exports;
}

const nav = loadNav();
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a count shows only when it is above zero', () => {
  assert.equal(nav.countBadgeText(0), '');
  assert.equal(nav.countBadgeText(-2), '');
  assert.equal(nav.countBadgeText(undefined), '');
  assert.equal(nav.countBadgeText('x'), '');
  assert.equal(nav.countBadgeText(1), '1');
  assert.equal(nav.countBadgeText(42.7), '42');
});

test('a large count is capped so it fits the nav', () => {
  assert.equal(nav.countBadgeText(999), '999');
  assert.equal(nav.countBadgeText(1000), '999+');
});

test('a badge is a span, or a link when it has somewhere to go, and nothing at zero', () => {
  assert.equal(nav.buildCountBadge(0, { title: 'x' }), '');
  assert.equal(nav.buildCountBadge(2, { className: 'count-badge-alert' }), '<span class="count-badge count-badge-alert">2</span>');
  const link = nav.buildCountBadge(5, { href: 'transactions.html?category=A%20%22B%22', title: '5 in "A"' });
  assert.match(link, /^<a class="count-badge" href="transactions\.html\?category=A%20%22B%22"/);
  assert.match(link, /title="5 in &quot;A&quot;"/);
  assert.match(link, />5<\/a>$/);
});

test('the counts response is read with anything malformed as zero', () => {
  assert.deepEqual(plain(nav.readNavCounts({
    unanswered_count: 2, catch_all_label: 'Uncategorized: Uncategorized', catch_all_transactions: 42,
  })), { unansweredCount: 2, catchAllLabel: 'Uncategorized: Uncategorized', catchAllTransactions: 42 });
  assert.deepEqual(plain(nav.readNavCounts({ unanswered_count: 'a', catch_all_label: 7, catch_all_transactions: -1 })),
    { unansweredCount: 0, catchAllLabel: '', catchAllTransactions: 0 });
  assert.deepEqual(plain(nav.readNavCounts(null)), { unansweredCount: 0, catchAllLabel: '', catchAllTransactions: 0 });
});

test('the catch-all count links to the transactions page filtered to that label', () => {
  assert.equal(nav.catchAllTransactionsHref('Uncategorized: Uncategorized'),
    'transactions.html?category=Uncategorized%3A%20Uncategorized');
});

test('the hamburger carries its dot when either count shows', () => {
  assert.equal(nav.navCountsNeedAttention(null), false);
  assert.equal(nav.navCountsNeedAttention({ unansweredCount: 0, catchAllLabel: 'U: U', catchAllTransactions: 0 }), false);
  assert.equal(nav.navCountsNeedAttention({ unansweredCount: 1, catchAllLabel: '', catchAllTransactions: 0 }), true);
  assert.equal(nav.navCountsNeedAttention({ unansweredCount: 0, catchAllLabel: 'U: U', catchAllTransactions: 3 }), true);
  // Without a label there is no catch-all badge, so no dot for it either.
  assert.equal(nav.navCountsNeedAttention({ unansweredCount: 0, catchAllLabel: '', catchAllTransactions: 3 }), false);
});

test('a page without an open-from width keeps its declared mode', () => {
  assert.equal(nav.navOpenFromWidth(null), 0);
  assert.equal(nav.navOpenFromWidth(''), 0);
  assert.equal(nav.navOpenFromWidth('-5'), 0);
  assert.equal(nav.navOpenFromWidth('1511'), 1511);
});

test('the nav stays open from the page width up and collapses below it', () => {
  assert.equal(nav.navModeForWidth(1511, 1920), 'persistent');
  assert.equal(nav.navModeForWidth(1511, 1511), 'persistent');
  assert.equal(nav.navModeForWidth(1511, 1510), 'collapsed');
  assert.equal(nav.navModeForWidth(1690, 1600), 'collapsed');
});

test('the two pages that switch by width declare it on their body', () => {
  const root = path.join(__dirname, '..');
  for (const page of ['transactions', 'investments']) {
    const html = fs.readFileSync(path.join(root, `${page}.html`), 'utf8');
    const body = html.match(/<body [^>]*>/)[0];
    assert.match(body, /data-nav-mode="collapsed"/);
    assert.match(body, /data-nav-open-from="\d+"/);
  }
});
