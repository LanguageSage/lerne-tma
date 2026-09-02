import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, ArrowRight, Sparkles, Clock, Layers } from 'lucide-react';
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
      className="deck-card-item glass lid-exam-deck-card"
      onClick={handleOpenExamSimulator}
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="lid-deck-card-glow" />
      
      <div className="deck-card-top">
        <div className="deck-flag-wrapper">
          <span className="lid-card-german-flag">🇩🇪</span>
        </div>
        <div className="deck-actions-wrapper">
          <span className="lid-official-tag">
            <Sparkles size={11} />
            <span>BAMF LiD</span>
          </span>
        </div>
      </div>

      <div className="deck-card-body">
        <h3 className="deck-title lid-exam-card-title">Симуляция экзамена</h3>
        <p className="deck-subtitle lid-exam-card-sub">Leben in Deutschland / Einbürgerungstest</p>
      </div>

      <div className="deck-card-bottom lid-exam-card-bottom">
        <div className="deck-stats-pills">
          <span className="stat-pill due" title="33 вопроса в билете">
            <Layers size={11} />
            <span>33 вопр.</span>
          </span>
          <span className="stat-pill new" title="Таймер 60 минут">
            <Clock size={11} />
            <span>60 мин</span>
          </span>
        </div>

        <div className="lid-deck-card-arrow">
          <ArrowRight size={18} />
        </div>
      </div>
    </motion.div>
  );
};
