import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, ChevronLeft, ChevronRight, Volume2, CheckCircle, Edit2, Settings, Image as ImageIcon, RefreshCw, Search, Upload, X } from 'lucide-react';
import { stripMarkdown } from '../utils/text';

const OPEN_GALLERY_AFTER_GOOGLE = 'lerne_open_gallery_after_google';

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
  setIsSettingsOpen
}) => {
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (view !== 'study' || !card) return;

    const openGalleryAfterGoogle = () => {
      const googleOpenedAt = Number(sessionStorage.getItem(OPEN_GALLERY_AFTER_GOOGLE) || 0);
      if (!googleOpenedAt || Date.now() - googleOpenedAt < 1200) return;
      sessionStorage.removeItem(OPEN_GALLERY_AFTER_GOOGLE);
      setIsImagePickerOpen(true);
      setTimeout(() => galleryInputRef.current?.click(), 350);
    };

    openGalleryAfterGoogle();
    window.addEventListener('focus', openGalleryAfterGoogle);
    document.addEventListener('visibilitychange', openGalleryAfterGoogle);

    return () => {
      window.removeEventListener('focus', openGalleryAfterGoogle);
      document.removeEventListener('visibilitychange', openGalleryAfterGoogle);
    };
  }, [view, card?.id]);

  const googleImageUrl = `https://www.google.com/search?q=${encodeURIComponent(card?.front || '')}&tbm=isch`;

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
                    className="btn-secondary btn-full"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={loading}
                  >
                    <Camera size={18} /> Сфотографировать
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-full"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={loading}
                  >
                    <Upload size={18} /> Загрузить из галереи
                  </button>
                  <a
                    href={googleImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary btn-full"
                    onClick={() => {
                      sessionStorage.setItem(OPEN_GALLERY_AFTER_GOOGLE, String(Date.now()));
                      setIsImagePickerOpen(false);
                    }}
                  >
                    <Search size={18} /> Поиск Google
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
            >
              {!isFlipped ? (
                <div className="card-inner card-front glass">
                  <div className="card-face">
                    <div className="card-q">❓</div>
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
                  <div className="card-face">
                    <div className="text-front-mini">{stripMarkdown(card.front)}</div>
                    <div className="text-back">{stripMarkdown(card.back)}</div>
                    {card.image_url && (
                      <img 
                        src={card.image_url} 
                        className="card-img" 
                        alt="Card"
                        onError={(e) => { console.warn('Image load error:', card.image_url); e.target.style.display='none'; }}
                      />
                    )}
                    {card.context && <div className="text-context">{stripMarkdown(card.context)}</div>}
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
