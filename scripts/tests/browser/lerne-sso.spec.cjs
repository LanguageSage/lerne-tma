const { test, expect } = require('@playwright/test');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const fixture = path.join(root, 'scripts/tests/fixtures/lerne_sso_server.py');
const directory = path.join(root, 'scratch', 'sso-browser-' + randomUUID());
const mainOrigin = 'http://localhost:5199';
const gameOrigin = 'http://127.0.0.1:5199';
const servers = [];

test.beforeAll(async () => {
  // Spawn the interpreter itself, not the Windows App Execution Alias launcher.
  const python = execFileSync('python', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim();
  execFileSync(python, [fixture, '--directory', directory, '--prepare'], { cwd: root });
  for (const [role, port] of [['issuer', 8011], ['client', 8012]]) {
    const server = spawn(python, [fixture, '--directory', directory, '--role', role, '--port', String(port)],
      { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let failure = '';
    server.stderr.on('data', data => { failure += data.toString(); });
    servers.push(server);
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error(`SSO fixture exited (${server.exitCode}): ${failure}`);
      try { return (await fetch(`http://127.0.0.1:${port}/fixture/health`)).status; } catch { return 0; }
    }, { timeout: 20000 }).toBe(200);
  }
});
test.afterAll(() => { for (const server of servers) server.kill(); });

async function setup(context) {
  const errors = [];
  const requests = [];
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_welcome_seen', 'true');
    localStorage.setItem('lerne_force_guest', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  });
  await context.routeWebSocket('**/*', () => {});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    requests.push({ origin: url.origin, url: url.href, body: route.request().postData() || '',
      authorization: route.request().headers().authorization || '' });
    const port = url.hostname === 'localhost' ? 8011 : 8012;
    // Actual isolated Auth v2 HTTP servers; only dev-server proxy is replaced.
    const response = await route.fetch({ url: `http://127.0.0.1:${port}${url.pathname}${url.search}` });
    return route.fulfill({ response });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(gameOrigin);
  return { page, errors, requests };
}

async function start(page) {
  await page.locator('.user-signin-button').click();
  await page.getByRole('button', { name: 'Войти через Lerne', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(mainOrigin + '/auth/lerne\\?'));
}
async function signInMain(page) {
  await page.getByRole('button', { name: 'Войти в аккаунт Lerne', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill('existing@example.test');
  await dialog.getByLabel('Пароль', { exact: true }).fill('existing-main-password');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Подтвердить вход в Game Test', exact: true })).toBeEnabled();
}
async function confirm(page) {
  await page.getByRole('button', { name: 'Подтвердить вход в Game Test', exact: true }).click();
  await expect(page).toHaveURL(gameOrigin + '/');
  await expect(page.locator('.guest-banner')).toHaveCount(0);
  await expect(page.getByText('Local SSO test progress', { exact: true })).toBeVisible();
}

test('two origins: existing main login, explicit consent, callback, reload and same local account', async ({ context }, testInfo) => {
  const { page, errors, requests } = await setup(context);
  await page.setViewportSize({ width: 375, height: 900 });
  await start(page);
  await page.reload();
  await signInMain(page);
  await page.screenshot({ path: testInfo.outputPath('consent-375.png'), fullPage: true });
  const mainAccount = await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_user_profile')).user_id);
  const mainTokens = await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_auth_v2_session')));
  const before = await (await fetch('http://127.0.0.1:8011/fixture/stats')).json();
  await confirm(page);
  const localAccount = await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_user_profile')).user_id);
  expect(localAccount).not.toBe(mainAccount);
  await page.reload();
  await expect(page.locator('.user-name')).toHaveText('Профиль');
  await expect(page.locator('.guest-banner')).toHaveCount(0);
  // Reset only this tab's test session; the main-origin session remains intact.
  await page.evaluate(async () => (await import('/src/store/useAuthStore.js')).useAuthStore.getState().logout());
  await page.reload();
  await start(page);
  await expect(page.getByRole('button', { name: 'Подтвердить вход в Game Test', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти в аккаунт Lerne', exact: true })).toHaveCount(0);
  await confirm(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('lerne_user_profile')).user_id)).toBe(localAccount);
  expect(await (await fetch('http://127.0.0.1:8011/fixture/stats')).json()).toEqual(before);
  expect((await (await fetch('http://127.0.0.1:8012/fixture/stats')).json()).passwords).toBe(0);
  expect(requests.filter(request => request.origin === gameOrigin).every(request =>
    !JSON.stringify(request).includes(mainTokens.access_token)
      && !JSON.stringify(request).includes(mainTokens.refresh_token)
      && !request.body.includes('existing-main-password'))).toBe(true);
  expect(requests.every(request => !request.url.includes('assertion='))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('signed-in-375.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('cancel and invalid request have finite errors; consent fits desktop and mobile', async ({ context }, testInfo) => {
  const { page, errors } = await setup(context);
  await start(page);
  for (const locale of ['ru', 'en']) {
    await page.evaluate(async locale => (await import('/src/i18n/locale.js')).setInterfaceLanguage(locale), locale);
    for (const width of [320, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: locale === 'ru' ? 'Отмена' : 'Cancel', exact: true })).toBeVisible();
      if (locale === 'en' && width === 320) await page.screenshot({ path: testInfo.outputPath('consent-en-320.png'), fullPage: true });
    }
  }
  await page.evaluate(async () => (await import('/src/i18n/locale.js')).setInterfaceLanguage('ru'));
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page).toHaveURL(gameOrigin + '/');
  await expect(page.getByText('Вход через Lerne отменён. Вы можете попробовать ещё раз.', { exact: true })).toBeVisible();
  await page.goto(mainOrigin + '/auth/lerne?request_id=bad&nonce=bad');
  await expect(page.getByRole('alert')).toContainText('Некорректный запрос');
  await page.screenshot({ path: testInfo.outputPath('invalid-request-1280.png'), fullPage: true });
  expect(errors).toEqual([]);
});
