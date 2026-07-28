import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Eye, Volume2, Sparkles } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { CardBackground } from '../common/CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useDeckStore } from '../../store/useDeckStore';
import { useLanguageStore } from '../../store/useLanguageStore';

// Extracted Sub-components and Utilities
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { parseClozeData, cleanBracketSyntax, autoGenerateChoices } from '../../utils/clozeParser';
import { StudyCardTrainer } from './StudyCardTrainer';
import { StudyCardPuzzle } from './StudyCardPuzzle';
import { StudyCardSpeech } from './StudyCardSpeech';
import { CardAudioPlayer } from './CardAudioPlayer';
import { KaraokeText } from './KaraokeText';
import { useVoicePicker } from '../../hooks/useVoicePicker';
import { useKaraokeSync } from '../../hooks/useKaraokeSync';

// Re-export for backward compatibility
export { playSuccessSound, playErrorSound, cleanBracketSyntax, autoGenerateChoices };
import { getCardStyle, getBackCardStyle, getContextStyle } from '../../utils/cardStyles';

export const StudyCard = React.memo(({
  card,
  isFlipped,
  onFlip,
  loading,
  historyIndex,
  playAudio,
  audioControls,
  sessionVoice = null, // from useSessionVoice in StudyView
  isAudioLoading,
  isAutoplayActive,
  onPlayBackAudio,
  styles,
  resolvedBgFront,
  resolvedBgBack,
  studyMode = 'classic',
  onTrainerAnswer,
  onNextCard
}) => {
  if (!card) return null;

  const deckResources = card.deck_metadata?.resources || [];
  const deckImage = deckResources.find(r => r.type === 'image');
  const deckVideo = deckResources.find(r => r.type === 'video');

  const imageUrl = card.image_url || deckImage?.url;

  // Card language: prefer card-level, then deck-level, then global active language
  const cardLang = card.target_language
    || useDeckStore.getState().currentDeck?.target_language
    || useLanguageStore.getState().activeLanguage
    || 'de';

  const deckId = useDeckStore.getState().currentDeck?.id;

  // Propagate voice choice back to session store so it survives card navigation
  const handleVoiceChange = useCallback((voiceValue) => {
    sessionVoice?.setSessionVoice(deckId, voiceValue);
  }, [sessionVoice, deckId]);

  // Voice picker — scoped to this card's language, initialized from session store
  const storedVoice = sessionVoice?.getSessionVoice(deckId) || null;
  const frontVoicePicker = useVoicePicker(cardLang, storedVoice, handleVoiceChange, true);

  // Karaoke: sync word boundaries with audio playback position
  const { activeWordIndex } = useKaraokeSync(
    frontVoicePicker.wordBoundaries,
    audioControls?.currentTime ?? 0,
    audioControls?.audioState ?? 'idle',
  );

  // Provide current card text to the picker so auto-generate works on voice switch
  const frontText = stripMarkdown(studyMode === 'reverse' ? card.back : card.front);
  useEffect(() => {
    frontVoicePicker.setCardText(frontText);
  }, [frontText]);

  // On card change: keep voice selection (session) but clear stale preview URL
  useEffect(() => {
    frontVoicePicker.setPreviewUrl(null);
  }, [card.id]);

  // Interactive Cloze states
  const [wrongSelected, setWrongSelected] = useState([]);
  const [correctSelected, setCorrectSelected] = useState(null);

  // Reset interactive states when card changes
  useEffect(() => {
    setWrongSelected([]);
    setCorrectSelected(null);
  }, [card.id, card.front, card.back, card.updated_at, studyMode]);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles?.cardFont, styles?.cardTextColor, styles?.cardFontSize, styles?.cardFontWeight, styles?.cardFontStyle, styles?.cardTextShadow, styles?.cardTextAlign]);
  const backCardStyle = useMemo(() => getBackCardStyle(styles), [styles?.cardFont, styles?.cardTextColor, styles?.cardFontSize, styles?.cardFontWeight, styles?.cardFontStyle, styles?.cardTextShadow, styles?.contextTextAlign, styles?.cardTextAlign]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles?.cardFont, styles?.cardTextColor, styles?.cardFontSize, styles?.cardFontWeight, styles?.cardFontStyle, styles?.cardTextShadow, styles?.contextFont, styles?.contextTextColor, styles?.contextFontSize, styles?.contextFontWeight, styles?.contextFontStyle, styles?.contextTextShadow, styles?.contextTextAlign]);

  // Cloze / Trainer Data Parsing
  const clozeData = useMemo(() => {
    const allDeckCards = useDeckStore.getState().deckCards || [];
    const allFavCards = useDeckStore.getState().favoriteCards || [];
    const allSourceCards = [...allDeckCards, ...allFavCards];
    return parseClozeData(card, studyMode, allSourceCards);
  }, [card.id, card.front, card.back, card.updated_at, studyMode]);

  const hasBracketSyntax = /\{([^}]+)\}/.test(card?.front || '');
  const hasTrainerGaps = clozeData && clozeData.gaps && clozeData.gaps.length > 0;
  const effectiveStudyMode = (hasBracketSyntax || hasTrainerGaps)
    ? 'trainer'
    : (studyMode === 'trainer' ? 'classic' : studyMode);

  const handleClozeClick = (option, e) => {
    e.stopPropagation();
    if (correctSelected || isFlipped) return;

    if (option.toLowerCase() === clozeData.correctAnswer.toLowerCase()) {
      setCorrectSelected(option);
      if (card.audio_url) playAudio(card.audio_url);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      
      if (studyMode === 'trainer' && onTrainerAnswer) {
        const isFirstTry = wrongSelected.length === 0;
        onTrainerAnswer(card.id, isFirstTry);
      }

      setTimeout(() => {
        onFlip(true);
      }, 700);
    } else {
      if (!wrongSelected.includes(option)) {
        if (studyMode === 'trainer' && wrongSelected.length === 0 && onTrainerAnswer) {
          onTrainerAnswer(card.id, false);
        }
        setWrongSelected([...wrongSelected, option]);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      }
    }
  };

  const renderRevealButton = () => (
    <button 
      className="btn-interactive-reveal"
      onClick={(e) => {
        e.stopPropagation();
        onFlip(true);
      }}
    >
      <Eye size={18} />
      <span>Показать ответ</span>
    </button>
  );

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        id="tut-study-card"
        key={`${card.id}-${card.front}-${historyIndex}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`card-container ${loading ? 'loading-card' : ''}`}
      >
        {!isFlipped ? (
          <div className="card-inner card-front glass" onClick={() => onFlip(true)} style={{ cursor: 'pointer' }}>
            <CardBackground styleType={resolvedBgFront} />
            <div className="card-face">
              
              {/* Media Preview Header */}
              {imageUrl && (effectiveStudyMode === 'classic' || effectiveStudyMode === 'reverse') && (
                <div className="media-container-card" style={{ marginBottom: '14px' }}>
                  <img src={imageUrl} alt="Card visual" className="card-img" />
                </div>
              )}

              {/* Classic / Reverse Mode Text */}
              {(effectiveStudyMode === 'classic' || effectiveStudyMode === 'reverse') && (
                <>
                  <div id="tut-study-front" className="text-front" style={cardStyle}>
                    <KaraokeText
                      text={cleanBracketSyntax(frontText)}
                      wordBoundaries={frontVoicePicker.wordBoundaries}
                      activeWordIndex={activeWordIndex}
                      style={cardStyle}
                    />
                  </div>
                  <div className="flip-hint-badge">
                    <Eye size={16} />
                    <span>Посмотреть ответ</span>
                  </div>
                  {(studyMode === 'reverse' ? (card.audio_back_url || card.audio_url) : card.audio_url) && (
                    <CardAudioPlayer
                      audioUrl={studyMode === 'reverse' ? (card.audio_back_url || card.audio_url) : card.audio_url}
                      playAudio={audioControls?.playAudio || playAudio}
                      pauseAudio={audioControls?.pauseAudio}
                      resumeAudio={audioControls?.resumeAudio}
                      togglePlayPause={audioControls?.togglePlayPause}
                      stopAudio={audioControls?.stopAudio}
                      seekAudio={audioControls?.seekAudio}
                      setPlaybackSpeed={audioControls?.setPlaybackSpeed}
                      audioState={audioControls?.audioState}
                      currentUrl={audioControls?.currentUrl}
                      currentTime={audioControls?.currentTime}
                      duration={audioControls?.duration}
                      playbackRate={audioControls?.playbackRate}
                      isAudioLoading={isAudioLoading || audioControls?.isAudioLoading}
                      isGenerating={card.audio_is_generating}
                      voicePicker={frontVoicePicker}
                      cardText={frontText}
                      disabled={loading || isAutoplayActive}
                      compact={true}
                    />
                  )}
                </>
              )}


              {/* Trainer Mode Component */}
              {effectiveStudyMode === 'trainer' && clozeData && (
                <StudyCardTrainer
                  card={card}
                  clozeData={clozeData}
                  isFlipped={isFlipped}
                  onFlip={onFlip}
                  playAudio={playAudio}
                  onTrainerAnswer={onTrainerAnswer}
                  onNextCard={onNextCard}
                  styles={styles}
                />
              )}

              {/* Cloze (Fill-in-the-blanks) Mode */}
              {effectiveStudyMode === 'cloze' && clozeData && (
                <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
                  <div className="text-hint-translation" style={{ marginBottom: '12px', opacity: 0.85, fontSize: '1rem' }}>
                    {stripMarkdown(card.back)}
                  </div>

                  <div className="text-front cloze-masked-text" style={{ fontSize: '1.25rem', fontWeight: 600, margin: '14px 0', lineHeight: 1.5 }}>
                    {(() => {
                      const parts = clozeData.maskedText.split('_____');
                      const activeWord = correctSelected || wrongSelected[wrongSelected.length - 1];

                      let borderColor = 'rgba(255,255,255,0.4)';
                      let bgColor = 'rgba(255,255,255,0.05)';
                      let textColor = 'rgba(255,255,255,0.5)';

                      if (correctSelected) {
                        borderColor = '#22c55e';
                        bgColor = 'rgba(34, 197, 94, 0.2)';
                        textColor = '#4ade80';
                      } else if (wrongSelected.length > 0) {
                        borderColor = '#ef4444';
                        bgColor = 'rgba(239, 68, 68, 0.2)';
                        textColor = '#f87171';
                      }

                      return (
                        <>
                          {parts[0]}
                          <span
                            style={{
                              display: 'inline-block',
                              minWidth: '64px',
                              padding: '2px 10px',
                              margin: '0 4px',
                              borderRadius: '8px',
                              border: `2px ${correctSelected ? 'solid' : 'dashed'} ${borderColor}`,
                              background: bgColor,
                              color: textColor,
                              fontWeight: 700,
                              textAlign: 'center',
                              transition: 'all 0.2s ease-in-out'
                            }}
                          >
                            {activeWord || '_____'}
                          </span>
                          {parts[1]}
                        </>
                      );
                    })()}
                  </div>

                  <div className="cloze-choices-grid" style={{ marginTop: '16px' }}>
                    {clozeData.choices.map((opt, i) => {
                      const isWrong = wrongSelected.includes(opt);
                      const isCorrect = correctSelected === opt;

                      let btnClass = 'btn-cloze-option';
                      let customStyle = {
                        fontFamily: cardFont,
                        fontSize: `${cardFontSize}rem`,
                        fontWeight: cardFontWeight,
                        fontStyle: cardFontStyle,
                        textShadow: getTextShadow(cardTextShadow, cardTextColor),
                        color: cardTextColor
                      };

                      if (isCorrect) { btnClass += ' correct'; delete customStyle.color; }
                      if (isWrong) { btnClass += ' wrong shake-animation'; delete customStyle.color; }

                      return (
                        <button
                          key={i}
                          className={btnClass}
                          style={customStyle}
                          onClick={(e) => handleClozeClick(opt, e)}
                          disabled={!!correctSelected}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {renderRevealButton()}
                </div>
              )}

              {/* Puzzle (Sentence Builder) Mode */}
              {studyMode === 'puzzle' && (
                <StudyCardPuzzle
                  card={card}
                  isFlipped={isFlipped}
                  onFlip={onFlip}
                  loading={loading}
                  playAudio={playAudio}
                  styles={styles}
                />
              )}

              {/* Speech Recognition Mode */}
              {studyMode === 'speak' && (
                <StudyCardSpeech
                  card={card}
                  onFlip={onFlip}
                  loading={loading}
                  playAudio={playAudio}
                  isAudioLoading={isAudioLoading}
                  isAutoplayActive={isAutoplayActive}
                  styles={styles}
                />
              )}

            </div>
          </div>
        ) : (
          <div className="card-inner card-back glass" onClick={() => onFlip(false)} style={{ cursor: 'pointer' }}>
            <CardBackground styleType={resolvedBgBack} />
            <div className="card-face">
              {/* В режиме тренажера не выводим дублирующее микро-превью, так как card.back уже содержит полный текст и разбор */}
              {effectiveStudyMode !== 'trainer' && (
                <div className="front-mini-container" style={{ position: 'relative', width: '100%', marginBottom: '20px' }}>
                  <div className="text-front-mini" style={{ marginBottom: 0, opacity: 0.9, ...cardStyle }}>
                    {cleanBracketSyntax(stripMarkdown(studyMode === 'reverse' ? card.back : card.front))}
                  </div>
                  {(studyMode === 'reverse' ? (card.audio_back_url || card.audio_url) : card.audio_url) && (
                    <CardAudioPlayer
                      audioUrl={studyMode === 'reverse' ? (card.audio_back_url || card.audio_url) : card.audio_url}
                      playAudio={audioControls?.playAudio || playAudio}
                      pauseAudio={audioControls?.pauseAudio}
                      resumeAudio={audioControls?.resumeAudio}
                      togglePlayPause={audioControls?.togglePlayPause}
                      stopAudio={audioControls?.stopAudio}
                      seekAudio={audioControls?.seekAudio}
                      setPlaybackSpeed={audioControls?.setPlaybackSpeed}
                      audioState={audioControls?.audioState}
                      currentUrl={audioControls?.currentUrl}
                      currentTime={audioControls?.currentTime}
                      duration={audioControls?.duration}
                      playbackRate={audioControls?.playbackRate}
                      isAudioLoading={isAudioLoading || audioControls?.isAudioLoading}
                      isGenerating={card.audio_is_generating}
                      disabled={loading || isAutoplayActive}
                      compact={true}
                    />
                  )}
                </div>
              )}

              {(card.video_back_url || deckVideo?.url) && (
                <div className="video-container-card">
                  <video src={card.video_back_url || deckVideo?.url} autoPlay loop muted playsInline />
                </div>
              )}
              
              <div className="back-answer-block">
                {(() => {
                  const targetBackAudioUrl = studyMode === 'reverse' ? card.audio_url : card.audio_back_url;
                  if (targetBackAudioUrl) {
                    return (
                      <CardAudioPlayer
                        audioUrl={targetBackAudioUrl}
                        playAudio={(url) => {
                          if (studyMode === 'reverse') {
                            if (card.audio_url && playAudio) playAudio(card.audio_url);
                          } else {
                            onPlayBackAudio?.(card);
                          }
                        }}
                        pauseAudio={audioControls?.pauseAudio}
                        resumeAudio={audioControls?.resumeAudio}
                        togglePlayPause={(url) => {
                          if (audioControls?.currentUrl === url && audioControls?.audioState !== 'idle') {
                            audioControls.togglePlayPause(url);
                          } else {
                            if (studyMode === 'reverse') {
                              if (card.audio_url && playAudio) playAudio(card.audio_url);
                            } else {
                              onPlayBackAudio?.(card);
                            }
                          }
                        }}
                        stopAudio={audioControls?.stopAudio}
                        seekAudio={audioControls?.seekAudio}
                        setPlaybackSpeed={audioControls?.setPlaybackSpeed}
                        audioState={audioControls?.audioState}
                        currentUrl={audioControls?.currentUrl}
                        currentTime={audioControls?.currentTime}
                        duration={audioControls?.duration}
                        playbackRate={audioControls?.playbackRate}
                        isAudioLoading={isAudioLoading || audioControls?.isAudioLoading}
                        isGenerating={card.audio_is_generating}
                        disabled={loading || isAudioLoading}
                        compact={true}
                      />
                    );
                  }
                  return (
                    <button
                      className="audio-btn-translation"
                      disabled={loading || isAudioLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (studyMode === 'reverse') {
                          if (card.audio_url && playAudio) playAudio(card.audio_url);
                        } else {
                          onPlayBackAudio?.(card);
                        }
                      }}
                      title="Озвучить"
                    >
                      {isAudioLoading ? (
                        card.audio_is_generating ? (
                          <Sparkles size={22} className="sparkles-spin" style={{ color: '#a855f7' }} />
                        ) : (
                          <RefreshCw size={22} className="spin" />
                        )
                      ) : (
                        <Volume2 size={22} />
                      )}
                    </button>
                  );
                })()}
                <div id="tut-study-answer" className="text-back" style={backCardStyle}>
                  {cleanBracketSyntax(stripMarkdown(studyMode === 'reverse' ? card.front : card.back))}
                </div>
              </div>
              
              {imageUrl && (
                <img
                  src={imageUrl}
                  className="card-img"
                  alt="Card"
                  onError={(e) => { console.warn('Image load error:', imageUrl); e.target.style.display = 'none'; }}
                />
              )}
              {card.context && (
                <div className="text-context" style={contextStyle}>
                  {stripMarkdown(card.context)}
                </div>
              )}

              {card.creator_name && (
                <div className="creator-badge-corner" style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(0,0,0,0.4)', padding: '4px 10px', borderRadius: '20px', zIndex: 10, opacity: 0.8 }}>
                  {card.creator_avatar ? (
                    <img src={card.creator_avatar} alt="avatar" style={{ width: 18, height: 18, borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '9px' }}>
                      {card.creator_name.charAt(0)}
                    </div>
                  )}
                  <span style={{ fontSize: '0.65rem', color: '#fff', fontWeight: 500 }}>{card.creator_name}</span>
                </div>
              )}

              <div 
                className="flip-hint-badge" 
                style={{ 
                  marginTop: '18px', 
                  cursor: 'pointer', 
                  background: 'rgba(20, 15, 38, 0.9)', 
                  border: '1.5px solid rgba(168, 85, 247, 0.55)', 
                  color: '#ffffff', 
                  fontWeight: 700, 
                  fontSize: '0.92rem', 
                  padding: '8px 16px', 
                  borderRadius: '14px',
                  boxShadow: '0 4px 18px rgba(0, 0, 0, 0.45)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onFlip(false);
                }}
              >
                <Eye size={16} style={{ color: '#c084fc' }} />
                <span>Вернуться к лицевой стороне</span>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="card-loading-overlay">
            <RefreshCw size={40} className="spin" />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
});
