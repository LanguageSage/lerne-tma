import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { tr } from '../i18n/locale.js';
import { getSpeechLocaleForLang } from '../constants/languageConstants.js';
import { useDeckStore } from '../store/useDeckStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { triggerHaptic } from '../utils/platform.js';
import { stopGlobalAudio } from './useAudio.js';

// Legacy speech exercises retain their silence timeout. Free Text opts into manual control.
export function useSpeechRecognition({ resetKey, language, onTranscript, onEnd,
  silenceTimeoutMs = 1500, autoRestart = false }) {
  const [status, setStatus] = useState('idle');
  const [recognizedText, setRecognizedText] = useState('');
  const [error, setError] = useState('');
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const flushTimerRef = useRef(null);
  const transcriptRef = useRef('');
  const wantedRef = useRef(false);
  const stoppingRef = useRef(null);
  const restartsRef = useRef({ empty: 0, total: 0 });
  const callbacksRef = useRef({ onTranscript, onEnd });
  useLayoutEffect(() => { callbacksRef.current = { onTranscript, onEnd }; });
  const key = `${resetKey}:${language}`;
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key);
    setStatus('idle');
    setRecognizedText('');
    setError('');
  }

  const retire = useCallback(() => {
    clearTimeout(timerRef.current);
    clearTimeout(restartTimerRef.current);
    clearTimeout(flushTimerRef.current);
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      rec.onresult = rec.onend = rec.onstart = rec.onerror = null;
      try { rec.abort(); } catch { /* already ended */ }
    }
  }, []);

  const cancel = useCallback(() => {
    wantedRef.current = false;
    retire();
    stoppingRef.current?.resolve(null);
    stoppingRef.current = null;
    setStatus('idle');
  }, [retire]);

  useLayoutEffect(() => () => {
    wantedRef.current = false;
    retire();
    stoppingRef.current?.resolve(null);
    stoppingRef.current = null;
    transcriptRef.current = '';
  }, [key, retire]);

  const finish = rec => {
    if (recognitionRef.current !== rec) return;
    const pending = stoppingRef.current;
    stoppingRef.current = null;
    retire();
    setStatus(pending?.pause ? 'paused' : 'idle');
    pending?.resolve(transcriptRef.current);
    if (!pending?.pause) callbacksRef.current.onEnd?.(transcriptRef.current);
  };

  const launch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      wantedRef.current = false;
      setStatus('idle');
      setError('Ваш девайс не поддерживает распознавание голоса.');
      return;
    }
    const base = transcriptRef.current;
    let received = false;
    try {
      const rec = new SpeechRecognition();
      const deckLanguage = useDeckStore.getState().currentDeck?.target_language;
      rec.lang = getSpeechLocaleForLang(language || deckLanguage || useLanguageStore.getState().activeLanguage || 'de');
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
      setStatus('listening');
      rec.onstart = () => {
        if (recognitionRef.current === rec) triggerHaptic('medium');
      };
      rec.onerror = event => {
        if (recognitionRef.current !== rec) return;
        // Only no-speech may recover automatically. Permission/network failures need user action.
        if (autoRestart && event.error === 'no-speech' && wantedRef.current) return;
        wantedRef.current = false;
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
          setError('Нет доступа к микрофону.');
        } else if (!['no-speech', 'aborted'].includes(event.error)) {
          setError('Ошибка распознавания. Попробуйте еще раз.');
        }
        finish(rec);
      };
      rec.onend = () => {
        if (recognitionRef.current !== rec) return;
        if (!autoRestart || !wantedRef.current || stoppingRef.current) { finish(rec); return; }
        // Keep the last visible interim text when the browser drops its session.
        retire();
        const limits = restartsRef.current;
        limits.total++;
        limits.empty = received ? 0 : limits.empty + 1;
        if (limits.empty >= 5 || limits.total >= 30) {
          wantedRef.current = false;
          setStatus('paused');
          setError('Распознавание приостановлено браузером. Нажмите «Продолжить».');
          return;
        }
        restartTimerRef.current = setTimeout(() => {
          if (wantedRef.current) launch();
        }, Math.min(250 * 2 ** limits.empty, 4000));
      };
      rec.onresult = event => {
        if (recognitionRef.current !== rec) return;
        const chunks = [];
        for (const result of Array.from(event.results)) {
          const chunk = result[0].transcript.trim();
          if (!chunk) continue;
          const previous = chunks.at(-1);
          if (previous && chunk.toLowerCase().startsWith(previous.toLowerCase())) chunks[chunks.length - 1] = chunk;
          else if (!previous || !previous.toLowerCase().endsWith(chunk.toLowerCase())) chunks.push(chunk);
        }
        const text = chunks.join(' ').replace(/\s+/g, ' ').trim();
        received ||= Boolean(text);
        // Result lists are session snapshots, never append each event. Some mobile engines
        // replay the entire preceding transcript after restarting; accept that as a snapshot.
        const baseWords = base.split(' ').filter(Boolean);
        const words = text.split(' ').filter(Boolean);
        let overlap = 0;
        for (let size = Math.min(baseWords.length, words.length); size >= 2; size--) {
          if (baseWords.slice(-size).join(' ').toLowerCase() === words.slice(0, size).join(' ').toLowerCase()) {
            overlap = size;
            break;
          }
        }
        const next = [base, words.slice(overlap).join(' ')].filter(Boolean).join(' ');
        transcriptRef.current = next;
        setRecognizedText(next);
        callbacksRef.current.onTranscript?.(next);
        if (recognitionRef.current !== rec || silenceTimeoutMs == null || stoppingRef.current) return;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => finish(rec), silenceTimeoutMs);
      };
      rec.start();
    } catch {
      cancel();
      setError('Ошибка при запуске микрофона.');
    }
  };

  const start = () => {
    cancel();
    transcriptRef.current = '';
    setRecognizedText('');
    setError('');
    restartsRef.current = { empty: 0, total: 0 };
    wantedRef.current = true;
    stopGlobalAudio();
    launch();
  };

  const resume = () => {
    if (recognitionRef.current || stoppingRef.current || wantedRef.current) return;
    setError('');
    restartsRef.current = { empty: 0, total: 0 };
    wantedRef.current = true;
    stopGlobalAudio();
    launch();
  };

  // stop() requests the browser's final result; wait for onend before evaluating.
  // A bounded fallback handles engines that omit onend, preserving the visible text.
  const flush = (pause = false) => {
    if (stoppingRef.current) return stoppingRef.current.promise;
    wantedRef.current = false;
    clearTimeout(restartTimerRef.current);
    clearTimeout(timerRef.current);
    const rec = recognitionRef.current;
    if (!rec) {
      setStatus(pause ? 'paused' : 'idle');
      return Promise.resolve(transcriptRef.current);
    }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    stoppingRef.current = { promise, resolve, pause };
    setStatus('stopping');
    flushTimerRef.current = setTimeout(() => finish(rec), 2000);
    try { rec.stop(); } catch { finish(rec); }
    return promise;
  };

  const stop = () => {
    // Existing pronunciation callers evaluate synchronously, including inside onresult.
    if (!autoRestart && silenceTimeoutMs != null) {
      const rec = recognitionRef.current;
      if (!rec) return;
      try { rec.stop(); } catch { /* already stopped */ }
      finish(rec);
      return;
    }
    return flush();
  };

  return { isListening: status === 'listening', isPaused: status === 'paused',
    isStopping: status === 'stopping', recognizedText, speechError: error ? tr(error) : '',
    start, stop, cancel, pause: () => flush(true), resume };
}
