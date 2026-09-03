import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  CheckCircle2, XCircle, RotateCcw, Award, Clock, 
  MapPin, ChevronRight, AlertTriangle, ArrowLeft, BookOpen, Sparkles, X, ListFilter, HelpCircle 
} from 'lucide-react';
import { useLidStore } from '../../store/useLidStore';
import { getBundeslandByCode } from '../../data/bundeslaender';
import { LidMistakeDetailModal } from './LidMistakeDetailModal';
import { ConfettiBurst } from '../common/ConfettiBurst';

export const LidResultsView = ({ onBackToMenu }) => {
  const {
    getResults,
    ticket,
    answers,
    startSimulation,
    retakeMistakes,
    selectedLandCode,
    resetToMenu
  } = useLidStore();

  const [filterTab, setFilterTab] = useState('all'); // 'all' | 'mistakes' | 'correct'
  const [activeModalIndex, setActiveModalIndex] = useState(null); // index in current filtered list

  const results = getResults();
  const { score, total, percent, isPassed, timeSpent, mistakes } = results;
  const stateInfo = getBundeslandByCode(selectedLandCode);

  // Build full list of all 33 questions with user answer & correctness
  const allQuestionItems = (ticket || []).map((q, idx) => {
    const userAnswer = answers[q.id] || null;
    const isCorrect = userAnswer === q.correctOption;
    return {
      question: { ...q, examIndex: idx + 1 },
      userAnswer,
      correctOption: q.correctOption,
      isCorrect,
      isSkipped: !userAnswer
    };
  });

  const filteredItems = allQuestionItems.filter((item) => {
    if (filterTab === 'mistakes') return !item.isCorrect;
    if (filterTab === 'correct') return item.isCorrect;
    return true;
  });

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins} мин ${secs < 10 ? '0' : ''}${secs} сек`;
  };

  const getOptionLetter = (id) => id?.toUpperCase();

  const activeModalItem = activeModalIndex !== null ? filteredItems[activeModalIndex] : null;

  return (
    <div className="lid-results-view">
      {isPassed && <ConfettiBurst trigger={true} />}

      <motion.div
        className="lid-results-container"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Top Window Header */}
        <div className="lid-menu-header glass" style={{ marginBottom: 4 }}>
          <button
            type="button"
            className="lid-back-btn"
            onClick={() => {
              resetToMenu();
              if (onBackToMenu) onBackToMenu();
            }}
            title="Назад в меню"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="lid-menu-title-wrap">
            <h2 className="lid-menu-title" style={{ fontSize: '1.2rem' }}>Результаты экзамена</h2>
            <span className="lid-menu-subtitle">
              Leben in Deutschland • {stateInfo?.nameDe || 'Федеральная земля'}
            </span>
          </div>
        </div>

        {/* Top Header Card */}
        <div className={`lid-results-card glass ${isPassed ? 'status-passed' : 'status-failed'}`}>
          <div className="lid-results-status-badge">
            {isPassed ? (
              <div className="lid-status-icon-wrap passed">
                <CheckCircle2 size={36} color="#22c55e" />
              </div>
            ) : (
              <div className="lid-status-icon-wrap failed">
                <XCircle size={36} color="#ef4444" />
              </div>
            )}
            <h2 className="lid-results-title">
              {isPassed ? '🟢 ЭКЗАМЕН СДАН' : '🔴 ЭКЗАМЕН НЕ СДАН'}
            </h2>
            <p className="lid-results-sub">
              {isPassed
                ? 'Поздравляем! Вы успешно преодолели порог сдачи экзамена.'
                : 'К сожалению, порог в 17 правильных ответов не достигнут.'}
            </p>
          </div>

          {/* Big Score Display */}
          <div className="lid-score-display">
            <div className="lid-score-number">
              <span className="lid-score-current">{score}</span>
              <span className="lid-score-total">/ {total}</span>
            </div>
            <div className="lid-score-percent-badge">
              <span>{percent}% правильных ответов</span>
            </div>
          </div>

          {/* Meta Info Grid */}
          <div className="lid-results-meta-grid">
            <div className="lid-meta-card glass">
              <Award size={16} className="lid-meta-icon" />
              <div className="lid-meta-text">
                <span className="lid-meta-val">17 из 33</span>
                <span className="lid-meta-lbl">Порог сдачи</span>
              </div>
            </div>

            <div className="lid-meta-card glass">
              <Clock size={16} className="lid-meta-icon" />
              <div className="lid-meta-text">
                <span className="lid-meta-val">{formatTime(timeSpent)}</span>
                <span className="lid-meta-lbl">Затрачено времени</span>
              </div>
            </div>

            {stateInfo && (
              <div className="lid-meta-card glass">
                <MapPin size={16} className="lid-meta-icon" />
                <div className="lid-meta-text">
                  <span className="lid-meta-val">{stateInfo.nameDe}</span>
                  <span className="lid-meta-lbl">Федеральная земля</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Question Review Section with Filter Tabs */}
        <div className="lid-mistakes-section">
          <div className="lid-section-header">
            <div className="lid-section-title-wrap">
              <ListFilter size={18} className="lid-alert-icon" />
              <h3 className="lid-section-title">
                Карточки экзамена ({allQuestionItems.length})
              </h3>
            </div>
            <span className="lid-section-hint">
              Нажмите на любую карточку для подробного изучения
            </span>
          </div>

          {/* Filter Tabs */}
          <div className="lid-results-filter-tabs">
            <button
              type="button"
              className={`lid-filter-tab ${filterTab === 'all' ? 'active' : ''}`}
              onClick={() => setFilterTab('all')}
            >
              <span>Все ({allQuestionItems.length})</span>
            </button>
            <button
              type="button"
              className={`lid-filter-tab mistakes ${filterTab === 'mistakes' ? 'active' : ''}`}
              onClick={() => setFilterTab('mistakes')}
            >
              <span>Ошибки ({mistakes.length})</span>
            </button>
            <button
              type="button"
              className={`lid-filter-tab correct ${filterTab === 'correct' ? 'active' : ''}`}
              onClick={() => setFilterTab('correct')}
            >
              <span>Правильные ({score})</span>
            </button>
          </div>

          {/* Cards List */}
          {filteredItems.length === 0 ? (
            <div className="lid-perfect-score-card glass">
              <Sparkles size={32} color="#eab308" />
              <h4>В этой категории нет карточек</h4>
            </div>
          ) : (
            <div className="lid-mistake-cards-list">
              {filteredItems.map((item, idx) => {
                const { question, userAnswer, correctOption, isCorrect, isSkipped } = item;
                const userChoiceLetter = userAnswer ? getOptionLetter(userAnswer) : '—';
                const correctChoiceLetter = getOptionLetter(correctOption);

                const correctOptObj = question.options?.find(o => o.id === correctOption);
                const userOptObj = question.options?.find(o => o.id === userAnswer);

                let cardStatusClass = isCorrect ? 'is-correct' : isSkipped ? 'is-skipped' : 'is-wrong';

                return (
                  <motion.div
                    key={`result-card-item-${question.id || idx}`}
                    className={`lid-mistake-card-item glass ${cardStatusClass}`}
                    onClick={() => setActiveModalIndex(idx)}
                    whileHover={{ scale: 1.01, y: -1 }}
                    whileTap={{ scale: 0.985 }}
                  >
                    <div className="lid-mistake-left">
                      <div className={`lid-mistake-q-badge ${cardStatusClass}`}>
                        <span>№{question.examIndex}</span>
                      </div>
                      <div className="lid-mistake-texts">
                        <div className="lid-mistake-category">{question.category}</div>
                        <div className="lid-mistake-q-title">{question.question}</div>
                        
                        <div className="lid-mistake-ans-comparison">
                          {isCorrect ? (
                            <span className="lid-correct-ans-tag">
                              <CheckCircle2 size={13} /> Ответ правильный: {correctChoiceLetter} {correctOptObj ? `(${correctOptObj.text})` : ''}
                            </span>
                          ) : isSkipped ? (
                            <>
                              <span className="lid-skipped-ans-tag">
                                <HelpCircle size={13} /> Ответ не выбран
                              </span>
                              <span className="lid-correct-ans-tag">
                                <CheckCircle2 size={13} /> Правильно: {correctChoiceLetter} {correctOptObj ? `(${correctOptObj.text})` : ''}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="lid-user-ans-tag">
                                <X size={13} /> Ваш ответ: {userChoiceLetter} {userOptObj ? `(${userOptObj.text})` : ''}
                              </span>
                              <span className="lid-correct-ans-tag">
                                <CheckCircle2 size={13} /> Правильно: {correctChoiceLetter} {correctOptObj ? `(${correctOptObj.text})` : ''}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="lid-mistake-right">
                      <ChevronRight size={18} className="lid-chevron" />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="lid-results-actions">
          <button
            type="button"
            className="btn btn-primary lid-btn-retake-all"
            onClick={() => startSimulation('exam')}
          >
            <RotateCcw size={18} />
            <span>Пройти заново (новый билет)</span>
          </button>

          {mistakes.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary lid-btn-retake-mistakes"
              onClick={retakeMistakes}
            >
              <BookOpen size={18} />
              <span>Повторить {mistakes.length} {mistakes.length === 1 ? 'ошибку' : 'ошибок'} в тренировке</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary lid-btn-back-menu"
            onClick={() => {
              resetToMenu();
              if (onBackToMenu) onBackToMenu();
            }}
          >
            <ArrowLeft size={18} />
            <span>Вернуться в меню</span>
          </button>
        </div>
      </motion.div>

      {/* Modal for full detail of chosen question card */}
      {activeModalItem && (
        <LidMistakeDetailModal
          item={activeModalItem}
          currentIndex={activeModalIndex + 1}
          totalItems={filteredItems.length}
          hasPrev={activeModalIndex > 0}
          hasNext={activeModalIndex < filteredItems.length - 1}
          onPrev={() => setActiveModalIndex(Math.max(0, activeModalIndex - 1))}
          onNext={() => setActiveModalIndex(Math.min(filteredItems.length - 1, activeModalIndex + 1))}
          onClose={() => setActiveModalIndex(null)}
        />
      )}
    </div>
  );
};
