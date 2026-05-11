import React, { useRef, useState } from 'react';
import { Sparkles, RefreshCw, Upload, X, Image as ImageIcon, Volume2 } from 'lucide-react';
import { MediaPicker } from './MediaPicker';
import { useDeckStore } from '../../store/useDeckStore';
import { CardBackground } from './CardBackground';
import { useSettingsStore } from '../../store/useSettingsStore';
import api from '../../services/api';

const styles = `
.textarea-preview {
  all: unset !important;
  display: block !important;
  width: 100% !important;
  box-sizing: border-box !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  padding: 4px !important;
  margin: 0 !important;
  text-align: center !important;
  word-wrap: break-word !important;
  white-space: pre-wrap !important;
  color: inherit !important;
  font-family: inherit !important;
  cursor: text;
}
`;

export const CardForm = ({
  cardData,
  setCardData,
  onSave,
  onAiGenerate,
  onGenerateAudio,
  playAudio,
  loading,
  isCreator = false
}) => {
  const { decks = [] } = useDeckStore();
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const contextRef = useRef(null);
  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);

  // Граб настройки со стора с защитой
  const settings = useSettingsStore();
  const { 
    cardFont = 'inherit', cardFontSize = 2, cardTextColor = '#fff', cardFontWeight = '400', cardFontStyle = 'normal', cardTextShadow = 'none',
    contextFont = 'inherit', contextFontSize = 1, contextTextColor = '#ccc', contextFontWeight = '400', contextFontStyle = 'normal', contextTextShadow = 'none',
    bgFront = 'default', bgBack = 'default', bgFrontType = 'preset', bgBackType = 'preset',
    getTextShadow = () => 'none', getContextShadow = () => 'none'
  } = settings || {};

  // Auto-resize textareas on mount/data change
  React.useEffect(() => {
    const adjustHeight = (ref) => {
      if (ref.current) {
        ref.current.style.height = 'auto';
        ref.current.style.height = ref.current.scrollHeight + 'px';
      }
    };
    adjustHeight(frontRef);
    adjustHeight(backRef);
    adjustHeight(contextRef);
  }, [cardData.id, cardData.front, cardData.back, cardData.context]);

  if (!cardData) return <div className="p-4 text-center">Загрузка данных...</div>;

  const resolvedBgFront = bgFrontType === 'preset' ? bgFront : (cardData.bg_front || bgFront);
  const resolvedBgBack = bgBackType === 'preset' ? bgBack : (cardData.bg_back || bgBack);

  // Media upload helpers
  const uploadVideo = async (file, side) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/media/upload-video', formData);
      if (res.data.path) {
        if (side === 'front') {
          setCardData({...cardData, video_front_path: res.data.path, video_front_url: res.data.url});
        } else {
          setCardData({...cardData, video_back_path: res.data.path, video_back_url: res.data.url});
        }
      }
    } catch (err) {
      console.error("Video upload error:", err);
    }
  };

  const uploadCreatorImage = async (file) => {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/media/upload-image', formData);
      if (res.data.path) {
        setCardData({
          ...cardData, 
          image_path: res.data.path, 
          image_url: res.data.url
        });
        setIsImagePickerOpen(false);
      }
    } catch (err) {
      console.error("Image upload error:", err);
    }
  };

  return (
    <div className="creator-form glass" style={{ marginTop: '10px', padding: '12px' }}>
      <style>{styles}</style>
      
      {isCreator && (
        <div className="form-group" style={{ marginBottom: '8px' }}>
          <label className="sub-label" style={{ marginBottom: '4px', fontSize: '0.75rem', opacity: 0.7 }}>ВЫБЕРИТЕ КОЛОДУ</label>
          <select 
            className="form-input" 
            value={cardData.deck_id || ''} 
            onChange={(e) => setCardData({...cardData, deck_id: parseInt(e.target.value)})}
            style={{ 
              width: '100%', 
              padding: '8px 12px', 
              borderRadius: '10px', 
              background: '#1e293b', 
              color: '#ffffff', 
              border: '1px solid rgba(255,255,255,0.1)',
              fontSize: '0.9rem',
              fontWeight: '500'
            }}
          >
            <option value="" disabled style={{ background: '#1e293b', color: '#ffffff' }}>-- Выберите колоду --</option>
            {decks.map(d => (
              <option key={d.id} value={d.id} style={{ background: '#1e293b', color: '#ffffff' }}>{d.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="form-toolbar form-toolbar-custom" style={{ marginBottom: '4px', justifyContent: 'flex-end', gap: '8px' }}>
        <button
          type="button"
          className="form-toolbar-btn"
          onClick={() => setIsImagePickerOpen(true)}
          style={{ width: '36px', height: '36px', padding: 0 }}
        >
          <ImageIcon size={18} />
        </button>
        <button 
          type="button"
          className="form-toolbar-btn" 
          onClick={() => onGenerateAudio(cardData, setCardData, playAudio)}
          disabled={loading}
          style={{ width: '36px', height: '36px', padding: 0 }}
        >
          <Volume2 size={18} />
        </button>
      </div>

      <div className="form-group" style={{ marginBottom: '0' }}>
        <div id="card-preview-front" className="card-container" style={{ height: 'auto', minHeight: '120px', aspectRatio: 'unset' }}>
          <div id="tut-creator-front" className="card-inner card-front glass" style={{ transform: 'none', height: 'auto' }}>
            <div className="card-face" style={{ position: 'relative', backfaceVisibility: 'visible', padding: '20px' }}>
              <CardBackground styleType={resolvedBgFront} />
              
              {cardData.video_front_url && (
                <div className="video-container-card">
                   <video src={cardData.video_front_url} autoPlay loop muted playsInline />
                </div>
              )}

              <textarea 
                ref={frontRef}
                className="text-front textarea-preview"
                autoFocus={isCreator}
                value={cardData.front || ''} 
                onChange={(e) => {
                  setCardData({...cardData, front: e.target.value});
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                placeholder="Текст на лицевой стороне"
                style={{ 
                  fontFamily: cardFont, 
                  fontWeight: cardFontWeight, 
                  fontStyle: cardFontStyle,
                  color: cardTextColor,
                  fontSize: `${cardFontSize}rem`,
                  textShadow: getTextShadow(cardTextShadow, cardTextColor)
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="ai-quick-actions" style={{ gap: '8px', marginTop: '4px', marginBottom: '8px' }}>
        <button 
          type="button"
          id="tut-creator-ai"
          className={`btn-ai-generate ${loading ? 'loading' : ''}`} 
          onClick={onAiGenerate}
          disabled={loading || !cardData.front}
          style={{ flex: 2, padding: '10px' }}
        >
          {loading ? (
            <>
              <RefreshCw className="spin" size={16} />
              <span>Жду...</span>
            </>
          ) : (
            <>
              <Sparkles size={16} />
              <span>Генерировать</span>
            </>
          )}
        </button>
        <button 
          type="button"
          className="btn btn-primary" 
          onClick={onSave} 
          disabled={loading}
          style={{ flex: 1, padding: '10px' }}
        >
          {loading ? <RefreshCw className="spin" size={16} /> : 'Сохранить'}
        </button>
      </div>

      <div className="media-edit-group" style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
         <div className="form-group" style={{ flex: 1 }}>
            <label className="sub-label" style={{ fontSize: '0.7rem' }}>ВИДЕО (ЛИЦО)</label>
            {(cardData.video_front_url || cardData.video_front_path) && (
              <div className="media-preview-mini" style={{ position: 'relative', height: '40px', borderRadius: '6px' }}>
                <video src={cardData.video_front_url || `/api/media/${cardData.video_front_path}`} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button 
                  type="button"
                  className="image-clear-btn" 
                  style={{ top: '2px', right: '2px', width: '24px', height: '24px' }} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardData({...cardData, video_front_path: '', video_front_url: ''});
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <button type="button" className="btn-secondary btn-tiny" onClick={() => videoFrontRef.current?.click()} style={{ width: '100%', marginTop: '4px', padding: '6px' }}>
              <Upload size={12} /> Выбрать
            </button>
            <input ref={videoFrontRef} type="file" accept="video/*" className="hidden-file-input" onChange={e => uploadVideo(e.target.files?.[0], 'front')} />
         </div>
         <div className="form-group" style={{ flex: 1 }}>
            <label className="sub-label" style={{ fontSize: '0.7rem' }}>ВИДЕО (ОБОРОТ)</label>
            {(cardData.video_back_url || cardData.video_back_path) && (
              <div className="media-preview-mini" style={{ position: 'relative', height: '40px', borderRadius: '6px' }}>
                <video src={cardData.video_back_url || `/api/media/${cardData.video_back_path}`} muted loop autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button 
                  type="button"
                  className="image-clear-btn" 
                  style={{ top: '2px', right: '2px', width: '24px', height: '24px' }} 
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardData({...cardData, video_back_path: '', video_back_url: ''});
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <button type="button" className="btn-secondary btn-tiny" onClick={() => videoBackRef.current?.click()} style={{ width: '100%', marginTop: '4px', padding: '6px' }}>
              <Upload size={12} /> Выбрать
            </button>
            <input ref={videoBackRef} type="file" accept="video/*" className="hidden-file-input" onChange={e => uploadVideo(e.target.files?.[0], 'back')} />
         </div>
      </div>

      <div className="form-group" style={{ marginBottom: '0' }}>
        <div id="card-preview-back" className="card-container" style={{ height: 'auto', minHeight: '120px', aspectRatio: 'unset' }}>
          <div className="card-inner card-back glass" style={{ transform: 'none', height: 'auto' }}>
            <div className="card-face" style={{ position: 'relative', backfaceVisibility: 'visible', padding: '20px' }}>
              <CardBackground styleType={resolvedBgBack} />
              <div className="card-face" style={{ padding: 0 }}>
                {cardData.video_back_url && (
                  <div className="video-container-card">
                    <video src={cardData.video_back_url} autoPlay loop muted playsInline />
                  </div>
                )}
                
                <textarea 
                  ref={backRef}
                  className="text-back textarea-preview"
                  value={cardData.back || ''} 
                  onChange={(e) => {
                    setCardData({...cardData, back: e.target.value});
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = e.target.scrollHeight + 'px';
                  }}
                  placeholder="Перевод"
                  style={{ 
                    fontFamily: cardFont, 
                    fontWeight: cardFontWeight, 
                    fontStyle: cardFontStyle,
                    color: cardTextColor,
                    fontSize: `${cardFontSize}rem`,
                    textShadow: getTextShadow(cardTextShadow, cardTextColor),
                    minHeight: '40px'
                  }}
                />

                {cardData.context && (
                  <>
                    <div style={{ width: '100%', height: '2px', background: 'rgba(255,255,255,0.3)', margin: '12px auto' }}></div>
                    <textarea 
                      ref={contextRef}
                      className="text-context textarea-preview"
                      value={cardData.context || ''} 
                      onChange={(e) => {
                        setCardData({...cardData, context: e.target.value});
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      onInput={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      placeholder="Контекст/Пример"
                      style={{ 
                        fontFamily: contextFont, 
                        fontSize: `${contextFontSize}rem`,
                        color: contextTextColor,
                        fontWeight: contextFontWeight,
                        fontStyle: contextFontStyle,
                        textShadow: getContextShadow(contextTextShadow, contextTextColor),
                        opacity: 0.8,
                        minHeight: '30px'
                      }}
                    />
                  </>
                )}

                {(cardData.audio_path || cardData.audio_url) && (
                  <button 
                    type="button"
                    className="audio-btn-back-corner" 
                    onClick={(e) => { e.stopPropagation(); playAudio(cardData.audio_url || `/api/media/${cardData.audio_path}`); }}
                  >
                    <Volume2 size={24} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <MediaPicker 
        isOpen={isImagePickerOpen}
        onClose={() => setIsImagePickerOpen(false)}
        onImageUpload={uploadCreatorImage}
        searchQuery={cardData?.front || ''}
        loading={loading}
      />
    </div>
  );
};
