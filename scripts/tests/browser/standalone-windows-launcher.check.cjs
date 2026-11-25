const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const WORKTREE_ROOT = path.resolve(__dirname, '../../..');
const LAUNCHER_BAT = path.join(WORKTREE_ROOT, 'run_standalone.bat');
const TEMP_DATA_DIR = path.join(WORKTREE_ROOT, 'local', 'test-data', 'standalone-windows-launcher');
const ADMIN_REPO_ROOT = process.env.LERNE_ADMIN_ROOT || path.resolve(WORKTREE_ROOT, '..', 'lerne-admin');
const ADMIN_PYTHON = process.env.LERNE_ADMIN_PYTHON || path.join(ADMIN_REPO_ROOT, '.venv', 'Scripts', 'python.exe');

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
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('HTTP timeout')));
  });
}

async function waitForServer(url, proc, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Launcher exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await httpGetText(url);
      if (res.status === 200 && res.body.includes('lerne-android-mode')) {
        return res.body;
      }
    } catch {
      // keep polling until Vite is ready
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for standalone server at ${url}`);
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
  const env = {
    ...process.env,
    LERNE_STANDALONE_PORT: String(port),
    LERNE_MODE: 'LOCAL',
    VITE_LERNE_LOCAL: '1',
    LERNE_V2_PREVIEW: '1',
  };
  const proc = spawn('cmd.exe', ['/c', LAUNCHER_BAT, '--no-browser'], {
    cwd: WORKTREE_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  proc.stdout.on('data', (d) => { logs += d.toString('utf8'); });
  proc.stderr.on('data', (d) => { logs += d.toString('utf8'); });
  return { proc, getLogs: () => logs };
}

function makePngBuffer(width = 24, height = 24) {
  const zlib = require('node:zlib');
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < width; x += 1) {
      const idx = y * rowSize + 1 + x * 3;
      raw[idx] = 56;
      raw[idx + 1] = 189;
      raw[idx + 2] = 248;
    }
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function makeWavBuffer(sampleCount = 800) {
  const dataSize = sampleCount * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    buf.writeInt16LE(Math.round(Math.sin(i * 0.25) * 8000), 44 + i * 2);
  }
  return buf;
}

function generateSyntheticZip(workDir) {
  const zipPath = path.join(workDir, 'win-standalone-import.zip');
  const script = `
import io, sys
from pathlib import Path
from PIL import Image
from peewee import SqliteDatabase

sys.path.insert(0, sys.argv[2])
sys.path.insert(0, str(Path(sys.argv[2]) / 'src'))
import os; os.environ.setdefault('LERNE_ADMIN_ALLOW_LOCAL', '1')

from lerne_admin.core import compatibility as compat
from lerne_admin.core.api import models
from lerne_admin.services import material_archive as admin_archive
from lerne_admin.services.material_transfer import Endpoint
from lerne_admin.services.native_cards import validate_envelope
import unittest
from tests.helpers import native_sqlite

class _Dummy(unittest.TestCase):
    pass
native_sqlite(_Dummy('setUp'))

zip_path = Path(sys.argv[1])
media_dir = zip_path.parent / 'media'
(media_dir / 'images').mkdir(parents=True, exist_ok=True)
b = io.BytesIO()
Image.new('RGB', (20, 20), (34, 197, 94)).save(b, format='PNG')
png_bytes = b.getvalue()
(media_dir / 'images' / 'seed.png').write_bytes(png_bytes)

db = SqliteDatabase(':memory:')
models.tma_db.initialize(db)
models.lerne_db.initialize(db)
db.create_tables([
    models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
    models.TMA_Collaborator, models.TMAProgress, models.TMAReviewHistory,
    models.TMAOfflineBatch, models.TMAMedia, models.TMASetting, models.LibraryCategory,
])
models.TMAUser.create(user_id=55, first_name='WinTest', username='wintest', is_guest=False)
ep = Endpoint(db, 'LOCAL:win-standalone', 55, media_root=media_dir)
with ep.scope(), compat.native_cards_write_scope():
    models.TMAMedia.create(folder='images', filename='seed.png', content=png_bytes)
    folder = models.TMA_Folder.create(user_id=55, name='Windows Standalone Ordner', color='#6366f1', target_language='de', position=0)
    deck = models.TMA_Deck.create(user_id=55, name='Windows Deck', target_language='de', level='A2', folder=folder, scope='personal', position=0)
    models.TMA_Card.create(
        deck=deck, creator_id=55, position=0, source='admin',
        content_v2=validate_envelope({'schema_version': 2, 'card': {'type': 'standard', 'image': 'images/seed.png', 'data': {'prompt': 'das Fenster', 'answer': 'окно'}}}),
        image_path='/api/media/images/seed.png',
    )
    admin_archive.export_archive(ep, zip_path, [folder.id], select_all=False)
`;
  execFileSync(ADMIN_PYTHON, ['-c', script, zipPath, ADMIN_REPO_ROOT], { stdio: ['ignore', 'pipe', 'pipe'] });
  return zipPath;
}

function inspectZip(zipPath) {
  const script = `
import json, sys
sys.path.insert(0, str(__import__('pathlib').Path(sys.argv[2]) / 'src'))
import os; os.environ.setdefault('LERNE_ADMIN_ALLOW_LOCAL', '1')
from lerne_admin.services import material_archive as admin_archive
doc, blobs = admin_archive.read_archive(sys.argv[1])
prompts = [c['values']['content_v2']['card']['data'].get('prompt') for c in doc['content']['card'] if c['values']['content_v2']['card']['type'] == 'standard']
print(json.dumps({'folders': len(doc['content']['folder']), 'decks': len(doc['content']['deck']), 'cards': len(doc['content']['card']), 'media': len(blobs), 'prompts': prompts}, ensure_ascii=False))
`;
  return JSON.parse(execFileSync(ADMIN_PYTHON, ['-c', script, zipPath, ADMIN_REPO_ROOT], { encoding: 'utf8' }).trim());
}

async function readIndexedDbState(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const names = dbs.map((d) => d.name).filter(Boolean);
    const meta = dbs.find((d) => d.name && d.name.startsWith('LerneStandaloneDB_'));
    if (!meta) return { found: false, names };
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(meta.name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const storeNames = ['folders', 'decks', 'cards', 'progress', 'media', 'syncState'].filter((n) => db.objectStoreNames.contains(n));
        const tx = db.transaction(storeNames, 'readonly');
        const out = { found: true, dbName: meta.name, names };
        let remaining = storeNames.length;
        for (const name of storeNames) {
          const getAll = tx.objectStore(name).getAll();
          getAll.onsuccess = () => {
            out[name] = getAll.result;
            remaining -= 1;
            if (remaining === 0) {
              db.close();
              resolve(out);
            }
          };
          getAll.onerror = () => reject(getAll.error);
        }
      };
    });
  });
}

function attachNetworkGuard(context, baseUrl, forbiddenRequests, pageErrors, consoleErrors) {
  context.on('page', (p) => {
    p.on('pageerror', (err) => pageErrors.push(err.message));
    p.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
  });
  return context.route('**/*', async (route) => {
    const url = route.request().url();
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      forbiddenRequests.push({ url, reason: 'invalid-url' });
      return route.abort();
    }
    const isLocalOrigin = url.startsWith(`${baseUrl}/`) || url === baseUrl;
    const isAllowedScheme = url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('ws://127.0.0.1:') || url.startsWith('ws://localhost:');
    const isApiCall = isLocalOrigin && parsed.pathname.startsWith('/api/');
    if ((!isLocalOrigin && !isAllowedScheme) || isApiCall) {
      forbiddenRequests.push({ url, method: route.request().method() });
      return route.abort();
    }
    return route.continue();
  });
}

async function run() {
  assert.equal(fs.existsSync(LAUNCHER_BAT), true, `Missing ${LAUNCHER_BAT}`);
  assert.equal(fs.existsSync(ADMIN_PYTHON), true, `Missing Admin Python at ${ADMIN_PYTHON}`);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
  const profileDir = path.join(TEMP_DATA_DIR, 'chromium-profile');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lerne-win-standalone-'));
  const importZip = generateSyntheticZip(workDir);
  const coverPng = path.join(workDir, 'new-cover.png');
  const clipWav = path.join(workDir, 'new-clip.wav');
  fs.writeFileSync(coverPng, makePngBuffer(28, 28));
  fs.writeFileSync(clipWav, makeWavBuffer(800));

  let launcher1 = null;
  let launcher2 = null;
  let context = null;

  const forbiddenRequests = [];
  const pageErrors = [];
  const consoleErrors = [];

  try {
    // 1. Start launcher #1 on fixed port
    launcher1 = startLauncher(port);
    const indexHtml = await waitForServer(baseUrl, launcher1.proc);
    assert.ok(indexHtml.includes('name="lerne-android-mode" content="offline-pilot"'));
    assert.equal(indexHtml.includes('telegram.org'), false);
    assert.equal(indexHtml.includes('fonts.googleapis.com'), false);

    // 2. Verify strictPort fails fast when port is already occupied, and launcher detects already-active port cleanly
    const strictCheck = spawnSync(
      'node',
      [path.join(WORKTREE_ROOT, 'app', 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: path.join(WORKTREE_ROOT, 'app'),
        env: { ...process.env, VITE_LERNE_STANDALONE: '1' },
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    assert.notEqual(strictCheck.status, 0, 'Vite --strictPort must fail when port is already bound');

    const dupLauncher = spawnSync('cmd.exe', ['/c', LAUNCHER_BAT, '--no-browser'], {
      cwd: WORKTREE_ROOT,
      env: { ...process.env, LERNE_STANDALONE_PORT: String(port) },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(dupLauncher.status, 0, `Duplicate launcher check failed: ${dupLauncher.stdout} ${dupLauncher.stderr}`);
    assert.ok(dupLauncher.stdout.includes(`Port ${port} is already active`), 'Launcher must report already-active port without killing it');

    // 3. Open persistent browser profile at fixed localhost origin
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
    });
    await attachNetworkGuard(context, baseUrl, forbiddenRequests, pageErrors, consoleErrors);
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.setItem('native_language', 'ru'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Alltag & Kommunikation (A2)', { exact: true }).waitFor({ state: 'visible' });

    // 4. Import ZIP archive
    await page.locator('[data-testid="standalone-open-materials-btn"]').click();
    await page.locator('[data-testid="standalone-import-materials-input"]').setInputFiles(importZip);
    await page.locator('[data-testid="standalone-import-confirm-btn"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="standalone-import-confirm-btn"]').click();
    await page.locator('[data-testid="standalone-materials-status"]').waitFor({ state: 'visible' });
    await page.locator('.settings-header .close-btn').click();

    // 5. Open imported folder/deck -> create card with PNG + WAV -> edit existing card
    await page.getByText('Windows Standalone Ordner', { exact: true }).click();
    await page.getByRole('heading', { name: 'Windows Deck' }).click();
    await page.locator('.deck-intro-btn-list').click();
    await page.locator('#tut-fab-add').waitFor({ state: 'visible' });

    await page.locator('#tut-fab-add').click();
    await page.locator('#card-editor-front').fill('der Tisch');
    await page.locator('#card-editor-back').fill('стол');
    await page.getByText('Медиа и оформление', { exact: true }).click();
    await page.getByRole('button', { name: 'Картинка', exact: true }).click();
    await page.locator('.image-picker-dialog input[type=file]').first().setInputFiles(coverPng);
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await page.locator('.image-preview-box img').waitFor({ state: 'visible' });
    await page.locator('.card-audio-attachments input[type="file"]').first().setInputFiles(clipWav);
    await page.getByRole('button', { name: 'Прикрепить аудио', exact: true }).click();
    await page.getByText('Аудио прикреплено к черновику', { exact: false }).waitFor({ state: 'visible' });
    await page.locator('.btn-save-action').first().click();
    await page.locator('.view-creator').waitFor({ state: 'hidden' });

    const origRow = page.locator('.card-item').filter({ hasText: 'das Fenster' }).first();
    await origRow.locator('.card-item-actions-trigger').click();
    await page.getByRole('button', { name: /Редактировать/ }).click();
    await page.locator('#card-editor-back').fill('окно (обновлено)');
    await page.locator('.btn-save-action').first().click();
    await page.locator('.view-editor').waitFor({ state: 'hidden' });

    // 6. Study & SRS grade
    await page.locator('.view-cards .back-btn').click({ force: true });
    await page.locator('.deck-intro-btn-start').click();
    await page.locator('.study-card-flip-button').waitFor({ state: 'visible' });
    await page.locator('.study-card-flip-button').click();
    const gradeBtn = page.locator('.grade-buttons .btn-grade').nth(2);
    await gradeBtn.waitFor({ state: 'visible' });
    await page.waitForTimeout(430);
    await gradeBtn.click();
    await page.locator('.view-study .back-btn').first().click({ force: true });
    await page.locator('.deck-intro-back-btn').click();
    await page.locator('.header-top-left .back-btn').click({ force: true });

    // 7. Export ZIP and verify contents
    await page.locator('[data-testid="standalone-open-materials-btn"]').click();
    const folderCheckbox = page.locator('[data-testid^="standalone-export-folder-"]').first();
    await folderCheckbox.waitFor({ state: 'visible' });
    await folderCheckbox.check();
    const [zipDl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="standalone-export-materials-btn"]').click(),
    ]);
    const exportedZipPath = path.join(workDir, zipDl.suggestedFilename());
    await zipDl.saveAs(exportedZipPath);
    const exportedSummary = inspectZip(exportedZipPath);
    assert.equal(exportedSummary.folders, 1);
    assert.equal(exportedSummary.decks, 1);
    assert.equal(exportedSummary.cards, 2);
    assert.ok(exportedSummary.media >= 3);
    assert.ok(exportedSummary.prompts.includes('der Tisch'));
    assert.ok(exportedSummary.prompts.includes('das Fenster'));

    const preRestartDb = await readIndexedDbState(page);
    assert.deepEqual(preRestartDb.names, ['LerneStandaloneDB_900001']);
    assert.equal(preRestartDb.progress.length, 1);

    await context.close();
    context = null;

    // 8. Fully stop Vite server, restart via run_standalone.bat on same port, and verify persistence
    stopProcessTree(launcher1.proc.pid);
    launcher1 = null;
    await new Promise((r) => setTimeout(r, 600));

    launcher2 = startLauncher(port);
    await waitForServer(baseUrl, launcher2.proc);

    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
    });
    await attachNetworkGuard(context, baseUrl, forbiddenRequests, pageErrors, consoleErrors);
    const page2 = context.pages()[0] || await context.newPage();
    page2.setDefaultTimeout(15000);

    await page2.goto(baseUrl, { waitUntil: 'networkidle' });
    await page2.getByText('Windows Standalone Ordner', { exact: true }).waitFor({ state: 'visible' });
    const postRestartDb = await readIndexedDbState(page2);
    assert.deepEqual(postRestartDb.names, ['LerneStandaloneDB_900001']);
    assert.equal(postRestartDb.progress.length, 1);
    assert.ok(postRestartDb.media.length >= 2, 'Expected both PNG and WAV media blobs to persist after restart');
    assert.ok(postRestartDb.media.some((m) => m.url.endsWith('.wav')), 'Expected stored WAV audio blob after restart');
    assert.ok(postRestartDb.cards.some((c) => c.content_v2?.card?.data?.prompt === 'der Tisch'));
    assert.ok(postRestartDb.cards.some((c) => c.content_v2?.card?.data?.answer === 'окно (обновлено)'));

    await page2.getByText('Windows Standalone Ordner', { exact: true }).click();
    await page2.getByRole('heading', { name: 'Windows Deck' }).click();
    await page2.locator('.deck-intro-btn-list').click();
    await page2.locator('.card-item').filter({ hasText: 'der Tisch' }).first().click();
    await page2.waitForFunction(() => {
      const img = document.querySelector('#tut-study-card img');
      return Boolean(img && img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:'));
    });
    await page2.locator('.audio-player-btn-main').first().waitFor({ state: 'visible' });

    assert.deepEqual(forbiddenRequests, [], `Forbidden network requests: ${JSON.stringify(forbiddenRequests)}`);
    assert.deepEqual(pageErrors, [], `Uncaught page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(consoleErrors, [], `Console errors: ${JSON.stringify(consoleErrors)}`);

    console.log('STANDALONE WINDOWS LAUNCHER E2E PASSED:', {
      port,
      dbNames: postRestartDb.names,
      progressCount: postRestartDb.progress.length,
      exportedSummary,
      forbiddenRequests: forbiddenRequests.length,
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
    });
  } finally {
    if (context) await context.close().catch(() => {});
    if (launcher1) stopProcessTree(launcher1.proc.pid);
    if (launcher2) stopProcessTree(launcher2.proc.pid);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('STANDALONE WINDOWS LAUNCHER E2E FAILED:', err);
  process.exit(1);
});
