import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, ArrowLeft, ArrowRight, 
  MapPin, RefreshCw, BookOpen, ShieldCheck, Check 
} from 'lucide-react';
import { useLidStore } from '../../store/useLidStore';
import { useUiStore } from '../../store/useUiStore';
import { getBundeslandByCode } from '../../data/bundeslaender';
import { BundeslandModal } from './BundeslandModal';
import { LidQuestionNavigator } from './LidQuestionNavigator';
import { LidQuestionCard } from './LidQuestionCard';
import { LidResultsView } from './LidResultsView';
import './LidExam.css';

export const LidExamView = () => {
  const { setView, showToast } = useUiStore();
  const {
    screen,
    examMode,
    currentQuestionIndex,
    questions,
    answers,
    timeRemaining,
    isTimerActive,
    selectedLandCode,
    isLandModalOpen,
    openLandModal,
    closeLandModal,
    startSimulation,
    goToQuestion,
    nextQuestion,
    prevQuestion,
    setAnswer,
    tickTimer,
    finishSimulation,
    resetToMenu
  } = useLidStore();

  // Timer interval
  useEffect(() => {
    let interval = null;
    if (isTimerActive) {
      interval = setInterval(() => {
        tickTimer();
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTimerActive, tickTimer]);

  const stateInfo = selectedLandCode ? getBundeslandByCode(selectedLandCode) : null;
  const currentQ = questions[currentQuestionIndex];
  const totalQ = questions.length;
  const answeredCount = Object.keys(answers).length;

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleStartExamFlow = (mode) => {
    if (!selectedLandCode) {
      showToast('Пожалуйста, выберите федеральную землю для экзамена', 'warning');
      useLidStore.getState().setPendingExamMode(mode);
      openLandModal(true);
    } else {
      startSimulation(mode);
    }
  };

  const handleFinishClick = () => {
    finishSimulation();
  };

  const handleBackToDecks = () => {
    resetToMenu();
    setView('decks');
  };

  return (
    <div className="lid-exam-view-wrapper">
      {/* 1. Menu Screen: Mode & Land Selection */}
      {screen === 'menu' && (
        <motion.div
          className="lid-menu-screen"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
        >
          {/* Header */}
          <div className="lid-menu-header glass">
            <button
              type="button"
              className="lid-back-btn"
              onClick={handleBackToDecks}
              title="Назад к колодам"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="lid-menu-title-wrap">
              <span className="lid-hero-flag">🇩🇪</span>
              <h2 className="lid-menu-title">Leben in Deutschland</h2>
              <span className="lid-menu-subtitle">
                Официальный симулятор экзамена BAMF
              </span>
            </div>
          </div>

          {/* Current Bundesland Card */}
          {selectedLandCode && stateInfo ? (
            <div className="lid-selected-land-banner glass" onClick={() => openLandModal(true)}>
              <div className="lid-land-banner-left">
                <div className="lid-land-banner-icon">
                  <span>{stateInfo?.symbol || '🇩🇪'}</span>
                </div>
                <div className="lid-land-banner-info">
                  <div className="lid-land-banner-label">Ваша земля для теста:</div>
                  <div className="lid-land-banner-name">
                    {stateInfo?.nameDe} <span className="lid-ru-sub">({stateInfo?.nameRu})</span>
                  </div>
                  <div className="lid-land-banner-capital">
                    <MapPin size={12} />
                    <span>Столица: {stateInfo?.capital}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="btn btn-secondary lid-btn-change-land-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openLandModal(true);
                }}
              >
                <RefreshCw size={14} />
                <span>Сменить землю</span>
              </button>
            </div>
          ) : (
            <div 
              className="lid-selected-land-banner glass lid-land-banner-unselected"
              onClick={() => openLandModal(true)}
            >
              <div className="lid-land-banner-left">
                <div className="lid-land-flag-unselected">
                  <MapPin size={22} color="#facc15" />
                </div>
                <div className="lid-land-banner-info">
                  <div className="lid-land-banner-label" style={{ color: '#facc15' }}>
                    ⚠️ Земля не выбрана
                  </div>
                  <div className="lid-land-banner-name">
                    Выберите землю
                  </div>
                  <div className="lid-land-banner-capital">
                    <span>3 региональных вопроса войдут в билет</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="lid-btn-choose-land-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openLandModal(true);
                }}
              >
                <span>Выбрать землю</span>
                <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Exam Rules Pill */}
          <div className="lid-rules-banner glass">
            <div className="lid-rule-item">
              <span className="lid-rule-val">33</span>
              <span className="lid-rule-lbl">вопроса</span>
            </div>
            <div className="lid-rule-divider" />
            <div className="lid-rule-item">
              <span className="lid-rule-val">60:00</span>
              <span className="lid-rule-lbl">таймер</span>
            </div>
            <div className="lid-rule-divider" />
            <div className="lid-rule-item">
              <span className="lid-rule-val">17 / 33</span>
              <span className="lid-rule-lbl">порог сдачи</span>
            </div>
          </div>

          {/* Mode Cards */}
          <div className="lid-modes-container">
            {/* Mode 1: Exam Mode */}
            <motion.div
              className="lid-mode-card glass exam-mode"
              whileHover={{ scale: 1.015, y: -2 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => handleStartExamFlow('exam')}
            >
              <div className="lid-mode-badge exam">
                <ShieldCheck size={16} />
                <span>Реальный экзамен</span>
              </div>
              <h3 className="lid-mode-title">Режим экзамена (Exam Mode)</h3>
              <ul className="lid-mode-features">
                <li>⏱️ Строгий таймер 60 минут</li>
                <li>🔒 Ответы скрыты до завершения билета</li>
                <li>🔄 Свободный возврат и смена вариантов (1..33)</li>
                <li>📊 Итоговый балл (🟢 СДАНО / 🔴 НЕ СДАНО) и разбор ошибок</li>
              </ul>
              <button
                type="button"
                className="btn btn-primary lid-btn-start-mode exam"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartExamFlow('exam');
                }}
              >
                <span>Начать экзамен</span>
                <ArrowRight size={18} />
              </button>
            </motion.div>

            {/* Mode 2: Practice Mode */}
            <motion.div
              className="lid-mode-card glass practice-mode"
              whileHover={{ scale: 1.015, y: -2 }}
              whileTap={{ scale: 0.985 }}
              onClick={() => handleStartExamFlow('practice')}
            >
              <div className="lid-mode-badge practice">
                <BookOpen size={16} />
                <span>Обучение</span>
              </div>
              <h3 className="lid-mode-title">Режим тренировки (Practice Mode)</h3>
              <ul className="lid-mode-features">
                <li>⏱️ Таймер 60 минут</li>
                <li>💡 Мгновенная подсветка правильного ответа</li>
                <li>📖 Подробные объяснения и перевод под вопросом</li>
                <li>🎯 Тренировочный темп без стресса</li>
              </ul>
              <button
                type="button"
                className="btn btn-secondary lid-btn-start-mode practice"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartExamFlow('practice');
                }}
              >
                <span>Начать тренировку</span>
                <ArrowRight size={18} />
              </button>
            </motion.div>
          </div>
        </motion.div>
      )}

      {/* 2. Running Simulation Screen */}
      {screen === 'running' && currentQ && (
        <div className="lid-running-screen">
          {/* Top Sticky Header */}
          <div className="lid-exam-top-bar glass">
            <div className="lid-top-bar-left">
              <button
                type="button"
                className="lid-exam-exit-btn"
                onClick={() => resetToMenu()}
                title="Назад в меню"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="lid-exam-mode-tag">
                {examMode === 'exam' ? '📝 Экзамен' : '🎓 Тренировка'}
              </div>
            </div>

            {/* Timer Badge */}
            <div className={`lid-exam-timer ${timeRemaining < 300 ? 'timer-warning' : ''}`}>
              <Clock size={16} className={timeRemaining < 300 ? 'pulse' : ''} />
              <span className="lid-timer-digits">{formatTimer(timeRemaining)}</span>
            </div>

            {/* Finish Button */}
            <button
              type="button"
              className="btn btn-primary lid-btn-finish-exam"
              onClick={handleFinishClick}
            >
              Завершить
            </button>
          </div>

          {/* Progress bar info */}
          <div className="lid-exam-progress-bar-row">
            <span className="lid-progress-answered">
              Отвечено: <strong>{answeredCount}</strong> из {totalQ}
            </span>
            <div className="lid-progress-track">
              <div
                className="lid-progress-fill"
                style={{ width: `${(answeredCount / totalQ) * 100}%` }}
              />
            </div>
          </div>

          {/* Navigator 1..33 */}
          <LidQuestionNavigator
            questions={questions}
            currentIndex={currentQuestionIndex}
            answers={answers}
            examMode={examMode}
            onSelectIndex={goToQuestion}
          />

          {/* Question Card */}
          <div className="lid-question-view-area">
            <AnimatePresence mode="wait">
              <motion.div
                key={`question-${currentQ.id}`}
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                transition={{ duration: 0.18 }}
              >
                <LidQuestionCard
                  question={currentQ}
                  examIndex={currentQuestionIndex + 1}
                  totalQuestions={totalQ}
                  examMode={examMode}
                  selectedAnswer={answers[currentQ.id]}
                  onSelectAnswer={setAnswer}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Bottom Navigation Buttons */}
          <div className="lid-bottom-nav-bar glass">
            <button
              type="button"
              className="btn btn-secondary lid-nav-prev-btn"
              disabled={currentQuestionIndex === 0}
              onClick={prevQuestion}
            >
              <ArrowLeft size={16} />
              <span>Назад</span>
            </button>

            {currentQuestionIndex < totalQ - 1 ? (
              <button
                type="button"
                className="btn btn-primary lid-nav-next-btn"
                onClick={nextQuestion}
              >
                <span>Далее</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary lid-nav-submit-btn"
                onClick={handleFinishClick}
              >
                <span>Завершить тест</span>
                <Check size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Results Screen */}
      {screen === 'results' && (
        <LidResultsView onBackToMenu={handleBackToDecks} />
      )}

      {/* Bundesland Selection Modal */}
      <BundeslandModal
        isOpen={isLandModalOpen}
        onClose={closeLandModal}
        onConfirm={() => {
          closeLandModal();
        }}
      />
    </div>
  );
};
