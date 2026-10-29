import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Languages } from 'lucide-react';
import { getCardStyle, getDesignStylesFromV2 } from '../../utils/cardStyles';
import { designConfigToCssVariables } from '../../design/designTokens.js';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth';
import { triggerHaptic } from '../../utils/platform';
import { evaluateTrainerGaps } from '../../utils/trainerEvaluation.js';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';
import { AnswerVictoryAnimation } from './AnswerVictoryAnimation.jsx';
import './StudyCardTrainer.css';

const AutoExpandingInput = React.memo(({
  rawValue = '',
  gap,
  disabled,
  status,
  inputRef,
  onInputChange,
  onCheck
}) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCheck?.();
    }
  };

  const hasValue = Boolean(rawValue && rawValue.trim());

  const isAffix = Boolean(gap.isAffix);
  const expectedAnswer = gap.correctAnswer ? (Array.isArray(gap.correctAnswer) ? gap.correctAnswer[0] : gap.correctAnswer.split('|')[0]) : '';
  const baseSizerText = isAffix ? '··' : (expectedAnswer || '______');

  const input = (
    <input
      type="text"
      className={`trainer-gap ${isAffix ? 'trainer-affix-gap' : 'trainer-full-gap'} is-${status === 'incorrect' ? 'wrong' : status || (hasValue ? 'selected' : 'idle')}`}
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
      placeholder={isAffix ? '·' : '_'.repeat(100)}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        padding: isAffix ? '0 1px' : '4px 10px',
        borderRadius: isAffix ? 0 : '10px',
        borderWidth: isAffix ? undefined : '2px',
        borderStyle: isAffix ? undefined : 'solid',
        fontWeight: 'inherit',
        fontSize: 'inherit',
        fontFamily: 'inherit',
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        verticalAlign: isAffix ? 'baseline' : 'middle',
        transition: 'border-color 0.15s ease-in-out, background 0.15s ease-in-out'
      }}
    />
  );

  const sizerContent = isAffix ? (
    <span className="trainer-affix-input-sizer" aria-hidden="true">
      {rawValue || '··'}
    </span>
  ) : (
    <span style={{ display: 'inline-grid' }}>
      <span className="trainer-input-sizer" aria-hidden="true" style={{ gridArea: '1 / 1' }}>
        {baseSizerText}
      </span>
      <span className="trainer-input-sizer" aria-hidden="true" style={{ gridArea: '1 / 1' }}>
        {rawValue}
      </span>
    </span>
  );

  return (
    <span className={isAffix ? 'trainer-affix-input-measure' : 'trainer-input-measure'}>
      {sizerContent}
      {input}
    </span>
  );
});

export const StudyCardTrainer = React.memo(({
  card,
  clozeData,
  onTrainerAnswer,
  renderAudioPlayer,
  styles = {},
  designConfig,
  savedState,
  onSaveState,
  footerActionTarget,
  assessmentMode = false
}) => {
  useInterfaceLocale();
  const [selectedOptions, setSelectedOptions] = useState(savedState?.selectedOptions || {}); // { gapId: chosenOption }
  const [openDropdownGapId, setOpenDropdownGapId] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({});
  const [showTranslation, setShowTranslation] = useState(savedState?.showTranslation || false);
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const completed = evaluation.state.completed || (assessmentMode && evaluation.state.attemptCount > 0);

  const gapRefs = useRef({});
  const dropdownRef = useRef(null);

  const v2Styles = useMemo(() => getDesignStylesFromV2(designConfig), [designConfig]);
  const cardStyle = useMemo(() => v2Styles?.frontText || getCardStyle(styles), [v2Styles, styles]);
  const designVars = useMemo(() => designConfig ? designConfigToCssVariables(designConfig) : {}, [designConfig]);

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
    if (completed || evaluation.isLocked(gapId)) return;
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
    if (assessmentMode) {
      onTrainerAnswer?.(card.id, { isCorrect: submission.state.result.accepted, completed: true,
        isFirstTry: true, attemptCount: 1, mistakeCount: submission.state.result.accepted ? 0 : 1,
        gradingSummary: { final_verdict: submission.state.result.verdict,
          error_types_seen: submission.state.errorTypesSeen, error_codes_seen: submission.state.errorCodesSeen } });
    }
    if (submission.evidence) {
      playSuccessSound();
      triggerHaptic('success');
      if (!assessmentMode) onTrainerAnswer?.(card.id, submission.evidence);
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
    const locked = completed || evaluation.isLocked(gap.id);
    const isDropdownOpen = openDropdownGapId === gap.id;
    const hasValue = Boolean(rawValue && rawValue.trim());
    const label = tr('Пропуск {{p0}}', { p0: gap.id + 1 });
    const longestChoice = gap.mode === 'choice' ? (gap.choices || []).reduce((a, b) => a.length > b.length ? a : b, '') : '';
    const sizerContent = gap.isAffix 
      ? (longestChoice || '··')
      : `${longestChoice || (gaps.length > 1 ? `[${gap.id + 1}] _____` : '_____')} ▾`;
    const displayContent = gap.isAffix 
      ? rawValue || '··'
      : `${rawValue || (gaps.length > 1 ? `[${gap.id + 1}] _____` : '_____')} ${status === 'correct' ? '✓' : '▾'}`;

    const buttonControl = (
        <button type="button" ref={el => { gapRefs.current[gap.id] = el; }}
          className={`trainer-gap ${gap.isAffix ? 'trainer-affix-gap' : 'trainer-choice-gap'} is-${status === 'incorrect' ? 'wrong' : status || (isDropdownOpen ? 'open' : (hasValue ? 'selected' : 'idle'))}`}
          onClick={e => handleOpenDropdown(gap.id, e)} disabled={locked}
          aria-label={label} aria-invalid={status === 'incorrect'}
          aria-describedby={status === 'incorrect' ? `trainer-hint-${gap.id}` : undefined}
          aria-haspopup="dialog" aria-expanded={isDropdownOpen}
          title={locked ? undefined : tr('Нажмите, чтобы выбрать вариант')}
          style={gap.isAffix ? undefined : {
            gridArea: '1 / 1', width: '100%', height: '100%', boxSizing: 'border-box',
            position: 'relative',
            fontFamily: 'inherit',
            fontSize: '1em',
            fontWeight: 'inherit',
          }}>
          {displayContent}
          {!gap.isAffix && status === 'correct' && <AnswerVictoryAnimation />}
        </button>
    );

    const control = gap.mode === 'input' ? (
      <label className={gap.isAffix ? 'trainer-affix-input' : 'trainer-input-gap'} onClick={e => e.stopPropagation()}>
        <AutoExpandingInput rawValue={rawValue} gap={gap} disabled={locked} status={status}
          inputRef={el => { gapRefs.current[gap.id] = el; }}
          onInputChange={handleInputChange} onCheck={handleCheck} />
        {!gap.isAffix && status === 'correct' && <AnswerVictoryAnimation />}
      </label>
    ) : gap.isAffix ? (
      buttonControl
    ) : (
      <span style={{ display: 'inline-grid', placeItems: 'center', maxWidth: '100%' }}>
        <span aria-hidden="true" style={{ 
          gridArea: '1 / 1', 
          visibility: 'hidden', 
          whiteSpace: 'pre', 
          padding: '4px 10px', 
          fontSize: '1em', 
          fontWeight: 'inherit'
        }}>
          {sizerContent}
        </span>
        {buttonControl}
      </span>
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

  // Keep the translation intact so Markdown paragraphs, lists and tables can render.
  const renderExerciseContent = () => {
    const rawMasked = clozeData.maskedText || '';
    if (!rawMasked) return null;

    // Split front into lines (preserving paragraph structure)
    const frontRawLines = rawMasked.split('\n');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
        {frontRawLines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={`empty-${idx}`} style={{ height: '8px' }} />;
          }

          return (
            <div key={`line-${idx}`} style={{ width: '100%', marginBottom: 0 }}>
              <div style={{ lineHeight: v2Styles ? 'inherit' : 1.75 }}>
                {renderSnippetWithGaps(line)}
              </div>
            </div>
          );
        })}

        {showTranslation && hasBackText && (
          <div className="trainer-line-trans" style={{ ...v2Styles?.backText, marginTop: '6px' }}>
            <Languages size={15} className="trainer-trans-icon" />
            <MarkdownRenderer>{backText}</MarkdownRenderer>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="interactive-mode-container trainer-exercise"
      data-design-v2={Boolean(v2Styles)}
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
      {hasBackText && !assessmentMode && (
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
            {completed ? tr(assessmentMode ? 'Ответ сохранён' : 'Выполнено') : allGapsFilled ? tr('Проверить ответы')
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
            <div ref={dropdownRef} className="gap-dropdown-popover"
              style={{ ...designVars, ...dropdownPos, fontFamily: cardStyle.fontFamily, fontSize: cardStyle.fontSize }}
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
                    {isSelected && <span aria-hidden="true">✓</span>}
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



