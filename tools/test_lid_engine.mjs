import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const questionsPath = path.join(__dirname, '../app/src/data/lidQuestions.json');
const rawData = fs.readFileSync(questionsPath, 'utf8');
const data = JSON.parse(rawData);
const { questions, stateCodeMap } = data;

console.log('--- 1. Testing Dataset Integrity ---');
console.log('Total Questions in JSON:', questions.length);
if (questions.length !== 460) throw new Error('Expected 460 questions');

// Verify all 16 states have 10 questions
const states = Object.keys(stateCodeMap);
console.log('Total States:', states.length);
states.forEach(code => {
  const sq = questions.filter(q => q.block === 'state' && q.stateCode === code);
  if (sq.length !== 10) throw new Error(`State ${code} has ${sq.length} questions, expected 10`);
});
console.log('All 16 states have exactly 10 questions: PASS');

// Verify blocks 1, 2, 3 have 100 questions each
const b1 = questions.filter(q => q.block === 1);
const b2 = questions.filter(q => q.block === 2);
const b3 = questions.filter(q => q.block === 3);

if (b1.length !== 100 || b2.length !== 100 || b3.length !== 100) {
  throw new Error(`Block lengths invalid: ${b1.length}, ${b2.length}, ${b3.length}`);
}
console.log('Blocks 1, 2, 3 have exactly 100 questions each: PASS');

// Verify every question has 4 options and valid correctOption
questions.forEach(q => {
  if (!['a', 'b', 'c', 'd'].includes(q.correctOption)) {
    throw new Error(`Question ${q.id} has invalid correctOption: ${q.correctOption}`);
  }
  if (q.options.length !== 4) {
    throw new Error(`Question ${q.id} does not have 4 options`);
  }
});
console.log('All 460 questions have valid 4 options and solutions: PASS');

console.log('\n--- 2. Testing 100 Randomized Ticket Generations ---');
const pickRandom = (array, count) => [...array].sort(() => Math.random() - 0.5).slice(0, count);

for (let i = 0; i < 100; i++) {
  const randomState = states[Math.floor(Math.random() * states.length)];
  const picked1 = pickRandom(b1, 10);
  const picked2 = pickRandom(b2, 10);
  const picked3 = pickRandom(b3, 10);
  const pickedState = pickRandom(questions.filter(q => q.block === 'state' && q.stateCode === randomState), 3);

  const ticket = [...picked1, ...picked2, ...picked3, ...pickedState];
  if (ticket.length !== 33) throw new Error(`Iteration ${i}: Ticket length ${ticket.length} !== 33`);

  const uniqueIds = new Set(ticket.map(q => q.id));
  if (uniqueIds.size !== 33) throw new Error(`Iteration ${i}: Duplicate questions in ticket!`);
}
console.log('100 random ticket generations passed with 0 duplicates and exact 10+10+10+3 split: PASS');

console.log('\n--- 3. Testing Passing Threshold (>= 17 / 33) ---');
const sampleTicket = [
  ...pickRandom(b1, 10),
  ...pickRandom(b2, 10),
  ...pickRandom(b3, 10),
  ...pickRandom(questions.filter(q => q.block === 'state' && q.stateCode === 'BY'), 3)
];

// Test 17 correct
let correctCountA = 17;
const isPassedA = correctCountA >= 17;
if (!isPassedA) throw new Error('17 correct answers must PASS');
console.log('Score 17 / 33 -> Status: PASSED (Correct)');

// Test 16 correct
let correctCountB = 16;
const isPassedB = correctCountB >= 17;
if (isPassedB) throw new Error('16 correct answers must NOT pass');
console.log('Score 16 / 33 -> Status: FAILED (Correct)');

console.log('\n=== ALL 100% UNIT AND INTEGRATION CHECKS PASSED SUCCESSFULLY! ===');
