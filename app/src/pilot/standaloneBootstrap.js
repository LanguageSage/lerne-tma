import { offlineApi } from '../services/offlineApi.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { useDeckStore } from '../store/useDeckStore.js';
import { useSettingsStore } from '../store/useSettingsStore.js';
import { useUiStore } from '../store/useUiStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { storage } from '../utils/auth.js';
import { tr } from '../i18n/locale.js';
import { prepareLocalDb } from '../services/localDb.js';
import { initOfflineMediaStore } from './offlineMediaStore.js';
import { ensureStandaloneSeed } from './standaloneSeed.js';

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

      await initOfflineMediaStore(await prepareLocalDb());
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
