import { useState, useCallback, useEffect } from 'react';
import { tr } from '../i18n/locale';
import { parseRangeSelection } from '../utils/deckUtils';
import { useUiStore } from '../store/useUiStore';

/**
 * Manages multi-select mode state, card selection, and range-based selection
 * for the CardList view.
 *
 * @param {Array}  filteredCards  - Currently visible (possibly filtered) cards array
 * @param {*}      currentDeckId  - Active deck id — resets selection on change
 * @param {string} view           - App view name — resets selection on change
 */
export function useCardSelectMode(filteredCards, currentDeckId, view) {
  const { showToast } = useUiStore();

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState(new Set());
  const [isBatchMoveModalOpen, setIsBatchMoveModalOpen] = useState(false);
  const [batchModalMode, setBatchModalMode] = useState('move');
  const [rangeInput, setRangeInput] = useState('');

  // Reset selection whenever the user navigates to a different deck or view
    useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSelectMode(false);
    setSelectedCardIds(new Set());
    setRangeInput('');
  }, [currentDeckId, view]);

  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => {
      if (prev) {
        setSelectedCardIds(new Set());
        setRangeInput('');
      }
      return !prev;
    });
  }, []);

  const handleToggleSelectCard = useCallback((cardId) => {
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedCardIds.size === filteredCards.length && filteredCards.length > 0) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(filteredCards.map(c => c.id)));
    }
  }, [selectedCardIds.size, filteredCards]);

  const handleApplyRange = useCallback((e) => {
    e?.preventDefault();
    if (!rangeInput.trim()) return;
    const indices = parseRangeSelection(rangeInput, filteredCards.length);
    if (indices.length === 0) {
      showToast(tr("Карточки по указанным номерам не найдены"), "warning");
      return;
    }
    const targetIds = indices.map(idx => filteredCards[idx - 1]?.id).filter(Boolean);
    setSelectedCardIds(new Set(targetIds));
    showToast(tr("Выбрано карточек: {{p0}}", { p0: targetIds.length }), "info");
  }, [rangeInput, filteredCards, showToast]);

  return {
    isSelectMode,
    setIsSelectMode,
    selectedCardIds,
    setSelectedCardIds,
    isBatchMoveModalOpen,
    setIsBatchMoveModalOpen,
    batchModalMode,
    setBatchModalMode,
    rangeInput,
    setRangeInput,
    toggleSelectMode,
    handleToggleSelectCard,
    handleSelectAll,
    handleApplyRange,
  };
}
