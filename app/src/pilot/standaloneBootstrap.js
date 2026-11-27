import { offlineApi } from '../services/offlineApi.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { useDeckStore } from '../store/useDeckStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useUiStore } from '../store/useUiStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { getUserId, storage } from '../utils/auth.js';
import { isBundledSeedDeck } from '../utils/deckUtils.js';
import { tr } from '../i18n/locale.js';
import { prepareLocalDb } from '../services/localDb.js';
import { IMPORTED_ID_START } from './materialArchiveIdentity.js';
import { initOfflineMediaStore } from './offlineMediaStore.js';
import { ensureStandaloneSeed } from './standaloneSeed.js';
import { recoverLocalKnowledgeAttempts } from '../services/localKnowledgeService.js';

export const STANDALONE_A2_OWNERSHIP_MIGRATION_KEY = 'standalone_a2_ownership_v1';

export async function ensureStandaloneA2Ownership(database) {
  return database.transaction('rw', database.folders, database.decks, database.syncState, async () => {
    const done = await database.syncState.get(STANDALONE_A2_OWNERSHIP_MIGRATION_KEY);
    if (done?.completed) {
      return { migrated: false, migratedFolders: 0, migratedDecks: 0 };
    }

    const [folders, decks] = await Promise.all([
      database.folders.toArray(),
      database.decks.toArray(),
    ]);

    const foldersToPut = [];
    for (const folder of folders) {
      if (folder.is_builtin === true) continue;
      const isLocalOrImported = Boolean(
        folder.standalone_origin_key
        || folder.standalone_source
        || folder.standalone_local_created
        || Number(folder.id) > IMPORTED_ID_START
      );
      if (!isLocalOrImported) continue;
      if (
        folder.role !== 'owner'
        || folder.is_owner !== true
        || folder.is_global_readonly !== false
        || folder.is_builtin !== false
      ) {
        foldersToPut.push({
          ...folder,
          role: 'owner',
          is_owner: true,
          is_global_readonly: false,
          is_builtin: false,
        });
      }
    }

    const decksToPut = [];
    for (const deck of decks) {
      if (isBundledSeedDeck(deck)) continue;
      const isLocalOrImported = Boolean(
        deck.standalone_origin_key
        || deck.standalone_deck_key
        || deck.standalone_source
        || deck.standalone_local_created
        || Number(deck.id) > IMPORTED_ID_START
      );
      if (!isLocalOrImported) continue;
      if (
        deck.role !== 'owner'
        || deck.is_owner !== true
        || deck.is_global_readonly !== false
        || deck.is_builtin !== false
      ) {
        decksToPut.push({
          ...deck,
          role: 'owner',
          is_owner: true,
          is_global_readonly: false,
          is_builtin: false,
        });
      }
    }

    if (foldersToPut.length > 0) await database.folders.bulkPut(foldersToPut);
    if (decksToPut.length > 0) await database.decks.bulkPut(decksToPut);
    await database.syncState.put({
      key: STANDALONE_A2_OWNERSHIP_MIGRATION_KEY,
      completed: true,
      migrated_folders: foldersToPut.length,
      migrated_decks: decksToPut.length,
      migrated_at: new Date().toISOString(),
    });
    return {
      migrated: true,
      migratedFolders: foldersToPut.length,
      migratedDecks: decksToPut.length,
    };
  });
}

function ensureStandaloneLanguageDefaults() {
  try {
    if (!localStorage.getItem('lerne_target_language')) {
      localStorage.setItem('lerne_target_language', 'de');
    }
    if (localStorage.getItem('lerne_has_selected_language') !== 'true') {
      localStorage.setItem('lerne_has_selected_language', 'true');
    }
    if (localStorage.getItem('native_language_selected') !== 'true') {
      localStorage.setItem('native_language_selected', 'true');
    }
    const currentTarget = localStorage.getItem('lerne_target_language') || 'de';
    useLanguageStore.getState().syncLanguageFromExternal(currentTarget, true);
  } catch { /* storage unavailable */ }
}

/**
 * Isolated offline bootstrap for the standalone Android pilot build.
 * Never starts background server sync loops, auth modals, or network polling.
 */
export function runStandaloneBootstrap() {
  let cancelled = false;

  const bootstrap = async () => {
    useUiStore.setState({ loading: true });
    useDeckStore.setState({ isFetchingDecks: true });
    try {
      ensureStandaloneLanguageDefaults();
      await useAuthStore.getState().restoreSession();
      if (cancelled) return;

      useSettingsStore.getState().activateSettingsAccount();
      await ensureStandaloneSeed();
      if (cancelled) return;

      const db = await prepareLocalDb();
      await ensureStandaloneA2Ownership(db);
      if (cancelled) return;
      void recoverLocalKnowledgeAttempts(db, getUserId()).catch(error => {
        console.error('[Knowledge] Could not recover local grade evidence', error);
      });

      await initOfflineMediaStore(db);
      if (cancelled) return;

      const initRes = await offlineApi.handle('get', '/init');
      if (cancelled) return;

      const freshDecks = initRes.data?.decks || [];
      const freshFolders = initRes.data?.folders || [];
      useDeckStore.getState().setDecksAndFolders(freshDecks, freshFolders, 'local');

      const uiState = useUiStore.getState();
      const savedDeckId = storage.get('lerne_current_deck_id');
      const currentDeck = useDeckStore.getState().currentDeck
        || (savedDeckId ? freshDecks.find(d => String(d.id) === String(savedDeckId)) : null);
      if (currentDeck) {
        const matched = freshDecks.find(d => d.id === currentDeck.id) || currentDeck;
        useDeckStore.getState().setCurrentDeck(matched);
        if (uiState.view === 'cards') {
          await useDeckStore.getState().fetchDeckCards(matched.id);
        }
      } else if (uiState.view === 'cards') {
        useUiStore.setState({ view: 'decks' });
      }
    } catch (error) {
      if (!cancelled) {
        console.error('[StandaloneBootstrap] Initialization failed:', error);
        useDeckStore.getState().setLibraryLoadError(error);
        useUiStore.getState().showToast(tr('Не удалось загрузить локальные колоды.'));
      }
    } finally {
      if (!cancelled) {
        useDeckStore.setState({ isFetchingDecks: false });
        useUiStore.setState({ loading: false, hasInitialized: true });
      }
    }
  };

  void bootstrap();

  return () => {
    cancelled = true;
  };
}
