const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SPLIT_PARENT = {
  transaction_id: 'parent-1', account_id: 'acct-1', description: "Ankeny Children's Dental",
  is_split: true, splits: [{ transaction_id: 'parent-1_split_0' }, { transaction_id: 'parent-1_split_1' }],
};

/** split-transactions.js on a stubbed page; `confirmAnswer` is what the user answers. */
function buildPage(confirmAnswer) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'transactions/split-transactions.js'), 'utf8');
  const page = { confirms: [], requests: [], statuses: [], rendered: 0 };
  const sandbox = {
    module: { exports: {} },
    console,
    document: { addEventListener() {}, getElementById: () => null },
    window: {},
    BACKEND_URL: 'http://api.test',
    transactions: [SPLIT_PARENT],
    confirm: (message) => { page.confirms.push(message); return confirmAnswer; },
    authenticatedFetch: async (url, options) => {
      page.requests.push({ url, options });
      return { ok: true, json: async () => ({ account_id: 'acct-1' }) };
    },
    showStatus: (message, kind) => page.statuses.push({ message, kind }),
    applyRowChangesFromResponse: async () => {},
    renderTransactionTable: () => { page.rendered += 1; },
  };
  vm.runInNewContext(`${source}\nmodule.exports = { handleDeleteSplit };`, sandbox);
  page.handleDeleteSplit = sandbox.module.exports.handleDeleteSplit;
  return page;
}

test('clearing a split asks first, naming the row and its piece count', async () => {
  const page = buildPage(true);
  await page.handleDeleteSplit('parent-1');

  assert.deepEqual(page.confirms, [
    'Clear the 2 splits on "Ankeny Children\'s Dental"? It goes back to one transaction, and the pieces\' categories and memos are removed.',
  ]);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].options.method, 'DELETE');
  assert.deepEqual(page.statuses.at(-1), { message: 'Splits cleared', kind: 'success' });
});

test('declining the question sends nothing and leaves the list alone', async () => {
  const page = buildPage(false);
  await page.handleDeleteSplit('parent-1');

  assert.equal(page.confirms.length, 1);
  assert.equal(page.requests.length, 0);
  assert.equal(page.statuses.length, 0);
  assert.equal(page.rendered, 0);
});
