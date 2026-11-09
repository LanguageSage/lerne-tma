const { test, expect } = require('./isolated-fixture.cjs');
const fs = require('node:fs');
const fixture = process.env.LERNE_MIGRATED_FIXTURE
  ? JSON.parse(fs.readFileSync(process.env.LERNE_MIGRATED_FIXTURE, 'utf8')) : null;
test.skip(!fixture, 'Explicit migrated disposable database required');
if (fixture && [fixture.tma_origin, fixture.admin_origin].some(url => !/^http:\/\/127\.0\.0\.1:\d+$/.test(url))) {
  throw new Error('Loopback applications only');
}

test('actual migrated cards render in TMA and actual Admin opens on the same copy', async ({ browser }, info) => {
  test.setTimeout(180000);
  expect(fixture.cards.length).toBeGreaterThan(0);
  for (const card of fixture.cards) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5199'
        ? route.continue() : route.abort('blockedbyclient'));
      await context.routeWebSocket('**/*', () => {});
      await context.addInitScript(card => {
        localStorage.setItem('native_language', 'ru');
        localStorage.setItem('native_language_selected', 'true');
        localStorage.setItem('lerne_has_selected_language', 'true');
        localStorage.setItem('lerne_target_language', 'de');
        localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: card.user_id, is_guest: false }));
        localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: card.user_id, access_token: card.token }));
      }, card);
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        return route.fulfill({ response: await route.fetch({ url: fixture.tma_origin + url.pathname + url.search }) });
      });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:5199/');
      await expect.poll(() => page.evaluate(async () =>
        (await import('/src/store/useAuthStore.js')).useAuthStore.getState().isRestoring)).toBe(false);
      await page.evaluate(async card => {
        (await import('/src/services/knowledgeSyncOrchestrator.js')).stopKnowledgeSync();
        (await import('/src/store/useSettingsStore.js')).useSettingsStore.setState({ autoPlay: false, autoGenerateCardAudio: false });
        const { networkApi } = await import('/src/services/networkApi.js');
        const study = (await networkApi.get(`/study/card/${card.id}`)).data;
        (await import('/src/store/useDeckStore.js')).useDeckStore.setState({ currentDeck: {
          id: card.deck_id, name: study.deck_name, user_id: card.user_id, role: 'owner', target_language: 'de' }, deckCards: [] });
        const { useSessionStore } = await import('/src/store/useSessionStore.js');
        useSessionStore.getState().resetSession();
        useSessionStore.getState().addToHistory(study);
        (await import('/src/store/useUiStore.js')).useUiStore.getState().setView('study');
      }, card);
      if (card.content_v2.card.layout) {
        await expect(page.locator('.structured-card-layout').first()).toBeVisible();
      } else {
        await expect(page.locator('#tut-study-front, .trainer-exercise, .quiz-container, .match-container, .puzzle-exercise, .word-bank-exercise, .free-text-exercise, .editable-text-exercise').first()).toBeVisible();
      }
      if (card.type === 'trainer') {
        await expect(page.locator('.trainer-exercise')).toBeVisible();
        if (card.content_v2.card.data.parts.some(p => p.type === 'choice' && p.distractors === 'auto')) {
          await page.getByRole('button', { name: /Пропуск/ }).first().click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          expect(await dialog.getByRole('button').count()).toBeGreaterThan(1);
        }
      }
      await page.screenshot({ path: info.outputPath(`migrated-${card.type}.png`), fullPage: true });
    } finally {
      // Closing a context cancels the real background pull. Discard only route
      // callbacks cancelled during teardown, as in native-recovery.spec.cjs.
      await context.unrouteAll({ behavior: 'ignoreErrors' });
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === fixture.admin_origin
      ? route.continue() : route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.goto(fixture.admin_origin);
    await expect(page.locator('body')).toContainText(/Lerne/i);
    const first = fixture.cards[0];
    const actual = await page.evaluate(async first => {
      const response = await fetch(`/api/admin/cards/${first.id}?deck_id=${first.deck_id}`);
      if (!response.ok) throw new Error('Admin read: ' + response.status);
      return response.json();
    }, first);
    expect(actual.content_v2).toEqual(first.content_v2);
    await page.screenshot({ path: info.outputPath('migrated-admin.png'), fullPage: true });
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }
});
