import { tr } from '../../i18n/locale.js';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale.js';
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PenLine, Eye, EyeOff, Check, Sparkles } from 'lucide-react';
import { getCardStyle, getContextStyle } from '../../utils/cardStyles.js';
import { playSuccessSound } from '../../utils/audioSynth.js';
import { triggerHaptic } from '../../utils/platform.js';

export const StudyCardFreeText = React.memo(({
  card,
  freeTextData,
  onFlip,
  onTrainerAnswer,
  onNextCard,
  renderAudioPlayer,
  styles = {},
  isPureTrainerMode = false
}) => {
  useInterfaceLocale();

  const [userInput, setUserInput] = useState('');
  const [showExample, setShowExample] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);

  const cardStyle = useMemo(() => getCardStyle(styles), [styles]);
  const contextStyle = useMemo(() => getContextStyle(styles), [styles]);

  // Reset state on card change
  useEffect(() => {
    queueMicrotask(() => {
      setUserInput('');
      setShowExample(false);
      setIsCompleted(false);
    });
  }, [card?.id]);

  if (!card || !freeTextData) return null;

  const exampleAnswer = freeTextData.exampleAnswer || (card.back || '').trim();

  const handleComplete = () => {
    if (isCompleted) return;
    setIsCompleted(true);
    playSuccessSound();
    triggerHaptic('success');
    onTrainerAnswer?.(card.id, true);

    if (!isPureTrainerMode && onFlip) {
      setTimeout(() => {
        onFlip(true);
      }, 700);
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
          lineHeight: 1.6,
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

      {/* Action Footer */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', width: '100%', maxWidth: '340px' }}>
          {exampleAnswer && (
            <button
              type="button"
              onClick={() => {
                setShowExample(prev => !prev);
                triggerHaptic('light');
              }}
              style={{
                flex: 1,
                padding: '11px 14px',
                borderRadius: '14px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.16)',
                color: '#f1f5f9',
                fontSize: '0.86rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              {showExample ? <EyeOff size={15} /> : <Eye size={15} />}
              <span>{showExample ? tr("Скрыть пример") : tr("Показать пример")}</span>
            </button>
          )}

          {!isCompleted ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleComplete}
              style={{
                flex: 1,
                padding: '11px 18px',
                borderRadius: '14px',
                fontWeight: 700,
                fontSize: '0.94rem',
                background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                color: '#fff',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <Check size={16} />
              <span>{tr("Готово")}</span>
            </button>
          ) : isPureTrainerMode ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onNextCard}
              style={{
                flex: 1,
                padding: '11px 18px',
                borderRadius: '14px',
                fontWeight: 700,
                fontSize: '0.94rem',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <span>{tr("Дальше →")}</span>
            </button>
          ) : null}
        </div>

        <button
          type="button"
          style={{
            cursor: 'pointer',
            background: 'rgba(20, 15, 38, 0.85)',
            backdropFilter: 'blur(14px)',
            padding: '9px 16px',
            borderRadius: '14px',
            border: '1.5px solid rgba(168, 85, 247, 0.5)',
            color: '#ffffff',
            fontSize: '0.88rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '4px'
          }}
          onClick={() => onFlip?.(true)}
        >
          <Eye size={15} style={{ color: '#c084fc' }} />
          <span>{tr("Показать ответ")}</span>
        </button>
      </div>
    </div>
  );
});
