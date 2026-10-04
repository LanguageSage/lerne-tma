import React, { useId, useRef, useState } from 'react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { editorCommands, projectEditorFields, readableFrontText, replaceEditorRange, insertEditorCommand, insertEditorLineAfter, setQuizOptionCorrect, syncWordBankAnswer } from '../../utils/cardEditorSyntax';
import './CardContentEditor.css';

export function CardContentEditor({ value, onChange, back = '', onBackChange, textStyle, autoFocus = false }) {
  useInterfaceLocale();
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const advancedId = useId();
  const rawRef = useRef(null);
  const fields = projectEditorFields(value);
  const toggle = () => {
    setAdvanced(current => !current);
    setError('');
  };
  const replace = (field, next) => {
    setError('');
    onChange(replaceEditorRange(value, field.start, field.end, next));
  };
  const addLine = (field, line) => {
    setError('');
    onChange(insertEditorLineAfter(value, field, line));
  };
  const safeChange = (next, reserved, apply) => {
    if (reserved.test(next)) {
      setError(tr('Этот символ используется в разметке. Откройте расширенный редактор.'));
      return;
    }
    setError('');
    apply(next);
  };
  const insert = id => {
    const area = rawRef.current;
    const result = insertEditorCommand(value, id, area?.selectionStart ?? value.length, area?.selectionEnd ?? value.length);
    onChange(result.text);
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(result.cursor, result.cursor);
    });
  };
  const commandButtons = editorCommands.map(command => (
    <button type="button" className="btn-secondary" key={command.id}
      onClick={() => insert(command.id)}>{tr(command.label)}</button>
  ));
  const commitInlineText = (field, element) => {
    const next = element.innerText.replace(/\r\n?/g, '\n');
    if (next === field.value.replace(/\r\n?/g, '\n')) return;
    if (/::|^\s*@|[{}[\]]|<<|>>/m.test(next)) {
      setError(tr('Этот символ используется в разметке. Откройте расширенный редактор.'));
      element.textContent = field.value;
      return;
    }
    replace(field, field.value.includes('\r\n') ? next.replace(/\n/g, '\r\n') : next);
  };
  const renderInput = (field, key) => <label className="card-editor-field" key={key}>
    <span className="sub-label">{tr(field.label)}</span>
    <input className="form-input" value={field.value.slice(2, -2)}
      onChange={e => safeChange(e.target.value, /[[\]\r\n]/, next => replace(field, `[[${next}]]`))} />
  </label>;
  const renderChoice = (field, key) => {
    const options = field.value.slice(1, -1).split(/[|;,/]/);
    const starred = options.some(option => option.trimStart().startsWith('*'));
    const update = (at, next) => replace(field, `{${options.map((option, i) => i === at ? next : option).join('|')}}`);
    return <fieldset className="card-editor-field" key={key}>
      <legend className="sub-label">{tr('Варианты ответа')}</legend>
      <p className="card-editor-hint">{tr('Отметьте правильные варианты.')}</p>
      {options.map((option, at) => {
        const correct = option.trimStart().startsWith('*') || (!starred && at === 0);
        return <div className="card-editor-choice" key={at}>
          <label className="card-editor-correct"><input type="checkbox" checked={correct}
            aria-label={tr('Правильный вариант {{p0}}', { p0: at + 1 })}
            onChange={e => {
              const normalized = options.map((item, i) => (item.trimStart().startsWith('*') || (!starred && i === 0) ? '*' : '') + item.trim().replace(/^\*/, ''));
              normalized[at] = (e.target.checked ? '*' : '') + option.trim().replace(/^\*/, '');
              if (!normalized.some(item => item.startsWith('*'))) {
                setError(tr('Нужен хотя бы один правильный вариант.'));
                return;
              }
              replace(field, `{${normalized.join('|')}}`);
            }} /></label>
          <input className="form-input" aria-label={tr('Вариант {{p0}}', { p0: at + 1 })}
            value={option.replace(/^\s*\*/, '')}
            onChange={e => safeChange(e.target.value, /[{}|;,/*\r\n]/, next => update(at, (correct ? '*' : '') + next))} />
          <button type="button" className="btn-secondary" aria-label={tr('Удалить вариант {{p0}}', { p0: at + 1 })}
            disabled={options.length <= 2 || (correct && options.filter(o => o.trimStart().startsWith('*')).length <= 1)}
            onClick={() => replace(field, `{${options.filter((_, i) => i !== at).join('|')}}`)}>×</button>
        </div>;
      })}
      <button type="button" className="btn-secondary" onClick={() => replace(field, `{${options.join('|')}|}`)}>{tr('Добавить вариант')}</button>
    </fieldset>;
  };
  const renderField = (field, index) => {
    if (field.kind === 'text' && field.sectionType === 'quiz') return <div className="card-editor-field" key={index}>
      <span className="sub-label">{tr(field.label)}</span>
      <div className="card-editor-sentence" style={textStyle}>
        <span className="card-editor-inline-text" contentEditable role="textbox"
          aria-label={tr(field.label)} aria-multiline="true" tabIndex={0} suppressContentEditableWarning
          onBlur={e => commitInlineText(field, e.currentTarget)}>{field.value}</span>
      </div>
    </div>;
    if (field.kind === 'text') return <label className="card-editor-field" key={index}>
      <span className="sub-label">{tr(field.label)}</span>
      <textarea className="textarea-preview" rows={Math.max(2, field.value.split('\n').length)}
        style={textStyle} autoFocus={autoFocus && index === 0} value={field.value}
        onChange={e => replace(field, e.target.value)} />
    </label>;
    if (field.kind === 'input') return renderInput(field, index);
    if (field.kind === 'choice') return renderChoice(field, index);
    if (field.kind === 'pair') return <React.Fragment key={index}>
      <div className="card-editor-pair-line">
        {[0, 1].map(side => <input key={side} className="form-input"
          aria-label={tr(side ? 'Правая сторона' : 'Левая сторона')}
          value={side ? field.value.slice(field.separator + field.separatorLength) : field.value.slice(0, field.separator)}
          onChange={e => safeChange(e.target.value, /=>|->|—|=|[\r\n]/, next => replace(field, side
            ? field.value.slice(0, field.separator + field.separatorLength) + next : next + field.value.slice(field.separator)))} />)}
      </div>
      {!fields.slice(index + 1).some(item => item.kind === 'pair') &&
        <button type="button" className="btn-secondary card-editor-add" onClick={() => addLine(field, ' => ')}>
          {tr('Добавить пару')}
        </button>}
    </React.Fragment>;
    if (field.kind === 'quiz-option') {
      const optionNumber = fields.filter(item => item.kind === 'quiz-option' && item.start <= field.start).length;
      return <React.Fragment key={index}>
        <div className="card-editor-quiz-option">
          <label className="card-editor-correct"><input type="checkbox" checked={field.correct}
            aria-label={tr('Правильный вариант {{p0}}', { p0: optionNumber })}
            onChange={e => {
              if (!e.target.checked && fields.filter(item => item.kind === 'quiz-option' && item.correct).length <= 1) {
                setError(tr('Нужен хотя бы один правильный вариант.'));
                return;
              }
              replace(field, setQuizOptionCorrect(field, e.target.checked));
            }} /></label>
          <input className="form-input" aria-label={tr('Вариант {{p0}}', { p0: optionNumber })}
            value={field.display}
            onChange={e => safeChange(e.target.value, /^(?:\*|\[)|[\r\n]/, next => replace(field, field.prefix + next))} />
        </div>
        {!fields.slice(index + 1).some(item => item.kind === 'quiz-option') &&
          <button type="button" className="btn-secondary card-editor-add" onClick={() => addLine(field, '- ')}>
            {tr('Добавить вариант')}
          </button>}
      </React.Fragment>;
    }
    if (field.kind === 'wordbank-option') return <label className="card-editor-field" key={index}>
      <span className="sub-label">{tr('Вариант {{p0}}', { p0: fields.filter(item => item.kind === 'wordbank-option' && item.start <= field.start).length })}</span>
      <input className="form-input" value={field.value.trim()}
        onChange={e => safeChange(e.target.value, /[|\r\n]/, next => {
          const leading = /^\s*/.exec(field.value)[0];
          const trailing = /\s*$/.exec(field.value)[0];
          replace(field, leading + next + trailing);
          const oldOption = field.value.trim();
          const duplicate = fields.filter(item => item.kind === 'wordbank-option'
            && item.value.trim().toLowerCase() === oldOption.toLowerCase()).length > 1;
          if (!duplicate && onBackChange) {
            const updatedBack = syncWordBankAnswer(back, oldOption, next);
            if (updatedBack !== back) onBackChange(updatedBack);
          }
        })} />
    </label>;
    return null;
  };
  const renderInlineGroup = group => <div className="card-editor-field" key={`group-${group[0].sectionIndex}`}>
    <span className="sub-label">{tr('Вопрос / лицевая сторона')}</span>
    <div className="card-editor-sentence" style={textStyle}>
      {group.filter(field => ['text', 'input', 'choice', 'wordbank-gap'].includes(field.kind)).map((field, slot) => field.kind === 'text'
        ? <span key={slot} className="card-editor-inline-text" contentEditable role="textbox"
            aria-label={tr(field.label)} aria-multiline="true" tabIndex={0} suppressContentEditableWarning
            onBlur={e => commitInlineText(field, e.currentTarget)}>{field.value}</span>
        : <span key={slot} className="card-editor-inline-gap" aria-label={tr('Пропуск')}>
            {field.kind === 'wordbank-gap' ? `${field.value.slice(2, -2)} · _____` : '_____'}
          </span>)}
    </div>
    {group.filter(field => field.kind === 'input').map((field, slot) => renderInput(field, `input-${slot}`))}
    {group.filter(field => field.kind === 'choice').map((field, slot) => renderChoice(field, `choice-${slot}`))}
  </div>;
  const renderedGroups = new Set();
  const visualFields = fields?.map((field, index) => {
    if (['trainer', 'word_bank'].includes(field.sectionType)) {
      if (renderedGroups.has(field.sectionIndex)) return null;
      renderedGroups.add(field.sectionIndex);
      return renderInlineGroup(fields.filter(item => item.sectionIndex === field.sectionIndex));
    }
    return renderField(field, index);
  });
  return <div className="card-content-editor">
    {fields ? <>
      {visualFields}
    </> : <div className="card-editor-field">
      <span className="sub-label">{tr('Вопрос / лицевая сторона')}</span>
      <div className="card-editor-readable" style={textStyle}>{readableFrontText(value)}</div>
    </div>}
    <div className="card-editor-mode">
      <button type="button" className="btn-secondary" aria-expanded={advanced}
        aria-controls={advanced ? advancedId : undefined} onClick={toggle}>{tr('Дополнительно')}</button>
    </div>
    {advanced && <div id={advancedId} className="card-editor-advanced">
      <label className="card-editor-field">
        <span className="sub-label">{tr('Исходная разметка')}</span>
        <textarea ref={rawRef} className="form-input card-editor-raw" rows={7} value={value}
          onChange={e => onChange(e.target.value)} spellCheck={false} />
      </label>
      <div className="card-editor-commands" aria-label={tr('Вставить элемент')}>{commandButtons}</div>
    </div>}
    {error && <p role="alert" className="card-editor-hint">{error}</p>}
  </div>;
}
