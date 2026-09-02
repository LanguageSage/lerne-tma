import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import './App.css';

// Utils & Services
import { getUserId, storage } from './utils/auth';
import { disableClosingConfirmation, setupBackButton, hideBackButton } from './utils/platform';


// Components
import { Toast } from './components/common/Toast';
import { GlobalLoader } from './components/common/Loader';
import { GuestBanner } from './components/common/UserBadge';
import { DeckGrid, CardList, CardEditor, CardCreator } from './components/deckgrid';
import { StudyView, TrainerView } from './components/study';
import { 
  CardActionModal, DeckModals, SettingsModal, RenameDeckModal, 
  SyncModal, DuplicateManager, TrashManager, AuthRequiredModal, 
  LanguageSelectionModal, ImportModal, CollaboratorsModal, BatchCardModal 
} from './components/modals';
import { TutorialOverlay } from './components/TutorialOverlay';
import { LidExamView } from './components/lid/LidExamView';

import { TUTORIAL_STEPS } from './constants/appConstants';

// Stores & Hooks
import { useUiStore } from './store/useUiStore';
import { useDeckStore } from './store/useDeckStore';
import { useSessionStore } from './store/useSessionStore';
import { useCardActions } from './hooks/useCardActions';
import { useAutoImport } from './hooks/useAutoImport';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useCardNavigation } from './hooks/useCardNavigation';
import { useCollaborativeSync } from './hooks/useCollaborativeSync';
import { useStudyNavigation } from './hooks/useStudyNavigation';

import { LanguageProvider, useTranslation } from './i18n/i18nContext';
import { getLocalizedTutorialSteps } from './i18n/tutorialSteps';
import LanguageWelcomeModal from './components/modals/LanguageWelcomeModal';

const USER_ID = getUserId();

function AppContent() {
  const { isFirstLaunch, setIsFirstLaunch, nativeLanguage } = useTranslation();

  const { 
    view, setView, isOpeningDeck, 
    activeTutorial, setActiveTutorial, toast, isCardActionModalOpen, 
    setIsCardActionModalOpen, actionCard, loading 
  } = useUiStore();
  
  const { 
    decks, folders, currentDeck, 
    deckToSync, setSyncModalOpen, syncModalOpen, handleSyncDeck 
  } = useDeckStore();

  const { isFlipped } = useSessionStore();
  const { handleMoveCard, handleCopyCard, handleDeleteCard, handleToggleLearn, handleShareCard } = useCardActions();
  const { openEditor, openCreator } = useCardNavigation();
  const { startStudy, startStudyCard } = useStudyNavigation();

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
  const authModalTitle = useUiStore(state => state.authModalTitle);
  const isBatchModalOpen = useUiStore(state => state.isBatchModalOpen);
  const anyModalOpen = isSettingsOpen || isNewDeckModalOpen || isRenameModalOpen || isCardActionModalOpen || syncModalOpen || isAuthModalOpen || isBatchModalOpen;

  // 1. Setup popstate listener and native back button onClick callback on mount
  useEffect(() => {
    disableClosingConfirmation();
    
    // Replace initial state with root decks view
    window.history.replaceState({ view: 'decks', folderId: null }, '');

    const handlePopState = (event) => {
      const state = event.state;
      if (state) {
        isPopStateRef.current = true;
        
        // If a modal was open, close it and prevent changing the view
        const uiState = useUiStore.getState();
        const deckState = useDeckStore.getState();
        const wasModalOpen = uiState.isSettingsOpen || uiState.isNewDeckModalOpen || uiState.isRenameModalOpen || uiState.isCardActionModalOpen || uiState.isAuthModalOpen || uiState.isBatchModalOpen || deckState.syncModalOpen;
        
        if (wasModalOpen) {
          uiState.setIsSettingsOpen(false);
          uiState.setIsNewDeckModalOpen(false);
          uiState.setIsRenameModalOpen(false);
          uiState.setIsCardActionModalOpen(false);
          uiState.setIsAuthModalOpen(false);
          uiState.setIsBatchModalOpen(false);
          deckState.setSyncModalOpen(false);
          lastModalOpenRef.current = false;
        } else {
          // No modal was open -> change view/folder
          const currentView = uiState.view;
          const session = useSessionStore.getState();

          // If leaving study or trainer, clean up autoplay and preserve scroll target
          if (currentView === 'study' || currentView === 'trainer') {
            session.stopAutoplay?.();
            if (session.card?.id) {
              uiState.setLastSelectedCardId(session.card.id);
            }
          }

          let targetView = state.view || 'decks';
          // Safety guard: If returning to 'study' or 'trainer' via popstate, but session has no card loaded,
          // route to 'cards' (if currentDeck is set) or 'decks' to prevent showing StudyFinished unexpectedly.
          if ((targetView === 'study' || targetView === 'trainer') && !session.card) {
            targetView = deckState.currentDeck ? 'cards' : 'decks';
          }

          setView(targetView);
          setActiveFolderId(state.folderId ?? null);
        }
        
        setTimeout(() => {
          isPopStateRef.current = false;
        }, 50);
      } else {
        // Popped past root in browser or null state
        window.history.replaceState({ view: 'decks', folderId: null }, '');
        setView('decks');
        setActiveFolderId(null);
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
  useCollaborativeSync(); // Real-time background sync for collaborative folders
  
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
      case 'study':
      case 'trainer':
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
      case 'lid_exam':
        return <LidExamView />;
      case 'decks':
      default:
        return (
          <DeckGrid
            userId={USER_ID}
            startStudy={startStudy}
            startTutorial={startTutorial}
          />
        );
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
      <BatchCardModal />
      <DeckModals />
      <RenameDeckModal />
      <CollaboratorsModal />
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
        onInsertBelow={(c) => openCreator(c.deck_id || currentDeck?.id, view, c.id)}
        onStartAutoplay={async (c) => {
          if (view === 'study') {
            const { startAutoplayFn } = useSessionStore.getState();
            if (startAutoplayFn) {
              startAutoplayFn();
            }
          } else {
            const targetDeck = decks.find(d => d.id === c?.deck_id) || currentDeck;
            if (targetDeck && c?.id) {
              await startStudyCard(targetDeck, c.id);
              setTimeout(() => {
                const { startAutoplayFn } = useSessionStore.getState();
                if (startAutoplayFn) startAutoplayFn();
              }, 400);
            }
          }
        }}
        loading={loading}
      />

      <AuthRequiredModal
        isOpen={isAuthModalOpen}
        onClose={() => useUiStore.getState().setIsAuthModalOpen(false)}
        title={authModalTitle}
      />

      <LanguageSelectionModal />
      <LanguageWelcomeModal 
        isOpen={isFirstLaunch} 
        onComplete={() => {
          setIsFirstLaunch(false);
          storage.set('lerne_welcome_seen', 'true');
          setTimeout(() => {
            setActiveTutorial('welcome');
          }, 350);
        }}
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

