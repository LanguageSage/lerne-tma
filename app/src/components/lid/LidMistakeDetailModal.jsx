import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, Check, HelpCircle, Languages, AlertCircle, 
  CheckCircle2, ChevronLeft, ChevronRight, Image as ImageIcon, Volume2 
} from 'lucide-react';
import { LidCardBreakdown } from './LidCardBreakdown';

export const LidMistakeDetailModal = ({ 
  item, 
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  currentIndex = 1,
  totalItems = 33
}) => {
  const [showTranslation, setShowTranslation] = useState(true);
  const [isZoomedImage, setIsZoomedImage] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef(null);

  const [cardImageHeight, setCardImageHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('lerne_lid_image_height');
      return saved ? Math.max(60, Math.min(800, parseInt(saved, 10))) : 200;
    } catch { return 200; }
  });

  const question = item?.question;
  const [fallbackQuestionId, setFallbackQuestionId] = useState(null);
  const rawImage = question?.image || null;
  const isFallback = fallbackQuestionId === question?.id;
  const imgSrc = isFallback && rawImage?.startsWith('/lid_images/')
    ? `/api/media/images/${rawImage.replace('/lid_images/', '')}`
    : rawImage;

  const handleImgError = useCallback(() => {
    if (question?.id) {
      setFallbackQuestionId(question.id);
    }
  }, [question]);

  const startCardImageResize = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.touches ? e.touches[0].clientY : e.clientY;
    const startH = cardImageHeight;
    const onMove = (ev) => {
      const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const newH = Math.max(60, Math.min(800, startH + (clientY - startY)));
      setCardImageHeight(newH);
    };
    const onUp = (ev) => {
      const clientY = ev.changedTouches ? ev.changedTouches[0].clientY : ev.clientY;
      const finalH = Math.max(60, Math.min(800, startH + (clientY - startY)));
      try {
        localStorage.setItem('lerne_lid_image_height', String(Math.round(finalH)));
      } catch { /* ignore */ }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [cardImageHeight]);

  // Stop audio on item change
  useEffect(() => {
    queueMicrotask(() => {
      setIsPlayingAudio(false);
    });
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [item?.question?.id]);

  const handleToggleAudio = () => {
    const url = item?.question?.audioUrl || item?.question?.audio_path;
    if (!url) return;

    if (!audioRef.current) {
      const audio = new Audio(url);
      audio.onended = () => setIsPlayingAudio(false);
      audio.onerror = () => setIsPlayingAudio(false);
      audioRef.current = audio;
    }

    if (isPlayingAudio) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    } else {
      audioRef.current.play()
        .then(() => setIsPlayingAudio(true))
        .catch(() => setIsPlayingAudio(false));
    }
  };

  if (!item) return null;

  const { userAnswer, correctOption } = item;
  const ruTrans = question?.translationRu;
  const isCorrect = userAnswer === correctOption;
  const isSkipped = !userAnswer;

  const getOptionLetter = (id) => id?.toUpperCase();

  return (
    <AnimatePresence>
      <div 
        className="lid-modal-backdrop" 
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.82)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 12000,
          padding: '16px'
        }}
      >
        <motion.div
          className="lid-mistake-modal-card glass"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 15 }}
          transition={{ duration: 0.2 }}
        >
          {/* Header */}
          <div className="lid-modal-header">
            <div className="lid-modal-title-wrap">
              <div className={`lid-modal-icon-badge ${isCorrect ? 'success' : isSkipped ? 'warning' : 'error'}`}>
                {isCorrect ? (
                  <CheckCircle2 size={20} color="#22c55e" />
                ) : isSkipped ? (
                  <HelpCircle size={20} color="#f59e0b" />
                ) : (
                  <AlertCircle size={20} color="#ef4444" />
                )}
              </div>
              <div>
                <h3 className="lid-modal-title">
                  {isCorrect ? 'Правильный ответ' : isSkipped ? 'Вопрос без ответа' : 'Разбор ошибки'}
                </h3>
                <p className="lid-modal-subtitle">
                  Вопрос {currentIndex} из {totalItems} • {question.category}
                </p>
              </div>
            </div>
            <button className="lid-modal-close-btn" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>

          <div className="lid-mistake-modal-body">
            {/* Optional Image */}
            {imgSrc && (
              <>
                <div 
                  className="lid-mistake-image-box" 
                  style={{ height: isZoomedImage ? 'auto' : `${cardImageHeight}px`, maxHeight: isZoomedImage ? '500px' : 'none' }}
                  onClick={() => setIsZoomedImage(!isZoomedImage)}
                >
                  <img 
                    src={imgSrc} 
                    alt="Иллюстрация к вопросу" 
                    className="lid-mistake-img" 
                    style={{ cursor: 'pointer', height: isZoomedImage ? 'auto' : '100%', maxHeight: isZoomedImage ? '500px' : 'none' }}
                    onError={handleImgError}
                  />
                  <div className="lid-img-zoom-hint">
                    <ImageIcon size={12} />
                    <span>{isZoomedImage ? 'Уменьшить' : 'Нажмите для увеличения'}</span>
                  </div>
                </div>
                {/* Interactive Resize Handle */}
                <div
                  onMouseDown={startCardImageResize}
                  onTouchStart={startCardImageResize}
                  title="Потяните, чтобы изменить высоту картинки"
                  style={{
                    height: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'ns-resize',
                    margin: '2px 0 10px 0',
                    userSelect: 'none',
                    touchAction: 'none',
                    flexShrink: 0
                  }}
                >
                  <div 
                    style={{
                      width: '40px',
                      height: '4px',
                      borderRadius: '2px',
                      background: 'rgba(168, 85, 247, 0.45)',
                      transition: 'background 0.2s'
                    }}
                    onMouseOver={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.9)'}
                    onMouseOut={e => e.currentTarget.style.background = 'rgba(168, 85, 247, 0.45)'}
                  />
                </div>
              </>
            )}

            {/* Question Text */}
            <div className="lid-mistake-question-box glass">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                <h4 className="lid-mistake-question-de" style={{ margin: 0, flex: 1 }}>{question.question}</h4>
                {(question.audioUrl || question.audio_path) && (
                  <button
                    type="button"
                    className={`lid-btn-audio-pill ${isPlayingAudio ? 'playing' : ''}`}
                    onClick={handleToggleAudio}
                    title="Озвучить вопрос"
                    style={{ flexShrink: 0 }}
                  >
                    <Volume2 size={13} />
                    <span>{isPlayingAudio ? 'Пауза' : 'Озвучить'}</span>
                  </button>
                )}
              </div>
              {showTranslation && (ruTrans?.question || question.cardBack) && (
                <p className="lid-mistake-question-ru" style={{ marginTop: '8px' }}>
                  {ruTrans?.question || question.cardBack.split('\n\n')[0]}
                </p>
              )}
            </div>

            {/* Options Comparison */}
            <div className="lid-mistake-options-list">
              {question.options.map((opt) => {
                const isUserChoice = userAnswer === opt.id;
                const isCorrectChoice = correctOption === opt.id;

                let optClass = 'neutral';
                if (isCorrectChoice) optClass = 'correct';
                else if (isUserChoice) optClass = 'wrong';

                return (
                  <div key={`modal-opt-${opt.id}`} className={`lid-mistake-opt-card ${optClass}`}>
                    <div className="lid-mistake-opt-badge">
                      <span>{getOptionLetter(opt.id)}</span>
                    </div>
                    <div className="lid-mistake-opt-content">
                      <div className="lid-mistake-opt-text">{opt.text}</div>
                      {showTranslation && (opt.translationRu || ruTrans?.[opt.id]) && (
                        <div className="lid-mistake-opt-trans">{opt.translationRu || ruTrans[opt.id]}</div>
                      )}
                    </div>
                    <div className="lid-mistake-opt-status">
                      {isCorrectChoice && (
                        <span className="lid-status-tag correct">
                          <Check size={14} />
                          <span>Правильный ответ</span>
                        </span>
                      )}
                      {isUserChoice && !isCorrectChoice && (
                        <span className="lid-status-tag wrong">
                          <X size={14} />
                          <span>Ваш ответ</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Real Card Breakdown */}
            {(question.cardContext || question.context || ruTrans?.context) && (
              <LidCardBreakdown
                context={question.cardContext || question.context}
                ruContext={ruTrans?.context}
              />
            )}
          </div>

          {/* Footer with Prev / Next Navigation & Translation Toggle */}
          <div className="lid-mistake-modal-footer">
            <div className="lid-modal-nav-group">
              <button
                type="button"
                className="btn btn-secondary lid-modal-nav-btn"
                onClick={onPrev}
                disabled={!hasPrev}
                title="Предыдущий вопрос"
              >
                <ChevronLeft size={16} />
                <span>Назад</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary lid-modal-nav-btn"
                onClick={onNext}
                disabled={!hasNext}
                title="Следующий вопрос"
              >
                <span>Вперед</span>
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="lid-modal-actions-group">
              <button
                type="button"
                className="btn btn-secondary lid-modal-toggle-trans"
                onClick={() => setShowTranslation(!showTranslation)}
              >
                <Languages size={15} />
                <span>{showTranslation ? 'Скрыть перевод' : 'Перевод'}</span>
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
