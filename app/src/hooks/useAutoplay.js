import { tr, getInterfaceLanguage } from '../i18n/locale';
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { getTtsVoiceForLang } from '../constants/languageConstants';
import { stripMarkdown } from '../utils/text';
import { getAudioUrl } from '../utils/media';
import { buildAutoplaySequence, createAutoplayQueue, normalizeAutoplaySettings } from '../utils/autoplaySequence';

const getCardText = (card, side) => side === 'back'
  ? (card.back ?? card.back_text ?? '') : (card.front ?? card.front_text ?? '');

export const useAutoplay = ({ playAudio, stopAudio, showToast, startBackgroundLock, stopBackgroundLock }) => {
  const runRef = useRef(0);
  const waitRef = useRef(null);
  const queueRef = useRef([]);
  const sessionRef = useRef({ audio: new Map(), order: null });
  const [autoplayCards, setAutoplayCards] = useState([]);
  const [status, setStatus] = useState('');

  const setQueue = useCallback((cards) => {
    queueRef.current = cards;
    setAutoplayCards(cards);
  }, []);

  // Every cancellation settles the pending audio/timer wait as well as stopping sound.
  const cancelCurrent = useCallback(() => {
    runRef.current += 1;
    waitRef.current?.();
    waitRef.current = null;
    stopAudio();
  }, [stopAudio]);

  const isCurrentRun = useCallback((id) => id === runRef.current
    && useSessionStore.getState().autoplayState === 'playing', []);

  const wait = useCallback((seconds, id) => new Promise(resolve => {
    const finish = (ok) => {
      clearTimeout(timer);
      if (waitRef.current === cancel) waitRef.current = null;
      resolve(ok && isCurrentRun(id));
    };
    const cancel = () => finish(false);
    const timer = setTimeout(() => finish(true), seconds * 1000);
    waitRef.current = cancel;
  }), [isCurrentRun]);

  const waitForAudio = useCallback((url, id) => new Promise(resolve => {
    const finish = (ok) => {
      if (waitRef.current === cancel) waitRef.current = null;
      resolve(Boolean(ok) && isCurrentRun(id));
    };
    const cancel = () => finish(false);
    waitRef.current = cancel;
    Promise.resolve(playAudio(url, finish, () => finish(false))).catch(() => finish(false));
  }), [isCurrentRun, playAudio]);

  const ensureAudio = useCallback(async (card, side, settings) => {
    const context = sessionRef.current;
    const back = side === 'back';
    const lang = back ? getInterfaceLanguage() : (card.target_language
      || useDeckStore.getState().currentDeck?.target_language || useLanguageStore.getState().activeLanguage || 'de');
    const globalSettings = useSettingsStore.getState();
    const voice = getTtsVoiceForLang(lang, globalSettings.adminSettings, globalSettings.ttsVoices);
    const speed = back ? settings.autoplayTranslationSpeed : settings.autoplayPhraseSpeed;
    const force = back ? settings.autoplayForceBackAudio : settings.autoplayForceFrontAudio;
    const key = JSON.stringify([card.id, side, lang, voice, speed, force]);
    if (context.audio.has(key)) return context.audio.get(key);

    const urlKey = back ? 'audio_back_url' : 'audio_url';
    const pathKey = back ? 'audio_back_path' : 'audio_path';
    const latest = queueRef.current.find(c => String(c.id) === String(card.id)) || card;
    const existing = getAudioUrl(latest[urlKey] || latest[pathKey]);
    const wrongBack = back && ((latest.audio_back_url && latest.audio_back_url === latest.audio_url)
      || (latest.audio_back_path && latest.audio_back_path === latest.audio_path));
    if (existing && !force && !wrongBack) return existing;
    const text = getCardText(latest, side);
    if (!text.trim()) throw new Error(tr("Нет текста для озвучки"));
    setStatus(back ? tr("Генерируем перевод") : tr("Генерируем фразу"));

    // The promise is cached before awaiting: pause/resume and deck loops reuse it.
    const request = api.post('/media/generate-card-audio', {
      card_id: card.id, side, text, lang, voice, rate: `${speed >= 0 ? '+' : ''}${speed}%`,
    }).then(({ data }) => {
      const url = getAudioUrl(data.url || data.path);
      if (!url) throw new Error(tr("Не удалось получить аудио"));
      if (sessionRef.current === context) {
        const patch = { [urlKey]: data.url, [pathKey]: data.path, audio_is_generating: false };
        useSessionStore.getState().updateCardInSession(card.id, patch);
        useDeckStore.getState().updateCardLocal?.(card.id, patch);
        setQueue(queueRef.current.map(c => String(c.id) === String(card.id) ? { ...c, ...patch } : c));
      }
      return url;
    }).catch(error => {
      context.audio.delete(key);
      throw error;
    });
    context.audio.set(key, request);
    return request;
  }, [setQueue]);

  const getCards = useCallback(async () => {
    const deck = useDeckStore.getState();
    if (!deck.currentDeck) return [];
    if (deck.currentDeck.id === 'duplicates') return deck.duplicateCards || [];
    await deck.fetchDeckCards(deck.currentDeck.id);
    return useDeckStore.getState().deckCards || [];
  }, []);

  const stop = useCallback(() => {
    cancelCurrent();
    stopBackgroundLock?.();
    setStatus('');
    useSessionStore.getState().setIsFlipped(false);
    useSessionStore.getState().stopAutoplay();
  }, [cancelCurrent, stopBackgroundLock]);

  const pause = useCallback(() => {
    cancelCurrent();
    stopBackgroundLock?.();
    setStatus(tr("Пауза"));
    useSessionStore.getState().pauseAutoplay();
  }, [cancelCurrent, stopBackgroundLock]);

  const run = useCallback(async (id, firstCard) => {
    let target = firstCard;
    try {
      while (target && isCurrentRun(id)) {
        const settings = normalizeAutoplaySettings(useSettingsStore.getState());
        const sequence = buildAutoplaySequence(settings);
        useSessionStore.getState().setCard(target);
        for (let step = 0; step < sequence.length; step++) {
          const side = sequence[step];
          useSessionStore.getState().setIsFlipped(side === 'back');
          const url = await ensureAudio(target, side, settings);
          if (!isCurrentRun(id)) return;
          const cycle = Math.floor(step / (settings.autoplayFrontRepeat + 1)) + 1;
          setStatus(tr("Цикл {{cycle}}/{{total}} · {{side}}", {
            cycle, total: settings.autoplayCycleRepeat,
            side: side === 'back' ? tr("Перевод") : tr("Фраза"),
          }));
          if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: stripMarkdown(getCardText(target, side)),
              artist: tr("Авто-режим"), album: useDeckStore.getState().currentDeck?.name || '',
            });
          }
          if (!await waitForAudio(url, id)) {
            if (isCurrentRun(id)) {
              pause();
              showToast?.(tr("Не удалось воспроизвести аудио. Нажмите «Продолжить», чтобы повторить."));
            }
            return;
          }
          const seconds = step === sequence.length - 1 ? settings.autoplayCardPause : settings.autoplayGap;
          setStatus(tr("Пауза {{seconds}} с", { seconds }));
          if (!await wait(seconds, id)) return;
        }
        const index = queueRef.current.findIndex(c => String(c.id) === String(target.id));
        if (index >= 0 && index + 1 < queueRef.current.length) {
          target = queueRef.current[index + 1];
        } else {
          if (!settings.autoplayLoop) { stop(); return; }
          const cards = await getCards();
          if (!isCurrentRun(id)) return;
          const queue = createAutoplayQueue(cards, settings.autoplayOrder, target.id);
          setQueue(queue);
          target = queue[0]; // Explicit loop also supports a deck containing one card.
          if (!target) stop();
        }
      }
    } catch (error) {
      if (!isCurrentRun(id)) return;
      pause();
      showToast?.(tr("Ошибка авто-режима: {{p0}}", { p0: error.response?.data?.detail || error.message }));
    }
  }, [ensureAudio, getCards, isCurrentRun, pause, setQueue, showToast, stop, wait, waitForAudio]);

  const launch = useCallback(async (fresh) => {
    if (fresh && useSessionStore.getState().autoplayState !== 'stopped') return;
    cancelCurrent();
    const id = runRef.current;
    if (fresh) sessionRef.current = { audio: new Map(), order: null };
    const settings = normalizeAutoplaySettings(useSettingsStore.getState());
    useSessionStore.getState().setAutoplayState('playing');
    startBackgroundLock?.();
    try {
      const rebuild = fresh || sessionRef.current.order !== settings.autoplayOrder || !queueRef.current.length;
      let target = useSessionStore.getState().card;
      if (rebuild) {
        setStatus(tr("Загрузка карточек..."));
        const cards = await getCards();
        if (!isCurrentRun(id)) return;
        const queue = createAutoplayQueue(cards, settings.autoplayOrder);
        setQueue(queue);
        sessionRef.current.order = settings.autoplayOrder;
        // Random starts at the start of its shuffled queue, so no cards are skipped.
        target = settings.autoplayOrder === 'random' ? queue[0]
          : queue.find(c => String(c.id) === String(target?.id)) || queue[0];
      }
      if (!target) {
        stop();
        showToast?.(settings.autoplayOrder === 'srs'
          ? tr("На сегодня нет карточек для повторения по SRS") : tr("В колоде нет доступных карточек"));
        return;
      }
      if (isCurrentRun(id)) void run(id, target);
    } catch (error) {
      if (isCurrentRun(id)) {
        stop();
        showToast?.(tr("Ошибка авто-режима: {{p0}}", { p0: error.response?.data?.detail || error.message }));
      }
    }
  }, [cancelCurrent, getCards, isCurrentRun, run, setQueue, showToast, startBackgroundLock, stop]);

  const start = useCallback(() => launch(true), [launch]);
  const resume = useCallback(() => launch(false), [launch]);

  const navigate = useCallback((direction) => {
    const session = useSessionStore.getState();
    const queue = queueRef.current;
    if (!queue.length) return;
    const index = queue.findIndex(c => String(c.id) === String(session.card?.id));
    let next = index + direction;
    if (next < 0 || next >= queue.length) {
      if (!useSettingsStore.getState().autoplayLoop) return;
      if (direction > 0 && sessionRef.current.order === 'random') {
        const reshuffled = createAutoplayQueue(queue, 'random', session.card?.id);
        setQueue(reshuffled);
        next = 0;
      } else next = (next + queue.length) % queue.length;
    }
    cancelCurrent();
    const target = queueRef.current[next];
    session.setCard(target);
    session.setIsFlipped(false);
    if (session.autoplayState === 'playing') void run(runRef.current, target);
  }, [cancelCurrent, run, setQueue]);

  useEffect(() => () => {
    cancelCurrent();
    stopBackgroundLock?.();
    useSessionStore.getState().stopAutoplay();
  }, [cancelCurrent, stopBackgroundLock]);

  return { start, stop, pause, resume, navigate, status, autoplayCards };
};
