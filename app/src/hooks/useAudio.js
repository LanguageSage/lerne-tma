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
  const retryCountRef = useRef({});

  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [audioState, setAudioState] = useState('idle'); // 'idle' | 'loading' | 'playing' | 'paused'
  const [currentUrl, setCurrentUrl] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState(1.0);
  const playbackRateRef = useRef(1.0);

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
        audioRef.current.ontimeupdate = null;
        audioRef.current.onloadedmetadata = null;
        audioRef.current.onplay = null;
        audioRef.current.onpause = null;
      } catch (e) {}
      audioRef.current = null;
    }
    setIsAudioLoading(false);
    setAudioState('idle');
    setCurrentTime(0);
    setDuration(0);
    setCurrentUrl(null);

    if (globalActiveAudio === audioRef.current || globalActiveStopCallback === stopAudio) {
      globalActiveAudio = null;
      globalActiveStopCallback = null;
    }
  }, []);

  const pauseAudio = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (e) {}
      setAudioState('paused');
    }
  }, []);

  const resumeAudio = useCallback(() => {
    if (audioRef.current && audioRef.current.paused) {
      audioRef.current.play().then(() => {
        setAudioState('playing');
      }).catch(err => {
        console.error("Resume failed:", err);
      });
    }
  }, []);

  const seekAudio = useCallback((timeSeconds) => {
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = timeSeconds;
        setCurrentTime(timeSeconds);
      } catch (e) {}
    }
  }, []);

  const setPlaybackSpeed = useCallback((speed) => {
    playbackRateRef.current = speed;
    setPlaybackRateState(speed);
    if (audioRef.current) {
      try {
        audioRef.current.playbackRate = speed;
      } catch (e) {}
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
    setAudioState('loading');
    setCurrentUrl(url);
    setCurrentTime(0);

    const cached = preloadAudio(url);
    const audio = cached?.cloneNode ? cached.cloneNode(true) : new Audio(url);
    audio.playsInline = true;
    audio.playbackRate = playbackRateRef.current || 1.0;

    audioRef.current = audio;
    globalActiveAudio = audio;
    globalActiveStopCallback = stopAudio;

    audio.oncanplaythrough = () => {
      setIsAudioLoading(false);
    };

    let animFrameId = null;
    const syncTime = () => {
      if (audioRef.current === audio && !audio.paused && !audio.ended) {
        setCurrentTime(audio.currentTime || 0);
        if (audio.duration) setDuration(audio.duration);
        animFrameId = requestAnimationFrame(syncTime);
      }
    };

    audio.onplay = () => {
      setIsAudioLoading(false);
      setAudioState('playing');
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(syncTime);
    };

    audio.onpause = () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (audioRef.current === audio && audio.currentTime < (audio.duration || 0)) {
        setAudioState('paused');
      }
    };

    audio.ontimeupdate = () => {
      if (audioRef.current === audio) {
        setCurrentTime(audio.currentTime || 0);
        if (audio.duration) setDuration(audio.duration);
      }
    };

    audio.onended = () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
    };

    audio.onloadedmetadata = () => {
      if (audioRef.current === audio) {
        setDuration(audio.duration || 0);
      }
    };

    audio.onerror = () => {
      setIsAudioLoading(false);
      setAudioState('idle');
      setCurrentUrl(null);
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
      setAudioState('idle');
      setCurrentTime(0);
      setCurrentUrl(null);

      if (globalActiveAudio === audio) {
        globalActiveAudio = null;
        globalActiveStopCallback = null;
      }
      if (onEndedCallback) onEndedCallback(true);
    };

    return audio.play().then(() => {
      retryCountRef.current[url] = 0;
      setAudioState('playing');
      return true;
    }).catch(err => {
      setIsAudioLoading(false);
      setAudioState('idle');
      setCurrentUrl(null);

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

  const togglePlayPause = useCallback((url, onEndedCallback) => {
    if (!url) return;
    if (currentUrl === url && audioRef.current) {
      if (audioState === 'playing') {
        pauseAudio();
      } else if (audioState === 'paused') {
        resumeAudio();
      } else {
        playAudio(url, onEndedCallback);
      }
    } else {
      playAudio(url, onEndedCallback);
    }
  }, [currentUrl, audioState, pauseAudio, resumeAudio, playAudio]);

  useEffect(() => {
    playAudioRef.current = playAudio;
  }, [playAudio]);

  return {
    playAudio,
    pauseAudio,
    resumeAudio,
    togglePlayPause,
    stopAudio,
    seekAudio,
    setPlaybackSpeed,
    preloadAudio,
    isAudioLoading,
    audioState,
    isPlaying: audioState === 'playing',
    isPaused: audioState === 'paused',
    currentUrl,
    currentTime,
    duration,
    playbackRate,
    startBackgroundLock: startBackgroundAudioLock,
    stopBackgroundLock: stopBackgroundAudioLock
  };
};
