import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SQLITE_SCHEMA_MANIFEST } from '../schema.generated.js';
import { createCapacitorSqliteDriver } from '../capacitorDriver.js';
import {
  getMigrationStatus,
  migrateSqlite,
  SqliteMigrationError,
  verifyIntegrity,
} from '../migrator.js';
import {
  canonicalMediaRelPath,
  computeTtsCacheKey,
  extractCardMediaRefs,
  extractDeckMediaRefs,
  normalizeMediaRelPath,
} from '../mediaContract.js';

function createNodeSqliteDriver(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  const tx = {
    async execute(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      return db.prepare(sql).run(...params);
    },
    async query(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
  return {
    ...tx,
    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(tx);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      }
    },
    close() {
      db.close();
    },
  };
}

describe('SQLite schema, migrator, and media contract', () => {
  test('applies migrations atomically, is idempotent, and verifies integrity on sample data', async () => {
    const driver = createNodeSqliteDriver();
    try {
      const first = await migrateSqlite(driver);
      assert.deepEqual(first.appliedNow, [1]);
      assert.equal(first.schemaVersion, SQLITE_SCHEMA_MANIFEST.schema_version);

      const second = await migrateSqlite(driver);
      assert.deepEqual(second.appliedNow, []);

      const status = await getMigrationStatus(driver);
      assert.equal(status.currentVersion, 1);
      assert.deepEqual(status.pendingVersions, []);

      const now = '2026-11-27T21:00:00Z';
      const shaAud = 'd'.repeat(64);
      const audRel = canonicalMediaRelPath('audio', shaAud, '.mp3');
      await driver.transaction(async (tx) => {
        await tx.run('INSERT INTO decks (name, target_language, created_at) VALUES (?, ?, ?)', ['Test', 'de', now]);
        const [{ id: deckId }] = await tx.query('SELECT last_insert_rowid() AS id');
        const envelope = { schema_version: 2, card: { type: 'standard', data: { question: 'Hallo', answer: 'Привет' } } };
        await tx.run(
          'INSERT INTO cards (deck_id, content_v2_json, front_preview, back_preview, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [deckId, JSON.stringify(envelope), 'Hallo', 'Привет', audRel, now]
        );
        const [{ id: cardId }] = await tx.query('SELECT last_insert_rowid() AS id');
        await tx.run(
          'INSERT INTO media_assets (sha256, folder, rel_path, mime, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [shaAud, 'audio', audRel, 'audio/mpeg', 1024, now]
        );
        await tx.run(
          'INSERT INTO media_links (owner_type, owner_id, slot, media_sha256) VALUES (?, ?, ?, ?)',
          ['card', String(cardId), 'audio_path', shaAud]
        );
        const cacheKey = computeTtsCacheKey({
          textNorm: 'Hallo',
          lang: 'de',
          provider: 'piper',
          model: 'de_DE-thorsten-high',
          voice: 'de_DE-thorsten-high',
          rate: '+0%',
        });
        await tx.run(
          `INSERT INTO tts_cache (cache_key, media_sha256, provider, model, voice, lang, rate,
           options_json, text_norm, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [cacheKey, shaAud, 'piper', 'de_DE-thorsten-high', 'de_DE-thorsten-high', 'de', '+0%', '{}', 'Hallo', now, now]
        );
      });

      await assert.rejects(
        () => driver.run('DELETE FROM media_assets WHERE sha256 = ?', [shaAud]),
        /FOREIGN KEY constraint failed/
      );

      const integrity = await verifyIntegrity(driver);
      assert.equal(integrity.integrity, 'ok');
    } finally {
      driver.close();
    }
  });

  test('fails closed on migration checksum mismatch or unknown version', async () => {
    const driver = createNodeSqliteDriver();
    try {
      await migrateSqlite(driver);
      await driver.run('UPDATE schema_migrations SET sha256 = ? WHERE version = 1', ['0'.repeat(64)]);
      await assert.rejects(() => migrateSqlite(driver), SqliteMigrationError);
    } finally {
      driver.close();
    }
  });

  test('mediaContract normalizes paths and extracts card/deck media bindings consistently', () => {
    const sha = 'e'.repeat(64);
    const ref = normalizeMediaRelPath(`/api/media/images/archive_${sha}.webp`);
    assert.equal(ref.relPath, `images/archive_${sha}.webp`);
    assert.equal(normalizeMediaRelPath('../images/x.webp'), null);

    const cardRefs = extractCardMediaRefs(
      { audio_path: `/api/media/audio/archive_${sha}.mp3` },
      { schema_version: 2, card: { type: 'standard', image: `images/archive_${sha}.webp`, layout: [{ id: 'i1', type: 'image', path: `images/archive_${sha}.webp` }], data: { question: 'a', answer: 'b' } } }
    );
    assert.deepEqual(
      cardRefs.map(r => [r.slot, r.relPath]),
      [
        ['audio_path', `audio/archive_${sha}.mp3`],
        ['card.image', `images/archive_${sha}.webp`],
        ['layout:i1', `images/archive_${sha}.webp`],
      ]
    );
    const deckRefs = extractDeckMediaRefs({ resources: [{ type: 'video', path: `videos/archive_${sha}.mp4` }] });
    assert.deepEqual(deckRefs.map(r => [r.slot, r.relPath]), [['deck_resource:0', `videos/archive_${sha}.mp4`]]);
  });

  test('CapacitorSQLite driver adapter opens unencrypted SQLite and delegates transactions cleanly', async () => {
    const calls = [];
    const mockPlugin = {
      isConnection: async () => ({ result: false }),
      createConnection: async (opts) => calls.push(['createConnection', opts]),
      isDBOpen: async () => ({ result: false }),
      open: async (opts) => calls.push(['open', opts]),
      execute: async (opts) => { calls.push(['execute', opts]); return { changes: 0 }; },
      run: async (opts) => { calls.push(['run', opts]); return { changes: 1 }; },
      query: async (opts) => { calls.push(['query', opts]); return { values: [{ ok: 1 }] }; },
      beginTransaction: async (opts) => calls.push(['beginTransaction', opts]),
      commitTransaction: async (opts) => calls.push(['commitTransaction', opts]),
      rollbackTransaction: async (opts) => calls.push(['rollbackTransaction', opts]),
      close: async (opts) => calls.push(['close', opts]),
      closeConnection: async (opts) => calls.push(['closeConnection', opts]),
    };

    const driver = createCapacitorSqliteDriver({ database: 'lerne_test', plugin: mockPlugin });
    await driver.open();
    await driver.transaction(async (tx) => {
      await tx.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await tx.run('INSERT INTO t (id) VALUES (?)', [1]);
      const rows = await tx.query('SELECT * FROM t');
      assert.equal(rows.length, 1);
    });
    await driver.close();

    assert.deepEqual(calls[0], [
      'createConnection',
      { database: 'lerne_test', version: 1, encrypted: false, mode: 'no-encryption', readonly: false },
    ]);
    assert.ok(calls.some(([name, opts]) => name === 'execute' && opts.statements.includes('PRAGMA foreign_keys = ON')));
    assert.ok(calls.some(([name, opts]) => name === 'execute' && opts.statements.includes('PRAGMA journal_mode = WAL')));
    assert.ok(calls.some(([name]) => name === 'beginTransaction'));
    assert.ok(calls.some(([name]) => name === 'commitTransaction'));
    assert.ok(calls.some(([name]) => name === 'closeConnection'));
  });
});
