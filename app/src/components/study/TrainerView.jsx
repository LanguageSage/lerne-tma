import { getResolvedStyle } from '../../utils/style';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Clock, Target, Folder, Eye } from 'lucide-react';

import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAudio } from '../../hooks/useAudio';
import { parseClozeData, cleanBracketSyntax } from '../../utils/clozeParser';
import { stripMarkdown } from '../../utils/text';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { getDesignStylesFromV2 } from '../../utils/cardStyles';

import { CardBackground } from '../common/CardBackground';
import { ExerciseRenderer } from './ExerciseRenderer.jsx';
import { detectExerciseType } from '../../utils/exerciseDetector.js';
import { parseExerciseContent } from '../../utils/exerciseContentParser.js';
import { ExerciseInfoBlocks } from './ExerciseInfoBlocks.jsx';
import { StudyCardTrainer } from './StudyCardTrainer.jsx';
import { TrainerFinished } from './TrainerFinished.jsx';
import { navigateUp } from '../../utils/navigation';

export const TrainerView = () => {
  useInterfaceLocale();
  const { showToast } = useUiStore();
  const { currentDeck, deckCards, fetchDeckCards } = useDeckStore();

  const autoPlay = useSettingsStore(s => s.autoPlay);
  const effectiveConfig = useSettingsStore(s => s.activeDesignConfig);
  const cardBgFront = useSettingsStore(s => s.personalDesignV2?.config?.front?.card?.background);
  const cardBgBack = useSettingsStore(s => s.personalDesignV2?.config?.back?.card?.background);

  const { playAudio, stopAudio } = useAudio(autoPlay, showToast);

  const [activeCards, setActiveCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Trainer metrics
  const [trainerStartTime, setTrainerStartTime] = useState(null);
  const [trainerElapsedSeconds, setTrainerElapsedSeconds] = useState(0);
  const [trainerCorrectCount, setTrainerCorrectCount] = useState(0);
  const [trainerWrongCardIds, setTrainerWrongCardIds] = useState([]);
  const [isFinished, setIsFinished] = useState(false);

  // Initialize active cards
  useEffect(() => {
    if (currentDeck?.id) {
      if (!deckCards || deckCards.length === 0) {
        fetchDeckCards(currentDeck.id);
      } else {
        queueMicrotask(() => {
          setActiveCards(deckCards);
          setCurrentIndex(0);
          setIsFlipped(false);
          setTrainerStartTime(Date.now());
          setTrainerCorrectCount(0);
          setTrainerWrongCardIds([]);
          setIsFinished(false);
        });
      }
    }
  }, [currentDeck?.id, deckCards, fetchDeckCards]);

  // Live timer tick
  useEffect(() => {
    if (!trainerStartTime || isFinished) return;
    const interval = setInterval(() => {
      setTrainerElapsedSeconds(Math.round((Date.now() - trainerStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [trainerStartTime, isFinished]);

  const currentCard = activeCards[currentIndex] || null;

  const clozeData = useMemo(() => {
    if (!currentCard) return null;
    return parseClozeData(currentCard, 'trainer', activeCards);
  }, [currentCard, activeCards]);

  const resolvedBgFront = getResolvedStyle(cardBgFront, currentCard?.id);
  const resolvedBgBack = getResolvedStyle(cardBgBack, currentCard?.id);

  const formatTimerDisplay = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleTrainerAnswer = (cardId, isFirstTry) => {
    if (isFirstTry) {
      setTrainerCorrectCount(prev => prev + 1);
    } else {
      setTrainerWrongCardIds(prev => prev.includes(cardId) ? prev : [...prev, cardId]);
    }
  };

  const handleNextCard = () => {
    stopAudio();
    setIsFlipped(false);
    if (currentIndex < activeCards.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setIsFinished(true);
      if (trainerStartTime) {
        setTrainerElapsedSeconds(Math.round((Date.now() - trainerStartTime) / 1000));
      }
    }
  };

  const handleRestart = () => {
    setActiveCards(deckCards || []);
    setCurrentIndex(0);
    setIsFlipped(false);
    setTrainerCorrectCount(0);
    setTrainerWrongCardIds([]);
    setTrainerStartTime(Date.now());
    setTrainerElapsedSeconds(0);
    setIsFinished(false);
  };

  const handleRetryWrong = () => {
    const wrongList = (deckCards || []).filter(c => trainerWrongCardIds.includes(c.id));
    if (wrongList.length > 0) {
      setActiveCards(wrongList);
      setCurrentIndex(0);
      setIsFlipped(false);
      setTrainerWrongCardIds([]);
      setTrainerStartTime(Date.now());
      setTrainerElapsedSeconds(0);
      setIsFinished(false);
    }
  };

  const v2Styles = useMemo(() => getDesignStylesFromV2(effectiveConfig), [effectiveConfig]);
  const cardStyle = v2Styles.referenceText;
  const backCardStyle = v2Styles.backText;
  const contextStyle = v2Styles.contextText;

  if (isFinished || !currentCard) {
    return (
      <div className="view-study">
        <div className="view" style={{ padding: '16px' }}>
          <TrainerFinished
            totalCards={activeCards.length || 1}
            correctFirstTry={trainerCorrectCount}
            wrongCount={trainerWrongCardIds.length}
            elapsedSeconds={trainerElapsedSeconds}
            onRetryWrong={handleRetryWrong}
            onRestart={handleRestart}
            onGoToDecks={navigateUp}
          />
        </div>
      </div>
    );
  }

  const progressPercent = activeCards.length > 0 ? ((currentIndex) / activeCards.length) * 100 : 0;

  return (
    <div className="view-study">
      {/* Top Navigation Bar */}
      <div className="study-header-container" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        width: '100%',
        maxWidth: '540px',
        margin: '0 auto'
      }}>
        <button
          className="back-btn btn-header-back"
          onClick={navigateUp}
          title={tr("Вернуться к колоде")}
          aria-label={tr("Вернуться к колоде")}
          style={{
            gap: '6px',
            padding: '8px 14px',
            fontSize: '0.9rem',
            fontWeight: 600
          }}
        >
          <ArrowLeft size={18} />
          <span>{tr("Колода")}</span>
        </button>

        {/* Center: Live Timer and Accuracy Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            background: 'rgba(168, 85, 247, 0.18)',
            border: '1px solid rgba(168, 85, 247, 0.4)',
            color: '#c084fc',
            padding: '5px 10px',
            borderRadius: '16px',
            fontSize: '0.82rem',
            fontWeight: 700
          }}>
            <Clock size={13} />
            <span>{formatTimerDisplay(trainerElapsedSeconds)}</span>
          </div>

          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#94a3b8',
            padding: '5px 10px',
            borderRadius: '16px',
            fontSize: '0.82rem',
            fontWeight: 700
          }}>
            <span>{currentIndex + 1} / {activeCards.length}</span>
          </div>
        </div>

        {/* Deck badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          color: '#a5b4fc',
          fontSize: '0.8rem',
          fontWeight: 600,
          maxWidth: '120px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          <Folder size={14} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentDeck?.name}</span>
        </div>
      </div>

      {/* Progress Line */}
      <div style={{
        width: '100%',
        maxWidth: '540px',
        margin: '0 auto 12px auto',
        height: '4px',
        background: 'rgba(255, 255, 255, 0.1)',
        borderRadius: '2px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${progressPercent}%`,
          height: '100%',
          background: 'linear-gradient(90deg, #a855f7, #22c55e)',
          borderRadius: '2px',
          transition: 'width 0.3s ease'
        }} />
      </div>

      {/* Card Content Area */}
      <div className="view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', flex: 1 }}>
        <div className="study-card-wrapper" style={{ width: '100%', maxWidth: '440px', position: 'relative' }}>
          <div className="card-container-outer">
            <div className={`card-inner-interactive ${isFlipped ? 'flipped' : ''}`}>
              
              {/* Front Face: Interactive Trainer */}
              {!isFlipped ? (
                <div
                  className="card-face card-face-front card-front trainer-card-face"
                  style={{
                    position: 'relative', isolation: 'isolate', overflow: 'hidden',
                    minHeight: '380px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    padding: '24px 18px',
                    borderRadius: '24px',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.45)',
                    border: '1px solid rgba(168, 85, 247, 0.3)'
                  }}
                >
                  <CardBackground background={effectiveConfig?.front?.card?.background} styleType={resolvedBgFront} cardId={currentCard.id} />
                  <ExerciseRenderer
                    card={currentCard}
                    designConfig={effectiveConfig}
                    studyMode="trainer"
                    isPureTrainerMode={true}
                    isFlipped={isFlipped}
                    onFlip={setIsFlipped}
                    playAudio={playAudio}
                    onTrainerAnswer={handleTrainerAnswer}
                    onNextCard={handleNextCard}
                    fallback={
                      <StudyCardTrainer
                        card={currentCard}
                        designConfig={effectiveConfig}
                        clozeData={clozeData}
                        isFlipped={isFlipped}
                        onFlip={setIsFlipped}
                        playAudio={playAudio}
                        onTrainerAnswer={handleTrainerAnswer}
                        onNextCard={handleNextCard}
                        isPureTrainerMode={true}
                      />
                    }
                  />
                </div>
              ) : (
                /* Back Face: Answer, Full Translation & Grammar Context */
                <div
                  className="card-face card-face-back card-back trainer-card-face"
                  style={{
                    position: 'relative', isolation: 'isolate', overflow: 'hidden',
                    minHeight: '380px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '24px 18px',
                    borderRadius: '24px',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.45)',
                    border: '1px solid rgba(168, 85, 247, 0.3)'
                  }}
                >
                  <CardBackground background={effectiveConfig?.back?.card?.background} styleType={resolvedBgBack} cardId={currentCard.id} />
                  {/* Top full original phrase */}
                  <div style={{ marginBottom: '16px', textAlign: 'center' }}>
                    {(() => {
                      const parsed = parseExerciseContent(currentCard.front || '');
                      const blocks = parsed.blocks || [];
                      const exIdx = blocks.findIndex(b => b.type === 'exercise');
                      const top = exIdx !== -1 ? blocks.slice(0, exIdx) : blocks;
                      return (
                        <>
                          {top.length > 0 && <ExerciseInfoBlocks blocks={top} />}
                          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f1f5f9', whiteSpace: 'pre-wrap', ...cardStyle }}>
                            {cleanBracketSyntax(stripMarkdown(parsed.exercise))}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Translation or Exercise Answer */}
                  <div style={{
                    padding: '12px 16px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '14px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    marginBottom: '14px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {detectExerciseType(currentCard) ? tr("Ответ / объяснение") : tr("Перевод")}
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#4ade80', whiteSpace: 'pre-wrap', ...backCardStyle }}>
                      <MarkdownRenderer>{currentCard.back}</MarkdownRenderer>
                    </div>
                  </div>

                  {/* Context Explanation */}
                  {currentCard.context && (
                    <div style={{
                      padding: '12px 14px',
                      background: 'rgba(168, 85, 247, 0.08)',
                      borderRadius: '14px',
                      border: '1px solid rgba(168, 85, 247, 0.25)',
                      maxHeight: '160px',
                      overflowY: 'auto',
                      fontSize: '0.88rem',
                      lineHeight: 1.45,
                      color: '#e2e8f0',
                      textAlign: 'left',
                      whiteSpace: 'pre-wrap',
                      ...contextStyle
                    }}>
                      <MarkdownRenderer>{currentCard.context}</MarkdownRenderer>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
                    <button
                      className="btn btn-primary"
                      style={{
                        width: '100%',
                        maxWidth: '280px',
                        padding: '12px 20px',
                        fontWeight: 700,
                        borderRadius: '14px',
                        fontSize: '1rem',
                        background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                        color: '#ffffff',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                      onClick={handleNextCard}
                    >{tr("Дальше →")}{' '}</button>

                    <button
                      type="button"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#c084fc',
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                      onClick={() => setIsFlipped(false)}
                    >
                      <Eye size={15} />
                      <span>{tr("Вернуться к заданию")}</span>
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
