import { useRef, useCallback } from 'react';

export const useAudio = (autoPlay, showToast) => {
  const audioRef = useRef(null);

  const playAudio = useCallback((url) => {
    if (!url) return;
    
    // Stop previous audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    console.log("Playing audio:", url);
    const audio = new Audio(url);
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
  }, [autoPlay, showToast]);

  return { playAudio };
};
