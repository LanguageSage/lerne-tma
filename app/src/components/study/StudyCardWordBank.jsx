import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useEffect, useMemo, useState } from 'react';
import { getCardStyle } from '../../utils/cardStyles.js';
import { playErrorSound, playSuccessSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';
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
  onSaveState
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
  const [results, setResults] = useState(savedState?.results || {});
  const [isFirstTry, setIsFirstTry] = useState(savedState?.isFirstTry ?? true);
  const [hasReportedWrong, setHasReportedWrong] = useState(savedState?.hasReportedWrong ?? false);
  const [isCompleted, setIsCompleted] = useState(savedState?.isCompleted ?? false);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const optionById = useMemo(() => new Map(options.map(option => [option.id, option])), [options]);
  const usedOptionIds = useMemo(() => getUsedWordBankOptionIds(assignments), [assignments]);
  const allFilled = gaps.length > 0 && gaps.every(gap => assignments[gap.id]);

  useEffect(() => {
    onSaveState?.({
      assignments,
      activeGapId,
      results,
      isFirstTry,
      hasReportedWrong,
      isCompleted
    });
  }, [assignments, activeGapId, results, isFirstTry, hasReportedWrong, isCompleted, onSaveState]);

  if (!card || !wordBankData) return null;

  const clearGapResult = (gapId) => {
    setResults(previous => {
      if (!previous[gapId]) return previous;
      const next = { ...previous };
      delete next[gapId];
      return next;
    });
  };

  const handleGapClick = (gapId, event) => {
    event.stopPropagation();
    if (isCompleted) return;
    triggerHaptic('selection');
    setActiveGapId(gapId);

    if (assignments[gapId]) {
      setAssignments(previous => removeWordBankOption(previous, gapId));
      clearGapResult(gapId);
    }
  };

  const handleOptionClick = (optionId, event) => {
    event.stopPropagation();
    if (isCompleted || usedOptionIds.has(optionId)) return;

    const targetGapId = activeGapId || getFirstEmptyWordBankGapId(gaps, assignments);
    if (!targetGapId) return;

    const updated = assignWordBankOption(assignments, targetGapId, optionId);
    if (updated === assignments) return;

    setAssignments(updated);
    clearGapResult(targetGapId);
    setActiveGapId(getNextEmptyWordBankGapId(gaps, updated, targetGapId));
    triggerHaptic('light');
  };

  const handleCheck = (event) => {
    event.stopPropagation();
    if (!allFilled || isCompleted) return;

    const checked = checkWordBankAssignments(gaps, options, assignments);
    setResults(checked.results);

    if (checked.allCorrect) {
      setIsCompleted(true);
      setActiveGapId(null);
      playSuccessSound();
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, isFirstTry);
      return;
    }

    const firstWrong = gaps.find(gap => checked.results[gap.id] === 'incorrect');
    setActiveGapId(firstWrong?.id ?? null);
    playErrorSound();
    triggerHaptic('error');
    if (!hasReportedWrong) {
      setHasReportedWrong(true);
      setIsFirstTry(false);
      onTrainerAnswer?.(card.id, false);
    }
  };

  const renderGap = (gapId) => {
    const gap = gaps.find(item => item.id === gapId);
    if (!gap) return null;
    const selectedOption = optionById.get(assignments[gapId]);
    const result = results[gapId];
    const isActive = activeGapId === gapId && !isCompleted;
    const classNames = [
      'word-bank-gap',
      isActive ? 'is-active' : '',
      result === 'correct' ? 'is-correct' : '',
      result === 'incorrect' ? 'is-incorrect' : ''
    ].filter(Boolean).join(' ');

    return (
      <button
        key={`gap-${gapId}`}
        type="button"
        className={classNames}
        onClick={(event) => handleGapClick(gapId, event)}
        disabled={isCompleted}
        aria-label={selectedOption
          ? `${gapId}: ${selectedOption.value}`
          : `${gapId}: ${tr('Пустой пропуск')}`}
      >
        <span className="word-bank-gap-number">{gapId}</span>
        <span>{selectedOption?.value || '________'}</span>
      </button>
    );
  };

  const renderText = () => {
    const parts = [];
    const marker = /___WORD_BANK_GAP_(\d+)___/g;
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

  return (
    <div className="interactive-mode-container word-bank-exercise" onClick={event => event.stopPropagation()}>
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
                disabled={isUsed || isCompleted}
                onClick={(event) => handleOptionClick(option.id, event)}
              >
                {option.value}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="btn btn-primary word-bank-check"
          disabled={!allFilled || isCompleted}
          onClick={handleCheck}
        >
          {isCompleted ? tr('Выполнено') : tr('Проверить')}
        </button>
      </div>
    </div>
  );
});
