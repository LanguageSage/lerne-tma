import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { getInterfaceLanguage, tr } from '../../i18n/locale';
import { useSpeechRecognitionCore } from '../../hooks/useSpeechRecognitionCore';
import { cardTypes, newCardContent, promptField, cardWriteError } from '../../utils/cardDraft';
import { patchInfoBlock, patchLayoutItem } from '../../utils/cardLayout';
import './StructuredCardFields.css';

function CardImages({ card, update, attachImage, uploadLayoutImage }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const uploadRequest = useRef(null);
  useEffect(() => () => { uploadRequest.current?.abort(); uploadRequest.current = null; }, []);
  const imagePath = /^images\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
  const canUploadFile = typeof uploadLayoutImage === 'function';
  const attach = value => {
    if (!imagePath.test(value)) { setError(tr('Укажите путь images/имя-файла.')); return; }
    attachImage(value);
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
      if (!canUploadFile) {
        throw new Error(tr('Загрузка изображений недоступна в текущем режиме.'));
      }
      const uploaded = await uploadLayoutImage(file, request.signal);
      const uploadedPath = typeof uploaded === 'string'
        ? uploaded
        : (uploaded?.relativePath || uploaded?.path);
      if (!request.signal.aborted && uploadedPath) attach(uploadedPath);
    } catch (failure) { if (!request.signal.aborted) setError(cardWriteError(failure)); }
    finally { if (uploadRequest.current === request) { uploadRequest.current = null; setUploading(false); } }
  };
  return <fieldset className="card-layout-editor">
    {card.layout?.filter(item => item.type === 'image').map(item =>
      <div key={item.id} className="card-layout-row">
        <strong>{tr('Изображение')}</strong>
        {['path', 'alt', 'caption'].map(field => <Field key={field} name={field}
          value={item[field] || ''} update={value => update(current => patchLayoutItem(current, item.id, { [field]: value }))} />)}
      </div>)}
    <label className="card-form-text-field">{tr('Путь существующего медиа')}
      <input className="form-input" value={path} placeholder="images/example.webp" onChange={event => setPath(event.target.value)} />
    </label>
    <button type="button" className="btn-secondary" onClick={() => attach(path)} disabled={!path || uploading}>{tr('Добавить изображение')}</button>
    {canUploadFile && (
      <label className="card-form-text-field">{uploading ? tr('Загрузка...') : tr('Загрузить изображение из файла')}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={upload} />
      </label>
    )}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
const labels = {
  path: 'Путь медиа', alt: 'Альтернативный текст', caption: 'Подпись',
  items: 'Варианты',
};

function Field({ name, value, update }) {
  const label = tr(labels[name] || name);
  if (Array.isArray(value)) {
    return <fieldset className="card-form-text-field">
      <legend>{label}</legend>
      {value.map((item, index) => <div key={index}>
        <Field name={`${label} ${index + 1}`} value={item}
          update={next => update(value.map((entry, i) => i === index ? next : entry))} />
        <button type="button" className="btn-secondary" aria-label={`${tr('Удалить')} ${label} ${index + 1}`}
          onClick={() => update(value.filter((_, i) => i !== index))}>{tr('Удалить')}</button>
      </div>)}
      <button type="button" className="btn-secondary" onClick={() => update([...value, ''])}>
        {tr('Добавить')} {label}
      </button>
    </fieldset>;
  }
  return <label className="card-form-text-field">{label}
    <textarea className="textarea-preview" value={value ?? ''} onChange={event => update(event.target.value)} />
  </label>;
}

export function CardTypeField({ card, update }) {
  return <label className="visual-card-editor-type">{tr('Тип карточки')}
    <select className="form-input" value={card.type} onChange={event => {
      const type = event.target.value;
      if (Object.values(card.data).some(Boolean) && !window.confirm(tr('Заменить поля текущего упражнения?'))) return;
      update(current => ({ ...current, type, data: newCardContent(type).card.data }));
    }}>{cardTypes.map(kind => <option key={kind} value={kind}>{kind}</option>)}</select>
  </label>;
}

export function PromptDictation({ type, update }) {
  const prompt = promptField[type];
  const speech = useSpeechRecognitionCore({
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

export function StructuredCardExtras({ card, update, attachImage, uploadLayoutImage, lockLayout = false }) {
  const layoutImages = Array.isArray(card.layout) ? card.layout.filter(item => item.type === 'image') : [];
  return <>
    <CardTopics topics={card.topics || []} update={update} />
    {card.info?.some(block => block.type === 'options') && <details className="card-form-secondary">
      <summary>{tr('Подсказки с вариантами')}</summary>
      {card.info.map((block, index) => block.type === 'options' && <Field
        key={index} name="items" value={block.items}
        update={items => update(current => patchInfoBlock(current, index, { items }))} />)}
    </details>}
    <details>
      <summary>{tr('Изображения')}</summary>
      {lockLayout ? (
        <div className="card-layout-editor card-layout-editor-locked" data-testid="standalone-layout-images-locked">
          <p style={{ margin: '0 0 6px', fontSize: '0.85rem', lineHeight: 1.4 }}>
            {tr('Добавление и изменение изображений в макете (layout) требует визуального редактора дизайна. Для обложки карточки используйте кнопку «Картинка» в разделе «Медиа и оформление».')}
          </p>
          {layoutImages.length > 0 && (
            <ul style={{ margin: 0, paddingInlineStart: '18px', fontSize: '0.8rem', opacity: 0.85, overflowWrap: 'anywhere' }}>
              {layoutImages.map(item => (
                <li key={item.id}>{item.path}{item.caption ? ` — ${item.caption}` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <CardImages card={card} update={update} attachImage={attachImage} uploadLayoutImage={uploadLayoutImage} />
      )}
    </details>
  </>;
}
