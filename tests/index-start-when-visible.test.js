const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mainPath = path.join(__dirname, '..', 'index', 'main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');

function loadStartWhenVisible() {
  const ignoresListeners = { addEventListener: () => {} };
  const sandbox = {
    module: { exports: {} },
    console,
    window: ignoresListeners,
    document: ignoresListeners,
  };
  vm.runInNewContext(
    `${mainSource}\nmodule.exports = { _startWhenVisible };`,
    sandbox,
    { filename: mainPath },
  );
  return sandbox.module.exports._startWhenVisible;
}

/** A document stand-in whose visibility the test changes. */
function fakeDocument(visibilityState) {
  const listeners = new Set();
  return {
    visibilityState,
    addEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
    becomes(nextState) {
      this.visibilityState = nextState;
      [...listeners].forEach(listener => listener());
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

const _startWhenVisible = loadStartWhenVisible();

test('a visible page starts at once', () => {
  const doc = fakeDocument('visible');
  let starts = 0;
  _startWhenVisible(doc, () => { starts += 1; });
  assert.equal(starts, 1);
  assert.equal(doc.listenerCount(), 0);
});

test('a hidden page waits until it is first shown, then starts only once', () => {
  const doc = fakeDocument('hidden');
  let starts = 0;
  _startWhenVisible(doc, () => { starts += 1; });
  assert.equal(starts, 0);

  doc.becomes('hidden');
  assert.equal(starts, 0);

  doc.becomes('visible');
  assert.equal(starts, 1);

  doc.becomes('hidden');
  doc.becomes('visible');
  assert.equal(starts, 1);
  assert.equal(doc.listenerCount(), 0);
});
