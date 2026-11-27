const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const WORKTREE_ROOT = path.resolve(__dirname, '../../..');
const APP_DIR = path.join(WORKTREE_ROOT, 'app');
const TEST_DATA_DIR = path.join(WORKTREE_ROOT, 'local', 'test-data');
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

function makePcm16Base64(frames = 2400) {
  const buf = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    buf.writeInt16LE(((i % 100) - 50) * 200, i * 2);
  }
  return buf.toString('base64');
}

function geminiResponse(url, request) {
  if (url.pathname.includes('preview-tts')) {
    return { inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: makePcm16Base64() } };
  }
  const system = request.systemInstruction?.parts?.[0]?.text || '';
  const prompt = request.contents?.[0]?.parts?.[0]?.text || '';
  if (prompt === 'ping') return { text: '{"ok":true}' };
  if (prompt.includes('phrases')) {
    return { text: JSON.stringify({
      cards: [
        { prompt: 'der Bahnhof', answer: 'вокзал', explanation: 'Вокзал', level: 'A1' },
        { prompt: 'abfahren', answer: 'отправляться', explanation: 'Отделяемая приставка ab-', level: 'A2' },
      ],
    }) };
  }
  const explanation = system.includes('Analyze the provided Native V2 flashcard')
    ? 'E2E AI объяснение: der Zug (ед. ч.).'
    : 'Первичный контекст от Gemini.';
  return { text: JSON.stringify({
    schema_version: 2,
    card: {
      type: 'standard',
      data: { prompt: 'der Zug', answer: 'поезд' },
      info: [],
      explanation,
      level: 'A2',
    },
  }) };
}

async function main() {
  process.env.LERNE_MODE = '';
  process.env.VITE_LERNE_STANDALONE = '1';
  process.env.VITE_LERNE_LOCAL = '0';
  const { createServer } = await import(pathToFileURL(require.resolve('vite', { paths: [APP_DIR] })).href);
  const server = await createServer({
    root: APP_DIR,
    envFile: false,
    cacheDir: path.join(TEST_DATA_DIR, 'standalone-ai-tts-vite'),
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  const pageErrors = [];
  const forbiddenRequests = [];
  let context;
  let profileDir;
  try {
    await server.listen();
    const baseUrl = new URL(server.resolvedUrls.local[0]).origin;
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
    profileDir = fs.mkdtempSync(path.join(fs.realpathSync(TEST_DATA_DIR), 'standalone-ai-tts-profile-'));
    const openPage = async (mockGemini) => {
      context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 375, height: 812 },
        serviceWorkers: 'block',
      });
      await context.addInitScript(() => {
        localStorage.setItem('native_language', 'ru');
        localStorage.setItem('lerne_onboarding_completed', 'true');
      });
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (mockGemini && url.origin === GEMINI_ORIGIN && url.pathname.endsWith(':generateContent') && request.method() === 'POST') {
          const part = geminiResponse(url, request.postDataJSON());
          return route.fulfill({ json: { candidates: [{ content: { parts: [part] } }] } });
        }
        if (url.origin === baseUrl && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__')) {
          return route.continue();
        }
        forbiddenRequests.push(url.origin + url.pathname);
        return route.abort();
      });
      const tab = context.pages()[0] || await context.newPage();
      tab.setDefaultTimeout(15000);
      tab.on('pageerror', (err) => pageErrors.push(err.message));
      await tab.goto(baseUrl, { waitUntil: 'networkidle' });
      return tab;
    };

    // 1. Open Standalone Settings -> configure shared Gemini API key & verify connection
    let page = await openPage(true);
    assert.equal(await page.locator('meta[name="lerne-android-mode"]').getAttribute('content'), 'offline-pilot');
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).waitFor({ state: 'visible' });
    await page.locator('.settings-trigger-btn, button[title*="Настройки"], [aria-label*="Настройки"]').first().click();
    await page.locator('#settings-tab-select').selectOption('ai');
    const secretKey = 'AIzaE2ESecretDoNotPersist12345';
    await page.locator('#standalone-ai-key-input').fill(secretKey);
    await page.locator('#standalone-ai-save-key-btn').click();
    await page.locator('#standalone-ai-test-btn').click();
    await page.getByText(/gemini\/gemini-2\.5-flash: OK/).waitFor({ state: 'visible' });

    // Assert VoiceTab recognizes shared Gemini key when Gemini TTS provider is selected
    await page.locator('#settings-tab-select').selectOption('voice');
    assert.equal(await page.locator('#standalone-tts-provider-select option[value="piper"]').count(), 0);
    await page.locator('#standalone-tts-provider-select').selectOption('gemini');
    await page.getByText(/Ключ Gemini настроен/).waitFor({ state: 'visible' });
    await page.locator('.settings-header .close-btn').last().click();

    // Assert zero plaintext secret key in localStorage or IndexedDB
    const leaked = await page.evaluate(async (needle) => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const val = localStorage.getItem(localStorage.key(i)) || '';
        if (val.includes(needle)) return `localStorage:${localStorage.key(i)}`;
      }
      const dbs = indexedDB.databases ? await indexedDB.databases() : [{ name: 'LerneStandaloneDB_900001' }];
      for (const info of dbs) {
        if (!info.name) continue;
        const found = await new Promise((resolve) => {
          const req = indexedDB.open(info.name);
          req.onsuccess = () => {
            const db = req.result;
            const stores = [...db.objectStoreNames];
            if (!stores.length) { db.close(); return resolve(null); }
            const tx = db.transaction(stores, 'readonly');
            Promise.all(stores.map((s) => new Promise((res) => {
              const r = tx.objectStore(s).getAll();
              r.onsuccess = () => res(JSON.stringify(r.result || []));
              r.onerror = () => res('');
            }))).then((chunks) => {
              db.close();
              resolve(chunks.some((c) => c.includes(needle)) ? `idb:${info.name}` : null);
            });
          };
          req.onerror = () => resolve(null);
        });
        if (found) return found;
      }
      return null;
    }, secretKey);
    assert.equal(leaked, null, `Browser API key must stay in session memory, found in ${leaked}`);

    // 2. Open deck -> Create Native V2 card with AI + Gemini TTS WAV audio
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-list').click();
    await page.locator('#tut-fab-add').click();
    await page.locator('#card-editor-front').fill('der Zug');
    await page.locator('.btn-ai-generate:not(.secondary-action-btn)').click();
    await page.waitForFunction(() => document.querySelector('#card-editor-back')?.value === 'поезд');
    await page.getByText('Медиа и оформление', { exact: true }).click();
    await page.locator('.btn-audio').first().click();
    await page.getByText('Озвучка обновлена').first().waitFor({ state: 'visible' });
    await page.locator('.btn-save-action').first().click();
    await page.getByText('der Zug').first().waitFor({ state: 'visible' });

    // 3. Batch create from phrase list via BatchCardModal
    await page.locator('button[title="Пакетная генерация карточек"]').click();
    await page.locator('.settings-modal textarea').fill('der Bahnhof\nabfahren');
    await page.getByRole('button', { name: /Сгенерировать \(2\)/ }).click();
    await page.getByText(/Успешно добавлено карточек:/).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.getByText('der Bahnhof').first().waitFor({ state: 'visible' });

    // Restart Chromium with the same profile and block all external requests.
    await context.close();
    context = null;
    page = await openPage(false);
    await page.locator('.settings-trigger-btn, button[title*="Настройки"], [aria-label*="Настройки"]').first().click();
    await page.locator('#settings-tab-select').selectOption('ai');
    await page.locator('#standalone-ai-key-status').filter({ hasText: /^Не задан$/ }).waitFor();
    await page.locator('.settings-header .close-btn').last().click();
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-list').click();
    await page.getByText('der Zug').first().waitFor({ state: 'visible' });

    // The generated WAV must still be linked to the saved card after reopening.
    const hasSavedAudio = await page.evaluate(async () => {
      const req = indexedDB.open('LerneStandaloneDB_900001');
      return new Promise((resolve) => {
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['cards', 'media'], 'readonly');
          const cardsReq = tx.objectStore('cards').getAll();
          const mediaReq = tx.objectStore('media').getAll();
          tx.oncomplete = () => {
            const zug = (cardsReq.result || []).find((c) => c.content_v2?.card?.data?.prompt === 'der Zug');
            const matchingMedia = (mediaReq.result || []).find((m) => m.url === zug?.audio_path);
            db.close();
            resolve(Boolean(zug?.audio_path?.endsWith('.wav') && matchingMedia?.blob?.size >= 128));
          };
        };
      });
    });
    assert.equal(hasSavedAudio, true, 'Saved Gemini TTS WAV audio must persist in IndexedDB across browser restart');

    // Verify zero requests to Lerne backend or Supabase
    assert.deepEqual(forbiddenRequests, []);
    assert.deepEqual(pageErrors, []);
    console.log('STANDALONE AI & TTS E2E PASS: keys memory-only, AI create + batch create + Gemini TTS WAV offline persistence verified.');
  } finally {
    await context?.close().catch(() => {});
    await server.close();
    if (profileDir && path.dirname(fs.realpathSync(profileDir)) === fs.realpathSync(TEST_DATA_DIR)) {
      fs.rmSync(profileDir, { recursive: true, maxRetries: 3 });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
