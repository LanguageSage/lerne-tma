const { test, expect } = require('@playwright/test');

const modes = [['build', 5198], ['local', 5173], ['preview', 5174]];
const deck = { id: 501, name: 'Deutsch üben · Синтетическая колода', role: 'owner', target_language: 'de',
  card_count: 1, stats: { total: 1, new: 1, learning: 0, due: 0 }, is_learning: true };
const profile = { user_id: 101, first_name: 'Parity learner', is_guest: false,
  has_selected_language: true, active_language: 'de', native_language: 'ru' };
let published, personal;
test.beforeAll(async () => {
  const { normalizeDesignConfig } = await import('../../../app/src/design/designConfig.js');
  const config = normalizeDesignConfig({ global: { uiFont: 'Inter', accentColor: '#246885', commonRadius: '18px',
    buttons: { primary: { height: 57, radius: 19, borderWidth: 3,
      normal: { mode: 'linear', color1: '#246885', color2: '#438b65', textColor: '#fafafa' },
      hover: { color1: '#765432', textColor: '#fefefe' } } } } });
  published = { schemaVersion: 2, revision: 7, config };
  personal = { schemaVersion: 2, revision: 2, preset: null,
    config: normalizeDesignConfig({ global: { accentColor: '#bc7234' }, front: { card: { background: 'dark_mocha' } } }) };
});

async function setup(browser, mode, port, width) {
  const origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1.25,
    reducedMotion: 'reduce', serviceWorkers: 'block' });
  const requests = [], errors = [], fontResponses = [];
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort('blockedbyclient'));
  await context.routeWebSocket('**/*', () => {});
  let publication = published, failInit = false, failedInitCount = 0;
  const settings = { designV2: personal, _designMigrationVersion: 1, autoplayVersion: 2, native_language: 'ru' };
  await context.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/sync/v2/status') return route.fulfill({ json: { server_generation: 'a'.repeat(64), restored: false } });
    if (pathname === '/api/init') {
      if (failInit) { failedInitCount++; return route.fulfill({ status: 503, json: {} }); }
      return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: settings,
        user_info: profile, is_admin: false, global_design_v2: publication } });
    }
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: profile });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: profile } });
    if (pathname === '/api/user/settings') return route.fulfill({ json: settings });
    if (pathname === '/api/decks') return route.fulfill({ json: [deck] });
    if (pathname === '/api/decks/501/cards') return route.fulfill({ json: [] });
    if (['/api/folders', '/api/messages'].includes(pathname)) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await context.addInitScript(({ mode, profile }) => {
    const prefix = mode === 'build' ? '' : 'lerne_local:';
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de' })) localStorage.setItem(key, value);
    localStorage.setItem(prefix + 'lerne_user_profile', JSON.stringify(profile));
    localStorage.setItem(prefix + 'lerne_auth_v2_session', JSON.stringify({ account_id: profile.user_id,
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }));
  }, { mode, profile });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('.woff2')) fontResponses.push(response.status());
  });
  await page.goto(origin);
  await expect(page.locator('#deck-item-501')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('--design-accent', '#246885');
  return { context, page, requests, errors, fontResponses,
    clearPublication: () => { publication = {}; }, failInit: () => { failInit = true; },
    failedInitCount: () => failedInitCount };
}

async function metrics(page, selector) {
  await page.evaluate(() => document.fonts.ready);
  return page.locator(selector).evaluateAll(elements => elements.map(e => {
    const css = getComputedStyle(e);
    return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'color',
      'backgroundColor', 'backgroundImage', 'borderColor', 'borderWidth', 'borderRadius',
      'padding', 'margin', 'gap', 'width', 'height', 'boxShadow'].map(k => [k, css[k]]));
  }));
}

for (const width of [320, 375, 430, 768, 1280]) test(`build, LOCAL and V2 Preview share design and geometry at ${width}px`, async ({ browser }, testInfo) => {
  const results = [];
  for (const [mode, port] of modes) {
    const device = await setup(browser, mode, port, width);
    const { page, context, requests, errors, fontResponses } = device;
    try {
      // Check actual downloaded faces, not just computed font-family (which can mask fallback).
      const loaded = await page.evaluate(async () => {
        const families = ['Inter', 'Outfit', 'Montserrat', 'Playfair Display', 'Roboto', 'Caveat',
          'Pacifico', 'Oswald', 'Lobster', 'Comfortaa'];
        return Promise.all(families.map(async family => {
          const faces = await document.fonts.load(`400 16px "${family}"`, 'Deutsch üben');
          return faces.length > 0 && faces.every(face => face.status === 'loaded');
        }));
      });
      expect(loaded).toEqual(Array(10).fill(true));
      expect(fontResponses.length).toBeGreaterThan(0);
      expect(fontResponses.every(status => status === 200)).toBe(true);
      const home = await metrics(page, 'h1, #deck-item-501, #deck-item-501 h3');
      await page.locator('#deck-item-501 h3').click();
      await expect(page.getByRole('button', { name: 'Начать занятие', exact: true })).toBeVisible();
      const selector = '.deck-intro-title, .deck-intro-hero, .deck-intro-btn-start, .deck-intro-btn-list';
      const intro = await metrics(page, selector);
      await expect(page.locator('.deck-intro-btn-start')).toHaveCSS('border-radius', '19px');
      await expect(page.locator('html')).toHaveCSS('--design-ui-btn-primary-height', '57px');
      // DeckIntro's existing compact layout keeps 44px targets below 440px.
      await expect(page.locator('.deck-intro-btn-start')).toHaveCSS('min-height', width <= 440 ? '44px' : '57px');
      await page.locator('.deck-intro-btn-start').hover();
      const hover = await metrics(page, '.deck-intro-btn-start');
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      results.push({ home, intro, hover });
      expect(requests.filter(url => /fonts\.googleapis|fonts\.gstatic/.test(url))).toEqual([]);
      if (mode !== 'build') expect(requests.filter(url => new URL(url).origin !== `http://127.0.0.1:${port}`)).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  }
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
});

test('confirmed empty publication replaces a cached theme; an unavailable API preserves it', async ({ browser }) => {
  const device = await setup(browser, 'local', 5173, 430);
  const { page, context } = device;
  try {
    device.failInit();
    await page.reload();
    await expect.poll(device.failedInitCount, { timeout: 15000 }).toBe(3);
    await expect(page.locator('.loading-overlay-global')).toHaveCount(0);
    await expect(page.locator('html')).toHaveCSS('--design-accent', '#246885');
  } finally { await context.close(); }
  const empty = await setup(browser, 'preview', 5174, 430);
  try {
    empty.clearPublication();
    await empty.page.reload();
    await expect(empty.page.locator('html')).toHaveCSS('--design-accent', '#bc7234');
    expect(await empty.page.evaluate(() => localStorage.getItem('lerne_local:lerne:published-design:v2'))).toBeNull();
    expect(await empty.page.evaluate(() => JSON.parse(localStorage.getItem('lerne_local:lerne:personal-design:v2:101')).document)).toMatchObject(personal);
  } finally { await empty.context.close(); }
});
