import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Languages } from 'lucide-react';
import { getCardStyle } from '../../utils/cardStyles';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { triggerHaptic } from '../../utils/platform';
import { evaluateTrainerGaps } from '../../utils/trainerEvaluation.js';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';
import { AnswerVictoryAnimation } from './AnswerVictoryAnimation.jsx';
import './StudyCardTrainer.css';

const AutoExpandingInput = React.memo(({
  rawValue,
  gap,
  disabled,
  status,
  inputRef,
  borderColor,
  bgColor,
  textColor,
  textDecoration,
  onInputChange,
  onCheck
}) => {
  const charLen = Math.max(rawValue.length + 2, 7);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCheck?.();
    }
  };

  const hasValue = Boolean(rawValue && rawValue.trim());
  const inputTextColor = gap.isAffix
    ? (status === 'correct' ? '#22c55e' : (status === 'incorrect' ? '#f87171' : (hasValue ? '#c084fc' : 'inherit')))
    : (status === 'correct' ? '#22c55e' : (status === 'incorrect' ? '#f87171' : (hasValue ? '#f3e8ff' : textColor)));

  const input = (
    <input
      type="text"
      className={gap.isAffix ? `trainer-affix-gap is-${status === 'incorrect' ? 'wrong' : status || (hasValue ? 'selected' : 'idle')}${hasValue ? ' has-value' : ''}` : undefined}
      ref={inputRef}
      aria-invalid={status === 'incorrect'}
      aria-describedby={status === 'incorrect' ? `trainer-hint-${gap.id}` : undefined}
      aria-label={tr('Пропуск {{p0}}', { p0: gap.id + 1 })}
      value={rawValue}
      disabled={disabled}
      onChange={(e) => onInputChange(gap.id, e.target.value)}
      onKeyDown={handleKeyDown}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      placeholder={gap.isAffix ? '··' : '______'}
      style={{
        width: gap.isAffix ? '100%' : `${charLen}ch`,
        position: gap.isAffix ? 'absolute' : undefined,
        inset: gap.isAffix ? 0 : undefined,
        minWidth: gap.isAffix ? undefined : '72px',
        maxWidth: '100%',
        boxSizing: 'border-box',
        padding: gap.isAffix ? '0 1px' : '4px 8px',
        borderRadius: gap.isAffix ? 0 : '10px',
        border: gap.isAffix ? undefined : `2px solid ${borderColor}`,
        background: gap.isAffix ? undefined : bgColor,
        color: inputTextColor,
        textDecoration,
        fontWeight: gap.isAffix ? (hasValue || status ? 700 : 'inherit') : 700,
        fontSize: 'inherit',
        fontFamily: 'inherit',
        textAlign: 'center',
        outline: gap.isAffix ? undefined : 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        verticalAlign: gap.isAffix ? 'baseline' : 'middle',
        boxShadow: !gap.isAffix && status === 'correct' ? '0 0 12px rgba(34, 197, 94, 0.35)' : undefined,
        animation: !gap.isAffix && status === 'correct' ? 'victoryTextPulse 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275)' : undefined,
        transition: 'border-color 0.15s ease-in-out, background 0.15s ease-in-out, width 0.1s ease-out'
      }}
    />
  );
  // Size fragments by their actual glyphs, including proportional/custom fonts.
  return gap.isAffix ? <span className="trainer-affix-input-measure">
    <span className="trainer-affix-input-sizer" aria-hidden="true">{rawValue || '··'}</span>
    {input}
  </span> : input;
});

export const StudyCardTrainer = React.memo(({
  card,
  clozeData,
  onTrainerAnswer,
  renderAudioPlayer,
  styles = {},
  savedState,
  onSaveState,
  footerActionTarget
}) => {
  useInterfaceLocale();
  const [selectedOptions, setSelectedOptions] = useState(savedState?.selectedOptions || {}); // { gapId: chosenOption }
  const [openDropdownGapId, setOpenDropdownGapId] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({});
  const [showTranslation, setShowTranslation] = useState(savedState?.showTranslation || false);
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const { completed } = evaluation.state;

  const gapRefs = useRef({});
  const dropdownRef = useRef(null);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);

  const gaps = useMemo(() => clozeData?.gaps || [], [clozeData?.gaps]);

  // Saved under StudyCard's existing reviewKey, including all partial retry evidence.
  useEffect(() => {
    onSaveState?.({ selectedOptions, showTranslation, evaluationState: evaluation.state });
  }, [selectedOptions, showTranslation, evaluation.state, onSaveState]);

  // Close dropdown on window scroll or resize to prevent detached menus
  useEffect(() => {
    if (openDropdownGapId === null) return;
    const handleDismiss = () => setOpenDropdownGapId(null);
    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        setOpenDropdownGapId(null);
        gapRefs.current[openDropdownGapId]?.focus();
      }
    };
    dropdownRef.current?.querySelector('button')?.focus();
    window.addEventListener('scroll', handleDismiss, { passive: true });
    window.addEventListener('resize', handleDismiss, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('scroll', handleDismiss);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openDropdownGapId]);

  if (!card || !clozeData) return null;

  const filledCount = gaps.filter(g => (selectedOptions[g.id] || '').trim().length > 0).length;
  const allGapsFilled = gaps.length > 0 && filledCount === gaps.length;

  const backText = (card.back_text || card.back || '').trim();
  const hasBackText = backText.length > 0;

  const handleOpenDropdown = (gapId, e) => {
    e.stopPropagation();
    if (evaluation.isLocked(gapId)) return;
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
    const estimatedHeight = Math.min(choicesCount * 48 + 16, 280);

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
    if (evaluation.isLocked(gapId)) return;
    const updated = { ...selectedOptions, [gapId]: option };
    setSelectedOptions(updated);
    evaluation.edit(gapId);
    setOpenDropdownGapId(null);
    gapRefs.current[gapId]?.focus();
    triggerHaptic('light');
  };

  const handleInputChange = (gapId, value) => {
    if (evaluation.isLocked(gapId)) return;
    setSelectedOptions(prev => ({ ...prev, [gapId]: value }));
    evaluation.edit(gapId);
  };

  const handleCheck = () => {
    if (!allGapsFilled || completed) return;
    setOpenDropdownGapId(null);
    const submission = evaluation.check(evaluateTrainerGaps(gaps, selectedOptions));
    if (!submission) return;
    if (submission.evidence) {
      playSuccessSound();
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, submission.evidence);
    } else {
      playErrorSound();
      triggerHaptic('error');
      const firstWrong = gaps.find(gap => evaluation.part(gap.id)?.status === 'incorrect');
      gapRefs.current[firstWrong?.id]?.focus();
    }
  };

  const renderHint = gap => {
    const hint = evaluation.part(gap.id)?.hint;
    return hint && <span id={`trainer-hint-${gap.id}`} className="exercise-part-hint" role="status">{tr(hint)}</span>;
  };

  const renderGapElement = gap => {
    const rawValue = selectedOptions[gap.id] || '';
    const status = evaluation.part(gap.id)?.status;
    const locked = evaluation.isLocked(gap.id);
    const isDropdownOpen = openDropdownGapId === gap.id;
    const hasValue = Boolean(rawValue && rawValue.trim());
    const borderColor = status === 'correct' ? '#22c55e'
      : status === 'incorrect' ? '#ef4444' : (hasValue ? 'rgba(168, 85, 247, 0.8)' : 'rgba(168, 85, 247, 0.45)');
    const bgColor = status === 'correct' ? 'rgba(34, 197, 94, 0.22)'
      : status === 'incorrect' ? 'rgba(239, 68, 68, 0.2)' : (hasValue ? 'rgba(168, 85, 247, 0.16)' : 'rgba(168, 85, 247, 0.1)');
    const label = tr('Пропуск {{p0}}', { p0: gap.id + 1 });
    const control = gap.mode === 'input' ? (
      <label className={gap.isAffix ? 'trainer-affix-input' : 'trainer-input-gap'} onClick={e => e.stopPropagation()}>
        <AutoExpandingInput rawValue={rawValue} gap={gap} disabled={locked} status={status}
          inputRef={el => { gapRefs.current[gap.id] = el; }}
          borderColor={borderColor} bgColor={bgColor} textColor="inherit" textDecoration="none"
          onInputChange={handleInputChange} onCheck={handleCheck} />
        {!gap.isAffix && status === 'correct' && <AnswerVictoryAnimation />}
      </label>
    ) : (
      <button type="button" ref={el => { gapRefs.current[gap.id] = el; }}
        className={gap.isAffix ? `trainer-affix-gap is-${status === 'incorrect' ? 'wrong' : status || (isDropdownOpen ? 'open' : (hasValue ? 'selected' : 'idle'))}${hasValue ? ' has-value' : ''}` : 'trainer-choice-gap'}
        onClick={e => handleOpenDropdown(gap.id, e)} disabled={locked}
        aria-label={label} aria-invalid={status === 'incorrect'}
        aria-describedby={status === 'incorrect' ? `trainer-hint-${gap.id}` : undefined}
        aria-haspopup="dialog" aria-expanded={isDropdownOpen}
        title={locked ? undefined : tr('Нажмите, чтобы выбрать вариант')}
        style={gap.isAffix ? undefined : {
          position: 'relative',
          borderColor,
          background: bgColor,
          color: status === 'correct' ? '#22c55e' : (hasValue ? '#e9d5ff' : 'inherit'),
          fontFamily: 'inherit',
          fontSize: '0.92em',
          fontWeight: hasValue || status ? 700 : 'inherit',
          boxShadow: status === 'correct'
            ? '0 0 14px rgba(34, 197, 94, 0.4)'
            : (isDropdownOpen ? '0 0 14px rgba(168, 85, 247, 0.7)' : undefined),
          animation: status === 'correct'
            ? 'victoryTextPulse 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            : undefined
        }}>
        {gap.isAffix ? rawValue || '··'
          : `${rawValue || (gaps.length > 1 ? `[${gap.id + 1}] _____` : '_____')} ${status === 'correct' ? '✓' : '▾'}`}
        {!gap.isAffix && status === 'correct' && <AnswerVictoryAnimation />}
      </button>
    );
    return gap.isAffix ? control : (
      <span key={`gap-${gap.id}`} className="exercise-part-feedback">
        {control}
        {renderHint(gap)}
      </span>
    );
  };

  // Render a snippet of text with gap placeholders replaced by interactive elements
  const renderSnippetPart = (snippet) => {
    const parts = [];
    const regex = /___GAP_(\d+)___/g;
    let match;
    let lastIdx = 0;

    while ((match = regex.exec(snippet)) !== null) {
      const gapIndex = parseInt(match[1], 10);
      const gap = gaps.find(g => g.id === gapIndex);
      const before = snippet.substring(lastIdx, match.index);
      const lastLetter = gap?.isAffix ? /[\p{L}\p{M}]$/u.exec(before)?.[0] || '' : '';
      const firstLetter = gap?.isAffix ? /^[\p{L}\p{M}]/u.exec(snippet.slice(regex.lastIndex))?.[0] || '' : '';
      const prefix = before.slice(0, before.length - lastLetter.length);
      if (prefix) {
        parts.push(
          <span key={`txt-${lastIdx}-${match.index}`} style={{ cursor: 'default' }}>
            {prefix}
          </span>
        );
      }
      if (gap) {
        parts.push(gap.isAffix
          ? <span key={`tail-${gap.id}`} className="trainer-word-tail">
              {lastLetter && <span className="trainer-word-letter">{lastLetter}</span>}
              {renderGapElement(gap)}
              {firstLetter}
            </span>
          : renderGapElement(gap));
      }
      lastIdx = regex.lastIndex + firstLetter.length;
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

  // Move words together; on emergency wraps, keep neighbouring letters glued to the gap.
  const renderSnippetWithGaps = snippet => snippet.split(/(\s+)/).map((part, index) => {
    const wordGaps = [...part.matchAll(/___GAP_(\d+)___/g)];
    const attached = wordGaps.some(match => gaps.find(gap => gap.id === Number(match[1]))?.isAffix);
    if (!attached) {
      return <React.Fragment key={index}>{renderSnippetPart(part)}</React.Fragment>;
    }

    const leadingMatch = part.match(/^[^\p{L}\p{M}\w]+/u);
    const leadingPunct = leadingMatch ? leadingMatch[0] : '';
    const withoutLeading = leadingPunct ? part.slice(leadingPunct.length) : part;

    const trailingMatch = withoutLeading.match(/[^\p{L}\p{M}\w]+$/u);
    const trailingPunct = trailingMatch ? trailingMatch[0] : '';
    const wordOnly = trailingPunct ? withoutLeading.slice(0, withoutLeading.length - trailingPunct.length) : withoutLeading;

    const areWordGapsCorrect = wordGaps.length > 0 && wordGaps.every(match => {
      const gap = gaps.find(item => item.id === Number(match[1]));
      return gap && evaluation.part(gap.id)?.status === 'correct';
    });

    return (
      <span key={index} className="exercise-part-feedback trainer-word-feedback">
        {leadingPunct}
        <span className={`trainer-word ${areWordGapsCorrect ? 'is-correct-word' : ''}`}>
          {renderSnippetPart(wordOnly)}
          {areWordGapsCorrect && <AnswerVictoryAnimation compact />}
        </span>
        {trailingPunct}
        {wordGaps.map(match => {
          const gap = gaps.find(item => item.id === Number(match[1]));
          return gap && <React.Fragment key={gap.id}>{renderHint(gap)}</React.Fragment>;
        })}
      </span>
    );
  });

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
              <div style={{ lineHeight: 1.75 }}>
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
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center', margin: '8px 0 12px 0' }}>
          <button
            type="button"
            className={`trainer-toggle-trans-btn ${showTranslation ? 'active' : ''}`}
            style={{
              padding: '8px 24px',
              borderRadius: '12px',
              fontWeight: 700,
              fontSize: '0.88rem',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
            onClick={(e) => {
              e.stopPropagation();
              setShowTranslation(prev => !prev);
              triggerHaptic('light');
            }}
            title={showTranslation ? tr("Скрыть перевод") : tr("Показать перевод")}
          >
            <Languages size={15} />
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
          width: '100%',
          paddingTop: '20px'
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
      {(() => {
        const actionButtonEl = (
          <button type="button"
            className={`btn trainer-footer-action ${allGapsFilled ? 'is-ready' : 'is-disabled'}`}
            disabled={!allGapsFilled || completed}
            onClick={e => { e.stopPropagation(); handleCheck(); }}>
            {completed ? tr('Выполнено') : allGapsFilled ? tr('Проверить ответы')
              : tr('Заполните пропуски ({{p0}}/{{p1}})', { p0: filledCount, p1: gaps.length })}
          </button>
        );

        if (footerActionTarget) {
          return createPortal(actionButtonEl, footerActionTarget);
        }

        return (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginTop: '8px' }}>
            {actionButtonEl}
          </div>
        );
      })()}

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
            <div ref={dropdownRef} className="gap-dropdown-popover" style={dropdownPos}
              role="dialog" aria-label={tr('Пропуск {{p0}}', { p0: openDropdownGapId + 1 })}
              onClick={e => e.stopPropagation()}>
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



