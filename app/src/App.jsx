import React, { useEffect } from 'react';
import './App.css';

// Utils & Services
import { getUserId, storage } from './utils/auth';
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
import { RenameDeckModal } from './components/RenameDeckModal';
import { SyncModal } from './components/SyncModal';
import { DuplicateManager } from './components/DuplicateManager';
import { TrashManager } from './components/TrashManager';
import { TutorialOverlay } from './components/TutorialOverlay';
import { TUTORIAL_STEPS } from './constants/appConstants';

// Stores & Hooks
import { useUiStore } from './store/useUiStore';
import { useDeckStore } from './store/useDeckStore';
import { useSessionStore } from './store/useSessionStore';
import { useCardActions } from './hooks/useCardActions';
import { useAutoImport } from './hooks/useAutoImport';
import { useAppInitialization } from './hooks/useAppInitialization';

const USER_ID = getUserId();

export default function App() {
  const { 
    view, setView, isOpeningDeck, setIsOpeningDeck, 
    activeTutorial, setActiveTutorial, toast, isCardActionModalOpen, 
    setIsCardActionModalOpen, actionCard, loading 
  } = useUiStore();
  
  const { 
    decks, currentDeck, setCurrentDeck, 
    deckToSync, setSyncModalOpen, syncModalOpen, handleSyncDeck 
  } = useDeckStore();

  const { isFlipped } = useSessionStore();
  const { fetchNextCard, handleMoveCard, handleCopyCard, handleDeleteCard, handleToggleLearn, handleShareCard } = useCardActions();

  const activeFolderId = useUiStore(state => state.activeFolderId);
  const setActiveFolderId = useUiStore(state => state.setActiveFolderId);
  const isSettingsOpen = useUiStore(state => state.isSettingsOpen);
  const isNewDeckModalOpen = useUiStore(state => state.isNewDeckModalOpen);
  const isRenameModalOpen = useUiStore(state => state.isRenameModalOpen);

  // Sync state with history and Telegram BackButton
  const isPopStateRef = React.useRef(false);
  const lastModalOpenRef = React.useRef(false);

  const anyModalOpen = isSettingsOpen || isNewDeckModalOpen || isRenameModalOpen || isCardActionModalOpen || syncModalOpen;

  // 1. Setup popstate listener and Telegram back button onClick callback on mount
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.enableClosingConfirmation();
    }
    
    // Replace initial state with root decks view
    window.history.replaceState({ view: 'decks', folderId: null }, '');

    const handlePopState = (event) => {
      const state = event.state;
      if (state) {
        isPopStateRef.current = true;
        
        // If a modal was open, close it and prevent changing the view
        const uiState = useUiStore.getState();
        const deckState = useDeckStore.getState();
        const wasModalOpen = uiState.isSettingsOpen || uiState.isNewDeckModalOpen || uiState.isRenameModalOpen || uiState.isCardActionModalOpen || deckState.syncModalOpen;
        
        if (wasModalOpen) {
          uiState.setIsSettingsOpen(false);
          uiState.setIsNewDeckModalOpen(false);
          uiState.setIsRenameModalOpen(false);
          uiState.setIsCardActionModalOpen(false);
          deckState.setSyncModalOpen(false);
          lastModalOpenRef.current = false;
        } else {
          // No modal was open -> change view/folder
          setView(state.view);
          setActiveFolderId(state.folderId);
        }
        
        setTimeout(() => {
          isPopStateRef.current = false;
        }, 50);
      } else {
        // Popped past root in browser
        const confirmExit = window.confirm("Вы действительно хотите выйти из приложения?");
        if (confirmExit) {
          if (window.Telegram?.WebApp) {
            window.Telegram.WebApp.close();
          } else {
            window.close();
          }
        } else {
          // Push state back so they don't exit next time
          window.history.pushState({ view: 'decks', folderId: null }, '');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    const handleTgBackClick = () => {
      window.history.back();
    };
    
    if (window.Telegram?.WebApp?.BackButton) {
      window.Telegram.WebApp.BackButton.onClick(handleTgBackClick);
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (window.Telegram?.WebApp?.BackButton) {
        window.Telegram.WebApp.BackButton.offClick(handleTgBackClick);
      }
    };
  }, [setView, setActiveFolderId]);

  // 2. Push history state on view/folder/modal transitions and sync Telegram BackButton visibility
  useEffect(() => {
    if (isPopStateRef.current) return;

    if (anyModalOpen && !lastModalOpenRef.current) {
      // Modal opened -> push state
      window.history.pushState({ view, folderId: activeFolderId, modalOpen: true }, '');
    } else if (!anyModalOpen && lastModalOpenRef.current) {
      // Modal closed -> remove state
      window.history.back();
    } else {
      // View or folder changed -> push state
      window.history.pushState({ view, folderId: activeFolderId }, '');
    }
    lastModalOpenRef.current = anyModalOpen;

    // Sync Telegram BackButton visibility
    const isRoot = view === 'decks' && activeFolderId === null;
    const tg = window.Telegram?.WebApp;
    if (tg?.BackButton) {
      if (isRoot) {
        tg.BackButton.hide();
      } else {
        tg.BackButton.show();
      }
    }
  }, [view, activeFolderId, anyModalOpen]);

  // Custom hooks for initialization and import logic
  const { importShareId, setImportShareId, checkStartParam } = useAutoImport();
  useAppInitialization(checkStartParam);
  
  // Scroll to top on view change
  useEffect(() => {
    if (view === 'duplicates' && useDeckStore.getState().lastDuplicateCardId) {
      return; // Let DuplicateManager handle the scroll
    }
    if (view === 'cards' && useUiStore.getState().lastSelectedCardId) {
      return; // Let CardList handle the scroll
    }
    const root = document.getElementById('root');
    if (root) {
      root.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [view]);

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

  const startStudyCard = async (deck, cardId) => {
    setIsOpeningDeck(true);
    try {
      setCurrentDeck(deck);
      setView('study');
      useSessionStore.getState().resetSession();
      
      const res = await api.get(`/study/card/${cardId}`);
      useSessionStore.getState().setCard(res.data);
      useSessionStore.getState().addToHistory(res.data);
    } catch (err) {
      console.error("startStudyCard Error:", err);
      useUiStore.getState().showToast("Ошибка при запуске обучения для этой карточки");
      setView('cards');
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

  // View Router
  const renderView = () => {
    switch (view) {
      case 'decks':
        return (
          <DeckGrid
            userId={USER_ID}
            startStudy={startStudy}
            startTutorial={startTutorial}
            importShareId={importShareId}
            onImportSuccess={() => setImportShareId(null)}
            onImportClose={() => setImportShareId(null)}
          />
        );
      case 'study':
        return <StudyView startTutorial={startTutorial} />;
      case 'cards':
        return (
          <CardList
            startTutorial={startTutorial}
            startStudy={startStudy}
            startStudyCard={startStudyCard}
          />
        );
      case 'duplicates':
        return <DuplicateManager />;
      case 'trash':
        return <TrashManager />;
      default:
        return null;
    }
  };

  return (
    <div className="app-container">
      <GuestBanner />
      
      {/* Active View */}
      {renderView()}

      {/* Overlays and Modals */}
      <CardCreator startTutorial={startTutorial} />
      <CardEditor startTutorial={startTutorial} />
      <DeckModals />
      <RenameDeckModal />
      <SettingsModal userId={USER_ID} startTutorial={startTutorial} />
      
      <SyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        deck={deckToSync}
        onSync={(mode) => handleSyncDeck(deckToSync?.id, mode)}
        loading={loading}
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
        decks={decks}
        onMove={handleMoveCard}
        onCopy={handleCopyCard}
        onDelete={(c) => handleDeleteCard(c.id, true)}
        onToggleLearn={handleToggleLearn}
        onShare={handleShareCard}
        loading={loading}
      />

      <Toast toast={toast} />
      <GlobalLoader isVisible={isOpeningDeck} />
    </div>
  );
}

