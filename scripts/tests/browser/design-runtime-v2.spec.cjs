const { test, expect } = require('./isolated-fixture.cjs');
const deck = { id: 1, name: 'Design runtime', target_language: 'de', is_learning: true, stats: { total: 1, new: 1 } };
const card = { id: 41, deck_id: 1, queue: 'new', front: 'Ich lerne jeden Tag Deutsch.', back: 'Каждый день я учу немецкий.', context: 'Ein Beispiel für den Alltag.' };
const config = { schemaVersion: 2,
  front: { card: { background: '#123456' }, mainText: { font: 'monospace', size: 1.1, weight: '500', style: 'italic', color: '#bcddee', align: 'right', lineHeight: 1.65, shadow: 'neon' } },
  back: { card: { background: 'linear-gradient(135deg, #102030, #304050)' },
    answerText: { font: 'serif', size: 1.2, color: '#cceeaa', weight: '600', shadow: 'outline', align: 'left' },
    referenceText: { font: 'monospace', size: 1, color: '#deccaa', shadow: 'glass' },
    context: { font: 'serif', size: 1, color: 'auto', shadow: 'glow', lineHeight: 1.8 } },
  cardList: { frontText: { font: 'monospace', shadow: 'neon', lineHeight: 1.8 }, backText: { shadow: 'outline', lineHeight: 1.7 } },
  exercises: { choice: { selected: { color: '#abc322', bg: '#223344', borderColor: '#778899' } } },
};
async function setup(page, context, design = config) {
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru'); localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true'); localStorage.setItem('lerne_target_language', 'de');
    window.recognitionStarts = 0;
    window.SpeechRecognition = class {
      start() { window.recognitionStarts++; window.testRecognition = this; this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() {}
    };
  });
  const writes = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes.push(path);
    if (path === '/api/init') return route.fulfill({ json: { decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {}, is_admin: true,
      user_info: { user_id: 1, is_guest: false }, ...(design ? { global_design_v2: { config: design, revision: 1 } } : {}) } });
    if (path === '/api/messages' || path === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (path === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (path === '/api/study/card/41' || path === '/api/decks/1/next') return route.fulfill({ json: card });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1'); await expect(page.getByText(deck.name, { exact: true }).first()).toBeVisible();
  await page.evaluate(async ({ deck, card }) => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSettingsStore.setState({ cardFont: 'Georgia', cardTextColor: '#ff00ff', cardFontSize: 1.8,
      cardBgFront: 'dark_mocha', cardBgBack: 'dark_emerald', contextFont: 'monospace', contextTextColor: '#ffff00',
      studyMode: 'classic', autoPlayAudio: false, autoShowAnswer: false, speechFollowupEnabled: false });
    const { migrateLegacyDesignSettings } = await import('/src/design/legacyAdapter.js');
    useSettingsStore.getState().setPersonalDesignV2(migrateLegacyDesignSettings(useSettingsStore.getState()));
    useDeckStore.setState({ currentDeck: deck, cards: [card], deckCards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card });
  return { writes, errors };
}
async function setSession(page, patch) {
  await page.evaluate(async patch => (await import('/src/store/useSessionStore.js')).useSessionStore.setState(patch), patch);
}
async function capture(page, testInfo, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}
async function speechType(item) {
  await expect(item).toHaveCSS('font-family', 'monospace'); await expect(item).toHaveCSS('font-size', '17.6px');
  await expect(item).toHaveCSS('font-weight', '500'); await expect(item).toHaveCSS('font-style', 'italic');
  await expect(item).toHaveCSS('color', 'rgb(188, 221, 238)'); await expect(item).not.toHaveCSS('text-shadow', 'none');
}
async function transcript(page, text) {
  await page.evaluate(text => {
    const result = [{ transcript: text }]; result.isFinal = true;
    window.testRecognition.onresult({ resultIndex: 0, results: [result] });
  }, text);
}

for (const width of [320, 375, 430, 768, 1280]) test(`speech V2 typography, transcript and review reset at ${width}px`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width, height: 1050 });
  const { errors } = await setup(page, context);
  await page.evaluate(async () => (await import('/src/store/useSettingsStore.js')).useSettingsStore.setState({ studyMode: 'speak' }));
  const target = page.locator('.speak-target-text'); await speechType(target);
  await page.getByRole('button', { name: 'Начать запись', exact: true }).click();
  await transcript(page, 'Ich lerne jeden Tag Deutsch.');
  const recognized = page.locator('.recognized-transcript-bubble > div');
  await speechType(recognized);
  await expect(page.locator('.btn-speak-mic')).toBeDisabled();
  await capture(page, testInfo, 'speech-v2-success');
  await setSession(page, { card: { ...card, id: 42 }, historyIndex: 1 });
  await expect(page.locator('.btn-speak-mic')).toBeEnabled();
  await expect(page.locator('.recognized-transcript-bubble')).toHaveCount(0);
  await speechType(target); expect(errors).toEqual([]);
});

test('all nine card types and reverse mode use physical V2 front/back backgrounds', async ({ page, context }) => {
  await setup(page, context);
  const fixtures = [
    ['Standard', 'Antwort'], ['@theory\nEin kurzer Überblick.', 'Theorie'],
    ['Welche Antwort?\nA) Nein\n*B) Ja', 'Ja'], ['@match\nKatze => кошка\nHund => собака', 'Paare'],
    ['@wordbank\nIch <<1>> Deutsch.\n@options\nlerne | lernst', '1=lerne'],
    ['@free\nSchreiben Sie einen Satz.', 'Ich lerne.'], ['@edit\nIch lernen.', 'Ich lerne.'],
    ['Ich [[lerne]] Deutsch.', 'Я учусь.'], ['@puzzle\nIch lerne Deutsch.', 'Я учу немецкий.'],
  ];
  for (const [i, [front, back]] of fixtures.entries()) {
    await setSession(page, { card: { ...card, id: i + 50, front, back }, historyIndex: i + 1, isFlipped: false });
    await expect(page.locator('.study-card-surface .card-front .bg-v2')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await setSession(page, { isFlipped: true });
    await expect(page.locator('.study-card-surface .card-back .bg-v2')).toHaveCSS('background-image', 'linear-gradient(135deg, rgb(16, 32, 48), rgb(48, 64, 80))');
  }
  await page.evaluate(async () => (await import('/src/store/useSettingsStore.js')).useSettingsStore.setState({ studyMode: 'reverse' }));
  await setSession(page, { card, isFlipped: false });
  await expect(page.locator('.study-card-surface .card-front .bg-v2')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
});

for (const design of [null, { schemaVersion: 2 }]) test(`unspecified V2 backgrounds preserve personal settings (${design ? 'old V2' : 'no V2'})`, async ({ page, context }) => {
  await setup(page, context, design);
  await expect(page.locator('.study-card-surface .bg-dark-mocha')).toHaveCount(1);
  await setSession(page, { isFlipped: true });
  await expect(page.locator('.study-card-surface .bg-dark-emerald')).toHaveCount(1);
});

test('editor uses the same backgrounds and V2 answer/context styles without changing source', async ({ page, context }, testInfo) => {
  const { writes } = await setup(page, context);
  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSessionStore.getState().setEditingCard(card); useUiStore.getState().setView('editor');
  }, card);
  await expect(page.locator('#tut-creator-front .bg-v2')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  const back = page.locator('#card-editor-back'), ctx = page.locator('#card-editor-context');
  await expect(back).toHaveCSS('font-family', 'serif'); await expect(back).toHaveCSS('color', 'rgb(204, 238, 170)');
  await expect(back).not.toHaveCSS('text-shadow', 'none'); await expect(ctx).not.toHaveCSS('text-shadow', 'none');
  await expect(back).toHaveValue(card.back); await expect(ctx).toHaveValue(card.context);
  await page.setViewportSize({ width: 375, height: 1050 });
  await capture(page, testInfo, 'editor-v2');
  expect(writes.filter(path => /cards\/save|grade|publish/.test(path))).toEqual([]);
});

test('semantic Quiz colors also determine V2 text glow', async ({ page, context }) => {
  await setup(page, context);
  await setSession(page, { card: { ...card, id: 45, front: 'Welche Antwort?\nA) Nein\n*B) Ja' }, historyIndex: 1 });
  const option = page.locator('.quiz-option-item').first(); await option.click();
  await expect(option).toHaveCSS('color', 'rgb(171, 195, 34)');
  const shadow = await option.locator('span').last().evaluate(element => getComputedStyle(element).textShadow);
  expect(shadow).toContain('rgb(171, 195, 34)');
});

test('scoped front/back/speech previews use the same V2 background and typography without publication', async ({ page, context }, testInfo) => {
  const { writes } = await setup(page, context);
  await page.locator('.settings-btn').click(); await page.locator('#settings-tab-select').selectOption('design');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { normalizeDesignConfig } = await import('/src/design/designConfig.js');
    const store = useSettingsStore.getState(), draft = normalizeDesignConfig(store.publishedDesignV2.config);
    draft.front.card.background = '#332211'; draft.front.mainText.color = '#abcdef';
    draft.back.answerText.color = '#bbccdd';
    store.commitAdminDraft(draft, { autoPreview: false });
  });
  const tabs = page.locator('.design-section-tabs');
  await tabs.getByRole('button', { name: /Лицевая/ }).click();
  const front = page.locator('.front-design-section .design-preview-scope');
  await expect(front.locator('.bg-v2')).toHaveCSS('background-color', 'rgb(51, 34, 17)');
  const text = front.getByText('Ich interessiere mich sehr für diese Stelle.', { exact: true });
  await expect(text).toHaveCSS('color', 'rgb(171, 205, 239)'); await expect(text).not.toHaveCSS('text-shadow', 'none');
  await expect(page.locator('.study-card-surface .bg-v2')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await page.locator('.front-design-section').getByRole('button', { name: 'Карточка', exact: true }).click();
  await page.locator('.design-surface-controls').getByRole('combobox', { name: 'Фон карточки', exact: true }).selectOption('$custom');
  const custom = page.getByRole('textbox', { name: 'Свой цвет / градиент', exact: true });
  await custom.fill('linear-gradient(90deg, #123456, #654321)'); await custom.press('Tab');
  await expect(front.locator('.bg-v2')).toHaveCSS('background-image', 'linear-gradient(90deg, rgb(18, 52, 86), rgb(101, 67, 33))');
  await tabs.getByRole('button', { name: /Обратная/ }).click();
  const back = page.locator('.back-design-section .design-preview-scope');
  await expect(back.getByText('Я очень интересуюсь этой должностью.', { exact: true })).not.toHaveCSS('text-shadow', 'none');
  const expected = await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { getDesignStylesFromV2 } = await import('/src/utils/cardStyles.js');
    const color = getDesignStylesFromV2(useSettingsStore.getState().adminDraftDesignV2).contextText.color;
    const node = document.createElement('span'); node.style.color = color; document.body.append(node);
    const value = getComputedStyle(node).color; node.remove(); return value;
  });
  await expect(back.getByText('Пример контекста: Bewerbung um eine Arbeitsstelle.', { exact: true })).toHaveCSS('color', expected);
  await tabs.getByRole('button', { name: /Упражнения/ }).click();
  const preview = page.locator('.exercise-design-section .design-preview-scope');
  await preview.getByRole('button', { name: 'Речь', exact: true }).click();
  await expect(preview.locator('.speak-target-text')).toHaveCSS('color', 'rgb(171, 205, 239)');
  await expect(preview.locator('.btn-speak-mic')).toBeDisabled();
  expect(await page.evaluate(() => window.recognitionStarts)).toBe(0);
  await page.setViewportSize({ width: 375, height: 1050 });
  await preview.locator('.speak-target-text').scrollIntoViewIfNeeded(); await capture(page, testInfo, 'scoped-speech-mobile');
  expect(writes.filter(path => /grade|publish|evaluate-answer/.test(path))).toEqual([]);
});

test('V2 speech follow-up and a live theme change retain the current review and microphone', async ({ page, context }) => {
  await setup(page, context);
  await page.evaluate(async card => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSettingsStore.setState({ speechFollowupEnabled: true });
    useSessionStore.setState({ card: { ...card, id: 60, front: '@puzzle\nIch lerne Deutsch.' }, historyIndex: 1 });
  }, card);
  for (const word of ['Ich', 'lerne', 'Deutsch.']) await page.locator('.btn-puzzle-chip').filter({ hasText: word }).click();
  await page.locator('.puzzle-check-action').click();
  await expect(page.locator('.speech-followup-intro')).toBeVisible();
  await speechType(page.locator('.speak-target-text'));
  const starts = await page.evaluate(() => window.recognitionStarts);
  expect(starts).toBe(1);
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().patchAdminDraft('front.card.background', '#345678');
    useSettingsStore.getState().patchAdminDraft('front.mainText.font', 'serif');
  });
  await expect(page.locator('.speak-target-text')).toHaveCSS('font-family', 'serif');
  await expect(page.locator('.study-card-surface .bg-v2')).toHaveCSS('background-color', 'rgb(52, 86, 120)');
  expect(await page.evaluate(() => window.recognitionStarts)).toBe(starts);
  await expect(page.locator('.btn-speak-mic')).toHaveAccessibleName('Остановить запись и проверить');
});

test('changing V2 background preserves text input; reduced motion retains the selected theme without animation', async ({ page, context }, testInfo) => {
  // The installed Framer hook snapshots the OS preference when it mounts.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page, context);
  await setSession(page, { card: { ...card, id: 61, front: '@free\nBeschreiben Sie Ihren Alltag.' }, historyIndex: 1 });
  const input = page.locator('.free-text-exercise textarea'); await input.fill('Мой несохранённый ответ.');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().patchAdminDraft('front.card.background', 'liquid_morning');
  });
  await expect(page.locator('.study-card-surface .bg-liquid-morning')).toHaveCount(1);
  const transforms = await page.locator('.study-card-surface .liquid-blob').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).transform));
  expect(transforms).toEqual(['none', 'none', 'none']);
  await expect(input).toHaveValue('Мой несохранённый ответ.');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().toggleLocalDesignPreview();
  });
  await expect(page.locator('.study-card-surface .bg-v2')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(input).toHaveValue('Мой несохранённый ответ.');
  await capture(page, testInfo, 'input-theme-preserved');
});
