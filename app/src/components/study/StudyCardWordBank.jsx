import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getCardStyle } from '../../utils/cardStyles.js';
import { playErrorSound, playSuccessSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';
import {
  assignWordBankOption,
  checkWordBankAssignments,
  getFirstEmptyWordBankGapId,
  getNextEmptyWordBankGapId,
  getUsedWordBankOptionIds,
  removeWordBankOption,
  sanitizeWordBankAssignments
} from '../../utils/wordBankState.js';

export const StudyCardWordBank = React.memo(({
  card,
  wordBankData,
  onTrainerAnswer,
  styles = {},
  savedState,
  onSaveState,
  footerActionTarget
}) => {
  useInterfaceLocale();

  const { gaps, options, maskedText } = wordBankData;
  const [assignments, setAssignments] = useState(() => (
    sanitizeWordBankAssignments(savedState?.assignments, gaps, options)
  ));
  const [activeGapId, setActiveGapId] = useState(() => {
    if (savedState?.activeGapId && gaps.some(gap => gap.id === savedState.activeGapId)) {
      return savedState.activeGapId;
    }
    const restored = sanitizeWordBankAssignments(savedState?.assignments, gaps, options);
    return getFirstEmptyWordBankGapId(gaps, restored);
  });
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const { completed: isCompleted } = evaluation.state;

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const optionFontSize = useMemo(() => {
    if (cardStyle?.fontSize) {
      return `calc(${cardStyle.fontSize} * 0.9)`;
    }
    return '0.9em';
  }, [cardStyle]);
  const optionById = useMemo(() => new Map(options.map(option => [option.id, option])), [options]);
  const usedOptionIds = useMemo(() => getUsedWordBankOptionIds(assignments), [assignments]);
  const allFilled = gaps.length > 0 && gaps.every(gap => assignments[gap.id]);

  useEffect(() => {
    onSaveState?.({ assignments, activeGapId, evaluationState: evaluation.state });
  }, [assignments, activeGapId, evaluation.state, onSaveState]);

  if (!card || !wordBankData) return null;

  const handleGapClick = (gapId, event) => {
    event.stopPropagation();
    if (evaluation.isLocked(gapId)) return;
    triggerHaptic('selection');
    setActiveGapId(gapId);

    if (assignments[gapId]) {
      setAssignments(previous => removeWordBankOption(previous, gapId));
      evaluation.edit(gapId);
    }
  };

  const handleOptionClick = (optionId, event) => {
    event.stopPropagation();
    if (isCompleted || usedOptionIds.has(optionId)) return;

    const targetGapId = activeGapId || getFirstEmptyWordBankGapId(gaps, assignments);
    if (!targetGapId || evaluation.isLocked(targetGapId)) return;

    const updated = assignWordBankOption(assignments, targetGapId, optionId);
    if (updated === assignments) return;

    setAssignments(updated);
    evaluation.edit(targetGapId);
    setActiveGapId(getNextEmptyWordBankGapId(gaps, updated, targetGapId));
    triggerHaptic('light');
  };

  const handleCheck = (event) => {
    event.stopPropagation();
    if (!allFilled || isCompleted) return;

    const checked = checkWordBankAssignments(gaps, options, assignments);
    const submission = evaluation.check(checked.evaluation);
    if (!submission) return;

    if (checked.allCorrect) {
      setActiveGapId(null);
      playSuccessSound();
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, submission.evidence);
      return;
    }

    const firstWrong = gaps.find(gap => checked.results[gap.id] === 'incorrect');
    setActiveGapId(firstWrong?.id ?? null);
    playErrorSound();
    triggerHaptic('error');
  };

  const renderGap = (gapId) => {
    const gap = gaps.find(item => item.id === gapId);
    if (!gap) return null;
    const selectedOption = optionById.get(assignments[gapId]);
    const part = evaluation.part(gapId);
    const result = part?.status;
    const isActive = activeGapId === gapId && !evaluation.isLocked(gapId);
    const classNames = [
      'word-bank-gap',
      isActive ? 'is-active' : '',
      result === 'correct' ? 'is-correct' : '',
      result === 'incorrect' ? 'is-incorrect' : ''
    ].filter(Boolean).join(' ');

    return (
      <span key={`gap-${gapId}`} className="exercise-part-feedback">
        <button
          type="button"
          className={classNames}
          onClick={(event) => handleGapClick(gapId, event)}
          disabled={evaluation.isLocked(gapId)}
          aria-invalid={result === 'incorrect'}
          aria-describedby={part?.hint ? `word-bank-hint-${gapId}` : undefined}
          style={{ fontSize: cardStyle?.fontSize || 'inherit' }}
          aria-label={selectedOption
            ? `${gapId}: ${selectedOption.value}`
            : `${gapId}: ${tr('Пустой пропуск')}`}
        >
          <span className="word-bank-gap-number">{gapId}</span>
          <span>{selectedOption?.value || '________'}</span>
        </button>
        {part?.hint && <span id={`word-bank-hint-${gapId}`} className="exercise-part-hint" role="status">{tr(part.hint)}</span>}
      </span>
    );
  };

  const renderText = () => {
    const parts = [];
    const marker = /___WORD_BANK_GAP_([a-zA-Z0-9_-]+)___/g;
    let cursor = 0;
    let match;

    while ((match = marker.exec(maskedText)) !== null) {
      if (match.index > cursor) {
        parts.push(<React.Fragment key={`text-${cursor}`}>{maskedText.slice(cursor, match.index)}</React.Fragment>);
      }
      parts.push(renderGap(match[1]));
      cursor = marker.lastIndex;
    }
    if (cursor < maskedText.length) {
      parts.push(<React.Fragment key={`text-${cursor}`}>{maskedText.slice(cursor)}</React.Fragment>);
    }
    return parts;
  };

  const checkButton = (
    <button
      type="button"
      className="btn btn-primary word-bank-check"
      disabled={!allFilled || isCompleted}
      onClick={handleCheck}
    >
      {isCompleted ? tr('Выполнено') : tr('Проверить')}
    </button>
  );

  return (
    <div className={`interactive-mode-container word-bank-exercise${footerActionTarget ? ' has-footer-action' : ''}`} onClick={event => event.stopPropagation()}>
      <div className="word-bank-text-area" style={cardStyle}>
        {renderText()}
      </div>

      <div className="word-bank-footer">
        <div className="word-bank-options" aria-label={tr('Банк слов')}>
          {options.map(option => {
            const isUsed = usedOptionIds.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className="word-bank-option"
                style={{ fontSize: optionFontSize }}
                disabled={isUsed || isCompleted}
                onClick={(event) => handleOptionClick(option.id, event)}
              >
                {option.value}
              </button>
            );
          })}
        </div>
      </div>

      {footerActionTarget ? createPortal(checkButton, footerActionTarget) : (
        <div className="word-bank-inline-actions">
          {checkButton}
        </div>
      )}
    </div>
  );
});



