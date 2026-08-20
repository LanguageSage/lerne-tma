import React, { useState, useEffect, useMemo } from 'react';
import { Eye, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { triggerHaptic } from '../../utils/platform';

export const StudyCardTrainer = React.memo(({
  card,
  clozeData,
  onFlip,
  onTrainerAnswer,
  onNextCard,
  styles = {},
  isPureTrainerMode = false
}) => {
  const [selectedOptions, setSelectedOptions] = useState({}); // { gapId: chosenOption }
  const [activeGapId, setActiveGapId] = useState(null);
  const [isChecked, setIsChecked] = useState(false);
  const [isFirstTry, setIsFirstTry] = useState(true);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles]);

  const gaps = useMemo(() => clozeData?.gaps || [], [clozeData?.gaps]);

  // Reset internal state when card changes
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedOptions({});
      setActiveGapId(null);
      setIsChecked(false);
      setIsFirstTry(true);
    });
  }, [card?.id]);

  // Determine current active gap (first unfilled or manually selected)
  const currentActiveGapId = useMemo(() => {
    if (gaps.length === 0) return 0;
    if (activeGapId !== null && gaps.some(g => g.id === activeGapId)) {
      return activeGapId;
    }
    const firstUnfilled = gaps.find(g => !selectedOptions[g.id]);
    return firstUnfilled ? firstUnfilled.id : gaps[0].id;
  }, [activeGapId, gaps, selectedOptions]);

  const activeGap = useMemo(() => {
    return gaps.find(g => g.id === currentActiveGapId) || gaps[0] || null;
  }, [gaps, currentActiveGapId]);

  if (!card || !clozeData) return null;

  const filledCount = gaps.filter(g => selectedOptions[g.id]).length;
  const allGapsFilled = gaps.length > 0 && filledCount === gaps.length;

  const handleSelectOption = (gapId, option) => {
    if (isChecked) return;
    const updated = { ...selectedOptions, [gapId]: option };
    setSelectedOptions(updated);
    triggerHaptic('light');

    // Auto-advance to next unfilled gap if available
    const nextUnfilled = gaps.find(g => g.id !== gapId && !updated[g.id]);
    if (nextUnfilled) {
      setActiveGapId(nextUnfilled.id);
    }
  };

  const handleCheck = () => {
    if (!allGapsFilled) return;
    setIsChecked(true);

    const allCorrect = gaps.every(
      g => (selectedOptions[g.id] || '').toLowerCase() === g.correctAnswer.toLowerCase()
    );

    if (allCorrect) {
      playSuccessSound();
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, isFirstTry);
    } else {
      playErrorSound();
      setIsFirstTry(false);
      triggerHaptic('error');
      onTrainerAnswer?.(card.id, false);
    }

    if (!isPureTrainerMode && onFlip) {
      setTimeout(() => {
        onFlip(true);
      }, 700);
    }
  };

  const handleNext = () => {
    if (onNextCard) {
      onNextCard();
    }
  };

  // Render text with interactive gap badges
  const renderTextWithGaps = () => {
    let text = clozeData.maskedText;
    const elements = [];
    let lastIndex = 0;

    gaps.forEach((gap) => {
      const placeholder = `___GAP_${gap.id}___`;
      const pos = text.indexOf(placeholder, lastIndex);
      if (pos !== -1) {
        if (pos > lastIndex) {
          elements.push(
            <span key={`text-${lastIndex}`} style={{ cursor: 'default' }}>
              {text.substring(lastIndex, pos)}
            </span>
          );
        }

        const chosen = selectedOptions[gap.id];
        const isCorrectChoice = chosen?.toLowerCase() === gap.correctAnswer.toLowerCase();
        const isActive = currentActiveGapId === gap.id && !isChecked;

        let borderColor = 'rgba(168, 85, 247, 0.45)';
        let bgColor = 'rgba(168, 85, 247, 0.08)';
        let textColor = '#c084fc';
        let badgeLabel = chosen || (gaps.length > 1 ? `[${gap.id + 1}] _____` : '_____');

        if (isChecked) {
          if (isCorrectChoice) {
            borderColor = '#22c55e';
            bgColor = 'rgba(34, 197, 94, 0.25)';
            textColor = '#4ade80';
            badgeLabel = `${chosen} ✓`;
          } else {
            borderColor = '#ef4444';
            bgColor = 'rgba(239, 68, 68, 0.25)';
            textColor = '#f87171';
            badgeLabel = `${chosen || '—'} ✗ (${gap.correctAnswer})`;
          }
        } else if (isActive) {
          borderColor = '#a855f7';
          bgColor = 'rgba(168, 85, 247, 0.35)';
          textColor = '#ffffff';
        } else if (chosen) {
          borderColor = 'rgba(168, 85, 247, 0.7)';
          bgColor = 'rgba(168, 85, 247, 0.18)';
          textColor = '#ffffff';
        }

        elements.push(
          <motion.span
            key={`gap-${gap.id}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!isChecked) {
                setActiveGapId(gap.id);
                triggerHaptic('light');
              }
            }}
            animate={isActive ? { scale: [1, 1.05, 1] } : { scale: 1 }}
            transition={isActive ? { repeat: Infinity, duration: 2 } : undefined}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '2px 4px',
              minWidth: '68px',
              padding: '4px 12px',
              borderRadius: '12px',
              border: `2px ${chosen || isActive ? 'solid' : 'dashed'} ${borderColor}`,
              background: bgColor,
              color: textColor,
              fontWeight: 700,
              textAlign: 'center',
              cursor: isChecked ? 'default' : 'pointer',
              boxShadow: isActive ? '0 0 16px rgba(168, 85, 247, 0.8)' : undefined,
              verticalAlign: 'baseline'
            }}
            title={isChecked ? undefined : `Пропуск #${gap.id + 1}`}
          >
            <span>{badgeLabel}</span>
          </motion.span>
        );
        lastIndex = pos + placeholder.length;
      }
    });

    if (lastIndex < text.length) {
      elements.push(
        <span key={`text-end`} style={{ cursor: 'default' }}>
          {text.substring(lastIndex)}
        </span>
      );
    }

    return elements;
  };

  const choices = activeGap?.choices || [];
  const hasLongChoice = choices.some(c => (c || '').length > 16);

  return (
    <div 
      className="interactive-mode-container" 
      onClick={e => e.stopPropagation()} 
      style={{ 
        cursor: 'default',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      {/* Masked Sentence Header */}
      <div 
        className="text-front cloze-masked-text" 
        style={{ 
          ...cardStyle, 
          margin: '12px 0 20px 0', 
          lineHeight: 1.8, 
          whiteSpace: 'pre-wrap', 
          cursor: 'default',
          width: '100%'
        }}
        onClick={e => e.stopPropagation()}
      >
        {renderTextWithGaps()}
      </div>

      {/* Multi-gap Indicator if more than 1 gap */}
      {gaps.length > 1 && !isChecked && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '10px',
          fontSize: '0.8rem',
          color: '#c084fc',
          fontWeight: 600
        }}>
          <Sparkles size={13} />
          <span>Варианты для пропуска #{currentActiveGapId + 1} из {gaps.length}</span>
        </div>
      )}

      {/* Duolingo-style Options Grid (Always visible inside card, no clipping!) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: hasLongChoice || choices.length <= 1 ? '1fr' : 'repeat(2, 1fr)',
          gap: '10px',
          width: '100%',
          maxWidth: '380px',
          margin: '0 auto 18px auto'
        }}
      >
        {choices.map((opt, i) => {
          const chosen = selectedOptions[currentActiveGapId];
          const isSelected = chosen === opt;
          const isCorrect = opt.toLowerCase() === activeGap?.correctAnswer?.toLowerCase();

          let btnBg = 'rgba(255, 255, 255, 0.06)';
          let btnBorder = '1.5px solid rgba(255, 255, 255, 0.12)';
          let btnColor = '#f1f5f9';
          let btnShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';

          if (isChecked) {
            if (isCorrect) {
              btnBg = 'rgba(34, 197, 94, 0.25)';
              btnBorder = '2px solid #22c55e';
              btnColor = '#4ade80';
              btnShadow = '0 0 16px rgba(34, 197, 94, 0.4)';
            } else if (isSelected && !isCorrect) {
              btnBg = 'rgba(239, 68, 68, 0.25)';
              btnBorder = '2px solid #ef4444';
              btnColor = '#f87171';
            } else {
              btnBg = 'rgba(255, 255, 255, 0.02)';
              btnBorder = '1px solid rgba(255, 255, 255, 0.05)';
              btnColor = 'rgba(255, 255, 255, 0.35)';
            }
          } else if (isSelected) {
            btnBg = 'linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(124, 58, 237, 0.4))';
            btnBorder = '2px solid #a855f7';
            btnColor = '#ffffff';
            btnShadow = '0 0 18px rgba(168, 85, 247, 0.45)';
          }

          return (
            <motion.button
              key={`${currentActiveGapId}-${i}-${opt}`}
              type="button"
              whileTap={!isChecked ? { scale: 0.95 } : undefined}
              disabled={isChecked}
              onClick={(e) => {
                e.stopPropagation();
                handleSelectOption(currentActiveGapId, opt);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '48px',
                padding: '10px 14px',
                borderRadius: '14px',
                background: btnBg,
                border: btnBorder,
                color: (isChecked || isSelected) ? btnColor : (contextStyle.color || btnColor),
                fontFamily: contextStyle.fontFamily || undefined,
                fontSize: contextStyle.fontSize || '1.1rem',
                fontWeight: isSelected ? 700 : (contextStyle.fontWeight || 600),
                fontStyle: contextStyle.fontStyle || undefined,
                textShadow: contextStyle.textShadow || undefined,
                cursor: isChecked ? 'default' : 'pointer',
                textAlign: 'center',
                boxShadow: btnShadow,
                transition: 'all 0.15s ease-in-out',
                wordBreak: 'break-word',
                userSelect: 'none',
                WebkitUserSelect: 'none'
              }}
            >
              <span>{opt}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Action Footer & Buttons */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        {!isChecked ? (
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '13px 24px',
              fontWeight: 700,
              borderRadius: '16px',
              fontSize: '1.02rem',
              cursor: allGapsFilled ? 'pointer' : 'not-allowed',
              background: allGapsFilled 
                ? 'linear-gradient(135deg, #a855f7, #7c3aed)' 
                : 'rgba(25, 20, 42, 0.85)',
              color: allGapsFilled ? '#ffffff' : '#94a3b8',
              boxShadow: allGapsFilled ? '0 6px 24px rgba(168, 85, 247, 0.5)' : 'none',
              border: allGapsFilled ? 'none' : '1px solid rgba(168, 85, 247, 0.3)',
              transition: 'all 0.2s ease-in-out',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)'
            }}
            disabled={!allGapsFilled}
            onClick={(e) => {
              e.stopPropagation();
              handleCheck();
            }}
          >
            {allGapsFilled ? 'Проверить ответы' : `Выберите вариант (${filledCount}/${gaps.length})`}
          </button>
        ) : isPureTrainerMode ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <button
              className="btn btn-primary"
              style={{
                width: '100%',
                maxWidth: '320px',
                padding: '13px 24px',
                fontWeight: 700,
                borderRadius: '16px',
                fontSize: '1.02rem',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#ffffff',
                boxShadow: '0 4px 20px rgba(34, 197, 94, 0.4)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out'
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
            >
              Дальше →
            </button>
          </div>
        ) : null}

        <button
          type="button"
          style={{ 
            cursor: 'pointer', 
            pointerEvents: 'auto',
            background: 'rgba(20, 15, 38, 0.85)', 
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            padding: '9px 16px', 
            borderRadius: '14px', 
            border: '1.5px solid rgba(168, 85, 247, 0.5)', 
            color: '#ffffff', 
            fontSize: '0.88rem',
            fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '2px',
            zIndex: 10
          }}
          onClick={(e) => {
            e.stopPropagation();
            onFlip(true);
          }}
        >
          <Eye size={15} style={{ color: '#c084fc' }} />
          <span>Показать перевод</span>
        </button>
      </div>
    </div>
  );
});
