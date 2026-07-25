import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Globe, Sparkles } from 'lucide-react';
import { useLanguageStore, SUPPORTED_LANGUAGES } from '../store/useLanguageStore';
import { renderFlag } from './deckgrid/FlagIcons';
import './LanguageSelectionModal.css';

export const LanguageSelectionModal = () => {
  const { isLanguageModalOpen, setLanguageModalOpen, activeLanguage, setLanguage } = useLanguageStore();
  const [selectedCode, setSelectedCode] = useState(activeLanguage);

  if (!isLanguageModalOpen) return null;

  const handleConfirm = () => {
    setLanguage(selectedCode);
    setLanguageModalOpen(false);
  };

  return (
    <AnimatePresence>
      <div className="language-modal-overlay">
        <motion.div 
          className="language-modal-content glass-modal"
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          <div className="language-modal-header">
            <div className="language-modal-badge">
              <Globe size={18} color="#38bdf8" />
              <span>Выбор языка</span>
            </div>
            <h2>Какой язык вы хотите изучать?</h2>
            <p>Выберите основной язык для обучения. Вы сможете переключаться между языками на главном экране в любой момент.</p>
          </div>

          <div className="language-options-grid">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isSelected = selectedCode === lang.code;
              return (
                <motion.div
                  key={lang.code}
                  className={`language-card-item ${isSelected ? 'selected' : ''}`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedCode(lang.code)}
                >
                  <div className="language-card-flag">
                    {renderFlag(lang.code, 36)}
                  </div>

                  <div className="language-card-info">
                    <div className="language-card-title">
                      <span className="lang-name">{lang.label}</span>
                      <span className="lang-code">({lang.name})</span>
                    </div>
                    <p className="lang-desc">{lang.desc}</p>
                  </div>

                  <div className={`language-radio ${isSelected ? 'active' : ''}`}>
                    {isSelected && <Check size={16} color="#ffffff" />}
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="language-modal-footer">
            <button className="btn btn-primary btn-large btn-glow" onClick={handleConfirm}>
              <Sparkles size={18} />
              <span>Начать обучение ({SUPPORTED_LANGUAGES.find(l => l.code === selectedCode)?.label})</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
