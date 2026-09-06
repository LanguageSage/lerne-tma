import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, BookOpen, PlayCircle, Layers, Brain, List, Sparkles, Settings } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore';
import { getHelpSection } from '../../constants/helpContent';
import './HelpDrawer.css';

const ICON_MAP = {
  Layers: Layers,
  Brain: Brain,
  List: List,
  Sparkles: Sparkles,
  Settings: Settings
};

export const HelpDrawer = ({ onStartTutorial }) => {
  const { isHelpOpen, helpTopic, closeHelp, openFullGuide } = useUiStore();

  if (!isHelpOpen) return null;

  const section = getHelpSection(helpTopic);
  const IconComponent = (section?.icon && ICON_MAP[section.icon]) || BookOpen;

  const handleOpenFullGuide = () => {
    openFullGuide(section?.id || 'decks');
  };

  const handleStartTour = () => {
    closeHelp();
    if (onStartTutorial) {
      onStartTutorial(helpTopic);
    }
  };

  return (
    <AnimatePresence>
      <motion.div 
        className="help-drawer-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={closeHelp}
      >
        <motion.div 
          className="help-drawer-content"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 26, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="help-drawer-handle-bar" />

          <div className="help-drawer-header">
            <div className="help-drawer-title-area">
              <div className="help-drawer-icon-wrap">
                <IconComponent size={20} />
              </div>
              <h3 className="help-drawer-title">{section?.title || 'Справка'}</h3>
            </div>
            <button 
              className="help-drawer-close-btn" 
              onClick={closeHelp}
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
          </div>

          {section?.shortDescription && (
            <p className="help-drawer-subtitle">{section.shortDescription}</p>
          )}

          <div className="help-drawer-body">
            {section?.quickTips?.map((tip, idx) => (
              <div key={idx} className="help-drawer-tip-card">
                <div className="help-drawer-tip-title">
                  <span>💡</span>
                  <span>{tip.title}</span>
                </div>
                <p className="help-drawer-tip-text">{tip.text}</p>
              </div>
            ))}
          </div>

          <div className="help-drawer-actions">
            <button className="help-drawer-btn-primary" onClick={handleOpenFullGuide}>
              <BookOpen size={18} />
              <span>Открыть полное руководство</span>
            </button>

            {onStartTutorial && (
              <button className="help-drawer-btn-secondary" onClick={handleStartTour}>
                <PlayCircle size={18} />
                <span>Показать интерактивный тур</span>
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
