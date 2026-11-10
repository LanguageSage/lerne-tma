import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findQuizOptionStart, parseQuizData } from '../quizParser.js';
import { detectCardType, detectExerciseType } from '../exerciseDetector.js';


const question = 'Wähle die passende Fortsetzung.\n\nDer Bus hatte eine Panne.\nWir kamen zu spät.\n\n\nWelche Aussage passt?';
const answers = ['Wir kamen pünktlich.', 'Wir kamen wegen einer Panne zu spät.', 'Wir blieben zu Hause.'];

test('explicit Quiz supports a question in information blocks without repeating a heading', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const gap of ['\n', '\n\n']) {
      const body = ['[ ] Ein Brief', '[*] Ein Forum', '[ ] Eine E-Mail'].join(gap);
      const front = `::task\nBestimme die Textsorte.\n::source\nWelche Textsorte passt?\n::exercise\n${body}`.replace(/\n/g, newline);
      assert.equal(detectCardType(front), 'quiz');
      assert.equal(detectExerciseType({ front_text: front, card_type: 'standard' }), 'quiz');
      const quiz = parseQuizData({ front });
      assert.ok(quiz);
      assert.equal(quiz.question, '');
      assert.equal(quiz.correctAnswerText, 'Ein Forum');
      assert.deepEqual([...quiz.options].sort((a, b) => a.id - b.id).map(option => option.text),
        ['Ein Brief', 'Ein Forum', 'Eine E-Mail']);



    }
  }
  for (const body of ['[*] Nur eine Antwort', '[ ] Eins\n[ ] Zwei', '[*] Eins\nErklärung\n[ ] Zwei']) {
    assert.equal(parseQuizData({ front: `::source\nFrage?\n::exercise\n${body}` }), null);
  }
  assert.equal(parseQuizData({ front: '::source\n[*] Eins\n[ ] Zwei\n::exercise\nNormaler Text' }), null);
});

const boundaries = JSON.parse(fs.readFileSync(new URL('../../../../tests/fixtures/quiz_boundaries.json', import.meta.url), 'utf8'));
const boundaryFormats = {
  checkboxes: (text, i, correct) => `${i === correct ? '[*]' : '[ ]'} ${text}`,
  letters: (text, i, correct) => `${String.fromCharCode(65 + i)})${i === correct ? '*' : ''}${text}`,
  numbers: (text, i, correct) => `${i + 1}. ${i === correct ? '*' : ''}${text}`,
  numberedParentheses: (text, i, correct) => `${i === correct ? '*' : ''}${i + 1})${text}`,
  dottedLetters: (text, i, correct) => `${i === correct ? '*' : ''}${String.fromCharCode(65 + i)}. ${text}`,
  bullets: (text, i, correct) => `- ${i === correct ? '*' : ''}${text}`,
  circles: (text, i, correct) => `○ ${i === correct ? '*' : ''}${text}`,
  dots: (text, i, correct) => `• ${i === correct ? '*' : ''}${text}`,
  star: (text, i, correct) => `${i === correct ? '*' : ''}${text}`,
};

for (const fixture of boundaries.examples) {
  for (const [format, render] of Object.entries(boundaryFormats)) {
    for (const newline of ['\n', '\r\n']) {
      test(`${fixture.name}: numbered question stays intact with ${format} (${JSON.stringify(newline)})`, () => {
        const optionLines = fixture.answers.map((text, i) => render(text, i, fixture.correct));
        const front = (fixture.preamble + fixture.question + fixture.gap + optionLines.join('\n')).replace(/\n/g, newline);
        const parsed = parseQuizData({ front });
        assert.ok(parsed);
        assert.equal(parsed.question, fixture.question);
        assert.deepEqual([...parsed.options].sort((a, b) => a.id - b.id), fixture.answers.map((text, id) => ({
          id, text, isCorrect: id === fixture.correct,
        })));






      });
    }
  }
}

for (const front of boundaries.ambiguous) {
  test(`ambiguous Quiz keeps source instead of guessing options: ${JSON.stringify(front)}`, () => {
    assert.equal(findQuizOptionStart(front.split('\n')), -1);
    assert.equal(parseQuizData({ front }), null);



  });
}

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
    question: 'A: «Wir haben zusammen nur 20 Euro gesammelt.»\n\nВыбери разумное продолжение:',
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

      const parsed = parseQuizData({ front });

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
  if (format !== 'star') {
    test(`quiz preserves a whole ${format} block with blank lines between answers`, () => {
      const front = `${question}\n\n${options.join('\n\n')}`;
      assert.equal(parseQuizData({ front }).question, question);

    });
  }
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



    const parsed = parseQuizData({ front_text: front });

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

test('editor and study share Quiz text formatting, checkbox markers and literal brackets', () => {
  for (const newline of ['\n', '\r\n']) {
    const front = ['**Welche Stadt** [in Deutschland] ?', '',
      '[*] Berlin ist *richtig* [Hauptstadt] .', '[ ] **Bonn** [früher] .', '[x] Hamburg *heute* .'].join(newline);

    const parsed = parseQuizData({ front });

    assert.equal(parsed.question, 'Welche Stadt [in Deutschland]?');

    assert.deepEqual([...parsed.options].sort((a, b) => a.id - b.id).map(option => option.isCorrect), [true, false, false]);
    assert.deepEqual([...parsed.options].sort((a, b) => a.id - b.id).map(option => option.text),
      ['Berlin ist richtig [Hauptstadt].', 'Bonn [früher].', 'Hamburg heute.']);
  }
});

test('bold answer text is formatting and does not mark an answer correct', () => {
  for (const prefix of ['A) ', '- ', '○ ', '• ', '[ ] ']) {
    const front = `**Wo** ?\n\n${prefix}**Bonn** [früher]\n*Berlin`;
    const parsed = parseQuizData({ front });

    assert.equal(parsed.correctAnswerText, 'Berlin');
    assert.equal(parsed.options.find(option => option.id === 0).text, 'Bonn [früher]');
    assert.equal(parsed.options.find(option => option.id === 0).isCorrect, false);
  }
});



test('B1-29-D02 compact A)Text labels preserve the full question and both answer notations', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../../../../tests/fixtures/quiz_compact_labels.json', import.meta.url), 'utf8'));
  const question = `A: «Wir haben zusammen nur 20 Euro gesammelt.»\n\nВыбери разумное продолжение:`;
  assert.equal(fixture.question, question);

  for (const starBeforeLabel of [true, false]) {
    const answers = fixture.answers.map((text, index) => {
      const label = `${String.fromCharCode(65 + index)})`;
      if (index !== fixture.correct) return label + text;
      return starBeforeLabel ? `*${label}${text}` : `${label}*${text}`;
    });
    const front = `::exercise\n${question}\n\n${answers.join('\n')}`;
    const parsed = parseQuizData({ front });

    assert.equal(parsed.question, question);
    assert.deepEqual(parsed.options.map(option => option.text).sort(), [...fixture.answers].sort());
    assert.equal(parsed.correctAnswerText, fixture.answers[fixture.correct]);


  }
});
