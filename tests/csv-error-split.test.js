const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'categories', 'advanced-mode.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// advanced-mode.js is function declarations; only the pure helper is exercised.
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(`${source}\nmodule.exports = { splitCSVError };`, sandbox, { filename: sourcePath });
const { splitCSVError } = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));

test('an error with no newline has no lines to add', () => {
  assert.deepEqual(plain(splitCSVError('Row 3: bad label')), { text: 'Row 3: bad label', linesToAdd: [] });
});

test('explanation then two CSV lines', () => {
  const error = "'Food: Tea' is leaving your list. Add one of these lines to the file: RETARGET moves them; KEEP keeps them.\n"
    + 'RETARGET,Food: Tea,Food And Drink: Coffee\nKEEP,Food: Tea';
  assert.deepEqual(plain(splitCSVError(error)), {
    text: "'Food: Tea' is leaving your list. Add one of these lines to the file: RETARGET moves them; KEEP keeps them.",
    linesToAdd: ['RETARGET,Food: Tea,Food And Drink: Coffee', 'KEEP,Food: Tea'],
  });
});

test('trailing blank lines are skipped', () => {
  assert.deepEqual(plain(splitCSVError('Explain\nKEEP,A: B\n\n  \n')), { text: 'Explain', linesToAdd: ['KEEP,A: B'] });
});
