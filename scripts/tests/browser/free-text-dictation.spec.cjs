const { test, expect } = require('@playwright/test');

async function setup(page, context, { recognition = 'supported', assessmentMode = false, admin = false } = {}) {
  const errors = [];
  const answers = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(recognition => {
    localStorage.setItem('native_language', 'ru');
    window.savedDictation = {};
    window.recognitionStarts = 0;
    window.SpeechRecognition = recognition === 'unsupported' ? undefined : class {
      start() {
        window.testRecognition = this;
        window.recognitionStarts++;
        if (recognition === 'failed') throw new Error('Missing microphone');
        if (recognition === 'denied') this.onerror?.({ error: 'not-allowed' });
        else this.onstart?.();
      }
      stop() {
        if (window.finalOnStop) {
          const result = [{ transcript: window.finalOnStop }]; result.isFinal = true;
          setTimeout(() => { this.onresult?.({ results: [result] }); this.onend?.(); }, 100);
        } else if (!window.omitSpeechEnd) this.onend?.();
      }
      abort() { this.aborted = true; }
    };
    window.webkitSpeechRecognition = recognition === 'prefixed' ? window.SpeechRecognition : undefined;
    if (recognition === 'prefixed') window.SpeechRecognition = undefined;
  }, recognition);
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname === '/api/ai/evaluate-answer') {
      answers.push(route.request().postDataJSON());
      return route.fulfill({ json: { grading_policy: { max_retries: 3 }, result: {
        verdict: 'correct', accepted: true, evaluator: 'exact',
      } } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('**/dictation-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body><div id="app-container"><div id="root"></div></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module" src="/dictation-harness.js"></script></body></html>` }));
  await page.route('**/dictation-harness.js', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { StudyCardFreeText } from '/src/components/study/StudyCardFreeText.jsx';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import { useSettingsStore } from '/src/store/useSettingsStore.js';
    useSettingsStore.setState({ isAdmin: ${JSON.stringify(admin)} });
    import { applyPublishedDesignTokens } from '/src/design/designTokens.js';
    import { DEFAULT_DESIGN_CONFIG_V2 } from '/src/design/designConfig.js';
    import '/src/index.css';
    import '/src/App.css';
    applyPublishedDesignTokens(DEFAULT_DESIGN_CONFIG_V2);
    useDeckStore.setState({ currentDeck: { id: 1, target_language: 'de', review: 'review-1' } });
    window.changeReview = review => useDeckStore.setState(state => ({ currentDeck: { ...state.currentDeck, review } }));
    window.changeSpeechLanguage = language => useDeckStore.setState(state => ({ currentDeck: { ...state.currentDeck, language } }));
    function Harness() {
      const { review, language } = useDeckStore(state => state.currentDeck);
      return React.createElement('main', { className: 'study-card', style: { maxWidth: 560, margin: '24px auto', padding: 16 } },
        React.createElement(StudyCardFreeText, {
          card: { id: 81, target_language: language }, reviewKey: review,
          freeTextData: { prompt: 'Was machen Sie am Wochenende? Расскажите о ваших планах на выходные.', exampleAnswer: 'Ich besuche meinen Freund.' },
          styles: { cardTextColor: '#fed7aa', cardFont: 'Georgia', contextTextColor: '#fed7aa', contextFont: 'Georgia' },
          savedState: window.savedDictation[review],
          onSaveState: state => { window.savedDictation[review] = state; },
          onTrainerAnswer: (...args) => { window.dictationEvidence = args; },
          assessmentMode: ${JSON.stringify(assessmentMode)},
        }));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, React.createElement(Harness)));
  ` }));
  await page.goto('/dictation-harness');
  await expect(page.locator('textarea')).toBeVisible().catch(error => { throw new Error(error.message + '\nPage errors: ' + JSON.stringify(errors)); });
  return { errors, answers };
}

async function speak(page, chunks) {
  await page.evaluate(chunks => window.testRecognition.onresult({ results: chunks.map(transcript => [{ transcript }]) }), chunks);
}

test('dictation survives long silence, pauses, resumes, permits correction and submits manually', async ({ page, context }) => {
  const { errors, answers } = await setup(page, context);
  const input = page.locator('textarea');
  const mic = page.locator('.free-text-dictate');
  const check = page.getByRole('button', { name: 'Проверить ответ', exact: true });
  await input.fill('Am Samstag');
  await mic.click();
  expect(await page.evaluate(() => ({ lang: window.testRecognition.lang, continuous: window.testRecognition.continuous, interim: window.testRecognition.interimResults })))
    .toEqual({ lang: 'de-DE', continuous: true, interim: true });
  await speak(page, ['möchte']);
  await speak(page, ['möchte ich einkaufen', 'möchte ich einkaufen gehen.', 'gehen.']);
  await expect(input).toHaveValue('Am Samstag möchte ich einkaufen gehen.');
  await expect(page.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
  await page.clock.install();
  await page.clock.runFor(60000);
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await mic.click();
  await expect(mic).toHaveText('Продолжить');
  expect(answers).toHaveLength(0);
  await expect(input).toBeEnabled();
  await mic.click();
  await speak(page, ['Danach besuche ich mein Freund.']);
  await mic.click();
  await expect(input).toHaveValue('Am Samstag möchte ich einkaufen gehen. Danach besuche ich mein Freund.');
  const corrected = 'Am Samstag möchte ich einkaufen gehen. Danach besuche ich meinen Freund.';
  await input.fill(corrected);
  await check.click();
  await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
  expect(answers).toEqual([{ card_id: 81, answer: corrected, feedback_language: 'ru' }]);
  await expect(input).toBeDisabled();
  await expect(mic).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('typing, navigation, retry and language changes retire late recognition events and keep saved drafts', async ({ page, context }) => {
  const { errors, answers } = await setup(page, context);
  const input = page.locator('textarea');
  const mic = page.locator('.free-text-dictate');
  await mic.click();
  await speak(page, ['Ich lerne']);
  await page.evaluate(() => { window.lateResult = window.testRecognition.onresult; window.retired = window.testRecognition; });
  await input.fill('Ich lerne Deutsch.');
  await page.evaluate(() => window.lateResult({ results: [[{ transcript: 'stale overwrite' }]] }));
  await expect(input).toHaveValue('Ich lerne Deutsch.');
  expect(await page.evaluate(() => window.retired.aborted && !window.retired.onresult)).toBe(true);
  await mic.click();
  await speak(page, ['jeden Tag.']);
  await expect(input).toHaveValue('Ich lerne Deutsch. jeden Tag.');
  await expect.poll(() => page.evaluate(() => window.savedDictation['review-1'].userInput)).toBe('Ich lerne Deutsch. jeden Tag.');
  await page.evaluate(() => { window.lateResult = window.testRecognition.onresult; window.retired = window.testRecognition; window.changeReview('review-2'); });
  await expect(input).toHaveValue('');
  await page.evaluate(() => window.lateResult({ results: [[{ transcript: 'old review' }]] }));
  await expect(input).toHaveValue('');
  expect(await page.evaluate(() => window.retired.aborted && !window.retired.onresult)).toBe(true);
  await page.evaluate(() => window.changeReview('review-1'));
  await expect(input).toHaveValue('Ich lerne Deutsch. jeden Tag.');
  await mic.click();
  await page.evaluate(() => window.changeSpeechLanguage('en'));
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await mic.click();
  expect(await page.evaluate(() => window.testRecognition.lang)).toBe('en-US');
  await page.evaluate(() => window.testRecognition.onend());
  await expect(input).toHaveValue('Ich lerne Deutsch. jeden Tag.');
  expect(answers).toHaveLength(0);
  expect(errors).toEqual([]);
});

for (const recognition of ['unsupported', 'denied', 'failed']) {
  test(recognition + ': microphone failure preserves keyboard entry and manual evaluation', async ({ page, context }) => {
    const { errors, answers } = await setup(page, context, { recognition });
    await page.locator('textarea').fill('Mein Entwurf.');
    await page.locator('.free-text-dictate').click();
    await expect(page.locator('.free-text-dictation-help')).toContainText(
      recognition === 'unsupported' ? 'не поддерживает' : recognition === 'denied' ? 'Нет доступа' : 'Ошибка при запуске');
    await expect(page.locator('.free-text-dictate')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('textarea')).toHaveValue('Mein Entwurf.');
    expect(answers).toHaveLength(0);
    await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
    await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
    expect(answers).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

test('recognition errors allow retry, cancel old timers and respect the answer length limit', async ({ page, context }) => {
  const { errors, answers } = await setup(page, context);
  const mic = page.locator('.free-text-dictate');
  await page.locator('textarea').fill('a'.repeat(3990));
  await mic.click();
  await speak(page, ['Ich möchte Deutsch lernen.']);
  await expect.poll(() => page.locator('textarea').inputValue().then(value => value.length)).toBe(4000);
  await page.evaluate(() => window.testRecognition.onerror({ error: 'network' }));
  await expect(page.locator('.free-text-dictation-help')).toContainText('Ошибка распознавания');
  await mic.click();
  await expect(page.locator('.free-text-dictation-help')).toContainText('Слушаю');
  await page.evaluate(() => window.testRecognition.onerror({ error: 'no-speech' }));
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.testRecognition.onend());
  expect(answers).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('dictation keeps the assessment single-submit contract', async ({ page, context }) => {
  const { answers } = await setup(page, context, { assessmentMode: true });
  await page.locator('.free-text-dictate').click();
  await speak(page, ['Ich besuche meinen Freund.']);
  await page.locator('.free-text-dictate').click();
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.locator('textarea')).toBeDisabled();
  await expect(page.locator('.free-text-dictate')).toHaveCount(0);
  expect(answers).toHaveLength(1);
  expect(await page.evaluate(() => window.dictationEvidence[1])).toMatchObject({ completed: true, attemptCount: 1 });
});

test('dictation controls wrap, keep touch targets and localize at study viewports', async ({ page, context }, testInfo) => {
  const { errors } = await setup(page, context);
  await page.locator('textarea').fill('Am Samstag möchte ich einkaufen gehen. Danach besuche ich meinen Freund.');
  for (const locale of ['ru', 'en', 'uk']) {
    await page.evaluate(async locale => (await import('/src/i18n/locale.js')).setInterfaceLanguage(locale), locale);
    for (const width of [320, 375, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const bounds = await page.locator('.free-text-dictate').boundingBox();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator('.free-text-prompt')).toHaveCSS('color', 'rgb(254, 215, 170)');
      await expect(page.locator('.free-text-prompt')).toHaveCSS('font-family', 'Georgia');
      await page.screenshot({ path: testInfo.outputPath('dictation-' + locale + '-' + width + '.png'), fullPage: true });
    }
    await page.locator('textarea').fill('Am Samstag möchte ich einkaufen gehen.');
    await page.locator('.free-text-dictate').click();
    await page.screenshot({ path: testInfo.outputPath('listening-' + locale + '.png'), fullPage: true });
    await page.locator('.free-text-dictate').click();
  }
  await expect(page.locator('.free-text-dictate')).toHaveText('Продовжити');
  expect(errors).toEqual([]);
});

for (const recognition of ['supported', 'prefixed']) {
  test(recognition + ': browser end restarts safely, accumulates snapshots and bounds empty restart loops', async ({ page, context }) => {
    const { answers, errors } = await setup(page, context, { recognition });
    await page.clock.install();
    const input = page.locator('textarea');
    const mic = page.locator('.free-text-dictate');
    await mic.click();
    await speak(page, ['Ich möchte']);
    await speak(page, ['Ich möchte Deutsch lernen.']);
    await page.evaluate(() => { window.oldResult = window.testRecognition.onresult; window.testRecognition.onend(); });
    await page.clock.runFor(300);
    expect(await page.evaluate(() => window.recognitionStarts)).toBe(2);
    // A mobile engine replays the preceding session, then revises the same result.
    await speak(page, ['Ich möchte Deutsch lernen. Jeden Tag']);
    await speak(page, ['Ich möchte Deutsch lernen. Jeden Tag eine Stunde.']);
    await page.evaluate(() => window.oldResult({ results: [[{ transcript: 'stale' }]] }));
    await expect(input).toHaveValue('Ich möchte Deutsch lernen. Jeden Tag eine Stunde.');
    await page.evaluate(() => window.testRecognition.onend());
    await page.clock.runFor(300);
    await speak(page, ['Danach lese ich.']);
    await expect(input).toHaveValue('Ich möchte Deutsch lernen. Jeden Tag eine Stunde. Danach lese ich.');
    await mic.click();
    await page.clock.runFor(60000);
    const starts = await page.evaluate(() => window.recognitionStarts);
    await expect(mic).toHaveText('Продолжить');
    await mic.click();
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.testRecognition.onend());
      await page.clock.runFor(4500);
    }
    await expect(mic).toHaveText('Продолжить');
    await expect(page.locator('.free-text-dictation-help')).toContainText('приостановлено браузером');
    const bounded = await page.evaluate(() => window.recognitionStarts);
    await page.clock.runFor(60000);
    expect(await page.evaluate(() => window.recognitionStarts)).toBe(bounded);
    expect(bounded - starts).toBe(5);
    expect(answers).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

test('submit waits for final recognition, prevents duplicates and uses the final text', async ({ page, context }) => {
  const { answers } = await setup(page, context);
  await page.locator('textarea').fill('Am Samstag');
  await page.locator('.free-text-dictate').click();
  await speak(page, ['möchte ich']);
  await page.evaluate(() => { window.finalOnStop = 'möchte ich Deutsch lernen.'; });
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await page.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
  expect(answers.map(answer => answer.answer)).toEqual(['Am Samstag möchte ich Deutsch lernen.']);
  expect(await page.evaluate(() => window.savedDictation['review-1'].evaluationState.attemptCount)).toBe(1);
});

test('missing end uses bounded flush; navigation while flushing prevents stale submit', async ({ page, context }) => {
  const { answers } = await setup(page, context);
  await page.clock.install();
  const mic = page.locator('.free-text-dictate');
  await mic.click();
  await speak(page, ['Mein Entwurf.']);
  await page.evaluate(() => { window.omitSpeechEnd = true; });
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await page.evaluate(() => window.changeReview('review-2'));
  await page.clock.runFor(3000);
  expect(answers).toHaveLength(0);
  await expect(page.locator('textarea')).toHaveValue('');
  await mic.click();
  await speak(page, ['Ein neuer Entwurf.']);
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await page.clock.runFor(2100);
  await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
  expect(answers.map(answer => answer.answer)).toEqual(['Ein neuer Entwurf.']);
});

test('permission denial never restarts, including late end events', async ({ page, context }) => {
  await setup(page, context);
  await page.clock.install();
  await page.locator('.free-text-dictate').click();
  await page.evaluate(() => {
    const end = window.testRecognition.onend;
    window.testRecognition.onerror({ error: 'not-allowed' });
    end();
  });
  await page.clock.runFor(120000);
  expect(await page.evaluate(() => window.recognitionStarts)).toBe(1);
  await expect(page.locator('.free-text-dictation-help')).toContainText('Нет доступа');
});

test('admin diagnostics shows the actual response only on request and never saves it with progress', async ({ page, context }) => {
  await setup(page, context, { admin: true });
  await page.route('**/api/ai/evaluate-answer', route => {
    expect(route.request().postDataJSON().diagnostics).toBe(true);
    return route.fulfill({ json: { result: { verdict: 'unavailable', accepted: false, error_code: 'evaluator.low_confidence' },
      diagnostics: { ai_called: true, provider: 'google', model: 'gemini-test', requests: [
        { system_prompt: 'ACTUAL SYSTEM', user_message: JSON.stringify({ expected_answers: ['PRIVATE REFERENCE'], user_answer: 'Entwurf' }) }
      ], result: { verdict: 'unavailable' } } } });
  });
  await page.getByRole('checkbox').check();
  await page.locator('textarea').fill('Entwurf');
  await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
  await page.getByText('Фактический запрос и результат проверки').click();
  await expect(page.locator('.free-text-diagnostics pre')).toContainText('ACTUAL SYSTEM');
  await expect(page.locator('.free-text-diagnostics pre')).toContainText('PRIVATE REFERENCE');
  expect(await page.evaluate(() => JSON.stringify(window.savedDictation))).not.toContain('PRIVATE REFERENCE');
  await page.evaluate(() => window.changeReview('review-2'));
  await expect(page.locator('.free-text-diagnostics pre')).toHaveCount(0);
});

test('learner gets safe reason and retries without an educational attempt or diagnostic disclosure', async ({ page, context }) => {
  const { answers } = await setup(page, context);
  let calls = 0;
  await page.route('**/api/ai/evaluate-answer', route => {
    calls++;
    expect(route.request().postDataJSON().diagnostics).toBeUndefined();
    return route.fulfill({ json: { result: calls === 1 ? {
      verdict: 'unavailable', accepted: false, error_code: 'evaluator.rate_limited',
    } : { verdict: 'correct', accepted: true, evaluator: 'ai' } } });
  });
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.locator('textarea').fill('Mein Entwurf.');
  await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
  await expect(page.locator('.free-text-feedback')).toContainText('временно перегружен');
  expect(await page.evaluate(() => window.savedDictation['review-1'].evaluationState.attemptCount)).toBe(0);
  await expect(page.getByRole('button', { name: 'Показать пример ответа' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Проверить ещё раз', exact: true }).click();
  await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.savedDictation['review-1'].evaluationState.attemptCount)).toBe(1);
  expect(calls).toBe(2);
  expect(answers).toHaveLength(0);
});
