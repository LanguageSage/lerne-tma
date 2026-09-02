import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, HelpCircle, Languages, AlertCircle } from 'lucide-react';

export const LidMistakeDetailModal = ({ mistakeItem, onClose }) => {
  const [showTranslation, setShowTranslation] = useState(true);

  if (!mistakeItem) return null;

  const { question, userAnswer, correctOption } = mistakeItem;
  const ruTrans = question.translationRu;
  const getOptionLetter = (id) => id?.toUpperCase();

  return (
    <AnimatePresence>
      <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10500 }}>
        <motion.div
          className="lid-mistake-modal-card glass"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.93, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.93, y: 20 }}
          transition={{ duration: 0.22 }}
        >
          {/* Header */}
          <div className="lid-modal-header">
            <div className="lid-modal-title-wrap">
              <div className="lid-modal-icon-badge error">
                <AlertCircle size={20} />
              </div>
              <div>
                <h3 className="lid-modal-title">Разбор ошибки</h3>
                <p className="lid-modal-subtitle">
                  Вопрос {question.examIndex ? `№${question.examIndex}` : ''} • {question.category}
                </p>
              </div>
            </div>
            <button className="lid-modal-close-btn" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>

          <div className="lid-mistake-modal-body">
            {/* Optional Image */}
            {question.image && (
              <div className="lid-mistake-image-box">
                <img src={question.image} alt="Иллюстрация" className="lid-mistake-img" />
              </div>
            )}

            {/* Question Text */}
            <div className="lid-mistake-question-box glass">
              <h4 className="lid-mistake-question-de">{question.question}</h4>
              {showTranslation && ruTrans?.question && (
                <p className="lid-mistake-question-ru">{ruTrans.question}</p>
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
                      {showTranslation && ruTrans?.[opt.id] && (
                        <div className="lid-mistake-opt-trans">{ruTrans[opt.id]}</div>
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

            {/* Context & Explanation */}
            {question.context && (
              <div className="lid-mistake-context-box glass">
                <div className="lid-context-title">
                  <HelpCircle size={15} />
                  <span>Объяснение:</span>
                </div>
                <p className="lid-context-de">{question.context}</p>
                {ruTrans?.context && (
                  <p className="lid-context-ru">{ruTrans.context}</p>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="lid-mistake-modal-footer">
            <button
              type="button"
              className="btn btn-secondary lid-modal-toggle-trans"
              onClick={() => setShowTranslation(!showTranslation)}
            >
              <Languages size={15} />
              <span>{showTranslation ? 'Скрыть перевод' : 'Показать перевод'}</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Понятно
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
