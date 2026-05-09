import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Sparkles, RefreshCw, Volume2, Image as ImageIcon, Camera, Upload, X, Search, Settings, Edit2, Plus } from 'lucide-react';
import { CardBackground } from './common/CardBackground';
import { getTextShadow, getContextShadow } from '../utils/style';
import { HelpButton } from './TutorialOverlay';

export const CardCreator = ({
  view,
  editorSourceView,
  setView,
  currentDeck,
  runAiGenerator,
  stopAiGeneration,
  generateAudioInternal,
  playAudio,
  saveCard,
  loading,
  setIsSettingsOpen,
  openCreator,
  startTutorial,
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
  uploadCreatorImage
}) => {
  const [newCardData, setNewCardData] = useState({
    front: '',
    back: '',
    context: '',
    audio_path: '',
    audio_url: '',
    image_path: '',
    image_url: '',
    deck_id: currentDeck?.id
  });

  const handleBack = () => {
    if (editorSourceView === 'study') {
      setView('study');
    } else if (editorSourceView === 'cards') {
      setView('cards');
    } else {
      setView('decks');
    }
  };

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
      uploadCreatorImage(file, newCardData, setNewCardData);
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
  }, [view]);

  useEffect(() => { autoResize(frontRef); }, [newCardData.front, cardFontSize, cardFont, cardFontWeight, cardFontStyle]);
  useEffect(() => { autoResize(backRef); }, [newCardData.back, cardFontSize, cardFont, cardFontWeight, cardFontStyle]);
  useEffect(() => { autoResize(contextRef); }, [newCardData.context, contextFontSize, contextFont, contextFontWeight, contextFontStyle]);

  React.useEffect(() => {
    if (view === 'creator') {
      setNewCardData({
        front: '',
        back: '',
        context: '',
        deck_id: currentDeck?.id
      });
    }
  }, [view, currentDeck?.id]);

  if (view !== 'creator') return null;

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, 0); // Using 0 for new card
  const resolvedBgBack = getResolvedStyle(cardBgBack, 0);

  const handleAiGenerate = async () => {
    if (!newCardData.front) return;
    const result = await runAiGenerator(newCardData.front, true);
    if (result) {
      const updated = {
        ...newCardData,
        front: result.front || newCardData.front,
        back: result.back || newCardData.back,
        context: result.context || newCardData.context
      };
      setNewCardData(updated);
      
      // Auto-generate audio after AI generation
      setTimeout(() => {
        generateAudioInternal(updated, setNewCardData);
      }, 500);
    }
  };

  const handleSave = () => {
    saveCard(newCardData);
  };

  return (
    <div className="view-creator">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="view">
        <div className="header-compact">
          <button className="back-btn" onClick={handleBack}><ChevronLeft size={24} /></button>
          <h2>Новая карточка</h2>
          <div className="header-actions">
            <button 
              className="header-action-btn" 
              disabled={true} 
              title="Добавить карточку"
            >
              <Plus size={22} />
            </button>

            <HelpButton onClick={() => startTutorial('creator')} />

            <button
              type="button"
              className="header-action-btn"
              onClick={() => setIsImagePickerOpen(true)}
              title="Добавить картинку"
            >
              <ImageIcon size={22} />
            </button>

            <button 
              className="header-action-btn" 
              onClick={() => generateAudioInternal(newCardData, setNewCardData)}
              disabled={loading}
              title="Озвучить"
            >
              <Volume2 size={22} />
            </button>

            <button 
              className="header-action-btn" 
              disabled={true} 
              title="Редактировать"
            >
              <Edit2 size={22} />
            </button>

            <button 
              className="header-action-btn settings-btn" 
              onClick={() => setIsSettingsOpen(true)}
              title="Настройки"
            >
              <Settings size={22} />
            </button>
          </div>
        </div>

        <div className="creator-form glass">
          <div className="form-group">
            <div id="tut-creator-front" className="card-preview-container glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: '12px' }}>
              <CardBackground styleType={resolvedBgFront} />
              <textarea 
                ref={frontRef}
                autoFocus
                value={newCardData.front} 
                onChange={e => setNewCardData({...newCardData, front: e.target.value})}
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
              
              {newCardData.image_url && (
                <div className="image-preview-box" style={{ margin: '10px', position: 'relative', zIndex: 3 }}>
                  <img src={newCardData.image_url} alt="" style={{ maxWidth: '100%', borderRadius: '8px' }} />
                  <button
                    type="button"
                    className="image-clear-btn"
                    onClick={() => setNewCardData({...newCardData, image_path: '', image_url: ''})}
                    title="Убрать картинку"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {(newCardData.audio_path || newCardData.audio_url) && (
                <button 
                  className="btn-secondary btn-small play-preview-btn" 
                  style={{ position: 'absolute', bottom: '10px', right: '10px', zIndex: 4 }}
                  onClick={() => playAudio(newCardData.audio_url || `/api/media/${newCardData.audio_path}`)}
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
              onClick={loading ? stopAiGeneration : handleAiGenerate}
              disabled={loading}
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
              onClick={handleSave} 
              disabled={loading}
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
                value={newCardData.back} 
                onChange={e => setNewCardData({...newCardData, back: e.target.value})}
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
                value={newCardData.context} 
                onChange={e => setNewCardData({...newCardData, context: e.target.value})}
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


        </div>
        
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
                    href={`https://www.google.com/search?q=${encodeURIComponent(newCardData.front || '')}&tbm=isch`}
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
                    uploadCreatorImage(e.target.files?.[0], newCardData, setNewCardData);
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
                    uploadCreatorImage(e.target.files?.[0], newCardData, setNewCardData);
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
      </motion.div>
    </div>
  );
};
