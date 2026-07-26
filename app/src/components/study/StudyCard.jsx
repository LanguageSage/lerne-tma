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

export const playSuccessSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 chime
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0, now + idx * 0.07);
      gain.gain.linearRampToValueAtTime(0.25, now + idx * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.35);
    });
  } catch (e) { console.warn('Sound synth error:', e); }
};

export const playErrorSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const now = ctx.currentTime;
    [220, 175].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.1);
      gain.gain.setValueAtTime(0.2, now + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.1 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.1);
      osc.stop(now + idx * 0.1 + 0.2);
    });
  } catch (e) { console.warn('Sound synth error:', e); }
};

const ConfettiBurst = () => {
  const particles = useMemo(() => {
    const symbols = ['🎉', '✨', '⭐', '🌟', '💥', '🟢', '✨', '⭐'];
    const colors = ['#22c55e', '#a855f7', '#eab308', '#3b82f6', '#ec4899', '#10b981'];
    return Array.from({ length: 22 }).map((_, i) => ({
      id: i,
      symbol: symbols[i % symbols.length],
      color: colors[i % colors.length],
      x: (Math.random() - 0.5) * 260,
      y: (Math.random() - 0.7) * 220,
      scale: 0.7 + Math.random() * 0.7,
      rotation: (Math.random() - 0.5) * 360,
    }));
  }, []);

  return (
    <div style={{ position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: 100 }}>
      {particles.map(p => (
        <motion.div
          key={p.id}
          initial={{ opacity: 1, x: 0, y: 0, scale: 0, rotate: 0 }}
          animate={{
            opacity: [1, 1, 0],
            x: p.x,
            y: p.y,
            scale: p.scale,
            rotate: p.rotation
          }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            fontSize: '1.5rem',
            color: p.color,
            filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.7))'
          }}
        >
          {p.symbol}
        </motion.div>
      ))}
    </div>
  );
};

const ARTICLE_GROUPS = [
  ['der', 'die', 'das', 'den', 'dem', 'des'],
  ['ein', 'eine', 'einen', 'einem', 'einer', 'eines'],
  ['mein', 'meine', 'meinen', 'meinem', 'meiner', 'meines'],
  ['dein', 'deine', 'deinen', 'deinem', 'deiner', 'deines'],
  ['kein', 'keine', 'keinen', 'keinem', 'keiner', 'keines'],
  ['dich', 'dir', 'du', 'dein'],
  ['mich', 'mir', 'ich', 'mein'],
  ['ihn', 'ihm', 'er', 'sein'],
  ['uns', 'wir', 'unser', 'unsere'],
  ['euch', 'ihr', 'euer', 'eure']
];

export const autoGenerateChoices = (correctWord, existingChoices = []) => {
  if (existingChoices.length > 1) return existingChoices;
  const lower = (correctWord || '').toLowerCase().trim();
  for (const group of ARTICLE_GROUPS) {
    if (group.includes(lower)) {
      const distractors = group.filter(w => w !== lower);
      const chosen = [];
      const copy = [...distractors];
      while (chosen.length < 3 && copy.length > 0) {
        const idx = Math.floor(Math.random() * copy.length);
        chosen.push(copy.splice(idx, 1)[0]);
      }
      return [correctWord, ...chosen];
    }
  }
  return existingChoices;
};

export const cleanBracketSyntax = (text) => {
  if (!text) return '';
  return text.replace(/\{([^}]+)\}/g, (match, contents) => {
    const parts = contents.split(/[|;]/).map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    const correct = parts.find(p => p.startsWith('*')) || parts[0];
    return correct.replace(/^\*/, '').trim();
  });
};

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
  onTrainerAnswer
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

  // Interactive Cloze & Puzzle & Speech & Trainer states
  const [wrongSelected, setWrongSelected] = useState([]);
  const [correctSelected, setCorrectSelected] = useState(null);
  const [selectedPuzzles, setSelectedPuzzles] = useState([]);
  const [isListening, setIsListening] = useState(false);

  // Trainer specific state
  const [selectedTrainerOption, setSelectedTrainerOption] = useState(null);
  const [isTrainerChecked, setIsTrainerChecked] = useState(false);
  const [isTrainerFirstTry, setIsTrainerFirstTry] = useState(true);

  useEffect(() => {
    setSelectedTrainerOption(null);
    setIsTrainerChecked(false);
    setIsTrainerFirstTry(true);
  }, [card?.id, historyIndex]);
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

  // ----------------- 1. Cloze (Fill-in-the-blanks) / Trainer Logic -----------------
  const clozeData = useMemo(() => {
    if (!card || (studyMode !== 'cloze' && studyMode !== 'trainer')) return null;
    const originalText = stripMarkdown(card.front);

    // 1. Check for explicit bracket syntax: {*correct|distractor1|distractor2} or {correct|distractor1|distractor2} or {correct}
    const bracketMatch = originalText.match(/\{([^}]+)\}/);
    if (bracketMatch) {
      const optionsRaw = bracketMatch[1].split(/[|;]/).map(o => o.trim()).filter(Boolean);
      if (optionsRaw.length > 0) {
        let correctAnswer = optionsRaw.find(o => o.startsWith('*')) || optionsRaw[0];
        const cleanCorrect = correctAnswer.replace(/^\*/, '').trim();
        let cleanChoices = optionsRaw.map(o => o.replace(/^\*/, '').trim());
        
        // Auto-generate choices if user wrote simplified single syntax like {den}
        cleanChoices = autoGenerateChoices(cleanCorrect, cleanChoices);

        const maskedText = originalText.replace(/\{([^}]+)\}/, '_____');
        // Shuffle choices for display
        const shuffledChoices = [...cleanChoices].sort(() => Math.random() - 0.5);
        return {
          maskedText,
          correctAnswer: cleanCorrect,
          choices: shuffledChoices
        };
      }
    }

    // 2. Standard cloze fallback: choose longest word
    const words = originalText.split(/\s+/).map(w => w.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "").trim()).filter(Boolean);
    if (words.length === 0) return { maskedText: originalText, correctAnswer: "", choices: [] };
    
    const validWords = words.filter(w => w.length >= 3);
    const targetWord = validWords.length > 0 
      ? validWords.reduce((longest, current) => current.length > longest.length ? current : longest, validWords[0])
      : words[0];

    const cleanTarget = targetWord.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»]/g, "");
    
    let maskedText = originalText;
    try {
      const regex = new RegExp(`\\b${cleanTarget}\\b`, 'i');
      maskedText = originalText.replace(regex, '_____');
    } catch(e) {
      maskedText = originalText.replace(cleanTarget, '_____');
    }

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

    const selectedDistractors = [];
    for (let i = 0; i < 3 && distractors.length > 0; i++) {
      const idx = Math.floor(Math.random() * distractors.length);
      selectedDistractors.push(distractors.splice(idx, 1)[0]);
    }

    const choices = [cleanTarget, ...selectedDistractors].sort(() => Math.random() - 0.5);

    return {
      maskedText,
      correctAnswer: cleanTarget,
      choices
    };
  }, [card.id, card.front, card.back, card.updated_at, studyMode]);

  const handleClozeClick = (option, e) => {
    e.stopPropagation();
    if (correctSelected || isFlipped) return;

    if (option.toLowerCase() === clozeData.correctAnswer.toLowerCase()) {
      setCorrectSelected(option);
      if (card.audio_url) playAudio(card.audio_url);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      
      if (studyMode === 'trainer' && onTrainerAnswer) {
        // If wrongSelected has elements, this was not answered correctly on 1st try
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
        // Incorrect completion, play error haptic
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

    // 1. Percentage overlap match: word ratio >= threshold %
    const ratioMatched = (matchRatio * 100) >= currentThreshold;

    // 2. Exact match
    const exactMatched = cleanTranscript === cleanOriginal;

    // 3. Spoke target + extra words (e.g. Target: "Tisch", Spoke: "der Tisch")
    const extraSpokenMatched = cleanTranscript.includes(cleanOriginal) && (originalWords.length / transcriptWords.length >= 0.6);

    // 4. Spoke fragment of target: ONLY if word coverage ratio ALSO meets threshold!
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

        // Auto silence timer: if user pauses speaking for 2.2s, stop recording and do final evaluation,
        // UNLESS the user is currently holding down the mic button!
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
        key={`${card.id}-${card.front}-${historyIndex}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`card-container ${loading ? 'loading-card' : ''}`}
        onClick={() => {
          // If we are in interactive mode (cloze, trainer, puzzle, speak) and not flipped yet,
          // tapping the card body should NOT flip it (only clicking options/speech does).
          if (!isFlipped && (studyMode === 'cloze' || studyMode === 'trainer' || studyMode === 'puzzle' || studyMode === 'speak')) {
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
              
              {/* Audio button for fronts in classic/speak/cloze/puzzle/trainer modes */}
              {card.audio_url && studyMode !== 'reverse' && (
                <button
                  id="tut-study-audio"
                  className="audio-btn-corner"
                  disabled={loading || isAutoplayActive}
                  onClick={(e) => { e.stopPropagation(); if (!isAutoplayActive) playAudio(card.audio_url); }}
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

              {card.video_front_url && (
                <div className="video-container-card">
                  <video src={card.video_front_url} autoPlay loop muted playsInline />
                </div>
              )}

              {imageUrl && !card.video_front_url && (
                <div className="video-container-card" style={{ maxHeight: '160px', overflow: 'hidden', marginBottom: '15px' }}>
                  <img
                    src={imageUrl}
                    alt="Context"
                    style={{
                      width: '100%',
                      height: '160px',
                      objectFit: 'cover'
                    }}
                    onError={(e) => { e.target.parentNode.style.display = 'none'; }}
                  />
                </div>
              )}

              {/* Conditionally render front based on studyMode */}
              {studyMode === 'classic' && (
                <>
                  <div className="text-front" style={{ fontStyle: cardFontStyle }}>{cleanBracketSyntax(stripMarkdown(card.front))}</div>
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

              {(studyMode === 'cloze' || studyMode === 'trainer') && clozeData && (
                <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
                  {studyMode === 'cloze' && (
                    <div className="text-hint-translation" style={{ marginBottom: '12px', opacity: 0.85, fontSize: '1rem' }}>
                      {stripMarkdown(card.back)}
                    </div>
                  )}

                  <div className="text-front cloze-masked-text" style={{ fontSize: '1.25rem', fontWeight: 600, margin: '14px 0', lineHeight: 1.5 }}>
                    {(() => {
                      const parts = clozeData.maskedText.split('_____');
                      const activeWord = selectedTrainerOption || (studyMode === 'cloze' ? (correctSelected || wrongSelected[wrongSelected.length - 1]) : null);
                      const isCorrectAnswer = activeWord?.toLowerCase() === clozeData.correctAnswer.toLowerCase();

                      let borderColor = 'rgba(255,255,255,0.4)';
                      let bgColor = 'rgba(255,255,255,0.05)';
                      let textColor = 'rgba(255,255,255,0.5)';

                      if (studyMode === 'trainer') {
                        if (isTrainerChecked) {
                          borderColor = isCorrectAnswer ? '#22c55e' : '#ef4444';
                          bgColor = isCorrectAnswer ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
                          textColor = isCorrectAnswer ? '#4ade80' : '#f87171';
                        } else if (selectedTrainerOption) {
                          borderColor = '#a855f7';
                          bgColor = 'rgba(168, 85, 247, 0.2)';
                          textColor = '#c084fc';
                        }
                      } else {
                        if (correctSelected) {
                          borderColor = '#22c55e';
                          bgColor = 'rgba(34, 197, 94, 0.2)';
                          textColor = '#4ade80';
                        } else if (wrongSelected.length > 0) {
                          borderColor = '#ef4444';
                          bgColor = 'rgba(239, 68, 68, 0.2)';
                          textColor = '#f87171';
                        }
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
                              border: `2px ${selectedTrainerOption || correctSelected ? 'solid' : 'dashed'} ${borderColor}`,
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
                      const isSelected = selectedTrainerOption === opt;
                      const isCorrectChoice = opt.toLowerCase() === clozeData.correctAnswer.toLowerCase();
                      
                      let btnClass = 'btn-cloze-option';
                      let customStyle = {
                        fontFamily: cardFont,
                        fontSize: `${cardFontSize}rem`,
                        fontWeight: cardFontWeight,
                        fontStyle: cardFontStyle,
                        textShadow: getTextShadow(cardTextShadow, cardTextColor),
                        color: cardTextColor
                      };

                      if (studyMode === 'trainer') {
                        if (isTrainerChecked) {
                          if (isCorrectChoice) {
                            btnClass += ' correct';
                            delete customStyle.color;
                          } else if (isSelected && !isCorrectChoice) {
                            btnClass += ' wrong shake-animation';
                            delete customStyle.color;
                          }
                        } else if (isSelected) {
                          customStyle = {
                            ...customStyle,
                            border: '2px solid #a855f7',
                            background: 'rgba(168, 85, 247, 0.3)',
                            color: '#ffffff',
                            boxShadow: '0 0 12px rgba(168, 85, 247, 0.4)'
                          };
                        }
                      } else {
                        const isWrong = wrongSelected.includes(opt);
                        const isCorrect = correctSelected === opt;
                        if (isCorrect) { btnClass += ' correct'; delete customStyle.color; }
                        if (isWrong) { btnClass += ' wrong shake-animation'; delete customStyle.color; }
                      }

                      return (
                        <button
                          key={i}
                          className={btnClass}
                          style={customStyle}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (studyMode === 'trainer') {
                              if (!isTrainerChecked) {
                                setSelectedTrainerOption(opt);
                                window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
                              }
                            } else {
                              handleClozeClick(opt, e);
                            }
                          }}
                          disabled={studyMode === 'trainer' ? isTrainerChecked : !!correctSelected}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  {studyMode === 'trainer' ? (
                    <div style={{ marginTop: '24px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      {isTrainerChecked && card.back && (
                        <div className="text-hint-translation" style={{ marginBottom: '8px', opacity: 0.9, fontSize: '0.95rem', color: '#e2e8f0', textAlign: 'center', background: 'rgba(255,255,255,0.06)', padding: '10px 14px', borderRadius: '10px', width: '100%' }}>
                          {stripMarkdown(card.back)}
                        </div>
                      )}

                      {!isTrainerChecked ? (
                        <button
                          className="btn btn-primary"
                          style={{
                            width: '100%',
                            maxWidth: '300px',
                            padding: '14px 24px',
                            fontWeight: 700,
                            borderRadius: '14px',
                            fontSize: '1.05rem',
                            opacity: selectedTrainerOption ? 1 : 0.4,
                            cursor: selectedTrainerOption ? 'pointer' : 'not-allowed',
                            background: selectedTrainerOption ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'rgba(255,255,255,0.12)',
                            color: '#ffffff',
                            boxShadow: selectedTrainerOption ? '0 4px 20px rgba(168, 85, 247, 0.4)' : 'none',
                            border: 'none',
                            transition: 'all 0.2s ease-in-out'
                          }}
                          disabled={!selectedTrainerOption}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!selectedTrainerOption) return;
                            setIsTrainerChecked(true);
                            const isCorrect = selectedTrainerOption.toLowerCase() === clozeData.correctAnswer.toLowerCase();
                            if (isCorrect) {
                              playSuccessSound();
                              if (card.audio_url) playAudio(card.audio_url);
                              window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
                              onTrainerAnswer?.(card.id, isTrainerFirstTry);
                            } else {
                              playErrorSound();
                              setIsTrainerFirstTry(false);
                              window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
                              onTrainerAnswer?.(card.id, false);
                            }
                          }}
                        >
                          Проверить
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary"
                          style={{
                            width: '100%',
                            maxWidth: '300px',
                            padding: '14px 24px',
                            fontWeight: 700,
                            borderRadius: '14px',
                            fontSize: '1.05rem',
                            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                            color: '#ffffff',
                            boxShadow: '0 4px 20px rgba(34, 197, 94, 0.4)',
                            border: 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease-in-out'
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onFlip(true);
                          }}
                        >
                          Дальше →
                        </button>
                      )}

                      {isTrainerChecked && selectedTrainerOption?.toLowerCase() === clozeData.correctAnswer.toLowerCase() && (
                        <ConfettiBurst />
                      )}
                    </div>
                  ) : (
                    renderRevealButton()
                  )}
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
                                  // Cache rects of all chips on drag start
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
                                    if (id === w.id) return; // skip self
                                    
                                    const cx = rect.left + rect.width / 2;
                                    const cy = rect.top + rect.height / 2;
                                    
                                    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
                                    if (dist < minDistance) {
                                      minDistance = dist;
                                      closestIdx = index;
                                      isRightOfCenter = px > cx;
                                    }
                                  });
                                  
                                  // Forgiving distance threshold: if finger is within 120px of a chip
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
                  <div className="text-front speak-target-text" style={{ fontStyle: cardFontStyle }}>{stripMarkdown(card.front)}</div>

                  {/* Quick Speech Accuracy Threshold Selector */}
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

