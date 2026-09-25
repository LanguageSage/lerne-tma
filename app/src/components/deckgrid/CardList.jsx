import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, Plus, ListPlus, Settings, Play, RefreshCw, GripHorizontal, ExternalLink, Crop, Loader2, Search, ChevronDown, ChevronUp, MoreHorizontal, ChevronRight, CheckSquare, Check, Trash2, X, Move, Copy } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { CardActionButton } from '../modals/CardActionModal';
import { BatchMoveModal } from '../modals/BatchMoveModal';
import DeckAudioPlayer from '../common/DeckAudioPlayer';
import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useCardNavigation } from '../../hooks/useCardNavigation';
import { useCardActions } from '../../hooks/useCardActions';
import { UserProfileBadge } from '../common/UserBadge';
import { DeckMediaModal } from '../modals/DeckMediaModal';
import { ImageEditorModal } from '../common/ImageEditorModal';
import { navigateUp } from '../../utils/navigation';
import { useMediaUpload } from '../../hooks/useMediaUpload';

import { getFlagStyle } from '../../constants/cardFlags';
import { CardLevelBadge } from '../common/CardLevelBadge';
import { useCollaborativePresence } from '../../hooks/useCollaborativePresence';
import { CollaboratorPresenceBar } from '../collaborative/CollaboratorPresenceBar';
import { detectExerciseType } from '../../utils/exerciseDetector';
import { getTextShadow, getCardListBgStyle } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTranslation } from '../../i18n/i18nContext';
import { SearchBar } from '../common/SearchBar';
import { matchCard } from '../../utils/search';
import { getSortedFolderTree, parseDeckMetadata, getResourceSrc, parseRangeSelection } from '../../utils/deckUtils';
import { stripMarkdown } from '../../utils/text';
import { cleanBracketSyntax } from '../../utils/clozeParser';

const DraggableCardItem = React.memo(({
  c,
  index,
  currentDeck,
  startStudyCard,
  frontTypographyStyle,
  backTypographyStyle,
  cardListBg,
  previewCardLines,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect
}) => {
  useInterfaceLocale();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const flagStyle = React.useMemo(() => getFlagStyle(c.flag), [c.flag]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: c.id,
    disabled: isSelectMode,
    animateLayoutChanges: () => false,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : (transition || undefined),
    opacity: isDragging ? 0.25 : 1,
    zIndex: isDragging ? 999 : undefined,
    ...flagStyle
  };

  const detectedExerciseType = React.useMemo(() => detectExerciseType(c), [c]);
  const isQuizCard = detectedExerciseType === 'quiz';
  const isTrainerCard = detectedExerciseType === 'trainer';
  const isMatchCard = detectedExerciseType === 'match';
  const isFreeTextCard = detectedExerciseType === 'free_text';
  const isPuzzleCard = detectedExerciseType === 'puzzle';

  const linesLimit = previewCardLines === 0 ? 0 : (previewCardLines || 2);
  const isFrontLong = linesLimit > 0 && ((c.front || '').length > (linesLimit * 45) || (c.front || '').split('\n').length > linesLimit);
  const isBackLong = linesLimit > 0 && ((c.back || '').length > (linesLimit * 45) || (c.back || '').split('\n').length > linesLimit);
  const isLikelyLong = isFrontLong || isBackLong;
  const showExpandBtn = linesLimit > 0 && (isLikelyLong || isExpanded);

  const clampStyle = linesLimit === 0 || isExpanded ? {
    display: 'block',
    WebkitLineClamp: 'unset',
    lineClamp: 'unset',
    overflow: 'visible'
  } : {
    display: '-webkit-box',
    WebkitLineClamp: linesLimit,
    lineClamp: linesLimit,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden'
  };

  const handleItemClick = () => {
    if (isSelectMode) {
      onToggleSelect?.(c.id);
      return;
    }
    const container = document.getElementById('app-container');
    if (container) useUiStore.getState().setCardsScrollTop(container.scrollTop);
    useUiStore.getState().setLastSelectedCardId(c.id);
    startStudyCard(currentDeck, c.id);
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...cardListBg?.style }}
      id={`card-item-${c.id}`}
      className={`card-item card-front glass ${cardListBg?.className || ''} card-item-draggable ${isDragging ? 'is-dragging' : ''} ${isSelectMode ? 'is-select-mode' : ''} ${isSelected ? 'is-selected' : ''}`}
      onClick={isSelectMode ? () => onToggleSelect?.(c.id) : undefined}
    >
      {isSelectMode && (
        <div className="card-select-checkbox">
          {isSelected && <Check size={16} strokeWidth={3} />}
        </div>
      )}
      <div 
        className="card-item-text"
        onClick={handleItemClick}
        style={{ cursor: 'pointer', position: 'relative' }}
      >
        <div 
          className={`front-min ${isExpanded ? 'expanded' : ''}`} 
          style={{ ...frontTypographyStyle, ...clampStyle }}
        >
          {stripMarkdown(cleanBracketSyntax(c.front || ''))}
        </div>

        {c.back && (
          <div 
            className={`back-min ${isExpanded ? 'expanded' : ''}`} 
            style={{ ...backTypographyStyle, ...clampStyle }}
          >
            {stripMarkdown(cleanBracketSyntax(c.back || ''))}
          </div>
        )}

        {showExpandBtn && (
          <button
            type="button"
            className="card-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(prev => !prev);
            }}
            title={isExpanded ? tr("Свернуть текст") : tr("Развернуть полный текст")}
          >
            <span>{isExpanded ? tr("Свернуть") : tr("ещё...")}</span>
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>

      <div className="card-item-footer">
        <div className="card-item-footer-left">
          {!isSelectMode && (
            <div 
              className="deck-drag-handle-bottom" 
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              title={tr("Зажмите и потяните для перетаскивания карточки")}
            >
              <GripHorizontal size={20} />
            </div>
          )}

          <CardLevelBadge card={c} size="sm" />

          {isQuizCard && (
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#4ade80', 
              background: 'rgba(34, 197, 94, 0.15)', 
              border: '1px solid rgba(34, 197, 94, 0.3)', 
              borderRadius: '6px', 
              padding: '1px 5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px'
            }}>{tr("☑️ Тест")}{' '}</span>
          )}

          {isTrainerCard && (
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#c084fc', 
              background: 'rgba(168, 85, 247, 0.15)', 
              border: '1px solid rgba(168, 85, 247, 0.3)', 
              borderRadius: '6px', 
              padding: '1px 5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px'
            }}>{tr("🏋️ Тренажер")}{' '}</span>
          )}

          {isMatchCard && (
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#38bdf8', 
              background: 'rgba(56, 189, 248, 0.15)', 
              border: '1px solid rgba(56, 189, 248, 0.3)', 
              borderRadius: '6px', 
              padding: '1px 5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px'
            }}>{tr("🔗 Сопоставление")}{' '}</span>
          )}

          {isFreeTextCard && (
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#f59e0b', 
              background: 'rgba(245, 158, 11, 0.15)', 
              border: '1px solid rgba(245, 158, 11, 0.3)', 
              borderRadius: '6px', 
              padding: '1px 5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px'
            }}>{tr("💬 Письмо")}{' '}</span>
          )}

          {isPuzzleCard && (
            <span style={{ 
              fontSize: '0.68rem', 
              fontWeight: 700, 
              color: '#ec4899', 
              background: 'rgba(236, 72, 153, 0.15)', 
              border: '1px solid rgba(236, 72, 153, 0.3)', 
              borderRadius: '6px', 
              padding: '1px 5px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px'
            }}>{tr("🧩 Пазл")}{' '}</span>
          )}
        </div>

        <div className="card-item-footer-right">
          {typeof index === 'number' && (
            <span className="card-item-corner-number">
              {index + 1}
            </span>
          )}

          {!isSelectMode && (
            <CardActionButton 
              card={c} 
              size={16} 
              className="card-item-actions-trigger" 
              stopDrag={true} 
            />
          )}
        </div>
      </div>
    </div>
  );
});

export const CardList = ({ startStudy, startStudyCard }) => {
  useInterfaceLocale();
  const { t } = useTranslation();
  const { view, setView, setIsSettingsOpen, setIsRenameModalOpen, setDeckToRename, setCardsScrollTop, setIsBatchModalOpen, showToast } = useUiStore();
  const { currentDeck, deckCards, cardsLoading, folders, decks, handleDeleteDeck, handleResetProgress, handleSyncDeck } = useDeckStore();
  const { handleBatchMoveCards, handleBatchCopyCards, handleBatchDeleteCards } = useCardActions();

  const [isSelectMode, setIsSelectMode] = React.useState(false);
  const [selectedCardIds, setSelectedCardIds] = React.useState(new Set());
  const [isBatchMoveModalOpen, setIsBatchMoveModalOpen] = React.useState(false);
  const [batchModalMode, setBatchModalMode] = React.useState('move');
  const [rangeInput, setRangeInput] = React.useState('');

  const toggleSelectMode = React.useCallback(() => {
    setIsSelectMode(prev => {
      if (prev) {
        setSelectedCardIds(new Set());
        setRangeInput('');
      }
      return !prev;
    });
  }, []);

  const handleToggleSelectCard = React.useCallback((cardId) => {
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

  React.useEffect(() => {
    setIsSelectMode(false);
    setSelectedCardIds(new Set());
    setRangeInput('');
  }, [currentDeck?.id, view]);

  const previewCardFont = useSettingsStore(s => s.previewCardFont);
  const previewCardTextColor = useSettingsStore(s => s.previewCardTextColor);
  const previewBackTextColor = useSettingsStore(s => s.previewBackTextColor);
  const previewCardFontSize = useSettingsStore(s => s.previewCardFontSize);
  const previewBackFontSize = useSettingsStore(s => s.previewBackFontSize);
  const previewCardFontWeight = useSettingsStore(s => s.previewCardFontWeight);
  const previewCardFontStyle = useSettingsStore(s => s.previewCardFontStyle);
  const previewTextShadow = useSettingsStore(s => s.previewTextShadow);
  const previewCardBg = useSettingsStore(s => s.previewCardBg);
  const cardListBg = React.useMemo(() => getCardListBgStyle(previewCardBg), [previewCardBg]);
  const previewCardLines = useSettingsStore(s => s.previewCardLines);
  const previewCardTextAlign = useSettingsStore(s => s.previewCardTextAlign);
  const isAdmin = useSettingsStore(s => s.isAdmin);
  const adminDraftDesignV2 = useSettingsStore(s => s.adminDraftDesignV2);
  const publishedDesignV2 = useSettingsStore(s => s.publishedDesignV2);

  const effectiveCardListConfig = (isAdmin && adminDraftDesignV2)
    ? adminDraftDesignV2.cardList
    : publishedDesignV2?.config?.cardList;

  const frontColor = previewCardTextColor || '#ffffff';
  const frontTypographyStyle = React.useMemo(() => {
    const v2 = effectiveCardListConfig?.frontText;
    if (v2) {
      return {
        fontFamily: v2.font || undefined,
        color: v2.color || '#ffffff',
        fontSize: v2.size ? `${v2.size}rem` : undefined,
        textShadow: getTextShadow(v2.shadow, v2.color || '#ffffff'),
        fontWeight: v2.weight || 600,
        fontStyle: v2.style || undefined,
        textAlign: v2.align || 'left',
      };
    }
    return {
      fontFamily: previewCardFont || undefined,
      color: frontColor,
      fontSize: previewCardFontSize ? `${previewCardFontSize}rem` : undefined,
      textShadow: getTextShadow(previewTextShadow, frontColor),
      fontWeight: previewCardFontWeight || 600,
      fontStyle: previewCardFontStyle || undefined,
      textAlign: previewCardTextAlign || 'left',
    };
  }, [effectiveCardListConfig, previewCardFont, frontColor, previewCardFontSize, previewTextShadow, previewCardFontWeight, previewCardFontStyle, previewCardTextAlign]);

  const effectiveBackColor = previewBackTextColor || '#cbd5e1';
  const backTypographyStyle = React.useMemo(() => {
    const v2 = effectiveCardListConfig?.backText;
    if (v2) {
      return {
        fontFamily: v2.font || undefined,
        color: v2.color || '#cbd5e1',
        fontSize: v2.size ? `${v2.size}rem` : undefined,
        textShadow: getTextShadow(v2.shadow, v2.color || '#cbd5e1'),
        fontWeight: v2.weight || 500,
        fontStyle: v2.style || undefined,
        textAlign: v2.align || 'left',
      };
    }
    return {
      fontFamily: previewCardFont || undefined,
      color: effectiveBackColor,
      fontSize: previewBackFontSize ? `${previewBackFontSize}rem` : undefined,
      textShadow: getTextShadow(previewTextShadow, effectiveBackColor),
      fontWeight: 500,
      fontStyle: previewCardFontStyle || undefined,
      textAlign: previewCardTextAlign || 'left',
    };
  }, [effectiveCardListConfig, previewCardFont, effectiveBackColor, previewBackFontSize, previewTextShadow, previewCardFontStyle, previewCardTextAlign]);

  const [searchQuery, setSearchQuery] = React.useState('');
  const [isSearchOpen, setIsSearchOpen] = React.useState(false);
  const [isMediaModalOpen, setIsMediaModalOpen] = React.useState(false);
  const [isDeckMenuOpen, setIsDeckMenuOpen] = React.useState(false);
  const [isMoveMenuOpen, setIsMoveMenuOpen] = React.useState(false);
  const [isCopyMenuOpen, setIsCopyMenuOpen] = React.useState(false);
  const deckMenuRef = React.useRef(null);
  const [editingDeckImgSrc, setEditingDeckImgSrc] = React.useState(null);
  const [editingDeckImgIndex, setEditingDeckImgIndex] = React.useState(-1);

  React.useEffect(() => {
    if (!isDeckMenuOpen) return;
    const handleClickOutside = (event) => {
      if (deckMenuRef.current && !deckMenuRef.current.contains(event.target)) {
        setIsDeckMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isDeckMenuOpen]);

  React.useEffect(() => {
    if (!isDeckMenuOpen) {
      setIsMoveMenuOpen(false);
      setIsCopyMenuOpen(false);
    }
  }, [isDeckMenuOpen]);

  const handleShare = async (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    try {
      const result = await useDeckStore.getState().handleShareDeck(currentDeck.id);
      if (result.success) {
        if (result.type === 'copy') showToast(tr("Ссылка скопирована!"), 'success');
        else if (result.type === 'telegram') showToast(tr("Открываем Telegram Share..."), 'success');
      }
    } catch {
      showToast(tr("Ошибка при создании ссылки"), 'error');
    }
  };

  const handleSync = (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    handleSyncDeck(currentDeck.id);
  };

  const handleRename = (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setDeckToRename(currentDeck);
    setIsRenameModalOpen(true);
  };

  const handleReset = async (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    if (window.confirm(tr("Это сбросит весь прогресс обучения по этой колоде. Вы уверены?"))) {
      try {
        await handleResetProgress(currentDeck.id);
        showToast(tr("Прогресс успешно сброшен"), "success");
      } catch {
        showToast(tr("Ошибка при сбросе прогресса"));
      }
    }
  };

  const handleDelete = (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    if (window.confirm(tr("Вы уверены, что хотите полностью удалить эту колоду и весь прогресс?"))) {
      handleDeleteDeck(currentDeck.id);
      setView('decks');
    }
  };

  const handleReclassifyDeck = async (e) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    showToast(tr("Обновление уровней колоды..."), 'info');
    try {
      const response = await fetch('/api/cards/classify-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deck_id: currentDeck.id, target_language: currentDeck.target_language || 'de' })
      });
      if (response.ok) {
        const data = await response.json();
        useDeckStore.getState().fetchDeckCards(currentDeck.id);
        showToast(tr("✨ Уровни карточек обновлены! ({{p0}} шт.)", { p0: data.updated_count || 0 }), 'success');
      } else {
        showToast(tr("Ошибка при переклассификации"));
      }
    } catch {
      showToast(tr("Ошибка сети при переклассификации"));
    }
  };

  const handleMoveToFolder = async (e, folderId) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setIsMoveMenuOpen(false);
    try {
      await useDeckStore.getState().moveDeckToFolder(currentDeck.id, folderId);
      showToast(tr("Колода перемещена"), "success");
    } catch {
      showToast(tr("Ошибка при перемещении колоды"), "error");
    }
  };

  const handleCopyToFolder = async (e, folderId) => {
    e?.stopPropagation();
    setIsDeckMenuOpen(false);
    setIsCopyMenuOpen(false);
    try {
      await useDeckStore.getState().copyDeckToFolder(currentDeck.id, folderId);
      showToast(tr("Колода скопирована"), "success");
    } catch {
      showToast(tr("Ошибка при копировании колоды"), "error");
    }
  };

  const filteredCards = React.useMemo(() => {
    if (!deckCards) return [];
    if (!searchQuery.trim()) return deckCards;
    return deckCards.filter(c => matchCard(c, searchQuery));
  }, [deckCards, searchQuery]);

  const handleSelectAll = React.useCallback(() => {
    if (selectedCardIds.size === filteredCards.length && filteredCards.length > 0) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(filteredCards.map(c => c.id)));
    }
  }, [selectedCardIds.size, filteredCards]);

  const handleApplyRange = React.useCallback((e) => {
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

  // =========================================================================
  // CRITICAL INVARIANT: DO NOT SIMPLIFY OR REMOVE THIS LOGIC!
  // When returning from StudyView/CardEditor to CardList, visibleCount MUST
  // include the previously selected card (lastSelectedCardId) and cardsScrollTop.
  // If visibleCount resets to 40 blindly, deep cards (e.g. card #120) won't exist
  // in the DOM, scrollHeight will be too short, and the browser will clamp scroll
  // to top, destroying user position.
  // =========================================================================
  const calculateRequiredVisibleCount = React.useCallback((cards) => {
    let count = 40;
    if (!cards || !cards.length) return count;
    const lastId = useUiStore.getState().lastSelectedCardId;
    if (lastId) {
      const idx = cards.findIndex(c => String(c.id) === String(lastId));
      if (idx !== -1) {
        count = Math.max(count, idx + 30);
      }
    }
    const savedTop = useUiStore.getState().cardsScrollTop;
    if (savedTop > 0) {
      count = Math.max(count, Math.ceil(savedTop / 50) + 20);
    }
    return Math.min(cards.length, count);
  }, []);

  const [visibleCount, setVisibleCount] = React.useState(() => {
    const deck = useDeckStore.getState().currentDeck;
    const cards = (deck && (useDeckStore.getState().deckCards || useDeckStore.getState().cardsByDeck[deck.id])) || [];
    let initial = 40;
    const lastId = useUiStore.getState().lastSelectedCardId;
    if (lastId && cards.length) {
      const idx = cards.findIndex(c => String(c.id) === String(lastId));
      if (idx !== -1) initial = Math.max(initial, idx + 30);
    }
    const savedTop = useUiStore.getState().cardsScrollTop;
    if (savedTop > 0 && cards.length) {
      initial = Math.max(initial, Math.ceil(savedTop / 50) + 20);
    }
    return Math.min(cards.length || 40, initial);
  });

  React.useEffect(() => {
    if (searchQuery.trim()) return;
    if (!filteredCards || !filteredCards.length) return;
    const required = calculateRequiredVisibleCount(filteredCards);
    setVisibleCount(prev => Math.max(prev, required));
  }, [filteredCards, searchQuery, calculateRequiredVisibleCount]);

  React.useEffect(() => {
    if (!searchQuery.trim()) {
      const required = calculateRequiredVisibleCount(filteredCards);
      setVisibleCount(required);
    }
  }, [currentDeck?.id, calculateRequiredVisibleCount, filteredCards, searchQuery]);

  const renderedCards = React.useMemo(() => {
    if (searchQuery.trim()) return filteredCards;
    return filteredCards.slice(0, visibleCount);
  }, [filteredCards, searchQuery, visibleCount]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const [activeCardId, setActiveCardId] = React.useState(null);

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

  const customCollisionDetection = React.useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return closestCenter(args);
  }, []);

  const activeCard = React.useMemo(() => {
    if (!activeCardId) return null;
    return filteredCards.find(c => c.id === activeCardId);
  }, [activeCardId, filteredCards]);

  const getOriginalIndex = React.useCallback((cardId) => {
    if (!deckCards) return 0;
    const idx = deckCards.findIndex(c => c.id === cardId);
    return idx >= 0 ? idx : 0;
  }, [deckCards]);

  const { uploadDeckResource } = useMediaUpload();
  const { openCreator } = useCardNavigation();
  const isDeckViewActive = ['cards', 'study', 'trainer', 'editor'].includes(view);
  const { collaborators, onlineCount, isShared } = useCollaborativePresence('deck', currentDeck?.id, isDeckViewActive);

  // Memoized Deck Metadata & Resources
  const deckMetadata = React.useMemo(() => parseDeckMetadata(currentDeck), [currentDeck]);
  const deckResources = React.useMemo(() => deckMetadata.resources || [], [deckMetadata]);
  const deckImages = React.useMemo(() => deckResources.filter(r => r.type === 'image'), [deckResources]);
  const deckAudios = React.useMemo(() => deckResources.filter(r => r.type === 'audio'), [deckResources]);
  const deckVideos = React.useMemo(() => deckResources.filter(r => r.type === 'video'), [deckResources]);
  const deckLinks = React.useMemo(() => deckResources.filter(r => r.type === 'link'), [deckResources]);

  // Resizable image height — read from metadata, default 220px
  const getMetaImageHeight = React.useCallback(() => {
    return deckMetadata.imageHeight || 220;
  }, [deckMetadata]);

  const [imageHeight, setImageHeight] = React.useState(getMetaImageHeight);

  // Sync imageHeight when deck changes
  React.useEffect(() => {
    setImageHeight(getMetaImageHeight());
  }, [getMetaImageHeight]);

  const saveImageHeight = React.useCallback(async (h) => {
    if (!currentDeck) return;
    await useDeckStore.getState().updateDeckMetadata(currentDeck.id, { ...deckMetadata, imageHeight: h });
  }, [currentDeck, deckMetadata]);

  const startResizeDrag = React.useCallback((e) => {
    e.preventDefault();
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const startH = imageHeight;
    const onMove = (ev) => {
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const delta = clientY - startY;
      const newH = Math.max(80, Math.min(800, startH + delta));
      setImageHeight(newH);
    };
    const onUp = (ev) => {
      const clientY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
      const delta = clientY - startY;
      const finalH = Math.max(80, Math.min(800, startH + delta));
      saveImageHeight(Math.round(finalH));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [imageHeight, saveImageHeight]);

  const handleToggleShowInCards = async (targetImg, isChecked) => {
    if (!currentDeck) return;
    let metadata = { resources: [] };
    if (currentDeck.metadata) {
      metadata = typeof currentDeck.metadata === 'string'
        ? JSON.parse(currentDeck.metadata)
        : currentDeck.metadata;
    }
    const updatedResources = (metadata.resources || []).map(r => {
      if (r === targetImg || (r.type === 'image' && (r.url === targetImg.url || r.path === targetImg.path))) {
        return { ...r, show_in_cards: isChecked };
      }
      return r;
    });
    await useDeckStore.getState().updateDeckMetadata(currentDeck.id, { ...metadata, resources: updatedResources });
  };

  React.useEffect(() => {
    if (view === 'cards' && currentDeck?.id) {
      const state = useDeckStore.getState();
      const hasCards = (state.deckCards && state.deckCards.length > 0) || (state.cardsByDeck[currentDeck.id]?.length > 0);
      if (!hasCards) {
        state.fetchDeckCards(currentDeck.id);
      }
    }
  }, [view, currentDeck?.id]);

  // =========================================================================
  // CRITICAL INVARIANT: DO NOT REMOVE isRestoringScrollRef OR THE RESTORATION EFFECT!
  // During remount & DOM layout calculation, container.scrollTop temporarily reports 0
  // or clamped values. isRestoringScrollRef prevents handleScroll from overwriting
  // saved cardsScrollTop with 0 before double-rAF restore finishes.
  // =========================================================================
  const isRestoringScrollRef = React.useRef(false);
  const hasRestoredForDeckRef = React.useRef(null);

  // Preserve scroll position on unmount so returning to CardList always has the latest scrollTop
  React.useEffect(() => {
    return () => {
      const container = document.getElementById('app-container');
      if (container && container.scrollTop > 0) {
        useUiStore.getState().setCardsScrollTop(container.scrollTop);
      }
    };
  }, []);

  // Safe scroll listener that does NOT fire or overwrite state while restoring scroll
  React.useEffect(() => {
    if (view !== 'cards') return;
    const container = document.getElementById('app-container');
    if (!container) return;

    const handleScroll = () => {
      if (isRestoringScrollRef.current) return;
      setCardsScrollTop(container.scrollTop);
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 350) {
        setVisibleCount(prev => (prev < filteredCards.length ? prev + 30 : prev));
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [view, setCardsScrollTop, filteredCards.length]);

  // Robust scroll & anchor restoration with layout-wait (double rAF)
  React.useEffect(() => {
    if (view !== 'cards' || !currentDeck?.id) return;
    if (!renderedCards || renderedCards.length === 0) return;

    // Run restoration only once per mount/deck view session
    if (hasRestoredForDeckRef.current === currentDeck.id) return;

    const savedTop = useUiStore.getState().cardsScrollTop;
    const lastId = useUiStore.getState().lastSelectedCardId;

    if (savedTop > 0 || lastId) {
      isRestoringScrollRef.current = true;
      hasRestoredForDeckRef.current = currentDeck.id;

      const container = document.getElementById('app-container');

      const performRestore = () => {
        if (!container) {
          isRestoringScrollRef.current = false;
          return;
        }

        // 1. Restore pixel position first if valid
        if (savedTop > 0) {
          container.scrollTop = savedTop;
        }

        // 2. Anchor to specific card element if lastSelectedCardId is known
        if (lastId) {
          const el = document.getElementById(`card-item-${lastId}`);
          if (el) {
            const rect = el.getBoundingClientRect();
            const inView = rect.top >= 60 && rect.bottom <= (window.innerHeight - 60);
            if (!inView) {
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
          }
        }

        // Cooldown period to ignore any layout-induced scroll events
        setTimeout(() => {
          isRestoringScrollRef.current = false;
          if (container && container.scrollTop > 0) {
            useUiStore.getState().setCardsScrollTop(container.scrollTop);
          }
        }, 150);
      };

      // Double rAF guarantees DOM nodes have been laid out with correct heights
      requestAnimationFrame(() => {
        requestAnimationFrame(performRestore);
      });
    } else {
      hasRestoredForDeckRef.current = currentDeck.id;
    }
  }, [view, currentDeck?.id, renderedCards]);

  if (view !== 'cards') return null;
  if (!currentDeck) {
    return (
      <div className="view-cards" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '350px' }}>
        <Loader2 className="animate-spin" size={32} color="#a855f7" />
      </div>
    );
  }

  return (
    <div className="view-cards">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="view">
        <div className="header-compact header-compact-sticky">
          <button 
            className="back-btn" 
            onClick={navigateUp}
            title={tr("Назад")}
            aria-label={tr("Назад")}
          >
            <ChevronLeft size={24} />
          </button>

          <div className="header-actions">
            <UserProfileBadge />
            <button 
              className="header-action-btn" 
              onClick={() => setIsBatchModalOpen(true)} 
              title={tr("Пакетная генерация карточек")}
            >
              <ListPlus size={22} />
            </button>

            <HelpButton topic="cards" />

            {/* Search Toggle Button */}
            <button
              className={`header-action-btn ${isSearchOpen ? 'active' : ''}`}
              onClick={() => {
                setIsSearchOpen(prev => {
                  if (prev) setSearchQuery('');
                  return !prev;
                });
              }}
              title={tr("Поиск карточек")}
              style={{
                color: (isSearchOpen || searchQuery) ? '#c084fc' : 'currentColor',
                background: (isSearchOpen || searchQuery) ? 'rgba(168, 85, 247, 0.2)' : undefined,
                borderColor: (isSearchOpen || searchQuery) ? 'rgba(168, 85, 247, 0.5)' : undefined
              }}
            >
              <Search size={20} />
            </button>

            {/* Selection Mode Toggle Button */}
            <button
              className={`header-action-btn ${isSelectMode ? 'active' : ''}`}
              onClick={toggleSelectMode}
              title={isSelectMode ? tr("Выйти из режима выбора") : tr("Выбрать несколько карточек")}
              style={{
                color: isSelectMode ? '#c084fc' : 'currentColor',
                background: isSelectMode ? 'rgba(168, 85, 247, 0.2)' : undefined,
                borderColor: isSelectMode ? 'rgba(168, 85, 247, 0.5)' : undefined
              }}
            >
              <CheckSquare size={20} />
            </button>

            {/* Quick Lines Switcher Button */}
            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title={tr("Настройки")}
            >
              <Settings size={22} />
            </button>

            {/* Deck Options Dropdown Menu Button */}
            <div style={{ position: 'relative' }} ref={deckMenuRef}>
              <button 
                className={`header-action-btn ${isDeckMenuOpen ? 'active' : ''}`} 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDeckMenuOpen(prev => !prev);
                }}
                title={tr("Опции колоды")}
                style={{
                  color: isDeckMenuOpen ? '#c084fc' : 'currentColor',
                  background: isDeckMenuOpen ? 'rgba(168, 85, 247, 0.2)' : undefined,
                  borderColor: isDeckMenuOpen ? 'rgba(168, 85, 247, 0.5)' : undefined
                }}
              >
                <MoreHorizontal size={22} />
              </button>

              {isDeckMenuOpen && (
                <div 
                  className="deck-dropdown-menu glass" 
                  style={{
                    top: 'calc(100% + 6px)',
                    bottom: 'auto',
                    right: 0,
                    transformOrigin: 'top right'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="dropdown-item" onClick={() => {
                    setIsDeckMenuOpen(false);
                    setIsMediaModalOpen(true);
                  }}>
                    <span>{tr("📎 Ресурсы колоды")}</span>
                  </button>

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={handleRename}>
                      <span>{tr("✍️ Переименовать")}</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={() => {
                      setIsDeckMenuOpen(false);
                      useUiStore.getState().setCollaboratorsTarget({ type: 'deck', id: currentDeck.id, name: currentDeck.name });
                      useUiStore.getState().setIsCollaboratorsModalOpen(true);
                    }}>
                      <span>{tr("👥 Совместный доступ")}</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={handleShare}>
                      <span>{tr("🔗 Поделиться")}</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <button className="dropdown-item" onClick={handleSync}>
                      <span>🔄 {currentDeck?.has_updates ? tr("❗️ Обновить") : tr("Обновить")}</span>
                    </button>
                  )}

                  {!currentDeck?.is_inbox && (
                    <>
                      <button 
                        className={`dropdown-item ${isMoveMenuOpen ? 'active' : ''}`} 
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsMoveMenuOpen(prev => !prev);
                        }}
                      >
                        <span>{tr("📁 Переместить в")}</span>
                        <ChevronRight 
                          size={14} 
                          style={{ 
                            marginLeft: 'auto', 
                            transform: isMoveMenuOpen ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.2s' 
                          }} 
                        />
                      </button>
                      {isMoveMenuOpen && (
                        <div className="dropdown-sub-menu">
                          <button 
                            className={`dropdown-sub-item ${currentDeck?.folder_id === null ? 'current' : ''}`}
                            onClick={(e) => handleMoveToFolder(e, null)}
                          >
                            <span>{tr("Без папки (Главная)")}</span>
                          </button>
                          {getSortedFolderTree(folders || []).map(f => (
                            <button 
                              key={f.id}
                              className={`dropdown-sub-item ${currentDeck?.folder_id === f.id ? 'current' : ''}`}
                              onClick={(e) => handleMoveToFolder(e, f.id)}
                              style={{ paddingLeft: `${12 + f.depth * 14}px` }}
                            >
                              <span>{f.name}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      <button 
                        className={`dropdown-item ${isCopyMenuOpen ? 'active' : ''}`} 
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsCopyMenuOpen(prev => !prev);
                        }}
                      >
                        <span>{tr("📋 Скопировать в")}</span>
                        <ChevronRight 
                          size={14} 
                          style={{ 
                            marginLeft: 'auto', 
                            transform: isCopyMenuOpen ? 'rotate(90deg)' : 'none',
                            transition: 'transform 0.2s' 
                          }} 
                        />
                      </button>
                      {isCopyMenuOpen && (
                        <div className="dropdown-sub-menu">
                          <button 
                            className={`dropdown-sub-item ${currentDeck?.folder_id === null ? 'current' : ''}`}
                            onClick={(e) => handleCopyToFolder(e, null)}
                          >
                            <span>{tr("Без папки (Главная)")}</span>
                          </button>
                          {getSortedFolderTree(folders || []).map(f => (
                            <button 
                              key={f.id}
                              className={`dropdown-sub-item ${currentDeck?.folder_id === f.id ? 'current' : ''}`}
                              onClick={(e) => handleCopyToFolder(e, f.id)}
                              style={{ paddingLeft: `${12 + f.depth * 14}px` }}
                            >
                              <span>{f.name}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      <button className="dropdown-item" onClick={handleReclassifyDeck}>
                        <span>{tr("✨ Обновить CEFR-уровни")}</span>
                      </button>
                      <button className="dropdown-item warning" onClick={handleReset}>
                        <span>{tr("🧹 Сбросить прогресс")}</span>
                      </button>
                      <button className="dropdown-item danger" onClick={handleDelete}>
                        <span>{tr("🗑️ Удалить колоду")}</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Select Mode Toolbar */}
        {isSelectMode && (
          <div className="select-mode-bar glass">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={toggleSelectMode}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  color: '#cbd5e1',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer'
                }}
                title={tr("Отменить выбор")}
              >
                <X size={16} />
              </button>
              <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc' }}>
                {tr("Выбрано: {{p0}} из {{p1}}", { p0: selectedCardIds.size, p1: filteredCards.length })}
              </span>
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={handleSelectAll}
              style={{
                padding: '5px 12px',
                fontSize: '0.78rem',
                borderRadius: '10px',
                fontWeight: 600,
                background: 'rgba(255, 255, 255, 0.08)'
              }}
            >
              {selectedCardIds.size === filteredCards.length && filteredCards.length > 0 ? tr("Снять всё") : tr("Выбрать все")}
            </button>
          </div>
        )}

        {/* Expandable Search Input in CardList */}
        {isSearchOpen && (
          <div style={{ padding: '0 15px', marginTop: '10px', marginBottom: '4px' }}>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('cards.search_placeholder', 'Поиск по слову, переводу...')}
              count={filteredCards.length}
              total={deckCards?.length || 0}
              countLabel={t('cards.search_found', { count: filteredCards.length, total: deckCards?.length || 0 })}
              autoFocus={true}
            />
          </div>
        )}

        {isShared && (
          <div style={{ padding: '0 15px', marginTop: '4px', marginBottom: '2px' }}>
            <CollaboratorPresenceBar collaborators={collaborators} onlineCount={onlineCount} isShared={isShared} />
          </div>
        )}

        {/* 2-line Hero Study Deck Button */}
        <div style={{ padding: '0 15px', marginTop: '6px', marginBottom: '8px' }}>
          <button 
            className="btn btn-primary btn-full study-deck-hero-btn"
            style={{ 
              display: 'flex', 
              flexDirection: 'column',
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '6px',
              padding: '14px 18px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, #a855f7 0%, #6366f1 100%)',
              boxShadow: '0 8px 24px rgba(168, 85, 247, 0.38)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              cursor: (!deckCards || deckCards.length === 0) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              width: '100%',
              boxSizing: 'border-box'
            }}
            onClick={() => startStudy(currentDeck)}
            disabled={!deckCards || deckCards.length === 0}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '1.05rem', fontWeight: 700, color: '#ffffff' }}>
              <Play size={20} fill="currentColor" />
              <span>{tr("Учить колоду (")}{deckCards?.length || 0})</span>
            </div>
            <div style={{ 
              fontSize: '1.05rem', 
              fontWeight: 700, 
              color: '#ffffff',
              textAlign: 'center',
              wordBreak: 'break-word',
              lineHeight: 1.35,
              width: '100%'
            }}>
              {currentDeck?.name}
            </div>
          </button>
        </div>

        {deckImages.length > 0 && (
          <div className="deck-images-gallery" style={{
            margin: '4px 15px 8px 15px',
            display: 'flex',
            gap: '10px',
            overflowX: 'auto',
            paddingBottom: '4px',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch'
          }}>
            {deckImages.map((img, idx) => {
              const imgSrc = getResourceSrc(img, 'images');
              const resourceIndex = deckResources.findIndex(r => r === img || (r.type === 'image' && (r.url === img.url || r.path === img.path)));
              return (
                <div key={idx} style={{ flex: '0 0 100%', maxWidth: '100%', scrollSnapAlign: 'start' }}>
                  <div className="glass" style={{
                    position: 'relative',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.25)'
                  }}>
                    <img 
                      src={imgSrc} 
                      alt="" 
                      style={{ 
                        display: 'block',
                        width: '100%', 
                        height: 'auto',
                        maxHeight: `${imageHeight}px`, 
                        objectFit: 'contain',
                        cursor: 'zoom-in' 
                      }} 
                      onClick={() => window.open(imgSrc, '_blank')}
                    />

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingDeckImgSrc(imgSrc);
                              setEditingDeckImgIndex(resourceIndex >= 0 ? resourceIndex : idx);
                            }}
                            style={{
                              position: 'absolute',
                              top: '8px',
                              right: '8px',
                              background: 'rgba(0, 0, 0, 0.7)',
                              backdropFilter: 'blur(6px)',
                              border: '1px solid rgba(255, 255, 255, 0.25)',
                              color: '#e9d5ff',
                              padding: '4px 10px',
                              borderRadius: '8px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              zIndex: 2,
                              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                              transition: 'all 0.2s'
                            }}
                            onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.85)'}
                            onMouseOut={e => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)'}
                            title={tr("Редактировать изображение списка")}
                          >
                            <Crop size={13} />
                            <span>{tr("Изменить")}</span>
                          </button>

                          {deckImages.length > 1 && (
                            <div style={{
                              position: 'absolute',
                              top: '8px',
                              left: '8px',
                              background: 'rgba(0, 0, 0, 0.65)',
                              color: 'white',
                              fontSize: '0.72rem',
                              padding: '2px 8px',
                              borderRadius: '8px',
                              fontWeight: 600
                            }}>
                              {idx + 1} / {deckImages.length}
                            </div>
                          )}
                        </div>

                        {/* Resize handle */}
                        <div
                          onMouseDown={startResizeDrag}
                          onTouchStart={startResizeDrag}
                          title={tr("Потяни чтобы изменить высоту")}
                          style={{
                            height: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'ns-resize',
                            margin: '2px 0',
                            userSelect: 'none',
                            touchAction: 'none'
                          }}
                        >
                          <div style={{
                            width: '48px',
                            height: '4px',
                            borderRadius: '2px',
                            background: 'rgba(168, 85, 247, 0.5)',
                            transition: 'background 0.2s'
                          }}
                          onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.9)'}
                          onMouseOut={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.5)'}
                          />
                        </div>

                        {/* Toggle switch for showing image in every card */}
                        <label 
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            marginTop: '4px',
                            padding: '6px 12px',
                            borderRadius: '12px',
                            background: 'rgba(255, 255, 255, 0.04)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            cursor: 'pointer',
                            userSelect: 'none',
                            width: '100%',
                            boxSizing: 'border-box'
                          }}
                        >
                          <span style={{ fontSize: '0.78rem', color: '#e2e8f0', fontWeight: 500 }}>{tr("Показывать картинку в каждой карточке")}{' '}</span>
                          <input
                            type="checkbox"
                            checked={img.show_in_cards !== false}
                            onChange={(e) => handleToggleShowInCards(img, e.target.checked)}
                            style={{
                              width: '16px',
                              height: '16px',
                              accentColor: '#a855f7',
                              cursor: 'pointer'
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

        {deckAudios.map((aud, idx) => (
          <DeckAudioPlayer key={idx} url={aud.url} title={aud.title} />
        ))}

        {deckVideos.map((vid, idx) => (
          <div key={idx} className="glass" style={{
            margin: '0 15px 10px 15px',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid rgba(251, 113, 133, 0.2)',
            background: '#000'
          }}>
            <video 
              src={vid.url} 
              controls 
              playsInline
              style={{ width: '100%', maxHeight: '200px', display: 'block', objectFit: 'contain' }} 
            />
          </div>
        ))}

        {deckLinks.length > 0 && (
          <div style={{
            margin: '0 15px 10px 15px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px'
          }}>
            {deckLinks.map((lnk, idx) => (
              <a
                key={idx}
                href={lnk.url}
                target="_blank"
                rel="noopener noreferrer"
                className="glass"
                style={{
                  padding: '6px 12px',
                  borderRadius: '10px',
                  fontSize: '0.8rem',
                  color: '#34d399',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  textDecoration: 'none',
                  border: '1px solid rgba(52, 211, 153, 0.2)'
                }}
              >
                <ExternalLink size={14} />
                <span>{lnk.title || lnk.url}</span>
              </a>
            ))}
          </div>
        )}

        <div id="tut-card-list-content" className="card-list">
          {cardsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
              <div className="cards-loading-state glass">
                <RefreshCw size={32} className="spin" color="#a855f7" />
                <h3>{tr("Загрузка карточек...")}</h3>
                <p>{tr("Получаем список карточек из базы данных")}</p>
              </div>
              {[1, 2, 3].map(idx => (
                <div key={idx} className="card-item glass card-skeleton" style={{ opacity: 0.6 }}>
                  <div className="card-item-text">
                    <div className="skeleton-line" style={{ width: '65%', height: '14px', marginBottom: '8px' }} />
                    <div className="skeleton-line" style={{ width: '45%', height: '10px' }} />
                  </div>
                  <div className="card-item-actions">
                    <div className="skeleton-action" />
                    <div className="skeleton-action" />
                    <div className="skeleton-action" />
                  </div>
                </div>
              ))}
            </div>
          ) : deckCards.length === 0 ? (
            <div className="empty-cards-state glass">
              <h3>{tr("В этой колоде пока нет карточек")}</h3>
              <p>{tr("Нажмите на \"+\" в правом верхнем углу или на кнопку ниже, чтобы создать свою первую карточку.")}</p>
              <button 
                className="btn btn-primary" 
                style={{ marginTop: '10px' }} 
                onClick={() => openCreator(currentDeck?.id)}
              >{tr("Создать карточку")}{' '}</button>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="search-empty-state glass">
              <Search size={32} opacity={0.4} color="#a855f7" />
              <h3>{t('cards.search_empty_title', 'Карточки не найдены')}</h3>
              <p>{t('cards.search_empty_desc', 'По вашему запросу ничего не найдено')}</p>
              <button 
                type="button" 
                className="btn btn-secondary" 
                style={{ padding: '8px 16px', fontSize: '0.85rem', marginTop: '4px' }}
                onClick={() => setSearchQuery('')}
              >
                {t('cards.search_clear', 'Сбросить поиск')}
              </button>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={customCollisionDetection}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={renderedCards.map(c => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="card-list">
                  {renderedCards.map((c, idx) => (
                    <DraggableCardItem 
                      key={c.id} 
                      c={c} 
                      index={searchQuery.trim() ? getOriginalIndex(c.id) : idx}
                      currentDeck={currentDeck} 
                      startStudyCard={startStudyCard}
                      frontTypographyStyle={frontTypographyStyle}
                      backTypographyStyle={backTypographyStyle}
                      cardListBg={cardListBg}
                      previewCardLines={publishedDesignV2?.config?.cardList?.frontText?.lines ?? previewCardLines}
                      isSelectMode={isSelectMode}
                      isSelected={selectedCardIds.has(c.id)}
                      onToggleSelect={handleToggleSelectCard}
                    />
                  ))}
                  {visibleCount < filteredCards.length && !searchQuery.trim() && (
                    <div style={{ textAlign: 'center', padding: '12px 0', opacity: 0.6, fontSize: '0.8rem', color: '#c084fc', userSelect: 'none' }}>{tr("Показано")}{' '}{renderedCards.length}{' '}{tr("из")}{' '}{filteredCards.length}{' '}{tr("(прокрутите вниз для загрузки)")}{' '}</div>
                  )}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
                {activeCard ? (
                  <div 
                    className={`card-item card-front glass ${cardListBg?.className || ''} is-drag-overlay`} 
                    style={{ 
                      opacity: 0.95, 
                      cursor: 'grabbing', 
                      boxShadow: '0 20px 40px rgba(0,0,0,0.6), 0 0 25px rgba(56,189,248,0.35)',
                      transform: 'scale(1.02)',
                      pointerEvents: 'none',
                      ...cardListBg?.style
                    }}
                  >
                    <div className="front-min" style={{ ...frontTypographyStyle }}>
                      {activeCard.front}
                    </div>
                    {activeCard.back && (
                      <div className="back-min" style={{ ...backTypographyStyle, marginTop: '4px' }}>
                        {activeCard.back}
                      </div>
                    )}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
        
        {!isSelectMode && (
          <button id="tut-fab-add" className="fab-add-card" onClick={() => openCreator(currentDeck?.id)}>
            <Plus size={28} />
          </button>
        )}

        {/* Floating Batch Actions Dock */}
        <AnimatePresence>
          {isSelectMode && (
            <motion.div
              className="batch-actions-bar"
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {/* Row 1: Range input */}
              <form className="batch-range-row" onSubmit={handleApplyRange}>
                <div className="batch-range-input-wrapper">
                  <input
                    type="text"
                    className="batch-range-input"
                    placeholder={tr("№ карт: 1-10, 15...")}
                    value={rangeInput}
                    onChange={(e) => setRangeInput(e.target.value)}
                  />
                  {rangeInput && (
                    <button
                      type="button"
                      className="batch-range-clear-btn"
                      onClick={() => setRangeInput('')}
                      title={tr("Очистить")}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="batch-range-apply-btn"
                  disabled={!rangeInput.trim()}
                >
                  {tr("Выбрать")}
                </button>
                <button
                  type="button"
                  className="batch-range-all-btn"
                  onClick={handleSelectAll}
                  title={selectedCardIds.size === filteredCards.length && filteredCards.length > 0 ? tr("Снять выбор со всех") : tr("Выбрать все карточки")}
                >
                  {selectedCardIds.size === filteredCards.length && filteredCards.length > 0 ? tr("Снять все") : tr("Все ({{p0}})", { p0: filteredCards.length })}
                </button>
              </form>

              {/* Row 2: Action buttons */}
              <div className="batch-buttons-row">
                <button
                  type="button"
                  className="batch-action-btn copy-btn"
                  disabled={selectedCardIds.size === 0}
                  onClick={() => {
                    setBatchModalMode('copy');
                    setIsBatchMoveModalOpen(true);
                  }}
                  title={tr("Копировать выбранные карточки")}
                >
                  <Copy size={15} />
                  <span className="batch-btn-label">{tr("Копировать")}</span>
                  <span className="batch-btn-count">({selectedCardIds.size})</span>
                </button>

                <button
                  type="button"
                  className="batch-action-btn move-btn"
                  disabled={selectedCardIds.size === 0}
                  onClick={() => {
                    setBatchModalMode('move');
                    setIsBatchMoveModalOpen(true);
                  }}
                  title={tr("Переместить выбранные карточки")}
                >
                  <Move size={15} />
                  <span className="batch-btn-label">{tr("Переместить")}</span>
                  <span className="batch-btn-count">({selectedCardIds.size})</span>
                </button>

                <button
                  type="button"
                  className="batch-action-btn delete-btn"
                  disabled={selectedCardIds.size === 0}
                  onClick={async () => {
                    const ids = Array.from(selectedCardIds);
                    const ok = await handleBatchDeleteCards(ids);
                    if (ok) {
                      setSelectedCardIds(new Set());
                      setIsSelectMode(false);
                    }
                  }}
                  title={tr("Удалить выбранные карточки")}
                >
                  <Trash2 size={15} />
                  <span className="batch-btn-label">{tr("Удалить")}</span>
                  <span className="batch-btn-count">({selectedCardIds.size})</span>
                </button>

                <button
                  type="button"
                  className="batch-action-cancel-btn"
                  onClick={toggleSelectMode}
                  title={tr("Отмена")}
                >
                  <X size={18} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <BatchMoveModal
          isOpen={isBatchMoveModalOpen}
          onClose={() => setIsBatchMoveModalOpen(false)}
          mode={batchModalMode}
          selectedCount={selectedCardIds.size}
          currentDeckId={currentDeck?.id}
          decks={decks || []}
          folders={folders || []}
          onConfirm={async (targetDeckId, duplicateAction) => {
            const orderedIds = (filteredCards || [])
              .filter(c => selectedCardIds.has(c.id))
              .map(c => c.id);
            const fallbackIds = Array.from(selectedCardIds);
            const ids = orderedIds.length > 0 ? orderedIds : fallbackIds;
            const ok = batchModalMode === 'copy'
              ? await handleBatchCopyCards(ids, targetDeckId, duplicateAction)
              : await handleBatchMoveCards(ids, targetDeckId, duplicateAction);
            if (ok) {
              setSelectedCardIds(new Set());
              setIsSelectMode(false);
              return true;
            }
            return false;
          }}
        />

        <DeckMediaModal 
          isOpen={isMediaModalOpen} 
          onClose={() => setIsMediaModalOpen(false)} 
        />

        <ImageEditorModal
          isOpen={!!editingDeckImgSrc}
          onClose={() => {
            setEditingDeckImgSrc(null);
            setEditingDeckImgIndex(-1);
          }}
          imageSrc={editingDeckImgSrc}
          onSave={async (editedFile) => {
            setEditingDeckImgSrc(null);
            if (editedFile && currentDeck?.id) {
              await uploadDeckResource(editedFile, 'image', currentDeck.id, editingDeckImgIndex);
            }
          }}
          title={tr("Настройка фото списка")}
        />
      </motion.div>
    </div>
  );
};
