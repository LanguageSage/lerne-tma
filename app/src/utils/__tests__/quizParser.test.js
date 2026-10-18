import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuizData } from '../quizParser.js';
import { projectEditorFields } from '../cardEditorSyntax.js';

const question = 'Wähle die passende Fortsetzung.\n\nDer Bus hatte eine Panne.\nWir kamen zu spät.\n\n\nWelche Aussage passt?';
const answers = ['Wir kamen pünktlich.', 'Wir kamen wegen einer Panne zu spät.', 'Wir blieben zu Hause.'];

// FRONT content from B1-29-D02_Услышь_и_ответь.md, cards 1–3.
const b1Cases = [
  {
    task: 'Экскурсия: пойми ограничение по времени и месту',
    question: 'A: «Der Raum im Museum ist am Samstag leider schon reserviert.»\n\nВыбери ответ B, который учитывает сказанное:',
    answers: [
      'Schade. Ist der Raum vielleicht am Sonntag frei?',
      'Gut, dann treffen wir uns am Samstag in diesem Raum.',
      'Super! Ich bringe einen Kuchen für Samstag mit.',
    ],
    correct: 0,
  },
  {
    task: 'Праздник курса: учти график работы партнёра',
    question: 'A: «Am Freitag muss ich bis 19 Uhr arbeiten.»\n\nЧто лучше ответить, если вы планировали встречу в 17:00?',
    answers: [
      'Kein Problem, dann sehen wir uns am Freitag um 17 Uhr.',
      'Dann ist 17 Uhr zu früh. Wäre Samstag für dich besser?',
      'Danke! Dann übernimmst du die Getränke um 17 Uhr.',
    ],
    correct: 1,
  },
  {
    task: 'Общий подарок: соотнеси бюджет и стоимость',
    question: 'A: «Wir haben zusammen nur 30 Euro gesammelt.»\n\nВыбери разумное продолжение:',
    answers: [
      'Dann kaufen wir den Gutschein für 50 Euro.',
      'Dann sammeln wir das Geld erst morgen, obwohl es schon da ist.',
      'Dann sollten wir ein Geschenk für höchstens 30 Euro aussuchen.',
    ],
    correct: 2,
  },
];

for (const [index, fixture] of b1Cases.entries()) {
  for (const starBeforeLetter of [true, false]) {
    test(`B1-29-D02 card ${index + 1}: ${starBeforeLetter ? '*B)' : 'B) *'} answer notation`, () => {
      const options = fixture.answers.map((text, id) => {
        const label = `${String.fromCharCode(65 + id)}) `;
        if (id !== fixture.correct) return label + text;
        return starBeforeLetter ? `*${label}${text}` : `${label}*${text}`;
      });
      const front = `::task\n${fixture.task}\n::exercise\n${fixture.question}\n\n${options.join('\n')}`;
      const fields = projectEditorFields(front);
      const parsed = parseQuizData({ front });
      assert.equal(fields.find(field => field.sectionType === 'quiz').value, fixture.question);
      assert.equal(parsed.question, fixture.question);
      assert.deepEqual([...parsed.options].sort((a, b) => a.id - b.id), fixture.answers.map((text, id) => ({
        id, text, isCorrect: id === fixture.correct,
      })));
      assert.equal(parsed.correctAnswerId, fixture.correct);
      assert.equal(parsed.correctAnswerText, fixture.answers[fixture.correct]);
    });
  }
}

const formats = [
  ['star', [answers[0], `*${answers[1]}`, answers[2]]],
  ['letters', [`A) ${answers[0]}`, `B) *${answers[1]}`, `C) ${answers[2]}`]],
  ['checkboxes', [`[ ] ${answers[0]}`, `[*] ${answers[1]}`, `[x] ${answers[2]}`]],
  ['numbers', [`1. ${answers[0]}`, `2. *${answers[1]}`, `3. ${answers[2]}`]],
  ['bullets', [`- ${answers[0]}`, `- *${answers[1]}`, `- ${answers[2]}`]],
  ['circles', [`○ ${answers[0]}`, `○ *${answers[1]}`, `○ ${answers[2]}`]],
  ['dots', [`• ${answers[0]}`, `• *${answers[1]}`, `• ${answers[2]}`]],
];

for (const [format, options] of formats) {
  for (const newline of ['\n', '\r\n']) {
    test(`quiz keeps every question paragraph and parses ${format} options (${JSON.stringify(newline)})`, () => {
      const front = `::exercise\n${question}\n\n${options.join('\n')}`.replace(/\n/g, newline);
      const parsed = parseQuizData({ front });
      assert.ok(parsed);
      assert.equal(parsed.question, question);
      assert.deepEqual([...parsed.options].sort((a, b) => a.id - b.id), answers.map((text, id) => ({
        id, text, isCorrect: id === 1,
      })));
      assert.equal(parsed.correctAnswerId, 1);
      assert.equal(parsed.correctAnswerText, answers[1]);
    });
  }
}

for (const options of [
  [`*${answers[1]}`, `- ${answers[0]}`, `- ${answers[2]}`],
  [`A) ${answers[0]}`, `B) *${answers[1]}`, `C) ${answers[2]}`],
  [`[ ] ${answers[0]}`, `[*] ${answers[1]}`, `[ ] ${answers[2]}`],
]) {
  test(`quiz uses the same question boundary as the editor: ${options[0]}`, () => {
    const front = `${question}\n${options.join('\n')}`;
    const fields = projectEditorFields(front);
    assert.ok(fields);
    assert.equal(fields[0].value, question);
    const parsed = parseQuizData({ front_text: front });
    assert.equal(parsed.question, fields[0].value);
    assert.deepEqual(parsed.options.map(option => option.text).sort(), [...answers].sort());
    assert.equal(parsed.correctAnswerText, answers[1]);
  });
}

test('legacy unprefixed options retain wrong answers before and after the correct answer', () => {
  for (const correctIndex of [0, 1, 2]) {
    const options = [...answers];
    const [correct] = options.splice(1, 1);
    options.splice(correctIndex, 0, `*${correct}`);
    const parsed = parseQuizData({ front: `Wo?\n\n${options.join('\n')}` });
    assert.ok(parsed);
    assert.equal(parsed.question, 'Wo?');
    assert.equal(parsed.options.length, 3);
    assert.equal(parsed.correctAnswerId, correctIndex);
    assert.equal(parsed.correctAnswerText, correct);
    assert.deepEqual(parsed.options.map(option => option.text).sort(), [...answers].sort());
  }
});

test('quiz ignores bold question lines and trainer markers when locating options', () => {
  const parsed = parseQuizData({ front: '**Wähle.**\n\n{*eins|zwei}\n[[*drei]]\n\nA) *Berlin\nB) Bonn' });
  assert.ok(parsed);
  assert.equal(parsed.question, 'Wähle.\n\n__TRAINER_CHOICE__\n__TRAINER_INPUT__');
  assert.deepEqual(parsed.options.map(option => option.text).sort(), ['Berlin', 'Bonn']);
});

test('quiz still requires a question, two answers and a correct-answer marker', () => {
  for (const front of ['', 'Frage?\nA) Eins\nB) Zwei', 'Frage?\n*Eins', '*Eins\nZwei']) {
    assert.equal(parseQuizData({ front }), null);
  }
});
