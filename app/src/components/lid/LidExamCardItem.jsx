import React from 'react';
import { motion } from 'framer-motion';
import { Award, ArrowRight, Sparkles, Clock, Layers, ShieldCheck, CheckCircle } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { useLidStore } from '../../store/useLidStore';

export const LidExamCardItem = () => {
  const { setView } = useUiStore();
  const { openLandModal, selectedLandCode, resetToMenu } = useLidStore();

  const handleOpenExamSimulator = (e) => {
    e.stopPropagation();
    resetToMenu();
    setView('lid_exam');
    if (!selectedLandCode) {
      openLandModal(false);
    }
  };

  return (
    <motion.div
      className="deck-card glass lid-exam-hero-card"
      onClick={handleOpenExamSimulator}
      whileHover={{ scale: 1.015, y: -2 }}
      whileTap={{ scale: 0.985 }}
    >
      {/* Top German Flag Accent Bar */}
      <div className="lid-hero-card-accent-bar" />

      <div className="lid-hero-card-inner">
        {/* Top Header Row */}
        <div className="lid-hero-header-row">
          <div className="lid-hero-badge-left">
            <span className="lid-hero-flag-emoji">🇩🇪</span>
            <span className="lid-hero-badge-text">BAMF • LiD</span>
          </div>

          <div className="lid-hero-badge-right">
            <Sparkles size={13} className="lid-sparkle-icon" />
            <span>Официальный симулятор</span>
          </div>
        </div>

        {/* Title & Subtitle */}
        <div className="lid-hero-title-group">
          <h3 className="lid-hero-title">
            <span>Симуляция экзамена</span>
            <ShieldCheck size={20} className="lid-shield-icon" />
          </h3>
          <p className="lid-hero-subtitle">
            Leben in Deutschland • Einbürgerungstest
          </p>
        </div>

        {/* 3 Stats Chips */}
        <div className="lid-hero-stats-row">
          <div className="lid-hero-stat-chip">
            <Layers size={13} className="chip-icon questions" />
            <span><strong>33</strong> вопроса</span>
          </div>

          <div className="lid-hero-stat-chip">
            <Clock size={13} className="chip-icon timer" />
            <span><strong>60</strong> минут</span>
          </div>

          <div className="lid-hero-stat-chip">
            <Award size={13} className="chip-icon pass" />
            <span>Порог <strong>17 / 33</strong></span>
          </div>
        </div>

        {/* Bottom CTA Bar */}
        <div className="lid-hero-footer-row">
          <div className="lid-hero-footer-info">
            <span className="lid-hero-mode-pill">📝 Реальный экзамен & 🎓 Тренировка</span>
          </div>

          <button
            type="button"
            className="lid-hero-start-btn"
            onClick={handleOpenExamSimulator}
          >
            <span>Начать</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};
