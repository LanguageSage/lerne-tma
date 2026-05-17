import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { useDeckStore } from '../store/useDeckStore';
import { useSessionStore } from '../store/useSessionStore';
import { useSettingsStore } from '../store/useSettingsStore';

const formatRate = (value) => `${value >= 0 ? '+' : ''}${value}%`;
const getCardText = (targetCard, side) => {
  if (!targetCard) return '';
  return side === 'back'
    ? (targetCard.back ?? targetCard.back_text ?? '')
    : (targetCard.front ?? targetCard.front_text ?? '');
};

export const useAutoplay = ({ card, playAudio, stopAudio, showToast }) => {
  const runRef = useRef(0);
  const timerRef = useRef(null);
  const cardRef = useRef(card);
  const [status, setStatus] = useState('');

  useEffect(() => {
    cardRef.current = card;
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
    const hasWrongBackAudio = isBack && (
      (targetCard.audio_back_url && targetCard.audio_url && targetCard.audio_back_url === targetCard.audio_url) ||
      (targetCard.audio_back_path && targetCard.audio_path && targetCard.audio_back_path === targetCard.audio_path)
    );

    if (targetCard[urlKey] && !hasWrongBackAudio) return targetCard[urlKey];
    if (!text?.trim()) return null;

    setStatus(isBack ? 'Генерируем перевод' : 'Генерируем фразу');
    let generated;
    try {
      generated = await api.post('/media/generate-audio', { text, lang, rate });
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

    if (!deckStore.deckCards.length) {
      await deckStore.fetchDeckCards(currentDeck.id);
      return useDeckStore.getState().deckCards;
    }
    return deckStore.deckCards;
  }, []);

  const moveToNextCard = useCallback(async (currentCard, runId) => {
    const settings = useSettingsStore.getState();
    const cards = await getAutoplayCards();
    if (!isCurrentRun(runId) || !cards.length) return false;

    const currentIndex = cards.findIndex((item) => item.id === currentCard.id);
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

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
  }, [getAutoplayCards, isCurrentRun, stopAudio]);

  const runCardCycle = useCallback(async (runId) => {
    const targetCard = cardRef.current;
    if (!targetCard || !isCurrentRun(runId)) return;

    const session = useSessionStore.getState();
    const settings = useSettingsStore.getState();

    try {
      session.setIsFlipped(false);
      setStatus('Озвучиваем фразу');
      const frontUrl = await ensureAudio(targetCard, 'front', runId);
      if (frontUrl) await waitForAudio(frontUrl, runId);
      if (!isCurrentRun(runId)) return;

      setStatus(`Пауза ${settings.autoplayFrontPause}с`);
      const afterFrontPause = await wait(settings.autoplayFrontPause, runId);
      if (!afterFrontPause) return;

      session.setIsFlipped(true);
      setStatus('Озвучиваем перевод');
      const latestCard = useSessionStore.getState().card || targetCard;
      const backUrl = await ensureAudio(latestCard, 'back', runId);
      if (backUrl) await waitForAudio(backUrl, runId);
      if (!isCurrentRun(runId)) return;

      setStatus(`Пауза ${settings.autoplayBackPause}с`);
      const afterBackPause = await wait(settings.autoplayBackPause, runId);
      if (!afterBackPause) return;

      await moveToNextCard(latestCard, runId);
    } catch (err) {
      console.error('Autoplay error:', err);
      if (isCurrentRun(runId)) {
        showToast?.(`Ошибка авто-режима: ${err.response?.data?.detail || err.message}`);
        useSessionStore.getState().stopAutoplay();
        stopAudio();
        setStatus('');
      }
    }
  }, [ensureAudio, isCurrentRun, moveToNextCard, showToast, stopAudio, wait, waitForAudio]);

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
    restart();
  }, [restart]);

  const stop = useCallback(() => {
    runRef.current += 1;
    clearTimer();
    stopAudio();
    setStatus('');
    useSessionStore.getState().stopAutoplay();
  }, [clearTimer, stopAudio]);

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
    clearTimer();
    stopAudio();
  }, [clearTimer, stopAudio]);

  return { start, stop, restart, cancelCurrent, status };
};
