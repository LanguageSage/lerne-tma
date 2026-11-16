const { test, expect } = require('./isolated-fixture.cjs');
const { writeFileSync, rmSync } = require('node:fs');
const { resolve, basename } = require('node:path');
const fixture = JSON.parse(process.env.LERNE_NATIVE_LEARNING_FIXTURE || 'null');
test.skip(!fixture, 'Use structured_cards_postgres.py --ratings-browser');
if (fixture && !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin)) throw new Error('Loopback fixture required');
let harnessPath;

test.beforeAll(() => {
  if (!fixture) return;
  harnessPath = resolve(__dirname, '../../../app', `.native-rating-harness-${process.pid}.jsx`);
  writeFileSync(harnessPath, `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { LanguageProvider } from '/src/i18n/i18nContext.jsx';
    import { useUiStore } from '/src/store/useUiStore.js';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import { StudyCard } from '/src/components/study/StudyCard.jsx';
    import '/src/index.css'; import '/src/App.css';
    const cards = ${JSON.stringify(fixture.cards)}; const deck = ${JSON.stringify(fixture.deck)};
    useDeckStore.setState({ currentDeck: deck, deckCards: cards });
    useUiStore.setState({ userProfile: { user_id: 1, is_guest: false } });
    function Harness() {
      const [card, setCard] = React.useState(cards[0]);
      window.showRatingCard = id => setCard(cards.find(c => c.id === id));
      return <div className="app-container"><StudyCard card={card} isFlipped={false} onFlip={() => {}}
        audioControls={{}} styles={{ cardFont: 'Inter', cardFontSize: 1.5 }} /></div>;
    }
    createRoot(document.getElementById('root')).render(<LanguageProvider><Harness /></LanguageProvider>);
  `);
});
test.afterAll(() => { if (harnessPath) rmSync(harnessPath, { force: true }); });

async function open(page, context, control = {}) {
  await context.addInitScript(token => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ account_id: 1, access_token: token }));
  }, fixture.tokens['1']);
  await page.route('**/api/**', async route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    if (control.offline && pathname.startsWith('/api/card-ratings/')) return route.abort('internetdisconnected');
    if (pathname.startsWith('/api/card-ratings/') || pathname === '/api/sync/v2/status') {
      if (request.method() === 'PUT') {
        control.puts = (control.puts || 0) + 1;
        if (control.status) return route.fulfill({ status: control.status, json: { detail: 'Synthetic failure' } });
      }
      const response = await route.fetch({ url: fixture.origin + pathname + search, maxRetries: 0 });
      if (request.method() === 'PUT' && control.hold) await control.hold;
      if (request.method() === 'PUT' && control.lose) {
        control.lose = false;
        expect(response.status()).toBe(200);
        return route.abort('connectionreset');
      }
      return route.fulfill({ response });
    }
    return route.fulfill({ json: [] });
  });
  await page.route('**/rating-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module" src="/${basename(harnessPath)}"></script></body></html>` }));
  await page.goto('/rating-harness');
  await expect(page.locator('.card-rating-count').first()).not.toHaveText('—');
}
const like = page => page.locator('.card-rating-btn.is-like');
const dislike = page => page.locator('.card-rating-btn.is-dislike');
async function counts(page, up, down) {
  await expect(like(page).locator('.card-rating-count')).toHaveText(String(up));
  await expect(dislike(page).locator('.card-rating-count')).toHaveText(String(down));
}
async function clear(page, id) {
  await page.evaluate(async ({ id, deck }) => {
    const service = await import('/src/services/cardRatings.js');
    await service.saveRating(1, id, null);
    await service.loadDeckRatings(1, deck, true);
  }, { id, deck: fixture.deck.id });
}

for (const [index, card] of (fixture?.cards || []).entries()) {
  test(`confirmed ratings for native ${card.content_v2.card.type}`, async ({ page, context }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: [320, 375, 430, 768, 1280][index % 5], height: 900 });
    await open(page, context);
    await page.evaluate(id => window.showRatingCard(id), card.id);
    await counts(page, 0, 1);
    await like(page).click();
    await expect(like(page)).toHaveAttribute('aria-pressed', 'true');
    await counts(page, 1, 1);
    await expect(page.locator('.card-rating-notice')).toBeVisible();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await counts(page, 0, 1);
    await dislike(page).click();
    await expect(dislike(page)).toHaveAttribute('aria-pressed', 'true');
    await counts(page, 0, 2);
    await expect(page.locator('.card-rating-panel')).toBeVisible();
    await dislike(page).click();
    await counts(page, 0, 1);
    await like(page).click();
    await counts(page, 1, 1);
    await dislike(page).click();
    await counts(page, 0, 2);
    await like(page).click();
    await counts(page, 1, 1);
    await page.reload();
    await page.evaluate(id => window.showRatingCard(id), card.id);
    await expect(like(page)).toHaveAttribute('aria-pressed', 'true');
    await counts(page, 1, 1);
    const geometry = await page.locator('.card-rating-pill').evaluate(element => {
      const box = element.getBoundingClientRect();
      return { right: box.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
        targets: [...element.querySelectorAll('button')].every(b => b.offsetHeight >= 44 && b.offsetWidth >= 44) };
    });
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.overflow).toBe(false);
    expect(geometry.targets).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${card.content_v2.card.type}-rating.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('HTTP failures, offline, lost commit response and retry never show false success', async ({ page, context }, testInfo) => {
  const control = {};
  const id = fixture.cards[0].id;
  await page.setViewportSize({ width: 320, height: 800 });
  await open(page, context, control);
  await clear(page, id);
  for (const status of [404, 503, 500, 403]) {
    control.status = status;
    await like(page).click();
    await expect(page.locator('.card-rating-error')).toBeVisible();
    await expect(like(page)).toBeEnabled();
    await expect(page.locator('.card-rating-notice')).toHaveCount(0);
    await expect(like(page)).toHaveAttribute('aria-pressed', 'false');
    await counts(page, 0, 1);
  }
  control.status = null;
  control.offline = true;
  await like(page).click();
  await expect(page.locator('.card-rating-error')).toBeVisible();
  await counts(page, '—', '—');
  await expect(like(page)).not.toHaveAttribute('aria-pressed');
  await expect(page.locator('.card-rating-notice')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('offline-unknown.png'), fullPage: true });
  control.offline = false;
  control.lose = true;
  await like(page).click();
  await expect(page.locator('.card-rating-error')).toBeVisible();
  await expect(like(page)).toBeEnabled();
  await expect(like(page)).toHaveAttribute('aria-pressed', 'true');
  await counts(page, 1, 1);
  await expect(page.locator('.card-rating-notice')).toHaveCount(0);
  // Retry a clear and re-save, then a real reload reads the committed vote.
  await like(page).click();
  await counts(page, 0, 1);
  await like(page).click();
  await counts(page, 1, 1);
  await page.reload();
  await expect(like(page)).toHaveAttribute('aria-pressed', 'true');
});

test('repeated press and navigation while saving cannot affect another card', async ({ page, context }) => {
  const control = {};
  const [first, second] = fixture.cards;
  await open(page, context, control);
  await clear(page, first.id);
  let release;
  control.hold = new Promise(resolve => { release = resolve; });
  const before = control.puts;
  await like(page).evaluate(button => { button.click(); button.click(); });
  await expect(like(page)).toBeDisabled();
  await expect(like(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.card-rating-notice')).toHaveCount(0);
  await page.evaluate(id => window.showRatingCard(id), second.id);
  await expect(like(page)).toBeEnabled();
  await counts(page, 1, 1);
  release();
  control.hold = null;
  await expect.poll(() => control.puts).toBe(before + 1);
  await expect(page.locator('.card-rating-notice')).toHaveCount(0);
  await page.evaluate(id => window.showRatingCard(id), first.id);
  await expect(like(page)).toBeEnabled();
  await expect(like(page)).toHaveAttribute('aria-pressed', 'true');
  await counts(page, 1, 1);
  await expect(page.locator('.card-rating-error')).toHaveCount(0);
});
