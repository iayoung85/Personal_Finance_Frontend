const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const statePath = path.join(__dirname, '..', 'index', 'state.js');
const stateSource = fs.readFileSync(statePath, 'utf8');

function loadState(storedValues = {}) {
  const storage = new Map(Object.entries(storedValues));
  const sandbox = {
    module: { exports: {} },
    console,
    Date,
    JSON,
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
  };
  vm.runInNewContext(
    `${stateSource}\nmodule.exports = { _trackPageOpen, IndexState, PAGE_OPEN_LIMIT, PAGE_OPEN_WINDOW_MS };`,
    sandbox,
    { filename: statePath },
  );
  return { ...sandbox.module.exports, storage };
}

const { _trackPageOpen, PAGE_OPEN_LIMIT, PAGE_OPEN_WINDOW_MS } = loadState();

test('a first open is not too often', () => {
  const result = _trackPageOpen([], 1_000_000);
  assert.deepEqual([...result.opens], [1_000_000]);
  assert.equal(result.tooOften, false);
});

test('opens up to the limit inside the window load normally', () => {
  let opens = [];
  let tooOften = false;
  for (let i = 0; i < PAGE_OPEN_LIMIT; i += 1) {
    ({ opens, tooOften } = _trackPageOpen(opens, 1_000_000 + i * 100));
  }
  assert.equal(tooOften, false);
});

test('one open past the limit inside the window is too often', () => {
  let opens = [];
  let tooOften = false;
  for (let i = 0; i <= PAGE_OPEN_LIMIT; i += 1) {
    ({ opens, tooOften } = _trackPageOpen(opens, 1_000_000 + i * 400));
  }
  assert.equal(tooOften, true);
});

test('opens older than the window are dropped and do not count', () => {
  const now = 1_000_000;
  const oldOpens = Array.from({ length: 10 }, (_, i) => now - PAGE_OPEN_WINDOW_MS - i);
  const result = _trackPageOpen(oldOpens, now);
  assert.deepEqual([...result.opens], [now]);
  assert.equal(result.tooOften, false);
});

test('malformed stored values are ignored', () => {
  const now = 1_000_000;
  assert.deepEqual([..._trackPageOpen(null, now).opens], [now]);
  assert.deepEqual([..._trackPageOpen({}, now).opens], [now]);
  assert.deepEqual([..._trackPageOpen(['x', now + 5000, now - 1], now).opens], [now - 1, now]);
});

test('recordPageOpen survives unreadable storage and pauses a loop', () => {
  const broken = loadState({ index_page_opens: 'not json' });
  assert.equal(broken.IndexState.recordPageOpen(), false);

  const looping = loadState();
  let paused = false;
  for (let i = 0; i <= PAGE_OPEN_LIMIT; i += 1) {
    paused = looping.IndexState.recordPageOpen();
  }
  assert.equal(paused, true);
  assert.ok(JSON.parse(looping.storage.get('index_page_opens')).length > PAGE_OPEN_LIMIT);
});
