import { useRef, useCallback, useState } from 'react';

export const useAudio = (autoPlay, showToast) => {
  const audioRef = useRef(null);
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

  const playAudio = useCallback((url) => {
    if (!url) return;

    // Stop previous audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

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
        setTimeout(() => playAudio(url), 1000);
      } else {
        if (showToast) showToast("Ошибка аудио: файл не найден или поврежден");
      }
    };

    audio.play().then(() => {
      // If played successfully, clear retry count for this URL
      retryCountRef.current[url] = 0;
    }).catch(err => {
      setIsAudioLoading(false);
      console.error("Audio play failed:", err);
      if (err.name === "NotSupportedError" || err.name === "NotAllowedError") {
         if (!autoPlay && showToast) showToast("Браузер заблокировал звук");
      }
    });
  }, [autoPlay, preloadAudio, showToast]);

  return { playAudio, preloadAudio, isAudioLoading };
};
