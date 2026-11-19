import React from 'react';

export function StudyCardText({ side = 'front', id, style, children }) {
  return <div id={id} className={side === 'back' ? 'text-back' : 'text-front'}
    style={{ whiteSpace: 'pre-wrap', ...style }}>{children}</div>;
}
