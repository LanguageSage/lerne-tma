// Opt-in real Knowledge/auth/DB transport. Only the Free Text AI verdict is synthetic;
// Trainer uses its actual deterministic checker.
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const results = {};

function sql(query) {
  return execFileSync(fixture.psql, ['-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', String(fixture.pgPort),
    '-U', fixture.pgUser, '-d', fixture.pgDatabase, '-v', 'ON_ERROR_STOP=1', '-c', query],
  { encoding: 'utf8', windowsHide: true }).trim();
}
const number = (value, signed = false) => { assert.ok(Number.isSafeInteger(value) && (signed ? value !== 0 : value > 0)); return value; };
const uidA = number(fixture.a.profile.user_id, true), uidB = number(fixture.b.profile.user_id, true);
for (const key of ['ki', 'ki2', 'cardA', 'cardB', 'deckA', 'deckB']) number(fixture[key]);
assert.match(fixture.pgDatabase, /^knowledge_disposable$/);
assert.match(fixture.api, /^http:\/\/127\.0\.0\.1:\d+$/);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function pairLock() {
  assert.match(fixture.lockA, /^-?\d+$/);
  const process = spawn(fixture.psql, ['-X', '-w', '-qAt', '-h', '127.0.0.1', '-p', String(fixture.pgPort),
    '-U', fixture.pgUser, '-d', fixture.pgDatabase, '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
  let output = '', errors = '';
  process.stdout.on('data', data => { output += data.toString(); });
  process.stderr.on('data', data => { errors += data.toString(); });
  process.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(${fixture.lockA}); SELECT 'LOCKED';\n`);
  await until(() => output.includes('LOCKED'), `acquire real PostgreSQL lock: ${errors}`);
  return async () => {
    process.stdin.end('COMMIT;\n\\q\n');
    await new Promise((resolve, reject) => process.on('exit', code => code === 0 ? resolve() : reject(new Error(errors))));
  };
}

async function request(account, path, body) {
  const response = await fetch(fixture.api + '/api' + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + account.session.access_token,
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.status === 200 || response.status === 204, `HTTP ${response.status}: ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let release;
  try {
    // Block external networking only. Every loopback API request uses the real server.
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.addInitScript(({ session, profile }) => {
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify(session));
      localStorage.setItem('lerne_user_profile', JSON.stringify({ ...profile, is_guest: false }));
      localStorage.setItem('lerne_user_id', String(profile.user_id));
      localStorage.setItem('native_language', 'en');
      localStorage.setItem('offline_mode', 'false');
    }, fixture.a);
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Browser error:', error.message));
    await page.goto(fixture.web + '/knowledge-harness.html');
    await page.evaluate(async () => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const { useStudySession } = await import('/src/hooks/useStudySession.js');
      const { useStudyNavigation } = await import('/src/hooks/useStudyNavigation.js');
      window.deckStore = (await import('/src/store/useDeckStore.js')).useDeckStore;
      window.sessionStore = (await import('/src/store/useSessionStore.js')).useSessionStore;
      window.uiStore = (await import('/src/store/useUiStore.js')).useUiStore;
      (await import('/src/store/useSettingsStore.js')).useSettingsStore.setState({ gradeSoundEnabled: false });
      createRoot(document.getElementById('harness')).render(React.createElement(function Harness() {
        window.study = useStudySession();
        window.navigation = useStudyNavigation();
        return null;
      }));
    });
    await page.waitForFunction(() => window.navigation && window.study);
    const countQueue = () => page.evaluate(async () => (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.count());
    const state = async () => request(fixture.a, `/knowledge/diagnostics/items/${fixture.ki}`);
    const baseline = (await state()).materialized_state.evidence_event_count;

    // Real hooks -> Axios -> HTTP grade -> PostgreSQL; real Dexie capture -> HTTP sync.
    await page.evaluate(async ({ deckA }) => {
      const api = (await import('/src/services/api.js')).default;
      const decks = (await api.get('/decks')).data;
      const deck = decks.find(item => item.id === deckA);
      if (!deck) throw new Error('Fixture deck unavailable through HTTP');
      await navigation.startStudy(deck);
    }, fixture);
    await page.evaluate(() => study.submitGrade(2));
    await until(async () => (await countQueue()) === 1, 'online capture');
    const online = await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()));
    assert.equal(online.succeededCount, 1);
    assert.equal(await countQueue(), 0);
    assert.equal((await state()).materialized_state.evidence_event_count, baseline + 1);
    results.browser_http_grade_attempt_mastery = 'PASS';
    console.log('PASS: browser HTTP grade -> Attempt -> Mastery');

    // Download actual entity snapshot, then use browser networking OFFLINE (no transport mocks).
    const downloaded = await page.evaluate(async () => (await import('/src/services/syncService.js')).syncService.sync());
    assert.equal(downloaded.success, true, JSON.stringify(downloaded));
    const reviewsBefore = Number(sql(`SELECT COUNT(*) FROM tmareviewhistory WHERE user_id=${uidA}`));
    const attemptsBefore = Number(sql(`SELECT COUNT(*) FROM tma_knowledge_attempt WHERE user_id=${uidA}`));
    await context.setOffline(true);
    await page.evaluate(async ({ deckA, cardA }) => {
      const deck = deckStore.getState().currentDeck;
      if (deck.id !== deckA) throw new Error('Wrong deck');
      await navigation.startStudyCard(deck, cardA);
    }, fixture);
    await page.evaluate(() => study.submitGrade(2));
    await until(async () => (await countQueue()) === 1, 'offline capture');
    const offlineRecord = await page.evaluate(async () => {
      const db = (await import('/src/services/localDb.js')).getLocalDb();
      return { events: await db.knowledge_attempt_outbox.toArray(),
        reviews: await db.syncState.filter(row => row.key.startsWith('review:')).toArray() };
    });
    assert.equal(offlineRecord.reviews.length, 1);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tma_knowledge_attempt WHERE user_id=${uidA}`)), attemptsBefore);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tmareviewhistory WHERE user_id=${uidA}`)), reviewsBefore);
    const offlineSend = await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()));
    assert.equal(offlineSend.transportFailed, true);
    assert.equal(await countQueue(), 1);
    await page.evaluate(async () => {
      const { getLocalDb, closeLocalDb } = await import('/src/services/localDb.js');
      closeLocalDb();
      await getLocalDb().open();
    });
    assert.equal(await countQueue(), 1, 'Durable outbox survives closing/reopening IndexedDB');
    await context.setOffline(false);
    const synced = await page.evaluate(async () => {
      const entities = await (await import('/src/services/syncService.js')).syncService.sync();
      const knowledge = await (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
        (await import('/src/utils/auth.js')).getUserId());
      return { entities, knowledge };
    });
    assert.equal(synced.entities.success, true, JSON.stringify(synced));
    assert.equal(synced.knowledge.succeededCount, 1);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tmareviewhistory WHERE user_id=${uidA}`)), reviewsBefore + 1);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tma_knowledge_attempt WHERE user_id=${uidA}`)), attemptsBefore + 1);
    assert.equal(await countQueue(), 0);
    const offlineId = offlineRecord.events[0].client_event_id;
    const duplicate = await request(fixture.a, '/knowledge/attempts/sync', { attempts: offlineRecord.events });
    assert.equal(duplicate.results[0].client_event_id, offlineId);
    assert.equal(duplicate.results[0].status, 'duplicate');
    assert.equal((await state()).materialized_state.evidence_event_count, baseline + 2);
    results.browser_offline_reconnect_durable_sync = 'PASS';
    console.log('PASS: real browser offline -> reconnect -> HTTP/PostgreSQL sync');

    // SQL is a fixture authoring operation on this disposable database, not a mocked API response.
    sql(`UPDATE tma_card_knowledge_item SET knowledge_item_id=${fixture.ki2} WHERE card_id=${fixture.cardA} AND role='primary'`);
    let primary = await page.evaluate(async ({ deckA, cardA }) => {
      await (await import('/src/services/knowledgeContentService.js')).prepareDeckKnowledge(deckA);
      return (await import('/src/services/knowledgeDbService.js')).getPrimaryKnowledgeItemForCard(cardA);
    }, fixture);
    assert.equal(primary.id, fixture.ki2);
    const stale = { ...offlineRecord.events[0], client_event_id: 'stale-after-remap' };
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [stale] })).results[0].status, 'rejected');
    sql(`DELETE FROM tma_card_knowledge_item WHERE card_id=${fixture.cardA} AND role='primary'`);
    primary = await page.evaluate(async ({ deckA, cardA }) => {
      await (await import('/src/services/knowledgeContentService.js')).prepareDeckKnowledge(deckA);
      return (await import('/src/services/knowledgeDbService.js')).getPrimaryKnowledgeItemForCard(cardA);
    }, fixture);
    assert.equal(primary, null);
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: offlineRecord.events })).results[0].status, 'duplicate');
    await page.evaluate(async ({ cardA }) => (await import('/src/services/knowledgeCaptureService.js')).captureStudyKnowledgeAttempt({
      userId: (await import('/src/utils/auth.js')).getUserId(), card: { id: cardA }, grade: 2 }), fixture);
    assert.equal(await countQueue(), 0);
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [{ ...stale, client_event_id: 'stale-after-unmap' }] })).results[0].status, 'rejected');
    sql(`INSERT INTO tma_card_knowledge_item(card_id,knowledge_item_id,role,complexity,created_at) VALUES(${fixture.cardA},${fixture.ki},'primary',3,NOW())`);
    results.browser_http_remap_unmap_cache_and_server = 'PASS';
    console.log('PASS: HTTP remap/unmap cache and server rejection');

    // Delay a genuine HTTP request with a genuine PG advisory lock, then close/switch account.
    const sharedId = 'same-id-across-accounts';
    await page.evaluate(async ({ cardA, ki, a, eventId }) => {
      await (await import('/src/services/knowledgeDbService.js')).enqueueKnowledgeAttempt({
        user_id: a.profile.user_id, card_id: cardA, knowledge_item_id: ki, client_event_id: eventId,
        event_time: new Date().toISOString(), evaluation_data: { schema_version: 1, evaluation_type: 'self_rating', rating: 'good' } });
    }, { ...fixture, eventId: sharedId });
    release = await pairLock();
    await page.evaluate(() => { window.inFlight = import('/src/services/knowledgeSyncService.js').then(module => module.syncKnowledgeAttempts(
      JSON.parse(localStorage.getItem('lerne_user_profile')).user_id)); });
    await until(() => Number(sql("SELECT COUNT(*) FROM pg_stat_activity WHERE datname='knowledge_disposable' AND wait_event='advisory'")) >= 1,
      'HTTP Knowledge request waiting in actual PostgreSQL');
    await request(fixture.a, '/auth/v2/logout', { all_sessions: false });
    await page.evaluate(async ({ a, b, cardB, ki, eventId }) => {
      (await import('/src/services/localDb.js')).closeLocalDb(a.profile.user_id);
      const auth = await import('/src/utils/auth.js');
      auth.saveAuthSession(b.session);
      auth.saveUserProfile(b.profile);
      await (await import('/src/services/knowledgeDbService.js')).enqueueKnowledgeAttempt({
        user_id: b.profile.user_id, card_id: cardB, knowledge_item_id: ki, client_event_id: eventId,
        event_time: new Date().toISOString(), evaluation_data: { schema_version: 1, evaluation_type: 'self_rating', rating: 'good' } });
    }, { ...fixture, eventId: sharedId });
    await release(); release = null;
    assert.equal((await page.evaluate(() => window.inFlight)).transportFailed, true);
    assert.equal(await countQueue(), 1, 'Account B queue must survive the late A acknowledgement');
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tma_knowledge_attempt WHERE user_id=${uidA} AND client_event_id='${sharedId}'`)), 1);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tma_knowledge_attempt WHERE user_id=${uidB} AND client_event_id='${sharedId}'`)), 0);
    const sentB = await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()));
    assert.equal(sentB.succeededCount, 1);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tma_knowledge_attempt WHERE client_event_id='${sharedId}'`)), 2);
    const login = await fetch(fixture.api + '/api/auth/v2/email-password/login', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.invalid', password: 'synthetic knowledge password' }) });
    assert.equal(login.status, 200);
    fixture.a.session = await login.json();
    fixture.a.headers.Authorization = 'Bearer ' + fixture.a.session.access_token;
    await page.evaluate(async ({ a, b }) => {
      (await import('/src/services/localDb.js')).closeLocalDb(b.profile.user_id);
      const auth = await import('/src/utils/auth.js');
      auth.saveAuthSession(a.session);
      auth.saveUserProfile(a.profile);
      await (await import('/src/services/knowledgeDbService.js')).resetStaleKnowledgeAttempts(-1);
    }, fixture);
    const replayA = await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()));
    assert.equal(replayA.succeededCount, 1);
    assert.equal(await countQueue(), 0);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tma_knowledge_attempt WHERE client_event_id='${sharedId}'`)), 2);
    const finalState = await state();
    assert.equal(finalState.state_matches_rebuild, true);
    assert.equal(finalState.materialized_state.evidence_event_count, baseline + 3);
    const stateB = await request(fixture.b, `/knowledge/diagnostics/items/${fixture.ki}`);
    assert.equal(stateB.state_matches_rebuild, true);
    assert.equal(stateB.materialized_state.evidence_event_count, 1);
    results.browser_http_account_switch_late_response_replay = 'PASS';
    // Actual Free Text clicks/feedback -> capture -> Dexie -> HTTP -> PostgreSQL.
    // Only the checker is synthetic; it never calls an external AI provider.
    let freeChecks = 0;
    await page.route('**/api/ai/evaluate-answer', route => {
      freeChecks++;
      return route.fulfill({ json: { grading_policy: { max_retries: 3 }, result: freeChecks === 1
        ? { verdict: 'needs_retry', accepted: false, evaluator: 'rules', hint: 'Synthetic informative hint' }
        : { verdict: 'accepted_minor', accepted: true, evaluator: 'rules', target_relevance: 'secondary',
          error_type: 'typo', error_code: 'synthetic.typo' } } });
    });
    await page.evaluate(async ({ cardA }) => {
      const RefreshRuntime = (await import('/@react-refresh')).default;
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
      const root = document.createElement('div'); root.id = 'free-ui'; document.body.append(root);
      window.freeRoot = createRoot(root);
      window.freeRoot.render(React.createElement(ExerciseRenderer, {
        card: { id: cardA, front: '@free\nSynthetic prompt', back: 'Synthetic example' },
        reviewKey: 'http-free-support', onSaveState: state => { window.freeSaved = state; },
        onTrainerAnswer: (_cardId, evidence) => { window.freeEvidence = evidence; },
      }));
    }, fixture);
    const freeInput = page.locator('#free-ui textarea');
    await freeInput.fill('synthetic first');
    await page.locator('#free-ui button[type=submit]').click();
    await page.waitForFunction(() => window.freeSaved?.evaluationState?.supportState?.hint_count === 1);
    await freeInput.fill('synthetic second');
    await page.locator('#free-ui button[type=submit]').click();
    await page.waitForFunction(() => window.freeSaved?.isCompleted === true && window.freeEvidence);
    const captured = await page.evaluate(async ({ cardA, deckA }) => {
      await (await import('/src/services/knowledgeContentService.js')).prepareDeckKnowledge(deckA);
      await (await import('/src/services/knowledgeCaptureService.js')).captureStudyKnowledgeAttempt({
        userId: (await import('/src/utils/auth.js')).getUserId(), card: { id: cardA, front: '@free\nSynthetic' },
        grade: 2, exerciseEvidence: window.freeEvidence });
      return (await (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray())[0];
    }, fixture);
    assert.match(captured.client_event_id, /^[a-f0-9-]+$/);
    const rawBefore = (await state()).materialized_state.evidence_event_count;
    await context.setOffline(true);
    assert.equal((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()))).transportFailed, true);
    assert.equal(await countQueue(), 1);
    await context.setOffline(false);
    assert.equal((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()))).succeededCount, 1);
    const persisted = JSON.parse(sql(`SELECT evaluation_data FROM tma_knowledge_attempt WHERE user_id=${uidA} AND client_event_id='${captured.client_event_id}'`));
    assert.deepEqual(persisted, captured.evaluation_data);
    assert.equal(persisted.exercise_evidence.grading_summary.final_target_relevance, 'secondary');
    assert.equal(persisted.exercise_evidence.support_evidence.hint_count, 1);
    assert.equal(persisted.exercise_evidence.support_evidence.translation_view_count, null);
    assert.equal(persisted.exercise_evidence.support_evidence.tracking_complete, false);
    assert.equal(persisted.exercise_evidence.support_evidence.answer_attempt_count, 2);
    assert.equal((await state()).materialized_state.evidence_event_count, rawBefore + 1);
    const afterCapture = (await state()).materialized_state;
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [captured] })).results[0].status, 'duplicate');
    assert.deepEqual((await state()).materialized_state, afterCapture);
    const changed = structuredClone(captured);
    changed.evaluation_data.exercise_evidence.grading_summary.final_target_relevance = 'primary';
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [changed] })).results[0].status, 'event_conflict');
    assert.deepEqual((await state()).materialized_state, afterCapture);
    const changedSupport = structuredClone(captured);
    changedSupport.evaluation_data.exercise_evidence.support_evidence.hint_count++;
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [changedSupport] })).results[0].status, 'event_conflict');
    assert.deepEqual((await state()).materialized_state, afterCapture);
    results.free_text_final_target_relevance_raw_postgres = 'PASS';
    results.free_text_support_ui_raw_postgres = 'PASS';
    await page.evaluate(() => window.freeRoot.unmount());

    // Classified Free Text -> Assessment conversion -> durable v3 -> real HTTP/PG.
    const assessmentBefore = (await state()).materialized_state;
    const assessmentReviews = Number(sql(`SELECT COUNT(*) FROM tmareviewhistory WHERE user_id=${uidA}`));
    const assessmentEvents = await page.evaluate(async ({ cardA, deckA }) => {
      const { assessmentFreeTextEvidence, recordAssessmentResult } = await import('/src/utils/assessment.js');
      const { saveAssessment } = await import('/src/services/assessmentService.js');
      const { createFreeTextEvaluationSession } = await import('/src/utils/freeTextEvaluationState.js');
      const userId = (await import('/src/utils/auth.js')).getUserId();
      const fresh = id => ({ id, userId, deckId: deckA, index: 0, results: {}, config: { required_count: 1 },
        cards: [{ id: cardA, metadata: { assessment: { competency_ids: ['synthetic'] } } }] });
      for (const [index, relevance] of ['primary', 'secondary', 'none', 'unknown'].entries()) {
        const checker = createFreeTextEvaluationSession(undefined, { trackSupport: true, assessmentMode: true });
        checker.recordSupport('hint_count');
        await checker.submit('first synthetic answer', async () => ({ result: {
          verdict: 'needs_retry', accepted: false, evaluator: 'ai', target_relevance: relevance,
          error_type: 'grammar', error_code: 'synthetic.grammar' } }));
        const first = recordAssessmentResult(fresh(`http-assessment-${index}`), cardA,
          assessmentFreeTextEvidence(checker.snapshot().result, checker.supportFields()));
        // Later accepted check must not replace the first result/relevance.
        checker.recordSupport('hint_count');
        await checker.submit('second synthetic answer', async () => ({ result: {
          verdict: 'correct', accepted: true, evaluator: 'ai', target_relevance: 'primary' } }));
        const later = recordAssessmentResult(first, cardA, assessmentFreeTextEvidence(checker.snapshot().result, checker.supportFields()));
        await saveAssessment(later, later.results[cardA]);
      }
      const unavailable = assessmentFreeTextEvidence({ verdict: 'unavailable', accepted: false, target_relevance: 'primary' });
      if (unavailable !== null) throw new Error('Unavailable became an Assessment result');
      const skipped = recordAssessmentResult(fresh('http-assessment-skip'), cardA, { skipped: true });
      await saveAssessment(skipped, skipped.results[cardA]);
      const trainer = recordAssessmentResult(fresh('http-assessment-trainer'), cardA, { isCorrect: true });
      await saveAssessment(trainer, trainer.results[cardA]);
      return (await (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray());
    }, fixture);
    assert.equal(assessmentEvents.length, 6);
    for (const event of assessmentEvents) {
      assert.equal(event.client_event_id, `${event.evaluation_data.assessment.session_id}:${fixture.cardA}`);
      assert.equal(event.evaluation_data.schema_version, 3);
      if (/http-assessment-[0-3]:/.test(event.client_event_id)) {
        assert.equal(event.evaluation_data.support_evidence.hint_count, 1);
        assert.equal(event.evaluation_data.support_evidence.answer_attempt_count, 1);
        assert.equal(event.evaluation_data.support_evidence.capture_point, 'first_assessment_result');
      } else assert.equal(Object.hasOwn(event.evaluation_data, 'support_evidence'), false);
      if (/http-assessment-[0-2]:/.test(event.client_event_id)) {
        assert.equal(event.evaluation_data.target_relevance, ['primary', 'secondary', 'none'][Number(event.evaluation_data.assessment.session_id.slice(-1))]);
        assert.equal(event.evaluation_data.status, 'incorrect');
      } else assert.equal(Object.hasOwn(event.evaluation_data, 'target_relevance'), false);
    }
    await context.setOffline(true);
    assert.equal((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()))).transportFailed, true);
    await page.evaluate(async () => {
      const db = await import('/src/services/localDb.js');
      db.closeLocalDb();
      await db.getLocalDb().open();
    });
    assert.equal(await countQueue(), 6);
    await context.setOffline(false);
    assert.equal((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()))).succeededCount, 6);
    const assessmentAfter = (await state()).materialized_state;
    assert.equal(assessmentAfter.evidence_event_count, assessmentBefore.evidence_event_count + 5);
    assert.equal(assessmentAfter.positive_evidence, assessmentBefore.positive_evidence + 1);
    assert.equal(assessmentAfter.negative_evidence, assessmentBefore.negative_evidence + 4);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tmareviewhistory WHERE user_id=${uidA}`)), assessmentReviews);
    for (const event of assessmentEvents) {
      const raw = JSON.parse(sql(`SELECT evaluation_data FROM tma_knowledge_attempt WHERE user_id=${uidA} AND client_event_id='${event.client_event_id}'`));
      assert.deepEqual(raw, event.evaluation_data);
      assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [event] })).results[0].status, 'duplicate');
      assert.equal((await request(fixture.b, '/knowledge/attempts/sync', { attempts: [event] })).results[0].error_code, 'assessment_not_accessible');
    }
    const rewritten = structuredClone(assessmentEvents.find(e => e.evaluation_data.target_relevance === 'secondary'));
    rewritten.evaluation_data.target_relevance = 'primary';
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [rewritten] })).results[0].status, 'event_conflict');
    const invalid = structuredClone(rewritten);
    invalid.evaluation_data.assessment.session_id = 'http-assessment-invalid';
    invalid.client_event_id = `http-assessment-invalid:${fixture.cardA}`;
    invalid.evaluation_data.target_relevance = 'unknown';
    assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [invalid] })).results[0].error_code, 'invalid_assessment_evidence');
    assert.deepEqual((await state()).materialized_state, assessmentAfter);
    results.assessment_target_relevance_offline_raw_postgres = 'PASS';
    results.assessment_support_offline_raw_postgres = 'PASS';

    // Actual deterministic Trainer UI -> immutable v2/v3 -> real HTTP/PostgreSQL.
    const trainerBefore = (await state()).materialized_state;
    const trainerReviews = Number(sql(`SELECT COUNT(*) FROM tmareviewhistory WHERE user_id=${uidA}`));
    await page.evaluate(async () => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
      const host = document.createElement('div'); host.id = 'trainer-ui'; document.body.append(host);
      const root = createRoot(host);
      window.mountHttpTrainer = (card, assessmentMode, key) => {
        window.httpTrainerSaved = null; window.httpTrainerAnswers = [];
        root.render(React.createElement(ExerciseRenderer, { key, reviewKey: key, card, assessmentMode,
          onSaveState: state => { window.httpTrainerSaved = state; },
          onTrainerAnswer: (_id, evidence) => window.httpTrainerAnswers.push(evidence) }));
      };
      window.unmountHttpTrainer = () => root.unmount();
    });
    const trainerCard = { id: fixture.cardA, deck_id: fixture.deckA, front: 'Visible {*A|B} [[form]].',
      back: 'Synthetic translation', metadata: { assessment: { competency_ids: ['synthetic'] } } };
    for (const version of [2, 3]) {
      await page.evaluate(({ card, version }) => window.mountHttpTrainer(card, version === 3, `trainer-http-${version}`), { card: trainerCard, version });
      await page.locator('#trainer-ui .trainer-choice-gap').click();
      await page.getByRole('dialog').getByRole('button', { name: 'B', exact: true }).click();
      if (version === 2) await page.locator('#trainer-ui .trainer-toggle-trans-btn').click();
      else assert.equal(await page.locator('#trainer-ui .trainer-toggle-trans-btn').count(), 0);
      await page.locator('#trainer-ui input[type=text]').fill('wrong');
      await page.locator('#trainer-ui .trainer-footer-action').click();
      await page.waitForFunction(() => window.httpTrainerSaved?.evaluationState.supportState.hint_count === 2);
      if (version === 2) {
        assert.equal(await page.evaluate(() => window.httpTrainerAnswers.length), 0);
        await page.locator('#trainer-ui .trainer-choice-gap').click();
        await page.getByRole('dialog').getByRole('button', { name: 'A', exact: true }).click();
        await page.locator('#trainer-ui input[type=text]').fill('form');
        await page.locator('#trainer-ui .trainer-footer-action').click();
      }
      await page.waitForFunction(() => window.httpTrainerAnswers.length === 1);
      await page.evaluate(async ({ card, version, userId }) => {
        const evidence = window.httpTrainerAnswers[0];
        if (version === 2) {
          await (await import('/src/services/knowledgeCaptureService.js')).captureStudyKnowledgeAttempt({
            userId, card, grade: 2, exerciseEvidence: evidence });
        } else {
          const { recordAssessmentResult } = await import('/src/utils/assessment.js');
          const first = recordAssessmentResult({ id: 'http-trainer-support', userId, deckId: card.deck_id,
            index: 0, cards: [card], results: {}, config: { required_count: 1 } }, card.id, evidence);
          const later = recordAssessmentResult(first, card.id, { isCorrect: true });
          await (await import('/src/services/assessmentService.js')).saveAssessment(later, later.results[card.id]);
        }
      }, { card: trainerCard, version, userId: fixture.a.profile.user_id });
    }
    const trainerEvents = await page.evaluate(async () => (await (await import('/src/services/localDb.js')).getLocalDb().knowledge_attempt_outbox.toArray()));
    assert.equal(trainerEvents.length, 2);
    for (const event of trainerEvents) {
      const isV2 = event.evaluation_data.schema_version === 2;
      const payload = isV2 ? event.evaluation_data.exercise_evidence : event.evaluation_data;
      assert.deepEqual(payload.support_evidence, { tracking_complete: false, hint_count: isV2 ? 2 : 0,
        translation_view_count: isV2 ? 1 : 0, answer_reveal_count: null, other_help_count: null,
        capture_point: isV2 ? 'exercise_completion' : 'first_assessment_result', answer_attempt_count: isV2 ? 2 : 1 });
      assert.equal(payload.task_support.sentence_frame_present, true);
      assert.equal(payload.task_support.source_vocabulary_present, true);
    }
    await context.setOffline(true);
    assert.equal((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()))).transportFailed, true);
    await page.evaluate(async () => { const db = await import('/src/services/localDb.js'); db.closeLocalDb(); await db.getLocalDb().open(); });
    assert.equal(await countQueue(), 2);
    await context.setOffline(false);
    assert.equal((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
      (await import('/src/utils/auth.js')).getUserId()))).succeededCount, 2);
    const trainerAfter = (await state()).materialized_state;
    assert.equal(trainerAfter.evidence_event_count, trainerBefore.evidence_event_count + 2);
    assert.ok(Math.abs(trainerAfter.positive_evidence - trainerBefore.positive_evidence - .79) < 1e-10);
    assert.ok(Math.abs(trainerAfter.negative_evidence - trainerBefore.negative_evidence - 1.21) < 1e-10);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM tmareviewhistory WHERE user_id=${uidA}`)), trainerReviews);
    for (const event of trainerEvents) {
      const raw = JSON.parse(sql(`SELECT evaluation_data FROM tma_knowledge_attempt WHERE user_id=${uidA} AND client_event_id='${event.client_event_id}'`));
      assert.deepEqual(raw, event.evaluation_data);
      assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [event] })).results[0].status, 'duplicate');
      assert.equal((await request(fixture.b, '/knowledge/attempts/sync', { attempts: [event] })).results[0].status, 'rejected');
      const changed = structuredClone(event);
      (changed.evaluation_data.schema_version === 2 ? changed.evaluation_data.exercise_evidence : changed.evaluation_data).support_evidence.hint_count++;
      assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [changed] })).results[0].status, 'event_conflict');
      assert.deepEqual(JSON.parse(sql(`SELECT evaluation_data FROM tma_knowledge_attempt WHERE user_id=${uidA} AND client_event_id='${event.client_event_id}'`)), raw);
    }
    assert.deepEqual((await state()).materialized_state, trainerAfter);
    assert.equal((await state()).state_matches_rebuild, true);
    results.trainer_support_v2_v3_ui_offline_raw_postgres = 'PASS';

    if (fixture.d14Support) {
      for (const card of fixture.d14Support) {
        number(card.id); number(card.deck_id);
        await page.evaluate(async card => {
          await (await import('/src/services/knowledgeContentService.js')).prepareDeckKnowledge(card.deck_id);
          window.mountHttpTrainer(card, true, `d14-${card.sourceId}`);
        }, card);
        const gapData = await page.evaluate(async card => (await import('/src/utils/clozeParser.js')).parseClozeData(card, 'classic'), card);
        for (const gap of gapData.gaps) {
          if (gap.mode === 'choice') {
            await page.locator('#trainer-ui .trainer-choice-gap').click();
            await page.getByRole('dialog').getByRole('button', { name: gap.correctAnswer, exact: true }).click();
          } else await page.locator('#trainer-ui input[type=text]').fill(gap.correctAnswer);
        }
        await page.locator('#trainer-ui .trainer-footer-action').click();
        await page.waitForFunction(() => window.httpTrainerAnswers.length === 1);
        const [event] = await page.evaluate(async ({ card, userId }) => {
          const { recordAssessmentResult } = await import('/src/utils/assessment.js');
          const session = recordAssessmentResult({ id: `http-d14-${card.sourceId}`, userId, deckId: card.deck_id,
            cards: [card], index: 0, results: {}, config: { required_count: 1 } }, card.id, window.httpTrainerAnswers[0]);
          await (await import('/src/services/assessmentService.js')).saveAssessment(session, session.results[card.id]);
          const db = (await import('/src/services/localDb.js')).getLocalDb();
          return db.knowledge_attempt_outbox.toArray();
        }, { card, userId: fixture.a.profile.user_id });
        const evidence = event.evaluation_data;
        assert.equal(evidence.correct, true);
        assert.equal(evidence.task_support.answer_options_present, card.sourceId === 358365);
        assert.equal(evidence.task_support.source_text_present, card.sourceId === 358385);
        assert.equal(evidence.task_support.sentence_frame_present, true);
        assert.equal(evidence.task_support.source_vocabulary_present, true);
        assert.equal(evidence.support_evidence.tracking_complete, false);
        assert.equal(Object.hasOwn(evidence, 'independent'), false);
        assert.equal((await page.evaluate(async () => (await import('/src/services/knowledgeSyncService.js')).syncKnowledgeAttempts(
          (await import('/src/utils/auth.js')).getUserId()))).succeededCount, 1);
        const raw = JSON.parse(sql(`SELECT evaluation_data FROM tma_knowledge_attempt WHERE user_id=${uidA} AND client_event_id='${event.client_event_id}'`));
        assert.deepEqual(raw, evidence);
        assert.equal((await request(fixture.a, '/knowledge/attempts/sync', { attempts: [event] })).results[0].status, 'duplicate');
        assert.equal((await request(fixture.b, '/knowledge/attempts/sync', { attempts: [event] })).results[0].status, 'rejected');
      }
      assert.equal((await state()).state_matches_rebuild, true);
      results.d14_trainer_local_clones_raw_postgres = 'PASS';
    }
    await page.evaluate(() => window.unmountHttpTrainer());
    console.log('PASS: account switch, late real HTTP response and durable replay');
  } finally {
    if (release) await release();
    await browser.close();
    fs.writeFileSync(fixture.output, JSON.stringify(results, null, 2));
  }
}

main().then(() => console.log(JSON.stringify(results, null, 2))).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
