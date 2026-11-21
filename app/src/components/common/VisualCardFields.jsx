import React, { useLayoutEffect, useRef } from 'react';
import { closestCenter, DndContext, pointerWithin, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ellipsis, GripVertical, Plus, Trash2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { addLayoutInfo, enableLayout, moveLayout, removeLayout, patchInfoBlock, patchLayoutItem } from '../../utils/cardLayout';
import { studyLayout } from '../../utils/structuredStudyCard';
import { StructuredCardLayout } from '../study/StructuredCardLayout';
import '../study/StudyCard.css';
import './VisualCardFields.css';

const roles = { task: 'Задание', source: 'Подсказка', example: 'Пример', text: 'Текст' };

function detectBlock(args) {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
}

export function SortableCardList({ items, onMove, instructions = tr('Стрелки вверх и вниз перемещают блок.'), children }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  return <DndContext sensors={sensors} collisionDetection={detectBlock}
    accessibility={{ screenReaderInstructions: { draggable: instructions } }}
    onDragEnd={({ active, over }) => { if (over && active.id !== over.id) onMove(active.id, over.id); }}>
    <SortableContext items={items} strategy={verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>;
}

export function InlineText({ value = '', display = value, label, onChange, id, block = false }) {
  const Element = block ? 'div' : 'span';
  return <Element className="visual-card-inline-field" data-value={value}>
    <Element className="visual-card-inline-display" inert>{value ? display : <span className="visual-card-inline-placeholder">{label}</span>}</Element>
    <textarea id={id} rows={1} cols={1} value={value} aria-label={label} placeholder={label}
      onChange={event => onChange(event.target.value)} />
  </Element>;
}

export function SortableCardItem({ id, label = tr('Переместить блок'), onMoveBy, children, ...props }) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } =
    useSortable({ id });
  return <div {...props} ref={setNodeRef} data-dragging={isDragging || undefined}
    style={{ transform: CSS.Translate.toString(transform), transition }}>
    <button ref={setActivatorNodeRef} type="button" className="visual-card-icon-control visual-card-drag-handle"
      {...listeners} {...attributes} title={`${label} ↑ ↓`} aria-label={label}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onMoveBy(event.key === 'ArrowUp' ? -1 : 1);
      }}>
      <GripVertical size={16} aria-hidden="true" />
    </button>
    {children}
  </div>;
}

function SortableBlock({ item, block, position, update, onMove, children }) {
  return <SortableCardItem id={item.id} className="visual-card-layout-block" data-layout-position={position}
    onMoveBy={offset => onMove(item.id, position, offset)}>
    {children}
    {item.type !== 'exercise' && <div className="visual-card-block-tools">
      {block && block.type !== 'options' && <select value={block.type} aria-label={tr('Роль блока')} onChange={event => {
        const type = event.target.value;
        update(card => patchInfoBlock(card, item.index, { type }));
      }}>
        {Object.entries(roles).map(([type, label]) => <option key={type} value={type}>{tr(label)}</option>)}
      </select>}
      <details className="visual-card-block-menu">
        <summary className="visual-card-icon-control" aria-label={tr('Настройки блока')} title={tr('Настройки блока')}>
          <Ellipsis size={16} aria-hidden="true" />
          {item.visibility === 'after_answer' && <span className="visual-card-visibility-dot" />}
        </summary>
        <div className="visual-card-block-menu-actions">
          <select aria-label={tr('Когда показывать')} value={item.visibility || 'before_answer'}
            onChange={event => {
              const visibility = event.target.value;
              update(card => patchLayoutItem(card, item.id, { visibility }));
            }}>
            <option value="before_answer">{tr('До ответа')}</option>
            <option value="after_answer">{tr('После ответа')}</option>
          </select>
          <button type="button" className="visual-card-icon-control" aria-label={tr('Удалить блок')} title={tr('Удалить блок')}
            onClick={() => {
              if (window.confirm(tr('Удалить этот блок?'))) update(card => removeLayout(enableLayout(card), item.id));
            }}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      </details>
    </div>}
  </SortableCardItem>;
}

export function VisualCardFields({ cardData, update, exercise, dictation, footer, resolveMediaUrl }) {
  const card = cardData.content_v2.card;
  const layout = studyLayout(card, { afterAnswer: true });
  const fields = useRef(null);
  const nextFocus = useRef(null);

  useLayoutEffect(() => {
    if (nextFocus.current) {
      fields.current?.querySelector(nextFocus.current)?.focus();
      nextFocus.current = null;
    }
  }, [card]);

  const addBlock = position => {
    nextFocus.current = `[data-layout-position="${position}"] textarea`;
    update(current => addLayoutInfo(current, position));
  };
  const insertControl = position => <button type="button" className="visual-card-layout-insert visual-card-icon-control"
    aria-label={tr('Добавить текстовый блок')} title={tr('Добавить текстовый блок')} onClick={() => addBlock(position)}>
    <Plus size={15} aria-hidden="true" />
  </button>;
  const move = (id, targetId) => {
    update(current => {
      const ordered = enableLayout(current);
      const from = ordered.layout.findIndex(item => item.id === id);
      const to = ordered.layout.findIndex(item => item.id === targetId);
      return from < 0 || to < 0 ? current : moveLayout(ordered, id, to - from);
    });
  };
  const moveWithKeys = (id, position, offset) => {
    const target = position + offset;
    if (target < 0 || target >= layout.length) return;
    nextFocus.current = `[data-layout-position="${target}"] .visual-card-drag-handle`;
    update(current => moveLayout(enableLayout(current), id, offset));
  };

  return <div ref={fields} className="visual-card-editor-layout">
    {dictation && <div className="visual-card-editor-dictation">{dictation}</div>}
    <SortableCardList items={layout.map(item => item.id)} onMove={move}>
        <StructuredCardLayout card={cardData} afterAnswer resolveMediaUrl={resolveMediaUrl}
          renderItem={(item, element, position) => <>
            {insertControl(position)}
            <SortableBlock item={item} position={position} block={item.type === 'info' ? card.info[item.index] : null}
              update={update} onMove={moveWithKeys}>
              {element}
            </SortableBlock>
          </>}
          renderInfoText={(item, value, display) => <InlineText value={value} display={display} block label={tr('Текст')}
            onChange={text => update(current => patchInfoBlock(current, item.index, { text }))} />}
          exercise={exercise}
        />
    </SortableCardList>
    {insertControl(layout.length)}
    {footer}
  </div>;
}
