import React from 'react';
import './KaraokeText.css';

/**
 * KaraokeText — renders text split into word spans,
 * highlighting the active word during audio playback.
 *
 * Props:
 *  - text (string)
 *  - wordBoundaries (array|null): [{word, start, end}] (exact or estimated)
 *  - activeWordIndex (number)   : current index from useKaraokeSync (-1 = none)
 *  - style (object)
 *  - className (string)
 */
export const KaraokeText = React.memo(({
  text = '',
  wordBoundaries = null,
  activeWordIndex = -1,
  style = {},
  className = '',
}) => {
  if (!text) return null;

  // Use provided boundaries if available, or split text by spaces for word wrapping
  const wordsToRender = (wordBoundaries && wordBoundaries.length > 0)
    ? wordBoundaries.map((wb) => wb.word)
    : text.trim().split(/\s+/);

  const spans = wordsToRender.map((w, i) => {
    const isActive = i === activeWordIndex;
    return (
      <span
        key={`${w}-${i}`}
        className={`karaoke-word ${isActive ? 'karaoke-word--active' : ''}`}
      >
        {w}
        {i < wordsToRender.length - 1 ? ' ' : ''}
      </span>
    );
  });

  return (
    <span className={`karaoke-text ${className}`} style={style}>
      {spans}
    </span>
  );
});
