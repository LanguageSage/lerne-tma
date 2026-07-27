import React, { useState, useEffect, useRef } from 'react';
import { Eye, X, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { stripMarkdown } from '../../utils/text';
import { getTextShadow } from '../../utils/style';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';

export const StudyCardTrainer = React.memo(({
  card,
  clozeData,
  isFlipped,
  onFlip,
  playAudio,
  onTrainerAnswer,
  onNextCard,
  styles = {}
}) => {
  const [selectedOptions, setSelectedOptions] = useState({}); // { gapId: chosenOption }
  const [activeGapId, setActiveGapId] = useState(null); // null by default
  const [isChecked, setIsChecked] = useState(false);
  const [isFirstTry, setIsFirstTry] = useState(true);
  const [popoverAlign, setPopoverAlign] = useState({}); // { [gapId]: 'center' | 'left' | 'right' }

  const gapRefs = useRef({});
  const gaps = clozeData?.gaps || [];

  // Reset internal state when card changes
  useEffect(() => {
    setSelectedOptions({});
    setActiveGapId(null);
    setIsChecked(false);
    setIsFirstTry(true);
  }, [card?.id]);

  // Smart Popover Edge Alignment Detection (Prevents off-screen overflow!)
  useEffect(() => {
    if (activeGapId !== null && gapRefs.current[activeGapId]) {
      const el = gapRefs.current[activeGapId];
      const rect = el.getBoundingClientRect();
      const parentContainer = el.closest('.interactive-mode-container') || document.body;
      const parentRect = parentContainer.getBoundingClientRect();

      const spaceLeft = rect.left - parentRect.left;
      const spaceRight = parentRect.right - rect.right;

      let align = 'center';
      if (spaceLeft < 110) {
        align = 'left';
      } else if (spaceRight < 110) {
        align = 'right';
      }

      setPopoverAlign(prev => ({ ...prev, [activeGapId]: align }));
    }
  }, [activeGapId]);

  if (!card || !clozeData) return null;

  const {
    cardFont,
    cardTextColor,
    cardFontSize,
    cardFontWeight,
    cardFontStyle,
    cardTextShadow,
    cardTextAlign
  } = styles;

  const cardStyle = {
    fontFamily: cardFont,
    color: cardTextColor,
    fontSize: cardFontSize ? `${cardFontSize}rem` : undefined,
    fontWeight: cardFontWeight,
    fontStyle: cardFontStyle,
    textShadow: getTextShadow(cardTextShadow, cardTextColor),
    textAlign: cardTextAlign || 'center'
  };

  const filledCount = gaps.filter(g => selectedOptions[g.id]).length;
  const allGapsFilled = gaps.length > 0 && filledCount === gaps.length;

  const handleSelectOption = (gapId, option) => {
    const updated = { ...selectedOptions, [gapId]: option };
    setSelectedOptions(updated);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    // Close dropdown menu immediately after selecting an option!
    setActiveGapId(null);
  };

  const handleCheck = () => {
    if (!allGapsFilled) return;
    setIsChecked(true);
    setActiveGapId(null);

    const allCorrect = gaps.every(
      g => (selectedOptions[g.id] || '').toLowerCase() === g.correctAnswer.toLowerCase()
    );

    if (allCorrect) {
      playSuccessSound();
      if (card.audio_url && playAudio) {
        playAudio(card.audio_url);
      }
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      onTrainerAnswer?.(card.id, isFirstTry);
    } else {
      playErrorSound();
      setIsFirstTry(false);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      onTrainerAnswer?.(card.id, false);
    }
  };

  const handleNext = () => {
    if (onNextCard) {
      onNextCard();
    }
  };

  // Render text with interactive gap badges and smart alignment popovers
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
        const isActive = activeGapId === gap.id && !isChecked;
        const align = popoverAlign[gap.id] || 'center';

        let borderColor = 'rgba(168, 85, 247, 0.4)';
        let bgColor = 'rgba(168, 85, 247, 0.08)';
        let textColor = '#c084fc';
        let badgeLabel = chosen || (gaps.length > 1 ? `[${gap.id + 1}] _____` : '_____');

        if (isChecked) {
          if (isCorrectChoice) {
            borderColor = '#22c55e';
            bgColor = 'rgba(34, 197, 94, 0.2)';
            textColor = '#4ade80';
            badgeLabel = `${chosen} ✓`;
          } else {
            borderColor = '#ef4444';
            bgColor = 'rgba(239, 68, 68, 0.2)';
            textColor = '#f87171';
            badgeLabel = `${chosen || '—'} ✗ (${gap.correctAnswer})`;
          }
        } else if (isActive) {
          borderColor = '#a855f7';
          bgColor = 'rgba(168, 85, 247, 0.4)';
          textColor = '#ffffff';
        } else if (chosen) {
          borderColor = 'rgba(168, 85, 247, 0.7)';
          bgColor = 'rgba(168, 85, 247, 0.2)';
          textColor = '#ffffff';
        }

        // Dynamic alignment styles for popover container & arrow
        let popoverPos = { left: '50%', transform: 'translateX(-50%)' };
        let arrowPos = { left: '50%', transform: 'translateX(-50%) rotate(45deg)' };

        if (align === 'left') {
          popoverPos = { left: '0', transform: 'none' };
          arrowPos = { left: '20px', transform: 'rotate(45deg)' };
        } else if (align === 'right') {
          popoverPos = { right: '0', left: 'auto', transform: 'none' };
          arrowPos = { right: '20px', transform: 'rotate(45deg)' };
        }

        elements.push(
          <span
            key={`gap-${gap.id}`}
            ref={el => (gapRefs.current[gap.id] = el)}
            style={{
              position: 'relative',
              display: 'inline-block',
              margin: '2px 4px',
              verticalAlign: 'baseline'
            }}
          >
            {/* Clickable Gap Badge */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                if (!isChecked) {
                  setActiveGapId(prev => prev === gap.id ? null : gap.id);
                  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
                }
              }}
              style={{
                display: 'inline-block',
                minWidth: '56px',
                padding: '3px 10px',
                borderRadius: '10px',
                border: `2px ${chosen || isActive ? 'solid' : 'dashed'} ${borderColor}`,
                background: bgColor,
                color: textColor,
                fontWeight: 700,
                textAlign: 'center',
                cursor: isChecked ? 'default' : 'pointer',
                boxShadow: isActive ? '0 0 20px rgba(168, 85, 247, 0.95)' : 'none',
                transform: isActive ? 'scale(1.08)' : 'none',
                transition: 'all 0.2s ease-in-out'
              }}
              title={isChecked ? undefined : `Нажмите, чтобы открыть варианты для пропуска #${gap.id + 1}`}
            >
              {badgeLabel}
            </span>

            {/* INLINE DROPDOWN POPOVER MENU WITH SMART BOUNDARY PROTECTION */}
            <AnimatePresence>
              {isActive && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.95 }}
                  transition={{ duration: 0.16 }}
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    ...popoverPos,
                    zIndex: 1000,
                    minWidth: '200px',
                    maxWidth: 'calc(100vw - 32px)',
                    width: 'max-content',
                    background: 'rgba(20, 15, 38, 0.97)',
                    backdropFilter: 'blur(18px)',
                    WebkitBackdropFilter: 'blur(18px)',
                    border: '1.5px solid rgba(168, 85, 247, 0.65)',
                    borderRadius: '14px',
                    padding: '10px',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.75), 0 0 24px rgba(168, 85, 247, 0.4)',
                    cursor: 'default'
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Top Arrow Pointer */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '-6px',
                      ...arrowPos,
                      width: '10px',
                      height: '10px',
                      background: 'rgba(20, 15, 38, 0.97)',
                      borderLeft: '1.5px solid rgba(168, 85, 247, 0.65)',
                      borderTop: '1.5px solid rgba(168, 85, 247, 0.65)',
                      zIndex: 1001
                    }}
                  />

                  {/* Dropdown Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Sparkles size={13} />
                      <span>Пропуск #{gap.id + 1} из {gaps.length}</span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveGapId(null);
                      }}
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                      title="Закрыть меню"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {/* Dropdown Choice Buttons List */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {gap.choices.map((opt, i) => {
                      const isSelected = chosen === opt;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectOption(gap.id, opt);
                          }}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: isSelected ? '1.5px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                            background: isSelected ? 'rgba(168, 85, 247, 0.35)' : 'rgba(255,255,255,0.06)',
                            color: isSelected ? '#ffffff' : '#e2e8f0',
                            fontFamily: cardFont,
                            fontSize: cardFontSize ? `${cardFontSize}rem` : undefined,
                            fontWeight: isSelected ? 700 : (cardFontWeight || 500),
                            fontStyle: cardFontStyle,
                            textShadow: getTextShadow(cardTextShadow, cardTextColor),
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease-in-out',
                            boxShadow: isSelected ? '0 0 10px rgba(168, 85, 247, 0.4)' : 'none'
                          }}
                        >
                          {isSelected ? `✓ ${opt}` : opt}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </span>
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

  return (
    <div className="interactive-mode-container" onClick={e => e.stopPropagation()} style={{ cursor: 'default' }}>
      {/* Masked Sentence Header with Clickable Gaps and Inline Dropdown Menus */}
      <div 
        className="text-front cloze-masked-text" 
        style={{ ...cardStyle, margin: '14px 0', lineHeight: 1.8, whiteSpace: 'pre-wrap', cursor: 'default' }}
        onClick={e => e.stopPropagation()}
      >
        {renderTextWithGaps()}
      </div>

      {/* High-Contrast Helper Guide Chip */}
      {!isChecked && (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', margin: '8px 0 12px 0' }}>
          <div 
            style={{ 
              fontSize: '0.92rem',
              fontWeight: 600,
              textAlign: 'center', 
              color: '#f3e8ff',
              background: 'rgba(15, 12, 30, 0.85)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              border: '1px solid rgba(168, 85, 247, 0.45)',
              padding: '8px 16px',
              borderRadius: '999px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              maxWidth: '92%'
            }}
          >
            <span>👆 <b>Нажмите на любой пропуск</b> для выбора</span>
            <span style={{ 
              background: filledCount === gaps.length ? 'rgba(34, 197, 94, 0.3)' : 'rgba(168, 85, 247, 0.35)', 
              padding: '2px 9px', 
              borderRadius: '12px', 
              fontSize: '0.85rem', 
              fontWeight: 700, 
              color: filledCount === gaps.length ? '#4ade80' : '#e9d5ff',
              border: filledCount === gaps.length ? '1px solid rgba(34, 197, 94, 0.5)' : '1px solid rgba(168, 85, 247, 0.5)'
            }}>
              {filledCount}/{gaps.length}
            </span>
          </div>
        </div>
      )}

      {/* Action Footer & Feedback */}
      <div style={{ marginTop: '16px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        {!isChecked ? (
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '14px 24px',
              fontWeight: 700,
              borderRadius: '16px',
              fontSize: '1.05rem',
              cursor: allGapsFilled ? 'pointer' : 'not-allowed',
              background: allGapsFilled 
                ? 'linear-gradient(135deg, #a855f7, #7c3aed)' 
                : 'rgba(25, 20, 42, 0.85)',
              color: allGapsFilled ? '#ffffff' : '#cbd5e1',
              boxShadow: allGapsFilled ? '0 6px 24px rgba(168, 85, 247, 0.5)' : '0 4px 16px rgba(0, 0, 0, 0.4)',
              border: allGapsFilled ? 'none' : '1px solid rgba(168, 85, 247, 0.35)',
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
            {allGapsFilled ? 'Проверить ответы' : `Заполните все пропуски (${filledCount}/${gaps.length})`}
          </button>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <button
              className="btn btn-primary"
              style={{
                width: '100%',
                maxWidth: '320px',
                padding: '14px 24px',
                fontWeight: 700,
                borderRadius: '16px',
                fontSize: '1.05rem',
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
        )}

        <button
          type="button"
          style={{ 
            cursor: 'pointer', 
            pointerEvents: 'auto',
            background: 'rgba(20, 15, 38, 0.92)', 
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            padding: '10px 18px', 
            borderRadius: '14px', 
            border: '1.5px solid rgba(168, 85, 247, 0.6)', 
            color: '#ffffff', 
            fontSize: '0.92rem',
            fontWeight: 700,
            boxShadow: '0 4px 18px rgba(0, 0, 0, 0.45)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '4px',
            zIndex: 20
          }}
          onClick={(e) => {
            e.stopPropagation();
            onFlip(true);
          }}
        >
          <Eye size={16} style={{ color: '#c084fc' }} />
          <span>Показать обратную сторону (Перевод)</span>
        </button>
      </div>
    </div>
  );
});
