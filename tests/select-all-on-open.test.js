const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helperPath = path.join(__dirname, '..', 'shared', 'categories-autocomplete.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function loadHelpers() {
  const sandbox = { console, localStorage: {}, window: {} };
  vm.runInNewContext(helperSource, sandbox, { filename: helperPath });
  return sandbox;
}

/** A text input with a selection range and listener bookkeeping. */
function fakeInput(value) {
  const listeners = {};
  const input = {
    value,
    selectionStart: value.length,
    selectionEnd: value.length,
    select() { input.selectionStart = 0; input.selectionEnd = input.value.length; },
    setSelectionRange(start, end) { input.selectionStart = start; input.selectionEnd = end; },
    addEventListener(name, listener) { listeners[name] = listener; },
    removeEventListener(name, listener) { if (listeners[name] === listener) delete listeners[name]; },
    listeners,
  };
  return input;
}

test('opening selects the whole value so typing replaces it', () => {
  const { selectAllOnOpen } = loadHelpers();
  const input = fakeInput('Groceries');
  selectAllOnOpen(input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 9]);
});

test('the next mousedown collapses the selection so the click can place a caret', () => {
  const { selectAllOnOpen } = loadHelpers();
  const input = fakeInput('Groceries');
  selectAllOnOpen(input);

  input.listeners.mousedown();
  assert.equal(input.selectionStart, input.selectionEnd);
  assert.equal('mousedown' in input.listeners, false);
});

test('a selection the user already narrowed is left alone', () => {
  const { selectAllOnOpen } = loadHelpers();
  const input = fakeInput('Groceries');
  selectAllOnOpen(input);
  input.setSelectionRange(2, 5);

  input.listeners.mousedown();
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 5]);
});

test('blur removes the listeners', () => {
  const { selectAllOnOpen } = loadHelpers();
  const input = fakeInput('Groceries');
  selectAllOnOpen(input);
  input.listeners.blur();
  assert.deepEqual(Object.keys(input.listeners), []);
});

test('an empty value or an input without a text selection is not treated as selected', () => {
  const { isWholeValueSelected } = loadHelpers();
  assert.equal(isWholeValueSelected(fakeInput('')), false);
  assert.equal(isWholeValueSelected({ value: '12', selectionStart: null, selectionEnd: null }), false);
  assert.equal(isWholeValueSelected({ value: '12', selectionStart: 0, selectionEnd: 2 }), true);
});
