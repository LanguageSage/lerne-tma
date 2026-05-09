import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, RefreshCw, Volume2, Image as ImageIcon, Camera, Upload, X, Search } from 'lucide-react';
import { CardBackground } from './CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { useMediaUpload } from '../../hooks/useMediaUpload';
import { cleanMedia } from '../../utils/media';

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
  const { uploadCreatorImage, uploadVideo } = useMediaUpload();

  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  
  const frontRef = useRef(null);
  const backRef = useRef(null);
  const contextRef = useRef(null);
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const videoFrontRef = useRef(null);
  const videoBackRef = useRef(null);

  const stopCamera = () => {
    cameraStreamRef.current?.getTracks().forEach(track => track.stop());
    cameraStreamRef.current = null;
  };

  const closeCamera = () => {
    stopCamera();
    setIsCameraOpen(false);
    setCameraError('');
  };

  const openCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraInputRef.current?.click();
      return;
    }
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }
      cameraStreamRef.current = stream;
      setIsImagePickerOpen(false);
      setIsCameraOpen(true);
    } catch (err) {
      console.error('Camera open failed:', err);
      setCameraError('Камера недоступна.');
      cameraInputRef.current?.click();
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
      uploadCreatorImage(file, cardData, setCardData);
      closeCamera();
    }, 'image/jpeg', 0.9);
  };

  useEffect(() => {
    if (isCameraOpen && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
      videoRef.current.play().catch(console.error);
    }
  }, [isCameraOpen]);

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
      
      {/* TOOLBAR FOR MEDIA */}
      <div className="form-toolbar" style={{ display: 'flex', gap: '10px', marginBottom: '15px', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="header-action-btn"
          onClick={() => setIsImagePickerOpen(true)}
          title="Добавить картинку"
          style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '8px', cursor: 'pointer', color: 'white' }}
        >
          <ImageIcon size={22} />
        </button>
        <button 
          className="header-action-btn" 
          onClick={() => onGenerateAudio(cardData, setCardData)}
          disabled={loading}
          title="Озвучить"
          style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '8px', padding: '8px', cursor: 'pointer', color: 'white' }}
        >
          <Volume2 size={22} />
        </button>
      </div>

      <div className="form-group">
        <div id="tut-creator-front" className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
          <CardBackground styleType={resolvedBgFront} />
          <textarea 
            ref={frontRef}
            autoFocus={isCreator}
            value={cardData.front || ''} 
            onChange={e => setCardData({...cardData, front: e.target.value})}
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
              display: 'block',
              boxSizing: 'border-box',
              padding: '12px'
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
              <RefreshCw size={14} />
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
            value={cardData.back || ''} 
            onChange={e => setCardData({...cardData, back: e.target.value})}
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
              display: 'block',
              boxSizing: 'border-box',
              padding: '12px'
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
            value={cardData.context || ''} 
            onChange={e => setCardData({...cardData, context: e.target.value})}
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
              display: 'block',
              boxSizing: 'border-box',
              padding: '12px'
            }}
            placeholder="Примеры, грамматика..."
          />
        </div>
      </div>

      {/* MODALS FOR CAMERA / IMAGE PICKER */}
      <AnimatePresence>
        {isImagePickerOpen && (
          <motion.div
            className="image-picker-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsImagePickerOpen(false)}
          >
            <motion.div
              className="image-picker-dialog glass"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="image-picker-header">
                <h3>Картинка</h3>
                <button
                  type="button"
                  className="image-picker-close"
                  onClick={() => setIsImagePickerOpen(false)}
                  title="Закрыть"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="image-picker-actions">
                <button
                  type="button"
                  className="image-picker-tile"
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={loading}
                >
                  <Upload size={24} />
                  <span>Галерея</span>
                </button>
                <button
                  type="button"
                  className="image-picker-tile"
                  onClick={openCamera}
                  disabled={loading}
                >
                  <Camera size={24} />
                  <span>Фото</span>
                </button>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(cardData?.front || '')}&tbm=isch`}
                  target="_blank"
                  rel="noreferrer"
                  className="image-picker-tile image-picker-tile-wide"
                  onClick={() => setIsImagePickerOpen(false)}
                >
                  <Search size={24} />
                  <span>Поиск Google</span>
                </a>
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden-file-input"
                onChange={e => {
                  uploadCreatorImage(e.target.files?.[0], cardData, setCardData);
                  e.target.value = '';
                  setIsImagePickerOpen(false);
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden-file-input"
                onChange={e => {
                  uploadCreatorImage(e.target.files?.[0], cardData, setCardData);
                  e.target.value = '';
                  setIsImagePickerOpen(false);
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCameraOpen && (
          <div className="camera-overlay" onClick={closeCamera}>
            <div className="camera-capture-dialog" onClick={e => e.stopPropagation()}>
              <div className="image-picker-header">
                <h3>Фото</h3>
                <button
                  type="button"
                  className="image-picker-close"
                  onClick={closeCamera}
                  title="Закрыть"
                >
                  <X size={18} />
                </button>
              </div>
              {cameraError ? (
                <p className="camera-error">{cameraError}</p>
              ) : (
                <video
                  ref={videoRef}
                  className="camera-preview"
                  autoPlay
                  playsInline
                  muted
                />
              )}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              <div className="camera-actions">
                <button type="button" className="btn-secondary" onClick={closeCamera}>
                  Отмена
                </button>
                <button type="button" className="btn btn-primary" onClick={capturePhoto} disabled={loading || !!cameraError}>
                  <Camera size={18} /> Снять
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
