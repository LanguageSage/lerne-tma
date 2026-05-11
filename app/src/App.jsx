import React, { useEffect } from 'react';
import './App.css';

// Utils & Services
import { getUserId, getUserProfile, storage } from './utils/auth';
import api from './services/api';

// Components
import { Toast } from './components/common/Toast';
import { GlobalLoader } from './components/common/Loader';
import { GuestBanner } from './components/common/UserBadge';
import { DeckGrid } from './components/DeckGrid';
import { StudyView } from './components/StudyView';
import { CardList } from './components/CardList';
import { CardEditor } from './components/CardEditor';
import { CardCreator } from './components/CardCreator';
import { CardActionModal } from './components/CardActionModal';
import { DeckModals } from './components/DeckModals';
import { SettingsModal } from './components/SettingsModal';
import { SyncModal } from './components/SyncModal';
import { ImportModal } from './components/ImportModal';
import { TutorialOverlay } from './components/TutorialOverlay';
import { TUTORIAL_STEPS, DESIGN_PRESETS } from './constants/appConstants';

// Stores
import { useUiStore } from './store/useUiStore';
import { useDeckStore } from './store/useDeckStore';
import { useSessionStore } from './store/useSessionStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useCardActions } from './hooks/useCardActions';

const USER_ID = getUserId();
const SETTINGS_VERSION = '6';

export default function App() {
  const { 
    view, setView, isOpeningDeck, setIsOpeningDeck, showToast, 
    activeTutorial, setActiveTutorial, toast, isCardActionModalOpen, 
    setIsCardActionModalOpen, actionCard 
  } = useUiStore();
  
  const { 
    setDecks, fetchDecks, currentDeck, setCurrentDeck, 
    deckToSync, setSyncModalOpen, syncModalOpen, handleSyncDeck 
  } = useDeckStore();

  const { isFlipped } = useSessionStore();
  const { fetchNextCard, handleMoveCard, handleCopyCard, handleDeleteCard, handleToggleLearn, handleShareCard } = useCardActions();

  const {
    setAdminSettings, setUserPrompts, applyDesignPreset, isAdmin
  } = useSettingsStore();

  const { setUserProfile } = useUiStore();
  const [importShareId, setImportShareId] = React.useState(null);

  // Initialization
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      console.log("Telegram WebApp Ready");
    }

    const profile = getUserProfile();
    setUserProfile(profile);
    syncProfile(profile);
    fetchInitData();
    
    // Check for sharing parameters
    const startParam = tg?.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get('tgWebAppStartParam');
    console.log("Start parameter detected:", startParam);

    if (startParam && (startParam.startsWith('c_') || startParam.startsWith('d_'))) {
      setImportShareId(startParam);
    }
    
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') === '1' || USER_ID === 642478257) {
      useSettingsStore.setState({ isAdmin: true });
    }

    const currentVersion = storage.get('lerne_settings_version');
    if (currentVersion !== SETTINGS_VERSION) {
      console.log(`Migrating settings to v${SETTINGS_VERSION}...`);
      const defaultSettings = DESIGN_PRESETS.find(p => p.id === 'lerne_2026')?.settings;
      if (defaultSettings) {
        applyDesignPreset({ name: 'Lerne 2026', settings: defaultSettings });
      }
      storage.set('lerne_settings_version', SETTINGS_VERSION);
    }

    const welcomed = storage.get('lerne_welcome_seen');
    if (!welcomed) {
      setTimeout(() => {
        setActiveTutorial('welcome');
        storage.set('lerne_welcome_seen', 'true');
      }, 1500);
    }
  }, []);

  const fetchInitData = async () => {
    useUiStore.setState({ loading: true });
    try {
      const res = await api.get('/init');
      setDecks(res.data.decks);
      setAdminSettings(res.data.settings);
      setUserPrompts(res.data.prompts);
      // Fetch backgrounds should be called by the settings store or component
    } catch (err) {
      console.error("Init Data Error:", err);
      showToast("Ошибка загрузки данных.");
    }
    useUiStore.setState({ loading: false });
  };

  const syncProfile = async (currentProfile) => {
    try {
      const res = await api.post('/auth/sync', {
        first_name: currentProfile.first_name,
        last_name: currentProfile.last_name,
        username: currentProfile.username,
        photo_url: currentProfile.photo_url,
        is_guest: currentProfile.is_guest
      });
      
      if (res.data.status === 'ok' && res.data.user) {
        const newProfile = res.data.user;
        
        // Если пользователь БЫЛ гостем, а СТАЛ полноценным пользователем -> переподгружаем данные
        if (currentProfile.is_guest && !newProfile.is_guest) {
          console.log("User promoted from Guest to Real User. Re-fetching data...");
          setUserProfile(newProfile);
          storage.set('lerne_user_profile', JSON.stringify(newProfile));
          fetchInitData(); // Подгружаем реальные колоды и настройки
        } else {
          setUserProfile(newProfile);
          storage.set('lerne_user_profile', JSON.stringify(newProfile));
        }
      }
    } catch (err) {
      console.error("Profile sync error:", err);
    }
  };

  const startStudy = async (deck) => {
    setIsOpeningDeck(true);
    try {
      setCurrentDeck(deck);
      setView('study');
      useSessionStore.getState().resetSession();
      await fetchNextCard(deck.id, true);
    } finally {
      setIsOpeningDeck(false);
    }
  };

  const finishTutorial = (context) => {
    storage.set(`lerne_tut_seen_${context}`, 'true');
    setActiveTutorial(null);
  };

  const startTutorial = (context) => {
    storage.remove(`lerne_tut_seen_${context}`);
    setActiveTutorial(null);
    setTimeout(() => {
      setActiveTutorial(context);
    }, 100);
  };

  return (
    <div className="app-container">
      <GuestBanner />
      <DeckGrid
        userId={USER_ID}
        startStudy={startStudy}
        startTutorial={startTutorial}
        importShareId={importShareId}
        onImportSuccess={() => setImportShareId(null)}
        onImportClose={() => setImportShareId(null)}
      />

      <StudyView
        startTutorial={startTutorial}
      />

      <DeckModals />

      <CardList
        startTutorial={startTutorial}
      />

      <CardCreator
        startTutorial={startTutorial}
      />

      <CardEditor
        startTutorial={startTutorial}
      />

      <SettingsModal
        userId={USER_ID}
        startTutorial={startTutorial}
      />

      <SyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        deck={deckToSync}
        onSync={(mode) => handleSyncDeck(deckToSync.id, mode)}
        loading={useUiStore.getState().loading}
      />

      <ImportModal 
        shareId={importShareId} 
        onClose={() => setImportShareId(null)}
        onImportSuccess={() => setImportShareId(null)}
      />

      <TutorialOverlay
        isOpen={!!activeTutorial}
        steps={TUTORIAL_STEPS[activeTutorial] || []}
        onFinish={() => finishTutorial(activeTutorial)}
        onSkip={() => finishTutorial(activeTutorial)}
        isFlipped={isFlipped}
      />

      <CardActionModal
        isOpen={isCardActionModalOpen}
        onClose={() => setIsCardActionModalOpen(false)}
        card={actionCard}
        decks={useDeckStore.getState().decks}
        onMove={handleMoveCard}
        onCopy={handleCopyCard}
        onDelete={(c) => handleDeleteCard(c.id)}
        onToggleLearn={handleToggleLearn}
        onShare={handleShareCard}
        loading={useUiStore.getState().loading}
      />

      <Toast toast={toast} />
      <GlobalLoader isVisible={isOpeningDeck} />
    </div>
  );
}
