import React, { useLayoutEffect, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { ArrowLeftRight, Link2, Plus, Trash2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { MatchTile } from '../study/StudyCardMatch';
import { InlineText, SortableCardItem, SortableCardList, VisualCardFields } from './VisualCardFields';
import './MatchCardFields.css';

export function MatchCardFields({ cardData, update, textStyles, lockLayout = false, resolveMediaUrl }) {
  const { pairs } = cardData.content_v2.card.data;
  const rows = useRef(null);
  const nextFocus = useRef(null);
  useLayoutEffect(() => {
    if (nextFocus.current) {
      rows.current?.querySelector(nextFocus.current)?.focus();
      nextFocus.current = null;
    }
  }, [pairs]);

  const updatePairs = change => update(card => ({
    ...card, data: { ...card.data, pairs: change(card.data.pairs) },
  }));
  const movePair = (from, to) => {
    if (!pairs[from] || !pairs[to]) return;
    nextFocus.current = `[data-pair-position="${to}"] .visual-card-drag-handle`;
    updatePairs(current => arrayMove(current, from, to));
  };
  const addPair = () => {
    nextFocus.current = `[data-pair-position="${pairs.length}"] textarea`;
    updatePairs(current => [...current, { left: '', right: '' }]);
  };
  const removePair = index => {
    if (!window.confirm(tr('Удалить эту пару?'))) return;
    nextFocus.current = `[data-pair-position="${Math.min(index, pairs.length - 2)}"] .visual-card-drag-handle`;
    updatePairs(current => current.length > 2 ? current.filter((_, position) => position !== index) : current);
  };
  const renderTile = (pair, index, side) => <MatchTile side={side} state="correct"
    textStyle={side === 'left' ? textStyles.frontText : textStyles.matchRightText}>
    <InlineText value={pair[side]} label={tr(side === 'left' ? 'Слева' : 'Справа') + ` ${index + 1}`}
      onChange={text => updatePairs(current => current.map((entry, position) =>
        position === index ? { ...entry, [side]: text } : entry))} />
  </MatchTile>;

  return <VisualCardFields cardData={cardData} update={update} lockLayout={lockLayout} resolveMediaUrl={resolveMediaUrl} exercise={
    <div className="match-editor" ref={rows}>
      <div className="match-heading"><Link2 size={16} aria-hidden="true" />{tr('Сопоставьте пары:')}</div>
      <SortableCardList items={pairs.map((_, index) => index)} onMove={movePair}
        instructions={tr('Стрелки вверх и вниз перемещают пару.')}>
        {pairs.map((pair, index) => <SortableCardItem key={index} id={index} className="match-editor-pair"
          data-pair-position={index} label={`${tr('Переместить пару')} ${index + 1}`}
          onMoveBy={offset => movePair(index, index + offset)}>
          {renderTile(pair, index, 'left')}
          <ArrowLeftRight className="match-editor-connector" size={16} aria-hidden="true" />
          {renderTile(pair, index, 'right')}
          <button type="button" className="visual-card-icon-control match-editor-remove" disabled={pairs.length <= 2}
            aria-label={`${tr('Удалить пару')} ${index + 1}`}
            title={tr(pairs.length <= 2 ? 'Нужно не меньше двух пар' : 'Удалить пару')} onClick={() => removePair(index)}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </SortableCardItem>)}
      </SortableCardList>
      <button type="button" className="btn-secondary match-editor-add" onClick={addPair}>
        <Plus size={16} aria-hidden="true" />{tr('Добавить пару')}
      </button>
    </div>
  } />;
}
