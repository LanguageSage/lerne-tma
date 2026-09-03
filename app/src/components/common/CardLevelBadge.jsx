import React, { useState, useMemo } from 'react';
import { getLevelInfo, getSavedCefr } from '../../utils/levelUtils';
import { classifySentenceFast } from '../../services/classifier';

const CEFR_DESCRIPTIONS = {
  A1: 'Начальный уровень (Beginner)',
  A2: 'Базовый уровень (Elementary)',
  B1: 'Средний уровень (Intermediate)',
  B2: 'Выше среднего (Upper Intermediate)',
  C1: 'Продвинутый уровень (Advanced)',
  C2: 'В совершенстве (Proficient)'
};

export const CardLevelBadge = ({
  card,
  size = 'md',
  textColor = null,
  style = {},
  onClick = null,
  defaultExpanded = false
}) => {
  const currentCardKey = `${card?.id || ''}-${card?.front || card?.front_text || ''}-${defaultExpanded}`;
  const [prevCardKey, setPrevCardKey] = useState(currentCardKey);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (prevCardKey !== currentCardKey) {
    setPrevCardKey(currentCardKey);
    setIsExpanded(defaultExpanded);
  }

  const frontText = (card?.front_text || card?.front || '').trim();
  const savedCefr = getSavedCefr(card);
  const isManual = Boolean(
    card?.manual_level ||
    card?.is_manual_level ||
    savedCefr?.source === 'manual' ||
    card?.reason_short === 'вручную' ||
    card?.reason === 'Установлен вручную'
  );

  const { info, reasonShort, fullReason } = useMemo(() => {
    if (savedCefr?.source === 'cleared' && !savedCefr?.level) {
      return { info: null, reasonShort: null, fullReason: null };
    }

    let computedInfo = null;
    let localClassified = null;

    if (isManual) {
      computedInfo = getLevelInfo({ ...(card || {}), level: card?.level || savedCefr?.level });
    } else {
      if (savedCefr?.level) {
        computedInfo = getLevelInfo({ level: savedCefr.level });
      } else if (frontText && !card?.reason && !card?.reason_short) {
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

    const rShort = isManual 
      ? (card?.reason_short || savedCefr?.reason_short || 'вручную') 
      : (card?.reason_short || savedCefr?.reason_short || localClassified?.reason_short || null);
      
    const fReason = isManual 
      ? (card?.reason || savedCefr?.reason || 'Установлено вручную') 
      : (card?.reason || savedCefr?.reason || localClassified?.reason || (rShort ? rShort : CEFR_DESCRIPTIONS[computedInfo.level] || null));

    return { info: computedInfo, reasonShort: rShort, fullReason: fReason };
  }, [card, frontText, isManual, savedCefr]);

  if (!info) return null;

  const isSmall = size === 'sm';
  const fontSize = isSmall ? '0.8rem' : '0.93rem';
  const padding = isSmall ? '2px 8px' : '4px 10px';
  const borderRadius = isSmall ? '8px' : '10px';

  const badgeTextColor = textColor || info.color;
  const detailedExplanation = fullReason || reasonShort || CEFR_DESCRIPTIONS[info.level] || '';
  const tooltipText = isExpanded
    ? 'Нажмите, чтобы скрыть объяснение'
    : (detailedExplanation ? `Уровень: ${info.level} (кликните для объяснения)` : `Уровень языка: ${info.level}`);

  const handleClick = (e) => {
    e.stopPropagation();
    if (onClick) {
      onClick(e);
    }
    setIsExpanded(prev => !prev);
  };

  return (
    <div
      className="card-level-badge"
      title={tooltipText}
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        width: 'fit-content',
        maxWidth: 'calc(100% - 24px)',
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
        lineHeight: 1.25,
        cursor: 'pointer',
        boxSizing: 'border-box',
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
      <span style={{ color: badgeTextColor, fontWeight: 800, flexShrink: 0 }}>{info.level}</span>
      {isExpanded && detailedExplanation && (
        <span
          className="badge-reason"
          style={{
            opacity: 0.92,
            fontWeight: 600,
            fontSize: isSmall ? '0.75em' : '0.82em',
            wordBreak: 'break-word'
          }}
        >
          • {detailedExplanation}
        </span>
      )}
    </div>
  );
};
