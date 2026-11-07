const { test, expect } = require('./isolated-fixture.cjs');
const { chromium } = require('@playwright/test');
const fixture = JSON.parse(process.env.LERNE_NATIVE_MEDIA_FIXTURE || 'null');
test.skip(!fixture, 'Use structured_cards_postgres.py --media-browser');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Loopback only');

async function setup(context, control = {}) {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5199'
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(token => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
    window.addEventListener('online', event => event.stopImmediatePropagation(), true);
  }, fixture.token);
  const forward = async route => {
    const { pathname, search } = new URL(route.request().url());
    if (control.offline) return route.abort('internetdisconnected');
    if (control.delay === pathname) await new Promise(resolve => setTimeout(resolve, 1200));
    if (control.fail === pathname) return route.fulfill({ status: 503, json: { detail: 'Synthetic generation unavailable' } });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [fixture.deck, fixture.target],
      folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    const response = await route.fetch({ url: fixture.origin + pathname + search, maxRetries: 0 });
    if (control.lose === pathname && route.request().method() !== 'GET') {
      expect(response.status(), await response.text()).toBe(200);
      control.committed = (control.committed || 0) + 1;
      return route.abort('connectionreset');
    }
    return route.fulfill({ response });
  };
  await context.route('**/api/**', forward);
  await context.route('**/storage/v1/**', forward);
}

async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  await page.goto('/');
  await expect(page.getByText(fixture.deck.name, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/store/useAuthStore.js')).useAuthStore.getState().isRestoring)).toBe(false);
  await page.evaluate(async () => {
    (await import('/src/services/knowledgeSyncOrchestrator.js')).stopKnowledgeSync();
    window.api = (await import('/src/services/api.js')).default;
    window.db = await (await import('/src/services/localDb.js')).prepareLocalDb();
    window.sync = () => import('/src/services/syncService.js').then(m => m.syncService.sync());
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ autoPlay: false, playerCollapsed: false, autoGenerateCardAudio: false });
  });
  return page;
}

async function show(page, id, flipped = false) {
  await page.evaluate(async ({ id, deck, flipped }) => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useDeckStore.setState({ currentDeck: deck, deckCards: [] });
    useSessionStore.getState().resetSession();
    useSessionStore.getState().addToHistory((await api.get(`/study/card/${id}`)).data);
    useSessionStore.getState().setIsFlipped(flipped);
    useUiStore.getState().setView('study');
  }, { id, deck: fixture.deck, flipped });
}

async function playable(page) {
  await expect.poll(() => page.locator('.video-container-card video').evaluate(el => el.readyState)).toBeGreaterThan(1);
  await expect.poll(() => page.locator('.video-container-card video').evaluate(el => el.currentTime)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.card-face img').first().evaluate(el => el.naturalWidth)).toBeGreaterThan(0);
  const play = page.getByRole('button', { name: 'Воспроизвести', exact: true }).last();
  await play.click();
  await expect(page.getByRole('button', { name: 'Пауза', exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Пауза', exact: true }).last().click();
}

test('nine native types retain playable media through cache, restart, retries and lifecycle', async ({ browser }, info) => {
  test.setTimeout(300000);
  const profile = info.outputPath('profile');
  const options = { headless: true, serviceWorkers: 'block', baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 375, height: 900 } };
  let context = await chromium.launchPersistentContext(profile, options);
  const control = {};
  await setup(context, control);
  let page = await open(context);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const peer = await browser.newContext();
  try {
    expect((await page.evaluate(() => sync())).success).toBe(true);
    // Generate synthetic image/video with browser APIs, then use the real uploads.
    const media = await page.evaluate(async id => {
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 90;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#6644cc'; ctx.fillRect(0, 0, 160, 90);
      const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const post = async (path, blob, filename) => {
        const body = new FormData(); body.append('file', blob, filename);
        return (await api.post(path, body)).data;
      };
      const picture = await post('/media/upload-image', image, 'synthetic.png');
      const stream = canvas.captureStream(8);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#6644cc' : '#228899'; ctx.fillRect(0, 0, 160, 90);
        await new Promise(resolve => setTimeout(resolve, 125));
      }
      recorder.stop(); await stopped;
      stream.getTracks().forEach(track => track.stop());
      const video = await post('/media/upload-video', new Blob(chunks, { type: 'video/webm' }), 'synthetic.webm');
      const audio = (await api.post('/media/generate-card-audio', { card_id: id })).data;
      return { image_path: picture.path, audio_path: audio.path, audio_back_path: audio.path,
        video_front_path: video.path, video_back_path: video.path };
    }, fixture.cards[0].id);
    for (const card of fixture.cards) {
      await page.evaluate(async ({ id, media }) => {
        const current = (await api.get(`/cards/${id}`)).data;
        await api.patch(`/cards/${id}`, { content_v2: current.content_v2, revision: current.revision,
          request_id: crypto.randomUUID(), ...media }, { offlineCardEdit: true });
        if (!(await sync()).success) throw new Error('Media edit delivery failed');
        const body = { card_id: id, voice: 'de-DE-KatjaNeural' };
        const first = (await api.post('/media/generate-card-audio', body)).data;
        const repeated = (await api.post('/media/generate-card-audio', body)).data;
        if (first.path !== repeated.path || first.revision !== repeated.revision) throw new Error('TTS retry changed object/revision');
      }, { id: card.id, media: fixture.cards.indexOf(card) % 2 ? { ...media,
        image_path: `http://127.0.0.1:5199/api/media/${media.image_path}`,
        video_front_path: `http://127.0.0.1:5199/api/media/${media.video_front_path}` } : media });
      await show(page, card.id);
      await playable(page);
      await show(page, card.id, true);
      await playable(page);
    }
    await expect.poll(() => page.evaluate(() => db.media.count())).toBeGreaterThanOrEqual(11);
    // Online source reads must populate Dexie; no direct cache seeding.
    await context.setOffline(true); control.offline = true;
    for (const card of fixture.cards) {
      await show(page, card.id);
      await playable(page);
      expect(await page.evaluate(() => (import('/src/store/useSessionStore.js')).then(m => m.useSessionStore.getState().card.audio_url))).toMatch(/^blob:/);
    }
    await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    await setup(context, control);
    // Serve the shell from Vite, keep all remote API/media requests disconnected.
    page = await open(context);
    await context.setOffline(true);
    page.on('pageerror', error => errors.push(error.message));
    for (const card of fixture.cards) {
      await show(page, card.id, true); await playable(page);
    }
    await page.screenshot({ path: info.outputPath('offline-restarted.png'), fullPage: true });
    await context.setOffline(false); control.offline = false;
    // Lost TTS response: backend commit survives; retry preserves object/revision.
    control.lose = '/api/media/generate-card-audio';
    await page.evaluate(async id => {
      try { await api.post('/media/generate-card-audio', { card_id: id }); throw new Error('Expected lost response'); }
      catch (error) { if (error.message === 'Expected lost response') throw error; }
    }, fixture.cards[0].id);
    expect(control.committed).toBe(1); control.lose = null;
    const authoritative = await page.evaluate(async id => (await api.get(`/cards/${id}`)).data, fixture.cards[0].id);
    const retried = await page.evaluate(async id => (await api.post('/media/generate-card-audio', { card_id: id })).data, fixture.cards[0].id);
    expect(retried.revision).toBe(authoritative.revision);
    expect(retried.path).toBe(authoritative.audio_path);
    // Second device obtains canonical paths and its own blobs through real pull.
    await setup(peer);
    const second = await open(peer);
    expect((await second.evaluate(() => sync())).success).toBe(true);
    for (const card of fixture.cards) { await show(second, card.id); await playable(second); }
    // Pending edit survives a lost PATCH response and a full process restart.
    await context.setOffline(true); control.offline = true;
    await page.evaluate(async cards => {
      for (const { id } of cards) {
        const card = (await api.get(`/cards/${id}`)).data;
        card.content_v2.card.explanation = 'Edited with media preserved';
        await api.patch(`/cards/${id}`, { content_v2: card.content_v2, revision: card.revision,
          request_id: crypto.randomUUID() }, { offlineCardEdit: true });
      }
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const { useUiStore } = await import('/src/store/useUiStore.js');
      await useDeckStore.getState().fetchDeckCards(cards[0].deck_id);
      useUiStore.getState().setView('cards');
    }, fixture.cards);
    await expect(page.getByText('Ожидает синхронизации').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('pending-media-edit.png'), fullPage: true });
    await context.setOffline(false); control.offline = false;
    control.lose = `/api/cards/${fixture.cards[0].id}`;
    await page.evaluate(() => sync());
    expect(control.committed).toBe(2);
    await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close();
    context = await chromium.launchPersistentContext(profile, options); control.lose = null;
    await setup(context, control); page = await open(context);
    await expect.poll(() => page.evaluate(() => sync()), { timeout: 15000 }).toMatchObject({ success: true });
    expect(await page.evaluate(() => db.cards.filter(card => Boolean(card.offline_edit)).count())).toBe(0);
    for (const card of fixture.cards) {
      await page.evaluate(async ({ id, target }) => {
        const current = (await api.get(`/cards/${id}`)).data;
        const body = { card_ids: [id], target_deck_id: target, revisions: { [id]: current.revision },
          on_duplicate: 'keep', request_id: crypto.randomUUID() };
        await api.post('/cards/batch-copy', body);
        await api.post('/cards/batch-move', { ...body, request_id: crypto.randomUUID() });
        const moved = (await api.get(`/cards/${id}`)).data;
        const deleted = (await api.post('/cards/batch-delete', { card_ids: [id],
          revisions: { [id]: moved.revision }, request_id: crypto.randomUUID() })).data;
        await api.post(`/trash/card/${id}/restore`, { revision: deleted.revision, request_id: crypto.randomUUID() });
      }, { id: card.id, target: fixture.target.id });
      await show(page, card.id); await playable(page);
    }
    // Real generation controls expose pending/failed requests and preserve the recording.
    await show(page, fixture.cards[0].id);
    control.delay = control.fail = '/api/media/generate-card-audio';
    await page.getByRole('button', { name: 'Перезаписать', exact: true }).click();
    await expect(page.locator('.audio-player-btn-regenerate')).toBeDisabled();
    await expect(page.getByText('Генерирую…', { exact: true })).toBeVisible();
    await expect(page.getByText('Synthetic generation unavailable', { exact: true })).toBeVisible();
    control.delay = control.fail = null;
    // Slow/missing network media exercises loading and online failure UI.
    control.delay = '/api/media/videos/missing.mp4';
    await page.evaluate(async () => {
      (await import('/src/store/useSessionStore.js')).useSessionStore.getState().updateCardInSession(
        (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card.id,
        { image_url: '/api/media/images/missing.webp', video_front_url: '/api/media/videos/missing.mp4',
          audio_url: 'http://127.0.0.1:5199/storage/v1/object/public/audio/missing.mp3' });
    });
    await expect(page.getByText('Загрузка видео...', { exact: true })).toBeVisible();
    await expect(page.getByText('Не удалось загрузить видео', { exact: true })).toBeVisible();
    await expect(page.getByText('Не удалось загрузить изображение', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('online-media-error.png'), fullPage: true });
    control.delay = null;
    // Uncached media and server errors have visible feedback, without silent regeneration.
    await page.evaluate(async id => {
      await db.cards.update(id, { image_path: 'images/missing.webp',
        video_front_path: 'videos/missing.mp4', audio_path: 'http://127.0.0.1:5199/storage/v1/object/public/audio/missing.mp3' });
    }, fixture.cards[0].id);
    await context.setOffline(true); control.offline = true;
    await show(page, fixture.cards[0].id);
    await expect(page.getByText('Изображение недоступно без сети', { exact: true })).toBeVisible();
    await expect(page.getByText('Видео недоступно без сети', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Воспроизвести', exact: true }).last().click();
    await expect(page.getByText('Аудио недоступно без сети', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Перезаписать', exact: true }).click();
    await expect(page.getByText('Для создания озвучки нужно подключение к сети', { exact: true })).toBeVisible();
    await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
    await expect(page.getByText('Image unavailable offline', { exact: true })).toBeVisible();
    await expect(page.getByText('Video unavailable offline', { exact: true })).toBeVisible();
    await expect(page.getByText('Audio unavailable offline', { exact: true })).toBeVisible();
    await expect(page.getByText('Connect to the internet to generate audio', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('offline-generation-error-en.png'), fullPage: true });
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`unavailable-${width}.png`), fullPage: true });
    }
    expect(errors).toEqual([]);
  } finally {
    await peer.close();
    await context.unrouteAll({ behavior: 'ignoreErrors' }); await context.close();
  }
});
