const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const A = -1000000000001, B = -1000000000002;
const profile = id => ({ user_id: id, first_name: id === A ? 'Learner A' : 'Learner B', is_guest: false });
const production = () => test.info().project.name === 'production';

// All APIs/provider scripts are intercepted. No real accounts, DB, AI or tokens.
async function setup(context, { guest = false, miniApp = false, delayedMe = false, search = '' } = {}) {
  const state = { attempts: new Map(), calls: [], refreshes: 0, loginCalls: 0, miniCalls: 0,
    refreshFailure: 0, turnFailure: 0, refreshDelay: 0, errors: [] };
  const access = new Map([['fixture-a', A], ['fixture-b', B]]);
  const refresh = new Map([['fixture-refresh-a', A], ['fixture-refresh-b', B]]);
  let releaseMe;
  const meGate = delayedMe ? new Promise(resolve => { releaseMe = resolve; }) : Promise.resolve();
  state.releaseMe = () => releaseMe?.();
  state.expire = () => access.clear();
  await context.addInitScript(({ guest, miniApp, A }) => {
    if (!localStorage.getItem('fixture_seeded')) {
      for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
        lerne_has_selected_language: 'true', lerne_target_language: 'de', lerne_welcome_seen: 'true',
        lerne_tut_seen_welcome: 'true', fixture_seeded: 'true' })) localStorage.setItem(key, value);
      if (guest) localStorage.setItem('lerne_force_guest', 'true');
      else {
        localStorage.setItem('lerne_user_id', String(miniApp ? 101 : A));
        localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: miniApp ? 101 : A, first_name: 'Learner A', is_guest: false }));
        if (!miniApp) localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'fixture-a', refresh_token: 'fixture-refresh-a' }));
      }
    }
    if (miniApp) window.Telegram = { WebApp: { initData: 'synthetic-signed-provider-boundary',
      initDataUnsafe: { user: { id: 101 } }, ready() {}, expand() {}, disableClosingConfirmation() {},
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} } } };
  }, { guest, miniApp, A });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (production() && url.origin === 'https://tma-amber.vercel.app') {
      const relative = url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : 'index.html';
      const contentType = relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html';
      return route.fulfill({ contentType, body: readFileSync(path.join(__dirname, '../../../app/dist', relative)) });
    }
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const pathname = url.pathname;
    const token = request.headers().authorization?.replace(/^Bearer /, '');
    const owner = access.get(token);
    state.calls.push({ pathname, owner, method: request.method(), origin: url.origin });
    const fail = (status, detail) => route.fulfill({ status, json: { detail } });
    if (pathname === '/api/auth/v2/refresh') {
      state.refreshes++;
      if (state.refreshDelay) await new Promise(resolve => setTimeout(resolve, state.refreshDelay));
      if (state.refreshFailure) return fail(state.refreshFailure, 'fixture_refresh_failure');
      const id = refresh.get(request.postDataJSON().refresh_token);
      if (!id) return fail(401, 'invalid_session');
      refresh.delete(request.postDataJSON().refresh_token);
      const tokens = { access_token: `fixture-access-${state.refreshes}`, refresh_token: `fixture-refresh-${state.refreshes}` };
      access.set(tokens.access_token, id); refresh.set(tokens.refresh_token, id);
      return route.fulfill({ json: tokens });
    }
    if (pathname === '/api/auth/v2/email-password/login' || pathname === '/api/auth/v2/telegram/mini-app') {
      const mini = pathname.endsWith('/mini-app');
      if (mini) { state.miniCalls++; await meGate; } else state.loginCalls++;
      const id = !mini && request.postDataJSON().email.startsWith('b@') ? B : A;
      const suffix = id === A ? 'a' : 'b';
      access.set(`fixture-${suffix}`, id); refresh.set(`fixture-refresh-${suffix}`, id);
      return route.fulfill({ json: { access_token: `fixture-${suffix}`, refresh_token: `fixture-refresh-${suffix}` } });
    }
    // Classic compatibility may still accept a legacy profile; Game/v2 never do.
    if (!owner && (pathname.startsWith('/api/game/') || pathname.startsWith('/api/auth/v2/'))) return fail(401, 'invalid_session');
    const id = owner || Number(request.headers()['x-user-id']);
    if (!id) return fail(401, 'authentication_required');
    if (pathname === '/api/auth/v2/me') { await meGate; return route.fulfill({ json: profile(id) }); }
    if (pathname === '/api/auth/v2/identities') return route.fulfill({ json: { providers: ['email_password', 'telegram'] } });
    if (pathname === '/api/auth/v2/password-settings') return route.fulfill({ json: { email: 'fixture@example.test' } });
    const decks = [{ id: id === A ? 1 : 2, name: `Classic ${id === A ? 'A' : 'B'}`, target_language: 'de', stats: { total: 2, new: 2 } }];
    if (pathname === '/api/init') return route.fulfill({ json: { decks, folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: profile(id) } });
    if (pathname === '/api/decks') return route.fulfill({ json: decks });
    if (pathname === '/api/folders') return route.fulfill({ json: [] });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: profile(id) } });
    if (pathname === '/api/game/scene') return route.fulfill({ json: {
      npc: { id: 'frau_mueller', name: 'Frau Müller', tts_voice: 'de-DE-KatjaNeural' },
      scene: { id: 'stadtbibliothek' }, ai_mode: 'live',
    } });
    if (pathname === '/api/game/attempts') {
      const attemptId = request.postDataJSON().attempt_id;
      if (state.attempts.has(attemptId) && state.attempts.get(attemptId).owner !== id) return fail(404, 'not_found');
      if (!state.attempts.has(attemptId)) state.attempts.set(attemptId, { owner: id, id: attemptId,
        version: 0, turn_count: 0, max_turns: 40, scene: {}, history: [{ role: 'npc', text: 'Guten Tag!' }] });
      return route.fulfill({ json: state.attempts.get(attemptId) });
    }
    if (pathname.startsWith('/api/game/attempts/')) {
      const attempt = state.attempts.get(pathname.split('/')[4]);
      if (!attempt || attempt.owner !== id) return fail(404, 'not_found');
      if (pathname.endsWith('/turns')) {
        if (state.turnFailure) return fail(state.turnFailure, 'fixture_turn_failure');
        const body = request.postDataJSON();
        attempt.history.push({ role: 'user', text: body.message }, { role: 'npc', text: 'Ich helfe Ihnen gern.' });
        attempt.version++; attempt.turn_count++;
      }
      return route.fulfill({ json: attempt });
    }
    return route.fulfill({ json: {} });
  });
  const page = await context.newPage();
  page.on('pageerror', error => state.errors.push(error.message));
  await page.goto('/' + search);
  await expect(page.locator('.view-decks')).toBeVisible();
  return { page, state };
}

async function enter(page) {
  await page.locator('.game-entry').click();
  await expect(page.getByRole('log')).toContainText('Guten Tag!');
  await expect(page.locator('#game-message')).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function send(page, text) {
  await page.locator('#game-message').fill(text);
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
}
async function login(page, email = 'a@example.test') {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await dialog.getByLabel('Пароль', { exact: true }).fill('synthetic-password');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('one login survives stale URL, Classic switching, reload and a new tab', async ({ context }, testInfo) => {
  const { page, state } = await setup(context, { guest: true, search: '?user_id=101' });
  await page.locator('.game-entry').click();
  await login(page);
  await enter(page);
  await send(page, 'Mein eigener Dialog A');
  await expect(page.locator('.game-message-user')).toContainText('Mein eigener Dialog A');
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(page.getByText('Classic A', { exact: true })).toBeVisible();
  await enter(page);
  await expect(page.locator('.game-message-user')).toContainText('Mein eigener Dialog A');
  await page.reload();
  await enter(page);
  await expect(page.locator('.game-message-user')).toContainText('Mein eigener Dialog A');
  const other = await context.newPage(); await other.goto('/?user_id=101'); await enter(other);
  expect(state.loginCalls).toBe(1);
  expect(state.calls.filter(c => c.pathname.startsWith('/api/game/')).every(c => c.owner === A)).toBe(true);
  if (production()) expect(state.calls.every(c => c.origin === 'https://tma-amber.vercel.app')).toBe(true);
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath(`authenticated-${width}.png`), fullPage: true });
  }
  expect(state.errors).toEqual([]);
});

test('Game waits for delayed v2 restoration', async ({ context }) => {
  const { page, state } = await setup(context, { delayedMe: true });
  await page.locator('.game-entry').click();
  await expect(page.getByRole('heading', { name: 'Frau Müller · Kennenlernen' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.calls.filter(c => c.pathname.startsWith('/api/game/'))).toHaveLength(0);
  state.releaseMe();
  await expect(page.locator('#game-message')).toBeEnabled();
});

test('Game waits for silent Telegram login and uses canonical linked account', async ({ context }) => {
  const { page, state } = await setup(context, { miniApp: true, delayedMe: true });
  await page.locator('.game-entry').click();
  await expect(page.getByRole('heading', { name: 'Frau Müller · Kennenlernen' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.attempts.size).toBe(0);
  state.releaseMe();
  await expect(page.locator('#game-message')).toBeEnabled();
  expect(state.miniCalls).toBe(1);
  await send(page, 'Hallo Frau Müller');
  await expect(page.locator('.game-message-user')).toContainText('Hallo Frau Müller');
  expect(state.calls.filter(c => c.pathname.startsWith('/api/game/')).every(c => c.owner === A)).toBe(true);
});

test('expired access refreshes across two tabs once; transient refresh failure retains history', async ({ context }) => {
  const { page, state } = await setup(context);
  await enter(page);
  await send(page, 'Vorherige Geschichte');
  await expect(page.locator('#game-message')).toHaveValue('');
  const other = await context.newPage(); await other.goto('/'); await enter(other);
  state.expire(); state.refreshDelay = 300;
  await Promise.all([send(page, 'Erste Tab'), send(other, 'Zweite Tab')]);
  await expect(page.locator('#game-message')).toHaveValue('');
  await expect(other.locator('#game-message')).toHaveValue('');
  expect(state.refreshes).toBe(1);
  state.expire(); state.refreshFailure = 503;
  await send(page, 'Gespeicherter Entwurf');
  await expect(page.locator('.game-error')).toBeVisible();
  await expect(page.locator('.game-message-user').first()).toContainText('Vorherige Geschichte');
  await expect(page.locator('#game-message')).toHaveValue('Gespeicherter Entwurf');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => Boolean(localStorage.getItem('lerne_auth_v2_session')))).toBe(true);
  state.refreshFailure = 0;
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('#game-message')).toHaveValue('');
});

test('invalid refresh uses existing login; 403 preserves the conversation without login', async ({ context }) => {
  const { page, state } = await setup(context); await enter(page);
  await send(page, 'История A'); await expect(page.locator('#game-message')).toHaveValue('');
  state.turnFailure = 403;
  await send(page, 'Entwurf');
  await expect(page.locator('.game-error')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.refreshes).toBe(0);
  state.turnFailure = 0; state.expire(); state.refreshFailure = 401;
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.game-message-user')).toContainText('История A');
  await expect(page.locator('#game-message')).toHaveValue('Entwurf');
  state.refreshFailure = 0;
  await login(page);
  await expect(page.locator('#game-message')).toBeEnabled();
  await expect(page.locator('.game-message-user')).toContainText('История A');
  await expect(page.locator('#game-message')).toHaveValue('Entwurf');
});

test('guest cannot create game data', async ({ context }) => {
  const { page, state } = await setup(context, { guest: true });
  await page.locator('.game-entry').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(state.attempts.size).toBe(0);
  expect(state.calls.filter(c => c.pathname.startsWith('/api/game/'))).toHaveLength(0);
});

test('logout and account switch retire old Game data, including another open tab', async ({ context }) => {
  const { page, state } = await setup(context); await enter(page);
  await send(page, 'Private history A'); await expect(page.locator('#game-message')).toHaveValue('');
  const other = await context.newPage(); await other.goto('/'); await enter(other);
  if (production()) {
    // Exercise the storage event boundary in the built app (no source imports).
    await other.evaluate(() => {
      localStorage.setItem('lerne_force_guest', 'true');
      for (const key of ['lerne_auth_v2_session', 'lerne_user_profile', 'lerne_user_id']) localStorage.removeItem(key);
    });
  } else await page.evaluate(async () => (await import('/src/store/useAuthStore.js')).useAuthStore.getState().logout());
  await expect(page.locator('.game-message')).toHaveCount(0);
  if (!production()) await expect(other.locator('.game-message')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await login(page, 'b@example.test');
  await expect(page.locator('#game-message')).toBeEnabled();
  await expect(page.getByRole('log')).not.toContainText('Private history A');
  await expect(other.getByRole('log')).not.toContainText('Private history A');
  expect([...state.attempts.values()].some(a => a.owner === A)).toBe(true);
  expect([...state.attempts.values()].some(a => a.owner === B)).toBe(true);
});

test('late refresh after logout cannot revive an old account or replay its turn as another user', async ({ context }) => {
  const { page, state } = await setup(context); await enter(page);
  const other = await context.newPage(); await other.goto('/');
  state.expire(); state.refreshDelay = 1500;
  const refreshResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/v2/refresh');
  await send(page, 'Stale private turn A');
  await expect.poll(() => state.refreshes).toBe(1);
  await other.evaluate(() => {
    localStorage.setItem('lerne_force_guest', 'true');
    for (const key of ['lerne_auth_v2_session', 'lerne_user_profile', 'lerne_user_id']) localStorage.removeItem(key);
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await login(page, 'b@example.test');
  await expect(page.locator('#game-message')).toBeEnabled();
  // Wait for the old response, then make a new authenticated request.
  await (await refreshResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('lerne_user_profile'))?.user_id)).toBe(B);
  await send(page, 'Private turn B');
  await expect(page.locator('.game-message-user')).toContainText('Private turn B');
  await expect(page.getByRole('log')).not.toContainText('Stale private turn A');
  expect(state.calls.filter(c => c.pathname.endsWith('/turns') && c.owner === B)).toHaveLength(1);
});
