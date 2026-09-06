import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion } from 'framer-motion';
import { Layers, ChevronRight } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';

export const LearningShortcutsBar = ({
  learningDecks = [],
  setCurrentDeck,
  fetchDeckCards
}) => {
  useInterfaceLocale();
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
          <span className="title-text">{tr("Сейчас усиленно учу")}</span>
          <span className="learning-count-pill">{learningDecks.length}</span>
        </div>
      </div>

      <div className="learning-shortcuts-scroll-container">
        {learningDecks.map((deck) => {
          const dueCount = deck.stats?.due || 0;
          const learningCount = deck.stats?.learning || 0;
          const newCount = deck.stats?.new || 0;
          const hasCardsToStudy = dueCount > 0 || learningCount > 0 || newCount > 0;

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
                {hasCardsToStudy ? (
                  <div className="shortcut-srs-counters">
                    <span className="shortcut-srs-pill pill-due" title={tr("К повторению сегодня")}>
                      <span className="anki-dot dot-red" />
                      <span className="srs-count-val">{dueCount}</span>
                    </span>
                    <span className="shortcut-srs-pill pill-learning" title={tr("На закреплении")}>
                      <span className="anki-dot dot-yellow" />
                      <span className="srs-count-val">{learningCount}</span>
                    </span>
                    <span className="shortcut-srs-pill pill-new" title={tr("Новые карточки")}>
                      <span className="anki-dot dot-blue" />
                      <span className="srs-count-val">{newCount}</span>
                    </span>
                  </div>
                ) : (
                  <span className="shortcut-done-badge">
                    <span>{tr("✓ Повторено")}</span>
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
