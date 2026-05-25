import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { HelpButton } from './TutorialOverlay';
import { useUiStore } from '../store/useUiStore';
import { useSettingsStore } from '../store/useSettingsStore';

// Modular Tabs
import { GeneralTab } from './settings/GeneralTab';
import { DesignTab } from './settings/DesignTab';
import { VoiceTab } from './settings/VoiceTab';
import { AITab } from './settings/AITab';
import { PromptsTab } from './settings/PromptsTab';
import { ProfileTab } from './settings/ProfileTab';

export const SettingsModal = ({ userId, startTutorial }) => {
  const { isSettingsOpen, setIsSettingsOpen, showToast } = useUiStore();
  const { isAdmin, adminSettings, setAdminSettings, userPrompts, setUserPrompts } = useSettingsStore();

  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [customBackgrounds, setCustomBackgrounds] = useState([]);

  const tabsRef = useRef(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  const updateFadeIndicators = () => {
    if (tabsRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = tabsRef.current;
      setShowLeftFade(scrollLeft > 5);
      setShowRightFade(scrollLeft < scrollWidth - clientWidth - 5);
    }
  };

  useEffect(() => {
    if (!isSettingsOpen) return;

    // Initial check after rendering
    const timer = setTimeout(updateFadeIndicators, 100);

    const tabsEl = tabsRef.current;
    if (tabsEl) {
      tabsEl.addEventListener('scroll', updateFadeIndicators);
    }
    window.addEventListener('resize', updateFadeIndicators);

    return () => {
      clearTimeout(timer);
      if (tabsEl) {
        tabsEl.removeEventListener('scroll', updateFadeIndicators);
      }
      window.removeEventListener('resize', updateFadeIndicators);
    };
  }, [isSettingsOpen, activeSettingsTab]);

  if (!isSettingsOpen) return null;

  return (
    <AnimatePresence>
      <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
        <motion.div 
          initial={{ opacity: 0, y: 50 }} 
          animate={{ opacity: 1, y: 0 }} 
          exit={{ opacity: 0, y: 50 }} 
          className="settings-modal wide-modal" 
          onClick={e => e.stopPropagation()}
        >
          <div className="settings-header">
            <h2>Настройки</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <HelpButton onClick={() => startTutorial('settings')} />
              <button className="close-btn" onClick={() => setIsSettingsOpen(false)}>
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="settings-tabs-container">
            <div className={`settings-tabs-fade settings-tabs-fade-left ${showLeftFade ? 'visible' : ''}`}></div>
            <div id="tut-settings-tabs" className="settings-tabs" ref={tabsRef}>
              <button className={`tab-btn ${activeSettingsTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('profile')}>Профиль</button>
              <button className={`tab-btn ${activeSettingsTab === 'general' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('general')}>Общие</button>
              <button className={`tab-btn ${activeSettingsTab === 'design' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('design')}>Дизайн</button>
              <button className={`tab-btn ${activeSettingsTab === 'voice' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('voice')}>Озвучка</button>
              <button className={`tab-btn ${activeSettingsTab === 'ai' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('ai')}>Провайдеры</button>
              <button className={`tab-btn ${activeSettingsTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveSettingsTab('prompts')}>Промпты</button>
            </div>
            <div className={`settings-tabs-fade settings-tabs-fade-right ${showRightFade ? 'visible' : ''}`}></div>
          </div>

          <div className="settings-content scrollable">
            <AnimatePresence mode="wait">
              {activeSettingsTab === 'profile' && <ProfileTab />}
              {activeSettingsTab === 'general' && <GeneralTab userId={userId} />}
              {activeSettingsTab === 'design' && (
                <DesignTab 
                  customBackgrounds={customBackgrounds} 
                  uploadCustomBackground={() => {}} 
                />
              )}
              {activeSettingsTab === 'voice' && <VoiceTab />}
              {activeSettingsTab === 'ai' && <AITab />}
              {activeSettingsTab === 'prompts' && <PromptsTab />}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

