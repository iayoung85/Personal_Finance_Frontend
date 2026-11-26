const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const box = { module: { exports: {} }, console, formatCurrency: () => '', document: { addEventListener() {} } };
vm.runInNewContext(
  `${fs.readFileSync(path.join(__dirname, '..', 'bills/modal.js'), 'utf8')}\n`
    + 'module.exports = { BILL_MATCH_HELP };',
  box,
  { filename: 'modal.js' },
);
const help = box.module.exports.BILL_MATCH_HELP;

test('the matching explanation has a title, six paragraphs and a tip', () => {
  assert.equal(help.title, 'How bill matching works');
  assert.equal(help.paragraphs.length, 6);
  assert.ok(help.tip.startsWith('Tip: '));
  help.paragraphs.forEach(text => assert.ok(text.length > 0));
});

test('the paragraph naming the day counts carries both', () => {
  const dayCounts = help.paragraphs.filter(text => text.includes('4 days'));
  assert.equal(dayCounts.length, 1);
  assert.ok(dayCounts[0].includes('two weeks'));
});
