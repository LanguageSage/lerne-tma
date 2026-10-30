const { test, expect } = require('./isolated-fixture.cjs');
const deck = { id: 1, name: 'Personal migration', target_language: 'de', is_learning: true, stats: { total: 1, new: 1 } };
const card = { id: 901, deck_id: 1, queue: 'new', front: 'Ich lerne jeden Tag Deutsch.',
  back: 'Каждый день я учу немецкий.', context: 'Ein Beispiel für den Alltag.' };
const legacy = { cardFont: 'monospace', cardFontSize: 1.25, cardFontWeight: '500', cardFontStyle: 'italic',
  cardTextColor: '#aaccdd', backTextColor: '#ddeeff', cardBgFront: 'dark_mocha', cardBgBack: 'dark_midnight',
  contextFont: 'serif', previewCardFont: 'monospace', previewCardFontStyle: 'italic', previewTextShadow: 'neon',
  userDesign: { cardFont: 'serif', cardBgFront: 'dark_emerald', cardFontSize: 1.6 } };

async function setup(page, context, { published, seed = true, initial = legacy } = {}) {
  await context.addInitScript(seed => {
    if (localStorage.getItem('migration-fixture-ready')) return;
    localStorage.setItem('migration-fixture-ready', 'true');
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: 'de',
      ...(seed ? { lerne_card_font: 'Georgia', lerne_card_bg_front: 'dark_obsidian',
        lerne_design_version: 'old-version', lerne_settings_version: 'old-settings',
        lerne_user_design: JSON.stringify({ cardFont: 'Georgia', marker: 'keep original' }) } : {}) })) localStorage.setItem(key, value);
  }, seed);
  const controller = { server: { 1: { autoplayVersion: 2, ...initial } }, backups: {}, posts: [], offline: false, errors: [] };
  page.on('pageerror', error => controller.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const owner = request.headers()['x-user-id'] || '1';
    if (path === '/api/user/settings') {
      if (controller.offline) return route.abort('internetdisconnected');
      if (request.method() === 'POST') {
        const payload = request.postDataJSON(), current = controller.server[owner] || {};
        controller.posts.push({ owner, payload });
        if (!current.designV2) controller.backups[owner] = JSON.stringify(current);
        const previous = current.designV2, incoming = payload.designV2;
        const same = previous && JSON.stringify(previous.config) === JSON.stringify(incoming.config)
          && JSON.stringify(previous.preset) === JSON.stringify(incoming.preset);
        if (!same && incoming.revision !== (previous?.revision || 0)) return route.fulfill({ status: 409, json: { detail: 'revision conflict' } });
        controller.server[owner] = { ...current, ...payload, designV2: { ...incoming,
          revision: same ? previous.revision : (previous?.revision || 0) + 1 } };
        return route.fulfill({ json: { status: 'success', settings: controller.server[owner], designMigrationVersion: 1 } });
      }
      return route.fulfill({ json: { ...controller.server[owner], _designMigrationVersion: 1 } });
    }
    if (path === '/api/user/settings/design-backup') return route.fulfill({ json: { raw: controller.backups[owner] } });
    if (path === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {},
      user_settings: controller.server[owner] || {}, is_admin: true, user_info: { user_id: Number(owner), is_guest: false },
      ...(published ? { global_design_v2: { config: published, revision: 7 } } : {}) } });
    if (path === '/api/messages' || path === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (path === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (path === '/api/study/card/901' || path === '/api/decks/1/next') return route.fulfill({ json: card });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  return controller;
}
async function enterStudy(page) {
  await page.evaluate(async ({ deck, card }) => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck, cards: [card], deckCards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card });
}
const record = page => page.evaluate(() => JSON.parse(localStorage.getItem('lerne:personal-design:v2:1')));

for (const width of [375, 1280]) test(`V1 migrates once and renders through V2 in study, editor and list (${width}px)`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width, height: 1050 });
  const control = await setup(page, context);
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  const migrated = await record(page);
  expect(migrated.backups.local.lerne_card_font).toBe('Georgia');
  expect(migrated.document.config.front.mainText.font).toBe('monospace');
  expect(migrated.document.preset.front.mainText.font).toBe('serif');
  expect(JSON.parse(control.backups[1]).cardFont).toBe('monospace');
  await enterStudy(page);
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-family', 'monospace');
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-style', 'italic');
  await expect(page.locator('.study-card-surface .bg-dark-mocha')).toHaveCount(1);
  await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.setState({ isFlipped: true }));
  await expect(page.locator('.card-back .text-back')).toHaveCSS('font-family', 'monospace');
  await expect(page.locator('.card-back .text-back')).toHaveCSS('font-size', '20px');
  await page.screenshot({ path: testInfo.outputPath(`migrated-back-${width}.png`), fullPage: true });
  await page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('cards'));
  await expect(page.locator('.front-min').first()).toHaveCSS('font-family', 'monospace');
  await page.evaluate(async card => {
    (await import('/src/store/useSessionStore.js')).useSessionStore.getState().setEditingCard(card);
    (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('editor');
  }, card);
  await expect(page.locator('#card-editor-back')).toHaveCSS('font-family', 'monospace');
  await expect(page.locator('#card-editor-back')).toHaveValue(card.back);
  const backup = migrated.backups.local;
  await page.reload();
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  expect((await record(page)).backups.local).toEqual(backup);
  expect(await page.evaluate(() => localStorage.getItem('lerne_design_version'))).toBe('old-version');
  expect(control.errors).toEqual([]);
});

test('published design keeps precedence, empty backgrounds inherit migrated personal, preview and saved preset remain isolated', async ({ page, context }) => {
  const control = await setup(page, context, { published: { front: { mainText: { font: 'serif' } } } });
  await enterStudy(page);
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-family', 'serif');
  await expect(page.locator('.study-card-surface .bg-dark-mocha')).toHaveCount(1);
  await page.evaluate(async () => {
    const store = (await import('/src/store/useSettingsStore.js')).useSettingsStore;
    store.getState().setAdminDraftDesignV2({ front: { mainText: { font: 'Georgia' } } });
  });
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-family', 'Georgia');
  await expect(page.locator('.study-card-surface .bg-dark-mocha')).toHaveCount(1);
  await page.evaluate(async () => (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState().toggleLocalDesignPreview());
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-family', 'serif');
  await page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().openSettings('design'));
  await page.getByRole('button', { name: /Пресет/ }).click();
  await page.getByRole('button', { name: 'Мой дизайн', exact: true }).click();
  const draft = await page.evaluate(async () => (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState().adminDraftDesignV2);
  expect(draft.front.mainText.font).toBe('serif'); expect(draft.front.card.background).toBe('dark_emerald');
  expect(control.posts.every(item => item.payload.cardFont === undefined)).toBe(true);
});

test('offline local edit and saved preset survive reload in offline mode and flush on reconnect', async ({ page, context }) => {
  const control = await setup(page, context);
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  control.offline = true;
  await page.evaluate(async () => {
    localStorage.setItem('offline_mode', 'true');
    const state = (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState();
    const config = structuredClone(state.personalDesignV2.config); config.front.mainText.font = 'serif';
    state.setPersonalDesignV2(config, config); await state.saveCurrentSettingsToServer();
  });
  expect((await record(page)).pending).toBe(true);
  await page.reload();
  await expect.poll(async () => page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().hasInitialized)).toBe(true);
  await enterStudy(page);
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-family', 'serif');
  expect((await record(page)).document.preset.front.mainText.font).toBe('serif');
  control.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  expect(control.server[1].designV2.config.front.mainText.font).toBe('serif');
  expect(control.server[1].designV2.preset.front.mainText.font).toBe('serif');
  expect(control.errors).toEqual([]);
});

test('account switching isolates migrated personal design and local admin preview and restores them on return', async ({ page, context }) => {
  await setup(page, context);
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().setAdminDraftDesignV2({ front: { mainText: { font: 'Georgia' } } });
    const auth = await import('/src/utils/auth.js');
    auth.saveAuthSession({ access_token: 'synthetic-B', refresh_token: 'synthetic-refresh-B' });
    (await import('/src/store/useAuthStore.js')).useAuthStore.getState().setUserProfile({ user_id: 2, is_guest: false });
  });
  const second = await page.evaluate(async () => {
    const state = (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState();
    return { account: state.designAccountId, font: state.activeDesignConfig?.front.mainText.font,
      draft: state.adminDraftDesignV2, preview: state.isLocalDesignPreviewActive,
      backup: JSON.parse(localStorage.getItem('lerne:personal-design:v2:2')).backups.local };
  });
  expect(second).toEqual({ account: 2, font: 'Comfortaa', draft: null, preview: false, backup: {} });
  await page.evaluate(async () => (await import('/src/store/useAuthStore.js')).useAuthStore.getState().setUserProfile({ user_id: 1, is_guest: false }));
  const restored = await page.evaluate(async () => {
    const state = (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState();
    return { account: state.designAccountId, font: state.activeDesignConfig?.front.mainText.font,
      personal: state.personalDesignV2?.config.front.mainText.font };
  });
  expect(restored).toEqual({ account: 1, font: 'Georgia', personal: 'monospace' });
});

test('local and server recovery keep backups and save a fresh revision', async ({ page, context }) => {
  const control = await setup(page, context);
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  const original = await record(page), revision = original.document.revision;
  await page.evaluate(async () => {
    const state = (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState();
    await state.restorePersonalDesignFromBackup('local'); await state.saveCurrentSettingsToServer();
  });
  expect((await record(page)).document.config.front.mainText.font).toBe('Georgia');
  expect((await record(page)).document.revision).toBeGreaterThan(revision);
  await page.evaluate(async () => {
    const state = (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState();
    await state.restorePersonalDesignFromBackup('server'); await state.saveCurrentSettingsToServer();
  });
  expect((await record(page)).document.config.front.mainText.font).toBe('monospace');
  expect((await record(page)).backups.local).toEqual(original.backups.local);
  expect(JSON.parse(control.backups[1]).cardFont).toBe('monospace');
});

test('migrated Match keeps distinct right-column typography and V2 selected feedback', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 1100 });
  await setup(page, context, { initial: { ...legacy, cardFont: 'serif', contextFont: 'monospace',
    contextTextColor: '#abcdef', contextFontSize: 1.4 } });
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  await enterStudy(page);
  await page.evaluate(async () => {
    const settings = (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState();
    const config = structuredClone(settings.personalDesignV2.config); config.exercises.match.selected.color = '#fedcba';
    settings.setPersonalDesignV2(config);
    (await import('/src/store/useSessionStore.js')).useSessionStore.setState({
      card: { id: 902, deck_id: 1, front: '@match\nKatze => кошка\nHund => собака', back: 'Paare' }, historyIndex: 1 });
  });
  await expect(page.locator('.match-item-left').first()).toHaveCSS('font-family', 'serif');
  const right = page.locator('.match-item-right').first();
  await expect(right).toHaveCSS('font-family', 'monospace');
  await expect(right).toHaveCSS('font-size', '22.4px');
  await expect(right).toHaveCSS('color', 'rgb(171, 205, 239)');
  await page.screenshot({ path: testInfo.outputPath('migrated-match-right.png'), fullPage: true });
  await right.click();
  await expect(right).toHaveCSS('color', 'rgb(254, 220, 186)');
});

test('explicit common V2 survives offline reload and account switching despite different personal backgrounds', async ({ page, context }) => {
  const control = await setup(page, context, { published: {
    schemaVersion: 2, front: { card: { background: 'dark_emerald' }, mainText: { font: 'serif' } },
    back: { card: { background: 'dark_emerald' } },
  } });
  await expect.poll(async () => (await record(page))?.pending).toBe(false);
  await enterStudy(page);
  await expect(page.locator('.card-front .bg-dark-emerald')).toHaveCount(1);
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-family', 'serif');
  await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.setState({ isFlipped: true }));
  await expect(page.locator('.card-back .bg-dark-emerald')).toHaveCount(1);
  control.offline = true;
  await page.evaluate(() => localStorage.setItem('offline_mode', 'true'));
  await page.reload();
  await expect.poll(async () => page.evaluate(async () => (await import('/src/store/useUiStore.js')).useUiStore.getState().hasInitialized)).toBe(true);
  await enterStudy(page);
  await expect(page.locator('.card-front .bg-dark-emerald')).toHaveCount(1);
  await page.evaluate(async () => {
    (await import('/src/utils/auth.js')).saveAuthSession({ access_token: 'synthetic-B', refresh_token: 'synthetic-B-refresh' });
    (await import('/src/store/useAuthStore.js')).useAuthStore.getState().setUserProfile({ user_id: 2, is_guest: false });
    const settings = (await import('/src/store/useSettingsStore.js')).useSettingsStore.getState();
    const config = structuredClone(settings.personalDesignV2.config);
    config.front.card.background = 'dark_mocha'; config.back.card.background = 'dark_midnight';
    settings.setPersonalDesignV2(config);
  });
  await expect(page.locator('.card-front .bg-dark-emerald')).toHaveCount(1);
  await expect(page.locator('.card-front .text-front')).toHaveCSS('font-family', 'serif');
  control.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => control.server[2]?.designV2?.revision).toBeGreaterThan(0);
  await expect(page.locator('.card-front .bg-dark-emerald')).toHaveCount(1);
  expect(control.errors).toEqual([]);
});
