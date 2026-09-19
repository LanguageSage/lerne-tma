import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PenLine, Eye, EyeOff, Check, X, Sparkles } from 'lucide-react';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles.js';
import { playSuccessSound, playErrorSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';

export const StudyCardFreeText = React.memo(({
  card,
  freeTextData,
  onTrainerAnswer,
  onNextCard,
  renderAudioPlayer,
  styles = {},
  isPureTrainerMode = false,
  savedState,
  onSaveState
}) => {
  useInterfaceLocale();

  const [userInput, setUserInput] = useState(savedState?.userInput || '');
  const [showExample, setShowExample] = useState(savedState?.showExample || false);
  const [isCompleted, setIsCompleted] = useState(savedState?.isCompleted || false);
  const [selfGrade, setSelfGrade] = useState(savedState?.selfGrade ?? null); // true | false | null

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles]);

  // Sync state to parent for flip preservation
  useEffect(() => {
    onSaveState?.({ userInput, showExample, isCompleted, selfGrade });
  }, [userInput, showExample, isCompleted, selfGrade, onSaveState]);

  // Reset state on card change when no saved state exists
  useEffect(() => {
    if (!savedState) {
      queueMicrotask(() => {
        setUserInput('');
        setShowExample(false);
        setIsCompleted(false);
        setSelfGrade(null);
      });
    }
  }, [card?.id, savedState]);

  if (!card || !freeTextData) return null;

  const exampleAnswer = freeTextData.exampleAnswer || (card.back || '').trim();
  const hasInput = userInput.trim().length > 0;

  const handleSelfGrade = (isCorrect) => {
    if (isCompleted || !hasInput) return;
    setIsCompleted(true);
    setSelfGrade(isCorrect);

    if (isCorrect) {
      playSuccessSound();
      triggerHaptic('success');
      onTrainerAnswer?.(card.id, true);
    } else {
      playErrorSound();
      triggerHaptic('error');
      onTrainerAnswer?.(card.id, false);
    }
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
      {/* Exercise Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        color: '#c084fc',
        fontSize: '0.86rem',
        fontWeight: 700,
        marginBottom: '10px'
      }}>
        <PenLine size={16} />
        <span>{tr("Свободный ответ / Письмо")}</span>
      </div>

      {/* Prompt / Instruction */}
      <div
        className="text-front"
        style={{
          ...cardStyle,
          fontSize: '1.12rem',
          lineHeight: 1.35,
          textAlign: 'center',
          marginBottom: '14px',
          whiteSpace: 'pre-wrap',
          width: '100%'
        }}
      >
        {freeTextData.prompt}
      </div>

      {renderAudioPlayer && (
        <div style={{ width: '100%', marginBottom: '14px' }}>
          {renderAudioPlayer()}
        </div>
      )}

      {/* Textarea for User Input */}
      <div style={{ width: '100%', maxWidth: '380px', marginBottom: '14px' }}>
        <textarea
          value={userInput}
          onChange={e => setUserInput(e.target.value)}
          placeholder={tr("Напишите ваш ответ здесь...")}
          disabled={isCompleted}
          rows={3}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: '14px',
            border: '1.5px solid rgba(168, 85, 247, 0.45)',
            background: 'rgba(255, 255, 255, 0.06)',
            color: '#f1f5f9',
            fontSize: '0.98rem',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            outline: 'none',
            resize: 'none',
            boxSizing: 'border-box',
            transition: 'border-color 0.2s ease',
            ...contextStyle
          }}
        />
      </div>

      {/* Example Answer Block (Collapsible) */}
      <AnimatePresence>
        {showExample && exampleAnswer && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              width: '100%',
              maxWidth: '380px',
              padding: '12px 14px',
              borderRadius: '14px',
              background: 'rgba(168, 85, 247, 0.14)',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              marginBottom: '14px',
              overflow: 'hidden'
            }}
          >
            <div style={{
              fontSize: '0.76rem',
              fontWeight: 700,
              color: '#c084fc',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: '4px'
            }}>
              <Sparkles size={12} />
              <span>{tr("Пример правильного ответа:")}</span>
            </div>
            <div style={{
              fontSize: '0.92rem',
              color: '#f8fafc',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              fontWeight: 600
            }}>
              {exampleAnswer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Footer & Workflow */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
        {!showExample ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!hasInput}
            onClick={() => {
              setShowExample(true);
              triggerHaptic('light');
            }}
            style={{
              width: '100%',
              maxWidth: '340px',
              padding: '12px 18px',
              borderRadius: '14px',
              fontWeight: 700,
              fontSize: '0.94rem',
              background: hasInput ? 'linear-gradient(135deg, #a855f7, #7c3aed)' : 'rgba(25, 20, 42, 0.85)',
              color: hasInput ? '#fff' : '#94a3b8',
              border: hasInput ? 'none' : '1px solid rgba(168, 85, 247, 0.3)',
              cursor: hasInput ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Eye size={16} />
            <span>{hasInput ? tr("Показать пример ответа") : tr("Введите ответ для продолжения")}</span>
          </button>
        ) : !isCompleted ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '340px', alignItems: 'center' }}>
            <div style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: 600 }}>
              {tr("Сверьте ваш ответ с образцом:")}
            </div>
            <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
              <button
                type="button"
                onClick={() => handleSelfGrade(true)}
                style={{
                  flex: 1,
                  padding: '11px 14px',
                  borderRadius: '14px',
                  background: 'rgba(34, 197, 94, 0.22)',
                  border: '1.5px solid #22c55e',
                  color: '#4ade80',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer'
                }}
              >
                <Check size={16} />
                <span>{tr("Ответ верный")}</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelfGrade(false)}
                style={{
                  flex: 1,
                  padding: '11px 14px',
                  borderRadius: '14px',
                  background: 'rgba(239, 68, 68, 0.22)',
                  border: '1.5px solid #ef4444',
                  color: '#f87171',
                  fontSize: '0.88rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  cursor: 'pointer'
                }}
              >
                <X size={16} />
                <span>{tr("Нужно повторить")}</span>
              </button>
            </div>
          </div>
        ) : isPureTrainerMode ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onNextCard}
            style={{
              width: '100%',
              maxWidth: '320px',
              padding: '12px 20px',
              borderRadius: '14px',
              fontWeight: 700,
              fontSize: '1rem',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            <span>{tr("Дальше →")}</span>
          </button>
        ) : (
          <div style={{ fontSize: '0.86rem', color: selfGrade ? '#4ade80' : '#f87171', fontWeight: 700 }}>
            {selfGrade ? tr("✓ Отмечено как верный ответ") : tr("✗ Отмечено для повторения")}
          </div>
        )}
      </div>
    </div>
  );
});
