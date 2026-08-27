import React, { useMemo } from 'react';
import { getLevelInfo } from '../../utils/levelUtils';
import { classifySentenceFast } from '../../services/classifier';

export const CardLevelBadge = ({ card, size = 'md', textColor = null, style = {}, onClick = null, showReason = true }) => {
  const frontText = (card?.front_text || card?.front || '').trim();
  const isManual = Boolean(card?.manual_level || card?.is_manual_level || card?.reason_short === 'вручную' || card?.reason === 'Установлен вручную');

  const { info, reasonShort, fullReason } = useMemo(() => {
    let computedInfo = null;
    let localClassified = null;

    if (isManual) {
      computedInfo = getLevelInfo(card);
    } else {
      if (frontText) {
        try {
          const res = classifySentenceFast(frontText, 'de');
          if (res && res.level) {
            localClassified = res;
            computedInfo = getLevelInfo({ level: res.level });
          }
        } catch {
          // ignore
        }
      }
      if (!computedInfo) {
        computedInfo = getLevelInfo(card);
      }
    }

    if (!computedInfo) return { info: null, reasonShort: null, fullReason: null };

    const rShort = isManual ? (card?.reason_short || 'вручную') : (localClassified?.reason_short || card?.reason_short || null);
    const fReason = isManual ? (card?.reason || 'Установлено вручную') : (localClassified?.reason || card?.reason || null);

    return { info: computedInfo, reasonShort: rShort, fullReason: fReason };
  }, [card, frontText, isManual]);

  if (!info) return null;

  const isSmall = size === 'sm';
  const fontSize = isSmall ? '0.8rem' : '0.93rem';
  const padding = isSmall ? '2px 8px' : '4px 10px';
  const borderRadius = isSmall ? '8px' : '10px';

  const badgeTextColor = textColor || info.color;
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
        gap: isSmall ? '5px' : '6px',
        fontSize,
        fontWeight: 800,
        padding,
        borderRadius,
        backgroundColor: info.bgColor,
        color: badgeTextColor,
        border: `1.5px solid ${info.borderColor}`,
        boxShadow: `0 2px 8px rgba(0, 0, 0, 0.2)`,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        userSelect: 'none',
        lineHeight: 1.2,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'opacity 0.2s ease, transform 0.15s ease',
        ...style
      }}
    >
      <span
        style={{
          width: isSmall ? '7px' : '8px',
          height: isSmall ? '7px' : '8px',
          borderRadius: '50%',
          backgroundColor: info.color,
          boxShadow: `0 0 6px ${info.color}`,
          display: 'inline-block',
          flexShrink: 0
        }}
      />
      <span style={{ color: badgeTextColor, fontWeight: 800 }}>{info.level}</span>
      {showReason && reasonShort && (
        <span
          className="badge-reason"
          style={{
            opacity: 0.88,
            fontWeight: 600,
            fontSize: isSmall ? '0.75em' : '0.8em',
            whiteSpace: 'nowrap'
          }}
        >
          • {reasonShort}
        </span>
      )}
    </div>
  );
};
