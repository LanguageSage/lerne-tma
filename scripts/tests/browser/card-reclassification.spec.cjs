const { test, expect } = require('./isolated-fixture.cjs');

// Real components and authenticated Axios client; every API is intercepted.
async function setup(page, context, surface, scenario) {
  const deck = { id: 1, name: 'Reclassification', role: 'owner', is_learning: true,
    target_language: scenario.language, stats: { total: 1, new: 1 } };
  const state = { requests: [], refreshes: 0, reads: 0, errors: [], outcome: scenario.outcome };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  state.release = release;
  page.on('pageerror', error => state.errors.push(error.message));
  await context.addInitScript(language => {
    for (const [key, value] of Object.entries({ native_language: 'ru', native_language_selected: 'true',
      lerne_has_selected_language: 'true', lerne_target_language: language, lerne_welcome_seen: 'true',
      lerne_tut_seen_welcome: 'true', lerne_user_id: '1' })) localStorage.setItem(key, value);
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({
      access_token: 'fixture-access', refresh_token: 'fixture-refresh' }));
  }, scenario.language || 'de');
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/cards/classify-batch') {
      state.requests.push({ method: request.method(), body: request.postDataJSON(),
        authorization: request.headers().authorization });
      await gate;
      if (state.outcome === 'network') return route.abort('connectionfailed');
      if (state.outcome === 'forbidden') return route.fulfill({ status: 403, json: { detail: 'forbidden' } });
      if (state.outcome === 'unauthorized' || state.outcome === 'refresh-rejected'
          || (state.outcome === 'refresh' && state.requests.length === 1)) {
        return route.fulfill({ status: 401, json: { detail: 'invalid_session' } });
      }
      return route.fulfill({ json: { status: 'ok', updated_count: scenario.count } });
    }
    if (pathname === '/api/auth/v2/refresh') {
      state.refreshes++;
      expect(request.postDataJSON()).toEqual({ refresh_token: 'fixture-refresh' });
      if (state.outcome === 'refresh-rejected') {
        return route.fulfill({ status: 401, json: { detail: 'invalid_session' } });
      }
      return route.fulfill({ json: { access_token: 'fixture-renewed', refresh_token: 'fixture-rotated' } });
    }
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {},
      prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/decks/1/cards') {
      state.reads++;
      return route.fulfill({ json: [{ id: 11, deck_id: 1, front: 'Haus', back: 'дом',
        tags: state.requests.length ? 'B2' : 'A1' }] });
    }
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('#deck-item-1')).toBeVisible();
  if (surface === 'CardList') {
    await page.evaluate(async deck => {
      const { useDeckStore } = await import('/src/store/useDeckStore.js');
      const { useUiStore } = await import('/src/store/useUiStore.js');
      useDeckStore.setState({ currentDeck: deck });
      await useDeckStore.getState().fetchDeckCards(deck.id);
      useUiStore.getState().setView('cards');
    }, deck);
  }
  state.initialReads = state.reads;
  return state;
}

async function reclassify(page) {
  await page.getByRole('button', { name: 'Опции колоды', exact: true }).click();
  await page.getByRole('button', { name: '✨ Обновить CEFR-уровни', exact: true }).click();
}

const scenarios = [
  { name: 'success preserves explicit language and count', outcome: 'success', count: 7, language: 'en' },
  { name: 'zero count and default language', outcome: 'success', count: 0 },
  { name: 'absent count still displays zero', outcome: 'success' },
  { name: '401 refreshes and retries with renewed Bearer', outcome: 'refresh', count: 3 },
  { name: 'persistent 401 stops after one retry', outcome: 'unauthorized' },
  { name: 'rejected refresh reports failure', outcome: 'refresh-rejected' },
  { name: '403 reports failure without refresh', outcome: 'forbidden' },
  { name: 'network failure permits retry', outcome: 'network', count: 2 },
];

for (const surface of ['DeckCardItem', 'CardList']) {
  for (const scenario of scenarios) {
    test(`${surface}: ${scenario.name}`, async ({ page, context }, testInfo) => {
      await page.setViewportSize({ width: surface === 'CardList' ? 375 : 1280, height: 900 });
      const state = await setup(page, context, surface, scenario);
      await reclassify(page);
      await expect.poll(() => state.requests.length).toBe(1);
      await expect(page.getByText('Обновление уровней колоды...', { exact: true })).toBeVisible();
      expect(state.reads).toBe(state.initialReads);
      state.release();

      const success = ['success', 'refresh'].includes(scenario.outcome);
      const message = success
        ? `✨ Уровни карточек обновлены! (${scenario.count || 0} шт.)`
        : scenario.outcome === 'network' ? 'Ошибка сети при переклассификации' : 'Ошибка при переклассификации';
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      expect(state.refreshes).toBe(['refresh', 'unauthorized', 'refresh-rejected'].includes(scenario.outcome) ? 1 : 0);
      expect(state.requests.length).toBe(['refresh', 'unauthorized'].includes(scenario.outcome) ? 2 : 1);
      for (const [index, request] of state.requests.entries()) {
        expect(request).toEqual({ method: 'POST', body: { deck_id: 1, target_language: scenario.language || 'de' },
          authorization: index === 0 ? 'Bearer fixture-access' : 'Bearer fixture-renewed' });
      }
      if (success) await expect.poll(() => state.reads).toBe(state.initialReads + 1);
      else expect(state.reads).toBe(state.initialReads);
      if (scenario.outcome === 'network') {
        await page.screenshot({ path: testInfo.outputPath(`${surface}-network.png`), fullPage: true });
        state.outcome = 'success';
        await reclassify(page);
        await expect(page.getByText('✨ Уровни карточек обновлены! (2 шт.)', { exact: true })).toBeVisible();
        await expect.poll(() => state.reads).toBe(state.initialReads + 1);
      }
      if (scenario.name.startsWith('success')) {
        await page.screenshot({ path: testInfo.outputPath(`${surface}-success.png`), fullPage: true });
      }
      expect(state.errors).toEqual([]);
    });
  }
}
