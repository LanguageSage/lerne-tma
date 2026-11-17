import React, { useLayoutEffect, useRef, useState } from 'react';
import { closestCenter, DndContext, pointerWithin, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, Circle, Ellipsis, Eye, EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { addLayoutInfo, enableLayout, moveLayout, removeLayout, patchInfoBlock, patchLayoutItem } from '../../utils/cardLayout';
import { studyLayout, studyQuiz } from '../../utils/structuredStudyCard';
import { ExerciseRenderer } from '../study/ExerciseRenderer';
import { StructuredCardLayout } from '../study/StructuredCardLayout';
import { QuizContent } from '../study/StudyCardQuiz';
import '../study/StudyCard.css';
import './QuizCardFields.css';

const roles = { task: 'Задание', source: 'Подсказка', example: 'Пример', text: 'Текст' };

function detectBlock(args) {
  const hits = pointerWithin(args);
  return hits.length ? hits : closestCenter(args);
}

function InlineText({ value = '', display, label, onChange, id, block = false }) {
  const Element = block ? 'div' : 'span';
  return <Element className="quiz-inline-field" data-value={value}>
    <Element className="quiz-inline-display" inert>{value ? display : <span className="quiz-inline-placeholder">{label}</span>}</Element>
    <textarea id={id} rows={1} value={value} aria-label={label} placeholder={label}
      onChange={event => onChange(event.target.value)} />
  </Element>;
}

function SortableBlock({ item, block, position, update, insert, onMove, children }) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: { draggable: item.type === 'image' } });
  return <div ref={setNodeRef} className="quiz-layout-block" data-layout-position={position} data-dragging={isDragging || undefined}
    style={{ transform: CSS.Translate.toString(transform), transition }}>
    <div className="quiz-block-tools">
      {item.type !== 'image' && <button ref={setActivatorNodeRef} type="button" className="quiz-icon-control quiz-drag-handle"
        {...listeners} {...attributes} title={`${tr('Переместить блок')} ↑ ↓`} aria-label={tr('Переместить блок')}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          onMove(item.id, position, event.key === 'ArrowUp' ? -1 : 1);
        }}>
        <GripVertical size={16} aria-hidden="true" />
      </button>}
      {insert}
      {block && <>
        {block.type !== 'options' && <select value={block.type} aria-label={tr('Роль блока')} onChange={event => {
          const type = event.target.value;
          update(card => patchInfoBlock(card, item.index, { type }));
        }}>
          {Object.entries(roles).map(([type, label]) => <option key={type} value={type}>{tr(label)}</option>)}
        </select>}
        <details className="quiz-block-menu">
          <summary className="quiz-icon-control" aria-label={tr('Настройки блока')} title={tr('Настройки блока')}>
            <Ellipsis size={16} aria-hidden="true" />
            {item.visibility === 'after_answer' && <span className="quiz-visibility-dot" />}
          </summary>
          <div className="quiz-block-menu-actions">
            <select aria-label={tr('Когда показывать')} value={item.visibility || 'before_answer'}
              onChange={event => {
                const visibility = event.target.value;
                update(card => patchLayoutItem(card, item.id, { visibility }));
              }}>
              <option value="before_answer">{tr('До ответа')}</option>
              <option value="after_answer">{tr('После ответа')}</option>
            </select>
            <button type="button" className="quiz-icon-control" aria-label={tr('Удалить блок')} title={tr('Удалить блок')}
              onClick={() => {
                if (window.confirm(tr('Удалить этот блок?'))) update(card => removeLayout(enableLayout(card), item.id));
              }}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        </details>
      </>}
    </div>
    {children}
  </div>;
}

export function QuizCardFields({ cardData, update, designConfig, dictation }) {
  const card = cardData.content_v2.card;
  const [preview, setPreview] = useState(false);
  const [afterAnswer, setAfterAnswer] = useState(false);
  const previewLabel = tr(preview ? 'Скрыть предпросмотр' : 'Показать предпросмотр');
  const layout = studyLayout(card, { afterAnswer: true });
  const quiz = studyQuiz(card.data);
  const fields = useRef(null);
  const nextFocus = useRef(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useLayoutEffect(() => {
    if (nextFocus.current) {
      fields.current?.querySelector(nextFocus.current)?.focus();
      nextFocus.current = null;
    }
  }, [card]);

  const updateOptions = change => update(current => ({
    ...current, data: { ...current.data, options: change(current.data.options) },
  }));
  const editOption = (index, patch) => updateOptions(options =>
    options.map((option, i) => i === index ? { ...option, ...patch } : option));
  const addBlock = position => {
    nextFocus.current = `[data-layout-position="${position}"] textarea`;
    update(current => addLayoutInfo(current, position));
  };
  const insertControl = position => <button type="button" className="quiz-layout-insert quiz-icon-control"
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
    nextFocus.current = `[data-layout-position="${target}"] .quiz-drag-handle`;
    update(current => moveLayout(enableLayout(current), id, offset));
  };

  return <div className="quiz-card-fields">
    <div className="quiz-editor-toolbar">
      <button type="button" className="quiz-icon-control" aria-pressed={preview} aria-label={previewLabel}
        title={previewLabel} onClick={() => setPreview(value => !value)}>
        {preview ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
      {dictation && <div hidden={preview}>{dictation}</div>}
      {preview && card.layout?.some(item => item.visibility === 'after_answer') && <label>
        <input type="checkbox" checked={afterAnswer} onChange={event => setAfterAnswer(event.target.checked)} />
        {tr('Предпросмотр после ответа')}
      </label>}
    </div>
    {preview ? <fieldset className="quiz-card-preview" disabled>
      <ExerciseRenderer card={cardData} designConfig={designConfig} previewAfterAnswer={afterAnswer} />
    </fieldset> : <div ref={fields} className="quiz-editor-layout">
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
            exercise={<QuizContent options={quiz.options} designConfig={designConfig}
              question={<InlineText id="card-editor-front" value={quiz.question} display={quiz.question} label={tr('Вопрос')}
                onChange={prompt => update(current => ({ ...current, data: { ...current.data, prompt } }))} />}
              renderOptionText={(option, display) => <InlineText id={`quiz-editor-option-${option.id}`} value={option.text}
                display={display} label={`${tr('Вариант ответа')} ${option.id + 1}`}
                onChange={optionText => editOption(option.id, { text: optionText })} />}
              renderOptionActions={option => <span className="quiz-option-tools">
                <button type="button" className="quiz-icon-control" aria-pressed={Boolean(option.isCorrect)}
                  aria-label={`${tr('Верный ответ')} ${option.id + 1}`} title={tr('Верный ответ')}
                  onClick={() => editOption(option.id, { correct: !option.isCorrect })}>
                  {option.isCorrect ? <Check size={16} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
                </button>
                <button type="button" className="quiz-icon-control" aria-label={`${tr('Удалить')} ${tr('Вариант ответа').toLowerCase()} ${option.id + 1}`}
                  title={tr('Удалить')} onClick={() => updateOptions(options => options.filter((_, i) => i !== option.id))}>
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </span>}
              footer={<button type="button" className="quiz-icon-control quiz-add-option"
                aria-label={tr('Добавить вариант')} title={tr('Добавить вариант')} onClick={() => {
                  nextFocus.current = `#quiz-editor-option-${quiz.options.length}`;
                  updateOptions(options => [...options, { text: '', correct: false }]);
                }}><Plus size={16} aria-hidden="true" /></button>}
            />}
          />
        </SortableContext>
      </DndContext>
      {insertControl(layout.length)}
    </div>}
  </div>;
}
