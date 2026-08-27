import { parseBatchCardsText } from '../app/src/utils/batchCardParser.js';
import { parseQuizData } from '../app/src/utils/quizParser.js';

const sampleText = `
In Deutschland können Eltern bis zum 14. Lebensjahr ihres Kindes entscheiden, ob es in der Schule am …

Geschichtsunterricht teilnimmt.
*Religionsunterricht teilnimmt.
Politikunterricht teilnimmt.
Sprachunterricht teilnimmt.
---
Deutschland ist ein Rechtsstaat. Was ist damit gemeint?

*Alle Einwohner / Einwohnerinnen und der Staat müssen sich an die Gesetze halten.
Der Staat muss sich nicht an die Gesetze halten.
Nur Deutsche müssen die Gesetze befolgen.
Die Gerichte machen die Gesetze.
---
Welches Recht gehört zu den Grundrechten in Deutschland?

Waffenbesitz
Faustrecht
*Meinungsfreiheit
Selbstjustiz
---
Wahlen in Deutschland sind frei. Was bedeutet das?

Man darf Geld annehmen, wenn man dafür einen bestimmten Kandidaten / eine bestimmte Kandidatin wählt.
Nur Personen, die noch nie im Gefängnis waren, dürfen wählen.
*Der Wähler darf bei der Wahl weder beeinflusst noch zu einer bestimmten Stimmabgabe gezwungen werden und keine Nachteile durch die Wahl haben.
Alle wahlberechtigten Personen müssen wählen.
---
Wie heißt die deutsche Verfassung?

Volksgesetz
Bundesgesetz
Deutsches Gesetz
*Grundgesetz
---
Welches Recht gehört zu den Grundrechten, die nach der deutschen Verfassung garantiert werden? Das Recht auf …

*Glaubens- und Gewissensfreiheit.
Unterhaltung.
Arbeit.
Wohnung.
---
Was steht nicht im Grundgesetz von Deutschland?

Die Würde des Menschen ist unantastbar.
*Alle sollen gleich viel Geld haben.
Jeder Mensch darf seine Meinung sagen.
Alle sind vor dem Gesetz gleich.
---
Welches Grundrecht gilt in Deutschland nur für Ausländer / Ausländerinnen? Das Grundrecht auf …

Schutz der Familie
Menschenwürde
*Asyl
Meinungsfreiheit
---
Was ist mit dem deutschen Grundgesetz vereinbar?

die Prügelstrafe
die Folter
die Todesstrafe
*die Geldstrafe
---
Wie wird die Verfassung der Bundesrepublik Deutschland genannt?

*Grundgesetz
Bundesverfassung
Gesetzbuch
Verfassungsvertrag
---
`;

const cards = parseBatchCardsText(sampleText);
console.log(`Parsed ${cards.length} cards:`);
cards.forEach((c, idx) => {
  const qData = parseQuizData(c);
  if (!qData || !qData.isQuiz) {
    console.error(`FAILED: Card ${idx + 1} not recognized by parseQuizData!`);
    process.exit(1);
  }
  console.log(`[${idx + 1}] Type: ${c.card_type} | Level: ${c.level} | Options: ${qData.options.length} | Answer: ${qData.correctAnswerText}`);
  console.log(`    Question: ${qData.question.substring(0, 60)}...`);
});

if (cards.length !== 10) {
  console.error(`FAILED: Expected 10 cards, got ${cards.length}`);
  process.exit(1);
}

console.log(`\nALL 10 QUIZ CARDS PARSED AND VALIDATED BY parseQuizData (100% PASS)!`);


console.log(`\nALL 10 QUIZ CARDS VERIFIED BY parseQuizData!`);
console.log(`Card 1 parsed quiz options:`);
const q1 = parseQuizData(cards[0]);
console.log(`- Question: ${q1.question}`);
console.log(`- Correct answer: ${q1.correctAnswerText}`);
console.log(`- Option count: ${q1.options.length}`);

