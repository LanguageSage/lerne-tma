import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useAudio, stopGlobalAudio } from '../../hooks/useAudio';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useUiStore } from '../../store/useUiStore';
import { getSpeechLocaleForLang } from '../../constants/languageConstants';
import { getAudioUrl } from '../../utils/media';
import { tr } from '../../i18n/locale';
import api from '../../services/api';

function speechFragments(sessions) {
  const fragments = [];
  let chain = [], extensions = 0;
  const flush = () => {
    // Some engines append cumulative hypotheses to new result slots, even marking
    // them final. Collapse a growing chain, not repeated words in ordinary speech.
    // All-final fragments need at least two prefix extensions as evidence;
    // identical final segments alone ("Ja", "Ja") remain separate uttered segments.
    const interimIndex = chain.findIndex(item => !item.result.final);
    if (interimIndex >= 0) {
      // A new tentative repetition must not replace an already finalized segment.
      fragments.push(...chain.slice(0, interimIndex).map(item => item.result), chain.at(-1).result);
    } else {
      fragments.push(...(extensions >= 2 ? [chain.at(-1).result] : chain.map(item => item.result)));
    }
    chain = [];
    extensions = 0;
  };
  for (const result of sessions.flatMap(session => session.results)) {
    // Compare complete words, ignoring casing/punctuation; keep original display text.
    const words = result.text.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) || [];
    const previous = chain.at(-1)?.words;
    const continues = previous?.length && words.length >= previous.length &&
      previous.every((word, index) => word === words[index]);
    if (!continues) flush();
    else if (words.length > previous.length) extensions += 1;
    chain.push({ result, words });
  }
  flush();
  return fragments;
}

// Game owns conversation timing; StudyCardSpeech owns card matching/grading.
export function useGameVoice({ scene, attempt, busy, draft, onDraft, onSend }) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState('off');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('lerne_game_autoplay') !== 'false');
  const [automatic, setAutomatic] = useState(() => localStorage.getItem('lerne_game_auto_send') === 'true');
  const [silenceSeconds, setSilenceSeconds] = useState(() => {
    const stored = Number(localStorage.getItem('lerne_game_silence_seconds'));
    return [2, 3, 4, 5].includes(stored) ? stored : 4;
  });
  const runtime = useRef({ enabled: false, paused: false, generation: 0, recognition: null, timers: new Set(), cache: new Map(), abort: null });
  const options = useRef(null);
  const observedReply = useRef(null);
  const showToast = useUiStore(state => state.showToast);
  const { playAudio, stopAudio } = useAudio(false, showToast);
  useEffect(() => { options.current = { scene, attempt, busy, draft, onDraft, onSend, autoplay, automatic, silenceSeconds }; });

  function clearResources() {
    const r = runtime.current;
    r.generation += 1;
    r.finish = null;
    for (const timer of r.timers) clearTimeout(timer);
    r.timers.clear();
    r.abort?.abort();
    r.abort = null;
    const rec = r.recognition;
    r.recognition = null;
    if (rec) {
      rec.onstart = rec.onresult = rec.onend = rec.onerror = rec.onspeechstart = rec.onspeechend = rec.onnomatch = null;
      try { rec.abort(); } catch { /* already ended */ }
    }
    stopAudio();
  }

  function later(callback, delay) {
    const r = runtime.current;
    const generation = r.generation;
    const timer = setTimeout(() => {
      r.timers.delete(timer);
      if (generation === r.generation) callback();
    }, delay);
    r.timers.add(timer);
    return timer;
  }

  function pause(message = '') {
    runtime.current.paused = true;
    clearResources();
    setError(message);
    setPhase(message ? 'error' : runtime.current.enabled ? 'paused' : 'off');
  }

  function canListen() {
    const o = options.current;
    return runtime.current.enabled && !runtime.current.paused && !o.busy &&
      !o.attempt?.ended &&
      o.attempt?.turn_count < o.attempt?.max_turns && ['live', 'mock'].includes(o.scene?.ai_mode);
  }

  function startListening() {
    if (!canListen()) return;
    clearResources();
    stopGlobalAudio();
    const r = runtime.current;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { pause(tr('Ваш девайс не поддерживает распознавание голоса.')); return; }
    const generation = r.generation;
    const active = () => generation === r.generation && canListen();
    const autoSend = options.current.automatic;
    const silenceMs = options.current.silenceSeconds * 1000;
    // A user utterance survives multiple browser recognition sessions. Each session
    // replaces its results snapshot; cumulative hypotheses inside it are revisions.
    const sessions = [];
    let finishing = false, silence, emptyWatchdog, emptyEnds = 0;
    const cancelTimer = timer => { clearTimeout(timer); r.timers.delete(timer); };
    const text = () => speechFragments(sessions).map(result => result.text).join(' ').replace(/\s+/g, ' ').trim();
    const publish = () => {
      const value = text();
      setTranscript(value);
      options.current.onDraft(value.slice(0, 1000));
      if (value) cancelTimer(emptyWatchdog);
    };
    const complete = () => {
      if (!active()) return;
      const value = text();
      const needsReview = speechFragments(sessions).some(result => !result.final || result.uncertain);
      clearResources();
      if (!value) { pause(); return; }
      if (needsReview || !/[a-zäöüß]/i.test(value) || value.length > 1000) {
        pause(tr('Проверьте распознанный текст и отправьте его кнопкой.'));
        return;
      }
      setPhase('thinking');
      options.current.onSend(value);
    };
    const finish = () => {
      if (!active() || finishing) return;
      finishing = true;
      cancelTimer(silence);
      setPhase('recognizing');
      if (!r.recognition) { complete(); return; }
      // stop waits for final results; cancellation always uses abort, never send.
      later(() => pause(tr('Распознавание не завершилось. Проверьте текст и попробуйте снова.')), 3000);
      try { r.recognition.stop(); } catch { pause(tr('Ошибка распознавания. Попробуйте еще раз.')); }
    };
    const scheduleSilence = () => {
      cancelTimer(silence);
      if (autoSend && !finishing && text()) silence = later(finish, silenceMs);
    };
    r.finish = finish;
    setTranscript('');
    setError('');
    setPhase('waiting');
    emptyWatchdog = later(() => pause(tr('Речь не обнаружена. Нажмите «Продолжить», когда будете готовы.')), 45000);

    const startSession = () => {
      if (!active() || finishing) return;
      const rec = new SpeechRecognition();
      const session = { results: [] };
      sessions.push(session);
      const current = () => active() && r.recognition === rec;
      rec.lang = getSpeechLocaleForLang('de');
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      r.recognition = rec;
      rec.onstart = () => { if (current() && !finishing) setPhase(text() ? 'listening' : 'waiting'); };
      rec.onspeechstart = () => {
        if (!current() || finishing) return;
        cancelTimer(silence);
        setPhase('listening');
      };
      rec.onspeechend = () => { if (current()) scheduleSilence(); };
      rec.onresult = event => {
        if (!current()) return;
        session.results = Array.from(event.results, result => ({
          text: result[0].transcript.trim(), final: result.isFinal,
          // 0 often means that the browser did not supply confidence.
          uncertain: result.isFinal && result[0].confidence > 0 && result[0].confidence < .5,
        })).filter(result => result.text);
        if (session.results.length) emptyEnds = 0;
        publish();
        if (!finishing) { setPhase('listening'); scheduleSilence(); }
      };
      rec.onend = () => {
        if (!current()) return;
        r.recognition = null;
        rec.onstart = rec.onresult = rec.onend = rec.onerror = rec.onspeechstart = rec.onspeechend = rec.onnomatch = null;
        if (finishing) { complete(); return; }
        // Native end/no-speech does not end the user's utterance or reset its pause timer.
        // Preserve unresolved interim text for review instead of silently dropping it.
        if (!session.results.length && ++emptyEnds >= 5) {
          pause(tr('Речь не обнаружена. Нажмите «Продолжить», когда будете готовы.')); return;
        }
        setPhase(text() ? 'listening' : 'waiting');
        later(startSession, 350);
      };
      rec.onerror = event => {
        if (!current()) return;
        if (event.error === 'no-speech') return; // onend restarts, with bounded empty retries.
        pause(tr(['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)
          ? 'Нет доступа к микрофону.' : 'Ошибка распознавания. Попробуйте еще раз.'));
      };
      rec.onnomatch = () => { if (current()) pause(tr('Проверьте распознанный текст и отправьте его кнопкой.')); };
      try { rec.start(); } catch { pause(tr('Ошибка при запуске микрофона.')); }
    };
    startSession();
  }

  async function speak(text) {
    if (!text) return;
    clearResources();
    stopGlobalAudio();
    const r = runtime.current;
    const generation = r.generation;
    const active = () => generation === r.generation;
    setError('');
    setPhase('speaking');
    const controller = new AbortController();
    r.abort = controller;
    const playbackError = () => tr(options.current.attempt?.ended
      ? 'Озвучивание недоступно. Попробуйте прослушать ответ снова.'
      : 'Озвучивание недоступно. Можно продолжить текстовый разговор.');
    later(() => pause(playbackError()), Math.max(45000, text.length * 200));
    try {
      const o = options.current;
      const voice = o.scene?.npc.tts_voice || 'de-DE-KatjaNeural';
      const settings = useSettingsStore.getState();
      const speed = o.attempt.scene.slow_speech ? Math.min(settings.ttsSpeed || 0, -30) : settings.ttsSpeed || 0;
      const rate = `${speed >= 0 ? '+' : ''}${speed}%`;
      const key = JSON.stringify([text, voice, rate]);
      let url = r.cache.get(key);
      if (!url) {
        const { data } = await api.post('/media/generate-audio', { text, lang: 'de', voice, rate }, { signal: controller.signal, timeout: 30000 });
        if (!active()) return;
        url = getAudioUrl(data.path || data.url);
        if (!url) throw new Error('Missing audio');
        if (r.cache.size >= 10) r.cache.delete(r.cache.keys().next().value);
        r.cache.set(key, url);
      }
      if (!active()) return;
      await playAudio(url, success => {
        if (!active()) return;
        if (!success) { pause(playbackError()); return; }
        clearResources();
        setPhase(r.enabled ? canListen() ? 'waiting' : 'paused' : 'off');
        // Let the speaker tail decay before opening the microphone.
        if (canListen()) later(startListening, 350);
      });
    } catch {
      if (active()) pause(playbackError());
    }
  }

  async function toggle() {
    const r = runtime.current;
    if (r.enabled) {
      r.enabled = false;
      setEnabled(false);
      pause();
      return;
    }
    r.enabled = true;
    r.paused = false;
    setEnabled(true);
    setError('');
    setPhase('recognizing');
    clearResources();
    const generation = r.generation;
    later(() => pause(tr('Нет доступа к микрофону.')), 30000);
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
      pause(tr('Ваш девайс не поддерживает распознавание голоса.')); return;
    }
    try {
      // Permission is requested only by this explicit click. No recordings are stored.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      if (generation !== r.generation || !r.enabled) return;
      const o = options.current;
      if (o.draft.trim()) { pause(); return; }
      if (o.autoplay) speak(o.attempt.history.findLast(m => m.role === 'npc')?.text);
      else startListening();
    } catch { if (generation === r.generation) pause(tr('Нет доступа к микрофону.')); }
  }

  function resume() {
    runtime.current.paused = false;
    setError('');
    if (options.current.draft.trim()) { pause(tr('Проверьте распознанный текст и отправьте его кнопкой.')); return; }
    startListening();
  }

  const respond = useEffectEvent(() => {
    const o = options.current;
    if (o.busy || !o.attempt) return;
    const key = `${o.attempt.id}:${o.attempt.version}`;
    const previous = observedReply.current;
    if (previous === key) return;
    observedReply.current = key;
    if (!previous || !previous.startsWith(`${o.attempt.id}:`)) return;
    if (runtime.current.paused) return;
    if (o.autoplay && o.attempt.version > 0 && o.attempt.history.at(-1)?.role === 'npc') speak(o.attempt.history.at(-1).text);
    else if (o.attempt.ended || o.attempt.turn_count >= o.attempt.max_turns) pause();
    else if (canListen()) startListening();
  });
  useEffect(() => { respond(); }, [attempt?.version, attempt?.id, busy]);

  useEffect(() => {
    const r = runtime.current;
    const onHide = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      r.enabled = false;
      clearResources();
    };
    // Resources are held in runtime; lifecycle cleanup does not depend on renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopAudio]);

  return { enabled, phase, error, transcript, autoplay, automatic, silenceSeconds, toggle, pause, resume,
    finish: () => runtime.current.finish?.(), speak,
    cancel: () => { pause(); setTranscript(''); options.current.onDraft(''); },
    beforeSend: () => { runtime.current.paused = false; clearResources(); setError(''); setPhase('thinking'); },
    setAutoplay: value => { localStorage.setItem('lerne_game_autoplay', String(value)); setAutoplay(value); if (!value) pause(); },
    setSilenceSeconds: value => {
      if (![2, 3, 4, 5].includes(value)) return;
      localStorage.setItem('lerne_game_silence_seconds', String(value)); setSilenceSeconds(value); pause();
    },
    setAutomatic: value => { localStorage.setItem('lerne_game_auto_send', String(value)); setAutomatic(value); pause(); },
  };
}
