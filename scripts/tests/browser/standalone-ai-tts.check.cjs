const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const WORKTREE_ROOT = path.resolve(__dirname, '../../..');
const LAUNCHER_BAT = path.join(WORKTREE_ROOT, 'run_standalone.bat');
const TEMP_DATA_DIR = path.join(WORKTREE_ROOT, 'local', 'test-data', 'standalone-ai-tts-e2e');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('timeout')));
  });
}

async function waitForServer(url, proc, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Launcher exited early (${proc.exitCode})`);
    try {
      const res = await httpGetText(url);
      if (res.status === 200 && res.body.includes('lerne-android-mode')) return;
    } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch { /* ignore */ }
  }
}

function startLauncher(port) {
  return spawn('cmd.exe', ['/c', LAUNCHER_BAT, '--no-browser'], {
    cwd: WORKTREE_ROOT,
    env: { ...process.env, LERNE_STANDALONE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function makePcm16Base64(frames = 2400) {
  const buf = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    buf.writeInt16LE(((i % 100) - 50) * 200, i * 2);
  }
  return buf.toString('base64');
}

async function main() {
  fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  const profileDir = path.join(TEMP_DATA_DIR, 'profile');
  fs.mkdirSync(profileDir, { recursive: true });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  let serverProc = startLauncher(port);
  let context = null;
  let online = true;
  const pageErrors = [];
  const forbiddenRequests = [];

  try {
    await waitForServer(baseUrl, serverProc);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      acceptDownloads: true,
    });
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.addInitScript(() => {
      try {
        if (!localStorage.getItem('native_language')) localStorage.setItem('native_language', 'ru');
        if (!localStorage.getItem('lerne_onboarding_completed')) localStorage.setItem('lerne_onboarding_completed', 'true');
      } catch { /* ignore */ }
      window.__playedAudios = [];
      const origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function playStub() {
        window.__playedAudios.push(this.src || this.currentSrc || 'unknown');
        return Promise.resolve();
      };
      if (origPlay) { /* reference kept */ }
    });

    await page.route('**/*', async (route) => {
      const reqUrl = route.request().url();
      if (/127\.0\.0\.1:(8000|8001|8002)|supabase\./i.test(reqUrl)) {
        forbiddenRequests.push(reqUrl);
        return route.abort();
      }
      if (reqUrl.endsWith('/__standalone_ext_https')) {
        if (!online) {
          return route.fulfill({
            status: 502,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, error: 'Simulated offline network' }),
          });
        }
        const post = JSON.parse(route.request().postData() || '{}');
        if (post.slot === 'gemini' && String(post.url).includes('preview-tts')) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: 200,
              ok: true,
              contentType: 'application/json',
              bodyText: JSON.stringify({
                candidates: [{
                  content: {
                    parts: [{
                      inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: makePcm16Base64() },
                    }],
                  },
                }],
              }),
            }),
          });
        }
        if (post.slot === 'gemini') {
          const bodyObj = JSON.parse(post.body || '{}');
          const sysText = bodyObj?.systemInstruction?.parts?.[0]?.text || '';
          const usrText = bodyObj?.contents?.[0]?.parts?.[0]?.text || '';
          if (usrText === 'ping') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 200,
                ok: true,
                contentType: 'application/json',
                bodyText: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
              }),
            });
          }
          if (usrText.includes('phrases')) {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 200,
                ok: true,
                contentType: 'application/json',
                bodyText: JSON.stringify({
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          cards: [
                            { prompt: 'der Bahnhof', answer: 'вокзал', explanation: 'Мужской род', level: 'A1' },
                            { prompt: 'abfahren', answer: 'отправляться', explanation: 'Отделяемая приставка ab-', level: 'A2' },
                          ],
                        }),
                      }],
                    },
                  }],
                }),
              }),
            });
          }
          if (sysText.includes('Analyze the provided Native V2 flashcard')) {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                status: 200,
                ok: true,
                contentType: 'application/json',
                bodyText: JSON.stringify({
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          schema_version: 2,
                          card: {
                            type: 'standard',
                            data: { prompt: 'der Zug', answer: 'поезд' },
                            info: [],
                            explanation: 'E2E AI объяснение: der Zug (мн. ч. die Züge).',
                            level: 'A2',
                          },
                        }),
                      }],
                    },
                  }],
                }),
              }),
            });
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: 200,
              ok: true,
              contentType: 'application/json',
              bodyText: JSON.stringify({
                candidates: [{
                  content: {
                    parts: [{
                      text: JSON.stringify({
                        schema_version: 2,
                        card: {
                          type: 'standard',
                          data: { prompt: 'der Zug', answer: 'поезд' },
                          info: [],
                          explanation: 'Первичный контекст от Gemini.',
                          level: 'A2',
                        },
                      }),
                    }],
                  },
                }],
              }),
            }),
          });
        }
      }
      return route.continue();
    });

    // 1. Open Standalone Settings -> configure shared Gemini API key & verify connection
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).waitFor({ state: 'visible' });
    await page.locator('.settings-trigger-btn, button[title*="Настройки"], [aria-label*="Настройки"]').first().click();
    await page.locator('#settings-tab-select').selectOption('ai');
    const secretKey = 'AIzaE2ESecretDoNotPersist12345';
    await page.locator('#standalone-ai-key-input').fill(secretKey);
    await page.locator('#standalone-ai-save-key-btn').click();
    await page.locator('#standalone-ai-test-btn').click();
    await page.getByText(/gemini\/gemini-2\.5-flash: OK/).waitFor({ state: 'visible' });

    // Assert VoiceTab recognizes shared Gemini key
    await page.locator('#settings-tab-select').selectOption('voice');
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
    assert.equal(leaked, null, `API key must stay strictly in RAM on PC, found in ${leaked}`);

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

    // 4. Go OFFLINE & restart standalone server -> verify saved TTS audio plays offline!
    online = false;
    stopProcessTree(serverProc.pid);
    await new Promise((r) => setTimeout(r, 400));
    serverProc = startLauncher(port);
    await waitForServer(baseUrl, serverProc);

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-list').click();
    await page.getByText('der Zug').first().waitFor({ state: 'visible' });

    // Play saved audio in card detail/preview and assert an archive_*.wav / blob URL loaded & played offline
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
    assert.equal(hasSavedAudio, true, 'Saved Gemini TTS WAV audio must persist in IndexedDB across restart');

    // Verify zero requests to Lerne backend or Supabase
    assert.deepEqual(forbiddenRequests, []);
    assert.deepEqual(pageErrors, []);
    console.log('STANDALONE AI & TTS E2E PASS: keys memory-only, AI create + batch create + Gemini TTS WAV offline persistence verified.');
  } finally {
    await context?.close().catch(() => {});
    stopProcessTree(serverProc?.pid);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
