import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { tr } from '../i18n/locale.js';
import { getSpeechLocaleForLang } from '../constants/languageConstants.js';
import { useDeckStore } from '../store/useDeckStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { triggerHaptic } from '../utils/platform.js';
import { stopGlobalAudio } from './useAudio.js';

// Recognition lifecycle only; callers own answer editing and evaluation.
export function useSpeechRecognition({ resetKey, language, onTranscript, onEnd }) {
  const [isListening, setIsListening] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [error, setError] = useState('');
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const transcriptRef = useRef('');
  const callbacksRef = useRef({ onTranscript, onEnd });
  useLayoutEffect(() => { callbacksRef.current = { onTranscript, onEnd }; });
  const key = `${resetKey}:${language}`;
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key);
    setIsListening(false);
    setRecognizedText('');
    setError('');
  }

  const retire = useCallback(() => {
    clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    rec.onresult = rec.onend = rec.onstart = rec.onerror = null;
    try { rec.abort(); } catch { /* already ended */ }
  }, []);

  const cancel = useCallback(() => {
    retire();
    setIsListening(false);
  }, [retire]);

  const reset = useCallback(() => {
    cancel();
    transcriptRef.current = '';
    setRecognizedText('');
    setError('');
  }, [cancel]);

  useLayoutEffect(() => retire, [key, retire]);

  const finish = rec => {
    if (recognitionRef.current !== rec) return;
    retire();
    setIsListening(false);
    callbacksRef.current.onEnd?.(transcriptRef.current);
  };

  const stop = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try { rec.stop(); } catch { /* still finish using the visible transcript */ }
    finish(rec);
  };

  const start = () => {
    reset();
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Ваш девайс не поддерживает распознавание голоса.');
      return;
    }
    stopGlobalAudio();
    try {
      const rec = new SpeechRecognition();
      const deckLanguage = useDeckStore.getState().currentDeck?.target_language;
      rec.lang = getSpeechLocaleForLang(language || deckLanguage || useLanguageStore.getState().activeLanguage || 'de');
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
      // Include startup in the active state to prevent repeated microphone starts.
      setIsListening(true);
      rec.onstart = () => {
        if (recognitionRef.current === rec) triggerHaptic('medium');
      };
      rec.onerror = event => {
        if (recognitionRef.current !== rec) return;
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
          setError('Нет доступа к микрофону.');
        } else if (!['no-speech', 'aborted'].includes(event.error)) {
          setError('Ошибка распознавания. Попробуйте еще раз.');
        }
        finish(rec);
      };
      rec.onend = () => finish(rec);
      rec.onresult = event => {
        if (recognitionRef.current !== rec) return;
        const chunks = [];
        for (const result of Array.from(event.results)) {
          const chunk = result[0].transcript.trim();
          if (!chunk) continue;
          const previous = chunks.at(-1);
          // Some Android browsers return cumulative/duplicate chunks.
          if (previous && chunk.toLowerCase().startsWith(previous.toLowerCase())) chunks[chunks.length - 1] = chunk;
          else if (!previous || !previous.toLowerCase().endsWith(chunk.toLowerCase())) chunks.push(chunk);
        }
        const text = chunks.join(' ').replace(/\s+/g, ' ').trim();
        transcriptRef.current = text;
        setRecognizedText(text);
        callbacksRef.current.onTranscript?.(text);
        if (recognitionRef.current !== rec) return;
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => finish(rec), 1500);
      };
      rec.start();
    } catch {
      cancel();
      setError('Ошибка при запуске микрофона.');
    }
  };

  return { isListening, recognizedText, speechError: error ? tr(error) : '', start, stop, cancel };
}
