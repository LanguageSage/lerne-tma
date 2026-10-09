const { test, expect } = require('@playwright/test');

async function setup(page, context, locale = 'ru') {
  const backend = { published: { config: { schemaVersion: 2, global: { appBg: '#101522' }, front: { mainText: { color: '#ffeedd' } } }, revision: 1 }, draft: null, writes: [], fail: false };
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
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/init') return route.fulfill({ json: { decks: [], folders: [], settings: {}, prompts: {}, user_settings: {}, user_info: { user_id: 1, is_guest: false }, is_admin: true, global_design_v2: backend.published } });
    if (pathname === '/api/admin/design/draft') {
      if (request.method() === 'GET') return route.fulfill({ json: backend.draft ? { config: backend.draft } : {} });
      backend.writes.push('draft');
      if (backend.fail) return route.fulfill({ status: 500, json: { detail: 'Test save failure' } });
      backend.draft = request.postDataJSON().config;
      return route.fulfill({ json: { config: backend.draft } });
    }
    if (pathname === '/api/admin/design/publish') {
      backend.writes.push('publish');
      if (backend.fail) return route.fulfill({ status: 500, json: { detail: 'Test publish failure' } });
      backend.published = { config: request.postDataJSON().config, revision: backend.published.revision + 1 };
      return route.fulfill({ json: backend.published });
    }
    if (pathname === '/api/decks' || pathname === '/api/folders' || pathname === '/api/cards/duplicates') return route.fulfill({ json: [] });
    if (pathname === '/api/auth/v2/me') return route.fulfill({ json: { user_id: 1, is_guest: false } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--design-app-bg') === '#101522');
  await openEditor(page);
  await expect(page.locator('.design-general-preview')).toBeVisible();
  return backend;
}
async function openEditor(page) {
  await page.locator('.settings-btn').click();
  await page.locator('#settings-tab-select').selectOption('design');
}
const rootBg = page => page.evaluate(() => document.documentElement.style.getPropertyValue('--design-app-bg'));
const previewBg = page => page.locator('.design-general-preview').evaluate(e => getComputedStyle(e).background);
const nav = (page, name) => page.locator('.design-editor-nav').getByRole('button', { name, exact: true });
async function patch(page, path, value) {
  await page.evaluate(async ({path, value}) => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    useSettingsStore.getState().patchAdminDraft(path, value);
  }, {path, value});
}

test('JSON, draft persistence, server load, revert and explicit publication keep root isolated', async ({ page, context }) => {
  const backend = await setup(page, context);
  await expect(page.getByLabel('Режим фона')).toHaveValue('legacy');
  expect(await rootBg(page)).toBe('#101522');
  await page.getByLabel('Режим фона').selectOption('linear');
  await page.getByLabel('Оттенок 1', { exact: true }).fill('#223344');
  await page.getByLabel('Количество оттенков').selectOption('2');
  expect(await previewBg(page)).toContain('34, 51, 68');
  expect(await rootBg(page)).toBe('#101522');
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.locator('.design-toolbar-status')).toHaveText('Черновик сохранён');
  expect(backend.draft.global.background.color1).toBe('#223344');
  expect(backend.published.revision).toBe(1);
  await page.reload();
  await openEditor(page);
  await expect(page.getByLabel('Режим фона')).toHaveValue('linear');
  expect(await rootBg(page)).toBe('#101522');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Экспорт JSON', exact: true }).click();
  const download = await downloadPromise;
  const fs = require('node:fs');
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(exported.global.background.color1).toBe('#223344');
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('.design-toolbar-status')).toHaveText('Некорректный JSON: черновик не изменён');
  await page.locator('input[type=file]').setInputFiles({ name: 'design.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...exported, global: { ...exported.global, background: { ...exported.global.background, color1: '#556677' } } })) });
  await expect(page.locator('.design-toolbar-status')).toHaveText('JSON импортирован в черновик');
  expect(await rootBg(page)).toBe('#101522');
  await page.getByRole('button', { name: 'Опубликовать для всех', exact: true }).click();
  expect(backend.writes).not.toContain('publish');
  await page.locator('.design-toolbar').getByRole('button', { name: '✕ Нет', exact: true }).click();
  expect(await rootBg(page)).toBe('#101522');
  await page.getByRole('button', { name: 'Опубликовать для всех', exact: true }).click();
  await page.locator('.design-toolbar-publish-confirm').click();
  await expect(page.getByRole('button', { name: 'Опубликовано!', exact: true })).toBeVisible();
  expect(await rootBg(page)).toContain('#556677');
  expect(backend.published.revision).toBe(2);
  expect(backend.published.config.front.mainText.color).toBe('#ffeedd');
  await patch(page, 'global.background.color1', '#abcdef');
  await page.getByRole('button', { name: 'Вернуть опубликованный', exact: true }).click();
  expect(await previewBg(page)).toContain('85, 102, 119');
  await page.getByRole('button', { name: 'Сбросить раздел', exact: true }).click();
  expect(await rootBg(page)).toContain('#556677');
  await page.evaluate(async () => {
    const { useSettingsStore } = await import('/src/store/useSettingsStore.js');
    await useSettingsStore.getState().loadAdminDraftFromServer();
  });
  expect(await rootBg(page)).toContain('#556677');
  await expect(page.getByLabel('Режим фона')).toHaveValue('linear');
});

test('save/publish failures preserve draft and published design', async ({ page, context }) => {
  const backend = await setup(page, context);
  backend.fail = true;
  await page.getByLabel('Режим фона').selectOption('solid');
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.locator('.design-toolbar-status')).toHaveText('Test save failure');
  await page.getByRole('button', { name: 'Опубликовать для всех', exact: true }).click();
  await page.locator('.design-toolbar-publish-confirm').click();
  await expect(page.getByRole('alert')).toHaveText('Test publish failure');
  expect(await rootBg(page)).toBe('#101522');
  await expect(page.getByLabel('Режим фона')).toHaveValue('solid');
});

test('surface, typography, details and both button states reach real preview components', async ({ page, context }) => {
  await setup(page, context);
  await nav(page, 'Панели и стекло').click();
  await page.getByLabel('Цвет поверхности', { exact: true }).fill('#123456');
  await page.getByLabel('Непрозрачность поверхности').fill('0.6');
  await page.getByLabel('Размытие фона').fill('0');
  await page.getByLabel('Цвет рамок', { exact: true }).fill('#abcdef');
  await page.getByLabel('Непрозрачность рамок').fill('0.4');
  await page.getByLabel('Скругление панелей').fill('24');
  await page.getByLabel('Интенсивность тени', { exact: true }).fill('0.5');
  await page.getByLabel('Внутренний световой блик').fill('0.2');
  await expect(page.locator('.design-general-preview .deck-card').first()).toHaveCSS('border-top-color', 'rgba(171, 205, 239, 0.4)');
  await expect(page.locator('.design-general-preview .deck-card').first()).toHaveCSS('box-shadow', /rgba\(255, 255, 255, 0.2\)/);
  const surface = await page.locator('.design-general-preview .deck-card').first().evaluate(e => {
    const s = getComputedStyle(e); return { bg: s.backgroundColor, radius: s.borderRadius, border: s.borderTopColor, blur: s.backdropFilter, shadow: s.boxShadow };
  });
  expect(surface).toEqual(expect.objectContaining({ bg: 'rgba(18, 52, 86, 0.6)', radius: '24px', border: 'rgba(171, 205, 239, 0.4)', blur: 'blur(0px)' }));
  expect(surface.shadow).toContain('0.2');
  await nav(page, 'Типографика интерфейса').click();
  await page.getByLabel('Цвет заголовков', { exact: true }).fill('#ffaa00');
  await page.getByLabel('Цвет основного текста', { exact: true }).fill('#aabbcc');
  await page.getByLabel('Цвет второстепенного текста', { exact: true }).fill('#778899');
  await page.getByLabel('Размер заголовков').fill('2');
  await page.getByLabel('Размер служебного текста').fill('1');
  await page.getByLabel('Межстрочный интервал', { exact: true }).fill('1.8');
  await nav(page, 'Акценты и детали').click();
  await page.getByLabel('Информационные метки', { exact: true }).fill('#ffcc11');
  await page.getByLabel('Нейтральные иконки', { exact: true }).fill('#1122ff');
  await page.getByLabel('Разделители', { exact: true }).fill('#445566');
  await page.getByLabel('Экран предпросмотра').selectOption('course');
  await expect(page.locator('.deck-intro-title')).toHaveCSS('color', 'rgb(255, 170, 0)');
  await expect(page.locator('.deck-intro-desc')).toHaveCSS('color', 'rgb(170, 187, 204)');
  await expect(page.locator('.deck-intro-topic-badge')).toHaveCSS('color', 'rgb(255, 204, 17)');
  await nav(page, 'Кнопки').click();
  await page.getByLabel('Фон кнопки', { exact: true }).selectOption('solid');
  await page.getByLabel('Фон: оттенок 1', { exact: true }).fill('#005544');
  await page.getByLabel('Цвет текста кнопки', { exact: true }).fill('#ffccaa');
  await page.getByLabel('Цвет иконок кнопки', { exact: true }).fill('#ccff11');
  await page.getByLabel('Толщина рамки кнопки').fill('3');
  await page.getByLabel('Высота кнопки').fill('64');
  await expect(page.locator('.deck-intro-btn-start')).toHaveCSS('background-color', 'rgb(0, 85, 68)');
  await expect(page.locator('.deck-intro-btn-start')).toHaveCSS('border-top-width', '3px');
  await expect(page.locator('.deck-intro-btn-start')).toHaveCSS('min-height', '64px');
  await expect(page.locator('.deck-intro-btn-start svg')).toHaveCSS('color', 'rgb(204, 255, 17)');
  await page.getByLabel('Состояние кнопки').selectOption('hover');
  await page.getByLabel('Фон кнопки', { exact: true }).selectOption('solid');
  await page.getByLabel('Фон: оттенок 1', { exact: true }).fill('#aa2244');
  const sample = page.locator('.design-button-samples .design-ui-button-primary:not(:disabled)');
  await sample.hover();
  await expect(sample).toHaveCSS('background-color', 'rgb(170, 34, 68)');
  await page.getByLabel('Состояние кнопки').selectOption('pressed');
  await page.getByLabel('Фон кнопки', { exact: true }).selectOption('solid');
  await page.getByLabel('Фон: оттенок 1', { exact: true }).fill('#2233aa');
  await sample.hover();
  await page.mouse.down();
  await expect(sample).toHaveCSS('background-color', 'rgb(34, 51, 170)');
  await page.mouse.up();
  await page.getByLabel('Состояние кнопки').selectOption('disabled');
  await page.getByLabel('Фон: оттенок 1', { exact: true }).fill('#334455');
  await expect(page.locator('.design-button-samples .design-ui-button-primary:disabled')).toHaveCSS('background-color', 'rgb(51, 68, 85)');
  await page.getByLabel('Вид кнопки').selectOption('secondary');
  await page.getByLabel('Состояние кнопки').selectOption('normal');
  await page.getByLabel('Фон: оттенок 1', { exact: true }).fill('#113355');
  await expect(page.locator('.deck-intro-btn-list')).toHaveCSS('background-color', 'rgb(17, 51, 85)');
  const before = await page.evaluate(async () => {
    const {useUiStore} = await import('/src/store/useUiStore.js');
    const {useDeckStore} = await import('/src/store/useDeckStore.js');
    return { view: useUiStore.getState().view, deck: useDeckStore.getState().currentDeck };
  });
  await page.locator('.deck-intro-btn-start').click();
  const after = await page.evaluate(async () => {
    const {useUiStore} = await import('/src/store/useUiStore.js');
    const {useDeckStore} = await import('/src/store/useDeckStore.js');
    return { view: useUiStore.getState().view, deck: useDeckStore.getState().currentDeck };
  });
  expect(after).toEqual(before);
  await page.getByLabel('Экран предпросмотра').selectOption('ordinary');
  await expect(page.locator('.deck-intro-title')).toHaveText('Alltag: Wörter und Ausdrücke');
  await expect(page.locator('.deck-intro-section')).toHaveCount(0);
  await page.getByLabel('Экран предпросмотра').selectOption('completion');
  await expect(page.locator('.lesson-completion-title')).toHaveCSS('color', 'rgb(255, 170, 0)');
  await expect(page.locator('.lesson-completion-btn-primary')).toHaveCSS('background-color', 'rgb(0, 85, 68)');
  expect(await rootBg(page)).toBe('#101522');
});

for (const width of [320, 375, 430, 768, 1080]) test(`four screens and all controls fit ${width}px; reduced motion`, async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page, context, width === 768 ? 'en' : 'ru');
  await patch(page, 'global.background.mode', 'radial');
  const screenSelect = page.locator('.design-preview-selectors select').first();
  for (const screen of ['home', 'course', 'ordinary', 'completion']) {
    await screenSelect.selectOption(screen);
    await expect(page.locator('.design-general-preview')).toBeVisible();
    await page.locator('.design-general-preview').screenshot({ path: testInfo.outputPath(`${screen}-${width}.png`) });
    await page.locator('.design-general-preview').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await page.locator('.design-general-preview').screenshot({ path: testInfo.outputPath(`${screen}-${width}-bottom.png`) });
    await page.locator('.design-general-preview').evaluate(e => { e.scrollTop = 0; });
    const overflow = await page.locator('.design-general-preview').evaluate(e => ({ scroll: e.scrollWidth, client: e.clientWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  }
  const reduced = await page.locator('.lesson-completion-btn-primary').evaluate(e => getComputedStyle(e).transitionDuration);
  expect(reduced).toBe('0s');
  for (const section of ['Фон приложения', 'Панели и стекло', 'Кнопки', 'Типографика интерфейса', 'Акценты и детали']) {
    // Select by stable section index for the English locale.
    const index = ['Фон приложения', 'Панели и стекло', 'Кнопки', 'Типографика интерфейса', 'Акценты и детали'].indexOf(section);
    await page.locator('.design-editor-nav button').nth(index).click();
    await page.locator('.design-editor-fields').screenshot({ path: testInfo.outputPath(`controls-${index}-${width}.png`) });
    const overflow = await page.locator('.settings-content').evaluate(e => ({ scroll: e.scrollWidth, client: e.clientWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  }
});


test('preview allows Tab navigation and shared button styling excludes SRS grades', async ({ page, context }) => {
  await setup(page, context);
  await page.getByLabel('Экран предпросмотра').selectOption('course');
  await page.locator('.deck-intro-btn-start').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.deck-intro-btn-list')).toBeFocused();
  const gradeColor = await page.evaluate(() => {
    const button = document.createElement('button');
    button.className = 'btn btn-primary btn-grade grade-0';
    document.body.append(button);
    const color = getComputedStyle(button).backgroundColor;
    button.remove();
    return color;
  });
  await patch(page, 'global.buttons.primary.normal.color1', '#ffffff');
  expect(gradeColor).toBe('rgba(239, 68, 68, 0.4)');
  const after = await page.evaluate(() => {
    const button = document.createElement('button');
    button.className = 'btn btn-primary btn-grade grade-0';
    document.querySelector('.design-general-preview').append(button);
    const color = getComputedStyle(button).backgroundColor;
    button.remove();
    return color;
  });
  expect(after).toBe(gradeColor);
});
