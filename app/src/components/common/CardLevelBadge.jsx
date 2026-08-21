import React from 'react';
import { getLevelInfo } from '../../utils/levelUtils';

export const CardLevelBadge = ({ card, size = 'md', showDifficulty = true, textColor = null, style = {} }) => {
  const info = getLevelInfo(card);
  if (!info) return null;

  const isSmall = size === 'sm';
  const fontSize = isSmall ? '0.78rem' : '0.86rem';
  const padding = isSmall ? '3px 8px' : '6px 12px';
  const borderRadius = isSmall ? '12px' : '16px';

  // Use provided card text color from design settings if available, else level color or inherit
  const badgeTextColor = textColor || 'inherit';

  return (
    <div
      className="card-level-badge"
      title={`Уровень: ${info.subLevel} • Сложность: ${info.difficultyScore} из 6`}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        fontSize,
        fontWeight: 600,
        padding,
        borderRadius,
        backgroundColor: info.bgColor,
        color: badgeTextColor,
        border: `1px solid ${info.borderColor}`,
        boxShadow: `0 3px 12px rgba(0, 0, 0, 0.25)`,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        userSelect: 'none',
        lineHeight: 1.2,
        ...style
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            width: isSmall ? '7px' : '9px',
            height: isSmall ? '7px' : '9px',
            borderRadius: '50%',
            backgroundColor: info.color,
            boxShadow: `0 0 8px ${info.color}`,
            display: 'inline-block',
            flexShrink: 0
          }}
        />
        <span style={{ color: info.color, fontWeight: 700 }}>{info.subLevel}</span>
      </span>

      {showDifficulty && (
        <>
          <span style={{ opacity: 0.3, fontWeight: 300 }}>|</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', opacity: 0.9 }}>
            <span>📊</span>
            <span>Сложность: {info.difficultyScore}</span>
          </span>
        </>
      )}
    </div>
  );
};
