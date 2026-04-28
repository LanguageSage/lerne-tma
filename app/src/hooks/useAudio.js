import { useRef, useCallback } from 'react';

export const useAudio = (autoPlay, showToast) => {
  const audioRef = useRef(null);
  const cacheRef = useRef(new Map());

  const preloadAudio = useCallback((url) => {
    if (!url) return;

    const cached = cacheRef.current.get(url);
    if (cached) return cached;

    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.load();
    cacheRef.current.set(url, audio);
    return audio;
  }, []);

  const playAudio = useCallback((url) => {
    if (!url) return;

    // Stop previous audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const cached = preloadAudio(url);
    const audio = cached?.cloneNode ? cached.cloneNode(true) : new Audio(url);
    audioRef.current = audio;
    
    audio.onerror = () => {
      if (showToast) showToast("Ошибка аудио: файл не найден или поврежден");
    };

    audio.play().catch(err => {
      console.error("Audio play failed:", err);
      if (err.name === "NotSupportedError" || err.name === "NotAllowedError") {
         if (!autoPlay && showToast) showToast("Браузер заблокировал звук");
      }
    });
  }, [autoPlay, preloadAudio, showToast]);

  return { playAudio, preloadAudio };
};
