const { test, expect } = require('@playwright/test');
const { writeFileSync, rmSync, mkdirSync } = require('node:fs');
const { resolve, basename } = require('node:path');

let harnessPath;
test.afterEach(() => { if (harnessPath) rmSync(harnessPath, { force: true }); });

test('favorites: centered heart, offline persistence, home collection and review of original cards', async ({ page, context }) => {
  const cards = [
    { id: 7001, deck_id: 70, deck_name: 'Deutsch im Alltag', front: 'Wie geht es dir?', back: 'Как твои дела?',
      target_language: 'de', card_type: 'translation', queue: 'review', interval: 12, level: 'A1',
      next_review: '2099-01-01T00:00:00', want_to_learn: false },
    { id: 7002, deck_id: 71, deck_name: 'Gespräche und Begegnungen', front: 'Schön, dich wiederzusehen.', back: 'Рад снова тебя видеть.',
      target_language: 'de', card_type: 'translation', queue: 'review', interval: 8, level: 'A2',
      next_review: '2099-01-01T00:00:00', want_to_learn: true },
  ];
  const grades = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    if (!localStorage.getItem('native_language')) localStorage.setItem('native_language', 'ru');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: 'test', refresh_token: 'test' }));
  });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/cards/favorites') return route.fulfill({ json: cards.filter(card => card.want_to_learn) });
    const favorite = url.pathname.match(/^\/api\/cards\/(\d+)\/favorite$/);
    if (favorite) {
      const card = cards.find(card => card.id === Number(favorite[1]));
      card.want_to_learn = request.postDataJSON().want_to_learn;
      return route.fulfill({ json: { id: card.id, want_to_learn: card.want_to_learn } });
    }
    const detail = url.pathname.match(/^\/api\/study\/card\/(\d+)$/);
    if (detail) return route.fulfill({ json: cards.find(card => card.id === Number(detail[1])) });
    if (url.pathname === '/api/study/grade') {
      grades.push(request.postDataJSON());
      return route.fulfill({ json: { status: 'success' } });
    }
    if (url.pathname.startsWith('/api/knowledge/decks/')) return route.fulfill({ json: { knowledge_items: [], card_knowledge_items: [] } });
    if (/card-notes|card-ratings/.test(url.pathname) || url.pathname === '/api/messages') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  harnessPath = resolve(__dirname, '../../../app', `.card-favorites-harness-${process.pid}.jsx`);
  writeFileSync(harnessPath, `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { LanguageProvider } from '/src/i18n/i18nContext.jsx';
    import { useUiStore } from '/src/store/useUiStore.js';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import { useSessionStore } from '/src/store/useSessionStore.js';
    import { useSettingsStore } from '/src/store/useSettingsStore.js';
    import { useStudyNavigation } from '/src/hooks/useStudyNavigation.js';
    import { StudyView } from '/src/components/study/StudyView.jsx';
    import { DeckGrid } from '/src/components/deckgrid/DeckGrid.jsx';
    import { FavoritesView } from '/src/components/deckgrid/FavoritesView.jsx';
    import { DraggableCardItem } from '/src/components/deckgrid/DraggableCardItem.jsx';
    import { DndContext } from '@dnd-kit/core';
    import '/src/index.css'; import '/src/App.css'; import '/src/components/DeckGrid.css';
    const card = ${JSON.stringify(cards[0])};
    const decks = [70, 71].map(id => ({ id, name: id === 70 ? 'Deutsch im Alltag' : 'Gespräche und Begegnungen',
      user_id: 1, role: 'owner', target_language: 'de', folder_id: null, stats: { total: 1 } }));
    useDeckStore.setState({ currentDeck: decks[0], decks, folders: [], deckCards: [card], libraryStatus: 'ready' });
    useSettingsStore.setState({ autoPlay: false, gradeSoundEnabled: false, showLessonCompletion: false,
      studyMode: 'classic', gradingCollapsed: false, speechFollowupEnabled: false });
    useUiStore.setState({ view: 'study', loading: false, hasInitialized: true, activeFolderId: null,
      userProfile: { user_id: 1, is_guest: false } });
    useSessionStore.getState().addToHistory(card);
    function Harness() {
      const view = useUiStore(s => s.view);
      const { startStudy, startStudyCard } = useStudyNavigation();
      return <div id="app-container" className="app-container">
        <button onClick={() => useUiStore.getState().setView('decks')}>Главная</button>
        <button onClick={() => useUiStore.getState().setView('list-preview')}>Список</button>
        {view === 'decks' ? <DeckGrid startTutorial={() => {}} />
          : view === 'favorites' ? <FavoritesView startStudy={startStudy} startStudyCard={startStudyCard} />
          : view === 'list-preview' ? <DndContext><DraggableCardItem c={card} index={0} currentDeck={decks[0]} startStudyCard={startStudyCard} /></DndContext>
          : <StudyView />}
      </div>;
    }
    createRoot(document.getElementById('root')).render(<LanguageProvider><Harness /></LanguageProvider>);
  `);
  await page.route('**/favorites-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module" src="/${basename(harnessPath)}"></script></body></html>` }));
  const screenshots = resolve(__dirname, '../../../local/test-data/favorites');
  mkdirSync(screenshots, { recursive: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/favorites-harness');
  const heart = page.locator('.card-rating-pill .favorite-button');
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const [like, favorite, dislike] = await page.locator('.card-rating-pill').evaluate(pill =>
      [...pill.children].map(button => { const rect = button.getBoundingClientRect(); return { x: rect.x, width: rect.width }; }));
    expect(favorite.x).toBeGreaterThan(like.x);
    expect(dislike.x).toBeGreaterThan(favorite.x);
    expect(favorite.width).toBeGreaterThanOrEqual(44);
    expect(Math.abs(favorite.x + favorite.width / 2 - (like.x + dislike.x + dislike.width) / 2)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(screenshots, `heart-${width}.png`), animations: 'disabled' });
  }
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => cards[0].want_to_learn).toBe(true);
  await page.screenshot({ path: resolve(screenshots, 'heart-selected.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Список', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.locator('.card-item .favorite-button')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(screenshots, 'card-list-320.png'), animations: 'disabled' });
  await page.evaluate(async () => { const { useUiStore } = await import('/src/store/useUiStore.js'); useUiStore.getState().setView('study'); });
  await page.locator('.study-card-flip-button').click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.card-rating-btn.is-like').click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('.favorites-shortcut-count')).toHaveText('2');
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: resolve(screenshots, 'home-375.png'), animations: 'disabled' });
  await page.locator('.favorites-shortcut').click();
  await expect(page.locator('.favorites-card')).toHaveCount(2);
  await page.screenshot({ path: resolve(screenshots, 'collection-375.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /Повторить избранное/ }).click();
  await expect(page.locator('.study-card-flip-button')).toBeVisible();
  await page.locator('.study-card-flip-button').click();
  await page.locator('.grade-2').click();
  await expect.poll(() => grades.length).toBe(1);
  await expect(page.locator('.study-flow')).toContainText(cards[1].front);
  await page.locator('.study-card-flip-button').click();
  // Separate deliberate answers must be outside the existing 350ms double-tap guard.
  await page.waitForTimeout(360);
  await expect(page.locator('.grade-2')).toBeEnabled();
  await page.locator('.grade-2').focus();
  await page.locator('.grade-2').press('Enter');
  await expect.poll(() => grades.length).toBe(2);
  expect(grades.map(grade => grade.deck_id)).toEqual([70, 71]);
  expect(grades.every(grade => grade.review_context === 'forced' && grade.return_next === false)).toBe(true);
  await expect(page.getByText('Колода завершена', { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, 'completed-375.png') });
  await page.getByRole('button', { name: 'Назад', exact: true }).focus();
  await page.getByRole('button', { name: 'Назад', exact: true }).press('Enter');
  await expect(page.locator('.favorites-card')).toHaveCount(2);
  await context.setOffline(true);
  await page.locator('.favorites-card').first().getByRole('button', { name: 'Убрать из избранного' }).click();
  await expect(page.locator('.favorites-card')).toHaveCount(1);
  await context.setOffline(false);
  // Reload runs the real local-first refresh/flush and reuses the same database.
  await page.reload();
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Главная', exact: true }).click();
  await expect(page.locator('.favorites-shortcut-count')).toHaveText('1');
  await expect.poll(() => cards[0].want_to_learn).toBe(false);
  for (const [locale, title] of [['en', 'Favorites'], ['uk', 'Обране']]) {
    await page.evaluate(locale => localStorage.setItem('native_language', locale), locale);
    await page.reload();
    await page.getByRole('button', { name: 'Главная', exact: true }).click();
    await page.locator('.favorites-shortcut').click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.locator('.favorites-card')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});
