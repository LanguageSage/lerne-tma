import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RefreshCw, Volume2, Image as ImageIcon, Camera, Upload, X, Search } from 'lucide-react';
import { CardBackground } from './CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { useMediaUpload } from '../../hooks/useMediaUpload';
import { cleanMedia } from '../../utils/media';
import { MediaPicker } from './MediaPicker';
import { useDeckStore } from '../../store/useDeckStore';

export const CardForm = ({
  cardData,
  setCardData,
  onSave,
  onAiGenerate,
  onGenerateAudio,
  playAudio,
  isCreator = false
}) => {
  const { 
    cardFont, cardTextColor, cardFontWeight, cardFontStyle, cardFontSize, cardTextShadow,
    cardBgFront, cardBgBack,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow
  } = useSettingsStore();

  const { loading } = useUiStore();
  const { decks } = useDeckStore();
  const { uploadCreatorImage, uploadVideo } = useMediaUpload();

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const contextRef = useRef(null);
  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);

  const autoResize = (ref) => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    const handleResize = () => {
      autoResize(frontRef);
      autoResize(backRef);
      autoResize(contextRef);
    };
    window.addEventListener('resize', handleResize);
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => { autoResize(frontRef); }, [cardData?.front, cardFontSize, cardFont, cardFontWeight, cardFontStyle]);
  useEffect(() => { autoResize(backRef); }, [cardData?.back, cardFontSize, cardFont, cardFontWeight, cardFontStyle]);
  useEffect(() => { autoResize(contextRef); }, [cardData?.context, contextFontSize, contextFont, contextFontWeight, contextFontStyle]);

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, cardData?.id || 0);
  const resolvedBgBack = getResolvedStyle(cardBgBack, cardData?.id || 0);

  if (!cardData) return null;

  return (
    <div className="creator-form glass" style={{ marginTop: '20px' }}>
      
      {isCreator && (
        <div className="form-group" style={{ marginBottom: '15px' }}>
          <label className="sub-label">Выберите колоду</label>
          <select 
            className="form-input" 
            value={cardData.deck_id || ''} 
            onChange={(e) => setCardData({...cardData, deck_id: parseInt(e.target.value)})}
            style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
          >
            <option value="" disabled>-- Выберите колоду --</option>
            {decks.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* TOOLBAR FOR MEDIA */}
      <div className="form-toolbar form-toolbar-custom">
        <button
          type="button"
          className="form-toolbar-btn"
          onClick={() => setIsImagePickerOpen(true)}
          title="Добавить картинку"
        >
          <ImageIcon size={22} />
        </button>
        <button 
          className="form-toolbar-btn" 
          onClick={() => onGenerateAudio(cardData, setCardData, playAudio)}
          disabled={loading}
          title="Озвучить"
        >
          <Volume2 size={22} />
        </button>
      </div>

      <div className="form-group">
        <div id="tut-creator-front" className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
          <CardBackground styleType={resolvedBgFront} />
          <textarea 
            ref={frontRef}
            className="textarea-preview textarea-front-preview"
            autoFocus={isCreator}
            value={cardData.front || ''} 
            onChange={e => setCardData({...cardData, front: e.target.value})}
            style={{ 
              fontFamily: cardFont, 
              fontWeight: cardFontWeight, 
              fontStyle: cardFontStyle,
              color: cardTextColor,
              fontSize: `${cardFontSize}rem`,
              textShadow: getTextShadow(cardTextShadow, cardTextColor)
            }}
            placeholder="Слово или фраза (Front)..."
          />
          
          {(cardData.image_url || cardData.image_path) && (
            <div className="image-preview-box" style={{ margin: '10px', position: 'relative', zIndex: 3 }}>
              <img src={cardData.image_url || `/api/media/${cardData.image_path}`} alt="" style={{ maxWidth: '100%', borderRadius: '8px' }} />
              <button
                type="button"
                className="image-clear-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setCardData({...cardData, image_path: '', image_url: ''});
                }}
                title="Убрать картинку"
              >
                <X size={20} />
              </button>
            </div>
          )}

          {(cardData.audio_path || cardData.audio_url) && (
            <button 
              className="btn-secondary btn-small play-preview-btn" 
              style={{ position: 'absolute', bottom: '10px', right: '10px', zIndex: 4 }}
              onClick={() => playAudio(cardData.audio_url || `/api/media/${cardData.audio_path}`)}
            >
              <Volume2 size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="ai-quick-actions" style={{ gap: '10px' }}>
        <button 
          id="tut-creator-ai"
          className={`btn-ai-generate ${loading ? 'loading' : ''}`} 
          onClick={onAiGenerate}
          disabled={loading || !cardData.front}
          style={{ flex: 1 }}
        >
          {loading ? (
            <>
              <RefreshCw className="spin" size={18} />
              <span>Генерация...</span>
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
          onClick={onSave} 
          disabled={loading}
          style={{ padding: '12px 20px' }}
        >
          {loading ? <RefreshCw className="spin" size={18} /> : 'Сохранить'}
        </button>
      </div>

      <div className="media-edit-group" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
         <div className="form-group" style={{ flex: 1 }}>
            <label className="sub-label">Видео (Лицо)</label>
            {(cardData.video_front_url || cardData.video_front_path) && (
              <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                <video src={cardData.video_front_url || `/api/media/${cardData.video_front_path}`} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button 
                  className="image-clear-btn" 
                  style={{ top: '5px', right: '5px', width: '32px', height: '32px' }} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardData({...cardData, video_front_path: '', video_front_url: ''});
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <button className="btn-secondary btn-tiny" onClick={() => videoFrontRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
              <Upload size={14} /> Выбрать
            </button>
            <input ref={videoFrontRef} type="file" accept="video/*" className="hidden-file-input" onChange={e => uploadVideo(e.target.files?.[0], cardData, setCardData, 'front')} />
         </div>
         <div className="form-group" style={{ flex: 1 }}>
            <label className="sub-label">Видео (Оборот)</label>
            {(cardData.video_back_url || cardData.video_back_path) && (
              <div className="media-preview-mini" style={{ position: 'relative', height: '60px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                <video src={cardData.video_back_url || `/api/media/${cardData.video_back_path}`} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button 
                  className="image-clear-btn" 
                  style={{ top: '5px', right: '5px', width: '32px', height: '32px' }} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardData({...cardData, video_back_path: '', video_back_url: ''});
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <button className="btn-secondary btn-tiny" onClick={() => videoBackRef.current?.click()} style={{ width: '100%', marginTop: '5px' }}>
              <Upload size={14} /> Выбрать
            </button>
            <input ref={videoBackRef} type="file" accept="video/*" className="hidden-file-input" onChange={e => uploadVideo(e.target.files?.[0], cardData, setCardData, 'back')} />
         </div>
      </div>

      <div className="form-group">
        <div className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
          <CardBackground styleType={resolvedBgBack} />
          <textarea 
            ref={backRef}
            className="textarea-preview textarea-back-preview"
            value={cardData.back || ''} 
            onChange={e => setCardData({...cardData, back: e.target.value})}
            style={{ 
              fontFamily: cardFont, 
              fontWeight: cardFontWeight, 
              fontStyle: cardFontStyle,
              color: cardTextColor,
              fontSize: `${cardFontSize}rem`,
              textShadow: getTextShadow(cardTextShadow, cardTextColor)
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
            className="context-textarea textarea-preview textarea-context-preview"
            value={cardData.context || ''} 
            onChange={e => setCardData({...cardData, context: e.target.value})}
            style={{ 
              fontFamily: contextFont, 
              fontSize: `${contextFontSize}rem`,
              color: contextTextColor,
              fontWeight: contextFontWeight,
              fontStyle: contextFontStyle,
              textShadow: getContextShadow(contextTextShadow, contextTextColor)
            }}
            placeholder="Примеры, грамматика..."
          />
        </div>
      </div>

      {/* MODALS FOR CAMERA / IMAGE PICKER */}
      <MediaPicker 
        isOpen={isImagePickerOpen}
        onClose={() => setIsImagePickerOpen(false)}
        onImageUpload={(file) => uploadCreatorImage(file, cardData, setCardData)}
        searchQuery={cardData?.front || ''}
        loading={loading}
      />
    </div>
  );
};
