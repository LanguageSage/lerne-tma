import React, { useMemo } from 'react';
import './KaraokeText.css';

/**
 * KaraokeText — renders text split into word spans,
 * highlighting the active word during audio playback while
 * strictly preserving newlines and whitespace formatting.
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
  activeWordIndex = -1,
  style = {},
  className = '',
}) => {
  const tokens = useMemo(() => {
    if (!text) return [];
    const normalized = text.replace(/\r\n/g, '\n');
    return normalized.split(/(\s+)/);
  }, [text]);

  if (!text || tokens.length === 0) return null;

  let wordIndex = 0;
  const elements = tokens.map((token, i) => {
    if (!token) return null;

    if (/^\s+$/.test(token)) {
      return <React.Fragment key={`ws-${i}`}>{token}</React.Fragment>;
    }

    const currentWordIndex = wordIndex++;
    const isActive = currentWordIndex === activeWordIndex;

    return (
      <span
        key={`w-${currentWordIndex}`}
        className={`karaoke-word ${isActive ? 'karaoke-word--active' : ''}`}
      >
        {token}
      </span>
    );
  });

  return (
    <span
      className={`karaoke-text ${className}`}
      style={{ whiteSpace: 'pre-wrap', ...style }}
    >
      {elements}
    </span>
  );
});
