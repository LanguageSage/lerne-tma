// Behavioral bridge for the Python contract tests. No application/server startup.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectCardType } from '../app/src/utils/exerciseDetector.js';
import { parseExerciseContent } from '../app/src/utils/exerciseContentParser.js';
import { parseClozeData } from '../app/src/utils/clozeParser.js';
import { evaluateTrainerGaps } from '../app/src/utils/trainerEvaluation.js';
import { parseMatchData, normalizeMatchValue } from '../app/src/utils/matchParser.js';
import { evaluateMatchPair, matchPartId } from '../app/src/utils/matchEvaluation.js';

const { legacy, expected } = JSON.parse(readFileSync(0, 'utf8'));
let gapsChecked = 0;
let pairsChecked = 0;
assert.equal(legacy.cards.length, expected.cards.length);
for (const [index, card] of legacy.cards.entries()) {
  const authored = expected.cards[index];
  assert.equal(detectCardType(card) || 'standard', authored.type);
  assert.equal(card.context, authored.explanation || '');
  const content = parseExerciseContent(card.front);
  assert.deepEqual(content.blocks.filter(block => block.type !== 'exercise').map(block => (
    block.type === 'options' ? { type: 'options', items: block.options }
      : { type: block.type, text: block.content }
  )), authored.info || []);
  if (authored.type === 'trainer') {
    const data = parseClozeData(card, 'trainer');
    const parts = authored.data.parts.filter(part => part.type !== 'text');
    assert.equal(data.gaps.length, parts.length);
    const values = {};
    for (const [gapIndex, part] of parts.entries()) {
      const gap = data.gaps[gapIndex];
      const answers = part.type === 'input' ? part.answers
        : part.options.filter(option => option.correct).map(option => option.text);
      assert.equal(gap.mode, part.type);
      assert.deepEqual(gap.correctAnswer.split('|'), answers);
      if (part.type === 'choice') {
        assert.deepEqual([...gap.choices].sort(), part.options.map(option => option.text).sort());
      }
      values[gap.id] = answers[0];
      gapsChecked++;
    }
    assert.equal(evaluateTrainerGaps(data.gaps, values).accepted, true);
    for (const gap of data.gaps) {
      for (const answer of gap.correctAnswer.split('|')) {
        assert.equal(evaluateTrainerGaps(data.gaps, { ...values, [gap.id]: answer }).accepted, true);
      }
      assert.equal(evaluateTrainerGaps(data.gaps, { ...values, [gap.id]: '__WRONG__' }).accepted, false);
      const part = parts[gap.id];
      for (const distractor of part.options?.filter(option => !option.correct) || []) {
        assert.equal(evaluateTrainerGaps(data.gaps, { ...values, [gap.id]: distractor.text }).accepted, false);
      }
    }
  } else if (authored.type === 'match') {
    const data = parseMatchData(card);
    assert.ok(data?.isMatch);
    assert.equal(data.prompt, '');
    assert.deepEqual(data.pairs, authored.data.pairs.map((pair, id) => ({ id, ...pair })));
    assert.equal(card.back, authored.data.pairs.map(pair => `${pair.left} => ${pair.right}`).join('\n'));
    pairsChecked += data.pairs.length;

    // Check the actual evaluator's correctness matrix, including equivalent
    // right labels. Every physical right tile must still be single-use.
    for (const left of data.pairs) {
      for (const right of data.pairs) {
        const attempt = evaluateMatchPair(data.pairs, {}, left.id, right.id);
        assert.equal(attempt.interactionCorrect,
          normalizeMatchValue(left.right) === normalizeMatchValue(right.right));
        assert.equal(attempt.result.accepted, false); // More than one pair required.
      }
    }
    // Reverse selection order deliberately swaps equivalent duplicate tiles.
    const matches = {};
    for (const left of data.pairs) {
      const right = [...data.pairs].reverse().find(candidate =>
        !Object.values(matches).includes(candidate.id)
        && normalizeMatchValue(left.right) === normalizeMatchValue(candidate.right));
      const attempt = evaluateMatchPair(data.pairs, matches, left.id, right.id);
      assert.equal(attempt.interactionCorrect, true);
      assert.equal(attempt.result.accepted, Object.keys(matches).length + 1 === data.pairs.length);
      assert.ok(attempt.result.parts.some(part => part.id === matchPartId(left.id) && part.status === 'correct'));
      matches[left.id] = right.id;
      assert.equal(evaluateMatchPair(data.pairs, matches, left.id, right.id), null);
      const next = data.pairs.find(pair => matches[pair.id] === undefined);
      if (next) assert.equal(evaluateMatchPair(data.pairs, matches, next.id, right.id), null);
    }
  } else {
    assert.equal(content.exercise, authored.type === 'theory' ? authored.data.text : authored.data.prompt);
    assert.equal(card.back, authored.type === 'theory' ? authored.data.summary || '' : authored.data.answer);
  }
}
console.log(JSON.stringify({ cards: legacy.cards.length, gaps: gapsChecked, pairs: pairsChecked }));
