import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCardType, detectExerciseType, detectAiQuickActionType } from '../exerciseDetector.js';
import { parseExerciseContent, restoreExerciseContent } from '../exerciseContentParser.js';
import { parseBatchCardsText, detectCardTypeByContent } from '../batchCardParser.js';
import { readableFrontText } from '../cardEditorSyntax.js';
import { cleanBracketSyntax } from '../clozeParser.js';

test('Theory is explicit card metadata and never selects an interactive exercise', () => {
  for (const body of ['Warum?', 'Warum?\n\n*Ein Grund\nEin anderer Grund', 'Form: [[hätte]] {*wäre|ist}', '@puzzle\nIch lerne.']) {
    const front = `  @THEORY  \r\n${body}`;
    assert.equal(detectCardType(front), 'theory');
    assert.equal(detectCardTypeByContent(front), 'theory');
    for (const mode of ['classic', 'trainer', 'puzzle']) {
      assert.equal(detectExerciseType({ front, card_type: 'quiz' }, mode), null);
    }
    assert.equal(detectAiQuickActionType(front), null);
  }
});

test('Theory projection hides only standalone metadata and retains information blocks', () => {
  const raw = '@theory\n::task\nПравило\n::exercise\nWarum?\n::source\nHinweis';
  const parsed = parseExerciseContent(raw);
  assert.equal(parsed.isTheory, true);
  assert.equal(parsed.exercise, 'Warum?');
  assert.equal(parsed.task, 'Правило');
  assert.equal(parsed.source, 'Hinweis');
  assert.ok(parsed.blocks.every(b => !b.content.includes('@theory')));
  assert.equal(cleanBracketSyntax('@theory\nWarum?'), 'Warum?');
  assert.equal(readableFrontText('@theory\nWarum?'), 'Warum?');
  for (const literal of ['Use @theory here', '@theory_other\nText', '::source\nQuoted:\n@theory\nText']) {
    assert.equal(detectCardType(literal), null);
  }
});

test('Theory after an information block works with or without ::exercise', () => {
  for (const marker of ['', '::exercise\n']) {
    const front = `::task\nПравило\n\n${marker}@theory\nWarum?`;
    assert.equal(detectCardType(front), 'theory');
    assert.equal(parseExerciseContent(front).exercise, 'Warum?');
  }
});

test('batch import preserves Theory FRONT/BACK/CONTEXT without extracting quiz answers', () => {
  const front = '@theory\nWarum?\n\n*Theorie\nBeispiel';
  const [card, quiz] = parseBatchCardsText(`FRONT:\n${front}\nBACK:\nCONTEXT:\nПояснение\n<<<LERNE_CARD>>>\nFRONT:\nWo?\n\n*Hier\nDort\nBACK:\nCONTEXT:`);
  assert.equal(card.card_type, 'theory');
  assert.equal(card.front, front);
  assert.equal(card.back, '');
  assert.equal(card.context, 'Пояснение');
  assert.equal(quiz.card_type, 'quiz');
});

test('restoring AI content retains Theory metadata and information', () => {
  for (const raw of ['@theory\nWarum?', '@theory\n::source\nHint\n::exercise\nWarum?']) {
    for (const generated of ['Neue Erklärung', '@theory\nNeue Erklärung']) {
      const restored = restoreExerciseContent(parseExerciseContent(raw), generated);
      assert.equal(detectCardType(restored), 'theory');
      assert.equal(parseExerciseContent(restored).exercise, 'Neue Erklärung');
      assert.equal(parseExerciseContent(restored).source, parseExerciseContent(raw).source);
      assert.equal((restored.match(/@theory/gi) || []).length, 1);
    }
  }
});
