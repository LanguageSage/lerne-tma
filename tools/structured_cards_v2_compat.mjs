// Behavioral bridge for the Python contract tests. No application/server startup.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectCardType } from '../app/src/utils/exerciseDetector.js';
import { parseExerciseContent } from '../app/src/utils/exerciseContentParser.js';
import { parseClozeData } from '../app/src/utils/clozeParser.js';
import { evaluateTrainerGaps } from '../app/src/utils/trainerEvaluation.js';

const { legacy, expected } = JSON.parse(readFileSync(0, 'utf8'));
let gapsChecked = 0;
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
  } else {
    assert.equal(content.exercise, authored.type === 'theory' ? authored.data.text : authored.data.prompt);
    assert.equal(card.back, authored.type === 'theory' ? authored.data.summary || '' : authored.data.answer);
  }
}
console.log(JSON.stringify({ cards: legacy.cards.length, gaps: gapsChecked }));
