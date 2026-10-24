const { test, expect } = require('@playwright/test');
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

async function setup(page, context, locale = 'ru', customDeck = null) {
  const writes = [];
  const currentDeck = structuredClone(customDeck || deck);
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
  }, currentDeck);
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

test('mobile deck passport renders topic badge without clipping and places start button above goal and srs at bottom', async ({ page, context }, testInfo) => {
  const userDeck = {
    id: 1, name: '', target_language: 'de', role: 'owner',
    metadata: {
      intro: {
        level: 'B1',
        topic: 'Противопоставление: obwohl и trotzdem',
        goal: 'Понять смысл противопоставления и научиться распознавать правильные конструкции с obwohl и trotzdem.',
        learning_outcomes: [
          'Объяснять разницу между obwohl и trotzdem на простых примерах.',
          'Понимать порядок слов в придаточном с obwohl и главном предложении с trotzdem.',
          'Различать obwohl в начале и в конце сложного предложения.'
        ],
        estimated_time: '25–35 минут'
      }
    },
    stats: { total: 18, new: 18, learning: 0, due: 0 }
  };
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page, context, 'ru', userDeck);

  // 1. Topic badge is fully visible and not clipped
  const topicBadge = page.locator('.deck-intro-topic-badge');
  await expect(topicBadge).toBeVisible();
  await expect(topicBadge).toHaveText('Противопоставление: obwohl и trotzdem');

  const heroRect = await page.locator('.deck-intro-hero').boundingBox();
  const badgeRect = await topicBadge.boundingBox();
  expect(badgeRect.y + badgeRect.height).toBeLessThanOrEqual(heroRect.y + heroRect.height + 1);

  // 2. Action buttons are right after indicators (above Goal)
  const actionsRect = await page.locator('.deck-intro-actions-card').boundingBox();
  const goalSection = page.locator('.deck-intro-section').first();
  const goalRect = await goalSection.boundingBox();
  expect(actionsRect.y).toBeLessThan(goalRect.y);

  // 3. SRS repetition block is placed at the bottom (below Goal and Outcomes)
  const srsRect = await page.locator('.deck-intro-srs-block').boundingBox();
  expect(srsRect.y).toBeGreaterThan(goalRect.y);

  await page.screenshot({ path: testInfo.outputPath('mobile-passport-final-375.png') });
});

