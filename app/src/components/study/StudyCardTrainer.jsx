import React, { useState, useEffect } from 'react';
import { Eye, Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { stripMarkdown } from '../../utils/text';
import { getTextShadow } from '../../utils/style';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';

export const StudyCardTrainer = ({
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
  const [activeGapId, setActiveGapId] = useState(0); // Default to first gap (0)
  const [isChecked, setIsChecked] = useState(false);
  const [isFirstTry, setIsFirstTry] = useState(true);

  const gaps = clozeData?.gaps || [];

  // Reset internal state when card changes
  useEffect(() => {
    setSelectedOptions({});
    setActiveGapId(0);
    setIsChecked(false);
    setIsFirstTry(true);
  }, [card?.id]);

  if (!card || !clozeData) return null;

  const {
    cardFont,
    cardTextColor,
    cardFontSize,
    cardFontWeight,
    cardFontStyle,
    cardTextShadow
  } = styles;

  const cardStyle = {
    fontFamily: cardFont,
    color: cardTextColor,
    fontSize: cardFontSize ? `${cardFontSize}rem` : undefined,
    fontWeight: cardFontWeight,
    fontStyle: cardFontStyle,
    textShadow: getTextShadow(cardTextShadow, cardTextColor)
  };

  const filledCount = gaps.filter(g => selectedOptions[g.id]).length;
  const allGapsFilled = gaps.length > 0 && filledCount === gaps.length;
  
  // Safe active gap resolution
  const safeActiveGapId = (activeGapId >= 0 && activeGapId < gaps.length) ? activeGapId : 0;
  const activeGap = gaps[safeActiveGapId] || gaps[0];

  const handleSelectOption = (gapId, option) => {
    const updated = { ...selectedOptions, [gapId]: option };
    setSelectedOptions(updated);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
  };

  const handleCheck = () => {
    if (!allGapsFilled) return;
    setIsChecked(true);

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
          elements.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex, pos)}</span>);
        }
        
        const chosen = selectedOptions[gap.id];
        const isCorrectChoice = chosen?.toLowerCase() === gap.correctAnswer.toLowerCase();
        const isActive = safeActiveGapId === gap.id && !isChecked;

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
          bgColor = 'rgba(168, 85, 247, 0.35)';
          textColor = '#ffffff';
        } else if (chosen) {
          borderColor = 'rgba(168, 85, 247, 0.7)';
          bgColor = 'rgba(168, 85, 247, 0.2)';
          textColor = '#ffffff';
        }

        elements.push(
          <span
            key={`gap-${gap.id}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!isChecked) {
                setActiveGapId(gap.id);
                window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
              }
            }}
            style={{
              display: 'inline-block',
              minWidth: '56px',
              padding: '3px 10px',
              margin: '2px 4px',
              borderRadius: '10px',
              border: `2px ${chosen || isActive ? 'solid' : 'dashed'} ${borderColor}`,
              background: bgColor,
              color: textColor,
              fontWeight: 700,
              textAlign: 'center',
              cursor: isChecked ? 'default' : 'pointer',
              boxShadow: isActive ? '0 0 16px rgba(168, 85, 247, 0.7)' : 'none',
              transition: 'all 0.2s ease-in-out'
            }}
            title={isChecked ? undefined : `Нажмите для выбора варианта для пропуска #${gap.id + 1}`}
          >
            {badgeLabel}
          </span>
        );
        lastIndex = pos + placeholder.length;
      }
    });

    if (lastIndex < text.length) {
      elements.push(<span key={`text-end`}>{text.substring(lastIndex)}</span>);
    }

    return elements;
  };

  return (
    <div className="interactive-mode-container" onClick={e => e.stopPropagation()}>
      {/* Masked Sentence Header with Clickable Gaps */}
      <div className="text-front cloze-masked-text" style={{ ...cardStyle, margin: '14px 0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {renderTextWithGaps()}
      </div>

      {/* Guide hint for multi-gap cards */}
      {gaps.length > 1 && !isChecked && (
        <div style={{ fontSize: '0.82rem', opacity: 0.9, textAlign: 'center', margin: '4px 0 10px 0', color: '#c084fc', fontWeight: 500 }}>
          <span>🎯 Выбираем вариант для пропуска <b>#{safeActiveGapId + 1} из {gaps.length}</b> (заполнено: {filledCount}/{gaps.length})</span>
        </div>
      )}

      {/* Options Panel for Active Gap */}
      {!isChecked && activeGap && (
        <div 
          className="cloze-choices-section glass"
          style={{
            marginTop: '10px',
            padding: '14px 16px',
            borderRadius: '16px',
            background: 'rgba(168, 85, 247, 0.08)',
            border: '1px solid rgba(168, 85, 247, 0.25)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
          }}
          onClick={e => e.stopPropagation()}
        >
          {gaps.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#e9d5ff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} style={{ color: '#c084fc' }} />
                <span>Пропуск #{activeGap.id + 1}: {selectedOptions[activeGap.id] ? `[ ${selectedOptions[activeGap.id]} ]` : '_____'}</span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  className="btn-secondary btn-tiny"
                  disabled={activeGap.id === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveGapId(activeGap.id - 1);
                  }}
                  title="Предыдущий пропуск"
                >
                  <ChevronLeft size={14} /> Назад
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-tiny"
                  disabled={activeGap.id === gaps.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveGapId(activeGap.id + 1);
                  }}
                  title="Следующий пропуск"
                >
                  Вперед <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}

          <div className="cloze-choices-grid">
            {activeGap.choices.map((opt, i) => {
              const isSelectedForActive = selectedOptions[activeGap.id] === opt;

              let btnClass = 'btn-cloze-option';
              let customStyle = {
                fontFamily: cardFont,
                fontSize: cardFontSize ? `${cardFontSize}rem` : undefined,
                fontWeight: cardFontWeight,
                fontStyle: cardFontStyle,
                textShadow: getTextShadow(cardTextShadow, cardTextColor),
                color: cardTextColor
              };

              if (isSelectedForActive) {
                customStyle = {
                  ...customStyle,
                  border: '2px solid #a855f7',
                  background: 'rgba(168, 85, 247, 0.35)',
                  color: '#ffffff',
                  boxShadow: '0 0 14px rgba(168, 85, 247, 0.5)'
                };
              }

              return (
                <button
                  key={i}
                  className={btnClass}
                  style={customStyle}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectOption(activeGap.id, opt);
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Action Footer & Feedback */}
      <div style={{ marginTop: '20px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        {isChecked && card.back && (
          <div
            className="text-hint-translation"
            style={{
              marginBottom: '8px',
              opacity: 0.9,
              fontSize: '0.95rem',
              color: '#e2e8f0',
              textAlign: 'center',
              background: 'rgba(255,255,255,0.06)',
              padding: '10px 14px',
              borderRadius: '10px',
              width: '100%'
            }}
          >
            {stripMarkdown(card.back)}
          </div>
        )}

        {isChecked && (
          <button
            className="btn-interactive-reveal"
            style={{ padding: '6px 14px', fontSize: '0.85rem', opacity: 0.8, marginTop: '4px' }}
            onClick={(e) => {
              e.stopPropagation();
              onFlip(!isFlipped);
            }}
          >
            <Eye size={15} />
            <span>{isFlipped ? 'Показать лицевую сторону' : 'Показать обратную сторону'}</span>
          </button>
        )}

        {!isChecked ? (
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              maxWidth: '300px',
              padding: '14px 24px',
              fontWeight: 700,
              borderRadius: '14px',
              fontSize: '1.05rem',
              opacity: allGapsFilled ? 1 : 0.5,
              cursor: allGapsFilled ? 'pointer' : 'not-allowed',
              background: allGapsFilled ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'rgba(255,255,255,0.12)',
              color: '#ffffff',
              boxShadow: allGapsFilled ? '0 4px 20px rgba(168, 85, 247, 0.4)' : 'none',
              border: 'none',
              transition: 'all 0.2s ease-in-out'
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
          <button
            className="btn btn-primary"
            style={{
              width: '100%',
              maxWidth: '300px',
              padding: '14px 24px',
              fontWeight: 700,
              borderRadius: '14px',
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
        )}
      </div>
    </div>
  );
};
