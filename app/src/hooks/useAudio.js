import { useRef, useCallback, useEffect, useState } from 'react';

export const useAudio = (autoPlay, showToast) => {
  const audioRef = useRef(null);
  const playAudioRef = useRef(null);
  const cacheRef = useRef(new Map());
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const retryCountRef = useRef({});

  const preloadAudio = useCallback((url) => {
    if (!url) return;

    const cached = cacheRef.current.get(url);
    if (cached) return cached;

    // LRU logic: limit cache to 15 entries to prevent memory leaks
    if (cacheRef.current.size >= 15) {
      const firstKey = cacheRef.current.keys().next().value;
      cacheRef.current.delete(firstKey);
    }

    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.load();
    cacheRef.current.set(url, audio);
    return audio;
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.oncanplaythrough = null;
      audioRef.current = null;
    }
    setIsAudioLoading(false);
  }, []);

  const playAudio = useCallback((url, onEndedCallback) => {
    if (!url) return Promise.resolve(false);

    // Stop previous audio
    stopAudio();

    setIsAudioLoading(true);

    const cached = preloadAudio(url);
    const audio = cached?.cloneNode ? cached.cloneNode(true) : new Audio(url);
    audioRef.current = audio;
    
    audio.oncanplaythrough = () => {
      setIsAudioLoading(false);
    };

    audio.onerror = () => {
      setIsAudioLoading(false);
      
      // Retry logic
      const retries = retryCountRef.current[url] || 0;
      if (retries < 1) {
        retryCountRef.current[url] = retries + 1;
        console.warn(`Audio load failed, retrying once for: ${url}`);
        setTimeout(() => playAudioRef.current?.(url, onEndedCallback), 1000);
      } else {
        if (showToast) showToast("Ошибка аудио: файл не найден или поврежден");
        if (onEndedCallback) onEndedCallback(false);
      }
    };

    audio.onended = () => {
      setIsAudioLoading(false);
      if (onEndedCallback) onEndedCallback(true);
    };

    return audio.play().then(() => {
      // If played successfully, clear retry count for this URL
      retryCountRef.current[url] = 0;
      return true;
    }).catch(err => {
      setIsAudioLoading(false);
      console.error("Audio play failed:", err);
      if (err.name === "NotSupportedError" || err.name === "NotAllowedError") {
         if (!autoPlay && showToast) showToast("Браузер заблокировал звук");
      }
      if (onEndedCallback) onEndedCallback(false);
      return false;
    });
  }, [autoPlay, preloadAudio, showToast, stopAudio]);

  useEffect(() => {
    playAudioRef.current = playAudio;
  }, [playAudio]);

  return { playAudio, preloadAudio, stopAudio, isAudioLoading };
};
