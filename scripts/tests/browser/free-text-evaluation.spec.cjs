const { test, expect } = require('@playwright/test');

const deck = { id: 1, name: 'Free Text Test', target_language: 'de', is_learning: true,
  stats: { total: 1, new: 1, due: 0, learning: 0 } };
const card = { id: 1, deck_id: 1, position: 0, queue: 'new', card_type: 'free_text',
  front: '@free\nПереведите: У меня есть собака.', back: 'Ich habe einen Hund.' };
const policy = { mode: 'controlled_text', max_retries: 3 };

async function openExercise(page, context, language = 'ru') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(language => {
    localStorage.setItem('native_language', language);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
  }, language);
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/init') return route.fulfill({ json: {
      decks: [deck], folders: [], settings: {}, prompts: {}, user_settings: {},
      user_info: { user_id: 1, first_name: 'Test', is_guest: false },
    } });
    if (pathname === '/api/decks/1/cards') return route.fulfill({ json: [card] });
    if (pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/study/card/1' || pathname === '/api/decks/1/next') return route.fulfill({ json: card });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: { user_id: 1, is_guest: false } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await page.getByText(deck.name, { exact: true }).first().click();
  await page.getByText('Переведите: У меня есть собака.', { exact: true }).first().click();
  await expect(page.locator('.free-text-exercise textarea')).toBeVisible();
  return errors;
}

for (const failure of ['default', 'throw', 'reject', 'invalid']) {
  test(`first hook submit handles ${failure} evaluator without escaping or counting`, async ({ page }) => {
    const errors = [];
    let evaluatorLoads = 0;
    let navigations = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.route('**/src/services/answerEvaluationService.js*', route => {
      evaluatorLoads++;
      return route.fulfill({ contentType: 'application/javascript', body: `
        export function evaluateFreeTextAnswer() {
          if (window.failEvaluation) return Promise.reject(new Error('evaluator unavailable'));
          return Promise.resolve({ result: { verdict: 'accepted_minor', accepted: true, error_type: 'typo' } });
        }
      ` });
    });
    await page.route('**/__free-evaluation-hook', route => route.fulfill({ contentType: 'text/html', body: `
      <div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { useFreeTextEvaluation } from '/src/hooks/useFreeTextEvaluation.js';
      window.failEvaluation = true;
      window.addEventListener('vite:preloadError', event => { event.preventDefault(); location.reload(); });
      const failure = ${JSON.stringify(failure)};
      function Probe() {
        const custom = failure === 'default' ? null : failure === 'invalid' ? {} : () => {
          if (window.failEvaluation) {
            if (failure === 'throw') throw new Error('initialization failed');
            return Promise.reject(new Error('provider failed'));
          }
          return Promise.resolve({ result: { verdict: 'accepted_minor', accepted: true, error_type: 'typo' } });
        };
        const { state, submit, evidence } = useFreeTextEvaluation(1, undefined, 'review-1', custom);
        return React.createElement('div', null,
          React.createElement('button', { onClick: async () => {
            try { window.outcome = await submit('main Nachbar ist ruhig'); }
            catch (error) { window.escaped = error.message; }
          } }, 'Submit'),
          React.createElement('pre', { id: 'state' }, JSON.stringify({ state, evidence })));
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Probe));
      </script>` }));
    await page.goto('/__free-evaluation-hook');
    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
    // Static loading finishes before the first submit, so a stale chunk cannot reload it.
    expect(evaluatorLoads).toBe(1);
    await page.route('**/src/services/answerEvaluationService.js*', route => route.abort());
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect.poll(async () => JSON.parse(await page.locator('#state').textContent()).state.result?.verdict).toBe('unavailable');
    const { state, evidence } = JSON.parse(await page.locator('#state').textContent());
    expect(state).toMatchObject({ attemptCount: 0, mistakeCount: 0, loading: false, lastAnswer: null });
    expect(evidence).toBeNull();
    expect(await page.evaluate(() => window.escaped)).toBeUndefined();
    expect(navigations).toBe(1);
    if (failure !== 'invalid') {
      await page.evaluate(() => { window.failEvaluation = false; });
      await page.getByRole('button', { name: 'Submit' }).click();
      await expect.poll(async () => JSON.parse(await page.locator('#state').textContent()).evidence?.attemptCount).toBe(1);
      expect(JSON.parse(await page.locator('#state').textContent()).evidence).toMatchObject({ isFirstTry: true, mistakeCount: 0 });
    }
    expect(errors).toEqual([]);
  });
}

test('grammar retry preserves text, blocks duplicate submits, and completes on correction', async ({ page, context }, testInfo) => {
  const errors = await openExercise(page, context);
  let calls = 0;
  let finish;
  await page.route('**/api/ai/evaluate-answer', async route => {
    calls++;
    const { answer } = route.request().postDataJSON();
    if (answer === 'Ich habe ein Hund.') {
      await new Promise(resolve => { finish = resolve; });
      return route.fulfill({ json: { grading_policy: policy, result: {
        verdict: 'needs_retry', accepted: false, error_type: 'grammar', error_code: 'grammar.article_case', evaluator: 'ai',
        hint: 'Проверь падеж артикля перед Hund.', explanation: 'После haben дополнение стоит в Akkusativ.',
      } } });
    }
    return route.fulfill({ json: { grading_policy: policy, result: { verdict: 'correct', accepted: true, evaluator: 'exact' } } });
  });
  const input = page.getByRole('textbox', { name: 'Ваш ответ' });
  await input.fill('Ich habe ein Hund.');
  await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Проверяем ответ…' })).toBeDisabled();
  await page.locator('.free-text-exercise').evaluate(form => form.requestSubmit());
  await page.screenshot({ path: testInfo.outputPath('loading.png'), fullPage: true });
  expect(calls).toBe(1);
  finish();
  await expect(page.getByText('Проверь падеж артикля перед Hund.')).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue('Ich habe ein Hund.');
  await expect(page.getByRole('button', { name: 'Показать пример ответа' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Перевернуть карточку' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Проверить ещё раз' })).toBeDisabled();
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`retry-${width}.png`), fullPage: true });
  }
  await input.fill('Ich habe einen Hund.');
  await page.getByRole('button', { name: 'Проверить ещё раз' }).click();
  await expect(page.getByText('Верно!', { exact: true })).toBeVisible();
  await expect(input).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Перевернуть карточку' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('success.png'), fullPage: true });
  expect(calls).toBe(2);
  expect(errors).toEqual([]);
});

test('unavailable preserves input and permits retry; minor acceptance is successful in English', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 844 });
  const errors = await openExercise(page, context, 'en');
  let calls = 0;
  await page.route('**/api/ai/evaluate-answer', route => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    return route.fulfill({ json: { grading_policy: policy, result: {
      verdict: 'accepted_minor', accepted: true, error_type: 'typo', evaluator: 'rules', corrected_answer: card.back,
    } } });
  });
  const input = page.getByRole('textbox', { name: 'Your answer' });
  await input.fill('Ich habe einen Hudn.');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByText('Could not check your answer. Try again — this attempt was not counted.')).toBeVisible();
  await expect(input).toHaveValue('Ich habe einen Hudn.');
  await expect(input).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('unavailable-en.png'), fullPage: true });
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText('Correct. A small typo.')).toBeVisible();
  await expect(input).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('minor-en.png'), fullPage: true });
  expect(calls).toBe(2);
  expect(errors).toEqual([]);
});

test('example answer becomes available only after configured unsuccessful attempts', async ({ page, context }) => {
  await openExercise(page, context);
  await page.route('**/api/ai/evaluate-answer', route => route.fulfill({ json: {
    grading_policy: { ...policy, max_retries: 2 }, result: {
      verdict: 'incorrect', accepted: false, evaluator: 'ai', error_type: 'meaning', hint: 'Проверь значение глагола.',
    },
  } }));
  const input = page.getByRole('textbox', { name: 'Ваш ответ' });
  await input.fill('Ich sehe einen Hund.');
  await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Показать пример ответа' })).toHaveCount(0);
  await input.fill('Ich liebe einen Hund.');
  await page.getByRole('button', { name: 'Проверить ещё раз' }).click();
  await page.getByRole('button', { name: 'Показать пример ответа' }).click();
  await expect(page.locator('.free-text-example')).toContainText(card.back);
  await expect(input).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Перевернуть карточку' })).toBeVisible();
});

