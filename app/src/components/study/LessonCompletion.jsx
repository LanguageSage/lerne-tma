import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Trophy, X, ArrowLeft } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ResultsPlaceholder } from './completion/ResultsPlaceholder';
import { MistakesPlaceholder } from './completion/MistakesPlaceholder';
import { ProgressPlaceholder } from './completion/ProgressPlaceholder';
import './LessonCompletion.css';

const CONFETTI_COLORS = ['#fbbf24', '#38bdf8', '#4ade80', '#a855f7', '#f43f5e'];

export const LessonCompletion = ({ deck, stats, onGoToDeck, onClose }) => {
  useInterfaceLocale();

  const showCompletionCelebration = useSettingsStore(state => state.showCompletionCelebration);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  }, []);

  const shouldAnimate = showCompletionCelebration && !prefersReducedMotion;

  // Generate lightweight static confetti particle coordinates once
  const confettiParticles = useMemo(() => {
    if (!shouldAnimate) return [];
    return Array.from({ length: 24 }).map((_, i) => ({
      id: i,
      left: `${(i * 4.2 + (i % 3) * 5) % 96 + 2}%`,
      top: `${(i % 5) * 8 + 4}%`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: `${(i % 6) * 0.12}s`,
      duration: `${2.0 + (i % 4) * 0.25}s`,
      size: `${6 + (i % 3) * 3}px`
    }));
  }, [shouldAnimate]);

  return (
    <div className="lesson-completion-overlay">
      {/* Non-blocking Celebration Confetti */}
      {shouldAnimate && (
        <div className="celebration-confetti-container" aria-hidden="true">
          {confettiParticles.map(p => (
            <span
              key={p.id}
              className="confetti-particle"
              style={{
                left: p.left,
                top: p.top,
                backgroundColor: p.color,
                animationDelay: p.delay,
                animationDuration: p.duration,
                width: p.size,
                height: p.size
              }}
            />
          ))}
        </div>
      )}

      <motion.div
        initial={shouldAnimate ? { opacity: 0, scale: 0.92, y: 20 } : { opacity: 1, scale: 1, y: 0 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="lesson-completion-card glass"
      >
        {/* Instant Skip / Close Button */}
        <button
          type="button"
          className="lesson-completion-close-btn"
          onClick={onClose}
          aria-label={tr("Закрыть")}
          title={tr("Закрыть")}
        >
          <X size={20} />
        </button>

        {/* Trophy with celebration glow */}
        <div className="lesson-completion-trophy-wrapper">
          {shouldAnimate && <div className="lesson-completion-trophy-glow" />}
          <motion.div
            initial={shouldAnimate ? { scale: 0.7, rotate: -8 } : false}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
          >
            <Trophy className="lesson-completion-trophy-icon" />
          </motion.div>
        </div>

        {/* Celebratory Headings */}
        <div className="lesson-completion-header">
          <h1 className="lesson-completion-title">
            {tr("Занятие завершено!")}
          </h1>
          <p className="lesson-completion-subtitle">
            {tr("Ты сделал ещё один шаг в изучении языка")}
          </p>
          {deck?.name && (
            <span className="lesson-completion-deck-pill">
              {deck.name}
            </span>
          )}
        </div>

        {/* Results section */}
        <ResultsPlaceholder
          exercises={stats?.exercises ?? '—'}
          correct={stats?.correct ?? '—'}
          mistakes={stats?.mistakes ?? '—'}
          accuracy={stats?.accuracy ?? '—'}
          duration={stats?.duration ?? '—'}
        />

        {/* Error breakdown placeholder (isolated, hidden at this stage) */}
        <MistakesPlaceholder isVisible={false} />

        {/* Progress breakdown placeholder (isolated, hidden at this stage) */}
        <ProgressPlaceholder isVisible={false} />

        {/* Action Button: Safe return to deck */}
        <div className="lesson-completion-actions">
          <button
            type="button"
            className="lesson-completion-btn-primary"
            onClick={onGoToDeck}
          >
            <ArrowLeft size={20} />
            <span>{tr("Вернуться к колоде")}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};
