// Behavioral bridge for the Python contract tests. No application/server startup.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectCardType } from '../app/src/utils/exerciseDetector.js';
import { parseExerciseContent, getInteractiveExerciseContent } from '../app/src/utils/exerciseContentParser.js';
import { parseClozeData } from '../app/src/utils/clozeParser.js';
import { evaluateTrainerGaps } from '../app/src/utils/trainerEvaluation.js';
import { parseMatchData, normalizeMatchValue } from '../app/src/utils/matchParser.js';
import { evaluateMatchPair, matchPartId } from '../app/src/utils/matchEvaluation.js';
import { stripMarkdown } from '../app/src/utils/text.js';
import { evaluatePuzzleOrder } from '../app/src/utils/puzzleEvaluation.js';
import { parseQuizData } from '../app/src/utils/quizParser.js';
import { evaluateQuizOption } from '../app/src/utils/quizEvaluation.js';
import { parseWordBankData, normalizeWordBankValue } from '../app/src/utils/wordBankParser.js';
import { assignWordBankOption, sanitizeWordBankAssignments, checkWordBankAssignments } from '../app/src/utils/wordBankState.js';
import { parseFreeTextData } from '../app/src/utils/freeTextParser.js';

const { legacy, expected } = JSON.parse(readFileSync(0, 'utf8'));
let gapsChecked = 0;
let pairsChecked = 0;
let tokensChecked = 0;
let optionsChecked = 0;
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
  } else if (authored.type === 'puzzle') {
    // StudyCardPuzzle's current tokenization; the browser regression also mounts
    // the actual component with these projected cards, without changing it.
    const body = getInteractiveExerciseContent(card.front, 'puzzle').replace(/^@puzzle\s*/i, '').trim();
    const tokens = stripMarkdown(body).split(/\s+/).map(word => word.trim()).filter(Boolean);
    assert.deepEqual(tokens, authored.data.tokens);
    assert.equal(card.back, authored.data.translation || '');
    tokensChecked += tokens.length;
    const target = tokens.map((_, id) => id);
    assert.equal(evaluatePuzzleOrder(target, target).accepted, true);
    for (const wrong of [target.slice(1), [...target, 999], target.map(() => 999)]) {
      assert.equal(evaluatePuzzleOrder(target, wrong).accepted, false);
    }
    if (target.length > 1) assert.equal(evaluatePuzzleOrder(target, [...target].reverse()).accepted, false);
    const firstDuplicate = tokens.findIndex((token, id) => tokens.indexOf(token) !== id);
    if (firstDuplicate >= 0) {
      const first = tokens.indexOf(tokens[firstDuplicate]);
      const swapped = [...target];
      [swapped[first], swapped[firstDuplicate]] = [swapped[firstDuplicate], swapped[first]];
      assert.deepEqual(swapped.map(id => tokens[id]), tokens);
      assert.equal(evaluatePuzzleOrder(target, swapped).accepted, false);
    }
  } else if (authored.type === 'quiz') {
    const data = parseQuizData(card);
    assert.ok(data?.isQuiz);
    assert.equal(data.question, authored.data.prompt);
    assert.deepEqual([...data.options].sort((a, b) => a.id - b.id),
      authored.data.options.map((option, id) => ({ id, text: option.text, isCorrect: option.correct || false })));
    const correct = authored.data.options.findIndex(option => option.correct);
    assert.equal(data.correctAnswerId, correct);
    assert.equal(data.correctAnswerText, authored.data.options[correct].text);
    assert.equal(card.back, authored.data.options[correct].text);
    for (const option of data.options) {
      assert.equal(evaluateQuizOption(data.options, option.id).accepted, option.id === correct);
    }
    assert.equal(evaluateQuizOption(data.options, -1), null);
    optionsChecked += data.options.length;
  } else if (authored.type === 'word_bank') {
    const data = parseWordBankData(card);
    assert.ok(data?.isWordBank);
    const parts = authored.data.parts;
    const gaps = parts.filter(part => part.type === 'gap');
    assert.equal(data.text, parts.map(part => part.type === 'text' ? part.text : `<<${part.option + 1}>>`).join(''));
    assert.deepEqual(data.gaps, gaps.map((part, index) => ({ id: String(part.option + 1), index,
      correctAnswer: authored.data.options[part.option] })));
    assert.deepEqual(data.options, authored.data.options.map((value, index) => ({ id: `option-${index}`, value })));
    let assignments = {};
    assert.equal(checkWordBankAssignments(data.gaps, data.options, assignments).allCorrect, false);
    for (const gap of data.gaps) {
      // Reverse search deliberately uses interchangeable duplicate occurrences.
      const option = [...data.options].reverse().find(option => !Object.values(assignments).includes(option.id)
        && option.value === gap.correctAnswer);
      assignments = assignWordBankOption(assignments, gap.id, option.id);
      const other = data.gaps.find(other => other.id !== gap.id);
      if (other) assert.equal(assignWordBankOption(assignments, other.id, option.id), assignments);
      for (const candidate of data.options) {
        const checked = checkWordBankAssignments([gap], data.options, { [gap.id]: candidate.id });
        assert.equal(checked.allCorrect, normalizeWordBankValue(candidate.value) === normalizeWordBankValue(gap.correctAnswer));
      }
    }
    assert.deepEqual(sanitizeWordBankAssignments(assignments, data.gaps, data.options), assignments);
    const checked = checkWordBankAssignments(data.gaps, data.options, assignments);
    assert.equal(checked.allCorrect, true);
    assert.equal(checked.evaluation.accepted, true);
    gapsChecked += data.gaps.length;
    optionsChecked += data.options.length;
  } else if (authored.type === 'free_text') {
    const data = parseFreeTextData(card);
    assert.equal(data.prompt, authored.data.prompt);
    assert.equal(data.exampleAnswer, authored.data.sample_answer);
    assert.deepEqual(card.metadata.accepted_answers, authored.data.accepted_answers || []);
    assert.deepEqual(card.metadata.grading_policy, { mode: 'open_text', typo_tolerance: true,
      semantic_equivalence: true, grammar_requires_retry: true, case_sensitive: false,
      punctuation_sensitive: false, max_retries: 3, ...authored.data.grading_policy });
  } else {
    assert.equal(content.exercise, authored.type === 'theory' ? authored.data.text : authored.data.prompt);
    assert.equal(card.back, authored.type === 'theory' ? authored.data.summary || '' : authored.data.answer);
  }
}
console.log(JSON.stringify({ cards: legacy.cards.length, gaps: gapsChecked, pairs: pairsChecked, tokens: tokensChecked, options: optionsChecked }));
