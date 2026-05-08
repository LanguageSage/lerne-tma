import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Volume2, RefreshCw, Search, Upload, X, Sparkles, Settings, ImageIcon } from 'lucide-react';
import { CardBackground } from './common/CardBackground';
import { getTextShadow, getContextShadow } from '../utils/style';

export const CardEditor = ({
  view,
  editorSourceView,
  setView,
  editingCard,
  setEditingCard,
  runAiGenerator,
  stopAiGeneration,
  generateAudioInternal,
  uploadImage,
  uploadCardVideo,
  playAudio,
  saveCard,
  loading,
  setIsSettingsOpen,
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
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const contextRef = useRef(null);
  const galleryInputRef = useRef(null);
  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);

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

  const imagePreviewUrl = editingCard?.image_url || (editingCard?.image_path?.startsWith('images/') ? `/api/media/${editingCard.image_path}` : editingCard?.image_path);

  return (
    <div className="view-editor">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={() => setView(editorSourceView)}><ChevronLeft size={24} /></button>
          <h2>Правка карточки</h2>
          <div className="header-actions">
            <button
              type="button"
              className="edit-btn-study"
              onClick={() => galleryInputRef.current?.click()}
              title="Добавить картинку"
            >
              <ImageIcon size={20} />
            </button>
            <button 
              className="edit-btn-study" 
              onClick={() => setIsSettingsOpen(true)}
              title="Настройки"
            >
              <Settings size={20} />
            </button>
            <button 
              className="edit-btn-study" 
              onClick={() => generateAudioInternal(editingCard, setEditingCard)}
              disabled={loading || !editingCard?.front}
              title="Озвучить"
            >
              <Volume2 size={20} />
            </button>
          </div>
        </div>

        <div className="creator-form glass">
          <div className="form-group">
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
                  color: cardTextColor,
                  fontSize: `${cardFontSize}rem`,
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
                placeholder="Слово или фраза (Front)..."
              />
              
              {imagePreviewUrl && (
                <div className="image-preview-box" style={{ margin: '10px', position: 'relative', zIndex: 3 }}>
                  <img src={imagePreviewUrl} alt="" style={{ maxWidth: '100%', borderRadius: '8px' }} />
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

              {(editingCard?.audio_path || editingCard?.audio_url) && (
                <button 
                  className="btn-secondary btn-small play-preview-btn" 
                  style={{ position: 'absolute', bottom: '10px', right: '10px', zIndex: 4 }}
                  onClick={() => playAudio(editingCard.audio_url || `/api/media/${editingCard.audio_path}`)}
                >
                  <RefreshCw size={14} />
                </button>
              )}
            </div>
          </div>
  
          <div className="ai-quick-actions" style={{ gap: '10px' }}>
            <button 
              className={`btn-ai-generate ${loading ? 'loading' : ''}`} 
              onClick={loading ? stopAiGeneration : handleAiGenerate}
              disabled={!loading && !editingCard?.front}
              style={{ flex: 1 }}
            >
              {loading ? (
                <>
                  <RefreshCw className="spin" size={18} />
                  <span>Стоп генерация</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  <span>Генерировать</span>
                </>
              )}
            </button>
            <button 
              className="btn btn-primary" 
              onClick={() => saveCard()} 
              disabled={loading || !editingCard?.front}
              style={{ padding: '12px 20px' }}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : 'Сохранить'}
            </button>
          </div>

          <div className="form-group">
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
                  color: cardTextColor,
                  fontSize: `${cardFontSize}rem`,
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
          </div>

          <div className="form-group">
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

          {/* Видео секции */}
          <div className="media-edit-group" style={{ display: 'flex', gap: '10px' }}>
             <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '5px' }}>Видео (Лицо)</label>
                {editingCard?.video_front_url && (
                  <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                    <video src={editingCard.video_front_url} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '4px', color: 'white' }} onClick={() => setEditingCard({...editingCard, video_front_path: '', video_front_url: ''})}><X size={10} /></button>
                  </div>
                )}
                <button className="btn-secondary btn-tiny" onClick={() => videoFrontRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
                  {editingCard?.video_front_url ? 'Заменить' : '+ Видео'}
                </button>
                <input ref={videoFrontRef} type="file" accept="video/mp4" className="hidden-file-input" style={{ display: 'none' }} onChange={e => uploadCardVideo(e.target.files?.[0], editingCard, 'front')} />
             </div>
             <div className="form-group" style={{ flex: 1 }}>
                <label style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: '5px' }}>Видео (Оборот)</label>
                {editingCard?.video_back_url && (
                  <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                    <video src={editingCard.video_back_url} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '4px', color: 'white' }} onClick={() => setEditingCard({...editingCard, video_back_path: '', video_back_url: ''})}><X size={10} /></button>
                  </div>
                )}
                <button className="btn-secondary btn-tiny" onClick={() => videoBackRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
                  {editingCard?.video_back_url ? 'Заменить' : '+ Видео'}
                </button>
                <input ref={videoBackRef} type="file" accept="video/mp4" className="hidden-file-input" style={{ display: 'none' }} onChange={e => uploadCardVideo(e.target.files?.[0], editingCard, 'back')} />
             </div>
          </div>
        </div>
        
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          className="hidden-file-input"
          style={{ display: 'none' }}
          onChange={e => {
            uploadImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </motion.div>
    </div>
  );
};
