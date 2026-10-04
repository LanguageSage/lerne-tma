import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, Check } from 'lucide-react';
import { triggerHaptic } from '../../utils/platform';
import { getCardStyle, getHarmonizedOptionStyles } from '../../utils/cardStyles';
import { stripMarkdown } from '../../utils/text';
import { useExerciseEvaluation } from '../../hooks/useExerciseEvaluation.js';
import { evaluateQuizOption, quizPartId } from '../../utils/quizEvaluation.js';

export const StudyCardQuiz = ({
  card,
  quizData,
  onTrainerAnswer,
  renderAudioPlayer,
  styles = {},
  savedState,
  onSaveState
}) => {
  useInterfaceLocale();
  const [selectedOptionId, setSelectedOptionId] = useState(savedState?.selectedOptionId ?? null);
  const evaluation = useExerciseEvaluation(savedState?.evaluationState);
  const isChecked = evaluation.state.completed;
  const [optionOrder] = useState(() => savedState?.optionOrder || quizData.options.map(option => option.id));
  const options = useMemo(() => optionOrder.map(id => quizData.options.find(option => option.id === id)).filter(Boolean), [optionOrder, quizData.options]);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const harmonizedOptions = useMemo(() => getHarmonizedOptionStyles(styles?.cardTextColor), [styles?.cardTextColor]);

  useEffect(() => {
    onSaveState?.({ selectedOptionId, optionOrder, evaluationState: evaluation.state });
  }, [selectedOptionId, optionOrder, evaluation.state, onSaveState]);

  if (!card || !quizData) return null;

  const { question } = quizData;
  const backText = stripMarkdown(card?.back || '').trim().toLowerCase();
  const displayQuestion = (question && question.trim().toLowerCase() === backText) ? null : question;

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

  const getOptionLetter = (index) => {
    return String.fromCharCode(65 + index); // A, B, C, D...
  };

  const formatPunctuation = (str) => {
    if (!str) return '';
    return str.replace(/\s+([?!.,;:])/g, '$1').trim();
  };

  const cleanDisplayQuestion = displayQuestion ? formatPunctuation(displayQuestion) : null;

  return (
    <div className="quiz-container" style={{ width: '100%', padding: '4px 0' }}>
      {/* Question Header */}
      {cleanDisplayQuestion && (
        <div className="quiz-question-wrapper" style={{ width: '100%', marginBottom: renderAudioPlayer ? '14px' : '20px' }}>
          <div className="quiz-question" style={{
            ...cardStyle,
            color: cardStyle.color || '#ffffff',
            fontSize: cardStyle.fontSize ? `${Math.max(parseFloat(cardStyle.fontSize), 1.4)}rem` : '1.45rem',
            fontWeight: cardStyle.fontWeight || 700,
            lineHeight: 1.35,
            letterSpacing: '-0.01em',
            textAlign: (styles?.cardTextAlign && styles.cardTextAlign !== 'center') ? styles.cardTextAlign : 'left',
            marginBottom: renderAudioPlayer ? '12px' : '0',
            width: '100%',
            whiteSpace: 'pre-wrap'
          }}>
            {cleanDisplayQuestion}
          </div>
          {renderAudioPlayer && (
            <div style={{ width: '100%', marginTop: '12px' }}>
              {renderAudioPlayer()}
            </div>
          )}
        </div>
      )}

      {!cleanDisplayQuestion && renderAudioPlayer && (
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
        marginBottom: '22px'
      }}>
        {options.map((option, index) => {
          const isSelected = selectedOptionId === option.id;
          const isWrong = evaluation.state.incorrectParts.includes(quizPartId(option.id));
          const isConfirmed = evaluation.part(quizPartId(option.id))?.status === 'correct';
          const disabled = isChecked || isWrong;
          let optionClass = 'quiz-option-item';

          if (isConfirmed) optionClass += ' correct';
          else if (isWrong) optionClass += ' wrong';
          else if (isSelected) optionClass += ' selected';

          // Option background & border calculation
          let bg = harmonizedOptions.buttonBg;
          let borderColor = harmonizedOptions.buttonBorder;
          const boxShadow = 'none';
          const textColor = harmonizedOptions.textColor;

          if (isConfirmed) {
            bg = 'rgba(34, 197, 94, 0.22)';
            borderColor = '#4ade80';
          } else if (isWrong) {
            bg = 'rgba(239, 68, 68, 0.22)';
            borderColor = '#f87171';
          } else if (isSelected) {
            bg = 'rgba(99, 102, 241, 0.25)';
            borderColor = '#818cf8';
          }

          return (
            <div key={option.id} className="quiz-option-feedback">
              <button
                type="button"
                className={optionClass}
                onClick={(e) => handleSelectOption(option.id, e)}
                disabled={disabled}
                aria-pressed={isSelected}
                aria-invalid={isWrong}
                aria-describedby={isWrong ? `quiz-hint-${option.id}` : undefined}
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
                  cursor: disabled ? 'default' : 'pointer',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  width: '100%',
                  boxShadow,
                  backdropFilter: 'blur(8px)',
                }}
              >
                {/* Option Letter Badge (A, B, C, D) */}
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: isConfirmed
                    ? '#22c55e'
                    : (isWrong
                        ? '#ef4444'
                        : (isSelected ? '#6366f1' : harmonizedOptions.badgeBg)),
                  border: isSelected || isConfirmed || isWrong
                    ? 'none'
                    : `1px solid ${harmonizedOptions.badgeBorder}`,
                  color: isSelected || isConfirmed || isWrong ? '#ffffff' : harmonizedOptions.badgeColor,
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
                    getOptionLetter(index)
                  ))}
                </div>

                {/* Option Text */}
                <span style={{
                  flex: 1,
                  wordBreak: 'break-word',
                  fontSize: '1.2rem',
                  lineHeight: 1.45,
                  fontWeight: isSelected ? 600 : 400,
                  color: textColor,
                  letterSpacing: '0.01em',
                }}>
                  {formatPunctuation(option.text)}
                </span>
              </button>
              {isWrong && <span id={`quiz-hint-${option.id}`} className="exercise-part-hint" role="status">{tr('Попробуй другой вариант.')}</span>}
            </div>
          );
        })}
      </div>

      {/* Verify / Check Button */}
      {!isChecked && (
        <button
          type="button"
          className="btn-check-quiz"
          onClick={handleVerifyAnswer}
          disabled={selectedOptionId === null}
          style={{
            width: '100%',
            padding: '14px 20px',
            borderRadius: '14px',
            background: selectedOptionId !== null
              ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
              : 'rgba(255, 255, 255, 0.07)',
            color: selectedOptionId !== null ? '#ffffff' : 'rgba(255, 255, 255, 0.4)',
            border: selectedOptionId !== null
              ? '1px solid rgba(255, 255, 255, 0.25)'
              : '1px solid rgba(255, 255, 255, 0.12)',
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
          background: 'rgba(34, 197, 94, 0.18)',
          border: '1.5px solid #22c55e',
          color: '#4ade80',
          fontSize: '0.92rem',
          fontWeight: 600,
          textAlign: 'center',
          marginTop: '6px'
        }}>
          {tr("✅ Правильно!")}
        </div>
      )}
    </div>
  );
};
