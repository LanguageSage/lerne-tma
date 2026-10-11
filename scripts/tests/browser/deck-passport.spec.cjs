const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const hostile = '<img src=x onerror="window.passportXss=1">';
const passport = { schema_version: 1, intro: { title: '09 · Самостоятельно построить мысль', level: 'B1',
  goal: 'Выражать противопоставление без готовых шаблонов', learning_outcomes: ['Строить предложения'], estimated_time: '40–60 минут' },
  pedagogy: { schema_version: 1, lesson_type: 'practice',
    stages: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, title: `Этап ${i + 1}: самостоятельно формулирую мысли`,
      goal: i === 0 ? hostile : 'Übungen mit langen Sätzen und unterschiedlichen Konstruktionen',
      from_card: i * 6 + 1, to_card: i * 6 + 6, support: i === 5 ? 'independent' : 'high' })),
    expected_result: 'Самостоятельно выражать противопоставление в речи',
    competencies: [{ id: 'meaning', title: 'Смысловая связь' }],
    review_recommendations: [{ id: 'review12', title: '12 · Восстановление знаний', when: 'Если возникают затруднения', reason: hostile }] } };
const deck = { id: 1, name: '09 · Самостоятельно построить мысль', target_language: 'de', role: 'owner',
  metadata: { resources: [], intro: passport.intro, pedagogy: passport.pedagogy }, stats: { total: 40, new: 40 } };

async function setup(page, context, locale = 'ru') {
  const writes = [];
  const currentDeck = structuredClone(deck);
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(locale => {
    localStorage.setItem('native_language', locale);
    localStorage.setItem('native_language_selected', 'true');
    localStorage.setItem('lerne_has_selected_language', 'true');
    localStorage.setItem('lerne_target_language', 'de');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
  }, locale);
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [currentDeck], folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false } } });
    if (pathname === '/api/decks') return route.fulfill({ json: [currentDeck] });
    if (pathname === '/api/decks/1/metadata') { writes.push(request.postDataJSON()); currentDeck.metadata = request.postDataJSON(); return route.fulfill({ json: { metadata: request.postDataJSON() } }); }
    if (pathname.endsWith('/cards') || pathname === '/api/folders' || pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname.endsWith('/next')) return route.fulfill({ json: { finished: true } });
    if (pathname === '/api/auth/sync') return route.fulfill({ json: { status: 'ok', user: { user_id: 1, is_guest: false } } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/?user_id=1');
  await expect(page.locator('#deck-item-1')).toBeVisible();
  await page.evaluate(async deck => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    useDeckStore.setState({ currentDeck: deck, deckCards: [] });
    useUiStore.getState().setView('deck_intro');
  }, deck);
  return writes;
}

async function finish(page) {
  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/store/useSessionStore.js');
    const { useUiStore } = await import('/src/store/useUiStore.js');
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.setState({ showLessonCompletion: true, showCompletionCelebration: false });
    useSessionStore.setState({ studyHistory: [{ id: 1, front: 'Wort', back: 'Слово' }], isSessionFinished: true,
      sessionStats: { reviewsCount: 4, correctCount: 3, mistakeCount: 1, startedAt: 100000, endedAt: 160000 } });
    useUiStore.getState().setView('study');
  });
}

for (const width of [320, 375, 430, 768, 1080]) test(`passport intro and completion fit ${width}px and preserve real results`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const locale = width === 768 ? 'en' : 'ru';
  await setup(page, context, locale);
  await page.locator('.deck-intro-route summary').click();
  await expect(page.locator('.deck-intro-route li')).toHaveCount(6);
  await expect(page.locator('.deck-intro-route')).toContainText(hostile);
  expect(await page.locator('.deck-intro-route img').count()).toBe(0);
  await page.locator('.deck-intro-route').screenshot({ path: testInfo.outputPath(`intro-${width}.png`) });
  const introWidth = await page.locator('.deck-intro-container').evaluate(e => [e.scrollWidth, e.clientWidth]);
  expect(introWidth[0]).toBeLessThanOrEqual(introWidth[1] + 1);
  await page.locator('.deck-intro-route li').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.deck-intro-route li').last()).toBeVisible();
  await page.locator('.deck-intro-btn-start').scrollIntoViewIfNeeded();
  await expect(page.locator('.deck-intro-btn-start')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`intro-bottom-${width}.png`) });
  await finish(page);
  await expect(page.locator('.lesson-completion-card')).toBeVisible();
  await expect(page.locator('.completion-metric-value')).toHaveText(['4', '3', '1', '75%', '1:00']);
  await expect(page.locator('.lesson-completion-pedagogy')).toHaveCount(2);
  await expect(page.locator('.lesson-completion-pedagogy').first()).toContainText(locale === 'en' ? 'Individual skills were not assessed' : 'Освоение отдельных навыков здесь не оценивалось');
  expect(await page.locator('.lesson-completion-pedagogy img').count()).toBe(0);
  expect(await page.evaluate(() => window.passportXss)).toBeUndefined();
  const completionWidth = await page.locator('.lesson-completion-card').evaluate(e => [e.scrollWidth, e.clientWidth]);
  expect(completionWidth[0]).toBeLessThanOrEqual(completionWidth[1] + 1);
  await page.locator('.lesson-completion-card').screenshot({ path: testInfo.outputPath(`completion-${width}.png`) });
  await page.locator('.lesson-completion-btn-primary').scrollIntoViewIfNeeded();
  await expect(page.locator('.lesson-completion-pedagogy').last()).toBeVisible();
  await expect(page.locator('.lesson-completion-btn-primary')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`completion-bottom-${width}.png`) });
});

test('intro editor preserves CEFR and pedagogy; old decks render without added sections', async ({ page, context }) => {
  const writes = await setup(page, context);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.locator('.settings-modal input').first().fill('Edited title');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.deck-intro-title')).toHaveText('Edited title');
  expect(writes[0].intro.level).toBe('B1');
  expect(writes[0].pedagogy).toEqual(passport.pedagogy);
  await page.evaluate(async () => {
    const { useDeckStore } = await import('/src/store/useDeckStore.js');
    useDeckStore.setState({ currentDeck: { ...useDeckStore.getState().currentDeck, metadata: {} } });
  });
  await expect(page.locator('.deck-intro-route')).toHaveCount(0);
  await finish(page);
  await expect(page.locator('.lesson-completion-pedagogy')).toHaveCount(0);
  await expect(page.locator('.completion-metric-value')).toHaveText(['4', '3', '1', '75%', '1:00']);
});

test('failed intro save keeps the draft open for retry', async ({ page, context }) => {
  await setup(page, context);
  await page.route('**/api/decks/1/metadata', route => route.fulfill({ status: 500, json: { detail: 'Test failure' } }));
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.locator('.settings-modal input').first().fill('Keep my draft');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.settings-modal')).toBeVisible();
  await expect(page.locator('.settings-modal input').first()).toHaveValue('Keep my draft');
  await expect(page.locator('.deck-intro-title')).toHaveText(passport.intro.title);
});

test('author preview edits passport drafts, escapes HTML and sends passport-only publication', async ({ page }, testInfo) => {
  const root = path.resolve(__dirname, '../../..');
  let html = fs.readFileSync(path.join(root, 'tools/admin/static/index.html'), 'utf8');
  html = html.replace(/<script src="\/static\/js\/(?!state\.js|api\.js|author\.js)[^"]+"><\/script>/g, '');
  await page.route('**/__admin', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/static/js/**', route => route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(root, 'tools/admin/static/js', path.basename(new URL(route.request().url()).pathname)), 'utf8') }));
  const doc = { cards: [{ deck_name: deck.name, front: 'F', back: 'B' }], passports: [{ deck_name: deck.name, passport }],
    decks: [{ deck_name: deck.name, cards_count: 1, has_passport: true, level: 'B1', goal: passport.intro.goal, stages_count: 6 }],
    total_cards: 1, decks_count: 1, passport_errors: [], document_errors: [], levels: ['B1'] };
  let published;
  await page.route('**/api/admin/author/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    if (pathname.endsWith('/parse')) return route.fulfill({ json: doc });
    if (pathname.endsWith('/passport-validate')) return route.fulfill({ json: { errors: [], decks: doc.decks } });
    if (pathname.endsWith('/publish-preview')) return route.fulfill({ json: { target_folder_name: 'Курс', total_cards: 1, decks_count: 1,
      passports: [{ ...body.passports[0], target_deck_id: 1, changes: [{ field: 'intro.goal', before: 'Old', after: body.passports[0].passport.intro.goal }] }] } });
    if (pathname.endsWith('/publish')) { published = body; return route.fulfill({ json: { folder_id: 10, folder_name: 'Курс', total_saved_cards: 0, passport_only: body.passport_only, updated_passports: 1, published_decks: [{ deck_name: deck.name, cards_count: 0 }] } }); }
    return route.fulfill({ json: {} });
  });
  await page.goto('/__admin');
  await page.evaluate(async () => {
    document.querySelectorAll('main > section').forEach(e => e.classList.add('hidden'));
    document.getElementById('content-author').classList.remove('hidden');
    foldersData = [{ id: 10, name: 'Курс', parent_id: null }];
    window.showToast = () => {};
    populateAuthorFolderSelects();
    await runAuthorParse({ text: 'fixture' });
  });
  await page.locator('#author-passport-editors > details > summary').click();
  await expect(page.locator('#author-passport-editors fieldset')).toHaveCount(6);
  expect(await page.locator('#author-passport-editors img').count()).toBe(0);
  await page.getByLabel('Цель', { exact: true }).first().fill('Новая цель');
  await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
  await page.locator('#author-publish-folder-select').selectOption('10');
  await page.locator('#author-passport-only').check();
  await page.getByRole('button', { name: /Предпросмотр \(Preview\)/ }).click();
  await page.locator('#author-passport-changes summary').click();
  await expect(page.locator('#author-passport-changes')).toContainText('Новая цель');
  await page.setViewportSize({ width: 375, height: 900 });
  await page.locator('#author-passport-editors').screenshot({ path: testInfo.outputPath('admin-editor-375.png') });
  const dimensions = await page.locator('#author-passport-editors').evaluate(e => [e.scrollWidth, e.clientWidth]);
  expect(dimensions[0]).toBeLessThanOrEqual(dimensions[1] + 1);
  await page.getByRole('button', { name: 'Опубликовать в базу' }).click();
  await expect(page.locator('#author-publish-success-wrap')).toBeVisible();
  await expect(page.locator('#author-publish-success-wrap')).toContainText('Карточки не изменялись');
  expect(published.passport_only).toBe(true);
  expect(published.passports[0].passport.intro.goal).toBe('Новая цель');
  expect(published.passports[0].passport.pedagogy.stages).toHaveLength(6);
  await page.evaluate(passport => {
    switchAuthorSubtab('update');
    authorState.update.previewResult = { preview_token: 'test', cards: [], updated: 0, unchanged: 1,
      passports: [{ deck_name: '09', deck_id: 1, before: { intro: { goal: 'Old' } }, passport }] };
    renderAuthorUpdateState();
  }, passport);
  await page.locator('#author-update-passports summary').click();
  await expect(page.locator('#author-update-passports')).toContainText('Old');
  const importedPassport = JSON.parse(await page.locator('#author-update-passports pre').nth(1).textContent());
  expect(importedPassport.pedagogy.stages[0].goal).toBe(hostile);
  expect(await page.locator('#author-update-passports img').count()).toBe(0);
});
