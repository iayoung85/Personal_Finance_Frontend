const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'categories', 'label-answers.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${source}\nmodule.exports = { describeUsageCounts, readMappingQuestions, allQuestionsAnswered, buildMappingAnswersPayload, summarizeAnswerResult, buildCsvPreviewRows, describeMappingQuestions, describeCsvMoves, buildInspectQuery, buildInspectLink };`,
  sandbox,
  { filename: sourcePath }
);
const {
  describeUsageCounts, readMappingQuestions, allQuestionsAnswered,
  buildMappingAnswersPayload, summarizeAnswerResult, buildCsvPreviewRows,
  describeMappingQuestions, describeCsvMoves, buildInspectQuery, buildInspectLink,
} = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));

const questions = {
  labels: [{ label: 'Food: Tea' }, { label: 'Fun: Golf' }],
  keys: [{ key: 'FOOD_TEA', from: 'Food: Tea', to: 'Food: Coffee', transactions: 4 }],
};

test('counts in words, singular and plural, zeros left out', () => {
  assert.equal(describeUsageCounts({ transactions: 12, rules: 2, overrides: 0, bills: 1, alerts: 0 }), '12 transactions, 2 rules, 1 bill');
  assert.equal(describeUsageCounts({ transactions: 1, alerts: 1 }), '1 transaction, 1 alert');
  assert.equal(describeUsageCounts({}), 'nothing recorded');
  assert.equal(describeUsageCounts({ transactions: 585, overrides: 52, split_parents: 6 }), '585 transactions, 52 overrides');
  assert.equal(describeUsageCounts({ transactions: 0, rules: 1, split_parents: 2 }), '2 split transactions, 1 rule');
});

test('an older API sends only labels_in_use', () => {
  const read = plain(readMappingQuestions({ labels_in_use: [{ label: 'A' }] }));
  assert.deepEqual(read, { labels: [{ label: 'A' }], keys: [] });
  assert.deepEqual(plain(readMappingQuestions({})), { labels: [], keys: [] });
});

test('save stays disabled until every item is answered', () => {
  const labelAnswers = { 'Food: Tea': { choice: 'keep' } };
  assert.equal(allQuestionsAnswered(questions, {}, {}), false);
  assert.equal(allQuestionsAnswered(questions, labelAnswers, { FOOD_TEA: 'move' }), false);
  labelAnswers['Fun: Golf'] = { choice: 'merge', target: '' };
  assert.equal(allQuestionsAnswered(questions, labelAnswers, { FOOD_TEA: 'move' }), false);
  labelAnswers['Fun: Golf'] = { choice: 'merge', target: 'Fun: Games' };
  assert.equal(allQuestionsAnswered(questions, labelAnswers, { FOOD_TEA: 'move' }), true);
  assert.equal(allQuestionsAnswered(questions, labelAnswers, {}), false);
});

test('payload carries relabel, keep and past_rows from the answers', () => {
  const payload = buildMappingAnswersPayload(
    { A: 'x' }, questions,
    { 'Food: Tea': { choice: 'keep' }, 'Fun: Golf': { choice: 'merge', target: 'Fun: Games' } },
    { FOOD_TEA: 'keep' }
  );
  assert.deepEqual(plain(payload), {
    category_mappings: { A: 'x' },
    relabel: { 'Fun: Golf': 'Fun: Games' },
    keep: ['Food: Tea'],
    past_rows: { FOOD_TEA: 'keep' },
  });
});

test('payload leaves out empty answer groups', () => {
  const payload = buildMappingAnswersPayload({ A: 'x' }, { labels: [], keys: [] }, {}, {});
  assert.deepEqual(plain(payload), { category_mappings: { A: 'x' } });
});

test('success summary names what was merged, kept and moved', () => {
  const text = summarizeAnswerResult({
    relabeled: { 'Fun: Golf': { to: 'Fun: Games', transactions: 3 } },
    kept: { 'Food: Tea': { overrides_added: 5 } },
    past_rows_moved: { FOOD_TEA: 4 },
    past_rows_kept: {},
  });
  assert.equal(text, 'Mappings saved: 1 label merged (3 transactions); 1 label kept as custom category; 4 past transactions moved');
  assert.equal(summarizeAnswerResult({}), 'Mappings saved');
});

test('preview rows for both tables', () => {
  const rows = plain(buildCsvPreviewRows({
    labels_leaving: [
      { label: 'A', transactions: 2, rules: 1, target: 'B', target_source: 'inferred' },
      { label: 'C', transactions: 1, target: null, target_source: 'keep' },
      { label: 'D', transactions: 1, target: null, target_source: null },
    ],
    keys_remapped: [
      { key: 'K1', from: 'A', to: 'B', transactions: 7, answer: 'move' },
      { key: 'K2', from: 'C', to: 'B', transactions: 1, answer: null },
    ],
  }));
  assert.equal(rows.movesNothing, false);
  assert.deepEqual(rows.labelRows.map(r => [r.where, r.how, r.needsLine]), [
    ['B', 'Inferred from your mappings', false],
    ['Kept as a custom category', 'KEEP line', false],
    ['Needs a line', '', true],
  ]);
  assert.equal(rows.labelRows[0].counts, '2 transactions, 1 rule');
  assert.deepEqual(rows.keyRows.map(r => [r.change, r.answer, r.needsLine]), [
    ['A → B', 'Move to the new label', false],
    ['C → B', 'Needs a line', true],
  ]);
});

test('empty dry run moves nothing, with or without keys_remapped', () => {
  assert.equal(buildCsvPreviewRows({ labels_leaving: [], keys_remapped: [] }).movesNothing, true);
  assert.equal(buildCsvPreviewRows({ labels_leaving: [] }).movesNothing, true);
});

test('dialog opening sentence follows what was asked', () => {
  const label = [{ label: 'A' }];
  const key = [{ key: 'K' }];
  assert.match(describeMappingQuestions({ labels: label, keys: [] }), /^This change would leave transactions/);
  assert.equal(describeMappingQuestions({ labels: [], keys: key }), 'Some Plaid categories you remapped have past transactions on their old label.');
  const both = describeMappingQuestions({ labels: label, keys: key });
  assert.match(both, /no longer in your list\. Some Plaid categories/);
});

test('CSV success lines show what moved and skip zeros', () => {
  const lines = describeCsvMoves({
    labels_relabeled: { A: { to: 'B', transactions: 2 } },
    labels_kept: { C: { overrides_added: 1 } },
    past_rows_moved: { K: 3 },
    past_rows_kept: {},
    transactions_migrated: 2,
    bills_migrated: 0,
    alerts_migrated: 1,
  });
  assert.deepEqual(plain(lines), [
    '1 label merged (2 transactions)',
    '1 label kept as custom category',
    '3 past transactions moved',
    '2 transactions moved to new labels',
    '1 alert moved to new labels',
  ]);
  assert.deepEqual(plain(describeCsvMoves({})), []);
});

test('inspect queries for a label, a key, and the catch-all key', () => {
  assert.equal(buildInspectQuery('Food: Tea'), 'label:"Food: Tea"');
  assert.equal(buildInspectQuery('Food: Tea', 'FOOD_TEA'),
    'label:"Food: Tea" pfc:FOOD_TEA is:plaid -is:override -is:transfer');
  assert.equal(buildInspectQuery('Other: Misc', 'OTHER_OTHER'),
    'label:"Other: Misc" confidence:low is:plaid -is:override -is:transfer');
});

test('inspect link is a transactions search with the query encoded', () => {
  const link = buildInspectLink('label:"A"', 6);
  assert.equal(link.text, 'Inspect 6 transactions');
  assert.equal(link.href, 'transactions.html?search=label%3A%22A%22');
  assert.equal(buildInspectLink('x', 1).text, 'Inspect 1 transaction');
});

test('preview rows carry inspect links, hidden for zero transactions', () => {
  const rows = plain(buildCsvPreviewRows({
    labels_leaving: [{ label: 'A', transactions: 2 }, { label: 'B', transactions: 0 }],
    keys_remapped: [{ key: 'K', from: 'A', to: 'B', transactions: 5, answer: 'move' }],
  }));
  assert.equal(rows.labelRows[0].inspectable, true);
  assert.equal(rows.labelRows[1].inspectable, false);
  assert.match(decodeURIComponent(rows.keyRows[0].inspect.href), /label:"A" pfc:K is:plaid/);
});
