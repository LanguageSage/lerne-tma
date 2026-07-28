import React from 'react';
import './KaraokeText.css';

/**
 * KaraokeText — renders a string as individual word spans,
 * highlighting the currently active word in sync with audio playback.
 *
 * Props:
 *  - text (string)           : the raw text to display
 *  - wordBoundaries (array)  : [{word, start, end}] from useVoicePicker
 *  - activeWordIndex (number): current index from useKaraokeSync (-1 = none)
 *  - style (object)          : text style (font, color, etc.)
 *  - className (string)
 *
 * If wordBoundaries is null/empty, the text is rendered as-is (no highlighting).
 */
export const KaraokeText = React.memo(({
  text = '',
  wordBoundaries = null,
  activeWordIndex = -1,
  style = {},
  className = '',
}) => {
  if (!text) return null;

  // No karaoke data — plain text
  if (!wordBoundaries?.length) {
    return (
      <span className={`karaoke-text ${className}`} style={style}>
        {text}
      </span>
    );
  }

  // Build spans aligned to word boundary words.
  // We match by order (not string search) to handle duplicate words correctly.
  const spans = wordBoundaries.map((wb, i) => (
    <span
      key={i}
      className={`karaoke-word ${i === activeWordIndex ? 'karaoke-word--active' : ''}`}
    >
      {wb.word}
      {/* Preserve spacing — Edge TTS words don't include trailing spaces */}
      {i < wordBoundaries.length - 1 ? ' ' : ''}
    </span>
  ));

  return (
    <span className={`karaoke-text ${className}`} style={style}>
      {spans}
    </span>
  );
});
