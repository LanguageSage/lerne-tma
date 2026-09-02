import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, HelpCircle, Languages, Image as ImageIcon } from 'lucide-react';
import { triggerHaptic } from '../../utils/platform';

export const LidQuestionCard = ({
  question,
  examIndex = 1,
  totalQuestions = 33,
  examMode = 'exam',
  selectedAnswer = null,
  onSelectAnswer
}) => {
  const [showTranslation, setShowTranslation] = useState(false);
  const [isImageExpanded, setIsImageExpanded] = useState(false);

  if (!question) return null;

  const isPractice = examMode === 'practice';
  const hasAnswered = Boolean(selectedAnswer);
  const isCorrect = hasAnswered ? (selectedAnswer === question.correctOption) : null;

  const handleOptionClick = (optionId) => {
    if (examMode === 'practice' && hasAnswered) {
      // In practice mode, allow changing or reviewing
    }
    triggerHaptic('selection');
    onSelectAnswer(question.id, optionId);
  };

  const getOptionLetter = (id) => id.toUpperCase();

  const ruTrans = question.translationRu;
  const questionRuText = ruTrans?.question;

  return (
    <div className="lid-question-container">
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

      {/* Expanded Image Modal Overlay */}
      {isImageExpanded && question.image && (
        <div className="modal-overlay" onClick={() => setIsImageExpanded(false)} style={{ zIndex: 11000 }}>
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

      {/* Question Text */}
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

        {questionRuText && (
          <button
            type="button"
            className={`lid-toggle-trans-btn ${showTranslation ? 'active' : ''}`}
            onClick={() => setShowTranslation(!showTranslation)}
            title="Показать / скрыть перевод"
          >
            <Languages size={13} />
            <span>{showTranslation ? 'Скрыть перевод' : 'Перевод на русский'}</span>
          </button>
        )}
      </div>

      {/* Options List A, B, C, D */}
      <div className="lid-options-list">
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

              {/* Status Indicator Icon */}
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

      {/* Practice Mode Explanation Card */}
      <AnimatePresence>
        {isPractice && hasAnswered && (
          <motion.div
            className={`lid-explanation-card glass ${isCorrect ? 'is-correct' : 'is-wrong'}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
          >
            <div className="lid-explanation-header">
              <div className="lid-explanation-badge">
                {isCorrect ? (
                  <>
                    <Check size={16} />
                    <span>Правильно!</span>
                  </>
                ) : (
                  <>
                    <X size={16} />
                    <span>Неверно. Правильный ответ: {getOptionLetter(question.correctOption)}</span>
                  </>
                )}
              </div>
            </div>

            {question.context && (
              <div className="lid-explanation-body">
                <div className="lid-explanation-title">
                  <HelpCircle size={14} />
                  <span>Пояснение к вопросу:</span>
                </div>
                <p className="lid-explanation-de">{question.context}</p>
                {ruTrans?.context && (
                  <p className="lid-explanation-ru">{ruTrans.context}</p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
