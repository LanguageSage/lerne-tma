import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { studyWordBank } from '../../utils/structuredStudyCard';
import { addWordBankGap, joinWordBankText, removeWordBankDraftOption, removeWordBankGap } from '../../utils/wordBankDraft';
import { WordBankContent, WordBankGap, WordBankOption } from '../study/StudyCardWordBank';
import { InlineText, VisualCardFields } from './VisualCardFields';

function SentenceText({ index, text, onChange, onBlur, onInsertGap }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    // Keep the browser's caret and undo history while typing.
    if (ref.current.innerText !== text) ref.current.textContent = text;
  }, [text]);

  return <span ref={ref} role="textbox" aria-label={tr('Текст задания')} aria-multiline="true"
    data-placeholder={tr('Введите текст задания')} className="word-bank-sentence-text"
    data-sentence-part={index} contentEditable="plaintext-only" onBlur={onBlur}
    onInput={event => onChange(event.currentTarget.innerText)}
    onKeyDown={event => {
      if (event.altKey && event.key === 'Enter' && onInsertGap) {
        event.preventDefault();
        onInsertGap();
      }
    }} />;
}

function sentenceSelection(root, parts) {
  const selection = root?.ownerDocument.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-sentence-part]');
  if (!element || !root.contains(element)) return null;

  const index = Number(element.dataset.sentencePart);
  const part = parts[index];
  const selected = selection.toString();
  if (part?.type !== 'text' || !selected.trim()) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  const before = prefix.toString();
  const start = part.text.indexOf(selected, before.length);
  // A browser range omits layout line breaks in pasted multiline text.
  return start >= 0 && part.text.slice(0, start).replace(/\n/g, '') === before.replace(/\n/g, '')
    ? { index, text: part.text, start, end: start + selected.length } : null;
}

export function WordBankCardFields({ cardData, update, designConfig, lockLayout = false, resolveMediaUrl }) {
  const source = cardData.content_v2.card.data;
  const data = useMemo(() => joinWordBankText(source), [source]);
  const wordBank = useMemo(() => studyWordBank(data), [data]);
  const [selection, setSelection] = useState(null);
  const exercise = useRef(null);
  const focusOption = useRef(false);
  const usedOptions = new Set(wordBank.gaps.map(gap => gap.correctOptionId));
  useEffect(() => {
    const onSelection = () => setSelection(sentenceSelection(exercise.current, data.parts));
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [data.parts]);
  useLayoutEffect(() => {
    if (!focusOption.current) return;
    focusOption.current = false;
    exercise.current?.querySelector('.word-bank-option:last-of-type textarea')?.focus();
  }, [data.options.length]);

  const changeData = change => update(card => ({ ...card, data: change(joinWordBankText(card.data)) }));
  const editText = (index, text) => {
    setSelection(null);
    changeData(current => current.parts.length ? {
      ...current, parts: current.parts.map((part, i) => i === index ? { ...part, text } : part),
    } : { ...current, parts: [{ type: 'text', text }] });
  };
  const editOption = (index, value) => changeData(current => ({
    ...current, options: current.options.map((option, i) => i === index ? value : option),
  }));
  const insertGap = () => {
    changeData(current => addWordBankGap(current, selection));
    setSelection(null);
  };
  const deleteGap = index => {
    setSelection(null);
    changeData(current => removeWordBankGap(current, index));
  };
  const removeEmptyText = index => changeData(current => {
    const part = current.parts[index];
    return current.parts.length > 1 && part?.type === 'text' && !part.text
      ? { ...current, parts: current.parts.filter((_, i) => i !== index) } : current;
  });

  return <VisualCardFields cardData={cardData} update={update} lockLayout={lockLayout} resolveMediaUrl={resolveMediaUrl} exercise={
    <div ref={exercise} className="word-bank-editor">
      <WordBankContent data={wordBank.parts.length ? wordBank : { ...wordBank, parts: [{ type: 'text', text: '' }] }}
        designConfig={designConfig}
        renderText={(part, index) => <SentenceText index={index} text={part.text} onChange={text => editText(index, text)}
          onInsertGap={selection?.index === index ? insertGap : undefined}
          onBlur={part.text ? undefined : () => removeEmptyText(index)} />}
        renderGap={(gap, style, index) => {
          const option = data.parts[index].option;
          return <WordBankGap as="span" style={style} status="correct">
            <Check size={16} className="word-bank-editor-check" aria-hidden="true" />
            <InlineText value={data.options[option]} label={`${tr('Пропуск')} ${gap.index + 1}`}
              onChange={value => editOption(option, value)} />
            <button type="button" className="visual-card-icon-control"
              aria-label={`${tr('Убрать пропуск')} ${gap.index + 1}`} title={tr('Убрать пропуск')}
              onClick={() => deleteGap(index)}><X size={14} aria-hidden="true" /></button>
          </WordBankGap>;
        }}
        renderOption={(option, style, index) => <WordBankOption as="span" style={style}>
          <InlineText value={option.value} label={`${tr('Слово')} ${index + 1}`} onChange={value => editOption(index, value)} />
          <button type="button" className="visual-card-icon-control" disabled={usedOptions.has(option.id)}
            aria-label={`${tr('Удалить слово из банка')} ${index + 1}`}
            title={tr(usedOptions.has(option.id) ? 'Сначала уберите пропуск, использующий это слово.' : 'Удалить слово из банка')}
            onClick={() => changeData(current => removeWordBankDraftOption(current, index))}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </WordBankOption>}
        sentenceAction={selection && <button type="button" className="word-bank-add-gap"
          aria-keyshortcuts="Alt+Enter" onPointerDown={event => event.preventDefault()} onClick={insertGap}>
          <Plus size={14} aria-hidden="true" />{tr('Создать пропуск')}
        </button>}
        bankAction={<button type="button" className="word-bank-option word-bank-add-option"
          aria-label={tr('Добавить вариант')} title={tr('Добавить вариант')} onClick={() => {
            focusOption.current = true;
            changeData(current => ({ ...current, options: [...current.options, ''] }));
          }}><Plus size={17} aria-hidden="true" /></button>}
      />
    </div>
  } />;
}
