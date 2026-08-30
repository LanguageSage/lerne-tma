import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, ArrowRight, ArrowLeft, Sparkles, Check } from 'lucide-react';
import { useTranslation } from '../../i18n/i18nContext';
import { SUPPORTED_NATIVE_LANGUAGES } from '../../constants/languageConstants';
import { useLanguageStore, SUPPORTED_LANGUAGES } from '../../store/useLanguageStore';
import { renderFlag } from '../deckgrid/FlagIcons';
import '../LanguageSelectionModal.css';

export default function LanguageWelcomeModal({ isOpen, onComplete, onClose }) {
  const { nativeLanguage, changeNativeLanguage, t } = useTranslation();
  const { activeLanguage, setLanguage } = useLanguageStore();

  const [step, setStep] = useState(1);
  const [selectedNative, setSelectedNative] = useState(nativeLanguage || 'uk');
  const [selectedTarget, setSelectedTarget] = useState(activeLanguage || 'de');

  if (!isOpen) return null;

  const handleSelectNative = (code) => {
    setSelectedNative(code);
    changeNativeLanguage(code, false);
  };

  const handleSelectTarget = (code) => {
    setSelectedTarget(code);
  };

  const handleFinish = () => {
    changeNativeLanguage(selectedNative, true);
    setLanguage(selectedTarget);
    if (onComplete) {
      onComplete(selectedNative, selectedTarget);
    } else if (onClose) {
      onClose();
    }
  };

  return (
    <div className="language-modal-overlay">
      <motion.div
        className="language-modal-content glass-modal"
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
      >
        {/* Step Indicator Header */}
        <div className="language-modal-header">
          <div className="language-modal-badge">
            <Globe size={16} color="#38bdf8" />
            <span>{t('welcome.step', { current: step, total: 2 }, `Шаг ${step} из 2`)}</span>
          </div>

          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="header-step-1"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
              >
                <h2>{t('welcome.native_title', 'Выберите язык приложения')}</h2>
                <p>{t('welcome.native_subtitle', 'Этот язык будет использоваться для интерфейса, объяснений грамматики и перевода слов ИИ.')}</p>
              </motion.div>
            ) : (
              <motion.div
                key="header-step-2"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
              >
                <h2>{t('welcome.target_title', 'Какой язык вы хотите изучать?')}</h2>
                <p>{t('welcome.target_subtitle', 'Выберите основной язык для обучения. Вы сможете переключаться в любой момент.')}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="step-1"
              className="language-options-grid"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22 }}
            >
              {SUPPORTED_NATIVE_LANGUAGES.map((lang) => {
                const isSelected = selectedNative === lang.code;
                return (
                  <motion.div
                    key={lang.code}
                    className={`language-card-item ${isSelected ? 'selected' : ''}`}
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => handleSelectNative(lang.code)}
                  >
                    <div className="language-card-flag">
                      {renderFlag(lang.code, 32)}
                    </div>

                    <div className="language-card-info">
                      <div className="language-card-title">
                        <span className="lang-name" style={{ fontSize: '1.05rem' }}>{lang.name}</span>
                      </div>
                    </div>

                    <div className={`language-radio ${isSelected ? 'active' : ''}`}>
                      {isSelected && <Check size={16} color="#ffffff" />}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="step-2"
              className="language-options-grid"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.22 }}
            >
              {SUPPORTED_LANGUAGES.map((lang) => {
                const isSelected = selectedTarget === lang.code;
                const localizedLabel = t(`welcome.lang_${lang.code}_label`, lang.label);
                const localizedDesc = t(`welcome.lang_${lang.code}_desc`, lang.desc);

                return (
                  <motion.div
                    key={lang.code}
                    className={`language-card-item ${isSelected ? 'selected' : ''}`}
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => handleSelectTarget(lang.code)}
                  >
                    <div className="language-card-flag">
                      {renderFlag(lang.code, 36)}
                    </div>

                    <div className="language-card-info">
                      <div className="language-card-title">
                        <span className="lang-name">{localizedLabel}</span>
                        <span className="lang-code">({lang.name})</span>
                      </div>
                      <p className="lang-desc">{localizedDesc}</p>
                    </div>

                    <div className={`language-radio ${isSelected ? 'active' : ''}`}>
                      {isSelected && <Check size={16} color="#ffffff" />}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer Actions */}
        <div className="language-modal-footer">
          {step === 1 ? (
            <button
              className="btn btn-primary btn-large btn-glow"
              onClick={() => setStep(2)}
            >
              <span>{t('welcome.next', 'ОК / Далее ➔')}</span>
              <ArrowRight size={18} />
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(1)}
                style={{
                  padding: '14px 18px',
                  borderRadius: '14px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#e2e8f0',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <ArrowLeft size={16} />
                <span>{t('welcome.back', 'Назад')}</span>
              </button>
              <button
                className="btn btn-primary btn-large btn-glow"
                style={{ flex: 1 }}
                onClick={handleFinish}
              >
                <Sparkles size={18} />
                <span>{t('welcome.start_learning', 'ОК / Начать обучение 🚀')}</span>
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
