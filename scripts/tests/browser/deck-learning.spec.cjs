const { test, expect } = require('@playwright/test');

async function setup(page, context) {
  const backend = { learning: new Map(), writes: [], fail: false, pending: null };
  const profile = user_id => ({ user_id, first_name: 'Test', is_guest: false });
  const decks = userId => [{ id: 1, name: 'Общая колода', target_language: 'de',
    role: 'viewer', is_global_readonly: true, is_shared: true,
    is_learning: backend.learning.get(userId) ?? false,
    metadata: {}, stats: { total: 1, new: 1, due: 0, learning: 0 } }];
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    if (!localStorage.getItem('lerne_user_profile')) {
      localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
      localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test-1', refresh_token: 'test' }));
    }
  });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const userId = Number(request.headers()['x-user-id'] || 1);
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: decks(userId), folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: profile(userId),
    } });
    if (pathname === '/api/decks') return route.fulfill({ json: decks(userId) });
    if (pathname === '/api/folders' || pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/decks/1/toggle-learning') {
      const body = request.postDataJSON();
      backend.writes.push({ userId, ...body });
      if (backend.pending) await backend.pending;
      if (backend.fail) return route.fulfill({ status: 500, json: { detail: 'Test failure' } });
      backend.learning.set(userId, body.is_learning);
      return route.fulfill({ json: { status: 'success', is_learning: body.is_learning } });
    }
    if (pathname === '/api/auth/v2/email-password/login') {
      const id = request.postDataJSON().email === 'other@example.test' ? 2 : 1;
      return route.fulfill({ json: { access_token: `test-${id}`, refresh_token: 'test' } });
    }
    if (pathname === '/api/auth/v2/me') {
      const id = Number(request.headers().authorization.split('-').pop());
      return route.fulfill({ json: profile(id) });
    }
    if (pathname === '/api/auth/v2/identities') return route.fulfill({ json: { providers: ['email'] } });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: profile(userId) } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.locator('#deck-item-1')).toBeVisible();
  return backend;
}

const learningButton = page => page.locator('#deck-item-1 .deck-learning-action-btn');
const openMenu = page => page.locator('#deck-item-1 .card-item-actions-trigger').click();
const fetchDecks = page => page.evaluate(async () => {
  const { useDeckStore } = await import('/src/store/useDeckStore.js');
  await useDeckStore.getState().fetchDecks(true);
});
const login = (page, email = 'same@example.test') => page.evaluate(async email => {
  const { useAuthStore } = await import('/src/store/useAuthStore.js');
  useAuthStore.getState().logout();
  return useAuthStore.getState().loginWithEmailPassword(email, 'test-password');
}, email);

test('learning button and menu persist true/false across fetch, reload and login, independently per user', async ({ page, context }) => {
  const backend = await setup(page, context);
  await expect(learningButton(page)).toBeEnabled();
  await expect(learningButton(page)).toHaveText('🎯Учить');
  await learningButton(page).click();
  await expect(page.locator('.toast.success')).toHaveText('Колода добавлена в изучение');
  expect(backend.writes).toEqual([{ userId: 1, is_learning: true }]);
  await expect(learningButton(page)).toHaveText('🔥Учу');
  await fetchDecks(page);
  await expect(learningButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_init_cache')).decks[0].is_learning)).toBe(true);
  await page.reload();
  await expect(learningButton(page)).toHaveText('🔥Учу');
  expect(await login(page)).toEqual({ success: true });
  await expect(learningButton(page)).toHaveText('🔥Учу');
  expect(await login(page, 'other@example.test')).toEqual({ success: true });
  await expect(learningButton(page)).toHaveText('🎯Учить');
  await openMenu(page);
  await page.getByRole('button', { name: '🔥 Включить в изучение', exact: true }).click();
  await expect(page.locator('.toast.success')).toHaveText('Колода добавлена в изучение');
  expect(backend.learning.get(1)).toBe(true);
  expect(backend.learning.get(2)).toBe(true);
  expect(await login(page)).toEqual({ success: true });
  await openMenu(page);
  await page.getByRole('button', { name: '⏸ Отключить изучение', exact: true }).click();
  await expect(page.locator('.toast.success')).toHaveText('Колода исключена из изучения');
  expect(backend.writes.at(-1)).toEqual({ userId: 1, is_learning: false });
  expect(backend.learning.get(2)).toBe(true);
  await fetchDecks(page);
  await page.reload();
  await expect(learningButton(page)).toHaveText('🎯Учить');
  expect(await login(page)).toEqual({ success: true });
  await expect(learningButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('pending clicks do not duplicate requests and errors roll back state and cache', async ({ page, context }) => {
  const backend = await setup(page, context);
  let release;
  backend.pending = new Promise(resolve => { release = resolve; });
  backend.fail = true;
  await learningButton(page).click();
  await expect(learningButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect(learningButton(page)).toHaveText('🔥Учу');
  await learningButton(page).click();
  await openMenu(page);
  await page.getByRole('button', { name: '⏸ Отключить изучение', exact: true }).click();
  expect(backend.writes).toHaveLength(1);
  release();
  await expect(page.locator('.toast.error')).toHaveText('Ошибка при изменении состояния изучения колоды');
  await expect(learningButton(page)).toHaveText('🎯Учить');
  await expect(learningButton(page)).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_init_cache')).decks[0].is_learning)).toBe(false);
  backend.fail = false;
  backend.pending = null;
  await learningButton(page).click();
  await expect(page.locator('.toast.success')).toHaveText('Колода добавлена в изучение');
});

test('learning states and menu render at mobile and desktop widths in Russian and English', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page, context);
  for (const locale of ['ru', 'en']) {
    await page.evaluate(async locale => (await import('/src/i18n/locale.js')).setInterfaceLanguage(locale), locale);
    for (const active of [false, true]) {
      for (const width of [320, 375, 430, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(learningButton(page)).toHaveAttribute('aria-pressed', String(active));
        expect(await learningButton(page).evaluate(el => getComputedStyle(el).cursor)).toBe('pointer');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await openMenu(page);
        await expect(page.getByRole('button', { name: active
          ? (locale === 'ru' ? '⏸ Отключить изучение' : '⏸ Stop learning')
          : (locale === 'ru' ? '🔥 Включить в изучение' : '🔥 Add to learning'), exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`${locale}-${active}-${width}.png`), fullPage: true });
        await openMenu(page);
      }
      await learningButton(page).click();
      await expect(learningButton(page)).toHaveAttribute('aria-busy', 'false');
    }
  }
  expect(errors).toEqual([]);
});
