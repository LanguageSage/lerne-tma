import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { stripMarkdown } from '../utils/text';

const formatRate = (value) => `${value >= 0 ? '+' : ''}${value}%`;
const getCardText = (targetCard, side) => {
  if (!targetCard) return '';
  return side === 'back'
    ? (targetCard.back ?? targetCard.back_text ?? '')
    : (targetCard.front ?? targetCard.front_text ?? '');
};

export const useAutoplay = ({ card, playAudio, stopAudio, showToast, startBackgroundLock, stopBackgroundLock }) => {
  const runRef = useRef(0);
  const timerRef = useRef(null);
  const cardRef = useRef(card);
  const autoplayCardsRef = useRef([]);
  const cardRepeatCountRef = useRef(1);
  const currentCardIdRef = useRef(card?.id);
  const [status, setStatus] = useState('');

  useEffect(() => {
    cardRef.current = card;
    if (card?.id !== currentCardIdRef.current) {
      currentCardIdRef.current = card?.id;
      cardRepeatCountRef.current = 1;
    }
  }, [card]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const isCurrentRun = useCallback((runId) => (
    runRef.current === runId && useSessionStore.getState().autoplayState === 'playing'
  ), []);

  const wait = useCallback((seconds, runId) => new Promise((resolve) => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      resolve(isCurrentRun(runId));
    }, Math.max(0, Number(seconds) || 0) * 1000);
  }), [clearTimer, isCurrentRun]);

  const waitForAudio = useCallback((url, runId) => new Promise((resolve) => {
    if (!url || !isCurrentRun(runId)) {
      resolve(false);
      return;
    }

    playAudio(url, () => resolve(isCurrentRun(runId)));
  }), [isCurrentRun, playAudio]);

  const updateCardAudio = useCallback((cardId, patch) => {
    const session = useSessionStore.getState();
    const deck = useDeckStore.getState();

    session.setCard((current) => (
      current?.id === cardId ? { ...current, ...patch } : current
    ));
    deck.setDeckCards(deck.deckCards.map((item) => (
      item.id === cardId ? { ...item, ...patch } : item
    )));
  }, []);

  const ensureAudio = useCallback(async (targetCard, side, runId) => {
    if (!targetCard || !isCurrentRun(runId)) return null;

    const settings = useSettingsStore.getState();
    const isBack = side === 'back';
    const urlKey = isBack ? 'audio_back_url' : 'audio_url';
    const pathKey = isBack ? 'audio_back_path' : 'audio_path';
    const text = getCardText(targetCard, side);
    const lang = isBack ? 'ru' : 'de';
    const rate = formatRate(isBack ? settings.ttsSpeedRu : settings.ttsSpeed);
    const voice = isBack ? settings.adminSettings?.TTS_VOICE_RU : settings.adminSettings?.TTS_VOICE;
    const forceGenerate = isBack ? settings.autoplayForceBackAudio : settings.autoplayForceFrontAudio;
    const hasWrongBackAudio = isBack && (
      (targetCard.audio_back_url && targetCard.audio_url && targetCard.audio_back_url === targetCard.audio_url) ||
      (targetCard.audio_back_path && targetCard.audio_path && targetCard.audio_back_path === targetCard.audio_path)
    );

    if (targetCard[urlKey] && !hasWrongBackAudio && !forceGenerate) return targetCard[urlKey];
    if (!text?.trim()) return null;

    setStatus(isBack ? 'Генерируем перевод' : 'Генерируем фразу');
    let generated;
    try {
      generated = await api.post('/media/generate-audio', { text, lang, rate, voice });
    } catch (err) {
      console.error('Audio generation failed:', err);
      showToast?.(`Не удалось сгенерировать ${isBack ? 'перевод' : 'фразу'}: ${err.response?.data?.detail || err.message}`);
      return null;
    }
    if (!isCurrentRun(runId)) return null;

    const audioPatch = {
      [pathKey]: generated.data.path,
      [urlKey]: generated.data.url
    };

    const deckId = targetCard.deck_id || useDeckStore.getState().currentDeck?.id;
    const saved = await api.post('/cards/save', {
      card_id: targetCard.id,
      deck_id: deckId,
      [pathKey]: generated.data.path,
      silent: true
    });

    if (!isCurrentRun(runId)) return null;

    const mergedPatch = {
      ...audioPatch,
      [pathKey]: saved.data[pathKey] || generated.data.path,
      [urlKey]: saved.data[urlKey] || generated.data.url
    };
    updateCardAudio(targetCard.id, mergedPatch);
    return mergedPatch[urlKey];
  }, [isCurrentRun, showToast, updateCardAudio]);

  const getAutoplayCards = useCallback(async () => {
    const deckStore = useDeckStore.getState();
    const currentDeck = deckStore.currentDeck;

    if (!currentDeck) return [];
    if (currentDeck.id === 'duplicates') return deckStore.duplicateCards;

    await deckStore.fetchDeckCards(currentDeck.id);
    return useDeckStore.getState().deckCards;
  }, []);

  const prepareAutoplayCards = useCallback(async () => {
    const cards = await getAutoplayCards();
    autoplayCardsRef.current = cards;
    return cards;
  }, [getAutoplayCards]);

  const moveToNextCard = useCallback(async (currentCard, runId) => {
    const settings = useSettingsStore.getState();
    let cards = autoplayCardsRef.current.length
      ? autoplayCardsRef.current
      : await prepareAutoplayCards();
    if (!isCurrentRun(runId) || !cards.length) return false;

    let currentIndex = cards.findIndex((item) => item.id === currentCard.id);
    let nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

    if (nextIndex >= cards.length && useDeckStore.getState().currentDeck?.id !== 'duplicates') {
      const refreshedCards = await getAutoplayCards();
      if (!isCurrentRun(runId)) return false;

      const refreshedIndex = refreshedCards.findIndex((item) => item.id === currentCard.id);
      if (refreshedIndex >= 0 && refreshedIndex + 1 < refreshedCards.length) {
        cards = refreshedCards;
        autoplayCardsRef.current = refreshedCards;
        currentIndex = refreshedIndex;
        nextIndex = currentIndex + 1;
      }
    }

    if (nextIndex >= cards.length) {
      if (!settings.autoplayLoop) {
        useSessionStore.getState().stopAutoplay();
        setStatus('');
        stopAudio();
        return false;
      }
      useSessionStore.getState().setCard(cards[0]);
      return true;
    }

    useSessionStore.getState().setCard(cards[nextIndex]);
    return true;
  }, [getAutoplayCards, isCurrentRun, prepareAutoplayCards, stopAudio]);

  const runCardCycle = useCallback(async (runId) => {
    const targetCard = cardRef.current;
    if (!targetCard || !isCurrentRun(runId)) return;

    const session = useSessionStore.getState();
    const settings = useSettingsStore.getState();

    try {
      session.setIsFlipped(false);
      const totalRepeats = settings.autoplayCardRepeat || 1;
      const repeatPrefix = totalRepeats > 1 ? `[Повтор ${cardRepeatCountRef.current}/${totalRepeats}] ` : '';

      setStatus(`${repeatPrefix}Озвучиваем фразу`);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: stripMarkdown(targetCard.front || ''),
          artist: 'Lerne TMA (Фраза)',
          album: useDeckStore.getState().currentDeck?.name || 'Режим изучения'
        });
      }
      const frontUrl = await ensureAudio(targetCard, 'front', runId);
      if (frontUrl) await waitForAudio(frontUrl, runId);
      if (!isCurrentRun(runId)) return;

      setStatus(`${repeatPrefix}Пауза ${settings.autoplayFrontPause}с`);
      const afterFrontPause = await wait(settings.autoplayFrontPause, runId);
      if (!afterFrontPause) return;

      session.setIsFlipped(true);
      setStatus(`${repeatPrefix}Озвучиваем перевод`);
      const latestCard = useSessionStore.getState().card || targetCard;
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: stripMarkdown(latestCard.back || ''),
          artist: 'Lerne TMA (Перевод)',
          album: useDeckStore.getState().currentDeck?.name || 'Режим изучения'
        });
      }
      const backUrl = await ensureAudio(latestCard, 'back', runId);
      if (backUrl) await waitForAudio(backUrl, runId);
      if (!isCurrentRun(runId)) return;

      setStatus(`${repeatPrefix}Пауза ${settings.autoplayBackPause}с`);
      const afterBackPause = await wait(settings.autoplayBackPause, runId);
      if (!afterBackPause) return;

      if (cardRepeatCountRef.current < totalRepeats) {
        cardRepeatCountRef.current += 1;
        clearTimer();
        stopAudio();
        const nextRunId = runRef.current + 1;
        runRef.current = nextRunId;
        runCardCycle(nextRunId);
      } else {
        await moveToNextCard(latestCard, runId);
      }
    } catch (err) {
      console.error('Autoplay error:', err);
      if (isCurrentRun(runId)) {
        showToast?.(`Ошибка авто-режима: ${err.response?.data?.detail || err.message}`);
        useSessionStore.getState().stopAutoplay();
        stopAudio();
        setStatus('');
      }
    }
  }, [clearTimer, ensureAudio, isCurrentRun, moveToNextCard, showToast, stopAudio, wait, waitForAudio]);

  const restart = useCallback(() => {
    clearTimer();
    stopAudio();
    const runId = runRef.current + 1;
    runRef.current = runId;
    runCardCycle(runId);
  }, [clearTimer, runCardCycle, stopAudio]);

  const start = useCallback(() => {
    if (!cardRef.current) return;
    useSessionStore.getState().setAutoplayState('playing');
    startBackgroundLock?.();
    prepareAutoplayCards().then(() => {
      if (useSessionStore.getState().autoplayState === 'playing') {
        cardRepeatCountRef.current = 1;
        restart();
      }
    });
  }, [prepareAutoplayCards, restart, startBackgroundLock]);

  const stop = useCallback(() => {
    runRef.current += 1;
    autoplayCardsRef.current = [];
    clearTimer();
    stopAudio();
    stopBackgroundLock?.();
    setStatus('');
    useSessionStore.getState().stopAutoplay();
  }, [clearTimer, stopAudio, stopBackgroundLock]);

  const pause = useCallback(() => {
    runRef.current += 1;
    clearTimer();
    stopAudio();
    stopBackgroundLock?.();
    setStatus('Пауза');
    useSessionStore.getState().pauseAutoplay();
  }, [clearTimer, stopAudio, stopBackgroundLock]);

  const resume = useCallback(() => {
    if (!cardRef.current) return;
    useSessionStore.getState().setAutoplayState('playing');
    startBackgroundLock?.();
    restart();
  }, [restart, startBackgroundLock]);

  const cancelCurrent = useCallback(() => {
    runRef.current += 1;
    clearTimer();
    stopAudio();
    setStatus('');
  }, [clearTimer, stopAudio]);

  useEffect(() => {
    const state = useSessionStore.getState().autoplayState;
    if (state === 'playing' && card?.id) {
      restart();
    }
  }, [card?.id, restart]);

  useEffect(() => () => {
    runRef.current += 1;
    autoplayCardsRef.current = [];
    clearTimer();
    stopAudio();
    stopBackgroundLock?.();
  }, [clearTimer, stopAudio, stopBackgroundLock]);

  return { start, stop, pause, resume, restart, cancelCurrent, status };
};
