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

export function InlineText({ value = '', display = value, label, onChange, id, block = false }) {
  const Element = block ? 'div' : 'span';
  return <Element className="visual-card-inline-field" data-value={value}>
    <Element className="visual-card-inline-display" inert>{value ? display : <span className="visual-card-inline-placeholder">{label}</span>}</Element>
    <textarea id={id} rows={1} cols={1} value={value} aria-label={label} placeholder={label}
      onChange={event => onChange(event.target.value)} />
  </Element>;
}

function SortableBlock({ item, block, position, update, insert, onMove, children }) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: { draggable: item.type === 'image' } });
  return <div ref={setNodeRef} className="visual-card-layout-block" data-layout-position={position} data-dragging={isDragging || undefined}
    style={{ transform: CSS.Translate.toString(transform), transition }}>
    {insert}
    {item.type !== 'image' && <button ref={setActivatorNodeRef} type="button" className="visual-card-icon-control visual-card-drag-handle"
      {...listeners} {...attributes} title={`${tr('Переместить блок')} ↑ ↓`} aria-label={tr('Переместить блок')}
      onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onMove(item.id, position, event.key === 'ArrowUp' ? -1 : 1);
      }}>
      <GripVertical size={16} aria-hidden="true" />
    </button>}
    {children}
    {block && <div className="visual-card-block-tools">
      {block.type !== 'options' && <select value={block.type} aria-label={tr('Роль блока')} onChange={event => {
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
  </div>;
}

export function VisualCardFields({ cardData, update, exercise, dictation }) {
  const card = cardData.content_v2.card;
  const layout = studyLayout(card, { afterAnswer: true });
  const fields = useRef(null);
  const nextFocus = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
  const move = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    update(current => {
      const ordered = enableLayout(current);
      const from = ordered.layout.findIndex(item => item.id === active.id);
      const to = ordered.layout.findIndex(item => item.id === over.id);
      return from < 0 || to < 0 ? current : moveLayout(ordered, active.id, to - from);
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
    <DndContext sensors={sensors} collisionDetection={detectBlock} onDragEnd={move}
      accessibility={{ screenReaderInstructions: { draggable: tr('Стрелки вверх и вниз перемещают блок.') } }}>
      <SortableContext items={layout.map(item => item.id)} strategy={verticalListSortingStrategy}>
        <StructuredCardLayout card={cardData} afterAnswer
          renderItem={(item, element, position) =>
            <SortableBlock item={item} position={position} block={item.type === 'info' ? card.info[item.index] : null}
              update={update} insert={insertControl(position)} onMove={moveWithKeys}>
              {element}
            </SortableBlock>}
          renderInfoText={(item, value, display) => <InlineText value={value} display={display} block label={tr('Текст')}
            onChange={text => update(current => patchInfoBlock(current, item.index, { text }))} />}
          exercise={exercise}
        />
      </SortableContext>
    </DndContext>
    {insertControl(layout.length)}
  </div>;
}
