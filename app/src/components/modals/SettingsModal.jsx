import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { HelpButton } from '../TutorialOverlay';
import { useUiStore } from '../../store/useUiStore';
import { useTranslation } from '../../i18n/i18nContext';

// Modular Tabs
import { GeneralTab } from '../settings/GeneralTab';
import { DesignTab } from '../settings/DesignTab';
import { VoiceTab } from '../settings/VoiceTab';
import { AITab } from '../settings/AITab';
import { PromptsTab } from '../settings/PromptsTab';
import { ProfileTab } from '../settings/ProfileTab';
import { RemindersTab } from '../settings/RemindersTab';
import { SrsTab } from '../settings/SrsTab';

export const SettingsModal = ({ userId, startTutorial }) => {
  const { isSettingsOpen, setIsSettingsOpen, settingsTab } = useUiStore();
  const { t } = useTranslation();

  const ADMIN_USER_ID = 642478257;
  const isAdmin = Number(userId) === ADMIN_USER_ID;

  const getInitialTab = () => {
    if (settingsTab) return settingsTab;
    try {
      const stored = localStorage.getItem('lerne_last_settings_tab');
      if (stored && (stored !== 'ai' || isAdmin)) return stored;
    } catch {
      // ignore
    }
    return 'general';
  };

  const [activeSettingsTab, setActiveSettingsTab] = useState(getInitialTab);
  const [customBackgrounds] = useState([]);

  const handleTabChange = (tab) => {
    setActiveSettingsTab(tab);
    try {
      localStorage.setItem('lerne_last_settings_tab', tab);
    } catch {
      // ignore
    }
  };

  React.useEffect(() => {
    if (isSettingsOpen) {
      if (settingsTab) {
        setActiveSettingsTab(settingsTab);
        try {
          localStorage.setItem('lerne_last_settings_tab', settingsTab);
        } catch {
          // ignore
        }
      } else {
        try {
          const stored = localStorage.getItem('lerne_last_settings_tab');
          if (stored && (stored !== 'ai' || isAdmin)) {
            setActiveSettingsTab(stored);
          } else {
            setActiveSettingsTab('general');
          }
        } catch {
          setActiveSettingsTab('general');
        }
      }
    }
  }, [isSettingsOpen, settingsTab, isAdmin]);

  React.useEffect(() => {
    if (!isAdmin && activeSettingsTab === 'ai') {
      setActiveSettingsTab('general');
    }
  }, [isAdmin, activeSettingsTab]);

  return (
    <AnimatePresence>
      {isSettingsOpen && (
        <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            exit={{ opacity: 0, y: 50 }} 
            className="settings-modal wide-modal" 
            onClick={e => e.stopPropagation()}
          >
            <div className="settings-header">
              <h2>{t('settings.title', 'Настройки')}</h2>
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
                onChange={(e) => handleTabChange(e.target.value)}
              >
                <option value="profile">👤 Профиль</option>
                <option value="srs">🧠 SRS (Интервалы и память)</option>
                <option value="reminders">🔔 Напоминания бота</option>
                <option value="general">⚙️ {t('settings.tab_general', 'Общие настройки')}</option>
                <option value="design">🎨 {t('settings.tab_design', 'Дизайн')}</option>
                <option value="voice">🗣 {t('settings.tab_voice', 'Озвучка')}</option>
                {isAdmin && <option value="ai">🤖 {t('settings.tab_models', 'Провайдеры ИИ')}</option>}
                <option value="prompts">📝 {t('settings.tab_prompts', 'Промпты ИИ')}</option>
              </select>
            </div>

            <div className="settings-content scrollable">
              {activeSettingsTab === 'profile' && <ProfileTab userId={userId} />}
              {activeSettingsTab === 'srs' && <SrsTab />}
              {activeSettingsTab === 'reminders' && <RemindersTab />}
              {activeSettingsTab === 'general' && <GeneralTab userId={userId} />}
              {activeSettingsTab === 'design' && (
                <DesignTab 
                  customBackgrounds={customBackgrounds} 
                  uploadCustomBackground={() => {}} 
                />
              )}
              {activeSettingsTab === 'voice' && <VoiceTab />}
              {activeSettingsTab === 'ai' && isAdmin && <AITab />}
              {activeSettingsTab === 'prompts' && <PromptsTab />}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};


