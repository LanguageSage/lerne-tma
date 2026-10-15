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
  await expect(page.getByText('Legacy-преобразование этого типа пока не реализовано. Это не ошибка карточки V2.', { exact: true })).toHaveCount(2);
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

test('Match preview separates ordered legacy pairs from valid but unrepresentable V2', async ({ page }, testInfo) => {
  await openPreview(page);
  const document = fixture('match.json');
  await upload(page, document);
  const card = page.locator('[data-v2-card="0"]');
  await expect(card).toContainText('kommen → sein');
  await expect(card).toContainText('lesen → haben');
  await expect(card).not.toContainText('пока не реализовано');
  await card.getByText('Временная legacy-проекция · только просмотр', { exact: true }).click();
  const projection = JSON.parse(await card.locator('details').first().locator('pre').textContent());
  const pairLines = document.cards[0].data.pairs.map(pair => `${pair.left} => ${pair.right}`).join('\n');
  expect(projection.front.split('@match\n')[1]).toBe(pairLines);
  expect(projection.back).toBe(pairLines);
  expect(projection.card_type).toBe('match');
  expect(projection.source_id).toBe(document.cards[0].id);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.screenshot({ path: testInfo.outputPath('match-legacy-desktop.png') });
  await page.setViewportSize({ width: 375, height: 900 });
  await card.screenshot({ path: testInfo.outputPath('match-legacy-375.png') });
  const dimensions = await card.evaluate(e => [e.scrollWidth, e.clientWidth]);
  expect(dimensions[0]).toBeLessThanOrEqual(dimensions[1] + 1);

  document.cards[0].data.pairs[1].right = hostile;
  await upload(page, document);
  await expect(page.locator('#author-v2-status')).toContainText('V2 валиден');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(card).toContainText('cards[0].data.pairs[1].right');
  await expect(card).toContainText('V2-карточка валидна, но legacy');
  await expect(card).toContainText(hostile);
  await expect(card.getByText('Временная legacy-проекция · только просмотр', { exact: true })).toHaveCount(0);
  await expect(card.locator('img, script')).toHaveCount(0);
});

test('Puzzle and single-answer Quiz project safely; multi-answer Quiz stays V2', async ({ page }, testInfo) => {
  await openPreview(page);
  const document = fixture('puzzle_quiz.json');
  const multi = JSON.parse(JSON.stringify(document.cards[1]));
  multi.id = 'multi';
  multi.data.options[0].correct = true;
  document.cards.push(multi, { type: 'puzzle', data: { tokens: ['two words'] } });
  await upload(page, document);
  await expect(page.locator('#author-v2-status')).toContainText('V2 валиден');
  const projections = [];
  for (const index of [0, 1]) {
    const card = page.locator(`[data-v2-card="${index}"]`);
    await card.getByText('Временная legacy-проекция · только просмотр', { exact: true }).click();
    projections.push(JSON.parse(await card.locator('details').first().locator('pre').textContent()));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await card.screenshot({ path: testInfo.outputPath(`puzzle-quiz-${index}-desktop.png`) });
    await page.setViewportSize({ width: 375, height: 900 });
    await card.screenshot({ path: testInfo.outputPath(`puzzle-quiz-${index}-375.png`) });
    const dimensions = await card.evaluate(e => [e.scrollWidth, e.clientWidth]);
    expect(dimensions[0]).toBeLessThanOrEqual(dimensions[1] + 1);
  }
  expect(projections[0].back).toBe(document.cards[0].data.translation);
  expect(projections[1].back).toBe('Berlin');
  await expect(page.locator('[data-v2-card="2"]')).toContainText('exactly one correct answer');
  await expect(page.locator('[data-v2-card="2"]').getByText('✓ Правильный ответ')).toHaveCount(2);
  await expect(page.locator('[data-v2-card="3"]')).toContainText('cards[3].data.tokens[0]');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Mount the existing learner components on an empty Vite page. All content
  // comes from the actual upload endpoint; no app initialization/storage/API.
  await page.route('http://127.0.0.1:5199/__v2-renderer', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body style="background:#0f172a;color:white"><div id="fixture"></div></body></html>' }));
  await page.goto('http://127.0.0.1:5199/__v2-renderer');
  await page.evaluate(async projections => {
    localStorage.setItem('native_language', 'ru');
    // The empty fixture page needs Vite's normal React refresh preamble.
    const RefreshRuntime = (await import('/@react-refresh')).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { StudyCardPuzzle } = await import('/src/components/study/StudyCardPuzzle.jsx');
    const { StudyCardQuiz } = await import('/src/components/study/StudyCardQuiz.jsx');
    const { parseQuizData } = await import('/src/utils/quizParser.js');
    const root = createRoot(document.getElementById('fixture'));
    window.v2Renderer = { answers: [] };
    const onTrainerAnswer = (_id, evidence) => window.v2Renderer.answers.push(evidence);
    window.v2Renderer.quiz = () => {
      const card = { ...projections[1], id: 102 };
      root.render(React.createElement(StudyCardQuiz, { card, quizData: parseQuizData(card), onTrainerAnswer }));
    };
    root.render(React.createElement(StudyCardPuzzle, { card: { ...projections[0], id: 101 }, onTrainerAnswer }));
  }, projections);
  await expect(page.locator('.btn-puzzle-chip')).toHaveCount(document.cards[0].data.tokens.length);
  const words = await page.locator('.btn-puzzle-chip').evaluateAll(items => items.map(item => ({ id: Number(item.dataset.id), text: item.textContent })).sort((a, b) => a.id - b.id));
  expect(words.map(word => word.text)).toEqual(document.cards[0].data.tokens);
  await page.getByRole('button', { name: 'Показать перевод' }).click();
  await expect(page.locator('.text-back')).toHaveText(document.cards[0].data.translation);
  // Swap physically distinct duplicate tokens: visible sentence stays identical,
  // but the existing evaluator must still reject this occurrence order.
  const wrong = [0, 3, 2, 1, 4, 5, 6, 7, 8];
  for (const id of wrong) await page.locator(`.btn-puzzle-chip[data-id="${id}"]`).click();
  await page.getByRole('button', { name: 'Проверить ответы' }).click();
  await expect(page.locator('.puzzle-boundary.is-incorrect').first()).toBeVisible();
  expect(await page.evaluate(() => window.v2Renderer.answers.length)).toBe(0);
  await page.getByTitle('Сбросить', { exact: true }).click();
  for (const word of words) await page.locator(`.btn-puzzle-chip[data-id="${word.id}"]`).click();
  await page.getByRole('button', { name: 'Проверить ответы' }).click();
  await expect.poll(() => page.evaluate(() => window.v2Renderer.answers.length)).toBe(1);
  await page.evaluate(() => window.v2Renderer.quiz());
  await expect(page.locator('.quiz-question')).toHaveText(document.cards[1].data.prompt);
  await expect(page.locator('.quiz-option-item')).toHaveCount(3);
  await page.locator('.quiz-option-item').filter({ hasText: 'München' }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.getByText('Попробуй другой вариант.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.v2Renderer.answers.length)).toBe(1);
  await page.locator('.quiz-option-item').filter({ hasText: 'Berlin' }).click();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.v2Renderer.answers.length)).toBe(2);
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
