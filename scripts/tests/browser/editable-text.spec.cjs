const { test, expect } = require('./isolated-fixture.cjs');

const realCards = require('./fixtures/editable-real-cards.json');
const original = realCards.find(card => card.id === 359618);
const source = original.front.split('@edit\n')[1];
const correction = original.back;
const card = { ...original, id: 1, deck_id: 1, position: 0, queue: 'new',
  front: original.front + '\n::source\nПеревод для проверки границ.' };

for (const width of [320, 375, 430, 768, 1280]) {
  test(`editable text correction at ${width}px`, async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await context.addInitScript(() => {
      localStorage.setItem('native_language', 'ru');
      localStorage.setItem('native_language_selected', 'true');
      localStorage.setItem('lerne_has_selected_language', 'true');
      localStorage.setItem('lerne_target_language', 'de');
    });
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/init') return route.fulfill({ json: {
        decks: [{ id: 1, name: 'Editable Text Test', target_language: 'de', is_learning: true,
          stats: { total: 1, new: 1, due: 0, learning: 0 } }],
        folders: [], settings: {}, prompts: {}, user_settings: {},
        user_info: { user_id: 1, first_name: 'Test', is_guest: false },
      } });
      if (path === '/api/decks/1/cards') return route.fulfill({ json: [card] });
      if (path === '/api/study/card/1' || path === '/api/decks/1/next') return route.fulfill({ json: card });
      if (path === '/api/cards/duplicates') return route.fulfill({ json: [] });
      if (path === '/api/ai/evaluate-answer') {
        const accepted = route.request().postDataJSON().answer === correction;
        return route.fulfill({ json: { grading_policy: { mode: 'controlled_text', max_retries: 3 },
          result: accepted
            ? { verdict: 'correct', accepted: true, evaluator: 'exact' }
            : { verdict: 'needs_retry', accepted: false, evaluator: 'ai', error_type: 'grammar',
              hint: 'Проверьте, нужно ли подлежащее после um.', explanation: 'Здесь требуется конструкция um ... zu.' },
        } });
      }
      return route.fulfill({ json: {} });
    });
    await page.goto('/?user_id=1');
    await page.getByText('Editable Text Test', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Начать занятие', exact: true }).click();
    const field = page.getByRole('textbox', { name: 'Исправленный текст' });
    await expect(field).toHaveValue(source);
    await expect(page.locator('.card-front')).not.toContainText('@edit');
    const reset = page.getByRole('button', { name: 'Сбросить изменения' });
    await expect(reset).toBeDisabled();
    await field.fill('Draft');
    await expect(page.getByText('Текст изменён', { exact: true })).toBeVisible();
    await field.press('Space');
    await expect(field).toBeVisible();
    await reset.click();
    await expect(field).toHaveValue(source);
    await expect(page.locator('.editable-text-exercise')).not.toContainText(correction);
    await expect(page.getByText('Перевод для проверки границ.')).toBeVisible();
    await field.fill(source + ' ');
    await page.getByRole('button', { name: 'Проверить ответ', exact: true }).click();
    await expect(page.getByText('Проверьте, нужно ли подлежащее после um.')).toBeVisible();
    await expect(field).toBeEnabled();
    await field.fill(correction);
    await page.getByRole('button', { name: 'Проверить ещё раз' }).click();
    await expect(page.getByText('Верно!')).toBeVisible();
    await expect(field).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`editable-text-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Перевернуть карточку' }).click();
    await expect(page.locator('.card-back')).toContainText(correction);
  });
}
