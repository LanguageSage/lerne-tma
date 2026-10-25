import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMatchData } from '../matchParser.js';

const pairs = (front) => parseMatchData(front)?.pairs.map(({ left, right }) => ({ left, right }));

test('Match B1-33-D09 #13 keeps the em dash in the reported translation', () => {
  assert.deepEqual(pairs('@match\num mich auszuruhen => цель — отдохнуть\nweil ich müde bin => причина — усталость'), [
    { left: 'um mich auszuruhen', right: 'цель — отдохнуть' },
    { left: 'weil ich müde bin', right: 'причина — усталость' }
  ]);
});

test('Match splits at the first => and preserves punctuation on either side', () => {
  const expected = [
    { left: 'a=b — c->d', right: 'x=>y -> z — w = v' },
    { left: 'ÄÖÜ ß?! «Wort»', right: 'a/b; c,d | [x] {y} <z> & @match ::task … 🙂' },
    { left: 'A', right: 'two  words\twith\u00a0spaces — punctuation!' }
  ];
  const front = '@match\n' + expected.map(({ left, right }) => `${left} => ${right}`).join('\n');
  for (const card of [front, { front }, { front_text: front }]) {
    assert.deepEqual(pairs(card), expected);
  }
});

test('Match never treats ->, — or = as pair separators', () => {
  for (const separator of ['->', '—', '=']) {
    assert.equal(parseMatchData(`@match\nA ${separator} eins\nB${separator}zwei`), null);
    assert.equal(parseMatchData(`@match\nA => eins\nB${separator}zwei`), null);
  }
  assert.deepEqual(pairs('@match\nA => eins\nB -> zwei\nC — drei\nD=vier\nE => fünf'), [
    { left: 'A', right: 'eins' }, { left: 'E', right: 'fünf' }
  ]);
});

test('Match preserves prompts with punctuation, formatting cleanup and duplicate tiles', () => {
  const parsed = parseMatchData('@match\r\nOrdnen Sie zu — A -> B = Paar.\r\n\r\n **A**=>_eins_\r\nB => eins\r\nC => zwei\r\nD=>zwei');
  assert.equal(parsed.prompt, 'Ordnen Sie zu — A -> B = Paar.');
  assert.deepEqual(parsed.pairs, [
    { id: 0, left: 'A', right: 'eins' }, { id: 1, left: 'B', right: 'eins' },
    { id: 2, left: 'C', right: 'zwei' }, { id: 3, left: 'D', right: 'zwei' }
  ]);
});

test('Match never falls back to a different separator on a malformed explicit pair', () => {
  assert.equal(parseMatchData('@match\n=> missing left — extra\nmissing right =>\nA => valid'), null);
  assert.equal(parseMatchData('@match\nA => B'), null);
  assert.equal(parseMatchData('A => B\nC => D'), null);
});
