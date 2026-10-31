const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const helperPath = path.join(__dirname, '..', 'shared', 'api-notices.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');

function loadHelper() {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(`${helperSource}\nmodule.exports = { extractNotices };`, sandbox, { filename: helperPath });
  return sandbox.module.exports;
}

const { extractNotices } = loadHelper();

test('notices come back as a list of strings', () => {
  assert.deepEqual([...extractNotices({ notices: ['one', 'two'] })], ['one', 'two']);
});

test('a response without notices, from an older API, has none', () => {
  assert.deepEqual([...extractNotices({ ok: true })], []);
  assert.deepEqual([...extractNotices(null)], []);
  assert.deepEqual([...extractNotices(undefined)], []);
  assert.deepEqual([...extractNotices({ notices: 'oops' })], []);
});

test('blank and non-string entries are dropped', () => {
  assert.deepEqual([...extractNotices({ notices: ['', '  ', 'kept', null, 5] })], ['kept']);
});
