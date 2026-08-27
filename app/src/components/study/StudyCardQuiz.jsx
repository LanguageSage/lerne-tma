import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, XCircle, Check, Eye } from 'lucide-react';
import { triggerHaptic } from '../../utils/platform';
import { getCardStyle } from '../../utils/cardStyles';
import { stripMarkdown } from '../../utils/text';

export const StudyCardQuiz = ({
  card,
  quizData,
  onFlip,
  setIsFlipped,
  onTrainerAnswer,
  renderAudioPlayer,
  styles = {}
}) => {
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [isChecked, setIsChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);

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
            lineHeight: 1.45,
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

          // Option background & border calculation
          let bg = 'rgba(15, 23, 42, 0.55)';
          let borderColor = 'rgba(255, 255, 255, 0.12)';
          let boxShadow = 'none';
          let textColor = '#f1f5f9';

          if (isChecked) {
            if (option.isCorrect) {
              bg = 'rgba(34, 197, 94, 0.22)';
              borderColor = '#4ade80';
              boxShadow = '0 0 16px rgba(34, 197, 94, 0.28)';
              textColor = '#86efac';
            } else if (isSelected && !option.isCorrect) {
              bg = 'rgba(239, 68, 68, 0.22)';
              borderColor = '#f87171';
              boxShadow = '0 0 16px rgba(239, 68, 68, 0.28)';
              textColor = '#fca5a5';
            } else {
              textColor = 'rgba(241, 245, 249, 0.6)';
            }
          } else if (isSelected) {
            bg = 'rgba(99, 102, 241, 0.25)';
            borderColor = '#818cf8';
            boxShadow = '0 0 16px rgba(99, 102, 241, 0.35)';
            textColor = '#ffffff';
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
                gap: '14px',
                padding: '14px 16px',
                borderRadius: '14px',
                border: `1.5px solid ${borderColor}`,
                background: bg,
                color: textColor,
                textAlign: 'left',
                cursor: isChecked ? 'default' : 'pointer',
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
                background: isChecked && option.isCorrect 
                  ? '#22c55e' 
                  : (isChecked && isSelected && !option.isCorrect 
                      ? '#ef4444' 
                      : (isSelected ? '#6366f1' : 'rgba(255, 255, 255, 0.1)')),
                border: isSelected || isChecked
                  ? 'none'
                  : '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.95rem',
                fontWeight: 700,
                flexShrink: 0,
                boxShadow: isSelected && !isChecked ? '0 2px 8px rgba(99, 102, 241, 0.5)' : 'none'
              }}>
                {isChecked && option.isCorrect ? (
                  <CheckCircle2 size={20} />
                ) : (isChecked && isSelected && !option.isCorrect ? (
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
          <Check size={20} />
          Проверить
        </button>
      )}

      {/* Result Banner after Check */}
      {isChecked && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: isCorrect ? 'rgba(34, 197, 94, 0.18)' : 'rgba(239, 68, 68, 0.18)',
          border: `1.5px solid ${isCorrect ? '#22c55e' : '#ef4444'}`,
          color: isCorrect ? '#4ade80' : '#fca5a5',
          fontSize: '0.92rem',
          fontWeight: 600,
          textAlign: 'center',
          marginTop: '6px'
        }}>
          {isCorrect ? '✅ Правильно!' : '❌ Неправильно! Смотри разбор на обороте.'}
        </div>
      )}

      {/* Reveal Answer Button */}
      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginTop: isChecked ? '12px' : '10px' }}>
        <button
          type="button"
          className="btn-interactive-reveal"
          onClick={(e) => {
            e.stopPropagation();
            const flipFn = onFlip || setIsFlipped;
            if (flipFn) flipFn(true);
          }}
        >
          <Eye size={18} />
          <span>Показать ответ</span>
        </button>
      </div>
    </div>
  );
};
