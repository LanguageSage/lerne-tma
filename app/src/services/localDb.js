import Dexie from 'dexie';

export const db = new Dexie('LerneLocalDB');

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

// Helper to generate temporary negative IDs
export const getNextTempId = () => {
  const current = parseInt(localStorage.getItem('lerne_temp_id_counter') || '-1', 10);
  const next = current - 1;
  localStorage.setItem('lerne_temp_id_counter', next.toString());
  return current;
};

// Check if app is in offline-first mode
export const isOfflineMode = () => {
  return localStorage.getItem('offline_mode') === 'true' || !!window.Capacitor;
};
