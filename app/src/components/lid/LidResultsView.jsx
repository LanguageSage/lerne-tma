import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  CheckCircle2, XCircle, RotateCcw, Award, Clock, 
  MapPin, ChevronRight, AlertTriangle, ArrowLeft, BookOpen, Sparkles, X 
} from 'lucide-react';
import { useLidStore } from '../../store/useLidStore';
import { getBundeslandByCode } from '../../data/bundeslaender';
import { LidMistakeDetailModal } from './LidMistakeDetailModal';
import { ConfettiBurst } from '../common/ConfettiBurst';

export const LidResultsView = ({ onBackToMenu }) => {
  const {
    getResults,
    startSimulation,
    retakeMistakes,
    selectedLandCode,
    resetToMenu
  } = useLidStore();

  const [activeMistakeModal, setActiveMistakeModal] = useState(null);

  const results = getResults();
  const { score, total, percent, isPassed, timeSpent, mistakes } = results;
  const stateInfo = getBundeslandByCode(selectedLandCode);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins} мин ${secs < 10 ? '0' : ''}${secs} сек`;
  };

  const getOptionLetter = (id) => id?.toUpperCase();

  return (
    <div className="lid-results-view">
      {isPassed && <ConfettiBurst trigger={true} />}

      <motion.div
        className="lid-results-container"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
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

        {/* Mistakes List Section */}
        <div className="lid-mistakes-section">
          <div className="lid-section-header">
            <div className="lid-section-title-wrap">
              {mistakes.length > 0 ? (
                <>
                  <AlertTriangle size={18} className="lid-alert-icon" />
                  <h3 className="lid-section-title">
                    Список ошибок ({mistakes.length} из {total})
                  </h3>
                </>
              ) : (
                <>
                  <Sparkles size={18} color="#eab308" />
                  <h3 className="lid-section-title">Идеальный результат!</h3>
                </>
              )}
            </div>
            {mistakes.length > 0 && (
              <span className="lid-section-hint">
                Нажмите на карточку для разбора
              </span>
            )}
          </div>

          {mistakes.length === 0 ? (
            <div className="lid-perfect-score-card glass">
              <div className="lid-perfect-badge">🏆 100%</div>
              <h4>Вы ответили правильно на все 33 вопроса!</h4>
              <p>Отличная подготовка к официальному экзамену BAMF Leben in Deutschland.</p>
            </div>
          ) : (
            <div className="lid-mistake-cards-list">
              {mistakes.map((m, idx) => {
                const { question, userAnswer, correctOption } = m;
                const userChoiceLetter = userAnswer ? getOptionLetter(userAnswer) : '—';
                const correctChoiceLetter = getOptionLetter(correctOption);

                const correctOptObj = question.options?.find(o => o.id === correctOption);
                const userOptObj = question.options?.find(o => o.id === userAnswer);

                return (
                  <motion.div
                    key={`mistake-item-${question.id || idx}`}
                    className="lid-mistake-card-item glass"
                    onClick={() => setActiveMistakeModal(m)}
                    whileHover={{ scale: 1.01, y: -1 }}
                    whileTap={{ scale: 0.985 }}
                  >
                    <div className="lid-mistake-left">
                      <div className="lid-mistake-q-badge">
                        <span>№{question.examIndex || (idx + 1)}</span>
                      </div>
                      <div className="lid-mistake-texts">
                        <div className="lid-mistake-category">{question.category}</div>
                        <div className="lid-mistake-q-title">{question.question}</div>
                        <div className="lid-mistake-ans-comparison">
                          <span className="lid-user-ans-tag">
                            <X size={12} /> Ваш ответ: {userChoiceLetter} {userOptObj ? `(${userOptObj.text})` : ''}
                          </span>
                          <span className="lid-correct-ans-tag">
                            <CheckCircle2 size={12} /> Правильно: {correctChoiceLetter} {correctOptObj ? `(${correctOptObj.text})` : ''}
                          </span>
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

      {/* Modal for detail of chosen mistake card */}
      {activeMistakeModal && (
        <LidMistakeDetailModal
          mistakeItem={activeMistakeModal}
          onClose={() => setActiveMistakeModal(null)}
        />
      )}
    </div>
  );
};
