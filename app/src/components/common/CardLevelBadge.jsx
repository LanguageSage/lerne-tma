import React from 'react';
import { getLevelInfo } from '../../utils/levelUtils';
import { classifySentenceFast } from '../../services/classifier';

export const CardLevelBadge = ({ card, size = 'md', textColor = null, style = {}, onClick = null, showReason = true }) => {
  let info = getLevelInfo(card);

  // If card doesn't have an explicit level/tag yet, compute via local classifier on the fly
  let localClassified = null;
  const frontText = (card?.front_text || card?.front || '').trim();

  if (frontText && (!info || showReason)) {
    try {
      const res = classifySentenceFast(frontText, 'de');
      if (res && res.level) {
        localClassified = res;
        if (!info) {
          info = getLevelInfo({ level: res.level });
        }
      }
    } catch {
      // ignore
    }
  }

  if (!info) return null;

  const isSmall = size === 'sm';
  const fontSize = isSmall ? '0.74rem' : '0.84rem';
  const padding = isSmall ? '2px 7px' : '4px 10px';
  const borderRadius = isSmall ? '10px' : '14px';

  const badgeTextColor = textColor || info.color;

  // Determine reason strings
  const reasonShort = card?.reason_short || localClassified?.reason_short || null;
  const fullReason  = card?.reason || localClassified?.reason || null;

  const tooltipText = fullReason ? `Уровень: ${info.level} (${fullReason})` : `Уровень языка: ${info.level}`;

  return (
    <div
      className="card-level-badge"
      title={tooltipText}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        width: 'fit-content',
        gap: '6px',
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
      {showReason && reasonShort && (
        <span
          className="badge-reason"
          style={{
            opacity: 0.88,
            fontWeight: 500,
            fontSize: isSmall ? '0.8em' : '0.85em',
            whiteSpace: 'nowrap'
          }}
        >
          • {reasonShort}
        </span>
      )}
    </div>
  );
};
