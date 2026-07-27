import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Eye, Volume2, Mic, MicOff, Check, AlertCircle, Undo, Sparkles, Sliders } from 'lucide-react';
import { stripMarkdown, normalizeSpeechText } from '../../utils/text';
import { CardBackground } from '../common/CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { getSpeechLocaleForLang } from '../../constants/languageConstants';

// Utilities & sub-components
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { parseClozeData, cleanBracketSyntax, autoGenerateChoices } from '../../utils/clozeParser';
import { ConfettiBurst } from '../common/ConfettiBurst';
import { StudyCardTrainer } from './StudyCardTrainer';

// Re-export for backward compatibility
export { playSuccessSound, playErrorSound, cleanBracketSyntax, autoGenerateChoices };

export const StudyCard = ({
  card,
  isFlipped,
  onFlip,
  loading,
  historyIndex,
  playAudio,
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

  const {
    cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow,
    speechMatchThreshold = 75
  } = styles;

  const deckResources = card.deck_metadata?.resources || [];
  const deckImage = deckResources.find(r => r.type === 'image');
  const deckVideo = deckResources.find(r => r.type === 'video');

  const imageUrl = card.image_url || deckImage?.url;

  // Interactive Cloze & Puzzle & Speech states
  const [wrongSelected, setWrongSelected] = useState([]);
  const [correctSelected, setCorrectSelected] = useState(null);
  const [selectedPuzzles, setSelectedPuzzles] = useState([]);
  const [isListening, setIsListening] = useState(false);

  const [recognizedText, setRecognizedText] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [speechSuccess, setSpeechSuccess] = useState(false);
  const [activeDragId, setActiveDragId] = useState(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [dragStartPos, setDragStartPos] = useState(null);
  const [dragCurrentPos, setDragCurrentPos] = useState(null);
  const cachedRectsRef = useRef([]);
  
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const cardFrontRef = useRef(card.front);

  // Press-and-Hold & Tap refs for microphone
  const isHoldingRef = useRef(false);
  const pressTimerRef = useRef(null);
  const pressStartTimeRef = useRef(0);
  const isPointerDownRef = useRef(false);
  const justHandledPointerRef = useRef(false);
  const recognizedTextRef = useRef("");
  const speechSuccessRef = useRef(false);
  const wasListeningOnPressStartRef = useRef(false);

  useEffect(() => {
    cardFrontRef.current = card.front;
  }, [card.front]);

  useEffect(() => {
    recognizedTextRef.current = recognizedText;
  }, [recognizedText]);

  useEffect(() => {
    speechSuccessRef.current = speechSuccess;
  }, [speechSuccess]);

  // Reset interactive states when card, card content or mode changes
  useEffect(() => {
    setWrongSelected([]);
    setCorrectSelected(null);
    setSelectedPuzzles([]);
    setIsListening(false);
    setRecognizedText("");
    setSpeechError("");
    setSpeechSuccess(false);
    setActiveDragId(null);
    setHoverIndex(null);
    setDragStartPos(null);
    setDragCurrentPos(null);

    isHoldingRef.current = false;
    isPointerDownRef.current = false;
    justHandledPointerRef.current = false;
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
    }
  }, [card.id, card.front, card.back, card.updated_at, studyMode]);

  // Cleanup speech recognition on unmount
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
    };
  }, []);

  const cardStyle = {
    fontFamily: cardFont,
    color: cardTextColor,
    fontSize: `${cardFontSize}rem`,
    fontWeight: cardFontWeight,
    fontStyle: cardFontStyle,
    textShadow: getTextShadow(cardTextShadow, cardTextColor)
  };

  const contextStyle = {
    fontFamily: contextFont,
    color: contextTextColor,
    fontSize: `${contextFontSize}rem`,
    fontWeight: contextFontWeight,
    fontStyle: contextFontStyle,
    textShadow: getContextShadow(contextTextShadow, contextTextColor)
  };

  const hasBracketSyntax = /\{([^}]+)\}/.test(card?.front || '');
  const effectiveStudyMode = (hasBracketSyntax || studyMode === 'trainer') ? 'trainer' : studyMode;

  // ----------------- 1. Cloze / Trainer Data Parsing -----------------
  const clozeData = useMemo(() => {
    const allDeckCards = useDeckStore.getState().deckCards || [];
    const allFavCards = useDeckStore.getState().favoriteCards || [];
    const allSourceCards = [...allDeckCards, ...allFavCards];
    return parseClozeData(card, studyMode, allSourceCards);
  }, [card.id, card.front, card.back, card.updated_at, studyMode]);

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

      // Auto flip after success
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

  // ----------------- 2. Puzzle (Sentence Builder) Logic -----------------
  const puzzleData = useMemo(() => {
    if (!card || studyMode !== 'puzzle') return null;
    const originalWords = stripMarkdown(card.front)
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean);

    const cleanWords = originalWords.map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").toLowerCase());

    const shuffledWords = originalWords
      .map((w, index) => ({ id: index, text: w }))
      .sort(() => Math.random() - 0.5);

    return {
      originalWords,
      cleanWords,
      shuffledWords
    };
  }, [card.id, card.front, card.back, card.updated_at, studyMode]);

  const handlePuzzleChipClick = (wordObj, e) => {
    e.stopPropagation();
    if (isFlipped) return;

    const updated = [...selectedPuzzles, wordObj];
    setSelectedPuzzles(updated);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  };

  const handleRemovePuzzleWord = (wordObj, index, e) => {
    e.stopPropagation();
    if (isFlipped) return;

    const updated = selectedPuzzles.filter((_, i) => i !== index);
    setSelectedPuzzles(updated);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  };

  useEffect(() => {
    if (loading) return;
    if (studyMode !== 'puzzle' || !puzzleData || selectedPuzzles.length === 0) return;
    if (isFlipped) return;

    if (selectedPuzzles.length === puzzleData.originalWords.length) {
      const userText = selectedPuzzles.map(w => w.text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").toLowerCase()).join(' ');
      const targetText = puzzleData.cleanWords.join(' ');

      if (userText === targetText) {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
        if (card.audio_url) playAudio(card.audio_url);
        const timer = setTimeout(() => {
          onFlip(true);
        }, 800);
        return () => clearTimeout(timer);
      } else {
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      }
    }
  }, [selectedPuzzles, puzzleData, studyMode, isFlipped, card.audio_url, playAudio, onFlip, loading]);

  // ----------------- 3. Speech Recognition Logic -----------------
  const stopSpeechRecognition = (e) => {
    e?.stopPropagation();
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  };

  const evaluateSpeech = (transcript, isFinalOrManualStop = false) => {
    if (!transcript) return false;
    const currentDeck = useDeckStore.getState().currentDeck;
    const activeLang = useLanguageStore.getState().activeLanguage;
    const cardLang = card.target_language || currentDeck?.target_language || activeLang || 'de';
    const cleanTranscript = normalizeSpeechText(transcript, cardLang);
    const cleanOriginal = normalizeSpeechText(cardFrontRef.current || card.front, cardLang);

    if (!cleanTranscript || !cleanOriginal) return false;

    const originalWords = cleanOriginal.split(/\s+/).filter(Boolean);
    const transcriptWords = cleanTranscript.split(/\s+/).filter(Boolean);

    let matchCount = 0;
    originalWords.forEach(w => {
      if (transcriptWords.includes(w)) {
        matchCount++;
      }
    });

    const matchRatio = originalWords.length > 0 ? matchCount / originalWords.length : 0;
    const currentThreshold = speechMatchThreshold || 75;

    const ratioMatched = (matchRatio * 100) >= currentThreshold;
    const exactMatched = cleanTranscript === cleanOriginal;
    const extraSpokenMatched = cleanTranscript.includes(cleanOriginal) && (originalWords.length / transcriptWords.length >= 0.6);
    const fragmentMatched = cleanOriginal.includes(cleanTranscript) && ((matchRatio * 100) >= currentThreshold);

    const isMatched = ratioMatched || exactMatched || extraSpokenMatched || fragmentMatched;

    if (isMatched) {
      setSpeechSuccess(true);
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      if (card.audio_url) playAudio(card.audio_url);
      setTimeout(() => {
        onFlip(true);
      }, 800);
      return true;
    } else if (isFinalOrManualStop) {
      setSpeechSuccess(false);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      return false;
    }
    return false;
  };

  const startSpeechRecognition = (e) => {
    e?.stopPropagation();
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError("Ваш девайс не поддерживает распознавание голоса.");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
    }

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    setSpeechError("");
    setRecognizedText("");
    setSpeechSuccess(false);
    recognizedTextRef.current = "";

    try {
      const rec = new SpeechRecognition();
      const currentDeck = useDeckStore.getState().currentDeck;
      const activeLang = useLanguageStore.getState().activeLanguage;
      const cardLang = card.target_language || currentDeck?.target_language || activeLang || 'de';
      rec.lang = getSpeechLocaleForLang(cardLang);
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsListening(true);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
      };

      rec.onerror = (err) => {
        console.error("Speech Error:", err);
        if (err.error === 'not-allowed') {
          setSpeechError("Нет доступа к микрофону.");
        } else if (err.error !== 'no-speech' && err.error !== 'aborted') {
          setSpeechError("Ошибка распознавания. Попробуйте еще раз.");
        }
        setIsListening(false);
      };

      rec.onend = () => {
        if (isHoldingRef.current && !speechSuccessRef.current) {
          try {
            rec.start();
            return;
          } catch (err) {}
        }
        setIsListening(false);
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      };

      rec.onresult = (event) => {
        let currentText = '';
        let isFinal = false;

        for (let i = 0; i < event.results.length; i++) {
          currentText += event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            isFinal = true;
          }
        }

        setRecognizedText(currentText);
        recognizedTextRef.current = currentText;

        const matched = evaluateSpeech(currentText, isFinal);

        if (!matched && !isHoldingRef.current) {
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            stopSpeechRecognition();
            evaluateSpeech(currentText, true);
          }, 2200);
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch(err) {
      setSpeechError("Ошибка при запуске микрофона.");
      setIsListening(false);
    }
  };

  const handleMicPointerDown = (e) => {
    e?.stopPropagation();
    pressStartTimeRef.current = Date.now();
    isHoldingRef.current = false;
    isPointerDownRef.current = true;
    wasListeningOnPressStartRef.current = isListening;
    justHandledPointerRef.current = false;

    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
    }

    pressTimerRef.current = setTimeout(() => {
      isHoldingRef.current = true;
    }, 250);

    if (!isListening && !speechSuccess) {
      startSpeechRecognition(e);
    }
  };

  const handleMicPointerUp = (e) => {
    e?.stopPropagation();
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;

    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }

    justHandledPointerRef.current = true;
    setTimeout(() => {
      justHandledPointerRef.current = false;
    }, 300);

    const duration = Date.now() - pressStartTimeRef.current;
    const wasHolding = isHoldingRef.current || duration >= 250;

    if (wasHolding) {
      isHoldingRef.current = false;
      stopSpeechRecognition(e);
      if (recognizedTextRef.current) {
        evaluateSpeech(recognizedTextRef.current, true);
      }
    } else {
      isHoldingRef.current = false;
      if (wasListeningOnPressStartRef.current) {
        stopSpeechRecognition(e);
        if (recognizedTextRef.current) {
          evaluateSpeech(recognizedTextRef.current, true);
        }
      }
    }
  };

  const handleMicClick = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (justHandledPointerRef.current) {
      return;
    }
    if (isListening) {
      stopSpeechRecognition(e);
      if (recognizedText) {
        evaluateSpeech(recognizedText, true);
      }
    } else {
      startSpeechRecognition(e);
    }
  };

  const renderRevealButton = () => {
    return (
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
  };

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
          <div className="card-inner card-front glass">
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
                    {cleanBracketSyntax(stripMarkdown(studyMode === 'reverse' ? card.back : card.front))}
                  </div>
                  <div className="flip-hint-badge">
                    <Eye size={16} />
                    <span>Узнать немецкий оригинал</span>
                  </div>
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
              {studyMode === 'puzzle' && puzzleData && (
                <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
                  <div className="text-hint-translation">{stripMarkdown(card.back)}</div>
                  
                  <div 
                    className="puzzle-target-slots glass"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      width: '100%',
                      minHeight: '58px',
                      padding: '12px',
                      borderRadius: '16px',
                      background: 'rgba(0, 0, 0, 0.2)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      marginBottom: '24px'
                    }}
                  >
                    {selectedPuzzles.length === 0 ? (
                      <span className="puzzle-placeholder">Нажимайте слова ниже, чтобы собрать фразу</span>
                    ) : (
                      <>
                        {selectedPuzzles.map((w, idx) => {
                          const showIndicator = hoverIndex === idx && activeDragId !== null && activeDragId !== w.id;
                          return (
                            <React.Fragment key={w.id}>
                              {showIndicator && (
                                <motion.div 
                                  layoutId="drop-indicator"
                                  className="puzzle-drop-indicator"
                                />
                              )}
                              <motion.span 
                                data-id={w.id}
                                layout
                                drag={!isFlipped}
                                dragSnapToOrigin={true}
                                dragElastic={0}
                                dragMomentum={false}
                                onDragStart={(event, info) => {
                                  setActiveDragId(w.id);
                                  const chips = document.querySelectorAll('.puzzle-slot-chip');
                                  cachedRectsRef.current = Array.from(chips).map((el, i) => ({
                                    index: i,
                                    id: el.getAttribute('data-id'),
                                    rect: el.getBoundingClientRect()
                                  }));

                                  const currentChip = Array.from(chips).find(el => el.getAttribute('data-id') === String(w.id));
                                  const cardEl = document.getElementById('tut-study-card');
                                  if (currentChip && cardEl) {
                                    const rect = currentChip.getBoundingClientRect();
                                    const cardRect = cardEl.getBoundingClientRect();
                                    setDragStartPos({
                                      x: rect.left + rect.width / 2 - cardRect.left,
                                      y: rect.top + rect.height / 2 - cardRect.top
                                    });
                                    setDragCurrentPos({
                                      x: info.point.x - cardRect.left,
                                      y: info.point.y - cardRect.top
                                    });
                                  }
                                }}
                                onDrag={(event, info) => {
                                  const px = info.point.x;
                                  const py = info.point.y;
                                  
                                  const cardEl = document.getElementById('tut-study-card');
                                  if (cardEl) {
                                    const cardRect = cardEl.getBoundingClientRect();
                                    setDragCurrentPos({
                                      x: px - cardRect.left,
                                      y: py - cardRect.top
                                    });
                                  }
                                  
                                  let closestIdx = null;
                                  let minDistance = Infinity;
                                  let isRightOfCenter = false;
                                  
                                  cachedRectsRef.current.forEach(({ index, id, rect }) => {
                                    if (id === w.id) return;
                                    
                                    const cx = rect.left + rect.width / 2;
                                    const cy = rect.top + rect.height / 2;
                                    
                                    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
                                    if (dist < minDistance) {
                                      minDistance = dist;
                                      closestIdx = index;
                                      isRightOfCenter = px > cx;
                                    }
                                  });
                                  
                                  if (minDistance < 120 && closestIdx !== null) {
                                    setHoverIndex(isRightOfCenter ? closestIdx + 1 : closestIdx);
                                  } else {
                                    setHoverIndex(null);
                                  }
                                }}
                                onDragEnd={() => {
                                  if (hoverIndex !== null && hoverIndex !== idx) {
                                    const updated = Array.from(selectedPuzzles);
                                    const [removed] = updated.splice(idx, 1);
                                    const insertIdx = idx < hoverIndex ? hoverIndex - 1 : hoverIndex;
                                    updated.splice(insertIdx, 0, removed);
                                    setSelectedPuzzles(updated);
                                  }
                                  setActiveDragId(null);
                                  setHoverIndex(null);
                                  setDragStartPos(null);
                                  setDragCurrentPos(null);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemovePuzzleWord(w, idx, e);
                                }}
                                className={`puzzle-slot-chip ${activeDragId === w.id ? 'dragging' : ''} ${hoverIndex === idx && activeDragId !== w.id ? 'drag-hover' : ''}`}
                                data-index={idx}
                                style={{
                                  fontFamily: cardFont,
                                  color: cardTextColor,
                                  fontSize: `${cardFontSize}rem`,
                                  fontWeight: cardFontWeight,
                                  fontStyle: cardFontStyle,
                                  textShadow: getTextShadow(cardTextShadow, cardTextColor),
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  cursor: 'grab',
                                  userSelect: 'none',
                                  touchAction: 'none'
                                }}
                              >
                                {w.text}
                              </motion.span>
                            </React.Fragment>
                          );
                        })}
                        {hoverIndex === selectedPuzzles.length && activeDragId !== null && (
                          <motion.div 
                            layoutId="drop-indicator"
                            className="puzzle-drop-indicator"
                          />
                        )}
                      </>
                    )}
                  </div>

                  <div className="puzzle-pool-chips">
                    {puzzleData.shuffledWords.map((w) => {
                      const isSelected = selectedPuzzles.some(p => p.id === w.id);
                      return (
                        <button
                          key={w.id}
                          className="btn-puzzle-chip"
                          disabled={isSelected}
                          onClick={(e) => handlePuzzleChipClick(w, e)}
                          style={{
                            fontFamily: cardFont,
                            color: cardTextColor,
                            fontSize: `${cardFontSize}rem`,
                            fontWeight: cardFontWeight,
                            fontStyle: cardFontStyle,
                            textShadow: getTextShadow(cardTextShadow, cardTextColor)
                          }}
                        >
                          {w.text}
                        </button>
                      );
                    })}
                  </div>
                  {renderRevealButton()}
                </div>
              )}

              {/* Speech Recognition Mode */}
              {studyMode === 'speak' && (
                <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
                  <div className="text-front speak-target-text" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.front)}</div>

                  <div className="speak-threshold-selector" onClick={e => e.stopPropagation()}>
                    <span className="threshold-label"><Sliders size={14} /> Точность:</span>
                    {[50, 75, 85, 100].map(val => (
                      <button
                        key={val}
                        type="button"
                        className={`btn-threshold-pill ${speechMatchThreshold === val ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          useSettingsStore.getState().setSpeechMatchThreshold(val);
                          window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
                        }}
                      >
                        {val}%
                      </button>
                    ))}
                  </div>

                  <div className="speak-mic-area">
                    <div className="speak-mic-controls-row">
                      <button 
                        type="button"
                        className={`btn-speak-mic ${isListening ? 'listening' : ''} ${speechSuccess ? 'success' : ''}`}
                        onClick={handleMicClick}
                        onPointerDown={handleMicPointerDown}
                        onPointerUp={handleMicPointerUp}
                        onPointerLeave={handleMicPointerUp}
                        onPointerCancel={handleMicPointerUp}
                      >
                        {isListening ? (
                          <div className="recording-wave-rings">
                            <span className="ring"></span>
                            <span className="ring"></span>
                            <span className="ring"></span>
                          </div>
                        ) : null}
                        {speechSuccess ? <Check size={32} /> : <Mic size={32} />}
                      </button>

                      {card.audio_url && (
                        <button
                          type="button"
                          className="btn-speak-audio"
                          disabled={loading || isAutoplayActive}
                          onClick={(e) => { e.stopPropagation(); if (!isAutoplayActive) playAudio(card.audio_url); }}
                          title="Озвучить карточку"
                        >
                          {isAudioLoading ? (
                            card.audio_is_generating ? (
                              <Sparkles size={22} className="sparkles-spin" style={{ color: '#a855f7' }} />
                            ) : (
                              <RefreshCw size={22} className="spin" />
                            )
                          ) : (
                            <Volume2 size={24} />
                          )}
                        </button>
                      )}
                    </div>
                    <p className="mic-help-label">
                      {isListening ? "Слушаю... Отпустите или нажмите для проверки" : "Нажмите или удерживайте микрофон"}
                    </p>
                  </div>

                  {recognizedText && (
                    <div 
                      className="recognized-transcript-bubble glass"
                      style={{
                        borderColor: speechSuccess ? 'rgba(16, 185, 129, 0.4)' : (isListening ? 'rgba(255, 255, 255, 0.15)' : 'rgba(244, 63, 94, 0.4)'),
                        flexDirection: 'column',
                        padding: '12px 18px',
                        width: '100%'
                      }}
                    >
                      <span style={{ fontSize: '0.85rem', opacity: 0.75, color: '#cbd5e1', marginBottom: '4px' }}>Вы сказали:</span>
                      <div style={{
                        fontFamily: cardFont,
                        color: cardTextColor,
                        fontSize: `${Math.max(cardFontSize * 1.1, 1.4)}rem`,
                        fontWeight: cardFontWeight,
                        fontStyle: cardFontStyle,
                        textShadow: getTextShadow(cardTextShadow, cardTextColor),
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        wordBreak: 'break-word'
                      }}>
                        <span>{recognizedText}</span>
                        {speechSuccess ? (
                          <Check size={24} color="#10b981" style={{ flexShrink: 0 }} />
                        ) : (!isListening ? (
                          <AlertCircle size={24} color="#f43f5e" style={{ flexShrink: 0 }} />
                        ) : null)}
                      </div>
                    </div>
                  )}

                  {speechError && (
                    <div className="speech-error-badge">
                      <AlertCircle size={16} />
                      <span>{speechError}</span>
                    </div>
                  )}
                  {renderRevealButton()}
                </div>
              )}

            </div>
          </div>
        ) : (
          <div className="card-inner card-back glass">
            <CardBackground styleType={resolvedBgBack} />
            <div className="card-face">
              <div className="front-mini-container" style={{ position: 'relative', width: '100%', marginBottom: '20px' }}>
                <div className="text-front-mini" style={{ marginBottom: 0 }}>
                  {cleanBracketSyntax(stripMarkdown(studyMode === 'reverse' ? card.back : card.front))}
                </div>
                {(studyMode === 'reverse' ? (card.audio_back_url || card.audio_url) : card.audio_url) && (
                  <button
                    id="tut-study-audio-back"
                    className="audio-btn-back-corner"
                    disabled={loading || isAutoplayActive}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isAutoplayActive) {
                        playAudio(studyMode === 'reverse' ? (card.audio_back_url || card.audio_url) : card.audio_url);
                      }
                    }}
                  >
                    {isAudioLoading ? (
                      card.audio_is_generating ? (
                        <Sparkles size={24} className="sparkles-spin" style={{ color: '#a855f7' }} />
                      ) : (
                        <RefreshCw size={24} className="spin" />
                      )
                    ) : (
                      <Volume2 size={24} />
                    )}
                  </button>
                )}
              </div>

              {(card.video_back_url || deckVideo?.url) && (
                <div className="video-container-card">
                  <video src={card.video_back_url || deckVideo?.url} autoPlay loop muted playsInline />
                </div>
              )}
              
              <div className="back-answer-block">
                <button
                  className="audio-btn-translation"
                  disabled={loading || isAudioLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (studyMode === 'reverse') {
                      if (card.audio_url) playAudio(card.audio_url);
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
                <div id="tut-study-answer" className="text-back" style={{ fontStyle: cardFontStyle }}>
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
            </div>
          </div>
        )}

        {loading && (
          <div className="card-loading-overlay">
            <RefreshCw size={40} className="spin" />
          </div>
        )}

        {dragStartPos && dragCurrentPos && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 9999
            }}
          >
            <defs>
              <filter id="arrow-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="6"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#c084fc" />
              </marker>
            </defs>
            <line
              x1={dragStartPos.x}
              y1={dragStartPos.y}
              x2={dragCurrentPos.x}
              y2={dragCurrentPos.y}
              stroke="#c084fc"
              strokeWidth="4"
              strokeDasharray="6 6"
              filter="url(#arrow-glow)"
              markerEnd="url(#arrow)"
            />
          </svg>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
