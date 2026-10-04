import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEditorFields, readableFrontText, replaceEditorRange, addVisualElement, insertEditorCommand, editorCommands, setQuizOptionCorrect, syncWordBankAnswer } from '../cardEditorSyntax.js';
import { parseExerciseContent } from '../exerciseContentParser.js';
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

test('task creation preserves the exercise and exposes an editable empty task', () => {
  let raw = addVisualElement('Wo?', 'task');
  const task = projectEditorFields(raw).find(f => f.label === 'Задание');
  raw = replaceEditorRange(raw, task.start, task.end, 'Wähle.');
  assert.equal(parseExerciseContent(raw).task, 'Wähle.');
  assert.equal(parseExerciseContent(raw).exercise, 'Wo?');
});

test('visual choice and input templates use the existing trainer parser', () => {
  const choice = addVisualElement('', 'choice');
  assert.equal(parseClozeData({ front: choice }, 'trainer').correctAnswer, 'Berlin');
  assert.equal(projectEditorFields(choice)[0].kind, 'choice');
  const input = addVisualElement('', 'input');
  assert.equal(parseClozeData({ front: input }, 'trainer').gaps[0].mode, 'input');
  assert.equal(projectEditorFields(input)[0].kind, 'input');
  assert.equal(projectEditorFields('{*|B}')[0].kind, 'choice');
  assert.equal(projectEditorFields('[[]]')[0].kind, 'input');
});

test('match/free/puzzle create existing types and retain the preceding question', () => {
  const match = addVisualElement('Verbinde.', 'match');
  assert.equal(parseMatchData(match).pairs.length, 2);
  assert.equal(parseExerciseContent(match).task, 'Verbinde.');
  assert.equal(projectEditorFields(match).filter(f => f.kind === 'pair').length, 2);
  const free = addVisualElement('', 'free');
  assert.equal(parseFreeTextData({ front: free, back: 'Beispiel' }).exampleAnswer, 'Beispiel');
  assert.equal(detectExerciseType(addVisualElement('', 'puzzle')), 'puzzle');
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
  for (const command of editorCommands.filter(c => c.info && c.id !== 'exercise')) {
    const raw = addVisualElement('Hallo', command.id);
    const field = projectEditorFields(raw).find(f => f.label === command.label);
    assert.ok(field, command.id);
    const changed = replaceEditorRange(raw, field.start, field.end, 'Wert ');
    assert.equal(parseExerciseContent(changed).exercise, 'Hallo');
    assert.ok(projectEditorFields(changed).find(f => f.label === command.label).value.endsWith(' '));
  }
});

test('editor output remains compatible with strict batch import', () => {
  const front = addVisualElement(addVisualElement('', 'choice'), 'task');
  const imported = parseBatchCardsText(`FRONT:\n${front}\nBACK:\nAnswer\nCONTEXT:\nNote`);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].front, front.trim());
  assert.equal(imported[0].back, 'Answer');
});
