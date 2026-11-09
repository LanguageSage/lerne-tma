const { test, expect } = require('./isolated-fixture.cjs');
const fixture = JSON.parse(process.env.LERNE_RECOVERY_FIXTURE || 'null');
test.skip(!fixture, 'Use structured_cards_postgres.py --recovery-browser');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Loopback only');

test.afterEach(async ({ context }) => {
  // Discard route callbacks cancelled by browser-context teardown. Test-body
  // fetches and their response assertions still propagate every error.
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

test.beforeEach(async ({ page, context }) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5199'
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(token => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({user_id: 1, is_guest: false}));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({account_id: 1, access_token: token}));
  }, fixture.token);
  await context.route('**/api/**', async route => {
    const {pathname, search} = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({json: {decks: [fixture.deck], folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: {user_id: 1, is_guest: false}}});
    if (pathname === '/api/messages') return route.fulfill({json: []});
    return route.fulfill({response: await route.fetch({url: fixture.origin + pathname + search, maxRetries: 0})});
  });
  await page.goto('/');
  await expect(page.getByText(fixture.deck.name, {exact: true}).first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/useAuthStore.js')).useAuthStore.getState().isRestoring)).toBe(false);
  await page.evaluate(async () => {
    (await import('/src/services/knowledgeSyncOrchestrator.js')).stopKnowledgeSync();
    window.api = (await import('/src/services/api.js')).default;
    window.db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    window.sync = options => import('/src/services/syncService.js').then(m => m.syncService.sync(options));
    window.waitSync = async options => {
      for (let i = 0; i < 100; i++) {
        const result = await sync(options);
        if (result.reason !== 'Already syncing') return result;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Background sync never released lock');
    };
    (await import('/src/store/useSettingsStore.js')).useSettingsStore.setState({autoPlay: false, autoGenerateCardAudio: false});
  });
});

test('auto distractors must offer alternatives in actual Native Trainer', async ({page}, info) => {
  await page.evaluate(async fixture => {
    (await import('/src/store/useDeckStore.js')).useDeckStore.setState({currentDeck: fixture.deck, deckCards: []});
    const {useSessionStore} = await import('/src/store/useSessionStore.js');
    useSessionStore.getState().resetSession();
    useSessionStore.getState().addToHistory((await api.get(`/study/card/${fixture.card.id}`)).data);
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('study');
  }, fixture);
  await page.getByRole('button', {name: 'Пропуск 1', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const labels = await dialog.getByRole('button').allTextContents();
  console.log('NATIVE_AUTO_VISIBLE_CHOICES', JSON.stringify(labels));
  await page.screenshot({path: info.outputPath('native-auto.png'), fullPage: true});
  expect(labels.length).toBeGreaterThan(1);
});

test('physical PostgreSQL rollback must preserve cached acknowledged card', async ({page}, info) => {
  const saved = await page.evaluate(async deck => {
    const {networkApi} = await import('/src/services/networkApi.js');
    const response = await networkApi.post('/cards/save', {deck_id: deck.id, request_id: crypto.randomUUID(),
      content_v2: {schema_version: 2, card: {type: 'standard', data: {prompt: 'Created after backup', answer: 'Keep my content'}}}});
    await waitSync({pullOnly: true});
    const card = await db.cards.get(response.data.id);
    if (!card || card.is_dirty || card.offline_create_status) throw new Error('Fixture was not acknowledged and cached');
    await api.post('/__test_rollback', {});
    const result = await waitSync({pullOnly: true});
    return {before: card, after: await db.cards.get(card.id), result};
  }, fixture.deck);
  console.log('POST_RESTORE_DEXIE_RESULT', JSON.stringify(saved));
  await page.screenshot({path: info.outputPath('post-rollback.png'), fullPage: true});
  expect(saved.after).toEqual(saved.before);
  expect(saved.result.success).toBe(false);
  expect(saved.result.error_code).toBe('database_generation_conflict');
  const quarantine = await page.evaluate(async () => ({
    generation: await db.syncState.get('serverGeneration'),
    conflict: await db.syncState.get('serverGenerationConflict'),
    cards: await db.cards.toArray(),
  }));
  expect(quarantine.conflict.server_generation).not.toBe(quarantine.generation.generation);
  // Restart the browser page: quarantine and the acknowledged card must survive.
  await page.reload();
  await page.evaluate(async () => {
    window.db = await (await import('/src/services/localDb.js')).prepareLocalDb();
  });
  await expect.poll(() => page.evaluate(() => db.syncState.get('serverGenerationConflict'))).toEqual(quarantine.conflict);
  expect(await page.evaluate(() => db.cards.toArray())).toEqual(quarantine.cards);
  const blocked = await page.evaluate(async deck => {
    const { networkApi } = await import('/src/services/networkApi.js');
    try {
      await networkApi.post('/cards/save', { deck_id: deck.id, request_id: crypto.randomUUID(),
        content_v2: { schema_version: 2, card: { type: 'standard', data: { prompt: 'Must stay local', answer: 'Blocked' } } } });
      return null;
    } catch (error) { return error.response?.data?.detail?.code; }
  }, fixture.deck);
  expect(blocked).toBe('database_generation_conflict');
});

test('rollback after sync preflight retains the original pending deletion and UUID', async ({ page, context }) => {
  await page.evaluate(async () => {
    await waitSync({ pullOnly: true });
  });
  const before = await page.evaluate(async id => {
    const { offlineApi } = await import('/src/services/offlineApi.js');
    const current = await db.cards.get(id);
    await offlineApi.handle('post', '/cards/batch-delete', {
      request_id: crypto.randomUUID(), card_ids: [id], revisions: { [id]: current.revision },
    });
    return { cards: await db.cards.orderBy('id').toArray(),
      queue: await db.syncState.where('key').startsWith('card-lifecycle-v2:').toArray() };
  }, fixture.card.id);
  expect(before.queue).toHaveLength(1);
  const attempts = [];
  await context.route('**/api/cards/batch-delete', async route => {
    // Preflight already completed. Recreate tables just before this mutation.
    await route.fetch({ url: fixture.origin + '/api/__test_rollback', method: 'POST', postData: '{}' });
    const response = await route.fetch({ url: fixture.origin + '/api/cards/batch-delete', maxRetries: 0 });
    attempts.push(response.status());
    await route.fulfill({ response });
  });
  const result = await page.evaluate(() => waitSync({ pendingNativeOnly: true, skipPull: true }));
  expect(result.success).toBe(false);
  expect(result.native_success).toBe(false);
  expect(result.error_code).toBe('database_generation_conflict');
  expect(attempts).toEqual([409]);
  const after = await page.evaluate(async () => ({ cards: await db.cards.orderBy('id').toArray(),
    queue: await db.syncState.where('key').startsWith('card-lifecycle-v2:').toArray() }));
  expect(after).toEqual(before);
});
