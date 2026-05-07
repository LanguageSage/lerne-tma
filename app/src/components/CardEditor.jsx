import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Volume2, RefreshCw, Search, Upload, X, Sparkles } from 'lucide-react';
import { CardBackground } from './common/CardBackground';
import { getTextShadow, getContextShadow } from '../utils/style';

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
  generateAudioInternal,
  uploadImage,
  uploadCardVideo,
  playAudio,
  saveCard,
  loading,
  cardFont,
  cardTextColor,
  cardFontWeight,
  cardFontStyle,
  cardBgFront,
  cardBgBack,
  contextFont,
  contextTextColor,
  contextFontSize,
  contextFontWeight,
  contextFontStyle,
  cardFontSize,
  cardTextShadow,
  contextTextShadow,
}) => {
  const imageInputRef = useRef(null);
  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const contextRef = useRef(null);

  const autoResize = (ref) => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  };

  useEffect(() => { autoResize(frontRef); }, [editingCard?.front]);
  useEffect(() => { autoResize(backRef); }, [editingCard?.back]);
  useEffect(() => { autoResize(contextRef); }, [editingCard?.context]);

  const handleAiGenerate = async () => {
    if (!editingCard?.front) return;
    const result = await runAiGenerator(editingCard.front, true);
    if (result) {
      const updated = {
        ...editingCard,
        front: result.front || editingCard.front,
        back: result.back || editingCard.back,
        context: result.context || editingCard.context
      };
      setEditingCard(updated);
      
      // Auto-generate audio after AI generation
      setTimeout(() => {
        generateAudioInternal(updated, setEditingCard);
      }, 500);
    }
  };

  if (view !== 'editor') return null;

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, editingCard?.id || 0);
  const resolvedBgBack = getResolvedStyle(cardBgBack, editingCard?.id || 0);

  const imageValue = editingCard?.image_path || editingCard?.image_url || '';
  const imagePreviewUrl = editingCard?.image_url
    || (imageValue.startsWith('images/') ? `/api/media/${imageValue}` : imageValue);

  return (
    <div className="view-editor">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView(editorSourceView)}><ChevronLeft size={24} /></button>
          <h2>Правка карточки</h2>
        </div>
        
        <div className="editor-form glass">
          <div className="form-group">
            <label>Текст (Front)</label>
            <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              <CardBackground styleType={resolvedBgFront} />
              <textarea 
                ref={frontRef}
                value={editingCard?.front || ''} 
                onChange={e => setEditingCard({...editingCard, front: e.target.value})}
                style={{ 
                  fontFamily: cardFont, 
                  fontWeight: cardFontWeight, 
                  fontStyle: cardFontStyle,
                  fontSize: `${cardFontSize}rem`,
                  color: cardTextColor,
                  textShadow: getTextShadow(cardTextShadow, cardTextColor),
                  background: 'transparent',
                  position: 'relative',
                  zIndex: 2,
                  minHeight: '100px',
                  border: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  width: '100%',
                  display: 'block'
                }}
                placeholder="Слово или фраза..."
              />
            </div>
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

          <div className="ai-quick-actions">
            <button 
              className="btn-ai-generate" 
              onClick={handleAiGenerate}
              disabled={loading || !editingCard?.front}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : <Sparkles size={18} />}
              <span>Сгенерировать ответ</span>
            </button>
          </div>

          <div className="form-group">
            <label>Видео (Лицо)</label>
            {editingCard?.video_front_url && (
              <div className="media-preview-mini">
                <video src={editingCard.video_front_url} muted loop autoPlay />
                <button className="media-clear-btn" onClick={() => setEditingCard({...editingCard, video_front_path: '', video_front_url: ''})}><X size={12} /></button>
              </div>
            )}
            <button className="btn-secondary btn-tiny" onClick={() => videoFrontRef.current?.click()} disabled={loading}>
              {editingCard?.video_front_url ? 'Заменить видео' : 'Добавить видео'}
            </button>
            <input ref={videoFrontRef} type="file" accept="video/mp4" className="hidden-file-input" onChange={e => {
              uploadCardVideo(e.target.files?.[0], editingCard, 'front');
              e.target.value = '';
            }} />
          </div>

          <div className="form-group">
            <label>Перевод (Back)</label>
            <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              <CardBackground styleType={resolvedBgBack} />
              <textarea 
                ref={backRef}
                value={editingCard?.back || ''} 
                onChange={e => setEditingCard({...editingCard, back: e.target.value})}
                style={{ 
                  fontFamily: cardFont, 
                  fontWeight: cardFontWeight, 
                  fontStyle: cardFontStyle,
                  fontSize: `${cardFontSize}rem`,
                  color: cardTextColor,
                  textShadow: getTextShadow(cardTextShadow, cardTextColor),
                  background: 'transparent',
                  position: 'relative',
                  zIndex: 2,
                  minHeight: '80px',
                  border: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  width: '100%',
                  display: 'block'
                }}
                placeholder="Перевод..."
              />
            </div>
            
            {/* Видео Оборот */}
            <div className="media-upload-section" style={{ marginTop: '10px' }}>
              <label className="sub-label">Видео (Оборот)</label>
              {editingCard?.video_back_url && (
                <div className="media-preview-mini">
                  <video src={editingCard.video_back_url} muted loop autoPlay />
                  <button className="media-clear-btn" onClick={() => setEditingCard({...editingCard, video_back_path: '', video_back_url: ''})}><X size={12} /></button>
                </div>
              )}
              <button className="btn-secondary btn-tiny" onClick={() => videoBackRef.current?.click()} disabled={loading}>
                {editingCard?.video_back_url ? 'Заменить видео' : 'Добавить видео'}
              </button>
              <input ref={videoBackRef} type="file" accept="video/mp4" className="hidden-file-input" onChange={e => {
                uploadCardVideo(e.target.files?.[0], editingCard, 'back');
                e.target.value = '';
              }} />
            </div>
          </div>

          <div className="form-group">
            <label>Контекст / Анализ</label>
            <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              <CardBackground styleType={resolvedBgBack} />
              <textarea 
                ref={contextRef}
                className="context-textarea"
                value={editingCard?.context || ''} 
                onChange={e => setEditingCard({...editingCard, context: e.target.value})}
                style={{ 
                  fontFamily: contextFont, 
                  fontSize: `${contextFontSize}rem`,
                  color: contextTextColor,
                  fontWeight: contextFontWeight,
                  fontStyle: contextFontStyle,
                  textShadow: getContextShadow(contextTextShadow, contextTextColor),
                  background: 'transparent',
                  position: 'relative',
                  zIndex: 2,
                  minHeight: '120px',
                  border: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  width: '100%',
                  display: 'block'
                }}
                placeholder="Примеры, грамматика..."
              />
            </div>
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

          <button className="btn btn-primary btn-full" onClick={() => saveCard()} disabled={loading}>
            {loading ? <RefreshCw className="spin" /> : 'Сохранить'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
