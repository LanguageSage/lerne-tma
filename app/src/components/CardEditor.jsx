import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Volume2, RefreshCw, Search, Upload, X } from 'lucide-react';

export const CardEditor = ({
  view,
  editorSourceView,
  setView,
  editingCard,
  setEditingCard,
  isAiWizardOpen,
  setIsAiWizardOpen,
  aiInputPhrase,
  setAiInputPhrase,
  runAiGenerator,
  generateAudio,
  uploadImage,
  playAudio,
  saveCard,
  loading
}) => {
  const imageInputRef = useRef(null);

  if (view !== 'editor') return null;

  const imageValue = editingCard?.image_path || editingCard?.image_url || '';
  const imagePreviewUrl = editingCard?.image_url
    || (imageValue.startsWith('images/') ? `/api/media/${imageValue}` : imageValue);

  return (
    <div className="view-editor">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView(editorSourceView)}><ChevronLeft size={24} /></button>
          <h2>{editingCard?.id ? 'Правка карточки' : 'Новая карточка'}</h2>
        </div>
        
        <div className="editor-form glass">
          {!isAiWizardOpen ? (
            <button className="btn-secondary btn-full ai-magic-btn" onClick={() => setIsAiWizardOpen(true)}>
              ✨ AI Мастер карточек
            </button>
          ) : (
            <div className="ai-wizard-panel glass">
              <label>Введите фразу для генерации</label>
              <textarea autoFocus placeholder="Например: Ich habe am Wochenende viel gearbeitet" value={aiInputPhrase} onChange={e => setAiInputPhrase(e.target.value)} />
              <div className="ai-wizard-actions">
                <button className="btn btn-primary" onClick={runAiGenerator} disabled={loading}>
                  {loading ? "Думаю..." : "Сгенерировать"}
                </button>
                <button className="btn-secondary" onClick={() => setIsAiWizardOpen(false)}>Отмена</button>
              </div>
            </div>
          )}
          
          <div className="form-group">
            <label>Текст (Front)</label>
            <textarea 
              value={editingCard?.front || ''} 
              onChange={e => setEditingCard({...editingCard, front: e.target.value})}
            />
            <div className="editor-audio-actions">
              <button 
                className="btn-secondary btn-small" 
                onClick={generateAudio}
                disabled={loading || !editingCard?.front}
              >
                <Volume2 size={16} /> Озвучить
              </button>
              {(editingCard?.audio_path || editingCard?.audio_url) && (
                <button 
                  className="btn-secondary btn-small play-preview-btn" 
                  onClick={() => playAudio(editingCard.audio_url || `/api/media/${editingCard.audio_path}`)}
                >
                  <RefreshCw size={14} /> Прослушать
                </button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>Перевод (Back)</label>
            <textarea 
              value={editingCard?.back || ''} 
              onChange={e => setEditingCard({...editingCard, back: e.target.value})}
            />
          </div>

          <div className="form-group">
            <label>Контекст</label>
            <textarea 
              value={editingCard?.context || ''} 
              onChange={e => setEditingCard({...editingCard, context: e.target.value})}
            />
          </div>

          <div className="form-group">
            <label>Изображение</label>
            <div className="image-edit-tools">
              {imagePreviewUrl && (
                <div className="image-preview-box">
                  <img src={imagePreviewUrl} alt="" />
                  <button
                    type="button"
                    className="image-clear-btn"
                    onClick={() => setEditingCard({...editingCard, image_path: '', image_url: ''})}
                    title="Убрать картинку"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              <div className="image-actions-row">
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={loading}
                >
                  <Upload size={16} /> Загрузить
                </button>
                <a 
                  href={`https://www.google.com/search?q=${encodeURIComponent(editingCard?.front || '')}&tbm=isch`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="btn-secondary btn-small"
                >
                  <Search size={16} /> Google
                </a>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden-file-input"
                onChange={e => {
                  uploadImage(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <input 
                type="text" 
                placeholder="URL картинки..." 
                value={editingCard?.image_path || ''}
                onChange={e => setEditingCard({...editingCard, image_path: e.target.value})}
              />
            </div>
          </div>

          <button className="btn btn-primary btn-full" onClick={saveCard} disabled={loading}>
            {loading ? <RefreshCw className="spin" /> : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
