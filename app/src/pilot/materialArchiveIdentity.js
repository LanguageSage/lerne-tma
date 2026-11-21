import { sha256Hex } from './sha256.js';

export const MATERIAL_EXPORT_SOURCE_KEY = 'standalone_material_export_source';

export function buildOriginKey(source, kind, sourceId) {
  return `archive:${source}:${kind}:${sourceId}`;
}

export function getMaterialExportSource(database) {
  return database.transaction('rw', database.syncState, async () => {
    const stored = await database.syncState.get(MATERIAL_EXPORT_SOURCE_KEY);
    if (stored) return stored.source;
    const source = `LOCAL:${sha256Hex(crypto.randomUUID())}`;
    await database.syncState.add({ key: MATERIAL_EXPORT_SOURCE_KEY, source });
    return source;
  });
}
