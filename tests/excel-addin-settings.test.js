// The settings page's Excel add-in panel: which manifest it offers, and that
// the section is reachable from the sidebar and the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadPanel() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${read('user-settings/excel-addin.js')}\nthis.api = { excelManifestForBackend, buildExcelAddinHtml };`,
    sandbox,
  );
  return sandbox.api;
}

test('the live site offers the live manifest', () => {
  const { excelManifestForBackend } = loadPanel();
  const manifest = excelManifestForBackend(false);
  assert.equal(manifest.href, 'excel/manifest.xml');
  assert.equal(manifest.addinName, 'IAY Financial');
  assert.equal(manifest.isDev, false);
});

test('the dev API offers the dev manifest and says so', () => {
  const { excelManifestForBackend, buildExcelAddinHtml } = loadPanel();
  const manifest = excelManifestForBackend(true);
  assert.equal(manifest.href, 'excel/manifest-dev.xml');
  const html = buildExcelAddinHtml(manifest);
  assert.match(html, /href="excel\/manifest-dev\.xml" download="IAY-Financial-dev-manifest\.xml"/);
  assert.match(html, /You are on the dev API/);
  assert.match(html, /IAY Financial \(dev\)/);
});

test('the live panel has no dev note and names the live add-in in both sets of steps', () => {
  const { excelManifestForBackend, buildExcelAddinHtml } = loadPanel();
  const html = buildExcelAddinHtml(excelManifestForBackend(false));
  assert.doesNotMatch(html, /dev API/);
  assert.equal(html.match(/<strong>IAY Financial<\/strong>/g).length, 2);
  assert.match(html, /\\\\YOUR-PC\\addins/);
});

test('each offered manifest file exists and names the add-in the panel names', () => {
  const { excelManifestForBackend } = loadPanel();
  for (const onDev of [false, true]) {
    const manifest = excelManifestForBackend(onDev);
    const xml = read(manifest.href);
    assert.ok(xml.includes(`<DisplayName DefaultValue="${manifest.addinName}"/>`), manifest.href);
  }
});

test('the section is wired into the sidebar, the page and the dispatcher', () => {
  assert.match(read('nav-sidebar.js'), /section: 'excel-addin'/);
  const page = read('user-settings.html');
  assert.match(page, /<div id="excel-addin" class="settings-panel hidden">/);
  assert.match(page, /<div id="excel-addin-content">/);
  assert.ok(page.indexOf('user-settings/excel-addin.js') < page.indexOf('user-settings/main.js'));
  const nav = read('user-settings/nav.js');
  assert.match(nav, /validSections = \[[^\]]*'excel-addin'/);
  assert.match(nav, /case 'excel-addin':\s+loadExcelAddinSettings\(\);/);
});
