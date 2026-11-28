import { canonicalMediaRelPath, isCanonicalMediaFilename, normalizeMediaRelPath } from '../sqlite/mediaContract.js';
import { openAndroidDatabase } from '../sqlite/androidDatabase.js';

export const MAX_STUDY_TTS_CACHE_ENTRIES = 400;
export { openAndroidDatabase as openNativeMediaDb };

export async function storeNativeMediaMetadata(assets, tts = null, transaction = null) {
  if (!assets.length) return;
  const now = new Date().toISOString();
  const rows = assets.map(({ sha256, folder, filename, mime, size }) => {
    const relPath = canonicalMediaRelPath(folder, sha256, filename.slice(filename.lastIndexOf('.')));
    if (relPath !== `${folder}/${filename}`) throw new Error(`Invalid native media path: ${relPath}`);
    return [sha256, folder, relPath, mime, size, now, now];
  });

  const write = async tx => {
    // Keep each batch below the 999-parameter SQLite limit.
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      await tx.run(`INSERT INTO media_assets (sha256, folder, rel_path, mime, size_bytes, created_at, verified_at)
        VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}
        ON CONFLICT(sha256) DO UPDATE SET mime = excluded.mime, size_bytes = excluded.size_bytes,
          verified_at = excluded.verified_at WHERE media_assets.rel_path = excluded.rel_path`, batch.flat());
    }

    if (tts) {
      await tx.run(`INSERT INTO tts_cache (cache_key, media_sha256, provider, model, voice, lang, rate,
          text_norm, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET media_sha256 = excluded.media_sha256, last_used_at = excluded.last_used_at`,
      [tts.key, assets[0].sha256, tts.provider, tts.model, tts.voice, tts.lang, tts.rate, tts.textNorm, now, now]);
      await tx.run(`DELETE FROM tts_cache WHERE cache_key IN (
        SELECT cache_key FROM tts_cache ORDER BY last_used_at DESC, rowid DESC LIMIT -1 OFFSET ?
      )`, [MAX_STUDY_TTS_CACHE_ENTRIES]);
    }
  };
  if (transaction) return write(transaction);
  const database = await openAndroidDatabase();
  return database.transaction(write);
}

export async function readNativeMediaMetadata() {
  const database = await openAndroidDatabase();
  const rows = await database.query('SELECT sha256, rel_path, mime, size_bytes FROM media_assets');
  return rows.flatMap(({ sha256, rel_path, mime, size_bytes }) => {
    const parsed = normalizeMediaRelPath(rel_path);
    if (!isCanonicalMediaFilename(parsed?.filename)) return [];
    const { folder, filename } = parsed;
    return [{ sha256, folder, filename, mime, size: size_bytes, path: `media/${filename.slice('archive_'.length)}` }];
  });
}
