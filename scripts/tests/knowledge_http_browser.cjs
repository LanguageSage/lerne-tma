// Opt-in companion to run_knowledge_http_postgres.py. No API route fulfil/mocks.
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
