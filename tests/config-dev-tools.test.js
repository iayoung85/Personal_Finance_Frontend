const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// config.js against the dev API: every page loads dev-tools.js, except one
// whose config.js tag asks it not to (the Excel panel).

const configPath = path.join(__dirname, '..', 'config.js');

async function loadConfigOnDev(scriptAttributes) {
  const appended = [];
  const store = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: key => (key in store ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value); },
      removeItem: key => { delete store[key]; },
    },
    location: { search: '', hostname: 'localhost' },
    document: {
      currentScript: { hasAttribute: name => scriptAttributes.includes(name) },
      createElement: () => ({}),
      body: { appendChild: element => appended.push(element) },
    },
    fetch: async () => ({ ok: true }),
    URLSearchParams,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(configPath, 'utf8'), sandbox, { filename: configPath });
  const url = await sandbox.BACKEND_URL_PROMISE;
  return { url, appended, autoLogin: sandbox.LOCAL_AUTO_LOGIN_ENABLED };
}

test('a web page on the dev API still loads dev-tools.js', async () => {
  const { url, appended, autoLogin } = await loadConfigOnDev([]);
  assert.equal(url, 'http://localhost:5501');
  assert.equal(autoLogin, true);
  assert.deepEqual(appended.map(element => element.src), ['dev-tools.js']);
});

test('a page that asks for no dev tools gets the dev session but no dev-tools.js request', async () => {
  const { appended, autoLogin } = await loadConfigOnDev(['data-no-dev-tools']);
  assert.equal(autoLogin, true);
  assert.equal(appended.length, 0);
});
