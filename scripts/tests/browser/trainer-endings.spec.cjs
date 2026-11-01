const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Endings', target_language: 'de', is_learning: true,
  stats: { total: 1, new: 1, due: 0, learning: 0 } };
const front = 'Mit klein{en} Hunden bei schön[[em]] Wetter.\n{Der} Hund läuft.';
const card = { id: 1, deck_id: 1, front, front_text: front, back: 'С маленькими собаками в хорошую погоду.', queue: 'new' };
// Stage 4B removed flat V1 typography. Endings use clozeGap state colors,
// independently of the sentence's front.mainText color.
const endingsDesign = {
  front: { mainText: { color: '#aaccee', font: 'Georgia', size: 1.75, weight: '400' } },
  exercises: { clozeGap: { gap: { color: '#fed7aa' }, filled: { color: '#cbd5e1' } } },
};

async function openCard(page, context, language = 'ru', editor = false, design = endingsDesign) {
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(language => {
    localStorage.setItem('native_language', language);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, first_name: 'Test', is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'endings-fixture', refresh_token: 'endings-refresh' }));
  }, language);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, first_name: 'Test', is_guest: false } });
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
      ...(design ? { global_design_v2: { config: design, revision: 1 } } : {}),
    } });
    if (pathname === '/api/cards/save') return route.fulfill({ json: { ...route.request().postDataJSON(), id: 1 } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/messages') return route.fulfill({ json: [] });
    if (pathname === '/api/study/card/1' || pathname === '/api/decks/1/next') return route.fulfill({ json: card });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText('Endings', { exact: true }).first()).toBeVisible();
  await page.evaluate(async ({ deck, card, editor }) => {
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    // Deliberately conflicting retired fields must never select a V1 renderer.
    useSettingsStore.setState({ cardTextColor: '#ff00ff', cardFont: 'monospace', cardFontSize: 1, cardFontWeight: 900 });
    useDeckStore.setState({ currentDeck: deck, cards: [card] });
    useSessionStore.setState({ card, editingCard: editor ? { ...card, front: 'kleinen' } : null, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView(editor ? 'editor' : 'study');
  }, { deck, card, editor });
}

test('endings stay compact and attached across viewports; choices, typing, correction and retry work', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openCard(page, context);
  const text = page.locator('.cloze-masked-text').first();
  const choice = text.getByRole('button', { name: 'Пропуск 1', exact: true });
  const input = text.getByRole('textbox', { name: 'Пропуск 2', exact: true });
  await expect(choice).toBeVisible();
  await expect(input).toBeVisible();
  await expect(text).toHaveCSS('color', 'rgb(170, 204, 238)');
  await expect(page.getByRole('button', { name: /Заполните пропуски/ })).toBeDisabled();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await text.evaluate(element => [...element.querySelectorAll('.trainer-word')].map(word => {
      const stem = word.querySelector('.trainer-word-letter').getBoundingClientRect();
      const gap = word.querySelector('.trainer-affix-gap');
      const box = gap.getBoundingClientRect();
      const style = getComputedStyle(gap);
      return { distance: box.left - stem.right, width: box.width, color: style.color, font: style.fontFamily, topDifference: Math.abs(box.top - stem.top) };
    }));
    for (const gap of geometry) {
      expect(gap.distance).toBeLessThanOrEqual(1);
      expect(gap.width).toBeLessThan(44);
      expect(gap.topDifference).toBeLessThan(10);
      expect(gap.color).toBe('rgb(254, 215, 170)');
      expect(gap.font).toContain('Georgia');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`endings-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await choice.click();
  const menu = page.getByRole('dialog', { name: 'Пропуск 1', exact: true });
  await expect(menu.getByRole('button')).toHaveCount(5);
  await page.screenshot({ path: testInfo.outputPath('endings-menu.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(choice).toBeFocused();
  await choice.click();
  await menu.getByRole('button', { name: 'en', exact: true }).click();
  await expect(choice).toHaveText('en');
  await expect(choice).toHaveCSS('color', 'rgb(203, 213, 225)');
  await input.focus();
  expect(await input.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  await input.fill('er');
  await text.getByRole('button', { name: 'Пропуск 3', exact: true }).click();
  await page.getByRole('dialog', { name: 'Пропуск 3', exact: true }).getByRole('button', { name: 'Der', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  await expect(input).toHaveValue('er');
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(choice).toBeDisabled();
  await expect(choice).toHaveCSS('color', 'rgb(74, 222, 128)');
  await expect(input).toHaveCSS('color', 'rgb(248, 113, 113)');
  await expect(text.getByRole('button', { name: 'Пропуск 3', exact: true })).toBeDisabled();
  await expect(text.locator('.trainer-affix-correction')).toHaveCount(0);
  await expect(text.getByText('Проверь окончание.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('endings-partial-retry.png'), fullPage: true });
  await input.fill('em');
  expect(await input.evaluate(element => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = getComputedStyle(element).font;
    return element.getBoundingClientRect().width >= context.measureText(element.value).width - 10;
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ending-input-em.png'), fullPage: true });
  await input.press('Enter');
  await expect(text.locator('.trainer-affix-gap.is-correct')).toHaveCount(2);
  await expect(input).toHaveCSS('color', 'rgb(74, 222, 128)');
  await page.screenshot({ path: testInfo.outputPath('endings-correct.png'), fullPage: true });
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.getState().setCard({ id: 2, deck_id: 1, front: 'Donaudampfschifffahrtsgesellschaft{en}' });
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(text.getByRole('button', { name: 'Пропуск 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ending-long-word-320.png'), fullPage: true });
  expect(errors).toEqual([]);
});

for (const configProp of ['omitted', 'null']) {
  test(`endings without V2 documents use V2 defaults for ${configProp} config, ignoring retired Legacy styles`, async ({ page, context }) => {
    await openCard(page, context, 'ru', false, null);
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
      // Bootstrap normally creates a personal V2 record. Also cover no source at all.
      useSettingsStore.setState({ personalDesignV2: null, publishedDesignV2: null,
        adminDraftDesignV2: null, isLocalDesignPreviewActive: false });
    });
    await expect(page.locator('.cloze-masked-text')).toHaveCSS('font-family', 'Comfortaa');
    await expect(page.locator('.trainer-affix-gap').first()).toHaveCSS('color', 'rgba(255, 255, 255, 0.5)');
    await page.evaluate(async configProp => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
      document.getElementById('root').style.display = 'none';
      const host = document.createElement('div'); host.id = 'endings-harness'; document.body.append(host);
      createRoot(host).render(React.createElement(ExerciseRenderer, {
        card: { id: 2, front: 'Mit klein{en} Hunden bei schön[[em]] Wetter.' },
        ...(configProp === 'null' ? { designConfig: null } : {}),
        styles: { cardTextColor: '#fed7aa', cardFont: 'Georgia' },
      }));
    }, configProp);
    const host = page.locator('#endings-harness');
    await expect(host.locator('.cloze-masked-text')).toHaveCSS('color', 'rgb(253, 224, 71)');
    await expect(host.locator('.cloze-masked-text')).toHaveCSS('font-family', 'Comfortaa');
    await expect(host.locator('.trainer-affix-gap')).toHaveCount(2);
    for (const gap of await host.locator('.trainer-affix-gap').all()) {
      await expect(gap).toHaveCSS('color', 'rgba(255, 255, 255, 0.5)');
    }
    await host.getByRole('textbox').fill('er');
    await expect(host.getByRole('textbox')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.evaluate(async design => {
      const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
      useSettingsStore.getState().setPublishedDesignV2({ config: design, revision: 1 });
    }, endingsDesign);
    await expect(host.locator('.cloze-masked-text')).toHaveCSS('font-family', 'Georgia');
    await expect(host.locator('.trainer-affix-gap').first()).toHaveCSS('color', 'rgb(254, 215, 170)');
    await expect(host.getByRole('textbox')).toHaveCSS('color', 'rgb(203, 213, 225)');
    await expect(host.getByRole('textbox')).toHaveValue('er');
  });
}

test('published endings roles resist an unpublished draft and publication updates preserve input', async ({ page, context }) => {
  await openCard(page, context);
  const input = page.getByRole('textbox', { name: 'Пропуск 2', exact: true });
  await input.fill('er');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { normalizeDesignConfig } = await import('/src/design/designConfig.js');
    useSettingsStore.getState().commitAdminDraft(normalizeDesignConfig({
      front: { mainText: { font: 'monospace', color: '#ff0000' } },
      exercises: { clozeGap: { gap: { color: '#00ff00' }, filled: { color: '#0000ff' } } },
    }), { autoPreview: false });
  });
  await expect(page.locator('.cloze-masked-text')).toHaveCSS('font-family', 'Georgia');
  await expect(page.locator('.trainer-affix-gap').first()).toHaveCSS('color', 'rgb(254, 215, 170)');
  await expect(input).toHaveCSS('color', 'rgb(203, 213, 225)');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const store = useSettingsStore.getState();
    const config = structuredClone(store.publishedDesignV2.config);
    config.exercises.clozeGap.gap.color = '#bbccdd';
    config.exercises.clozeGap.filled.color = '#ddeebb';
    store.setPublishedDesignV2({ config, revision: 2 });
  });
  await expect(input).toHaveValue('er');
  await expect(input).toHaveCSS('color', 'rgb(221, 238, 187)');
  await expect(page.locator('.trainer-affix-gap').first()).toHaveCSS('color', 'rgb(187, 204, 221)');
});

test('ending command wraps a selected ending and saves the short markup; English labels work', async ({ page, context }, testInfo) => {
  await openCard(page, context, 'en', true);
  const source = page.getByRole('textbox', { name: 'Source markup', exact: true });
  await expect(source).toHaveValue('kleinen');
  await source.evaluate(element => { element.focus(); element.setSelectionRange(5, 7); });
  await page.getByRole('button', { name: 'Ending with choices', exact: true }).click();
  await expect(source).toHaveValue('klein{en}');
  const gap = await page.evaluate(async front => {
    const { parseClozeData } = await import('/src/utils/clozeParser.js');
    return parseClozeData({ front }, 'trainer').gaps[0];
  }, await source.inputValue());
  expect(gap.correctAnswer).toBe('en');
  expect(gap.choices.slice().sort()).toEqual(['e', 'em', 'en', 'er', 'es']);
  await page.getByRole('button', { name: 'Show preview', exact: true }).click();
  await expect(page.locator('.card-front-preview .trainer-affix-gap')).toHaveText('··');
  await expect(page.locator('.card-front-preview .trainer-affix-gap')).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('.card-front-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('ending-editor-sentence-en-320.png'), fullPage: true });
  await source.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('ending-editor-en-320.png'), fullPage: true });
  const saved = page.waitForRequest(request => new URL(request.url()).pathname === '/api/cards/save');
  await page.getByRole('button', { name: /^Save/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({ front: 'klein{en}', card_type: 'trainer' });
});
