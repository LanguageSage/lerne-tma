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
});
