const { test, expect } = require('./isolated-fixture.cjs');
const deck = { id: 1, name: 'Puzzle Trainer Design', target_language: 'de', is_learning: true, stats: { total: 1, new: 1 } };
const trainer = { id: 31, deck_id: 1, queue: 'new', front: 'Ich [[lerne]] mit klein{en} Hunden bei schön[[em]] Wetter {*heute|morgen}.', back: 'Сегодня я учусь.', context: 'Контекст задания.' };
const puzzle = { id: 32, deck_id: 1, queue: 'new', front: '@puzzle\nIch lerne heute Deutsch.', back: 'Сегодня я учу немецкий.' };
const palette = (offset, states) => Object.fromEntries(states.map((state, i) => [state, {
  color: `#${offset + i}accee`, bg: `#1${offset + i}2535`, borderColor: `#${offset + i}bbbaa`,
}]));
const clozeGap = palette(1, ['gap', 'filled', 'correct', 'wrong']);
const puzzleStates = { ...palette(5, ['item', 'selected', 'correct', 'wrong']),
  container: { bg: '#112233', borderColor: '#445566', radius: '15px' } };
const design = { schemaVersion: 2,
  front: { mainText: { font: 'monospace', size: 1, weight: '500', style: 'italic', color: '#aabbcc', lineHeight: 1.65, align: 'right' } },
  back: { answerText: { font: 'serif', size: 1.2, color: '#cceeaa', weight: '600', align: 'right' },
    referenceText: { font: 'monospace', size: 1, color: '#ddeebb' }, context: { font: 'serif', color: '#ccddee' } },
  exercises: { clozeGap, puzzle: puzzleStates,
    gapDropdown: { font: 'monospace', size: 1.1, bg: '#172839', borderColor: '#abcdef',
      item: { color: '#bbccdd', bg: '#273849', borderColor: '#445566' }, selected: { color: '#ffeecc', bg: '#374859', borderColor: '#998877' } },
    actionButton: { primary: { color: '#bbddff', bg: '#223344', borderColor: '#8899aa' },
      disabled: { color: '#778899', bg: '#121314', borderColor: '#343536' } },
  },
};
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
async function setup(page, context, card, config = design) {
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru'); localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true'); localStorage.setItem('lerne_target_language', 'de');
  });
  const writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {}, is_admin: true,
      user_info: { user_id: 1, is_guest: false }, ...(config ? { global_design_v2: { config, revision: 1 } } : {}) } });
    if (path === '/api/messages' || path === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (path === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (path === `/api/study/card/${card.id}` || path === '/api/decks/1/next') return route.fulfill({ json: card });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await page.evaluate(async ({ deck, card }) => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSettingsStore.setState({ cardFont: 'Georgia', cardTextColor: '#ff00ff', cardFontSize: 1.8,
      contextFont: 'monospace', contextTextColor: '#ffff00', backTextColor: '#ffcc00',
      studyMode: 'classic', autoPlayAudio: false, autoShowAnswer: false });
    useDeckStore.setState({ currentDeck: deck, cards: [card], deckCards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card });
  return { writes, errors };
}
async function colors(item, state) {
  await expect(item).toHaveCSS('color', rgb(state.color));
  await expect(item).toHaveCSS('background-color', rgb(state.bg));
  await expect(item).toHaveCSS('border-top-color', rgb(state.borderColor));
}
async function type(item) {
  await expect(item).toHaveCSS('font-family', 'monospace');
  await expect(item).toHaveCSS('font-size', '16px');
  await expect(item).toHaveCSS('font-weight', '500');
  await expect(item).toHaveCSS('font-style', 'italic');
}
async function capture(page, testInfo, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}
async function choose(page, gap, value, root = page) {
  await root.getByRole('button', { name: `Пропуск ${gap}`, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: value, exact: true }).click();
}

for (const width of [320, 375, 430, 768, 1280]) {
  test(`Trainer V2 gaps, endings, translation and feedback at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page, context, trainer);
    const text = page.locator('.cloze-masked-text');
    const full = text.getByRole('textbox', { name: 'Пропуск 1', exact: true });
    const affix = text.getByRole('textbox', { name: 'Пропуск 3', exact: true });
    await type(text); await type(full); await type(affix);
    await expect(text).toHaveCSS('color', rgb(design.front.mainText.color));
    await colors(full, clozeGap.gap);
    await expect(affix).toHaveCSS('color', rgb(clozeGap.gap.color));
    await full.fill('lernst'); await colors(full, clozeGap.filled);
    await choose(page, 2, 'er'); await affix.fill('em'); await choose(page, 4, 'morgen');
    await text.getByRole('button', { name: 'Пропуск 4', exact: true }).click();
    await colors(page.getByRole('dialog').locator('.is-selected'), design.exercises.gapDropdown.selected);
    await page.keyboard.press('Escape');
    await colors(page.locator('.trainer-footer-action'), design.exercises.actionButton.primary);
    await page.locator('.trainer-footer-action').click();
    await colors(full, clozeGap.wrong);
    await expect(affix).toHaveCSS('color', rgb(clozeGap.correct.color));
    await expect(affix).toBeDisabled();
    await expect(text.locator('.trainer-word.is-correct-word')).toHaveCSS('background-color', rgb(clozeGap.correct.bg));
    await capture(page, testInfo, 'trainer-retry');
    await full.fill('lerne'); await choose(page, 2, 'en'); await choose(page, 4, 'heute');
    await page.locator('.trainer-footer-action').click();
    await colors(full, clozeGap.correct); await expect(full).toBeDisabled();
    await colors(page.locator('.trainer-footer-action'), design.exercises.actionButton.disabled);
    await page.getByRole('button', { name: 'Показать перевод', exact: true }).click();
    const translation = page.locator('.trainer-line-trans');
    await expect(translation).toHaveCSS('font-family', 'serif');
    await expect(translation).toHaveCSS('color', rgb(design.back.answerText.color));
    await capture(page, testInfo, 'trainer-completed');
    expect(errors).toEqual([]);
  });
  test(`Puzzle V2 sources, selected, boundaries and completion at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page, context, puzzle);
    const pool = id => page.locator(`.btn-puzzle-chip[data-id="${id}"]`);
    await colors(page.locator('.puzzle-check-action'), design.exercises.actionButton.disabled);
    await type(pool(0)); await colors(pool(0), puzzleStates.item);
    await expect(page.locator('.puzzle-target-slots')).toHaveCSS('background-color', rgb(puzzleStates.container.bg));
    await expect(page.locator('.puzzle-target-slots')).toHaveCSS('border-radius', '15px');
    await page.getByRole('button', { name: 'Показать перевод', exact: true }).click();
    await expect(page.locator('.puzzle-exercise .text-back')).toHaveCSS('color', rgb(design.back.answerText.color));
    for (const id of [1, 0, 2, 3]) await pool(id).click();
    await colors(page.locator('.puzzle-check-action'), design.exercises.actionButton.primary);
    await colors(page.locator('.puzzle-slot-chip').first(), puzzleStates.selected);
    await page.locator('.puzzle-check-action').click();
    await expect(page.locator('.puzzle-target-slots')).toHaveCSS('background-color', rgb(puzzleStates.wrong.bg));
    await expect(page.locator('.puzzle-boundary.is-incorrect').first()).toHaveCSS('color', rgb(puzzleStates.wrong.color));
    await capture(page, testInfo, 'puzzle-retry');
    await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
    for (const id of [0, 1, 2, 3]) await pool(id).click();
    await page.locator('.puzzle-check-action').click();
    await colors(page.locator('.puzzle-slot-chip').first(), puzzleStates.correct);
    await expect(page.locator('.puzzle-slot-chip').first()).toBeDisabled();
    await capture(page, testInfo, 'puzzle-completed');
    expect(errors).toEqual([]);
  });
}

for (const card of [trainer, puzzle]) test(`editor normal appearance matches study for ${card.id}`, async ({ page, context }) => {
  await setup(page, context, card);
  const selector = card === trainer ? '.trainer-full-gap' : '.btn-puzzle-chip';
  const appearance = element => { const s = getComputedStyle(element); return [s.color, s.backgroundColor, s.borderTopColor, s.font, s.lineHeight]; };
  const normal = await page.locator(selector).first().evaluate(appearance);
  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSessionStore.getState().setEditingCard(card); useUiStore.getState().setView('editor');
  }, card);
  await page.locator('.card-editor-mode > button').click();
  const preview = page.locator('.card-front-preview');
  expect(await preview.locator(selector).first().evaluate(appearance)).toEqual(normal);
  await expect(preview.locator(selector).first()).toBeDisabled();
});

test('settings uses real Trainer and Puzzle; body portals preserve scoped draft without root publication', async ({ page, context }, testInfo) => {
  const { writes } = await setup(page, context, trainer);
  await page.locator('.settings-btn').click(); await page.locator('#settings-tab-select').selectOption('design');
  await page.locator('.design-section-tabs').getByRole('button', { name: /Упражнения/ }).click();
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { normalizeDesignConfig } = await import('/src/design/designConfig.js');
    const store = useSettingsStore.getState(); const draft = normalizeDesignConfig(store.publishedDesignV2.config);
    draft.front.mainText.font = 'serif'; draft.exercises.gapDropdown.item.color = '#ccbbaa';
    draft.exercises.gapDropdown.font = 'inherit';
    draft.exercises.puzzle.selected.color = '#aaddcc';
    store.commitAdminDraft(draft, { autoPreview: false });
  });
  const scope = page.locator('.exercise-design-section > .design-preview-scope');
  await scope.getByRole('button', { name: 'Пропуск', exact: true }).click();
  await expect(scope.locator('.cloze-masked-text')).toHaveCSS('font-family', 'serif');
  await scope.getByRole('button', { name: 'Пропуск 3', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.gap-dropdown-item').first()).toHaveCSS('color', 'rgb(204, 187, 170)');
  await expect(page.getByRole('dialog').locator('.gap-dropdown-item').first()).toHaveCSS('font-family', 'serif');
  await page.keyboard.press('Escape');
  await expect(page.locator('.study-card-surface .cloze-masked-text')).toHaveCSS('font-family', 'monospace');
  await scope.getByRole('button', { name: 'Пазл', exact: true }).click();
  const source = scope.locator('.btn-puzzle-chip').first();
  await source.scrollIntoViewIfNeeded();
  const box = await source.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 8 });
  const overlay = page.locator('.puzzle-drag-overlay');
  await expect(overlay.locator('..')).toHaveCSS('z-index', '100000');
  await expect(overlay).toHaveCSS('color', 'rgb(170, 221, 204)');
  await expect(overlay).toHaveCSS('font-family', 'serif');
  await capture(page, testInfo, 'scoped-drag');
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.setViewportSize({ width: 375, height: 900 });
  await scope.getByRole('combobox').selectOption('cloze');
  await scope.locator('.trainer-full-gap').scrollIntoViewIfNeeded();
  await capture(page, testInfo, 'settings-trainer-mobile');
  expect(writes.filter(path => /grade|knowledge|publish|evaluate-answer/.test(path))).toEqual([]);
});

for (const card of [trainer, puzzle]) test(`standalone renderer inherits effective V2 and design changes preserve answers for ${card.id}`, async ({ page, context }) => {
  await setup(page, context, card);
  await page.evaluate(async card => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div'); host.id = 'stage2b-harness'; document.body.append(host);
    createRoot(host).render(React.createElement(ExerciseRenderer, { card }));
  }, card);
  const host = page.locator('#stage2b-harness');
  if (card === trainer) { await type(host.locator('.trainer-full-gap')); await host.locator('.trainer-full-gap').fill('Mein Entwurf'); }
  else { await type(host.locator('.btn-puzzle-chip').first()); await host.locator('.btn-puzzle-chip').first().click(); }
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().patchAdminDraft('front.mainText.font', 'serif');
  });
  const item = host.locator(card === trainer ? '.trainer-full-gap' : '.puzzle-slot-chip').first();
  await expect(item).toHaveCSS('font-family', 'serif');
  if (card === trainer) await expect(item).toHaveValue('Mein Entwurf');
  else await expect(item).toHaveCount(1);
});

test('separate TrainerView uses effective V2 on its interactive front', async ({ page, context }, testInfo) => {
  await setup(page, context, trainer);
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { TrainerView } = await import('/src/components/study/TrainerView.jsx');
    const { LanguageProvider } = await import('/src/i18n/i18nContext.jsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div'); host.id = 'trainer-view-harness'; document.body.append(host);
    createRoot(host).render(React.createElement(LanguageProvider, null, React.createElement(TrainerView)));
  });
  const host = page.locator('#trainer-view-harness');
  await type(host.locator('.cloze-masked-text')); await colors(host.locator('.trainer-full-gap'), clozeGap.gap);
  await capture(page, testInfo, 'trainer-view');
});

test('automatic Cloze study mode shares V2 typography and feedback even while hovered', async ({ page, context }, testInfo) => {
  const card = { ...trainer, id: 33, front: 'Ich lerne jeden Tag Deutsch.' };
  await setup(page, context, card);
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ studyMode: 'cloze' });
  });
  const options = page.locator('.btn-cloze-option');
  await expect(options).toHaveCount(4);
  await type(options.first());
  const correct = options.filter({ hasText: /^Deutsch$/ });
  const wrong = options.filter({ hasNotText: /^Deutsch$/ }).first();
  await wrong.click(); await wrong.hover(); await colors(wrong, clozeGap.wrong);
  await correct.click(); await correct.hover(); await colors(correct, clozeGap.correct);
  await capture(page, testInfo, 'automatic-cloze');
});
