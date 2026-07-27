import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Eye, Volume2, Mic, Check, AlertCircle, Sparkles, Sliders } from 'lucide-react';
import { stripMarkdown, normalizeSpeechText } from '../../utils/text';
import { getTextShadow } from '../../utils/style';
import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { getSpeechLocaleForLang } from '../../constants/languageConstants';

export const StudyCardSpeech = React.memo(({
  card,
  onFlip,
  loading,
  playAudio,
  isAudioLoading,
  isAutoplayActive,
  styles = {}
}) => {
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [speechSuccess, setSpeechSuccess] = useState(false);

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const cardFrontRef = useRef(card?.front);

  // Press-and-Hold & Tap refs for microphone
  const isHoldingRef = useRef(false);
  const pressTimerRef = useRef(null);
  const pressStartTimeRef = useRef(0);
  const isPointerDownRef = useRef(false);
  const justHandledPointerRef = useRef(false);
  const recognizedTextRef = useRef("");
  const speechSuccessRef = useRef(false);
  const wasListeningOnPressStartRef = useRef(false);

  const {
    cardFont,
    cardTextColor,
    cardFontSize = 1,
    cardFontWeight,
    cardFontStyle,
    cardTextShadow,
    cardTextAlign,
    speechMatchThreshold = 75
  } = styles;

  useEffect(() => {
    cardFrontRef.current = card?.front;
  }, [card?.front]);

  useEffect(() => {
    recognizedTextRef.current = recognizedText;
  }, [recognizedText]);

  useEffect(() => {
    speechSuccessRef.current = speechSuccess;
  }, [speechSuccess]);

  // Reset speech state on card change
  useEffect(() => {
    setIsListening(false);
    setRecognizedText("");
    setSpeechError("");
    setSpeechSuccess(false);

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
  }, [card?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
    };
  }, []);

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
    if (!transcript || !card) return false;
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
      if (card.audio_url && playAudio) playAudio(card.audio_url);
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
    if (justHandledPointerRef.current) return;

    if (isListening) {
      stopSpeechRecognition(e);
      if (recognizedText) {
        evaluateSpeech(recognizedText, true);
      }
    } else {
      startSpeechRecognition(e);
    }
  };

  if (!card) return null;

  return (
    <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
      <div className="text-front speak-target-text" style={{ fontStyle: cardFontStyle, textAlign: cardTextAlign || 'center' }}>
        {stripMarkdown(card.front)}
      </div>

      {/* Accuracy Threshold Selector */}
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

      {/* Microphone Controls */}
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
              onClick={(e) => { e.stopPropagation(); if (!isAutoplayActive && playAudio) playAudio(card.audio_url); }}
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

      {/* Recognized Transcript Bubble */}
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

      {/* Reveal Answer Button */}
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
    </div>
  );
});
