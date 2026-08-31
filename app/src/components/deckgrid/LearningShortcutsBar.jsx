import React from 'react';
import { motion } from 'framer-motion';
import { Flame, Layers, ChevronRight, Sparkles, Folder } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';

export const LearningShortcutsBar = ({
  learningDecks = [],
  folders = [],
  setCurrentDeck,
  fetchDeckCards
}) => {
  if (!learningDecks || learningDecks.length === 0) return null;

  const handleOpenDeck = (deck) => {
    const currentId = useDeckStore.getState().currentDeck?.id;
    if (currentId !== deck.id) {
      useDeckStore.setState({ deckCards: [], cardsLoading: true });
    }
    setCurrentDeck(deck);
    useUiStore.getState().setCardsScrollTop(0);
    useUiStore.getState().setLastSelectedCardId(null);
    useUiStore.getState().setView('cards');
    if (fetchDeckCards) fetchDeckCards(deck.id);
  };

  return (
    <div className="learning-shortcuts-section">
      <div className="learning-shortcuts-header">
        <div className="learning-shortcuts-title">
          <span className="flame-icon-pulse">🔥</span>
          <span className="title-text">Сейчас усиленно учу</span>
          <span className="learning-count-pill">{learningDecks.length}</span>
        </div>
      </div>

      <div className="learning-shortcuts-scroll-container">
        {learningDecks.map((deck) => {
          const parentFolder = deck.folder_id && folders 
            ? folders.find(f => f.id === deck.folder_id) 
            : null;
          const dueCount = deck.stats?.due || 0;
          const newCount = deck.stats?.new || 0;

          return (
            <motion.div
              key={`learning-shortcut-${deck.id}`}
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => handleOpenDeck(deck)}
              className={`learning-shortcut-chip glass ${dueCount > 0 ? 'has-due-cards' : ''}`}
            >
              <div className="shortcut-top-row">
                <div className="shortcut-deck-icon">
                  {dueCount > 0 ? (
                    <span className="shortcut-badge-pulse">⚡</span>
                  ) : (
                    <Layers size={14} color="#34d399" />
                  )}
                </div>
                <span className="shortcut-deck-name" title={deck.name}>
                  {deck.name}
                </span>
                <ChevronRight size={14} className="shortcut-arrow" />
              </div>

              <div className="shortcut-bottom-row">
                {dueCount > 0 ? (
                  <span className="shortcut-due-badge">
                    <Flame size={11} />
                    <span>{dueCount} повторить</span>
                  </span>
                ) : newCount > 0 ? (
                  <span className="shortcut-new-badge">
                    <Sparkles size={11} />
                    <span>{newCount} новых</span>
                  </span>
                ) : (
                  <span className="shortcut-done-badge">
                    <span>✓ Повторено</span>
                  </span>
                )}

                {parentFolder && (
                  <span 
                    className="shortcut-folder-tag"
                    title={`В папке: ${parentFolder.name}`}
                    style={{
                      color: parentFolder.color || '#94a3b8',
                      borderColor: parentFolder.color ? `${parentFolder.color}40` : 'rgba(255,255,255,0.1)'
                    }}
                  >
                    <Folder size={10} />
                    <span className="folder-name-truncate">{parentFolder.name}</span>
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
