import { useState, useCallback, useEffect, useMemo } from 'react';
import { tr } from '../i18n/locale';
import { parseRangeSelection } from '../utils/deckUtils';
import { useUiStore } from '../store/useUiStore';

const EMPTY_SELECTED_SET = new Set();

/**
 * Manages multi-select mode state, card selection, and range-based selection
 * for the CardList view.
 *
 * @param {Array}  filteredCards  - Currently visible (possibly filtered) cards array
 * @param {*}      currentDeckId  - Active deck id — resets selection on change
 * @param {string} view           - App view name — resets selection on change
 */
export function useCardSelectMode(filteredCards, currentDeckId, view) {
  const showToast = useUiStore(s => s.showToast);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState(EMPTY_SELECTED_SET);
  const [isBatchMoveModalOpen, setIsBatchMoveModalOpen] = useState(false);
  const [batchModalMode, setBatchModalMode] = useState('move');
  const [rangeInput, setRangeInput] = useState('');

  // Reset selection whenever the user navigates to a different deck or view
    useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSelectMode(false);
    setSelectedCardIds(prev => (prev.size === 0 ? prev : EMPTY_SELECTED_SET));
    setRangeInput('');
  }, [currentDeckId, view]);

  const toggleSelectMode = useCallback(() => {
    setIsSelectMode(prev => {
      if (prev) {
        setSelectedCardIds(EMPTY_SELECTED_SET);
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

  const selectableCount = useMemo(
    () => filteredCards.filter(card => !card.offline_create_status).length,
    [filteredCards]
  );
  const handleSelectAll = useCallback(() => {
    if (selectedCardIds.size === selectableCount && selectableCount > 0) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(filteredCards.filter(card => !card.offline_create_status).map(card => card.id)));
    }
  }, [selectedCardIds.size, selectableCount, filteredCards]);

  const handleApplyRange = useCallback((e) => {
    e?.preventDefault();
    if (!rangeInput.trim()) return;
    const indices = parseRangeSelection(rangeInput, filteredCards.length);
    if (indices.length === 0) {
      showToast(tr("Карточки по указанным номерам не найдены"), "warning");
      return;
    }
    const targetIds = indices.map(idx => filteredCards[idx - 1])
      .filter(card => card && !card.offline_create_status).map(card => card.id);
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
    selectableCount,
    handleApplyRange,
  };
}
