import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEditorFields, readableFrontText, replaceEditorRange, insertEditorCommand, insertEditorLineAfter, editorCommands, editorCommandGroups, setQuizOptionCorrect, syncWordBankAnswer } from '../cardEditorSyntax.js';
import { parseExerciseContent, restoreExerciseContent } from '../exerciseContentParser.js';
import { parseClozeData } from '../clozeParser.js';
import { parseMatchData } from '../matchParser.js';
import { parseFreeTextData } from '../freeTextParser.js';
import { detectExerciseType } from '../exerciseDetector.js';
import { parseBatchCardsText } from '../batchCardParser.js';
import { parseQuizData } from '../quizParser.js';
import { parseWordBankData } from '../wordBankParser.js';

test('plain and empty cards project without transforming the original text', () => {
  for (const raw of ['', 'Hallo', '  Hallo\r\nWelt  ']) {
    const fields = projectEditorFields(raw);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].value, raw);
    assert.equal(replaceEditorRange(raw, fields[0].start, fields[0].end, fields[0].value), raw);
  }
});

test('explicit blocks and repeated examples retain whitespace and CRLF on no-op edits', () => {
  const raw = '::task\r\n  Frage? \r\n\r\n::example\r\nBeispiel\r\n::example\r\nNoch eins\r\n::exercise\r\nIch {*bin/bist} [[hier]].  ';
  const fields = projectEditorFields(raw);
  assert.ok(fields);
  for (const field of fields) assert.equal(replaceEditorRange(raw, field.start, field.end, field.value), raw);
  const input = fields.find(f => f.kind === 'input');
  assert.equal(replaceEditorRange(raw, input.start, input.end, '[[dort]]'), raw.replace('[[hier]]', '[[dort]]'));
});

test('an empty task block is editable without changing the exercise', () => {
  let raw = '::task\n\n::exercise\nWo?';
  const task = projectEditorFields(raw).find(f => f.label === 'Задание');
  raw = replaceEditorRange(raw, task.start, task.end, 'Wähle.');
  assert.equal(parseExerciseContent(raw).task, 'Wähle.');
  assert.equal(parseExerciseContent(raw).exercise, 'Wo?');
});

test('choice and input commands use the existing trainer parser', () => {
  const choice = insertEditorCommand('', 'choice').text;
  assert.equal(parseClozeData({ front: choice }, 'trainer').correctAnswer, 'Berlin');
  assert.equal(projectEditorFields(choice)[0].kind, 'choice');
  const input = insertEditorCommand('', 'input').text;
  assert.equal(parseClozeData({ front: input }, 'trainer').gaps[0].mode, 'input');
  assert.equal(projectEditorFields(input)[0].kind, 'input');
  assert.equal(projectEditorFields('{*|B}')[0].kind, 'choice');
  assert.equal(projectEditorFields('[[]]')[0].kind, 'input');
});

test('match/free/puzzle commands create existing types and retain the preceding question', () => {
  const match = `::task\nVerbinde.\n\n::exercise\n${insertEditorCommand('', 'match').text}`;
  assert.equal(parseMatchData(match).pairs.length, 2);
  assert.equal(parseExerciseContent(match).task, 'Verbinde.');
  assert.equal(projectEditorFields(match).filter(f => f.kind === 'pair').length, 2);
  const free = insertEditorCommand('', 'free').text;
  assert.equal(parseFreeTextData({ front: free, back: 'Beispiel' }).exampleAnswer, 'Beispiel');
  assert.equal(detectExerciseType(insertEditorCommand('', 'puzzle').text), 'puzzle');
});

test('trainer sentence segments keep inline gap positions and answers below', () => {
  const raw = 'Ich [[lerne]] heute {*Deutsch|Englisch}.';
  const fields = projectEditorFields(raw);
  assert.deepEqual(fields.map(field => field.kind), ['text', 'input', 'text', 'choice', 'text']);
  assert.ok(fields.every(field => field.sectionType === 'trainer'));
  const changed = replaceEditorRange(raw, fields[0].start, fields[0].end, 'Wir ');
  assert.equal(changed, 'Wir [[lerne]] heute {*Deutsch|Englisch}.');
  assert.equal(parseClozeData({ front: changed }, 'trainer').gaps.length, 2);
});

test('match pairs expose editable text for each supported separator', () => {
  const raw = '@match\nVerbinde.\nBerlin => Deutschland\nWien -> Österreich\nParis — Frankreich\nRom = Italien';
  const fields = projectEditorFields(raw);
  assert.deepEqual(fields.map(field => field.kind), ['text', 'pair', 'pair', 'pair', 'pair']);
  for (const field of fields) assert.equal(replaceEditorRange(raw, field.start, field.end, field.value), raw);
  const changed = replaceEditorRange(raw, fields[2].start, fields[2].end, 'Graz -> Österreich');
  assert.equal(parseMatchData(changed).pairs[1].left, 'Graz');
});

test('quiz question and options edit without exposing markers', () => {
  const raw = 'Wo liegt Berlin?\r\n\r\nA) *Deutschland\r\nB) Österreich';
  const fields = projectEditorFields(raw);
  assert.deepEqual(fields.map(field => field.kind), ['text', 'quiz-option', 'quiz-option']);
  for (const field of fields) assert.equal(replaceEditorRange(raw, field.start, field.end, field.value), raw);
  assert.equal(fields[1].display, 'Deutschland');
  const changed = replaceEditorRange(raw, fields[2].start, fields[2].end, setQuizOptionCorrect(fields[2], true));
  assert.equal(changed, 'Wo liegt Berlin?\r\n\r\nA) *Deutschland\r\nB) *Österreich');
  assert.equal(parseQuizData({ front: changed }).options.filter(option => option.isCorrect).length, 2);
});

test('adding a quiz option creates an editable answer below the existing ones', () => {
  const raw = 'Wo?\r\n\r\n*Berlin\r\nHamburg';
  const last = projectEditorFields(raw).at(-1);
  const added = insertEditorLineAfter(raw, last, '- ');
  assert.equal(added, 'Wo?\r\n\r\n*Berlin\r\nHamburg\r\n- ');
  const option = projectEditorFields(added).at(-1);
  assert.equal(option.kind, 'quiz-option');
  assert.equal(option.display, '');
  const filled = replaceEditorRange(added, option.start, option.end, '- München');
  assert.equal(parseQuizData({ front: filled }).options.length, 3);
});

test('adding a matching pair creates two editable sides', () => {
  const raw = '@match\nBerlin => Deutschland\nWien -> Österreich';
  const last = projectEditorFields(raw).at(-1);
  const added = insertEditorLineAfter(raw, last, ' => ');
  const pair = projectEditorFields(added).at(-1);
  assert.equal(pair.kind, 'pair');
  assert.equal(pair.value.slice(0, pair.separator), '');
  assert.equal(pair.value.slice(pair.separator + pair.separatorLength), '');
  const filled = replaceEditorRange(added, pair.start, pair.end, 'Paris => Frankreich');
  assert.equal(parseMatchData(filled).pairs.length, 3);
});

test('wordbank sentence and options project as editable ranges', () => {
  const raw = '@wordbank\r\nIch trinke <<31>>.\r\n@options\r\nMilch | Tee';
  const fields = projectEditorFields(raw);
  assert.deepEqual(fields.map(field => field.kind), ['text', 'wordbank-gap', 'text', 'wordbank-option', 'wordbank-option']);
  for (const field of fields) assert.equal(replaceEditorRange(raw, field.start, field.end, field.value), raw);
  const option = fields.find(field => field.kind === 'wordbank-option' && field.value.includes('Tee'));
  const changed = replaceEditorRange(raw, option.start, option.end, 'Kaffee');
  assert.equal(parseWordBankData({ front: changed, back: '31=Milch' }).options[1].value, 'Kaffee');
  const answer = syncWordBankAnswer('31=Milch\r\n32 = Tee  ', 'Tee', 'Kaffee');
  assert.equal(answer, '31=Milch\r\n32 = Kaffee  ');
  const milk = fields.find(field => field.kind === 'wordbank-option' && field.value.includes('Milch'));
  const updatedFront = replaceEditorRange(raw, milk.start, milk.end, 'Wasser ');
  const updatedBack = syncWordBankAnswer('31=Milch', 'Milch', 'Wasser');
  assert.equal(parseWordBankData({ front: updatedFront, back: updatedBack }).gaps[0].correctAnswer, 'Wasser');
  assert.equal(syncWordBankAnswer('31=Ice cream', 'Ice cream', 'Sorbet', ['Ice cream', 'ice   cream']),
    '31=Ice cream');
});

test('quiz and wordbank stay editable after an implicit information block', () => {
  const quiz = '::task\nWähle.\n\nWo?\n\n*Berlin\nHamburg';
  const wordbank = '::task\nErgänze.\n\n@wordbank\nIch <<1>>.\n@options\nlerne | lese';
  assert.deepEqual(projectEditorFields(quiz).map(field => field.kind),
    ['text', 'text', 'quiz-option', 'quiz-option']);
  assert.deepEqual(projectEditorFields(wordbank).map(field => field.kind),
    ['text', 'text', 'wordbank-gap', 'text', 'wordbank-option', 'wordbank-option']);
});

test('raw insertion replaces selection at the cursor, retaining both surrounding parts', () => {
  const result = insertEditorCommand('AB', 'input', 1);
  assert.equal(result.text, 'A[[Berlin]]B');
  assert.equal(result.cursor, 11);
  assert.equal(insertEditorCommand('AB', 'choice', 0, 1).text, '{*Berlin|Hamburg|München}B');
  assert.equal(insertEditorCommand('AB', 'task', 1).text, 'A\n::task\nB');
});

test('unknown and ambiguous legacy syntax is not converted or lost', () => {
  const legacy = ['::future\nDATA', '[alt]', '::task\nTask\n\nLegacy body'];
  for (const raw of legacy) {
    assert.equal(projectEditorFields(raw), null);
    assert.equal(insertEditorCommand(raw, 'unknown').text, raw);
  }
});

test('ambiguous front markup has a readable preview without changing stored text', () => {
  const raw = '::task\r\nWähle die Antwort.\r\n\r\n::future\r\nHinweis\r\n@wordbank\r\nIch [[lerne]] {*Deutsch|Englisch}.';
  assert.equal(projectEditorFields(raw), null);
  assert.equal(readableFrontText(raw), 'Wähle die Antwort.\n\nHinweis\nIch lerne Deutsch.');
  assert.ok(raw.includes('::future'));
});

test('every information block is editable without changing other blocks', () => {
  for (const command of editorCommands.filter(c => c.info && !['exercise', 'hint'].includes(c.id))) {
    const raw = `${command.template}\n::exercise\nHallo`;
    const field = projectEditorFields(raw).find(f => f.label === command.label);
    assert.ok(field, command.id);
    const changed = replaceEditorRange(raw, field.start, field.end, 'Wert ');
    assert.equal(parseExerciseContent(changed).exercise, 'Hallo');
    assert.ok(projectEditorFields(changed).find(f => f.label === command.label).value.endsWith(' '));
  }
});

test('editor output remains compatible with strict batch import', () => {
  const front = `::task\n\n::exercise\n${insertEditorCommand('', 'choice').text}`;
  const imported = parseBatchCardsText(`FRONT:\n${front}\nBACK:\nAnswer\nCONTEXT:\nNote`);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].front, front.trim());
  assert.equal(imported[0].back, 'Answer');
});

test('hint toolbar action generates only the official source marker', () => {
  assert.equal(editorCommandGroups.length, 2);
  const exerciseGroup = editorCommandGroups.find(g => g.id === 'exercise');
  const markerGroup = editorCommandGroups.find(g => g.id === 'marker');

  assert.ok(exerciseGroup);
  assert.ok(markerGroup);
  assert.deepEqual(exerciseGroup.commands.map(c => c.id), ['puzzle', 'match', 'free', 'choice', 'input', 'ending']);
  assert.deepEqual(markerGroup.commands.map(c => c.id), ['task', 'hint', 'example', 'source', 'exercise', 'options', 'topic', 'level']);

  const withHint = insertEditorCommand('', 'hint').text;
  assert.equal(withHint, '::source\n');
  assert.ok(editorCommands.every(command => !command.template.includes('::hint')));
});

test('saved hint blocks remain editable and are read as source', () => {
  const cardWithHint = `::task\nAufgabe\n\n::hint\nTipp\n\n::exercise\nHallo [[Welt]].`;
  const fields = projectEditorFields(cardWithHint);
  assert.ok(fields);
  const hintField = fields.find(f => f.label === 'Исходный текст');
  assert.ok(hintField);
  assert.equal(hintField.value.trim(), 'Tipp');

  const parsed = parseExerciseContent(cardWithHint);
  assert.equal(parsed.source, 'Tipp');
  assert.equal(parsed.blocks[1].type, 'source');
  assert.equal(parsed.task, 'Aufgabe');
  assert.equal(parsed.exercise, 'Hallo [[Welt]].');
  assert.equal(replaceEditorRange(cardWithHint, hintField.start, hintField.end, hintField.value), cardWithHint);
  const restored = restoreExerciseContent(parsed, 'Neu [[hier]].');
  assert.ok(restored.includes('::source\nTipp'));
  assert.ok(!restored.includes('::hint'));
});

test('source insertion follows task content without replacing selected text', () => {
  const exercise = '::exercise\nDas ist ein [[schönes]] Haus.';
  for (const task of ['Заполни пропуск.', 'Первая строка.\nВторая строка.\n\nПоследняя строка.']) {
    for (const next of [exercise, `::example\nEin Haus.\n\n${exercise}`, `::options\nschönes | schönes?\n\n${exercise}`,
      `::options\nschönes\n\n::example\nEin Haus.\n\n${exercise}`]) {
      const before = `::task\n${task}\n\n`;
      const raw = before + next;
      for (const id of ['hint', 'source']) {
        for (const [start, end] of [[0, 0], [0, raw.length], [raw.length, raw.length]]) {
          const result = insertEditorCommand(raw, id, start, end);
          assert.equal(result.text, before + '::source\n\n\n' + next);
          assert.equal(result.cursor, before.length + '::source\n'.length);
          const parsed = parseExerciseContent(result.text);
          assert.equal(parsed.task, task);
          assert.equal(parsed.exercise, parseExerciseContent(raw).exercise);
        }
      }
    }
  }
});

test('existing source or legacy hint is focused without duplicate markers or text changes', () => {
  for (const marker of ['::source', '  ::SOURCE  ', '::hint']) {
    for (const content of ['', 'Перевод.\nКонтекст.']) {
      const before = `::task\nЗадание.\n\n${marker}\n`;
      const raw = before + content + '\n\n::exercise\nHallo [[Welt]].';
      for (const id of ['hint', 'source']) {
        assert.deepEqual(insertEditorCommand(raw, id, 0, raw.length), { text: raw, cursor: before.length });
      }
    }
  }
});

test('without task source is inserted directly before exercise, preserving preamble', () => {
  for (const preamble of ['', 'Вступление.\n\n', '::example\nПример.\n\n']) {
    const exercise = '::exercise\nHallo [[Welt]].';
    const result = insertEditorCommand(preamble + exercise, 'hint', 0);
    assert.equal(result.text, preamble + '::source\n\n\n' + exercise);
    assert.equal(result.cursor, preamble.length + '::source\n'.length);
  }
  assert.equal(insertEditorCommand('Обычный текст.', 'hint', 0).text, 'Обычный текст.\n\n::source\n');
});

test('source insertion preserves CRLF, marker casing, indentation and missing blank separators', () => {
  const raw = '  ::TASK  \r\n  Первая строка. \r\nВторая.\r\n ::EXERCISE \r\nHallo [[Welt]].';
  const before = '  ::TASK  \r\n  Первая строка. \r\nВторая.\r\n';
  const result = insertEditorCommand(raw, 'hint', 0);
  assert.equal(result.text, before + '\r\n::source\r\n\r\n\r\n' + raw.slice(before.length));
  assert.equal(result.cursor, before.length + '\r\n::source\r\n'.length);
  assert.equal(insertEditorCommand(result.text, 'hint').text, result.text);
  assert.equal(insertEditorCommand('::task\nМного\nстрок', 'hint', 0).text, '::task\nМного\nстрок\n\n::source\n');
});
