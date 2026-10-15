const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'project_docs/examples/structured_cards_v2', name), 'utf8'));
const hostile = '<img src=x onerror="window.v2Xss=1"><script>window.v2Xss=1</script>';
let server;

test.beforeAll(async () => {
  const python = process.platform === 'win32' ? path.join(root, 'venv/Scripts/python.exe') : 'python';
  server = spawn(python, ['-m', 'uvicorn', 'scripts.tests.structured_preview_server:app', '--host', '127.0.0.1', '--port', '8051'], { cwd: root, stdio: 'ignore' });
  await expect.poll(async () => {
    try { return (await fetch('http://127.0.0.1:8051/')).status; } catch { return 0; }
  }, { timeout: 15000 }).toBe(200);
});
test.afterAll(() => server?.kill());

async function openPreview(page) {
  let html = fs.readFileSync(path.join(root, 'tools/admin/static/index.html'), 'utf8');
  html = html.replace(/<script src="\/static\/js\/(?!state\.js|api\.js|author\.js)[^"]+"><\/script>/g, '');
  await page.route('http://127.0.0.1:8051/', route => route.fulfill({ contentType: 'text/html', body: html }));
  // Only the actual preview endpoint is reachable in the isolated fixture.
  await page.goto('http://127.0.0.1:8051/');
  await page.evaluate(() => {
    document.querySelectorAll('main > section').forEach(e => e.classList.add('hidden'));
    document.getElementById('content-author').classList.remove('hidden');
  });
  await page.getByRole('button', { name: 'JSON V2 · Preview' }).click();
  await expect(page.locator('#author-v2-status')).toContainText('Выберите файл');
}

async function upload(page, document, name = 'lesson.json') {
  await page.locator('#author-v2-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof document === 'string' ? document : JSON.stringify(document)) });
  await expect(page.locator('#author-v2-file')).toBeEnabled();
}

test('actual upload previews all types, escapes content and never enters a write flow', async ({ page }, testInfo) => {
  const pageErrors = [];
  const writes = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST') writes.push(new URL(request.url()).pathname);
  });
  await openPreview(page);
  const document = fixture('basics.json');
  document.cards.push(...fixture('other_types.json').cards);
  document.deck.name += hostile;
  document.deck.passport.intro.goal = hostile;
  document.cards[0].data.text += hostile;
  document.cards[0].explanation = hostile;
  document.cards[1].data.answer = hostile;
  document.cards.find(c => c.type === 'quiz').data.options[0].text = hostile;
  document.cards.find(c => c.type === 'free_text').data.accepted_answers = ['Ein anderer Text.'];
  await upload(page, document);
  await expect(page.locator('[data-v2-card]')).toHaveCount(document.cards.length);
  await expect(page.locator('#author-v2-status')).toContainText('V2 валиден');
  const card = type => page.locator('[data-v2-card]').filter({ has: page.locator('h4', { hasText: `· ${type}` }) });
  await expect(card('quiz').getByText('✓ Правильный ответ')).toHaveCount(2);
  await expect(card('word_bank')).toContainText('habe (вариант №1)');
  await expect(card('puzzle')).toContainText('Правильный порядок');
  await expect(card('match')).toContainText('essen → gegessen');
  await expect(card('free_text')).toContainText('Пример ответа (не точный ключ)');
  await expect(card('free_text')).toContainText('Ein anderer Text.');
  await expect(page.getByText('Legacy-преобразование этого типа пока не реализовано. Это не ошибка карточки V2.', { exact: true })).toHaveCount(5);
  await page.locator('[data-v2-card="0"] summary').first().click();
  await expect(page.locator('[data-v2-card="0"]')).toContainText('front');
  await expect(page.locator('[data-v2-card="0"]')).toContainText(hostile);
  await expect(page.locator('#author-v2-result img, #author-v2-result script')).toHaveCount(0);
  expect(await page.evaluate(() => window.v2Xss)).toBeUndefined();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#content-author').screenshot({ path: testInfo.outputPath('v2-desktop.png') });
  await page.locator('[data-v2-card="0"]').screenshot({ path: testInfo.outputPath('v2-theory-desktop.png') });
  for (const width of [320, 375, 430, 768]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.locator('#content-author').evaluate(e => [e.scrollWidth, e.clientWidth]);
    expect(dimensions[0], `author overflow at ${width}`).toBeLessThanOrEqual(dimensions[1] + 1);
    await page.locator('#content-author').screenshot({ path: testInfo.outputPath(`v2-${width}.png`) });
    if (width === 375) await card('quiz').screenshot({ path: testInfo.outputPath('v2-quiz-375.png') });
  }
  await page.getByRole('button', { name: 'Публикация', exact: true }).click();
  await expect(page.locator('#author-publish-dropzone')).toBeVisible();
  await expect(page.locator('#author-publish-result-wrap')).toBeHidden();
  expect(await page.evaluate(() => authorState.publish.parseResult)).toBeNull();
  expect(await page.evaluate(() => authorState.update.previewResult)).toBeNull();
  expect(writes).toEqual(['/api/admin/author/v2-preview']);
  expect(pageErrors).toEqual([]);
});

test('field errors, JSON syntax and conversion limits are reviewable; retry clears stale preview', async ({ page }, testInfo) => {
  await openPreview(page);
  const document = fixture('basics.json');
  document.cards[1].data.answer = '';
  await upload(page, document);
  await expect(page.getByRole('alert')).toContainText('Карточка №2');
  await expect(page.getByRole('alert')).toContainText('data.answer');
  await expect(page.locator('[data-v2-card]')).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.locator('#author-panel-v2').screenshot({ path: testInfo.outputPath('v2-errors-375.png') });
  await upload(page, '{');
  await expect(page.getByRole('alert')).toContainText('строка 1, столбец 2');
  document.cards[1].data.answer = 'дом';
  document.cards[1].data.prompt = '[*] Legacy collision';
  await upload(page, document);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('[data-v2-card="1"]')).toContainText('V2-карточка валидна, но legacy');
  await expect(page.locator('[data-v2-card="2"]')).toContainText('Временная legacy-проекция');
  await upload(page, '{}', 'wrong.txt');
  await expect(page.locator('#author-v2-status')).toContainText('Выберите файл .json');
  await expect(page.locator('[data-v2-card]')).toHaveCount(0);
  await upload(page, fixture('other_types.json'));
  await expect(page.locator('[data-v2-card]')).toHaveCount(5);
});

test('loading disables repeat upload; server failures allow retry', async ({ page }) => {
  await openPreview(page);
  let release;
  await page.route('**/api/admin/author/v2-preview', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ status: 503, json: { detail: hostile } });
  });
  await page.locator('#author-v2-file').setInputFiles({ name: 'lesson.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.locator('#author-v2-file')).toBeDisabled();
  await expect(page.locator('#author-v2-status')).toContainText('Проверка:');
  release();
  await expect(page.locator('#author-v2-file')).toBeEnabled();
  await expect(page.locator('#author-v2-status')).toContainText(hostile);
  await expect(page.locator('#author-v2-status img')).toHaveCount(0);
  await page.unroute('**/api/admin/author/v2-preview');
  await upload(page, fixture('basics.json'));
  await expect(page.locator('#author-v2-status')).toContainText('V2 валиден');
});
