import React, { useRef, useState } from 'react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { editorCommands, EDITOR_MODE_KEY, projectEditorFields, replaceEditorRange, insertEditorCommand, addVisualElement } from '../../utils/cardEditorSyntax';
import './CardContentEditor.css';

export function CardContentEditor({ value, onChange, textStyle, autoFocus = false }) {
  useInterfaceLocale();
  const [advanced, setAdvanced] = useState(() => {
    try { return localStorage.getItem(EDITOR_MODE_KEY) === 'advanced'; } catch { return false; }
  });
  const [error, setError] = useState('');
  const menu = useRef(null);
  const rawRef = useRef(null);
  const fields = projectEditorFields(value);
  const toggle = () => {
    const next = !advanced;
    setAdvanced(next);
    setError('');
    try { localStorage.setItem(EDITOR_MODE_KEY, next ? 'advanced' : 'simple'); } catch { /* Preferences are optional. */ }
  };
  const replace = (field, next) => {
    setError('');
    onChange(replaceEditorRange(value, field.start, field.end, next));
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
  const add = id => {
    onChange(addVisualElement(value, id));
    menu.current.open = false;
    menu.current.querySelector('summary')?.focus();
  };
  const commandButtons = visual => editorCommands.filter(command => !visual || !['level', 'topic'].includes(command.id)).map(command => (
    <button type="button" className="btn-secondary" key={command.id}
      disabled={visual && ((command.directive && /[{}[\]]|^\s*(::|@)/m.test(value)) ||
        (['choice', 'input', 'exercise'].includes(command.id) && /^\s*@(match|free|puzzle)\b/m.test(value)))}
      onClick={() => visual ? add(command.id) : insert(command.id)}>{tr(command.label)}</button>
  ));
  return <div className="card-content-editor">
    <div className="card-editor-mode">
      <button type="button" className="btn-secondary" aria-pressed={advanced}
        aria-label={advanced ? tr('Обычный редактор') : tr('Дополнительно: исходная разметка')} onClick={toggle}>
        {advanced ? tr('Обычный редактор') : tr('Дополнительно')}
      </button>
    </div>
    {advanced ? <>
      <label className="card-editor-field">
        <span className="sub-label">{tr('Исходная разметка')}</span>
        <textarea ref={rawRef} className="form-input card-editor-raw" rows={7} value={value}
          onChange={e => onChange(e.target.value)} spellCheck={false} />
      </label>
      <div className="card-editor-commands" aria-label={tr('Вставить элемент')}>{commandButtons(false)}</div>
    </> : fields ? <>
      {fields.map((field, index) => <div className="card-editor-field" key={index}>
        {field.kind === 'text' ? <label>
          <span className="sub-label">{tr(field.label)}</span>
          <textarea className="textarea-preview" rows={Math.max(2, field.value.split('\n').length)}
            style={textStyle} autoFocus={autoFocus && index === 0} value={field.value}
            onChange={e => replace(field, e.target.value)} />
        </label> : field.kind === 'input' ? <label>
          <span className="sub-label">{tr(field.label)}</span>
          <input className="form-input" value={field.value.slice(2, -2)}
            onChange={e => safeChange(e.target.value, /[[\]\r\n]/, next => replace(field, `[[${next}]]`))} />
        </label> : field.kind === 'pair' ? <fieldset>
          <legend className="sub-label">{tr('Соединение пар')}</legend>
          <div className="card-editor-pair">
            {[0, 1].map(side => <label key={side}>
              <span className="sub-label">{tr(side ? 'Правая сторона' : 'Левая сторона')}</span>
              <input className="form-input" value={side ? field.value.slice(field.separator + 4) : field.value.slice(0, field.separator)}
                onChange={e => safeChange(e.target.value, /=>|->|—|=|[\r\n]/, next => replace(field, side
                  ? field.value.slice(0, field.separator + 4) + next : next + field.value.slice(field.separator)))} />
            </label>)}
          </div>
          {fields.filter(item => item.kind === 'pair').length > 2 && <button type="button" className="btn-secondary"
            onClick={() => replace(field, '')}>{tr('Удалить пару')}</button>}
          {!fields.slice(index + 1).some(item => item.kind === 'pair') && <button type="button" className="btn-secondary"
            onClick={() => replace(field, field.value + '\nBerlin => Deutschland')}>{tr('Добавить пару')}</button>}
        </fieldset> : <fieldset>
          <legend className="sub-label">{tr('Варианты ответа')}</legend>
          <p className="card-editor-hint">{tr('Отметьте правильные варианты.')}</p>
          {(() => {
            const options = field.value.slice(1, -1).split(/[|;,/]/);
            const starred = options.some(option => option.trimStart().startsWith('*'));
            const update = (at, next) => replace(field, `{${options.map((option, i) => i === at ? next : option).join('|')}}`);
            return <>
              {options.map((option, at) => {
                const correct = option.trimStart().startsWith('*') || (!starred && at === 0);
                return <div className="card-editor-choice" key={at}>
                  <label className="card-editor-correct"><input type="checkbox" checked={correct} aria-label={tr('Правильный вариант {{p0}}', { p0: at + 1 })}
                    onChange={e => {
                      const normalized = options.map((item, i) => (item.trimStart().startsWith('*') || (!starred && i === 0) ? '*' : '') + item.trim().replace(/^\*/, ''));
                      normalized[at] = (e.target.checked ? '*' : '') + option.trim().replace(/^\*/, '');
                      if (!normalized.some(item => item.startsWith('*'))) {
                        setError(tr('Нужен хотя бы один правильный вариант.'));
                        return;
                      }
                      replace(field, `{${normalized.join('|')}}`);
                    }} /></label>
                  <input className="form-input" aria-label={tr('Вариант {{p0}}', { p0: at + 1 })} value={option.replace(/^\s*\*/, '')}
                    onChange={e => safeChange(e.target.value, /[{}|;,/*\r\n]/, next => update(at, (correct ? '*' : '') + next))} />
                  <button type="button" className="btn-secondary" aria-label={tr('Удалить вариант {{p0}}', { p0: at + 1 })}
                    disabled={options.length <= 2 || (correct && options.filter(o => o.trimStart().startsWith('*')).length <= 1)}
                    onClick={() => replace(field, `{${options.filter((_, i) => i !== at).join('|')}}`)}>×</button>
                </div>;
              })}
              <button type="button" className="btn-secondary" onClick={() => replace(field, `{${options.join('|')}|}`)}>{tr('Добавить вариант')}</button>
            </>;
          })()}
        </fieldset>}
      </div>)}
      <details ref={menu} className="card-editor-add" onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menu.current.open = false; menu.current.querySelector('summary')?.focus(); }
      }}>
        <summary>{tr('+ Добавить элемент')}</summary>
        <div className="card-editor-commands">{commandButtons(true)}</div>
      </details>
    </> : <div className="card-editor-fallback">
      <p>{tr('Эта карточка содержит сложную разметку. Содержимое сохранено без изменений.')}</p>
      <button type="button" className="btn-secondary" onClick={toggle}>{tr('Редактировать исходную разметку')}</button>
    </div>}
    {error && <p role="alert" className="card-editor-hint">{error}</p>}
  </div>;
}
