const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const WORKTREE_ROOT = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(WORKTREE_ROOT, 'app', 'dist');
const EVIDENCE_DIR = path.join(WORKTREE_ROOT, 'local', 'test-data', 'standalone-materials-evidence');
const ADMIN_PYTHON = process.env.LERNE_ADMIN_PYTHON || 'C:\\121\\Lerne_projekt\\lerne-admin\\.venv\\Scripts\\python.exe';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
};

function startStaticDistServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0];
      const safePath = path.normalize(reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, ''));
      let filePath = path.join(distDir, safePath);
      if (!filePath.startsWith(distDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function generateSyntheticAdminArchives(workDir) {
  const validZip = path.join(workDir, 'admin-e2e-v4.zip');
  const missingMediaZip = path.join(workDir, 'admin-missing-media.zip');
  const script = `
import io, json, sys, wave, zipfile
from pathlib import Path
from PIL import Image
from peewee import SqliteDatabase

sys.path.insert(0, r'C:\\121\\Lerne_projekt\\lerne-admin')
sys.path.insert(0, r'C:\\121\\Lerne_projekt\\lerne-admin\\src')
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

case = _Dummy('setUp')
native_sqlite(case)

root = Path(sys.argv[1])
valid_zip = Path(sys.argv[2])
missing_zip = Path(sys.argv[3])
media_dir = root / 'media'
media_dir.mkdir(parents=True, exist_ok=True)

db = SqliteDatabase(':memory:')
models.tma_db.initialize(db)
models.lerne_db.initialize(db)
db.create_tables([
    models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
    models.TMA_Collaborator, models.TMAProgress, models.TMAReviewHistory,
    models.TMAOfflineBatch, models.TMAMedia, models.TMASetting, models.LibraryCategory,
])
models.TMAUser.create(user_id=42, first_name='E2E Author', username='e2e_author', is_guest=False)
ep = Endpoint(db, 'LOCAL:e2e-admin', 42, media_root=media_dir)

def png_bytes(color):
    b = io.BytesIO()
    Image.new('RGB', (48, 48), color).save(b, format='PNG')
    return b.getvalue()

def wav_bytes():
    b = io.BytesIO()
    with wave.open(b, 'wb') as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(8000); wf.writeframes(b'\\x01\\x00' * 1200)
    return b.getvalue()

blobs = {
    'images/card.png': png_bytes((115, 70, 225)),
    'images/layout.png': png_bytes((22, 165, 115)),
    'images/inline.png': png_bytes((225, 130, 35)),
    'audio/card_front.wav': wav_bytes(),
    'audio/deck_track.wav': wav_bytes(),
}
with ep.scope(), compat.native_cards_write_scope():
    for rel, raw in blobs.items():
        fld, name = rel.split('/')
        p = media_dir / fld / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw)
        models.TMAMedia.create(folder=fld, filename=name, content=raw)

    f_root = models.TMA_Folder.create(user_id=42, name='Kurs Offline E2E', color='#6366f1', target_language='de', position=0)
    f_child = models.TMA_Folder.create(user_id=42, name='Einheit 1', color='#10b981', target_language='de', position=0, parent=f_root)
    deck = models.TMA_Deck.create(
        user_id=42, name='Medien & Schreiben', level='A2', topic='Obst', target_language='de',
        folder=f_child, position=0, scope='personal',
        metadata=json.dumps({
            'intro': {'title': 'Medien & Schreiben', 'level': 'A2'},
            'resources': [{'type': 'audio', 'label': 'Track 1', 'url': '/api/media/audio/deck_track.wav'}],
        }, ensure_ascii=False),
    )
    c1 = validate_envelope({
        'schema_version': 2,
        'card': {
            'type': 'standard', 'level': 'A2', 'image': 'images/card.png',
            'info': [{'type': 'task', 'text': 'Пример картинки ![inline](/api/media/images/inline.png)'}],
            'layout': [
                {'id': 'img_l', 'type': 'image', 'path': 'images/layout.png', 'alt': 'Layout sample'},
                {'id': 'info_0', 'type': 'info', 'index': 0},
                {'id': 'ex_1', 'type': 'exercise'},
            ],
            'data': {'prompt': 'der Apfel', 'answer': 'яблоко'},
            'explanation': 'Базовое слово',
        },
    })
    models.TMA_Card.create(deck=deck, creator_id=42, position=0, source='admin', content_v2=c1,
                           image_path='/api/media/images/card.png', audio_path='/api/media/audio/card_front.wav')
    c2 = validate_envelope({
        'schema_version': 2,
        'card': {
            'type': 'free_text', 'level': 'A2',
            'data': {
                'prompt': 'Переведите: Добрый день',
                'sample_answer': 'Guten Tag',
                'accepted_answers': ['guten tag'],
                'grading_policy': {'mode': 'exact'},
            },
        },
    })
    models.TMA_Card.create(deck=deck, creator_id=42, position=1, source='admin', content_v2=c2)
    admin_archive.export_archive(ep, valid_zip, [f_root.id], select_all=False)

with zipfile.ZipFile(valid_zip) as zin, zipfile.ZipFile(missing_zip, 'w', compression=zipfile.ZIP_DEFLATED) as zout:
    names = zin.namelist()
    dropped = next(n for n in names if n.startswith('media/'))
    for n in names:
        if n != dropped:
            zout.writestr(n, zin.read(n))
`;
  execFileSync(ADMIN_PYTHON, ['-c', script, workDir, validZip, missingMediaZip], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { validZip, missingMediaZip };
}

function makePngBuffer(width = 32, height = 32) {
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
    for (let i = 0; i < buf.length; i += 1) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
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
      raw[idx] = 240;
      raw[idx + 1] = 140;
      raw[idx + 2] = 40;
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeWavBuffer(sampleCount = 1600) {
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

function makeMp4HeaderBuffer() {
  const buf = Buffer.alloc(40);
  buf.writeUInt32BE(24, 0);
  buf.write('ftyp', 4, 'ascii');
  buf.write('isom', 8, 'ascii');
  buf.writeUInt32BE(512, 12);
  buf.write('isom', 16, 'ascii');
  buf.write('mp41', 20, 'ascii');
  buf.writeUInt32BE(16, 24);
  buf.write('free', 28, 'ascii');
  return buf;
}

function verifyZipWithAdminPython(zipPath) {
  const script = `
import json, sys
sys.path.insert(0, r'C:\\121\\Lerne_projekt\\lerne-admin\\src')
import os; os.environ.setdefault('LERNE_ADMIN_ALLOW_LOCAL', '1')
from lerne_admin.services import material_archive as admin_archive
doc = admin_archive.read_archive(sys.argv[1])
deck_meta = json.loads(doc['content']['deck'][0]['values']['metadata'])
resource_types = sorted(r.get('type') for r in deck_meta.get('resources', []))
print(json.dumps({'folders': len(doc['content']['folder']), 'decks': len(doc['content']['deck']), 'cards': len(doc['content']['card']), 'media': len(doc['assets']), 'resource_types': resource_types}))
`;
  return JSON.parse(execFileSync(ADMIN_PYTHON, ['-c', script, zipPath], { encoding: 'utf8' }).trim());
}

async function readIndexedDbState(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const standaloneDbMeta = dbs.find(d => d.name && d.name.startsWith('LerneStandaloneDB_'));
    if (!standaloneDbMeta) return { found: false };
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(standaloneDbMeta.name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const storeNames = ['folders', 'decks', 'cards', 'progress', 'media', 'syncState'].filter(n => db.objectStoreNames.contains(n));
        const tx = db.transaction(storeNames, 'readonly');
        const out = { found: true, dbName: standaloneDbMeta.name };
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

async function wipeClientStorage(page) {
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const dbs = await indexedDB.databases();
    for (const d of dbs) {
      if (!d.name) continue;
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = resolve;
        req.onerror = resolve;
        req.onblocked = resolve;
      });
    }
  });
}

async function gradeCard(page, gradeIndex) {
  const target = page.locator('.grade-buttons .btn-grade').nth(gradeIndex);
  await target.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(430);
  await target.click();
}

async function run() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(`Standalone app/dist missing at ${DIST_DIR}`);
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lerne-e2e-materials-'));

  const { validZip, missingMediaZip } = generateSyntheticAdminArchives(tempWorkDir);
  const { server, baseUrl } = await startStaticDistServer(DIST_DIR);
  const browser = await chromium.launch({ headless: true });

  const forbiddenRequests = [];
  const pageErrors = [];
  const consoleErrors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      acceptDownloads: true,
    });

    await context.route('**/*', async (route) => {
      const url = route.request().url();
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        forbiddenRequests.push({ url, reason: 'invalid-url' });
        return route.abort();
      }
      const isLocalOrigin = url.startsWith(`${baseUrl}/`) || url === baseUrl;
      const isBlobOrData = url.startsWith('blob:') || url.startsWith('data:');
      const isApiCall = isLocalOrigin && parsed.pathname.startsWith('/api/');
      if ((!isLocalOrigin && !isBlobOrData) || isApiCall) {
        forbiddenRequests.push({ url, method: route.request().method() });
        return route.abort();
      }
      return route.continue();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // 1. Cold offline boot -> click header 1-tap Materials button
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByText('Alltag & Kommunikation (A2)', { exact: true }).waitFor({ state: 'visible' });
    await page.locator('[data-testid="standalone-open-materials-btn"]').click();
    await page.locator('[data-testid="standalone-import-materials-btn"]').waitFor({ state: 'visible' });

    // 2. Preview -> Cancel leaves IndexedDB untouched
    await page.locator('[data-testid="standalone-import-materials-input"]').setInputFiles(validZip);
    await page.locator('[data-testid="standalone-import-confirm-card"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="standalone-import-confirm-card"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-import-preview-375.png'), fullPage: true });
    await page.locator('[data-testid="standalone-import-cancel-btn"]').click();
    await page.locator('[data-testid="standalone-import-confirm-card"]').waitFor({ state: 'hidden' });

    const afterCancel = await readIndexedDbState(page);
    assert.equal(afterCancel.decks.length, 3);
    assert.equal(afterCancel.cards.length, 30);
    assert.equal(afterCancel.folders.length, 0);

    // 3. Confirm import -> responsive layout checks at 375px and 320px
    await page.locator('[data-testid="standalone-import-materials-input"]').setInputFiles(validZip);
    await page.locator('[data-testid="standalone-import-confirm-btn"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="standalone-import-confirm-btn"]').click();
    await page.locator('[data-testid="standalone-materials-status"]').waitFor({ state: 'visible' });

    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      'Materials panel must not overflow at 375px'
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-materials-panel-375.png'), fullPage: true });

    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false,
      'Materials panel must not overflow at 320px'
    );
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '03-materials-panel-320.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });

    // 4. Close settings -> navigate Kurs Offline E2E -> Einheit 1 -> Medien & Schreiben -> Start
    await page.locator('.settings-header .close-btn').click();
    await page.getByText('Kurs Offline E2E', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('Kurs Offline E2E', { exact: true }).click();
    await page.getByText('Einheit 1', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('Einheit 1', { exact: true }).click();
    await page.getByRole('heading', { name: 'Medien & Schreiben' }).waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: 'Medien & Schreiben' }).click();
    await page.locator('.deck-intro-btn-start').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-btn-start').click();

    // 5. Card 1 (standard + card PNG + layout PNG + markdown PNG + WAV audio)
    await page.locator('#tut-study-card img').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('#tut-study-card img'));
      return imgs.length >= 2 && imgs.every(img => img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:'));
    });

    const renderedImages = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#tut-study-card img')).map(img => ({
        src: img.src,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      }))
    );
    assert.ok(renderedImages.length >= 2, `Expected >=2 blob images rendered, got ${renderedImages.length}`);
    for (const img of renderedImages) {
      assert.equal(img.src.startsWith('blob:'), true);
      assert.equal(img.naturalWidth > 0, true);
    }

    // Verify stored WAV blobs decode cleanly as HTML Audio (metadata loaded)
    const audioDecodeResults = await page.evaluate(async () => {
      const dbs = await indexedDB.databases();
      const dbMeta = dbs.find(d => d.name && d.name.startsWith('LerneStandaloneDB_'));
      const mediaEntries = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbMeta.name);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const getAll = db.transaction(['media'], 'readonly').objectStore('media').getAll();
          getAll.onsuccess = () => { db.close(); resolve(getAll.result); };
          getAll.onerror = () => reject(getAll.error);
        };
      });
      const wavEntries = mediaEntries.filter(m => m.url.endsWith('.wav'));
      const decoded = [];
      for (const item of wavEntries) {
        const url = URL.createObjectURL(item.blob);
        try {
          const info = await new Promise((resolve, reject) => {
            const el = new Audio(url);
            el.addEventListener('loadedmetadata', () => resolve({ url: item.url, readyState: el.readyState, duration: el.duration }));
            el.addEventListener('error', () => reject(new Error(`Audio error on ${item.url}`)));
            el.load();
          });
          decoded.push(info);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      return decoded;
    });
    assert.ok(audioDecodeResults.length >= 1, 'Expected stored WAV audio blobs to decode cleanly');
    assert.equal(audioDecodeResults.every(a => a.readyState >= 1 && a.duration > 0), true);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04-imported-card-media.png'), fullPage: true });

    await page.locator('.study-card-flip-button').click();
    await page.locator('#tut-study-answer, .card-back').first().waitFor({ state: 'visible' });
    await gradeCard(page, 2);

    // 6. Card 2 (free_text evaluated locally offline)
    await page.locator('.free-text-exercise textarea').waitFor({ state: 'visible' });
    await page.locator('.free-text-exercise textarea').fill('Guten Tag');
    await page.locator('.free-text-exercise button[type="submit"]').click();
    await page.locator('.free-text-feedback.is-success').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05-imported-freetext.png'), fullPage: true });
    await gradeCard(page, 2);

    await page.locator('.lesson-completion-btn-primary').waitFor({ state: 'visible' });
    await page.locator('.lesson-completion-btn-primary').click();
    await page.locator('.deck-intro-back-btn').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-back-btn').click();

    // 7. Reload page (Force Stop simulation) -> verify imported materials, media, and SRS persist
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Kurs Offline E2E', { exact: true }).waitFor({ state: 'visible' });
    const postReloadDb = await readIndexedDbState(page);
    assert.equal(postReloadDb.folders.length, 2);
    assert.equal(postReloadDb.decks.length, 4);
    assert.equal(postReloadDb.cards.length, 32);
    assert.equal(postReloadDb.progress.length, 2);
    assert.ok(postReloadDb.media.length >= 4);

    // 8. Re-import same ZIP -> preserves SRS and creates 0 duplicates
    await page.locator('[data-testid="standalone-open-materials-btn"]').click();
    await page.locator('[data-testid="standalone-import-materials-input"]').setInputFiles(validZip);
    await page.locator('[data-testid="standalone-import-confirm-card"]').waitFor({ state: 'visible' });
    const confirmText = await page.locator('[data-testid="standalone-import-confirm-card"]').innerText();
    assert.ok(confirmText.includes('Повторный импорт'), 'Re-import confirmation must warn about preserving existing SRS');
    await page.locator('[data-testid="standalone-import-confirm-btn"]').click();
    await page.locator('[data-testid="standalone-materials-status"]').waitFor({ state: 'visible' });

    const postReimportDb = await readIndexedDbState(page);
    assert.equal(postReimportDb.decks.length, 4);
    assert.equal(postReimportDb.cards.length, 32);
    assert.equal(postReimportDb.progress.length, 2);

    // 9. Corrupt ZIP and Missing Media ZIP -> error banner shown, DB untouched
    await page.locator('[data-testid="standalone-import-materials-input"]').setInputFiles({
      name: 'corrupt.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('not-a-valid-zip-payload'),
    });
    await page.locator('[data-testid="standalone-materials-error"]').waitFor({ state: 'visible' });

    await page.locator('[data-testid="standalone-import-materials-input"]').setInputFiles(missingMediaZip);
    await page.locator('[data-testid="standalone-materials-error"]').waitFor({ state: 'visible' });
    const afterRejectDb = await readIndexedDbState(page);
    assert.equal(afterRejectDb.decks.length, 4);
    assert.equal(afterRejectDb.cards.length, 32);
    assert.equal(afterRejectDb.progress.length, 2);

    // 10. Progress Backup (full-v2) -> Wipe -> Re-import ZIP -> Restore -> Reload -> Exact SRS restored
    const [progressDl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="standalone-export-progress-btn"]').click(),
    ]);
    const progressBackupPath = path.join(tempWorkDir, progressDl.suggestedFilename());
    await progressDl.saveAs(progressBackupPath);
    const progressJson = JSON.parse(fs.readFileSync(progressBackupPath, 'utf8'));
    assert.equal(progressJson.integrity.scope, 'full-v2');
    assert.equal(progressJson.imported_records.length, 2);

    await wipeClientStorage(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Alltag & Kommunikation (A2)', { exact: true }).waitFor({ state: 'visible' });

    await page.locator('[data-testid="standalone-open-materials-btn"]').click();
    await page.locator('[data-testid="standalone-import-materials-input"]').setInputFiles(validZip);
    await page.locator('[data-testid="standalone-import-confirm-btn"]').click();
    await page.locator('[data-testid="standalone-materials-status"]').waitFor({ state: 'visible' });

    await page.locator('[data-testid="standalone-restore-file-input"]').setInputFiles(progressBackupPath);
    await page.locator('[data-testid="standalone-restore-confirm-btn"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="standalone-restore-confirm-btn"]').click();
    await page.locator('[data-testid="standalone-backup-status"]').waitFor({ state: 'visible' });

    await page.reload({ waitUntil: 'networkidle' });
    const restoredDb = await readIndexedDbState(page);
    assert.equal(restoredDb.progress.length, 2, 'Imported card SRS progress must restore across wipe + re-import');

    // 10b. DeckMediaModal local resource upload (image + audio + video), DeckResources playback, reload persistence, and ZIP export
    const deckPngPath = path.join(tempWorkDir, 'deck-cover.png');
    const deckWavPath = path.join(tempWorkDir, 'deck-extra.wav');
    const deckMp4Path = path.join(tempWorkDir, 'deck-clip.mp4');
    fs.writeFileSync(deckPngPath, makePngBuffer(32, 32));
    fs.writeFileSync(deckWavPath, makeWavBuffer(1600));
    fs.writeFileSync(deckMp4Path, makeMp4HeaderBuffer());

    await page.getByText('Kurs Offline E2E', { exact: true }).click();
    await page.getByText('Einheit 1', { exact: true }).click();
    await page.getByRole('heading', { name: 'Medien & Schreiben' }).click();
    await page.locator('.deck-intro-btn-list').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-btn-list').click();
    await page.locator('.view-cards .header-action-btn[aria-expanded]').waitFor({ state: 'visible' });

    await page.locator('.view-cards .header-action-btn[aria-expanded]').click();
    await page.locator('.deck-dropdown-menu .dropdown-item').first().click();
    await page.locator('.settings-modal input[type="file"][accept="audio/*"]').waitFor({ state: 'attached' });

    // Upload image (via ImageEditorModal)
    await page.locator('.settings-modal input[type="file"][accept="image/*"]').setInputFiles(deckPngPath);
    await page.locator('.image-editor-actions .btn-primary').waitFor({ state: 'visible' });
    await page.waitForTimeout(250);
    await page.locator('.image-editor-actions .btn-primary').click();
    await page.locator('.image-editor-actions').waitFor({ state: 'hidden' });

    // Upload audio & video
    await page.locator('.settings-modal input[type="file"][accept="audio/*"]').setInputFiles(deckWavPath);
    await page.waitForFunction(async () => {
      const dbs = await indexedDB.databases();
      const meta = dbs.find(d => d.name && d.name.startsWith('LerneStandaloneDB_'));
      if (!meta) return false;
      return new Promise((resolve) => {
        const req = indexedDB.open(meta.name);
        req.onsuccess = () => {
          const db = req.result;
          const getAll = db.transaction(['decks'], 'readonly').objectStore('decks').getAll();
          getAll.onsuccess = () => {
            db.close();
            const deck = getAll.result.find(d => d.name === 'Medien & Schreiben');
            const m = typeof deck?.metadata === 'string' ? JSON.parse(deck.metadata) : deck?.metadata;
            const types = (m?.resources || []).map(r => r.type);
            resolve(types.includes('image') && types.filter(t => t === 'audio').length === 2);
          };
        };
      });
    });

    await page.locator('.settings-modal input[type="file"][accept="video/*"]').setInputFiles(deckMp4Path);
    await page.waitForFunction(async () => {
      const dbs = await indexedDB.databases();
      const meta = dbs.find(d => d.name && d.name.startsWith('LerneStandaloneDB_'));
      if (!meta) return false;
      return new Promise((resolve) => {
        const req = indexedDB.open(meta.name);
        req.onsuccess = () => {
          const db = req.result;
          const getAll = db.transaction(['decks'], 'readonly').objectStore('decks').getAll();
          getAll.onsuccess = () => {
            db.close();
            const deck = getAll.result.find(d => d.name === 'Medien & Schreiben');
            const m = typeof deck?.metadata === 'string' ? JSON.parse(deck.metadata) : deck?.metadata;
            const types = (m?.resources || []).map(r => r.type);
            resolve(types.includes('image') && types.includes('video') && types.filter(t => t === 'audio').length === 2);
          };
        };
      });
    });

    await page.locator('.settings-modal .modal-footer-actions .btn-primary').click();
    await page.locator('.settings-modal').waitFor({ state: 'hidden' });

    // Verify DeckResources rendering & audio metadata/playback
    await page.waitForFunction(() => {
      const img = document.querySelector('.deck-images-gallery img');
      const audios = [...document.querySelectorAll('.deck-audio-player audio')];
      const video = document.querySelector('.view-cards video');
      return Boolean(
        img && img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:')
        && audios.length === 2 && audios.every(a => a.src.startsWith('blob:'))
        && video && video.src.startsWith('blob:')
      );
    });
    const deckAudioMeta = await page.evaluate(async () => {
      const audios = [...document.querySelectorAll('.deck-audio-player audio')];
      return Promise.all(audios.map(el => {
        if (el.readyState >= 1) return Promise.resolve({ readyState: el.readyState, duration: el.duration });
        return new Promise((resolve, reject) => {
          el.addEventListener('loadedmetadata', () => resolve({ readyState: el.readyState, duration: el.duration }), { once: true });
          el.addEventListener('error', () => reject(new Error('Deck audio element failed to load')), { once: true });
          el.load();
        });
      }));
    });
    assert.equal(deckAudioMeta.length, 2);
    assert.equal(deckAudioMeta.every(a => a.readyState >= 1 && a.duration > 0), true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '06-deck-resources-375.png'), fullPage: true });

    // Reload and verify DeckResources persist across Force Stop simulation
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Kurs Offline E2E', { exact: true }).click();
    await page.getByText('Einheit 1', { exact: true }).click();
    await page.getByRole('heading', { name: 'Medien & Schreiben' }).click();
    await page.locator('.deck-intro-btn-list').click();
    await page.waitForFunction(() => {
      const img = document.querySelector('.deck-images-gallery img');
      const audios = [...document.querySelectorAll('.deck-audio-player audio')];
      const video = document.querySelector('.view-cards video');
      return Boolean(
        img && img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:')
        && audios.length === 2 && audios.every(a => a.src.startsWith('blob:'))
        && video && video.src.startsWith('blob:')
      );
    });

    // Verify canonical /api/media/... paths stored in IndexedDB (never ephemeral blob: URLs)
    const dbAfterDeckMedia = await readIndexedDbState(page);
    const updatedDeckRow = dbAfterDeckMedia.decks.find(d => d.name === 'Medien & Schreiben');
    const storedMeta = typeof updatedDeckRow.metadata === 'string'
      ? JSON.parse(updatedDeckRow.metadata)
      : updatedDeckRow.metadata;
    for (const res of storedMeta.resources) {
      assert.match(res.path, /^\/api\/media\/(images|audio|videos)\/archive_[a-f0-9]{64}\./);
      assert.equal(res.url, res.path);
    }

    await page.locator('.view-cards .back-btn').click({ force: true });
    await page.locator('.deck-intro-back-btn').click();
    await page.locator('.header-top-left .back-btn').click({ force: true });
    await page.locator('.header-top-left .back-btn').click({ force: true });

    // 11. Selective Material Export -> Validate ZIP directly with Admin Python
    await page.locator('[data-testid="standalone-open-materials-btn"]').click();
    const folderCheckbox = page.locator('[data-testid^="standalone-export-folder-"]').first();
    await folderCheckbox.waitFor({ state: 'visible' });
    await folderCheckbox.check();
    const [zipDl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="standalone-export-materials-btn"]').click(),
    ]);
    const exportedZipPath = path.join(tempWorkDir, zipDl.suggestedFilename());
    await zipDl.saveAs(exportedZipPath);
    const pythonValidationOut = verifyZipWithAdminPython(exportedZipPath);
    assert.equal(pythonValidationOut.folders, 2);
    assert.equal(pythonValidationOut.decks, 1);
    assert.equal(pythonValidationOut.cards, 2);
    assert.equal(pythonValidationOut.media, 7);
    assert.deepEqual(pythonValidationOut.resource_types, ['audio', 'audio', 'image', 'video']);

    assert.deepEqual(forbiddenRequests, [], `Forbidden network requests: ${JSON.stringify(forbiddenRequests)}`);
    assert.deepEqual(pageErrors, [], `Uncaught page errors: ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(consoleErrors, [], `Console errors: ${JSON.stringify(consoleErrors)}`);

    console.log('STANDALONE OFFLINE MATERIALS E2E PASSED:', {
      renderedImages: renderedImages.length,
      decodedAudioBlobs: audioDecodeResults.length,
      restoredImportedProgress: restoredDb.progress.length,
      pythonReadArchive: pythonValidationOut,
      forbiddenRequests: forbiddenRequests.length,
      pageErrors: pageErrors.length,
      consoleErrors: consoleErrors.length,
      evidenceDir: EVIDENCE_DIR,
    });
  } catch (err) {
    try {
      const pages = browser.contexts().flatMap(c => c.pages());
      if (pages[0]) {
        await pages[0].screenshot({ path: path.join(EVIDENCE_DIR, 'failure-state.png'), fullPage: true });
      }
    } catch {}
    throw err;
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tempWorkDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('STANDALONE OFFLINE MATERIALS E2E FAILED:', err);
  process.exit(1);
});
