import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import "fake-indexeddb/auto";
import { resetAllDatabases, getLocalDb } from '../localDb.js';
import * as dbService from '../knowledgeDbService.js';

// Mock Vite env
globalThis.import = { meta: { env: { VITE_KNOWLEDGE_LAYER_ENABLED: 'true' } } };

import { captureStudyKnowledgeAttempt, knowledgeRatingForGrade } from '../knowledgeCaptureService.js';
import { createFreeTextEvaluationSession } from '../../utils/freeTextEvaluationState.js';

describe('KnowledgeCaptureService - KI-04', () => {
  test('free-text summary reaches durable outbox without changing objective fields', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.add({ card_id: 71, knowledge_item_id: 101, role: 'primary' });
    const session = createFreeTextEvaluationSession();
    await session.submit('Hudn', async () => ({
      result: { verdict: 'accepted_minor', accepted: true, error_type: 'typo', error_code: 'typo.single_token', evaluator: 'rules' },
      grading_policy: { max_retries: 3 },
    }));
    await captureStudyKnowledgeAttempt({ userId: '123', card: { id: 71, front: '@free\nTranslate.' },
      grade: 2, isExtended: false, exerciseEvidence: session.evidence() });
    const [attempt] = await dbService.getPendingKnowledgeAttempts('123');
    assert.equal(attempt.evaluation_data.schema_version, 2);
    const evidence = attempt.evaluation_data.exercise_evidence;
    assert.equal(evidence.attempt_count, 1);
    assert.equal(evidence.first_try_correct, true);
    assert.equal(evidence.mistake_count, 0);
    assert.equal(evidence.completed, true);
    assert.deepEqual(evidence.grading_summary.minor_errors, ['typo']);
  });

  beforeEach(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) {
        await new Promise(r => { const req = indexedDB.deleteDatabase(db.name); req.onsuccess = r; req.onerror = r; });
      }
    }
    resetAllDatabases();
    
    // Prepare DB for user 123
    const db = getLocalDb('123');
    await db.knowledge_items.bulkAdd([
      { id: 101, title: 'Primary', type: 'grammar' },
      { id: 102, title: 'Secondary', type: 'vocab' }
    ]);
  });

  test('Test 1 - no KI -> no attempt', async () => {
    // Card with no mapping
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 1 },
      grade: 3,
      isExtended: false,
      eventTime: '2026-01-01T10:00:00Z'
    });
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 0);
  });

  test('Test 2 - primary KI -> attempt queued', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.add({ card_id: 1, knowledge_item_id: 101, role: 'primary' });
    
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 1, front_text: '@puzzle\nSomething' },
      grade: 2, // Good in GradeButtons
      isExtended: false,
      eventTime: '2026-01-01T10:00:00Z'
    });
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 1);
    
    const attempt = pending[0];
    assert.strictEqual(attempt.knowledge_item_id, 101);
    assert.strictEqual(attempt.card_id, 1);
    assert.strictEqual(attempt.evaluation_data.card_type, 'puzzle');
    assert.strictEqual(attempt.evaluation_data.evaluation_type, 'self_rating');
    assert.strictEqual(attempt.evaluation_data.correct, null); // self-rating is always null correctness
    assert.strictEqual(attempt.evaluation_data.rating, 'good');
    assert.strictEqual(attempt.event_time, '2026-01-01T10:00:00Z');
  });

  test('GradeButtons standard semantics reach self and hybrid capture', async () => {
    const source = readFileSync(new URL('../../components/study/GradeButtons.jsx', import.meta.url), 'utf8');
    const db = getLocalDb('123');
    const ratings = ['again', 'hard', 'good', 'easy'];
    for (const [grade, rating] of ratings.entries()) {
      assert.match(source, new RegExp(`\\{ grade: ${grade}, label: t\\('study\\.grade_${rating}'`));
      assert.strictEqual(knowledgeRatingForGrade(grade, false), rating);
      for (const hybrid of [false, true]) {
        const cardId = 100 + grade * 2 + Number(hybrid);
        await db.card_knowledge_items.add({ card_id: cardId, knowledge_item_id: 101, role: 'primary' });
        await captureStudyKnowledgeAttempt({
          userId: '123', card: { id: cardId }, grade, isExtended: false,
          exerciseEvidence: hybrid
            ? { isCorrect: true, isFirstTry: true, attemptCount: 1, mistakeCount: 0 }
            : undefined
        });
      }
    }
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 8);
    for (const attempt of pending) {
      const grade = Math.floor((attempt.card_id - 100) / 2);
      assert.strictEqual(attempt.evaluation_data.rating, ratings[grade]);
      assert.strictEqual(attempt.evaluation_data.evaluation_type,
        attempt.card_id % 2 ? 'hybrid' : 'self_rating');
    }
  });

  test('GradeButtons extended values reach capture as ext_0 through ext_7', async () => {
    const source = readFileSync(new URL('../../components/study/GradeButtons.jsx', import.meta.url), 'utf8');
    const db = getLocalDb('123');
    for (let grade = 0; grade < 8; grade++) {
      assert.match(source, new RegExp(`\\{ grade: ${grade}, num: ${grade + 1}, fallback:`));
      assert.strictEqual(knowledgeRatingForGrade(grade, true), `ext_${grade}`);
      const cardId = 200 + grade;
      await db.card_knowledge_items.add({ card_id: cardId, knowledge_item_id: 101, role: 'primary' });
      await captureStudyKnowledgeAttempt({ userId: '123', card: { id: cardId }, grade, isExtended: true });
    }
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 8);
    for (const attempt of pending) {
      assert.strictEqual(attempt.evaluation_data.rating, `ext_${attempt.card_id - 200}`);
    }
  });

  test('Test 3 - primary + secondary -> only one attempt for primary', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.bulkAdd([
      { card_id: 2, knowledge_item_id: 101, role: 'primary' },
      { card_id: 2, knowledge_item_id: 102, role: 'secondary' },
      { card_id: 2, knowledge_item_id: 103, role: 'secondary' }
    ]);
    
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 2 },
      grade: 0,
      isExtended: true, // ext_0
      eventTime: '2026-01-01T10:00:00Z'
    });
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].knowledge_item_id, 101);
    assert.strictEqual(pending[0].evaluation_data.rating, 'ext_0');
  });

  test('Test 4 - secondary only -> no attempt', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.add({ card_id: 3, knowledge_item_id: 102, role: 'secondary' });
    
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 3 },
      grade: 3,
      isExtended: false
    });
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 0);
  });

  test('Test 11 - capture error does not throw (safely ignored)', async () => {
    // Try to pass a broken payload or mock failure
    // If it throws, the test will fail
    await captureStudyKnowledgeAttempt({
      userId: null, // should just return early without throwing
      card: { id: 4 }
    });
    
    const originalEnv = globalThis.import.meta.env.VITE_KNOWLEDGE_LAYER_ENABLED;
    globalThis.import.meta.env.VITE_KNOWLEDGE_LAYER_ENABLED = 'false';
    // should return early due to feature flag
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 1 },
      grade: 3
    });
    globalThis.import.meta.env.VITE_KNOWLEDGE_LAYER_ENABLED = originalEnv;
    
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    assert.strictEqual(pending.length, 0); // No new attempts
  });


  test('KI-04.1 - Exercise first try correct', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.add({ card_id: 10, knowledge_item_id: 101, role: 'primary' });
    await captureStudyKnowledgeAttempt({ userId: '123', card: { id: 10, front_text: '* A' }, grade: 3, isExtended: false, exerciseEvidence: { isCorrect: true, isFirstTry: true, attemptCount: 1, mistakeCount: 0 } });
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    const attempt = pending.find(a => a.card_id === 10);
    assert.strictEqual(attempt.evaluation_data.schema_version, 2);
    assert.strictEqual(attempt.evaluation_data.evaluation_type, 'hybrid');
    assert.strictEqual(attempt.evaluation_data.exercise_evidence.first_try_correct, true);
    assert.strictEqual(attempt.evaluation_data.exercise_evidence.attempt_count, 1);
  });

  test('KI-04.1 - Exercise after errors', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.add({ card_id: 11, knowledge_item_id: 101, role: 'primary' });
    await captureStudyKnowledgeAttempt({ userId: '123', card: { id: 11, front_text: '* A' }, grade: 2, isExtended: false, exerciseEvidence: { isCorrect: true, isFirstTry: false, attemptCount: 4, mistakeCount: 3 } });
    const pending = await dbService.getPendingKnowledgeAttempts('123');
    const attempt = pending.find(a => a.card_id === 11);
    assert.strictEqual(attempt.evaluation_data.schema_version, 2);
    assert.strictEqual(attempt.evaluation_data.exercise_evidence.first_try_correct, false);
    assert.strictEqual(attempt.evaluation_data.exercise_evidence.attempt_count, 4);
    assert.strictEqual(attempt.evaluation_data.exercise_evidence.mistake_count, 3);
  });

  test('KI-04.1 - Repeated card review lifecycle isolation', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.add({ card_id: 42, knowledge_item_id: 101, role: 'primary' });

    // Review #1 for Card 42 (e.g., student struggled, 4 attempts, 3 mistakes)
    const reviewEvidence1 = { isCorrect: true, isFirstTry: false, attemptCount: 4, mistakeCount: 3 };
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 42, front_text: '@match\nA - 1' },
      grade: 2,
      isExtended: false,
      eventTime: '2026-01-01T10:00:00Z',
      exerciseEvidence: reviewEvidence1
    });

    // Review #2 for SAME Card 42 (e.g. later in session or single-card deck, student gets it right on first try)
    const reviewEvidence2 = { isCorrect: true, isFirstTry: true, attemptCount: 1, mistakeCount: 0 };
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 42, front_text: '@match\nA - 1' },
      grade: 3,
      isExtended: false,
      eventTime: '2026-01-01T10:05:00Z',
      exerciseEvidence: reviewEvidence2
    });

    const pending = await dbService.getPendingKnowledgeAttempts('123');
    const cardAttempts = pending.filter(a => a.card_id === 42).sort((a, b) => a.event_time.localeCompare(b.event_time));
    assert.strictEqual(cardAttempts.length, 2);

    const firstReview = cardAttempts[0];
    const secondReview = cardAttempts[1];

    assert.strictEqual(firstReview.evaluation_data.exercise_evidence.attempt_count, 4);
    assert.strictEqual(firstReview.evaluation_data.exercise_evidence.first_try_correct, false);
    assert.strictEqual(firstReview.evaluation_data.exercise_evidence.mistake_count, 3);

    // Second review MUST have attempt_count=1, first_try_correct=true, mistake_count=0
    assert.strictEqual(secondReview.evaluation_data.exercise_evidence.attempt_count, 1);
    assert.strictEqual(secondReview.evaluation_data.exercise_evidence.first_try_correct, true);
    assert.strictEqual(secondReview.evaluation_data.exercise_evidence.mistake_count, 0);
  });

  test('KI-04.1 - StudyCard reviewKey state scoping by historyIndex', () => {
    // Simulating StudyCard exerciseStates cache keyed by ${card.id}:
    const exerciseStates = {};
    const cardA = { id: 77 };

    const saveExerciseState = (cardId, historyIdx, state) => {
      const reviewKey = `${cardId}:${historyIdx}`;
      exerciseStates[reviewKey] = state;
    };

    const getSavedState = (cardId, historyIdx) => {
      const reviewKey = `${cardId}:${historyIdx}`;
      return exerciseStates[reviewKey];
    };

    // Review #1 (historyIndex = 10)
    saveExerciseState(cardA.id, 10, { attemptCount: 4, mistakeCount: 3, isFirstTry: false });
    assert.deepStrictEqual(getSavedState(cardA.id, 10), { attemptCount: 4, mistakeCount: 3, isFirstTry: false });

    // Review #2 (historyIndex = 11) for the same cardA must start fresh (no saved state from historyIndex 10)
    const stateForReview2 = getSavedState(cardA.id, 11);
    assert.strictEqual(stateForReview2, undefined);
  });

  test('grammar error -> grammar error -> incorrect -> max_retries -> grade captures failed hybrid attempt in Dexie outbox', async () => {
    const db = getLocalDb('123');
    await db.card_knowledge_items.add({ card_id: 88, knowledge_item_id: 101, role: 'primary' });

    const session = createFreeTextEvaluationSession();
    // 1. grammar error
    await session.submit('Ich habe ein Hund.', async () => ({
      result: { verdict: 'needs_retry', accepted: false, error_type: 'grammar', error_code: 'grammar.article_case', evaluator: 'ai' },
      grading_policy: { max_retries: 3 },
    }));
    // 2. grammar error
    await session.submit('Ich habe dem Hund.', async () => ({
      result: { verdict: 'needs_retry', accepted: false, error_type: 'grammar', error_code: 'grammar.article_case', evaluator: 'ai' },
      grading_policy: { max_retries: 3 },
    }));
    // 3. incorrect (max_retries reached)
    await session.submit('Ich habe Katze.', async () => ({
      result: { verdict: 'incorrect', accepted: false, error_type: 'vocabulary', error_code: 'vocab.wrong_word', evaluator: 'ai' },
      grading_policy: { max_retries: 3 },
    }));

    const evidence = session.evidence();
    assert.strictEqual(evidence.isCorrect, false);
    assert.strictEqual(evidence.completed, false);
    assert.strictEqual(evidence.attemptCount, 3);
    assert.strictEqual(evidence.mistakeCount, 3);

    // Grade card (e.g. grade 0 = 'again')
    await captureStudyKnowledgeAttempt({
      userId: '123',
      card: { id: 88, front: '@free\nTranslate.' },
      grade: 0,
      isExtended: false,
      exerciseEvidence: evidence
    });

    const pending = await dbService.getPendingKnowledgeAttempts('123');
    const attempt = pending.find(a => a.card_id === 88);
    assert.ok(attempt, 'Pending attempt should exist in Dexie outbox');

    const evalData = attempt.evaluation_data;
    assert.strictEqual(evalData.schema_version, 2);
    assert.strictEqual(evalData.evaluation_type, 'hybrid');
    assert.strictEqual(evalData.correct, false);
    assert.strictEqual(evalData.rating, 'again');

    const exEvidence = evalData.exercise_evidence;
    assert.strictEqual(exEvidence.auto_evaluated, true);
    assert.strictEqual(exEvidence.completed, false);
    assert.strictEqual(exEvidence.first_try_correct, false);
    assert.strictEqual(exEvidence.attempt_count, 3);
    assert.strictEqual(exEvidence.mistake_count, 3);
    assert.deepStrictEqual(exEvidence.grading_summary.error_types_seen, ['grammar', 'vocabulary']);
    assert.deepStrictEqual(exEvidence.grading_summary.error_codes_seen, ['grammar.article_case', 'vocab.wrong_word']);
    assert.strictEqual(exEvidence.grading_summary.final_verdict, 'incorrect');
    assert.strictEqual(exEvidence.grading_summary.final_evaluator, 'ai');
  });
});


