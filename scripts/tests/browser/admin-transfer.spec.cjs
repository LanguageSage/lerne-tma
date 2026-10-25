const { test, expect } = require('@playwright/test');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');

async function setup(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 500 && !(response.status() === 503 && response.url().endsWith('/transfer/preview'))) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  await page.route('https://unpkg.com/**', route => route.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
  await page.route('https://cdn.tailwindcss.com/**', route => route.fulfill({
    path: path.join(root, 'scratch/admin-import-assets/tailwind.js'), contentType: 'text/javascript' }));
  await page.route(/https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.tailwindcss\.com|unpkg\.com)/, route => route.abort());
  await page.goto('/');
  await page.locator('#tab-transfer').click();
  await expect(page.locator('#transfer-config')).toContainText('fixture');
  expect(await page.content()).not.toContain('must-never-appear-in-browser');
  return errors;
}

for (const width of [320, 375, 430, 768, 1440]) test(`selection, concrete preview and confirmation ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors = await setup(page);
  await page.locator('#transfer-direction').selectOption('publish');
  await page.locator('#transfer-kind').selectOption('card');
  await page.locator('#transfer-search').fill('Guten');
  await page.locator('#transfer-load').click();
  await page.locator('#transfer-catalog input').first().check();
  await expect(page.locator('#transfer-preview')).toBeEnabled();
  await page.locator('#transfer-preview').click();
  await expect(page.locator('#transfer-diff')).toContainText('Карточка');
  await page.locator('#transfer-diff details').last().locator('summary').click();
  await expect(page.locator('#transfer-diff')).toContainText('Guten Morgen');
  await expect(page.locator('#transfer-apply')).toBeDisabled();
  await page.locator('#transfer-confirmation').fill('wrong');
  await page.locator('#transfer-confirmed').check();
  await expect(page.locator('#transfer-apply')).toBeDisabled();
  await page.locator('#transfer-confirmation').fill('Supabase:fixture');
  await expect(page.locator('#transfer-apply')).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath(`preview-${width}.png`), fullPage: true });
  const sizes = await page.locator('#content-transfer').evaluate(el => [el.scrollWidth, el.clientWidth]);
  expect(sizes[0]).toBeLessThanOrEqual(sizes[1] + 1);
  await page.locator('#transfer-apply').click();
  await expect(page.locator('#transfer-status')).toContainText('Готово.', { timeout: 15000 });
  await expect(page.locator('#transfer-apply')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('single-card entry, loading, error and retry preserve selection', async ({ page }) => {
  await setup(page);
  await page.goto('/?publish_card=1');
  await expect(page.locator('#content-transfer')).toBeVisible();
  await expect(page.locator('#transfer-selection')).toContainText('#1');
  let fail = true;
  await page.route('**/api/admin/transfer/preview', route => fail ? route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Синтетическая ошибка. Повторите.' })
  }) : route.continue());
  await page.locator('#transfer-preview').click();
  await expect(page.locator('#transfer-status')).toContainText('Синтетическая ошибка');
  await expect(page.locator('#transfer-preview')).toBeEnabled();
  fail = false;
  await page.locator('#transfer-preview').click();
  await expect(page.locator('#transfer-summary')).toContainText('Без изменений');
  await page.locator('#transfer-mode').selectOption('force');
  await expect(page.locator('#transfer-preview-panel')).toBeHidden();
});

test('download has a visible start button after the background check', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  const errors = await setup(page);
  await expect(page.locator('#transfer-catalog input').first()).toBeVisible();
  await page.locator('#transfer-catalog input').first().check();
  await page.locator('#transfer-preview').click();
  await expect(page.locator('#transfer-summary')).toContainText('Создать');
  const panelTop = await page.locator('#transfer-preview-panel').evaluate(el => el.getBoundingClientRect().top);
  const headerBottom = await page.locator('body > header').evaluate(el => el.getBoundingClientRect().bottom);
  expect(panelTop).toBeGreaterThanOrEqual(headerBottom);
  await expect(page.locator('#transfer-apply')).toHaveText('2. Начать копирование в LOCAL');
  await expect(page.locator('#transfer-apply')).toBeDisabled();
  await page.locator('#transfer-confirmation').fill('LOCAL:fixture');
  await page.locator('#transfer-confirmed').check();
  await expect(page.locator('#transfer-apply')).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('download-confirmation.png'), fullPage: true });
  await page.locator('#transfer-apply').click();
  await expect(page.locator('#transfer-status')).toContainText('Готово.', { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('oversized background preview displays its error in view and keeps selection', async ({ page }) => {
  await page.route('**/api/admin/transfer/catalog?**', route => {
    const direction = new URL(route.request().url()).searchParams.get('direction');
    return route.fulfill({ json: { items: direction === 'download' ? Array.from({ length: 50 }, (_, i) =>
      ({ id: i + 1, name: 'Длинная папка учебных материалов ' + i })) : [], has_more: false } });
  });
  await setup(page);
  await page.locator('#transfer-catalog input').last().check();
  await page.route('**/api/admin/transfer/preview', route => route.fulfill({ status: 202, json: { id: 'test-check' } }));
  let polls = 0;
  await page.route('**/api/admin/transfer/previews/test-check', route => route.fulfill({ json: ++polls === 1
    ? { status: 'running', elapsed: 12 } : { status: 'error', error: 'В пакете больше 2000 карточек. Выберите вложенную папку.' } }));
  await page.locator('#transfer-preview').click();
  await expect(page.locator('#transfer-status')).toContainText('Прошло 12 с.');
  await expect(page.locator('#transfer-preview')).toBeDisabled();
  await expect(page.locator('#transfer-status')).toContainText('больше 2000');
  await expect(page.locator('#transfer-status')).toBeInViewport();
  await expect(page.locator('#transfer-preview')).toBeEnabled();
  await expect(page.locator('#transfer-catalog input').last()).toBeChecked();
});

test('returning to transfer tab preserves the catalog without new requests', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().includes('/transfer/catalog?')) requests++; });
  await setup(page);
  await expect(page.locator('#transfer-catalog input').first()).toBeVisible();
  const count = await page.locator('#transfer-catalog input').count();
  const loaded = requests;
  await page.evaluate(() => switchTab('decks'));
  await page.locator('#tab-transfer').click();
  await expect(page.locator('#transfer-catalog input')).toHaveCount(count);
  expect(requests).toBe(loaded);
});

test('Author destination sends saved LOCAL deck into the existing transfer preview', async ({ page }, testInfo) => {
  const errors = await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#tab-author').click();
  await expect(page.locator('#tab-author')).toHaveClass(/bg-indigo-600/);
  await expect(page.locator('#tab-transfer')).not.toHaveClass(/bg-indigo-600/);
  await page.locator('#author-publish-destination').selectOption('both');
  await page.screenshot({ path: testInfo.outputPath('author-destination.png'), fullPage: true });
  await page.evaluate(() => {
    const folder = document.getElementById('author-publish-folder-select');
    folder.replaceChildren(new Option('A1 fixture', '1'));
    folder.value = '1';
    authorState.publish.isNewFolder = false;
    authorState.publish.parseResult = {
      cards: [{ front: 'Autor Transfer', back: 'Проверка', deck_name: 'Author destination fixture' }],
      passports: [], passport_errors: [],
    };
  });
  await page.evaluate(() => runAuthorPublish());
  await expect(page.locator('#content-transfer')).toBeVisible();
  await expect(page.locator('#transfer-direction')).toHaveValue('publish');
  await expect(page.locator('#transfer-selection')).toContainText('локальных колод: 1');
  await expect(page.locator('#transfer-diff')).toContainText('Author destination fixture');
  await expect(page.locator('#transfer-apply')).toBeDisabled();
  await page.locator('#transfer-confirmation').fill('Supabase:fixture');
  await page.locator('#transfer-confirmed').check();
  await page.locator('#transfer-apply').click();
  await expect(page.locator('#transfer-status')).toContainText('Готово.', { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('folder importer hands its receipt deck IDs to Material Transfer', async ({ page }) => {
  const errors = await setup(page);
  await page.locator('#tab-author').click();
  await page.locator('#author-publish-destination').selectOption('supabase');
  await page.route('**/api/admin/author/folder-import/apply', route => route.fulfill({ json: {
    status: 'success', created_cards: 1, updated_media: 0, folder_id: 1,
    folder_name: 'A1 fixture', deck_ids: [1],
  } }));
  await page.evaluate(() => {
    const folder = document.getElementById('author-publish-folder-select');
    folder.replaceChildren(new Option('A1 fixture', '1'));
    folder.value = '1';
    authorState.publish.isNewFolder = false;
    folderImport.files = new Map([['D01.txt', new File(['# Deck: Урок 1'], 'D01.txt')]]);
    folderImport.selected = new Set(['D01.txt']);
    folderImport.requestId = crypto.randomUUID();
    folderImport.preview = { plan: { can_apply: true, preview_token: 'fixture' }, payload: {
      selected: ['D01.txt'], mode: 'import', manifests: [], decisions: {}, media_choices: {}, target_folder_id: 1,
    } };
  });
  await page.evaluate(() => applyFolderImport());
  await expect(page.locator('#content-transfer')).toBeVisible();
  await expect(page.locator('#transfer-selection')).toContainText('ID: 1');
  await expect(page.locator('#transfer-preview-panel')).toBeVisible();
  await expect(page.locator('#transfer-apply')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('LOCAL author destination never starts a cloud transfer', async ({ page }) => {
  const errors = await setup(page);
  let cloudPreviews = 0;
  page.on('request', request => { if (request.url().endsWith('/api/admin/transfer/preview')) cloudPreviews++; });
  await page.locator('#tab-author').click();
  await expect(page.locator('#author-publish-destination')).toHaveValue('local');
  await page.evaluate(() => {
    const folder = document.getElementById('author-publish-folder-select');
    folder.replaceChildren(new Option('A1 fixture', '1'));
    folder.value = '1';
    authorState.publish.isNewFolder = false;
    authorState.publish.parseResult = {
      cards: [{ front: 'Nur Lokal', back: 'Только локально', deck_name: 'Author local fixture' }],
      passports: [], passport_errors: [],
    };
  });
  await page.evaluate(() => runAuthorPublish());
  await expect(page.locator('#author-publish-success-wrap')).toBeVisible();
  await expect(page.locator('#content-author')).toBeVisible();
  expect(cloudPreviews).toBe(0);
  expect(errors).toEqual([]);
});

test('disabled cloud gate rejects Author publication before LOCAL write', async ({ page }) => {
  await setup(page);
  await page.locator('#tab-author').click();
  await page.locator('#author-publish-destination').selectOption('supabase');
  await page.route('**/api/admin/transfer/config', route => route.fulfill({ json: {
    enabled: true, allow_cloud_write: false, project_ref: 'fixture', environment: 'staging',
  } }));
  let localWrites = 0;
  page.on('request', request => { if (request.url().endsWith('/api/admin/author/publish')) localWrites++; });
  await page.evaluate(() => {
    authorState.publish.parseResult = {
      cards: [{ front: 'Gate test', back: 'Проверка', deck_name: 'Blocked fixture' }],
      passports: [], passport_errors: [],
    };
  });
  await page.evaluate(() => runAuthorPublish());
  expect(localWrites).toBe(0);
  await expect(page.locator('#content-author')).toBeVisible();
  await expect(page.locator('#author-publish-success-wrap')).toBeHidden();
});
