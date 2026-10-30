const { test, expect } = require('./isolated-fixture.cjs');

const deck = { id: 1, name: 'Input design fixtures', target_language: 'de', is_learning: true, stats: { total: 1, new: 1 } };
const cards = {
  wordBank: { id: 21, deck_id: 1, queue: 'new', front: '@wordbank\nIch <<1>> <<2>> Deutsch. Каждый день я изучаю немецкий язык.\n@options\nlerne | heute | morgen', back: '1=lerne\n2=heute' },
  freeText: { id: 22, deck_id: 1, queue: 'new', front: '@free\nSchreiben Sie einen Satz über Ihren Alltag. Расскажите о своём обычном дне.', back: 'Ich lerne jeden Tag Deutsch.' },
  editableText: { id: 23, deck_id: 1, queue: 'new', front: '@edit\nIch lernen jeden Tag Deutsch.', back: 'Ich lerne jeden Tag Deutsch.' },
};
const wordBank = {
  container: { bg: '#182638', borderColor: '#527088', radius: '17px' },
  word: { color: '#d0e4f5', bg: '#123344', borderColor: '#537789', radius: '11px' },
  selected: { color: '#decafa', bg: '#3d2455', borderColor: '#a985d8', radius: '9px' },
  correct: { color: '#b8e9bb', bg: '#163d2a', borderColor: '#6bb889', radius: '7px' },
  wrong: { color: '#ffd4bb', bg: '#51282a', borderColor: '#d08272', radius: '5px' },
};
const freeText = {
  input: { color: '#b6ddee', bg: '#152535', borderColor: '#668899', radius: '13px' },
  focus: { bg: '#1c2c3c', borderColor: '#99ccaa' },
  correct: { color: '#aadd88', borderColor: '#55aa66' },
  wrong: { color: '#eeaa88', borderColor: '#dd7766' },
};
const design = {
  schemaVersion: 2,
  front: { mainText: { font: 'monospace', color: '#aaccee', size: 1.05, weight: '500', style: 'italic', align: 'right', lineHeight: 1.7 } },
  back: { context: { font: 'serif', color: '#ff00cc', size: 1.125, weight: '600', style: 'normal', align: 'left', lineHeight: 1.8 } },
  exercises: { wordBank, freeText, choice: { correct: { color: '#00ff00', bg: '#005500', borderColor: '#00ff00' }, wrong: { color: '#ff0000', bg: '#550000', borderColor: '#ff0000' } } },
};
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function setup(page, context, card, config = design) {
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  });
  const writes = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') writes.push({ path, data: route.request().postDataJSON() });
    if (path === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {}, is_admin: true,
      user_info: { user_id: 1, is_guest: false }, ...(config ? { global_design_v2: { config, revision: 1 } } : {}),
    } });
    if (path === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (path === '/api/cards/duplicates' || path === '/api/messages') return route.fulfill({ json: [] });
    if (path === `/api/study/card/${card.id}` || path === '/api/decks/1/next') return route.fulfill({ json: card });
    if (path === '/api/ai/evaluate-answer') {
      const answer = route.request().postDataJSON().answer;
      const verdict = answer === 'Falsch.' ? 'needs_retry' : answer === 'Ausfall.' ? 'unavailable' : 'correct';
      return route.fulfill({ json: { grading_policy: { max_retries: 4 }, result: {
        verdict, accepted: verdict === 'correct', evaluator: 'exact', hint: 'Попробуйте ещё раз.',
      } } });
    }
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
      contextFont: 'monospace', contextTextColor: '#ffff00', contextFontSize: 1.6,
      studyMode: 'classic', autoPlayAudio: false, autoShowAnswer: false });
    const { migrateLegacyDesignSettings } = await import('/src/design/legacyAdapter.js');
    useSettingsStore.getState().setPersonalDesignV2(migrateLegacyDesignSettings(useSettingsStore.getState()));
    useDeckStore.setState({ currentDeck: deck, cards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.getState().setView('study');
  }, { deck, card });
  return { writes, errors };
}
async function colors(item, state) {
  await expect(item).toHaveCSS('color', rgb(state.color));
  if (state.bg) await expect(item).toHaveCSS('background-color', rgb(state.bg));
  await expect(item).toHaveCSS('border-top-color', rgb(state.borderColor));
  if (state.radius) await expect(item).toHaveCSS('border-top-left-radius', state.radius);
}
async function frontType(item, size = '16.8px') {
  await expect(item).toHaveCSS('font-family', 'monospace');
  await expect(item).toHaveCSS('font-size', size);
  await expect(item).toHaveCSS('font-weight', '500');
  await expect(item).toHaveCSS('font-style', 'italic');
}
async function inputType(item) {
  await expect(item).toHaveCSS('font-family', 'serif');
  await expect(item).toHaveCSS('font-size', '18px');
  await expect(item).toHaveCSS('font-weight', '600');
  await expect(item).toHaveCSS('line-height', '32.4px');
}
async function capture(page, testInfo, name) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

for (const width of [320, 375, 430, 768, 1280]) {
  test(`WordBank uses V2 text and independent states at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page, context, cards.wordBank);
    const gaps = page.locator('.word-bank-gap');
    const option = text => page.locator('.word-bank-option').filter({ hasText: new RegExp(`^${text}$`) });
    await frontType(page.locator('.word-bank-text-area'));
    await frontType(gaps.first());
    await frontType(option('lerne'), '15.12px');
    await expect(page.locator('.word-bank-text-area')).toHaveCSS('color', rgb(design.front.mainText.color));
    await colors(gaps.first(), wordBank.selected);
    await colors(gaps.nth(1), wordBank.word);
    await option('lerne').focus();
    await page.keyboard.press('Enter');
    await option('morgen').click();
    await page.locator('.word-bank-check').click();
    await colors(gaps.first(), wordBank.correct);
    await expect(gaps.first()).toBeDisabled();
    await colors(gaps.nth(1), wordBank.wrong);
    await expect(gaps.nth(1)).toHaveAttribute('aria-invalid', 'true');
    await capture(page, testInfo, 'wordbank-retry');
    await gaps.nth(1).click();
    await option('heute').click();
    await page.locator('.word-bank-check').click();
    await colors(gaps.nth(1), wordBank.correct);
    await expect(gaps.nth(1)).toBeDisabled();
    await expect(page.locator('.word-bank-check')).toBeDisabled();
    await colors(option('heute'), wordBank.word);
    await capture(page, testInfo, 'wordbank-completed');
    expect(errors).toEqual([]);
  });

  for (const type of ['freeText', 'editableText']) test(`${type} V2 input, focus, retry and correct at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors, writes } = await setup(page, context, cards[type]);
    const form = page.locator('.free-text-exercise');
    const field = form.locator('textarea');
    await inputType(field);
    await colors(field, freeText.input);
    if (type === 'freeText') {
      await frontType(page.locator('.free-text-prompt'));
      await expect(page.locator('.free-text-prompt')).toHaveCSS('color', rgb(design.front.mainText.color));
    } else await expect(field).toHaveValue('Ich lernen jeden Tag Deutsch.');
    await field.focus();
    await expect(field).toHaveCSS('background-color', rgb(freeText.focus.bg));
    await expect(field).toHaveCSS('border-top-color', rgb(freeText.focus.borderColor));
    await field.fill('Falsch.');
    await form.locator('button[type="submit"]').click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await colors(field, freeText.wrong);
    await expect(field).toBeEnabled();
    await field.focus();
    await expect(field).toHaveCSS('border-top-color', rgb(freeText.wrong.borderColor));
    await capture(page, testInfo, `${type}-retry`);
    await field.fill('Ich lerne jeden Tag Deutsch.');
    await expect(field).toHaveCSS('color', rgb(freeText.input.color));
    await form.locator('button[type="submit"]').click();
    await expect(field).toBeDisabled();
    await colors(field, freeText.correct);
    await expect(form.locator('.free-text-feedback')).toHaveCSS('color', rgb(freeText.correct.color));
    await capture(page, testInfo, `${type}-completed`);
    expect(writes.filter(w => w.path === '/api/ai/evaluate-answer').map(w => w.data.answer)).toEqual(['Falsch.', 'Ich lerne jeden Tag Deutsch.']);
    expect(errors).toEqual([]);
  });
}

for (const type of Object.keys(cards)) test(`${type} editor preview matches real normal typography and colors`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const { writes } = await setup(page, context, cards[type]);
  const selector = type === 'wordBank' ? '.word-bank-gap' : 'textarea';
  const appearance = element => {
    const style = getComputedStyle(element);
    return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'color', 'backgroundColor', 'borderTopColor'].map(key => [key, style[key]]));
  };
  const normal = await page.locator(type === 'wordBank' ? selector : '.free-text-exercise textarea').first().evaluate(appearance);
  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useSessionStore.getState().setEditingCard(card);
    useUiStore.getState().setView('editor');
  }, cards[type]);
  await page.locator('.card-editor-mode > button').click();
  const preview = page.locator('.card-front-preview');
  expect(await preview.locator(selector).first().evaluate(appearance)).toEqual(normal);
  await expect(preview.locator(selector).first()).toBeDisabled();
  await capture(page, testInfo, `${type}-editor`);
  expect(writes.filter(w => /evaluate-answer|grade|knowledge|publish/.test(w.path))).toEqual([]);
});

for (const type of Object.keys(cards)) test(`${type} preserves migrated personal typography without published V2`, async ({ page, context }) => {
  await setup(page, context, cards[type], null);
  if (type === 'wordBank') {
    await expect(page.locator('.word-bank-text-area')).toHaveCSS('font-family', 'Georgia');
    await expect(page.locator('.word-bank-text-area')).toHaveCSS('color', 'rgb(255, 0, 255)');
  } else {
    await expect(page.locator('.free-text-exercise textarea')).toHaveCSS('font-family', 'monospace');
    await expect(page.locator('.free-text-exercise textarea')).toHaveCSS('color', 'rgb(255, 255, 0)');
  }
});

test('local preview toggle changes V2 without losing input or WordBank assignment', async ({ page, context }) => {
  await setup(page, context, cards.freeText);
  const field = page.locator('.free-text-exercise textarea');
  await field.fill('Мой несохранённый ответ');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const store = useSettingsStore.getState();
    store.patchAdminDraft('back.context.font', 'monospace');
    store.patchAdminDraft('exercises.freeText.input.color', '#abcdef');
  });
  await expect(field).toHaveCSS('font-family', 'monospace');
  await expect(field).toHaveCSS('color', 'rgb(171, 205, 239)');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().toggleLocalDesignPreview();
  });
  await inputType(field);
  await expect(field).toHaveValue('Мой несохранённый ответ');
  await page.evaluate(async card => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 1 });
  }, cards.wordBank);
  await page.locator('.word-bank-option').filter({ hasText: /^lerne$/ }).click();
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().patchAdminDraft('front.mainText.font', 'serif');
  });
  await expect(page.locator('.word-bank-text-area')).toHaveCSS('font-family', 'serif');
  await expect(page.locator('.word-bank-gap').first()).toContainText('lerne');
});

test('Free Text service failure stays neutral and retry succeeds', async ({ page, context }) => {
  await setup(page, context, cards.freeText);
  const field = page.locator('.free-text-exercise textarea');
  await field.fill('Ausfall.');
  await page.locator('.free-text-exercise button[type="submit"]').click();
  await expect(page.locator('.free-text-feedback')).toContainText('попытка не засчитана');
  await expect(field).toHaveAttribute('aria-invalid', 'false');
  await expect(field).toHaveCSS('color', rgb(freeText.input.color));
  await expect(field).toBeEnabled();
  await field.fill('Ich lerne jeden Tag Deutsch.');
  await page.locator('.free-text-exercise button[type="submit"]').click();
  await expect(field).toBeDisabled();
  await colors(field, freeText.correct);
});

test('standalone renderer resolves effective V2 for all three types and uses active V2 for explicit null, ignoring flat V1 styles', async ({ page, context }) => {
  await setup(page, context, cards.wordBank);
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { ExerciseRenderer } = await import('/src/components/study/ExerciseRenderer.jsx');
    document.getElementById('root').style.display = 'none';
    const host = document.createElement('div');
    host.id = 'input-design-harness';
    document.body.append(host);
    const root = createRoot(host);
    window.renderInputDesign = (card, legacy) => root.render(React.createElement(ExerciseRenderer, {
      card, key: `${card.id}:${legacy}`, ...(legacy ? { designConfig: null } : {}),
      styles: { cardFont: 'Georgia', cardTextColor: '#ff00ff', contextFont: 'monospace', contextTextColor: '#ffff00' },
    }));
  });
  const harness = page.locator('#input-design-harness');
  for (const [type, card] of Object.entries(cards)) {
    await page.evaluate(card => window.renderInputDesign(card, false), card);
    if (type === 'wordBank') await frontType(harness.locator('.word-bank-text-area'));
    else await inputType(harness.locator('textarea'));
    await page.evaluate(card => window.renderInputDesign(card, true), card);
    if (type === 'wordBank') await frontType(harness.locator('.word-bank-text-area'));
    else await inputType(harness.locator('textarea'));
  }
});

test('long WordBank options and gap labels wrap at 320px without overflow', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const longWord = 'Donaudampfschifffahrtsgesellschaftskapitän';
  const card = { ...cards.wordBank, front: `@wordbank\nDie <<1>>.\n@options\n${longWord} | длинноесловобезпробеловдляпроверкипереноса`, back: `1=${longWord}` };
  await setup(page, context, card);
  const option = page.locator('.word-bank-option').first();
  expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await option.click();
  await capture(page, testInfo, 'wordbank-long-word');
  const gap = page.locator('.word-bank-gap');
  expect(await gap.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('settings uses real scoped previews and WordBank feedback without evaluation or study writes', async ({ page, context }, testInfo) => {
  const { writes, errors } = await setup(page, context, cards.freeText);
  await page.locator('.settings-btn').click();
  await page.locator('#settings-tab-select').selectOption('design');
  await page.locator('.design-section-tabs').getByRole('button', { name: /Упражнения/ }).click();
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    const { normalizeDesignConfig } = await import('/src/design/designConfig.js');
    const store = useSettingsStore.getState();
    const draft = normalizeDesignConfig(store.publishedDesignV2.config);
    draft.front.mainText.font = 'serif';
    draft.exercises.freeText.input.color = '#abcdef';
    store.commitAdminDraft(draft, { autoPreview: false });
  });
  const preview = page.locator('.exercise-design-section > .design-preview-scope');
  await preview.getByRole('button', { name: 'Банк слов', exact: true }).click();
  await expect(preview.locator('.word-bank-text-area')).toHaveCSS('font-family', 'serif');
  await preview.locator('.word-bank-option').filter({ hasText: /^lerne$/ }).click();
  await preview.locator('.word-bank-option').filter({ hasText: /^morgen$/ }).click();
  await preview.locator('.word-bank-check').click();
  await colors(preview.locator('.word-bank-gap').first(), wordBank.correct);
  await colors(preview.locator('.word-bank-gap').nth(1), wordBank.wrong);
  await preview.getByRole('button', { name: 'Свободный ответ / Письмо', exact: true }).click();
  await expect(preview.locator('textarea')).toBeDisabled();
  await expect(preview.locator('textarea')).toHaveCSS('color', 'rgb(171, 205, 239)');
  await expect(page.locator('.study-card-surface textarea').first()).toHaveCSS('color', rgb(freeText.input.color));
  const controls = page.locator('.exercise-design-tabs');
  await controls.getByRole('button', { name: 'Свободный ответ / Письмо', exact: true }).click();
  const inputControls = page.locator('.exercise-design-section fieldset').filter({ has: page.locator('legend', { hasText: /^input$/ }) });
  await inputControls.getByLabel('Цвет текста', { exact: true }).fill('#ccddff');
  await expect(preview.locator('textarea')).toHaveCSS('color', 'rgb(204, 221, 255)');
  await preview.getByRole('button', { name: 'Редактируемый текст', exact: true }).click();
  await expect(preview.locator('.editable-text-exercise textarea')).toHaveValue('Ich lernen jeden Tag Deutsch.');
  await expect(preview.locator('textarea')).toBeDisabled();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 320) {
      await preview.getByRole('combobox').selectOption('freeText');
      const bounds = await preview.locator('.free-text-prompt').boundingBox();
      const scope = await preview.boundingBox();
      expect(bounds.y).toBeLessThan(scope.y + scope.height);
      await preview.getByRole('combobox').selectOption('editableText');
    }
    await capture(page, testInfo, `settings-input-${width}`);
  }
  expect(writes.filter(w => /evaluate-answer|grade|knowledge|publish/.test(w.path))).toEqual([]);
  expect(errors).toEqual([]);
});
