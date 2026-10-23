const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z4AdMOEQH6QSAM1BAQ/oQeJvAAAAAElFTkSuQmCC', 'base64');

function wav() {
  const buffer = Buffer.alloc(844, 128);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(836, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(8000, 28);
  buffer.writeUInt16LE(1, 32); buffer.writeUInt16LE(8, 34); buffer.write('data', 36);
  buffer.writeUInt32LE(800, 40);
  return buffer;
}

async function sources(testInfo, prefix, media = true, existing = false) {
  const dir = testInfo.outputPath('folder');
  await fs.mkdir(path.join(dir, 'D01_Медиа', 'images'), { recursive: true });
  await fs.mkdir(path.join(dir, 'D01_Медиа', 'audio'), { recursive: true });
  for (let i = 1; i <= 10; i++) {
    const name = i === 1 && existing ? 'Существующая колода' : `${prefix} ${i} · Grundlagen und häufig verwendete Ausdrücke`;
    await fs.writeFile(path.join(dir, `D${String(i).padStart(2, '0')}.txt`), `# Deck: ${name}\nFRONT:\nGuten Morgen\nBACK:\nДоброе утро\nCONTEXT:\n`);
  }
  if (media) {
    await fs.writeFile(path.join(dir, 'D01_Медиа', 'images', 'one.png'), png);
    await fs.writeFile(path.join(dir, 'D01_Медиа', 'audio', 'one.wav'), wav());
    await fs.writeFile(path.join(dir, 'D01_Медиа', 'media_manifest.json'), JSON.stringify({
      schema_version: 1, deck_file: '../D01.txt', bindings: [{ card_number: 1, image: 'images/one.png', audio_front: 'audio/one.wav' }],
    }));
  }
  return dir;
}

async function setup(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://unpkg.com/**', route => route.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
  await page.route('https://cdn.tailwindcss.com/**', async route => {
    const cached = path.join(root, 'scratch', 'admin-import-assets', 'tailwind.js');
    try { await route.fulfill({ path: cached, contentType: 'text/javascript' }); }
    catch { await route.continue(); }
  });
  await page.goto('/');
  await page.locator('#tab-author').click();
  await expect(page.locator('#author-publish-folder-select option')).not.toHaveCount(0);
  return errors;
}

for (const width of [1280, 1440, 1920]) test(`desktop folder selection, preview and confirmation at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const errors = await setup(page);
  const sent = [];
  page.on('request', request => {
    if (request.url().includes('/folder-import/')) sent.push(request.postDataBuffer().toString());
  });
  const directory = await sources(testInfo, `Ширина ${width}`);
  await page.locator('#folder-import-input').setInputFiles(directory);
  await expect(page.locator('#folder-import-list input')).toHaveCount(10);
  expect(sent).toHaveLength(0);
  await expect(page.locator('#folder-import-apply-button')).toBeDisabled();
  await page.getByRole('button', { name: 'Выбрать все', exact: true }).click();
  await expect(page.locator('#folder-import-list input:checked')).toHaveCount(10);
  await page.getByRole('button', { name: 'Снять выбор', exact: true }).click();
  await page.locator('#folder-import-list input').first().check();
  await page.locator('#folder-import-preview-button').click();
  await expect(page.locator('#folder-import-apply-button')).toBeEnabled();
  await expect(page.locator('#folder-import-preview')).toContainText('Новые карточки: 1');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('D01.txt');
  expect(sent[0]).not.toContain('D02.txt');
  expect(sent[0]).toContain('one.png');
  const panel = page.locator('#folder-import-panel');
  const size = await panel.evaluate(e => [e.scrollWidth, e.clientWidth]);
  expect(size[0]).toBeLessThanOrEqual(size[1] + 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath(`preview-${width}.png`), fullPage: true });
  await page.locator('#folder-import-apply-button').click();
  await expect(page.locator('#folder-import-status')).toContainText('Готово. Новых карточек: 1');
  await page.locator('#folder-import-preview-button').click();
  await expect(page.locator('#folder-import-preview')).toContainText('Новые карточки: 0');
  await expect(page.locator('#folder-import-apply-button')).toBeEnabled();
  await page.locator('#folder-import-mode').selectOption('media');
  await expect(page.locator('#folder-import-apply-button')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('media-only manual match, file conflict, missing file and response-loss retry', async ({ page }, testInfo) => {
  await setup(page);
  const directory = await sources(testInfo, 'Обновление', true, true);
  await page.locator('#folder-import-input').setInputFiles(directory);
  await page.locator('#folder-import-list input').first().check();
  await page.locator('#folder-import-mode').selectOption('media');
  await page.locator('#folder-import-preview-button').click();
  await expect(page.locator('#folder-import-preview')).toContainText('выберите существующую карточку');
  await expect(page.locator('#folder-import-apply-button')).toBeDisabled();
  await page.getByRole('combobox', { name: 'Сопоставление Существующая колода, карточка 1' }).selectOption('1');
  await page.locator('#folder-import-preview-button').click();
  await expect(page.locator('#folder-import-preview')).toContainText('существующее медиа');
  await page.getByRole('combobox', { name: 'Медиа Существующая колода, карточка 1, image', exact: true }).selectOption('replace');
  await page.locator('#folder-import-preview-button').click();
  await expect(page.locator('#folder-import-apply-button')).toBeEnabled();
  let requestId;
  await page.route('**/folder-import/apply', async route => {
    const body = route.request().postDataBuffer().toString();
    requestId = body.match(/"request_id":"([^"]+)"/)[1];
    await route.fetch(); // The fixture commits; the browser loses the response.
    await route.abort('failed');
    await page.unroute('**/folder-import/apply');
  });
  await page.locator('#folder-import-apply-button').click();
  await expect(page.locator('#folder-import-status')).toContainText('Можно повторить подтверждение');
  const repeat = page.waitForRequest('**/folder-import/apply');
  await page.locator('#folder-import-apply-button').click();
  expect((await repeat).postDataBuffer().toString()).toContain(requestId);
  await expect(page.locator('#folder-import-status')).toContainText('Готово. Новых карточек: 0');
  await fs.unlink(path.join(directory, 'D01_Медиа', 'audio', 'one.wav'));
  await page.locator('#folder-import-input').setInputFiles(directory);
  await page.locator('#folder-import-list input').first().check();
  await page.locator('#folder-import-preview-button').click();
  await expect(page.locator('#folder-import-preview')).toContainText('отсутствующий файл');
  await expect(page.locator('#folder-import-apply-button')).toBeDisabled();
});

test('three selected decks without media and legacy selector restoration', async ({ page }, testInfo) => {
  await setup(page);
  const directory = await sources(testInfo, 'Три колоды', false);
  await page.locator('#folder-import-input').setInputFiles(directory);
  for (const index of [1, 4, 7]) await page.locator('#folder-import-list input').nth(index).check();
  await page.locator('#folder-import-preview-button').click();
  await expect(page.locator('#folder-import-preview')).toContainText('Колоды: 3');
  await page.locator('#folder-import-apply-button').click();
  await expect(page.locator('#folder-import-status')).toContainText('Готово. Новых карточек: 3');
  await page.getByRole('button', { name: 'Обычные файлы / текст', exact: true }).click();
  await expect(page.locator('#author-publish-dropzone-wrap')).toBeVisible();
  await expect(page.locator('#author-publish-result-wrap #author-publish-target-box')).toHaveCount(1);
});
