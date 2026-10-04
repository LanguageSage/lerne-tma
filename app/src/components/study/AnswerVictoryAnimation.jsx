import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import './AnswerVictoryAnimation.css';

export const AnswerVictoryAnimation = React.memo(({ compact = false, style = {} }) => {
  const prefersReducedMotion = useReducedMotion();

  const sparkles = [
    { id: 1, x: -16, y: -16, char: '✨', size: 10, color: '#fbbf24', delay: 0.02, scale: 1.1, rotate: -25 },
    { id: 2, x: 16, y: -16, char: '⭐', size: 9, color: '#4ade80', delay: 0.05, scale: 1.0, rotate: 30 },
    { id: 3, x: -20, y: 3, char: '•', size: 14, color: '#38bdf8', delay: 0.08, scale: 1.2, rotate: 0 },
    { id: 4, x: 20, y: 3, char: '•', size: 14, color: '#f472b6', delay: 0.06, scale: 1.2, rotate: 0 },
    { id: 5, x: 0, y: -22, char: '✨', size: 12, color: '#fbbf24', delay: 0.04, scale: 1.3, rotate: 15 }
  ];

  return (
    <div
      className={`answer-victory-wrapper ${compact ? 'is-compact' : ''}`}
      style={style}
      aria-hidden="true"
    >
      {/* Celebratory micro-burst particles */}
      {!prefersReducedMotion && (
        <div className="victory-sparkles-container">
          {sparkles.map((s) => (
            <motion.span
              key={s.id}
              className="victory-sparkle-item"
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.2 }}
              animate={{
                opacity: [0, 1, 1, 0],
                x: s.x,
                y: s.y,
                scale: [0.2, s.scale, s.scale * 0.8, 0],
                rotate: s.rotate
              }}
              transition={{ duration: 0.75, ease: 'easeOut', delay: s.delay }}
              style={{
                fontSize: `${s.size}px`,
                color: s.color
              }}
            >
              {s.char}
            </motion.span>
          ))}
        </div>
      )}

      {/* Victory Badge with down pointer */}
      <motion.div
        className="victory-badge"
        initial={prefersReducedMotion ? { opacity: 0 } : { scale: 0, y: 8, opacity: 0 }}
        animate={prefersReducedMotion ? { opacity: 1 } : { scale: [0, 1.22, 0.96, 1], y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 350, duration: 0.45 }}
      >
        <Check size={compact ? 11 : 13} strokeWidth={3.5} className="victory-check-icon" />
        <span className="victory-sparkle-icon">✨</span>
        <div className="victory-badge-arrow" />
      </motion.div>
    </div>
  );
});

AnswerVictoryAnimation.displayName = 'AnswerVictoryAnimation';
