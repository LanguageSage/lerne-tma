/**
 * tools/test_js_classifier.mjs
 *
 * Runs the 19 test cases against the JS classifier to ensure 100% parity with Python.
 */

import { classifySentenceFast } from '../app/src/services/classifier/index.js';

const tests = [
  ['Ich lerne Deutsch.', 'A1'],
  ['Das ist sehr schön.', 'A1'],
  ['Er kann schwimmen.', 'A1'],
  ['Ich bin da.', 'A1'],
  ['Ich habe das Passwort falsch eingegeben.', 'A2'],
  ['Ich habe ein Buch gekauft.', 'A2'],
  ['Er ist gestern nach Berlin gefahren.', 'A2'],
  ['Ich habe gehört, dass die Musik schön ist.', 'A2'],
  ['Sie konnte nicht kommen.', 'A2'],
  ['Ich freue mich auf das Wochenende.', 'A2'],
  ['Ich möchte einen Kaffee, bitte.', 'A2'],
  ['Lassen Sie sich Zeit.', 'A2'],
  ['Ich lerne Deutsch, um in Deutschland zu arbeiten.', 'B1'],
  ['Das Auto wird repariert.', 'B1'],
  ['Das ist der Mann, den ich gestern gesehen habe.', 'B1'],
  ['Obwohl ich müde bin, gehe ich arbeiten.', 'B1'],
  ['Wegen des Regens blieben wir zu Hause.', 'B1'],
  ['Gut, wir machen es so, wie du denkst.', 'B1'],
  ['Ich weiß nicht, wie das funktioniert.', 'B1'],
  ['Er fragt, wo der Bahnhof ist.', 'B1'],
  ['Ich werde morgen Deutsch lernen.', 'B1'],
  ['Während des Regens bleiben wir zu Hause.', 'B1'],
  ['Je mehr ich lerne, desto besser spreche ich.', 'B2'],
  ['Das Dokument ist verschlüsselt worden.', 'B2'],
  ['Das Formular muss ausgefüllt werden.', 'B2'],
  ['Das Problem ist zu lösen.', 'C1'],
  ['Das lässt sich leicht erklären.', 'C1'],
];

let passed = 0;
let failed = 0;

console.log('\nLerne TMA — Frontend JS Classifier Test\n' + '─'.repeat(70));

for (const [phrase, expected] of tests) {
  const r = classifySentenceFast(phrase, 'de');
  const actual = r.level;
  const conf = r.confidence;
  const ok = actual === expected ? '✅ PASS' : '❌ FAIL';

  if (actual === expected) passed++;
  else failed++;

  const aiFlag = conf < 0.80 ? ' ->AI' : '';
  console.log(`${ok} conf=${conf.toFixed(2)}${aiFlag} [${actual}] (${r.reason_short}) | ${phrase}`);
  console.log(`     └─ Полная причина: ${r.reason}`);
}

console.log('─'.repeat(70));
console.log(`JS Test Results: ${passed}/${tests.length} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
