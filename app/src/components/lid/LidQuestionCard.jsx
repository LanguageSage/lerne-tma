import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, X, HelpCircle, Languages, Image as ImageIcon, 
  RotateCw, RotateCcw, Eye, Sparkles, BookOpen, CheckCircle2 
} from 'lucide-react';
import { triggerHaptic } from '../../utils/platform';

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

  // Reset flipped and translation states when moving to a different question
  useEffect(() => {
    queueMicrotask(() => {
      setIsFlipped(false);
      setShowTranslation(false);
    });
  }, [question?.id]);

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
  const questionRuText = ruTrans.question;
  const correctOptObj = question.options?.find(o => o.id === question.correctOption);

  return (
    <div className="lid-question-container lid-flip-card-perspective">
      {/* Expanded Image Modal Overlay (shared) */}
      {isImageExpanded && question.image && (
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
            <img src={question.image} alt="Иллюстрация" className="lid-image-modal-img" />
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

            {/* Optional Image */}
            {question.image && (
              <div className="lid-question-image-wrapper">
                <img
                  src={question.image}
                  alt={`Иллюстрация к вопросу ${examIndex}`}
                  className="lid-question-image"
                  onClick={() => setIsImageExpanded(!isImageExpanded)}
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

                const optRuText = ruTrans?.[opt.id];

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

              <button
                type="button"
                className="lid-btn-return-front"
                onClick={handleFlipCard}
              >
                <RotateCcw size={14} />
                <span>Лицевая сторона</span>
              </button>
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
              {question.image && (
                <div 
                  className="lid-question-image-wrapper" 
                  style={{ maxHeight: '160px', marginTop: '6px', cursor: 'pointer' }}
                  onClick={() => setIsImageExpanded(true)}
                >
                  <img
                    src={question.image}
                    alt="Иллюстрация"
                    className="lid-question-image"
                    style={{ maxHeight: '150px' }}
                  />
                </div>
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
                const optRu = ruTrans?.[opt.id];
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

            {/* Explanation & Context Box */}
            {(ruTrans.context || question.context) && (
              <div className="lid-back-explanation-box">
                <div className="lid-back-explanation-title">
                  <HelpCircle size={15} />
                  <span>Пояснение к вопросу (BAMF):</span>
                </div>
                {ruTrans.context && (
                  <p className="lid-back-expl-ru">
                    {ruTrans.context}
                  </p>
                )}
                {question.context && (
                  <p className="lid-back-expl-de" style={{ opacity: 0.85, fontSize: '0.85rem' }}>
                    <strong>DE: </strong>{question.context}
                  </p>
                )}
              </div>
            )}

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
