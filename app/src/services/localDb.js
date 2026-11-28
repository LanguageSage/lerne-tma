import Dexie from 'dexie';
import { getUserId } from '../utils/auth.js';
import { isNative } from '../utils/platform.js';
import { IS_STANDALONE, STANDALONE_DB_PREFIX } from '../utils/standaloneMode.js';
import { createAndroidLocalDb } from '../sqlite/androidLocalDb.js';

const databases = new Map();
let androidDatabase;
const preparations = new Map();
const blockedListeners = new Set();
const closeListeners = new Set();
const versionChangedDatabases = new WeakSet();
const MAX_PREPARE_RETRIES = 3;

function notifyLocalDbClose(payload) {
  for (const listener of closeListeners) {
    try {
      listener(payload);
    } catch (error) {
      console.warn('[localDb] Close listener failed:', error);
    }
  }
}

export const onLocalDbClose = (listener) => {
  if (typeof listener !== 'function') return () => {};
  closeListeners.add(listener);
  return () => {
    closeListeners.delete(listener);
  };
};

function isDatabaseClosed(database) {
  if (!database) return true;
  if (database.hasBeenClosed?.()) return true;
  return database._state?.dbOpenError?.name === 'DatabaseClosedError';
}

function evictDatabase(userId, database) {
  const key = userId != null ? String(userId) : null;
  if (key !== null && databases.get(key) === database) {
    databases.delete(key);
  }
  const prep = preparations.get(database.name);
  if (prep && prep.database === database) {
    preparations.delete(database.name);
  }
  notifyLocalDbClose({ databaseName: database?.name || null, resetAll: false });
}

export const onLocalDbBlocked = (listener) => {
  if (typeof listener !== 'function') return () => {};
  blockedListeners.add(listener);
  return () => {
    blockedListeners.delete(listener);
  };
};

export const getLocalDb = () => {
  if (IS_STANDALONE && isNative()) return androidDatabase ??= createAndroidLocalDb(getUserId());
  const userId = String(getUserId());
  const existing = databases.get(userId);
  if (existing) {
    if (!isDatabaseClosed(existing)) {
      return existing;
    }
    evictDatabase(userId, existing);
  }
  const prefix = IS_STANDALONE ? STANDALONE_DB_PREFIX : 'LerneLocalDB';
  const database = new Dexie(`${prefix}_${userId}`);
  configureDatabase(database, userId);
  databases.set(userId, database);
  return database;
};

export const closeLocalDb = (userId) => {
  const targetId = userId != null ? String(userId) : String(getUserId());
  if (databases.has(targetId)) {
    const database = databases.get(targetId);
    evictDatabase(targetId, database);
    try {
      database.close();
    } catch { /* ignore */ }
  }
};

export const resetAllDatabases = () => {
  const entries = Array.from(databases.entries());
  databases.clear();
  preparations.clear();
  for (const [, database] of entries) {
    try {
      database.close();
    } catch { /* ignore */ }
  }
  notifyLocalDbClose({ databaseName: null, resetAll: true });
};

export async function prepareLocalDb(attempt = 0) {
  const database = getLocalDb();
  if (database.isAndroidSqlite) {
    await database.open();
    return database;
  }
  let entry = preparations.get(database.name);
  if (!entry || entry.database !== database) {
    const userId = getUserId();
    entry = { database, promise: null };
    entry.promise = (async () => {
      if (!database.isOpen()) {
        await database.open();
      }
      await migrateLegacy(database, userId);
    })().catch((error) => {
      if (preparations.get(database.name) === entry) {
        preparations.delete(database.name);
      }
      if (isDatabaseClosed(database)) {
        evictDatabase(String(userId), database);
      }
      throw error;
    });
    preparations.set(database.name, entry);
  }
  try {
    await entry.promise;
  } catch (error) {
    if (
      error?.name === 'DatabaseClosedError'
      && versionChangedDatabases.has(database)
      && attempt < MAX_PREPARE_RETRIES
    ) {
      return prepareLocalDb(attempt + 1);
    }
    throw error;
  }
  if (isDatabaseClosed(database) || !database.isOpen()) {
    evictDatabase(String(getUserId()), database);
    if (versionChangedDatabases.has(database) && attempt < MAX_PREPARE_RETRIES) {
      return prepareLocalDb(attempt + 1);
    }
    throw new Dexie.DatabaseClosedError();
  }
  return database;
}

async function migrateLegacy(database, userId) {
  if (IS_STANDALONE) return;
  if (await database.syncState.get('legacyImported')) return;
  if (await Dexie.exists('LerneLocalDB')) {
    const legacy = new Dexie('LerneLocalDB');
    try {
      await legacy.open();
      const owner = localStorage.getItem('lerne_db_owner') || localStorage.getItem('lerne_last_sync_user_id');
      const knownOwner = owner === String(userId);
      const rows = {};
      for (const name of ['folders', 'decks', 'cards', 'progress']) {
        rows[name] = legacy.tables.some(t => t.name === name) ? await legacy.table(name).toArray() : [];
      }
      if (!knownOwner) {
        rows.folders = rows.folders.filter(f => String(f.user_id) === String(userId));
        rows.decks = rows.decks.filter(d => String(d.user_id) === String(userId));
        const deckIds = new Set(rows.decks.map(d => d.id));
        rows.cards = rows.cards.filter(c => deckIds.has(c.deck_id));
        rows.progress = rows.progress.filter(p => String(p.user_id) === String(userId));
      }
      await database.transaction('rw', database.folders, database.decks, database.cards, database.progress, async () => {
        for (const [name, items] of Object.entries(rows)) {
          for (const item of items) {
            const key = name === 'progress' ? [item.card_id, item.user_id] : item.id;
            if (!await database[name].get(key)) await database[name].put(item);
          }
        }
      });
    } finally {
      legacy.close();
    }
  }
  await database.syncState.put({ key: 'legacyImported' });
}

// Existing consumers keep the same API; each account retains its unsent changes.
export const db = new Proxy({}, {
  get(_target, key) {
    const database = getLocalDb();
    const value = database[key];
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

function configureDatabase(db, userId = null) {
  db.on('versionchange', (event) => {
    console.warn(`[localDb] Version change detected for "${db.name}"; closing connection cleanly.`, event);
    versionChangedDatabases.add(db);
    evictDatabase(userId, db);
    try {
      db.close();
    } catch { /* ignore */ }
    return false;
  });

  db.on('blocked', (event) => {
    console.warn(`[localDb] Database "${db.name}" blocked by another open connection.`, event);
    for (const listener of blockedListeners) {
      try {
        Promise.resolve(listener({ database: db, name: db.name, event })).catch((error) => {
          console.warn('[localDb] Blocked listener failed:', error);
        });
      } catch (error) {
        console.warn('[localDb] Blocked listener threw:', error);
      }
    }
  });

  db.on('close', () => {
    evictDatabase(userId, db);
  });

// Define database schema
// Note: We only index fields we intend to query on (filter / sort).
db.version(1).stores({
  decks: 'id, user_id, name, is_deleted, is_dirty',
  cards: 'id, deck_id, front_text, is_deleted, is_dirty',
  progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty'
});

db.version(2).stores({
  folders: 'id, user_id, name, is_deleted, is_dirty',
  decks: 'id, user_id, folder_id, name, is_deleted, is_dirty',
  cards: 'id, deck_id, front_text, is_deleted, is_dirty',
  progress: '[card_id+user_id], user_id, card_id, next_review, is_dirty'
});

db.version(3).stores({
  syncState: 'key',
  media: 'url',
});

db.version(4).stores({
  knowledge_items: 'id, language, category',
  card_knowledge_items: '[card_id+knowledge_item_id], card_id, knowledge_item_id, role',
  knowledge_attempt_outbox: 'client_event_id, user_id, knowledge_item_id, sync_status, created_locally_at',
  user_knowledge_state: '[user_id+knowledge_item_id], user_id, knowledge_item_id'
});
db.version(5).stores({ card_notes: 'id, card_id, is_dirty' });
}

export const CARD_CREATE_KEY = 'card-create-v2:';
export const CARD_EDIT_KEY = 'card-edit-v2:';
export const CARD_MOVE_KEY = 'card-move-v2:';
export const CARD_LIFECYCLE_KEY = 'card-lifecycle-v2:';

// Helper to generate temporary negative IDs
export const getNextTempId = () => {
  const current = parseInt(localStorage.getItem('lerne_temp_id_counter') || '-1', 10);
  const next = current - 1;
  localStorage.setItem('lerne_temp_id_counter', next.toString());
  return current;
};

// Check if app is in offline-first mode
export const isOfflineMode = () => {
  return IS_STANDALONE || isNative() || localStorage.getItem('offline_mode') === 'true'
    || (import.meta.env.DEV && new URLSearchParams(window.location.search).get('offline') === '1');
};

export async function resolveLocalRequest(url, body) {
  const mappings = (await getLocalDb().syncState.get('aliases'))?.mappings || {};
  const id = (kind, value) => mappings[kind]?.[String(value)] ?? value;
  const resolvedUrl = url
    .replace(/\/(decks|folders|cards)\/(-\d+)(?=\/|\?|$)/g, (_, kind, value) => `/${kind}/${id(kind, Number(value))}`)
    .replace(/\/study\/card\/(-\d+)/, (_, value) => `/study/card/${id('cards', Number(value))}`)
    .replace(/\/trash\/(folder|deck|card)\/(-\d+)/, (_, kind, value) => `/trash/${kind}/${id(`${kind}s`, Number(value))}`);
  if (!body || typeof body !== 'object' || body instanceof FormData) return { url: resolvedUrl, body };
  const copy = { ...body };
  for (const [field, kind] of Object.entries({ card_id: 'cards', deck_id: 'decks', target_deck_id: 'decks', folder_id: 'folders', parent_id: 'folders', after_card_id: 'cards' })) {
    if (field in copy) copy[field] = id(kind, copy[field]);
  }
  if (Array.isArray(copy.card_ids)) {
    copy.card_ids = copy.card_ids.map(c => id('cards', c));
  }
  if (Array.isArray(copy.exclude_ids)) copy.exclude_ids = copy.exclude_ids.map(c => id('cards', c));
  return { url: resolvedUrl, body: copy };
}
