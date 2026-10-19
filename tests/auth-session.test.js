const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sessionPath = path.join(__dirname, '..', 'shared', 'auth-session.js');
const sessionSource = fs.readFileSync(sessionPath, 'utf8');

function mapStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * Load a fresh copy of the shared session script.
 * @param {Object} storedValues - Starting localStorage contents.
 * @param {Function} respond - Answers the refresh request: returns a response or throws.
 */
function loadAuthSession(storedValues, respond) {
  const localStorage = mapStorage(storedValues);
  const navigations = [];
  const refreshRequests = [];
  const sandbox = {
    module: { exports: {} },
    console: { error: () => {} },
    BACKEND_URL: 'https://api.example.test',
    localStorage,
    sessionStorage: mapStorage(),
    window: { location: { set href(url) { navigations.push(url); } } },
    fetch: async (url, options) => {
      refreshRequests.push({ url, body: JSON.parse(options.body) });
      await new Promise(resolve => setImmediate(resolve));
      return respond();
    },
  };
  vm.runInNewContext(
    `${sessionSource}\nmodule.exports = { renewSessionAfter401, takeSessionExpiredNotice };`,
    sandbox,
    { filename: sessionPath },
  );
  return { ...sandbox.module.exports, localStorage, navigations, refreshRequests };
}

const signedIn = { authToken: 'old-access', refreshToken: 'old-refresh', currentUser: '{"id":1}' };
const refusesToRefresh = () => { throw new Error('no refresh expected'); };

test('requests that fail together share one refresh request', async () => {
  const session = loadAuthSession(signedIn, () => jsonResponse(200, { access_token: 'new-access', refresh_token: 'new-refresh' }));

  const renewedTokens = await Promise.all([
    session.renewSessionAfter401('old-access'),
    session.renewSessionAfter401('old-access'),
  ]);

  assert.deepEqual(renewedTokens, ['new-access', 'new-access']);
  assert.equal(session.refreshRequests.length, 1);
  assert.equal(session.refreshRequests[0].url, 'https://api.example.test/api/auth/refresh');
  assert.equal(session.refreshRequests[0].body.refresh_token, 'old-refresh');
  assert.equal(session.localStorage.getItem('authToken'), 'new-access');
  assert.equal(session.localStorage.getItem('refreshToken'), 'new-refresh');
});

test('a token renewed after the request went out is reused without refreshing', async () => {
  const session = loadAuthSession({ ...signedIn, authToken: 'newer-access' }, refusesToRefresh);

  assert.equal(await session.renewSessionAfter401('old-access'), 'newer-access');
  assert.equal(session.refreshRequests.length, 0);
});

test('a refused refresh signs out once and tells the login screen why', async () => {
  const session = loadAuthSession(signedIn, () => jsonResponse(401, { error: 'Refresh token expired' }));

  const renewedTokens = await Promise.all([
    session.renewSessionAfter401('old-access'),
    session.renewSessionAfter401('old-access'),
  ]);

  assert.deepEqual(renewedTokens, [null, null]);
  assert.equal(session.localStorage.getItem('authToken'), null);
  assert.equal(session.localStorage.getItem('refreshToken'), null);
  assert.equal(session.localStorage.getItem('currentUser'), null);
  assert.deepEqual(session.navigations, ['index.html']);
  assert.equal(session.takeSessionExpiredNotice(), true);
  assert.equal(session.takeSessionExpiredNotice(), false);
});

test('an unreachable API keeps the session', async () => {
  const networkFailure = () => { throw new TypeError('Failed to fetch'); };
  const serverRestarting = () => jsonResponse(503, {});

  for (const respond of [networkFailure, serverRestarting]) {
    const session = loadAuthSession(signedIn, respond);
    assert.equal(await session.renewSessionAfter401('old-access'), null);
    assert.equal(session.localStorage.getItem('refreshToken'), 'old-refresh');
    assert.deepEqual(session.navigations, []);
    assert.equal(session.takeSessionExpiredNotice(), false);
  }
});

test('a missing refresh token signs out without asking the API', async () => {
  const session = loadAuthSession({ authToken: 'old-access' }, refusesToRefresh);

  assert.equal(await session.renewSessionAfter401('old-access'), null);
  assert.equal(session.refreshRequests.length, 0);
  assert.deepEqual(session.navigations, ['index.html']);
});
