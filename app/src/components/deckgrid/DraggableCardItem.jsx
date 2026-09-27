import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { CardActionButton } from '../modals/CardActionModal';
import { CardLevelBadge } from '../common/CardLevelBadge';
import { CardTypeBadge } from '../common/CardTypeBadge';
import { useUiStore } from '../../store/useUiStore';
import { getFlagStyle } from '../../constants/cardFlags';
import { detectExerciseType } from '../../utils/exerciseDetector';
import { stripMarkdown } from '../../utils/text';
import { cleanBracketSyntax } from '../../utils/clozeParser';

export const DraggableCardItem = React.memo(({
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
          <CardTypeBadge type={detectedExerciseType} />
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
