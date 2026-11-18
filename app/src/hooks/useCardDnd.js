import { useState, useCallback } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useDeckStore } from '../store/useDeckStore';

/**
 * Manages drag-and-drop sorting state and handlers for the card list.
 *
 * @param {Array} filteredCards - Currently visible cards (used for reorder computation)
 * @param {Array} deckCards     - All cards in the deck (used for getOriginalIndex)
 * @param {number} deckId       - Deck that owns the current list
 */
export function useCardDnd(filteredCards, deckCards, deckId) {
  const [activeCardId, setActiveCardId] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null);

  const isReorderPending = pendingOrder !== null && pendingOrder.deckId === deckId;
  const orderedCards = isReorderPending && pendingOrder.source === filteredCards
    ? pendingOrder.cards : filteredCards;

  const handleDragStart = (event) => {
    setActiveCardId(event.active.id);
  };

  const handleDragEnd = async ({ active, over }) => {
    setActiveCardId(null);
    if (isReorderPending || !over || active.id === over.id) return;
    const oldIndex = filteredCards.findIndex(item => item.id === active.id);
    const newIndex = filteredCards.findIndex(item => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const newOrder = arrayMove(filteredCards, oldIndex, newIndex);
    const pending = { deckId, source: filteredCards, cards: newOrder };
    setPendingOrder(pending);
    try {
      await useDeckStore.getState().reorderCards(newOrder.map(card => card.id), deckId);
    } finally {
      setPendingOrder(current => current === pending ? null : current);
    }
  };

  const getOriginalIndex = useCallback((cardId) => {
    if (!deckCards) return 0;
    const idx = deckCards.findIndex(c => c.id === cardId);
    return idx >= 0 ? idx : 0;
  }, [deckCards]);

  return {
    orderedCards,
    isReorderPending,
    activeCard: activeCardId === null ? null : filteredCards.find(c => c.id === activeCardId),
    handleDragStart,
    handleDragEnd,
    handleDragCancel: () => setActiveCardId(null),
    getOriginalIndex,
  };
}
