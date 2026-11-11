import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJECTIVE_ENDINGS, parseClozeData, cleanBracketSyntax } from '../clozeParser.js';


test('short attached endings generate all adjective endings while retaining the answer', () => {
  for (const ending of ADJECTIVE_ENDINGS) {
    const front = `Mit klein{${ending}} Hund.`;
    const { gaps } = parseClozeData({ front }, 'trainer');
    assert.equal(gaps[0].isAffix, true);
    assert.equal(gaps[0].correctAnswer, ending);
    assert.deepEqual([...gaps[0].choices].sort(), [...ADJECTIVE_ENDINGS].sort());
    assert.equal(cleanBracketSyntax(front), `Mit klein${ending} Hund.`);
  }
});

test('explicit choices, input answers and standalone words retain their meaning', () => {
  const { gaps } = parseClozeData({ front: 'groß{*en|em} schön[[e]] {en}, {er} kommt.' }, 'trainer');
  assert.deepEqual([...gaps[0].choices].sort(), ['em', 'en']);
  assert.equal(gaps[1].mode, 'input');
  assert.equal(gaps[1].isAffix, true);
  assert.deepEqual(gaps[1].choices, []);
  assert.equal(gaps[2].isAffix, false);
  assert.deepEqual(gaps[2].choices, ['en']);
  assert.equal(gaps[3].isAffix, false);
  assert.ok(gaps[3].choices.includes('ihn'));
});

test('Unicode stems and prefixes attach, punctuation and whitespace do not', () => {
  const { gaps } = parseClozeData({ front: 'grün{em} біл[[ий]] {un}bekannt ({en}) Wort {en}' }, 'trainer');
  assert.deepEqual(gaps.map(gap => gap.isAffix), [true, true, true, false, false]);
});
