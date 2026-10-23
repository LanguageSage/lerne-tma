import test from 'node:test';
import assert from 'node:assert/strict';
import { getInteractiveExerciseContent, parseExerciseContent, restoreExerciseContent } from '../exerciseContentParser.js';
import { detectExerciseType } from '../exerciseDetector.js';
import { parseMatchData } from '../matchParser.js';
import { parseFreeTextData } from '../freeTextParser.js';
import { parseEditableTextData } from '../editableTextParser.js';
import { parseWordBankData } from '../wordBankParser.js';
import { parseBatchCardsText } from '../batchCardParser.js';

test('standalone interactive blocks do not depend on ::exercise position', () => {
  for (const [marker, type] of [['puzzle', 'puzzle'], ['match', 'match'], ['wordbank', 'word_bank'], ['free', 'free_text'], ['edit', 'editable_text']]) {
    const body = `@${marker}\nFirst line\n\nSecond line`;
    for (const [prefix, suffix] of [['', ''], ['::exercise\n', ''], ['', '\n::exercise\nTail']]) {
      const front = `::task\nInstructions\n\n${prefix}${body}${suffix}\n::example\nExample`;
      const parsed = parseExerciseContent(front);
      assert.equal(detectExerciseType(front), type, front);
      assert.ok(parsed.exercise.includes(body));
      assert.ok(!parsed.exercise.includes('::exercise'));
      assert.ok(!parsed.exercise.includes('Example'));
      assert.deepEqual(parsed.examples, ['Example']);
      assert.equal(parsed.blocks.filter(b => b.type === 'exercise' && b.content.startsWith('@')).length, 1);
      assert.ok(!parsed.blocks.some(b => b.type === 'exercise' && !b.content));
    }
  }
});

test('interactive markers inside information blocks stay literal', () => {
  for (const info of ['task', 'source', 'example']) {
    for (const marker of ['puzzle', 'match', 'wordbank', 'free', 'edit']) {
      for (const suffix of ['', '\n::exercise\nPlain text']) {
        const front = `::${info}\nQuoted marker:\n@${marker}\nLiteral text${suffix}`;
        assert.equal(detectExerciseType(front), null, front);
        assert.ok(!parseExerciseContent(front).exercise.includes('@' + marker));
      }
    }
  }
});

test('interactive markers require a complete line and allow whitespace/CRLF', () => {
  for (const marker of ['puzzle', 'match', 'wordbank', 'free', 'edit']) {
    for (const front of [`Use @${marker} here`, `@${marker} is a literal mention`, `@${marker}_other\nText`]) {
      assert.equal(detectExerciseType(front), null, front);
    }
    assert.notEqual(detectExerciseType(`  @${marker.toUpperCase()}  \r\nText`), null);
  }
});

test('editable text reads the source from FRONT and correction from BACK', () => {
  const card = {
    front: '::task\nCorrect the sentence.\n\n@edit\nIch trainiere, um ich stärker zu werden.\n::source\nЯ тренируюсь, чтобы стать сильнее.',
    back: 'Ich trainiere, um stärker zu werden.',
  };
  assert.equal(detectExerciseType(card), 'editable_text');
  assert.deepEqual(parseEditableTextData(card), {
    sourceText: 'Ich trainiere, um ich stärker zu werden.',
    correctText: card.back,
  });
  assert.equal(parseEditableTextData({ ...card, back: '' }), null);
  const imported = parseBatchCardsText(`FRONT:\n${card.front}\nBACK:\n${card.back}\nCONTEXT:\nRule`);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].card_type, 'editable_text');
  assert.equal(imported[0].back, card.back);
});

test('directives own their full body until the next structural marker', () => {
  const parsed = parseExerciseContent('@puzzle\nOne\n\nTwo\n@match\nA => B\nC => D\n::source\nHint');
  assert.deepEqual(parsed.blocks.filter(b => b.type === 'exercise').map(b => b.content),
    ['@puzzle\nOne\n\nTwo', '@match\nA => B\nC => D']);
  assert.equal(parsed.source, 'Hint');
  assert.equal(getInteractiveExerciseContent('@puzzle\nSentence\n::exercise\nTail', 'puzzle'), '@puzzle\nSentence');
  const free = parseFreeTextData('@free\nPrompt\n\nMore\n@puzzle\nSentence');
  assert.equal(free.prompt, 'Prompt\n\nMore');
  const match = parseMatchData('@match\nA => B\nC => D\n@free\nAnother prompt');
  assert.equal(match.pairs.length, 2);
  const bank = parseWordBankData({
    front: '@wordbank\nIch <<1>>.\n@options\nlerne\n@free\nAnother prompt', back: '1=lerne',
  });
  assert.equal(bank.options.length, 1);
});

test('restoring an exercise keeps information blocks before and after it', () => {
  const front = '::task\nInstructions\n\n@free\nPrompt\n::example\nExample';
  const parsed = parseExerciseContent(restoreExerciseContent(parseExerciseContent(front), '@free\nNew prompt'));
  assert.equal(parsed.task, 'Instructions');
  assert.deepEqual(parsed.examples, ['Example']);
  assert.equal(parsed.exercise, '@free\nNew prompt');
});
