const { test, expect } = require('@playwright/test');

const fixtures = {
  puzzle: { front: '::task\nСобери предложение.\n\n::exercise\n@puzzle\nIch lerne Deutsch.', back: 'Я учу немецкий.' },
  trainer: { front: 'Ich [[lerne]] Deutsch.', back: 'Я учу немецкий.' },
  wordbank: { front: '@wordbank\nIch <<1>> Deutsch.\n@options\nlerne | lernst', back: '1=lerne' },
};

async function setup(page, context, { type = 'puzzle', enabled = true, recognition = 'supported', locale = 'ru', requiredActions } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(({ enabled, recognition, locale }) => {
    localStorage.setItem('native_language', locale);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'speech-test', refresh_token: 'speech-test' }));
    if (localStorage.getItem('lerne_speech_followup_enabled') === null) {
      localStorage.setItem('lerne_speech_followup_enabled', String(enabled));
    }
    window.recognitionStarts = 0;
    window.SpeechRecognition = recognition === 'unsupported' ? undefined : class {
      start() {
        window.testRecognition = this;
        window.recognitionStarts++;
        if (recognition === 'denied') this.onerror?.({ error: 'not-allowed' });
        else if (recognition === 'failed') throw new Error('Missing microphone');
        else this.onstart?.();
      }
      stop() { this.onend?.(); }
      abort() { this.aborted = true; }
    };
    window.webkitSpeechRecognition = undefined;
  }, { enabled, recognition, locale });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/speech-followup-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body><div id="app-container"><div id="root"></div></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module" src="/speech-followup-harness.js"></script></body></html>` }));
  await page.route('**/speech-followup-harness.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { LanguageProvider } from '/src/i18n/i18nContext.jsx';
    import { StudyView } from '/src/components/study/StudyView.jsx';
    import { useUiStore } from '/src/store/useUiStore.js';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import { useSessionStore } from '/src/store/useSessionStore.js';
    import { useSettingsStore } from '/src/store/useSettingsStore.js';
    import '/src/index.css';
    import '/src/App.css';
    const card = ${JSON.stringify({ id: 81, deck_id: 1, queue: 'new', ...fixtures[type], ...(requiredActions ? { requiredActions } : {}) })};
    const deck = { id: 1, name: 'Speech MVP', target_language: 'de', stats: { total: 2, new: 2 } };
    useSettingsStore.setState({ studyMode: 'classic', autoPlay: false, cardTextColor: '#fed7aa', cardFont: 'Georgia' });
    useDeckStore.setState({ currentDeck: deck, deckCards: [card, { ...card, id: 82 }] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.setState({ view: 'study', loading: false });
    window.nextSpeechReview = () => useSessionStore.setState(state => ({
      card: { ...state.card, id: state.card.id + 1 }, historyIndex: state.historyIndex + 1, isFlipped: false,
    }));
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider, null,
      React.createElement(StudyView)));
  ` }));
  await page.goto('/speech-followup-harness');
  await expect(page.locator('.study-voice-followup-toggle')).toBeVisible();
  return errors;
}

async function answer(page, type = 'puzzle', wrong = false) {
  if (type === 'puzzle') {
    for (const word of ['Ich', 'lerne', 'Deutsch.']) {
      await page.locator('.btn-puzzle-chip').filter({ hasText: new RegExp('^' + word.replace('.', '\\.') + '$') }).click();
    }
    await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  } else if (type === 'trainer') {
    await page.getByRole('textbox', { name: 'Пропуск 1' }).fill(wrong ? 'falsch' : 'lerne');
    await page.getByRole('button', { name: 'Проверить ответы', exact: true }).click();
  } else {
    await page.locator('.word-bank-option').filter({ hasText: wrong ? 'lernst' : /^lerne$/ }).click();
    await page.locator('.word-bank-check').click();
  }
}

for (const type of ['puzzle', 'trainer', 'wordbank']) {
  test(type + ': answer → automatic microphone → wrong speech → retry → grade', async ({ page, context }) => {
    const errors = await setup(page, context, { type });
    await expect(page.locator('.btn-grade').first()).toBeDisabled();
    if (type === 'trainer') {
      await answer(page, type, true);
      await expect(page.locator('.speak-target-text')).toHaveCount(0);
      await expect(page.locator('.btn-grade').first()).toBeDisabled();
    }
    await answer(page, type);
    await expect(page.locator('.speak-target-text')).toHaveText('Ich lerne Deutsch.');
    await expect(page.locator('.btn-speak-mic')).toHaveClass(/listening/);
    expect(await page.evaluate(() => window.recognitionStarts)).toBe(1);
    await page.evaluate(() => window.testRecognition.onresult({ results: [[{ transcript: 'falsche Antwort' }]] }));
    await page.locator('.btn-speak-mic').click();
    await expect(page.locator('.btn-grade').first()).toBeDisabled();
    await page.locator('.btn-speak-mic').click();
    await page.evaluate(() => window.testRecognition.onresult({ results: [[{ transcript: 'Ich lerne Deutsch' }]] }));
    await expect(page.locator('.btn-grade').first()).toBeEnabled();
    const gradeRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/study/grade');
    await page.locator('.btn-grade.grade-2').click();
    expect((await gradeRequest).postDataJSON()).toMatchObject({ card_id: 81, grade: 2, return_next: false });
    await expect.poll(() => page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().card.id)).toBe(82);
    await expect(page.locator('.speak-target-text')).toHaveCount(0);
    await expect(page.locator('.btn-grade').first()).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

for (const recognition of ['unsupported', 'denied', 'failed']) {
  test(recognition + ': microphone error permits skip and next review', async ({ page, context }) => {
    const errors = await setup(page, context, { recognition });
    await answer(page);
    await expect(page.locator('.speech-error-badge')).toBeVisible();
    await expect(page.locator('.btn-grade').first()).toBeDisabled();
    await page.locator('.speech-followup-skip').click();
    await expect(page.locator('.btn-grade').first()).toBeEnabled();
    const gradeRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/study/grade');
    await page.locator('.btn-grade.grade-2').click();
    expect((await gradeRequest).postDataJSON()).toMatchObject({ card_id: 81, grade: 2 });
    await expect(page.locator('.btn-grade').first()).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

test('toggle is persisted, syncs with user settings and applies on the next review', async ({ page, context }) => {
  await setup(page, context, { enabled: false });
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
  await page.locator('.study-voice-followup-toggle input').check();
  expect(await page.evaluate(() => localStorage.getItem('lerne_speech_followup_enabled'))).toBe('true');
  expect(await page.evaluate(async () => {
    const { collectUserSettings, useSettingsStore } = await import('/src/store/useSettingsStore.js');
    return collectUserSettings(useSettingsStore.getState()).speechFollowupEnabled;
  })).toBe(true);
  await answer(page);
  await expect(page.locator('.speak-target-text')).toHaveCount(0);
  await page.evaluate(() => window.nextSpeechReview());
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await answer(page);
  await page.locator('.study-voice-followup-toggle input').uncheck();
  await expect(page.locator('.speak-target-text')).toBeVisible();
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.locator('.speech-followup-skip').click();
  await page.reload();
  await expect(page.locator('.study-voice-followup-toggle input')).not.toBeChecked();
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().syncUserSettingsFromServer({ speechFollowupEnabled: true });
  });
  await expect(page.locator('.study-voice-followup-toggle input')).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('lerne_speech_followup_enabled'))).toBe('true');
});

test('manual navigation retires microphone events; autoplay suspends speech', async ({ page, context }) => {
  const errors = await setup(page, context);
  await answer(page);
  await page.evaluate(() => { window.retiredRecognition = window.testRecognition; });
  // Suppress only the unrelated infinite arrow animation so Playwright can click it.
  await page.addStyleTag({ content: '.nav-arrow-btn { animation: none !important; }' });
  await page.getByRole('button', { name: 'Следующая карточка', exact: true }).click();
  await expect(page.locator('.speak-target-text')).toHaveCount(0);
  expect(await page.evaluate(() => window.retiredRecognition.aborted && !window.retiredRecognition.onresult)).toBe(true);
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await answer(page);
  await expect(page.locator('.btn-speak-mic')).toHaveClass(/listening/);
  await page.evaluate(() => { window.autoplayRecognition = window.testRecognition; });
  await page.evaluate(async () => {
    (await import('/src/store/useSessionStore.js')).useSessionStore.setState({ autoplayState: 'paused' });
  });
  await expect(page.locator('.study-voice-followup-toggle input')).toBeDisabled();
  await expect(page.locator('.speak-target-text')).toHaveCount(0);
  expect(await page.evaluate(() => window.recognitionStarts)).toBe(2);
  expect(await page.evaluate(() => window.autoplayRecognition.aborted && !window.autoplayRecognition.onresult)).toBe(true);
  expect(errors).toEqual([]);
});

test('explicit required actions retain precedence', async ({ page, context }) => {
  await setup(page, context, { requiredActions: ['answer'] });
  await answer(page);
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
  await expect(page.locator('.speak-target-text')).toHaveCount(0);
  expect(await page.evaluate(() => window.recognitionStarts)).toBe(0);
});

test('speech UI keeps card appearance, touch targets and responsive layout in three locales', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context);
  await answer(page);
  for (const locale of ['ru', 'en', 'uk']) {
    await page.evaluate(async language => (await import('/src/i18n/locale.js')).setInterfaceLanguage(language), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 1100 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const target = page.locator('.speak-target-text');
      await expect(target).toHaveCSS('color', 'rgb(254, 215, 170)');
      await expect(target).toHaveCSS('font-family', 'Georgia');
      for (const selector of ['.speech-followup-skip', '.btn-speak-mic', '.speech-followup-threshold .btn-threshold-pill']) {
        const bounds = await page.locator(selector).first().boundingBox();
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.width).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath('speech-' + locale + '-' + width + '.png'), fullPage: true });
    }
  }
  await expect(page.locator('.speech-followup-skip')).toHaveText('Пропустити усну частину');
  expect(errors).toEqual([]);
});
