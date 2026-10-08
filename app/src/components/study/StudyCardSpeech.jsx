import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useEffectEvent, useRef, useMemo } from 'react';
import { RefreshCw, Eye, Volume2, Mic, Check, AlertCircle, Sparkles, Sliders } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { evaluateStudySpeech } from '../../utils/speechEvaluation.js';
import { getTextShadow } from '../../utils/style';
import { useDeckStore } from '../../store/useDeckStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { getSpeechLocaleForLang } from '../../constants/languageConstants';
import { getCardStyle } from '../../utils/cardStyles';
import { triggerHaptic } from '../../utils/platform';
import { stopGlobalAudio } from '../../hooks/useAudio';
import { parseExerciseContent } from '../../utils/exerciseContentParser';
import { cleanBracketSyntax } from '../../utils/clozeParser';
import { ExerciseInfoBlocks } from './ExerciseInfoBlocks.jsx';


export const StudyCardSpeech = React.memo(({
  card,
  targetText,
  reviewKey,
  onSuccess,
  onSkip,
  followUp = false,
  onFlip,
  loading,
  playAudio,
  onPlayCardAudio,
  stopAudio,
  isAudioLoading,
  isAutoplayActive,
  styles = {}
}) => {
  useInterfaceLocale();
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [speechSuccess, setSpeechSuccess] = useState(false);

  const exerciseContent = useMemo(() => parseExerciseContent(card?.front || ''), [card?.front]);
  const spokenFront = useMemo(
    () => targetText ?? cleanBracketSyntax(exerciseContent.exercise),
    [targetText, exerciseContent]
  );

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const cardFrontRef = useRef(spokenFront);

  const recognizedTextRef = useRef("");
  const speechSuccessRef = useRef(false);

  const speechMatchThreshold = useSettingsStore(s => s.speechMatchThreshold) ?? 75;
  const setSpeechMatchThreshold = useSettingsStore(s => s.setSpeechMatchThreshold);

  const {
    cardFont,
    cardTextColor,
    cardFontSize = 1,
    cardFontWeight,
    cardFontStyle,
    cardTextShadow
  } = styles;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cardStyle = useMemo(() => getCardStyle(styles), [
    styles?.cardFont,
    styles?.cardTextColor,
    styles?.cardFontSize,
    styles?.cardFontWeight,
    styles?.cardFontStyle,
    styles?.cardTextShadow,
    styles?.cardTextAlign
  ]);

  useEffect(() => {
    cardFrontRef.current = spokenFront;
  }, [spokenFront]);

  useEffect(() => {
    recognizedTextRef.current = recognizedText;
  }, [recognizedText]);

  useEffect(() => {
    speechSuccessRef.current = speechSuccess;
  }, [speechSuccess]);

  // Reset speech state on card change
  useEffect(() => {
    stopSpeechRecognition();
    setIsListening(false);
    setRecognizedText("");
    setSpeechError("");
    setSpeechSuccess(false);

    speechSuccessRef.current = false;
    recognizedTextRef.current = "";
    // Retired recognition instances must not report into another card/step.
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      retireSpeechRecognition();
    };
  }, [card?.id, reviewKey, spokenFront]);

  const retireSpeechRecognition = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onstart = null;
    recognition.onerror = null;
    recognitionRef.current = null;
    try { recognition.abort(); } catch { /* ignore */ }
  };

  const stopSpeechRecognition = (e) => {
    e?.stopPropagation();
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { /* ignore */ }
    }
  };

  const evaluateSpeech = (transcript, isFinalCheck = false, overrideThreshold = null) => {
    if (!transcript || !card || speechSuccessRef.current) return false;

    const currentDeck = useDeckStore.getState().currentDeck;
    const activeLang = useLanguageStore.getState().activeLanguage;
    const cardLang = card.target_language || currentDeck?.target_language || activeLang || 'de';
    const currentThreshold = overrideThreshold !== null ? overrideThreshold : (speechMatchThreshold || 75);
    const result = evaluateStudySpeech({
      transcript, targetText: cardFrontRef.current || spokenFront, language: cardLang, threshold: currentThreshold,
    });

    if (result.success) {
      speechSuccessRef.current = true;
      setSpeechSuccess(true);
      setIsListening(false);
      
      stopSpeechRecognition();

      triggerHaptic('success');
      onSuccess?.({ ...result, transcript, targetText: cardFrontRef.current || spokenFront });
      return true;
    } else if (isFinalCheck) {
      setSpeechSuccess(false);
      triggerHaptic('error');
      return false;
    }
    return false;
  };

  const startSpeechRecognition = (e) => {
    e?.stopPropagation();
    
    if (speechSuccessRef.current) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechError(tr("Ваш девайс не поддерживает распознавание голоса."));
      return;
    }

    // Stop any playing audio immediately so mic does not catch speaker audio
    try {
      stopAudio?.();
      stopGlobalAudio();
    } catch { /* ignore */ }

    retireSpeechRecognition();

    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    setSpeechError("");
    setRecognizedText("");
    setSpeechSuccess(false);
    speechSuccessRef.current = false;
    recognizedTextRef.current = "";

    try {
      const rec = new SpeechRecognition();
      const currentDeck = useDeckStore.getState().currentDeck;
      const activeLang = useLanguageStore.getState().activeLanguage;
      const cardLang = card.target_language || currentDeck?.target_language || activeLang || 'de';
      
      rec.lang = getSpeechLocaleForLang(cardLang);
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsListening(true);
        triggerHaptic('medium');
      };

      rec.onerror = (err) => {
        console.error("Speech Error:", err);
        if (err.error === 'not-allowed') {
          setSpeechError(tr("Нет доступа к микрофону."));
        } else if (err.error !== 'no-speech' && err.error !== 'aborted') {
          setSpeechError(tr("Ошибка распознавания. Попробуйте еще раз."));
        }
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        if (!speechSuccessRef.current && recognizedTextRef.current) {
          evaluateSpeech(recognizedTextRef.current, true);
        }
      };

      rec.onresult = (event) => {
        let textChunks = [];

        for (let i = 0; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript.trim();
          if (!chunk) continue;

          if (textChunks.length === 0) {
            textChunks.push(chunk);
          } else {
            const prev = textChunks[textChunks.length - 1];
            // If Brave/Android cumulative chunk starts with the previous chunk, replace it!
            if (chunk.toLowerCase().startsWith(prev.toLowerCase())) {
              textChunks[textChunks.length - 1] = chunk;
            } 
            // If previous chunk ends with the new chunk or equals it, skip
            else if (prev.toLowerCase().endsWith(chunk.toLowerCase())) {
              continue;
            } 
            // Otherwise, it's a new consecutive phrase chunk, append it!
            else {
              textChunks.push(chunk);
            }
          }
        }

        const transcript = textChunks.join(' ').replace(/\s+/g, ' ').trim();
        setRecognizedText(transcript);
        recognizedTextRef.current = transcript;

        // Auto-evaluate 100% success while speaking on the fly
        const matched = evaluateSpeech(transcript, false, 100);
        if (matched) return;

        // Silence timer (1.5s): if user stops speaking and 100% wasn't reached, evaluate user's selected threshold (e.g. 75%)
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          stopSpeechRecognition();
          evaluateSpeech(recognizedTextRef.current, true);
        }, 1500);
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      setSpeechError(tr("Ошибка при запуске микрофона."));
      setIsListening(false);
    }
  };

  const handleMicClick = (e) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (speechSuccessRef.current) return;

    // Immediately stop and interrupt any previously played audio
    try {
      stopAudio?.();
      stopGlobalAudio();
    } catch { /* ignore */ }

    if (isListening) {
      stopSpeechRecognition(e);
      if (recognizedTextRef.current) {
        evaluateSpeech(recognizedTextRef.current, true);
      }
    } else {
      startSpeechRecognition(e);
    }
  };

  // Start once per follow-up review. Retry remains an explicit microphone action.
  const startFollowupRecognition = useEffectEvent(() => startSpeechRecognition());
  useEffect(() => {
    if (followUp) startFollowupRecognition();
  }, [followUp, card?.id, reviewKey, spokenFront]);

  if (!card) return null;

  return (
    <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
      {!followUp && <ExerciseInfoBlocks content={exerciseContent} />}
      {followUp && (
        <div className="speech-followup-intro" role="status">
          <strong>{tr('Шаг 2 из 2 — произнесите предложение')}</strong>
          <span>{tr('Теперь скажите вслух фразу, которую вы только что построили.')}</span>
        </div>
      )}

      <div
        className="text-front speak-target-text" 
        style={{ 
          ...cardStyle, 
          marginBottom: '28px' 
        }}
      >
        {stripMarkdown(spokenFront)}
      </div>

      {/* Accuracy Threshold Selector */}
      <div className={`speak-threshold-selector${followUp ? ' speech-followup-threshold' : ''}`} onClick={e => e.stopPropagation()}>
        <span className="threshold-label"><Sliders size={14} />{' '}{tr("Совпадение слов:")}</span>
        {[50, 75, 85, 100].map(val => (
          <button
            key={val}
            type="button"
            className={`btn-threshold-pill ${speechMatchThreshold === val ? 'active' : ''}`}
            aria-pressed={speechMatchThreshold === val}
            onClick={(e) => {
              e.stopPropagation();
              setSpeechMatchThreshold(val);
              triggerHaptic('selection');
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
            aria-label={isListening ? tr('Остановить запись и проверить') : tr('Начать запись')}
            disabled={speechSuccess}
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

          {(onPlayCardAudio || (!followUp && card.audio_url)) && (
            <button
              type="button"
              className="btn-speak-audio"
              disabled={loading || isAutoplayActive}
              onClick={(e) => {
                e.stopPropagation();
                if (isAutoplayActive) return;
                if (card.audio_url) playAudio?.(card.audio_url);
                else onPlayCardAudio?.();
              }}
              title={tr("Озвучить карточку")}
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
          {isListening ? tr("Слушаю... Произнесите фразу или нажмите для проверки") : tr("Нажмите на микрофон для записи")}
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
          <span style={{ fontSize: '0.85rem', opacity: 0.75, color: '#cbd5e1', marginBottom: '4px' }}>{tr("Вы сказали:")}</span>
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

      {followUp ? (
        <button
          type="button"
          className="speech-followup-skip"
          onClick={e => {
            e.stopPropagation();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            retireSpeechRecognition();
            setIsListening(false);
            onSkip?.();
          }}
        >
          {tr('Пропустить устную часть')}
        </button>
      ) : (
        <button
          className="btn-interactive-reveal"
          onClick={e => {
            e.stopPropagation();
            onFlip?.(true);
          }}
        >
          <Eye size={18} />
          <span>{tr("Показать ответ")}</span>
        </button>
      )}
    </div>
  );
});
