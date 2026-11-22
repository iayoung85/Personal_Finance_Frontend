const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'nav-sidebar.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function loadNav(hash = '') {
  const sandbox = {
    module: { exports: {} },
    window: { location: { hash, pathname: '/x.html' } },
    document: { addEventListener() {}, body: { getAttribute: () => null } },
  };
  vm.runInNewContext(
    `${source}\nmodule.exports = { NAV_SIDEBAR_ITEMS, NAV_SIDEBAR_FOOTER_ITEMS, _buildNavLink };`,
    sandbox,
    { filename: sourcePath },
  );
  return sandbox.module.exports;
}

function navItem(nav, id) {
  return [...nav.NAV_SIDEBAR_ITEMS, ...nav.NAV_SIDEBAR_FOOTER_ITEMS].find(item => item.id === id);
}

test('the Budget row is a link to the report, not a toggle', () => {
  const nav = loadNav();
  const html = nav._buildNavLink(navItem(nav, 'budget'), 'transactions');
  const parentLink = html.match(/<a [^>]*data-nav-id="budget"[^>]*>/)[0];
  assert.match(parentLink, /href="budget\.html"/);
  assert.doesNotMatch(parentLink, /data-has-children/);
  assert.doesNotMatch(html, /nav-chevron/);
});

test('the Targets link always shows under Budget, from any page', () => {
  const nav = loadNav();
  const html = nav._buildNavLink(navItem(nav, 'budget'), 'bills');
  assert.match(html, /<ul class="nav-sidebar-subnav expanded">/);
  assert.match(html, /data-nav-id="budget-targets"[^>]*href="budget\.html#targets"/);
});

test('on the Budget page the row is active and Targets lights up on its panel', () => {
  const onReport = loadNav('');
  const reportHtml = onReport._buildNavLink(navItem(onReport, 'budget'), 'budget');
  assert.match(reportHtml, /class="nav-sidebar-link nav-sidebar-link-open active"/);
  assert.doesNotMatch(reportHtml, /class="nav-sidebar-link active" data-nav-id="budget-targets"/);

  const onTargets = loadNav('#targets');
  const targetsHtml = onTargets._buildNavLink(navItem(onTargets, 'budget'), 'budget');
  assert.match(targetsHtml, /class="nav-sidebar-link active" data-nav-id="budget-targets"/);
});

test('rows with children elsewhere still only expand', () => {
  const nav = loadNav();
  for (const id of ['categories', 'user-settings']) {
    const html = nav._buildNavLink(navItem(nav, id), 'transactions');
    const parentLink = html.match(new RegExp(`<a [^>]*data-nav-id="${id}"[^>]*>`))[0];
    assert.match(parentLink, /data-has-children="true"/);
    assert.doesNotMatch(parentLink, /href=/);
    assert.match(html, /nav-chevron/);
    assert.match(html, /<ul class="nav-sidebar-subnav">/);
  }
});
