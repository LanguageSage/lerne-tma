import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEditorFields, replaceEditorRange, addVisualElement, insertEditorCommand, editorCommands } from '../cardEditorSyntax.js';
import { parseExerciseContent } from '../exerciseContentParser.js';
import { parseClozeData } from '../clozeParser.js';
import { parseMatchData } from '../matchParser.js';
import { parseFreeTextData } from '../freeTextParser.js';
import { detectExerciseType } from '../exerciseDetector.js';
import { parseBatchCardsText } from '../batchCardParser.js';

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

test('raw insertion replaces selection at the cursor, retaining both surrounding parts', () => {
  const result = insertEditorCommand('AB', 'input', 1);
  assert.equal(result.text, 'A[[Berlin]]B');
  assert.equal(result.cursor, 11);
  assert.equal(insertEditorCommand('AB', 'choice', 0, 1).text, '{*Berlin|Hamburg|München}B');
  assert.equal(insertEditorCommand('AB', 'task', 1).text, 'A\n::task\nB');
});

test('unknown and ambiguous legacy syntax is not converted or lost', () => {
  const legacy = ['::future\nDATA', '@wordbank\n<<1>>\n@options\nA', '[alt]', '::task\nTask\n\nLegacy body', '@match\nA -> B\nC — D'];
  for (const raw of legacy) {
    assert.equal(projectEditorFields(raw), null);
    assert.equal(insertEditorCommand(raw, 'unknown').text, raw);
  }
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
