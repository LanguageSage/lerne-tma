import Dexie from 'dexie';

// Deliberately independent of localDb/auth/sync: opening the application database
// through those modules can import legacy data or start delivery. Never do that here.
const knownTables = new Set(['folders', 'decks', 'cards', 'progress', 'syncState', 'media',
  'knowledge_items', 'card_knowledge_items', 'knowledge_attempt_outbox', 'user_knowledge_state', 'card_notes']);
const inertKeys = new Set(['aliases', 'lastSync', 'legacyImported']);
const dirty = value => value !== undefined && value !== null && value !== false && value !== 0;

export async function inspectCutoverDatabase(database) {
  const blockers = {};
  const add = reason => { blockers[reason] = (blockers[reason] || 0) + 1; };
  const tables = {};
  // Dynamic Dexie schema, read transaction only; old versions are never upgraded.
  await database.transaction('r', database.tables, async () => {
    for (const table of database.tables) {
      tables[table.name] = 0;
      if (!knownTables.has(table.name)) add(`unknown_table:${table.name}`);
      await table.each(row => {
        tables[table.name]++;
        if (dirty(row.is_dirty)) add(`${table.name}:dirty`);
        if (dirty(row.learning_dirty)) add(`${table.name}:learning_dirty`);
        if (['folders', 'decks', 'cards', 'progress'].includes(table.name)
            && [row.id, row.card_id, row.deck_id, row.folder_id, row.parent_id].some(id => Number(id) < 0)) {
          add(`${table.name}:temporary_reference`);
        }
        if (row.offline_edit || row.offline_lifecycle || row.offline_move || row.offline_create_status) {
          add(`${table.name}:unacknowledged_native_state`);
        }
        // Successful attempts are removed by the existing sender. Anything left,
        // including failed/syncing/unknown states, still requires reconciliation.
        if (table.name === 'knowledge_attempt_outbox') add('knowledge_attempt_outbox:retained');
        if (table.name === 'syncState') {
          const key = String(row.key);
          if (inertKeys.has(key) || key.startsWith('grade:')) return;
          // Even an expired refresh lease is not evidence that other tabs stopped.
          add(key === 'pending' ? 'syncState:pending_batch'
            : key.startsWith('review:') ? 'syncState:review'
              : key.startsWith('card-') ? 'syncState:native_operation' : 'syncState:unknown_or_active');
        }
      });
    }
  });
  if (!database.tables.some(table => table.name === 'cards')) add('missing_cards_table');
  return { name: database.name, version: database.verno, tables, blockers,
    pending_free: Object.keys(blockers).length === 0 };
}

export function inspectCutoverStorage(storage) {
  const blockers = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!/lerne_bulk_import_|lerne:personal-design:v2:/.test(key)) continue;
    try {
      const value = JSON.parse(storage.getItem(key));
      if (key.includes('lerne_bulk_import_')) {
        if (!Array.isArray(value) || value.length) blockers[key] = 'pending_import';
      } else if (!value || value.version !== 1 || typeof value.owner !== 'string'
          || value.document?.schemaVersion !== 2 || !Number.isInteger(value.document?.revision)
          || typeof value.pending !== 'boolean' || value.pending || value.edited) {
        blockers[key] = 'pending_or_unknown_settings';
      }
    } catch { blockers[key] = 'unreadable_original_retained'; }
  }
  return blockers;
}

/** Device/origin/profile-local observation, never a global migration permit. */
export async function inspectCardCutover(options = {}) {
  const databases = [];
  const errors = [];
  let names = [];
  try {
    // Do not fall back to Dexie's remembered-name registry: it can omit old DBs.
    if (typeof indexedDB.databases !== 'function') throw new Error('enumeration unavailable');
    names = (await indexedDB.databases()).map(item => item.name)
      .filter(name => /^Lerne(?:Local|Test)DB(?:_|$)/.test(name)).sort();
  } catch { errors.push('database_enumeration_failed'); }
  for (const name of names) {
    const database = new Dexie(name);
    try {
      await database.open();
      databases.push(await inspectCutoverDatabase(database));
    } catch { errors.push(`database_unreadable:${name}`); }
    finally { database.close(); }
  }
  let storageBlockers = {};
  try { storageBlockers = inspectCutoverStorage('storage' in options ? options.storage : globalThis.localStorage); }
  catch { errors.push('local_storage_unreadable'); }
  return { format: 'lerne-card-cutover-device-v1', observed_at: new Date().toISOString(),
    databases, storage_blockers: storageBlockers, errors,
    pending_free: !errors.length && !Object.keys(storageBlockers).length && databases.every(item => item.pending_free),
    safe_to_stop_v1_writes: false,
    required_evidence: ['all_devices_and_origins', 'saved_in_memory_drafts', 'writers_fenced', 'verified_rollback'] };
}
