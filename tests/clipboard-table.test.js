const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'shared', 'clipboard-table.js');
const source = fs.readFileSync(sourcePath, 'utf8');

// clipboard-table.js is function declarations; only the pure converters are exercised.
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(`${source}\nmodule.exports = { parseCsvRows, csvToTsv };`, sandbox, { filename: sourcePath });
const { parseCsvRows, csvToTsv } = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));

test('a balance report row becomes one cell per field', () => {
  const csv = '"Account","Mask","2026-01-31","2026-02-28"\n'
    + '"    vehicle total value","1001",42535.00,42090.00\n';
  assert.equal(
    csvToTsv(csv),
    'Account\tMask\t2026-01-31\t2026-02-28\n    vehicle total value\t1001\t42535.00\t42090.00',
  );
});

test('a comma inside a quoted name stays in one cell', () => {
  assert.deepEqual(plain(parseCsvRows('"Smith, Jones CC","6270",-213.27\n')), [['Smith, Jones CC', '6270', '-213.27']]);
});

test('doubled quotes inside a quoted field become one quote', () => {
  assert.deepEqual(plain(parseCsvRows('"27"" monitor",12\n')), [['27" monitor', '12']]);
  assert.equal(csvToTsv('"27"" monitor",12\n'), '27" monitor\t12');
});

test('empty fields keep their column position', () => {
  assert.equal(csvToTsv(',,"Total Income",5,6\n'), '\t\tTotal Income\t5\t6');
  assert.equal(csvToTsv('"Liabilities",\n'), 'Liabilities\t');
});

test('a section row with fewer fields is kept as a short row', () => {
  assert.equal(csvToTsv('"Expenses"\n,"Food","Tea",1,2\n'), 'Expenses\n\tFood\tTea\t1\t2');
});

test('a tab or line break inside a field becomes a space so the grid holds', () => {
  assert.equal(csvToTsv('"line one\nline two","a\tb",3\n'), 'line one line two\ta b\t3');
});

test('a field that opens with a quote is wrapped so it cannot swallow later cells', () => {
  assert.equal(csvToTsv('"""Quoted"" name",5\n'), '"""Quoted"" name"\t5');
});

test('Windows line endings and a missing final newline both parse', () => {
  assert.deepEqual(plain(parseCsvRows('a,b\r\nc,d')), [['a', 'b'], ['c', 'd']]);
});

test('empty input gives no rows', () => {
  assert.deepEqual(plain(parseCsvRows('')), []);
  assert.equal(csvToTsv(''), '');
});
