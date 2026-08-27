import React, { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Clock, Target, Folder, Eye } from 'lucide-react';

import { useUiStore } from '../../store/useUiStore';
import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useAudio } from '../../hooks/useAudio';
import { parseClozeData, cleanBracketSyntax } from '../../utils/clozeParser';
import { stripMarkdown } from '../../utils/text';
import { getCardStyle, getBackCardStyle, getContextStyle } from '../../utils/cardStyles';

import { StudyCardTrainer } from './StudyCardTrainer';
import { TrainerFinished } from './TrainerFinished';

export const TrainerView = () => {
  const { setView, showToast } = useUiStore();
  const { currentDeck, deckCards, fetchDeckCards } = useDeckStore();

  const autoPlay = useSettingsStore(s => s.autoPlay);
  const cardBgFront = useSettingsStore(s => s.cardBgFront);
  const cardBgBack = useSettingsStore(s => s.cardBgBack);
  const cardFont = useSettingsStore(s => s.cardFont);
  const cardTextColor = useSettingsStore(s => s.cardTextColor);
  const cardFontSize = useSettingsStore(s => s.cardFontSize);
  const cardFontWeight = useSettingsStore(s => s.cardFontWeight);
  const cardFontStyle = useSettingsStore(s => s.cardFontStyle);
  const cardTextShadow = useSettingsStore(s => s.cardTextShadow);
  const cardTextAlign = useSettingsStore(s => s.cardTextAlign);
  const contextFont = useSettingsStore(s => s.contextFont);
  const contextTextColor = useSettingsStore(s => s.contextTextColor);
  const contextFontSize = useSettingsStore(s => s.contextFontSize);
  const contextFontWeight = useSettingsStore(s => s.contextFontWeight);
  const contextFontStyle = useSettingsStore(s => s.contextFontStyle);
  const contextTextShadow = useSettingsStore(s => s.contextTextShadow);
  const contextTextAlign = useSettingsStore(s => s.contextTextAlign);

  const styleSettings = useMemo(() => ({
    cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow, cardTextAlign,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow, contextTextAlign
  }), [cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow, cardTextAlign, contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow, contextTextAlign]);

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

  const availableStyles = ['mesh', 'aurora', 'holographic', 'liquid', 'liquid_sunset', 'liquid_ocean', 'liquid_cosmic', 'liquid_emerald', 'video_aquarium', 'video_space', 'video_nature'];
  const getResolvedStyle = (settingStyle, cardId) => {
    if (settingStyle !== 'auto') return settingStyle;
    if (!cardId) return 'standard';
    const sum = cardId.toString().split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return availableStyles[sum % availableStyles.length];
  };

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

  const cardStyle = useMemo(() => getCardStyle(styleSettings), [styleSettings]);
  const backCardStyle = useMemo(() => getBackCardStyle(styleSettings), [styleSettings]);
  const contextStyle = useMemo(() => getContextStyle(styleSettings), [styleSettings]);

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
            onGoToDecks={() => setView('cards')}
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
          className="btn-header-back"
          onClick={() => {
            stopAudio();
            setView('cards');
          }}
          title="Вернуться к колоде"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#f8fafc',
            borderRadius: '12px',
            padding: '8px 14px',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={18} />
          <span>Колода</span>
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
      <div className="view" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <div className="study-card-wrapper" style={{ width: '100%', maxWidth: '440px' }}>
          <div className="card-container-outer">
            <div className={`card-inner-interactive ${isFlipped ? 'flipped' : ''}`}>
              
              {/* Front Face: Interactive Trainer */}
              {!isFlipped ? (
                <div
                  className={`card-face card-face-front card-bg-${resolvedBgFront}`}
                  style={{
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
                  <StudyCardTrainer
                    card={currentCard}
                    clozeData={clozeData}
                    isFlipped={isFlipped}
                    onFlip={setIsFlipped}
                    playAudio={playAudio}
                    onTrainerAnswer={handleTrainerAnswer}
                    onNextCard={handleNextCard}
                    styles={styleSettings}
                    isPureTrainerMode={true}
                  />
                </div>
              ) : (
                /* Back Face: Answer, Full Translation & Grammar Context */
                <div
                  className={`card-face card-face-back card-bg-${resolvedBgBack}`}
                  style={{
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
                  {/* Top full original phrase */}
                  <div style={{ marginBottom: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f1f5f9', whiteSpace: 'pre-wrap', ...cardStyle }}>
                      {cleanBracketSyntax(stripMarkdown(currentCard.front))}
                    </div>
                  </div>

                  {/* Russian Translation */}
                  <div style={{
                    padding: '12px 16px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '14px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    marginBottom: '14px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Перевод
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#4ade80', whiteSpace: 'pre-wrap', ...backCardStyle }}>
                      {stripMarkdown(currentCard.back)}
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
                      {stripMarkdown(currentCard.context)}
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
                    >
                      Дальше →
                    </button>

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
                      <span>Вернуться к заданию</span>
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
