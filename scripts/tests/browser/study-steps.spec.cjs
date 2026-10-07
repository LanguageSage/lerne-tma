const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Steps', target_language: 'de', stats: { total: 1, new: 1 } };
const quiz = { id: 12, deck_id: 1, queue: 'new', front: 'Choose\n\n- Wrong\n* Ich lerne Deutsch', back: 'Quiz' };

async function setup(page, context, requiredActions) {
  const errors = [];
  const diagnostics = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
    window.SpeechRecognition = class {
      start() { window.testRecognition = this; this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() {}
    };
  });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/study-steps-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body><div id="app-container"><div id="root"></div></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module" src="/study-steps-harness.js"></script></body></html>` }));
  await page.route('**/study-steps-harness.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { LanguageProvider } from '/src/i18n/i18nContext.jsx';
    import { StudyView } from '/src/components/study/StudyView.jsx';
    import { StudyCardSpeech } from '/src/components/study/StudyCardSpeech.jsx';
    import { useUiStore } from '/src/store/useUiStore.js';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import { useSessionStore } from '/src/store/useSessionStore.js';
    import { useSettingsStore } from '/src/store/useSettingsStore.js';
    import '/src/index.css';
    import '/src/App.css';
    const deck = ${JSON.stringify(deck)};
    const card = ${JSON.stringify({ ...quiz, ...(requiredActions ? { requiredActions } : {}) })};
    useSettingsStore.setState({ studyMode: 'classic', autoPlay: false, cardTextColor: '#fed7aa', cardFont: 'Georgia' });
    useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    useSessionStore.setState({ card, studyHistory: [card], historyIndex: 0, isFlipped: false });
    useUiStore.setState({ view: 'study', loading: false });
    function renderRequiredAction({ card, stepFlow, audioControls, styles }) {
      window.capturedStep = stepFlow.currentStep;
      window.capturedComplete = stepFlow.completeStep;
      if (stepFlow.currentStep.action !== 'speak') return null;
      return React.createElement(StudyCardSpeech, {
        key: stepFlow.reviewKey + ':' + stepFlow.currentStep.id,
        card, targetText: 'Ich lerne Deutsch', reviewKey: stepFlow.reviewKey,
        onSuccess: stepFlow.completeStep, stopAudio: audioControls.stopAudio,
        styles, onFlip: useSessionStore.getState().setIsFlipped,
      });
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(LanguageProvider, null,
      React.createElement(StudyView, { renderRequiredAction })));
  ` }));
  await page.goto('/study-steps-harness');
  try {
    await expect(page.locator('.quiz-option-item')).toHaveCount(2);
  } catch (error) {
    throw new Error([...errors, ...diagnostics].join('\n') || error.message);
  }
  return errors;
}

async function answerQuiz(page) {
  await page.locator('.quiz-option-item').filter({ hasText: 'Ich lerne Deutsch' }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
}

test('StudyView default remains self-assessed; exercise answer preserves grading', async ({ page, context }) => {
  const errors = await setup(page, context);
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
  await answerQuiz(page);
  await expect(page.locator('.quiz-option-item.correct')).toHaveCount(1);
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
  expect(errors).toEqual([]);
});

test('quiz → injected speech renderer → finish, flip and review reset', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context, ['answer', 'speak']);
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await answerQuiz(page);
  await expect(page.locator('.speak-target-text')).toHaveText('Ich lerne Deutsch');
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  // Flip/remount must not discard answer completion or reveal an enabled grade.
  await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().setIsFlipped(true));
  await expect(page.locator('.card-back')).toBeVisible();
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().setIsFlipped(false));
  await expect(page.locator('.btn-speak-mic')).toBeVisible();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('speak-step-' + width + '.png'), fullPage: true });
  }
  await page.locator('.btn-speak-mic').click();
  await page.evaluate(() => window.testRecognition.onresult({ results: [[{ transcript: 'falsche Antwort' }]] }));
  await page.locator('.btn-speak-mic').click();
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.locator('.btn-speak-mic').click();
  await page.evaluate(() => window.testRecognition.onresult({ results: [[{ transcript: 'Ich lerne Deutsch' }]] }));
  await expect(page.locator('.btn-grade').first()).toBeEnabled();
  // Captured old completion cannot finish a new review of the same card.
  await page.evaluate(async () => {
    const session = (await import('/src/store/useSessionStore.js')).useSessionStore;
    session.setState({ historyIndex: 1 });
  });
  await expect(page.locator('.quiz-option-item')).toHaveCount(2);
  await page.evaluate(() => window.capturedComplete({ success: true }));
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await answerQuiz(page);
  await expect(page.locator('.btn-speak-mic')).toBeVisible();
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await page.evaluate(async () => {
    window.retiredComplete = window.capturedComplete;
    const session = (await import('/src/store/useSessionStore.js')).useSessionStore.getState();
    window.originalCard = session.card;
    session.setCard({ ...session.card, id: 99 });
  });
  await expect(page.locator('.quiz-option-item')).toHaveCount(2);
  await page.evaluate(async () => (await import('/src/store/useSessionStore.js')).useSessionStore.getState().setCard(window.originalCard));
  await expect(page.locator('.quiz-option-item')).toHaveCount(2);
  await page.evaluate(() => window.retiredComplete({ success: true }));
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  await answerQuiz(page);
  await expect(page.locator('.btn-speak-mic')).toBeVisible();
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  expect(errors).toEqual([]);
});

test('unknown action blocks grade after a correct answer', async ({ page, context }) => {
  const errors = await setup(page, context, ['answer', 'future-action']);
  await answerQuiz(page);
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  expect(await page.evaluate(() => window.capturedStep.action)).toBe('future-action');
  await page.evaluate(() => window.capturedComplete());
  await expect(page.locator('.btn-grade').first()).toBeDisabled();
  expect(errors).toEqual([]);
});
