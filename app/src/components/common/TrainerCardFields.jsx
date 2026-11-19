import React, { useLayoutEffect, useRef, useState } from 'react';
import { Check, Plus, Puzzle, Trash2, X } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { InlineText, VisualCardFields } from './VisualCardFields';
import '../study/StudyCardTrainer.css';
import './TrainerCardFields.css';

const partTypes = {
  text: ['Текст', { type: 'text', text: '' }],
  input: ['Пропуск с вводом', { type: 'input', answers: [''] }],
  choice: ['Пропуск с выбором', { type: 'choice', options: [{ text: '', correct: true }, { text: '', correct: false }] }],
  auto: ['Пропуск с автоматическими вариантами', { type: 'choice', distractors: 'auto', options: [{ text: '', correct: true }] }],
};

export function TrainerCardFields({ cardData, update, textStyles }) {
  const { parts } = cardData.content_v2.card.data;
  const editor = useRef(null);
  const addPartButton = useRef(null);
  const nextFocus = useRef(null);
  const [selection, setSelection] = useState(null);
  const [partMenuOpen, setPartMenuOpen] = useState(false);
  const [insertBefore, setInsertBefore] = useState(false);
  const [warning, setWarning] = useState('');
  const selected = parts[selection?.part];

  useLayoutEffect(() => {
    if (!nextFocus.current) return;
    editor.current?.querySelector(nextFocus.current)?.focus();
    nextFocus.current = null;
  }, [parts]);

  const focusField = (index, option = 0) => {
    nextFocus.current = `[data-trainer-part="${index}"][data-trainer-option="${option}"] textarea`;
  };
  const updateParts = change => update(card => ({
    ...card, data: { ...card.data, parts: change(card.data.parts) },
  }));
  const updatePart = (index, change) => updateParts(items =>
    items.map((part, position) => position === index ? change(part) : part));
  const select = (part, option) => {
    setSelection({ part, option });
    setWarning('');
  };
  const addPart = type => {
    const index = selected ? selection.part + Number(!insertBefore) : parts.length;
    const part = structuredClone(partTypes[type][1]);
    focusField(index);
    select(index, 0);
    setPartMenuOpen(false);
    updateParts(items => [...items.slice(0, index), part, ...items.slice(index)]);
  };
  const canRemovePart = selected && (selected.type === 'text'
    || parts.some((part, index) => index !== selection.part && part.type !== 'text'));
  const removePart = () => {
    if (!canRemovePart || !window.confirm(tr('Удалить эту часть?'))) return;
    updateParts(items => items.filter((_, index) => index !== selection.part));
    setSelection(null);
    setWarning('');
    addPartButton.current?.focus();
  };

  const renderGap = (part, index, gap) => {
    const choice = part.type === 'choice';
    const auto = part.distractors === 'auto';
    const entries = choice ? part.options : part.answers;
    const key = choice ? 'options' : 'answers';
    const gapLabel = tr('Пропуск {{p0}}', { p0: gap });
    const editEntries = change => updatePart(index, current => ({ ...current, [key]: change(current[key]) }));
    const addEntry = () => {
      if (auto && !window.confirm(tr('Заменить автоварианты своими?'))) return;
      focusField(index, entries.length);
      select(index, entries.length);
      updatePart(index, current => ({
        ...current, ...(auto ? { distractors: null } : {}),
        [key]: [...current[key], choice ? { text: '', correct: false } : ''],
      }));
    };
    const editCorrect = (position, correct) => {
      if (!correct && !entries.some((entry, i) => i !== position && entry.correct)) {
        setWarning(tr('Нужен хотя бы один правильный вариант.'));
        return;
      }
      setWarning('');
      editEntries(items => items.map((entry, i) => i === position ? { ...entry, correct } : entry));
    };
    const removeEntry = position => {
      if (choice && !entries.some((entry, i) => i !== position && entry.correct)) {
        setWarning(tr('Нужен хотя бы один правильный вариант.'));
        return;
      }
      if (choice && entries.length <= 2) {
        setWarning(tr('Для пропуска с выбором нужны хотя бы два варианта.'));
        return;
      }
      focusField(index, Math.min(position, entries.length - 2));
      setWarning('');
      editEntries(items => items.filter((_, i) => i !== position));
    };
    return <span key={index} className={`trainer-editor-gap${choice ? ' trainer-editor-choice' : ''}`} role="group" aria-label={gapLabel}>
      {entries.map((entry, position) => {
        const label = `${gap}.${position + 1}`;
        const correct = !choice || Boolean(entry.correct);
        const active = selection?.part === index && selection.option === position;
        const selectEntry = () => {
          if (!active) select(index, position);
        };
        return <span key={position} className="trainer-editor-option" data-trainer-part={index}
          data-trainer-option={position} onFocusCapture={selectEntry} onClick={selectEntry}>
          <span className={`trainer-gap trainer-choice-gap is-${correct ? 'correct' : 'wrong'}`}>
            <InlineText value={choice ? entry.text : entry} label={`${tr('Вариант ответа')} ${label}`}
              onChange={value => editEntries(items => items.map((item, i) =>
                i === position ? (choice ? { ...item, text: value } : value) : item))} />
          </span>
          {active && choice && <span className="trainer-editor-option-tools">
            <button type="button" className="visual-card-icon-control trainer-mark-correct" aria-pressed={correct}
              aria-label={`${tr('Отметить как правильный')} ${label}`} onClick={() => editCorrect(position, true)}>
              <Check size={16} aria-hidden="true" />
            </button>
            <button type="button" className="visual-card-icon-control trainer-mark-wrong" aria-pressed={!correct}
              aria-label={`${tr('Отметить как неправильный')} ${label}`} onClick={() => editCorrect(position, false)}>
              <X size={16} aria-hidden="true" />
            </button>
          </span>}
        </span>;
      })}
      <span className="trainer-editor-gap-actions">
        <button type="button" className="visual-card-icon-control trainer-editor-add-option"
          aria-label={`${tr('Добавить вариант')} · ${gapLabel}`} title={tr('Добавить вариант')} onClick={addEntry}>
          <Plus size={16} aria-hidden="true" />
        </button>
        {selection?.part === index && entries.length > 1 && <button type="button" className="visual-card-icon-control"
          aria-label={`${tr('Удалить вариант')} ${gap}.${selection.option + 1}`} title={tr('Удалить вариант')}
          onClick={() => removeEntry(selection.option)}>
          <Trash2 size={15} aria-hidden="true" />
        </button>}
      </span>
      {auto && <span className="trainer-editor-auto-label">{tr('Автоматические варианты')}</span>}
      {choice && !auto && entries.length === 1 && entries[0].correct &&
        <button type="button" className="btn-secondary trainer-editor-auto"
          onClick={() => updatePart(index, current => ({ ...current, distractors: 'auto' }))}>
          {tr('Автоматические варианты')}
        </button>}
    </span>;
  };

  let gap = 0;
  return <VisualCardFields cardData={cardData} update={update}
    exercise={<div ref={editor} className="trainer-editor trainer-exercise">
      <div className="trainer-editor-heading"><Puzzle size={18} aria-hidden="true" />{tr('Заполните пропуски:')}</div>
      <div className="trainer-editor-sentence" style={textStyles.frontText}>
        {parts.map((part, index) => part.type === 'text'
          ? <span key={index} className="trainer-editor-text" data-trainer-part={index} data-trainer-option="0"
            onFocusCapture={() => select(index, 0)} onClick={event => event.currentTarget.querySelector('textarea').focus()}>
            <InlineText value={part.text} label={`${tr('Текст')} ${index + 1}`}
              onChange={text => updatePart(index, current => ({ ...current, text }))} />
          </span>
          : renderGap(part, index, ++gap))}
      </div>
      {warning && <p className="trainer-editor-warning" role="alert">{warning}</p>}
      {parts.some(part => part.type === 'choice' && part.distractors !== 'auto')
        && <p className="trainer-editor-help">{tr('Можно отметить несколько правильных вариантов.')}</p>}
      <div className="trainer-editor-part-tools">
        <button ref={addPartButton} type="button" className="btn-secondary trainer-editor-parts-toggle"
          aria-expanded={partMenuOpen} onClick={() => setPartMenuOpen(open => !open)}>
          <Plus size={16} aria-hidden="true" />{tr('Добавить часть')}
        </button>
        {selected && <button type="button" className="visual-card-icon-control" disabled={!canRemovePart}
          aria-label={tr('Удалить выбранную часть')} title={tr('Удалить выбранную часть')} onClick={removePart}>
          <Trash2 size={16} aria-hidden="true" />
        </button>}
      </div>
      {partMenuOpen && <div className="trainer-editor-part-menu">
        {selected && <label>
          <input type="checkbox" checked={insertBefore} onChange={event => setInsertBefore(event.target.checked)} />
          {tr('Вставить перед выбранной частью')}
        </label>}
        <div className="trainer-editor-part-types">
          {Object.entries(partTypes).map(([type, [label]]) => <button key={type} type="button" className="btn-secondary"
            onClick={() => addPart(type)}>{tr(label)}</button>)}
        </div>
      </div>}
    </div>}
  />;
}
