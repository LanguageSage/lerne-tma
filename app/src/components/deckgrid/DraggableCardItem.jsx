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
import { studyContent, studySideText } from '../../utils/structuredStudyCard.js';
import { detectCardType } from '../../utils/exerciseDetector';
import { stripMarkdown } from '../../utils/text';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { cleanBracketSyntax } from '../../utils/clozeParser';
import { offlineEditLabel, offlineMoveLabel } from '../../services/offlineUi';

export const DraggableCardItem = React.memo(({
  c,
  index,
  currentDeck,
  canEditContent = true,
  startStudyCard,
  openEditor,
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
  const createStatus = c.offline_create_status;
  const canDrag = canEditContent && !createStatus && !c.offline_move;
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
    disabled: isSelectMode || !canDrag,
    animateLayoutChanges: () => false,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : (transition || undefined),
    opacity: isDragging ? 0.25 : 1,
    zIndex: isDragging ? 999 : undefined,
    ...flagStyle
  };

  const structured = studyContent(c);
  const detectedExerciseType = structured?.type ?? detectCardType(c);
  const prompt = structured ? studySideText(structured) : (c.front || '');
  const answer = structured ? studySideText(structured, 'back') : (c.back || '');

  const linesLimit = previewCardLines === 0 ? 0 : (previewCardLines || 2);
  const isFrontLong = linesLimit > 0 && (prompt.length > (linesLimit * 45) || prompt.split('\n').length > linesLimit);
  const isBackLong = linesLimit > 0 && (answer.length > (linesLimit * 45) || answer.split('\n').length > linesLimit);
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
    if (createStatus) return;
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
      onClick={isSelectMode && !createStatus ? () => onToggleSelect?.(c.id) : undefined}
    >
      {isSelectMode && !createStatus && (
        <div className="card-select-checkbox">
          {isSelected && <Check size={16} strokeWidth={3} />}
        </div>
      )}
      <div
        className="card-item-text"
        onClick={handleItemClick}
        style={{ cursor: createStatus ? 'default' : 'pointer', position: 'relative' }}
      >
        <div
          className={`front-min ${isExpanded ? 'expanded' : ''}`}
          style={{ ...frontTypographyStyle, ...clampStyle }}
        >
          {stripMarkdown(structured ? prompt : cleanBracketSyntax(prompt))}
        </div>

        {answer && (
          <div
            className={`back-min ${isExpanded ? 'expanded' : ''}`}
            style={{ ...backTypographyStyle, ...clampStyle }}
          >
            <MarkdownRenderer>{answer}</MarkdownRenderer>
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

      {createStatus && <small role="status" style={{ overflowWrap: 'anywhere' }}>{tr(createStatus === 'error'
        ? 'Ошибка синхронизации. Карточка сохранена на устройстве.' : 'Ожидает синхронизации')}
        {c.offline_create_error && <> {c.offline_create_error}</>}
      </small>}
      {c.offline_move && <small role="status">{offlineMoveLabel(c.offline_move)}</small>}
      {c.offline_edit && (
        <div className="card-edit-status">
          <small role="status">{offlineEditLabel(c.offline_edit)}</small>
          {!isSelectMode && (
            <button type="button" className="btn btn-secondary" onClick={() => openEditor(c.deck_id, c)}>
              {tr('Открыть локальную правку')}
            </button>
          )}
        </div>
      )}
      <div className="card-item-footer">
        <div className="card-item-footer-left">
          {!isSelectMode && canDrag && (
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

          {!isSelectMode && !createStatus && (
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
