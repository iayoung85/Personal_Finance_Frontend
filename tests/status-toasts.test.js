const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const utilsPath = path.join(__dirname, '..', 'transactions', 'utils.js');
const utilsSource = fs.readFileSync(utilsPath, 'utf8');

function fakeElement() {
  return {
    className: '',
    textContent: '',
    children: [],
    parent: null,
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter(sibling => sibling !== this);
      this.parent = null;
    },
  };
}

// The status bar on a fake page, with a clock the test moves by hand.
function loadStatusBar() {
  const bar = fakeElement();
  const toasts = fakeElement();
  const timers = [];
  let now = 0;
  const sandbox = {
    module: { exports: {} },
    console,
    document: {
      getElementById: (id) => ({ 'status-message': bar, 'status-toasts': toasts }[id]),
      createElement: () => fakeElement(),
    },
    setTimeout: (callback, delay) => { timers.push({ due: now + delay, callback }); },
  };
  vm.runInNewContext(
    `${utilsSource}\nmodule.exports = { showStatus, STICKY_STATUS_MS };`,
    sandbox,
    { filename: utilsPath },
  );

  const advance = (milliseconds) => {
    now += milliseconds;
    for (const timer of timers.filter(pendingTimer => pendingTimer.due <= now)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.callback();
    }
  };
  const toastTexts = () => toasts.children.map(toast => toast.textContent);

  return { api: sandbox.module.exports, bar, advance, toastTexts };
}

test('a warning stays up for ten seconds', () => {
  const page = loadStatusBar();
  assert.equal(page.api.STICKY_STATUS_MS, 10000);

  page.api.showStatus('Refused', 'warning');
  page.advance(9999);
  assert.deepEqual(page.toastTexts(), ['Refused']);

  page.advance(1);
  assert.deepEqual(page.toastTexts(), []);
});

test('a success shown after a warning does not hide it', () => {
  const page = loadStatusBar();

  page.api.showStatus('Refused', 'warning');
  page.api.showStatus('Category saved', 'success');

  assert.deepEqual(page.toastTexts(), ['Refused']);
  assert.equal(page.bar.textContent, 'Category saved', 'the success waits under the toast');
});

test('warnings pile up and each one leaves on its own timer', () => {
  const page = loadStatusBar();

  page.api.showStatus('First refused', 'warning');
  page.advance(4000);
  page.api.showStatus('Second refused', 'error');
  assert.deepEqual(page.toastTexts(), ['First refused', 'Second refused']);

  page.advance(6000);
  assert.deepEqual(page.toastTexts(), ['Second refused']);

  page.advance(4000);
  assert.deepEqual(page.toastTexts(), []);
});

test('a warning clears older text from the bar so it does not come back', () => {
  const page = loadStatusBar();

  page.api.showStatus('Memo saved', 'success');
  page.api.showStatus('Refused', 'warning');

  assert.equal(page.bar.textContent, '');
  assert.equal(page.bar.className, 'status-message');
});
