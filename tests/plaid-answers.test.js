const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const labelAnswersSource = fs.readFileSync(path.join(root, 'categories', 'label-answers.js'), 'utf8');
const sourcePath = path.join(root, 'categories', 'plaid-answers.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(
  `${labelAnswersSource}\n${source}\nmodule.exports = { readUnansweredPlaidCategories, plaidAnswerLabel, plaidAnswersToSend, withPlaidCategoryAnswers, describePlaidCategoryAnswers, summarizeMappingsSave, unansweredNoticeTitle, unansweredNoticeParagraphs, describeRowsInCatchAll };`,
  sandbox,
  { filename: sourcePath }
);
const {
  readUnansweredPlaidCategories, plaidAnswerLabel, plaidAnswersToSend, withPlaidCategoryAnswers,
  describePlaidCategoryAnswers, summarizeMappingsSave, unansweredNoticeTitle,
  unansweredNoticeParagraphs, describeRowsInCatchAll,
} = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const CATCH_ALL = 'Uncategorized: Uncategorized';
const unanswered = [
  { code: 'GENERAL_SERVICES_X', primary: 'GENERAL_SERVICES', name: 'General Services: X', transactions: 3 },
  { code: 'TRAVEL_Y', primary: 'TRAVEL', name: 'Travel: Y', transactions: 0 },
];

test('the unanswered list is read from the categories response', () => {
  const read = plain(readUnansweredPlaidCategories({
    unanswered_plaid_categories: [
      { code: 'GENERAL_SERVICES_X', primary: 'GENERAL_SERVICES', name: 'General Services: X', transactions: 3 },
      { code: 'TRAVEL_Y', primary: 'TRAVEL', transactions: '2' },
      { code: '', name: 'blank' },
      null,
    ],
  }));
  assert.deepEqual(read, [
    { code: 'GENERAL_SERVICES_X', primary: 'GENERAL_SERVICES', name: 'General Services: X', transactions: 3 },
    { code: 'TRAVEL_Y', primary: 'TRAVEL', name: 'TRAVEL_Y', transactions: 2 },
  ]);
});

test('a response without the field has nothing unanswered', () => {
  assert.deepEqual(plain(readUnansweredPlaidCategories({})), []);
  assert.deepEqual(plain(readUnansweredPlaidCategories(null)), []);
  assert.deepEqual(plain(readUnansweredPlaidCategories({ unanswered_plaid_categories: 'x' })), []);
});

test('an answer sends its label, keep sends the catch-all, and nothing sends a blank', () => {
  assert.equal(plaidAnswerLabel({ choice: 'label', label: ' Food: Dining ' }, CATCH_ALL), 'Food: Dining');
  assert.equal(plaidAnswerLabel({ choice: 'keep' }, CATCH_ALL), CATCH_ALL);
  assert.equal(plaidAnswerLabel({ choice: 'label', label: '  ' }, CATCH_ALL), '');
  assert.equal(plaidAnswerLabel({ choice: 'keep' }, ''), '');
  assert.equal(plaidAnswerLabel(undefined, CATCH_ALL), '');
});

test('only codes still unanswered and with a choice are sent', () => {
  const sent = plain(plaidAnswersToSend({
    GENERAL_SERVICES_X: { choice: 'label', label: 'Food: Dining' },
    TRAVEL_Y: { choice: 'label', label: '' },
    FOOD_ALREADY_MAPPED: { choice: 'keep' },
  }, unanswered, CATCH_ALL));
  assert.deepEqual(sent, { GENERAL_SERVICES_X: { choice: 'label', label: 'Food: Dining' } });
});

test('a save with no choices sends no unanswered code', () => {
  const mappings = { FOOD_COFFEE: 'Food: Coffee' };
  const sent = plaidAnswersToSend({}, unanswered, CATCH_ALL);
  const merged = plain(withPlaidCategoryAnswers(mappings, sent));
  assert.deepEqual(merged, { FOOD_COFFEE: 'Food: Coffee' });
  assert.equal('GENERAL_SERVICES_X' in merged, false);
});

test('answers are added to a copy of the mappings', () => {
  const mappings = { FOOD_COFFEE: 'Food: Coffee' };
  const sent = plaidAnswersToSend({ TRAVEL_Y: { choice: 'keep' } }, unanswered, CATCH_ALL);
  const merged = plain(withPlaidCategoryAnswers(mappings, sent));
  assert.deepEqual(merged, { FOOD_COFFEE: 'Food: Coffee', TRAVEL_Y: CATCH_ALL });
  assert.deepEqual(plain(mappings), { FOOD_COFFEE: 'Food: Coffee' });
});

test('the result follows the choice, not the count', () => {
  const sent = {
    GENERAL_SERVICES_X: { choice: 'label', label: 'Food: Dining' },
    TRAVEL_Y: { choice: 'keep', label: CATCH_ALL },
  };
  // A keep answer can report rows when the same save renames the catch-all.
  const lines = describePlaidCategoryAnswers(sent, { GENERAL_SERVICES_X: 3, TRAVEL_Y: 5 }, unanswered);
  assert.deepEqual(plain(lines), [
    'General Services: X now files under Food: Dining; 3 transactions moved there.',
    `Travel: Y now stays in ${CATCH_ALL}.`,
  ]);
});

test('a label answer with no rows says nothing needed moving', () => {
  const sent = { TRAVEL_Y: { choice: 'label', label: 'Travel: Trips' } };
  assert.deepEqual(plain(describePlaidCategoryAnswers(sent, { TRAVEL_Y: 0 }, unanswered)), [
    'Travel: Y now files under Travel: Trips; it had no transactions to move.',
  ]);
  assert.deepEqual(plain(describePlaidCategoryAnswers(sent, { TRAVEL_Y: 1 }, unanswered)), [
    'Travel: Y now files under Travel: Trips; 1 transaction moved there.',
  ]);
});

test('a missing count leaves the count out', () => {
  const sent = { GENERAL_SERVICES_X: { choice: 'label', label: 'Food: Dining' } };
  assert.deepEqual(plain(describePlaidCategoryAnswers(sent, undefined, unanswered)), [
    'General Services: X now files under Food: Dining.',
  ]);
});

test('the save message joins the usual summary and the answers', () => {
  assert.equal(summarizeMappingsSave({}, {}, unanswered), 'Mappings saved');
  const sent = { TRAVEL_Y: { choice: 'keep', label: CATCH_ALL } };
  assert.equal(
    summarizeMappingsSave({ answered_plaid_categories: { TRAVEL_Y: 0 } }, sent, unanswered),
    `Mappings saved. Travel: Y now stays in ${CATCH_ALL}.`
  );
  assert.equal(
    summarizeMappingsSave({ past_rows_moved: { FOOD_COFFEE: 2 }, answered_plaid_categories: { TRAVEL_Y: 0 } }, sent, unanswered),
    `Mappings saved: 2 past transactions moved. Travel: Y now stays in ${CATCH_ALL}.`
  );
});

test('the notice says keeping them is an answer and that it stays until one is given', () => {
  assert.equal(unansweredNoticeTitle(1), 'Plaid sent a category you haven\'t mapped');
  assert.equal(unansweredNoticeTitle(3), 'Plaid sent 3 categories you haven\'t mapped');
  const text = unansweredNoticeParagraphs(2, CATCH_ALL).join(' ');
  assert.match(text, /filing under Uncategorized: Uncategorized until you choose/);
  assert.match(text, /keep them in Uncategorized: Uncategorized/);
  assert.match(text, /this notice stays until you choose for each one/);
  assert.match(unansweredNoticeParagraphs(1, CATCH_ALL).join(' '), /choose for this category/);
});

test('each row says how many transactions wait in the catch-all', () => {
  assert.equal(describeRowsInCatchAll(3, CATCH_ALL), `3 transactions waiting in ${CATCH_ALL}`);
  assert.equal(describeRowsInCatchAll(1, CATCH_ALL), `1 transaction waiting in ${CATCH_ALL}`);
  assert.match(describeRowsInCatchAll(0, CATCH_ALL), /^No transactions yet/);
});
