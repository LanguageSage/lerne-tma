const { test, expect } = require('@playwright/test');
const { chromium } = require('@playwright/test');
const fixture = JSON.parse(process.env.LERNE_NATIVE_MEDIA_FIXTURE || 'null');
test.skip(!fixture, 'Use structured_cards_postgres.py --media-browser');
if (fixture && ![fixture.origin, fixture.browser_origin].every(value => /^http:\/\/127\.0\.0\.1:\d+$/.test(value))) throw new Error('Loopback only');

test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

async function setup(context, control = {}) {
  await context.route('**/*', route => new URL(route.request().url()).origin === fixture.browser_origin
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  await context.addInitScript(({ token, blockOnline }) => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
    if (blockOnline) window.addEventListener('online', event => event.stopImmediatePropagation(), true);
  }, { token: fixture.token, blockOnline: !control.allowOnline });
  const forward = async route => {
    const { pathname, search } = new URL(route.request().url());
    if (control.offline) return route.abort('internetdisconnected');
    if (control.delay === pathname) await new Promise(resolve => setTimeout(resolve, 1200));
    if (control.fail === pathname) return route.fulfill({ status: 503, json: { detail: 'Synthetic generation unavailable' } });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [fixture.deck, fixture.target],
      folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    const response = await route.fetch({ url: fixture.origin + pathname + search, maxRetries: 0 });
    if (control.tamper === pathname) {
      return route.fulfill({ json: { ...(await response.json()), sha256: '0'.repeat(64) } });
    }
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
    window.sync = options => import('/src/services/syncService.js').then(m => m.syncService.sync(options));
    window.waitSync = async options => {
      for (let i = 0; i < 100; i++) {
        const result = await sync(options);
        if (result.reason !== 'Already syncing') return result;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('Background sync never released lock');
    };
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
  // The short fixture can finish after playback is observed.
  await page.evaluate(async () => (await import('/src/hooks/useAudio.js')).stopGlobalAudio());
}

test('nine native types retain playable media through cache, restart, retries and lifecycle', async ({ browser }, info) => {
  test.setTimeout(300000);
  const profile = info.outputPath('profile');
  const options = { headless: true, serviceWorkers: 'block', baseURL: fixture.browser_origin,
    viewport: { width: 375, height: 900 } };
  let context = await chromium.launchPersistentContext(profile, options);
  const control = {};
  await setup(context, control);
  let page = await open(context);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const peer = await browser.newContext();
  try {
    expect((await page.evaluate(() => waitSync())).success).toBe(true);
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
        if (!(await waitSync()).success) throw new Error('Media edit delivery failed');
        const body = { card_id: id, voice: 'de-DE-KatjaNeural' };
        const first = (await api.post('/media/generate-card-audio', body)).data;
        const repeated = (await api.post('/media/generate-card-audio', body)).data;
        if (first.path !== repeated.path || first.revision !== repeated.revision) throw new Error('TTS retry changed object/revision');
      }, { id: card.id, media: fixture.cards.indexOf(card) % 2 ? { ...media,
        image_path: `${fixture.browser_origin}/api/media/${media.image_path}`,
        video_front_path: `${fixture.browser_origin}/api/media/${media.video_front_path}` } : media });
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
    expect((await second.evaluate(() => waitSync())).success).toBe(true);
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
        if (!(await waitSync({ pendingNativeOnly: true, skipPull: true })).success) throw new Error('Copy delivery failed');
        await api.post('/cards/batch-move', { ...body, request_id: crypto.randomUUID() });
        if (!(await waitSync({ pendingNativeOnly: true, skipPull: true })).success) throw new Error('Move delivery failed');
        const moved = (await api.get(`/cards/${id}`)).data;
        await api.post('/cards/batch-delete', { card_ids: [id],
          revisions: { [id]: moved.revision }, request_id: crypto.randomUUID() });
        if (!(await waitSync({ pendingNativeOnly: true, skipPull: true })).success) throw new Error('Delete delivery failed');
        const deleted = await db.cards.get(id);
        await api.post(`/trash/card/${id}/restore`, { revision: deleted.revision, request_id: crypto.randomUUID() });
        if (!(await waitSync({ pendingNativeOnly: true, skipPull: true })).success) throw new Error('Restore delivery failed');
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
    await page.evaluate(async origin => {
      (await import('/src/store/useSessionStore.js')).useSessionStore.getState().updateCardInSession(
        (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card.id,
        { image_url: '/api/media/images/missing.webp', video_front_url: '/api/media/videos/missing.mp4',
          audio_url: origin + '/storage/v1/object/public/audio/missing.mp3' });
    }, fixture.browser_origin);
    await expect(page.getByText('Загрузка видео...', { exact: true })).toBeVisible();
    await expect(page.getByText('Не удалось загрузить видео', { exact: true })).toBeVisible();
    await expect(page.getByText('Не удалось загрузить изображение', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('online-media-error.png'), fullPage: true });
    control.delay = null;
    // Uncached media and server errors have visible feedback, without silent regeneration.
    await page.evaluate(async ({ id, origin }) => {
      await db.cards.update(id, { image_path: 'images/missing.webp',
        video_front_path: 'videos/missing.mp4', audio_path: origin + '/storage/v1/object/public/audio/missing.mp3' });
    }, { id: fixture.cards[0].id, origin: fixture.browser_origin });
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

test('ready audio uploads through the editor, preserves sides and survives failures', async ({ context }, info) => {
  test.setTimeout(120000);
  const control = { allowOnline: true };
  await setup(context, control);
  const page = await open(context);
  const tts = [];
  page.on('request', request => { if (request.url().includes('/media/generate-')) tts.push(request.url()); });
  const card = await page.evaluate(async deck => {
    const { networkApi } = await import('/src/services/networkApi.js');
    const created = (await networkApi.post('/cards/save', {
      deck_id: deck, request_id: crypto.randomUUID(), content_v2: { schema_version: 2, card: {
        type: 'standard', data: { prompt: 'Fertige Aufnahme mit einer langen Beschreibung', answer: 'Готовая запись' } } },
    })).data;
    return (await api.get(`/cards/${created.id}`)).data;
  }, fixture.deck.id);
  expect(card.id).toBeGreaterThan(0);
  const openEditor = async value => {
    await page.evaluate(async ({ value, deck }) => {
      (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: deck });
      (await import('/src/store/useSessionStore.js')).useSessionStore.getState().setEditingCard(value);
      (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('editor');
    }, { value, deck: fixture.deck });
    const media = page.locator('details.card-form-secondary').first();
    if ((await media.getAttribute('open')) === null) await media.locator('summary').click();
  };
  await openEditor(card);
  const draft = () => page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().editingCard);
  const field = side => page.getByRole('group', { name: side === 'front' ? 'Аудио для вопроса' : 'Аудио для ответа' });
  // A real, playable PCM WAV generated in the test; it never leaves loopback.
  const recording = Buffer.alloc(44 + 16000);
  recording.write('RIFF'); recording.writeUInt32LE(recording.length - 8, 4); recording.write('WAVEfmt ', 8);
  recording.writeUInt32LE(16, 16); recording.writeUInt16LE(1, 20); recording.writeUInt16LE(1, 22);
  recording.writeUInt32LE(8000, 24); recording.writeUInt32LE(16000, 28); recording.writeUInt16LE(2, 32);
  recording.writeUInt16LE(16, 34); recording.write('data', 36); recording.writeUInt32LE(16000, 40);
  for (let i = 0; i < 8000; i++) recording.writeInt16LE(Math.round(1200 * Math.sin(i * .17)), 44 + i * 2);
  const select = async (side, bytes = recording) => field(side).locator('input[type=file]').setInputFiles({
    name: 'Готовая запись с длинным названием.wav', mimeType: 'audio/wav', buffer: bytes,
  });
  const attach = side => field(side).getByRole('button', { name: 'Прикрепить аудио', exact: true });
  await select('front');
  const preview = page.getByLabel('Предпрослушивание файла');
  await expect.poll(() => preview.evaluate(el => el.readyState)).toBeGreaterThan(1);
  await preview.evaluate(el => el.play());
  await expect.poll(() => preview.evaluate(el => el.currentTime)).toBeGreaterThan(0);
  await preview.evaluate(el => el.pause());
  expect((await draft()).audio_path).toBeFalsy();
  control.lose = '/api/media/upload-audio';
  await attach('front').click();
  await expect(page.locator('.card-audio-attachments [role=alert]')).toBeVisible();
  expect((await draft()).audio_path).toBeFalsy();
  control.lose = null;
  await attach('front').click();
  await expect(page.getByText('Аудио прикреплено к черновику. Сохраните карточку.', { exact: true })).toBeVisible();
  const firstPath = (await draft()).audio_path;
  expect(firstPath).toMatch(/audio_[a-f0-9]{64}\.wav$/);
  expect(await page.evaluate(async id => (await api.get(`/cards/${id}`)).data.audio_path, card.id)).toBeFalsy();
  // Both sides can reuse the same immutable object; no TTS request is made.
  await select('back'); await attach('back').click();
  await expect.poll(async () => (await draft()).audio_back_path).toBe(firstPath);
  await page.getByRole('button', { name: 'Сохранить карточку', exact: true }).click();
  await expect.poll(draft).toBeNull();
  await expect.poll(() => page.evaluate(() => waitSync())).toMatchObject({ success: true });
  const saved = await page.evaluate(async id => (await api.get(`/cards/${id}`)).data, card.id);
  expect(saved.audio_path).toBe(firstPath); expect(saved.audio_back_path).toBe(firstPath);
  await openEditor(saved);
  // Bad bytes, outage and a wrong integrity receipt leave both attachments intact.
  for (const failure of ['invalid', 'outage', 'digest']) {
    await select('front', failure === 'invalid' ? Buffer.from('<html>not audio</html>') : recording);
    control.fail = failure === 'outage' ? '/api/media/upload-audio' : null;
    control.tamper = failure === 'digest' ? '/api/media/upload-audio' : null;
    await attach('front').click();
    await expect(page.locator('.card-audio-attachments [role=alert]')).toBeVisible();
    expect((await draft()).audio_path).toBe(firstPath);
    expect((await draft()).audio_back_path).toBe(firstPath);
  }
  control.fail = null; control.tamper = null;
  // A different edit arriving during the request must win over a late upload.
  await select('front'); control.delay = '/api/media/upload-audio';
  await attach('front').click();
  await expect(page.getByRole('button', { name: 'Сохранить карточку', exact: true })).toBeDisabled();
  await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState()
    .setEditingCard(current => ({ ...current, revision: 'newer-draft' })));
  await expect(page.getByText('Карточка или аудио изменились. Выберите файл ещё раз.', { exact: true })).toBeVisible();
  expect((await draft()).audio_path).toBe(firstPath); control.delay = null;
  // Cancel discards the selected candidate, preserving the current attachment.
  await page.getByRole('button', { name: 'Отмена выбора', exact: true }).click();
  await select('back');
  await context.setOffline(true);
  await expect(attach('back')).toBeDisabled();
  await context.setOffline(false);
  await expect(attach('back')).toBeEnabled();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ready-audio-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => waitSync());
  await context.setOffline(true); control.offline = true;
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('en'));
  await expect(page.getByRole('group', { name: 'Answer audio' })).toBeVisible();
  expect(tts).toEqual([]);
});
