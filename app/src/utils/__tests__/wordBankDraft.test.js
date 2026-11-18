import test from 'node:test';
import assert from 'node:assert/strict';
import { addWordBankGap, joinWordBankText, removeWordBankDraftOption, removeWordBankGap } from '../wordBankDraft.js';

test('turning text into a gap keeps spaces and punctuation and uses a separate index for repeated words', () => {
  const text = 'vor, vor!';
  const original = joinWordBankText({ options: ['vor'], parts: [
    { type: 'text', text: 'vo' }, { type: 'text', text: 'r, vor!' },
  ] });
  const first = addWordBankGap(original, { index: 0, text, start: 0, end: 3 });
  assert.equal(first.options, original.options);
  const second = addWordBankGap(first, { index: 1, text: ', vor!', start: 1, end: 5 });
  assert.deepEqual(second, {
    options: ['vor', 'vor'],
    parts: [{ type: 'gap', option: 0 }, { type: 'text', text: ', ' },
      { type: 'gap', option: 1 }, { type: 'text', text: '!' }],
  });
  assert.equal(addWordBankGap(second, { index: 1, text, start: 0, end: 3 }), second);
});

test('removing a gap restores its text and deleting a free word shifts remaining references', () => {
  const original = {
    options: ['vor', 'vor'],
    parts: [{ type: 'text', text: 'Wir ' }, { type: 'gap', option: 0 }, { type: 'text', text: ', ' },
      { type: 'gap', option: 1 }, { type: 'text', text: '!' }],
  };
  assert.equal(removeWordBankDraftOption(original, 0), original);
  const withText = removeWordBankGap(original, 1);
  assert.deepEqual(removeWordBankDraftOption(withText, 0), {
    options: ['vor'],
    parts: [{ type: 'text', text: 'Wir vor, ' }, { type: 'gap', option: 0 }, { type: 'text', text: '!' }],
  });
});
