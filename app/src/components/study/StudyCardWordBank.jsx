import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDesignStylesFromV2 } from '../../utils/cardStyles.js';
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
  renderAudioPlayer,
  onTrainerAnswer,
  designConfig,
  savedState,
  onSaveState,
  footerActionTarget
}) => {
  useInterfaceLocale();

  const { gaps, options } = wordBankData;
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

  const renderGap = (gap, style) => {
    const option = optionById.get(assignments[gap.id]);
    const part = evaluation.part(gap.id);
    const isActive = activeGapId === gap.id && !evaluation.isLocked(gap.id);
    const label = gap.index + 1;
    return (
      <WordBankGap style={style} status={part?.status} active={isActive} hint={part?.hint} gapId={gap.id}
        onClick={event => handleGapClick(gap.id, event)} disabled={evaluation.isLocked(gap.id)}
        aria-label={`${label}: ${option?.value || tr('Пустой пропуск')}`}>
        <span className="word-bank-gap-number">{label}</span>
        <span>{option?.value || '________'}</span>
      </WordBankGap>
    );
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
    <WordBankContent data={wordBankData} designConfig={designConfig} footerActionTarget={footerActionTarget}
      renderAudioPlayer={renderAudioPlayer} renderGap={renderGap}
      renderOption={(option, style) =>
        <WordBankOption style={style} disabled={usedOptionIds.has(option.id) || isCompleted}
          onClick={event => handleOptionClick(option.id, event)}>{option.value}</WordBankOption>}>
      {footerActionTarget ? createPortal(checkButton, footerActionTarget) : (
        <div className="word-bank-inline-actions">{checkButton}</div>
      )}
    </WordBankContent>
  );
});

export function WordBankContent({
  data, designConfig, renderAudioPlayer, footerActionTarget,
  renderGap, renderOption, renderText, sentenceAction, bankAction, children,
}) {
  const textStyle = useMemo(() => getDesignStylesFromV2(designConfig).frontText, [designConfig]);
  const optionStyle = {
    ...textStyle, color: undefined,
    fontSize: textStyle.fontSize ? `calc(${textStyle.fontSize} * 0.9)` : '0.9em',
  };

  return (
    <div className={`interactive-mode-container word-bank-exercise${footerActionTarget ? ' has-footer-action' : ''}`}
      onClick={event => event.stopPropagation()}>
      {renderAudioPlayer?.()}
      <div className="word-bank-text-area" style={textStyle}>
        {data.parts.map((part, index) => <React.Fragment key={part.type === 'text' ? `text-${index}` : part.id}>
          {part.type === 'text' ? renderText ? renderText(part, index) : part.text : renderGap(part, textStyle, index)}
        </React.Fragment>)}
      </div>
      {sentenceAction}
      <div className="word-bank-footer">
        {bankAction && <div className="word-bank-bank-label">{tr('Банк слов')}</div>}
        <div className="word-bank-options" aria-label={tr('Банк слов')}>
          {data.options.map((option, index) => <React.Fragment key={option.id}>
            {renderOption(option, optionStyle, index)}
          </React.Fragment>)}
          {bankAction}
        </div>
      </div>
      {children}
    </div>
  );
}

export function WordBankGap({ as: Element = 'button', active, status, style, hint, gapId, children, ...props }) {
  const className = [
    'word-bank-gap', active && 'is-active',
    status === 'correct' && 'is-correct', status === 'incorrect' && 'is-incorrect',
  ].filter(Boolean).join(' ');
  const hintId = hint ? `word-bank-hint-${gapId}` : undefined;
  return (
    <span className="exercise-part-feedback">
      <Element className={className} style={{ ...style, color: undefined }}
        {...(Element === 'button' && { type: 'button', 'aria-invalid': status === 'incorrect', 'aria-describedby': hintId })}
        {...props}>
        {children}
      </Element>
      {hint && <span id={hintId} className="exercise-part-hint" role="status">{tr(hint)}</span>}
    </span>
  );
}

export function WordBankOption({ as: Element = 'button', style, children, ...props }) {
  return <Element className="word-bank-option" style={style} {...(Element === 'button' && { type: 'button' })} {...props}>
    {children}
  </Element>;
}
