const { test, expect } = require('@playwright/test');
const { writeFileSync, rmSync } = require('node:fs');
const { resolve, basename } = require('node:path');

// Serve this entry through Vite so its React imports use the application's module graph.
const harnessPath = resolve(__dirname, '../../../app', `.study-card-info-harness-${process.pid}.jsx`);
test.afterEach(() => rmSync(harnessPath, { force: true }));

const card = {
  id: 9101, deck_id: 91, level: 'B1', target_language: 'de',
  creator_name: 'Автор_с_очень_длинным_именем_для_проверки_переноса',
  front: 'Слушателю нужен маршрут:\n' + 'Тема и план: о чём будет выступление. Мой опыт: что лично я видел.\n'.repeat(8)
    + '\n::source\nУчебные заметки автора',
  back: 'Erzähle von deinen Erfahrungen und begründe deine Meinung. '.repeat(14),
  cefr: { level: 'B1', reason: 'Связный рассказ об опыте и обоснование своего мнения.' },
};

async function setup(page, context, initialCard = card) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const diagnostics = [];
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('native_language_selected', 'true');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/card-info-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    </script><script type="module" src="/${basename(harnessPath)}"></script></body></html>` }));
  writeFileSync(harnessPath, `
    import React from 'react';
    import ReactDOM from 'react-dom/client';
    import { LanguageProvider } from '/src/i18n/i18nContext.jsx';
    import { setInterfaceLanguage } from '/src/i18n/locale.js';
    import { StudyCard } from '/src/components/study/StudyCard.jsx';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import '/src/index.css'; import '/src/App.css';
    useDeckStore.setState({ currentDeck: { id: 91, name: 'Рассказываем об опыте', target_language: 'de' } });
    function Harness() {
      const [card, setCard] = React.useState(${JSON.stringify(initialCard)});
      const [isFlipped, onFlip] = React.useState(false);
      const [loading, setLoading] = React.useState(false);
      window.setTestCard = setCard; window.setTestLoading = setLoading;
      window.setTestLocale = setInterfaceLanguage;
      return React.createElement('div', { className: 'app-container' },
        React.createElement(StudyCard, { card, isFlipped, onFlip, loading, historyIndex: 0,
          audioControls: {}, styles: { cardFont: 'Inter', cardFontSize: 1.8,
            cardTextColor: '#cbd5e1', cardTextAlign: 'left' } }));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(
      React.createElement(LanguageProvider, null, React.createElement(Harness)));
  `);
  await page.goto('/card-info-harness');
  try {
    await expect(page.locator('.study-card-info-button')).toBeVisible();
  } catch (error) {
    throw new Error([...errors, ...diagnostics].join('\n') || error.message);
  }
  return errors;
}

async function checkLayout(page) {
  const bounds = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const surface = rect('.study-card-perspective');
    const footer = rect('.study-card-footer');
    const badge = rect('.card-level-badge');
    const actions = rect('.study-card-footer-actions');
    const info = rect('.study-card-info-button');
    return {
      belowContent: footer.top >= surface.bottom - 1,
      controlsSeparate: badge.right <= actions.left && actions.right <= info.left,
      fits: document.querySelector('.app-container').scrollWidth <= innerWidth,
      buttonFits: info.right <= innerWidth,
    };
  });
  expect(bounds).toEqual({ belowContent: true, controlsSeparate: true, fits: true, buttonFits: true });
}

test('long card: footer does not cover content, info expands in flow on both sides', async ({ page, context }, testInfo) => {
  const errors = await setup(page, context);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await checkLayout(page);
    const info = page.getByRole('button', { name: 'Информация о карточке', exact: true });
    await info.click();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.study-card-info')).toContainText(card.creator_name);
    await expect(page.locator('.study-card-info')).toContainText('Немецкий');
    await expect(page.locator('.study-card-info')).toContainText('Учебные заметки автора');
    await expect(page.locator('.study-card-info-row').filter({ hasText: 'Дата создания' })).toContainText('Нет данных');
    await expect(page.locator('.study-card-info-row').filter({ hasText: 'Соавторы' })).toContainText('Пока недоступно');
    expect(await page.locator('.card-front').count()).toBe(1);
    await checkLayout(page);
    await page.locator('.study-card-footer').screenshot({ path: testInfo.outputPath(`info-${width}.png`) });
    await info.click();
    await expect(page.locator('.study-card-info')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Перевернуть карточку', exact: true }).click();
  await expect(page.locator('.card-back')).toBeVisible();
  await checkLayout(page);
  await page.getByRole('button', { name: 'Информация о карточке', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.study-card-info')).toBeVisible();
  await page.evaluate(() => window.setTestLocale('en'));
  await expect(page.getByRole('region', { name: 'Card information' })).toContainText('Author');
  await expect(page.getByRole('region', { name: 'Card information' })).toContainText('German');
  await page.evaluate(() => window.setTestCard({ id: 9102, deck_id: 91, front: 'Neue Karte', back: 'Новая карточка' }));
  await expect(page.locator('.study-card-info')).toHaveCount(0);
  await expect(page.locator('.card-level-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Card information', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Card information' })).not.toContainText(card.creator_name);
  await page.evaluate(() => window.setTestLoading(true));
  await expect(page.locator('.study-card-flip-button')).toBeDisabled();
  await page.evaluate(() => window.setTestLoading(false));
  await expect(page.locator('.study-card-flip-button')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('trainer check action remains usable in the non-floating footer', async ({ page, context }) => {
  const errors = await setup(page, context, {
    ...card, front: 'Ich [[lerne]] Deutsch.', back: 'Я учу немецкий.',
    created_at: '2026-09-10T12:00:00Z', updated_at: '2026-10-16T12:00:00Z',
  });
  await page.setViewportSize({ width: 320, height: 900 });
  const check = page.locator('.study-card-footer .trainer-footer-action');
  await expect(check).toBeVisible();
  await expect(check).toBeDisabled();
  await page.locator('input').first().fill('lerne');
  await expect(check).toBeEnabled();
  await check.click();
  await expect(check).toHaveText('Выполнено');
  await checkLayout(page);
  await page.getByRole('button', { name: 'Информация о карточке', exact: true }).click();
  await expect(page.locator('.study-card-info-row').filter({ hasText: 'Дата создания' })).toContainText('10.09.2026');
  await expect(page.locator('.study-card-info-row').filter({ hasText: 'Дата изменения' })).toContainText('16.10.2026');
  expect(errors).toEqual([]);
});

test('info stays available without revealing a blocked free-text answer', async ({ page, context }) => {
  const errors = await setup(page, context, {
    ...card, front: '@free\nBeschreiben Sie Ihre Erfahrungen.', back: 'Private example answer',
  });
  await expect(page.locator('.study-card-flip-button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Информация о карточке', exact: true }).click();
  await expect(page.locator('.study-card-info')).toContainText(card.creator_name);
  await expect(page.locator('.study-card-info')).not.toContainText('Private example answer');
  await expect(page.locator('.card-back')).toHaveCount(0);
  expect(errors).toEqual([]);
});
