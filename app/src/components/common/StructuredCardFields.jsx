import React, { useState } from 'react';
import { getInterfaceLanguage, tr } from '../../i18n/locale';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { cardTypes, newCardContent, promptField, answerField, cardWriteError } from '../../utils/cardDraft';
import { networkApi } from '../../services/api';
import { ExerciseRenderer } from '../study/ExerciseRenderer';
import { KaraokeText } from '../study/KaraokeText';
import { studySideText } from '../../utils/structuredStudyCard';

const trainerParts = [
  { type: 'text', text: '' }, { type: 'input', answers: [''] },
  { type: 'choice', options: [{ text: '', correct: true }, { text: '', correct: false }] },
];
const infoParts = ['task', 'source', 'example'].map(type => ({ type, text: '' }))
  .concat({ type: 'options', items: [''] });
const samples = {
  parts: trainerParts, info: infoParts, pairs: [{ left: '', right: '' }],
  answers: [''], accepted_answers: [''], items: [''], topics: [''], tokens: [''],
};
const labels = {
  prompt: 'Задание', text: 'Текст', source_text: 'Исходный текст', parts: 'Части задания',
  options: 'Варианты', items: 'Варианты', correct: 'Верный ответ', answers: 'Правильные ответы',
  accepted_answers: 'Допустимые ответы', pairs: 'Пары', left: 'Слева', right: 'Справа',
  tokens: 'Элементы в правильном порядке', option: 'Номер варианта с нуля',
  info: 'Информационные блоки', topics: 'Темы',
  task: 'Задание', source: 'Подсказка', example: 'Пример', input: 'Ввод', choice: 'Выбор', gap: 'Пропуск',
};

function Field({ name, value, update, kind, remove }) {
  const label = tr(labels[name] || name);
  if (Array.isArray(value)) {
    const choices = name === 'parts' && kind === 'word_bank'
      ? [trainerParts[0], { type: 'gap', option: 0 }]
      : name === 'options' && kind !== 'word_bank' ? [{ text: '', correct: false }] : samples[name] || [''];
    return <fieldset className="card-form-text-field">
      <legend>{label}</legend>
      {value.map((item, index) => <div key={index}>
        <Field name={item?.type || `${label} ${index + 1}`} value={item} kind={kind}
          update={next => update(value.map((entry, i) => i === index ? next : entry))} />
        <button type="button" className="btn-secondary" aria-label={`${tr('Удалить')} ${label} ${index + 1}`}
          onClick={() => remove ? remove(index) : update(value.filter((_, i) => i !== index))}>{tr('Удалить')}</button>
      </div>)}
      {choices.map((sample, i) => <button key={i} type="button" className="btn-secondary"
        onClick={() => update([...value, structuredClone(sample)])}>
        {tr('Добавить')} {sample?.type ? tr(labels[sample.type] || sample.type) : label}
      </button>)}
    </fieldset>;
  }
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => key !== 'type').map(([key, field]) =>
    <Field key={key} name={key} value={field} kind={kind} update={next => update({ ...value, [key]: next })} />);
  if (typeof value === 'boolean') return <label>
    <input type="checkbox" checked={value} onChange={event => update(event.target.checked)} /> {label}
  </label>;
  return <label className="card-form-text-field">{label}
    {typeof value === 'number'
      ? <input className="form-input" type="number" min="0" value={value} onChange={event => update(event.target.valueAsNumber || 0)} />
      : <textarea className="textarea-preview" value={value ?? ''} onChange={event => update(event.target.value)} />}
  </label>;
}

export function StructuredCardFields({ card, update, isCreator, textStyle }) {
  const { type, data } = card;
  const prompt = promptField[type];
  const [fieldError, setFieldError] = useState('');
  const [preview, setPreview] = useState(null);
  const activePreview = preview?.source === card ? preview : null;
  const togglePreview = async () => {
    if (activePreview?.content) {
      setPreview(null);
      return;
    }
    setPreview({ source: card, loading: true });
    try {
      const { data: content } = await networkApi.post('/cards/validate', { schema_version: 2, card });
      setPreview(current => current?.source === card ? { source: card, content } : current);
    } catch (error) {
      setPreview(current => current?.source === card ? { source: card, error: cardWriteError(error) } : current);
    }
  };
  const speech = useSpeechRecognition({
    resetKey: type, language: getInterfaceLanguage(), silenceTimeoutMs: null,
    onEnd: transcript => {
      if (transcript?.trim() && prompt) update(current => ({ ...current, data: { ...current.data,
        [prompt]: [current.data[prompt], transcript.trim()].filter(Boolean).join(' ') } }));
    },
  });
  return <>
    <label className="card-form-text-field">{tr('Тип карточки')}
      <select className="form-input" value={type} onChange={event => {
        const next = event.target.value;
        if (Object.values(data).some(Boolean) && !window.confirm(tr('Заменить поля текущего упражнения?'))) return;
        update(current => ({ ...current, type: next, data: newCardContent(next).card.data }));
      }}>{cardTypes.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select>
    </label>
    {prompt && <div className="card-form-text-field">
      <label htmlFor="card-editor-front">{tr(labels[prompt])}</label>
      <textarea id="card-editor-front" className="textarea-preview" value={data[prompt]} style={textStyle}
        onChange={event => {
          const value = event.target.value;
          update(current => ({ ...current, data: { ...current.data, [prompt]: value } }));
        }} />
      {isCreator && <button type="button" className="btn-secondary" onClick={() => speech.isListening ? speech.stop() : speech.start()}>
        {speech.isListening ? tr('Остановить диктовку') : tr('Диктовать')}
      </button>}
      {speech.speechError && <p role="status">{speech.speechError}</p>}
    </div>}
    {Object.entries(data).filter(([key]) => key !== prompt && key !== answerField[type] && key !== 'grading_policy')
      .map(([key, value]) => <Field key={key} name={key} value={value} kind={type}
        remove={type === 'word_bank' && key === 'options' ? index => {
          if (data.parts.some(part => part.type === 'gap' && part.option === index)) {
            setFieldError(tr('Сначала измените пропуски, использующие этот вариант.'));
            return;
          }
          setFieldError('');
          update(current => ({ ...current, data: {
            ...current.data,
            options: current.data.options.filter((_, i) => i !== index),
            parts: current.data.parts.map(part => part.type === 'gap' && part.option > index
              ? { ...part, option: part.option - 1 } : part),
          } }));
        } : undefined}
        update={next => update(current => ({ ...current, data: { ...current.data, [key]: next } }))} />)}
    {fieldError && <p role="status">{fieldError}</p>}
    <details>
      <summary>{tr('Информационные блоки и темы')}</summary>
      <Field name="info" value={card.info || []} update={info => update(current => ({ ...current, info }))} kind={type} />
      <Field name="topics" value={card.topics || []} update={topics => update(current => ({ ...current, topics }))} kind={type} />
    </details>
    <button type="button" className="btn-secondary" onClick={togglePreview} disabled={activePreview?.loading}>
      {activePreview?.content ? tr('Скрыть предпросмотр') : tr('Показать предпросмотр')}
    </button>
    {activePreview?.error && <p role="alert">{activePreview.error}</p>}
    {activePreview?.content && <fieldset disabled>
      <ExerciseRenderer native card={{ content_v2: activePreview.content }} fallback={
        <KaraokeText text={studySideText(activePreview.content.card)} style={textStyle} />
      } />
    </fieldset>}
  </>;
}
