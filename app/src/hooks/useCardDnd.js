import { useState, useCallback, useMemo } from 'react';
import {
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useDeckStore } from '../store/useDeckStore';

/**
 * Manages drag-and-drop sorting state and handlers for the card list.
 *
 * @param {Array} filteredCards - Currently visible cards (used for reorder computation)
 * @param {Array} deckCards     - All cards in the deck (used for getOriginalIndex)
 */
export function useCardDnd(filteredCards, deckCards) {
  const [activeCardId, setActiveCardId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event) => {
    setActiveCardId(event.active.id);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveCardId(null);
    if (over && active.id !== over.id) {
      const oldIndex = filteredCards.findIndex(item => item.id === active.id);
      const newIndex = filteredCards.findIndex(item => item.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(filteredCards, oldIndex, newIndex);
        const orderedIds = newOrder.map(c => c.id);
        useDeckStore.getState().reorderCards(orderedIds);
      }
    }
  };

  const customCollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    return closestCenter(args);
  }, []);

  const activeCard = useMemo(() => {
    if (!activeCardId) return null;
    return filteredCards.find(c => c.id === activeCardId);
  }, [activeCardId, filteredCards]);

  const getOriginalIndex = useCallback((cardId) => {
    if (!deckCards) return 0;
    const idx = deckCards.findIndex(c => c.id === cardId);
    return idx >= 0 ? idx : 0;
  }, [deckCards]);

  return {
    sensors,
    activeCardId,
    activeCard,
    handleDragStart,
    handleDragEnd,
    customCollisionDetection,
    getOriginalIndex,
  };
}
