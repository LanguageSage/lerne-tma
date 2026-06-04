import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Eye, Volume2, Mic, MicOff, Check, AlertCircle, Undo, Sparkles } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { CardBackground } from '../common/CardBackground';
import { getTextShadow, getContextShadow } from '../../utils/style';
import { useDeckStore } from '../../store/useDeckStore';

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
  studyMode = 'classic'
}) => {
  if (!card) return null;

  const {
    cardFont, cardTextColor, cardFontSize, cardFontWeight, cardFontStyle, cardTextShadow,
    contextFont, contextTextColor, contextFontSize, contextFontWeight, contextFontStyle, contextTextShadow,
    speechMatchThreshold = 75
  } = styles;

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
  const cachedRectsRef = useRef([]);
  
  const recognitionRef = useRef(null);

  // Reset interactive states when card or mode changes
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

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
    }
  }, [card.id, studyMode]);

  // Cleanup speech recognition on unmount
  useEffect(() => {
    return () => {
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

  // ----------------- 1. Cloze (Fill-in-the-blanks) Logic -----------------
  const clozeData = useMemo(() => {
    if (!card || studyMode !== 'cloze') return null;
    const originalText = stripMarkdown(card.front);
    
    // Split text into words, removing punctuation
    const words = originalText.split(/\s+/).map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").trim()).filter(Boolean);
    if (words.length === 0) return { maskedText: originalText, correctAnswer: "", choices: [] };
    
    // Choose longest word (length >= 3)
    const validWords = words.filter(w => w.length >= 3);
    const targetWord = validWords.length > 0 
      ? validWords.reduce((longest, current) => current.length > longest.length ? current : longest, validWords[0])
      : words[0];

    const cleanTarget = targetWord.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "");
    
    // Safe replace: replace only as a whole word (using regex word boundaries)
    let maskedText = originalText;
    try {
      const regex = new RegExp(`\\b${cleanTarget}\\b`, 'i');
      maskedText = originalText.replace(regex, '_____');
    } catch(e) {
      maskedText = originalText.replace(cleanTarget, '_____');
    }

    // Generate distractors
    const allDeckCards = useDeckStore.getState().deckCards || [];
    const allFavCards = useDeckStore.getState().favoriteCards || [];
    const allSourceCards = [...allDeckCards, ...allFavCards];

    const distractorWords = new Set();
    allSourceCards.forEach(c => {
      if (c.id === card.id) return;
      const frontTxt = stripMarkdown(c.front || '');
      frontTxt.split(/\s+/).forEach(w => {
        const cleaned = w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").trim();
        if (cleaned.length >= 3 && cleaned.toLowerCase() !== cleanTarget.toLowerCase()) {
          distractorWords.add(cleaned);
        }
      });
    });

    let distractors = Array.from(distractorWords);
    const fallbackWords = ['Auto', 'Haus', 'Katze', 'Brot', 'Milch', 'Hund', 'Wasser', 'Apfel', 'Buch', 'Tee', 'Kaffee', 'Straße', 'Stadt', 'Land', 'Schule', 'Lehrer'];
    while (distractors.length < 3) {
      const randomFallback = fallbackWords[Math.floor(Math.random() * fallbackWords.length)];
      if (randomFallback.toLowerCase() !== cleanTarget.toLowerCase()) {
        distractors.push(randomFallback);
      }
    }

    // Take 3 random distractors
    const selectedDistractors = [];
    for (let i = 0; i < 3 && distractors.length > 0; i++) {
      const idx = Math.floor(Math.random() * distractors.length);
      selectedDistractors.push(distractors.splice(idx, 1)[0]);
    }

    // Combine and shuffle choices
    const choices = [cleanTarget, ...selectedDistractors].sort(() => Math.random() - 0.5);

    return {
      maskedText,
      correctAnswer: cleanTarget,
      choices
    };
  }, [card.id, studyMode]);

  const handleClozeClick = (option, e) => {
    e.stopPropagation();
    if (correctSelected || isFlipped) return;

    if (option.toLowerCase() === clozeData.correctAnswer.toLowerCase()) {
      setCorrectSelected(option);
      // Play audio and trigger haptic feedback
      if (card.audio_url) playAudio(card.audio_url);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      
      // Auto flip after success
      setTimeout(() => {
        onFlip(true);
      }, 700);
    } else {
      if (!wrongSelected.includes(option)) {
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
  }, [card.id, studyMode]);

  const handlePuzzleChipClick = (wordObj, e) => {
    e.stopPropagation();
    if (isFlipped) return;

    // Add to selected
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

  // Check puzzle correctness when selectedPuzzles changes (on tap and drag-reorder)
  useEffect(() => {
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
        // Incorrect completion, play error haptic
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      }
    }
  }, [selectedPuzzles, puzzleData, studyMode, isFlipped, card.audio_url, playAudio, onFlip]);

  // ----------------- 3. Speech Recognition Logic -----------------
  const startSpeechRecognition = (e) => {
    e?.stopPropagation();
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError("Ваш девайс не поддерживает распознавание голоса.");
      return;
    }

    setSpeechError("");
    setRecognizedText("");
    setSpeechSuccess(false);

    try {
      const rec = new SpeechRecognition();
      rec.lang = 'de-DE';
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsListening(true);
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
      };

      rec.onerror = (err) => {
        console.error("Speech Error:", err);
        if (err.error === 'not-allowed') {
          setSpeechError("Нет доступа к микрофону.");
        } else {
          setSpeechError("Ошибка распознавания. Попробуйте еще раз.");
        }
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      rec.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setRecognizedText(transcript);

        const cleanTranscript = transcript.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").trim();
        const cleanOriginal = stripMarkdown(card.front).toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").trim();

        // Нечеткое сравнение слов (fuzzy word overlap, >= 75%)
        const originalWords = cleanOriginal.split(/\s+/).filter(Boolean);
        const transcriptWords = cleanTranscript.split(/\s+/).filter(Boolean);
        
        let matchCount = 0;
        originalWords.forEach(w => {
          if (transcriptWords.includes(w)) {
            matchCount++;
          }
        });
        
        const matchRatio = originalWords.length > 0 ? matchCount / originalWords.length : 0;
        const isMatched = (matchRatio * 100) >= speechMatchThreshold || cleanTranscript === cleanOriginal || cleanOriginal.includes(cleanTranscript) || cleanTranscript.includes(cleanOriginal);

        if (isMatched) {
          setSpeechSuccess(true);
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
          if (card.audio_url) playAudio(card.audio_url);
          setTimeout(() => {
            onFlip(true);
          }, 1000);
        } else {
          setSpeechSuccess(false);
          window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch(err) {
      setSpeechError("Ошибка при запуске микрофона.");
      setIsListening(false);
    }
  };

  const stopSpeechRecognition = (e) => {
    e?.stopPropagation();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
  };

  // Help reveal button for interactive modes when user is stuck
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
        key={`${card.id}-${historyIndex}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`card-container ${loading ? 'loading-card' : ''}`}
        onClick={() => {
          // If we are in interactive mode (cloze, puzzle, speak) and not flipped yet,
          // tapping the card body should NOT flip it (only clicking options/speech does).
          if (!isFlipped && (studyMode === 'cloze' || studyMode === 'puzzle' || studyMode === 'speak')) {
            return;
          }
          if (!loading) onFlip(!isFlipped);
        }}
        style={cardStyle}
      >
        {!isFlipped ? (
          <div className="card-inner card-front glass">
            <CardBackground styleType={resolvedBgFront} />
            <div className="card-face">
              
              {/* Audio button for fronts in classic/speak/cloze/puzzle modes */}
              {card.audio_url && studyMode !== 'reverse' && (
                <button
                  id="tut-study-audio"
                  className="audio-btn-corner"
                  disabled={loading || isAutoplayActive}
                  onClick={(e) => { e.stopPropagation(); if (!isAutoplayActive) playAudio(card.audio_url); }}
                >
                  {isAudioLoading ? <RefreshCw size={24} className="spin" /> : <Volume2 size={24} />}
                </button>
              )}

              {card.video_front_url && (
                <div className="video-container-card">
                  <video src={card.video_front_url} autoPlay loop muted playsInline />
                </div>
              )}

              {/* Conditionally render front based on studyMode */}
              {studyMode === 'classic' && (
                <>
                  <div className="text-front" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.front)}</div>
                  <div className="flip-hint-badge">
                    <Eye size={16} />
                    <span>Перевернуть карточку</span>
                  </div>
                </>
              )}

              {studyMode === 'reverse' && (
                <>
                  <div className="text-front" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.back)}</div>
                  <div className="flip-hint-badge">
                    <Eye size={16} />
                    <span>Узнать немецкий оригинал</span>
                  </div>
                </>
              )}

              {studyMode === 'cloze' && clozeData && (
                <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
                  <div className="text-hint-translation">{stripMarkdown(card.back)}</div>
                  <div className="text-front cloze-masked-text">{clozeData.maskedText}</div>
                  
                  <div className="cloze-choices-grid">
                    {clozeData.choices.map((opt, i) => {
                      const isWrong = wrongSelected.includes(opt);
                      const isCorrect = correctSelected === opt;
                      return (
                        <button
                          key={i}
                          className={`btn-cloze-option ${isCorrect ? 'correct' : ''} ${isWrong ? 'wrong shake-animation' : ''}`}
                          onClick={(e) => handleClozeClick(opt, e)}
                          disabled={!!correctSelected}
                          style={{
                            fontFamily: cardFont,
                            fontSize: `${cardFontSize}rem`,
                            fontWeight: cardFontWeight,
                            fontStyle: cardFontStyle,
                            textShadow: getTextShadow(cardTextShadow, cardTextColor),
                            ...(isCorrect || isWrong ? {} : { color: cardTextColor })
                          }}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {renderRevealButton()}
                </div>
              )}

              {studyMode === 'puzzle' && puzzleData && (
                <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
                  <div className="text-hint-translation">{stripMarkdown(card.back)}</div>
                  
                  {/* Slots where clicked words are placed (reorderable by drag) */}
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
                      selectedPuzzles.map((w, idx) => {
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
                              onDragStart={() => {
                                setActiveDragId(w.id);
                                // Cache rects of all chips on drag start
                                const chips = document.querySelectorAll('.puzzle-slot-chip');
                                cachedRectsRef.current = Array.from(chips).map((el, i) => ({
                                  index: i,
                                  id: el.getAttribute('data-id'),
                                  rect: el.getBoundingClientRect()
                                }));
                              }}
                              onDrag={(event, info) => {
                                const px = info.point.x;
                                const py = info.point.y;
                                
                                let closestIdx = null;
                                let minDistance = Infinity;
                                
                                cachedRectsRef.current.forEach(({ index, id, rect }) => {
                                  if (id === w.id) return; // skip self
                                  
                                  const cx = rect.left + rect.width / 2;
                                  const cy = rect.top + rect.height / 2;
                                  
                                  const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
                                  if (dist < minDistance) {
                                    minDistance = dist;
                                    closestIdx = index;
                                  }
                                });
                                
                                // Forgiving distance threshold: if finger is within 120px of a chip
                                if (minDistance < 120) {
                                  setHoverIndex(closestIdx);
                                } else {
                                  setHoverIndex(null);
                                }
                              }}
                              onDragEnd={() => {
                                if (hoverIndex !== null && hoverIndex !== idx) {
                                  // Reorder the array
                                  const updated = Array.from(selectedPuzzles);
                                  const [removed] = updated.splice(idx, 1);
                                  updated.splice(hoverIndex, 0, removed);
                                  setSelectedPuzzles(updated);
                                }
                                setActiveDragId(null);
                                setHoverIndex(null);
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
                      })
                    )}
                  </div>

                  {/* Shuffled pool of word chips */}
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

              {studyMode === 'speak' && (
                <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
                  <div className="text-hint-translation" style={{ marginBottom: '10px' }}>{stripMarkdown(card.back)}</div>
                  <div className="text-front speak-target-text" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.front)}</div>

                  <div className="speak-mic-area">
                    <button 
                      className={`btn-speak-mic ${isListening ? 'listening' : ''} ${speechSuccess ? 'success' : ''}`}
                      onMouseDown={startSpeechRecognition}
                      onMouseUp={stopSpeechRecognition}
                      onTouchStart={startSpeechRecognition}
                      onTouchEnd={stopSpeechRecognition}
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
                    <p className="mic-help-label">
                      {isListening ? "Слушаю... Отпустите для проверки" : "Зажмите микрофон и говорите"}
                    </p>
                  </div>

                  {recognizedText && (
                    <div className="recognized-transcript-bubble glass">
                      <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Вы сказали: </span>
                      <strong style={{ color: speechSuccess ? '#10b981' : '#f43f5e' }}>{recognizedText}</strong>
                      {speechSuccess ? (
                        <Check size={16} color="#10b981" style={{ display: 'inline-block', marginLeft: '6px' }} />
                      ) : (
                        <AlertCircle size={16} color="#f43f5e" style={{ display: 'inline-block', marginLeft: '6px' }} />
                      )}
                    </div>
                  )}

                  {speechError && (
                    <div className="speech-error-badge">
                      <AlertCircle size={14} />
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
                  {stripMarkdown(studyMode === 'reverse' ? card.back : card.front)}
                </div>
                {(card.audio_back_url || card.audio_url) && (
                  <button
                    id="tut-study-audio-back"
                    className="audio-btn-back-corner"
                    disabled={loading || isAutoplayActive}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isAutoplayActive) playAudio(studyMode === 'reverse' ? card.audio_back_url : (card.audio_back_url || card.audio_url));
                    }}
                  >
                    {isAudioLoading ? <RefreshCw size={24} className="spin" /> : <Volume2 size={24} />}
                  </button>
                )}
              </div>

              {card.video_back_url && (
                <div className="video-container-card">
                  <video src={card.video_back_url} autoPlay loop muted playsInline />
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
                  {isAudioLoading ? <RefreshCw size={22} className="spin" /> : <Volume2 size={22} />}
                </button>
                <div id="tut-study-answer" className="text-back" style={{ fontStyle: cardFontStyle }}>
                  {stripMarkdown(studyMode === 'reverse' ? card.front : card.back)}
                </div>
              </div>
              
              {card.image_url && (
                <img
                  src={card.image_url}
                  className="card-img"
                  alt="Card"
                  onError={(e) => { console.warn('Image load error:', card.image_url); e.target.style.display = 'none'; }}
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
      </motion.div>
    </AnimatePresence>
  );
};

