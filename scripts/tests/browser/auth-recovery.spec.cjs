const { test, expect } = require('./isolated-fixture.cjs');
const { devices } = require('@playwright/test');

const profile = { user_id: 101, first_name: 'Saved learner', is_guest: false, active_language: 'de', has_selected_language: true };
const deck = { id: 21, name: 'Recovery synthetic deck', target_language: 'de', stats: { total: 1, new: 1 } };
const card = { id: 31, deck_id: 21, front: 'Recovered study card', back: 'Synthetic answer', queue: 'new' };
const tokens = { access_token: 'valid', refresh_token: 'valid-refresh', account_id: 101, session_id: 'session-a' };

async function setup(page, context, mode = 'missing') {
  const state = { refreshes: 0, errors: [], mode, authorized: mode !== 'missing', requests: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await context.addInitScript(({ profile, deck, tokens, mode }) => {
    if (localStorage.getItem('recovery-seeded')) return;
    localStorage.setItem('recovery-seeded', 'true');
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_target_language: 'de', lerne_has_selected_language: 'true', lerne_welcome_seen: 'true',
      lerne_tut_seen_welcome: 'true', lerne_settings_version: '6' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify(profile));
    localStorage.setItem('lerne_user_id', String(profile.user_id));
    localStorage.setItem('lerne_init_cache_version', '3');
    localStorage.setItem('lerne_init_cache', JSON.stringify({ user_id: 101, decks: [deck], folders: [], user_info: profile }));
    if (mode !== 'missing') localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ ...tokens,
      access_token: ['expired', 'rejected'].includes(mode) ? 'expired' : 'valid' }));
  }, { profile, deck, tokens, mode });
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.requests.push({ path, authorization: request.headers().authorization, hint: request.headers()['x-user-id'] });
    const reply = (status, json) => route.fulfill({ status, json });
    if (path === '/api/auth/v2/challenges') return reply(503, { detail: 'provider_not_configured' });
    if (path === '/api/auth/v2/email-password/login') {
      state.authorized = true; state.mode = 'valid'; return reply(200, tokens);
    }
    if (path === '/api/auth/v2/refresh') {
      state.refreshes++;
      if (state.refreshGate) await state.refreshGate;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (state.mode === 'rejected') return reply(401, { detail: 'invalid_session' });
      return reply(200, { ...tokens, refresh_token: `valid-refresh-${state.refreshes}` });
    }
    if (state.mode === 'network') return route.abort('internetdisconnected');
    if (state.mode === 'timeout') return route.abort('timedout');
    if (state.mode === 'server') return reply(503, { detail: 'service_unavailable' });
    if (state.mode === 'forbidden') return reply(403, { detail: 'permission_denied' });
    if (!state.authorized || request.headers().authorization !== 'Bearer valid') return reply(401, { detail: 'authentication_required' });
    if (path === '/api/auth/v2/me') return reply(200, profile);
    if (path === '/api/auth/v2/identities') return reply(200, { providers: ['email_password'] });
    if (path === '/api/auth/v2/password-settings') return reply(200, { email: 'synthetic@example.test' });
    if (path === '/api/init') return reply(200, { decks: [deck], folders: [], user_info: profile, settings: {}, prompts: {}, user_settings: {} });
    if (path === '/api/decks') return reply(200, [deck]);
    if (path === '/api/folders' || path === '/api/messages') return reply(200, []);
    if (path === '/api/decks/21/cards') return reply(200, [card]);
    if (path === '/api/decks/21/next' || path === '/api/study/card/31') return reply(200, card);
    if (path === '/api/auth/sync') return reply(200, { status: 'ok', user: profile });
    return reply(200, {});
  });
  await page.goto('/');
  await expect(page.locator('.view-decks')).toBeVisible();
  return state;
}

for (const withoutWebLocks of [false, true]) {
test(`two tabs rotate one shared credential and synchronize terminal expiry (${withoutWebLocks ? 'Dexie lease' : 'Web Locks'})`, async ({ page, context }) => {
  if (withoutWebLocks) await context.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  const state = await setup(page, context, 'valid');
  await expect.poll(async () => (await snapshot(page)).status).toBe('authenticated');
  const second = await context.newPage();
  await second.goto('/');
  await expect.poll(async () => (await snapshot(second)).status).toBe('authenticated');
  await page.evaluate(async withoutWebLocks => {
    if (withoutWebLocks) {
      const db = (await import('/src/services/localDb.js')).getLocalDb();
      await db.syncState.put({ key: 'auth-v2-refresh-lease', owner: 'closed-tab', expiresAt: 0 });
    }
    const auth = await import('/src/utils/auth.js');
    auth.saveAuthSession({ ...auth.getAuthSession(), access_token: 'expired' });
  }, withoutWebLocks);
  await Promise.all([page, second].map(tab => tab.evaluate(async () => {
    const api = (await import('/src/services/api.js')).default;
    await Promise.all(['/init', '/decks', '/folders'].map(url => api.get(url)));
  })));
  expect(state.refreshes).toBe(1);
  if (withoutWebLocks) expect(await page.evaluate(async () =>
    (await import('/src/services/localDb.js')).getLocalDb().syncState.get('auth-v2-refresh-lease'))).toBeUndefined();
  expect(JSON.parse((await snapshot(page)).session)).toEqual(JSON.parse((await snapshot(second)).session));
  state.mode = 'rejected';
  await page.evaluate(async () => {
    const auth = await import('/src/utils/auth.js');
    auth.saveAuthSession({ ...auth.getAuthSession(), access_token: 'expired' });
    await (await import('/src/services/api.js')).default.get('/init').catch(() => {});
  });
  await expect.poll(async () => (await snapshot(second)).session).toBeNull();
  expect((await snapshot(page)).profile).toBeNull(); expect((await snapshot(second)).profile).toBeNull();
  expect(state.refreshes).toBe(2); expect(state.errors).toEqual([]);
  expect(context.pages()).toHaveLength(2);
});
}

test('switching accounts during a held refresh retires its tokens and response', async ({ page, context }) => {
  const state = await setup(page, context, 'valid');
  await expect.poll(async () => (await snapshot(page)).status).toBe('authenticated');
  let release;
  state.refreshGate = new Promise(resolve => { release = resolve; });
  await page.evaluate(async () => {
    (await import('/src/store/useSessionStore.js')).useSessionStore.setState({ card: { id: 31 },
      pendingGrades: { '101:31': { card: { id: 31 }, userId: 101 } } });
    const auth = await import('/src/utils/auth.js');
    auth.saveAuthSession({ ...auth.getAuthSession(), access_token: 'expired' });
    window.oldRequest = (await import('/src/services/api.js')).default.get('/init').then(() => 'success', error => error.code);
  });
  await expect.poll(() => state.refreshes).toBe(1);
  await page.evaluate(async () => {
    const auth = await import('/src/utils/auth.js');
    auth.saveAuthSession({ access_token: 'account-b', refresh_token: 'refresh-b', account_id: 202, session_id: 'session-b' });
    auth.saveUserProfile({ user_id: 202, first_name: 'New account' });
  });
  release();
  expect(await page.evaluate(() => window.oldRequest)).toBe('ERR_CANCELED');
  const value = await snapshot(page);
  expect(value.session).toContain('account-b'); expect(value.profile.user_id).toBe(202);
  expect(value.uiProfile.user_id).toBe(202); expect(state.errors).toEqual([]);
  const study = await page.evaluate(async () => {
    const state = (await import('/src/store/useSessionStore.js')).useSessionStore.getState();
    return { card: state.card, pending: state.pendingGrades['101:31'] };
  });
  expect(study.card).toBeNull(); expect(study.pending.userId).toBe(101);
});

test('terminal 401 preserves dirty cards, notes, reviews and outbox; offline data stays usable', async ({ page, context }) => {
  const state = await setup(page, context, 'valid');
  await expect.poll(async () => (await snapshot(page)).status).toBe('authenticated');
  const before = await page.evaluate(async ({ deck, card }) => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    await db.decks.put({ ...deck, user_id: 101, is_deleted: false, is_dirty: 1 });
    await db.cards.put({ ...card, front_text: card.front, back_text: card.back, is_deleted: false, is_dirty: 1 });
    await db.progress.put({ card_id: 31, user_id: 101, is_dirty: 1, review_count: 2 });
    await db.card_notes.put({ id: 41, card_id: 31, text: 'Unsent note', is_dirty: 1 });
    await db.knowledge_attempt_outbox.put({ client_event_id: 'synthetic-event', user_id: 101, sync_status: 'pending' });
    await db.syncState.put({ key: 'review:synthetic-grade', card_id: 31, grade: 2, user_id: 101 });
    const rows = await Promise.all(['decks', 'cards', 'progress', 'card_notes', 'knowledge_attempt_outbox'].map(name => db[name].toArray()));
    rows.push(await db.syncState.filter(item => item.key.startsWith('review:')).toArray());
    return rows;
  }, { deck, card });
  state.mode = 'rejected';
  await page.evaluate(async () => {
    const auth = await import('/src/utils/auth.js');
    auth.saveAuthSession({ ...auth.getAuthSession(), access_token: 'expired' });
    await (await import('/src/services/api.js')).default.get('/init').catch(() => {});
  });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await context.setOffline(true);
  const after = await page.evaluate(async () => {
    const db = (await import('/src/services/localDb.js')).getLocalDb();
    const rows = await Promise.all(['decks', 'cards', 'progress', 'card_notes', 'knowledge_attempt_outbox'].map(name => db[name].toArray()));
    rows.push(await db.syncState.filter(item => item.key.startsWith('review:')).toArray());
    const library = await (await import('/src/services/api.js')).default.get('/decks');
    return { rows, library: library.data };
  });
  expect(after.rows).toEqual(before); expect(after.library.map(item => item.id)).toContain(21);
  expect((await snapshot(page)).session).toBeNull(); expect(state.errors).toEqual([]);
});

async function snapshot(page) {
  return page.evaluate(async () => {
    const { useAuthStore } = await import('/src/store/useAuthStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    return { profile: useAuthStore.getState().userProfile, status: useAuthStore.getState().status,
      uiProfile: useUiStore.getState().userProfile, session: localStorage.getItem('lerne_auth_v2_session'),
      cache: localStorage.getItem('lerne_init_cache') };
  });
}

for (const mobile of [false, true]) {
  test.describe(mobile ? 'mobile Chromium' : 'web Chromium', () => {
    test.use(mobile ? { viewport: devices['Pixel 7'].viewport, userAgent: devices['Pixel 7'].userAgent,
      deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });

    test('missing credentials with a saved profile/cache opens one login form', async ({ page, context }, testInfo) => {
      const state = await setup(page, context);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      const value = await snapshot(page);
      expect(value.profile).toBeNull(); expect(value.uiProfile).toBeNull(); expect(value.cache).toBeTruthy();
      expect(state.refreshes).toBe(0); expect(context.pages()).toHaveLength(1);
      expect(state.requests.every(item => !item.hint && !item.authorization)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('auth-required.png'), fullPage: true });
      expect(state.errors).toEqual([]);
    });

    test('expired access and parallel 401s share refresh without opening login', async ({ page, context }) => {
      const state = await setup(page, context, 'expired');
      await expect.poll(async () => (await snapshot(page)).status).toBe('authenticated');
      await page.evaluate(async () => {
        const auth = await import('/src/utils/auth.js');
        auth.saveAuthSession({ ...auth.getAuthSession(), access_token: 'expired' });
        const api = (await import('/src/services/api.js')).default;
        await Promise.all(['/init', '/decks', '/folders'].map(url => api.get(url)));
      });
      expect(state.refreshes).toBe(2);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect((await snapshot(page)).session).toContain('valid');
      expect(state.errors).toEqual([]);
    });

    test('rejected refresh synchronizes both stores and preserves offline data', async ({ page, context }) => {
      const state = await setup(page, context, 'rejected');
      await expect(page.getByRole('dialog')).toHaveCount(1);
      const value = await snapshot(page);
      expect(value.session).toBeNull(); expect(value.profile).toBeNull(); expect(value.uiProfile).toBeNull();
      expect(value.cache).toBeTruthy(); expect(state.refreshes).toBe(1);
      expect(state.errors).toEqual([]);
    });

    for (const mode of ['network', 'timeout', 'server', 'forbidden']) {
      test(`${mode} preserves credentials and cached library`, async ({ page, context }) => {
        const state = await setup(page, context, mode);
        await expect.poll(async () => (await snapshot(page)).status).toBe('offline');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect((await snapshot(page)).session).toContain('valid-refresh');
        expect((await snapshot(page)).cache).toBeTruthy(); expect(state.refreshes).toBe(0);
        expect(state.errors).toEqual([]);
      });
    }

    test('chosen deck resumes study after login without a technical study error', async ({ page, context }, testInfo) => {
      const state = await setup(page, context);
      await page.getByRole('button', { name: 'Позже', exact: true }).click();
      // Mount the production hook; it shares the actual App navigation/stores.
      await page.evaluate(async deck => {
        const React = (await import('/node_modules/.vite/deps/react.js')).default;
        const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
        const { useStudyNavigation } = await import('/src/hooks/useStudyNavigation.js');
        const target = document.createElement('div'); document.body.append(target);
        createRoot(target).render(React.createElement(function Harness() {
          window.recoveryNavigation = useStudyNavigation(); return null;
        }));
        window.recoveryDeck = deck;
      }, deck);
      await expect.poll(() => page.evaluate(() => !!window.recoveryNavigation)).toBe(true);
      await page.evaluate(() => window.recoveryNavigation.startStudy(window.recoveryDeck));
      await expect(page.getByRole('dialog')).toHaveCount(1);
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill('synthetic@example.test');
      await dialog.getByLabel('Пароль', { exact: true }).fill('synthetic password');
      await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator('.view-study')).toBeVisible();
      await expect(page.getByText('Recovered study card', { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().apiError)).toBeNull();
      await page.screenshot({ path: testInfo.outputPath('study-resumed.png'), fullPage: true });
      expect(state.errors).toEqual([]);
    });

    test('opening a saved deck resumes after login and a provider-style reload', async ({ page, context }) => {
      const state = await setup(page, context);
      await page.getByRole('button', { name: 'Позже', exact: true }).click();
      await page.getByRole('heading', { name: 'Recovery synthetic deck', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.reload();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1);
      await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill('synthetic@example.test');
      await dialog.getByLabel('Пароль', { exact: true }).fill('synthetic password');
      await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().view)).toBe('deck_intro');
      await expect.poll(() => page.evaluate(async () => (await import('/src/store/useDeckStore.js')).useDeckStore.getState().deckCards.map(card => card.id))).toEqual([31]);
      expect(state.errors).toEqual([]);
    });
  });
}
