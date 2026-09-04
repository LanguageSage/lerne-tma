import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, X, HelpCircle, Languages, Image as ImageIcon, 
  RotateCw, RotateCcw, Eye, Sparkles, BookOpen, CheckCircle2, Volume2 
} from 'lucide-react';
import { triggerHaptic } from '../../utils/platform';
import { LidCardBreakdown } from './LidCardBreakdown';

export const LidQuestionCard = ({
  question,
  examIndex = 1,
  totalQuestions = 33,
  examMode = 'exam',
  selectedAnswer = null,
  onSelectAnswer
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [isImageExpanded, setIsImageExpanded] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const audioRef = useRef(null);

  const [cardImageHeight, setCardImageHeight] = useState(() => {
    try {
      const saved = localStorage.getItem('lerne_lid_image_height');
      return saved ? Math.max(60, Math.min(800, parseInt(saved, 10))) : 200;
    } catch { return 200; }
  });

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

  // Reset flipped and translation states when moving to a different question
  useEffect(() => {
    queueMicrotask(() => {
      setIsFlipped(false);
      setShowTranslation(false);
      setIsPlayingAudio(false);
    });
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [question?.id]);

  const handleToggleAudio = (e) => {
    if (e) e.stopPropagation();
    const url = question?.audioUrl || question?.audio_path;
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

  if (!question) return null;

  const isPractice = examMode === 'practice';
  const hasAnswered = Boolean(selectedAnswer);
  const isCorrect = hasAnswered ? (selectedAnswer === question.correctOption) : null;

  const handleOptionClick = (optionId) => {
    triggerHaptic('selection');
    onSelectAnswer(question.id, optionId);
  };

  const handleFlipCard = (e) => {
    if (e) e.stopPropagation();
    triggerHaptic('medium');
    setIsFlipped(!isFlipped);
  };

  const getOptionLetter = (id) => (id || '').toUpperCase();

  const ruTrans = question.translationRu || {};
  const questionRuText = ruTrans.question || (question.cardBack ? question.cardBack.split('\n\n')[0] : '');
  const correctOptObj = question.options?.find(o => o.id === question.correctOption);

  return (
    <div className="lid-question-container lid-flip-card-perspective">
      {/* Expanded Image Modal Overlay (shared) */}
      {isImageExpanded && imgSrc && (
        <div 
          className="lid-modal-backdrop" 
          onClick={() => setIsImageExpanded(false)} 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 13000,
            padding: '16px'
          }}
        >
          <div className="lid-image-modal-card glass" onClick={(e) => e.stopPropagation()}>
            <img src={imgSrc} alt="Иллюстрация" className="lid-image-modal-img" onError={handleImgError} />
            <button
              type="button"
              className="btn btn-secondary lid-image-modal-close"
              onClick={() => setIsImageExpanded(false)}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {!isFlipped ? (
          /* =========================================================
             FRONT FACE: Question, Options & Practice Toolbar
             ========================================================= */
          <motion.div
            key={`front-${question.id}`}
            className="lid-card-front-face"
            initial={{ opacity: 0, rotateY: -70 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ opacity: 0, rotateY: 70 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {/* Top Meta: Number & Category */}
            <div className="lid-question-meta-row">
              <div className="lid-q-number-badge">
                <span>Вопрос {examIndex} из {totalQuestions}</span>
              </div>
              <div className="lid-q-category-pill" title={question.category}>
                <span>{question.category}</span>
              </div>
            </div>

            {/* Optional Image with Interactive Height Resize */}
            {imgSrc && (
              <>
                <div 
                  className="lid-question-image-wrapper"
                  style={{ height: `${cardImageHeight}px`, maxHeight: 'none' }}
                >
                  <img
                    src={imgSrc}
                    alt={`Иллюстрация к вопросу ${examIndex}`}
                    className="lid-question-image"
                    style={{ height: '100%', maxHeight: 'none' }}
                    onClick={() => setIsImageExpanded(!isImageExpanded)}
                    onError={handleImgError}
                  />
                  <button
                    type="button"
                    className="lid-image-expand-btn"
                    onClick={() => setIsImageExpanded(!isImageExpanded)}
                    title="Увеличить изображение"
                  >
                    <ImageIcon size={14} />
                  </button>
                </div>
                {/* Interactive Resize Handle (как в карточках изучения) */}
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

            {/* Question Text Box */}
            <div className="lid-question-text-box glass">
              <h3 className="lid-question-text">{question.question}</h3>
              {showTranslation && questionRuText && (
                <motion.div
                  className="lid-question-translation"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <Languages size={14} className="lid-trans-icon" />
                  <span>{questionRuText}</span>
                </motion.div>
              )}

              {/* Toolbar Row */}
              <div className="lid-card-actions-toolbar">
                {questionRuText && (
                  <button
                    type="button"
                    className={`lid-toggle-trans-btn ${showTranslation ? 'active' : ''}`}
                    onClick={() => setShowTranslation(!showTranslation)}
                    title="Показать / скрыть перевод вопроса"
                  >
                    <Languages size={13} />
                    <span>{showTranslation ? 'Скрыть перевод' : 'Перевод на русский'}</span>
                  </button>
                )}

                {(question.audioUrl || question.audio_path) && (
                  <button
                    type="button"
                    className={`lid-btn-audio-pill ${isPlayingAudio ? 'playing' : ''}`}
                    onClick={handleToggleAudio}
                    title="Прослушать вопрос на немецком"
                  >
                    <Volume2 size={13} />
                    <span>{isPlayingAudio ? 'Пауза' : 'Озвучить'}</span>
                  </button>
                )}

                {isPractice && (
                  <button
                    type="button"
                    className="lid-btn-flip-card"
                    onClick={handleFlipCard}
                    title="Перевернуть карточку и посмотреть разбор"
                  >
                    <RotateCw size={13} />
                    <span>Обратная сторона карточки</span>
                  </button>
                )}
              </div>
            </div>

            {/* Options List A, B, C, D */}
            <div className="lid-options-list" style={{ marginTop: '12px' }}>
              {question.options.map((opt) => {
                const isSelected = selectedAnswer === opt.id;
                const isThisCorrect = opt.id === question.correctOption;

                let optionStateClass = '';
                if (isSelected) optionStateClass += ' selected';

                if (isPractice && hasAnswered) {
                  if (isThisCorrect) {
                    optionStateClass += ' correct-revealed';
                  } else if (isSelected && !isThisCorrect) {
                    optionStateClass += ' wrong-revealed';
                  }
                }

                const optRuText = opt.translationRu || ruTrans?.[opt.id];

                return (
                  <motion.button
                    key={`opt-${question.id}-${opt.id}`}
                    type="button"
                    className={`lid-option-item glass ${optionStateClass}`}
                    onClick={() => handleOptionClick(opt.id)}
                    whileTap={{ scale: 0.985 }}
                  >
                    <div className="lid-option-letter-badge">
                      <span>{getOptionLetter(opt.id)}</span>
                    </div>

                    <div className="lid-option-content">
                      <span className="lid-option-text">{opt.text}</span>
                      {showTranslation && optRuText && (
                        <span className="lid-option-trans-text">{optRuText}</span>
                      )}
                    </div>

                    {/* Status Indicator in Practice Mode */}
                    {isPractice && hasAnswered && (
                      <div className="lid-option-status-icon">
                        {isThisCorrect ? (
                          <div className="lid-status-correct">
                            <Check size={16} strokeWidth={3} />
                          </div>
                        ) : isSelected ? (
                          <div className="lid-status-wrong">
                            <X size={16} strokeWidth={3} />
                          </div>
                        ) : null}
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>

            {/* Practice Mode Feedback Action Banner */}
            {isPractice && hasAnswered && (
              <motion.div
                className={`lid-practice-feedback-banner ${isCorrect ? 'is-correct' : 'is-wrong'}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="lid-feedback-title">
                  {isCorrect ? (
                    <>
                      <CheckCircle2 size={18} />
                      <span>Верно! Ответ: {getOptionLetter(question.correctOption)}</span>
                    </>
                  ) : (
                    <>
                      <X size={18} />
                      <span>Неверно. Правильный: {getOptionLetter(question.correctOption)}</span>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  className="lid-btn-see-back"
                  onClick={handleFlipCard}
                >
                  <RotateCw size={13} />
                  <span>Разбор на обороте</span>
                </button>
              </motion.div>
            )}
          </motion.div>
        ) : (
          /* =========================================================
             BACK FACE: Full Card Breakdown, Answer & Context
             ========================================================= */
          <motion.div
            key={`back-${question.id}`}
            className="lid-card-back-container"
            initial={{ opacity: 0, rotateY: 70 }}
            animate={{ opacity: 1, rotateY: 0 }}
            exit={{ opacity: 0, rotateY: -70 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            {/* Top Bar on Back Side */}
            <div className="lid-back-top-bar">
              <div className="lid-back-mode-badge">
                <RotateCw size={14} />
                <span>Обратная сторона • Вопрос {examIndex}/{totalQuestions}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {(question.audioUrl || question.audio_path) && (
                  <button
                    type="button"
                    className={`lid-btn-audio-pill ${isPlayingAudio ? 'playing' : ''}`}
                    onClick={handleToggleAudio}
                    title="Прослушать вопрос на немецком"
                  >
                    <Volume2 size={13} />
                    <span>{isPlayingAudio ? 'Пауза' : 'Озвучить'}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="lid-btn-return-front"
                  onClick={handleFlipCard}
                >
                  <RotateCcw size={14} />
                  <span>Лицевая сторона</span>
                </button>
              </div>
            </div>

            {/* Question Summary Box */}
            <div className="lid-back-question-card glass">
              <div className="lid-back-q-label">Вопрос (Frage):</div>
              <h3 className="lid-back-q-text-de">{question.question}</h3>
              {questionRuText && (
                <div className="lid-back-q-text-ru">
                  <strong>Перевод: </strong>{questionRuText}
                </div>
              )}
              {imgSrc && (
                <>
                  <div 
                    className="lid-question-image-wrapper" 
                    style={{ height: `${cardImageHeight}px`, maxHeight: 'none', marginTop: '6px', cursor: 'pointer' }}
                    onClick={() => setIsImageExpanded(true)}
                  >
                    <img
                      src={imgSrc}
                      alt="Иллюстрация"
                      className="lid-question-image"
                      style={{ height: '100%', maxHeight: 'none' }}
                      onError={handleImgError}
                    />
                  </div>
                  {/* Resize Handle */}
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
            </div>

            {/* Correct Option Hero Banner */}
            <div className="lid-back-correct-hero">
              <div className="lid-back-correct-header">
                <CheckCircle2 size={16} />
                <span>Правильный ответ: Вариант {getOptionLetter(question.correctOption)}</span>
              </div>
              {correctOptObj && (
                <>
                  <div className="lid-back-correct-de">
                    {correctOptObj.text}
                  </div>
                  {ruTrans[question.correctOption] && (
                    <div className="lid-back-correct-ru">
                      {ruTrans[question.correctOption]}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* All Options Full Breakdown */}
            <div className="lid-back-options-box glass">
              <div className="lid-back-options-title">Все варианты ответа:</div>
              {question.options.map((opt) => {
                const isThisCorrect = opt.id === question.correctOption;
                const optRu = opt.translationRu || ruTrans?.[opt.id];
                return (
                  <div
                    key={`back-opt-${opt.id}`}
                    className={`lid-back-option-row ${isThisCorrect ? 'is-correct-row' : ''}`}
                  >
                    <div className="lid-back-opt-badge">
                      <span>{getOptionLetter(opt.id)}</span>
                    </div>
                    <div className="lid-back-opt-texts">
                      <div className="lid-back-opt-de">
                        {opt.text} {isThisCorrect && ' ✓'}
                      </div>
                      {optRu && (
                        <div className="lid-back-opt-ru">
                          {optRu}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Real Card Breakdown (Full lesson: 🎯 Объяснение, 📖 Словарный запас, 💡 Грамматика) */}
            <LidCardBreakdown
              context={question.cardContext || question.context}
              ruContext={ruTrans?.context}
            />

            {/* Bottom Return Button */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '6px' }}>
              <button
                type="button"
                className="btn btn-secondary lid-btn-return-front"
                style={{ padding: '10px 24px', fontSize: '0.92rem', borderRadius: '12px' }}
                onClick={handleFlipCard}
              >
                <RotateCcw size={16} />
                <span>← Вернуться к вопросу</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
