import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useKaraokeSync — synchronises word boundary data with the audio currentTime
 * to determine which word is currently being spoken.
 *
 * Design:
 *  - Accepts `wordBoundaries` (from useVoicePicker) and `currentTime` (from useAudio).
 *  - Uses a binary-search-like scan to find the active word index in O(n) per tick,
 *    which is fast enough for typical sentence lengths (< 100 words).
 *  - Exposes `activeWordIndex` and `activeWord` for rendering.
 *  - When audio is idle/stopped, `activeWordIndex` resets to -1.
 *
 * @param {Array|null} wordBoundaries - [{word, start, end}] from useVoicePicker
 * @param {number} currentTime        - current playback position in seconds (from useAudio)
 * @param {string} audioState         - 'playing' | 'paused' | 'idle' | 'loading'
 */
export const useKaraokeSync = (wordBoundaries, currentTime, audioState) => {
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const prevIndexRef = useRef(-1);

  useEffect(() => {
    if (!wordBoundaries?.length || audioState === 'idle') {
      if (prevIndexRef.current !== -1) {
        setActiveWordIndex(-1);
        prevIndexRef.current = -1;
      }
      return;
    }

    // Find the word whose [start, end] window contains currentTime
    let found = -1;
    for (let i = 0; i < wordBoundaries.length; i++) {
      const { start, end } = wordBoundaries[i];
      if (currentTime >= start && currentTime < end) {
        found = i;
        break;
      }
      // If we've gone past the currentTime range, the word was in-between — keep previous
      if (start > currentTime) break;
    }

    if (found !== prevIndexRef.current) {
      setActiveWordIndex(found);
      prevIndexRef.current = found;
    }
  }, [wordBoundaries, currentTime, audioState]);

  const activeWord = activeWordIndex >= 0 ? wordBoundaries?.[activeWordIndex]?.word ?? null : null;

  const reset = useCallback(() => {
    setActiveWordIndex(-1);
    prevIndexRef.current = -1;
  }, []);

  return { activeWordIndex, activeWord, reset };
};
