import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Languages, RotateCcw } from 'lucide-react';
import { getCardStyle } from '../../utils/cardStyles';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { triggerHaptic } from '../../utils/platform';
import { normalizeAnswer } from '../../utils/clozeParser';

const AutoExpandingInput = React.memo(({
  rawValue,
  gap,
  isChecked,
  borderColor,
  bgColor,
  textColor,
  textDecoration,
  onInputChange,
  onCheck
}) => {
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [rawValue]);

  const charLen = Math.max((gap.correctAnswer || '').length + 2, rawValue.length + 2, 7);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCheck?.();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={rawValue}
      disabled={isChecked}
      onChange={(e) => onInputChange(gap.id, e.target.value)}
      onKeyDown={handleKeyDown}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      placeholder="______"
      style={{
        width: `${charLen}ch`,
        minWidth: '72px',
        maxWidth: '100%',
        boxSizing: 'border-box',
        padding: '4px 8px',
        borderRadius: '10px',
        border: `2px solid ${borderColor}`,
        background: bgColor,
        color: textColor,
        textDecoration,
        fontWeight: 700,
        fontSize: 'inherit',
        fontFamily: 'inherit',
        textAlign: 'center',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        verticalAlign: 'middle',
        lineHeight: 1.3,
        transition: 'border-color 0.15s ease-in-out, background 0.15s ease-in-out'
      }}
    />
  );
});

export const StudyCardTrainer = React.memo(({
  card,
  clozeData,
  onTrainerAnswer,
  renderAudioPlayer,
  styles = {},
  savedState,
  onSaveState
}) => {
  useInterfaceLocale();
  const [selectedOptions, setSelectedOptions] = useState(savedState?.selectedOptions || {}); // { gapId: chosenOption }
  const [openDropdownGapId, setOpenDropdownGapId] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({});
  const [showTranslation, setShowTranslation] = useState(savedState?.showTranslation || false);
  const [isChecked, setIsChecked] = useState(savedState?.isChecked || false);
  const [isFirstTry, setIsFirstTry] = useState(savedState?.isFirstTry ?? true);

  const gapRefs = useRef({});

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);

  const gaps = useMemo(() => clozeData?.gaps || [], [clozeData?.gaps]);

  // Sync state to parent for flip/navigation preservation
  useEffect(() => {
    onSaveState?.({ selectedOptions, isChecked, isFirstTry, showTranslation });
  }, [selectedOptions, isChecked, isFirstTry, showTranslation, onSaveState]);

  // Reset internal state when card changes and no saved state exists
  useEffect(() => {
    if (!savedState) {
      queueMicrotask(() => {
        setSelectedOptions({});
        setOpenDropdownGapId(null);
        setShowTranslation(false);
        setIsChecked(false);
        setIsFirstTry(true);
      });
    }
  }, [card?.id, savedState]);

  // Close dropdown on window scroll or resize to prevent detached menus
  useEffect(() => {
    if (openDropdownGapId === null) return;
    const handleDismiss = () => setOpenDropdownGapId(null);
    window.addEventListener('scroll', handleDismiss, { passive: true });
    window.addEventListener('resize', handleDismiss, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleDismiss);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [openDropdownGapId]);

  if (!card || !clozeData) return null;

  const filledCount = gaps.filter(g => (selectedOptions[g.id] || '').trim().length > 0).length;
  const allGapsFilled = gaps.length > 0 && filledCount === gaps.length;

  const backText = (card.back_text || card.back || '').trim();
  const hasBackText = backText.length > 0;

  const handleOpenDropdown = (gapId, e) => {
    e.stopPropagation();
    if (isChecked) return;
    triggerHaptic('selection');

    if (openDropdownGapId === gapId) {
      setOpenDropdownGapId(null);
      return;
    }

    const el = gapRefs.current[gapId];
    if (!el) {
      setOpenDropdownGapId(gapId);
      return;
    }

    const rect = el.getBoundingClientRect();
    const gapObj = gaps.find(g => g.id === gapId);
    const choicesCount = gapObj?.choices?.length || 3;
    const minWidth = Math.max(Math.round(rect.width), 80);

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedHeight = Math.min(choicesCount * 38 + 16, 280);

    const pos = {
      position: 'fixed',
      minWidth: `${minWidth}px`,
      maxWidth: `calc(100vw - 24px)`,
      zIndex: 99999
    };

    // Right-side screen boundary protection: if gap is near right edge, align right edge of popover to right of gap
    if (rect.left > window.innerWidth - 180) {
      pos.right = `${Math.max(12, Math.round(window.innerWidth - rect.right))}px`;
    } else {
      pos.left = `${Math.max(12, Math.round(rect.left))}px`;
    }

    // If bottom space is too small, flip upwards directly above gap
    if (spaceBelow < estimatedHeight + 16 && spaceAbove > spaceBelow) {
      pos.bottom = `${Math.round(window.innerHeight - rect.top + 6)}px`;
    } else {
      pos.top = `${Math.round(rect.bottom + 6)}px`;
    }

    setDropdownPos(pos);
    setOpenDropdownGapId(gapId);
  };

  const handleSelectOption = (gapId, option) => {
    if (isChecked) return;
    const updated = { ...selectedOptions, [gapId]: option };
    setSelectedOptions(updated);
    setOpenDropdownGapId(null);
    triggerHaptic('light');
  };

  const handleInputChange = (gapId, value) => {
    if (isChecked) return;
    setSelectedOptions(prev => ({ ...prev, [gapId]: value }));
  };

  const handleCheck = () => {
    if (!allGapsFilled) return;
    setOpenDropdownGapId(null);
    setIsChecked(true);

    const allCorrect = gaps.every(g => {
      const userAns = normalizeAnswer(selectedOptions[g.id] || '');
      const validAnswers = (g.correctAnswer || '').split('|').map(normalizeAnswer);
      return validAnswers.includes(userAns);
    });

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
  };

  const handleReset = () => {
    setSelectedOptions({});
    setOpenDropdownGapId(null);
    setIsChecked(false);
    triggerHaptic('light');
  };

  // Render a specific gap element (Input gap or Choice gap badge)
  const renderGapElement = (gap) => {
    const rawValue = selectedOptions[gap.id] || '';
    const isInputGap = gap.mode === 'input';
    const normUser = normalizeAnswer(rawValue);
    const validAnswers = (gap.correctAnswer || '').split('|').map(normalizeAnswer);
    const isCorrectChoice = validAnswers.includes(normUser);
    const isDropdownOpen = openDropdownGapId === gap.id;

    if (isInputGap) {
      let borderColor = 'rgba(168, 85, 247, 0.45)';
      let bgColor = 'rgba(168, 85, 247, 0.1)';
      let textColor = '#ffffff';
      let textDecoration = 'none';

      if (isChecked) {
        if (isCorrectChoice) {
          borderColor = '#22c55e';
          bgColor = 'rgba(34, 197, 94, 0.25)';
          textColor = '#4ade80';
        } else {
          borderColor = '#ef4444';
          bgColor = 'rgba(239, 68, 68, 0.25)';
          textColor = '#f87171';
          textDecoration = 'line-through';
        }
      }

      return (
        <span
          key={`gap-input-wrap-${gap.id}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            verticalAlign: 'middle',
            margin: '2px 4px',
            position: 'relative',
            maxWidth: '100%'
          }}
          onClick={e => e.stopPropagation()}
        >
          <AutoExpandingInput
            rawValue={rawValue}
            gap={gap}
            isChecked={isChecked}
            borderColor={borderColor}
            bgColor={bgColor}
            textColor={textColor}
            textDecoration={textDecoration}
            onInputChange={handleInputChange}
            onCheck={handleCheck}
          />
          {isChecked && (
            isCorrectChoice ? (
              <span style={{ color: '#22c55e', marginLeft: '5px', fontWeight: 800 }}>✓</span>
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  marginLeft: '4px'
                }}
              >
                <span style={{ color: '#ef4444', fontWeight: 800, fontSize: '0.9em' }}>✗</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    padding: '3px 8px',
                    borderRadius: '8px',
                    border: '1.5px solid #22c55e',
                    background: 'rgba(34, 197, 94, 0.25)',
                    color: '#4ade80',
                    fontWeight: 700,
                    fontSize: '0.88em'
                  }}
                >
                  <span>{gap.correctAnswer}</span>
                  <span style={{ color: '#22c55e', fontWeight: 800 }}>✓</span>
                </span>
              </span>
            )
          )}
        </span>
      );
    }

    // Choice gap when checked & incorrect: render two separate side-by-side badges
    if (isChecked && !isCorrectChoice) {
      return (
        <span
          key={`gap-choice-result-${gap.id}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            verticalAlign: 'baseline',
            margin: '2px 4px'
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Wrong User Choice Badge */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 9px',
              borderRadius: '10px',
              border: '1.5px solid #ef4444',
              background: 'rgba(239, 68, 68, 0.25)',
              color: '#f87171',
              fontWeight: 700,
              fontSize: '0.92em',
              userSelect: 'none'
            }}
          >
            <span style={{ textDecoration: 'line-through' }}>{rawValue || '—'}</span>
            <span style={{ color: '#ef4444', fontWeight: 800 }}>✗</span>
          </span>

          {/* Correct Answer Badge */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 9px',
              borderRadius: '10px',
              border: '1.5px solid #22c55e',
              background: 'rgba(34, 197, 94, 0.25)',
              color: '#4ade80',
              fontWeight: 700,
              fontSize: '0.92em',
              userSelect: 'none'
            }}
          >
            <span>{gap.correctAnswer}</span>
            <span style={{ color: '#22c55e', fontWeight: 800 }}>✓</span>
          </span>
        </span>
      );
    }

    // Choice gap: interactive clickable badge (default / correct / open)
    let borderColor = 'rgba(168, 85, 247, 0.45)';
    let bgColor = 'rgba(168, 85, 247, 0.08)';
    let textColor = '#c084fc';
    let badgeLabel = rawValue ? `${rawValue} ▾` : (gaps.length > 1 ? `[${gap.id + 1}] _____ ▾` : '_____ ▾');

    if (isChecked) {
      if (isCorrectChoice) {
        borderColor = '#22c55e';
        bgColor = 'rgba(34, 197, 94, 0.25)';
        textColor = '#4ade80';
        badgeLabel = `${rawValue} ✓`;
      }
    } else if (isDropdownOpen) {
      borderColor = '#a855f7';
      bgColor = 'rgba(168, 85, 247, 0.35)';
      textColor = '#ffffff';
    } else if (rawValue) {
      borderColor = 'rgba(168, 85, 247, 0.7)';
      bgColor = 'rgba(168, 85, 247, 0.18)';
      textColor = '#ffffff';
    }

    return (
      <button
        key={`gap-btn-${gap.id}`}
        ref={el => { gapRefs.current[gap.id] = el; }}
        type="button"
        onClick={(e) => handleOpenDropdown(gap.id, e)}
        disabled={isChecked}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '2px 4px',
          minWidth: '68px',
          padding: '4px 10px',
          borderRadius: '10px',
          border: `1.5px ${rawValue || isDropdownOpen ? 'solid' : 'dashed'} ${borderColor}`,
          background: bgColor,
          color: textColor,
          fontWeight: 700,
          fontSize: '0.92em',
          fontFamily: 'inherit',
          textAlign: 'center',
          cursor: isChecked ? 'default' : 'pointer',
          boxShadow: isDropdownOpen ? '0 0 14px rgba(168, 85, 247, 0.7)' : undefined,
          verticalAlign: 'baseline',
          transition: 'all 0.15s ease-in-out',
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
        title={isChecked ? undefined : tr("Нажмите, чтобы выбрать вариант")}
      >
        <span>{badgeLabel}</span>
      </button>
    );
  };

  // Render a snippet of text with gap placeholders replaced by interactive elements
  const renderSnippetWithGaps = (snippet) => {
    const parts = [];
    const regex = /___GAP_(\d+)___/g;
    let match;
    let lastIdx = 0;

    while ((match = regex.exec(snippet)) !== null) {
      const gapIndex = parseInt(match[1], 10);
      const gap = gaps.find(g => g.id === gapIndex);
      if (match.index > lastIdx) {
        parts.push(
          <span key={`txt-${lastIdx}-${match.index}`} style={{ cursor: 'default' }}>
            {snippet.substring(lastIdx, match.index)}
          </span>
        );
      }
      if (gap) {
        parts.push(renderGapElement(gap));
      }
      lastIdx = regex.lastIndex;
    }

    if (lastIdx < snippet.length) {
      parts.push(
        <span key={`txt-end-${lastIdx}`} style={{ cursor: 'default' }}>
          {snippet.substring(lastIdx)}
        </span>
      );
    }

    return parts;
  };

  // Render the full text with optional line-by-line / paragraph-by-paragraph translation
  const renderExerciseContent = () => {
    const rawMasked = clozeData.maskedText || '';
    if (!rawMasked) return null;

    // Split front into lines (preserving paragraph structure)
    const frontRawLines = rawMasked.split('\n');
    // Split back translation into non-empty lines
    const backLines = backText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    let backLinePointer = 0;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
        {frontRawLines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={`empty-${idx}`} style={{ height: '8px' }} />;
          }

          const translationForLine = backLines[backLinePointer];
          backLinePointer += 1;

          return (
            <div key={`line-${idx}`} style={{ width: '100%', marginBottom: 0 }}>
              <div style={{ lineHeight: 1.35 }}>
                {renderSnippetWithGaps(line)}
              </div>
              {showTranslation && translationForLine && (
                <div className="trainer-line-trans">
                  <Languages size={15} className="trainer-trans-icon" />
                  <span>{translationForLine}</span>
                </div>
              )}
            </div>
          );
        })}

        {showTranslation && backLinePointer < backLines.length && (
          <div className="trainer-line-trans" style={{ marginTop: '6px' }}>
            <Languages size={15} className="trainer-trans-icon" />
            <span>{backLines.slice(backLinePointer).join('\n')}</span>
          </div>
        )}
      </div>
    );
  };

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
      {/* Front Face Translation Toggle Button */}
      {hasBackText && (
        <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', marginBottom: '8px' }}>
          <button
            type="button"
            className={`trainer-toggle-trans-btn ${showTranslation ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setShowTranslation(prev => !prev);
              triggerHaptic('light');
            }}
            title={showTranslation ? tr("Скрыть перевод") : tr("Показать перевод")}
          >
            <Languages size={14} />
            <span>{showTranslation ? tr("Скрыть перевод") : tr("Показать перевод")}</span>
          </button>
        </div>
      )}

      {/* Main Text with Gaps & Inline Translation */}
      <div
        className="text-front cloze-masked-text"
        style={{
          ...cardStyle,
          margin: '4px 0 16px 0',
          cursor: 'default',
          width: '100%'
        }}
        onClick={e => e.stopPropagation()}
      >
        {renderExerciseContent()}
      </div>

      {renderAudioPlayer && (
        <div style={{ width: '100%', marginBottom: '16px' }}>
          {renderAudioPlayer()}
        </div>
      )}

      {/* Action Footer & Buttons */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
        {!isChecked ? (
          <button
            type="button"
            className="btn"
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '13px 24px',
              fontWeight: 700,
              borderRadius: '16px',
              fontSize: '1.02rem',
              cursor: allGapsFilled ? 'pointer' : 'not-allowed',
              background: allGapsFilled
                ? 'rgba(255, 255, 255, 0.12)'
                : 'rgba(25, 20, 42, 0.4)',
              color: allGapsFilled ? '#ffffff' : '#94a3b8',
              boxShadow: allGapsFilled ? '0 4px 20px rgba(0, 0, 0, 0.25)' : 'none',
              border: allGapsFilled ? '1.5px solid rgba(255, 255, 255, 0.28)' : '1px solid rgba(255, 255, 255, 0.1)',
              transition: 'all 0.2s ease-in-out',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)'
            }}
            disabled={!allGapsFilled}
            onClick={(e) => {
              e.stopPropagation();
              handleCheck();
            }}
          >
            {allGapsFilled ? tr("Проверить ответы") : tr("Заполните пропуски ({{p0}}/{{p1}})", { p0: filledCount, p1: gaps.length })}
          </button>
        ) : (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="btn"
              style={{
                width: '100%',
                maxWidth: '320px',
                padding: '13px 24px',
                fontWeight: 700,
                borderRadius: '16px',
                fontSize: '1.02rem',
                background: 'rgba(255, 255, 255, 0.12)',
                color: '#ffffff',
                border: '1.5px solid rgba(255, 255, 255, 0.28)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)'
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
            >
              <RotateCcw size={18} />
              <span>{tr("Сбросить")}</span>
            </button>
          </div>
        )}
      </div>

      {/* Viewport-Safe Floating Gap Dropdown Popover */}
      {openDropdownGapId !== null && (() => {
        const activeDropdownGap = gaps.find(g => g.id === openDropdownGapId);
        if (!activeDropdownGap || activeDropdownGap.mode !== 'choice') return null;
        const currentChoices = activeDropdownGap.choices || [];
        const currentChosen = selectedOptions[openDropdownGapId];

        return createPortal(
          <>
            <div
              className="gap-dropdown-backdrop"
              onClick={() => setOpenDropdownGapId(null)}
              onTouchStart={() => setOpenDropdownGapId(null)}
            />
            <div className="gap-dropdown-popover" style={dropdownPos} onClick={e => e.stopPropagation()}>
              {currentChoices.map((opt, i) => {
                const isSelected = currentChosen === opt;
                return (
                  <button
                    key={`${openDropdownGapId}-${i}-${opt}`}
                    type="button"
                    className={`gap-dropdown-item ${isSelected ? 'is-selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectOption(openDropdownGapId, opt);
                    }}
                  >
                    <span style={{ flex: 1 }}>{opt}</span>
                    {isSelected && <span style={{ color: '#c084fc', fontWeight: 800 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </>,
          document.body
        );
      })()}
    </div>
  );
});
