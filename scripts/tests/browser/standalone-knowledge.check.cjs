// Opt-in real-material pilot. Run with the corrected D10/D14 snapshot and a local Python.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { expect } = require('@playwright/test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const targetSkill = 'de.relativsaetze.prepositions';
const pilotDecks = {
  d14: 'B1-09-10-D14 · Abschlusstest — Relativsätze',
  d10: 'B1-09-10-D10 · Aktive Anwendung und Fehlerdiagnose',
};

function makeArchive(snapshotPath, python, reverseDecks = false) {
  return execFileSync(python, ['-c', String.raw`
import hashlib, io, json, sys, zipfile
from pathlib import Path
from api.v1_to_v2_converter import convert_v1_card

snapshot = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
requested = {7139: {358375, 358377}, 7142: {358530}}
skill = "de.relativsaetze.prepositions"
root = {"rule_code": "de.relativsaetze", "language": "de", "kind": "topic", "name": "Relativsätze", "revision": 1}
prerequisite = {**root, "rule_code": "de.relativsaetze.dative", "kind": "skill", "name": "Dativ", "parent_key": root["rule_code"]}
definition = {**prerequisite, "rule_code": skill, "name": "Relativsätze mit Präpositionen", "prerequisite_keys": [prerequisite["rule_code"]]}
cards_by_id = {card["id"]: card for card in snapshot["cards"]}
decks_by_id = {deck["id"]: deck for deck in snapshot["decks"]}
mappings_by_id = {m["card_id"]: m for m in snapshot["knowledge_mappings"] if m["role"] == "primary"}
decks, cards = [], []
ordered = list(requested.items())
if sys.argv[2] == "true":
    ordered.reverse()
for deck_id, card_ids in ordered:
    deck = decks_by_id[deck_id]
    mappings = []
    for position, card_id in enumerate(sorted(card_ids)):
        original = cards_by_id[card_id]
        assert original["deck_id"] == deck_id and mappings_by_id[card_id]["rule_code"] == skill
        envelope = convert_v1_card({**original, "audio_path": None, "audio_back_path": None}, deck=deck)
        assert envelope["card"]["type"] == "trainer"
        cards.append({"id": card_id, "author": 1, "values": {
            "content_v2": envelope, "deck_id": deck_id, "position": position, "is_deleted": False,
            "source": "admin", "image_path": None, "audio_path": None, "audio_back_path": None,
            "video_front_path": None, "video_back_path": None, "difficulty": None,
        }})
        mappings.append({
            "card_id": card_id, "rule_code": skill, "role": "primary",
            "ability": "guided_application", "complexity": mappings_by_id[card_id]["complexity"],
        })
    metadata = {"knowledge": {"version": 1, "items": [root, prerequisite, definition], "mappings": mappings}}
    decks.append({"id": deck_id, "author": 1, "values": {
        "name": deck["name"], "level": "B1", "topic": "Relativsätze", "target_language": "de",
        "is_deleted": False, "position": deck_id, "folder_id": None, "metadata": json.dumps(metadata),
        "scope": "personal", "category_id": None, "is_default": False,
    }})
source = "LOCAL:" + hashlib.sha256(b"lerne-real-knowledge-pilot-d10-d14").hexdigest()
manifest = json.dumps({
    "format": "lerne-materials", "version": 4, "source": source,
    "source_users": [{"id": 1, "name": "Lerne", "username": None}],
    "content": {"folder": [], "deck": decks, "card": cards}, "assets": [],
}, ensure_ascii=False).encode()
output = io.BytesIO()
with zipfile.ZipFile(output, "w") as archive:
    archive.writestr("manifest.json", manifest)
    archive.writestr("manifest.sha256", hashlib.sha256(manifest).hexdigest())
sys.stdout.buffer.write(output.getvalue())
`, snapshotPath, String(reverseDecks)], { cwd: root, windowsHide: true });
}

const profile = page => page.evaluate(async () => {
  const { default: api } = await import('/src/services/api.js');
  return (await api.get('/knowledge/profile')).data;
});

async function importMaterials(page, archive) {
  await page.getByTestId('standalone-open-materials-btn').click();
  await page.getByTestId('standalone-import-materials-input').setInputFiles({
    buffer: archive, name: 'D10-D14.zip', mimeType: 'application/zip',
  });
  const confirm = page.getByTestId('standalone-import-confirm-btn');
  const error = page.getByTestId('standalone-materials-error');
  await expect(confirm.or(error)).toBeVisible();
  assert.equal(await error.count(), 0, await error.textContent({ timeout: 100 }).catch(() => ''));
  await confirm.click();
  await expect(page.getByTestId('standalone-materials-status')).toBeVisible();
  await page.locator('.settings-header .close-btn').click();
}

async function studyTrainer(page, deck, incorrect, correct) {
  await page.getByRole('heading', { name: deck, exact: true }).click();
  await page.locator('.deck-intro-btn-start').click();
  const input = page.locator('.trainer-exercise input.trainer-gap');
  const check = page.locator('.trainer-footer-action').last();
  await input.fill(incorrect);
  await check.click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill(correct);
  await check.click();
  await page.locator('.grade-buttons .btn-grade').nth(2).click();
}

async function run() {
  const [snapshot, python = 'python'] = process.argv.slice(2);
  if (!snapshot) throw new Error('Usage: node standalone-knowledge.check.cjs <corrected.snapshot.json> [python]');
  const archive = makeArchive(path.resolve(snapshot), python);
  process.env.VITE_LERNE_STANDALONE = '1';
  process.env.VITE_LERNE_LOCAL = '0';
  const app = path.join(root, 'app');
  const { createServer } = await import(pathToFileURL(require.resolve('vite', { paths: [app] })).href);
  const server = await createServer({ root: app, envFile: false, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  const forbidden = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const open = async () => {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, acceptDownloads: true });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/__')) return route.continue();
        forbidden.push(url.href);
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(origin);
      return page;
    };
    const page = await open();
    await importMaterials(page, archive);
    const guided = async () => (await profile(page)).skills.find(item => item.skill_key === targetSkill)
      .dimensions.find(item => item.ability === 'guided_application');
    assert.equal((await guided()).status, 'not_checked');
    await studyTrainer(page, pilotDecks.d14, 'mit den', 'mit dem');
    await expect.poll(async () => (await guided()).event_count).toBe(1);
    assert.equal((await guided()).status, 'insufficient_evidence');
    await page.reload();
    await expect(page.getByRole('heading', { name: pilotDecks.d10, exact: true })).toBeVisible();
    await studyTrainer(page, pilotDecks.d10, 'über der', 'über die');
    await expect.poll(async () => (await guided()).status).toBe('weak');
    const [weakness] = (await profile(page)).weaknesses;
    assert.equal(weakness.skill_key, targetSkill);
    assert.equal(weakness.evidence.length, 2);
    assert.ok(weakness.evidence.every(event => event.evaluation_data.exercise.mistake_count === 1));
    assert.ok(weakness.evidence.every(event => event.evaluation_data.task_support.trainer_answer_mode === 'input'));
    assert.deepEqual(new Set(weakness.related_materials.map(item => item.deck_name)), new Set(Object.values(pilotDecks)));
    assert.equal(weakness.prerequisites_to_check[0].skill_key, 'de.relativsaetze.dative');

    await page.reload();
    await page.locator('#tut-main-settings').click();
    await page.locator('#settings-tab-select').selectOption('profile');
    const [download] = await Promise.all([
      page.waitForEvent('download'), page.getByTestId('standalone-export-progress-btn').click(),
    ]);
    const recovery = [];
    for await (const chunk of await download.createReadStream()) recovery.push(chunk);
    const restored = await open();
    await importMaterials(restored, makeArchive(path.resolve(snapshot), python, true));
    await restored.locator('#tut-main-settings').click();
    await restored.locator('#settings-tab-select').selectOption('profile');
    await restored.getByTestId('standalone-restore-file-input').setInputFiles({
      buffer: Buffer.concat(recovery), name: 'progress.json', mimeType: 'application/json',
    });
    await restored.getByTestId('standalone-restore-confirm-btn').click();
    await expect(restored.getByTestId('standalone-backup-status')).toBeVisible();
    const [recomputed] = (await profile(restored)).weaknesses;
    assert.equal(recomputed.skill_key, weakness.skill_key);
    assert.deepEqual(recomputed.evidence.map(row => row.event_id), weakness.evidence.map(row => row.event_id));
    assert.notDeepEqual(recomputed.evidence.map(row => row.card_id), weakness.evidence.map(row => row.card_id));
    assert.equal(recomputed.confidence, weakness.confidence);
    assert.deepEqual(forbidden, []);
    console.log('D10/D14: ZIP import → 2 real Trainer reviews → guided weakness → restored evidence → same profile');
  } finally {
    await browser?.close();
    await server.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
