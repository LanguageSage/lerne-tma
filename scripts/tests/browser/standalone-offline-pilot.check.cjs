const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { expect } = require('@playwright/test');

const WORKTREE_ROOT = path.resolve(__dirname, '../../..');
const DIST_DIR = path.join(WORKTREE_ROOT, 'app', 'dist');
const EVIDENCE_DIR = path.join(WORKTREE_ROOT, 'local', 'test-data', 'standalone-pilot-evidence');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
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

async function readIndexedDbState(page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const standaloneDbMeta = dbs.find(d => d.name && d.name.startsWith('LerneStandaloneDB_'));
    if (!standaloneDbMeta) {
      return { found: false, dbNames: dbs.map(d => d.name) };
    }
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(standaloneDbMeta.name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const storeNames = ['folders', 'decks', 'cards', 'progress', 'syncState'].filter(n => db.objectStoreNames.contains(n));
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
  const buttons = page.locator('.grade-buttons .btn-grade');
  const target = buttons.nth(gradeIndex);
  await target.waitFor({ state: 'visible', timeout: 8000 });
  // Respect GradeButtons 350ms double-tap debounce
  await page.waitForTimeout(430);
  await target.click();
}

async function completeTheoryOrStandard(page, gradeIndex) {
  const flipBtn = page.locator('.study-card-flip-button');
  await flipBtn.waitFor({ state: 'visible', timeout: 8000 });
  await flipBtn.click();
  await page.locator('#tut-study-answer, .card-back').first().waitFor({ state: 'visible', timeout: 5000 });
  await gradeCard(page, gradeIndex);
}

async function completeTrainer(page, actions, gradeIndex) {
  const trainer = page.locator('.trainer-exercise');
  await trainer.waitFor({ state: 'visible', timeout: 8000 });
  for (const action of actions) {
    if (action.kind === 'input') {
      const input = trainer.locator('input.trainer-gap').nth(action.index ?? 0);
      await input.fill(action.value);
    } else if (action.kind === 'choice') {
      const btn = trainer.locator('.trainer-choice-gap').nth(action.index ?? 0);
      await btn.click();
      const option = page.getByRole('dialog').getByRole('button', { name: action.value, exact: true });
      await option.waitFor({ state: 'visible', timeout: 5000 });
      await option.click();
    }
  }
  const checkBtn = page.locator('.trainer-footer-action').last();
  await checkBtn.waitFor({ state: 'visible', timeout: 5000 });
  await checkBtn.click();
  await page.waitForTimeout(200);
  await gradeCard(page, gradeIndex);
}

async function completeQuiz(page, optionText, gradeIndex) {
  const quiz = page.locator('.quiz-container');
  await quiz.waitFor({ state: 'visible', timeout: 8000 });
  await quiz.getByText(optionText, { exact: true }).click();
  const checkBtn = quiz.locator('.btn-check-quiz');
  await checkBtn.click();
  await quiz.locator('.quiz-option-item.correct').first().waitFor({ state: 'visible', timeout: 5000 });
  await gradeCard(page, gradeIndex);
}

async function completeMatch(page, pairs, gradeIndex) {
  const match = page.locator('.match-container');
  await match.waitFor({ state: 'visible', timeout: 8000 });
  for (const [left, right] of pairs) {
    await match.getByText(left, { exact: true }).click();
    await match.getByText(right, { exact: true }).click();
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(200);
  await gradeCard(page, gradeIndex);
}

async function completePuzzle(page, tokenCount, gradeIndex, screenshotPath = null) {
  const puzzle = page.locator('.puzzle-exercise');
  await puzzle.waitFor({ state: 'visible', timeout: 8000 });
  for (let id = 0; id < tokenCount; id += 1) {
    await puzzle.locator(`.btn-puzzle-chip[data-id="${id}"]`).click();
  }
  await puzzle.locator('.puzzle-check-action').click();
  await page.locator('.puzzle-exercise.is-correct').waitFor({ state: 'visible', timeout: 5000 });
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
  await gradeCard(page, gradeIndex);
}

async function completeWordBank(page, words, gradeIndex) {
  const bank = page.locator('.word-bank-exercise');
  await bank.waitFor({ state: 'visible', timeout: 8000 });
  for (const word of words) {
    await bank.locator('.word-bank-option', { hasText: word }).first().click();
  }
  const checkBtn = page.locator('.study-card-footer-action-target .word-bank-check, .word-bank-check').first();
  await checkBtn.click();
  await bank.locator('.word-bank-gap.is-correct').first().waitFor({ state: 'visible', timeout: 5000 });
  await gradeCard(page, gradeIndex);
}

async function checkWrittenCards(page) {
  const { buildZipArchive } = await import('../../../app/src/pilot/zipCodec.js');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const image = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const audio = Buffer.alloc(44 + 32000);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  const assetRecord = (bytes, folder, ext, mime) => {
    const sha256 = hash(bytes);
    return {
      sha256, folder, mime, size: bytes.length,
      filename: `archive_${sha256}.${ext}`,
      path: `media/${sha256}.${ext}`,
    };
  };
  const imageAsset = assetRecord(image, 'images', 'gif', 'image/gif');
  const audioAsset = assetRecord(audio, 'audio', 'wav', 'audio/wav');
  const freeText = { type: 'free_text', data: { prompt: 'Wo wohnst du?', sample_answer: 'Ich wohne in Berlin.' }, image: `archive://${imageAsset.sha256}` };
  const editableText = { type: 'editable_text', data: { source_text: 'Die Katze schlafen.', correct_text: 'Die Katze schläft.' } };
  const name = 'Schreiben offline';
  const manifest = Buffer.from(JSON.stringify({
    format: 'lerne-materials',
    version: 4,
    source: `LOCAL:${hash('browser-written-cards-fixture')}`,
    source_users: [{ id: 1, name: 'Fixture', username: null }],
    assets: [imageAsset, audioAsset],
    content: {
      folder: [],
      deck: [{ id: 1, author: 1, values: {
        name, level: 'A2', topic: null, target_language: 'de', position: 0,
        is_deleted: false, folder_id: null, metadata: null, scope: 'personal', category_id: null, is_default: false,
      } }],
      card: [freeText, editableText].map((card, position) => ({ id: position + 1, author: 1, values: {
        content_v2: { schema_version: 2, card }, image_path: null,
        audio_path: position === 0 ? `archive://${audioAsset.sha256}` : null, audio_back_path: null,
        video_front_path: null, video_back_path: null, difficulty: null, source: 'user', position, is_deleted: false, deck_id: 1,
      } })),
    },
  }));
  const archive = await buildZipArchive([
    { name: 'manifest.json', data: manifest },
    { name: 'manifest.sha256', data: Buffer.from(hash(manifest)) },
    { name: imageAsset.path, data: image },
    { name: audioAsset.path, data: audio },
  ]);

  await page.locator('#tut-main-settings').click();
  await page.locator('#settings-tab-select').selectOption('profile');
  await page.getByTestId('standalone-import-materials-input').setInputFiles({
    name: 'written-cards.zip', mimeType: 'application/zip', buffer: Buffer.from(archive),
  });
  await page.getByTestId('standalone-import-confirm-btn').click();
  await page.getByTestId('standalone-materials-status').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name, exact: true }).click();
  const imported = await readIndexedDbState(page);
  const importedDeck = imported.decks.find(deck => deck.name === name);
  const importedIds = new Set(imported.cards.filter(card => card.deck_id === importedDeck.id).map(card => card.id));
  const countWrittenProgress = async () => {
    const { progress } = await readIndexedDbState(page);
    return progress.filter(row => importedIds.has(row.card_id)).length;
  };
  await page.locator('.deck-intro-btn-start').click();
  await page.waitForFunction(() => document.querySelector('#tut-study-card img[src^="blob:"]')?.naturalWidth === 1);
  const audioPlayer = page.locator('.card-audio-floating-wrapper .study-controls-block');
  await audioPlayer.waitFor();
  if (await audioPlayer.locator('.study-controls-restore').isEnabled()) {
    await audioPlayer.locator('.study-controls-restore').click();
  }
  if ((await audioPlayer.locator('.audio-player-btn-main.playing').count()) === 0) {
    await audioPlayer.locator('.audio-player-btn-main').click();
  }
  await audioPlayer.locator('.audio-player-btn-main.playing').waitFor();

  for (const [selector, data, correctAnswer] of [
    ['.free-text-exercise:not(.editable-text-exercise)', freeText.data, freeText.data.sample_answer],
    ['.editable-text-exercise', editableText.data, editableText.data.correct_text],
  ]) {
    const exercise = page.locator(selector);
    const input = exercise.locator('textarea');
    await input.waitFor();
    assert.equal(await exercise.locator('.free-text-dictate').count(), 0);
    if (data.source_text) {
      assert.equal(await countWrittenProgress(), 1, 'Advance to the next card requires a committed grade');
      assert.equal(await input.inputValue(), data.source_text);
    }
    await input.fill('Unpassende Antwort.');
    await exercise.locator('button[type="submit"]').click();
    await exercise.locator('.free-text-feedback:not(.is-success)').waitFor();
    await input.fill(correctAnswer);
    await exercise.locator('button[type="submit"]').click();
    await exercise.locator('.free-text-feedback.is-success').waitFor();
    await gradeCard(page, 2);
  }
  await expect.poll(countWrittenProgress).toBe(2);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name, exact: true }).waitFor();
  assert.equal(await countWrittenProgress(), 2);
}

async function checkLocalAuthoringAndTrash(page) {
  await page.evaluate(() => localStorage.setItem('native_language', 'ru'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)', exact: true }).waitFor({ state: 'visible' });

  // 1. Seed deck 9101 remains structurally readonly in UI
  assert.equal(await page.locator('#deck-item-9101 .pin-deck-btn').count(), 0, 'Seed deck must not show Pin button');
  assert.equal(await page.locator('#deck-item-9101 .deck-drag-handle-bottom').count(), 0, 'Seed deck must not show DragHandle');
  await page.locator('#deck-item-9101 .card-item-actions-trigger').click();
  const seedMenu = page.locator('#deck-item-9101 .deck-dropdown-menu');
  await seedMenu.waitFor({ state: 'visible' });
  assert.equal(await seedMenu.getByText('Переименовать', { exact: false }).count(), 0);
  assert.equal(await seedMenu.getByText('Переместить в', { exact: false }).count(), 0);
  assert.equal(await seedMenu.getByText('Удалить колоду', { exact: false }).count(), 0);
  assert.equal(await seedMenu.getByText('Совместный доступ', { exact: false }).count(), 0);
  assert.equal(await seedMenu.getByText('Поделиться', { exact: false }).count(), 0);
  assert.equal(await seedMenu.getByText('Скопировать в', { exact: false }).count(), 0);
  assert.equal(await seedMenu.getByText('Обновить CEFR-уровни', { exact: false }).count(), 0);
  await page.locator('#deck-item-9101 .card-item-actions-trigger').click();

  // 2. Create folder via #tut-add-deck (and verify "Из Библиотеки" is absent)
  await page.locator('#tut-add-deck').click();
  const addModal = page.locator('.settings-modal');
  await addModal.getByRole('button', { name: /Создать колоду/ }).waitFor({ state: 'visible' });
  await addModal.getByRole('button', { name: /Создать папку/ }).waitFor({ state: 'visible' });
  assert.equal(await addModal.getByText('Из Библиотеки', { exact: false }).count(), 0, 'Online library import must be hidden offline');
  await addModal.getByRole('button', { name: /Создать папку/ }).click();
  await addModal.locator('input[placeholder="Введите название..."]').fill('E3 Test Folder');
  await addModal.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('heading', { name: 'E3 Test Folder', exact: true }).waitFor({ state: 'visible' });

  // 3. Rename folder & verify online-only menu items are hidden
  const dbAfterFolder = await readIndexedDbState(page);
  const createdFolder = dbAfterFolder.folders.find(f => f.name === 'E3 Test Folder' && !f.is_deleted);
  assert.ok(createdFolder && createdFolder.id > 1_000_000, 'Created folder must have positive local ID > 1_000_000');
  assert.equal(createdFolder.is_dirty, 0);
  assert.equal(createdFolder.role, 'owner');

  await page.locator(`#folder-item-${createdFolder.id} .card-item-actions-trigger`).click();
  const folderMenu = page.locator(`#folder-item-${createdFolder.id} .deck-dropdown-menu`);
  await folderMenu.waitFor({ state: 'visible' });
  assert.equal(await folderMenu.getByText('Совместный доступ', { exact: false }).count(), 0);
  assert.equal(await folderMenu.getByText('Поделиться содержимым', { exact: false }).count(), 0);
  assert.equal(await folderMenu.getByText('Опубликовать глобально', { exact: false }).count(), 0);
  page.once('dialog', d => d.accept('E3 Renamed Folder'));
  await folderMenu.getByRole('button', { name: /Переименовать/ }).click();
  await page.getByRole('heading', { name: 'E3 Renamed Folder', exact: true }).waitFor({ state: 'visible' });

  // 4. Create deck, verify online-only menu hiding, rename & move into folder
  await page.locator('#tut-add-deck').click();
  await addModal.getByRole('button', { name: /Создать колоду/ }).click();
  await addModal.locator('input[placeholder="Введите название..."]').fill('E3 Test Deck');
  await addModal.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('heading', { name: 'E3 Test Deck', exact: true }).waitFor({ state: 'visible' });

  const dbAfterDeck = await readIndexedDbState(page);
  const createdDeck = dbAfterDeck.decks.find(d => d.name === 'E3 Test Deck' && !d.is_deleted);
  assert.ok(createdDeck && createdDeck.id > 1_000_000, 'Created deck must have positive local ID > 1_000_000');
  assert.equal(createdDeck.is_dirty, 0);
  assert.equal(createdDeck.role, 'owner');

  await page.locator(`#deck-item-${createdDeck.id} .card-item-actions-trigger`).click();
  const deckMenu = page.locator(`#deck-item-${createdDeck.id} .deck-dropdown-menu`);
  await deckMenu.waitFor({ state: 'visible' });
  assert.equal(await deckMenu.getByText('Совместный доступ', { exact: false }).count(), 0);
  assert.equal(await deckMenu.getByText('Поделиться', { exact: false }).count(), 0);
  assert.equal(await deckMenu.getByText('Обновить', { exact: false }).count(), 0);
  assert.equal(await deckMenu.getByText('Скопировать в', { exact: false }).count(), 0);
  assert.equal(await deckMenu.getByText('Обновить CEFR-уровни', { exact: false }).count(), 0);
  await deckMenu.getByRole('button', { name: /Переименовать/ }).click();

  const renameModal = page.locator('.settings-modal');
  await renameModal.waitFor({ state: 'visible' });
  await renameModal.locator('input[placeholder="Введите название..."]').fill('E3 Renamed Deck');
  await renameModal.locator('select').selectOption(String(createdFolder.id));
  await renameModal.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await renameModal.waitFor({ state: 'hidden' });

  await page.getByRole('heading', { name: 'E3 Renamed Folder', exact: true }).click();
  await page.getByRole('heading', { name: 'E3 Renamed Deck', exact: true }).waitFor({ state: 'visible' });

  // 5. DeckIntro edit enabled on user deck + CardList position reorder + batch copy
  await page.getByRole('heading', { name: 'E3 Renamed Deck', exact: true }).click();
  await page.locator('.deck-intro-edit-btn').waitFor({ state: 'visible' });
  await page.locator('.deck-intro-edit-btn').click();
  await page.locator('input[placeholder="Например: Склонение прилагательных"]').fill('E3 Topic');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.locator('.deck-intro-topic-badge', { hasText: 'E3 Topic' }).waitFor({ state: 'visible' });

  await page.locator('.deck-intro-btn-list').click();
  await page.locator('#tut-fab-add').waitFor({ state: 'visible' });
  assert.equal(await page.locator('button[title="Пакетная генерация карточек"]').count(), 0, 'AI BatchModal trigger must be hidden offline');

  for (const [front, back] of [['E3 Card One', 'Один'], ['E3 Card Two', 'Два']]) {
    await page.locator('#tut-fab-add').click();
    await page.locator('#card-editor-front').fill(front);
    await page.locator('#card-editor-back').fill(back);
    await page.locator('.btn-save-action').first().click();
    await page.locator('.view-creator').waitFor({ state: 'hidden' });
  }

  // Reorder via CardActionModal -> Позиция в списке
  const firstCardRow = page.locator('.card-item').filter({ hasText: 'E3 Card One' }).first();
  await firstCardRow.locator('.card-item-actions-trigger').click();
  await page.getByRole('button', { name: /Позиция в списке/ }).click();
  await page.getByRole('button', { name: /В конец/ }).click();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await page.locator('.card-action-modal').waitFor({ state: 'hidden' });
  await expect.poll(async () => page.locator('.card-item .front-min').allInnerTexts()).toEqual(['E3 Card Two', 'E3 Card One']);

  // Batch copy via Selection Mode + FloatingBatchDock
  await page.locator('button[title="Выбрать несколько карточек"]').click();
  await page.locator('.batch-actions-bar').waitFor({ state: 'visible' });
  await page.locator('.card-item').filter({ hasText: 'E3 Card Two' }).first().click();
  await page.locator('.batch-action-btn.copy-btn').click();
  await page.locator('.settings-modal .deck-selector-list').getByRole('button', { name: /Schreiben offline/ }).click();
  await page.locator('.settings-modal').getByRole('button', { name: 'Копировать (1)', exact: true }).click();
  await page.locator('.batch-actions-bar').waitFor({ state: 'hidden' });

  const dbAfterCopy = await readIndexedDbState(page);
  const targetDeck = dbAfterCopy.decks.find(d => d.name === 'Schreiben offline');
  const copiedCards = dbAfterCopy.cards.filter(c => c.deck_id === targetDeck.id && !c.is_deleted);
  assert.ok(copiedCards.some(c => c.content_v2?.card?.data?.prompt === 'E3 Card Two'), 'Batch copy must duplicate card into target deck');

  // 6. Delete deck + delete folder -> Trash parent_deleted guard -> Restore -> Reload persistence
  await page.locator('.view-cards .back-btn').click({ force: true });
  await page.locator('.deck-intro-back-btn').click();
  await page.locator(`#deck-item-${createdDeck.id} .card-item-actions-trigger`).click();
  page.once('dialog', d => d.accept());
  await page.locator(`#deck-item-${createdDeck.id} .deck-dropdown-menu`).getByRole('button', { name: /Удалить колоду/ }).click();
  await page.getByRole('heading', { name: 'E3 Renamed Deck', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Эта папка пуста', exact: true }).waitFor({ state: 'visible' });

  await page.locator('.header-top-left .back-btn').click({ force: true });
  await page.locator(`#folder-item-${createdFolder.id} .card-item-actions-trigger`).click();
  page.once('dialog', d => d.accept());
  await page.locator(`#folder-item-${createdFolder.id} .deck-dropdown-menu`).getByRole('button', { name: /Удалить папку/ }).click();
  await page.getByRole('heading', { name: 'E3 Renamed Folder', exact: true }).waitFor({ state: 'hidden' });

  await page.locator('.bottom-tools-toggle').click();
  await page.locator('.bottom-tools-item.trash-item').click();
  await page.locator('.trash-container').waitFor({ state: 'visible' });

  // Deck restore must be blocked until parent folder is restored
  await page.getByText('Сначала восстановите родительскую папку.', { exact: true }).waitFor({ state: 'visible' });
  const deckTrashBtn = page.locator('.trash-card').filter({ hasText: 'E3 Renamed Deck' }).locator('.trash-restore-btn');
  assert.equal(await deckTrashBtn.isDisabled(), true, 'Deck restore must be disabled when parent folder is deleted');

  // Restore folder first, then deck
  await page.locator('.trash-tab').filter({ hasText: 'Папки' }).click();
  await page.locator('.trash-card').filter({ hasText: 'E3 Renamed Folder' }).locator('.trash-restore-btn').click();
  await page.locator('.trash-card').filter({ hasText: 'E3 Renamed Folder' }).waitFor({ state: 'hidden' });

  await page.locator('.trash-tab').filter({ hasText: 'Колоды' }).click();
  await expect.poll(async () => deckTrashBtn.isDisabled()).toBe(false);
  await deckTrashBtn.click();
  await page.locator('.trash-card').filter({ hasText: 'E3 Renamed Deck' }).waitFor({ state: 'hidden' });

  await page.locator('.trash-back-btn').click({ force: true });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'E3 Renamed Folder', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'E3 Renamed Folder', exact: true }).click();
  await page.getByRole('heading', { name: 'E3 Renamed Deck', exact: true }).waitFor({ state: 'visible' });

  // 7. DuplicateManager in IS_STANDALONE: verify visibility, duplicate rendering, and Share2 absence
  await page.locator('.header-top-left .back-btn').click({ force: true });
  await page.locator('.bottom-tools-toggle').waitFor({ state: 'visible' });
  await page.locator('.bottom-tools-toggle .tools-badge-total').waitFor({ state: 'visible' });
  await page.locator('.bottom-tools-toggle').click();
  const dupToolsItem = page.locator('.bottom-tools-item.duplicate-item');
  await dupToolsItem.waitFor({ state: 'visible' });
  await dupToolsItem.click();
  await page.locator('.view-duplicates').waitFor({ state: 'visible' });
  await page.locator('.view-duplicates .group-header').filter({ hasText: 'E3 Card Two' }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.view-duplicates .duplicate-item').count(), 2, 'DuplicateManager must list both copies of E3 Card Two');
  assert.equal(
    await page.locator('.view-duplicates svg.lucide-share2, .view-duplicates svg.lucide-share-2, .view-duplicates button[aria-label="Поделиться"]').count(),
    0,
    'Share2 button must be hidden in standalone DuplicateManager'
  );
  assert.equal(
    await page.locator('.view-duplicates .duplicate-item .item-actions button').count(),
    4,
    'Only Edit and Delete buttons (2 per card x 2 cards) should render in standalone DuplicateManager'
  );
  await page.locator('.view-duplicates .back-btn').click({ force: true });
  await page.locator('.view-decks').waitFor({ state: 'visible' });

  const finalDb = await readIndexedDbState(page);
  assert.equal(finalDb.folders.every(f => f.is_dirty === 0), true, 'All standalone folders must stay is_dirty === 0');
  assert.equal(finalDb.decks.every(d => d.is_dirty === 0), true, 'All standalone decks must stay is_dirty === 0');
  assert.equal(finalDb.cards.every(c => c.is_dirty === 0), true, 'All standalone cards must stay is_dirty === 0');
  for (const prefix of ['card-create-v2:', 'card-edit-v2:', 'card-move-v2:', 'card-lifecycle-v2:', 'review:']) {
    assert.equal(finalDb.syncState.some(s => s.key.startsWith(prefix)), false, `Forbidden cloud key: ${prefix}`);
  }
}

async function run() {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(`Standalone app/dist missing at ${DIST_DIR}`);
  }
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const distHtml = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  assert.equal(distHtml.includes('telegram.org'), false, 'Standalone dist/index.html must not contain telegram.org');
  assert.equal(distHtml.includes('fonts.googleapis.com'), false, 'Standalone dist/index.html must not contain Google Fonts');

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

    // Strict zero-network/zero-API enforcement: only local static bundle allowed
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
      const isApiCall = parsed.pathname.startsWith('/api/');
      if (!isLocalOrigin || isApiCall) {
        forbiddenRequests.push({ url, method: route.request().method() });
        return route.abort();
      }
      return route.continue();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // 1. Cold offline boot (empty localStorage & empty IndexedDB)
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByText('Alltag & Kommunikation (A2)', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('Perfekt & Plusquamperfekt (B1)', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText('Nebensätze & Konjunktionen (B1)', { exact: true }).waitFor({ state: 'visible' });

    assert.equal(await page.locator('.guest-banner').count(), 0, 'GuestBanner must not show in standalone mode');
    assert.equal(await page.locator('.language-modal-overlay').count(), 0, 'LanguageWelcomeModal must not block cold boot');
    assert.equal(await page.locator('.auth-modal, [data-testid="auth-required-modal"]').count(), 0, 'Auth modal must not open');
    assert.equal(await page.locator('#tut-add-deck').count(), 1, 'Create deck/folder button must be visible in standalone mode');

    const overflowHome = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflowHome, false, 'Home decks screen must not overflow horizontally at 375px');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-home-decks.png'), fullPage: true });

    // 2. Study Deck 1 (12 cards, exercising ALL 7 offline card types)
    const seeded = await readIndexedDbState(page);
    const firstDeck = seeded.decks.find(deck => deck.name === 'Alltag & Kommunikation (A2)');
    const firstCard = seeded.cards.filter(card => card.deck_id === firstDeck.id)
      .sort((a, b) => a.position - b.position)[0];
    await page.evaluate(({ dbName, card }) => new Promise((resolve, reject) => {
      const open = indexedDB.open(dbName);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['cards', 'media'], 'readwrite');
        const url = new URL('/api/media/images/standalone-test.svg', location.origin).href;
        const blob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="purple"/></svg>'], { type: 'image/svg+xml' });
        tx.objectStore('media').put({ url, blob });
        tx.objectStore('cards').put({ ...card, image_path: url });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), { dbName: seeded.dbName, card: firstCard });
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-start').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.deck-intro-edit-btn').count(), 0, 'Deck intro edit button must be hidden in standalone read-only mode');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-deck-intro.png'), fullPage: true });
    await page.locator('.deck-intro-btn-start').click();

    const cachedImage = page.locator('#tut-study-card img[src^="blob:"]');
    await cachedImage.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#tut-study-card img[src^="blob:"]')?.naturalWidth === 24);
    await page.locator('.study-card-flip-button').click();
    await page.locator('.card-back').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.study-card-rating, .card-question-composer').count(), 0,
      'Standalone study should hide the server-backed rating and question controls');
    assert.equal(await page.locator('#tut-study-add-card, #tut-study-edit-card').count(), 2,
      'Standalone study should expose local authoring controls');
    await page.locator('.study-card-flip-button').click();
    await page.locator('.card-front').waitFor({ state: 'visible' });
    await completeTheoryOrStandard(page, 2); // a2-01 theory -> Good
    await completeTheoryOrStandard(page, 0); // a2-02 standard -> Again
    await completeTheoryOrStandard(page, 1); // a2-03 standard -> Hard
    await completeTheoryOrStandard(page, 2); // a2-04 standard -> Good
    await completeTrainer(page, [{ kind: 'input', index: 0, value: 'können' }], 3); // a2-05 trainer input -> Easy
    await completeTrainer(page, [{ kind: 'choice', index: 0, value: 'um' }], 2); // a2-06 trainer choice -> Good
    await completeQuiz(page, 'Ich hätte gern einen Kaffee ohne Zucker, bitte.', 2); // a2-07 quiz -> Good
    await completeQuiz(page, 'Das passt mir gut.', 3); // a2-08 quiz multi -> Easy
    await completeMatch(page, [
      ['absagen', 'отменить'],
      ['einladen', 'пригласить'],
      ['mitbringen', 'принести с собой'],
      ['vergleichen', 'сравнить'],
    ], 2); // a2-09 match -> Good
    await completeMatch(page, [
      ['Wohin?', 'Куда?'],
      ['Woher?', 'Откуда?'],
      ['Wie lange?', 'Как долго?'],
    ], 2); // a2-10 match -> Good
    await completePuzzle(page, 7, 3, path.join(EVIDENCE_DIR, '03-study-puzzle-correct.png')); // a2-11 puzzle -> Easy
    await completeWordBank(page, ['Kasse', 'bezahlen'], 2); // a2-12 word_bank -> Good

    await page.locator('.lesson-completion-btn-primary').waitFor({ state: 'visible' });
    await page.locator('.lesson-completion-btn-primary').click();
    await page.locator('.deck-intro-back-btn').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-back-btn').click();

    // 3. Study Deck 2 (10 cards -> 12 + 10 = 22 graded cards total!)
    await page.getByRole('heading', { name: 'Perfekt & Plusquamperfekt (B1)' }).click();
    await page.locator('.deck-intro-btn-start').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-btn-start').click();

    await completeTheoryOrStandard(page, 2); // b1-past-01 theory
    await completeTheoryOrStandard(page, 2); // b1-past-02 standard
    await completeTheoryOrStandard(page, 3); // b1-past-03 standard
    await completeTrainer(page, [
      { kind: 'choice', index: 0, value: 'Nachdem' },
      { kind: 'input', index: 0, value: 'hatte' },
    ], 2); // b1-past-04 trainer mixed
    await completeTrainer(page, [{ kind: 'choice', index: 0, value: 'ist' }], 2); // b1-past-05 trainer choice
    await completeTrainer(page, [{ kind: 'input', index: 0, value: 'vergessen' }], 1); // b1-past-06 trainer input
    await completeQuiz(page, 'Er ist das ganze Wochenende zu Hause geblieben.', 2); // b1-past-07 quiz
    await completeMatch(page, [
      ['schreiben', 'geschrieben'],
      ['sprechen', 'gesprochen'],
      ['helfen', 'geholfen'],
      ['nehmen', 'genommen'],
    ], 2); // b1-past-08 match
    await completePuzzle(page, 8, 3); // b1-past-09 puzzle
    await completeWordBank(page, ['ist', 'angekommen'], 2); // b1-past-10 word_bank

    await page.locator('.lesson-completion-btn-primary').waitFor({ state: 'visible' });
    await page.locator('.lesson-completion-btn-primary').click();
    await page.locator('.deck-intro-back-btn').waitFor({ state: 'visible' });
    await page.locator('.deck-intro-back-btn').click();

    // 4. Kill/Relaunch simulation (reload) + Dexie SRS & idempotency check
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Alltag & Kommunikation (A2)', { exact: true }).waitFor({ state: 'visible' });

    const postRelaunchDb = await readIndexedDbState(page);
    assert.equal(postRelaunchDb.found, true);
    assert.equal(postRelaunchDb.decks.length, 3, 'Must have exactly 3 decks after relaunch');
    assert.equal(postRelaunchDb.cards.length, 30, 'Must have exactly 30 cards after relaunch (no duplicate seed)');
    assert.equal(postRelaunchDb.progress.length, 22, 'Must persist all 22 SRS progress rows across reload');
    assert.equal(
      postRelaunchDb.progress.every(r => Boolean(r.last_reviewed) && Boolean(r.next_review)),
      true,
      'Every graded SRS row must have last_reviewed and next_review'
    );
    const seedManifest = postRelaunchDb.syncState.find(s => s.key === 'standalone_seed_manifest');
    assert.equal(seedManifest?.pack_version, 1);
    const reviewEntries = postRelaunchDb.syncState.filter(s => s.key.startsWith('review:'));
    const gradeEntries = postRelaunchDb.syncState.filter(s => s.key.startsWith('grade:'));
    assert.equal(reviewEntries.length, 0, 'Standalone mode must not accumulate syncState review: entries');
    assert.equal(gradeEntries.length, 22, 'Standalone mode should retain recent bounded grade: receipts (22 <= 64)');

    // 5. Settings -> Profile -> Backup Export -> Tamper/Wrong-Format Reject -> Clean Install Wipe -> Restore
    await page.locator('#tut-main-settings').click();
    await page.locator('#settings-tab-select').selectOption('profile');
    await page.locator('[data-testid="standalone-export-progress-btn"]').waitFor({ state: 'visible' });

    const overflow375 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow375, false, 'Settings Profile backup UI must not overflow at 375px');
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '04-settings-backup-375.png'), fullPage: true });

    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(150);
    const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow320, false, 'Settings Profile backup UI must not overflow at 320px');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '05-settings-backup-320.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid="standalone-export-progress-btn"]').click(),
    ]);
    const backupFilePath = path.join(EVIDENCE_DIR, download.suggestedFilename());
    await download.saveAs(backupFilePath);
    const backupRaw = fs.readFileSync(backupFilePath, 'utf8');
    const backupJson = JSON.parse(backupRaw);
    assert.equal(backupJson.format, 'lerne-offline-progress-backup');
    assert.equal(backupJson.schema_version, 1);
    assert.equal(backupJson.records.length, 22);
    assert.match(backupJson.integrity?.payload_hash || '', /^[a-f0-9]{64}$/);
    await page.locator('[data-testid="standalone-backup-status"]').waitFor({ state: 'visible' });

    // Tampered file must be rejected cleanly
    const tamperedJson = JSON.parse(backupRaw);
    tamperedJson.records[0].interval = 9999;
    await page.locator('[data-testid="standalone-restore-file-input"]').setInputFiles({
      name: 'tampered.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(tamperedJson), 'utf8'),
    });
    await page.locator('[data-testid="standalone-backup-error"]').waitFor({ state: 'visible' });

    // Raw V2 deck JSON must be rejected with format mismatch
    const deckDocRaw = fs.readFileSync(path.join(WORKTREE_ROOT, 'app', 'src', 'pilot', 'decks', 'de_a2_alltag.json'), 'utf8');
    await page.locator('[data-testid="standalone-restore-file-input"]').setInputFiles({
      name: 'deck.json',
      mimeType: 'application/json',
      buffer: Buffer.from(deckDocRaw, 'utf8'),
    });
    await page.locator('[data-testid="standalone-backup-error"]').waitFor({ state: 'visible' });

    // Clean install simulation: wipe IndexedDB + localStorage + reload
    await wipeClientStorage(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Alltag & Kommunikation (A2)', { exact: true }).waitFor({ state: 'visible' });

    const cleanDb = await readIndexedDbState(page);
    assert.equal(cleanDb.decks.length, 3);
    assert.equal(cleanDb.cards.length, 30);
    assert.equal(cleanDb.progress.length, 0, 'Clean install must start with 0 progress rows');

    // Open Settings -> Profile -> Preview + Cancel must leave 0 progress rows
    await page.locator('#tut-main-settings').click();
    await page.locator('#settings-tab-select').selectOption('profile');
    await page.locator('[data-testid="standalone-restore-file-input"]').setInputFiles(backupFilePath);
    await page.locator('[data-testid="standalone-restore-confirm-card"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="standalone-restore-cancel-btn"]').scrollIntoViewIfNeeded();
    await page.locator('[data-testid="standalone-restore-cancel-btn"]').click();
    await page.locator('[data-testid="standalone-restore-confirm-card"]').waitFor({ state: 'hidden' });
    assert.equal((await readIndexedDbState(page)).progress.length, 0, 'Canceling restore must not write progress');

    // Confirm Restore -> Reload -> Exact 22 SRS records restored
    await page.locator('[data-testid="standalone-restore-file-input"]').setInputFiles(backupFilePath);
    await page.locator('[data-testid="standalone-restore-confirm-card"]').waitFor({ state: 'visible' });
    await page.locator('[data-testid="standalone-restore-confirm-card"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '06-restore-confirm.png'), fullPage: true });
    await page.locator('[data-testid="standalone-restore-confirm-btn"]').click();
    await page.locator('[data-testid="standalone-backup-status"]').waitFor({ state: 'visible' });

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Alltag & Kommunikation (A2)', { exact: true }).waitFor({ state: 'visible' });

    const restoredDb = await readIndexedDbState(page);
    assert.equal(restoredDb.decks.length, 3);
    assert.equal(restoredDb.cards.length, 30);
    assert.equal(restoredDb.progress.length, 22, 'All 22 SRS progress records must survive restore + relaunch');

    const beforeById = new Map(postRelaunchDb.progress.map(r => [r.card_id, r]));
    for (const row of restoredDb.progress) {
      const orig = beforeById.get(row.card_id);
      assert.ok(orig, `Unexpected restored card_id ${row.card_id}`);
      assert.equal(row.queue, orig.queue);
      assert.equal(row.interval, orig.interval);
      assert.equal(row.ease_factor, orig.ease_factor);
      assert.equal(row.repetitions, orig.repetitions);
      assert.equal(row.lapses, orig.lapses);
      assert.equal(row.next_review, orig.next_review);
      assert.equal(row.last_reviewed, orig.last_reviewed);
    }

    await checkWrittenCards(page);
    await checkLocalAuthoringAndTrash(page);
    assert.deepEqual(forbiddenRequests, [], `Forbidden network/API requests detected: ${JSON.stringify(forbiddenRequests)}`);
    assert.deepEqual(pageErrors, [], `Uncaught page errors detected: ${JSON.stringify(pageErrors)}`);
    assert.deepEqual(consoleErrors, [], `Console errors detected: ${JSON.stringify(consoleErrors)}`);

    console.log('STANDALONE OFFLINE PILOT E2E PASSED:', {
      decks: restoredDb.decks.length,
      cards: restoredDb.cards.length,
      restoredProgress: restoredDb.progress.length,
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
        const debugInfo = await pages[0].evaluate(() => ({
          buttons: Array.from(document.querySelectorAll('button')).map(b => ({ cls: b.className, text: b.textContent?.trim(), disabled: b.disabled })),
          cardText: document.querySelector('#tut-study-card')?.textContent?.slice(0, 300),
        }));
        console.error('FAILURE DEBUG INFO:', JSON.stringify(debugInfo, null, 2));
      }
    } catch {}
    throw err;
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error('STANDALONE OFFLINE PILOT E2E FAILED:', err);
  process.exit(1);
});
