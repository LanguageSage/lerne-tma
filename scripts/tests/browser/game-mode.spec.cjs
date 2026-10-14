const { test, expect } = require('@playwright/test');

async function setup(page, context, { mode = 'mock', guest = false, failTurn = false, voice = false, ttsFail = false, turnDelay = 150, maxTurns = 40 } = {}) {
  const errors = [];
  const requests = [];
  const attempts = new Map();
  const audioRequests = [];
  let aiMode = mode;
  let shouldFail = failTurn;
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(guest => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_welcome_seen', 'true');
    localStorage.setItem('lerne_tut_seen_welcome', 'true');
    if (guest) localStorage.setItem('lerne_force_guest', 'true');
    else {
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'isolated-game-access', refresh_token: 'isolated-game-refresh' }));
      localStorage.setItem('lerne_user_id', '1');
      localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, first_name: 'Learner', is_guest: false }));
    }
  }, guest);
  if (voice) await context.addInitScript(() => {
    window.__voice = { recognizers: [], audios: [], tracksStopped: 0, overlap: 0, micError: false };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, writable: true, value: async () => {
      if (window.__voice.micError) throw new DOMException('Denied', 'NotAllowedError');
      return { getTracks: () => [{ stop: () => window.__voice.tracksStopped++ }] };
    } });
    window.SpeechRecognition = class {
      constructor() { window.__voice.recognizers.push(this); this.results = []; }
      start() {
        if (window.__voice.audios.some(a => !a.paused)) window.__voice.overlap++;
        this.active = true;
        queueMicrotask(() => this.onstart?.());
      }
      stop() { this.active = false; queueMicrotask(() => this.onend?.()); }
      abort() { this.active = false; }
      result(text, final = true, confidence = .95) {
        const result = [{ transcript: text, confidence }]; result.isFinal = final;
        this.results = [result];
        this.onresult?.({ results: this.results });
      }
    };
    window.Audio = class {
      constructor(url) { this.src = url; this.paused = true; this.currentTime = 0; this.duration = 2; window.__voice.audios.push(this); }
      load() {}
      play() {
        if (window.__voice.recognizers.some(r => r.active)) window.__voice.overlap++;
        this.paused = false;
        this.onplay?.(); this.oncanplaythrough?.();
        return Promise.resolve();
      }
      pause() { this.paused = true; this.onpause?.(); }
      end() { this.paused = true; this.ended = true; this.onended?.(); }
    };
  });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const profile = { user_id: 1, first_name: 'Learner', is_guest: false };
    if (pathname === '/api/game/scene') return route.fulfill({ json: {
      npc: { id: 'frau_mueller', name: 'Frau Müller', age: 52, profession: 'Bibliothekarin', tts_voice: 'de-DE-KatjaNeural' },
      scene: { id: 'stadtbibliothek', name: 'Stadtbibliothek', situation_id: 'library_balcony_book_v1' }, ai_mode: aiMode,
    } });
    if (pathname === '/api/game/attempts') {
      const { attempt_id } = route.request().postDataJSON();
      if (!attempts.has(attempt_id)) attempts.set(attempt_id, {
        id: attempt_id, version: 0, hint_count: 0, clarification_count: 0, turn_count: 0, max_turns: maxTurns,
        outcome: 'ongoing', scene: { slow_speech: false }, book: null,
        previous_attempt_at: attempts.size ? '2026-10-10T12:00:00Z' : null,
        history: [{ role: 'npc', text: 'Guten Tag! Welches Buch suchen Sie?' }],
      });
      return route.fulfill({ json: attempts.get(attempt_id) });
    }
    if (pathname.startsWith('/api/game/attempts/')) {
      const id = pathname.split('/')[4];
      const data = attempts.get(id);
      if (!data) return route.fulfill({ status: 404, json: { detail: 'game_attempt_not_found' } });
      if (pathname.endsWith('/turns')) {
        const request = route.request().postDataJSON();
        requests.push(request);
        if (shouldFail) { shouldFail = false; return route.fulfill({ status: 503, json: { detail: 'game_ai_unavailable' } }); }
        await new Promise(resolve => setTimeout(resolve, turnDelay));
        data.version += 1;
        data.turn_count += 1;
        if (request.action === 'hint') {
          data.hint_count += 1;
          data.history.push({ role: 'hint', text: 'Beschreiben Sie Thema, Balkon und Erfahrung.' });
        } else {
          data.history.push({ role: 'user', text: request.message });
          if (request.message.includes('ausleihen')) {
            data.outcome = 'success';
            data.book = { id: 'balcony_first_steps', title: 'Mein erster Balkongarten' };
            data.history.push({ role: 'npc', text: 'Hier ist „Mein erster Balkongarten“. Sie haben das Buch jetzt ausgeliehen.' });
          } else data.history.push({ role: 'npc', text: 'Ich helfe Ihnen gern. Welches Thema interessiert Sie?' });
        }
      }
      return route.fulfill({ json: data });
    }
    if (pathname === '/api/media/generate-audio') {
      audioRequests.push(route.request().postDataJSON());
      return voice && !ttsFail ? route.fulfill({ json: { path: '/api/media/audio/fixture.mp3' } })
        : route.fulfill({ status: 503, json: { detail: 'tts_unavailable' } });
    }
    if (guest) return route.fulfill({ status: 401, json: { detail: 'authentication_required' } });
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [], folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: profile } });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: profile });
    if (pathname === '/api/auth/v2/identities') return route.fulfill({ json: { providers: ['email_password'] } });
    if (pathname === '/api/decks' || pathname === '/api/folders') return route.fulfill({ json: [] });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: profile } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.locator('.view-decks')).toBeVisible();
  return { errors, requests, attempts, audioRequests, setMode: value => { aiMode = value; } };
}

async function enter(page) {
  await page.locator('.game-entry').click();
  await expect(page.getByRole('heading', { name: 'Stadtbibliothek' })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('Guten Tag!');
  await expect(page.getByRole('button', { name: 'Новый диалог', exact: true })).toBeEnabled();
}

test('conversation, success, repeat, hint, new dialogue and TTS failure', async ({ page, context }, testInfo) => {
  const fixture = await setup(page, context);
  await enter(page);
  await expect(page.getByText('MOCK:', { exact: false })).toBeVisible();
  await page.getByLabel('Ваша реплика на немецком').fill('Ich wollen Buch Gemüse Balkon. Ich Anfänger. Ausleihen bitte. ausleihen');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('.game-result')).toContainText('Задача решена');
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.game-conversation')).toContainText('Повтор');
  expect(fixture.requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Подсказка', exact: true }).click();
  await expect(page.locator('.game-message-hint')).toContainText('Beschreiben');
  await page.getByRole('button', { name: 'Слушать', exact: true }).click();
  await expect(page.getByText('Озвучивание недоступно.', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 1300 });
  await page.locator('#app-container').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('game-success-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Новый диалог', exact: true }).click();
  await expect(page.locator('.game-message')).toHaveCount(1);
  await expect(page.locator('.game-result')).toHaveCount(0);
  await expect(page.getByText('Предыдущая попытка:', { exact: false })).toBeVisible();
  expect(fixture.attempts.size).toBe(2);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.locator('.view-decks')).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('recoverable AI failure preserves draft and reuses request ID', async ({ page, context }) => {
  const fixture = await setup(page, context, { failTurn: true, mode: 'live' });
  await enter(page);
  const input = page.getByLabel('Ваша реплика на немецком');
  await input.fill('Ich suche ein Buch.');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ИИ временно недоступен');
  await expect(input).toHaveValue('Ich suche ein Buch.');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeDisabled();
  await expect(input).toHaveValue('');
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[0].request_id).toBe(fixture.requests[1].request_id);
  expect(fixture.errors).toEqual([]);
});

test('localized responsive states and unconfigured AI', async ({ page, context }, testInfo) => {
  const fixture = await setup(page, context, { mode: 'unconfigured' });
  await enter(page);
  await expect(page.getByText('ИИ не настроен.', { exact: false })).toBeVisible();
  await expect(page.locator('#game-message')).toBeDisabled();
  for (const locale of ['ru', 'en', 'uk']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const button of await page.locator('.game-view button:visible').all()) {
        const bounds = await button.boundingBox();
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      await expect(page.locator('.game-notice')).not.toContainText('undefined');
    }
  }
  await page.setViewportSize({ width: 375, height: 1300 });
  await page.locator('#app-container').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('game-unconfigured-mobile.png'), fullPage: true });
  fixture.setMode('live');
  await page.locator('.game-header > .game-button').click();
  await expect(page.locator('#game-message')).toBeEnabled();
  expect(fixture.errors).toEqual([]);
});

test('guest entry uses existing login and never creates an anonymous conversation', async ({ page, context }) => {
  const fixture = await setup(page, context, { guest: true });
  await page.locator('.game-entry').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(fixture.attempts.size).toBe(0);
  expect(fixture.errors).toEqual([]);
});

test('reload restores the conversation and browser Back returns to Classic', async ({ page, context }) => {
  const fixture = await setup(page, context);
  await enter(page);
  await page.getByLabel('Ваша реплика на немецком').fill('Guten Tag!');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('');
  await page.reload();
  await expect(page.locator('.view-decks')).toBeVisible();
  await enter(page);
  await expect(page.locator('.game-message-user')).toContainText('Guten Tag!');
  expect(fixture.attempts.size).toBe(1);
  await page.goBack();
  await expect(page.locator('.view-decks')).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

async function enableVoice(page) {
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await expect(page.getByText('Frau Müller говорит…', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__voice.audios.some(a => !a.paused))).toBe(true);
  await page.evaluate(() => window.__voice.audios.find(a => !a.paused).end());
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
}

test('voice loop, imperfect German, topic changes, replay, pause, off and no duplicate turns', async ({ page, context }, testInfo) => {
  const fixture = await setup(page, context, { voice: true, mode: 'live' });
  await enter(page);
  await page.getByLabel('Отправлять после паузы').check();
  await page.getByLabel('Пауза перед отправкой').selectOption('2');
  expect(await page.evaluate(() => window.__voice.recognizers.length)).toBe(0);
  await enableVoice(page);
  await page.setViewportSize({ width: 375, height: 1300 });
  await page.locator('#app-container').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('game-voice-listening-mobile.png'), fullPage: true });
  for (const message of ['Ich wollen Buch Gemüse Balkon.', 'Warum mögen Sie Musik?', 'Ja, danke.']) {
    await page.evaluate(text => {
      const rec = window.__voice.recognizers.find(r => r.active);
      window.__lateResult = rec.onresult;
      window.__lateEnd = rec.onend;
      rec.result(text);
    }, message);
    await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue(message);
    await expect(page.getByText('Frau Müller говорит…', { exact: true })).toBeVisible();
    await page.evaluate(() => { window.__lateResult({ results: [] }); window.__lateEnd(); });
    await expect.poll(() => page.evaluate(() => window.__voice.audios.some(a => !a.paused))).toBe(true);
    await page.evaluate(() => window.__voice.audios.find(a => !a.paused).end());
    await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  }
  expect(fixture.requests.map(r => r.message)).toEqual(['Ich wollen Buch Gemüse Balkon.', 'Warum mögen Sie Musik?', 'Ja, danke.']);
  expect(new Set(fixture.requests.map(r => r.request_id)).size).toBe(3);
  expect(fixture.audioRequests.every(r => r.voice === 'de-DE-KatjaNeural' && r.lang === 'de')).toBe(true);
  expect(fixture.audioRequests[0].text).toBe('Guten Tag! Welches Buch suchen Sie?');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByText('Frau Müller говорит…', { exact: true })).toBeVisible();
  expect(fixture.requests).toHaveLength(3);
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  await expect(page.getByText('Микрофон выключен', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__voice.overlap)).toBe(0);
  expect(await page.evaluate(() => window.__voice.tracksStopped)).toBe(1);
  for (const locale of ['ru', 'en', 'uk']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 1100 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('game-voice-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 1300 });
  await page.locator('#app-container').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('game-voice-mobile.png'), fullPage: true });
  expect(fixture.errors).toEqual([]);
});

test('voice rejects silence, interim and uncertain recognition; supports manual finish and text', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page);
  await page.getByLabel('Отправлять после паузы').check();
  await page.getByLabel('Пауза перед отправкой').selectOption('2');
  await page.getByLabel('Озвучивать ответы автоматически').uncheck();
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).stop());
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.filter(r => r.active).length)).toBe(1);
  expect(fixture.requests).toHaveLength(0);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Vielleicht', false));
  await expect(page.getByRole('alert')).toContainText('Проверьте распознанный текст');
  expect(fixture.requests).toHaveLength(0);
  await page.getByLabel('Ваша реплика на немецком').fill('Guten Tag!');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Unklar', true, .2));
  await expect(page.getByRole('alert')).toContainText('Проверьте распознанный текст');
  expect(fixture.requests).toHaveLength(1);
  await page.getByLabel('Ваша реплика на немецком').fill('');
  await page.getByLabel('Отправлять после паузы').uncheck();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Ich habe eine Frage.'));
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(2);
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  expect(fixture.errors).toEqual([]);
});

test('microphone, recognition, AI and TTS failures preserve a usable text alternative', async ({ page, context }, testInfo) => {
  const fixture = await setup(page, context, { voice: true, failTurn: true, ttsFail: true });
  await enter(page);
  await page.getByLabel('Отправлять после паузы').check();
  await page.getByLabel('Пауза перед отправкой').selectOption('2');
  await page.evaluate(() => { window.__voice.micError = true; });
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Нет доступа к микрофону');
  await page.setViewportSize({ width: 320, height: 1300 });
  await page.screenshot({ path: testInfo.outputPath('game-voice-error-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  await page.evaluate(() => { window.__voice.micError = false; });
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Озвучивание недоступно');
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  await page.getByLabel('Озвучивать ответы автоматически').uncheck();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).onerror({ error: 'network' }));
  await expect(page.getByRole('alert')).toContainText('Ошибка распознавания');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Wie geht es Ihnen?'));
  await expect(page.getByRole('alert')).toContainText('ИИ временно недоступен');
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('Wie geht es Ihnen?');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('');
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[0].request_id).toBe(fixture.requests[1].request_id);
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test('voice cancellation retires permission, audio retries and stuck recognizers', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      window.__grantPermission = async () => { navigator.mediaDevices.getUserMedia = original; resolve(await original()); };
    });
  });
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  await page.evaluate(() => window.__grantPermission());
  expect(await page.evaluate(() => window.__voice.recognizers.length)).toBe(0);
  expect(fixture.audioRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.audios.some(a => !a.paused))).toBe(true);
  await page.clock.install();
  await page.evaluate(() => window.__voice.audios.find(a => !a.paused).onerror());
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  const audioCount = await page.evaluate(() => window.__voice.audios.length);
  await page.clock.fastForward(1000);
  expect(await page.evaluate(() => window.__voice.audios.length)).toBe(audioCount);
  await page.getByLabel('Озвучивать ответы автоматически').uncheck();
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => { window.__voice.recognizers.find(r => r.active).stop = () => {}; });
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await page.clock.fastForward(3100);
  await expect(page.getByRole('alert')).toContainText('Распознавание не завершилось');
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  expect(fixture.requests).toHaveLength(0);
  expect(fixture.errors).toEqual([]);
});

test('pause during AI processing prevents playback and microphone restart', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true, turnDelay: 1000 });
  await enter(page);
  await enableVoice(page);
  await page.getByLabel('Ваша реплика на немецком').fill('Ich möchte etwas fragen.');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  expect(await page.evaluate(() => window.__voice.audios.some(a => !a.paused))).toBe(false);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.audioRequests).toHaveLength(1);
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  expect(fixture.errors).toEqual([]);
});

test('last allowed NPC reply is spoken, and replay keeps a paused microphone paused', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true, maxTurns: 1 });
  await enter(page);
  await page.getByLabel('Отправлять после паузы').check();
  await page.getByLabel('Пауза перед отправкой').selectOption('2');
  await enableVoice(page);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Danke!'));
  await expect(page.getByText('Достигнут лимит этого разговора.', { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__voice.audios.some(a => !a.paused))).toBe(true);
  await page.evaluate(() => window.__voice.audios.find(a => !a.paused).end());
  await expect(page.getByText('Голосовой разговор приостановлен', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.audios.some(a => !a.paused))).toBe(true);
  await page.evaluate(() => window.__voice.audios.find(a => !a.paused).end());
  await expect(page.getByText('Голосовой разговор приостановлен', { exact: true })).toBeVisible();
  expect(fixture.requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  expect(fixture.errors).toEqual([]);
});

async function startQuietVoice(page) {
  await page.getByLabel('Озвучивать ответы автоматически').uncheck();
  await page.getByRole('button', { name: 'Включить голос', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
}

for (const final of [false, true]) test(`growing recognition hypotheses replace previous prefixes (final=${final})`, async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page); await startQuietVoice(page);
  const hypotheses = ['guten', 'guten Tag', 'guten Tag', 'guten Tag', 'guten Tag ich',
    'guten Tag ich suche', 'guten Tag ich suche', 'guten Tag ich suche', 'guten Tag ich suche ein Buch'];
  await page.evaluate(({ hypotheses, final }) => {
    const rec = window.__voice.recognizers.find(r => r.active);
    const results = [];
    for (const text of hypotheses) {
      const result = [{ transcript: text, confidence: .95 }]; result.isFinal = final;
      results.push(result);
      rec.onresult({ results, resultIndex: results.length - 1 });
    }
    // Native wrappers may append a final cumulative result instead of revising a slot.
    if (!final) {
      const result = [{ transcript: 'Guten Tag, ich suche ein Buch.', confidence: .95 }]; result.isFinal = true;
      results.push(result);
      rec.onresult({ results, resultIndex: results.length - 1 });
    }
  }, { hypotheses, final });
  const expected = final ? 'guten Tag ich suche ein Buch' : 'Guten Tag, ich suche ein Buch.';
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue(expected);
  await expect(page.locator('.game-transcript [lang="de"]')).toHaveText(expected);
  expect(fixture.requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  expect(fixture.requests[0].message).toBe(expected);
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  expect(fixture.errors).toEqual([]);
});

test('cumulative interim across browser restarts is replaced by the final phrase, then autosent once', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page);
  await page.getByLabel('Отправлять после паузы').check();
  await page.getByLabel('Пауза перед отправкой').selectOption('2');
  await startQuietVoice(page); await page.clock.install();
  for (const text of ['guten', 'Guten Tag', 'Guten Tag ich suche']) {
    await page.evaluate(text => {
      const rec = window.__voice.recognizers.find(r => r.active);
      rec.result(text, false); rec.stop();
    }, text);
    await page.clock.fastForward(400);
    await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  }
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    rec.result('Guten Tag, ich suche ein Buch.', true);
    window.__duplicateEnd = rec.onend;
  });
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('Guten Tag, ich suche ein Buch.');
  expect(fixture.requests).toHaveLength(0);
  await page.clock.fastForward(2100);
  await expect.poll(() => fixture.requests.length).toBe(1);
  expect(fixture.requests[0].message).toBe('Guten Tag, ich suche ein Buch.');
  await page.evaluate(() => window.__duplicateEnd());
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  await page.clock.fastForward(3000);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.errors).toEqual([]);
});

test('distinct finalized segments and deliberate repeats are retained', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page); await startQuietVoice(page);
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    const results = ['Ja', 'Ja', 'ja', 'Guten Tag', 'Guten Tag', 'Ich', 'ich suche ein Buch.', 'Buch', 'Bücher', 'sehr sehr gut.'].map(text => {
      const result = [{ transcript: text, confidence: .95 }]; result.isFinal = true; return result;
    });
    rec.onresult({ results, resultIndex: 0 });
    rec.onresult({ results, resultIndex: results.length - 1 });
  });
  const expected = 'Ja Ja ja Guten Tag Guten Tag Ich ich suche ein Buch. Buch Bücher sehr sehr gut.';
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue(expected);
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  expect(fixture.requests[0].message).toBe(expected);
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  expect(fixture.errors).toEqual([]);
});

test('a tentative repeated word does not overwrite the finalized word before it', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page); await startQuietVoice(page);
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    const first = [{ transcript: 'Ja', confidence: .95 }]; first.isFinal = true;
    const second = [{ transcript: 'ja', confidence: .95 }]; second.isFinal = false;
    rec.onresult({ results: [first, second], resultIndex: 1 });
    window.__finishRepeatedWord = () => {
      second.isFinal = true;
      rec.onresult({ results: [first, second], resultIndex: 1 });
    };
  });
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('Ja ja');
  await page.evaluate(() => window.__finishRepeatedWord());
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  expect(fixture.requests[0].message).toBe('Ja ja');
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  expect(fixture.errors).toEqual([]);
});

test('manual default preserves pauses, native restarts and result snapshots until Finish', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page);
  await expect(page.getByLabel('Отправлять после паузы')).not.toBeChecked();
  await startQuietVoice(page);
  await page.clock.install();
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Ich möchte'));
  await page.clock.fastForward(60000);
  expect(fixture.requests).toHaveLength(0);
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    window.__oldResult = rec.onresult; window.__oldEnd = rec.onend;
    rec.stop();
  });
  await page.clock.fastForward(400);
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    rec.result('ein Buch', false);
    rec.result('ein Buch', false);
    rec.result('ein Buch', true);
    rec.result('ein Buch', true);
    window.__oldResult({ results: [] }); window.__oldEnd();
  });
  await page.clock.fastForward(6000);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).stop());
  await page.clock.fastForward(400);
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    const results = ['über Autos.', 'Ja, ja.'].map(text => {
      const result = [{ transcript: text, confidence: .95 }]; result.isFinal = true; return result;
    });
    rec.onresult({ results }); rec.onresult({ results });
    window.__lastResult = rec.onresult; window.__lastEnd = rec.onend;
  });
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('Ich möchte ein Buch über Autos. Ja, ja.');
  expect(fixture.requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  expect(fixture.requests[0].message).toBe('Ich möchte ein Buch über Autos. Ja, ja.');
  await page.evaluate(() => { window.__lastResult({ results: [] }); window.__lastEnd(); });
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  await page.clock.fastForward(6000);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.errors).toEqual([]);
});

for (const seconds of [2, 5]) test(`automatic ${seconds}s pause survives native end and interim revisions without early send`, async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page);
  await page.getByLabel('Отправлять после паузы').check();
  await page.getByLabel('Пауза перед отправкой').selectOption(String(seconds));
  await startQuietVoice(page);
  await page.clock.install();
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    rec.result('Ich suche'); rec.onerror({ error: 'no-speech' }); rec.stop();
  });
  await page.clock.fastForward(400);
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  expect(fixture.requests).toHaveLength(0);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('ein', false));
  await page.clock.fastForward(seconds * 1000 - 100);
  expect(fixture.requests).toHaveLength(0);
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    rec.result('ein Buch über Autos.', true);
    window.__finalEnd = rec.onend;
  });
  await page.clock.fastForward(seconds * 1000 - 100);
  expect(fixture.requests).toHaveLength(0);
  await page.clock.fastForward(150);
  await expect.poll(() => fixture.requests.length).toBe(1);
  expect(fixture.requests[0].message).toBe('Ich suche ein Buch über Autos.');
  await page.evaluate(() => window.__finalEnd());
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  await page.clock.fastForward(6000);
  expect(fixture.requests).toHaveLength(1);
  await page.reload(); await enter(page);
  await expect(page.getByLabel('Отправлять после паузы')).toBeChecked();
  await expect(page.getByLabel('Пауза перед отправкой')).toHaveValue(String(seconds));
  await expect(page.getByText('Микрофон выключен', { exact: true })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('Finish during browser restart sends once; cancellation and text retire callbacks', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page); await startQuietVoice(page);
  await page.clock.install();
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Guten Tag!'));
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).stop());
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await expect.poll(() => fixture.requests.length).toBe(1);
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('');
  await page.clock.fastForward(400);
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active);
    rec.result('Nicht senden'); window.__canceledResult = rec.onresult; window.__canceledEnd = rec.onend;
  });
  await page.getByRole('button', { name: 'Отменить реплику', exact: true }).click();
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('');
  await page.evaluate(() => { window.__canceledResult({ results: [] }); window.__canceledEnd(); });
  await page.clock.fastForward(6000);
  expect(fixture.requests).toHaveLength(1);
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('Mein Entwurf'));
  await page.getByLabel('Ваша реплика на немецком').focus();
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('Mein Entwurf');
  await page.getByRole('button', { name: 'Выключить голос', exact: true }).click();
  expect(fixture.errors).toEqual([]);
});

test('interim carried across sessions requires review, and hidden page cancels recognition', async ({ page, context }) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page); await startQuietVoice(page); await page.clock.install();
  await page.evaluate(() => {
    const rec = window.__voice.recognizers.find(r => r.active); rec.result('Vielleicht', false); rec.stop();
  });
  await page.clock.fastForward(400);
  await expect.poll(() => page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(true);
  await page.evaluate(() => window.__voice.recognizers.find(r => r.active).result('morgen.', true));
  await page.getByRole('button', { name: 'Завершить реплику', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Проверьте распознанный текст');
  await expect(page.getByLabel('Ваша реплика на немецком')).toHaveValue('Vielleicht morgen.');
  expect(fixture.requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Отменить реплику', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(50000);
  expect(await page.evaluate(() => window.__voice.recognizers.some(r => r.active))).toBe(false);
  expect(fixture.requests).toHaveLength(0);
  expect(fixture.errors).toEqual([]);
});

test('voice settings and manual instructions fit localized mobile and desktop layouts', async ({ page, context }, testInfo) => {
  const fixture = await setup(page, context, { voice: true });
  await enter(page); await startQuietVoice(page);
  for (const locale of ['ru', 'en', 'uk']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const automatic of [false, true]) {
      await page.locator('.game-voice-settings input').nth(1).setChecked(automatic);
      for (const width of [320, 375, 430, 768, 1280]) {
        await page.setViewportSize({ width, height: 1100 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const control of await page.locator('.game-voice button:visible, .game-voice select:visible').all()) {
          expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
        }
        if (locale === 'ru' && [320, 1280].includes(width)) {
          await page.locator('.game-voice').screenshot({ path: testInfo.outputPath(`voice-${automatic ? 'auto' : 'manual'}-${width}.png`) });
        }
      }
    }
  }
  expect(fixture.errors).toEqual([]);
});
