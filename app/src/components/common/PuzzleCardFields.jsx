import React, { useLayoutEffect, useRef, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { puzzleDraftTokens } from '../../utils/cardDraft';
import { MarkdownRenderer } from './MarkdownRenderer';
import { InlineText, VisualCardFields } from './VisualCardFields';

export function PuzzleCardFields({ cardData, update, textStyles, lockLayout = false, resolveMediaUrl }) {
  const { data, info } = cardData.content_v2.card;
  const [edit, setEdit] = useState(null);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const returnFocus = useRef(false);
  const editing = edit !== null;
  const { frontText, backText } = textStyles;
  const sentenceStyle = { ...frontText, color: undefined };
  const sentence = data.tokens.join(' ');
  const sentenceLabel = tr('Правильное предложение');
  const updateData = patch => update(card => ({ ...card, data: { ...card.data, ...patch } }));

  useLayoutEffect(() => {
    if (editing) inputRef.current?.focus();
    if (!editing && returnFocus.current) {
      buttonRef.current?.focus();
      returnFocus.current = false;
    }
  }, [editing]);

  return <VisualCardFields cardData={cardData} update={update} lockLayout={lockLayout} resolveMediaUrl={resolveMediaUrl} exercise={
    <div className="puzzle-editor puzzle-exercise is-correct">
      {!info?.some(block => block.type === 'task' && block.text.trim()) && <div className="puzzle-editor-instruction">
        <Puzzle size={15} aria-hidden="true" />
        {tr('Соберите предложение')}
      </div>}
      <div className="text-back" style={backText}>
        <InlineText block label={tr('Перевод')} value={data.translation}
          display={<MarkdownRenderer>{data.translation}</MarkdownRenderer>}
          onChange={translation => updateData({ translation })} />
      </div>
      <div className="puzzle-editor-label">{sentenceLabel}</div>
      <div className="puzzle-editor-line" data-editing={editing || undefined}>
        <button type="button" ref={buttonRef} className="puzzle-editor-sentence" style={sentenceStyle}
          title={tr('Редактировать предложение')}
          aria-label={[tr('Редактировать предложение'), sentence].filter(Boolean).join(' — ')}
          onClick={() => setEdit({ text: sentence, tokens: data.tokens })}>
          {data.tokens.length ? data.tokens.map((token, index) =>
            <span className="puzzle-slot-chip" key={index}>{token}</span>)
            : <span className="visual-card-inline-placeholder">{tr('Введите предложение')}</span>}
        </button>
        {editing && <textarea id="card-editor-front" ref={inputRef} className="puzzle-editor-input"
          aria-label={sentenceLabel} value={edit.text} style={frontText}
          onChange={event => {
            const text = event.target.value;
            setEdit({ ...edit, text });
            updateData({ tokens: puzzleDraftTokens(text, edit.tokens) });
          }}
          onBlur={() => setEdit(null)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            returnFocus.current = true;
            setEdit(null);
          }} />}
      </div>
    </div>
  } />;
}
