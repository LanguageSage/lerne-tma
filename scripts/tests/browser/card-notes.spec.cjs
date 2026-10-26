const { test, expect } = require('./isolated-fixture.cjs');
const { writeFileSync, rmSync } = require('node:fs');
const { resolve, basename } = require('node:path');
let harnessPath;
let sequence = 0;
test.afterEach(() => { if (harnessPath) rmSync(harnessPath, { force: true }); });

async function setup(page, context) {
  const server = new Map();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    localStorage.setItem('native_language', 'ru');
    localStorage.setItem('lerne_user_profile', JSON.stringify({ user_id: 1, is_guest: false }));
    localStorage.setItem('lerne_auth_v2_session', JSON.stringify({ access_token: 'test', refresh_token: 'test' }));
  });
  await page.route('**/api/card-notes/**', async route => {
    const parts = new URL(route.request().url()).pathname.split('/');
    if (route.request().method() === 'GET') return route.fulfill({ json: [...server.values()] });
    const data = route.request().postDataJSON();
    const old = server.get(parts[4]);
    const row = { id: parts[4], card_id: Number(parts[3]), user_id: 1,
      status: 'new', reply: '', revision: 1, seen_revision: 0, ...old, ...data };
    server.set(row.id, row);
    return route.fulfill({ json: row });
  });
  harnessPath = resolve(__dirname, '../../../app', `.card-notes-harness-${process.pid}-${++sequence}.jsx`);
  writeFileSync(harnessPath, `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { LanguageProvider } from '/src/i18n/i18nContext.jsx';
    import { useUiStore } from '/src/store/useUiStore.js';
    import { useDeckStore } from '/src/store/useDeckStore.js';
    import { StudyCard } from '/src/components/study/StudyCard.jsx';
    import { CardActionModal } from '/src/components/modals/CardActionModal.jsx';
    import { refreshCardNotes } from '/src/services/cardNotes.js';
    import { getLocalDb } from '/src/services/localDb.js';
    import { setInterfaceLanguage } from '/src/i18n/locale.js';
    import '/src/index.css'; import '/src/App.css';
    const card = { id: 9101, deck_id: 91, front: 'Erzähle von deinen Erfahrungen.', back: 'Расскажите о своём опыте.', target_language: 'de', level: 'B1', creator_name: 'Автор' };
    const deck = { id: 91, name: 'Немецкий', role: 'viewer', target_language: 'de' };
    useDeckStore.setState({ currentDeck: deck, deckCards: [card] });
    useUiStore.setState({ userProfile: { user_id: 1 } });
    window.refreshNotes = () => refreshCardNotes(card.id);
    window.localNotes = () => getLocalDb().card_notes.toArray();
    window.setLocale = setInterfaceLanguage;
    function Harness() {
      const open = useUiStore(s => s.isCardActionModalOpen);
      const [flipped, flip] = React.useState(false);
      return <div className="app-container"><StudyCard card={card} isFlipped={flipped} onFlip={flip}
        audioControls={{}} styles={{cardFont:'Inter', cardFontSize:1.5}} />
        {open && <CardActionModal isOpen card={card} decks={[deck]} folders={[]}
          onClose={() => useUiStore.getState().setIsCardActionModalOpen(false)} />}</div>;
    }
    createRoot(document.getElementById('root')).render(<LanguageProvider><Harness /></LanguageProvider>);
  `);
  await page.route('**/notes-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script>
    <script type="module" src="/${basename(harnessPath)}"></script></body></html>` }));
  await page.goto('/notes-harness');
  await expect(page.locator('.study-card-actions-button')).toBeVisible();
  return { server, errors };
}

async function openNotes(page) {
  await page.getByRole('button', { name: 'Действия с карточкой', exact: true }).click();
  await page.getByRole('button', { name: 'Заметки и предложения', exact: true }).click();
}

test('private note CRUD, durable offline queue, retry, and menu order', async ({ page, context }) => {
  const { server, errors } = await setup(page, context);
  await expect(page.locator('.study-card-info-button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Действия с карточкой', exact: true }).click();
  expect(await page.locator('.action-grid > button').allTextContents()).toEqual([
    'ПоделитьсяОтправить ссылку в Telegram', 'Заметки и предложения', 'Информация о карточке',
  ]);
  await page.getByRole('button', { name: 'Заметки и предложения', exact: true }).click();
  await expect(page.getByText('Записей пока нет')).toBeVisible();
  await page.getByLabel('Новая запись').fill('Черновик заметки');
  await page.getByRole('button', { name: 'Предложение по улучшению', exact: true }).click();
  await expect(page.getByLabel('Новая запись')).toHaveValue('');
  await page.getByRole('button', { name: 'Личная заметка', exact: true }).click();
  await expect(page.getByLabel('Новая запись')).toHaveValue('Черновик заметки');
  await context.setOffline(true);
  await page.getByLabel('Новая запись').fill('Личная заметка: проверить сложное немецкое предложение');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.card-notes-entry')).toContainText('Личная заметка:');
  await expect(page.getByText('Ожидает синхронизации')).toBeVisible();
  expect(server.size).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.study-card-actions-button .card-note-dot')).toBeVisible();
  await expect(page.locator('.study-card-actions-button .card-note-dot')).not.toHaveClass(/unread/);
  await context.setOffline(false);
  await page.evaluate(() => window.refreshNotes());
  await expect.poll(() => server.size).toBe(1);
  await page.reload(); await openNotes(page);
  await expect(page.locator('.card-notes-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.getByLabel('Редактировать запись').fill('Обновлённая личная заметка');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.card-notes-entry')).toContainText('Обновлённая личная заметка');
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.locator('.card-notes-entry')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.study-card-actions-button .card-note-dot')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('moderation reply pulses until viewed, persists read state, and respects reduced motion', async ({ page, context }) => {
  const { server, errors } = await setup(page, context);
  await openNotes(page);
  await page.getByRole('button', { name: 'Предложение по улучшению', exact: true }).click();
  await page.getByLabel('Новая запись').fill('Исправьте опечатку');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.card-notes-entry')).toContainText('Новое');
  await page.keyboard.press('Escape');
  const row = [...server.values()][0];
  Object.assign(row, { status: 'fixed', reply: 'Спасибо, исправлено.', revision: 2 });
  await page.evaluate(() => window.refreshNotes());
  const dot = page.locator('.study-card-actions-button .card-note-dot');
  await expect(dot).toHaveClass(/unread/);
  await expect(dot).toHaveCSS('animation-duration', '3s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dot).toHaveCSS('animation-name', 'none');
  await page.getByRole('button', { name: 'Действия с карточкой', exact: true }).click();
  await expect(page.locator('.action-menu-item .card-note-dot')).toHaveClass(/unread/);
  await page.getByRole('button', { name: 'Заметки и предложения', exact: true }).click();
  // The default personal-note mode must not consume an unread suggestion.
  await expect.poll(() => row.seen_revision).toBe(1);
  await page.getByRole('button', { name: 'Предложение по улучшению', exact: true }).click();
  await expect(page.locator('.card-notes-reply')).toContainText('Спасибо, исправлено.');
  await expect.poll(() => server.get(row.id).seen_revision).toBe(2);
  await page.keyboard.press('Escape');
  await expect(dot).toHaveCount(0);
  await page.reload(); await expect(dot).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('notes and information fit mobile/tablet/desktop and keep keyboard focus inside the dialog', async ({ page, context }, info) => {
  const { errors } = await setup(page, context);
  for (const width of [320, 375, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await openNotes(page);
    await page.getByLabel('Новая запись').fill('Заметка для длинного текста '.repeat(12));
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator('.card-notes-entry').last()).toBeVisible();
    const fits = await page.getByRole('dialog').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.height <= innerHeight && el.scrollWidth <= el.clientWidth;
    });
    expect(fits).toBe(true);
    await page.getByRole('dialog').screenshot({ path: info.outputPath(`notes-${width}.png`) });
    await page.getByRole('button', { name: 'Закрыть', exact: true }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Назад', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.study-card-actions-button')).toBeFocused();
  }
  await page.evaluate(() => window.setLocale('en'));
  await page.locator('.study-card-actions-button').click();
  await page.getByRole('button', { name: 'Notes and suggestions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Personal note', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
