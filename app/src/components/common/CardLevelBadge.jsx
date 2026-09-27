import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useMemo } from 'react';
import { getLevelInfo, getSavedCefr } from '../../utils/levelUtils';

const CEFR_DESCRIPTIONS = {
  get A1() { return tr("Начальный уровень (Beginner)"); },
  get A2() { return tr("Базовый уровень (Elementary)"); },
  get B1() { return tr("Средний уровень (Intermediate)"); },
  get B2() { return tr("Выше среднего (Upper Intermediate)"); },
  get C1() { return tr("Продвинутый уровень (Advanced)"); },
  get C2() { return tr("В совершенстве (Proficient)"); }
};

export const CardLevelBadge = ({
  card,
  size = 'md',
  textColor = null,
  style = {},
  onClick = null,
  defaultExpanded = false
}) => {
  useInterfaceLocale();
  const currentCardKey = `${card?.id || ''}-${card?.front || card?.front_text || ''}-${defaultExpanded}`;
  const [prevCardKey, setPrevCardKey] = useState(currentCardKey);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (prevCardKey !== currentCardKey) {
    setPrevCardKey(currentCardKey);
    setIsExpanded(defaultExpanded);
  }

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

    const computedInfo = getLevelInfo(card);
    if (!computedInfo) return { info: null, reasonShort: null, fullReason: null };

    const rShort = card?.reason_short || savedCefr?.reason_short || (isManual ? tr("вручную") : null);
    const fReason = card?.reason || savedCefr?.reason || (isManual ? tr("Установлено вручную") : (rShort ? rShort : CEFR_DESCRIPTIONS[computedInfo.level] || null));

    return { info: computedInfo, reasonShort: rShort, fullReason: fReason };
  }, [card, isManual, savedCefr]);

  if (!info) return null;

  const isSmall = size === 'sm';
  const fontSize = isSmall ? '0.8rem' : '0.93rem';
  const padding = isSmall ? '2px 8px' : '4px 10px';
  const borderRadius = isSmall ? '8px' : '10px';

  const badgeTextColor = textColor || info.color;
  const detailedExplanation = fullReason || reasonShort || CEFR_DESCRIPTIONS[info.level] || '';
  const tooltipText = isExpanded
    ? tr("Нажмите, чтобы скрыть объяснение")
    : (detailedExplanation ? tr("Уровень: {{p0}} (кликните для объяснения)", { p0: info.level }) : tr("Уровень языка: {{p0}}", { p0: info.level }));

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
