import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, ChevronLeft, ChevronRight, Volume2, CheckCircle, Edit2, Settings, Image as ImageIcon, RefreshCw, Search, Upload, X } from 'lucide-react';
import { stripMarkdown } from '../utils/text';
import { CardBackground } from './common/CardBackground';
import { getTextShadow, getContextShadow } from '../utils/style';

const OPEN_PICKER_AFTER_GOOGLE = 'lerne_open_picker_after_google';

export const StudyView = ({
  view,
  currentDeck,
  card,
  loading,
  isFlipped,
  setIsFlipped,
  studyHistory,
  historyIndex,
  apiError,
  setView,
  setCard,
  openEditor,
  uploadStudyImage,
  handleQuickAudio,
  playAudio,
  submitGrade,
  goBack,
  goNext,
  handleSyncDeck,
  handleResetProgress,
  setIsSettingsOpen,
  cardBgFront,
  cardBgBack,
  cardFont,
  cardTextColor,
  cardFontSize,
  contextFont,
  contextTextColor,
  contextFontSize,
  cardTextShadow,
  contextTextShadow,
  cardFontWeight,
  cardFontStyle,
  contextFontWeight,
  contextFontStyle
}) => {
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const googleReturnTimerRef = useRef(null);

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
      setCameraError('Камера недоступна. Разрешите доступ или откройте через HTTPS/localhost.');
      cameraInputRef.current?.click();
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !card) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
      uploadStudyImage(file, card);
      closeCamera();
    }, 'image/jpeg', 0.9);
  };

  useEffect(() => {
    if (view !== 'study' || !card) return;

    const openPickerAfterGoogle = () => {
      const googleOpenedAt = Number(sessionStorage.getItem(OPEN_PICKER_AFTER_GOOGLE) || 0);
      if (!googleOpenedAt) return;

      const elapsed = Date.now() - googleOpenedAt;
      if (elapsed < 1200) {
        clearTimeout(googleReturnTimerRef.current);
        googleReturnTimerRef.current = setTimeout(openPickerAfterGoogle, 1200 - elapsed);
        return;
      }

      sessionStorage.removeItem(OPEN_PICKER_AFTER_GOOGLE);
      setIsImagePickerOpen(true);
    };

    openPickerAfterGoogle();
    window.addEventListener('focus', openPickerAfterGoogle);
    document.addEventListener('visibilitychange', openPickerAfterGoogle);

    return () => {
      clearTimeout(googleReturnTimerRef.current);
      window.removeEventListener('focus', openPickerAfterGoogle);
      document.removeEventListener('visibilitychange', openPickerAfterGoogle);
    };
  }, [view, card?.id]);

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = cameraStreamRef.current;
    if (!isCameraOpen || !video || !stream) return;

    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');

    const startVideo = () => {
      video.play().catch((err) => {
        console.error('Camera preview play failed:', err);
        setCameraError('Не удалось запустить предпросмотр камеры. Попробуйте закрыть и открыть фото ещё раз.');
      });
    };

    if (video.readyState >= 1) {
      startVideo();
    } else {
      video.onloadedmetadata = startVideo;
    }

    return () => {
      video.onloadedmetadata = null;
      video.srcObject = null;
    };
  }, [isCameraOpen]);

  const googleImageUrl = `https://www.google.com/search?q=${encodeURIComponent(card?.front || '')}&tbm=isch`;

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

  const resolvedBgFront = getResolvedStyle(cardBgFront, card?.id);
  const resolvedBgBack = getResolvedStyle(cardBgBack, card?.id);

  if (view !== 'study') return null;

  return (
    <div className="view-study">
      <motion.div 
        key="study"
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        className="view"
      >
        <div className="header-compact">
          <button className="back-btn" onClick={() => { setView('decks'); setCard(null); }}>
            <ChevronLeft size={24} />
          </button>
          <div className="header-study-info">
            <h2>{currentDeck?.name}</h2>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="edit-btn-study"
              onClick={() => setIsImagePickerOpen(true)}
              disabled={loading || !card}
              title="Добавить картинку"
            >
              <ImageIcon size={20} />
            </button>
            <button 
              className="edit-btn-study" 
              onClick={() => handleQuickAudio(card)} 
              disabled={loading}
              title="Добавить озвучку"
            >
              <Volume2 size={20} />
            </button>
            <button className="edit-btn-study" onClick={() => openEditor(currentDeck?.id, card, 'study')} title="Редактировать">
              <Edit2 size={20} />
            </button>
            <button className="settings-btn" onClick={() => setIsSettingsOpen(true)}>
              <Settings size={22} />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isImagePickerOpen && card && (
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
                    href={googleImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="image-picker-tile image-picker-tile-wide"
                    onClick={() => {
                      sessionStorage.setItem(OPEN_PICKER_AFTER_GOOGLE, String(Date.now()));
                      setIsImagePickerOpen(false);
                    }}
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
                    uploadStudyImage(e.target.files?.[0], card);
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
                    uploadStudyImage(e.target.files?.[0], card);
                    e.target.value = '';
                    setIsImagePickerOpen(false);
                  }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isCameraOpen && card && (
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
                    disablePictureInPicture
                  />
                )}
                <canvas ref={canvasRef} className="hidden-file-input" />
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

        {loading && !card ? (
          <div className="finished-view glass">
            <RefreshCw size={48} className="spin" color="#a855f7" />
            <h3>Загрузка карточек...</h3>
          </div>
        ) : card ? (
          <div className="study-flow">
            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={card.id}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.2 }}
              className={`card-container ${loading ? 'loading-card' : ''}`}
              onClick={() => !loading && setIsFlipped(!isFlipped)}
              style={{ 
                fontFamily: cardFont, 
                color: cardTextColor, 
                fontSize: `${cardFontSize}rem`,
                fontWeight: cardFontWeight,
                fontStyle: cardFontStyle,
                textShadow: getTextShadow(cardTextShadow, cardTextColor)
              }}
            >
              {!isFlipped ? (
                <div className="card-inner card-front glass">
                  <CardBackground styleType={resolvedBgFront} />
                  <div className="card-face">
                    <div className="card-q">❓</div>
                    {card.video_front_url && (
                      <div className="video-container-card">
                        <video src={card.video_front_url} autoPlay loop muted playsInline />
                      </div>
                    )}
                    <div className="text-front">{stripMarkdown(card.front)}</div>
                    {card.audio_url && (
                      <button 
                        className="audio-btn" 
                        disabled={loading}
                        onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                      >
                        <Volume2 size={20} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card-inner card-back glass">
                  <CardBackground styleType={resolvedBgBack} />
                  <div className="card-face">
                    <div className="text-front-mini">{stripMarkdown(card.front)}</div>
                    {card.video_back_url && (
                      <div className="video-container-card">
                        <video src={card.video_back_url} autoPlay loop muted playsInline />
                      </div>
                    )}
                    <div className="text-back">{stripMarkdown(card.back)}</div>
                    {card.image_url && (
                      <img 
                        src={card.image_url} 
                        className="card-img" 
                        alt="Card"
                        onError={(e) => { console.warn('Image load error:', card.image_url); e.target.style.display='none'; }}
                      />
                    )}
                    {card.context && (
                      <div 
                        className="text-context" 
                        style={{ 
                          fontFamily: contextFont, 
                          color: contextTextColor, 
                          fontSize: `${contextFontSize}rem`,
                          fontWeight: contextFontWeight,
                          fontStyle: contextFontStyle,
                          textShadow: getContextShadow(contextTextShadow, contextTextColor)
                        }}
                      >
                        {stripMarkdown(card.context)}
                      </div>
                    )}
                    {card.audio_url && (
                      <button 
                        className="audio-btn bg-audio-btn" 
                        disabled={loading}
                        onClick={(e) => { e.stopPropagation(); playAudio(card.audio_url); }}
                      >
                        <Volume2 size={24} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {loading && (
                <div className="card-loading-overlay">
                  <RefreshCw size={40} className="spin" />
                </div>
              )}
            </motion.div>
            </AnimatePresence>

            {isFlipped && (
              <div className="grade-buttons">
                <button disabled={loading} title="Again" className="btn btn-grade grade-0" onClick={() => submitGrade(0)}>{card.intervals?.[0] || 'Снова'}</button>
                <button disabled={loading} title="Hard" className="btn btn-grade grade-1" onClick={() => submitGrade(1)}>{card.intervals?.[1] || 'Трудно'}</button>
                <button disabled={loading} title="Good" className="btn btn-grade grade-2" onClick={() => submitGrade(2)}>{card.intervals?.[2] || 'Хорошо'}</button>
                <button disabled={loading} title="Easy" className="btn btn-grade grade-3" onClick={() => submitGrade(3)}>{card.intervals?.[3] || 'Легко'}</button>
              </div>
            )}
            
            {!isFlipped && (
              <p className="hint">Нажмите на карточку, чтобы увидеть ответ</p>
            )}

            <div className="study-navigation">
              <div className="nav-counter nav-counter-current" title="Текущая позиция">
                {historyIndex + 1}
              </div>
              <div className="nav-buttons-group">
                <button 
                  className="nav-arrow-btn" 
                  onClick={goBack} 
                  disabled={historyIndex <= 0 || loading}
                  title="Назад"
                >
                  <ChevronLeft size={28} />
                </button>
                <button 
                  className="nav-arrow-btn" 
                  onClick={goNext} 
                  disabled={loading}
                  title="Вперед (пропустить)"
                >
                  <ChevronRight size={28} />
                </button>
              </div>
              <div className="nav-counter nav-counter-total" title="Всего в колоде">
                {currentDeck?.stats?.total || 0}
              </div>
            </div>
          </div>
        ) : (
          <div className="finished-view glass">
            <CheckCircle size={48} color="#22c55e" />
            <h3>Колода пройдена!</h3>
            <p>На сегодня больше нет карточек для повторения.</p>
            {apiError && (
              <div className="api-error-box glass" style={{color: '#f87171', padding: '10px', margin: '10px 0', border: '1px solid #ef4444'}}>
                 Ошибка сервера: {apiError}
              </div>
            )}
            <div className="finished-actions">
              <button className="btn btn-primary" onClick={() => setView('decks')}>В меню</button>
              <button className="btn btn-secondary" onClick={() => handleSyncDeck(currentDeck.id)}>Обновить данные</button>
              <button className="btn btn-secondary" onClick={() => handleResetProgress(currentDeck.id)}>Учить заново</button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
