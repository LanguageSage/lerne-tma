const { test, expect } = require('playwright/test');
const { writeFileSync, rmSync } = require('node:fs');
const { resolve, basename } = require('node:path');

let harnessPath;
let sequence = 0;
test.afterEach(() => { if (harnessPath) rmSync(harnessPath, { force: true }); });

test('card rating: like/dislike before and after flip, feedback submission, right alignment', async ({ page, context }) => {
  const ratings = new Map();
  const messages = [];
  const errors = [];
  page.on('pageerror', error => {
    if (!error.message.includes('send')) errors.push(error.message);
  });

  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
  });

  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/card-notes/**', route => route.fulfill({ json: [] }));
  await page.route('**/api/study/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/card-ratings/**', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.startsWith('/api/card-ratings/deck/')) {
      return route.fulfill({ json: [...ratings.values()] });
    }
    const cardId = Number(url.pathname.split('/').pop());
    if (method === 'PUT') {
      const data = route.request().postDataJSON();
      const row = { card_id: cardId, rating: data.rating, reason: data.reason };
      ratings.set(cardId, row);
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: {} });
  });

  await page.route('**/api/messages/**', async route => {
    const data = route.request().postDataJSON();
    messages.push(data);
    return route.fulfill({ json: { id: 'msg-1', text: data.text, card_id: data.card_id } });
  });

  harnessPath = resolve(__dirname, '../../../app', `.card-rating-harness-${process.pid}-${++sequence}.jsx`);
  writeFileSync(harnessPath, `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { LanguageProvider } from '/src/i18n/i18nContext.jsx';
    import { useUiStore } from '/src/store/useUiStore.js';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import { StudyCard } from '/src/components/study/StudyCard.jsx';
    import '/src/index.css'; import '/src/App.css';

    const card = { id: 7001, deck_id: 70, front: 'Wie geht es dir?', back: 'Как твои дела?', target_language: 'de', level: 'A1' };
    const deck = { id: 70, name: 'Deutsch', role: 'viewer', target_language: 'de' };
    useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    useUiStore.setState({ userProfile: { user_id: 1, is_guest: false } });

    function Harness() {
      const [flipped, setFlipped] = React.useState(false);
      return (
        <div className="app-container">
          <StudyCard card={card} isFlipped={flipped} onFlip={setFlipped}
            audioControls={{}} styles={{ cardFont: 'Inter', cardFontSize: 1.5 }} />
        </div>
      );
    }
    createRoot(document.getElementById('root')).render(
      <LanguageProvider><Harness /></LanguageProvider>
    );
  `);

  await page.route('**/rating-harness', route => route.fulfill({
    contentType: 'text/html',
    body: `
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>
      <div id="root"></div>
      <script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
      </script>
      <script type="module" src="/${basename(harnessPath)}"></script>
      </body></html>`
  }));

  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/rating-harness');
  await expect(page.locator('.study-card-rating')).toBeVisible();

  // 1. Check alignment - pill should be right-aligned within footer
  const pillBox = await page.locator('.card-rating-pill').boundingBox();
  const footerBox = await page.locator('.study-card-footer').boundingBox();
  expect(footerBox.x + footerBox.width - (pillBox.x + pillBox.width)).toBeLessThan(25);
  await page.screenshot({ path: resolve(__dirname, '../../../local/test-data/ux-feedback/real-front.png') });

  // 2. Click Like (before flip)
  await page.locator('.card-rating-btn.is-like').click();
  await expect(page.locator('.card-rating-btn.is-like')).toHaveClass(/is-on/);
  await expect(page.locator('.card-rating-notice')).toBeVisible();
  expect(ratings.get(7001)?.rating).toBe(1);
  await page.screenshot({ path: resolve(__dirname, '../../../local/test-data/ux-feedback/real-like.png') });

  // 3. Flip card, rating persists
  await page.locator('.study-card-flip-button').click();
  await expect(page.locator('.card-rating-btn.is-like')).toHaveClass(/is-on/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(__dirname, '../../../local/test-data/ux-feedback/real-back.png') });

  // 4. Switch to Dislike
  await page.locator('.card-rating-btn.is-dislike').click();
  await expect(page.locator('.card-rating-btn.is-dislike')).toHaveClass(/is-on/);
  await expect(page.locator('.card-rating-panel')).toBeVisible();
  expect(ratings.get(7001)?.rating).toBe(-1);

  // 5. Select reason chip and write improvement text
  await page.getByRole('button', { name: 'Непонятное задание' }).click();
  expect(ratings.get(7001)?.reason).toBe('unclear');
  await page.screenshot({ path: resolve(__dirname, '../../../local/test-data/ux-feedback/real-dislike.png') });

  const textarea = page.locator('.card-rating-panel textarea');
  await textarea.fill('Пример не очень понятен');
  // Verify typing space does not flip the card
  await textarea.press('Space');
  await page.getByRole('button', { name: 'Отправить' }).click();

  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0].card_id).toBe(7001);
  expect(messages[0].text).toContain('Пример не очень понятен');
  await expect(page.locator('.card-rating-panel')).toHaveCount(0);

  // 6. Untoggle dislike by clicking it again
  await page.locator('.card-rating-btn.is-dislike').click();
  await expect(page.locator('.card-rating-btn.is-dislike')).not.toHaveClass(/is-on/);
  expect(ratings.get(7001)?.rating).toBe(null);

  expect(errors).toEqual([]);
});
