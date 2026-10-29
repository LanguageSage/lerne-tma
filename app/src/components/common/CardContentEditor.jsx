import React, { useId, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { editorCommandGroups, insertEditorCommand, editorSourceOffset } from '../../utils/cardEditorSyntax';
import { parseExerciseContent } from '../../utils/exerciseContentParser';
import { detectExerciseType } from '../../utils/exerciseDetector';
import { getDesignStylesFromV2 } from '../../utils/cardStyles';
import { ExerciseRenderer } from '../study/ExerciseRenderer.jsx';
import { CardFrontContent } from './CardFrontContent.jsx';
import './CardContentEditor.css';

function fitEditorTextarea(area) {
  if (!area) return;
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`;
}

export function CardContentEditor({ value, onChange, card = {}, styles, textStyle, autoFocus = false, modeAction }) {
  useInterfaceLocale();
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState('');
  const [historyActions, setHistoryActions] = useState({ text: value, undo: false, redo: false });
  const previewId = useId();
  const rawRef = useRef(null);
  const editorRef = useRef(null);
  const selectionRef = useRef(null);
  const insertionRef = useRef(null);
  const historyRef = useRef({ past: [], future: [], expected: value, typing: null });

  useLayoutEffect(() => { fitEditorTextarea(rawRef.current); });
  useEffect(() => {
    const observer = new ResizeObserver(() => fitEditorTextarea(rawRef.current));
    observer.observe(editorRef.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const insertion = insertionRef.current;
    const area = rawRef.current;
    if (!insertion || !area || insertion.text !== value) return;
    insertionRef.current = null;
    const offset = at => value.slice(0, at).replace(/\r\n?/g, '\n').length;
    area.focus({ preventScroll: true });
    area.setSelectionRange(offset(insertion.selectionStart), offset(insertion.selectionEnd));
    selectionRef.current = { start: area.selectionStart, end: area.selectionEnd };
    for (const { element, top, left } of insertion.scroll || []) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }, [value]);

  const rememberSelection = event => {
    const area = event.currentTarget;
    selectionRef.current = { start: area.selectionStart, end: area.selectionEnd };
  };
  const snapshot = () => {
    const selection = selectionRef.current || { start: value.length, end: value.length };
    return { text: value, selectionStart: editorSourceOffset(value, selection.start),
      selectionEnd: editorSourceOffset(value, selection.end) };
  };
  const change = (next, typing = null) => {
    const history = historyRef.current;
    if (history.expected !== value) {
      history.past = [];
      history.future = [];
      history.typing = null;
    }
    if (next === value) return;
    const previous = history.typing;
    if (!typing || !previous || previous.type !== typing.type
      || typing.time - previous.time > 1000 || previous.cursor !== typing.start) {
      history.past.push(snapshot());
    }
    history.typing = typing;
    history.future = [];
    history.expected = next;
    setHistoryActions({ text: next, undo: true, redo: false });
    setError('');
    onChange(next);
  };
  const undo = redo => {
    const history = historyRef.current;
    if (history.expected !== value) return;
    const source = redo ? history.future : history.past;
    const target = source.pop();
    if (!target) return;
    (redo ? history.past : history.future).push(snapshot());
    history.typing = null;
    history.expected = target.text;
    setHistoryActions({ text: target.text, undo: history.past.length > 0, redo: history.future.length > 0 });
    insertionRef.current = target;
    setError('');
    onChange(target.text);
  };
  const insert = id => {
    const area = rawRef.current;
    const selection = document.activeElement === area
      ? { start: area.selectionStart, end: area.selectionEnd } : selectionRef.current;
    selectionRef.current = selection;
    const result = insertEditorCommand(value, id,
      selection ? editorSourceOffset(value, selection.start) : value.length,
      selection ? editorSourceOffset(value, selection.end) : value.length);
    if (result.error) { setError(result.error); return; }
    const scroll = [];
    for (let element = area; element; element = element.parentElement) {
      if (element === area || element.scrollHeight > element.clientHeight) {
        scroll.push({ element, top: element.scrollTop, left: element.scrollLeft });
      }
    }
    insertionRef.current = { ...result, selectionStart: result.selectionStart ?? result.cursor,
      selectionEnd: result.selectionEnd ?? result.cursor, scroll };
    change(result.text);
    if (result.text === value) {
      insertionRef.current = null;
      area.focus({ preventScroll: true });
    }
  };
  const previewCard = { ...card, front: value };
  const exerciseType = detectExerciseType(previewCard);
  const effectiveConfig = styles?.isLocalDesignPreviewActive && styles.adminDraftDesignV2
    ? styles.adminDraftDesignV2 : styles?.publishedDesignV2?.config;
  const previewTextStyle = getDesignStylesFromV2(effectiveConfig)?.frontText || textStyle;
  const renderCommands = group => <div key={group.id} className="card-editor-command-group"
    role="group" aria-label={tr(group.label)}>
    <span className="sub-label">{tr(group.label)}</span>
    <div className="card-editor-command-list">
      {group.commands.map(command => <button key={command.id} type="button"
        className={`btn-secondary card-editor-btn card-editor-btn-${group.id}`}
        onMouseDown={e => e.preventDefault()} onClick={() => insert(command.id)}>
        {tr(command.label)}
      </button>)}
    </div>
  </div>;

  return <div className="card-content-editor" ref={editorRef}>
    {showPreview && <div id={previewId} className="card-editor-preview">
      <span className="sub-label">{tr('Предпросмотр (Лицевая сторона)')}</span>
      <fieldset disabled className="card-front-preview" aria-label={tr('Предпросмотр (Лицевая сторона)')}>
        {!value.trim() ? <p className="card-editor-hint">{tr('Здесь появится предпросмотр карточки.')}</p>
          : exerciseType ? <ExerciseRenderer key={value + card.back} card={previewCard} styles={styles} designConfig={effectiveConfig} />
            : <CardFrontContent content={parseExerciseContent(value)} textStyle={previewTextStyle} />}
      </fieldset>
    </div>}
    <div className="card-editor-mode">
      <button type="button" className="btn-secondary" aria-expanded={showPreview}
        aria-controls={showPreview ? previewId : undefined} onClick={() => setShowPreview(current => !current)}>
        {tr(showPreview ? 'Скрыть предпросмотр' : 'Показать предпросмотр')}
      </button>
      {modeAction}
    </div>
    <div className="card-editor-advanced">
      <div className="card-editor-toolbar" role="region" aria-label={tr('Панель быстрой вставки')}>
        {editorCommandGroups.filter(group => group.id === 'marker').map(renderCommands)}
      </div>
      <p className="card-editor-hint">{tr('Выделите текст и нажмите маркер. Без выделения появится пустой блок у курсора.')}</p>
      <div className="card-editor-history" role="group" aria-label={tr('История правок')}>
        <button type="button" className="btn-secondary" aria-label={tr('Отменить правку')}
          title={tr('Отменить правку')} disabled={historyActions.text !== value || !historyActions.undo}
          onMouseDown={e => e.preventDefault()} onClick={() => undo(false)}><Undo2 size={18} /></button>
        <button type="button" className="btn-secondary" aria-label={tr('Вернуть правку')}
          title={tr('Вернуть правку')} disabled={historyActions.text !== value || !historyActions.redo}
          onMouseDown={e => e.preventDefault()} onClick={() => undo(true)}><Redo2 size={18} /></button>
      </div>
      <label className="card-editor-field">
        <span className="sub-label">{tr('Исходная разметка')}</span>
        <textarea ref={rawRef} className="form-input card-editor-raw" rows={4} value={value}
          autoFocus={autoFocus && !value} onSelect={rememberSelection} onFocus={rememberSelection}
          onBlur={rememberSelection} onClick={rememberSelection} onKeyUp={rememberSelection}
          onKeyDown={e => {
            if (e.isComposing || e.nativeEvent.isComposing) return;
            if ((e.ctrlKey || e.metaKey) && !e.altKey
              && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
              e.preventDefault();
              undo(e.shiftKey || e.key.toLowerCase() === 'y');
            }
          }}
          onChange={e => {
            const area = e.target;
            const next = value.includes('\r\n') ? area.value.replace(/\n/g, '\r\n') : area.value;
            const type = e.nativeEvent.inputType;
            if (type === 'historyUndo' || type === 'historyRedo') {
              undo(type === 'historyRedo');
              return;
            }
            change(next, ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(type)
              ? { type, time: e.timeStamp, start: selectionRef.current?.start,
                cursor: area.selectionStart } : null);
            rememberSelection(e);
          }} spellCheck={false} />
      </label>
      {error && <p role="alert" className="card-editor-hint">{tr(error)}</p>}
      <div className="card-editor-toolbar" role="region" aria-label={tr('Тренажёр')}>
        {editorCommandGroups.filter(group => group.id !== 'marker').map(renderCommands)}
      </div>
    </div>
  </div>;
}
