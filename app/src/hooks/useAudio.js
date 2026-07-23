import { useRef, useCallback, useEffect, useState } from 'react';

let isLockActive = false;
let wakeLock = null;
let silentAudio = null;

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isLockActive) {
      if ('wakeLock' in navigator && (!wakeLock || wakeLock.released)) {
        navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
      }
      if (silentAudio && silentAudio.paused) {
        silentAudio.play().catch(() => {});
      }
    }
  });
}

export const startBackgroundAudioLock = () => {
  isLockActive = true;
  try {
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(lock => {
        wakeLock = lock;
      }).catch(err => console.warn('WakeLock request failed:', err));
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Авторежим Lerne',
        artist: 'Lerne TMA',
        album: 'Режим изучения'
      });
    }

    if (!silentAudio) {
      silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.loop = true;
      silentAudio.playsInline = true;
    }
    silentAudio.play().catch(err => console.warn('Silent audio play failed:', err));
  } catch (err) {
    console.warn('Background audio lock init failed:', err);
  }
};

export const stopBackgroundAudioLock = () => {
  isLockActive = false;
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  if (silentAudio) {
    try {
      silentAudio.pause();
    } catch (e) {}
    silentAudio = null;
  }
};

let globalActiveAudio = null;
let globalActiveStopCallback = null;

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
      try {
        audioRef.current.pause();
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        audioRef.current.oncanplaythrough = null;
      } catch (e) {}
      audioRef.current = null;
    }
    setIsAudioLoading(false);
    if (globalActiveAudio === audioRef.current || globalActiveStopCallback === stopAudio) {
      globalActiveAudio = null;
      globalActiveStopCallback = null;
    }
  }, []);

  const playAudio = useCallback((url, onEndedCallback) => {
    if (!url) return Promise.resolve(false);

    if (globalActiveStopCallback && globalActiveStopCallback !== stopAudio) {
      try {
        globalActiveStopCallback();
      } catch (e) {}
    }

    stopAudio();
    setIsAudioLoading(true);

    const cached = preloadAudio(url);
    const audio = cached?.cloneNode ? cached.cloneNode(true) : new Audio(url);
    audio.playsInline = true;
    audioRef.current = audio;
    globalActiveAudio = audio;
    globalActiveStopCallback = stopAudio;
    
    audio.oncanplaythrough = () => {
      setIsAudioLoading(false);
    };

    audio.onerror = () => {
      setIsAudioLoading(false);
      if (globalActiveAudio === audio) {
        globalActiveAudio = null;
        globalActiveStopCallback = null;
      }
      
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
      if (globalActiveAudio === audio) {
        globalActiveAudio = null;
        globalActiveStopCallback = null;
      }
      if (onEndedCallback) onEndedCallback(true);
    };

    return audio.play().then(() => {
      retryCountRef.current[url] = 0;
      return true;
    }).catch(err => {
      setIsAudioLoading(false);
      if (globalActiveAudio === audio) {
        globalActiveAudio = null;
        globalActiveStopCallback = null;
      }
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

  return { playAudio, preloadAudio, stopAudio, isAudioLoading, startBackgroundLock: startBackgroundAudioLock, stopBackgroundLock: stopBackgroundAudioLock };
};
