import { useRef, useCallback, useEffect, useState } from 'react';

// Используем сетевой эндпоинт вместо data: URI для создания полноценной сессии в AVAudioSession / MediaPlayer
const SILENT_URL = '/api/media/silent-audio';

// 1-frame transparent MP4 video (NoSleep.js standard)
const NO_SLEEP_MP4 = 'data:video/mp4;base64,AAAAHGZ0eXBpc29tAAAAAGlzb21pc28ybXA0MQAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthAHAAABthAHAAAAAAAkAAAAZ9tb292AAAAbG12aGQAAAAA2jaO72o2ju9sAAABAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACWXRyYWsAAABcdGtoZAAAAAPaNo7vajaO72wAAAABAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAABAAAAAQAAAAAAAQAAAAAAAQAAAAABp21kaWEAAAAgZ3RoZAAAAAA2jaO72jaO72wAAAABAAAAAAAAAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAFdbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcY3JlZgAAAAx1cmwgAAAAAQAAAdRzdGJsAAAAsXN0c2QAAAAAAAAAAQAAAKFhdmMxAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAABAAABAEpIBv/+ACFhVkNBLw0MSP7+QIYsC4QAAAMABAAAAwHgPEiAAAABIGdKAP/+ACFhVkNBLw0MSP7+QIYsC4QAAAMABAAAAwHgPEiAAAAAAAYDf/8AAAAYYnN0cgAAAAAQAAAAAAAQAAAAAAAQAAAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAQAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAAAAAAAEAAAAYAAAAFHN0Y28AAAAAAAAAAQAAACwAAAAUc3RzcwAAAAAAAAABAAAAAQ==';

let audioCtx = null;
let silentSource = null;
let silentAudioEl = null;
let noSleepVideoEl = null;
let isLockActive = false;
let heartbeatInterval = null;
let wakeLock = null;

const maintainBackgroundLock = () => {
  if (!isLockActive) return;
  try {
    if (silentAudioEl && silentAudioEl.paused) {
      silentAudioEl.play().catch(() => {});
    }
    if (noSleepVideoEl && noSleepVideoEl.paused) {
      noSleepVideoEl.play().catch(() => {});
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch (e) {}
};

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isLockActive) {
      maintainBackgroundLock();
    } else if (document.visibilityState === 'visible' && isLockActive) {
      if ('wakeLock' in navigator && (!wakeLock || wakeLock.released)) {
        navigator.wakeLock.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
      }
    }
  });
  window.addEventListener('blur', () => {
    if (isLockActive) {
      maintainBackgroundLock();
    }
  });
}

export const startBackgroundAudioLock = () => {
  isLockActive = true;
  try {
    // 1. Предотвращаем автоматическое отключение экрана через Wake Lock API
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(lock => {
        wakeLock = lock;
      }).catch(err => console.warn('WakeLock request failed:', err));
    }

    // 2. Предотвращаем отключение экрана через NoSleep Video Loop (Гарантия для WebView)
    if (!noSleepVideoEl) {
      noSleepVideoEl = document.createElement('video');
      noSleepVideoEl.setAttribute('playsinline', 'true');
      noSleepVideoEl.setAttribute('muted', 'true');
      noSleepVideoEl.setAttribute('loop', 'true');
      noSleepVideoEl.setAttribute('autoplay', 'true');
      noSleepVideoEl.muted = true;
      noSleepVideoEl.loop = true;
      noSleepVideoEl.playsInline = true;
      noSleepVideoEl.src = NO_SLEEP_MP4;
      noSleepVideoEl.style.position = 'fixed';
      noSleepVideoEl.style.top = '0';
      noSleepVideoEl.style.left = '0';
      noSleepVideoEl.style.width = '1px';
      noSleepVideoEl.style.height = '1px';
      noSleepVideoEl.style.opacity = '0';
      noSleepVideoEl.style.pointerEvents = 'none';
      noSleepVideoEl.style.zIndex = '-9999';
      document.body.appendChild(noSleepVideoEl);
    }
    noSleepVideoEl.play().catch(err => console.warn('NoSleep video play failed:', err));

    // 3. Сетевой тихий аудиопоток
    if (!silentAudioEl) {
      silentAudioEl = new Audio(SILENT_URL);
      silentAudioEl.loop = true;
      silentAudioEl.playsInline = true;
      silentAudioEl.preload = 'auto';

      silentAudioEl.onpause = () => {
        if (isLockActive) {
          setTimeout(() => {
            if (isLockActive && silentAudioEl && silentAudioEl.paused) {
              silentAudioEl.play().catch(() => {});
            }
          }, 50);
        }
      };
    }
    silentAudioEl.play().catch(err => console.warn('HTML5 silent audio lock failed:', err));

    // 4. Web Audio API
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    if (!silentSource) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      gain.gain.value = 0.0001; // Essentially silent
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      silentSource = osc;
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Авторежим Lerne',
        artist: 'Lerne TMA',
        album: 'Режим изучения'
      });
      navigator.mediaSession.setActionHandler('play', () => {
        maintainBackgroundLock();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (isLockActive) {
          maintainBackgroundLock();
        }
      });
    }

    if (!heartbeatInterval) {
      heartbeatInterval = setInterval(() => {
        if (isLockActive) {
          maintainBackgroundLock();
        }
      }, 1000);
    }
  } catch (err) {
    console.warn('Background audio lock init failed:', err);
  }
};

export const stopBackgroundAudioLock = () => {
  isLockActive = false;
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  try {
    if (noSleepVideoEl) {
      noSleepVideoEl.pause();
      try {
        if (noSleepVideoEl.parentNode) {
          noSleepVideoEl.parentNode.removeChild(noSleepVideoEl);
        }
      } catch (e) {}
      noSleepVideoEl = null;
    }
    if (silentAudioEl) {
      silentAudioEl.pause();
    }
    if (silentSource) {
      silentSource.stop();
      silentSource.disconnect();
      silentSource = null;
    }
    if (audioCtx && audioCtx.state === 'running') {
      audioCtx.suspend().catch(() => {});
    }
  } catch (err) {
    console.warn('Background audio lock stop failed:', err);
  }
};

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

    stopAudio();
    setIsAudioLoading(true);

    const cached = preloadAudio(url);
    const audio = cached?.cloneNode ? cached.cloneNode(true) : new Audio(url);
    audio.playsInline = true;
    audioRef.current = audio;
    
    audio.oncanplaythrough = () => {
      setIsAudioLoading(false);
    };

    audio.onerror = () => {
      setIsAudioLoading(false);
      
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

  return { playAudio, preloadAudio, stopAudio, isAudioLoading, startBackgroundLock: startBackgroundAudioLock, stopBackgroundLock: stopBackgroundAudioLock };
};
