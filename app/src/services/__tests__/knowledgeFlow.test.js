import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as localDb from '../localDb.js';

let userId = '1';
globalThis.window = { location: { search: '' } };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.localStorage = { getItem: key => key === 'lerne_user_id' ? userId : null };
const api = { get: mock.fn(), post: mock.fn() };
mock.module('../api.js', { defaultExport: api });
const { prepareDeckKnowledge } = await import('../knowledgeContentService.js');
const { captureStudyKnowledgeAttempt } = await import('../knowledgeCaptureService.js');
const { syncKnowledgeAttempts } = await import('../knowledgeSyncService.js');
const { enqueueKnowledgeAttempt, resetStaleKnowledgeAttempts } = await import('../knowledgeDbService.js');
const { saveAssessment, loadAssessment } = await import('../assessmentService.js');
const { assessmentFreeTextEvidence, recordAssessmentResult } = await import('../../utils/assessment.js');
const { createFreeTextEvaluationSession } = await import('../../utils/freeTextEvaluationState.js');
const { freeTextTaskSupport } = await import('../../utils/supportEvidence.js');
const { trainerTaskSupport } = await import('../../utils/supportEvidence.js');
const { createExerciseEvaluationSession } = await import('../../utils/exerciseEvaluation.js');
const { parseClozeData } = await import('../../utils/clozeParser.js');
const { evaluateTrainerGaps } = await import('../../utils/trainerEvaluation.js');
const { assessmentTrainerEvidence } = await import('../../utils/assessment.js');

const content = (ki = 10) => ({ card_ids: [1, 2], knowledge_items: [{ id: ki, name: 'Synthetic skill' }],
  card_knowledge_items: [{ card_id: 1, knowledge_item_id: ki, role: 'primary' }] });
const attempt = (id = 'same-id') => ({ client_event_id: id, user_id: userId, knowledge_item_id: 10,
  card_id: 1, event_time: '2026-10-30T10:00:00Z', evaluation_data: { schema_version: 1,
    evaluation_type: 'self_rating', rating: 'good' } });
const capture = () => captureStudyKnowledgeAttempt({ userId, card: { id: 1, deck_id: 5, front: 'Synthetic' }, grade: 2 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

const assessment = relevance => recordAssessmentResult({ id: 'synthetic-exam', userId: 1, deckId: 5, index: 0,
  config: { required_count: 1 }, results: {},
  cards: [{ id: 1, metadata: { assessment: { competency_ids: ['synthetic'] } } }] }, 1,
assessmentFreeTextEvidence({ verdict: 'incorrect', accepted: false, evaluator: 'ai', target_relevance: relevance }));

beforeEach(() => {
  userId = '1';
  navigator.onLine = true;
  localStorage.getItem = key => key === 'lerne_user_id' ? userId : null;
  api.get.mock.resetCalls();
  api.post.mock.resetCalls();
  api.get.mock.mockImplementation(async () => ({ data: content() }));
  api.post.mock.mockImplementation(async (_url, body) => ({ data: { results: body.attempts.map(a =>
    ({ client_event_id: a.client_event_id, status: 'created' })) } }));
});
afterEach(async () => {
  localDb.resetAllDatabases();
  for (const database of await indexedDB.databases()) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(database.name);
      request.onsuccess = resolve;
      request.onerror = reject;
    });
  }
});

test('online cold cache loads KI, captures grade and drains the durable outbox', async () => {
  const database = localDb.getLocalDb();
  await prepareDeckKnowledge(5);
  assert.equal(api.get.mock.calls[0].arguments[1]._expectedUserId, 1);
  await capture();
  const [event] = await database.knowledge_attempt_outbox.toArray();
  assert.equal(event.knowledge_item_id, 10);
  assert.equal(event.evaluation_data.rating, 'good');
  assert.equal(event.evaluation_data.schema_version, 1);
  const result = await syncKnowledgeAttempts('1');
  assert.equal(result.succeededCount, 1);
  assert.equal(api.post.mock.calls[0].arguments[2]._expectedUserId, 1);
  assert.equal(await database.knowledge_attempt_outbox.count(), 0);
});

test('offline capture survives network failure and duplicate acknowledgement on reconnect', async () => {
  const database = localDb.getLocalDb();
  await prepareDeckKnowledge(5);
  navigator.onLine = false;
  await prepareDeckKnowledge(5);
  assert.equal(api.get.mock.callCount(), 1);
  await capture();
  const [event] = await database.knowledge_attempt_outbox.toArray();
  api.post.mock.mockImplementation(async () => { throw new Error('Disconnected'); });
  assert.equal((await syncKnowledgeAttempts('1')).transportFailed, true);
  assert.equal((await database.knowledge_attempt_outbox.get(event.client_event_id)).sync_status, 'pending');
  navigator.onLine = true;
  api.post.mock.mockImplementation(async () => ({ data: { results: [{ client_event_id: event.client_event_id, status: 'duplicate' }] } }));
  assert.equal((await syncKnowledgeAttempts('1')).succeededCount, 1);
  assert.equal(await database.knowledge_attempt_outbox.count(), 0);
});

test('Assessment relevance survives durable offline replay and account isolation', async () => {
  await prepareDeckKnowledge(5);
  const session = assessment('secondary');
  await saveAssessment(session, session.results[1]);
  const original = localDb.getLocalDb();
  const [frozen] = await original.knowledge_attempt_outbox.toArray();
  assert.equal(frozen.evaluation_data.target_relevance, 'secondary');
  api.post.mock.mockImplementation(async () => { throw new Error('Offline'); });
  assert.equal((await syncKnowledgeAttempts('1')).transportFailed, true);
  localDb.closeLocalDb();
  assert.deepEqual(await loadAssessment(1, 5), session);
  const database = localDb.getLocalDb();
  assert.deepEqual((await database.knowledge_attempt_outbox.toArray())[0].evaluation_data, frozen.evaluation_data);
  userId = '2';
  await assert.rejects(saveAssessment(session, session.results[1]), /Account changed/);
  assert.equal((await syncKnowledgeAttempts('1')).selectedCount, 0);
  assert.equal(await localDb.getLocalDb().knowledge_attempt_outbox.count(), 0);
  userId = '1';
  api.post.mock.mockImplementation(async (_url, body) => {
    assert.deepEqual(body.attempts[0].evaluation_data, frozen.evaluation_data);
    assert.equal(body.attempts[0].client_event_id, frozen.client_event_id);
    return { data: { results: [{ client_event_id: frozen.client_event_id, status: 'duplicate' }] } };
  });
  assert.equal((await syncKnowledgeAttempts('1')).succeededCount, 1);
  assert.equal(await database.knowledge_attempt_outbox.count(), 0);
});

test('Assessment save leaves frozen annotated and old unannotated payloads unchanged', async () => {
  await prepareDeckKnowledge(5);
  const database = localDb.getLocalDb();
  for (const relevance of ['none', undefined]) {
    const session = assessment(relevance);
    await saveAssessment(session, session.results[1]);
    const [frozen] = await database.knowledge_attempt_outbox.toArray();
    const changed = assessment('primary');
    await saveAssessment(changed, changed.results[1]);
    assert.deepEqual((await database.knowledge_attempt_outbox.toArray())[0], frozen);
    await database.knowledge_attempt_outbox.clear();
  }
});

test('v2/v3 support survives offline, database reopen, account switch, conflict and duplicate replay', async () => {
  await prepareDeckKnowledge(5);
  const card = { id: 1, front: '@free\nSynthetic prompt' };
  for (const version of [2, 3]) {
    const checker = createFreeTextEvaluationSession(undefined, { trackSupport: true,
      assessmentMode: version === 3, taskSupport: freeTextTaskSupport(card) });
    checker.recordSupport('hint_count');
    await checker.submit('synthetic', async () => ({ result: { verdict: 'correct', accepted: true } }));
    if (version === 2) {
      const evidence = checker.evidence();
      const saving = captureStudyKnowledgeAttempt({ userId, card, grade: 2, exerciseEvidence: evidence });
      evidence.supportEvidence.hint_count = 99; // Mutation while mapping lookup is in flight.
      await saving;
    } else {
      const evidence = assessmentFreeTextEvidence(checker.snapshot().result, checker.supportFields());
      const session = recordAssessmentResult({ ...assessment('none'), results: {} }, 1, evidence);
      await saveAssessment(session, session.results[1]);
      evidence.supportEvidence.hint_count = 99;
    }
    const [frozen] = await localDb.getLocalDb().knowledge_attempt_outbox.toArray();
    const container = version === 2 ? frozen.evaluation_data.exercise_evidence : frozen.evaluation_data;
    assert.equal(container.support_evidence.hint_count, 1);
    assert.equal(container.support_evidence.translation_view_count, null);
    assert.equal(container.support_evidence.tracking_complete, false);
    checker.recordSupport('answer_reveal_count');
    api.post.mock.mockImplementation(async () => { throw new Error('Offline'); });
    assert.equal((await syncKnowledgeAttempts('1')).transportFailed, true);
    localDb.closeLocalDb();
    const database = localDb.getLocalDb();
    assert.deepEqual((await database.knowledge_attempt_outbox.toArray())[0].evaluation_data, frozen.evaluation_data);
    userId = '2';
    assert.equal((await syncKnowledgeAttempts('1')).selectedCount, 0);
    assert.equal(await localDb.getLocalDb().knowledge_attempt_outbox.count(), 0);
    userId = '1';
    api.post.mock.mockImplementation(async (_url, body) => {
      assert.deepEqual(body.attempts[0].evaluation_data, frozen.evaluation_data);
      return { data: { results: [{ client_event_id: frozen.client_event_id, status: 'event_conflict' }] } };
    });
    await syncKnowledgeAttempts('1');
    const conflicted = await database.knowledge_attempt_outbox.get(frozen.client_event_id);
    assert.deepEqual(conflicted.evaluation_data, frozen.evaluation_data);
    // A conflict is retained as failed; an explicit diagnostic retry changes transport state only.
    await database.knowledge_attempt_outbox.update(frozen.client_event_id, { sync_status: 'pending' });
    api.post.mock.mockImplementation(async (_url, body) => {
      assert.deepEqual(body.attempts[0].evaluation_data, frozen.evaluation_data);
      return { data: { results: [{ client_event_id: frozen.client_event_id, status: 'duplicate' }] } };
    });
    assert.equal((await syncKnowledgeAttempts('1')).succeededCount, 1);
    assert.equal(await database.knowledge_attempt_outbox.count(), 0);
  }
});

test('offline without KI or with mapping but missing KI creates no evidence', async () => {
  navigator.onLine = false;
  await prepareDeckKnowledge(5);
  await capture();
  const database = localDb.getLocalDb();
  await database.card_knowledge_items.put({ card_id: 1, knowledge_item_id: 10, role: 'primary' });
  await capture();
  assert.equal(await database.knowledge_attempt_outbox.count(), 0);
  assert.equal(api.get.mock.callCount(), 0);
});

test('refresh replaces changed and removed primary mappings, without deleting queued events', async () => {
  const database = localDb.getLocalDb();
  await prepareDeckKnowledge(5);
  await enqueueKnowledgeAttempt(attempt());
  api.get.mock.mockImplementation(async () => ({ data: content(20) }));
  await prepareDeckKnowledge(5);
  assert.equal((await database.card_knowledge_items.toArray()).length, 1);
  assert.equal((await database.card_knowledge_items.toArray())[0].knowledge_item_id, 20);
  api.get.mock.mockImplementation(async () => ({ data: { ...content(), knowledge_items: [], card_knowledge_items: [] } }));
  await prepareDeckKnowledge(5);
  await capture();
  assert.equal(await database.card_knowledge_items.count(), 0);
  assert.equal(await database.knowledge_attempt_outbox.count(), 1);
});

test('malformed KI response preserves the previous content cache', async () => {
  const database = localDb.getLocalDb();
  await prepareDeckKnowledge(5);
  api.get.mock.mockImplementation(async () => ({ data: {} }));
  await assert.rejects(prepareDeckKnowledge(5), /Invalid knowledge content/);
  assert.equal(await database.card_knowledge_items.count(), 1);
});

test('online offline-first mode refreshes KI; invalid writes roll back the cache transaction', async () => {
  localStorage.getItem = key => key === 'lerne_user_id' ? userId : key === 'offline_mode' ? 'true' : null;
  const database = localDb.getLocalDb();
  await prepareDeckKnowledge(5);
  assert.equal(api.get.mock.callCount(), 1);
  api.get.mock.mockImplementation(async () => ({ data: { ...content(20),
    card_knowledge_items: [{ knowledge_item_id: 20, role: 'primary' }] } }));
  await assert.rejects(prepareDeckKnowledge(5));
  assert.equal((await database.card_knowledge_items.toArray())[0].knowledge_item_id, 10);
  assert.equal(await database.knowledge_items.get(20), undefined);
});

test('older server without card_ids clears removed mappings for cached deck cards', async () => {
  const database = localDb.getLocalDb();
  await database.cards.put({ id: 1, deck_id: 5 });
  await prepareDeckKnowledge(5);
  api.get.mock.mockImplementation(async () => ({ data: { knowledge_items: [], card_knowledge_items: [] } }));
  await prepareDeckKnowledge(5);
  assert.equal(await database.card_knowledge_items.count(), 0);
});

test('account change while loading KI cannot populate either account with late content', async () => {
  const pending = deferred();
  api.get.mock.mockImplementation(() => pending.promise);
  const original = localDb.getLocalDb();
  const loading = prepareDeckKnowledge(5);
  userId = '2';
  const current = localDb.getLocalDb();
  pending.resolve({ data: content() });
  await assert.rejects(loading, /Account changed/);
  assert.equal(await original.knowledge_items.count(), 0);
  assert.equal(await current.knowledge_items.count(), 0);
});

test('late sync acknowledgement deletes only the sending account event with the same ID', async () => {
  const original = localDb.getLocalDb();
  await enqueueKnowledgeAttempt(attempt());
  const sent = deferred();
  const response = deferred();
  api.post.mock.mockImplementation(() => { sent.resolve(); return response.promise; });
  const syncing = syncKnowledgeAttempts('1');
  await sent.promise;
  userId = '2';
  const current = localDb.getLocalDb();
  await enqueueKnowledgeAttempt(attempt());
  response.resolve({ data: { results: [{ client_event_id: 'same-id', status: 'created' }] } });
  await syncing;
  assert.equal(await original.knowledge_attempt_outbox.count(), 0);
  assert.equal((await current.knowledge_attempt_outbox.get('same-id')).sync_status, 'pending');
});

test('Trainer v2/v3 frozen support survives offline/reopen/conflict and late acknowledgement across accounts', async () => {
  await prepareDeckKnowledge(5);
  const card = { id: 1, front: 'Visible [[form]].', back: 'Synthetic translation',
    metadata: { assessment: { competency_ids: ['synthetic'] } } };
  const cloze = parseClozeData(card, 'classic');
  for (const version of [2, 3]) {
    const owner = createExerciseEvaluationSession(undefined, { trackSupport: true, assessmentMode: version === 3,
      taskSupport: trainerTaskSupport(card, cloze) });
    owner.recordSupport('translation_view_count');
    owner.check(evaluateTrainerGaps(cloze.gaps, { 0: 'wrong' }));
    let session;
    if (version === 2) {
      owner.recordSupport('hint_count');
      owner.check(evaluateTrainerGaps(cloze.gaps, { 0: 'form' }));
      await captureStudyKnowledgeAttempt({ userId, card, grade: 2, exerciseEvidence: owner.evidence() });
    } else {
      const submission = { state: owner.snapshot(), ...owner.supportFields() };
      const evidence = assessmentTrainerEvidence(submission);
      session = recordAssessmentResult({ id: 'trainer-flow', userId: 1, deckId: 5, index: 0,
        results: {}, config: { required_count: 1 }, cards: [card] }, 1, evidence);
      await saveAssessment(session, session.results[1]);
      owner.recordSupport('hint_count');
      owner.check(evaluateTrainerGaps(cloze.gaps, { 0: 'form' }));
      const later = recordAssessmentResult(session, 1, assessmentTrainerEvidence({ state: owner.snapshot(), ...owner.supportFields() }));
      await saveAssessment(later, later.results[1]);
    }
    const [frozen] = await localDb.getLocalDb().knowledge_attempt_outbox.toArray();
    const payload = version === 2 ? frozen.evaluation_data.exercise_evidence : frozen.evaluation_data;
    assert.equal(payload.support_evidence.hint_count, version === 2 ? 1 : 0);
    assert.equal(payload.support_evidence.translation_view_count, 1);
    assert.equal(payload.support_evidence.answer_reveal_count, null);
    assert.equal(payload.task_support.sentence_frame_present, true);
    api.post.mock.mockImplementation(async () => { throw new Error('Offline'); });
    assert.equal((await syncKnowledgeAttempts('1')).transportFailed, true);
    localDb.closeLocalDb();
    const original = localDb.getLocalDb();
    assert.deepEqual((await original.knowledge_attempt_outbox.toArray())[0].evaluation_data, frozen.evaluation_data);
    api.post.mock.mockImplementation(async () => ({ data: { results: [{ client_event_id: frozen.client_event_id, status: 'event_conflict' }] } }));
    await syncKnowledgeAttempts('1');
    assert.deepEqual((await original.knowledge_attempt_outbox.get(frozen.client_event_id)).evaluation_data, frozen.evaluation_data);
    await original.knowledge_attempt_outbox.update(frozen.client_event_id, { sync_status: 'pending' });
    const sent = deferred(), response = deferred();
    api.post.mock.mockImplementation((_url, body) => {
      assert.deepEqual(body.attempts[0].evaluation_data, frozen.evaluation_data);
      sent.resolve(); return response.promise;
    });
    const syncing = syncKnowledgeAttempts('1');
    await sent.promise;
    userId = '2';
    const current = localDb.getLocalDb();
    await enqueueKnowledgeAttempt({ ...frozen, user_id: '2', sync_status: 'pending' });
    if (session) await assert.rejects(saveAssessment(session, session.results[1]), /Account changed/);
    response.resolve({ data: { results: [{ client_event_id: frozen.client_event_id, status: 'duplicate' }] } });
    await syncing;
    assert.equal(await original.knowledge_attempt_outbox.count(), 0);
    const isolated = await current.knowledge_attempt_outbox.get(frozen.client_event_id);
    assert.equal(isolated.sync_status, 'pending');
    assert.deepEqual(isolated.evaluation_data, frozen.evaluation_data);
    await current.knowledge_attempt_outbox.clear();
    userId = '1';
  }
});

test('account switch after selection cancels sending and restores the original queue', async () => {
  const original = localDb.getLocalDb();
  await enqueueKnowledgeAttempt(attempt());
  original.knowledge_attempt_outbox.hook('reading', event => { userId = '2'; return event; });
  const result = await syncKnowledgeAttempts('1');
  assert.equal(result.transportFailed, true);
  assert.equal(api.post.mock.callCount(), 0);
  assert.equal((await original.knowledge_attempt_outbox.get('same-id')).sync_status, 'pending');
  assert.equal(await localDb.getLocalDb().knowledge_attempt_outbox.count(), 0);
});

test('logout closes the sending database; its durable event recovers on the next login', async () => {
  await enqueueKnowledgeAttempt(attempt());
  const sent = deferred();
  const response = deferred();
  api.post.mock.mockImplementation(() => { sent.resolve(); return response.promise; });
  const syncing = syncKnowledgeAttempts('1');
  await sent.promise;
  localDb.closeLocalDb(1);
  userId = '2';
  await enqueueKnowledgeAttempt(attempt());
  response.resolve({ data: { results: [{ client_event_id: 'same-id', status: 'created' }] } });
  assert.equal((await syncing).transportFailed, true);
  assert.equal((await localDb.getLocalDb().knowledge_attempt_outbox.get('same-id')).sync_status, 'pending');
  userId = '1';
  const recovered = localDb.getLocalDb();
  assert.equal((await recovered.knowledge_attempt_outbox.get('same-id')).sync_status, 'syncing');
  await resetStaleKnowledgeAttempts(-1);
  api.post.mock.mockImplementation(async () => ({ data: { results: [{ client_event_id: 'same-id', status: 'duplicate' }] } }));
  assert.equal((await syncKnowledgeAttempts('1')).succeededCount, 1);
  assert.equal(await recovered.knowledge_attempt_outbox.count(), 0);
});

test('capture cannot cross accounts during primary KI lookup', async () => {
  userId = '2';
  await localDb.getLocalDb().knowledge_items.put({ id: 10, name: 'Same KI in second account' });
  userId = '1';
  const original = localDb.getLocalDb();
  await prepareDeckKnowledge(5);
  original.card_knowledge_items.hook('reading', mapping => { userId = '2'; return mapping; });
  await capture();
  assert.equal(await original.knowledge_attempt_outbox.count(), 0);
  assert.equal(await localDb.getLocalDb().knowledge_attempt_outbox.count(), 0);
});

test('partial response retries missing events and ignores IDs outside the sent batch', async () => {
  const database = localDb.getLocalDb();
  await enqueueKnowledgeAttempt(attempt('one'));
  await enqueueKnowledgeAttempt(attempt('two'));
  await database.knowledge_attempt_outbox.add({ ...attempt('unrelated'), sync_status: 'failed' });
  api.post.mock.mockImplementation(async () => ({ data: { results: [
    { client_event_id: 'one', status: 'duplicate' }, { client_event_id: 'unrelated', status: 'created' },
  ] } }));
  await syncKnowledgeAttempts('1');
  assert.equal(await database.knowledge_attempt_outbox.get('one'), undefined);
  assert.equal((await database.knowledge_attempt_outbox.get('two')).sync_status, 'pending');
  assert.equal((await database.knowledge_attempt_outbox.get('unrelated')).sync_status, 'failed');
});
