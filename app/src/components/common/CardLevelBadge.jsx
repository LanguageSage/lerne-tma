import React from 'react';
import { getLevelInfo } from '../../utils/levelUtils';

export const CardLevelBadge = ({ card, size = 'md', textColor = null, style = {}, onClick = null }) => {
  const info = getLevelInfo(card);
  if (!info) return null;

  const isSmall = size === 'sm';
  const fontSize = isSmall ? '0.74rem' : '0.84rem';
  const padding = isSmall ? '2px 7px' : '4px 10px';
  const borderRadius = isSmall ? '10px' : '14px';

  const badgeTextColor = textColor || info.color;

  return (
    <div
      className="card-level-badge"
      title={`Уровень языка: ${info.level}`}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        width: 'fit-content',
        gap: '5px',
        fontSize,
        fontWeight: 600,
        padding,
        borderRadius,
        backgroundColor: info.bgColor,
        color: badgeTextColor,
        border: `1px solid ${info.borderColor}`,
        boxShadow: `0 2px 6px rgba(0, 0, 0, 0.15)`,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        userSelect: 'none',
        lineHeight: 1.2,
        cursor: 'pointer',
        ...style
      }}
    >
      <span
        style={{
          width: isSmall ? '6px' : '8px',
          height: isSmall ? '6px' : '8px',
          borderRadius: '50%',
          backgroundColor: info.color,
          boxShadow: `0 0 6px ${info.color}`,
          display: 'inline-block',
          flexShrink: 0
        }}
      />
      <span style={{ color: badgeTextColor, fontWeight: 700 }}>{info.level}</span>
    </div>
  );
};
