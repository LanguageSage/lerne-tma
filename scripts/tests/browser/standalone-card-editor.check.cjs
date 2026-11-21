const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const WORKTREE_ROOT = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(WORKTREE_ROOT, 'app', 'dist');
const EVIDENCE_DIR = path.join(WORKTREE_ROOT, 'local', 'test-data', 'standalone-card-editor-evidence');
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
      raw[idx] = 64;
      raw[idx + 1] = 180;
      raw[idx + 2] = 240;
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
  return buf;
}

function generateSyntheticZipWithAdminPython(workDir) {
  const zipPath = path.join(workDir, 'imported-edit-test-v4.zip');
  const script = `
import io, sys, zipfile
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
native_sqlite(_Dummy('setUp'))

zip_path = Path(sys.argv[1])
media_dir = zip_path.parent / 'media'
media_dir.mkdir(parents=True, exist_ok=True)
img = Image.new('RGB', (16, 16), (34, 197, 94))
b = io.BytesIO()
img.save(b, format='PNG')
png_bytes = b.getvalue()
(media_dir / 'images').mkdir(parents=True, exist_ok=True)
(media_dir / 'images' / 'seed.png').write_bytes(png_bytes)

db = SqliteDatabase(':memory:')
models.tma_db.initialize(db)
models.lerne_db.initialize(db)
db.create_tables([
    models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
    models.TMA_Collaborator, models.TMAProgress, models.TMAReviewHistory,
    models.TMAOfflineBatch, models.TMAMedia, models.TMASetting, models.LibraryCategory,
])
models.TMAUser.create(user_id=77, first_name='Teacher', username='teacher', is_guest=False)
ep = Endpoint(db, 'LOCAL:e2e-editor', 77, media_root=media_dir)
with ep.scope(), compat.native_cards_write_scope():
    models.TMAMedia.create(folder='images', filename='seed.png', content=png_bytes)
    deck = models.TMA_Deck.create(user_id=77, name='Imported Lib Deck', target_language='de', level='A2', scope='personal', position=0)
    models.TMA_Card.create(
        deck=deck, creator_id=77, position=0, source='admin',
        content_v2=validate_envelope({'schema_version': 2, 'card': {'type': 'standard', 'image': 'images/seed.png', 'data': {'prompt': 'Original Imported One', 'answer': 'Оригинал 1'}}}),
        image_path='/api/media/images/seed.png',
    )
    models.TMA_Card.create(
        deck=deck, creator_id=77, position=1, source='admin',
        content_v2=validate_envelope({'schema_version': 2, 'card': {'type': 'standard', 'data': {'prompt': 'Original Imported Two', 'answer': 'Оригинал 2'}}}),
    )
    admin_archive.export_archive(ep, zip_path, [], deck_ids=[deck.id], select_all=False)
`;
  execFileSync(ADMIN_PYTHON, ['-c', script, zipPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  return zipPath;
}

function inspectZipWithAdminPython(zipPath) {
  const script = `
import json, sys
sys.path.insert(0, r'C:\\121\\Lerne_projekt\\lerne-admin\\src')
import os; os.environ.setdefault('LERNE_ADMIN_ALLOW_LOCAL', '1')
from lerne_admin.services import material_archive as admin_archive
doc, blobs = admin_archive.read_archive(sys.argv[1])
prompts = [c['values']['content_v2']['card']['data'].get('prompt') for c in doc['content']['card'] if c['values']['content_v2']['card']['type'] == 'standard']
print(json.dumps({'decks': len(doc['content']['deck']), 'cards': len(doc['content']['card']), 'media': len(blobs), 'prompts': prompts}, ensure_ascii=False))
`;
  return JSON.parse(execFileSync(ADMIN_PYTHON, ['-c', script, zipPath], { encoding: 'utf8' }).trim());
}

async function readIndexedDbState(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const meta = dbs.find(d => d.name && d.name.startsWith('LerneStandaloneDB_'));
    if (!meta) return { found: false };
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(meta.name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const storeNames = ['folders', 'decks', 'cards', 'progress', 'media', 'syncState'].filter(n => db.objectStoreNames.contains(n));
        const tx = db.transaction(storeNames, 'readonly');
        const out = { found: true, dbName: meta.name };
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

async function assertZeroOverflowAcrossViewports(page, screenshotsPrefix = null) {
  const widths = [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
  ];
  for (const vp of widths) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `Horizontal overflow detected at ${vp.width}px`);
    if (screenshotsPrefix) {
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `${screenshotsPrefix}-${vp.width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
}

async function gradeCard(page, gradeIndex = 2) {
  const target = page.locator('.grade-buttons .btn-grade').nth(gradeIndex);
  await target.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(430);
  await target.click();
}

async function saveCurrentCardForm(page) {
  const saveBtn = page.locator('.btn-save-action').first();
  await saveBtn.scrollIntoViewIfNeeded();
  await saveBtn.click();
  await page.locator('.view-creator, .view-editor').waitFor({ state: 'hidden', timeout: 10000 });
}

async function run() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(`Standalone app/dist missing at ${DIST_DIR}`);
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lerne-e2e-editor-'));
  const pngPath = path.join(tempWorkDir, 'cover.png');
  const wavPath = path.join(tempWorkDir, 'clip.wav');
  fs.writeFileSync(pngPath, makePngBuffer(32, 32));
  fs.writeFileSync(wavPath, makeWavBuffer(800));
  const hasAdminPython = fs.existsSync(ADMIN_PYTHON);
  const importZipPath = hasAdminPython ? generateSyntheticZipWithAdminPython(tempWorkDir) : null;

  const distHtml = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  assert.equal(distHtml.includes('telegram.org'), false, 'Standalone dist must not include telegram.org');
  assert.equal(distHtml.includes('fonts.googleapis.com'), false, 'Standalone dist must not include fonts.googleapis.com');

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
    await context.addInitScript(() => {
      localStorage.setItem('native_language', 'ru');
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

    // 1. Cold boot & open deck card list
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-list').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-btn-list').click();
    await page.locator('#tut-fab-add').waitFor({ state: 'visible' });

    // Verify CardActionModal shows ONLY offline authoring + flag + info
    await page.locator('.card-item-actions-trigger').first().click();
    await page.getByRole('button', { name: /Редактировать/ }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Удалить карточку/ }).waitFor({ state: 'visible' });
    assert.equal(await page.getByText('Переместить', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Копировать', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Позиция в списке', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Поделиться', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Мои заметки', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Предложить улучшение', { exact: true }).count(), 0);
    await page.locator('.settings-header .close-btn').last().click();
    await page.locator('.action-grid').waitFor({ state: 'hidden' });

    // 2. Dirty-draft Cancel guard check & standalone editor UI hygiene
    await page.locator('#tut-fab-add').click();
    await page.locator('.view-creator').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.btn-ai-generate').count(), 0, 'AI generate buttons must be hidden');
    assert.equal(await page.locator('.btn-audio').count(), 0, 'TTS generate button must be hidden');
    assert.equal(await page.getByRole('button', { name: 'Диктовать', exact: true }).count(), 0, 'Dictation must be hidden');
    assert.equal(await page.locator('.visual-card-layout-insert').count(), 0, 'Layout insert buttons must be hidden');
    assert.equal(await page.locator('.visual-card-layout-block > .visual-card-drag-handle').count(), 0, 'Layout drag handles must be hidden');

    await page.locator('#card-editor-front').fill('Temp Unsaved Draft');
    page.once('dialog', d => d.dismiss());
    await page.locator('.ai-quick-actions button.btn-secondary').click();
    assert.equal(await page.locator('.view-creator').count(), 1, 'Dismissing cancel dialog keeps creator open');
    page.once('dialog', d => d.accept());
    await page.locator('.ai-quick-actions button.btn-secondary').click();
    await page.locator('.view-creator').waitFor({ state: 'hidden' });

    // 3. Create ALL 9 Native V2 card types via real UI (+ PNG cover & WAV audio on Standard)
    const typeSelect = () => page.getByRole('combobox', { name: 'Тип карточки', exact: true });

    // 3.1 Standard + PNG cover + WAV audio
    await page.locator('#tut-fab-add').click();
    await page.locator('#card-editor-front').fill('der Offline-Stift');
    await page.locator('#card-editor-back').fill('офлайн-ручка');
    await page.locator('#card-editor-context').fill('Создано локально в Android Standalone');
    await page.getByText('Медиа и оформление', { exact: true }).click();
    await page.getByRole('button', { name: 'Картинка', exact: true }).click();
    await page.locator('.image-picker-dialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.image-picker-dialog a').count(), 0, 'Google Search tile must be hidden offline');
    await page.locator('.image-picker-dialog input[type=file]').first().setInputFiles(pngPath);
    await page.getByRole('button', { name: 'Применить', exact: true }).click();
    await page.locator('.image-preview-box img').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#tut-creator-front input[type="range"]').count(), 0, 'Cover height slider must be hidden in standalone');

    await page.locator('.card-audio-attachments input[type="file"]').first().setInputFiles(wavPath);
    await page.getByRole('button', { name: 'Прикрепить аудио', exact: true }).click();
    await page.getByText('Аудио прикреплено к черновику', { exact: false }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => Boolean(document.querySelector('.card-audio-attachments audio')?.getAttribute('src')));
    await assertZeroOverflowAcrossViewports(page, '01-creator-standard');
    await saveCurrentCardForm(page);

    // 3.2 Theory
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('theory');
    await page.locator('#card-editor-front').fill('**Offline Theorie**');
    await page.locator('#card-editor-back').fill('Краткая сводка');
    await saveCurrentCardForm(page);

    // 3.3 Trainer
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('trainer');
    await page.getByRole('textbox', { name: 'Текст 1', exact: true }).fill('Ich ');
    await page.getByRole('textbox', { name: 'Вариант ответа 1.1', exact: true }).fill('lerne');
    await page.getByRole('button', { name: 'Добавить часть', exact: true }).click();
    await page.getByRole('button', { name: 'Пропуск с выбором', exact: true }).click();
    await page.getByRole('textbox', { name: 'Вариант ответа 2.1', exact: true }).fill('Deutsch');
    await page.getByRole('textbox', { name: 'Вариант ответа 2.2', exact: true }).fill('Musik');
    await page.locator('#card-editor-back').fill('Тренажёр E2E');
    await saveCurrentCardForm(page);

    // 3.4 Quiz
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('quiz');
    await page.locator('#card-editor-front').fill('Welche Hauptstadt hat Deutschland?');
    await page.locator('#quiz-editor-option-0').fill('Berlin');
    await page.locator('#quiz-editor-option-1').fill('München');
    await saveCurrentCardForm(page);

    // 3.5 Match
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('match');
    await page.getByRole('textbox', { name: 'Слева 1', exact: true }).fill('Hund');
    await page.getByRole('textbox', { name: 'Справа 1', exact: true }).fill('собака');
    await page.getByRole('textbox', { name: 'Слева 2', exact: true }).fill('Katze');
    await page.getByRole('textbox', { name: 'Справа 2', exact: true }).fill('кошка');
    await assertZeroOverflowAcrossViewports(page, '02-creator-match');
    await saveCurrentCardForm(page);

    // 3.6 Puzzle
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('puzzle');
    await page.locator('.puzzle-editor-sentence').click();
    await page.locator('#card-editor-front').fill('Das ist mein Buch');
    await page.getByRole('textbox', { name: 'Перевод', exact: true }).fill('Это моя книга');
    await saveCurrentCardForm(page);

    // 3.7 Word Bank
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('word_bank');
    const wbSentence = page.locator('.word-bank-editor .word-bank-sentence-text').first();
    await wbSentence.fill('Heute scheint Sonne');
    await wbSentence.evaluate((el) => {
      const range = document.createRange();
      range.setStart(el.firstChild, 6);
      range.setEnd(el.firstChild, 13);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.getByRole('button', { name: 'Создать пропуск', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Создать пропуск', exact: true }).click();
    await page.locator('.word-bank-editor').getByRole('button', { name: 'Добавить вариант', exact: true }).click();
    await page.locator('.word-bank-editor').getByRole('textbox', { name: 'Слово 2', exact: true }).fill('regnet');
    await saveCurrentCardForm(page);

    // 3.8 Free Text
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('free_text');
    await page.locator('#card-editor-front').fill('Schreiben Sie zwei Sätze über Berlin.');
    await page.locator('#card-editor-back').fill('Berlin ist die Hauptstadt.');
    await saveCurrentCardForm(page);

    // 3.9 Editable Text
    await page.locator('#tut-fab-add').click();
    await typeSelect().selectOption('editable_text');
    await page.locator('#card-editor-front').fill('Er gehen heute heim.');
    await page.locator('#card-editor-back').fill('Er geht heute heim.');
    await saveCurrentCardForm(page);

    const dbAfterCreateAll9 = await readIndexedDbState(page);
    const activeA2 = dbAfterCreateAll9.cards.filter(c => c.deck_id === 9101 && !c.is_deleted);
    assert.equal(activeA2.length, 21, `Expected 12 seeded + 9 created cards, got ${activeA2.length}`);
    const createdCards = activeA2.filter(c => c.standalone_local_created);
    assert.equal(createdCards.length, 9);
    const createdTypes = new Set(createdCards.map(c => c.content_v2.card.type));
    assert.equal(createdTypes.size, 9, 'All 9 Native V2 types must exist locally');
    const standardCreated = createdCards.find(c => c.content_v2.card.type === 'standard');
    assert.ok(standardCreated.image_path, 'Cover image path must be persisted');
    assert.ok(standardCreated.audio_path, 'Audio path must be persisted');
    const a2Deck = dbAfterCreateAll9.decks.find(d => d.id === 9101);
    assert.equal(a2Deck.role, 'viewer');
    assert.equal(a2Deck.is_global_readonly, true);

    // Verify newly created standard card opens in StudyView with its local PNG cover & WAV audio player
    const standardRow = page.locator('.card-item').filter({ hasText: 'der Offline-Stift' }).first();
    await standardRow.scrollIntoViewIfNeeded();
    await standardRow.waitFor({ state: 'visible' });
    await standardRow.click();
    await page.locator('#tut-study-card img').first().waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const img = document.querySelector('#tut-study-card img');
      return Boolean(img && img.complete && img.naturalWidth > 0 && img.src.startsWith('blob:'));
    });
    await page.locator('.audio-player-btn-main').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02b-study-created-media-375.png'), fullPage: true });
    await page.locator('.view-study .back-btn').first().waitFor({ state: 'visible' });
    await page.locator('.view-study .back-btn').first().click({ force: true });
    await page.locator('#tut-fab-add').waitFor({ state: 'visible' });

    // 4. Layout-lock test: inject a layout-carrying card into A2, open in CardEditor, verify UI lock + layout preservation
    const layoutImageRel = standardCreated.image_path.replace('/api/media/', '');
    const originalLayout = [
      { id: 'img_0', type: 'image', path: layoutImageRel, caption: 'Закреплённое фото' },
      { id: 'info_0', type: 'info', index: 0, visibility: 'before_answer' },
      { id: 'ex_0', type: 'exercise' },
    ];
    await page.evaluate(async ({ layout, dbName }) => {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['cards'], 'readwrite');
          tx.objectStore('cards').put({
            id: 1500001,
            deck_id: 9101,
            position: 999,
            target_language: 'de',
            revision: 1,
            is_deleted: 0,
            is_dirty: 0,
            standalone_card_key: 'test:layout:1500001',
            content_v2: {
              schema_version: 2,
              card: {
                type: 'standard',
                data: { prompt: 'Layout Card Orig', answer: 'Макет ответ' },
                info: [{ type: 'task', text: 'Исходный блок задания' }],
                layout,
              },
            },
          });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, { layout: originalLayout, dbName: dbAfterCreateAll9.dbName });

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-list').click();
    await page.getByText('Layout Card Orig', { exact: true }).waitFor({ state: 'visible' });

    const layoutCardRow = page.locator('.card-item').filter({ hasText: 'Layout Card Orig' }).first();
    await layoutCardRow.locator('.card-item-actions-trigger').click();
    await page.getByRole('button', { name: /Редактировать/ }).click();
    await page.locator('.view-editor').waitFor({ state: 'visible' });

    await page.getByTestId('standalone-layout-lock-note').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.visual-card-layout-insert').count(), 0);
    await page.getByText('Изображения', { exact: true }).click();
    await page.getByTestId('standalone-layout-images-locked').waitFor({ state: 'visible' });
    const imagesText = await page.getByTestId('standalone-layout-images-locked').innerText();
    assert.ok(imagesText.includes('Закреплённое фото'));
    assert.equal(await page.getByTestId('standalone-layout-images-locked').locator('input[type="file"]').count(), 0);
    await assertZeroOverflowAcrossViewports(page, '03-editor-layout-locked');

    await page.locator('#card-editor-front').fill('Layout Card Edited');
    await saveCurrentCardForm(page);

    const afterLayoutEdit = await readIndexedDbState(page);
    const editedLayoutCard = afterLayoutEdit.cards.find(c => c.id === 1500001);
    assert.equal(editedLayoutCard.content_v2.card.data.prompt, 'Layout Card Edited');
    assert.deepEqual(editedLayoutCard.content_v2.card.layout, originalLayout, 'Existing layout must remain intact');

    const editedLayoutRow = page.locator('.card-item').filter({ hasText: 'Layout Card Edited' }).first();
    await editedLayoutRow.locator('.card-item-actions-trigger').click();
    await page.getByRole('button', { name: /Редактировать/ }).click();
    await page.locator('#card-editor-front').fill('Unsaved draft after a conflict');
    await page.evaluate(({ dbName, card }) => new Promise((resolve, reject) => {
      const open = indexedDB.open(dbName);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const tx = database.transaction('cards', 'readwrite');
        card.revision += 1;
        card.content_v2.card.data.prompt = 'Newer local text';
        tx.objectStore('cards').put(card);
        tx.oncomplete = () => { database.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }), { dbName: afterLayoutEdit.dbName, card: editedLayoutCard });
    await page.locator('.view-editor .btn-save-action').first().click();
    await page.getByText(/Карточка изменилась на устройстве/).waitFor({ state: 'visible' });
    assert.equal(await page.locator('#card-editor-front').inputValue(), 'Unsaved draft after a conflict');
    const afterConflict = (await readIndexedDbState(page)).cards.find(c => c.id === editedLayoutCard.id);
    assert.equal(afterConflict.revision, editedLayoutCard.revision + 1);
    assert.equal(afterConflict.content_v2.card.data.prompt, 'Newer local text');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.view-editor').getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.locator('.view-editor').waitFor({ state: 'hidden' });

    // 5. StudyView reflection + grading SRS + edit via StudyHeader + reload persistence + delete
    await page.locator('.view-cards .back-btn').click({ force: true });
    await page.locator('.deck-intro-btn-start').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-btn-start').click();
    await page.locator('#tut-study-edit-card').waitFor({ state: 'visible' });
    await page.locator('#tut-study-add-card').waitFor({ state: 'visible' });

    const currentStudyPrompt = await page.evaluate(() => {
      return document.querySelector('#tut-study-card')?.innerText || '';
    });
    assert.ok(currentStudyPrompt.length > 0);
    await page.locator('.study-card-flip-button').click();
    await gradeCard(page, 2);

    // Edit the now-active second study card from StudyHeader (#tut-study-edit-card)
    await page.locator('#tut-study-edit-card').click();
    await page.locator('.view-editor').waitFor({ state: 'visible' });
    await page.locator('#card-editor-front').fill('Edited Live In Study');
    await saveCurrentCardForm(page);
    await page.locator('#tut-study-card').waitFor({ state: 'visible' });
    await page.getByText('Edited Live In Study', { exact: false }).waitFor({ state: 'visible' });

    // Force-stop simulation (reload page) -> edited content & SRS progress survive, zero cloud queues
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).waitFor({ state: 'visible' });
    const postReload = await readIndexedDbState(page);
    assert.ok(postReload.cards.some(c => c.content_v2?.card?.data?.prompt === 'Edited Live In Study'), 'Live study edit must survive reload');
    assert.ok(postReload.progress.some(p => p.repetitions === 1), 'Graded SRS must survive edit and reload');
    const syncKeys = postReload.syncState.map(s => s.key);
    for (const prefix of ['card-create-v2:', 'card-edit-v2:', 'card-lifecycle-v2:', 'review:']) {
      assert.equal(syncKeys.some(k => k.startsWith(prefix)), false, `Forbidden cloud key: ${prefix}`);
    }

    // Delete card from CardEditor
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-list').click();
    const deleteRow = page.locator('.card-item').filter({ hasText: 'Edited Live In Study' }).first();
    await deleteRow.locator('.card-item-actions-trigger').click();
    await page.getByRole('button', { name: /Редактировать/ }).click();
    await page.getByTestId('standalone-editor-delete-btn').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04-editor-delete-button-375.png'), fullPage: true });
    page.once('dialog', d => d.accept());
    await page.getByTestId('standalone-editor-delete-btn').click();
    await page.locator('.view-editor').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.card-item').filter({ hasText: 'Edited Live In Study' }).count(), 0);

    // 6. Imported ZIP -> local edit -> re-import protection -> ZIP export with Admin Python verify
    if (importZipPath) {
      await page.locator('.view-cards .back-btn').click({ force: true });
      await page.locator('.deck-intro-back-btn').click();
      await page.getByTestId('standalone-open-materials-btn').click();
      await page.getByTestId('standalone-import-materials-input').setInputFiles(importZipPath);
      await page.getByTestId('standalone-import-confirm-btn').click();
      await page.getByTestId('standalone-materials-status').waitFor({ state: 'visible' });
      await page.locator('.settings-header .close-btn').click();

      await page.getByRole('heading', { name: 'Imported Lib Deck' }).click();
      await page.locator('.deck-intro-btn-list').click();
      const impRow = page.locator('.card-item').filter({ hasText: 'Original Imported One' }).first();
      await impRow.locator('.card-item-actions-trigger').click();
      await page.getByRole('button', { name: /Редактировать/ }).click();
      await page.locator('#card-editor-front').fill('Protected Imported Edit');
      await saveCurrentCardForm(page);

      // Create new card inside imported deck
      await page.locator('#tut-fab-add').click();
      await page.locator('#card-editor-front').fill('Authored Inside Imported Deck');
      await page.locator('#card-editor-back').fill('Создано внутри импорта');
      await saveCurrentCardForm(page);

      // Re-import same ZIP -> verify protection notice & survival
      await page.locator('.view-cards .back-btn').click({ force: true });
      await page.locator('.deck-intro-back-btn').click();
      await page.getByTestId('standalone-open-materials-btn').click();
      await page.getByTestId('standalone-import-materials-input').setInputFiles(importZipPath);
      await page.getByTestId('standalone-import-protected-notice').waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(EVIDENCE_DIR, '05-reimport-protected-notice-375.png'), fullPage: true });
      await page.getByTestId('standalone-import-confirm-btn').click();
      await page.getByTestId('standalone-materials-status').waitFor({ state: 'visible' });

      const afterReimport = await readIndexedDbState(page);
      const impDeck = afterReimport.decks.find(d => d.name === 'Imported Lib Deck');
      const impCards = afterReimport.cards.filter(c => c.deck_id === impDeck.id && !c.is_deleted);
      const prompts = impCards.map(c => c.content_v2.card.data.prompt);
      assert.ok(prompts.includes('Protected Imported Edit'), 'Local edit must survive ZIP re-import');
      assert.ok(prompts.includes('Original Imported Two'), 'Unedited imported card remains');
      assert.ok(prompts.includes('Authored Inside Imported Deck'), 'Newly created card remains');

      const deckCheckbox = page.getByTestId(`standalone-export-deck-${impDeck.id}`);
      await deckCheckbox.check();
      const [zipDl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('standalone-export-materials-btn').click(),
      ]);
      const exportedPath = path.join(tempWorkDir, zipDl.suggestedFilename());
      await zipDl.saveAs(exportedPath);
      const pyExportCheck = inspectZipWithAdminPython(exportedPath);
      assert.equal(pyExportCheck.cards, 3);
      assert.ok(pyExportCheck.prompts.includes('Protected Imported Edit'));
      assert.ok(pyExportCheck.prompts.includes('Authored Inside Imported Deck'));
    }

    assert.deepEqual(forbiddenRequests, [], `Forbidden requests detected: ${JSON.stringify(forbiddenRequests)}`);
    assert.deepEqual(pageErrors, [], `Page errors detected: ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(consoleErrors, [], `Console errors detected: ${JSON.stringify(consoleErrors)}`);

    console.log('STANDALONE CARD EDITOR E2E PASSED:', {
      all9TypesCreated: true,
      layoutPreserved: true,
      liveStudyEditAndSrsPersisted: true,
      zipReimportProtectedAndExported: Boolean(importZipPath),
      forbiddenRequests: 0,
      pageErrors: 0,
      consoleErrors: 0,
      evidenceDir: EVIDENCE_DIR,
    });
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tempWorkDir, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('STANDALONE CARD EDITOR E2E FAILED:', err);
  process.exit(1);
});
