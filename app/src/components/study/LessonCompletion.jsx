import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Trophy, X, ArrowLeft, Sparkles } from 'lucide-react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { useSettingsStore } from '../../store/useSettingsStore';
import { ResultsPlaceholder } from './completion/ResultsPlaceholder';
import { MistakesPlaceholder } from './completion/MistakesPlaceholder';
import { ProgressPlaceholder } from './completion/ProgressPlaceholder';
import './LessonCompletion.css';

const CONFETTI_COLORS = ['#fbbf24', '#38bdf8', '#4ade80', '#a855f7', '#f43f5e', '#f59e0b', '#22d3ee'];

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

  // Emotionally personalized messaging based on accuracy & effort
  const celebrationData = useMemo(() => {
    const acc = typeof stats?.accuracy === 'string'
      ? parseInt(stats.accuracy, 10)
      : (typeof stats?.accuracy === 'number' ? stats.accuracy : null);

    if (acc !== null && !isNaN(acc)) {
      if (acc >= 90) {
        return {
          title: tr("Великолепно! 🎉"),
          subtitle: tr("Ты блестяще усвоил материал занятия!"),
          badge: tr("🏆 Превосходный результат"),
          badgeClass: "badge-gold"
        };
      }
      if (acc >= 75) {
        return {
          title: tr("Отличная работа! 🌟"),
          subtitle: tr("Уверенный шаг вперёд, так держать!"),
          badge: tr("⚡️ Твёрдые знания"),
          badgeClass: "badge-blue"
        };
      }
      return {
        title: tr("Занятие пройдено! 💪"),
        subtitle: tr("Ты проявил упорство — практика ведёт к мастерству!"),
        badge: tr("🌱 Опыт получен"),
        badgeClass: "badge-green"
      };
    }

    return {
      title: tr("Занятие завершено! 🎉"),
      subtitle: tr("Ты сделал ещё один уверенный шаг в изучении языка!"),
      badge: tr("✨ Занятие усвоено"),
      badgeClass: "badge-gold"
    };
  }, [stats?.accuracy]);

  // Generate lightweight colorful celebration confetti particles
  const confettiParticles = useMemo(() => {
    if (!shouldAnimate) return [];
    return Array.from({ length: 32 }).map((_, i) => ({
      id: i,
      left: `${(i * 3.1 + (i % 5) * 6) % 96 + 2}%`,
      top: `${(i % 6) * 6 + 2}%`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: `${(i % 8) * 0.1}s`,
      duration: `${2.2 + (i % 4) * 0.3}s`,
      size: `${6 + (i % 3) * 4}px`,
      isRound: i % 2 === 0
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
                height: p.isRound ? p.size : `${parseInt(p.size, 10) * 1.5}px`,
                borderRadius: p.isRound ? '50%' : '3px'
              }}
            />
          ))}
        </div>
      )}

      <motion.div
        initial={shouldAnimate ? { opacity: 0, scale: 0.9, y: 24 } : { opacity: 1, scale: 1, y: 0 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
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

        {/* Trophy with celebration aura and sparkles */}
        <div className="lesson-completion-trophy-wrapper">
          {shouldAnimate && <div className="lesson-completion-trophy-glow" />}
          {shouldAnimate && <div className="lesson-completion-trophy-ring" />}

          {shouldAnimate && (
            <motion.div
              className="lesson-completion-sparkle sparkle-left"
              animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.25, 0.95, 1] }}
              transition={{ repeat: Infinity, duration: 2.6, ease: "easeInOut" }}
            >
              <Sparkles size={22} color="#fbbf24" />
            </motion.div>
          )}

          <motion.div
            initial={shouldAnimate ? { scale: 0.5, rotate: -12 } : false}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', damping: 10, stiffness: 180, delay: 0.1 }}
          >
            <Trophy className="lesson-completion-trophy-icon" />
          </motion.div>

          {shouldAnimate && (
            <motion.div
              className="lesson-completion-sparkle sparkle-right"
              animate={{ rotate: [0, -15, 15, 0], scale: [1, 1.2, 0.9, 1] }}
              transition={{ repeat: Infinity, duration: 2.8, ease: "easeInOut", delay: 0.35 }}
            >
              <Sparkles size={20} color="#f59e0b" />
            </motion.div>
          )}
        </div>

        {/* Celebratory Headings & Emotional Badge */}
        <div className="lesson-completion-header">
          <div className={`lesson-completion-emotional-badge ${celebrationData.badgeClass}`}>
            <span>{celebrationData.badge}</span>
          </div>

          <h1 className="lesson-completion-title">
            {celebrationData.title}
          </h1>
          <p className="lesson-completion-subtitle">
            {celebrationData.subtitle}
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
