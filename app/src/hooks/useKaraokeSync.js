import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * Helper to generate estimated word boundaries when exact TTS timestamps are missing.
 * Distributes word start/end times proportionally to character length across the audio duration.
 */
export const estimateWordBoundaries = (text, duration) => {
  if (!text || !duration || duration <= 0) return [];
  
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const totalWords = words.length;

  // 1. Calculate weights for each word based on character length + punctuation pauses
  const wordWeights = words.map((word, index) => {
    // Base weight from letter count (min 1 char weight)
    const cleanWord = word.replace(/[^\p{L}\p{N}]/gu, '');
    let charWeight = Math.max(1, cleanWord.length);

    // Extra weight for punctuation pauses at the end of the word token
    let pauseWeight = 0;
    if (/[.!?]$/.test(word)) {
      pauseWeight = 2.4; // Sentence end pause (~0.25s-0.35s)
    } else if (/[,;:—–]$/.test(word)) {
      pauseWeight = 1.1; // Clause pause (~0.12s-0.18s)
    }

    // TTS speech pace calibration: Edge-TTS starts slightly slower and stabilizes speed
    // Apply a progressive multiplier from 1.08 (start) down to 0.94 (end) for speech pacing
    const positionFactor = totalWords > 1 
      ? 1.08 - (index / (totalWords - 1)) * 0.14
      : 1.0;

    return {
      word,
      weight: (charWeight + pauseWeight) * positionFactor,
    };
  });

  const totalWeight = wordWeights.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight === 0) return [];

  // Initial TTS stream start padding (~0.05s)
  const leadIn = Math.min(0.05, duration * 0.02);
  const effectiveDuration = Math.max(0.1, duration - leadIn);

  let currentTimePointer = leadIn;
  return wordWeights.map(({ word, weight }) => {
    const wordDuration = (weight / totalWeight) * effectiveDuration;
    const start = currentTimePointer;
    const end = start + wordDuration;
    currentTimePointer = end;
    return {
      word,
      start: roundTo(start, 3),
      end: roundTo(end, 3),
    };
  });
};

const roundTo = (num, decimals) => {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

/**
 * useKaraokeSync — synchronises word boundary data with audio currentTime
 * to determine which word is currently being spoken.
 *
 * Supports both:
 *  1. Exact TTS word boundaries (from Edge-TTS stream)
 *  2. Estimated word boundaries (fallback generated from text + audio duration)
 *
 * @param {Array|null} wordBoundaries - [{word, start, end}] from useVoicePicker (if available)
 * @param {string} text               - card text for fallback estimation
 * @param {number} duration           - total audio duration in seconds
 * @param {number} currentTime        - current audio playback time in seconds
 * @param {string} audioState         - 'playing' | 'paused' | 'idle' | 'loading'
 */
export const useKaraokeSync = (wordBoundaries, text, duration, currentTime, audioState) => {
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const prevIndexRef = useRef(-1);

  // Compute effective boundaries: use exact if present, otherwise fallback to estimation
  const effectiveBoundaries = useMemo(() => {
    if (wordBoundaries && wordBoundaries.length > 0) {
      return wordBoundaries;
    }
    if (text && duration > 0) {
      return estimateWordBoundaries(text, duration);
    }
    return null;
  }, [wordBoundaries, text, duration]);

  useEffect(() => {
    if (!effectiveBoundaries?.length || audioState === 'idle') {
      if (prevIndexRef.current !== -1) {
        prevIndexRef.current = -1;
        queueMicrotask(() => setActiveWordIndex(-1));
      }
      return;
    }

    // For exact boundaries from TTS stream, use targetTime directly
    const isExact = wordBoundaries && wordBoundaries.length > 0;
    const targetTime = isExact ? currentTime : Math.max(0, currentTime);

    // Find the word index corresponding to targetTime with a 0.03s buffer for smooth transitions
    let found = -1;
    for (let i = 0; i < effectiveBoundaries.length; i++) {
      const { start, end } = effectiveBoundaries[i];
      // Expand target range slightly so short pauses between words don't flicker to -1
      const isCurrent = targetTime >= (start - 0.02) && targetTime <= (end + 0.03);
      if (isCurrent) {
        found = i;
        break;
      }
      if (start > targetTime + 0.05) break;
    }

    // If past all words but audio still playing near end
    if (found === -1 && targetTime > 0 && effectiveBoundaries.length > 0) {
      const lastWord = effectiveBoundaries[effectiveBoundaries.length - 1];
      if (targetTime >= lastWord.start) {
        found = effectiveBoundaries.length - 1;
      }
    }

    if (found !== prevIndexRef.current) {
      prevIndexRef.current = found;
      queueMicrotask(() => setActiveWordIndex(found));
    }
  }, [effectiveBoundaries, currentTime, audioState, wordBoundaries]);

  const activeWord = activeWordIndex >= 0 ? effectiveBoundaries?.[activeWordIndex]?.word ?? null : null;

  const reset = useCallback(() => {
    setActiveWordIndex(-1);
    prevIndexRef.current = -1;
  }, []);

  return { activeWordIndex, activeWord, effectiveBoundaries, reset };
};
