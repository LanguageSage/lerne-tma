import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import './App.css';

// Utils & Services
import { getUserId, storage } from './utils/auth';
import api from './services/api';
import { enableClosingConfirmation, setupBackButton, hideBackButton, closeApp } from './utils/platform';


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
import { AuthRequiredModal } from './components/AuthRequiredModal';
import { LanguageSelectionModal } from './components/LanguageSelectionModal';
import { ImportModal } from './components/ImportModal';
import { TutorialOverlay } from './components/TutorialOverlay';
import { TUTORIAL_STEPS } from './constants/appConstants';

// Stores & Hooks
import { useUiStore } from './store/useUiStore';
import { useDeckStore } from './store/useDeckStore';
import { useSessionStore } from './store/useSessionStore';
import { useCardActions } from './hooks/useCardActions';
import { useAutoImport } from './hooks/useAutoImport';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useCardNavigation } from './hooks/useCardNavigation';

import { LanguageProvider, useTranslation } from './i18n/i18nContext';
import { getLocalizedTutorialSteps } from './i18n/tutorialSteps';
import LanguageWelcomeModal from './components/modals/LanguageWelcomeModal';

const USER_ID = getUserId();

function AppContent() {
  const { isFirstLaunch, setIsFirstLaunch, nativeLanguage } = useTranslation();

  const { 
    view, setView, isOpeningDeck, setIsOpeningDeck, 
    activeTutorial, setActiveTutorial, toast, isCardActionModalOpen, 
    setIsCardActionModalOpen, actionCard, loading 
  } = useUiStore();
  
  const { 
    decks, folders, currentDeck, setCurrentDeck, 
    deckToSync, setSyncModalOpen, syncModalOpen, handleSyncDeck 
  } = useDeckStore();

  const { isFlipped } = useSessionStore();
  const { fetchNextCard, handleMoveCard, handleCopyCard, handleDeleteCard, handleToggleLearn, handleShareCard } = useCardActions();
  const { openEditor } = useCardNavigation();

  const activeFolderId = useUiStore(state => state.activeFolderId);
  const setActiveFolderId = useUiStore(state => state.setActiveFolderId);
  const isSettingsOpen = useUiStore(state => state.isSettingsOpen);
  const isNewDeckModalOpen = useUiStore(state => state.isNewDeckModalOpen);
  const isRenameModalOpen = useUiStore(state => state.isRenameModalOpen);

  // Sync state with history and Telegram BackButton
  const isPopStateRef = React.useRef(false);
  const lastModalOpenRef = React.useRef(false);
  const lastViewRef = React.useRef(view);
  const lastFolderIdRef = React.useRef(activeFolderId);

  const isAuthModalOpen = useUiStore(state => state.isAuthModalOpen);
  const anyModalOpen = isSettingsOpen || isNewDeckModalOpen || isRenameModalOpen || isCardActionModalOpen || syncModalOpen || isAuthModalOpen;

  // 1. Setup popstate listener and native back button onClick callback on mount
  useEffect(() => {
    enableClosingConfirmation();
    
    // Replace initial state with root decks view
    window.history.replaceState({ view: 'decks', folderId: null }, '');

    const handlePopState = (event) => {
      const state = event.state;
      if (state) {
        isPopStateRef.current = true;
        
        // If a modal was open, close it and prevent changing the view
        const uiState = useUiStore.getState();
        const deckState = useDeckStore.getState();
        const wasModalOpen = uiState.isSettingsOpen || uiState.isNewDeckModalOpen || uiState.isRenameModalOpen || uiState.isCardActionModalOpen || uiState.isAuthModalOpen || deckState.syncModalOpen;
        
        if (wasModalOpen) {
          uiState.setIsSettingsOpen(false);
          uiState.setIsNewDeckModalOpen(false);
          uiState.setIsRenameModalOpen(false);
          uiState.setIsCardActionModalOpen(false);
          uiState.setIsAuthModalOpen(false);
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
          closeApp();
        } else {
          // Push state back so they don't exit next time
          window.history.pushState({ view: 'decks', folderId: null }, '');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    const cleanupBackButton = setupBackButton(() => {
      window.history.back();
    });

    return () => {
      window.removeEventListener('popstate', handlePopState);
      cleanupBackButton();
    };
  }, [setView, setActiveFolderId]);

  // 2. Push history state on view/folder/modal transitions and sync BackButton visibility
  useEffect(() => {
    if (isPopStateRef.current) {
      lastViewRef.current = view;
      lastFolderIdRef.current = activeFolderId;
      lastModalOpenRef.current = anyModalOpen;
      return;
    }

    if (anyModalOpen && !lastModalOpenRef.current) {
      // Modal opened -> push state
      window.history.pushState({ view, folderId: activeFolderId, modalOpen: true }, '');
    } else if (!anyModalOpen && lastModalOpenRef.current) {
      // Modal closed
      if (view !== lastViewRef.current) {
        // View changed while modal closed (e.g. "Редактировать" set view to 'editor')
        window.history.replaceState({ view, folderId: activeFolderId }, '');
      } else {
        // Modal closed without view change -> remove modal history state
        window.history.back();
      }
    } else if (view !== lastViewRef.current || activeFolderId !== lastFolderIdRef.current) {
      // View or folder changed -> push state
      window.history.pushState({ view, folderId: activeFolderId }, '');
    }

    lastModalOpenRef.current = anyModalOpen;
    lastViewRef.current = view;
    lastFolderIdRef.current = activeFolderId;

    // Sync BackButton visibility
    const isRoot = view === 'decks' && activeFolderId === null && !anyModalOpen;
    if (isRoot) {
      hideBackButton();
    }
  }, [view, activeFolderId, anyModalOpen]);

  // Custom hooks for initialization and import logic
  const { importShareId, clearImportShareId, checkStartParam } = useAutoImport();
  useAppInitialization(checkStartParam);
  
  // Scroll to top on view change
  useEffect(() => {
    if (view === 'duplicates' && useDeckStore.getState().lastDuplicateCardId) {
      return; // Let DuplicateManager handle the scroll
    }
    if (view === 'cards') {
      const container = document.getElementById('app-container');
      const savedScroll = useUiStore.getState().cardsScrollTop;
      const lastId = useUiStore.getState().lastSelectedCardId;
      if (container && (savedScroll > 0 || lastId)) {
        if (savedScroll > 0) {
          container.scrollTop = savedScroll;
        }
        return; // Let CardList handle restoring scroll
      }
    }
    const container = document.getElementById('app-container');
    if (container) {
      container.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [view]);

  const startStudy = async (deck) => {
    setIsOpeningDeck(true);
    try {
      setCurrentDeck(deck);
      setView('study');
      useSessionStore.getState().resetSession();
      if (deck.id === 'duplicates') {
        await useDeckStore.getState().fetchDuplicates();
      } else {
        await useDeckStore.getState().fetchDeckCards(deck.id);
      }
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
      const localCard = (useDeckStore.getState().deckCards || []).find(c => c.id === cardId);
      if (localCard) {
        useSessionStore.getState().addToHistory(localCard);
      }
      if (deck.id === 'duplicates') {
        await useDeckStore.getState().fetchDuplicates();
      } else {
        await useDeckStore.getState().fetchDeckCards(deck.id);
      }
      
      const res = await api.get(`/study/card/${cardId}`);
      if (localCard) {
        useSessionStore.getState().setCard(res.data);
        const history = useSessionStore.getState().studyHistory;
        if (history.length > 0) {
          const updatedHistory = [...history];
          updatedHistory[history.length - 1] = res.data;
          useSessionStore.getState().setStudyHistory(updatedHistory);
        }
      } else {
        useSessionStore.getState().addToHistory(res.data);
      }
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
    if (context === 'welcome') {
      import('./store/useLanguageStore').then(({ useLanguageStore }) => {
        useLanguageStore.getState().setLanguageModalOpen(true);
      });
    }
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
    <motion.div id="app-container" className="app-container" layoutScroll>
      <GuestBanner />
      
      {/* Active View */}
      {renderView()}

      {/* Overlays and Modals */}
      <CardCreator startTutorial={startTutorial} />
      <CardEditor startTutorial={startTutorial} />
      <DeckModals />
      <RenameDeckModal />
      <SettingsModal userId={USER_ID} startTutorial={startTutorial} />
      
      {importShareId && (
        <ImportModal
          shareId={importShareId}
          onImportSuccess={() => {
            clearImportShareId();
            setView('decks');
          }}
          onClose={() => clearImportShareId()}
        />
      )}
      
      <SyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        deck={deckToSync}
        onSync={(mode) => handleSyncDeck(deckToSync?.id, mode)}
        loading={loading}
      />

      <TutorialOverlay
        isOpen={!!activeTutorial}
        steps={getLocalizedTutorialSteps(nativeLanguage, activeTutorial)}
        onFinish={() => finishTutorial(activeTutorial)}
        onSkip={() => finishTutorial(activeTutorial)}
        isFlipped={isFlipped}
      />



      <CardActionModal
        isOpen={isCardActionModalOpen}
        onClose={() => setIsCardActionModalOpen(false)}
        card={actionCard}
        decks={decks}
        folders={folders}
        onMove={handleMoveCard}
        onCopy={handleCopyCard}
        onDelete={(c) => handleDeleteCard(c.id, true)}
        onToggleLearn={handleToggleLearn}
        onShare={handleShareCard}
        onEdit={(c) => openEditor(c.deck_id || currentDeck?.id, c, view)}
        loading={loading}
      />

      <AuthRequiredModal
        isOpen={useUiStore(s => s.isAuthModalOpen)}
        onClose={() => useUiStore.getState().setIsAuthModalOpen(false)}
        title={useUiStore(s => s.authModalTitle)}
      />

      <LanguageSelectionModal />
      <LanguageWelcomeModal 
        isOpen={isFirstLaunch} 
        onClose={() => setIsFirstLaunch(false)} 
      />

      <Toast toast={toast} />
      <GlobalLoader isVisible={isOpeningDeck} />
    </motion.div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

