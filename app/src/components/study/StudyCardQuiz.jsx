import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, Check } from 'lucide-react';
import { triggerHaptic } from '../../utils/platform';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles';
import { stripMarkdown } from '../../utils/text';

export const StudyCardQuiz = ({
  card,
  quizData,
  onTrainerAnswer,
  styles = {}
}) => {
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [isChecked, setIsChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles]);

  // Reset state on card change
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedOptionId(null);
      setIsChecked(false);
      setIsCorrect(null);
    });
  }, [card?.id, card?.front, card?.back]);

  if (!card || !quizData) return null;

  const { question, options } = quizData;
  const backText = stripMarkdown(card?.back || '').trim().toLowerCase();
  const displayQuestion = (question && question.trim().toLowerCase() === backText) ? null : question;

  const handleSelectOption = (optionId, e) => {
    e.stopPropagation();
    if (isChecked) return;
    setSelectedOptionId(optionId);
  };

  const handleVerifyAnswer = (e) => {
    e.stopPropagation();
    if (selectedOptionId === null || isChecked) return;

    const chosenOption = options.find(o => o.id === selectedOptionId);
    const correct = chosenOption ? chosenOption.isCorrect : false;

    setIsChecked(true);
    setIsCorrect(correct);

    if (correct) {
      triggerHaptic('success');
      if (onTrainerAnswer) {
        onTrainerAnswer(card.id, true);
      }
    } else {
      triggerHaptic('error');
      if (onTrainerAnswer) {
        onTrainerAnswer(card.id, false);
      }
    }
  };

  const getOptionLetter = (index) => {
    return String.fromCharCode(65 + index); // A, B, C, D...
  };

  return (
    <div className="quiz-container" style={{ width: '100%', padding: '4px 0' }}>
      {/* Question Header */}
      {displayQuestion && (
        <div className="quiz-question" style={{
          ...cardStyle,
          marginBottom: '16px',
          lineHeight: 1.4,
          width: '100%'
        }}>
          {displayQuestion}
        </div>
      )}

      {/* Options List */}
      <div className="quiz-options-list" style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: '100%',
        marginBottom: '18px'
      }}>
        {options.map((option, index) => {
          const isSelected = selectedOptionId === option.id;
          let optionClass = 'quiz-option-item';

          if (isChecked) {
            if (option.isCorrect) {
              optionClass += ' correct';
            } else if (isSelected && !option.isCorrect) {
              optionClass += ' wrong';
            }
          } else if (isSelected) {
            optionClass += ' selected';
          }

          return (
            <button
              key={option.id}
              type="button"
              className={optionClass}
              onClick={(e) => handleSelectOption(option.id, e)}
              disabled={isChecked}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                borderRadius: '12px',
                border: '1.5px solid rgba(255, 255, 255, 0.12)',
                background: isSelected && !isChecked 
                  ? 'rgba(99, 102, 241, 0.25)' 
                  : (isChecked && option.isCorrect 
                      ? 'rgba(34, 197, 94, 0.25)' 
                      : (isChecked && isSelected && !option.isCorrect 
                          ? 'rgba(239, 68, 68, 0.25)' 
                          : 'rgba(30, 41, 59, 0.6)')),
                borderColor: isSelected && !isChecked 
                  ? '#818cf8' 
                  : (isChecked && option.isCorrect 
                      ? '#4ade80' 
                      : (isChecked && isSelected && !option.isCorrect 
                          ? '#f87171' 
                          : 'rgba(255, 255, 255, 0.12)')),
                color: '#ffffff',
                fontSize: '0.98rem',
                fontWeight: isSelected ? 600 : 400,
                textAlign: 'left',
                cursor: isChecked ? 'default' : 'pointer',
                transition: 'all 0.2s ease',
                width: '100%',
                boxShadow: isSelected && !isChecked ? '0 0 12px rgba(99, 102, 241, 0.3)' : 'none'
              }}
            >
              <div style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: isChecked && option.isCorrect 
                  ? '#22c55e' 
                  : (isChecked && isSelected && !option.isCorrect 
                      ? '#ef4444' 
                      : (isSelected ? '#6366f1' : 'rgba(255, 255, 255, 0.15)')),
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.85rem',
                fontWeight: 700,
                flexShrink: 0
              }}>
                {isChecked && option.isCorrect ? (
                  <CheckCircle2 size={16} />
                ) : (isChecked && isSelected && !option.isCorrect ? (
                  <XCircle size={16} />
                ) : (
                  getOptionLetter(index)
                ))}
              </div>
              <span style={{
                flex: 1,
                wordBreak: 'break-word',
                fontFamily: contextStyle.fontFamily || undefined,
                color: isSelected || isChecked ? undefined : (contextStyle.color || undefined),
                textShadow: contextStyle.textShadow || undefined
              }}>
                {option.text}
              </span>
            </button>
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
            padding: '12px 16px',
            borderRadius: '12px',
            background: selectedOptionId !== null
              ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
              : 'rgba(255, 255, 255, 0.1)',
            color: selectedOptionId !== null ? '#ffffff' : 'rgba(255, 255, 255, 0.4)',
            border: 'none',
            fontSize: '1rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: selectedOptionId !== null ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
            boxShadow: selectedOptionId !== null ? '0 4px 14px rgba(99, 102, 241, 0.4)' : 'none'
          }}
        >
          <Check size={18} />
          Проверить
        </button>
      )}

      {/* Result Banner after Check */}
      {isChecked && (
        <div style={{
          padding: '10px 14px',
          borderRadius: '10px',
          background: isCorrect ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          border: `1px solid ${isCorrect ? '#22c55e' : '#ef4444'}`,
          color: isCorrect ? '#4ade80' : '#f87171',
          fontSize: '0.9rem',
          fontWeight: 600,
          textAlign: 'center',
          marginTop: '6px'
        }}>
          {isCorrect ? '✅ Правильно!' : '❌ Неправильно! Смотри разбор на обороте.'}
        </div>
      )}
    </div>
  );
};
