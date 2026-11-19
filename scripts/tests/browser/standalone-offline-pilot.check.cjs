const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

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
        const storeNames = ['decks', 'cards', 'progress', 'syncState'].filter(n => db.objectStoreNames.contains(n));
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

    const overflowHome = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflowHome, false, 'Home decks screen must not overflow horizontally at 375px');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-home-decks.png'), fullPage: true });

    // 2. Study Deck 1 (12 cards, exercising ALL 7 offline card types)
    await page.getByRole('heading', { name: 'Alltag & Kommunikation (A2)' }).click();
    await page.locator('.deck-intro-btn-start').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-deck-intro.png'), fullPage: true });
    await page.locator('.deck-intro-btn-start').click();

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
