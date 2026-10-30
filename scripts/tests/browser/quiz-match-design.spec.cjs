const { test, expect } = require('./isolated-fixture.cjs');
const deck = { id: 1, name: 'Design fixtures', target_language: 'de', is_learning: true, stats: { total: 1, new: 1 } };
const quiz = { id: 11, deck_id: 1, queue: 'new', front: 'Welche Antwort passt?\n\n- Gestern\n* Heute\n- Morgen', back: 'Antwort' };
const match = { id: 12, deck_id: 1, queue: 'new', front: '@match\ndie Katze => кошка\nder Hund => собака\nder Vogel => птица', back: 'Paare' };
const palette = (offset = 0) => Object.fromEntries(['normal', 'selected', 'correct', 'wrong', 'disabled'].map((state, i) => [state, {
  color: `#${offset + i + 1}1ccaa`, bg: `#1${offset + i + 1}2233`, borderColor: `#aa${offset + i + 1}1bb`,
}]));
const choice = palette();
const matchStates = Object.fromEntries(Object.entries(palette(4)).map(([state, value]) => [state === 'normal' ? 'item' : state === 'correct' ? 'matched' : state, value]));
const design = { schemaVersion: 2, front: { mainText: { font: 'monospace', color: '#aaccee', size: 1.05, weight: '500', style: 'italic', align: 'right', lineHeight: 1.7 } }, exercises: { choice, match: matchStates } };
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function setup(page, context, card, config = design) {
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  });
  const writes = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {}, is_admin: true, user_info: { user_id: 1, is_guest: false }, ...(config ? { global_design_v2: { config, revision: 1 } } : {}) } });
    if (path === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (path === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (path === `/api/study/card/${card.id}` || path === '/api/decks/1/next') return route.fulfill({ json: card });
    if (path === '/api/messages') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await page.evaluate(async ({ deck, card }) => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSettingsStore.setState({ cardFont: 'Georgia', cardTextColor: '#ff00ff', cardFontSize: 1.8, cardFontWeight: '900', contextFont: 'serif', contextTextColor: '#ffff00', contextFontSize: 1.6, studyMode: 'classic', autoPlayAudio: false, autoShowAnswer: false });
    const { migrateLegacyDesignSettings } = await import('/src/design/legacyAdapter.js');
    useSettingsStore.getState().setPersonalDesignV2(migrateLegacyDesignSettings(useSettingsStore.getState()));
    useDeckStore.setState({ currentDeck: deck, cards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card });
  return writes;
}
async function colors(item, state) {
  await expect(item).toHaveCSS('color', rgb(state.color));
  await expect(item).toHaveCSS('background-color', rgb(state.bg));
  await expect(item).toHaveCSS('border-top-color', rgb(state.borderColor));
}
async function typography(item) {
  await expect(item).toHaveCSS('font-family', 'monospace');
  await expect(item).toHaveCSS('font-size', '16.8px');
  await expect(item).toHaveCSS('font-weight', '500');
  await expect(item).toHaveCSS('font-style', 'italic');
}
async function capture(page, testInfo, name) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [320, 375, 430, 768, 1280]) {
  test(`Quiz V2 typography and states override V1 at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context, quiz);
    const question = page.locator('.quiz-question');
    const options = ['Gestern', 'Heute', 'Morgen'].map(text => page.locator('.quiz-option-item').filter({ hasText: text }));
    await typography(question);
    await expect(question).toHaveCSS('color', rgb(design.front.mainText.color));
    await typography(options[0].locator('span').last());
    await colors(options[0], choice.normal);
    await options[0].focus();
    await page.keyboard.press('Enter');
    await colors(options[0], choice.selected);
    await page.locator('.btn-check-quiz').click();
    await colors(options[0], choice.wrong);
    await expect(options[0]).toBeDisabled();
    await colors(options[1], choice.normal);
    await capture(page, testInfo, 'quiz-retry');
    await options[1].click();
    await page.locator('.btn-check-quiz').click();
    await colors(options[1], choice.correct);
    await colors(options[2], choice.disabled);
    await expect(options[2]).toBeDisabled();
    await capture(page, testInfo, 'quiz-completed');
  });
  test(`Match independent V2 states on both columns at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, context, match);
    const left = page.locator('.match-item-left');
    const right = text => page.locator('.match-item-right').filter({ hasText: text });
    await typography(left.first());
    await typography(right('кошка'));
    await colors(left.first(), matchStates.item);
    await colors(right('кошка'), matchStates.item);
    await left.first().click();
    await colors(left.first(), matchStates.selected);
    await right('собака').click();
    await colors(left.first(), matchStates.wrong);
    await colors(right('собака'), matchStates.wrong);
    await expect(left.first()).toBeEnabled();
    await capture(page, testInfo, 'match-retry');
    await right('кошка').click();
    await colors(right('кошка'), matchStates.selected);
    await left.first().click();
    await colors(left.first(), matchStates.matched);
    await colors(right('кошка'), matchStates.matched);
    await expect(left.first()).toBeDisabled();
    await expect(right('кошка')).toBeDisabled();
    await colors(left.nth(1), matchStates.item);
    await capture(page, testInfo, 'match-confirmed');
  });
}

test('local V2 edits and toggle update typography without losing selection', async ({ page, context }) => {
  await setup(page, context, quiz);
  await page.locator('.quiz-option-item').first().click();
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().patchAdminDraft('front.mainText.font', 'serif');
    useSettingsStore.getState().patchAdminDraft('front.mainText.color', '#abcdef');
  });
  await expect(page.locator('.quiz-question')).toHaveCSS('font-family', 'serif');
  await expect(page.locator('.quiz-question')).toHaveCSS('color', 'rgb(171, 205, 239)');
  await colors(page.locator('.quiz-option-item').first(), choice.selected);
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().toggleLocalDesignPreview();
  });
  await typography(page.locator('.quiz-question'));
  await colors(page.locator('.quiz-option-item').first(), choice.selected);
});

test('migrated personal typography and normal colors remain without published V2', async ({ page, context }) => {
  await setup(page, context, match, null);
  await expect(page.locator('.match-item-left').first()).toHaveCSS('font-family', 'Georgia');
  await expect(page.locator('.match-item-left').first()).toHaveCSS('color', 'rgb(255, 0, 255)');
  await expect(page.locator('.match-item-right').first()).toHaveCSS('font-family', 'serif');
  await expect(page.locator('.match-item-right').first()).toHaveCSS('color', 'rgb(255, 255, 0)');
  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 1 });
  }, quiz);
  await expect(page.locator('.quiz-question')).toHaveCSS('font-family', 'Georgia');
  await expect(page.locator('.quiz-question')).toHaveCSS('color', 'rgb(255, 0, 255)');
});

for (const card of [quiz, match]) test(`existing editor preview matches study for ${card.id}`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await setup(page, context, card);
  const selector = card === quiz ? '.quiz-option-item' : '.match-item-left';
  const getColors = e => { const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor, border: s.borderTopColor }; };
  const study = await page.locator(selector).first().evaluate(getColors);
  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSessionStore.getState().setEditingCard(card);
    useUiStore.getState().setView('editor');
  }, card);
  await page.locator('.card-editor-mode > button').click();
  const preview = page.locator('.card-front-preview');
  await expect(preview).toHaveCount(1);
  const item = preview.locator(selector).first();
  expect(await item.evaluate(getColors)).toEqual(study);
  await typography(card === quiz ? item.locator('span').last() : item);
  await expect(item).toBeDisabled();
  await capture(page, testInfo, 'existing-editor-preview');
});

test('settings uses the real preview with scoped draft and no learning writes', async ({ page, context }, testInfo) => {
  const writes = await setup(page, context, quiz);
  await page.locator('.settings-btn').click();
  await page.locator('#settings-tab-select').selectOption('design');
  await page.locator('.design-section-tabs').getByRole('button', { name: /Упражнения/ }).click();
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { normalizeDesignConfig } = await import('/src/design/designConfig.js');
    const store = useSettingsStore.getState();
    const draft = normalizeDesignConfig(store.publishedDesignV2.config);
    draft.front.mainText.font = 'serif';
    draft.front.mainText.color = '#abcdef';
    draft.exercises.match.selected.color = '#ddeecc';
    store.commitAdminDraft(draft, { autoPreview: false });
  });
  const preview = page.locator('.exercise-design-section .design-preview-scope');
  await expect(preview).toHaveCount(1);
  await expect(preview.locator('.quiz-question')).toHaveCSS('font-family', 'serif');
  await expect(preview.locator('.quiz-question')).toHaveCSS('color', 'rgb(171, 205, 239)');
  await expect(page.locator('.study-card-surface .quiz-question').first()).toHaveCSS('font-family', 'monospace');
  await preview.locator('.quiz-option-item').filter({ hasText: 'Gestern' }).click();
  await colors(preview.locator('.quiz-option-item').filter({ hasText: 'Gestern' }), choice.selected);
  await preview.locator('.btn-check-quiz').click();
  await colors(preview.locator('.quiz-option-item').filter({ hasText: 'Gestern' }), choice.wrong);
  await preview.getByRole('button', { name: 'Пары', exact: true }).click();
  await expect(preview.locator('.match-item-left').first()).toHaveCSS('font-family', 'serif');
  await preview.locator('.match-item-left').first().click();
  await expect(preview.locator('.match-item-left').first()).toHaveCSS('color', 'rgb(221, 238, 204)');
  await colors(preview.locator('.match-item-right').first(), matchStates.item);
  await page.locator('.exercise-design-section > div').filter({ has: page.getByRole('button', { name: 'Пары', exact: true }) }).last().getByRole('button', { name: 'Пары', exact: true }).click();
  const controls = page.locator('.exercise-design-section fieldset').filter({ has: page.locator('legend', { hasText: /^selected$/ }) });
  await controls.getByLabel('Цвет текста', { exact: true }).fill('#ccddff');
  await expect(preview.locator('.match-item-left').first()).toHaveCSS('color', 'rgb(204, 221, 255)');
  await capture(page, testInfo, 'existing-settings-preview');
  expect(writes.filter(path => /grade|knowledge|publish/.test(path))).toEqual([]);
});

for (const card of [quiz, match]) test(`renderer inherits V2 without explicit config for ${card.id}`, async ({ page, context }) => {
  await setup(page, context, card);
  await page.evaluate(async card => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    host.id = 'design-renderer-harness';
    document.body.append(host);
    createRoot(host).render(React.createElement(ExerciseRenderer, { card,
      styles: { cardFont: 'Georgia', cardTextColor: '#ff00ff', contextFont: 'serif', contextTextColor: '#ffff00' } }));
  }, card);
  const renderer = page.locator('#design-renderer-harness');
  if (card === quiz) {
    await typography(renderer.locator('.quiz-question'));
    await expect(renderer.locator('.quiz-question')).toHaveCSS('color', rgb(design.front.mainText.color));
  } else {
    await typography(renderer.locator('.match-item-left').first());
    await typography(renderer.locator('.match-item-right').first());
    await colors(renderer.locator('.match-item-left').first(), matchStates.item);
  }
});

test('Match prompt changes color and font through V2 while long pairs fit mobile', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const card = { ...match, front: '@match\nOrdnen Sie die passenden Ausdrücke zu.\ndie Donaudampfschifffahrtsgesellschaft => длинное русское описание транспортной компании\ndie Katze => кошка' };
  await setup(page, context, card);
  await typography(page.locator('.match-prompt'));
  await expect(page.locator('.match-prompt')).toHaveCSS('color', rgb(design.front.mainText.color));
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().patchAdminDraft('front.mainText.font', 'serif');
    useSettingsStore.getState().patchAdminDraft('front.mainText.color', '#abcdef');
  });
  await expect(page.locator('.match-prompt')).toHaveCSS('font-family', 'serif');
  await expect(page.locator('.match-prompt')).toHaveCSS('color', 'rgb(171, 205, 239)');
  await expect(page.locator('.match-item-right').first()).toHaveCSS('font-family', 'serif');
  await colors(page.locator('.match-item-left').first(), matchStates.item);
  await capture(page, testInfo, 'match-long-pairs-mobile');
});
