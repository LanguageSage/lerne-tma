import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { getInterfaceLanguage, tr } from '../../i18n/locale';
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition';
import { cardTypes, newCardContent, promptField, answerField, cardWriteError } from '../../utils/cardDraft';
import { networkApi } from '../../services/api';
import { ExerciseRenderer } from '../study/ExerciseRenderer';
import { KaraokeText } from '../study/KaraokeText';
import { studySideText } from '../../utils/structuredStudyCard';
import { enableLayout, moveLayout, removeLayout, addLayoutInfo, addLayoutImage, patchInfoBlock, patchLayoutItem } from '../../utils/cardLayout';
import './StructuredCardFields.css';

const trainerParts = [
  { type: 'text', text: '' }, { type: 'input', answers: [''] },
  { type: 'choice', options: [{ text: '', correct: true }, { text: '', correct: false }] },
];
const infoParts = ['task', 'source', 'example'].map(type => ({ type, text: '' }))
  .concat({ type: 'options', items: [''] });
const samples = {
  parts: trainerParts, info: infoParts, pairs: [{ left: '', right: '' }],
  answers: [''], accepted_answers: [''], items: [''], topics: [''],
};

function LayoutFields({ card, update, imagesOnly = false }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const uploadRequest = useRef(null);
  useEffect(() => () => { uploadRequest.current?.abort(); uploadRequest.current = null; }, []);
  const imagePath = /^images\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
  const attach = value => {
    if (!imagePath.test(value)) { setError(tr('Укажите путь images/имя-файла.')); return; }
    update(current => addLayoutImage(current, value));
    setPath(''); setError('');
  };
  const upload = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const request = new AbortController();
    uploadRequest.current = request;
    setUploading(true); setError('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await networkApi.post('/media/upload-image', form, { signal: request.signal });
      if (!request.signal.aborted) attach(response.data.path);
    } catch (failure) { if (!request.signal.aborted) setError(cardWriteError(failure)); }
    finally { if (uploadRequest.current === request) { uploadRequest.current = null; setUploading(false); } }
  };
  if (!card.layout && !imagesOnly) return <button type="button" className="btn-secondary"
    onClick={() => update(enableLayout)}>{tr('Настроить порядок блоков')}</button>;
  return <fieldset className="card-layout-editor">
    {!imagesOnly && <legend>{tr('Порядок блоков')}</legend>}
    {card.layout?.map((item, position) => (!imagesOnly || item.type === 'image') &&
      <div key={item.id} className="card-layout-row" data-layout-editor-id={item.id}>
      <div className="card-layout-actions">
        <strong>{item.type === 'exercise' ? tr('Упражнение') : item.type === 'image' ? tr('Изображение') : tr('Текстовый блок')}</strong>
        <button type="button" className="btn-secondary" disabled={!position}
          aria-label={tr('Переместить вверх')} onClick={() => update(current => moveLayout(current, item.id, -1))}>↑</button>
        <button type="button" className="btn-secondary" disabled={position === card.layout.length - 1}
          aria-label={tr('Переместить вниз')} onClick={() => update(current => moveLayout(current, item.id, 1))}>↓</button>
        {item.type !== 'exercise' && <button type="button" className="btn-secondary"
          onClick={() => {
            if (!imagesOnly || window.confirm(tr('Удалить этот блок?'))) update(current => removeLayout(current, item.id));
          }}>{tr('Удалить')}</button>}
      </div>
      {item.type === 'info' && card.info[item.index] && <>
        {card.info[item.index].type !== 'options' && <label>{tr('Роль блока')}
          <select className="form-input" value={card.info[item.index].type} onChange={event => {
            const type = event.target.value;
            update(current => patchInfoBlock(current, item.index, { type }));
          }}>{['text', 'task', 'source', 'example'].map(type => <option key={type} value={type}>{tr(labels[type] || type)}</option>)}</select>
        </label>}
        <Field name={card.info[item.index].type} value={card.info[item.index]} update={value => update(current => ({ ...current,
          info: current.info.map((block, index) => index === item.index ? value : block) }))} />
      </>}
      {item.type === 'image' && ['path', 'alt', 'caption'].map(field => <Field key={field}
        name={field} value={item[field] || ''} update={value => update(current => patchLayoutItem(current, item.id, { [field]: value }))} />)}
      {item.type !== 'exercise' && <label>{tr('Когда показывать')}
        <select className="form-input" value={item.visibility || 'before_answer'} onChange={event => {
          const visibility = event.target.value;
          update(current => patchLayoutItem(current, item.id, { visibility }));
        }}><option value="before_answer">{tr('До ответа')}</option><option value="after_answer">{tr('После ответа')}</option></select>
      </label>}
    </div>)}
    {!imagesOnly && <button type="button" className="btn-secondary"
      onClick={() => update(current => addLayoutInfo(current))}>{tr('Добавить текстовый блок')}</button>}
    <label className="card-form-text-field">{tr('Путь существующего медиа')}
      <input className="form-input" value={path} placeholder="images/example.webp" onChange={event => setPath(event.target.value)} />
    </label>
    <button type="button" className="btn-secondary" onClick={() => attach(path)} disabled={!path || uploading}>{tr('Добавить изображение')}</button>
    <label className="card-form-text-field">{uploading ? tr('Загрузка...') : tr('Загрузить изображение из файла')}
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={upload} />
    </label>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
const labels = {
  path: 'Путь медиа', alt: 'Альтернативный текст', caption: 'Подпись',
  prompt: 'Задание', text: 'Текст', source_text: 'Исходный текст', parts: 'Части задания',
  options: 'Варианты', items: 'Варианты', correct: 'Верный ответ', answers: 'Правильные ответы',
  accepted_answers: 'Допустимые ответы', pairs: 'Пары', left: 'Слева', right: 'Справа',
  info: 'Информационные блоки', topics: 'Темы',
  task: 'Задание', source: 'Подсказка', example: 'Пример', input: 'Ввод', choice: 'Выбор',
};

function Field({ name, value, update }) {
  const label = tr(labels[name] || name);
  if (Array.isArray(value)) {
    const choices = name === 'options' ? [{ text: '', correct: false }] : samples[name] || [''];
    return <fieldset className="card-form-text-field">
      <legend>{label}</legend>
      {value.map((item, index) => <div key={index}>
        <Field name={item?.type || `${label} ${index + 1}`} value={item}
          update={next => update(value.map((entry, i) => i === index ? next : entry))} />
        <button type="button" className="btn-secondary" aria-label={`${tr('Удалить')} ${label} ${index + 1}`}
          onClick={() => update(value.filter((_, i) => i !== index))}>{tr('Удалить')}</button>
      </div>)}
      {choices.map((sample, i) => <button key={i} type="button" className="btn-secondary"
        onClick={() => update([...value, structuredClone(sample)])}>
        {tr('Добавить')} {sample?.type ? tr(labels[sample.type] || sample.type) : label}
      </button>)}
    </fieldset>;
  }
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => key !== 'type').map(([key, field]) =>
    <Field key={key} name={key} value={field} update={next => update({ ...value, [key]: next })} />);
  if (typeof value === 'boolean') return <label>
    <input type="checkbox" checked={value} onChange={event => update(event.target.checked)} /> {label}
  </label>;
  return <label className="card-form-text-field">{label}
    {typeof value === 'number'
      ? <input className="form-input" type="number" min="0" value={value} onChange={event => update(event.target.valueAsNumber || 0)} />
      : <textarea className="textarea-preview" value={value ?? ''} onChange={event => update(event.target.value)} />}
  </label>;
}

export function CardTypeField({ card, update, visual }) {
  return <label className={visual ? 'visual-card-editor-type' : 'card-form-text-field'}>{tr('Тип карточки')}
    <select className="form-input" value={card.type} onChange={event => {
      const type = event.target.value;
      if (Object.values(card.data).some(Boolean) && !window.confirm(tr('Заменить поля текущего упражнения?'))) return;
      update(current => ({ ...current, type, data: newCardContent(type).card.data }));
    }}>{cardTypes.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select>
  </label>;
}

export function PromptDictation({ type, update }) {
  const prompt = promptField[type];
  const speech = useSpeechRecognition({
    resetKey: type, language: getInterfaceLanguage(), silenceTimeoutMs: null,
    onEnd: transcript => {
      if (transcript?.trim() && prompt) update(current => ({ ...current, data: { ...current.data,
        [prompt]: [current.data[prompt], transcript.trim()].filter(Boolean).join(' ') } }));
    },
  });
  return <>
    <button type="button" className="btn-secondary" onClick={() => speech.isListening ? speech.stop() : speech.start()}>
      {speech.isListening ? tr('Остановить диктовку') : tr('Диктовать')}
    </button>
    {speech.speechError && <p role="status">{speech.speechError}</p>}
  </>;
}

function CardTopics({ topics, update }) {
  const updateTopics = change => update(card => ({ ...card, topics: change(card.topics || []) }));
  return <details className="card-form-secondary visual-card-topics">
    <summary>{tr('Тема')}</summary>
    {topics.map((topic, index) => <div className="visual-card-topic-row" key={index}>
      <input type="text" className="form-input" aria-label={`${tr('Тема')} ${index + 1}`} value={topic}
        onChange={event => {
          const value = event.target.value;
          updateTopics(items => items.map((item, i) => i === index ? value : item));
        }} />
      <button type="button" className="visual-card-icon-control" aria-label={`${tr('Удалить тему')} ${index + 1}`}
        title={tr('Удалить тему')} onClick={() => updateTopics(items => items.filter((_, i) => i !== index))}>
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </div>)}
    <button type="button" className="visual-card-icon-control" aria-label={tr('Добавить тему')} title={tr('Добавить тему')}
      onClick={() => updateTopics(items => [...items, ''])}>
      <Plus size={16} aria-hidden="true" />
    </button>
  </details>;
}

export function StructuredCardExtras({ card, update, visual }) {
  if (visual) return <>
    <CardTopics topics={card.topics || []} update={update} />
    {card.info?.some(block => block.type === 'options') && <details className="card-form-secondary">
      <summary>{tr('Подсказки с вариантами')}</summary>
      {card.info.map((block, index) => block.type === 'options' && <Field
        key={index} name="items" value={block.items}
        update={items => update(current => patchInfoBlock(current, index, { items }))} />)}
    </details>}
    <details>
      <summary>{tr('Изображения')}</summary>
      <LayoutFields card={card} update={update} imagesOnly />
    </details>
  </>;
  return <>
    <details>
      <summary>{tr('Информационные блоки и темы')}</summary>
      {!card.layout && <Field name="info" value={card.info || []} update={info => update(current => ({ ...current, info }))} />}
      <Field name="topics" value={card.topics || []} update={topics => update(current => ({ ...current, topics }))} />
    </details>
    <LayoutFields card={card} update={update} />
  </>;
}

export function StructuredCardFields({ card, update, dictation, textStyle }) {
  const { type, data } = card;
  const prompt = promptField[type];
  const [preview, setPreview] = useState(null);
  const [previewAfterAnswer, setPreviewAfterAnswer] = useState(false);
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
  return <>
    {prompt && <div className="card-form-text-field">
      <label htmlFor="card-editor-front">{tr(labels[prompt])}</label>
      <textarea id="card-editor-front" className="textarea-preview" value={data[prompt]} style={textStyle}
        onChange={event => {
          const value = event.target.value;
          update(current => ({ ...current, data: { ...current.data, [prompt]: value } }));
        }} />
      {dictation}
    </div>}
    {Object.entries(data).filter(([key]) => key !== prompt && key !== answerField[type] && key !== 'grading_policy')
      .map(([key, value]) => <Field key={key} name={key} value={value}
        update={next => update(current => ({ ...current, data: { ...current.data, [key]: next } }))} />)}
    <StructuredCardExtras card={card} update={update} />
    <button type="button" className="btn-secondary" onClick={togglePreview} disabled={activePreview?.loading}>
      {activePreview?.content ? tr('Скрыть предпросмотр') : tr('Показать предпросмотр')}
    </button>
    {activePreview?.error && <p role="alert">{activePreview.error}</p>}
    {activePreview?.content && <>
      <label><input type="checkbox" checked={previewAfterAnswer} onChange={event => setPreviewAfterAnswer(event.target.checked)} />
        {tr('Предпросмотр после ответа')}</label>
      <fieldset disabled>
      <ExerciseRenderer previewAfterAnswer={previewAfterAnswer} card={{ content_v2: activePreview.content }} fallback={
        <KaraokeText text={studySideText(activePreview.content.card)} style={textStyle} />
      } />
      </fieldset>
    </>}
  </>;
}
