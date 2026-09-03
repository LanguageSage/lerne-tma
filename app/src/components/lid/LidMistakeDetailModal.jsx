import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, Check, HelpCircle, Languages, AlertCircle, 
  CheckCircle2, ChevronLeft, ChevronRight, Image as ImageIcon 
} from 'lucide-react';

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

  if (!item) return null;

  const { question, userAnswer, correctOption } = item;
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
            {question.image && (
              <div className="lid-mistake-image-box" onClick={() => setIsZoomedImage(!isZoomedImage)}>
                <img 
                  src={question.image} 
                  alt="Иллюстрация к вопросу" 
                  className="lid-mistake-img" 
                  style={{ cursor: 'pointer' }}
                />
                <div className="lid-img-zoom-hint">
                  <ImageIcon size={12} />
                  <span>{isZoomedImage ? 'Уменьшить' : 'Нажмите для увеличения'}</span>
                </div>
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
                  <span>Пояснение:</span>
                </div>
                <p className="lid-context-de">{question.context}</p>
                {ruTrans?.context && (
                  <p className="lid-context-ru">{ruTrans.context}</p>
                )}
              </div>
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
