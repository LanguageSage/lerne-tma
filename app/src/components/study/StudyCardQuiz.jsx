import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, Check } from 'lucide-react';
import { triggerHaptic } from '../../utils/platform';
import { getDesignStylesFromV2, getHarmonizedOptionStyles } from '../../utils/cardStyles';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';
import { shuffleFY } from '../../utils/shuffle.js';
import { evaluateQuizOption, quizPartId } from '../../utils/quizEvaluation.js';

export const StudyCardQuiz = ({
  card,
  quizData,
  onTrainerAnswer,
  renderAudioPlayer,
  designConfig,
  savedState,
  onSaveState
}) => {
  useInterfaceLocale();
  const [selectedOptionId, setSelectedOptionId] = useState(savedState?.selectedOptionId ?? null);
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const isChecked = evaluation.state.completed;
  const [optionOrder] = useState(() => savedState?.optionOrder || shuffleFY(quizData.options.map(option => option.id)));
  const options = useMemo(() => optionOrder.map(id => quizData.options.find(option => option.id === id)).filter(Boolean), [optionOrder, quizData.options]);

  useEffect(() => {
    onSaveState?.({ selectedOptionId, optionOrder, evaluationState: evaluation.state });
  }, [selectedOptionId, optionOrder, evaluation.state, onSaveState]);

  const handleSelectOption = (optionId, e) => {
    e.stopPropagation();
    if (isChecked || evaluation.state.incorrectParts.includes(quizPartId(optionId))) return;
    setSelectedOptionId(optionId);
  };

  const handleVerifyAnswer = (e) => {
    e.stopPropagation();
    if (selectedOptionId === null || isChecked) return;

    const result = evaluateQuizOption(options, selectedOptionId);
    if (!result) return;
    const submission = evaluation.check(result);
    if (!submission) return;
    if (submission.evidence) {
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, submission.evidence);
    } else {
      triggerHaptic('error');
      setSelectedOptionId(null);
    }
  };

  return <QuizContent
    question={quizData.question}
    options={options}
    designConfig={designConfig}
    renderAudioPlayer={renderAudioPlayer}
    selection={{
      selectedOptionId, isChecked,
      isWrong: id => evaluation.state.incorrectParts.includes(quizPartId(id)),
      isConfirmed: id => evaluation.part(quizPartId(id))?.status === 'correct',
      onSelect: handleSelectOption,
      onVerify: handleVerifyAnswer,
    }}
  />;
};

function formatPunctuation(text) {
  return (text || '').replace(/\s+([?!.,;:])/g, '$1').trim();
}

export function QuizContent({
  question, options, designConfig, renderAudioPlayer, selection,
  renderOptionText, renderOptionActions, footer,
}) {
  const v2Text = useMemo(() => getDesignStylesFromV2(designConfig).frontText, [designConfig]);
  const harmonizedOptions = useMemo(() => getHarmonizedOptionStyles(designConfig?.exercises?.baseColor), [designConfig?.exercises?.baseColor]);
  const { selectedOptionId = null, isChecked = false } = selection || {};
  const OptionRow = selection ? 'button' : 'div';

  return (
    <div className="quiz-container" style={{ width: '100%', padding: '4px 0' }}>
      {/* Question Header */}
      {question && (
        <div className="quiz-question-wrapper" style={{ width: '100%', marginBottom: renderAudioPlayer ? '14px' : '20px' }}>
          <div className="quiz-question" style={{
            ...v2Text,
            letterSpacing: '-0.01em',
            marginBottom: renderAudioPlayer ? '12px' : '0',
            width: '100%',
            whiteSpace: 'pre-wrap'
          }}>
            {question}
          </div>
          {renderAudioPlayer && (
            <div style={{ width: '100%', marginTop: '12px' }}>
              {renderAudioPlayer()}
            </div>
          )}
        </div>
      )}

      {!question && renderAudioPlayer && (
        <div style={{ width: '100%', marginBottom: '16px' }}>
          {renderAudioPlayer()}
        </div>
      )}

      {/* Options List */}
      <div className="quiz-options-list" style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        width: '100%',
        marginBottom: footer ? '4px' : '22px'
      }}>
        {options.map((option, index) => {
          const isSelected = selectedOptionId === option.id;
          const isWrong = selection?.isWrong(option.id);
          const isConfirmed = selection?.isConfirmed(option.id);
          const disabled = isChecked || isWrong;
          const highlighted = isSelected || isConfirmed || isWrong;
          const state = isConfirmed ? 'correct' : isWrong ? 'wrong' : isSelected ? 'selected' : disabled ? 'disabled' : 'normal';
          const label = formatPunctuation(option.text);

          // Option background & border calculation
          let bg = `var(--design-choice-normal-bg, ${harmonizedOptions.buttonBg})`;
          let borderColor = `var(--design-choice-normal-border, ${harmonizedOptions.buttonBorder})`;
          let textColor = `var(--design-choice-normal-color, ${harmonizedOptions.textColor})`;

          if (isConfirmed) {
            bg = 'var(--design-choice-correct-bg, var(--design-correct-bg, rgba(34, 197, 94, 0.22)))';
            borderColor = 'var(--design-choice-correct-border, var(--design-correct-border, #4ade80))';
            textColor = 'var(--design-choice-correct-color, var(--design-correct-color, #4ade80))';
          } else if (isWrong) {
            bg = 'var(--design-choice-wrong-bg, var(--design-wrong-bg, rgba(239, 68, 68, 0.22)))';
            borderColor = 'var(--design-choice-wrong-border, var(--design-wrong-border, #f87171))';
            textColor = 'var(--design-choice-wrong-color, var(--design-wrong-color, #f87171))';
          } else if (isSelected) {
            bg = 'var(--design-choice-selected-bg, var(--design-selected-bg, rgba(99, 102, 241, 0.25)))';
            borderColor = 'var(--design-choice-selected-border, var(--design-selected-border, #818cf8))';
            textColor = 'var(--design-choice-selected-color, var(--design-selected-color, #ffffff))';
          } else if (disabled) {
            bg = 'var(--design-choice-disabled-bg, rgba(255, 255, 255, 0.03))';
            textColor = 'var(--design-choice-disabled-color, #475569)';
            borderColor = 'var(--design-choice-disabled-border, rgba(255, 255, 255, 0.06))';
          }

          return (
            <div key={option.id} className="quiz-option-feedback">
              <OptionRow
                className={highlighted ? `quiz-option-item ${state}` : 'quiz-option-item'}
                {...(selection && {
                  type: 'button',
                  onClick: event => selection.onSelect(option.id, event),
                  disabled,
                  'aria-pressed': isSelected,
                  'aria-invalid': isWrong,
                  'aria-describedby': isWrong ? `quiz-hint-${option.id}` : undefined,
                })}
                data-design-state={state}
                data-part-id={quizPartId(option.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 16px',
                  borderRadius: '14px',
                  border: `1.5px solid ${borderColor}`,
                  background: bg,
                  color: textColor,
                  textAlign: 'left',
                  cursor: !selection || disabled ? 'default' : 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  width: '100%',
                  boxShadow: 'none',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {/* Option Letter Badge (A, B, C, D) */}
                <span style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: isConfirmed
                    ? 'var(--design-choice-correct-border, var(--design-correct-border, #22c55e))'
                    : (isWrong
                        ? 'var(--design-choice-wrong-border, var(--design-wrong-border, #ef4444))'
                        : (isSelected ? 'var(--design-choice-selected-border, var(--design-selected-border, #6366f1))' : harmonizedOptions.badgeBg)),
                  border: highlighted ? 'none' : `1px solid ${harmonizedOptions.badgeBorder}`,
                  color: highlighted ? '#ffffff' : harmonizedOptions.badgeColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  flexShrink: 0,
                  boxShadow: isSelected && !isChecked ? '0 2px 8px rgba(99, 102, 241, 0.5)' : 'none'
                }}>
                  {isConfirmed ? (
                    <CheckCircle2 size={20} />
                  ) : (isWrong ? (
                    <XCircle size={20} />
                  ) : (
                    String.fromCharCode(65 + index)
                  ))}
                </span>

                {/* Option Text */}
                <span style={{
                  ...v2Text,
                  flex: 1,
                  minWidth: 0,
                  wordBreak: 'break-word',
                  fontSize: v2Text?.fontSize || '1.2rem',
                  lineHeight: v2Text?.lineHeight || 1.45,
                  fontWeight: v2Text?.fontWeight || (isSelected ? 600 : 400),
                  color: textColor,
                  letterSpacing: '0.01em',
                }}>
                  {renderOptionText ? renderOptionText(option, label) : label}
                </span>
                {renderOptionActions?.(option)}
              </OptionRow>
              {isWrong && <span id={`quiz-hint-${option.id}`} className="exercise-part-hint" role="status">{tr('Попробуй другой вариант.')}</span>}
            </div>
          );
        })}
      </div>

      {/* Verify / Check Button */}
      {selection && !isChecked && (
        <button
          type="button"
          className="btn-check-quiz"
          onClick={selection.onVerify}
          disabled={selectedOptionId === null}
          style={{
            width: '100%',
            padding: '14px 20px',
            borderRadius: '14px',
            background: selectedOptionId !== null
              ? 'var(--design-btn-primary-bg, linear-gradient(135deg, #6366f1 0%, #4f46e5 100%))'
              : 'var(--design-btn-disabled-bg, rgba(255, 255, 255, 0.07))',
            color: selectedOptionId !== null
              ? 'var(--design-btn-primary-color, #ffffff)'
              : 'var(--design-btn-disabled-color, rgba(255, 255, 255, 0.4))',
            border: selectedOptionId !== null
              ? '1px solid var(--design-btn-primary-border, rgba(255, 255, 255, 0.25))'
              : '1px solid var(--design-btn-secondary-bg, rgba(255, 255, 255, 0.12))',
            fontSize: '1.05rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: selectedOptionId !== null ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: selectedOptionId !== null
              ? '0 4px 18px rgba(99, 102, 241, 0.45)'
              : 'none'
          }}
        >
          <Check size={20} />{tr("Проверить")}{' '}</button>
      )}

      {/* Result Banner after Check */}
      {isChecked && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'var(--design-choice-correct-bg, rgba(34, 197, 94, 0.18))',
          border: '1.5px solid var(--design-choice-correct-border, #22c55e)',
          color: 'var(--design-choice-correct-color, #4ade80)',
          fontSize: '0.92rem',
          fontWeight: 600,
          textAlign: 'center',
          marginTop: '6px'
        }}>
          {tr("✅ Правильно!")}
        </div>
      )}
      {footer}
    </div>
  );
}
