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
  const { isSettingsOpen, setIsSettingsOpen } = useUiStore();
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [customBackgrounds] = useState([]);

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

          <div className="settings-dropdown-container">
            <label htmlFor="settings-tab-select" className="settings-dropdown-label">Раздел настроек:</label>
            <select
              id="settings-tab-select"
              className="settings-dropdown-select glass"
              value={activeSettingsTab}
              onChange={(e) => setActiveSettingsTab(e.target.value)}
            >
              <option value="profile">👤 Профиль пользователя</option>
              <option value="general">⚙️ Общие настройки</option>
              <option value="design">🎨 Оформление и дизайн</option>
              <option value="voice">🗣 Озвучка и голос</option>
              <option value="ai">🤖 Провайдеры ИИ</option>
              <option value="prompts">📝 Промпты для карточек</option>
            </select>
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

