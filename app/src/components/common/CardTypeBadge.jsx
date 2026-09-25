import React from 'react';

/**
 * Inline badge displaying the card exercise type with emoji + label.
 * Covers all exercise types used in Lerne: quiz, trainer, match,
 * free_text, puzzle, word_bank, standard.
 *
 * Props:
 *   type  {string} – card_type value (e.g. 'quiz', 'trainer', …)
 *   size  {'sm'|'md'} – 'sm' for compact lists (default: 'sm')
 */

const TYPE_CONFIG = {
  quiz:      { emoji: '☑️', label: 'Quiz',      color: '#4ade80', bg: 'rgba(34,197,94,0.15)',    border: 'rgba(34,197,94,0.3)' },
  trainer:   { emoji: '🏋️', label: 'Trainer',   color: '#c084fc', bg: 'rgba(168,85,247,0.15)',   border: 'rgba(168,85,247,0.3)' },
  match:     { emoji: '🔗', label: 'Match',     color: '#38bdf8', bg: 'rgba(56,189,248,0.15)',   border: 'rgba(56,189,248,0.3)' },
  free_text: { emoji: '💬', label: 'Free text', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',   border: 'rgba(245,158,11,0.3)' },
  puzzle:    { emoji: '🧩', label: 'Puzzle',    color: '#ec4899', bg: 'rgba(236,72,153,0.15)',   border: 'rgba(236,72,153,0.3)' },
  word_bank: { emoji: '🏦', label: 'Word Bank', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)',  border: 'rgba(167,139,250,0.3)' },
  standard:  { emoji: '📖', label: 'Standard',  color: '#94a3b8', bg: 'rgba(255,255,255,0.08)',  border: 'rgba(255,255,255,0.15)' },
};

export const CardTypeBadge = ({ type, size = 'sm' }) => {
  const cfg = TYPE_CONFIG[type];
  if (!cfg) return null;

  const fontSize = size === 'sm' ? '0.68rem' : '0.78rem';

  return (
    <span
      style={{
        fontSize,
        fontWeight: 700,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 4,
        padding: '1px 4px',
        flexShrink: 0,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {cfg.emoji} {cfg.label}
    </span>
  );
};
