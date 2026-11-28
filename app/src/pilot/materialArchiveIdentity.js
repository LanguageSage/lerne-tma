import { localTransaction } from '../services/localTransaction.js';
import { sha256Hex } from './sha256.js';

export const MATERIAL_EXPORT_SOURCE_KEY = 'standalone_material_export_source';
export const IMPORTED_ID_START = 1000000;
export const ID_COUNTERS_KEY = 'standalone_id_counters';

export function buildOriginKey(source, kind, sourceId) {
  return `archive:${source}:${kind}:${sourceId}`;
}

export async function getMaterialExportSourceInTx(database) {
  const stored = await database.syncState.get(MATERIAL_EXPORT_SOURCE_KEY);
  if (stored) return stored.source;
  const source = `LOCAL:${sha256Hex(crypto.randomUUID())}`;
  await database.syncState.add({ key: MATERIAL_EXPORT_SOURCE_KEY, source });
  return source;
}

export function getMaterialExportSource(database) {
  return localTransaction(database, 'rw', database.syncState, database => getMaterialExportSourceInTx(database));
}
